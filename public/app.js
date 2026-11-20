const STATUSES = ["Planned", "Running", "Completed"];
const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  accent: "", // empty = use the theme's default professional blue
  theme: "light",
  columns: 2,
  title: "Dashboard",
  notes: "",
  widgets: [
    { id: "total", visible: true, wide: false },
    { id: "progress", visible: true, wide: false },
    { id: "status", visible: true, wide: false },
    { id: "recent", visible: true, wide: false },
    { id: "notes", visible: true, wide: true },
  ],
};

const WIDGET_NAMES = {
  total: "Total experiments",
  progress: "Completion progress",
  status: "By status",
  recent: "Recent experiments",
  notes: "Scratch notes",
};

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
const clone = (o) => JSON.parse(JSON.stringify(o));

let items = load("experiments", []);
let settings = Object.assign(clone(DEFAULTS), load("dashSettings", {}));
// make sure every known widget exists (in case of older saved settings)
DEFAULTS.widgets.forEach((w) => {
  if (!settings.widgets.some((x) => x.id === w.id)) settings.widgets.push(clone(w));
});

if (settings.accent === "#2f6fed") settings.accent = ""; // migrate old default colour
const saveItems = () => localStorage.setItem("experiments", JSON.stringify(items));
const saveSettings = () => localStorage.setItem("dashSettings", JSON.stringify(settings));

/* ---------- Widgets ---------- */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const count = (s) => items.filter((x) => x.status === s).length;

const RENDERERS = {
  total(box) {
    const big = el("div", "big", String(items.length));
    big.append(el("small", "", " experiments logged"));
    box.append(big);
  },
  progress(box) {
    const pct = items.length ? Math.round((count("Completed") / items.length) * 100) : 0;
    box.append(el("div", "big", pct + "%"));
    const bar = el("div", "progress");
    const fill = el("div");
    fill.style.width = pct + "%";
    bar.append(fill);
    box.append(bar);
  },
  status(box) {
    const max = Math.max(1, ...STATUSES.map(count));
    STATUSES.forEach((s) => {
      const row = el("div", "bar-row");
      const track = el("div", "track");
      const fill = el("div", "fill");
      fill.style.width = (count(s) / max) * 100 + "%";
      track.append(fill);
      row.append(el("span", "label", s), track, el("span", "count", String(count(s))));
      box.append(row);
    });
  },
  recent(box) {
    if (!items.length) return box.append(el("div", "empty", "Nothing yet — add an experiment below."));
    const ul = el("ul");
    items.slice(0, 5).forEach((it) => {
      const li = el("li", "mini");
      li.append(el("span", "", it.title), el("span", "empty", it.status));
      ul.append(li);
    });
    box.append(ul);
  },
  notes(box) {
    const ta = el("textarea", "notes");
    ta.placeholder = "Jot down ideas, reminders, observations…";
    ta.value = settings.notes;
    ta.addEventListener("input", () => { settings.notes = ta.value; saveSettings(); });
    box.append(ta);
  },
};

function renderDashboard() {
  const dash = $("dashboard");
  dash.innerHTML = "";
  settings.widgets.filter((w) => w.visible).forEach((w) => {
    const box = el("div", "widget" + (w.wide ? " wide" : ""));
    box.append(el("h3", "", WIDGET_NAMES[w.id]));
    RENDERERS[w.id](box);
    dash.append(box);
  });
  if (!dash.children.length) dash.append(el("p", "empty", "All widgets are hidden. Open Customize to turn some on."));
}

/* ---------- Appearance ---------- */
function applyAppearance() {
  const root = document.documentElement;
  if (settings.accent) root.style.setProperty("--accent", settings.accent);
  else root.style.removeProperty("--accent");
  root.style.setProperty("--cols", settings.columns);
  root.dataset.theme = settings.theme;
  $("dashHeading").textContent = settings.title || "Dashboard";
}

/* ---------- Customize panel ---------- */
function renderConfig() {
  const ul = $("widgetConfig");
  ul.innerHTML = "";
  settings.widgets.forEach((w, i) => {
    const li = el("li");
    const vis = el("button", w.visible ? "on" : "", w.visible ? "Shown" : "Hidden");
    vis.onclick = () => { w.visible = !w.visible; update(); };
    const wide = el("button", w.wide ? "on" : "", "Wide");
    wide.title = "Span the full width";
    wide.onclick = () => { w.wide = !w.wide; update(); };
    const up = el("button", "", "↑");
    up.disabled = i === 0;
    up.onclick = () => { swap(i, i - 1); };
    const down = el("button", "", "↓");
    down.disabled = i === settings.widgets.length - 1;
    down.onclick = () => { swap(i, i + 1); };
    li.append(el("span", "", WIDGET_NAMES[w.id]), vis, wide, up, down);
    ul.append(li);
  });
}

function swap(a, b) {
  const w = settings.widgets;
  [w[a], w[b]] = [w[b], w[a]];
  update();
}

function update() {
  saveSettings();
  applyAppearance();
  renderDashboard();
  renderConfig();
}

$("customizeBtn").onclick = () => { $("panel").hidden = !$("panel").hidden; };
$("closePanel").onclick = () => { $("panel").hidden = true; };

$("accent").oninput = (e) => { settings.accent = e.target.value; update(); };
$("theme").onchange = (e) => { settings.theme = e.target.value; update(); };
$("columns").onchange = (e) => { settings.columns = +e.target.value; update(); };
$("dashTitle").oninput = (e) => { settings.title = e.target.value; saveSettings(); applyAppearance(); };
$("resetBtn").onclick = () => {
  if (!confirm("Reset the dashboard layout and appearance?")) return;
  settings = clone(DEFAULTS);
  syncControls();
  update();
};

function syncControls() {
  $("accent").value = settings.accent || "#1f5fa8";
  $("theme").value = settings.theme;
  $("columns").value = String(settings.columns);
  $("dashTitle").value = settings.title;
}

/* ---------- Experiments list ---------- */
function renderList() {
  const list = $("list");
  list.innerHTML = "";
  items.forEach((item, i) => {
    const li = document.createElement("li");

    const info = el("div", "info");
    info.append(el("strong", "", item.title), el("div", "hyp", item.hypothesis || ""));

    const badge = el("span", "badge " + item.status, item.status);
    badge.title = "Click to change status";
    badge.onclick = () => {
      item.status = STATUSES[(STATUSES.indexOf(item.status) + 1) % STATUSES.length];
      refresh();
    };

    const del = el("button", "del", "✕");
    del.onclick = () => { items.splice(i, 1); refresh(); };

    li.append(info, badge, del);
    list.append(li);
  });
}

function refresh() {
  saveItems();
  renderList();
  renderDashboard();
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  items.unshift({
    title: $("title").value.trim(),
    hypothesis: $("hypothesis").value.trim(),
    status: $("status").value,
  });
  e.target.reset();
  refresh();
});

syncControls();
applyAppearance();
renderList();
renderDashboard();
renderConfig();

/* ---------- ☰ show/hide dashboard (hidden by default) ---------- */
(function () {
  const btn = $("dashToggle"), dash = $("dashboard");
  let hidden = true;
  try { hidden = localStorage.getItem("dashHidden") !== "0"; } catch {}
  function apply() {
    dash.hidden = hidden;
    btn.setAttribute("aria-expanded", String(!hidden));
    btn.classList.toggle("open", !hidden);
  }
  btn.onclick = () => {
    hidden = !hidden;
    try { localStorage.setItem("dashHidden", hidden ? "1" : "0"); } catch {}
    apply();
  };
  apply();
})();
