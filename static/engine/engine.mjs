// pdforge local engine: the same API as the Flask server (app.py), running
// entirely on the user's device (desktop app, or the website with ?local=1).
//
//   handle(url, formData) -> Promise<Response>
//
// Engines: pdf-lib (editing), pdf.js (rendering), qpdf compiled to WebAssembly
// (encryption, decryption, repair, structural compression), fflate (ZIP).
import {
  PDFDocument, PDFName, PDFRawStream, PDFArray, PDFDict, StandardFonts, EncryptedPDFError,
  degrees, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix,
} from "../vendor/pdf-lib.esm.min.js";
import * as pdfjs from "../vendor/pdf.min.mjs";
import { zipSync, unzipSync, unzlibSync } from "../vendor/fflate.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.min.mjs", import.meta.url).href;

const MM = 72 / 25.4; // points per millimetre
const THUMB_WIDTH = 180;
const COMPRESS_LEVELS = { low: null, recommended: [150, 0.75], extreme: [96, 0.5] };
const PAGE_NUMBER_FORMATS = { n: "{n}", page_n: "Page {n}", page_n_of: "Page {n} of {total}", n_slash: "{n} / {total}" };
const LOAD = { updateMetadata: false }; // don't stamp "pdf-lib" as producer

class ToolError extends Error {}

// ---------- request helpers ----------

function baseName(filename) {
  const name = (filename || "document").split(/[\\/]/).pop().replace(/\.[^.]*$/, "");
  return name.replace(/[^\w\-. ]/g, "_") || "document";
}

function pdfFiles(fd) {
  const files = fd.getAll("files").filter((f) => f && f.name);
  if (!files.length) throw new ToolError("Please upload a PDF file.");
  return files;
}

const str = (fd, name, dflt = "") => (fd.get(name) ?? dflt).toString();
const flag = (fd, name) => ["1", "true", "on"].includes(str(fd, name));
function num(fd, name, dflt, lo, hi) {
  const v = parseFloat(str(fd, name, String(dflt)));
  if (Number.isNaN(v)) throw new ToolError(`'${name}' must be a number.`);
  return Math.min(Math.max(v, lo), hi);
}

// ---------- response helpers ----------

const MIME = { pdf: "application/pdf", zip: "application/zip", jpg: "image/jpeg", png: "image/png" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function sendBytes(bytes, filename) {
  const ext = filename.split(".").pop().toLowerCase();
  return new Response(new Blob([bytes], { type: MIME[ext] || "application/octet-stream" }), {
    headers: { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` },
  });
}

// One result -> that file. Several -> a ZIP (duplicate names get a suffix).
function sendResults(results, zipName) {
  if (results.length === 1) return sendBytes(results[0][1], results[0][0]);
  const entries = {};
  for (const [name, bytes] of results) {
    const dot = name.lastIndexOf(".");
    let unique = name;
    for (let i = 2; unique in entries; i++) unique = `${name.slice(0, dot)} (${i})${name.slice(dot)}`;
    entries[unique] = [bytes, { level: 1 }];
  }
  return sendBytes(zipSync(entries), zipName);
}

async function forEachPdf(fd, suffix, process) {
  const results = [];
  for (const f of pdfFiles(fd)) {
    const doc = await loadPdf(f, str(fd, "password"));
    results.push([`${baseName(f.name)}_${suffix}.pdf`, await process(doc)]);
  }
  return sendResults(results, `${suffix}.zip`);
}

const save = (doc) => doc.save({ useObjectStreams: true });

// ---------- qpdf (WebAssembly) ----------

let qpdfModule;
function loadQpdf() {
  return (qpdfModule ||= new Promise((resolve, reject) => {
    // qpdf.js is an Emscripten build that defines a global `Module` factory.
    const script = document.createElement("script");
    script.src = new URL("../vendor/qpdf.js", import.meta.url).href;
    script.onload = () => {
      const factory = window.Module;
      window.Module = undefined;
      factory({
        locateFile: () => new URL("../vendor/qpdf.wasm", import.meta.url).href,
        noInitialRun: true,
        print: () => {},
        printErr: () => {},
      }).then(resolve, reject);
    };
    script.onerror = () => reject(new Error("Couldn't load the qpdf engine."));
    document.head.appendChild(script);
  }));
}

let qpdfRun = 0;
// Run qpdf with `args`, where "{in}" and "{out}" stand for the input and output files.
// Returns the output bytes, or null if qpdf failed (exit code 2; 3 means warnings only).
async function qpdf(args, input) {
  const q = await loadQpdf();
  const id = ++qpdfRun;
  const inPath = `/in${id}.pdf`, outPath = `/out${id}.pdf`;
  q.FS.writeFile(inPath, input);
  let code;
  try {
    code = q.callMain(args.map((a) => a.replace("{in}", inPath).replace("{out}", outPath)));
  } catch (e) {
    code = typeof e?.status === "number" ? e.status : 2;
  }
  let out = null;
  if (code === 0 || code === 3) {
    try { out = q.FS.readFile(outPath); } catch (_) { out = null; }
  }
  for (const p of [inPath, outPath]) { try { q.FS.unlink(p); } catch (_) {} }
  return out;
}

const decryptBytes = (bytes, password) => qpdf([`--password=${password}`, "--decrypt", "{in}", "{out}"], bytes);
const repairBytes = (bytes) => qpdf(["{in}", "{out}"], bytes);

// ---------- opening PDFs ----------

const isEncryptedError = (e) => e instanceof EncryptedPDFError || /encrypted/i.test(e?.message || "");

// Returns { doc, bytes, encrypted }; bytes are the (decrypted) PDF the doc was parsed from.
async function openPdf(file, password = "") {
  let bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return { doc: await PDFDocument.load(bytes, LOAD), bytes, encrypted: false };
  } catch (e) {
    if (isEncryptedError(e)) {
      // Files with only print/copy restrictions open with an empty password.
      const plain = (await decryptBytes(bytes, password)) || (password ? null : await decryptBytes(bytes, ""));
      if (!plain) {
        throw new ToolError(password
          ? `Incorrect password for '${file.name}'.`
          : `'${file.name}' is password-protected. Enter its password first.`);
      }
      return { doc: await PDFDocument.load(plain, LOAD), bytes: plain, encrypted: true };
    }
    // Damaged or unusual file: let qpdf rebuild it, then try again.
    const fixed = await repairBytes(bytes);
    if (fixed) {
      try { return { doc: await PDFDocument.load(fixed, LOAD), bytes: fixed, encrypted: false }; } catch (_) {}
    }
    throw new ToolError(`'${file.name}' is not a valid PDF file.`);
  }
}

const loadPdf = async (file, password) => (await openPdf(file, password)).doc;

async function openPdfjs(file, password) {
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    return await pdfjs.getDocument({ data, password: password || undefined, isEvalSupported: false }).promise;
  } catch (e) {
    if (e?.name === "PasswordException") {
      throw new ToolError(password ? "Incorrect password. Please try again."
        : `'${file.name}' is password-protected. Enter its password first.`);
    }
    throw new ToolError(`Couldn't open '${file.name}'. Is it a damaged PDF?`);
  }
}

function closePdfjs(doc) {
  // pdf.js v6 frees a document through its loading task.
  (doc.loadingTask || doc).destroy?.();
}

async function renderPage(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // "print" intent renders without requestAnimationFrame, so it keeps going
  // even when the window or tab is in the background.
  await page.render({ canvas, canvasContext: ctx, viewport, intent: "print" }).promise;
  return canvas;
}

const canvasBytes = (canvas, type, quality) => new Promise((resolve, reject) =>
  canvas.toBlob((b) => (b ? b.arrayBuffer().then((ab) => resolve(new Uint8Array(ab))) : reject(new Error("Image encoding failed"))), type, quality));

// ---------- page geometry ----------

function pageRotation(page) {
  return ((page.getRotation().angle % 360) + 360) % 360;
}

function visualSize(page) {
  const { width, height } = page.getCropBox();
  return pageRotation(page) % 180 ? [height, width] : [width, height];
}

// Draw on every page in its *visual* (on-screen) orientation.
// draw(page, visualWidth, visualHeight, pageIndex, pageCount)
function drawOverlays(doc, draw) {
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const { x, y, width: w, height: h } = page.getCropBox();
    const m = {
      0: [1, 0, 0, 1, x, y],
      90: [0, 1, -1, 0, x + w, y],
      180: [-1, 0, 0, -1, x + w, y + h],
      270: [0, -1, 1, 0, x, y + h],
    }[pageRotation(page)];
    const [vw, vh] = visualSize(page);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m));
    draw(page, vw, vh, i, pages.length);
    page.pushOperators(popGraphicsState());
  });
}

function hexColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) throw new ToolError("Invalid colour.");
  const n = parseInt(m[1], 16);
  return rgb((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

async function embedFont(doc, name, text) {
  const font = await doc.embedFont(name);
  try {
    font.encodeText(text);
  } catch (_) {
    throw new ToolError("For now, text can only use Latin letters, digits and common punctuation.");
  }
  return font;
}

function parseRanges(spec, pageCount) {
  const groups = [];
  for (let part of (spec || "").split(",")) {
    part = part.trim();
    if (!part) continue;
    const m = /^(\d*)\s*-\s*(\d*)$|^(\d+)$/.exec(part);
    if (!m) throw new ToolError(`Couldn't understand page range '${part}'. Use e.g. 1-3, 5, 8-10.`);
    const start = m[3] ? +m[3] : +(m[1] || 1);
    const end = m[3] ? +m[3] : +(m[2] || pageCount);
    if (start < 1 || end > pageCount || start > end) {
      throw new ToolError(`Range '${part}' is outside the document (1–${pageCount}).`);
    }
    groups.push(Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i));
  }
  if (!groups.length) throw new ToolError("Enter at least one page range.");
  return groups;
}

async function pagesPdf(src, indices) {
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(src, indices)) out.addPage(p);
  return save(out);
}

// ---------- general ----------

function readMetadata(doc) {
  const get = (fn) => { try { return doc[fn]() || ""; } catch (_) { return ""; } };
  return {
    title: get("getTitle"), author: get("getAuthor"), subject: get("getSubject"),
    keywords: get("getKeywords"), creator: get("getCreator"), producer: get("getProducer"),
  };
}

async function inspect(fd) {
  const out = [];
  for (const f of pdfFiles(fd)) {
    try {
      const { doc } = await openPdf(f);
      const first = doc.getPageCount() ? doc.getPage(0) : null;
      out.push({ encrypted: false, pages: doc.getPageCount(), size: first && visualSize(first), metadata: readMetadata(doc) });
    } catch (e) {
      if (e instanceof ToolError && /password-protected/.test(e.message)) {
        out.push({ encrypted: true, pages: null, size: null, metadata: null });
      } else {
        throw e;
      }
    }
  }
  return json({ files: out });
}

async function thumbnails(fd) {
  const f = pdfFiles(fd)[0];
  const limit = parseInt(str(fd, "limit", "0"), 10) || 0;
  const only = parseInt(str(fd, "page", "0"), 10) || 0; // 1-based; 0 = from the first page
  const width = num(fd, "width", THUMB_WIDTH, 60, 1400);
  const doc = await openPdfjs(f, str(fd, "password"));
  const pages = [], sizes = [];
  let total = 0;
  try {
    const start = Math.max(1, only);
    const count = limit ? Math.min(start + limit - 1, doc.numPages) : doc.numPages;
    for (let i = start; i <= count; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 }); // already accounts for /Rotate
      const canvas = await renderPage(page, width / base.width);
      pages.push(canvas.toDataURL("image/jpeg", 0.75));
      sizes.push([Math.round(base.width * 10) / 10, Math.round(base.height * 10) / 10]);
      page.cleanup();
    }
  } finally {
    total = doc.numPages;
    closePdfjs(doc);
  }
  return json({ pages, sizes, total });
}

// ---------- security ----------

async function unlock(fd) {
  const results = [];
  for (const f of pdfFiles(fd)) {
    const { bytes, encrypted } = await openPdf(f, str(fd, "password")); // decrypted bytes
    if (!encrypted) throw new ToolError(`'${f.name}' isn't password-protected, so there is nothing to unlock.`);
    results.push([`${baseName(f.name)}_unlocked.pdf`, bytes]);
  }
  return sendResults(results, "unlocked.zip");
}

function randomPassword() {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/[^A-Za-z0-9]/g, "x");
}

async function protect(fd) {
  const files = pdfFiles(fd);
  const newPassword = str(fd, "new_password");
  const [blockPrint, blockCopy, blockEdit] = ["block_print", "block_copy", "block_edit"].map((k) => flag(fd, k));
  const restricted = blockPrint || blockCopy || blockEdit;
  if (!newPassword && !restricted) throw new ToolError("Enter a new password, or choose something to restrict.");

  // With restrictions the owner password must differ from the open password,
  // otherwise opening the file with it would lift the restrictions.
  const owner = restricted ? randomPassword() : newPassword;
  const encArgs = [
    "--encrypt", `--user-password=${newPassword}`, `--owner-password=${owner}`, "--bits=256",
    `--print=${blockPrint ? "none" : "full"}`, `--extract=${blockCopy ? "n" : "y"}`,
    `--modify=${blockEdit ? "none" : "all"}`, "--",
  ];
  const encrypt = async (pdfBytes) => {
    const out = await qpdf([...encArgs, "{in}", "{out}"], pdfBytes);
    if (!out) throw new ToolError("Couldn't encrypt this PDF.");
    return out;
  };

  const results = [];
  for (const f of files) {
    const name = baseName(f.name);
    if (/\.zip$/i.test(f.name)) {
      let entries;
      try { entries = unzipSync(new Uint8Array(await f.arrayBuffer())); } catch (_) { throw new ToolError("That ZIP file is damaged."); }
      const out = {};
      for (const [entry, data] of Object.entries(entries)) out[entry] = [/\.pdf$/i.test(entry) ? await encrypt(data) : data, { level: 1 }];
      results.push([`${name}_protected.zip`, zipSync(out)]);
    } else {
      const { bytes } = await openPdf(f, str(fd, "password"));
      results.push([`${name}_protected.pdf`, await encrypt(bytes)]);
    }
  }
  return sendResults(results, "protected.zip");
}

// ---------- organize ----------

async function merge(fd) {
  const files = pdfFiles(fd);
  if (files.length < 2) throw new ToolError("Add at least two PDFs to merge.");
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await loadPdf(f, str(fd, "password"));
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  }
  return sendBytes(await save(out), "merged.pdf");
}

async function split(fd) {
  const f = pdfFiles(fd)[0];
  const src = await loadPdf(f, str(fd, "password"));
  const name = baseName(f.name);
  const n = src.getPageCount();
  if (n < 2) throw new ToolError("This PDF has only one page, so there is nothing to split.");
  const groups = str(fd, "mode", "all") === "all"
    ? Array.from({ length: n }, (_, i) => [i])
    : parseRanges(str(fd, "ranges"), n);
  let results = [];
  for (const g of groups) {
    const label = g.length === 1 ? `${g[0] + 1}` : `${g[0] + 1}-${g[g.length - 1] + 1}`;
    results.push([`${name}_${label}.pdf`, await pagesPdf(src, g)]);
  }
  if (results.length === 1) results = [[`${name}_pages.pdf`, results[0][1]]];
  return sendResults(results, `${name}_split.zip`);
}

async function extract(fd) {
  const f = pdfFiles(fd)[0];
  const src = await loadPdf(f, str(fd, "password"));
  const n = src.getPageCount();
  const chosen = str(fd, "pages").trim().split(/[\s,]+/).filter(Boolean).map((x) => {
    if (!/^\d+$/.test(x)) throw new ToolError("Pages must be numbers, e.g. 2, 4, 7.");
    return +x;
  });
  if (!chosen.length) throw new ToolError("Select at least one page.");
  const bad = chosen.find((p) => p < 1 || p > n);
  if (bad !== undefined) throw new ToolError(`Page ${bad} doesn't exist (this PDF has ${n} pages).`);
  return sendBytes(await pagesPdf(src, chosen.map((p) => p - 1)), `${baseName(f.name)}_pages.pdf`);
}

async function organize(fd) {
  const f = pdfFiles(fd)[0];
  const src = await loadPdf(f, str(fd, "password"));
  const n = src.getPageCount();
  let plan;
  try { plan = JSON.parse(str(fd, "plan", "[]")); } catch (_) { throw new ToolError("Invalid page plan."); }
  if (!Array.isArray(plan) || !plan.length) throw new ToolError("The document needs at least one page.");

  if (!n) throw new ToolError("This PDF has no pages.");
  const blankSize = visualSize(src.getPage(0));
  const out = await PDFDocument.create();
  for (const item of plan) {
    let page;
    if (item.blank) {
      page = out.addPage(blankSize);
    } else {
      const num = parseInt(item.page, 10);
      if (!(num >= 1 && num <= n)) throw new ToolError(`Page ${num} doesn't exist.`);
      [page] = await out.copyPages(src, [num - 1]);
      out.addPage(page);
    }
    const rotate = ((parseInt(item.rotate, 10) || 0) % 360 + 360) % 360;
    if (rotate) page.setRotation(degrees((pageRotation(page) + rotate) % 360));
  }
  return sendBytes(await save(out), `${baseName(f.name)}_organized.pdf`);
}

// ---------- optimize ----------

const structural = (bytes) => qpdf([
  "--object-streams=generate", "--compress-streams=y", "--recompress-flate",
  "--compression-level=9", "--remove-unreferenced-resources=yes", "{in}", "{out}",
], bytes);

function imageComponents(doc, dict) {
  const cs = dict.lookup(PDFName.of("ColorSpace"));
  if (cs === PDFName.of("DeviceRGB")) return 3;
  if (cs === PDFName.of("DeviceGray")) return 1;
  if (cs instanceof PDFArray && cs.lookup(0) === PDFName.of("ICCBased")) {
    const icc = cs.lookup(1);
    const n = icc?.dict?.lookup(PDFName.of("N"))?.asNumber?.();
    return n === 1 || n === 3 ? n : 0;
  }
  return 0;
}

// Decode one image XObject into a canvas-drawable bitmap, or null if unsupported.
async function decodeImage(doc, stream) {
  const dict = stream.dict;
  if (dict.lookup(PDFName.of("ImageMask"))?.asBoolean?.() || dict.has(PDFName.of("Decode"))) return null;
  if ((dict.lookup(PDFName.of("BitsPerComponent"))?.asNumber?.() ?? 8) !== 8) return null;
  const comps = imageComponents(doc, dict);
  if (!comps) return null;
  let filter = dict.lookup(PDFName.of("Filter"));
  if (filter instanceof PDFArray) filter = filter.size() === 1 ? filter.lookup(0) : null;
  const w = dict.lookup(PDFName.of("Width")).asNumber();
  const h = dict.lookup(PDFName.of("Height")).asNumber();

  if (filter === PDFName.of("DCTDecode")) {
    return createImageBitmap(new Blob([stream.contents], { type: "image/jpeg" }));
  }
  if (filter === PDFName.of("FlateDecode")) {
    const parms = dict.lookup(PDFName.of("DecodeParms"));
    if (parms instanceof PDFDict && (parms.lookup(PDFName.of("Predictor"))?.asNumber?.() ?? 1) > 1) return null;
    const raw = unzlibSync(stream.contents);
    if (raw.length < w * h * comps) return null;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0, j = 0; i < w * h; i++, j += comps) {
      rgba[i * 4] = raw[j];
      rgba[i * 4 + 1] = raw[comps === 3 ? j + 1 : j];
      rgba[i * 4 + 2] = raw[comps === 3 ? j + 2 : j];
      rgba[i * 4 + 3] = 255;
    }
    return createImageBitmap(new ImageData(rgba, w, h));
  }
  return null;
}

async function shrinkImages(doc, [dpi, quality]) {
  const seen = new Set();
  for (const page of doc.getPages()) {
    const maxPx = Math.round((Math.max(...visualSize(page)) / 72) * dpi);
    const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject"));
    if (!(xobjects instanceof PDFDict)) continue;
    for (const [, ref] of xobjects.entries()) {
      const key = ref.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream) || stream.dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
      try {
        const bitmap = await decodeImage(doc, stream);
        if (!bitmap) continue;
        const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const jpeg = await canvasBytes(canvas, "image/jpeg", quality);
        if (jpeg.length >= stream.contents.length) continue;
        const dict = doc.context.obj({
          Type: "XObject", Subtype: "Image", Width: canvas.width, Height: canvas.height,
          ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode",
        });
        const smask = stream.dict.get(PDFName.of("SMask"));
        if (smask) dict.set(PDFName.of("SMask"), smask);
        doc.context.assign(ref, PDFRawStream.of(dict, jpeg));
      } catch (_) {
        // Unusual image encodings are simply left alone.
      }
    }
  }
}

async function compress(fd) {
  const level = str(fd, "level", "recommended");
  if (!(level in COMPRESS_LEVELS)) throw new ToolError("Unknown compression level.");
  const results = [];
  for (const f of pdfFiles(fd)) {
    const original = new Uint8Array(await f.arrayBuffer());
    let { doc, bytes } = await openPdf(f, str(fd, "password"));
    if (COMPRESS_LEVELS[level]) {
      await shrinkImages(doc, COMPRESS_LEVELS[level]);
      bytes = await save(doc);
    }
    let data = (await structural(bytes)) || bytes;
    // Never hand back something bigger than what was uploaded.
    if (data.length >= original.length) data = original;
    results.push([`${baseName(f.name)}_compressed.pdf`, data]);
  }
  return sendResults(results, "compressed.zip");
}

async function repair(fd) {
  const results = [];
  for (const f of pdfFiles(fd)) {
    const { bytes } = await openPdf(f, str(fd, "password"));
    const fixed = await repairBytes(bytes);
    if (!fixed) throw new ToolError(`'${f.name}' is too damaged to repair.`);
    results.push([`${baseName(f.name)}_repaired.pdf`, fixed]);
  }
  return sendResults(results, "repaired.zip");
}

// ---------- convert ----------

async function imagesToPdf(fd) {
  const files = fd.getAll("files").filter((f) => f && f.name);
  if (!files.length) throw new ToolError("Please upload at least one image.");
  const out = await PDFDocument.create();
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    let img;
    try {
      if (f.type === "image/jpeg" || /\.jpe?g$/i.test(f.name)) img = await out.embedJpg(bytes);
      else if (f.type === "image/png" || /\.png$/i.test(f.name)) img = await out.embedPng(bytes);
      else {
        // Other formats (WebP, GIF, BMP…): let the browser decode, then embed as PNG.
        const bitmap = await createImageBitmap(f);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        img = await out.embedPng(await canvasBytes(canvas, "image/png"));
      }
    } catch (_) {
      throw new ToolError(`'${f.name}' is not a supported image.`);
    }
    // 100 pixels per inch, like the server version.
    const w = (img.width * 72) / 100, h = (img.height * 72) / 100;
    out.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  const name = files.length === 1 ? baseName(files[0].name) : "images";
  return sendBytes(await save(out), `${name}.pdf`);
}

async function pdfToImage(fd) {
  const f = pdfFiles(fd)[0];
  const fmt = str(fd, "format", "jpg");
  if (!["jpg", "png"].includes(fmt)) throw new ToolError("Choose JPG or PNG.");
  const dpi = Math.round(num(fd, "dpi", 150, 36, 300));
  const doc = await openPdfjs(f, str(fd, "password"));
  const name = baseName(f.name);
  const results = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const canvas = await renderPage(page, dpi / 72);
      const bytes = await canvasBytes(canvas, fmt === "jpg" ? "image/jpeg" : "image/png", 0.9);
      results.push([`${name}_${i}.${fmt}`, bytes]);
      canvas.width = canvas.height = 0; // free memory early
      page.cleanup();
    }
  } finally {
    closePdfjs(doc);
  }
  return sendResults(results, `${name}_images.zip`);
}

// ---------- edit ----------

async function rotate(fd) {
  const angle = parseInt(str(fd, "angle", "90"), 10);
  if (![90, 180, 270].includes(angle)) throw new ToolError("Rotation must be 90, 180 or 270 degrees.");
  return forEachPdf(fd, "rotated", async (doc) => {
    for (const page of doc.getPages()) page.setRotation(degrees((pageRotation(page) + angle) % 360));
    return save(doc);
  });
}

async function watermark(fd) {
  const text = str(fd, "text").trim();
  if (!text) throw new ToolError("Enter the watermark text.");
  const position = str(fd, "position", "diagonal");
  if (!["center", "diagonal", "tiled", "top", "bottom"].includes(position)) throw new ToolError("Unknown watermark position.");
  const size = num(fd, "size", 60, 8, 200);
  const opacity = num(fd, "opacity", 30, 5, 100) / 100;
  const color = hexColor(str(fd, "color", "#e0443a"));

  return forEachPdf(fd, "watermarked", async (doc) => {
    const font = await embedFont(doc, StandardFonts.HelveticaBold, text);
    const unit = font.widthOfTextAtSize(text, 1) || 1; // text width at size 1
    drawOverlays(doc, (page, w, h) => {
      const opts = { font, color, opacity };
      if (position === "center" || position === "top" || position === "bottom") {
        const s = Math.min(size, (w * 0.9) / unit);
        const y = { center: h / 2 - s * 0.35, top: h - 15 * MM - s * 0.7, bottom: 15 * MM }[position];
        page.drawText(text, { ...opts, size: s, x: w / 2 - (unit * s) / 2, y });
      } else if (position === "diagonal") {
        const s = Math.min(size, (Math.hypot(w, h) * 0.8) / unit);
        const a = Math.atan2(h, w), cos = Math.cos(a), sin = Math.sin(a);
        const half = (unit * s) / 2, drop = s * 0.35;
        page.drawText(text, {
          ...opts, size: s, rotate: degrees((a * 180) / Math.PI),
          x: w / 2 - half * cos + drop * sin, y: h / 2 - half * sin - drop * cos,
        });
      } else {
        const a = (35 * Math.PI) / 180;
        page.pushOperators(pushGraphicsState(),
          concatTransformationMatrix(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), w / 2, h / 2));
        const stepX = unit * size + size * 2, stepY = size * 4;
        const reach = Math.hypot(w, h) / 2 + stepX;
        for (let y = -reach, row = 0; y <= reach; y += stepY, row++) {
          for (let x = -reach + ((row % 2) * stepX) / 2; x <= reach; x += stepX) {
            page.drawText(text, { ...opts, size, x: x - (unit * size) / 2, y });
          }
        }
        page.pushOperators(popGraphicsState());
      }
    });
    return save(doc);
  });
}

async function pageNumbers(fd) {
  const [vpos, hpos] = str(fd, "position", "bottom-center").split("-");
  if (!["top", "bottom"].includes(vpos) || !["left", "center", "right"].includes(hpos)) throw new ToolError("Unknown position.");
  const template = PAGE_NUMBER_FORMATS[str(fd, "format", "n")];
  if (!template) throw new ToolError("Unknown number format.");
  const start = Math.round(num(fd, "start", 1, 0, 100000));
  const size = num(fd, "size", 11, 6, 48);
  const skipFirst = flag(fd, "skip_first");
  const margin = 12 * MM;
  const color = rgb(0x22 / 255, 0x22 / 255, 0x22 / 255);

  return forEachPdf(fd, "numbered", async (doc) => {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    drawOverlays(doc, (page, w, h, i, n) => {
      if (skipFirst && i === 0) return;
      const offset = skipFirst ? 1 : 0;
      const label = template.replace("{n}", start + i - offset).replace("{total}", start + n - offset - 1);
      const tw = font.widthOfTextAtSize(label, size);
      const y = vpos === "bottom" ? margin : h - margin - size * 0.7;
      const x = hpos === "left" ? margin : hpos === "right" ? w - margin - tw : w / 2 - tw / 2;
      page.drawText(label, { font, size, color, x, y });
    });
    return save(doc);
  });
}

async function crop(fd) {
  const visual = ["top", "right", "bottom", "left"].map((k) => num(fd, k, 0, 0, 500) * MM);
  if (!visual.some(Boolean)) throw new ToolError("Set at least one margin to crop.");
  return forEachPdf(fd, "cropped", async (doc) => {
    for (const page of doc.getPages()) {
      const { x, y, width, height } = page.getCropBox();
      const k = pageRotation(page) / 90;
      // Map the on-screen sides onto the unrotated page's sides.
      const [top, right, bottom, left] = [0, 1, 2, 3].map((i) => visual[(i + k) % 4]);
      const w = width - left - right, h = height - top - bottom;
      if (w < 36 || h < 36) throw new ToolError("Those margins are larger than the page. Use smaller values.");
      page.setCropBox(x + left, y + bottom, w, h);
    }
    return save(doc);
  });
}

async function metadata(fd) {
  const removeAll = flag(fd, "remove_all");
  const fields = {
    Title: str(fd, "title").trim(), Author: str(fd, "author").trim(),
    Subject: str(fd, "subject").trim(), Keywords: str(fd, "keywords").trim(),
  };
  return forEachPdf(fd, removeAll ? "cleaned" : "edited", async (doc) => {
    // Drop the XMP packet so the document info dictionary is the single source of truth.
    doc.catalog.delete(PDFName.of("Metadata"));
    if (removeAll) {
      doc.context.trailerInfo.Info = doc.context.register(doc.context.obj({}));
      return save(doc);
    }
    const info = doc.getInfoDict();
    for (const [key, value] of Object.entries(fields)) {
      if (value) doc[`set${key}`](key === "Keywords" ? [value] : value);
      else info.delete(PDFName.of(key));
    }
    return save(doc);
  });
}

// ---------- router ----------

const ROUTES = {
  "/api/inspect": inspect,
  "/api/thumbnails": thumbnails,
  "/api/unlock": unlock,
  "/api/protect": protect,
  "/api/merge": merge,
  "/api/split": split,
  "/api/extract": extract,
  "/api/organize": organize,
  "/api/compress": compress,
  "/api/repair": repair,
  "/api/images-to-pdf": imagesToPdf,
  "/api/pdf-to-image": pdfToImage,
  "/api/rotate": rotate,
  "/api/watermark": watermark,
  "/api/page-numbers": pageNumbers,
  "/api/crop": crop,
  "/api/metadata": metadata,
};

export async function handle(url, fd) {
  const route = ROUTES[url];
  if (!route) return json({ error: "Unknown tool." }, 404);
  try {
    return await route(fd);
  } catch (e) {
    if (e instanceof ToolError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: "Something went wrong while processing the file." }, 500);
  }
}
