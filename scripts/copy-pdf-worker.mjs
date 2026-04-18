/**
 * Keeps public/pdf.worker.min.js in sync with the installed pdfjs-dist version.
 * Run automatically via npm postinstall.
 */
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs");
const dest = join(root, "public/pdf.worker.min.js");

if (!existsSync(src)) {
  console.warn("[copy-pdf-worker] Skipped: pdfjs-dist worker not found at", src);
  process.exit(0);
}

copyFileSync(src, dest);
console.log("[copy-pdf-worker] Copied to public/pdf.worker.min.js");
