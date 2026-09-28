// src/lib/tables/vision/pageImages.js
// Page rasters for scanned PDFs without canvas: the largest image XObject on
// each page, read from pdfjs page.objs after getOperatorList() and encoded to
// PNG. Moved here from worker/runOcr.js (which now uses it) so OCR ingestion
// and table vision share one copy. Replaces the desktop's canvas-based
// vision/render.js forEachPdfPageImage.
//
// Limitation: a page with no raster image (vector-only, no text) yields no
// PNG; onPage receives null for it.
import { createRequire } from "module";
import { pixelDataToPngBuffer } from "../../imageUtils.js";

process.env.PDFJS_DISABLE_WORKER = "true";
const require = createRequire(import.meta.url);
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const OPS = pdfjsLib.OPS;

const IMAGE_OPS = new Set([OPS.paintImageXObject, OPS.paintJpegXObject, OPS.paintImageXObjectRepeat]);

// Walks the given pages (all pages when pageNumbers is null) one at a time —
// pdfjs isn't safe to use concurrently on one document — and awaits
// onPage(pageNumber, pngBufferOrNull) for each, so callers can OCR as they
// go without holding every page in memory.
export async function forEachPdfPageImage(pdfBuffer, pageNumbers, onPage) {
  const pdfDoc = await pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    verbosity: 0,
    disableFontFace: true,
  }).promise;

  try {
    const pages = pageNumbers || Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1);
    for (const pageNum of pages) {
      if (pageNum < 1 || pageNum > pdfDoc.numPages) continue;
      const page = await pdfDoc.getPage(pageNum);
      let png = null;
      try {
        // getOperatorList() triggers full page processing including image decoding.
        // pdfjs resolves all image XObjects into page.objs before lastChunk arrives.
        const ops = await page.getOperatorList();

        // Collect image XObject names referenced on this page
        const imgNames = new Set();
        for (let i = 0; i < ops.fnArray.length; i++) {
          if (IMAGE_OPS.has(ops.fnArray[i])) imgNames.add(ops.argsArray[i][0]);
        }

        // Get the largest image (page scan) — scanned PDFs have one image per page
        let bestData = null;
        let bestSize = 0;
        for (const name of imgNames) {
          let imgData = null;
          // page.objs holds page-specific images; commonObjs holds shared resources
          if (page.objs.has(name)) imgData = page.objs.get(name);
          else if (page.commonObjs.has(name)) imgData = page.commonObjs.get(name);

          if (imgData?.data && imgData.width && imgData.height) {
            const size = imgData.width * imgData.height;
            if (size > bestSize) {
              bestSize = size;
              bestData = imgData;
            }
          }
        }

        if (bestData) png = pixelDataToPngBuffer(bestData);
        else if (imgNames.size > 0) {
          console.warn(`⚠️  Image data not resolved for page ${pageNum} (names: ${[...imgNames].join(", ")})`);
        }
      } catch (err) {
        console.warn(`⚠️  Could not extract image from page ${pageNum}: ${err.message}`);
      }
      page.cleanup();
      await onPage(pageNum, png);
    }
  } finally {
    try { await pdfDoc.destroy(); } catch (_) {}
  }
}

// The table-vision entry point named by the spec: PNGs of the chosen pages.
export function pageImagePng(pdfBuffer, pageNumbers, onPage) {
  return forEachPdfPageImage(pdfBuffer, pageNumbers, onPage);
}
