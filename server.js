// Study-material sharing server. No dependencies: Node built-ins only.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const DATA = path.join(__dirname, "data");
const UPLOADS = path.join(DATA, "uploads");
const DB_FILE = path.join(DATA, "db.json");

const MAX_UPLOAD = 10 * 1024 * 1024; // 10 MB
const MAX_JSON = 100 * 1024;
// Study-material file types only
const ALLOWED_EXT = new Set([
  ".pdf", ".txt", ".md", ".doc", ".docx", ".ppt", ".pptx",
  ".xls", ".xlsx", ".csv", ".png", ".jpg", ".jpeg", ".gif", ".webp",
]);

fs.mkdirSync(UPLOADS, { recursive: true });

/* ---------- Tiny JSON "database" ---------- */
let db = { users: [], sessions: {}, uploads: [], comments: [], subs: [] };
if (fs.existsSync(DB_FILE)) db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
function persist() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

/* ---------- Helpers ---------- */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function send(res, status, body, headers = {}) {
  const isObj = typeof body === "object" && !Buffer.isBuffer(body);
  res.writeHead(status, {
    "Content-Type": isObj ? "application/json" : "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, "File or request too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req, MAX_JSON);
  try { return JSON.parse(buf.toString("utf8") || "{}"); }
  catch { throw new HttpError(400, "Invalid JSON"); }
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function currentUser(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  const name = db.sessions[sha(sid)];
  return name ? db.users.find((u) => u.name === name) || null : null;
}
function requireUser(req) {
  const u = currentUser(req);
  if (!u) throw new HttpError(401, "Please log in first");
  return u;
}

// Basic brute-force protection on login/register
const attempts = new Map();
function throttle(req) {
  const ip = req.socket.remoteAddress;
  const now = Date.now();
  const a = attempts.get(ip) && attempts.get(ip).reset > now ? attempts.get(ip) : { n: 0, reset: now + 15 * 60 * 1000 };
  a.n++;
  attempts.set(ip, a);
  if (a.n > 30) throw new HttpError(429, "Too many attempts, try again later");
}

function clean(s, max) {
  return String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

function uploadView(u, me) {
  const cs = db.comments.filter((c) => c.uploadId === u.id);
  return {
    id: u.id, title: u.title, subject: u.subject, description: u.description,
    filename: u.filename, size: u.size, owner: u.owner, created: u.created,
    comments: cs.length,
    openQueries: cs.filter((c) => c.isQuery && !c.resolved).length,
    mine: !!me && me.name === u.owner,
    subscribed: !!me && db.subs.some((s) => s.follower === me.name && s.target === u.owner),
  };
}

/* ---------- API ---------- */
async function api(req, res, url) {
  const m = req.method;
  const p = url.pathname;
  let r;

  // --- auth ---
  if (m === "POST" && p === "/api/register") {
    throttle(req);
    const { username, password } = await readJson(req);
    const name = clean(username, 20).toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(name)) throw new HttpError(400, "Username: 3-20 letters, numbers or _");
    if (typeof password !== "string" || password.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
    if (db.users.some((u) => u.name === name)) throw new HttpError(409, "Username already taken");
    const salt = crypto.randomBytes(16).toString("hex");
    db.users.push({ name, salt, hash: crypto.scryptSync(password, salt, 64).toString("hex"), created: Date.now() });
    return startSession(res, name);
  }
  if (m === "POST" && p === "/api/login") {
    throttle(req);
    const { username, password } = await readJson(req);
    const u = db.users.find((x) => x.name === clean(username, 20).toLowerCase());
    const ok = u && typeof password === "string" &&
      crypto.timingSafeEqual(Buffer.from(u.hash, "hex"), crypto.scryptSync(password, u.salt, 64));
    if (!ok) throw new HttpError(401, "Wrong username or password");
    return startSession(res, u.name);
  }
  if (m === "POST" && p === "/api/logout") {
    const sid = parseCookies(req).sid;
    if (sid) { delete db.sessions[sha(sid)]; persist(); }
    return send(res, 200, { ok: true }, { "Set-Cookie": "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
  }
  if (m === "GET" && p === "/api/me") {
    const u = currentUser(req);
    return send(res, 200, { user: u ? u.name : null });
  }

  // --- uploads ---
  if (m === "GET" && p === "/api/uploads") {
    const me = currentUser(req);
    const q = clean(url.searchParams.get("q"), 100).toLowerCase();
    const subject = clean(url.searchParams.get("subject"), 40).toLowerCase();
    const user = clean(url.searchParams.get("user"), 20).toLowerCase();
    const feed = url.searchParams.get("feed") === "1";
    if (feed && !me) throw new HttpError(401, "Log in to see your subscription feed");
    const followed = feed ? new Set(db.subs.filter((s) => s.follower === me.name).map((s) => s.target)) : null;
    const list = db.uploads
      .filter((u) => !followed || followed.has(u.owner))
      .filter((u) => !user || u.owner === user)
      .filter((u) => !subject || u.subject.toLowerCase() === subject)
      .filter((u) => !q || [u.title, u.description, u.subject, u.owner, u.filename].join(" ").toLowerCase().includes(q))
      .sort((a, b) => b.created - a.created)
      .map((u) => uploadView(u, me));
    return send(res, 200, { uploads: list, subjects: [...new Set(db.uploads.map((u) => u.subject))].sort() });
  }
  if (m === "POST" && p === "/api/uploads") {
    const me = requireUser(req);
    const h = req.headers;
    const dec = (v) => { try { return decodeURIComponent(v || ""); } catch { return ""; } };
    if (h["x-confirm-study"] !== "yes") throw new HttpError(400, "Please confirm this is study material you may share");
    const filename = clean(dec(h["x-filename"]), 120).replace(/[\\/]/g, "_");
    const ext = path.extname(filename).toLowerCase();
    if (!filename || !ALLOWED_EXT.has(ext)) throw new HttpError(400, "Only study files are allowed: " + [...ALLOWED_EXT].join(" "));
    const title = clean(dec(h["x-title"]), 100);
    const subject = clean(dec(h["x-subject"]), 40);
    if (!title || !subject) throw new HttpError(400, "Title and subject are required");
    if (Number(h["content-length"]) > MAX_UPLOAD) throw new HttpError(413, "Max file size is 10 MB");
    const body = await readBody(req, MAX_UPLOAD);
    if (!body.length) throw new HttpError(400, "Empty file");
    const id = crypto.randomUUID();
    fs.writeFileSync(path.join(UPLOADS, id + ext), body);
    const rec = { id, title, subject, description: clean(dec(h["x-description"]), 500), filename, ext, size: body.length, owner: me.name, created: Date.now() };
    db.uploads.push(rec);
    persist();
    return send(res, 201, uploadView(rec, me));
  }
  if ((r = p.match(/^\/api\/files\/([\w-]+)$/)) && m === "GET") {
    const u = db.uploads.find((x) => x.id === r[1]);
    if (!u) throw new HttpError(404, "Not found");
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(u.filename),
      "Content-Length": u.size,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    });
    return fs.createReadStream(path.join(UPLOADS, u.id + u.ext)).pipe(res);
  }
  if ((r = p.match(/^\/api\/uploads\/([\w-]+)$/)) && m === "DELETE") {
    const me = requireUser(req);
    const u = db.uploads.find((x) => x.id === r[1]);
    if (!u) throw new HttpError(404, "Not found");
    if (u.owner !== me.name) throw new HttpError(403, "Not your upload");
    fs.rmSync(path.join(UPLOADS, u.id + u.ext), { force: true });
    db.uploads = db.uploads.filter((x) => x.id !== u.id);
    db.comments = db.comments.filter((c) => c.uploadId !== u.id);
    persist();
    return send(res, 200, { ok: true });
  }

  // --- comments & queries ---
  if ((r = p.match(/^\/api\/uploads\/([\w-]+)\/comments$/))) {
    const u = db.uploads.find((x) => x.id === r[1]);
    if (!u) throw new HttpError(404, "Not found");
    if (m === "GET") {
      const me = currentUser(req);
      const list = db.comments.filter((c) => c.uploadId === u.id).sort((a, b) => a.created - b.created)
        .map((c) => ({ ...c, canDelete: !!me && (me.name === c.author || me.name === u.owner),
                       canResolve: !!me && c.isQuery && (me.name === c.author || me.name === u.owner) }));
      return send(res, 200, { comments: list });
    }
    if (m === "POST") {
      const me = requireUser(req);
      const { text, isQuery } = await readJson(req);
      const t = clean(text, 1000);
      if (!t) throw new HttpError(400, "Write something first");
      const c = { id: crypto.randomUUID(), uploadId: u.id, author: me.name, text: t, isQuery: !!isQuery, resolved: false, created: Date.now() };
      db.comments.push(c);
      persist();
      return send(res, 201, c);
    }
  }
  if ((r = p.match(/^\/api\/comments\/([\w-]+)(\/resolve)?$/))) {
    const me = requireUser(req);
    const c = db.comments.find((x) => x.id === r[1]);
    if (!c) throw new HttpError(404, "Not found");
    const u = db.uploads.find((x) => x.id === c.uploadId);
    const allowed = me.name === c.author || (u && me.name === u.owner);
    if (!allowed) throw new HttpError(403, "Not allowed");
    if (m === "DELETE" && !r[2]) {
      db.comments = db.comments.filter((x) => x.id !== c.id);
      persist();
      return send(res, 200, { ok: true });
    }
    if (m === "POST" && r[2]) {
      if (!c.isQuery) throw new HttpError(400, "Only queries can be resolved");
      c.resolved = !c.resolved;
      persist();
      return send(res, 200, c);
    }
  }

  // --- subscriptions ---
  if (m === "GET" && p === "/api/subscriptions") {
    const me = requireUser(req);
    return send(res, 200, { subscriptions: db.subs.filter((s) => s.follower === me.name).map((s) => s.target) });
  }
  if ((r = p.match(/^\/api\/users\/([a-z0-9_]{3,20})$/)) && m === "GET") {
    const me = currentUser(req);
    const user = db.users.find((u) => u.name === r[1]);
    if (!user) throw new HttpError(404, "No such user");
    return send(res, 200, {
      name: user.name,
      uploads: db.uploads.filter((u) => u.owner === user.name).length,
      subscribers: db.subs.filter((s) => s.target === user.name).length,
      subscribed: !!me && db.subs.some((s) => s.follower === me.name && s.target === user.name),
      isMe: !!me && me.name === user.name,
    });
  }
  if ((r = p.match(/^\/api\/subscribe\/([a-z0-9_]{3,20})$/)) && (m === "POST" || m === "DELETE")) {
    const me = requireUser(req);
    if (!db.users.some((u) => u.name === r[1])) throw new HttpError(404, "No such user");
    if (r[1] === me.name) throw new HttpError(400, "You can't subscribe to yourself");
    db.subs = db.subs.filter((s) => !(s.follower === me.name && s.target === r[1]));
    if (m === "POST") db.subs.push({ follower: me.name, target: r[1] });
    persist();
    return send(res, 200, { subscribed: m === "POST" });
  }

  throw new HttpError(404, "Unknown API route");
}

function startSession(res, name) {
  const sid = crypto.randomBytes(32).toString("hex");
  db.sessions[sha(sid)] = name;
  persist();
  send(res, 200, { user: name }, {
    "Set-Cookie": `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
  });
}

/* ---------- Static files ---------- */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, "Not found");
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'",
  });
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else if (req.method === "GET") serveStatic(req, res, url);
    else send(res, 405, "Method not allowed");
  } catch (e) {
    if (!res.headersSent) {
      if (e instanceof HttpError) send(res, e.status, { error: e.message });
      else { console.error(e); send(res, 500, { error: "Server error" }); }
    }
  }
}).listen(PORT, () => console.log(`Study library running at http://localhost:${PORT}`));
