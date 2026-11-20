/* Flaskie: floating study assistant. Searches topics/uploads and answers questions.
   All text from the server is inserted with textContent (never innerHTML). */
(() => {
  if (document.getElementById("flaskie")) return;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  const root = el("div"); root.id = "flaskie";
  const fab = el("button", "fl-fab"); fab.setAttribute("aria-label", "Open study assistant"); fab.title = "Ask Flaskie";
  const icon = el("img"); icon.src = "/chatbot-icon.svg"; icon.alt = ""; icon.width = 34; icon.height = 34;
  fab.append(icon);

  const panel = el("section", "fl-panel"); panel.hidden = true; panel.setAttribute("aria-label", "Study assistant chat");
  const head = el("div", "fl-head");
  const hi = el("img"); hi.src = "/chatbot-icon.svg"; hi.alt = ""; hi.width = 30; hi.height = 30;
  const ht = el("div", "fl-title"); ht.append(el("strong", "", "Flaskie"), el("small", "", "Study helper · search & questions"));
  const close = el("button", "fl-close", "✕"); close.setAttribute("aria-label", "Close chat");
  head.append(hi, ht, close);
  const log = el("div", "fl-log"); log.setAttribute("aria-live", "polite");
  const chips = el("div", "fl-chips");
  const form = el("form", "fl-form");
  const input = el("input"); input.placeholder = "Ask a question or search notes…"; input.maxLength = 500; input.autocomplete = "off";
  const send = el("button", "", "Send"); send.type = "submit";
  form.append(input, send);
  panel.append(head, log, chips, form);
  root.append(panel, fab);
  document.body.append(root);

  const history = [];
  function bot(text, results) {
    const row = el("div", "fl-msg bot");
    row.append(el("div", "fl-text", text));
    (results || []).forEach((r) => {
      const a = el("a", "fl-result");
      a.href = r.url;
      a.append(el("strong", "", (r.type === "topic" ? "📘 " : "📄 ") + r.title), el("small", "", r.detail));
      row.append(a);
    });
    log.append(row); log.scrollTop = log.scrollHeight;
  }
  function me(text) { log.append(el("div", "fl-msg me", text)); log.scrollTop = log.scrollHeight; }

  async function ask(text) {
    chips.hidden = true;
    me(text);
    const typing = el("div", "fl-msg bot fl-typing", "Flaskie is thinking…");
    log.append(typing); log.scrollTop = log.scrollHeight;
    send.disabled = true;
    try {
      const res = await fetch("/api/chat", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: history.slice(-6) }),
      });
      const data = await res.json().catch(() => ({}));
      typing.remove();
      if (!res.ok) { bot(data.error || "Sorry, something went wrong."); }
      else {
        bot(data.reply, data.results);
        history.push({ role: "user", content: text }, { role: "assistant", content: data.reply });
      }
    } catch { typing.remove(); bot("I can't reach the server right now. Please try again."); }
    send.disabled = false; input.focus();
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t) return;
    input.value = "";
    ask(t);
  });
  ["What plans do you offer?", "Find photosynthesis notes", "How do I upload a file?"].forEach((q) => {
    const c = el("button", "fl-chip", q); c.type = "button"; c.onclick = () => ask(q); chips.append(c);
  });

  function toggle(open) {
    panel.hidden = !open;
    fab.classList.toggle("hide", open);
    if (open) {
      if (!log.children.length) bot("Hi! I'm Flaskie 🧪 Ask me about any study topic, search the shared notes, or ask about plans and uploads.");
      input.focus();
    }
  }
  fab.onclick = () => toggle(true);
  close.onclick = () => toggle(false);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) toggle(false); });
})();
