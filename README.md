# PDFKit

A small, self-hosted PDF toolbox in the style of iLovePDF. Choose a tool, upload a file, and download the result.

## Tools
- **Unlock PDF**: enter the password of an encrypted PDF and download a copy with no password.
- **Protect / Change password**: add a password (AES-256), or replace the password on a PDF that already has one.
- **Merge PDF**: combine several PDFs. You can reorder them before merging.
- **Select pages**: see a preview of every page, click the ones you want (for example 2, 4 and 7), and get a new PDF with only those pages. You can also type pages such as `2, 4, 7` or `1-3`.
- **Split PDF**: split every page into its own file, or extract custom ranges such as `1-3, 5, 8-`.
- **Rotate PDF**: rotate all pages 90°, 180° or 270°.
- **Compress PDF**: recompress the file and clean up its structure. This runs as soon as you upload.
- **JPG to PDF**: turn one or more images into a single PDF.

When a result is ready, you can tick **Password-protect this file** before downloading it. This works for every tool, including ZIP results, where each PDF inside is protected. If you upload a PDF that already has a password to Select pages, Split or Rotate, the tool asks for that password first.

Files are processed in memory and never saved to disk.

## Run

```bash
./run.sh
```

Then open http://127.0.0.1:5050. The first run creates a `.venv` and installs Flask, pikepdf and Pillow.
Use `PORT=8000 ./run.sh` to run it on a different port.
