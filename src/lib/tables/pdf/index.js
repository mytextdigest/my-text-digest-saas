// src/lib/tables/pdf/index.js
// PDF table extraction: text layer → lines/segments → regions → grids →
// continuation merge. Pages are read sequentially on one pdfjs handle
// (pdfjs isn't safe to use concurrently on a single document). Pure.
import config from "../config.js";
import { openPdf, readPage } from "./textLayer.js";
import { groupLines, segmentLine, findRepeatedBands, bandKey, isTabularLine, findRegions, extendHeaderUp } from "./detect.js";
import { buildCandidate } from "./structure.js";
import { mergeContinuations } from "./continuation.js";

async function extractPdfTables(buffer) {
  const pdf = await openPdf(buffer);
  const pages = [];
  const scannedPageNumbers = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await readPage(pdf, p);
      if (page.words.length < config.SCANNED_PAGE_MAX_WORDS) scannedPageNumbers.push(p);
      page.lines = groupLines(page.words);
      for (const l of page.lines) l.segments = segmentLine(l, page.rulings.vertical);
      delete page.words;
      pages.push(page);
    }
  } finally {
    try { await pdf.destroy(); } catch (_) {}
  }

  const bands = findRepeatedBands(pages);
  const candidates = [];
  let candidatesSeen = 0, rejected = 0, skippedLowConf = 0;
  const rejectReasons = {};

  for (const page of pages) {
    if (bands.size) page.lines = page.lines.filter((l) => !bands.has(bandKey(l, page.height)));
    for (const l of page.lines) l.tabular = isTabularLine(l, page.width);
    const regions = findRegions(page.lines, page);
    for (const region of regions) {
      extendHeaderUp(region, page.lines);
      candidatesSeen++;
      const cand = buildCandidate(region, page, page.lines);
      if (!cand) { rejected++; continue; }
      if (cand.rejected) {
        // Too small on its own, but it may be the tail of a table from the
        // previous page — keep it for the continuation merge.
        if (cand.rejected.length === 1 && cand.rejected[0] === "fewer than 2 data rows") {
          cand.fragment = true;
          candidates.push(cand);
          continue;
        }
        rejected++;
        for (const r of cand.rejected) rejectReasons[r] = (rejectReasons[r] || 0) + 1;
        continue;
      }
      candidates.push(cand);
    }
  }

  // Merge before thresholding so a strong first half carries its continuation.
  const merged = mergeContinuations(candidates);
  const tables = [];
  for (const t of merged) {
    if (t.fragment) {
      rejected++;
      rejectReasons["fewer than 2 data rows"] = (rejectReasons["fewer than 2 data rows"] || 0) + 1;
      continue;
    }
    if (t.confidence < config.CONFIDENCE_KEEP) { skippedLowConf++; continue; }
    t.lowConfidence = t.confidence < config.CONFIDENCE_HIGH;
    tables.push(t);
  }

  return {
    tables,
    stats: { candidatesSeen, rejected, rejectReasons, skippedLowConf, scannedPages: scannedPageNumbers.length, scannedPageNumbers, pageCount: pages.length },
  };
}

export { extractPdfTables };
