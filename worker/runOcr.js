// worker/runOcr.js
// OCR pipeline for scanned PDFs using pdfjs-dist + pngjs + tesseract.js
// No native binaries: no tesseract binary, no poppler, no canvas, no cairo.

import { createRequire } from "module";
import Tesseract from "tesseract.js";
import { pixelDataToPngBuffer } from "./imageUtils.js";

const require = createRequire(import.meta.url);
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

// In Node.js, pdfjs-dist automatically uses a fake (in-process) worker.
// No workerSrc config needed — isWorkerDisabled is set to true by pdfjs for Node.js.

const OPS = pdfjsLib.OPS;

// OCR concurrency: 2 pages at a time to keep memory/CPU stable on EC2
const CONCURRENCY = 2;

// -------------------------------------------------------------------
// Fallback: scan raw PDF bytes for embedded JPEG streams (FF D8 FF … FF D9)
// Works reliably for scanner-produced PDFs where each page is a JPEG.
// -------------------------------------------------------------------
function extractJpegsFromBuffer(pdfBuffer) {
  const images = [];
  for (let i = 0; i < pdfBuffer.length - 3; i++) {
    if (pdfBuffer[i] === 0xFF && pdfBuffer[i + 1] === 0xD8 && pdfBuffer[i + 2] === 0xFF) {
      const start = i;
      for (let j = start + 2; j < pdfBuffer.length - 1; j++) {
        if (pdfBuffer[j] === 0xFF && pdfBuffer[j + 1] === 0xD9) {
          const jpeg = pdfBuffer.slice(start, j + 2);
          if (jpeg.length > 8192) images.push(jpeg); // skip tiny thumbnails
          i = j + 1;
          break;
        }
      }
    }
  }
  return images;
}

// -------------------------------------------------------------------
// Primary image extraction via pdfjs-dist operator list + page.objs
// After getOperatorList() resolves, image pixel data is available in
// page.objs (decoded to RGBA/RGB/1bpp by the pdfjs inline worker).
// No canvas or rendering step is required.
// -------------------------------------------------------------------
async function extractPageImages(pdfBuffer) {
  const pdfDoc = await pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    verbosity: 0,
    disableFontFace: true,
  }).promise;

  const numPages = pdfDoc.numPages;
  const pageImages = [];

  const imageOps = new Set([
    OPS.paintImageXObject,
    OPS.paintJpegXObject,
    OPS.paintImageXObjectRepeat,
  ]);

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    try {
      // getOperatorList() triggers full page processing including image decoding.
      // pdfjs resolves all image XObjects into page.objs before lastChunk arrives.
      const ops = await page.getOperatorList();

      // Collect image XObject names referenced on this page
      const imgNames = new Set();
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (imageOps.has(ops.fnArray[i])) imgNames.add(ops.argsArray[i][0]);
      }

      // Get the largest image (page scan) — scanned PDFs have one image per page
      let bestData = null;
      let bestSize = 0;

      for (const name of imgNames) {
        let imgData = null;
        // page.objs holds page-specific images; commonObjs holds shared resources
        if (page.objs.has(name)) {
          imgData = page.objs.get(name);
        } else if (page.commonObjs.has(name)) {
          imgData = page.commonObjs.get(name);
        }

        if (imgData?.data && imgData.width && imgData.height) {
          const size = imgData.width * imgData.height;
          if (size > bestSize) {
            bestSize = size;
            bestData = imgData;
          }
        }
      }

      if (bestData) {
        pageImages.push({ pageNum, buffer: pixelDataToPngBuffer(bestData) });
      } else if (imgNames.size > 0) {
        console.warn(`⚠️  Image data not resolved for page ${pageNum} (names: ${[...imgNames].join(', ')})`);
      }
    } catch (err) {
      console.warn(`⚠️  Could not extract image from page ${pageNum}: ${err.message}`);
    }
    page.cleanup();
  }

  await pdfDoc.destroy();
  return pageImages;
}

// -------------------------------------------------------------------
// OCR text cleanup
// -------------------------------------------------------------------
function cleanOcrText(text) {
  return (text || '')
    .replace(/\f/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// -------------------------------------------------------------------
// runOCR — public entry point
// Accepts a PDF Buffer, returns { fullText, pageTexts }
// -------------------------------------------------------------------
export async function runOCR(pdfBuffer) {
  const ocrStart = Date.now();
  console.log('⚠️  Scanned PDF detected → running OCR');

  // Step 1: extract page images via pdfjs-dist (preferred, no native deps)
  let pageImages = await extractPageImages(pdfBuffer);

  // Step 2: fallback — extract raw JPEG streams from PDF binary
  if (pageImages.length === 0) {
    console.log('🔄  Falling back to raw JPEG extraction from PDF binary...');
    const jpegs = extractJpegsFromBuffer(pdfBuffer);
    if (jpegs.length === 0) {
      throw new Error('No page images could be extracted from the scanned PDF');
    }
    pageImages = jpegs.map((buffer, idx) => ({ pageNum: idx + 1, buffer }));
  }

  console.log(`🖼️  PDF converted to ${pageImages.length} image(s)`);

  // Step 3: OCR each page with limited concurrency (avoid memory spikes)
  const pageTexts = new Array(pageImages.length).fill('');

  for (let i = 0; i < pageImages.length; i += CONCURRENCY) {
    const batch = pageImages.slice(i, i + CONCURRENCY);

    const results = await Promise.all(
      batch.map(async ({ pageNum, buffer }) => {
        console.log(`OCR page ${pageNum}/${pageImages.length}`);
        try {
          const result = await Tesseract.recognize(buffer, 'eng', { logger: () => {} });
          return cleanOcrText(result.data.text);
        } catch (err) {
          console.warn(`⚠️  OCR failed for page ${pageNum}: ${err.message}`);
          return '';
        }
      })
    );

    results.forEach((text, j) => { pageTexts[i + j] = text; });
  }

  const fullText = pageTexts.filter(Boolean).join('\n\n');
  const elapsed = ((Date.now() - ocrStart) / 1000).toFixed(2);
  console.log(`⏱️  OCR completed in ${elapsed}s`);

  return { fullText, pageTexts };
}
