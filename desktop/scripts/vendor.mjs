// Copy the in-browser PDF engines from node_modules into static/vendor/.
// They are used by the desktop app (and by the website with ?local=1).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const nm = join(here, "..", "node_modules");
const out = join(here, "..", "..", "static", "vendor");
mkdirSync(out, { recursive: true });

const files = {
  "pdf-lib.esm.min.js": "pdf-lib/dist/pdf-lib.esm.min.js",
  "pdf.min.mjs": "pdfjs-dist/build/pdf.min.mjs",
  "pdf.worker.min.mjs": "pdfjs-dist/build/pdf.worker.min.mjs",
  "fflate.mjs": "fflate/esm/browser.js",
  "qpdf.js": "@neslinesli93/qpdf-wasm/dist/qpdf.js",
  "qpdf.wasm": "@neslinesli93/qpdf-wasm/dist/qpdf.wasm",
};
for (const [name, src] of Object.entries(files)) copyFileSync(join(nm, src), join(out, name));
console.log(`vendor: copied ${Object.keys(files).length} files to static/vendor`);
