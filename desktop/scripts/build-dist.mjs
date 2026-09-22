// Build desktop/dist: the website's page and static files, turned into a
// self-contained app that processes PDFs locally (no server).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const dist = join(here, "..", "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

let html = readFileSync(join(root, "templates", "index.html"), "utf8");
html = html
  .replace(/\{\{\s*url_for\('static',\s*filename='([^']+)'\)\s*\}\}/g, "static/$1")
  .replace(/\{\{\s*max_upload_mb\s*\}\}/g, "0")
  .replace(/\{%\s*if online\s*%\}[\s\S]*?\{%\s*endif\s*%\}/g, "")
  .replace("<body ", '<body data-desktop="1" ');
if (/\{\{|\{%/.test(html)) throw new Error("Unconverted template syntax left in index.html");
// Test builds only: run tests/selftest.mjs inside the app (see src-tauri "selftest" feature).
if (process.env.PDFORGE_SELFTEST_BUILD) {
  html = html.replace("</body>", '<script type="module" src="static/selftest.mjs"></script>\n</body>');
}
writeFileSync(join(dist, "index.html"), html);
cpSync(join(root, "static"), join(dist, "static"), { recursive: true });
if (process.env.PDFORGE_SELFTEST_BUILD) cpSync(join(here, "..", "tests", "selftest.mjs"), join(dist, "static", "selftest.mjs"));
console.log("build-dist: wrote desktop/dist");
