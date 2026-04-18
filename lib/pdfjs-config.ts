import path from "path";
import { pathToFileURL } from "url";

type PdfjsWithWorker = {
  GlobalWorkerOptions: { workerSrc: string };
};

const WORKER_SPECIFIER = "pdfjs-dist/legacy/build/pdf.worker.min.mjs";

function resolvePdfWorkerFileUrl(): string {
  const im = import.meta as ImportMeta & { resolve?: (s: string) => string };
  if (typeof im.resolve === "function") {
    try {
      return im.resolve(WORKER_SPECIFIER);
    } catch {
      /* e.g. unknown specifier in some bundlers */
    }
  }
  const abs = path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.min.mjs");
  return pathToFileURL(abs).href;
}

/**
 * pdf.js fake worker uses dynamic `import(workerSrc)`. In Next.js/Vercel the default
 * `./pdf.worker.mjs` may not resolve next to the bundled chunk — set an explicit URL.
 *
 * - **Server (Node):** absolute `file://` URL into `node_modules/pdfjs-dist/...`
 * - **Browser:** static asset from `/public` (see `scripts/copy-pdf-worker.mjs`)
 */
export function configurePdfjsWorker(pdfjs: PdfjsWithWorker): void {
  if (typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";
    return;
  }

  pdfjs.GlobalWorkerOptions.workerSrc = resolvePdfWorkerFileUrl();
}
