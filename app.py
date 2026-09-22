"""PDFKit — a small iLovePDF-style PDF toolbox.

Everything is processed in memory; uploaded files are never written to disk.
"""
import base64
import io
import os
import re
import zipfile

import pikepdf
import pypdfium2 as pdfium
from flask import Flask, jsonify, render_template, request, send_file
from PIL import Image

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # 200 MB per request
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0  # always serve the latest JS/CSS
THUMB_WIDTH = 180  # px, page-picker previews


class ToolError(Exception):
    """An error whose message is safe to show to the user."""


# ---------- helpers ----------

def base_name(filename):
    name = os.path.splitext(os.path.basename(filename or "document"))[0]
    return re.sub(r"[^\w\-. ]", "_", name) or "document"


def pdf_files():
    files = [f for f in request.files.getlist("files") if f and f.filename]
    if not files:
        raise ToolError("Please upload a PDF file.")
    return files


def open_pdf(file_storage, password=""):
    data = file_storage.read()
    try:
        return pikepdf.open(io.BytesIO(data), password=password or "")
    except pikepdf.PasswordError:
        if password:
            raise ToolError("Incorrect password. Please try again.")
        raise ToolError(f"'{file_storage.filename}' is password-protected. Unlock it first with the Unlock PDF tool.")
    except pikepdf.PdfError:
        raise ToolError(f"'{file_storage.filename}' is not a valid PDF file.")


def form_password():
    return request.form.get("password", "")


def pdf_response(pdf, filename, **save_kwargs):
    out = io.BytesIO()
    pdf.save(out, **save_kwargs)
    out.seek(0)
    return send_file(out, mimetype="application/pdf", as_attachment=True, download_name=filename)


def parse_ranges(spec, page_count):
    """'1-3, 5, 8-' -> [[0,1,2],[4],[7..end]] (0-based page indices)."""
    groups = []
    for part in (spec or "").split(","):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r"(\d*)\s*-\s*(\d*)|(\d+)", part)
        if not m:
            raise ToolError(f"Couldn't understand page range '{part}'. Use e.g. 1-3, 5, 8-10.")
        if m.group(3):
            start = end = int(m.group(3))
        else:
            start = int(m.group(1) or 1)
            end = int(m.group(2) or page_count)
        if start < 1 or end > page_count or start > end:
            raise ToolError(f"Range '{part}' is outside the document (1–{page_count}).")
        groups.append(list(range(start - 1, end)))
    if not groups:
        raise ToolError("Enter at least one page range.")
    return groups


# ---------- routes ----------

@app.errorhandler(ToolError)
def handle_tool_error(err):
    return jsonify(error=str(err)), 400


@app.errorhandler(413)
def handle_too_large(_err):
    return jsonify(error="File is too large (limit is 200 MB)."), 413


@app.route("/")
def index():
    return render_template("index.html")


@app.post("/api/inspect")
def inspect():
    """Tell the UI whether a PDF is encrypted and how many pages it has."""
    f = pdf_files()[0]
    data = f.read()
    try:
        with pikepdf.open(io.BytesIO(data)) as pdf:
            return jsonify(encrypted=pdf.is_encrypted, pages=len(pdf.pages))
    except pikepdf.PasswordError:
        return jsonify(encrypted=True, pages=None)
    except pikepdf.PdfError:
        raise ToolError(f"'{f.filename}' is not a valid PDF file.")


@app.post("/api/unlock")
def unlock():
    f = pdf_files()[0]
    pdf = open_pdf(f, request.form.get("password", ""))
    return pdf_response(pdf, f"{base_name(f.filename)}_unlocked.pdf", encryption=False)


@app.post("/api/protect")
def protect():
    """Set a password, or change the password of an already-encrypted PDF.

    Also accepts a ZIP of PDFs (e.g. a Split result) and protects every PDF inside it.
    """
    f = pdf_files()[0]
    new_password = request.form.get("new_password", "")
    if not new_password:
        raise ToolError("Enter the new password.")
    enc = pikepdf.Encryption(user=new_password, owner=new_password, R=6)  # AES-256
    name = base_name(f.filename)

    if f.filename.lower().endswith(".zip"):
        try:
            src = zipfile.ZipFile(io.BytesIO(f.read()))
        except zipfile.BadZipFile:
            raise ToolError("That ZIP file is damaged.")
        buf = io.BytesIO()
        with src, zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as dst:
            for item in src.infolist():
                data = src.read(item)
                if item.filename.lower().endswith(".pdf"):
                    with pikepdf.open(io.BytesIO(data)) as pdf:
                        out = io.BytesIO()
                        pdf.save(out, encryption=enc)
                        data = out.getvalue()
                dst.writestr(item.filename, data)
        buf.seek(0)
        return send_file(buf, mimetype="application/zip", as_attachment=True, download_name=f"{name}_protected.zip")

    pdf = open_pdf(f, form_password())
    return pdf_response(pdf, f"{name}_protected.pdf", encryption=enc)


@app.post("/api/thumbnails")
def thumbnails():
    """Render small JPEG previews of every page (for the page picker)."""
    f = pdf_files()[0]
    data = f.read()
    try:
        doc = pdfium.PdfDocument(data, password=form_password() or None)
    except pdfium.PdfiumError:
        if form_password():
            raise ToolError("Incorrect password. Please try again.")
        raise ToolError(f"Couldn't open '{f.filename}'. Is it a password-protected or damaged PDF?")
    pages = []
    try:
        for page in doc:
            width = page.get_width() or 1
            img = page.render(scale=THUMB_WIDTH / width).to_pil().convert("RGB")
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=70)
            pages.append("data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode())
            page.close()
    finally:
        doc.close()
    return jsonify(pages=pages)


@app.post("/api/extract")
def extract():
    """Build a new PDF from the chosen pages, in the order given (e.g. '2,4,7')."""
    f = pdf_files()[0]
    pdf = open_pdf(f, form_password())
    n = len(pdf.pages)
    try:
        chosen = [int(x) for x in re.split(r"[\s,]+", request.form.get("pages", "").strip()) if x]
    except ValueError:
        raise ToolError("Pages must be numbers, e.g. 2, 4, 7.")
    if not chosen:
        raise ToolError("Select at least one page.")
    bad = [p for p in chosen if p < 1 or p > n]
    if bad:
        raise ToolError(f"Page {bad[0]} doesn't exist (this PDF has {n} pages).")
    out = pikepdf.new()
    for p in chosen:
        out.pages.append(pdf.pages[p - 1])
    return pdf_response(out, f"{base_name(f.filename)}_pages.pdf")


@app.post("/api/merge")
def merge():
    files = pdf_files()
    if len(files) < 2:
        raise ToolError("Add at least two PDFs to merge.")
    out = pikepdf.new()
    for f in files:
        src = open_pdf(f)
        out.pages.extend(src.pages)
    return pdf_response(out, "merged.pdf")


@app.post("/api/split")
def split():
    f = pdf_files()[0]
    pdf = open_pdf(f, form_password())
    name = base_name(f.filename)
    n = len(pdf.pages)
    mode = request.form.get("mode", "all")
    groups = [[i] for i in range(n)] if mode == "all" else parse_ranges(request.form.get("ranges"), n)

    if len(groups) == 1:
        part = pikepdf.new()
        part.pages.extend(pdf.pages[i] for i in groups[0])
        return pdf_response(part, f"{name}_pages.pdf")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for g in groups:
            part = pikepdf.new()
            part.pages.extend(pdf.pages[i] for i in g)
            label = f"{g[0] + 1}" if len(g) == 1 else f"{g[0] + 1}-{g[-1] + 1}"
            pbuf = io.BytesIO()
            part.save(pbuf)
            zf.writestr(f"{name}_{label}.pdf", pbuf.getvalue())
    buf.seek(0)
    return send_file(buf, mimetype="application/zip", as_attachment=True, download_name=f"{name}_split.zip")


@app.post("/api/rotate")
def rotate():
    f = pdf_files()[0]
    angle = int(request.form.get("angle", 90))
    if angle not in (90, 180, 270):
        raise ToolError("Rotation must be 90, 180 or 270 degrees.")
    pdf = open_pdf(f, form_password())
    for page in pdf.pages:
        page.rotate(angle, relative=True)
    return pdf_response(pdf, f"{base_name(f.filename)}_rotated.pdf")


@app.post("/api/compress")
def compress():
    f = pdf_files()[0]
    pdf = open_pdf(f, form_password())
    pdf.remove_unreferenced_resources()
    return pdf_response(
        pdf,
        f"{base_name(f.filename)}_compressed.pdf",
        compress_streams=True,
        recompress_flate=True,
        object_stream_mode=pikepdf.ObjectStreamMode.generate,
    )


@app.post("/api/images-to-pdf")
def images_to_pdf():
    files = [f for f in request.files.getlist("files") if f and f.filename]
    if not files:
        raise ToolError("Please upload at least one image.")
    images = []
    for f in files:
        try:
            img = Image.open(f.stream)
            img.load()
        except Exception:
            raise ToolError(f"'{f.filename}' is not a supported image.")
        images.append(img.convert("RGB"))
    out = io.BytesIO()
    images[0].save(out, format="PDF", save_all=True, append_images=images[1:], resolution=100.0)
    out.seek(0)
    name = base_name(files[0].filename) if len(files) == 1 else "images"
    return send_file(out, mimetype="application/pdf", as_attachment=True, download_name=f"{name}.pdf")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    print(f"\n  PDFKit running at http://127.0.0.1:{port}\n")
    app.run(host="127.0.0.1", port=port, debug=False)
