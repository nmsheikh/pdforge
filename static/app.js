// PDFKit front-end: pick a tool -> upload -> (options) -> process -> download.

const $ = (id) => document.getElementById(id);

const TOOLS = [
  {
    id: "unlock",
    title: "Unlock PDF",
    desc: "Remove the password from a PDF. Enter the password once, download an unlocked copy.",
    icon: "🔓",
    endpoint: "/api/unlock",
    inspect: true,
    ownPassword: true,
    options: (info) => info.encrypted
      ? `<div class="field">
           <label for="password">PDF password</label>
           <input type="password" id="password" name="password" autocomplete="off" required>
         </div>`
      : `<p class="note">This PDF isn't password-protected. You can still process it to get a clean copy.</p>`,
    button: "Unlock PDF",
    validate: (fd, info) => (info.encrypted && !fd.get("password") ? "Enter the PDF password." : null),
  },
  {
    id: "protect",
    title: "Protect / Change password",
    desc: "Add a password to a PDF, or replace the password of an already-protected PDF.",
    icon: "🔒",
    endpoint: "/api/protect",
    inspect: true,
    ownPassword: true,
    options: (info) => `
      ${info.encrypted ? `
        <div class="field">
          <label for="password">Current password</label>
          <input type="password" id="password" name="password" autocomplete="off">
          <p class="hint">This PDF is already protected. Enter its current password to change it.</p>
        </div>` : ""}
      <div class="field">
        <label for="new_password">New password</label>
        <input type="password" id="new_password" name="new_password" autocomplete="new-password">
      </div>
      <div class="field">
        <label for="confirm">Repeat new password</label>
        <input type="password" id="confirm" name="confirm" autocomplete="new-password">
        <p class="hint">Encrypted with AES-256.</p>
      </div>`,
    button: (info) => (info.encrypted ? "Change password" : "Protect PDF"),
    validate: (fd, info) => {
      if (info.encrypted && !fd.get("password")) return "Enter the current password.";
      if (!fd.get("new_password")) return "Enter a new password.";
      if (fd.get("new_password") !== fd.get("confirm")) return "The new passwords don't match.";
      return null;
    },
  },
  {
    id: "merge",
    title: "Merge PDF",
    desc: "Combine several PDFs into one, in the order you choose.",
    icon: "⧉",
    endpoint: "/api/merge",
    multiple: true,
    button: "Merge PDFs",
    validate: (_fd, _info, files) => (files.length < 2 ? "Add at least two PDFs to merge." : null),
  },
  {
    id: "split",
    title: "Split PDF",
    desc: "Split every page into its own PDF, or pull out specific page ranges.",
    icon: "✂",
    endpoint: "/api/split",
    inspect: true,
    options: (info) => `
      <div class="field">
        <div class="seg">
          <label><input type="radio" name="mode" value="all" checked><span>Every page</span></label>
          <label><input type="radio" name="mode" value="ranges"><span>Custom ranges</span></label>
        </div>
      </div>
      <div class="field" id="rangesField" hidden>
        <label for="ranges">Page ranges ${info.pages ? `<span class="muted">(1–${info.pages})</span>` : ""}</label>
        <input type="text" id="ranges" name="ranges" placeholder="e.g. 1-3, 5, 8-10">
        <p class="hint">Each range becomes a separate PDF. One range = one PDF, several = a ZIP.</p>
      </div>`,
    afterRender: () => {
      document.querySelectorAll('input[name="mode"]').forEach((r) =>
        r.addEventListener("change", () => { $("rangesField").hidden = r.value !== "ranges" || !r.checked; }));
    },
    button: "Split PDF",
    validate: (fd) => (fd.get("mode") === "ranges" && !fd.get("ranges").trim() ? "Enter page ranges." : null),
  },
  {
    id: "extract",
    title: "Select pages",
    desc: "Click the pages you want, such as 2, 4 and 7, and get a new PDF with only those pages.",
    icon: "☑",
    endpoint: "/api/extract",
    inspect: true,
    wide: true,
    options: () => `
      <div class="picker-bar">
        <input type="text" id="pageSpec" placeholder="Type pages, e.g. 2, 4, 7 or 1-3" aria-label="Pages to keep" autocomplete="off">
        <button type="button" class="ghost sm" id="selAll">Select all</button>
        <button type="button" class="ghost sm" id="selNone">Clear</button>
      </div>
      <p class="hint" id="selCount">Click pages to select them. Shift-click selects a range.</p>
      <input type="hidden" name="pages" id="pagesField">
      <div class="pages" id="pageGrid"></div>`,
    afterRender: () => initPicker(),
    button: "Create PDF",
    validate: (fd) => (!fd.get("pages") ? "Select at least one page." : null),
  },
  {
    id: "rotate",
    title: "Rotate PDF",
    desc: "Rotate all pages of a PDF.",
    icon: "↻",
    endpoint: "/api/rotate",
    inspect: true,
    options: () => `
      <div class="field">
        <div class="seg">
          <label><input type="radio" name="angle" value="90" checked><span>90° right</span></label>
          <label><input type="radio" name="angle" value="180"><span>180°</span></label>
          <label><input type="radio" name="angle" value="270"><span>90° left</span></label>
        </div>
      </div>`,
    button: "Rotate PDF",
  },
  {
    id: "compress",
    title: "Compress PDF",
    desc: "Shrink file size by recompressing and cleaning up the PDF structure.",
    icon: "⇲",
    endpoint: "/api/compress",
    auto: true,
  },
  {
    id: "images",
    title: "JPG to PDF",
    desc: "Turn JPG, PNG and other images into a single PDF.",
    icon: "🖼",
    endpoint: "/api/images-to-pdf",
    accept: "image/*",
    multiple: true,
    button: "Convert to PDF",
  },
];

// ---------- state ----------
let tool = null;
let files = [];
let info = {};
let downloadUrl = null;
let result = null; // { blob, name } of the last processed file

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);

function show(step) {
  for (const s of ["stepUpload", "stepOptions", "stepWorking", "stepDone"]) $(s).hidden = s !== step;
}

function showError(msg) {
  $("errorMsg").textContent = msg;
  $("errorMsg").hidden = !msg;
}

// ---------- navigation ----------
function renderHome() {
  $("toolGrid").innerHTML = TOOLS.map((t) => `
    <button class="tool" data-id="${t.id}">
      <div class="icon">${t.icon}</div>
      <h3>${esc(t.title)}</h3>
      <p>${esc(t.desc)}</p>
    </button>`).join("");
  $("toolGrid").querySelectorAll(".tool").forEach((el) =>
    el.addEventListener("click", () => { location.hash = el.dataset.id; }));
}

function route() {
  const t = TOOLS.find((x) => x.id === location.hash.slice(1));
  if (!t) {
    $("home").hidden = false;
    $("workspace").hidden = true;
    return;
  }
  tool = t;
  $("home").hidden = true;
  $("workspace").hidden = false;
  $("toolTitle").textContent = t.title;
  $("toolDesc").textContent = t.desc;
  $("fileInput").accept = t.accept || "application/pdf,.pdf";
  $("fileInput").multiple = !!t.multiple;
  $("dzMain").textContent = t.accept ? "Select images" : t.multiple ? "Select PDF files" : "Select PDF file";
  reset();
}

function reset() {
  files = [];
  info = {};
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
  $("fileInput").value = "";
  showError("");
  show("stepUpload");
}

// ---------- upload ----------
async function addFiles(list) {
  const incoming = Array.from(list);
  if (!incoming.length) return;
  files = tool.multiple ? files.concat(incoming) : [incoming[0]];

  // Tools with no options run straight away.
  if (tool.auto) return run();

  if (tool.inspect && !info.checked) {
    show("stepWorking");
    try {
      const fd = new FormData();
      fd.append("files", files[0]);
      const res = await fetch("/api/inspect", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't read that file.");
      info = { ...data, checked: true };
    } catch (e) {
      show("stepUpload");
      files = [];
      alert(e.message);
      return;
    }
  }
  renderOptions();
}

function renderOptions() {
  $("fileList").innerHTML = files.map((f, i) => `
    <li>
      <span class="fname" title="${esc(f.name)}">${esc(f.name)}</span>
      ${info.encrypted ? '<span class="badge">🔒 Protected</span>' : ""}
      ${info.pages ? `<span class="fsize">${info.pages} page${info.pages === 1 ? "" : "s"}</span>` : ""}
      <span class="fsize">${fmtSize(f.size)}</span>
      ${tool.multiple ? `
        <button class="mini" data-act="up" data-i="${i}" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="mini" data-act="down" data-i="${i}" title="Move down" ${i === files.length - 1 ? "disabled" : ""}>↓</button>
        <button class="mini" data-act="del" data-i="${i}" title="Remove">✕</button>` : ""}
    </li>`).join("");

  $("fileList").querySelectorAll(".mini").forEach((b) => b.addEventListener("click", () => {
    const i = +b.dataset.i;
    if (b.dataset.act === "del") files.splice(i, 1);
    else {
      const j = b.dataset.act === "up" ? i - 1 : i + 1;
      [files[i], files[j]] = [files[j], files[i]];
    }
    if (!files.length) return reset();
    renderOptions();
  }));

  $("addMoreBtn").hidden = !tool.multiple;
  // Only render option inputs once so typed values survive file-list edits.
  if (!$("options").dataset.tool || $("options").dataset.tool !== tool.id || $("stepOptions").hidden) {
    const pwField = info.encrypted && !tool.ownPassword ? `
      <div class="field">
        <label for="password">PDF password</label>
        <input type="password" id="password" name="password" autocomplete="off">
        <p class="hint">This PDF is protected. Enter its password to continue.</p>
      </div>` : "";
    $("options").innerHTML = pwField + (tool.options ? tool.options(info) : "");
    $("options").dataset.tool = tool.id;
    tool.afterRender && tool.afterRender();
  }
  $("stepOptions").classList.toggle("wide", !!tool.wide);
  $("runBtn").textContent = (typeof tool.button === "function" ? tool.button(info) : tool.button) || "Process";
  showError("");
  show("stepOptions");
  const firstInput = $("options").querySelector("input[type=password], input[type=text]");
  if (firstInput) firstInput.focus();
}

// ---------- process ----------
function collect() {
  const fd = new FormData();
  $("options").querySelectorAll("input").forEach((el) => {
    if (!el.name || ((el.type === "radio" || el.type === "checkbox") && !el.checked)) return;
    fd.append(el.name, el.value);
  });
  return fd;
}

async function run() {
  const fd = tool.auto ? new FormData() : collect();
  const err = (info.encrypted && !tool.ownPassword && !fd.get("password") && "Enter the PDF password.")
    || (tool.validate && tool.validate(fd, info, files));
  if (err) return showError(err);
  fd.delete("confirm");
  files.forEach((f) => fd.append("files", f));

  show("stepWorking");
  try {
    const res = await fetch(tool.endpoint, { method: "POST", body: fd });
    if (!res.ok) {
      let msg = "Something went wrong.";
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const name = filenameFrom(res) || "result.pdf";
    let extra = "";
    if (tool.id === "compress") {
      const inSize = files.reduce((s, f) => s + f.size, 0);
      const pct = Math.round((1 - blob.size / inSize) * 100);
      extra = pct > 0 ? ` · ${pct}% smaller` : " · already well optimized";
    }
    setResult(blob, name, extra);
    resetProtectBox();
    show("stepDone");
  } catch (e) {
    if (tool.auto) {
      show("stepUpload");
      files = [];
      alert(e.message);
    } else {
      show("stepOptions");
      showError(e.message);
    }
  }
}

function setResult(blob, name, extra = "") {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  result = { blob, name };
  downloadUrl = URL.createObjectURL(blob);
  $("downloadBtn").href = downloadUrl;
  $("downloadBtn").download = name;
  $("downloadBtn").textContent = name.endsWith(".zip") ? "Download ZIP" : "Download PDF";
  $("doneMeta").textContent = `${name} · ${fmtSize(blob.size)}${extra}`;
}

// ---------- optional password on the result ----------
function resetProtectBox() {
  // The Protect tool's output already has a password.
  $("protectBox").hidden = tool.id === "protect";
  $("protectToggle").checked = false;
  $("protectFields").hidden = true;
  $("protectDone").hidden = true;
  $("protectToggleRow").hidden = false;
  $("resultPw").value = "";
  $("resultPw2").value = "";
  $("protectError").hidden = true;
}

async function protectResult() {
  const pw = $("resultPw").value;
  const fail = (msg) => { $("protectError").textContent = msg; $("protectError").hidden = false; };
  if (!pw) return fail("Enter a password.");
  if (pw !== $("resultPw2").value) return fail("The passwords don't match.");

  const btn = $("protectApply");
  btn.disabled = true;
  btn.textContent = "Adding password…";
  try {
    const fd = new FormData();
    fd.append("files", result.blob, result.name);
    fd.append("new_password", pw);
    const res = await fetch("/api/protect", { method: "POST", body: fd });
    if (!res.ok) {
      let msg = "Couldn't add the password.";
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
    setResult(await res.blob(), filenameFrom(res) || result.name, " · 🔒 password protected");
    $("protectFields").hidden = true;
    $("protectToggleRow").hidden = true;
    $("protectDone").hidden = false;
  } catch (e) {
    fail(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Add password";
  }
}

// ---------- page picker (Select pages tool) ----------
const picker = { selected: new Set(), count: 0, last: null, loaded: false };

function initPicker() {
  Object.assign(picker, { selected: new Set(), count: 0, last: null, loaded: false });
  $("selAll").addEventListener("click", () => { for (let i = 1; i <= picker.count; i++) picker.selected.add(i); syncPicker(); });
  $("selNone").addEventListener("click", () => { picker.selected.clear(); syncPicker(); });
  $("pageSpec").addEventListener("input", () => {
    picker.selected = parsePageSpec($("pageSpec").value, picker.count);
    syncPicker(false);
  });

  if (info.encrypted) {
    $("pageGrid").innerHTML = `<div class="pages-msg">Enter the password above, then
      <button type="button" class="link inline" id="showPages">show pages</button>.</div>`;
    $("showPages").addEventListener("click", loadThumbs);
    $("password").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !picker.loaded) { e.preventDefault(); e.stopPropagation(); loadThumbs(); }
    });
  } else {
    loadThumbs();
  }
}

async function loadThumbs() {
  const pw = $("password") ? $("password").value : "";
  if (info.encrypted && !pw) return showError("Enter the PDF password.");
  showError("");
  $("pageGrid").innerHTML = `<div class="pages-msg"><div class="spinner"></div>Loading pages…</div>`;
  try {
    const fd = new FormData();
    fd.append("files", files[0]);
    fd.append("password", pw);
    const res = await fetch("/api/thumbnails", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't load the pages.");
    picker.count = data.pages.length;
    picker.loaded = true;
    $("pageGrid").innerHTML = data.pages.map((src, i) => `
      <button type="button" class="page" data-n="${i + 1}" aria-pressed="false">
        <img src="${src}" alt="Page ${i + 1}" loading="lazy">
        <span class="page-no">${i + 1}</span>
        <span class="page-check">✓</span>
      </button>`).join("");
    $("pageGrid").querySelectorAll(".page").forEach((el) => el.addEventListener("click", (e) => {
      const n = +el.dataset.n;
      if (e.shiftKey && picker.last) {
        const on = !picker.selected.has(n);
        const [a, b] = [Math.min(picker.last, n), Math.max(picker.last, n)];
        for (let i = a; i <= b; i++) on ? picker.selected.add(i) : picker.selected.delete(i);
      } else {
        picker.selected.has(n) ? picker.selected.delete(n) : picker.selected.add(n);
      }
      picker.last = n;
      syncPicker();
    }));
    picker.selected = parsePageSpec($("pageSpec").value, picker.count);
    syncPicker(false);
  } catch (e) {
    $("pageGrid").innerHTML = `<div class="pages-msg">${esc(e.message)}</div>`;
    if (info.encrypted) {
      $("pageGrid").insertAdjacentHTML("beforeend",
        `<button type="button" class="link" id="retryPages">Try again</button>`);
      $("retryPages").addEventListener("click", loadThumbs);
    }
  }
}

function syncPicker(updateText = true) {
  const list = [...picker.selected].sort((a, b) => a - b);
  $("pagesField").value = list.join(",");
  if (updateText) $("pageSpec").value = toPageSpec(list);
  $("pageGrid").querySelectorAll(".page").forEach((el) => {
    const on = picker.selected.has(+el.dataset.n);
    el.classList.toggle("on", on);
    el.setAttribute("aria-pressed", on);
  });
  $("selCount").textContent = list.length
    ? `${list.length} of ${picker.count} page${picker.count === 1 ? "" : "s"} selected. Your new PDF will contain page${list.length === 1 ? "" : "s"} ${toPageSpec(list)}.`
    : "Click pages to select them. Shift-click selects a range.";
  showError("");
}

// "2, 4, 6-8" -> Set{2,4,6,7,8} (ignores anything out of range or malformed)
function parsePageSpec(spec, max) {
  const out = new Set();
  for (const part of spec.split(",")) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let i = Math.max(1, Math.min(a, b)); i <= Math.min(max, Math.max(a, b)); i++) out.add(i);
  }
  return out;
}

// [1,2,3,5,7,8] -> "1-3, 5, 7-8"
function toPageSpec(list) {
  const parts = [];
  for (let i = 0; i < list.length; i++) {
    let j = i;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    parts.push(j > i ? `${list[i]}-${list[j]}` : `${list[i]}`);
    i = j;
  }
  return parts.join(", ");
}

function filenameFrom(res) {
  const cd = res.headers.get("Content-Disposition") || "";
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1]);
  const plain = cd.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : null;
}

// ---------- wiring ----------
$("fileInput").addEventListener("change", (e) => addFiles(e.target.files));
const dz = $("dropzone");
["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

$("addMoreBtn").addEventListener("click", () => {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.multiple = true;
  picker.accept = $("fileInput").accept;
  picker.addEventListener("change", () => addFiles(picker.files));
  picker.click();
});
$("runBtn").addEventListener("click", run);
$("protectToggle").addEventListener("change", (e) => {
  $("protectFields").hidden = !e.target.checked;
  if (e.target.checked) $("resultPw").focus();
});
$("protectApply").addEventListener("click", protectResult);
$("protectFields").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); protectResult(); } });
$("options").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); run(); } });
$("resetBtn").addEventListener("click", reset);
$("againBtn").addEventListener("click", reset);
$("backBtn").addEventListener("click", () => { location.hash = ""; });
$("homeLink").addEventListener("click", (e) => { e.preventDefault(); location.hash = ""; });
window.addEventListener("hashchange", route);

renderHome();
route();
