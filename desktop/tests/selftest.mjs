// Self-test that runs INSIDE the desktop app's web view (only in test builds):
// exercises every tool through the local engine and reports back to Rust.
import { handle } from "./engine/engine.mjs";
import { PDFDocument, StandardFonts, degrees } from "./vendor/pdf-lib.esm.min.js";
import { unzipSync } from "./vendor/fflate.mjs";

const report = { userAgent: navigator.userAgent, tauri: !!window.__TAURI__?.core?.invoke, results: [] };
const check = (name, ok, detail = "") => report.results.push({ name, ok: !!ok, detail: String(detail) });

async function makePdf(pages = 10, { rotateSecond = false, withPhoto = false } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(String(i + 1), { x: 250, y: 350, size: 120, font });
  }
  if (rotateSecond) doc.getPage(1).setRotation(degrees(90));
  if (withPhoto) {
    const c = document.createElement("canvas");
    c.width = 2400; c.height = 3000;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 90 + ((i / 4) % c.width) / 20) | 0;
      img.data[i] = v; img.data[i + 1] = v + 30; img.data[i + 2] = 200 - v / 2; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const jpg = new Uint8Array(await (await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95))).arrayBuffer());
    const image = await doc.embedJpg(jpg);
    doc.getPage(0).drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  }
  return doc.save();
}

const asFile = (bytes, name, type = "application/pdf") => new File([bytes], name, { type });

async function call(url, fields, files) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields || {})) fd.append(k, v);
  for (const f of files) fd.append("files", f);
  const t = performance.now();
  const res = await handle(url, fd);
  const ms = Math.round(performance.now() - t);
  const isJson = (res.headers.get("Content-Type") || "").includes("json");
  const body = isJson ? await res.json() : new Uint8Array(await (await res.blob()).arrayBuffer());
  const name = decodeURIComponent((res.headers.get("Content-Disposition") || "").split("''")[1] || "");
  return { status: res.status, name, body, ms };
}
const pagesOf = async (bytes) => (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();

async function runEngine() {
  const ten = await makePdf(10);
  const tenRot = await makePdf(10, { rotateSecond: true });
  const photo = await makePdf(1, { withPhoto: true });

  let r = await call("/api/inspect", {}, [asFile(tenRot, "a.pdf")]);
  check("inspect", r.status === 200 && r.body.files[0].pages === 10, JSON.stringify(r.body.files[0].size));

  r = await call("/api/thumbnails", { width: 180 }, [asFile(tenRot, "a.pdf")]);
  check("thumbnails", r.status === 200 && r.body.pages.length === 10 && r.body.sizes[1][0] === 792, `${r.ms}ms sizes[1]=${r.body.sizes?.[1]}`);

  r = await call("/api/protect", { new_password: "secret" }, [asFile(ten, "a.pdf")]);
  const locked = r.body;
  let loadsWithoutPw = true;
  try { await PDFDocument.load(locked); } catch (_) { loadsWithoutPw = false; }
  check("protect (AES-256)", r.status === 200 && !loadsWithoutPw, `${r.ms}ms ${r.name}`);

  r = await call("/api/inspect", {}, [asFile(locked, "locked.pdf")]);
  check("inspect encrypted", r.body.files?.[0]?.encrypted === true);

  r = await call("/api/unlock", { password: "wrong" }, [asFile(locked, "locked.pdf")]);
  check("unlock wrong password rejected", r.status === 400, r.body.error);
  r = await call("/api/unlock", { password: "secret" }, [asFile(locked, "locked.pdf")]);
  check("unlock", r.status === 200 && (await pagesOf(r.body)) === 10, `${r.ms}ms`);

  r = await call("/api/protect", { block_print: "1", block_copy: "1" }, [asFile(ten, "a.pdf")]);
  const restricted = r.body;
  r = await call("/api/inspect", {}, [asFile(restricted, "r.pdf")]);
  check("restrictions-only file opens without password", r.body.files?.[0]?.encrypted === false && r.body.files[0].pages === 10);

  r = await call("/api/merge", { password: "secret" }, [asFile(ten, "a.pdf"), asFile(locked, "b.pdf")]);
  check("merge (incl. protected file)", r.status === 200 && (await pagesOf(r.body)) === 20, `${r.ms}ms`);

  r = await call("/api/split", { mode: "all" }, [asFile(ten, "a.pdf")]);
  check("split", r.status === 200 && Object.keys(unzipSync(r.body)).length === 10, r.name);

  r = await call("/api/extract", { pages: "2,4,7" }, [asFile(ten, "a.pdf")]);
  check("select pages", r.status === 200 && (await pagesOf(r.body)) === 3);

  r = await call("/api/organize", { plan: JSON.stringify([{ page: 3 }, { blank: true }, { page: 1, rotate: 90 }]) }, [asFile(ten, "a.pdf")]);
  const org = await PDFDocument.load(r.body);
  check("organize", r.status === 200 && org.getPageCount() === 3 && org.getPage(2).getRotation().angle === 90);

  for (const level of ["low", "recommended", "extreme"]) {
    r = await call("/api/compress", { level }, [asFile(photo, "photo.pdf")]);
    check(`compress ${level}`, r.status === 200 && r.body.length <= photo.length, `${photo.length} -> ${r.body.length} bytes, ${r.ms}ms`);
  }

  r = await call("/api/repair", {}, [asFile(ten, "a.pdf")]);
  check("repair", r.status === 200 && (await pagesOf(r.body)) === 10);

  const c = document.createElement("canvas");
  c.width = 200; c.height = 300;
  c.getContext("2d").fillRect(0, 0, 100, 100);
  const png = new Uint8Array(await (await new Promise((res) => c.toBlob(res, "image/png"))).arrayBuffer());
  const webp = await new Promise((res) => c.toBlob(res, "image/webp"));
  r = await call("/api/images-to-pdf", {}, [asFile(png, "a.png", "image/png"), new File([webp], "b.webp", { type: webp.type })]);
  check("JPG/PNG/WebP to PDF", r.status === 200 && (await pagesOf(r.body)) === 2, r.body.error || `webp encoded as ${webp.type}`);

  r = await call("/api/pdf-to-image", { format: "jpg", dpi: "150" }, [asFile(tenRot, "a.pdf")]);
  const imgs = r.status === 200 ? unzipSync(r.body) : {};
  const first = Object.values(imgs)[0];
  check("PDF to JPG", Object.keys(imgs).length === 10 && first?.[0] === 0xff && first?.[1] === 0xd8, `${r.ms}ms`);

  r = await call("/api/rotate", { angle: "90" }, [asFile(ten, "a.pdf"), asFile(tenRot, "b.pdf")]);
  check("rotate (batch)", r.status === 200 && Object.keys(unzipSync(r.body)).length === 2);

  r = await call("/api/watermark", { text: "CONFIDENTIAL", position: "tiled" }, [asFile(tenRot, "a.pdf")]);
  check("watermark", r.status === 200 && (await pagesOf(r.body)) === 10, `${r.ms}ms`);

  r = await call("/api/page-numbers", { format: "page_n_of", position: "bottom-right" }, [asFile(tenRot, "a.pdf")]);
  check("page numbers", r.status === 200);

  r = await call("/api/crop", { top: "20" }, [asFile(ten, "a.pdf")]);
  const cropped = await PDFDocument.load(r.body);
  check("crop", Math.round(cropped.getPage(0).getCropBox().height) === Math.round(792 - 20 * 72 / 25.4));

  r = await call("/api/metadata", { title: "Hello", author: "Me" }, [asFile(ten, "a.pdf")]);
  check("metadata", (await PDFDocument.load(r.body, { updateMetadata: false })).getTitle() === "Hello");
}

const errors = [];
window.addEventListener("error", (e) => errors.push(e.message));
window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { for (let t = 0; t < ms; t += 100) { if (fn()) return true; await wait(100); } return false; };

// Drive the real interface (app.js globals) the way a user would.
async function runUi() {
  check("UI: home shows 15 tools", document.querySelectorAll("#toolGrid .tool").length === 15);
  check("UI: web-only Download button hidden in app", getComputedStyle(document.getElementById("getAppBtn")).display === "none");
  document.getElementById("menuBtn").click();
  check("UI: All tools menu opens", !document.getElementById("megaMenu").hidden);
  toggleMenu(false);

  location.hash = "watermark";
  await wait(200);
  await addFiles([asFile(await makePdf(3, { rotateSecond: true }), "report.pdf")]);
  const previewOk = await until(() => document.getElementById("pvImg")?.naturalWidth > 0 && document.querySelector("#pvLayer .pv-text"));
  check("UI: watermark live preview", previewOk);
  await run();
  check("UI: watermark result ready", await until(() => !document.getElementById("stepDone").hidden), document.getElementById("doneMeta").textContent);
  check("UI: continue-with chips", document.querySelectorAll("#continueList button").length === 13);

  document.querySelector('#continueList [data-id="organize"]').click();
  check("UI: organize page grid", await until(() => document.querySelectorAll("#pageGrid .org-page").length === 3));

  location.hash = "compress";
  await wait(200);
  await addFiles([asFile(await makePdf(1, { withPhoto: true }), "scan.pdf")]);
  await run();
  check("UI: compress result", await until(() => !document.getElementById("stepDone").hidden), document.getElementById("doneMeta").textContent);
  // New in 3.0.1: file views, expanded preview, password asked up front.
  location.hash = "merge";
  await wait(200);
  await addFiles([asFile(await makePdf(4), "a.pdf"), asFile(await makePdf(2), "b.pdf")]);
  await until(() => document.querySelectorAll("#fileList .file-row").length === 2 || document.querySelectorAll("#fileList .file-card").length === 2);
  document.querySelector('[data-view="grid"]').click();
  check("UI: grid view thumbnails", await until(() => document.querySelectorAll(".file-thumb img").length === 2, 20000));

  document.querySelector('[data-expand="1"]').click();
  check("UI: expanded preview opens", await until(() => document.getElementById("pvFull").naturalWidth > 400, 20000), document.getElementById("pvCount").textContent);
  document.getElementById("pvNext").click();
  check("UI: preview page navigation", await until(() => document.getElementById("pvCount").textContent === "Page 2 of 2", 20000));
  closePreview();

  document.querySelector('input[name="protect_result"]').click();
  document.getElementById("resultPw").value = "pw1234";
  document.getElementById("resultPw2").value = "nope";
  await run();
  check("UI: mismatched result passwords rejected", document.getElementById("errorMsg").textContent.includes("don't match"));
  document.getElementById("resultPw2").value = "pw1234";
  await run();
  const ready = await until(() => !document.getElementById("stepDone").hidden, 30000);
  let opensWithoutPw = true;
  try { await PDFDocument.load(new Uint8Array(await result.blob.arrayBuffer())); } catch (_) { opensWithoutPw = false; }
  check("UI: result protected with the password asked up front", ready && !opensWithoutPw, document.getElementById("doneMeta").textContent);
  check("UI: no password box on the result screen", !document.getElementById("protectBox"));

  check("UI: no JavaScript errors", errors.length === 0, errors.join(" | "));
}

try {
  await runEngine();
  await runUi();
} catch (e) {
  check("self-test crashed", false, `${e?.message}\n${e?.stack}`);
}
report.passed = report.results.filter((x) => x.ok).length;
report.total = report.results.length;
const bytes = new TextEncoder().encode(JSON.stringify(report, null, 2));
await window.__TAURI__.core.invoke("selftest_report", bytes);
