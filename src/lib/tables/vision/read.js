// src/lib/tables/vision/read.js
// Reads tables from one image with a vision model (V2-G1). The model only
// transcribes; Tesseract OCR of the same image is the ground truth: every
// number the model returns must be one OCR also saw, or the cell is flagged
// (and a table with too few confirmed values is dropped).
import { MODEL_VISION } from "../config.js";
import config from "../config.js";
import { makeRawTable } from "../schema.js";
import { verifyGrid, numericTokens } from "../verify.js";
import { looksNumeric } from "../clean.js";
import { looksTabular } from "./prefilter.js";
import { prepareImage } from "./imageOps.js";

const SYSTEM_PROMPT =
  "You transcribe data tables from images of document pages. Rules:\n" +
  "- Only printed data tables (text arranged in rows and columns). Ignore charts, graphs, diagrams, forms, logos and running paragraphs.\n" +
  "- Copy each cell's text exactly as printed: keep number formatting, signs, parentheses, currency and % symbols and footnote markers. " +
  "Never calculate, round, convert, translate or fill in values. A blank cell is \"\".\n" +
  "- header: the column headings, always included when the table has them. A heading printed over several lines is ONE cell (\"Wood pallets and containers (SIC 244)\"). " +
  "Use a second header row only for a heading that spans several columns; put its text in the first column it covers and \"\" in the rest.\n" +
  "- rows: the table body only, one entry per printed row, each with the same number of cells as the header. Keep section labels (e.g. \"1992:\") as their own row.\n" +
  "- caption: the table's printed title directly above or below it (e.g. \"Table 2: Revenue by region (in $m)\"), or null.\n" +
  "- If the image holds several separate tables, return each one. If it holds no data table, return an empty list.\n" +
  'Respond with JSON only: {"tables":[{"caption":string|null,"header":[["heading", ...]],"rows":[["cell", ...], ...]}]}';

function cleanGrid(rows) {
  const grid = (Array.isArray(rows) ? rows : [])
    .filter(Array.isArray)
    .map((r) => r.map((c) => String(c ?? "").replace(/\s+/g, " ").trim()))
    .filter((r) => r.some(Boolean));
  const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
  // Drop columns that are empty in every row (padding the model sometimes adds).
  const keep = Array.from({ length: width }, (_, j) => grid.some((r) => r[j]));
  return grid.map((r) => Array.from({ length: width }, (_, j) => r[j] || "").filter((_, j) => keep[j]));
}

function parseVisionResponse(content) {
  let parsed;
  try { parsed = JSON.parse(content || "{}"); } catch (_) { return []; }
  const list = Array.isArray(parsed?.tables) ? parsed.tables : [];
  return list.slice(0, config.VISION_MAX_TABLES_PER_IMAGE).map((t) => {
    // Headers come as their own list; older-style replies give a count.
    const header = Array.isArray(t?.header) ? t.header.filter(Array.isArray) : [];
    const rows = cleanGrid([...header, ...(Array.isArray(t?.rows) ? t.rows : [])]);
    const declared = header.length ? cleanGrid(header).length : Math.floor(Number(t?.headerRows) || 0);
    // The model tends to count a multi-line printed header as several rows
    // even after merging it into one, swallowing the first data row. As in
    // the text-layer detector, headers end at the first row carrying a
    // numeric value that isn't a period label ("2025", "Q1 2025").
    const firstData = rows.findIndex((r) => r.slice(1).some(looksNumeric));
    let headerRows = Math.max(0, Math.min(3, declared, Math.max(0, rows.length - 1)));
    if (firstData >= 0) headerRows = Math.min(headerRows, firstData);
    const caption = typeof t?.caption === "string" && t.caption.trim() ? t.caption.trim().slice(0, 300) : null;
    return { rows, headerRows, caption };
  });
}

function ocrWordSet(text) {
  const set = new Set();
  for (const w of String(text || "").toLowerCase().split(/[^a-zÀ-ɏ]+/)) if (w.length >= 3) set.add(w);
  return set;
}

// How much of a transcribed grid OCR confirms. Numbers weigh double: they
// are what a misread would silently change.
function groundVisionGrid(rows, ocrText) {
  const { flagged } = verifyGrid(rows, ocrText);
  const words = ocrWordSet(ocrText);
  let numericCells = 0, groundedNumeric = 0, wordCount = 0, groundedWords = 0;
  rows.forEach((r, i) => r.forEach((cell, j) => {
    if (numericTokens(cell).length) {
      numericCells++;
      if (!flagged.has(`${i}:${j}`)) groundedNumeric++;
    }
    for (const w of String(cell).toLowerCase().split(/[^a-zÀ-ɏ]+/)) {
      if (w.length < 3) continue;
      wordCount++;
      if (words.has(w)) groundedWords++;
    }
  }));
  const weight = 2 * numericCells + wordCount;
  const share = weight ? (2 * groundedNumeric + groundedWords) / weight : 0;
  const numericShare = numericCells ? groundedNumeric / numericCells : null;
  return { share, numericShare, numericCells, flagged };
}

// Turns one parsed vision table into the extraction candidate shape used by
// the text-layer detectors (tables/index.js finalise), or null when OCR
// doesn't back it up.
function toCandidate(parsed, { ocrText, sourceType, page = null, figureId = null }) {
  const { rows, headerRows, caption } = parsed;
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (width < config.MIN_COLUMNS || rows.length - headerRows < config.MIN_DATA_ROWS) return { rejected: "too small" };
  const g = groundVisionGrid(rows, ocrText);
  if (g.numericCells >= 3 && g.numericShare < config.VISION_MIN_GROUNDED) return { rejected: "numbers not confirmed by OCR" };
  if (g.share < config.VISION_MIN_GROUNDED) return { rejected: "text not confirmed by OCR" };
  const confidence = Math.min(0.95, 0.35 + 0.6 * g.share);
  return {
    raw: makeRawTable(rows, {
      headerRows,
      caption,
      provenance: { pages: page ? [page] : [], source: "vision", ...(figureId ? { figureId } : {}) },
    }),
    sourceType,
    pageStart: page,
    pageEnd: page,
    caption,
    confidence,
    lowConfidence: confidence < config.CONFIDENCE_HIGH,
    // finalise() re-checks every number against this and flags misses.
    sourceText: ocrText,
    figureId,
  };
}

// One image → table candidates. `alwaysAsk` skips the OCR pre-screen (an
// uploaded image, or a figure whose caption already says "table").
// `dryRun` stops after the pre-screen and reports whether a call would be
// made. Returns { candidates, asked, rejected, wouldAsk }.
async function readTablesFromImage(openai, ocr, png, { sourceType, page = null, figureId = null, alwaysAsk = false, dryRun = false, model = MODEL_VISION } = {}) {
  const img = prepareImage(png);
  const { text: ocrText, words } = await ocr.recognize(img.ocr);
  const wouldAsk = !!ocrText.trim() && (alwaysAsk || looksTabular(words, img.width));
  if (!wouldAsk || dryRun) return { candidates: [], asked: false, rejected: 0, wouldAsk };

  const resp = await openai.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${img.modelMime};base64,${img.model.toString("base64")}`, detail: "high" } },
          { type: "text", text: "Transcribe every data table in this image." },
        ],
      },
    ],
  });
  const parsed = parseVisionResponse(resp.choices?.[0]?.message?.content);
  const candidates = [];
  let rejected = 0;
  for (const p of parsed) {
    const c = toCandidate(p, { ocrText, sourceType, page, figureId });
    if (c.rejected) { rejected++; continue; }
    candidates.push(c);
  }
  return { candidates, asked: true, rejected, wouldAsk };
}

export { readTablesFromImage, parseVisionResponse, groundVisionGrid, toCandidate, SYSTEM_PROMPT };
