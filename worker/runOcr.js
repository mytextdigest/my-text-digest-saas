// worker/runOcr.js
// OCR pipeline for scanned PDFs using pdfjs-dist + pngjs + tesseract.js
// No native binaries: no tesseract binary, no poppler, no canvas, no cairo.

import Tesseract from "tesseract.js";
import { forEachPdfPageImage } from "../src/lib/tables/vision/pageImages.js";

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
// (shared with table vision: src/lib/tables/vision/pageImages.js).
// No canvas or rendering step is required.
// -------------------------------------------------------------------
async function extractPageImages(pdfBuffer) {
  const pageImages = [];
  await forEachPdfPageImage(pdfBuffer, null, (pageNum, buffer) => {
    if (buffer) pageImages.push({ pageNum, buffer });
  });
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
