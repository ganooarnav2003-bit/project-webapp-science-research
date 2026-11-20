/* Shared study library: accounts, uploads, subscriptions, comments & queries.
   All user-provided text is inserted with textContent (never innerHTML). */
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  let me = null;
  let myPlan = null;
  let planInfo = null;
  let interval = "month";
  let userFilter = "";

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: "same-origin", ...opts });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
    return data;
  }
  const post = (path, body) =>
    api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });

  const fmtSize = (n) => (n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB");
  const fmtDate = (t) => new Date(t).toLocaleDateString();

  /* ---------- Tabs ---------- */
  function showView(name) {
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
    if (name === "library") loadLibrary();
    if (name === "feed") loadFeed();
    if (name === "plans") loadPlans();
  }
  document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => showView(b.dataset.view)));

  /* ---------- Auth ---------- */
  let registering = false;
  function setAuthMode(reg) {
    registering = reg;
    $("authTitle").textContent = reg ? "Create account" : "Log in";
    $("authSubmit").textContent = reg ? "Register" : "Log in";
    $("authSwitch").textContent = reg ? "Have an account? Log in" : "Need an account? Register";
    $("authPass").autocomplete = reg ? "new-password" : "current-password";
    $("authError").textContent = "";
  }
  function openAuth(reg) { setAuthMode(reg); $("authDialog").showModal(); }
  $("authSwitch").onclick = () => setAuthMode(!registering);
  $("authCancel").onclick = () => $("authDialog").close();
  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await post(registering ? "/api/register" : "/api/login", {
        username: $("authUser").value, password: $("authPass").value,
      });
      me = r.user;
      await loadMe();
      $("authForm").reset();
      $("authDialog").close();
      renderAuth();
      refreshActive();
    } catch (err) { $("authError").textContent = err.message; }
  });

  function renderAuth() {
    const a = $("authArea");
    a.innerHTML = "";
    if (me) {
      a.append(el("span", "who", "👤 " + me));
      if (myPlan) a.append(el("span", "chip planchip", myPlan.name));
      const out = el("button", "ghost", "Log out");
      out.onclick = async () => { await post("/api/logout"); me = null; myPlan = null; renderAuth(); refreshActive(); };
      a.append(out);
    } else {
      const li = el("button", "ghost", "Log in");
      li.onclick = () => openAuth(false);
      const rg = el("button", "ghost", "Register");
      rg.onclick = () => openAuth(true);
      a.append(li, rg);
    }
    $("uploadForm").hidden = !me;
    $("loginHint").hidden = !!me;
    if (me && myPlan) {
      const left = myPlan.maxUploads === null ? "unlimited uploads" : `${myPlan.uploadsUsed} of ${myPlan.maxUploads} uploads used`;
      $("upLimits").textContent = `Allowed: PDF, text, Word, PowerPoint, Excel, CSV, images · ${myPlan.name} plan: ${left}, up to ${myPlan.maxMB} MB per file`;
    }
  }

  async function loadMe() {
    try { const r = await api("/api/me"); me = r.user; myPlan = r.plan; } catch { me = null; myPlan = null; }
  }

  /* ---------- Plans (INR) ---------- */
  const rupees = (n) => "₹" + n.toLocaleString("en-IN");
  document.querySelectorAll("#intervalToggle button").forEach((b) => (b.onclick = () => {
    interval = b.dataset.interval;
    document.querySelectorAll("#intervalToggle button").forEach((x) => x.classList.toggle("on", x === b));
    renderPlans();
  }));

  async function loadPlans() {
    $("planMsg").textContent = "";
    try { planInfo = await api("/api/plans"); } catch (err) { $("planMsg").textContent = err.message; return; }
    await loadMe();
    renderAuth();
    renderPlans();
  }

  function renderPlans() {
    const box = $("planCards");
    box.innerHTML = "";
    if (!planInfo) return;
    Object.entries(planInfo.plans).forEach(([id, p]) => {
      const card = el("div", "card plan" + (myPlan && myPlan.id === id ? " current" : ""));
      card.append(el("h3", "", p.name));
      const price = el("div", "price");
      price.append(document.createTextNode(rupees(p.price[interval])));
      price.append(el("small", "", id === "free" ? " forever" : interval === "year" ? " / year" : " / month"));
      card.append(price);
      const ul = el("ul", "feat");
      p.features.forEach((f) => ul.append(el("li", "", "✓ " + f)));
      card.append(ul);
      if (myPlan && myPlan.id === id) {
        card.append(el("p", "empty", myPlan.expires ? "Current plan · renews/ends " + new Date(myPlan.expires).toLocaleDateString() : "Your current plan"));
      }
      if (id !== "free") {
        const label = myPlan && myPlan.id === id ? "Extend" : "Choose " + p.name;
        const btn = el("button", "", label + " · " + rupees(p.price[interval]));
        btn.onclick = () => buy(id, btn);
        card.append(btn);
      }
      box.append(card);
    });
    if (!planInfo.paymentsEnabled) $("planMsg").textContent = "Online payments are not switched on for this site yet.";
  }

  function loadScript(src) {
    return new Promise((ok, fail) => {
      if (window.Razorpay) return ok();
      const s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = () => fail(new Error("Could not load the payment window"));
      document.head.append(s);
    });
  }

  async function buy(plan, btn) {
    const msg = $("planMsg");
    msg.textContent = "";
    if (!me) { openAuth(false); return; }
    btn.disabled = true;
    try {
      const o = await post("/api/billing/order", { plan, interval });
      await loadScript("https://checkout.razorpay.com/v1/checkout.js");
      const rz = new window.Razorpay({
        key: o.keyId, amount: o.amount, currency: o.currency, order_id: o.orderId,
        name: "Research Notebook", description: o.plan + " plan (" + interval + "ly)",
        handler: async (resp) => {
          try {
            await post("/api/billing/verify", resp);
            await loadMe(); renderAuth(); renderPlans();
            msg.textContent = "";
            alert("Payment successful. Your plan is now active.");
          } catch (err) { msg.textContent = err.message; }
        },
        modal: { ondismiss: () => { btn.disabled = false; } },
      });
      rz.open();
    } catch (err) { msg.textContent = err.message; }
    btn.disabled = false;
  }

  function activeView() {
    const b = document.querySelector("#tabs button.active");
    return b ? b.dataset.view : "dashboard";
  }
  function refreshActive() {
    const v = activeView();
    if (v === "library") loadLibrary();
    if (v === "feed") loadFeed();
  }

  /* ---------- Upload card with comments ---------- */
  function renderUpload(u) {
    const card = el("article", "card upload");

    const head = el("div", "up-head");
    const titleBox = el("div");
    titleBox.append(el("strong", "up-title", u.title));
    const meta = el("div", "meta");
    meta.append(el("span", "chip", u.subject));
    const by = el("button", "link", "@" + u.owner);
    by.onclick = () => { userFilter = u.owner; showView("library"); };
    meta.append(by, el("span", "", ` · ${fmtDate(u.created)} · ${u.filename} (${fmtSize(u.size)})`));
    titleBox.append(meta);
    head.append(titleBox);

    const actions = el("div", "actions");
    const dl = el("a", "btn", "⬇ Download");
    dl.href = "/api/files/" + encodeURIComponent(u.id);
    actions.append(dl);
    if (u.mine) {
      const del = el("button", "danger", "Delete");
      del.onclick = async () => {
        if (!confirm("Delete this upload and all its comments?")) return;
        try { await api("/api/uploads/" + u.id, { method: "DELETE" }); refreshActive(); }
        catch (err) { alert(err.message); }
      };
      actions.append(del);
    } else if (me) {
      actions.append(subButton(u.owner, u.subscribed));
    }
    head.append(actions);
    card.append(head);

    if (u.description) card.append(el("p", "desc", u.description));

    // Comments / queries
    const toggle = el("button", "link", "");
    const label = () => `💬 Comments (${u.comments})` + (u.openQueries ? ` · ❓ ${u.openQueries} open ${u.openQueries === 1 ? "query" : "queries"}` : "");
    toggle.textContent = label();
    const thread = el("div", "thread");
    thread.hidden = true;
    toggle.onclick = () => {
      thread.hidden = !thread.hidden;
      if (!thread.hidden) loadThread(u, thread, () => { toggle.textContent = label(); });
    };
    card.append(toggle, thread);
    return card;
  }

  function subButton(name, subscribed) {
    const b = el("button", subscribed ? "on" : "", subscribed ? "✓ Subscribed" : "+ Subscribe");
    b.onclick = async () => {
      try {
        await api("/api/subscribe/" + name, { method: subscribed ? "DELETE" : "POST" });
        refreshActive();
      } catch (err) { alert(err.message); }
    };
    return b;
  }

  async function loadThread(u, box, onChange) {
    box.innerHTML = "";
    let data;
    try { data = await api(`/api/uploads/${u.id}/comments`); }
    catch (err) { box.append(el("p", "error", err.message)); return; }

    u.comments = data.comments.length;
    u.openQueries = data.comments.filter((c) => c.isQuery && !c.resolved).length;
    onChange();

    const list = el("div", "comments");
    if (!data.comments.length) list.append(el("p", "empty", "No comments yet."));
    data.comments.forEach((c) => {
      const row = el("div", "comment" + (c.isQuery ? " query" : "") + (c.resolved ? " resolved" : ""));
      const top = el("div", "c-top");
      top.append(el("strong", "", "@" + c.author), el("span", "empty", " · " + fmtDate(c.created)));
      if (c.isQuery) top.append(el("span", "chip " + (c.resolved ? "ok" : "warn"), c.resolved ? "✔ Answered" : "❓ Query"));
      row.append(top, el("div", "c-text", c.text));
      const acts = el("div", "c-actions");
      if (c.canResolve) {
        const r = el("button", "link", c.resolved ? "Reopen" : "Mark answered");
        r.onclick = async () => { await post(`/api/comments/${c.id}/resolve`); loadThread(u, box, onChange); };
        acts.append(r);
      }
      if (c.canDelete) {
        const d = el("button", "link", "Delete");
        d.onclick = async () => { await api("/api/comments/" + c.id, { method: "DELETE" }); loadThread(u, box, onChange); };
        acts.append(d);
      }
      row.append(acts);
      list.append(row);
    });
    box.append(list);

    if (!me) { box.append(el("p", "empty", "Log in to comment or ask a query.")); return; }
    const f = el("form", "comment-form");
    const ta = el("textarea");
    ta.placeholder = "Add a comment, or ask a question about this material…";
    ta.maxLength = 1000;
    ta.required = true;
    const lab = el("label", "check");
    const cb = el("input");
    cb.type = "checkbox";
    lab.append(cb, document.createTextNode(" This is a query (question)"));
    const send = el("button", "", "Post");
    send.type = "submit";
    const err = el("span", "error");
    f.append(ta, lab, send, err);
    f.onsubmit = async (e) => {
      e.preventDefault();
      try { await post(`/api/uploads/${u.id}/comments`, { text: ta.value, isQuery: cb.checked }); loadThread(u, box, onChange); }
      catch (x) { err.textContent = x.message; }
    };
    box.append(f);
  }

  /* ---------- Library view ---------- */
  async function loadLibrary() {
    const params = new URLSearchParams();
    if ($("search").value) params.set("q", $("search").value);
    if ($("subjectFilter").value) params.set("subject", $("subjectFilter").value);
    if (userFilter) params.set("user", userFilter);
    const box = $("libraryList");
    try {
      const data = await api("/api/uploads?" + params);
      // keep subject filter options in sync
      const cur = $("subjectFilter").value;
      const sel = $("subjectFilter");
      sel.innerHTML = "";
      sel.append(new Option("All subjects", ""));
      data.subjects.forEach((s) => sel.append(new Option(s, s)));
      sel.value = data.subjects.includes(cur) ? cur : "";

      box.innerHTML = "";
      if (!data.uploads.length) box.append(el("p", "empty", "No study material found."));
      data.uploads.forEach((u) => box.append(renderUpload(u)));
    } catch (err) { box.textContent = err.message; }
    renderBanner();
  }

  async function renderBanner() {
    const b = $("userBanner");
    if (!userFilter) { b.hidden = true; return; }
    b.hidden = false;
    b.innerHTML = "";
    try {
      const p = await api("/api/users/" + userFilter);
      b.append(el("strong", "", "@" + p.name), el("span", "", ` · ${p.uploads} uploads · ${p.subscribers} subscribers `));
      if (me && !p.isMe) b.append(subButton(p.name, p.subscribed));
    } catch (err) { b.textContent = err.message; }
    const clear = el("button", "link", "✕ Show everyone");
    clear.onclick = () => { userFilter = ""; loadLibrary(); };
    b.append(clear);
  }

  let timer;
  $("search").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(loadLibrary, 250); });
  $("subjectFilter").addEventListener("change", loadLibrary);

  $("uploadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = $("upFile").files[0];
    const msg = $("upMsg");
    msg.textContent = "";
    if (!file) return;
    const maxMB = myPlan ? myPlan.maxMB : 5;
    if (file.size > maxMB * 1024 * 1024) { msg.textContent = `Your plan allows files up to ${maxMB} MB. See Plans to upgrade.`; return; }
    try {
      await api("/api/uploads", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Filename": encodeURIComponent(file.name),
          "X-Title": encodeURIComponent($("upTitle").value),
          "X-Subject": encodeURIComponent($("upSubject").value),
          "X-Description": encodeURIComponent($("upDesc").value),
          "X-Confirm-Study": $("upConfirm").checked ? "yes" : "no",
        },
        body: file,
      });
      e.target.reset();
      await loadMe(); renderAuth();
      loadLibrary();
    } catch (err) { msg.textContent = err.message; }
  });

  /* ---------- Feed view ---------- */
  async function loadFeed() {
    const subs = $("subList"), feed = $("feedList");
    subs.innerHTML = ""; feed.innerHTML = "";
    if (!me) { feed.append(el("p", "empty", "Log in to subscribe to people and see their new uploads here.")); return; }
    try {
      const s = await api("/api/subscriptions");
      if (!s.subscriptions.length) subs.append(el("p", "empty", "You're not subscribed to anyone yet. Open the Library and click “+ Subscribe” on an uploader."));
      s.subscriptions.forEach((n) => {
        const c = el("span", "chip");
        const a = el("button", "link", "@" + n);
        a.onclick = () => { userFilter = n; showView("library"); };
        const x = el("button", "link", "✕");
        x.title = "Unsubscribe";
        x.onclick = async () => { await api("/api/subscribe/" + n, { method: "DELETE" }); loadFeed(); };
        c.append(a, x);
        subs.append(c);
      });
      const data = await api("/api/uploads?feed=1");
      if (s.subscriptions.length && !data.uploads.length) feed.append(el("p", "empty", "No uploads from your subscriptions yet."));
      data.uploads.forEach((u) => feed.append(renderUpload(u)));
    } catch (err) { feed.textContent = err.message; }
  }

  /* ---------- Init ---------- */
  (async () => {
    await loadMe();
    renderAuth();
    const v = location.hash.replace("#", "");
    if (["library", "feed", "plans"].includes(v)) showView(v);
  })();
})();
