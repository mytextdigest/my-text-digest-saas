// src/lib/tables/vision/prefilter.js
// Free pre-screen before a (paid) vision call: runs the text-layer line and
// segment rules on OCR words. A scanned page is sent to the vision model
// only when several nearby lines split into cell-like segments.
import { groupLines, segmentLine, isTabularLine, median } from "../pdf/detect.js";

const MIN_TABULAR_LINES = 3;

// words: OCR words in textLayer shape. width: image width in pixels.
function looksTabular(words, width) {
  if (!Array.isArray(words) || words.length < 6) return false;
  const lines = groupLines(words);
  for (const l of lines) l.segments = segmentLine(l, []);
  const fs = median(lines.map((l) => l.fontSize)) || 10;

  // Longest run of tabular lines, allowing short gaps (section labels,
  // wrapped cells) between them — the same idea as findRegions.
  let best = 0, run = 0, lastBottom = null, singles = 0;
  for (const l of lines) {
    const tabular = isTabularLine(l, width);
    const near = lastBottom == null || l.top - lastBottom <= 4.2 * fs;
    if (tabular) {
      run = near ? run + 1 : 1;
      singles = 0;
      lastBottom = l.bottom;
    } else if (run && near && singles < 2) {
      singles++;
    } else {
      run = 0;
      singles = 0;
      lastBottom = null;
    }
    best = Math.max(best, run);
  }
  return best >= MIN_TABULAR_LINES;
}

// Embedded figures come with a vision caption and OCR text already
// (figures/caption.js). A figure is worth reading as a table when its
// caption says so, or its OCR text has several lines holding 2+ numbers.
const TABLE_CAPTION_RE = /\b(tables?|tabular|spreadsheet|rows? and columns?|columns? and rows?|grid of (?:values|numbers|data)|financial statement|balance sheet|income statement)\b/i;

function figureLooksTabular(figure) {
  if (TABLE_CAPTION_RE.test(figure?.caption || "")) return true;
  const lines = String(figure?.ocr_text || "").split(/\n/);
  const numericLines = lines.filter((l) => (l.match(/\d[\d,.]*/g) || []).length >= 2).length;
  return numericLines >= 3;
}

export { looksTabular, figureLooksTabular, TABLE_CAPTION_RE };
