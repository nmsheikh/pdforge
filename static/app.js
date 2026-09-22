// pdforge front-end: pick a tool -> upload -> (options) -> process -> download.

const $ = (id) => document.getElementById(id);
const MM = 72 / 25.4; // points per millimetre
// Desktop app (or the website with ?local=1): process PDFs on this device, no server.
const DESKTOP = document.body.dataset.desktop === "1";
const LOCAL = DESKTOP || new URLSearchParams(location.search).has("local");
const MAX_UPLOAD_BYTES = LOCAL || !+document.body.dataset.maxUploadMb
  ? Infinity : +document.body.dataset.maxUploadMb * 1024 * 1024;

// Icon paths adapted from Lucide (ISC licence).
const ICONS = {
  merge: '<path d="m8 6 4-4 4 4"/><path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22"/><path d="m20 22-5-5"/>',
  split: '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>',
  extract: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>',
  organize: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  compress: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>',
  repair: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  images: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  pdf2img: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><circle cx="10" cy="13" r="2"/><path d="m20 17-1.1-1.1a2 2 0 0 0-2.8 0L10 22"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  watermark: '<path d="M5 22h14"/><path d="M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77Z"/><path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-3-3c-1.66 0-3 1-3 3s1 2 1 3.5V13"/>',
  pagenumbers: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  metadata: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1"/>',
  unlock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  protect: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};
const icon = (name, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const CATEGORIES = [
  { id: "organize", label: "Organize PDF" },
  { id: "optimize", label: "Optimize PDF" },
  { id: "convert", label: "Convert PDF" },
  { id: "edit", label: "Edit PDF" },
  { id: "security", label: "PDF Security" },
];
const QUICK_NAV = ["merge", "split", "compress", "organize"];

// ---------- small HTML helpers for tool options ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);

function seg(name, choices, value, cls = "") {
  return `<div class="seg ${cls}" role="radiogroup">${choices.map(([v, label, sub]) => `
    <label><input type="radio" name="${name}" value="${v}" ${v === value ? "checked" : ""}>
      <span>${label}${sub ? `<small>${sub}</small>` : ""}</span></label>`).join("")}</div>`;
}
function field(label, inner, hint = "", id = "") {
  return `<div class="field"${id ? ` id="${id}"` : ""}><label>${label}</label>${inner}${hint ? `<p class="hint">${hint}</p>` : ""}</div>`;
}
function range(name, min, max, value, unit) {
  return `<div class="range"><input type="range" name="${name}" min="${min}" max="${max}" value="${value}">
    <output>${value}${unit}</output></div>`;
}
function check(name, label, checked = false) {
  return `<label class="check-row"><input type="checkbox" name="${name}" value="1" ${checked ? "checked" : ""}> <span>${label}</span></label>`;
}

// ---------- tools ----------
const TOOLS = [
  // Organize
  {
    id: "merge", category: "organize", title: "Merge PDF",
    desc: "Combine several PDFs into one, in the order you choose.",
    endpoint: "/api/merge", multiple: true, ordered: true, button: "Merge PDFs",
    validate: () => (files.length < 2 ? "Add at least two PDFs to merge." : null),
  },
  {
    id: "split", category: "organize", title: "Split PDF",
    desc: "Split every page into its own PDF, or pull out specific page ranges.",
    endpoint: "/api/split", button: "Split PDF",
    options: (info) => `
      <div class="field">${seg("mode", [["all", "Every page"], ["ranges", "Custom ranges"]], "all")}</div>
      <div class="field" id="rangesField" hidden>
        <label for="ranges">Page ranges ${info.pages ? `<span class="muted">(1–${info.pages})</span>` : ""}</label>
        <input type="text" id="ranges" name="ranges" placeholder="e.g. 1-3, 5, 8-10">
        <p class="hint">Each range becomes a separate PDF. One range gives one PDF, several give a ZIP.</p>
      </div>`,
    afterRender: () => document.querySelectorAll('input[name="mode"]').forEach((r) =>
      r.addEventListener("change", () => { $("rangesField").hidden = !(r.value === "ranges" && r.checked); })),
    validate: (fd) => (fd.get("mode") === "ranges" && !fd.get("ranges").trim() ? "Enter page ranges." : null),
  },
  {
    id: "extract", category: "organize", title: "Select pages",
    desc: "Click the pages you want, such as 2, 4 and 7, and get a new PDF with only those pages.",
    endpoint: "/api/extract", wide: true, button: "Create PDF",
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
    validate: (fd) => (!fd.get("pages") ? "Select at least one page." : null),
  },
  {
    id: "organize", category: "organize", title: "Organize PDF", isNew: true,
    desc: "Reorder pages by dragging, rotate or delete single pages, and insert blank pages.",
    endpoint: "/api/organize", wide: true, button: "Save changes",
    options: () => `
      <div class="picker-bar">
        <button type="button" class="ghost sm" id="orgBlank">+ Add blank page</button>
        <button type="button" class="ghost sm" id="orgReset">Reset</button>
        <span class="hint grow" id="orgCount"></span>
      </div>
      <p class="hint">Drag pages to reorder them. Hover a page (or tap it on a phone) for rotate, move and delete buttons.</p>
      <input type="hidden" name="plan" id="planField">
      <div class="pages org" id="pageGrid"></div>`,
    afterRender: () => initOrganizer(),
    validate: (fd) => (JSON.parse(fd.get("plan") || "[]").length ? null : "The document needs at least one page."),
  },

  // Optimize
  {
    id: "compress", category: "optimize", title: "Compress PDF",
    desc: "Make PDFs smaller by shrinking images and tidying the file structure.",
    endpoint: "/api/compress", multiple: true, button: "Compress PDF",
    options: () => field("Compression level", seg("level", [
      ["extreme", "Extreme", "Smallest file, lower image quality"],
      ["recommended", "Recommended", "Good quality, good compression"],
      ["low", "Low", "Best quality, less compression"],
    ], "recommended", "tall")),
  },
  {
    id: "repair", category: "optimize", title: "Repair PDF", isNew: true,
    desc: "Fix damaged or broken PDFs by rebuilding their internal structure.",
    endpoint: "/api/repair", multiple: true, button: "Repair PDF",
  },

  // Convert
  {
    id: "images", category: "convert", title: "JPG to PDF",
    desc: "Turn JPG, PNG and other images into a single PDF.",
    endpoint: "/api/images-to-pdf", accept: "image/*", multiple: true, ordered: true, button: "Convert to PDF",
  },
  {
    id: "pdf2img", category: "convert", title: "PDF to JPG", isNew: true, result: "images",
    desc: "Turn every page of a PDF into a JPG or PNG image.",
    endpoint: "/api/pdf-to-image", button: "Convert to images",
    options: () => `
      ${field("Image format", seg("format", [["jpg", "JPG"], ["png", "PNG"]], "jpg"))}
      ${field("Quality", seg("dpi", [["72", "Screen", "72 DPI"], ["150", "Standard", "150 DPI"], ["300", "High", "300 DPI"]], "150", "tall"))}`,
  },

  // Edit
  {
    id: "rotate", category: "edit", title: "Rotate PDF",
    desc: "Rotate all pages of one or more PDFs.",
    endpoint: "/api/rotate", multiple: true, button: "Rotate PDF",
    options: () => field("Rotation", seg("angle", [["90", "90° right"], ["180", "180°"], ["270", "90° left"]], "90")),
  },
  {
    id: "watermark", category: "edit", title: "Watermark", isNew: true,
    desc: "Stamp text such as CONFIDENTIAL or DRAFT over your pages.",
    endpoint: "/api/watermark", multiple: true, preview: true, button: "Add watermark",
    options: () => `
      ${field("Text", `<input type="text" name="text" value="CONFIDENTIAL" maxlength="80">`)}
      ${field("Position", seg("position", [["diagonal", "Diagonal"], ["center", "Center"], ["tiled", "Tiled"], ["top", "Top"], ["bottom", "Bottom"]], "diagonal", "wrap"))}
      <div class="two">
        ${field("Size", range("size", 12, 150, 60, "pt"))}
        ${field("Opacity", range("opacity", 5, 100, 30, "%"))}
      </div>
      ${field("Colour", `<input type="color" name="color" value="#e0443a">`)}`,
    validate: (fd) => (!fd.get("text").trim() ? "Enter the watermark text." : null),
    drawPreview: (layer, fd, k, [w, h]) => {
      const text = fd.get("text") || "";
      const size = +fd.get("size");
      const pos = fd.get("position");
      const unit = textWidth(text, "bold") || 1;
      const style = `color:${fd.get("color")};opacity:${fd.get("opacity") / 100};font-weight:700`;
      if (pos === "tiled") {
        const stepX = unit * size + size * 2, stepY = size * 4;
        const reach = Math.hypot(w, h) / 2 + stepX;
        let spans = "", row = 0;
        for (let y = -reach; y <= reach; y += stepY, row++) {
          for (let x = -reach + (row % 2) * stepX / 2; x <= reach; x += stepX) {
            spans += `<span class="pv-text mid" style="left:${x * k}px;top:${-y * k}px;font-size:${size * k}px">${esc(text)}</span>`;
          }
        }
        layer.innerHTML = `<div class="pv-rot" style="${style};transform:rotate(-35deg)">${spans}</div>`;
        return;
      }
      const s = pos === "diagonal" ? Math.min(size, Math.hypot(w, h) * 0.8 / unit) : Math.min(size, w * 0.9 / unit);
      const place = {
        diagonal: `left:50%;top:50%;transform:translate(-50%,-50%) rotate(${-Math.atan2(h, w) * 180 / Math.PI}deg)`,
        center: "left:50%;top:50%;transform:translate(-50%,-50%)",
        top: `left:50%;top:${15 * MM * k}px;transform:translateX(-50%)`,
        bottom: `left:50%;bottom:${15 * MM * k}px;transform:translateX(-50%)`,
      }[pos];
      layer.innerHTML = `<span class="pv-text" style="${style};${place};font-size:${s * k}px">${esc(text)}</span>`;
    },
  },
  {
    id: "pagenumbers", category: "edit", title: "Page numbers", isNew: true,
    desc: "Add page numbers to your PDF, in the position and style you want.",
    endpoint: "/api/page-numbers", multiple: true, preview: true, button: "Add page numbers",
    options: () => `
      ${field("Position", seg("position", [
        ["top-left", "↖"], ["top-center", "↑"], ["top-right", "↗"],
        ["bottom-left", "↙"], ["bottom-center", "↓"], ["bottom-right", "↘"],
      ], "bottom-center", "grid3"))}
      ${field("Format", `<select name="format">
        <option value="n">1</option><option value="page_n">Page 1</option>
        <option value="page_n_of">Page 1 of N</option><option value="n_slash">1 / N</option></select>`)}
      <div class="two">
        ${field("Start at", `<input type="number" name="start" value="1" min="0">`)}
        ${field("Text size", range("size", 6, 36, 11, "pt"))}
      </div>
      ${check("skip_first", "Don't number the first page (cover)")}`,
    drawPreview: (layer, fd, k) => {
      const [v, hpos] = fd.get("position").split("-");
      const start = +fd.get("start") || 0;
      const skip = fd.get("skip_first") === "1";
      const total = (info.pages || 1) - (skip ? 1 : 0) + start - 1;
      const label = { n: "{n}", page_n: "Page {n}", page_n_of: "Page {n} of {total}", n_slash: "{n} / {total}" }[fd.get("format")]
        .replace("{n}", start).replace("{total}", total);
      const m = 12 * MM * k;
      const style = [`font-size:${fd.get("size") * k}px`, v === "top" ? `top:${m}px` : `bottom:${m}px`,
        hpos === "left" ? `left:${m}px` : hpos === "right" ? `right:${m}px` : "left:50%;transform:translateX(-50%)"].join(";");
      layer.innerHTML = skip
        ? `<span class="pv-note">Page 1 isn't numbered. Numbering starts on page 2.</span>`
        : `<span class="pv-text dark" style="${style}">${esc(label)}</span>`;
    },
  },
  {
    id: "crop", category: "edit", title: "Crop PDF", isNew: true,
    desc: "Trim the margins of every page.",
    endpoint: "/api/crop", preview: true, button: "Crop PDF",
    options: () => `
      <p class="hint">How much to trim from each side, in millimetres.</p>
      <div class="two">
        ${field("Top", `<input type="number" name="top" value="10" min="0" step="1">`)}
        ${field("Bottom", `<input type="number" name="bottom" value="10" min="0" step="1">`)}
        ${field("Left", `<input type="number" name="left" value="10" min="0" step="1">`)}
        ${field("Right", `<input type="number" name="right" value="10" min="0" step="1">`)}
      </div>`,
    validate: (fd) => (["top", "right", "bottom", "left"].some((s) => +fd.get(s) > 0) ? null : "Set at least one margin to crop."),
    drawPreview: (layer, fd, k) => {
      const px = (s) => Math.max(0, +fd.get(s) || 0) * MM * k;
      const [t, r, b, l] = ["top", "right", "bottom", "left"].map(px);
      layer.innerHTML = `
        <div class="pv-shade" style="left:0;right:0;top:0;height:${t}px"></div>
        <div class="pv-shade" style="left:0;right:0;bottom:0;height:${b}px"></div>
        <div class="pv-shade" style="left:0;top:${t}px;bottom:${b}px;width:${l}px"></div>
        <div class="pv-shade" style="right:0;top:${t}px;bottom:${b}px;width:${r}px"></div>
        <div class="pv-cropbox" style="top:${t}px;right:${r}px;bottom:${b}px;left:${l}px"></div>`;
    },
  },
  {
    id: "metadata", category: "edit", title: "Edit metadata", isNew: true,
    desc: "Change a PDF's title, author and keywords, or remove all hidden metadata.",
    endpoint: "/api/metadata", button: "Save metadata",
    options: (info) => {
      const m = info.metadata || {};
      const producedBy = [m.creator, m.producer].filter(Boolean).join(" · ");
      return `
        ${check("remove_all", "Remove all metadata (title, author, software used, dates…)")}
        <div id="metaFields">
          ${field("Title", `<input type="text" name="title" value="${esc(m.title)}">`)}
          ${field("Author", `<input type="text" name="author" value="${esc(m.author)}">`)}
          ${field("Subject", `<input type="text" name="subject" value="${esc(m.subject)}">`)}
          ${field("Keywords", `<input type="text" name="keywords" value="${esc(m.keywords)}">`,
            producedBy ? `Created with: ${esc(producedBy)}` : "")}
        </div>`;
    },
    afterRender: () => {
      const box = document.querySelector('input[name="remove_all"]');
      box.addEventListener("change", () => {
        $("metaFields").classList.toggle("disabled", box.checked);
        $("metaFields").querySelectorAll("input").forEach((i) => { i.disabled = box.checked; });
      });
    },
  },

  // Security
  {
    id: "unlock", category: "security", title: "Unlock PDF",
    desc: "Remove the password from PDFs. Enter the password once and download unlocked copies.",
    endpoint: "/api/unlock", multiple: true, ownPassword: true, button: "Unlock PDF",
    options: (info) => info.encrypted
      ? field("PDF password", `<input type="password" name="password" autocomplete="off">`,
        files.length > 1 ? "Used for every protected file you uploaded." : "")
      : `<p class="note">${files.length > 1 ? "None of these PDFs is" : "This PDF isn't"} password-protected. You can still process ${files.length > 1 ? "them" : "it"} to get a clean copy.</p>`,
    validate: (fd, info) => (info.encrypted && !fd.get("password") ? "Enter the PDF password." : null),
  },
  {
    id: "protect", category: "security", title: "Protect PDF",
    desc: "Add or change a password, and optionally block printing, copying or editing.",
    endpoint: "/api/protect", multiple: true, ownPassword: true,
    button: (info) => (info.encrypted ? "Change password" : "Protect PDF"),
    options: (info) => `
      ${info.encrypted ? field("Current password", `<input type="password" name="password" autocomplete="off">`,
        "Already protected. Enter the current password to change it.") : ""}
      <div class="two">
        ${field("New password", `<input type="password" name="new_password" autocomplete="new-password">`)}
        ${field("Repeat new password", `<input type="password" name="confirm" autocomplete="new-password">`)}
      </div>
      <p class="hint">Encrypted with AES-256.</p>
      <div class="field"><label>Restrictions <span class="muted">(optional)</span></label>
        ${check("block_print", "Block printing")}
        ${check("block_copy", "Block copying text and images")}
        ${check("block_edit", "Block editing, comments and form filling")}
        <p class="hint">With restrictions and no password, anyone can open the file but can't do what you blocked.</p>
      </div>`,
    validate: (fd, info) => {
      const restricted = ["block_print", "block_copy", "block_edit"].some((k) => fd.get(k));
      if (info.encrypted && !fd.get("password")) return "Enter the current password.";
      if (!fd.get("new_password") && !restricted) return "Enter a new password, or choose something to restrict.";
      if (fd.get("new_password") !== fd.get("confirm")) return "The new passwords don't match.";
      return null;
    },
  },
];
const toolById = (id) => TOOLS.find((t) => t.id === id);

// ---------- state ----------
let tool = null;
let files = [];
let fileInfo = []; // per file, from /api/inspect
let info = {};     // summary of fileInfo used by option renderers
let result = null; // { blob, name } of the last processed file
let downloadUrl = null;
let pendingFiles = null; // files carried over by "Continue with…"
let activeCategory = "all";

function show(step) {
  for (const s of ["stepUpload", "stepOptions", "stepWorking", "stepDone"]) $(s).hidden = s !== step;
}
function showError(msg) {
  $("errorMsg").textContent = msg || "";
  $("errorMsg").hidden = !msg;
}
let engine = null;
async function postForm(url, fd) {
  if (LOCAL) engine ||= await import("./engine/engine.mjs");
  const res = LOCAL ? await engine.handle(url, fd) : await fetch(url, { method: "POST", body: fd });
  if (!res.ok) {
    let msg = "Something went wrong.";
    try {
      msg = (await res.json()).error || msg;
    } catch (_) {
      // Not our JSON: the hosting platform rejected the request itself.
      if (res.status === 413) msg = `That's too large for the online version (limit ${MAX_UPLOAD_BYTES / 1048576} MB).`;
    }
    throw new Error(msg);
  }
  return res;
}

// ---------- home, navigation, menu ----------
function toolCard(t) {
  return `<a class="tool cat-${t.category}" href="#${t.id}" data-cat="${t.category}">
    <div class="icon">${icon(t.id)}</div>
    ${t.isNew ? '<span class="new">New</span>' : ""}
    <h3>${esc(t.title)}</h3>
    <p>${esc(t.desc)}</p>
  </a>`;
}

function renderHome() {
  $("chips").innerHTML = [{ id: "all", label: "All" }, ...CATEGORIES].map((c) =>
    `<button class="chip ${c.id === activeCategory ? "active" : ""}" role="tab" aria-selected="${c.id === activeCategory}" data-cat="${c.id}">${c.label}</button>`).join("");
  $("chips").querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    activeCategory = b.dataset.cat;
    renderHome();
  }));
  $("toolGrid").innerHTML = TOOLS.filter((t) => activeCategory === "all" || t.category === activeCategory).map(toolCard).join("");
}

function renderNav() {
  $("quickNav").innerHTML = QUICK_NAV.map((id) => `<a href="#${id}">${esc(toolById(id).title)}</a>`).join("");
  $("megaMenu").innerHTML = CATEGORIES.map((c) => `
    <div class="mega-col">
      <p class="mega-title">${c.label}</p>
      ${TOOLS.filter((t) => t.category === c.id).map((t) =>
        `<a href="#${t.id}" class="mega-link cat-${t.category}">${icon(t.id, "mi")}<span>${esc(t.title)}</span></a>`).join("")}
    </div>`).join("");
}

function toggleMenu(open) {
  const isOpen = open ?? $("megaMenu").hidden;
  $("megaMenu").hidden = !isOpen;
  $("menuBtn").setAttribute("aria-expanded", isOpen);
}

function route() {
  toggleMenu(false);
  const t = toolById(location.hash.slice(1));
  if (!t) {
    tool = null;
    $("home").hidden = false;
    $("workspace").hidden = true;
    document.title = "pdforge";
    return;
  }
  tool = t;
  document.title = `${t.title} · pdforge`;
  $("home").hidden = true;
  $("workspace").hidden = false;
  $("workspace").className = `cat-${t.category}`;
  $("toolTitle").textContent = t.title;
  $("toolDesc").textContent = t.desc;
  $("fileInput").accept = t.accept || "application/pdf,.pdf";
  $("fileInput").multiple = !!t.multiple;
  $("dzMain").textContent = t.accept ? "Select images" : t.multiple ? "Select PDF files" : "Select PDF file";
  $("dzSub").textContent = t.multiple ? "or drop them here. You can add several at once." : "or drop it here";
  window.scrollTo(0, 0);
  reset();
  if (pendingFiles) {
    const carry = pendingFiles;
    pendingFiles = null;
    addFiles(carry);
  }
}

function reset() {
  files = [];
  fileInfo = [];
  info = {};
  result = null;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
  $("fileInput").value = "";
  $("options").innerHTML = "";
  showError("");
  show("stepUpload");
}

// ---------- upload & inspect ----------
const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

async function addFiles(list) {
  let incoming = Array.from(list);
  if (!incoming.length) return;
  const wantPdf = !tool.accept;
  const rejected = incoming.filter((f) => (wantPdf ? !isPdf(f) : !f.type.startsWith("image/")));
  incoming = incoming.filter((f) => !rejected.includes(f));
  if (rejected.length) alert(`Skipped ${rejected.map((f) => f.name).join(", ")}: not ${wantPdf ? "a PDF" : "an image"}.`);
  if (!incoming.length) return;

  const next = tool.multiple ? files.concat(incoming) : [incoming[0]];
  const total = next.reduce((s, f) => s + f.size, 0);
  if (total > MAX_UPLOAD_BYTES) {
    openDownload(`${next.length > 1 ? "These files are" : "This file is"} ${fmtSize(total)}. The online version handles up to ${MAX_UPLOAD_BYTES / 1048576} MB per upload. ${IS_PHONE ? "On a computer, the free desktop app has no limit." : "The desktop app has no limit."}`);
    return;
  }

  const firstRender = $("stepOptions").hidden;
  const wasEncrypted = !!info.encrypted;
  files = next;

  if (wantPdf) {
    if (firstRender) { $("workingMsg").textContent = "Reading your file…"; show("stepWorking"); }
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      const data = await (await postForm("/api/inspect", fd)).json();
      fileInfo = data.files;
    } catch (e) {
      files = files.slice(0, files.length - incoming.length);
      if (firstRender) show("stepUpload");
      alert(e.message);
      return;
    }
  }
  summarize();
  renderFileList();
  // Re-render the options only when needed, so typed values survive "Add more".
  if (firstRender || wasEncrypted !== !!info.encrypted) renderOptions();
  show("stepOptions");
}

function summarize() {
  const first = fileInfo[0] || {};
  info = {
    encrypted: fileInfo.some((f) => f.encrypted),
    pages: first.pages, size: first.size, metadata: first.metadata,
  };
}

function renderFileList() {
  $("fileList").innerHTML = files.map((f, i) => {
    const fi = fileInfo[i] || {};
    return `<li>
      <span class="fname" title="${esc(f.name)}">${esc(f.name)}</span>
      ${fi.encrypted ? '<span class="badge">🔒 Protected</span>' : ""}
      ${fi.pages ? `<span class="fsize">${fi.pages} page${fi.pages === 1 ? "" : "s"}</span>` : ""}
      <span class="fsize">${fmtSize(f.size)}</span>
      ${tool.multiple ? `
        ${tool.ordered ? `
          <button class="mini" data-act="up" data-i="${i}" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="mini" data-act="down" data-i="${i}" title="Move down" ${i === files.length - 1 ? "disabled" : ""}>↓</button>` : ""}
        <button class="mini" data-act="del" data-i="${i}" title="Remove">✕</button>` : ""}
    </li>`;
  }).join("");
  $("fileList").querySelectorAll(".mini").forEach((b) => b.addEventListener("click", () => {
    const i = +b.dataset.i;
    const wasEncrypted = info.encrypted;
    const move = (arr, j) => { [arr[i], arr[j]] = [arr[j], arr[i]]; };
    if (b.dataset.act === "del") { files.splice(i, 1); fileInfo.splice(i, 1); }
    else { const j = b.dataset.act === "up" ? i - 1 : i + 1; move(files, j); if (fileInfo.length) move(fileInfo, j); }
    if (!files.length) return reset();
    summarize();
    renderFileList();
    if (wasEncrypted !== info.encrypted) renderOptions();
  }));
  $("addMoreBtn").hidden = !tool.multiple;
}

function renderOptions() {
  const pwField = info.encrypted && !tool.ownPassword
    ? field(files.length > 1 ? "Password for the protected files" : "PDF password",
      `<input type="password" id="password" name="password" autocomplete="off">`,
      "This PDF is protected. Enter its password to continue.")
    : "";
  const controls = pwField + (tool.options ? tool.options(info) : "");
  $("options").innerHTML = tool.preview
    ? `<div class="opt-grid"><div class="preview" id="preview">
         <div class="pv-page" id="pvPage"><img id="pvImg" alt="Preview of page 1"><div class="pv-layer" id="pvLayer"></div></div>
         <p class="hint center" id="pvNote">Loading preview…</p></div>
       <div class="controls">${controls}</div></div>`
    : controls;
  $("stepOptions").classList.toggle("wide", !!(tool.wide || tool.preview));
  $("runBtn").textContent = (typeof tool.button === "function" ? tool.button(info) : tool.button) || "Process";
  showError("");

  // Live values next to sliders.
  $("options").querySelectorAll(".range input").forEach((r) => r.addEventListener("input", () => {
    const out = r.nextElementSibling;
    out.textContent = r.value + out.textContent.replace(/^[\d.]+/, "");
  }));
  tool.afterRender && tool.afterRender();
  if (tool.preview) initPreview();

  const first = $("options").querySelector("input[type=password], input[type=text]");
  if (first && !tool.preview) first.focus();
}

// ---------- live preview (watermark, page numbers, crop) ----------
const preview = { size: null };

function textWidth(text, weight = "") {
  const ctx = (textWidth.ctx ||= document.createElement("canvas").getContext("2d"));
  ctx.font = `${weight} 100px Helvetica, Arial, sans-serif`;
  return ctx.measureText(text).width / 100;
}

async function initPreview() {
  preview.size = null;
  const pw = $("password");
  if (info.encrypted && !(pw && pw.value)) {
    $("pvNote").textContent = "Enter the password to see a preview.";
    $("pvPage").hidden = true;
    if (pw) pw.addEventListener("change", initPreview, { once: true });
    return;
  }
  try {
    const fd = new FormData();
    fd.append("files", files[0]);
    fd.append("limit", "1");
    fd.append("width", "520");
    if (pw) fd.append("password", pw.value);
    const data = await (await postForm("/api/thumbnails", fd)).json();
    preview.size = data.sizes[0];
    $("pvImg").onload = () => { $("pvPage").hidden = false; updatePreview(); };
    $("pvImg").src = data.pages[0];
    $("pvNote").textContent = files.length > 1 ? "Preview of the first page of the first file." : "Preview of page 1.";
  } catch (e) {
    $("pvNote").textContent = e.message;
    if (pw) pw.addEventListener("change", initPreview, { once: true });
  }
}

function updatePreview() {
  if (!tool || !tool.drawPreview || !preview.size || !$("pvImg")) return;
  const k = $("pvImg").clientWidth / preview.size[0]; // CSS px per PDF point
  tool.drawPreview($("pvLayer"), collect(), k, preview.size);
}

// ---------- page thumbnails (Select pages, Organize) ----------
function withPages(onLoaded) {
  const pw = $("password");
  const grid = $("pageGrid");
  const load = async () => {
    if (info.encrypted && !pw.value) return showError("Enter the PDF password.");
    showError("");
    grid.innerHTML = `<div class="pages-msg"><div class="spinner"></div>Loading pages…</div>`;
    try {
      const fd = new FormData();
      fd.append("files", files[0]);
      if (pw) fd.append("password", pw.value);
      const data = await (await postForm("/api/thumbnails", fd)).json();
      onLoaded(data.pages);
    } catch (e) {
      grid.innerHTML = `<div class="pages-msg">${esc(e.message)}
        ${info.encrypted ? '<button type="button" class="link inline" id="showPages">Try again</button>' : ""}</div>`;
    }
  };
  if (info.encrypted) {
    grid.innerHTML = `<div class="pages-msg">Enter the password above, then
      <button type="button" class="link inline" id="showPages">show pages</button>.</div>`;
    grid.addEventListener("click", (e) => { if (e.target.id === "showPages") load(); });
    pw.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !grid.querySelector(".page")) { e.preventDefault(); e.stopPropagation(); load(); }
    });
  } else {
    load();
  }
}

// Select pages
const picker = { selected: new Set(), count: 0, last: null };

function initPicker() {
  Object.assign(picker, { selected: new Set(), count: 0, last: null });
  $("selAll").addEventListener("click", () => { for (let i = 1; i <= picker.count; i++) picker.selected.add(i); syncPicker(); });
  $("selNone").addEventListener("click", () => { picker.selected.clear(); syncPicker(); });
  $("pageSpec").addEventListener("input", () => {
    picker.selected = parsePageSpec($("pageSpec").value, picker.count);
    syncPicker(false);
  });
  withPages((pages) => {
    picker.count = pages.length;
    $("pageGrid").innerHTML = pages.map((src, i) => `
      <button type="button" class="page" data-n="${i + 1}" aria-pressed="false">
        <img src="${src}" alt="Page ${i + 1}" loading="lazy">
        <span class="page-no">${i + 1}</span>
        <span class="page-check">✓</span>
      </button>`).join("");
    $("pageGrid").querySelectorAll(".page").forEach((el) => el.addEventListener("click", (e) => {
      const n = +el.dataset.n;
      if (e.shiftKey && picker.last) {
        const on = !picker.selected.has(n);
        for (let i = Math.min(picker.last, n); i <= Math.max(picker.last, n); i++) on ? picker.selected.add(i) : picker.selected.delete(i);
      } else {
        picker.selected.has(n) ? picker.selected.delete(n) : picker.selected.add(n);
      }
      picker.last = n;
      syncPicker();
    }));
    picker.selected = parsePageSpec($("pageSpec").value, picker.count);
    syncPicker(false);
  });
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

// Organize
const org = { items: [], thumbs: [], drag: null };

function initOrganizer() {
  org.items = [];
  org.thumbs = [];
  $("orgBlank").addEventListener("click", () => { org.items.push({ blank: true, rotate: 0 }); renderOrganizer(); });
  $("orgReset").addEventListener("click", () => {
    org.items = org.thumbs.map((_, i) => ({ page: i + 1, rotate: 0 }));
    renderOrganizer();
  });
  withPages((pages) => {
    org.thumbs = pages;
    org.items = pages.map((_, i) => ({ page: i + 1, rotate: 0 }));
    renderOrganizer();
  });
}

function renderOrganizer() {
  const grid = $("pageGrid");
  grid.innerHTML = org.items.map((it, i) => `
    <div class="page org-page" draggable="true" data-i="${i}">
      <div class="org-thumb">
        ${it.blank ? '<div class="blank-page"></div>' : `<img src="${org.thumbs[it.page - 1]}" alt="Page ${it.page}" draggable="false">`}
      </div>
      <span class="page-no">${it.blank ? "Blank" : it.page}</span>
      <div class="org-tools">
        <button type="button" data-act="left" title="Move left" ${i === 0 ? "disabled" : ""}>←</button>
        <button type="button" data-act="ccw" title="Rotate left">↺</button>
        <button type="button" data-act="cw" title="Rotate right">↻</button>
        <button type="button" data-act="del" title="Delete page">✕</button>
        <button type="button" data-act="right" title="Move right" ${i === org.items.length - 1 ? "disabled" : ""}>→</button>
      </div>
    </div>`).join("") || `<div class="pages-msg">No pages left. Click Reset to start over.</div>`;

  grid.querySelectorAll(".org-page").forEach((card) => {
    const i = +card.dataset.i;
    const rot = org.items[i].rotate;
    card.querySelector(".org-thumb > *").style.transform = `rotate(${rot}deg)${rot % 180 ? " scale(0.77)" : ""}`;
    card.querySelectorAll("button").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const it = org.items[i];
      const act = b.dataset.act;
      if (act === "cw") it.rotate = (it.rotate + 90) % 360;
      if (act === "ccw") it.rotate = (it.rotate + 270) % 360;
      if (act === "del") org.items.splice(i, 1);
      if (act === "left" || act === "right") {
        const j = act === "left" ? i - 1 : i + 1;
        [org.items[i], org.items[j]] = [org.items[j], org.items[i]];
      }
      renderOrganizer();
    }));
    card.addEventListener("click", () => {
      grid.querySelectorAll(".org-page.show-tools").forEach((c) => c !== card && c.classList.remove("show-tools"));
      card.classList.toggle("show-tools");
    });
    card.addEventListener("dragstart", (e) => {
      org.drag = i;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(i));
    });
    card.addEventListener("dragend", () => { org.drag = null; card.classList.remove("dragging"); });
    card.addEventListener("dragover", (e) => {
      if (org.drag === null) return;
      e.preventDefault();
      const r = card.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      card.classList.toggle("drop-after", after);
      card.classList.toggle("drop-before", !after);
    });
    card.addEventListener("dragleave", () => card.classList.remove("drop-before", "drop-after"));
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      if (org.drag === null) return;
      const after = card.classList.contains("drop-after");
      const [moved] = org.items.splice(org.drag, 1);
      let target = i + (after ? 1 : 0);
      if (org.drag < target) target--;
      org.items.splice(target, 0, moved);
      org.drag = null;
      renderOrganizer();
    });
  });

  $("planField").value = JSON.stringify(org.items.map((it) =>
    it.blank ? { blank: true, rotate: it.rotate } : { page: it.page, rotate: it.rotate }));
  const blanks = org.items.filter((it) => it.blank).length;
  $("orgCount").textContent = `${org.items.length} page${org.items.length === 1 ? "" : "s"}${blanks ? `, including ${blanks} blank` : ""}`;
}

// ---------- process ----------
function collect() {
  const fd = new FormData();
  $("options").querySelectorAll("input, select").forEach((el) => {
    if (!el.name || el.disabled || ((el.type === "radio" || el.type === "checkbox") && !el.checked)) return;
    fd.append(el.name, el.value);
  });
  return fd;
}

async function run() {
  const fd = collect();
  const err = (info.encrypted && !tool.ownPassword && !fd.get("password") && "Enter the PDF password.")
    || (tool.validate && tool.validate(fd, info));
  if (err) return showError(err);
  fd.delete("confirm");
  files.forEach((f) => fd.append("files", f));

  $("workingMsg").textContent = files.length > 1 ? `Processing ${files.length} files…` : "Processing your file…";
  show("stepWorking");
  try {
    const res = await postForm(tool.endpoint, fd);
    const blob = await res.blob();
    const name = filenameFrom(res) || "result.pdf";
    let extra = "";
    if (tool.id === "compress") {
      const inSize = files.reduce((s, f) => s + f.size, 0);
      const pct = Math.round((1 - blob.size / inSize) * 100);
      extra = pct > 0 ? ` · ${pct}% smaller` : " · already as small as it gets";
    }
    if (!LOCAL && MAX_UPLOAD_BYTES !== Infinity && blob.size > MAX_UPLOAD_BYTES) {
      // Too big to send back to the server for "Continue with…" or adding a password.
      extra += " · open it in the desktop app to keep editing";
    }
    setResult(blob, name, extra);
    resetProtectBox();
    renderContinue();
    show("stepDone");
  } catch (e) {
    show("stepOptions");
    showError(e.message);
  }
}

function setResult(blob, name, extra = "") {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  result = { blob, name };
  $("savedNote").hidden = true;
  downloadUrl = URL.createObjectURL(blob);
  $("downloadBtn").href = downloadUrl;
  $("downloadBtn").download = name;
  const ext = name.split(".").pop().toUpperCase();
  $("downloadBtn").textContent = `Download ${ext === "JPG" || ext === "PNG" ? "image" : ext}`;
  $("doneMeta").textContent = `${name} · ${fmtSize(blob.size)}${extra}`;
}

function filenameFrom(res) {
  const cd = res.headers.get("Content-Disposition") || "";
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1]);
  const plain = cd.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : null;
}

// "Continue with…": hand the result straight to another tool.
function renderContinue() {
  const isPdfResult = /\.pdf$/i.test(result.name);
  $("continueBox").hidden = !isPdfResult;
  if (!isPdfResult) return;
  $("continueList").innerHTML = TOOLS.filter((t) => !t.accept && t.id !== tool.id).map((t) =>
    `<button class="continue-chip cat-${t.category}" data-id="${t.id}">${icon(t.id, "mi")}<span>${esc(t.title)}</span></button>`).join("");
  $("continueList").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    pendingFiles = [new File([result.blob], result.name, { type: "application/pdf" })];
    location.hash = b.dataset.id;
  }));
}

// ---------- optional password on the result ----------
function resetProtectBox() {
  // Hidden for Protect (already has one) and for image results.
  $("protectBox").hidden = tool.id === "protect" || tool.result === "images";
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
    const res = await postForm("/api/protect", fd);
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

// ---------- desktop app: download panel (website) and saving files (app) ----------
function detectOs() {
  const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent).toLowerCase();
  return p.includes("mac") ? "mac" : p.includes("win") ? "windows" : p.includes("linux") ? "linux" : "";
}

// Phones and tablets can't run the desktop app.
const IS_PHONE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform)); // iPadOS reports "Mac"
document.body.classList.toggle("phone", IS_PHONE);

function openDownload(reason = "") {
  $("dlTitle").textContent = IS_PHONE ? "Use pdforge on a computer" : "Get pdforge for your computer";
  $("dlPhone").hidden = !IS_PHONE;
  $("dlDesktop").hidden = IS_PHONE;
  $("shareNote").hidden = true;
  $("dlReason").textContent = reason;
  $("dlReason").hidden = !reason;
  const os = detectOs();
  document.querySelectorAll(".dl-btn").forEach((a, i, all) => {
    // Can't tell Apple Silicon from Intel in the browser; suggest Apple Silicon (most current Macs).
    const first = [...all].find((b) => b.dataset.os === os);
    a.classList.toggle("suggested", a === first);
  });
  $("downloadModal").hidden = false;
  $("dlClose").focus();
}
const closeDownload = () => { $("downloadModal").hidden = true; };

// In the desktop app, "Download" opens a native Save dialog (Tauri command in src-tauri).
async function saveInApp(e) {
  if (!DESKTOP || !result) return;
  e.preventDefault();
  try {
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const path = await window.__TAURI__.core.invoke("save_file", bytes, {
      headers: { "x-filename": encodeURIComponent(result.name) },
    });
    if (path) {
      $("savedNote").textContent = `Saved to ${path}`;
      $("savedNote").hidden = false;
    }
  } catch (err) {
    alert(`Couldn't save the file: ${err}`);
  }
}

// ---------- wiring ----------
$("downloadBtn").addEventListener("click", saveInApp);
$("getAppBtn").addEventListener("click", () => openDownload());
$("nudgeBtn").addEventListener("click", () => openDownload());
$("shareLink").addEventListener("click", async () => {
  const url = location.origin + "/";
  try {
    if (navigator.share) {
      await navigator.share({ title: "pdforge", text: "Open this on your computer to get the pdforge app", url });
      return;
    }
    await navigator.clipboard.writeText(url);
    $("shareNote").textContent = "Link copied. Paste it into a message or email to yourself.";
  } catch (_) {
    $("shareNote").textContent = `Open ${url} on your computer.`;
  }
  $("shareNote").hidden = false;
});
document.querySelectorAll("[data-open-download]").forEach((b) => b.addEventListener("click", () => openDownload()));
$("dlClose").addEventListener("click", closeDownload);
$("downloadModal").addEventListener("click", (e) => { if (e.target === $("downloadModal")) closeDownload(); });
$("fileInput").addEventListener("change", (e) => addFiles(e.target.files));
const dz = $("dropzone");
["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

$("addMoreBtn").addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = $("fileInput").accept;
  input.addEventListener("change", () => addFiles(input.files));
  input.click();
});
$("runBtn").addEventListener("click", run);
$("options").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("input:not([type=checkbox]):not([type=radio])")) { e.preventDefault(); run(); }
});
$("options").addEventListener("input", updatePreview);
$("options").addEventListener("change", updatePreview);
window.addEventListener("resize", updatePreview);
$("resetBtn").addEventListener("click", reset);
$("againBtn").addEventListener("click", reset);
$("backBtn").addEventListener("click", () => { location.hash = ""; });
$("homeLink").addEventListener("click", (e) => { e.preventDefault(); location.hash = ""; });

$("protectToggle").addEventListener("change", (e) => {
  $("protectFields").hidden = !e.target.checked;
  if (e.target.checked) $("resultPw").focus();
});
$("protectApply").addEventListener("click", protectResult);
$("protectFields").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); protectResult(); } });

$("menuBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(); });
document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) toggleMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { toggleMenu(false); closeDownload(); } });
window.addEventListener("hashchange", route);

renderNav();
renderHome();
route();
