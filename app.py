"""pdforge — a small iLovePDF-style PDF toolbox.

Everything is processed in memory; uploaded files are never written to disk.
"""
import base64
import io
import json
import math
import os
import re
import secrets
import time
import urllib.request
import zipfile

import pikepdf
import pypdfium2 as pdfium
from flask import Flask, abort, jsonify, redirect, render_template, request, send_file
from PIL import Image
from reportlab.lib.colors import HexColor
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as rl_canvas

app = Flask(__name__)
# Vercel's serverless functions accept and return at most 4.5 MB per request.
ON_VERCEL = bool(os.environ.get("VERCEL"))
MAX_UPLOAD_MB = 4 if ON_VERCEL else 200
MAX_RESULT_BYTES = int(4.4 * 1024 * 1024) if ON_VERCEL else None
app.config["MAX_CONTENT_LENGTH"] = int((MAX_UPLOAD_MB + 0.4) * 1024 * 1024)  # + room for form fields
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0  # always serve the latest JS/CSS
THUMB_WIDTH = 180  # px, page-picker previews
MM = 72 / 25.4  # points per millimetre

# Compress levels: (max image resolution in DPI, JPEG quality); None = structural only.
COMPRESS_LEVELS = {"low": None, "recommended": (150, 75), "extreme": (96, 50)}

PAGE_NUMBER_FORMATS = {
    "n": "{n}",
    "page_n": "Page {n}",
    "page_n_of": "Page {n} of {total}",
    "n_slash": "{n} / {total}",
}


class ToolError(Exception):
    """An error whose message is safe to show to the user."""


# ---------- request helpers ----------

def base_name(filename):
    name = os.path.splitext(os.path.basename(filename or "document"))[0]
    return re.sub(r"[^\w\-. ]", "_", name) or "document"


def pdf_files():
    files = [f for f in request.files.getlist("files") if f and f.filename]
    if not files:
        raise ToolError("Please upload a PDF file.")
    return files


def form_password():
    return request.form.get("password", "")


def form_float(name, default, lo, hi):
    try:
        value = float(request.form.get(name, default))
    except ValueError:
        raise ToolError(f"'{name}' must be a number.")
    return min(max(value, lo), hi)


def form_flag(name):
    return request.form.get(name) in ("1", "true", "on")


def open_pdf(file_storage, password=""):
    data = file_storage.read()
    file_storage.seek(0)
    try:
        return pikepdf.open(io.BytesIO(data), password=password or "")
    except pikepdf.PasswordError:
        if password:
            raise ToolError(f"Incorrect password for '{file_storage.filename}'.")
        raise ToolError(f"'{file_storage.filename}' is password-protected. Enter its password first.")
    except pikepdf.PdfError:
        raise ToolError(f"'{file_storage.filename}' is not a valid PDF file.")


# ---------- response helpers ----------

def pdf_bytes(pdf, **save_kwargs):
    out = io.BytesIO()
    pdf.save(out, **save_kwargs)
    return out.getvalue()


MIMETYPES = {".pdf": "application/pdf", ".zip": "application/zip", ".jpg": "image/jpeg", ".png": "image/png"}


def send_bytes(data, filename):
    if MAX_RESULT_BYTES and len(data) > MAX_RESULT_BYTES:
        raise ToolError(
            f"The result is {len(data) / 1048576:.1f} MB, more than the online version can send back "
            f"({MAX_UPLOAD_MB} MB). Try fewer pages or files, or run pdforge on your own computer."
        )
    mimetype = MIMETYPES.get(os.path.splitext(filename)[1].lower(), "application/octet-stream")
    return send_file(io.BytesIO(data), mimetype=mimetype, as_attachment=True, download_name=filename)


def send_results(results, zip_name):
    """One result -> that file. Several -> a ZIP (duplicate names get a suffix)."""
    if len(results) == 1:
        return send_bytes(results[0][1], results[0][0])
    buf = io.BytesIO()
    used = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in results:
            stem, ext = os.path.splitext(name)
            unique, i = name, 2
            while unique in used:
                unique, i = f"{stem} ({i}){ext}", i + 1
            used.add(unique)
            zf.writestr(unique, data)
    return send_bytes(buf.getvalue(), zip_name)


def for_each_pdf(suffix, process):
    """Batch helper: run process(pdf) -> bytes on every uploaded PDF and return the PDF(s)."""
    results = []
    for f in pdf_files():
        pdf = open_pdf(f, form_password())
        results.append((f"{base_name(f.filename)}_{suffix}.pdf", process(pdf)))
    return send_results(results, f"{suffix}.zip")


# ---------- page geometry ----------

def page_rotation(page):
    """Effective /Rotate of a page (it can be inherited from the page tree)."""
    node = page.obj
    while node is not None:
        if "/Rotate" in node:
            return int(node.Rotate) % 360
        node = node.get("/Parent")
    return 0


def page_box(page):
    return [float(v) for v in page.cropbox]


def visual_size(page):
    x0, y0, x1, y1 = page_box(page)
    w, h = x1 - x0, y1 - y0
    return (h, w) if page_rotation(page) in (90, 270) else (w, h)


def add_overlays(pdf, draw):
    """Draw on every page with reportlab, in the page's *visual* orientation.

    draw(canvas, visual_width, visual_height, page_index, page_count)
    """
    n = len(pdf.pages)
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf)
    for i, page in enumerate(pdf.pages):
        # add_overlay() counter-rotates the overlay for rotated pages, so we
        # simply draw on a canvas the size of the page as it appears on screen.
        vw, vh = visual_size(page)
        c.setPageSize((vw, vh))
        draw(c, vw, vh, i, n)
        c.showPage()
    c.save()
    overlay = pikepdf.open(io.BytesIO(buf.getvalue()))
    for page, ov in zip(pdf.pages, overlay.pages):
        page.add_overlay(ov, pikepdf.Rectangle(*page_box(page)))
    return pdf


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


# ---------- routes: general ----------

@app.errorhandler(ToolError)
def handle_tool_error(err):
    return jsonify(error=str(err)), 400


@app.errorhandler(413)
def handle_too_large(_err):
    return jsonify(error=f"Files are too large. The limit is {MAX_UPLOAD_MB} MB per upload."), 413


# ---------- desktop app downloads ----------

RELEASES = "https://github.com/nmsheikh/pdforge/releases"
RELEASES_PAGE = f"{RELEASES}/latest"
RELEASES_API = "https://api.github.com/repos/nmsheikh/pdforge/releases/latest"
# Bump this with each desktop release (desktop/package.json, tauri.conf.json, Cargo.toml).
APP_VERSION = "3.0.1"
# Installer file names produced by the GitHub Actions release build (Tauri).
DOWNLOAD_PATTERNS = {
    "mac-arm": r"_aarch64\.dmg$",
    "mac-intel": r"_x64\.dmg$",
    "windows": r"_x64-setup\.exe$",
    "linux": r"_amd64\.deb$",
}
DOWNLOAD_FILES = {
    "mac-arm": f"pdforge_{APP_VERSION}_aarch64.dmg",
    "mac-intel": f"pdforge_{APP_VERSION}_x64.dmg",
    "windows": f"pdforge_{APP_VERSION}_x64-setup.exe",
    "linux": f"pdforge_{APP_VERSION}_amd64.deb",
}
_release_cache = {"at": 0.0, "assets": []}


def latest_release_assets():
    """Asset list of the latest GitHub release, cached for 10 minutes."""
    if time.time() - _release_cache["at"] > 600:
        req = urllib.request.Request(RELEASES_API, headers={"User-Agent": "pdforge", "Accept": "application/vnd.github+json"})
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                _release_cache["assets"] = json.load(resp).get("assets", [])
            _release_cache["at"] = time.time()
        except Exception:
            _release_cache["at"] = time.time()  # don't retry on every request
    return _release_cache["assets"]


@app.get("/download/<platform>")
def download(platform):
    """Redirect to the newest installer for a platform (so links never go stale).

    GitHub's API is rate limited per IP and Vercel shares IPs, so fall back to
    the version this build knows about rather than dumping people on a file list.
    """
    pattern = DOWNLOAD_PATTERNS.get(platform)
    if not pattern:
        abort(404)
    for asset in latest_release_assets():
        if re.search(pattern, asset.get("name", "")):
            return redirect(asset["browser_download_url"])
    return redirect(f"{RELEASES}/download/v{APP_VERSION}/{DOWNLOAD_FILES[platform]}")


@app.route("/")
def index():
    return render_template("index.html", max_upload_mb=MAX_UPLOAD_MB, online=ON_VERCEL)


def read_metadata(pdf):
    info = pdf.docinfo
    keys = {"title": "/Title", "author": "/Author", "subject": "/Subject",
            "keywords": "/Keywords", "creator": "/Creator", "producer": "/Producer"}
    return {k: str(info[v]) if v in info else "" for k, v in keys.items()}


@app.post("/api/inspect")
def inspect():
    """Per file: encrypted?, page count, first-page size (points) and metadata."""
    out = []
    for f in pdf_files():
        try:
            with pikepdf.open(io.BytesIO(f.read())) as pdf:
                first = pdf.pages[0] if len(pdf.pages) else None
                out.append({
                    "encrypted": False,  # opened without a password (at most print/copy restrictions)
                    "pages": len(pdf.pages),
                    "size": visual_size(first) if first else None,
                    "metadata": read_metadata(pdf),
                })
        except pikepdf.PasswordError:
            out.append({"encrypted": True, "pages": None, "size": None, "metadata": None})
        except pikepdf.PdfError:
            raise ToolError(f"'{f.filename}' is not a valid PDF file.")
    return jsonify(files=out)


@app.post("/api/thumbnails")
def thumbnails():
    """Render JPEG previews of the pages (all, or the first `limit`).

    Also returns each page's on-screen size in points, so the UI can position
    previews (watermark, page numbers, crop) to scale.
    """
    f = pdf_files()[0]
    limit = int(request.form.get("limit") or 0)
    only = int(request.form.get("page") or 0)  # 1-based; 0 = from the first page
    width = int(form_float("width", THUMB_WIDTH, 60, 1400))
    try:
        doc = pdfium.PdfDocument(f.read(), password=form_password() or None)
    except pdfium.PdfiumError:
        if form_password():
            raise ToolError("Incorrect password. Please try again.")
        raise ToolError(f"Couldn't open '{f.filename}'. Is it a password-protected or damaged PDF?")
    pages, sizes = [], []
    total = len(doc)
    try:
        start = max(0, only - 1)
        count = min(start + limit, total) if limit else total
        for i in range(start, count):
            page = doc[i]
            w, h = page.get_size()  # already accounts for /Rotate
            img = page.render(scale=width / (w or 1)).to_pil().convert("RGB")
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=75)
            pages.append("data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode())
            sizes.append([round(w, 1), round(h, 1)])
            page.close()
    finally:
        doc.close()
    return jsonify(pages=pages, sizes=sizes, total=total)


# ---------- routes: security ----------

@app.post("/api/unlock")
def unlock():
    return for_each_pdf("unlocked", lambda pdf: pdf_bytes(pdf, encryption=False))


@app.post("/api/protect")
def protect():
    """Set or change a password, optionally restricting printing/copying/editing.

    Also accepts a ZIP of PDFs (e.g. a Split result) and protects every PDF inside it.
    """
    files = pdf_files()
    new_password = request.form.get("new_password", "")
    block_print, block_copy, block_edit = (form_flag(k) for k in ("block_print", "block_copy", "block_edit"))
    restricted = block_print or block_copy or block_edit
    if not new_password and not restricted:
        raise ToolError("Enter a new password, or choose something to restrict.")

    perms = pikepdf.Permissions(
        print_lowres=not block_print, print_highres=not block_print,
        extract=not block_copy, accessibility=True,
        modify_annotation=not block_edit, modify_assembly=not block_edit,
        modify_form=not block_edit, modify_other=not block_edit,
    )
    # With restrictions the owner password must differ from the open password,
    # otherwise opening the file with it would lift the restrictions.
    owner = secrets.token_urlsafe(24) if restricted else new_password
    enc = pikepdf.Encryption(user=new_password, owner=owner, R=6, allow=perms)  # AES-256

    results = []
    for f in files:
        name = base_name(f.filename)
        if f.filename.lower().endswith(".zip"):
            results.append((f"{name}_protected.zip", protect_zip(f.read(), enc)))
        else:
            pdf = open_pdf(f, form_password())
            results.append((f"{name}_protected.pdf", pdf_bytes(pdf, encryption=enc)))
    return send_results(results, "protected.zip")


def protect_zip(data, enc):
    try:
        src = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ToolError("That ZIP file is damaged.")
    buf = io.BytesIO()
    with src, zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            content = src.read(item)
            if item.filename.lower().endswith(".pdf"):
                with pikepdf.open(io.BytesIO(content)) as pdf:
                    content = pdf_bytes(pdf, encryption=enc)
            dst.writestr(item.filename, content)
    return buf.getvalue()


# ---------- routes: organize ----------

@app.post("/api/merge")
def merge():
    files = pdf_files()
    if len(files) < 2:
        raise ToolError("Add at least two PDFs to merge.")
    out = pikepdf.new()
    for f in files:
        out.pages.extend(open_pdf(f, form_password()).pages)
    return send_bytes(pdf_bytes(out), "merged.pdf")


@app.post("/api/split")
def split():
    f = pdf_files()[0]
    pdf = open_pdf(f, form_password())
    name = base_name(f.filename)
    n = len(pdf.pages)
    mode = request.form.get("mode", "all")
    groups = [[i] for i in range(n)] if mode == "all" else parse_ranges(request.form.get("ranges"), n)

    results = []
    for g in groups:
        part = pikepdf.new()
        part.pages.extend(pdf.pages[i] for i in g)
        label = f"{g[0] + 1}" if len(g) == 1 else f"{g[0] + 1}-{g[-1] + 1}"
        results.append((f"{name}_{label}.pdf", pdf_bytes(part)))
    if len(results) == 1:
        results = [(f"{name}_pages.pdf", results[0][1])]
    return send_results(results, f"{name}_split.zip")


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
    return send_bytes(pdf_bytes(out), f"{base_name(f.filename)}_pages.pdf")


@app.post("/api/organize")
def organize():
    """Rebuild a PDF from a page plan: [{"page": 3, "rotate": 90}, {"blank": true}, ...]."""
    f = pdf_files()[0]
    pdf = open_pdf(f, form_password())
    n = len(pdf.pages)
    try:
        plan = json.loads(request.form.get("plan", "[]"))
    except ValueError:
        raise ToolError("Invalid page plan.")
    if not isinstance(plan, list) or not plan:
        raise ToolError("The document needs at least one page.")

    blank_size = visual_size(pdf.pages[0]) if n else (612, 792)
    out = pikepdf.new()
    for item in plan:
        if item.get("blank"):
            out.add_blank_page(page_size=blank_size)
        else:
            num = int(item.get("page", 0))
            if not 1 <= num <= n:
                raise ToolError(f"Page {num} doesn't exist.")
            out.pages.append(pdf.pages[num - 1])
        rotate = int(item.get("rotate", 0)) % 360
        if rotate:
            out.pages[-1].rotate(rotate, relative=True)
    return send_bytes(pdf_bytes(out), f"{base_name(f.filename)}_organized.pdf")


# ---------- routes: optimize ----------

def shrink_image(obj, max_px, quality):
    """Downsample/recompress one image XObject in place if that makes it smaller."""
    if obj.get("/ImageMask") or "/Decode" in obj or int(obj.get("/BitsPerComponent", 8)) != 8:
        return
    pil = pikepdf.PdfImage(obj).as_pil_image()
    if pil.mode not in ("RGB", "L"):
        return
    w, h = pil.size
    scale = min(1.0, max_px / max(w, h))
    if scale < 1:
        pil = pil.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    buf = io.BytesIO()
    pil.save(buf, format="JPEG", quality=quality, optimize=True)
    data = buf.getvalue()
    if len(data) >= len(obj.read_raw_bytes()):
        return
    obj.write(data, filter=pikepdf.Name.DCTDecode)
    obj.Width, obj.Height = pil.size
    obj.ColorSpace = pikepdf.Name.DeviceRGB if pil.mode == "RGB" else pikepdf.Name.DeviceGray
    obj.BitsPerComponent = 8
    if "/DecodeParms" in obj:
        del obj.DecodeParms


def compress_pdf(pdf, level):
    settings = COMPRESS_LEVELS[level]
    if settings:
        dpi, quality = settings
        seen = set()
        for page in pdf.pages:
            max_px = int(max(visual_size(page)) / 72 * dpi)
            for img in page.images.values():
                if img.objgen in seen:
                    continue
                seen.add(img.objgen)
                try:
                    shrink_image(img, max_px, quality)
                except Exception:  # unusual image encodings are simply left alone
                    continue
    pdf.remove_unreferenced_resources()
    return pdf_bytes(
        pdf,
        compress_streams=True,
        recompress_flate=True,
        object_stream_mode=pikepdf.ObjectStreamMode.generate,
    )


@app.post("/api/compress")
def compress():
    level = request.form.get("level", "recommended")
    if level not in COMPRESS_LEVELS:
        raise ToolError("Unknown compression level.")
    results = []
    for f in pdf_files():
        original = f.read()
        f.seek(0)
        data = compress_pdf(open_pdf(f, form_password()), level)
        # Never hand back something bigger than what was uploaded.
        if len(data) >= len(original):
            data = original
        results.append((f"{base_name(f.filename)}_compressed.pdf", data))
    return send_results(results, "compressed.zip")


@app.post("/api/repair")
def repair():
    # qpdf (inside pikepdf) reconstructs broken cross-reference tables while opening.
    return for_each_pdf("repaired", lambda pdf: pdf_bytes(pdf, fix_metadata_version=True))


# ---------- routes: convert ----------

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
    name = base_name(files[0].filename) if len(files) == 1 else "images"
    return send_bytes(out.getvalue(), f"{name}.pdf")


@app.post("/api/pdf-to-image")
def pdf_to_image():
    f = pdf_files()[0]
    fmt = request.form.get("format", "jpg")
    if fmt not in ("jpg", "png"):
        raise ToolError("Choose JPG or PNG.")
    dpi = int(form_float("dpi", 150, 36, 300))
    try:
        doc = pdfium.PdfDocument(f.read(), password=form_password() or None)
    except pdfium.PdfiumError:
        raise ToolError("Couldn't open that PDF. Check the password.")
    name = base_name(f.filename)
    results = []
    try:
        for i in range(len(doc)):
            page = doc[i]
            img = page.render(scale=dpi / 72).to_pil().convert("RGB")
            buf = io.BytesIO()
            if fmt == "jpg":
                img.save(buf, format="JPEG", quality=90, dpi=(dpi, dpi))
            else:
                img.save(buf, format="PNG", dpi=(dpi, dpi))
            results.append((f"{name}_{i + 1}.{fmt}", buf.getvalue()))
            page.close()
    finally:
        doc.close()
    return send_results(results, f"{name}_images.zip")


# ---------- routes: edit ----------

@app.post("/api/rotate")
def rotate():
    angle = int(request.form.get("angle", 90))
    if angle not in (90, 180, 270):
        raise ToolError("Rotation must be 90, 180 or 270 degrees.")

    def process(pdf):
        for page in pdf.pages:
            page.rotate(angle, relative=True)
        return pdf_bytes(pdf)
    return for_each_pdf("rotated", process)


@app.post("/api/watermark")
def watermark():
    text = request.form.get("text", "").strip()
    if not text:
        raise ToolError("Enter the watermark text.")
    position = request.form.get("position", "diagonal")
    if position not in ("center", "diagonal", "tiled", "top", "bottom"):
        raise ToolError("Unknown watermark position.")
    size = form_float("size", 60, 8, 200)
    opacity = form_float("opacity", 30, 5, 100) / 100
    try:
        color = HexColor(request.form.get("color", "#e0443a"))
    except ValueError:
        raise ToolError("Invalid colour.")
    font = "Helvetica-Bold"
    unit = stringWidth(text, font, 1) or 1  # text width at font size 1

    def draw(c, w, h, _i, _n):
        c.setFillColor(color)
        c.setFillAlpha(opacity)
        if position in ("center", "top", "bottom"):
            s = min(size, w * 0.9 / unit)
            c.setFont(font, s)
            y = {"center": h / 2 - s * 0.35, "top": h - 15 * MM - s * 0.7, "bottom": 15 * MM}[position]
            c.drawCentredString(w / 2, y, text)
        elif position == "diagonal":
            s = min(size, math.hypot(w, h) * 0.8 / unit)
            c.setFont(font, s)
            c.translate(w / 2, h / 2)
            c.rotate(math.degrees(math.atan2(h, w)))
            c.drawCentredString(0, -s * 0.35, text)
        else:  # tiled
            c.setFont(font, size)
            c.translate(w / 2, h / 2)
            c.rotate(35)
            step_x, step_y = unit * size + size * 2, size * 4
            reach = math.hypot(w, h) / 2 + step_x
            y, row = -reach, 0
            while y <= reach:
                x = -reach + (row % 2) * step_x / 2
                while x <= reach:
                    c.drawCentredString(x, y, text)
                    x += step_x
                y += step_y
                row += 1

    return for_each_pdf("watermarked", lambda pdf: pdf_bytes(add_overlays(pdf, draw)))


@app.post("/api/page-numbers")
def page_numbers():
    vpos, _, hpos = request.form.get("position", "bottom-center").partition("-")
    if vpos not in ("top", "bottom") or hpos not in ("left", "center", "right"):
        raise ToolError("Unknown position.")
    template = PAGE_NUMBER_FORMATS.get(request.form.get("format", "n"))
    if not template:
        raise ToolError("Unknown number format.")
    start = int(form_float("start", 1, 0, 100000))
    size = form_float("size", 11, 6, 48)
    skip_first = form_flag("skip_first")
    margin = 12 * MM
    font = "Helvetica"

    def draw(c, w, h, i, n):
        if skip_first and i == 0:
            return
        offset = 1 if skip_first else 0
        label = template.format(n=start + i - offset, total=start + n - offset - 1)
        c.setFont(font, size)
        c.setFillColor(HexColor("#222222"))
        y = margin if vpos == "bottom" else h - margin - size * 0.7
        if hpos == "left":
            c.drawString(margin, y, label)
        elif hpos == "right":
            c.drawRightString(w - margin, y, label)
        else:
            c.drawCentredString(w / 2, y, label)

    return for_each_pdf("numbered", lambda pdf: pdf_bytes(add_overlays(pdf, draw)))


@app.post("/api/crop")
def crop():
    """Trim margins (mm, as seen on screen: top/right/bottom/left) from every page."""
    visual = [form_float(k, 0, 0, 500) * MM for k in ("top", "right", "bottom", "left")]
    if not any(visual):
        raise ToolError("Set at least one margin to crop.")

    def process(pdf):
        for page in pdf.pages:
            x0, y0, x1, y1 = page_box(page)
            k = page_rotation(page) // 90
            # Map the on-screen sides onto the unrotated page's sides.
            top, right, bottom, left = (visual[(i + k) % 4] for i in range(4))
            box = [x0 + left, y0 + bottom, x1 - right, y1 - top]
            if box[2] - box[0] < 36 or box[3] - box[1] < 36:
                raise ToolError("Those margins are larger than the page. Use smaller values.")
            page.obj.CropBox = pikepdf.Array(box)
        return pdf_bytes(pdf)
    return for_each_pdf("cropped", process)


@app.post("/api/metadata")
def metadata():
    remove_all = form_flag("remove_all")
    fields = {
        "/Title": ("dc:title", request.form.get("title", "").strip()),
        "/Author": ("dc:creator", request.form.get("author", "").strip()),
        "/Subject": ("dc:description", request.form.get("subject", "").strip()),
        "/Keywords": ("pdf:Keywords", request.form.get("keywords", "").strip()),
    }

    def process(pdf):
        if remove_all:
            if "/Metadata" in pdf.Root:
                del pdf.Root.Metadata
            pdf.trailer.Info = pdf.make_indirect(pikepdf.Dictionary())
            return pdf_bytes(pdf)
        # Keep the XMP packet and the document info dictionary in sync.
        with pdf.open_metadata(set_pikepdf_as_editor=False, update_docinfo=False) as meta:
            for prop, value in fields.values():
                if value:
                    meta[prop] = [value] if prop == "dc:creator" else value
                elif prop in meta:
                    del meta[prop]
        for key, (_prop, value) in fields.items():
            if value:
                pdf.docinfo[key] = value
            elif key in pdf.docinfo:
                del pdf.docinfo[key]
        return pdf_bytes(pdf)

    return for_each_pdf("cleaned" if remove_all else "edited", process)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    print(f"\n  pdforge running at http://127.0.0.1:{port}\n")
    app.run(host="127.0.0.1", port=port, debug=False)
