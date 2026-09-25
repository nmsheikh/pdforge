// Self-test that runs INSIDE the desktop app's web view (only in test builds):
// exercises every tool through the local engine and reports back to Rust.
import { handle } from "./engine/engine.mjs";
import { PDFDocument, StandardFonts, degrees } from "./vendor/pdf-lib.esm.min.js";
import { unzipSync } from "./vendor/fflate.mjs";
import * as pdfjs from "./vendor/pdf.min.mjs";

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

// A photo/scan with a printed date, optionally sideways - for the arrange-by-date OCR test.
async function makeDatedImage(dateText, rotateDeg = 0, bodyText = "") {
  const w = 400, h = 300;
  const c = document.createElement("canvas");
  c.width = rotateDeg % 180 ? h : w;
  c.height = rotateDeg % 180 ? w : h;
  const ctx = c.getContext("2d");
  ctx.save();
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotateDeg * Math.PI) / 180);
  ctx.fillStyle = "#fff";
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = "#000";
  ctx.font = "bold 32px sans-serif";
  ctx.fillText(dateText, -w / 2 + 20, -h / 2 + 60);
  if (bodyText) {
    ctx.font = "20px sans-serif";
    ctx.fillText(bodyText, -w / 2 + 20, -h / 2 + 110);
  }
  ctx.restore();
  return new Uint8Array(await (await new Promise((r) => c.toBlob(r, "image/png"))).arrayBuffer());
}

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

  r = await call("/api/split", { mode: "all" }, [asFile(await makePdf(1), "one.pdf")]);
  check("split refuses a one-page PDF", r.status === 400, r.body.error);
  r = await call("/api/extract", { pages: "1" }, [asFile(await makePdf(1), "one.pdf")]);
  check("select pages refuses a one-page PDF", r.status === 400, r.body.error);
  r = await call("/api/unlock", {}, [asFile(ten, "open.pdf")]);
  check("unlock refuses a PDF with no password", r.status === 400, r.body.error);

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

  // Mixed PDF + images, out of order, one sideways, one with no date at all.
  const datedPdf = await PDFDocument.create();
  const dpFont = await datedPdf.embedFont(StandardFonts.HelveticaBold);
  datedPdf.addPage([400, 300]).drawText("2 January 2026", { x: 20, y: 240, size: 28, font: dpFont });
  r = await call("/api/arrange-by-date", {}, [
    asFile(await datedPdf.save(), "b.pdf", "application/pdf"),
    asFile(await makeDatedImage("1 January 2026"), "a.png", "image/png"),
    asFile(await makeDatedImage("3 January 2026", 90), "c.png", "image/png"), // sideways
    asFile(await makeDatedImage(""), "d.png", "image/png"), // no date -> should still appear, at the end
  ]);
  const arranged = r.status === 200 ? await PDFDocument.load(r.body) : null;
  check("arrange by date: all pages kept, none dropped", arranged?.getPageCount() === 4, `${r.ms}ms ${r.body?.error || ""}`);
  check("arrange by date: sideways page straightened", arranged && arranged.getPage(2).getWidth() < arranged.getPage(2).getHeight());
  if (arranged) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
    const raster = await pdfjs.getDocument({ data: await arranged.save() }).promise;
    const worker = await (await import("./vendor/tesseract.esm.min.js")).default.createWorker("eng", 1, {
      workerPath: new URL("./vendor/tesseract-worker.min.js", import.meta.url).href,
      corePath: new URL("./vendor/tesseract-core-simd-lstm.js", import.meta.url).href,
      langPath: new URL("./vendor/", import.meta.url).href,
      cacheMethod: "none", gzip: true, workerBlobURL: false, logger: () => {},
    });
    const read = [];
    for (let i = 1; i <= 3; i++) {
      const page = await raster.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport }).promise;
      read.push((await worker.recognize(canvas)).data.text);
    }
    await worker.terminate();
    check("arrange by date: chronological order", /1 January/.test(read[0]) && /2 January/.test(read[1]) && /3 January/.test(read[2]), read.join(" | "));
  }

  // Medical bills: classification (keyword matching), the not-medical filter,
  // flagging of the unrecognizable page, and date-then-visit-order sorting once
  // the user fills in the flagged one.
  r = await call("/api/analyze-medical-bills", {}, [
    asFile(await makeDatedImage("12-01-2026", 0, "Dr. Smith Clinic - Consultation fee"), "doctor.png", "image/png"),
    asFile(await makeDatedImage("12-01-2026", 0, "Prescription - Rx - take as directed"), "rx.png", "image/png"),
    asFile(await makeDatedImage("12-01-2026", 0, "City Pharmacy - Tablet Capsule MRP"), "meds.png", "image/png"),
    asFile(await makeDatedImage("10-01-2026", 0, "Dr. Jones Clinic - Consultation fee"), "earlier-doctor.png", "image/png"),
    asFile(await makeDatedImage("", 0, "random unrelated receipt text"), "unknown.png", "image/png"), // no date, no medical signal at all
  ]);
  const analysis = r.status === 200 ? r.body : null;
  check("medical bills: analyze runs", r.status === 200 && analysis?.units?.length === 5, `${r.ms}ms ${r.body?.error || ""}`);
  if (analysis) {
    const [doctor, rx, meds, earlierDoctor, unknown] = analysis.units;
    check("medical bills: classifies doctor bill", doctor.type === "doctor", doctor.type);
    check("medical bills: classifies prescription", rx.type === "prescription", rx.type);
    check("medical bills: classifies medicine bill", meds.type === "medicine", meds.type);
    check("medical bills: filters out a non-medical file (not just 'other')", unknown.type === "not-medical" && !unknown.date,
      `type=${unknown.type} date=${unknown.date}`);
    check("medical bills: non-medical file gets no extracted fields", !unknown.doctorName && !unknown.billNumber && !unknown.amount,
      JSON.stringify({ doctorName: unknown.doctorName, billNumber: unknown.billNumber, amount: unknown.amount }));

    const otherR = await call("/api/analyze-medical-bills", {}, [
      asFile(await makeDatedImage("12-01-2026", 0, "General Hospital records"), "vague.png", "image/png"),
    ]);
    check("medical bills: medical-but-unclear text is 'other', not filtered out",
      otherR.status === 200 && otherR.body.units[0].type === "other", otherR.body.units?.[0]?.type);

    // A resume mentioning a clinic/hospital in someone's work history must not
    // pass as a medical document just because it contains those words.
    const resumeR = await call("/api/analyze-medical-bills", {}, [
      asFile(await makeDatedImage("", 0, "Career objective: Work Experience at City Hospital Clinic"), "resume.png", "image/png"),
    ]);
    check("medical bills: a resume is filtered out even with clinic/hospital wording",
      resumeR.status === 200 && resumeR.body.units[0].type === "not-medical", resumeR.body.units?.[0]?.type);

    // Simulate the user filling in the flagged page during review, then finalize.
    const plan = analysis.units.map((u, i) => (i === 4 ? { ...u, date: "2026-01-11", type: "medicine" } : u));
    r = await call("/api/finalize-medical-bills", { plan: JSON.stringify(plan) }, [
      asFile(await makeDatedImage("12-01-2026", 0, "Dr. Smith Clinic - Consultation fee"), "doctor.png", "image/png"),
      asFile(await makeDatedImage("12-01-2026", 0, "Prescription - Rx - take as directed"), "rx.png", "image/png"),
      asFile(await makeDatedImage("12-01-2026", 0, "City Pharmacy - Tablet Capsule MRP"), "meds.png", "image/png"),
      asFile(await makeDatedImage("10-01-2026", 0, "Dr. Jones Clinic - Consultation fee"), "earlier-doctor.png", "image/png"),
      asFile(await makeDatedImage("", 0, "random unrelated receipt text"), "unknown.png", "image/png"),
    ]);
    const finalized = r.status === 200 ? r.body : null;
    check("medical bills: finalize runs", finalized && (await pagesOf(finalized)) === 5, `${r.ms}ms ${r.body?.error || ""}`);
    if (finalized) {
      // Expected order: 10 Jan (doctor), 11 Jan (the filled-in medicine page), then
      // 12 Jan doctor -> prescription -> medicine.
      const raster = await pdfjs.getDocument({ data: finalized }).promise;
      const worker = await (await import("./vendor/tesseract.esm.min.js")).default.createWorker("eng", 1, {
        workerPath: new URL("./vendor/tesseract-worker.min.js", import.meta.url).href,
        corePath: new URL("./vendor/tesseract-core-simd-lstm.js", import.meta.url).href,
        langPath: new URL("./vendor/", import.meta.url).href,
        cacheMethod: "none", gzip: true, workerBlobURL: false, logger: () => {},
      });
      const read = [];
      for (let i = 1; i <= 5; i++) {
        const page = await raster.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport }).promise;
        read.push((await worker.recognize(canvas)).data.text);
      }
      await worker.terminate();
      check("medical bills: date, then doctor -> prescription -> medicine order",
        /Jones/.test(read[0]) && /unrelated/.test(read[1]) && /Smith/.test(read[2]) && /Rx/.test(read[3]) && /Pharmacy/.test(read[4]),
        read.map((t) => t.replace(/\s+/g, " ").trim()).join(" || "));
    }
  }

  // Claims-data extraction: doctor name/qualification/bill number/facility/amount
  // pulled from a single richer bill, offline (no AI key set in this test).
  const claimBill = document.createElement("canvas");
  claimBill.width = 500; claimBill.height = 350;
  const cctx = claimBill.getContext("2d");
  cctx.fillStyle = "#fff"; cctx.fillRect(0, 0, 500, 350);
  cctx.fillStyle = "#000"; cctx.font = "22px sans-serif";
  ["Dr. Ramesh Kumar MBBS", "City Care Clinic", "12-01-2026", "Bill No: INV-4521", "Consultation Fee", "Total Rs. 850.00"]
    .forEach((line, i) => cctx.fillText(line, 20, 40 + i * 34));
  const claimBillBytes = new Uint8Array(await (await new Promise((res) => claimBill.toBlob(res, "image/png"))).arrayBuffer());
  r = await call("/api/analyze-medical-bills", {}, [asFile(claimBillBytes, "claim.png", "image/png")]);
  const claimUnit = r.status === 200 ? r.body.units[0] : null;
  check("claims data: doctor name has no 'Dr.' prefix baked in", claimUnit?.doctorName === "Ramesh Kumar", claimUnit?.doctorName);
  check("claims data: qualification", claimUnit?.qualification === "MBBS", claimUnit?.qualification);
  check("claims data: bill number", claimUnit?.billNumber === "INV-4521", claimUnit?.billNumber);
  check("claims data: facility", claimUnit?.facility === "City Care Clinic", claimUnit?.facility);
  check("claims data: amount", claimUnit?.amount === "850", claimUnit?.amount);

  // Regression checks for two real false-positives found on actual bills (not
  // synthetic text): "Bill Cum Receipt" (a document title, not a number) was
  // read as bill number "Cum"; "DRUGS"/"DRESSING" etc. (all-caps, common on
  // real bills) were read as "Dr" + a capitalized "name".
  const falsePosBill = document.createElement("canvas");
  falsePosBill.width = 500; falsePosBill.height = 200;
  const fctx = falsePosBill.getContext("2d");
  fctx.fillStyle = "#fff"; fctx.fillRect(0, 0, 500, 200);
  fctx.fillStyle = "#000"; fctx.font = "22px sans-serif";
  ["BILL CUM RECEIPT", "12-01-2026", "DRUGS / PRESCRIPTIONS", "Total Rs. 500.00"]
    .forEach((line, i) => fctx.fillText(line, 20, 30 + i * 34));
  const falsePosBytes = new Uint8Array(await (await new Promise((res) => falsePosBill.toBlob(res, "image/png"))).arrayBuffer());
  r = await call("/api/analyze-medical-bills", {}, [asFile(falsePosBytes, "falsepos.png", "image/png")]);
  const falsePosUnit = r.status === 200 ? r.body.units[0] : null;
  check("claims data: 'Bill Cum Receipt' title isn't read as a bill number",
    !falsePosUnit?.billNumber, falsePosUnit?.billNumber);
  check("claims data: 'DRUGS' isn't read as a doctor name",
    !falsePosUnit?.doctorName, falsePosUnit?.doctorName);
}

const errors = [];
window.addEventListener("error", (e) => errors.push(e.message));
window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { for (let t = 0; t < ms; t += 100) { if (fn()) return true; await wait(100); } return false; };

// Drive the real interface (app.js globals) the way a user would.
async function runUi() {
  check("UI: home shows 17 tools", document.querySelectorAll("#toolGrid .tool").length === 17);
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
  check("UI: result screen offers only the download", !document.getElementById("continueBox"));
  check("UI: controls use the icon set, not text glyphs",
    !/[\u2715\u2922\u2630\u25a6\u2039\u203a\u21ba\u21bb]/.test(document.body.innerText));

  location.hash = "organize";
  await wait(200);
  await addFiles([asFile(await makePdf(3), "pages.pdf")]);
  check("UI: organize page grid", await until(() => document.querySelectorAll("#pageGrid .org-page").length === 3, 20000));
  check("UI: organize controls are icons", document.querySelectorAll(".org-tools svg.ui").length >= 5);

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

  // Single-file tools refuse a multi-file drop instead of quietly using the first.
  location.hash = "split";
  await wait(250);
  await addFiles([asFile(await makePdf(4), "a.pdf"), asFile(await makePdf(4), "b.pdf")]);
  await wait(400);
  check("UI: single-file tool refuses two files", files.length === 0 && !document.getElementById("dzWarn").hidden,
    document.getElementById("dzWarn").textContent);
  await addFiles([asFile(await makePdf(4), "a.pdf")]);
  check("UI: single-file tool accepts one file", await until(() => files.length === 1 && !document.getElementById("stepOptions").hidden));

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
