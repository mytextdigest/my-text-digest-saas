// src/lib/tables/vision/ocr.js
// Tesseract OCR for table images. Returns the page text (the grounding
// source for vision-read tables) and positioned words in the same shape as
// pdf/textLayer.js, so the text-layer detector can pre-screen the image.
import Tesseract from "tesseract.js";

const { createWorker } = Tesseract;

// Digit look-alikes Tesseract produces inside numbers ("1O4.5", "2,l00").
// Only tokens that are already mostly digits are touched.
function fixDigitLookalikes(text) {
  return String(text || "").replace(/[\dOoIl|S$€£.,%()\-]{2,}/g, (tok) => {
    const digits = (tok.match(/\d/g) || []).length;
    const letters = (tok.match(/[OoIl|S]/g) || []).length;
    if (!digits || letters > digits / 2) return tok;
    return tok.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/S(?=\d)/g, "5");
  });
}

function wordsFromBlocks(blocks) {
  const words = [];
  for (const block of blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        // Tesseract's own line box height is steadier than per-word boxes
        // (which shrink for words without ascenders or descenders).
        const lineH = Math.max(1, (line.bbox?.y1 ?? 0) - (line.bbox?.y0 ?? 0));
        for (const w of line.words || []) {
          const text = String(w.text || "").trim();
          if (!text || !w.bbox) continue;
          const fontSize = Math.max(4, lineH * 0.85);
          words.push({
            text: fixDigitLookalikes(text),
            x0: w.bbox.x0,
            x1: w.bbox.x1,
            top: w.bbox.y0,
            bottom: w.bbox.y1,
            baseline: line.baseline?.y0 ?? w.bbox.y1,
            fontSize,
            fontName: "",
            spacesBefore: null,
            confidence: w.confidence,
          });
        }
      }
    }
  }
  return words;
}

// One worker per job: loading the language model is the slow part, so a
// run over many pages reuses it. Call terminate() when done.
async function createOcr() {
  const worker = await createWorker("eng");
  // Images carry no usable DPI; without this Tesseract guesses (and warns).
  await worker.setParameters({ user_defined_dpi: "300", preserve_interword_spaces: "1" });
  return {
    async recognize(imageBuffer) {
      const { data } = await worker.recognize(imageBuffer, {}, { text: true, blocks: true });
      return {
        text: fixDigitLookalikes(data.text || ""),
        words: wordsFromBlocks(data.blocks),
      };
    },
    async terminate() {
      try { await worker.terminate(); } catch (_) {}
    },
  };
}

export { createOcr, fixDigitLookalikes, wordsFromBlocks };
