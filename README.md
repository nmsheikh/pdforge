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

## Run

```bash
./run.sh
```

Then open http://127.0.0.1:5050. The first run creates a `.venv` and installs the dependencies (Flask, pikepdf, pypdfium2, Pillow, reportlab).
Use `PORT=8000 ./run.sh` to run it on a different port.
