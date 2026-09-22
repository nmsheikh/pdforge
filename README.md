# pdforge

A small, self-hosted PDF toolbox in the style of iLovePDF. Choose a tool, upload a file, and download the result. Files are processed in memory on your own machine and never saved to disk or sent anywhere else.

## Tools

The home page groups tools into categories, and you can filter the grid by category. The **All tools** menu in the top bar lists every tool.

| Category | Tools |
|---|---|
| Organize | **Merge** (reorder before merging) · **Split** (every page, or ranges like `1-3, 5, 8-`) · **Select pages** (click pages such as 2, 4, 7 to make a new PDF) · **Organize** (drag to reorder, rotate or delete single pages, insert blank pages) |
| Optimize | **Compress** (Extreme / Recommended / Low: downsamples and recompresses images) · **Repair** (rebuilds damaged files) |
| Convert | **JPG to PDF** · **PDF to JPG** (JPG or PNG at 72, 150 or 300 DPI) |
| Edit | **Rotate** · **Watermark** (text, position, size, opacity, colour) · **Page numbers** (6 positions, 4 formats, start number, skip cover) · **Crop** (trim margins) · **Edit metadata** (title, author, subject, keywords, or remove all metadata) |
| Security | **Unlock** · **Protect** (AES-256 password, and optionally block printing, copying or editing) |

**Working with files**
- **Several files at once**: Compress, Repair, Rotate, Watermark, Page numbers, Edit metadata, Unlock and Protect accept several PDFs and return a ZIP.
- **Live preview**: Watermark, Page numbers and Crop show the first page with your settings applied as you change them.
- **Protected uploads**: if you upload a PDF that has a password, the tool asks for it before continuing.

**When a result is ready**
- **Continue with this file**: send the result straight into another tool, for example Watermark, then Page numbers, then Protect.
- **Password-protect this file**: add a password before downloading. This works for every PDF or ZIP result. In a ZIP, each PDF inside is protected.

A comparison with iLovePDF and Adobe Acrobat Pro, and the roadmap, are in [docs/competitive-analysis.md](docs/competitive-analysis.md).

## Desktop app (no size limit)

The desktop app has the same 15 tools with **no file size limit**. Everything runs on your computer, so no files are uploaded and it works offline. It's about 10 MB and needs nothing else installed.

Get it from the **Download app** button on the website, or from [Releases](https://github.com/nmsheikh/pdforge/releases/latest):

| System | File |
|---|---|
| macOS, Apple Silicon (M1 and newer) | `pdforge_*_aarch64.dmg` |
| macOS, Intel | `pdforge_*_x64.dmg` |
| Windows 10/11 | `pdforge_*_x64-setup.exe` |
| Ubuntu/Debian | `pdforge_*_amd64.deb` (other Linux: `.AppImage`) |

The app isn't signed with a paid certificate yet, so the first time you open it: on macOS, right-click the app and choose **Open**; on Windows, click **More info**, then **Run anyway**.

**How it works:** the app is built with [Tauri](https://tauri.app), which uses the web engine already built into your operating system instead of bundling a browser. PDF processing happens in [`static/engine/engine.mjs`](static/engine/engine.mjs) with in-browser engines:
- [qpdf](https://github.com/qpdf/qpdf) compiled to WebAssembly: encryption, decryption, repair, compression
- [pdf-lib](https://pdf-lib.js.org): page editing, watermarks, page numbers
- [pdf.js](https://mozilla.github.io/pdf.js/): previews, PDF to image
- [fflate](https://github.com/101arrowz/fflate): ZIP files

**Building it yourself:**
- Requirements: Node.js and [Rust](https://rustup.rs).
- Run `cd desktop && npm install && npm run build`.
- Pushing a tag such as `v3.0.1` makes GitHub Actions build every platform and publish a release.

To try the in-browser engine on the website locally, open http://127.0.0.1:5050/?local=1 after running `cd desktop && npm install && npm run prepare-dist`.

## Run the website

```bash
./run.sh
```

Then open http://127.0.0.1:5050. The hosted version at https://pdforge-brown.vercel.app limits uploads to 4 MB (a Vercel limit) and points larger files to the desktop app. The first run creates a `.venv` and installs the dependencies (Flask, pikepdf, pypdfium2, Pillow, reportlab).
Use `PORT=8000 ./run.sh` to run it on a different port.
