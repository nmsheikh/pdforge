# Competitive analysis and V2 plan

Researched 2026-09-22 from ilovepdf.com (home, tool pages, pricing) and adobe.com (Acrobat Pro, features, compare plans).

## 1. How iLovePDF organizes its UI

**Global navigation**
- Top bar: logo, then shortcuts to the three most-used tools (Merge, Split, Compress), a "Convert PDF" dropdown, and an "All PDF tools" mega-menu. On the right: Login, Sign up, and an app switcher (iLoveIMG, iLoveSign, API).
- On mobile this collapses to a hamburger menu and the app-switcher grid.

**Home page = a tool catalogue**
- Headline ("Every tool you need to work with PDFs in one place") with a single sentence underneath.
- **Category filter chips**: All · Workflows · Organize PDF · Optimize PDF · Convert PDF · Edit PDF · PDF Security · PDF Intelligence. Clicking a chip filters the grid in place, with no page load.
- **Tool grid**: about 31 cards. Each card has a coloured icon (the colour is tied to the category), a title and a one-line description. New tools get a "New!" badge.
- Below the grid: "Create a workflow" (chain tools and save the chain), Desktop and Mobile apps, Business, the Premium upsell, a sister product (iLoveIMG), trust stats, and a large footer.

**Tools by category**

| Category | Tools |
|---|---|
| Organize | Merge, Split, Organize PDF (reorder, delete and add pages), Scan to PDF |
| Optimize | Compress, Repair, OCR |
| Convert | PDF ↔ Word / PowerPoint / Excel, PDF ↔ JPG, HTML to PDF, PDF to PDF/A |
| Edit | Edit PDF (text, images, shapes, freehand), Watermark, Rotate, Page numbers, Crop, PDF Forms |
| Security | Unlock, Protect, Sign, Redact, Compare |
| Intelligence (AI) | AI Summarizer, Translate PDF, PDF to Markdown |

**Tool page pattern (every tool is the same)**
1. **Landing**: a centred title, a one-line description, one huge "Select PDF file" button, and small Google Drive and Dropbox buttons next to it. "or drop PDF here" appears underneath. There is nothing else on the page.
2. **Workspace**: file or page thumbnails on the left and an options sidebar on the right, with one big action button at the bottom of the sidebar.
3. **Result**: a big Download button, plus "Continue to…" links to other tools that take the result file with them. There are also options to share, save to the cloud, and delete the file now.

**Monetization**: Free (limited), Premium (≈₹283/mo: unlimited use, desktop and mobile, digital signatures, workflows, no ads, AI credits), and Business (SSO, account manager).

**Takeaways for us**: filtering by category, colour-coding by category, the same three steps on every tool, chaining the result into another tool, and minimal chrome.

## 2. Adobe Acrobat Pro: features

Acrobat Pro costs about ₹638/mo (₹19,158/yr), or there is a 3-year desktop-only licence (Acrobat Pro 2024). Adobe advertises "70+ features". Grouped by what they do:

**Edit and organize**
- Edit existing text and images in place (fix typos, change fonts, swap and crop images)
- Add, delete, reorder, rotate, crop, resize and replace pages, using drag and drop
- Merge and split
- Headers and footers, watermarks, backgrounds, Bates numbering
- Bookmarks, links and file attachments

**Review and comment**
- Highlight, underline, sticky notes, drawing, stamps
- Shared review by link, where reviewers can comment without signing in
- Compare two versions of a PDF

**Convert**
- PDF ↔ Word, Excel, PowerPoint, images and HTML
- Create PDFs from any file, including web pages and the Office add-ins
- Industry standards: PDF/A (archive), PDF/X (print), PDF/UA (accessibility)

**Scan and OCR**
- Turn scans into searchable, editable PDFs; auto-deskew; editable text in the source's own font

**Forms and e-sign**
- Create fillable forms, with automatic field detection; fill and sign forms
- Request e-signatures, track status, send reminders, send in bulk
- Certificate-based digital signatures

**Protect**
- Open passwords, plus permission passwords that restrict printing, copying and editing
- Redaction that permanently removes content, including search-and-redact and AI-suggested redactions
- Sanitize: remove hidden data and metadata

**Optimize and prepress**
- Reduce file size with fine-grained settings, and optimize for fast web view
- Preflight, print production, and accessibility checking and fixing

**Automation**
- Action Wizard: batch-run sequences of steps over many files

**AI (separate add-on)**
- Chat with a document with citations, summaries, and "PDF Spaces" across several documents
- Audio overviews, rewriting, generating presentations, editing by prompt

**Platform**
- Desktop, web and mobile; 100 GB of cloud storage; integrations with Microsoft 365, Google Drive, Dropbox and others

## 3. Where pdforge stands (V1)

| Area | V1 has | Gap vs iLovePDF / Acrobat |
|---|---|---|
| Organize | Merge, Split, Select pages, Rotate (whole document) | Organize (reorder, delete, rotate single pages, insert blank pages), Crop |
| Optimize | Compress (structural only) | Real compression (downsample images), Repair, OCR |
| Convert | JPG → PDF | PDF → JPG/PNG, Office ↔ PDF, HTML → PDF, PDF/A |
| Edit | none | Watermark, Page numbers, Header/footer, Metadata, Edit or annotate |
| Security | Unlock, Protect (AES-256), password on any result | Permissions (no print or copy), Sign, Redact, Sanitize, Compare |
| UX | Tool grid, three-step flow | Category chips, colour-coding, "Continue to…" chaining, batch, workflows |

## 4. V2 scope (built 2026-09-22)

Chosen because each item can be built self-hosted with our current stack (Flask, pikepdf, pypdfium2, Pillow) plus at most one small library (`reportlab` for drawing text). Nothing is sent to a third-party service.

**A. UI reorganization**
1. Category chips (All · Organize · Optimize · Convert · Edit · Security) that filter the grid in place
2. Icon colours by category and "New" badges
3. A top nav with shortcuts to popular tools and an "All tools" menu
4. **Continue to…** on the result screen: send the output straight into another tool

**B. New tools**
5. **Organize PDF**: a page grid where you drag to reorder pages, rotate single pages, delete pages and insert blank pages
6. **PDF to JPG/PNG**: every page as an image (ZIP), with a choice of resolution
7. **Watermark**: text, with position, size, opacity and rotation
8. **Page numbers**: position, start number, format ("1", "Page 1 of N")
9. **Crop PDF**: trim margins on all pages
10. **Repair PDF**: rebuild damaged files
11. **Edit metadata**: title, author, subject, keywords; remove all metadata (sanitize)

**C. Upgrades to existing tools**
12. **Compress**: Low / Recommended / Extreme levels that actually downsample images
13. **Protect**: optional permissions (block printing, copying and editing)
14. **Batch**: Rotate, Compress, Protect and Unlock accept several files and return a ZIP

**Later (V3 candidates)**: Sign PDF (draw or upload a signature and place it), annotate and add text, true redaction, OCR (needs Tesseract), Office ↔ PDF (needs LibreOffice), Compare, PDF/A, saved workflows, AI summary and chat.
