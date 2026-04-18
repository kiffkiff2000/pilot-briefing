import { createRequire } from "module";

import { configurePdfjsWorker } from "@/lib/pdfjs-config";

/**
 * pdfjs-dist loads display/canvas at import time (`new DOMMatrix()`). In Node it
 * normally pulls DOMMatrix from @napi-rs/canvas; priming from here ensures the
 * package resolves even when pdf.mjs is served from a hashed Next.js path.
 */
function primePdfjsNodeGlobals(): void {
  if (typeof globalThis.DOMMatrix !== "undefined") return;
  try {
    const require = createRequire(import.meta.url);
    const canvas = require("@napi-rs/canvas") as {
      DOMMatrix: typeof DOMMatrix;
      ImageData: typeof ImageData;
      Path2D: typeof Path2D;
    };
    globalThis.DOMMatrix = canvas.DOMMatrix;
    globalThis.ImageData ??= canvas.ImageData;
    globalThis.Path2D ??= canvas.Path2D;
  } catch (e) {
    throw new Error(
      `PDF extraction requires @napi-rs/canvas on the server: ${(e as Error).message}`,
    );
  }
}

type TextItemLike = {
  str?: string;
  transform?: number[];
  width?: number;
};

type PositionedText = {
  text: string;
  x: number;
  y: number;
  width: number;
};

function groupItemsIntoLines(items: PositionedText[]): PositionedText[][] {
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 0.01) {
      return b.y - a.y;
    }
    return a.x - b.x;
  });

  const lines: PositionedText[][] = [];
  const yTolerance = 2.5;

  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (!last) {
      lines.push([item]);
      continue;
    }
    const avgY = last.reduce((sum, v) => sum + v.y, 0) / last.length;
    if (Math.abs(item.y - avgY) <= yTolerance) {
      last.push(item);
    } else {
      lines.push([item]);
    }
  }

  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
  }

  return lines;
}

function rebuildLineText(line: PositionedText[]): string {
  let out = "";
  let prev: PositionedText | null = null;
  const spaceGapThreshold = 1.5;

  for (const item of line) {
    const token = item.text.trim();
    if (!token) {
      continue;
    }
    if (!prev) {
      out += token;
      prev = item;
      continue;
    }
    const prevEnd = prev.x + prev.width;
    const gap = item.x - prevEnd;
    if (gap > spaceGapThreshold) {
      out += " ";
    }
    out += token;
    prev = item;
  }

  return out.trim();
}

/**
 * Extract PDF text with page/line preservation:
 * - group by Y coordinate to reconstruct lines
 * - sort by X coordinate to preserve word order
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  primePdfjsNodeGlobals();
  // Legacy build: main entry is pdf.mjs (package has no extension-less `pdf` file).
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfjsWorker(pdfjs);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;

  try {
    const pageBlocks: string[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const positioned: PositionedText[] = [];
      for (const raw of textContent.items as TextItemLike[]) {
        const text = (raw.str ?? "").replace(/\s+/g, " ").trim();
        const transform = raw.transform ?? [];
        if (!text || transform.length < 6) {
          continue;
        }
        positioned.push({
          text,
          x: transform[4],
          y: transform[5],
          width: raw.width ?? text.length,
        });
      }

      const lines = groupItemsIntoLines(positioned)
        .map((line) => rebuildLineText(line))
        .filter((line) => line.length > 0);
      pageBlocks.push(lines.join("\n"));
    }

    const extracted = pageBlocks.filter(Boolean).join("\n\n");
    const debugLines = extracted.split(/\r?\n/).slice(0, 50);
    console.log("[pdf] first_50_lines_start");
    debugLines.forEach((line, idx) => {
      console.log(`[pdf] ${idx + 1}: ${line}`);
    });
    console.log("[pdf] first_50_lines_end");
    return extracted;
  } finally {
    await loadingTask.destroy();
  }
}
