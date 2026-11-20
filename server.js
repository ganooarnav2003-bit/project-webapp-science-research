// Study-material sharing server. No dependencies: Node built-ins only.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : process.env.VERCEL ? "/tmp/notebook-data" : path.join(__dirname, "data");
const UPLOADS = path.join(DATA, "uploads");
const DB_FILE = path.join(DATA, "db.json");

const { TOPICS, SUBJECTS } = require("./topics");

const MAX_UPLOAD = 25 * 1024 * 1024; // hard cap; each plan has its own lower limit
const MAX_JSON = 100 * 1024;

// Subscription plans. Prices are in rupees (INR); null = unlimited.
const PLANS = {
  free: { name: "Free", price: { month: 0, year: 0 }, maxUploads: 5, maxMB: 5,
    features: ["Browse & download all study material", "Comment and ask queries", "Upload up to 5 files (5 MB each)"] },
  student: { name: "Student", price: { month: 199, year: 1999 }, maxUploads: 50, maxMB: 10,
    features: ["Everything in Free", "Upload up to 50 files (10 MB each)", "Priority listing for your uploads"] },
  pro: { name: "Pro", price: { month: 499, year: 4999 }, maxUploads: null, maxMB: 25,
    features: ["Everything in Student", "Unlimited uploads (25 MB each)", "Best for teachers and study groups"] },
};
const DAY = 24 * 60 * 60 * 1000;

// Razorpay (set these environment variables to switch on payments)
const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const RZP_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";
const RZP_API = process.env.RAZORPAY_API || "https://api.razorpay.com";
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
// Study-material file types only
const ALLOWED_EXT = new Set([
  ".pdf", ".txt", ".md", ".doc", ".docx", ".ppt", ".pptx",
  ".xls", ".xlsx", ".csv", ".png", ".jpg", ".jpeg", ".gif", ".webp",
]);

fs.mkdirSync(UPLOADS, { recursive: true });

/* ---------- Tiny JSON "database" ---------- */
let db = { users: [], sessions: {}, uploads: [], comments: [], subs: [], orders: [] };
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
// Behind a host/proxy (Render, Railway, Heroku, nginx...) the socket address is the proxy's,
// so rate limits would be shared by everyone. Set TRUST_PROXY=1 to use X-Forwarded-For.
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const clientIp = (req) => (TRUST_PROXY && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress;
const isHttps = (req) => req.socket.encrypted || (TRUST_PROXY && req.headers["x-forwarded-proto"] === "https");
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
  const ip = clientIp(req);
  const now = Date.now();
  const a = attempts.get(ip) && attempts.get(ip).reset > now ? attempts.get(ip) : { n: 0, reset: now + 15 * 60 * 1000 };
  a.n++;
  attempts.set(ip, a);
  if (a.n > 30) throw new HttpError(429, "Too many attempts, try again later");
}

function clean(s, max) {
  return String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

function planOf(user) {
  const p = user && user.plan;
  const id = p && p.expires > Date.now() && PLANS[p.id] ? p.id : "free";
  return { id, ...PLANS[id], expires: id === "free" ? null : p.expires, interval: id === "free" ? null : p.interval };
}
function planView(user) {
  const p = planOf(user);
  return { id: p.id, name: p.name, expires: p.expires, interval: p.interval, maxUploads: p.maxUploads, maxMB: p.maxMB,
    uploadsUsed: db.uploads.filter((u) => u.owner === user.name).length };
}
function activateOrder(order) {
  if (order.status === "paid") return;
  const user = db.users.find((u) => u.name === order.user);
  if (!user) return;
  const now = Date.now();
  const same = user.plan && user.plan.id === order.plan && user.plan.expires > now;
  const base = same ? user.plan.expires : now;
  user.plan = { id: order.plan, interval: order.interval, expires: base + (order.interval === "year" ? 365 : 30) * DAY };
  order.status = "paid";
  persist();
}
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const hmac = (secret, data) => crypto.createHmac("sha256", secret).update(data).digest("hex");

/* ---------- Chat assistant: library search + optional Claude answers ---------- */
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_URL = process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages";
const CHAT_MODEL = process.env.CHAT_MODEL || "claude-haiku-5-5";
const STOP = new Set("the and for are was what how why when who which with this that these those can you your about from have has into does did not but any all tell give show find explain please help need want like get use using been being more some than then them they their there here would could should will just also very much many such own same each other out our its it's is of to in on at as by an or be a i me my we do if so no yes".split(" "));
const tokens = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));

const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { n: 1, reset: now + windowMs }); return; }
  if (++b.n > max) throw new HttpError(429, "You're sending messages too fast. Please wait a moment.");
}

function searchLibrary(msg) {
  const q = tokens(msg);
  if (!q.length) return { topics: [], uploads: [] };
  const lower = msg.toLowerCase();
  const topics = TOPICS.map((t) => {
    const name = new Set(tokens(t.name)), body = new Set(tokens(t.summary + " " + t.subject));
    let s = lower.includes(t.name.toLowerCase()) ? 6 : 0;
    q.forEach((w) => { if (name.has(w)) s += 3; else if (body.has(w)) s += 1; });
    return { t, s };
  }).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.t);
  const uploads = db.uploads.map((u) => {
    const title = new Set(tokens(u.title + " " + u.subject)), desc = new Set(tokens(u.description + " " + u.filename));
    let s = 0;
    q.forEach((w) => { if (title.has(w)) s += 3; else if (desc.has(w)) s += 1; });
    return { u, s };
  }).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s || b.u.created - a.u.created).slice(0, 3).map((x) => x.u);
  return { topics, uploads };
}

function siteAnswer(msg) {
  const m = msg.toLowerCase();
  const rs = (n) => "₹" + n.toLocaleString("en-IN");
  if (/^(hi|hello|hey|namaste|good (morning|afternoon|evening))\b/.test(m)) {
    return "Hi! I'm Flaskie, your study helper. Ask me about a topic (e.g. “photosynthesis”), search shared notes, or ask about plans and uploads.";
  }
  if (/\b(plans?|pric(e|es|ing)|cost|rupees?|upgrade|how much)\b/.test(m) || /₹|pay for/.test(m)) {
    return "Plans (in ₹): " + Object.values(PLANS).map((p) =>
      p.price.month ? `${p.name} ${rs(p.price.month)}/month or ${rs(p.price.year)}/year (${p.maxUploads === null ? "unlimited" : p.maxUploads} uploads, ${p.maxMB} MB each)`
        : `${p.name} ${rs(0)} (${p.maxUploads} uploads, ${p.maxMB} MB each)`).join("; ") + ". Open the Plans tab to upgrade.";
  }
  if (/\bhow\b.*\b(upload|share)\b/.test(m) || /\bupload(ing)?\b.*\b(file|notes?)\b/.test(m)) {
    return "To share study material: log in, open the Library tab, fill in the title and subject, choose a file (PDF, Word, PowerPoint, Excel, CSV, text or image), tick the study-material box and press Upload. Free accounts can upload 5 files of up to 5 MB.";
  }
  if (/\bhow\b.*\bsubscri/.test(m) || /\bsubscri(be|ption)s?\b.*\b(user|people|someone|uploader)/.test(m)) {
    return "To follow someone, click “+ Subscribe” next to their upload in the Library (or open their profile by clicking @name). Their new uploads then appear under My subscriptions. Paid plans are separate: see the Plans tab.";
  }
  if (/\bhow\b.*\b(comment|query|queries|ask)\b/.test(m)) {
    return "Under every upload, click “Comments”, write your message and tick “This is a query” if it's a question. The uploader can mark it answered.";
  }
  return null;
}

function resultLinks(found) {
  return [
    ...found.topics.map((t) => ({ type: "topic", title: t.name, detail: t.subject, url: "/topics/" + t.slug })),
    ...found.uploads.map((u) => ({ type: "upload", title: u.title, detail: u.subject + " · by " + u.owner, url: "/api/files/" + u.id })),
  ];
}

async function askClaude(msg, history, found) {
  const ctx = [
    ...found.topics.map((t) => `Topic "${t.name}" (${t.subject}): ${t.summary}`),
    ...found.uploads.map((u) => `Shared file "${u.title}" (${u.subject}): ${u.description || "no description"}`),
  ].join("\n");
  const system = "You are Flaskie, a friendly study assistant inside a study-material sharing website. " +
    "Answer study questions clearly and briefly (under 150 words), step by step when solving problems. " +
    "Stay on study and learning topics. You cannot read the contents of shared files; only mention their titles. " +
    "If you are not sure, say so.\n" + (ctx ? "Relevant items on this site:\n" + ctx : "");
  const messages = [...history, { role: "user", content: msg }];
  const r = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: CHAT_MODEL, max_tokens: 600, system, messages }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error("status " + r.status);
  const j = await r.json();
  const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  if (!text) throw new Error("empty answer");
  return text;
}

async function chat(req, me, body) {
  rateLimit("chat:" + clientIp(req), 30, 60 * 1000);
  const msg = clean(body.message, 500);
  if (!msg) throw new HttpError(400, "Type a question first");
  const history = (Array.isArray(body.history) ? body.history : []).slice(-6)
    .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string" && h.content.trim())
    .map((h) => ({ role: h.role, content: clean(h.content, 800) }));
  while (history.length && history[0].role !== "user") history.shift();

  const site = siteAnswer(msg);
  if (site) return { reply: site, results: [], source: "site" };

  const found = searchLibrary(msg);
  const results = resultLinks(found);

  if (ANTHROPIC_KEY && me) {
    rateLimit("ai:" + me.name, 20, 60 * 60 * 1000);
    try { return { reply: await askClaude(msg, history, found), results, source: "ai" }; }
    catch (e) { console.error("Claude chat failed:", e.message); }
  }
  if (results.length) return { reply: "Here's what I found in the library:", results, source: "search" };
  const hint = ANTHROPIC_KEY && !me ? " Log in and I can also answer study questions in detail." : "";
  return { reply: "I couldn't find anything for that yet. Try different keywords, browse the Topics page, or post it as a query under a related upload so the community can help." + hint, results: [], source: "search" };
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
    return startSession(req, res, name);
  }
  if (m === "POST" && p === "/api/login") {
    throttle(req);
    const { username, password } = await readJson(req);
    const u = db.users.find((x) => x.name === clean(username, 20).toLowerCase());
    const ok = u && typeof password === "string" &&
      crypto.timingSafeEqual(Buffer.from(u.hash, "hex"), crypto.scryptSync(password, u.salt, 64));
    if (!ok) throw new HttpError(401, "Wrong username or password");
    return startSession(req, res, u.name);
  }
  if (m === "POST" && p === "/api/logout") {
    const sid = parseCookies(req).sid;
    if (sid) { delete db.sessions[sha(sid)]; persist(); }
    return send(res, 200, { ok: true }, { "Set-Cookie": "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
  }
  if (m === "GET" && p === "/api/me") {
    const u = currentUser(req);
    return send(res, 200, { user: u ? u.name : null, plan: u ? planView(u) : null });
  }

  if (m === "POST" && p === "/api/chat") {
    return send(res, 200, await chat(req, currentUser(req), await readJson(req)));
  }
  if (m === "GET" && p === "/api/chat/status") {
    return send(res, 200, { ai: !!ANTHROPIC_KEY });
  }

  // --- plans & billing (INR via Razorpay) ---
  if (m === "GET" && p === "/api/plans") {
    return send(res, 200, { currency: "INR", plans: PLANS, paymentsEnabled: !!(RZP_KEY_ID && RZP_KEY_SECRET), keyId: RZP_KEY_ID || null });
  }
  if (m === "POST" && p === "/api/billing/order") {
    const me = requireUser(req);
    if (!RZP_KEY_ID || !RZP_KEY_SECRET) throw new HttpError(503, "Online payments are not switched on yet");
    const { plan, interval } = await readJson(req);
    if (!PLANS[plan] || plan === "free" || !["month", "year"].includes(interval)) throw new HttpError(400, "Choose a paid plan and billing period");
    const amount = PLANS[plan].price[interval]; // always taken from the server, never the client
    const local = crypto.randomUUID();
    let rz;
    try {
      const r2 = await fetch(RZP_API + "/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(RZP_KEY_ID + ":" + RZP_KEY_SECRET).toString("base64") },
        body: JSON.stringify({ amount: amount * 100, currency: "INR", receipt: "rcpt_" + local.slice(0, 30) }),
      });
      if (!r2.ok) throw new Error("status " + r2.status);
      rz = await r2.json();
    } catch (e) {
      console.error("Razorpay order failed:", e.message);
      throw new HttpError(502, "Could not start payment, please try again");
    }
    db.orders.push({ id: rz.id, user: me.name, plan, interval, amount, status: "created", created: Date.now() });
    persist();
    return send(res, 200, { orderId: rz.id, amount: amount * 100, currency: "INR", keyId: RZP_KEY_ID, plan: PLANS[plan].name });
  }
  if (m === "POST" && p === "/api/billing/verify") {
    const me = requireUser(req);
    const b = await readJson(req);
    const order = db.orders.find((o) => o.id === b.razorpay_order_id && o.user === me.name);
    if (!order) throw new HttpError(404, "Order not found");
    const expected = hmac(RZP_KEY_SECRET, order.id + "|" + String(b.razorpay_payment_id));
    if (!RZP_KEY_SECRET || !safeEqual(expected, b.razorpay_signature)) throw new HttpError(400, "Payment could not be verified");
    order.paymentId = String(b.razorpay_payment_id);
    activateOrder(order);
    return send(res, 200, { plan: planView(me) });
  }
  if (m === "POST" && p === "/api/billing/webhook") {
    // Backup path: Razorpay tells us a payment was captured even if the browser closed early.
    if (!RZP_WEBHOOK_SECRET) throw new HttpError(503, "Webhook not configured");
    const raw = await readBody(req, MAX_JSON);
    if (!safeEqual(hmac(RZP_WEBHOOK_SECRET, raw), req.headers["x-razorpay-signature"] || "")) throw new HttpError(400, "Bad signature");
    let ev;
    try { ev = JSON.parse(raw.toString("utf8")); } catch { throw new HttpError(400, "Bad JSON"); }
    const pay = ev && ev.payload && ev.payload.payment && ev.payload.payment.entity;
    if (pay && ["payment.captured", "order.paid"].includes(ev.event)) {
      const order = db.orders.find((o) => o.id === pay.order_id);
      if (order && pay.amount === order.amount * 100 && pay.currency === "INR") { order.paymentId = pay.id; activateOrder(order); }
    }
    return send(res, 200, { ok: true });
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
    const plan = planOf(me);
    const used = db.uploads.filter((x) => x.owner === me.name).length;
    if (plan.maxUploads !== null && used >= plan.maxUploads) {
      throw new HttpError(403, `Your ${plan.name} plan allows ${plan.maxUploads} uploads. Upgrade your plan to upload more.`);
    }
    const limit = plan.maxMB * 1024 * 1024;
    if (Number(h["content-length"]) > limit) throw new HttpError(413, `Your ${plan.name} plan allows files up to ${plan.maxMB} MB`);
    const body = await readBody(req, MAX_UPLOAD);
    if (!body.length) throw new HttpError(400, "Empty file");
    if (body.length > limit) throw new HttpError(413, `Your ${plan.name} plan allows files up to ${plan.maxMB} MB`);
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

function startSession(req, res, name) {
  const sid = crypto.randomBytes(32).toString("hex");
  db.sessions[sha(sid)] = name;
  persist();
  send(res, 200, { user: name }, {
    "Set-Cookie": `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}` + (isHttps(req) ? "; Secure" : ""),
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
    "Content-Security-Policy": CSP,
  });
  fs.createReadStream(file).pipe(res);
}

/* ---------- Public topic pages (server-rendered, no login needed) ---------- */
// Razorpay Checkout needs its own script, frame and network hosts.
const CSP = "default-src 'self'; script-src 'self' https://checkout.razorpay.com; " +
  "frame-src https://api.razorpay.com https://checkout.razorpay.com; " +
  "connect-src 'self' https://*.razorpay.com; img-src 'self' data: https://*.razorpay.com";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtSize = (n) => (n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB");

function htmlPage(res, title, desc, body, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | Research Notebook</title>
<meta name="description" content="${esc(desc)}">
<link rel="stylesheet" href="/style.css"></head><body>
<header><div><h1><a class="home" href="/">🔬 Research Notebook</a></h1><p>Free study topics and shared material</p></div>
<nav class="pub-nav"><a href="/topics">Topics</a><a href="/#library">Library</a><a href="/plans">Plans &amp; pricing</a></nav></header>
<main class="pub">${body}</main><script src="/chatbot.js"></script></body></html>`;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": CSP });
  res.end(html);
}

function uploadsHtml(list) {
  if (!list.length) return `<p class="empty">No shared files yet. <a href="/#library">Be the first to upload one.</a></p>`;
  return list.map((u) => `<article class="card"><strong>${esc(u.title)}</strong>
<div class="meta"><span class="chip">${esc(u.subject)}</span> by ${esc(u.owner)} · ${esc(u.filename)} (${fmtSize(u.size)})</div>
${u.description ? `<p class="desc">${esc(u.description)}</p>` : ""}
<a class="btn" href="/api/files/${encodeURIComponent(u.id)}">⬇ Download</a></article>`).join("");
}

function topicsIndex(res) {
  const body = `<h2>Study topics</h2><p class="notice">${TOPICS.length} free topic pages across ${SUBJECTS.length} subjects. Open any topic to see a short overview and the study material shared by the community.</p>` +
    SUBJECTS.map((s) => `<section class="subject-block"><h3>${esc(s)}</h3><div class="topic-grid">` +
      TOPICS.filter((t) => t.subject === s).map((t) => `<a class="topic-link" href="/topics/${t.slug}">${esc(t.name)}</a>`).join("") +
      `</div></section>`).join("");
  htmlPage(res, "Study topics", `Browse ${TOPICS.length} study topics across ${SUBJECTS.length} subjects.`, body);
}

function topicPage(res, slug) {
  const t = TOPICS.find((x) => x.slug === slug);
  if (!t) return htmlPage(res, "Not found", "Topic not found", `<h2>Topic not found</h2><p><a href="/topics">See all topics</a></p>`, 404);
  const needle = t.name.toLowerCase();
  const hay = (u) => [u.title, u.description].join(" ").toLowerCase();
  const direct = db.uploads.filter((u) => hay(u).includes(needle)).sort((a, b) => b.created - a.created).slice(0, 20);
  const ids = new Set(direct.map((u) => u.id));
  const more = db.uploads.filter((u) => u.subject.toLowerCase() === t.subject.toLowerCase() && !ids.has(u.id))
    .sort((a, b) => b.created - a.created).slice(0, 10);
  const related = TOPICS.filter((x) => x.subject === t.subject && x.slug !== t.slug).slice(0, 6);
  const body = `<p><a href="/topics">← All topics</a></p><h2>${esc(t.name)}</h2><p><span class="chip">${esc(t.subject)}</span></p>
<p class="lead">${esc(t.summary)}</p>
<h3>Study material on ${esc(t.name)}</h3>${uploadsHtml(direct)}
${more.length ? `<h3>More ${esc(t.subject)} material</h3>${uploadsHtml(more)}` : ""}
<h3>Related topics</h3><div class="topic-grid">${related.map((x) => `<a class="topic-link" href="/topics/${x.slug}">${esc(x.name)}</a>`).join("")}</div>
<p class="notice">Have notes on this topic? <a href="/#library">Log in and share them</a>, or <a href="/#plans">see plans in ₹</a> for more upload space.</p>`;
  htmlPage(res, t.name, t.summary, body);
}

function plansPage(res) {
  const rs = (n) => "₹" + n.toLocaleString("en-IN");
  const cards = Object.values(PLANS).map((p) => `<div class="card plan"><h3>${esc(p.name)}</h3>
<div class="price">${rs(p.price.month)}<small>${p.price.month ? " / month" : " forever"}</small></div>
${p.price.year ? `<p class="empty">or ${rs(p.price.year)} / year (save ${rs(p.price.month * 12 - p.price.year)})</p>` : ""}
<ul class="feat">${p.features.map((f) => `<li>✓ ${esc(f)}</li>`).join("")}</ul>
<a class="btn" href="/#plans">${p.price.month ? "Choose " + esc(p.name) : "Get started"}</a></div>`).join("");
  htmlPage(res, "Plans and pricing", "Subscription plans in Indian rupees: Free, Student and Pro.",
    `<h2>Plans &amp; pricing</h2><p class="notice">All prices are in Indian rupees (₹). Everyone can browse, download and comment for free; paid plans add upload space.</p><div class="plans">${cards}</div>`);
}

function siteMap(req, res) {
  const base = PUBLIC_URL || "http://" + (req.headers.host || "localhost");
  const urls = ["/", "/topics", "/plans", ...TOPICS.map((t) => "/topics/" + t.slug)];
  res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
  res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `<url><loc>${esc(base + u)}</loc></url>`).join("\n") + `\n</urlset>`);
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/healthz") send(res, 200, { ok: true });
    else if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else if (req.method === "GET" && url.pathname === "/plans") plansPage(res);
    else if (req.method === "GET" && url.pathname === "/topics") topicsIndex(res);
    else if (req.method === "GET" && /^\/topics\/[a-z0-9-]+$/.test(url.pathname)) topicPage(res, url.pathname.slice(8));
    else if (req.method === "GET" && url.pathname === "/sitemap.xml") siteMap(req, res);
    else if (req.method === "GET" && url.pathname === "/robots.txt") {
      const base = PUBLIC_URL || "http://" + (req.headers.host || "localhost");
      send(res, 200, `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${base}/sitemap.xml\n`);
    }
    else if (req.method === "GET") serveStatic(req, res, url);
    else send(res, 405, "Method not allowed");
  } catch (e) {
    if (!res.headersSent) {
      if (e instanceof HttpError) send(res, e.status, { error: e.message });
      else { console.error(e); send(res, 500, { error: "Server error" }); }
    }
  }
}

// `node server.js` runs a normal server; on Vercel the handler is imported by api/index.js instead.
if (require.main === module) {
  http.createServer(handler).listen(PORT, "0.0.0.0", () => console.log(`Study library running on port ${PORT}`));
}
module.exports = handler;
