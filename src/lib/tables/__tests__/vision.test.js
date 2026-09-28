import test from "node:test";
import assert from "node:assert";
import { parseVisionResponse, groundVisionGrid, toCandidate } from "../vision/read.js";
import { looksTabular, figureLooksTabular } from "../vision/prefilter.js";
import { fixDigitLookalikes } from "../vision/ocr.js";
import { finaliseTables, supportsTables } from "../index.js";

const OCR_TEXT = [
  "Table 2: Revenue by region (in $m)",
  "Region 2025 2024",
  "Europe 845.2 790.4",
  "Asia Pacific 612.8 540.3",
  "North America 1,234.5 1,101.9",
  "Total 2,692.5 2,432.6",
].join("\n");

const GRID = [
  ["Region", "2025", "2024"],
  ["Europe", "845.2", "790.4"],
  ["Asia Pacific", "612.8", "540.3"],
  ["North America", "1,234.5", "1,101.9"],
  ["Total", "2,692.5", "2,432.6"],
];

test("parseVisionResponse cleans grids and clamps header rows", () => {
  const parsed = parseVisionResponse(JSON.stringify({
    tables: [
      { caption: " Table 2: Revenue ", headerRows: 9, rows: [["Item", "", "Value"], ["A", "", "1"], ["B", "", " 2 "], ["", "", ""]] },
      { rows: "not a grid" },
    ],
  }));
  assert.strictEqual(parsed.length, 2);
  assert.deepStrictEqual(parsed[0].rows, [["Item", "Value"], ["A", "1"], ["B", "2"]]); // empty column and row dropped
  assert.strictEqual(parsed[0].headerRows, 1);
  assert.strictEqual(parsed[0].caption, "Table 2: Revenue");
  assert.deepStrictEqual(parsed[1].rows, []);
  assert.deepStrictEqual(parseVisionResponse("not json"), []);
  const [h] = parseVisionResponse(JSON.stringify({ tables: [{ header: [["Year", "Pallets"]], rows: [["1978", "44.4"], ["1979", "46.9"]] }] }));
  assert.strictEqual(h.headerRows, 1);
  assert.deepStrictEqual(h.rows[0], ["Year", "Pallets"]);
});

test("header rows stop at the first row of values", () => {
  const [t] = parseVisionResponse(JSON.stringify({ tables: [{ headerRows: 3, rows: [
    ["Year", "Wood pallets (SIC 244)", "Upholstered furniture (SIC 2512)"],
    ["1978", "44.4", "102.0"],
    ["1979", "46.9", "101.7"],
  ] }] }));
  assert.strictEqual(t.headerRows, 1);
  const [y] = parseVisionResponse(JSON.stringify({ tables: [{ headerRows: 1, rows: [["Cost line", "2024", "2025"], ["Fuel", "48.6", "45.2"]] }] }));
  assert.strictEqual(y.headerRows, 1); // year labels are headers, not values
});

test("a transcription OCR confirms is kept with high confidence", () => {
  const g = groundVisionGrid(GRID, OCR_TEXT);
  assert.strictEqual(g.numericShare, 1);
  const c = toCandidate({ rows: GRID, headerRows: 1, caption: "Table 2: Revenue by region (in $m)" }, { ocrText: OCR_TEXT, sourceType: "image_vision" });
  assert.ok(!c.rejected);
  assert.ok(c.confidence >= 0.75, `confidence ${c.confidence}`);
  const [t] = finaliseTables([c]);
  assert.strictEqual(t.groundingIssues, 0);
  assert.strictEqual(t.title, "Revenue by region");
  assert.strictEqual(t.clean.columns.length, 3);
});

test("one misread number is kept but flagged", () => {
  const grid = GRID.map((r) => [...r]);
  grid[2][1] = "621.8";
  const c = toCandidate({ rows: grid, headerRows: 1, caption: null }, { ocrText: OCR_TEXT, sourceType: "pdf_vision", page: 3 });
  assert.ok(!c.rejected);
  const [t] = finaliseTables([c]);
  assert.strictEqual(t.groundingIssues, 1);
  assert.strictEqual(t.raw.rows[2].cells[1].flag, "ungrounded");
  assert.strictEqual(t.pageStart, 3);
});

test("a transcription with invented numbers is rejected", () => {
  const invented = [["Region", "2025"], ["Europe", "111.1"], ["Asia", "222.2"], ["Africa", "333.3"]];
  const c = toCandidate({ rows: invented, headerRows: 1, caption: null }, { ocrText: OCR_TEXT, sourceType: "image_vision" });
  assert.ok(c.rejected);
});

test("tables too small to be real are rejected", () => {
  const c = toCandidate({ rows: [["Region", "2025"], ["Europe", "845.2"]], headerRows: 1 }, { ocrText: OCR_TEXT, sourceType: "image_vision" });
  assert.ok(c.rejected);
});

// OCR words in textLayer shape: one entry per word at pixel positions.
function wordsFor(lines, { lineHeight = 30, charW = 12 } = {}) {
  const words = [];
  lines.forEach((cols, i) => {
    const top = 100 + i * lineHeight * 1.4;
    for (const [x, text] of cols) {
      let cx = x;
      for (const w of text.split(" ")) {
        words.push({ text: w, x0: cx, x1: cx + w.length * charW, top, bottom: top + lineHeight, baseline: top + lineHeight, fontSize: lineHeight, fontName: "", spacesBefore: null });
        cx += (w.length + 1) * charW;
      }
    }
  });
  return words;
}

test("looksTabular accepts a table layout and rejects prose", () => {
  const table = wordsFor([
    [[50, "Region"], [600, "2025"], [800, "2024"]],
    [[50, "Europe"], [600, "845.2"], [800, "790.4"]],
    [[50, "Asia Pacific"], [600, "612.8"], [800, "540.3"]],
    [[50, "North America"], [600, "1,234.5"], [800, "1,101.9"]],
  ]);
  assert.strictEqual(looksTabular(table, 1200), true);
  const prose = wordsFor([
    [[50, "Revenue grew in every region this year, led by North America and"]],
    [[50, "Europe, while Asia Pacific recovered from a weak first half of the"]],
    [[50, "year. The board expects growth to continue into the next period."]],
    [[50, "Margins improved as costs fell across all the operating segments."]],
  ]);
  assert.strictEqual(looksTabular(prose, 1200), false);
});

test("figureLooksTabular uses the caption or numeric OCR lines", () => {
  assert.ok(figureLooksTabular({ caption: "A table listing revenue by region for 2024 and 2025.", ocr_text: "" }));
  assert.ok(figureLooksTabular({ caption: "A scanned page.", ocr_text: "Europe 845.2 790.4\nAsia 612.8 540.3\nTotal 1,458.0 1,330.7" }));
  assert.ok(!figureLooksTabular({ caption: "A photo of the company headquarters.", ocr_text: "ACME 2025" }));
});

test("fixDigitLookalikes repairs letters inside numbers only", () => {
  assert.strictEqual(fixDigitLookalikes("Europe 8O4.5 l,234"), "Europe 804.5 1,234");
  assert.strictEqual(fixDigitLookalikes("Oslo Italy"), "Oslo Italy");
});

test("images are a supported table source", () => {
  assert.ok(supportsTables("scan.PNG"));
  assert.ok(supportsTables("photo.jpeg"));
  assert.ok(!supportsTables("notes.txt"));
});
