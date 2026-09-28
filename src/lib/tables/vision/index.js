// src/lib/tables/vision/index.js
// Tables from images (V2-G1): scanned PDF pages, uploaded images, and
// images embedded in PDF/DOCX (figures). Each source is OCR'd, pre-screened
// for free where it can be, and only then sent to the vision model
// (read.js). Returns extraction candidates for tables/index.js finalise();
// worker/processTables.js owns persistence and progress.
import config from "../config.js";
import { figureLooksTabular } from "./prefilter.js";

// Heavy modules (tesseract, pdfjs page rasters) load only when a vision run
// starts, so tables/index.js and the node:test suite never pull them in.
const lazy = {
  ocr: () => import("./ocr.js"),
  pageImages: () => import("./pageImages.js"),
  read: () => import("./read.js"),
};

const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"];

function isImageFilename(filename) {
  const lower = String(filename || "").toLowerCase();
  return IMAGE_EXT.some((e) => lower.endsWith(e));
}

async function withOcr(fn) {
  const ocr = await (await lazy.ocr()).createOcr();
  try { return await fn(ocr); } finally { await ocr.terminate(); }
}

// Scanned PDF pages. Pages are OCR'd (free, local) up to maxPages; a page
// goes to the model only if its OCR looks tabular, up to maxCalls. Pages not
// reached are left out of checkedPages so a later run can pick them up.
// A page with no raster image (vector-only) can't be read without canvas;
// it is skipped and counted as checked.
async function readScannedPages(openai, pdfBuffer, pageNumbers, { maxPages = config.VISION_AUTO_MAX_PAGES, maxCalls = config.VISION_AUTO_MAX_CALLS, onProgress } = {}) {
  const pages = pageNumbers.slice(0, maxPages);
  const candidates = [];
  const checkedPages = [];
  let calls = 0, rejected = 0, done = 0;
  await withOcr(async (ocr) => {
    const { readTablesFromImage } = await lazy.read();
    const { pageImagePng } = await lazy.pageImages();
    await pageImagePng(pdfBuffer, pages, async (page, png) => {
      done++;
      await onProgress?.({ done, total: pages.length, page });
      if (!png) { checkedPages.push(page); return; }
      if (calls >= maxCalls) {
        // Still pre-screen, so a page that isn't a table counts as checked
        // and never costs a call later.
        const res = await readTablesFromImage(openai, ocr, png, { sourceType: "pdf_vision", page, dryRun: true }).catch(() => null);
        if (res && !res.wouldAsk) checkedPages.push(page);
        return;
      }
      try {
        const res = await readTablesFromImage(openai, ocr, png, { sourceType: "pdf_vision", page });
        if (res.asked) calls++;
        rejected += res.rejected;
        candidates.push(...res.candidates);
        checkedPages.push(page);
      } catch (err) {
        console.warn(`⚠️  [tables] Vision read failed for page ${page}:`, err.message || err);
      }
    });
  });
  return { candidates, checkedPages, calls, rejected };
}

// A standalone uploaded image: always worth one call (the user uploaded it
// on purpose, and a photographed table often defeats the OCR pre-screen).
async function readImageFile(openai, buffer) {
  const { readTablesFromImage } = await lazy.read();
  const res = await withOcr((ocr) => readTablesFromImage(openai, ocr, buffer, { sourceType: "image_vision", alwaysAsk: true }));
  return { candidates: res.candidates, calls: res.asked ? 1 : 0, rejected: res.rejected };
}

// Embedded figures (Figure rows, already captioned), in the desktop row
// shape { id, caption, ocr_text, page_number }. Only figures whose caption
// or OCR text suggests a table are read; loadImage(figure) fetches the image
// bytes (from S3). Returns per-figure outcomes for Figure.tableScan.
async function readFigures(openai, figures, { maxCalls = config.VISION_AUTO_MAX_FIGURES, loadImage } = {}) {
  const outcomes = new Map();
  const candidates = [];
  let calls = 0, rejected = 0;
  const wanted = [];
  for (const f of figures) {
    if (figureLooksTabular(f)) wanted.push(f);
    else outcomes.set(f.id, "not-table");
  }
  if (!wanted.length) return { candidates, outcomes, calls, rejected };
  const { readTablesFromImage } = await lazy.read();
  await withOcr(async (ocr) => {
    for (const f of wanted) {
      if (calls >= maxCalls) break; // left unscanned for the next run
      try {
        const image = await loadImage(f);
        const res = await readTablesFromImage(openai, ocr, image, {
          sourceType: "figure_vision", page: f.page_number ?? null, figureId: f.id, alwaysAsk: true,
        });
        if (res.asked) calls++;
        rejected += res.rejected;
        candidates.push(...res.candidates);
        outcomes.set(f.id, res.candidates.length ? "found" : "none");
      } catch (err) {
        console.warn(`⚠️  [tables] Vision read failed for figure ${f.id}:`, err.message || err);
        outcomes.set(f.id, "error");
      }
    }
  });
  return { candidates, outcomes, calls, rejected };
}

export { isImageFilename, readScannedPages, readImageFile, readFigures, IMAGE_EXT };
