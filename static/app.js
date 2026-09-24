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
  "arrange-by-date": '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  "medical-bills": '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h6"/><path d="M9 8h1"/>',
  claude: '<path d="M12 2v20"/><path d="M4.5 6.5l15 11"/><path d="M19.5 6.5l-15 11"/>',
  openai: '<circle cx="12" cy="6.5" r="2.5"/><circle cx="6.5" cy="16" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/><path d="M12 9v3.5M6.5 13.5 12 12.5M17.5 13.5 12 12.5"/>',
  protect: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  // interface controls
  arrowUp: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  arrowUpLeft: '<path d="M7 17V7h10"/><path d="M17 17 7 7"/>',
  arrowUpRight: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  arrowDownLeft: '<path d="M17 7 7 17"/><path d="M17 17H7V7"/>',
  arrowDownRight: '<path d="m7 7 10 10"/><path d="M17 7v10H7"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  expand: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  rotateCcw: '<path d="M3 12a9 9 0 1 0 9-9c-2.52 0-4.93 1-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  listView: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  gridView: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="m2 2 20 20"/>',
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
// Password box with a show/hide (eye) button.
function passwordInput(name, { id = "", autocomplete = "off", ui = false } = {}) {
  return `<div class="pw-wrap">
    <input type="password" name="${name}"${id ? ` id="${id}"` : ""} autocomplete="${autocomplete}"${ui ? ' data-ui="1"' : ""}>
    <button type="button" class="eye" aria-label="Show password" title="Show password">${icon("eye", "eye-icon")}</button>
  </div>`;
}

function check(name, label, checked = false) {
  return `<label class="check-row"><input type="checkbox" name="${name}" value="1" ${checked ? "checked" : ""}> <span>${label}</span></label>`;
}

// ---------- tools ----------
const TOOLS = [
  // Organize
  {
    id: "merge", category: "organize", title: "Merge PDF",
    guard: (_info, files) => (files.length < 2 ? "Merging needs at least two PDFs. Add one more file below." : null),
    desc: "Combine several PDFs into one, in the order you choose.",
    endpoint: "/api/merge", multiple: true, ordered: true, button: "Merge PDFs",
    validate: () => (files.length < 2 ? "Add at least two PDFs to merge." : null),
  },
  {
    id: "split", category: "organize", title: "Split PDF",
    guard: (info) => (info.pages === 1
      ? "This PDF has only one page, so there is nothing to split. Merge it with another PDF first, or use Select pages on a longer file."
      : null),
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
    guard: (info) => (info.pages === 1 ? "This PDF has only one page, so there is nothing to select. Merge it with another PDF first, or use Rotate or Crop on a single page." : null),
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
    guard: (info) => (info.pages === 1 ? "This PDF has only one page, so there is nothing to reorder. You can still rotate it with Rotate PDF." : null),
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
  {
    id: "arrange-by-date", category: "organize", title: "Arrange by date", isNew: true, localOnly: true,
    guard: () => (!LOCAL ? "This tool reads the date on each page by running OCR on your device, so it only works in the desktop app." : null),
    desc: "Drop in PDFs and photos with a date on each page, and get one PDF with everything in date order, upright.",
    endpoint: "/api/arrange-by-date", accept: "application/pdf,image/*", multiple: true, button: "Arrange by date",
  },
  {
    id: "medical-bills", category: "organize", title: "Arrange medical bills", isNew: true, localOnly: true,
    guard: () => (!LOCAL ? "This tool reads each page with OCR on your device, so it only works in the desktop app." : null),
    desc: "Sort doctor bills, prescriptions and medicine bills into one PDF: by date, then doctor bill, prescription, medicine bill.",
    endpoint: "/api/finalize-medical-bills", accept: "application/pdf,image/*", multiple: true, wide: true, button: "Build PDF",
    options: () => `
      <details class="ai-settings" id="aiSettings">
        <summary>Use AI for better extraction (optional)</summary>
        <p class="hint">Off by default. When set, each document's <em>text</em> (not the image) is sent to the provider below using your own key, to fill in the claim details more accurately than pattern-matching alone can. Everything else in pdforge stays on your device.</p>
        <div class="ai-settings-row">
          <div class="ai-provider" id="aiProviderWrap">
            <button type="button" class="ai-provider-btn" id="aiProviderBtn" aria-haspopup="listbox" aria-expanded="false">
              <span id="aiProviderBtnIcon"></span><span id="aiProviderBtnLabel">Off</span>${icon("chevronRight", "ui ai-provider-caret")}
            </button>
            <div class="ai-provider-menu" id="aiProviderMenu" role="listbox" hidden>
              <button type="button" class="ai-provider-opt" data-value="" role="option">Off</button>
              <button type="button" class="ai-provider-opt" data-value="claude" role="option">${icon("claude", "ui")} Claude</button>
              <button type="button" class="ai-provider-opt" data-value="openai" role="option">${icon("openai", "ui")} OpenAI</button>
            </div>
          </div>
          ${passwordInput("aiApiKey", { id: "aiApiKey", autocomplete: "off", ui: true })}
        </div>
      </details>
      <div class="picker-bar">
        <span class="hint grow" id="medCount"></span>
      </div>
      <p class="hint">Check the date and document type pdforge found for each page, and fix anything flagged for review.</p>
      <input type="hidden" name="plan" id="planField">
      <div class="pages med-grid" id="pageGrid"></div>
      <div class="claims-wrap">
        <div class="picker-bar">
          <span class="hint grow">Extracted claim data</span>
          <button type="button" class="ghost sm" id="claimAddLine">${icon("plus", "ui")} Add Line</button>
          <button type="button" class="ghost sm" id="claimDelLine">${icon("trash", "ui")} Delete Line</button>
          <button type="button" class="ghost sm" id="claimCalc">Calculate</button>
        </div>
        <div class="claims-scroll"><table class="claims-grid" id="claimsGrid"></table></div>
        <p class="hint" id="claimTotal"></p>
      </div>`,
    afterRender: () => initMedicalReview(),
    validate: (fd) => {
      let plan;
      try { plan = JSON.parse(fd.get("plan") || "[]"); } catch (_) { return "Something went wrong reading the pages."; }
      if (!plan.length) return "No pages to arrange.";
      if (plan.some((p) => !p.date)) return "Set the date for every page flagged for review.";
      if (plan.some((p) => p.type === "other")) return "Set the document type for every page flagged for review.";
      return null;
    },
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
        ["top-left", icon("arrowUpLeft", "ui")], ["top-center", icon("arrowUp", "ui")], ["top-right", icon("arrowUpRight", "ui")],
        ["bottom-left", icon("arrowDownLeft", "ui")], ["bottom-center", icon("arrowDown", "ui")], ["bottom-right", icon("arrowDownRight", "ui")],
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
    guard: (info, files) => (info.encrypted ? null
      : `${files.length > 1 ? "None of these PDFs is" : "This PDF isn't"} password-protected, so there is nothing to unlock.`),
    desc: "Remove the password from PDFs. Enter the password once and download unlocked copies.",
    endpoint: "/api/unlock", multiple: true, ownPassword: true, button: "Unlock PDF",
    options: (info) => (info.encrypted
      ? field("PDF password", passwordInput("password"),
        files.length > 1 ? "Used for every protected file you uploaded." : "")
      : ""),
    validate: (fd, info) => (info.encrypted && !fd.get("password") ? "Enter the PDF password." : null),
  },
  {
    id: "protect", category: "security", title: "Protect PDF",
    desc: "Add or change a password, and optionally block printing, copying or editing.",
    endpoint: "/api/protect", multiple: true, ownPassword: true,
    button: (info) => (info.encrypted ? "Change password" : "Protect PDF"),
    options: (info) => `
      ${info.encrypted ? field("Current password", passwordInput("password"),
        "Already protected. Enter the current password to change it.") : ""}
      <div class="two">
        ${field("New password", passwordInput("new_password", { autocomplete: "new-password" }))}
        ${field("Repeat new password", passwordInput("confirm", { autocomplete: "new-password" }))}
      </div>
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

// The password for protected uploads (Unlock/Protect name it, other tools get a generated field).
const pwValue = () => $("options").querySelector('input[name="password"]')?.value || "";

function show(step) {
  for (const s of ["stepUpload", "stepOptions", "stepWorking", "stepDone"]) $(s).hidden = s !== step;
}
function showError(msg) {
  $("errorMsg").textContent = msg || "";
  $("errorMsg").hidden = !msg;
}
let engine = null;
// Slow tools (e.g. OCR) report progress this way; postForm() otherwise awaits in one shot.
window.addEventListener("pdforge:progress", (e) => {
  if (!$("stepWorking").hidden) $("workingMsg").textContent = e.detail.message;
  const inline = document.getElementById("progressMsg"); // in-grid loading spinners (e.g. medical bill review)
  if (inline) inline.textContent = e.detail.message;
});
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
  // Desktop-only tools (OCR) can't do anything on the hosted site - nudge toward the
  // app right away instead of opening a tool screen where every upload dead-ends.
  if (t.localOnly && !LOCAL) {
    location.hash = "";
    openDownload(t.guard());
    return;
  }
  tool = t;
  document.title = `${t.title} · pdforge`;
  $("home").hidden = true;
  $("workspace").hidden = false;
  $("workspace").className = `cat-${t.category}`;
  $("toolTitle").textContent = t.title;
  $("toolDesc").textContent = t.desc;
  const mixed = t.accept === "application/pdf,image/*";
  $("fileInput").accept = t.accept || "application/pdf,.pdf";
  $("fileInput").multiple = !!t.multiple;
  $("dzMain").textContent = mixed ? "Select PDFs and images" : t.accept ? "Select images" : t.multiple ? "Select PDF files" : "Select PDF file";
  $("dzSub").textContent = t.multiple
    ? `or drop them here. You can add several at once.`
    : `or drop it here. ${t.title} works on one ${t.accept ? "image" : "PDF"} at a time.`;
  $("dzWarn").hidden = true;
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
const isImageFile = (f) => f.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(f.name);

async function addFiles(list) {
  let incoming = Array.from(list);
  if (!incoming.length) return;
  const mixed = tool.accept === "application/pdf,image/*";
  const wantPdf = !tool.accept;
  const rejected = incoming.filter((f) => (mixed ? !isPdf(f) && !isImageFile(f) : wantPdf ? !isPdf(f) : !f.type.startsWith("image/")));
  incoming = incoming.filter((f) => !rejected.includes(f));
  if (rejected.length) warnOnDropzone(`Skipped ${rejected.map((f) => f.name).join(", ")}: not ${mixed ? "a PDF or image" : wantPdf ? "a PDF" : "an image"}.`);
  if (!incoming.length) return;

  if (!tool.multiple && incoming.length > 1) {
    warnOnDropzone(`${tool.title} works on one ${wantPdf ? "PDF" : "image"} at a time. Drop a single file, or use a tool that takes several.`);
    return;
  }

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
  // Re-render the options when the file set changes in a way the options depend on.
  if (firstRender || wasEncrypted !== !!info.encrypted || guardMessage() || $("runBtn").hidden) renderOptions();
  show("stepOptions");
}

let warnTimer;
function warnOnDropzone(message) {
  const el = $("dzWarn");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(warnTimer);
  warnTimer = setTimeout(() => { el.hidden = true; }, 8000);
  if (!$("stepUpload").hidden) return;
  showError(message); // already past the upload screen
}

function summarize() {
  const first = fileInfo[0] || {};
  info = {
    encrypted: fileInfo.some((f) => f.encrypted),
    pages: first.pages, size: first.size, metadata: first.metadata,
  };
}

let fileView = localStorage.getItem("pdforge.fileView") === "grid" ? "grid" : "list";
const thumbCache = new Map(); // File -> page 1 data URL

function fileActions(i) {
  if (!tool.multiple) return "";
  const grid = fileView === "grid";
  return `${tool.ordered ? `
      <button class="mini" data-act="up" data-i="${i}" title="Move ${grid ? "left" : "up"}" aria-label="Move ${grid ? "left" : "up"}" ${i === 0 ? "disabled" : ""}>${icon(grid ? "arrowLeft" : "arrowUp", "ui")}</button>
      <button class="mini" data-act="down" data-i="${i}" title="Move ${grid ? "right" : "down"}" aria-label="Move ${grid ? "right" : "down"}" ${i === files.length - 1 ? "disabled" : ""}>${icon(grid ? "arrowRight" : "arrowDown", "ui")}</button>` : ""}
    <button class="mini" data-act="del" data-i="${i}" title="Remove" aria-label="Remove">${icon("close", "ui")}</button>`;
}

function renderFileList() {
  const list = $("fileList");
  list.className = `filelist ${fileView}`;
  const pdfs = !tool.accept;
  const mixed = tool.accept === "application/pdf,image/*";
  const showThumbs = pdfs || mixed; // pure image-only tools thumbnail via the browser directly, below
  list.innerHTML = files.map((f, i) => {
    const fi = fileInfo[i] || {};
    const pages = fi.pages ? `${fi.pages} page${fi.pages === 1 ? "" : "s"}` : "";
    const lock = fi.encrypted ? `<span class="badge">${icon("protect", "badge-icon")} Protected</span>` : "";
    const expand = showThumbs ? `<button class="expand" data-expand="${i}" title="Open a bigger preview" aria-label="Open a bigger preview of ${esc(f.name)}">${icon("expand", "ui")}</button>` : "";
    if (fileView === "grid") {
      return `<div class="file-card">
        ${expand}
        <div class="file-thumb" data-thumb="${i}">${fi.encrypted ? '<span class="thumb-lock">🔒</span>' : '<span class="thumb-wait"></span>'}</div>
        <div class="file-body">
          <span class="fname" title="${esc(f.name)}">${esc(f.name)}</span>
          <span class="fsize">${[pages, fmtSize(f.size)].filter(Boolean).join(" · ")}</span>
          ${lock}
        </div>
        <div class="file-actions">${fileActions(i)}</div>
      </div>`;
    }
    return `<div class="file-row">
      ${expand}
      <span class="fname" title="${esc(f.name)}">${esc(f.name)}</span>
      ${lock}
      ${pages ? `<span class="fsize">${pages}</span>` : ""}
      <span class="fsize">${fmtSize(f.size)}</span>
      ${fileActions(i)}
    </div>`;
  }).join("") + (tool.multiple ? `
    <button type="button" class="add-tile" id="addTile">
      <span class="add-plus">${icon("plus", "ui")}</span>
      <span>Add more ${tool.accept ? "images" : "PDFs"}</span>
    </button>` : "");

  $("addTile")?.addEventListener("click", pickMoreFiles);
  list.querySelectorAll(".mini").forEach((b) => b.addEventListener("click", () => {
    const i = +b.dataset.i;
    const wasEncrypted = info.encrypted;
    const move = (arr, j) => { [arr[i], arr[j]] = [arr[j], arr[i]]; };
    if (b.dataset.act === "del") { files.splice(i, 1); fileInfo.splice(i, 1); }
    else { const j = b.dataset.act === "up" ? i - 1 : i + 1; move(files, j); if (fileInfo.length) move(fileInfo, j); }
    if (!files.length) return reset();
    summarize();
    renderFileList();
    renderOptions();
  }));
  list.querySelectorAll("[data-expand]").forEach((b) =>
    b.addEventListener("click", () => openPreview(+b.dataset.expand)));

  $("filesCount").textContent = files.length === 1
    ? esc(files[0].name)
    : `${files.length} files`;
  $("filesHead").hidden = !pdfs && files.length < 2;
  $("viewSwitch").hidden = files.length < 2;
  $("viewSwitch").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.view === fileView));
  if (fileView === "grid" && showThumbs) loadFileThumbs();
}

// Page-1 thumbnails for the grid view, loaded one file at a time.
async function loadFileThumbs() {
  for (const el of [...$("fileList").querySelectorAll("[data-thumb]")]) {
    const i = +el.dataset.thumb;
    const f = files[i];
    if (!f) continue;
    if (isImageFile(f) && !isPdf(f)) {
      // Images are already images: thumbnail them directly, no engine round-trip.
      if (thumbCache.get(f) === undefined) thumbCache.set(f, { key: `${f.name}|${f.size}`, src: URL.createObjectURL(f) });
      if (files[i] === f && el.isConnected) el.innerHTML = `<img src="${thumbCache.get(f).src}" alt="">`;
      continue;
    }
    if ((fileInfo[i] || {}).encrypted && !pwValue()) continue; // locked and no password yet
    try {
      const key = `${f.name}|${f.size}|${pwValue()}`;
      if (thumbCache.get(f) !== undefined && thumbCache.get(f).key === key) {
        // already rendered with this password
      } else {
        const fd = new FormData();
        fd.append("files", f);
        fd.append("limit", "1");
        fd.append("width", "260");
        fd.append("password", pwValue());
        const data = await (await postForm("/api/thumbnails", fd)).json();
        thumbCache.set(f, { key, src: data.pages[0] });
      }
      if (files[i] === f && el.isConnected) el.innerHTML = `<img src="${thumbCache.get(f).src}" alt="">`;
    } catch (_) {
      if (el.isConnected) el.innerHTML = '<span class="thumb-lock">?</span>';
    }
  }
}

// A tool can refuse a file up front (one-page split, unlocking an open PDF, …).
function guardMessage() {
  if (!files.length) return null;
  const pages = fileInfo.map((f) => f.pages).filter((n) => n !== null && n !== undefined);
  if (pages.length && pages.every((n) => n === 0)) return "This PDF has no pages.";
  return (tool.guard && tool.guard(info, files)) || null;
}

function guardNotice() {
  const msg = guardMessage();
  return msg ? `<p class="note blocked"><strong>This tool can't run on this file</strong>${esc(msg)}</p>` : "";
}

function renderOptions() {
  const pwField = info.encrypted && !tool.ownPassword
    ? field(files.length > 1 ? "Password for the protected files" : "PDF password",
      passwordInput("password", { id: "password" }),
      "This PDF is protected. Enter its password to continue.")
    : "";
  // Offer result protection up front (not after processing), except where it makes no sense.
  const canProtect = !["protect", "unlock"].includes(tool.id) && tool.result !== "images";
  const protectSection = canProtect ? `
    <div class="field protect-opt">
      ${check("protect_result", `${icon("protect", "check-icon")} Protect the result with a password`, false)}
      <div id="protectResultFields" hidden>
        <div class="two">
          ${field("Password", passwordInput("result_pw", { id: "resultPw", autocomplete: "new-password", ui: true }))}
          ${field("Repeat password", passwordInput("result_pw2", { id: "resultPw2", autocomplete: "new-password", ui: true }))}
        </div>
        <p class="hint">The file you download will ask for this password when it is opened.</p>
      </div>
    </div>` : "";
  // When a tool can't run on these files, show only the reason - no options to fiddle with.
  const blocked = guardMessage();
  const controls = blocked
    ? guardNotice()
    : pwField + (tool.options ? tool.options(info) : "") + protectSection;
  $("options").innerHTML = tool.preview
    ? `<div class="opt-grid"><div class="preview" id="preview">
         <div class="pv-page" id="pvPage"><img id="pvImg" alt="Page preview"><div class="pv-layer" id="pvLayer"></div></div>
         <div class="pv-bar" id="pvBar" hidden>
           <button type="button" class="ghost sm" id="pvPagePrev" aria-label="Previous page">${icon("chevronLeft", "ui")}</button>
           <span class="pv-label" id="pvPageLabel"></span>
           <button type="button" class="ghost sm" id="pvPageNext" aria-label="Next page">${icon("chevronRight", "ui")}</button>
           <button type="button" class="ghost sm" id="pvPageBig" title="Open a bigger preview" aria-label="Open a bigger preview">${icon("expand", "ui")}</button>
         </div>
         <p class="hint center" id="pvNote">Loading preview…</p></div>
       <div class="controls">${controls}</div></div>`
    : controls;
  $("stepOptions").classList.toggle("wide", !blocked && !!(tool.wide || tool.preview));
  $("runBtn").hidden = !!blocked;
  $("resetBtn").textContent = blocked ? "Choose another file" : "Cancel";
  $("runBtn").textContent = (typeof tool.button === "function" ? tool.button(info) : tool.button) || "Process";
  showError("");

  // Live values next to sliders.
  $("options").querySelectorAll(".range input").forEach((r) => r.addEventListener("input", () => {
    const out = r.nextElementSibling;
    out.textContent = r.value + out.textContent.replace(/^[\d.]+/, "");
  }));
  const uploadPw = $("options").querySelector('input[name="password"]');
  if (uploadPw) uploadPw.addEventListener("change", () => { if (fileView === "grid") renderFileList(); });
  if (blocked) return;
  const protectBox = $("options").querySelector('input[name="protect_result"]');
  if (protectBox) {
    protectBox.dataset.ui = "1";
    protectBox.addEventListener("change", () => {
      $("protectResultFields").hidden = !protectBox.checked;
      if (protectBox.checked) $("resultPw").focus();
    });
  }
  tool.afterRender && tool.afterRender();
  if (tool.preview) initPreview();

  const first = $("options").querySelector("input[type=password], input[type=text]");
  if (first && !tool.preview) first.focus();
}

// ---------- live preview (watermark, page numbers, crop) ----------
const preview = { size: null, page: 1, total: 1 };

function textWidth(text, weight = "") {
  const ctx = (textWidth.ctx ||= document.createElement("canvas").getContext("2d"));
  ctx.font = `${weight} 100px Helvetica, Arial, sans-serif`;
  return ctx.measureText(text).width / 100;
}

function initPreview() {
  preview.page = 1;
  preview.total = info.pages || 1;
  return loadPreview();
}

async function loadPreview() {
  preview.size = null;
  const pw = $("options").querySelector('input[name="password"]');
  if (info.encrypted && !pwValue()) {
    $("pvNote").textContent = "Enter the password to see a preview.";
    $("pvPage").hidden = true;
    if (pw) pw.addEventListener("change", loadPreview, { once: true });
    return;
  }
  try {
    const fd = new FormData();
    fd.append("files", files[0]);
    fd.append("limit", "1");
    fd.append("page", String(preview.page));
    fd.append("width", "520");
    fd.append("password", pwValue());
    const data = await (await postForm("/api/thumbnails", fd)).json();
    preview.size = data.sizes[0];
    preview.total = data.total || preview.total;
    $("pvImg").onload = () => { $("pvPage").hidden = false; updatePreview(); };
    $("pvImg").src = data.pages[0];
    $("pvBar").hidden = false;
    $("pvPageLabel").textContent = `Page ${preview.page} of ${preview.total}`;
    $("pvPagePrev").disabled = preview.page <= 1;
    $("pvPageNext").disabled = preview.page >= preview.total;
    $("pvNote").textContent = files.length > 1 ? "First file: this is how every page will look." : "Every page gets the same treatment.";
    $("pvPagePrev").onclick = () => stepPreviewPage(-1);
    $("pvPageNext").onclick = () => stepPreviewPage(1);
    $("pvPageBig").onclick = () => openPreview(0, preview.page);
  } catch (e) {
    $("pvNote").textContent = e.message;
    if (pw) pw.addEventListener("change", loadPreview, { once: true });
  }
}

function stepPreviewPage(delta) {
  const next = preview.page + delta;
  if (next < 1 || next > preview.total) return;
  preview.page = next;
  loadPreview();
}

function updatePreview() {
  if (!tool || !tool.drawPreview || !preview.size || !$("pvImg")) return;
  const k = $("pvImg").clientWidth / preview.size[0]; // CSS px per PDF point
  tool.drawPreview($("pvLayer"), collect(), k, preview.size);
}

// ---------- page thumbnails (Select pages, Organize) ----------
function withPages(onLoaded) {
  const pw = $("options").querySelector('input[name="password"]');
  const grid = $("pageGrid");
  const load = async () => {
    if (info.encrypted && !pwValue()) return showError("Enter the PDF password.");
    showError("");
    grid.innerHTML = `<div class="pages-msg"><div class="spinner"></div>Loading pages…</div>`;
    try {
      const fd = new FormData();
      fd.append("files", files[0]);
      fd.append("password", pwValue());
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
      <div class="page" data-n="${i + 1}" role="checkbox" aria-checked="false" tabindex="0">
        <button type="button" class="expand page-zoom" data-zoom="${i + 1}" title="Open a bigger preview" aria-label="Preview page ${i + 1}">${icon("expand", "ui")}</button>
        <img src="${src}" alt="Page ${i + 1}" loading="lazy">
        <span class="page-no">${i + 1}</span>
        <span class="page-check">${icon("check", "ui")}</span>
      </div>`).join("");
    $("pageGrid").querySelectorAll("[data-zoom]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      openPreview(0, +b.dataset.zoom);
    }));
    $("pageGrid").querySelectorAll(".page").forEach((el) => {
      el.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); el.click(); } });
      el.addEventListener("click", (e) => {
      const n = +el.dataset.n;
      if (e.shiftKey && picker.last) {
        const on = !picker.selected.has(n);
        for (let i = Math.min(picker.last, n); i <= Math.max(picker.last, n); i++) on ? picker.selected.add(i) : picker.selected.delete(i);
      } else {
        picker.selected.has(n) ? picker.selected.delete(n) : picker.selected.add(n);
      }
      picker.last = n;
      syncPicker();
      });
    });
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
    el.setAttribute("aria-checked", on);
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
      ${it.blank ? "" : `<button type="button" class="expand page-zoom" data-zoom="${it.page}" title="Open a bigger preview" aria-label="Preview page ${it.page}">${icon("expand", "ui")}</button>`}
      <div class="org-thumb">
        ${it.blank ? '<div class="blank-page"></div>' : `<img src="${org.thumbs[it.page - 1]}" alt="Page ${it.page}" draggable="false">`}
      </div>
      <span class="page-no">${it.blank ? "Blank" : it.page}</span>
      <div class="org-tools">
        <button type="button" data-act="left" title="Move left" aria-label="Move left" ${i === 0 ? "disabled" : ""}>${icon("arrowLeft", "ui")}</button>
        <button type="button" data-act="ccw" title="Rotate left" aria-label="Rotate left">${icon("rotateCcw", "ui")}</button>
        <button type="button" data-act="cw" title="Rotate right" aria-label="Rotate right">${icon("rotate", "ui")}</button>
        <button type="button" data-act="del" title="Delete page" aria-label="Delete page">${icon("trash", "ui")}</button>
        <button type="button" data-act="right" title="Move right" aria-label="Move right" ${i === org.items.length - 1 ? "disabled" : ""}>${icon("arrowRight", "ui")}</button>
      </div>
    </div>`).join("") || `<div class="pages-msg">No pages left. Click Reset to start over.</div>`;

  grid.querySelectorAll("[data-zoom]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    openPreview(0, +b.dataset.zoom);
  }));
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

// ---------- medical bill review (Arrange medical bills) ----------
const BILL_TYPE_LABELS = { doctor: "Doctor bill", prescription: "Prescription", medicine: "Medicine bill", other: "Other" };
let medUnits = [];
let claimRows = [];

// ---------- optional AI extraction (Claude/OpenAI, user's own key) ----------
function loadAiSettings() {
  return { provider: localStorage.getItem("pdforge:aiProvider") || "", apiKey: localStorage.getItem("pdforge:aiApiKey") || "" };
}
function saveAiSettings(provider, apiKey) {
  localStorage.setItem("pdforge:aiProvider", provider);
  localStorage.setItem("pdforge:aiApiKey", apiKey);
}

const CLAIM_EXTRACT_FIELDS = ["doctorName", "qualification", "billNumber", "facility", "amount"];

// Sends this one document's OCR text (never the image) directly to the provider
// using the visitor's own key. Never throws - a failed call just keeps whatever
// the offline regex pass already found.
async function callAiExtract(text, provider, apiKey) {
  const prompt = `Extract these fields from the medical bill text below as strict JSON with exactly these keys: doctorName, qualification (e.g. MBBS, MD), billNumber, facility (pharmacy/hospital/clinic/lab name), amount (number only, no currency symbol). Use "" for anything not present. Text:\n\n${text}`;
  try {
    if (provider === "claude") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return JSON.parse(data.content[0].text.match(/\{[\s\S]*\}/)[0]);
    }
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini", response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return JSON.parse(data.choices[0].message.content);
    }
  } catch (_) {
    // Network error, bad key, unparseable reply - keep the offline result.
  }
  return null;
}

const AI_PROVIDER_LABELS = { "": "Off", claude: "Claude", openai: "OpenAI" };

function setAiProvider(value) {
  $("aiProviderWrap").dataset.value = value;
  $("aiProviderBtnLabel").textContent = AI_PROVIDER_LABELS[value] || "Off";
  $("aiProviderBtnIcon").innerHTML = value ? icon(value, "ui") : "";
  $("aiProviderMenu").querySelectorAll(".ai-provider-opt").forEach((b) => b.classList.toggle("on", b.dataset.value === value));
  saveAiSettings(value, $("aiApiKey").value);
}

function initMedicalReview() {
  const { provider, apiKey } = loadAiSettings();
  setAiProvider(provider);
  $("aiApiKey").value = apiKey;
  $("aiApiKey").placeholder = "Paste your API key";
  $("aiApiKey").addEventListener("change", () => saveAiSettings($("aiProviderWrap").dataset.value || "", $("aiApiKey").value));
  $("aiProviderBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const open = $("aiProviderMenu").hidden;
    $("aiProviderMenu").hidden = !open;
    $("aiProviderBtn").setAttribute("aria-expanded", String(open));
  });
  $("aiProviderMenu").querySelectorAll(".ai-provider-opt").forEach((b) => b.addEventListener("click", () => {
    setAiProvider(b.dataset.value);
    $("aiProviderMenu").hidden = true;
    $("aiProviderBtn").setAttribute("aria-expanded", "false");
  }));
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#aiProviderWrap")) {
      $("aiProviderMenu").hidden = true;
      $("aiProviderBtn")?.setAttribute("aria-expanded", "false");
    }
  });
  if (provider && apiKey) $("aiSettings").open = true;
  $("claimAddLine").addEventListener("click", () => { claimRows.push(blankClaimRow()); renderClaimsGrid(); });
  $("claimDelLine").addEventListener("click", () => {
    const selected = $("claimsGrid").querySelector("tr.selected");
    const i = selected ? +selected.dataset.i : claimRows.length - 1;
    if (i >= 0) claimRows.splice(i, 1);
    renderClaimsGrid();
  });
  $("claimCalc").addEventListener("click", () => {
    const total = claimRows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
    $("claimTotal").textContent = `Total requested amount: ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  });

  const grid = $("pageGrid");
  grid.innerHTML = `<div class="pages-msg"><div class="spinner"></div><span id="progressMsg">Reading pages…</span></div>`;
  (async () => {
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      const data = await (await postForm("/api/analyze-medical-bills", fd)).json();
      medUnits = data.units;

      if (provider && apiKey) {
        for (let i = 0; i < medUnits.length; i++) {
          reportAiProgress(`Reading with AI… ${i + 1}/${medUnits.length}`);
          const found = await callAiExtract(medUnits[i].text || "", provider, apiKey);
          if (found) CLAIM_EXTRACT_FIELDS.forEach((k) => { if (found[k]) medUnits[i][k] = String(found[k]); });
        }
      }

      claimRows = medUnits.map((u) => claimRowFromUnit(u));
      renderMedicalReview();
      renderClaimsGrid();
    } catch (e) {
      grid.innerHTML = `<div class="pages-msg">${esc(e.message)}</div>`;
    }
  })();
}
// initMedicalReview()'s own AI-progress text (distinct from the analyze pass's
// pdforge:progress-driven #progressMsg, since that element may already be gone).
function reportAiProgress(message) {
  const el = $("progressMsg");
  if (el) el.textContent = message;
}

function renderMedicalReview() {
  const grid = $("pageGrid");
  grid.innerHTML = medUnits.map((u, i) => {
    const flagged = !u.date || u.type === "other";
    return `
    <div class="page med-page${flagged ? " needs-review" : ""}" data-i="${i}">
      <img src="${u.thumb}" alt="Page ${i + 1}">
      ${flagged ? `<span class="badge med-flag">${icon("eye", "badge-icon")} Needs review</span>` : ""}
      <div class="med-fields">
        <select data-field="type" aria-label="Document type">
          ${Object.entries(BILL_TYPE_LABELS).map(([v, label]) => `<option value="${v}" ${u.type === v ? "selected" : ""}>${esc(label)}</option>`).join("")}
        </select>
        <input type="date" data-field="date" value="${u.date || ""}" aria-label="Document date">
      </div>
    </div>`;
  }).join("") || `<div class="pages-msg">No pages found.</div>`;

  grid.querySelectorAll(".med-page").forEach((card) => {
    const i = +card.dataset.i;
    card.querySelectorAll("[data-field]").forEach((el) => el.addEventListener("change", () => {
      medUnits[i][el.dataset.field] = el.value || null;
      renderMedicalReview();
    }));
  });

  $("planField").value = JSON.stringify(medUnits.map((u) => (
    { fileIndex: u.fileIndex, pageIndex: u.pageIndex, date: u.date, type: u.type, rotation: u.rotation })));
  const flaggedCount = medUnits.filter((u) => !u.date || u.type === "other").length;
  $("medCount").textContent = `${medUnits.length} page${medUnits.length === 1 ? "" : "s"}${flaggedCount ? `, ${flaggedCount} need${flaggedCount === 1 ? "s" : ""} review` : ""}`;
}

// ---------- claims data grid (Arrange medical bills) - display/editing only,
// separate from the plan that builds the PDF, per the user's own request ----------
const CLAIM_COLUMNS = [
  ["familyMember", "Family Member"], ["birthDate", "Birth Date"], ["gender", "Gender"],
  ["doctorName", "Doctor Name"], ["qualification", "Doctor Qualification"], ["billNumber", "Bill Number"],
  ["consultationDate", "Consultation Date"], ["billDate", "Bill Date"], ["natureOfClaim", "Nature of Claim"],
  ["medicalAppliance", "Medical Appliance"], ["applicantRemark", "Applicant Remark"], ["facility", "Name of Pharmacy/Hospital/Laboratory"],
  ["amount", "Requested Amount"],
];

// One row per analyzed document (not per date/claim - simplest mapping today).
// Doctor-type documents fill "Consultation Date", medicine-type fill "Bill Date".
function claimRowFromUnit(u) {
  return {
    familyMember: "", birthDate: "", gender: "",
    doctorName: u.doctorName || "", qualification: u.qualification || "", billNumber: u.billNumber || "",
    consultationDate: (u.type === "doctor" || u.type === "prescription") ? (u.date || "") : "",
    billDate: u.type === "medicine" ? (u.date || "") : "",
    natureOfClaim: "", medicalAppliance: "", applicantRemark: "",
    facility: u.facility || "", exceptionAllowed: false, amount: u.amount || "",
  };
}
const blankClaimRow = () => claimRowFromUnit({});

function renderClaimsGrid() {
  const table = $("claimsGrid");
  const head = `<tr><th>Line No.</th>${CLAIM_COLUMNS.map(([, label]) => `<th>${esc(label)}</th>`).join("")}<th>Exception Allowed</th></tr>`;
  const body = claimRows.map((row, i) => `
    <tr data-i="${i}">
      <td class="claim-line">${String(i + 1).padStart(4, "0")}</td>
      ${CLAIM_COLUMNS.map(([key]) => `<td><input data-field="${key}" value="${esc(row[key] || "")}"></td>`).join("")}
      <td class="claim-check"><input type="checkbox" data-field="exceptionAllowed" ${row.exceptionAllowed ? "checked" : ""}></td>
    </tr>`).join("");
  table.innerHTML = head + body;

  table.querySelectorAll("tr[data-i] input").forEach((el) => el.addEventListener("change", () => {
    const i = +el.closest("tr").dataset.i;
    claimRows[i][el.dataset.field] = el.type === "checkbox" ? el.checked : el.value;
  }));
  table.querySelectorAll("tr[data-i]").forEach((tr) => tr.addEventListener("focusin", () => {
    table.querySelectorAll("tr").forEach((r) => r.classList.remove("selected"));
    tr.classList.add("selected");
  }));
  $("claimTotal").textContent = "";
}

// ---------- expanded preview ----------
const preview2 = { file: null, page: 1, total: 1, token: 0 };

async function openPreview(index, page = 1) {
  const f = files[index];
  if (!f) return;
  preview2.file = f;
  preview2.page = page;
  preview2.total = (fileInfo[index] || {}).pages || 1;
  $("pvTitle").textContent = f.name;
  $("previewModal").hidden = false;
  await showPreviewPage();
}

async function showPreviewPage() {
  const token = ++preview2.token;
  const f = preview2.file;
  $("pvError").hidden = true;
  $("pvSpinner").hidden = false;
  $("pvCount").textContent = `Page ${preview2.page} of ${preview2.total}`;
  $("pvPrev").disabled = preview2.page <= 1;
  $("pvNext").disabled = preview2.page >= preview2.total;
  if (isImageFile(f) && !isPdf(f)) {
    // Already an image: show it directly, no engine round-trip and no "pages".
    $("pvFull").src = URL.createObjectURL(f);
    $("pvFull").hidden = false;
    $("pvSpinner").hidden = true;
    preview2.total = 1;
    $("pvCount").textContent = "";
    $("pvPrev").disabled = true;
    $("pvNext").disabled = true;
    return;
  }
  try {
    const fd = new FormData();
    fd.append("files", f);
    fd.append("page", String(preview2.page));
    fd.append("limit", "1");
    fd.append("width", "1100");
    fd.append("password", pwValue());
    const data = await (await postForm("/api/thumbnails", fd)).json();
    if (token !== preview2.token) return;
    $("pvFull").src = data.pages[0];
    $("pvFull").hidden = false;
    preview2.total = data.total || preview2.total;
    $("pvCount").textContent = `Page ${preview2.page} of ${preview2.total}`;
    $("pvNext").disabled = preview2.page >= preview2.total;
  } catch (e) {
    if (token !== preview2.token) return;
    $("pvFull").hidden = true;
    $("pvError").textContent = e.message;
    $("pvError").hidden = false;
  } finally {
    if (token === preview2.token) $("pvSpinner").hidden = true;
  }
}

function closePreview() {
  preview2.token++;
  $("previewModal").hidden = true;
  $("pvFull").removeAttribute("src");
}

function stepPreview(delta) {
  const next = preview2.page + delta;
  if (next < 1 || next > preview2.total) return;
  preview2.page = next;
  showPreviewPage();
}

// ---------- process ----------
function collect() {
  const fd = new FormData();
  $("options").querySelectorAll("input, select").forEach((el) => {
    if (!el.name || el.disabled || el.dataset.ui === "1") return;
    if ((el.type === "radio" || el.type === "checkbox") && !el.checked) return;
    fd.append(el.name, el.value);
  });
  return fd;
}

async function run() {
  const blocked = guardMessage();
  if (blocked) return showError(blocked);
  const fd = collect();
  const wantProtect = !!$("options").querySelector('input[name="protect_result"]:checked');
  const resultPw = wantProtect ? $("resultPw").value : "";
  const err = (info.encrypted && !tool.ownPassword && !fd.get("password") && "Enter the PDF password.")
    || (wantProtect && !resultPw && "Enter the password for the result, or untick the protect box.")
    || (wantProtect && resultPw !== $("resultPw2").value && "The result passwords don't match.")
    || (tool.validate && tool.validate(fd, info));
  if (err) return showError(err);
  fd.delete("confirm");
  files.forEach((f) => fd.append("files", f));

  $("workingMsg").textContent = files.length > 1 ? `Processing ${files.length} files…` : "Processing your file…";
  show("stepWorking");
  try {
    let res = await postForm(tool.endpoint, fd);
    let blob = await res.blob();
    let name = filenameFrom(res) || "result.pdf";
    let extra = "";
    if (wantProtect) {
      $("workingMsg").textContent = "Adding the password…";
      const pfd = new FormData();
      pfd.append("files", blob, name);
      pfd.append("new_password", resultPw);
      res = await postForm("/api/protect", pfd);
      blob = await res.blob();
      name = filenameFrom(res) || name;
      extra = " · password protected";
    }
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

// ---------- desktop app: download panel (website) and saving files (app) ----------
const DOWNLOADS = {
  "mac-arm": ["macOS", "Apple Silicon (M1 and newer)"],
  "mac-intel": ["macOS", "Intel processor"],
  windows: ["Windows", "Windows 10 and 11, 64-bit"],
  linux: ["Linux", "Ubuntu / Debian (.deb)"],
};

function detectOs() {
  const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent).toLowerCase();
  if (p.includes("mac")) return "mac";
  if (p.includes("win")) return "windows";
  return p.includes("linux") && !p.includes("android") ? "linux" : "";
}

// Apple Silicon or Intel? Chromium answers directly; otherwise the GPU name tells us.
function macChipFromGpu() {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const info = gl && gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "");
    if (/apple\s*(m\d|gpu)/i.test(renderer)) return "arm";
    if (/intel|radeon|nvidia|geforce/i.test(renderer)) return "x86";
  } catch (_) {}
  return "";
}

async function detectDownload() {
  const os = detectOs();
  if (os === "windows" || os === "linux") return os;
  if (os !== "mac") return "";
  let arch = "";
  try {
    const hints = await navigator.userAgentData?.getHighEntropyValues?.(["architecture"]);
    if (hints?.architecture) arch = hints.architecture.includes("arm") ? "arm" : "x86";
  } catch (_) {}
  // Unknown Mac: Apple Silicon is the safe default, and the other build is one click away.
  return (arch || macChipFromGpu()) === "x86" ? "mac-intel" : "mac-arm";
}

// Phones and tablets can't run the desktop app.
const IS_PHONE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform)); // iPadOS reports "Mac"
document.body.classList.toggle("phone", IS_PHONE);

async function openDownload(reason = "") {
  $("dlTitle").textContent = IS_PHONE ? "Use pdforge on a computer" : "Get pdforge for your computer";
  $("dlPhone").hidden = !IS_PHONE;
  $("dlDesktop").hidden = IS_PHONE;
  $("shareNote").hidden = true;
  $("dlReason").textContent = reason;
  $("dlReason").hidden = !reason;
  $("downloadModal").hidden = false;
  $("dlClose").focus();
  if (IS_PHONE) return;

  // One button for the system we detect; the rest stay a click away.
  const key = await detectDownload();
  $("dlMain").hidden = !key;
  $("dlButtons").hidden = !!key;
  $("dlOtherBtn").setAttribute("aria-expanded", "false");
  // First-launch steps follow the same detected system - no separate toggle to operate.
  const isMac = key.startsWith("mac");
  const isWindows = key === "windows";
  $("dlHelp").hidden = !(isMac || isWindows);
  $("dlStepsMac").hidden = !isMac;
  $("dlStepsWin").hidden = !isWindows;
  if (!key) return;
  const [name, detail] = DOWNLOADS[key];
  $("dlMainBtn").href = `/download/${key}`;
  $("dlMainBtn").textContent = `Download for ${name}`;
  $("dlMainNote").textContent = detail;
  document.querySelectorAll(".dl-btn").forEach((a) => a.classList.toggle("suggested", a.dataset.key === key));
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
$("dlOtherBtn").addEventListener("click", () => {
  const show = $("dlButtons").hidden;
  $("dlButtons").hidden = !show;
  $("dlOtherBtn").setAttribute("aria-expanded", String(show));
  $("dlOtherBtn").textContent = show ? "Hide other systems" : "Not your system?";
});
let copyTimer;
$("dlCopyBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("dlCode").textContent);
  } catch (_) {
    return;
  }
  // Swap the icon markup rather than toggling .hidden on it: some engines don't
  // reflect the `hidden` IDL property to the attribute for <svg> elements.
  $("dlCopyBtn").innerHTML = icon("check", "ui");
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { $("dlCopyBtn").innerHTML = icon("copy", "ui"); }, 1500);
});
$("downloadModal").addEventListener("click", (e) => { if (e.target === $("downloadModal")) closeDownload(); });
$("fileInput").addEventListener("change", (e) => addFiles(e.target.files));
const dz = $("dropzone");
["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

function pickMoreFiles() {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = $("fileInput").accept;
  input.addEventListener("change", () => addFiles(input.files));
  input.click();
}
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


$("viewSwitch").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-view]");
  if (!b) return;
  fileView = b.dataset.view;
  localStorage.setItem("pdforge.fileView", fileView);
  renderFileList();
});
$("pvCloseBtn").addEventListener("click", closePreview);
$("previewModal").addEventListener("click", (e) => { if (e.target === $("previewModal")) closePreview(); });
$("pvPrev").addEventListener("click", () => stepPreview(-1));
$("pvNext").addEventListener("click", () => stepPreview(1));
// Show/hide for any password box.
document.addEventListener("click", (e) => {
  const eye = e.target.closest(".eye");
  if (!eye) return;
  const input = eye.previousElementSibling;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  eye.classList.toggle("on", show);
  eye.innerHTML = icon(show ? "eyeOff" : "eye", "eye-icon");
  eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
  eye.title = show ? "Hide password" : "Show password";
});

$("menuBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(); });
document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) toggleMenu(false); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { toggleMenu(false); closeDownload(); closePreview(); }
  if (!$("previewModal").hidden) {
    if (e.key === "ArrowLeft") stepPreview(-1);
    if (e.key === "ArrowRight") stepPreview(1);
  }
});
window.addEventListener("hashchange", route);

renderNav();
renderHome();
route();
