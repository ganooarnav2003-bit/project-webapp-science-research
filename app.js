const STATUSES = ["Planned", "Running", "Completed"];
let items = JSON.parse(localStorage.getItem("experiments") || "[]");

const $ = (id) => document.getElementById(id);
const save = () => localStorage.setItem("experiments", JSON.stringify(items));

function render() {
  const list = $("list");
  list.innerHTML = "";
  items.forEach((item, i) => {
    const li = document.createElement("li");

    const info = document.createElement("div");
    info.className = "info";
    const t = document.createElement("strong");
    t.textContent = item.title;
    const h = document.createElement("div");
    h.className = "hyp";
    h.textContent = item.hypothesis || "";
    info.append(t, h);

    const badge = document.createElement("span");
    badge.className = "badge " + item.status;
    badge.textContent = item.status;
    badge.title = "Click to change status";
    badge.onclick = () => {
      item.status = STATUSES[(STATUSES.indexOf(item.status) + 1) % STATUSES.length];
      save(); render();
    };

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "✕";
    del.onclick = () => { items.splice(i, 1); save(); render(); };

    li.append(info, badge, del);
    list.append(li);
  });

  const done = items.filter((x) => x.status === "Completed").length;
  $("stats").textContent = `${items.length} experiments · ${done} completed`;
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  items.unshift({
    title: $("title").value.trim(),
    hypothesis: $("hypothesis").value.trim(),
    status: $("status").value,
  });
  save();
  e.target.reset();
  render();
});

render();
