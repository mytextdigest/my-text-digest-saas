// worker/extractFigures.js
// Figure/diagram extraction for PDF and DOCX documents.
// PDF: extends runOcr.js's extractPageImages technique (pdfjs-dist operator
// list + page.objs/commonObjs), but collects every image XObject per page
// instead of just the largest one.
// DOCX: reads word/media/* directly from the docx zip via jszip — mammoth's
// extractRawText() silently discards embedded images.

import { createRequire } from "module";
import crypto from "crypto";
import JSZip from "jszip";
import { pixelDataToPngBuffer } from "./imageUtils.js";

const require = createRequire(import.meta.url);
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const OPS = pdfjsLib.OPS;

const IMAGE_OPS = new Set([
  OPS.paintImageXObject,
  OPS.paintJpegXObject,
  OPS.paintImageXObjectRepeat,
]);

// Extracts every embedded image XObject per page. Gates every resolution
// behind a synchronous page.objs.has()/commonObjs.has() check first — the
// callback-based page.objs.get(id, cb) form hangs forever for glyph/font-mask
// images that only ever resolve during actual page rendering (never done
// here), which is why runOcr.js uses the same has()-gated pattern.
export async function extractPdfFigures(buffer) {
  const pdfDoc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    verbosity: 0,
    disableFontFace: true,
  }).promise;

  const figures = [];
  let figureIndex = 0;

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    try {
      const ops = await page.getOperatorList();

      const imgNames = new Set();
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (IMAGE_OPS.has(ops.fnArray[i])) imgNames.add(ops.argsArray[i][0]);
      }

      for (const name of imgNames) {
        let imgData = null;
        if (page.objs.has(name)) {
          imgData = page.objs.get(name);
        } else if (page.commonObjs.has(name)) {
          imgData = page.commonObjs.get(name);
        }

        if (!imgData?.data || !imgData.width || !imgData.height) continue;

        try {
          figures.push({
            buffer: pixelDataToPngBuffer(imgData),
            width: imgData.width,
            height: imgData.height,
            pageNumber: pageNum,
            figureIndex: figureIndex++,
            format: "png",
          });
        } catch (err) {
          console.warn(`⚠️  Could not encode figure on page ${pageNum} (${name}): ${err.message}`);
        }
      }
    } catch (err) {
      console.warn(`⚠️  Could not extract figures from page ${pageNum}: ${err.message}`);
    }
    page.cleanup();
  }

  await pdfDoc.destroy();
  return figures;
}

const SKIP_EXTENSIONS = new Set(["emf", "wmf"]);
const READABLE_FORMATS = { png: "png", jpg: "jpeg", jpeg: "jpeg" };

function getImageDimensions(buffer, format) {
  if (format === "png") {
    // 8-byte signature + 4-byte length + "IHDR" (4 bytes) precede width/height
    if (buffer.length < 24) return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if (format === "jpeg") {
    let offset = 2; // skip SOI marker
    while (offset + 9 < buffer.length && buffer[offset] === 0xFF) {
      const marker = buffer[offset + 1];
      // SOFn markers (frame dimensions) — excludes DHT(C4)/JPG(C8)/DAC(CC)
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
    return null;
  }

  return null;
}

// Sorts by the filename's numeric suffix (image1.png, image2.jpeg, ...) for
// a stable document-order approximation — docx doesn't otherwise expose the
// order media entries appear in the document body.
function docxMediaSortKey(name) {
  const match = name.match(/(\d+)(?=\.\w+$)/);
  return match ? parseInt(match[1], 10) : 0;
}

export async function extractDocxFigures(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  const mediaFiles = Object.keys(zip.files)
    .filter((name) => name.startsWith("word/media/") && !zip.files[name].dir)
    .sort((a, b) => docxMediaSortKey(a) - docxMediaSortKey(b));

  const figures = [];
  let figureIndex = 0;

  for (const name of mediaFiles) {
    const ext = name.split(".").pop().toLowerCase();

    if (SKIP_EXTENSIONS.has(ext)) {
      console.warn(`⚠️  Skipping unsupported DOCX image format (no converter available): ${name}`);
      continue;
    }

    const format = READABLE_FORMATS[ext];
    if (!format) {
      console.warn(`⚠️  Skipping unrecognized DOCX media entry: ${name}`);
      continue;
    }

    const imgBuffer = Buffer.from(await zip.files[name].async("nodebuffer"));
    const dims = getImageDimensions(imgBuffer, format);
    if (!dims) {
      console.warn(`⚠️  Could not read dimensions for DOCX image: ${name}`);
      continue;
    }

    figures.push({
      buffer: imgBuffer,
      width: dims.width,
      height: dims.height,
      pageNumber: null,
      figureIndex: figureIndex++,
      format,
    });
  }

  return figures;
}

// Pure function: drops undersized images, dedups by content hash (keeps the
// first occurrence — catches repeated logos/headers/footers across pages),
// caps at maxFigures after filtering/dedup.
export function filterAndDedupFigures(rawFigures, { minWidth = 100, minHeight = 100, maxFigures = 40 } = {}) {
  const seenHashes = new Set();
  const kept = [];

  for (const fig of rawFigures) {
    if (fig.width < minWidth || fig.height < minHeight) continue;

    const hash = crypto.createHash("sha256").update(fig.buffer).digest("hex");
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);

    kept.push(fig);
    if (kept.length >= maxFigures) break;
  }

  return kept;
}
