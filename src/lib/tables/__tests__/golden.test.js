// Golden fixtures: every fixture document is extracted and compared with the
// ground truth in fixtures/expected.json (written by fixtures/src/make.js
// from the same data used to build the documents). Fails when detection
// precision/recall or cell accuracy drop below the requirements' thresholds.
import test from "node:test";
import assert from "node:assert";
import path from "path";
import { extractTables } from "../index.js";

import fs from "fs";

const FIXTURES = path.join(import.meta.dirname, "fixtures");
const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, "expected.json"), "utf8"));

const THRESHOLDS = {
  pdf: { precision: 0.9, recall: 0.9 },
  docx: { precision: 0.98, recall: 0.98 },
  cellAccuracy: 0.97,
};

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// Matches each expected table to the extracted table with the same caption.
function score(extracted, truth) {
  let matched = 0, cells = 0, correct = 0;
  const details = [];
  for (const exp of truth) {
    const got = extracted.find((t) => norm(t.caption) === norm(exp.caption));
    if (!got) { details.push(`missing: ${exp.caption}`); continue; }
    matched++;
    const eff = got.clean;
    const labels = eff.columns.map((c) => norm(c.label));
    exp.headers.forEach((h, j) => { cells++; if (labels[j] === norm(h)) correct++; else details.push(`${exp.caption} header ${j}: "${labels[j]}" ≠ "${h}"`); });
    exp.rows.forEach((row, i) => row.forEach((val, j) => {
      cells++;
      const cell = eff.rows[i]?.cells[j];
      if (cell && norm(cell.raw) === norm(val)) correct++;
      else if (details.length < 20) details.push(`${exp.caption} r${i}c${j}: "${cell?.raw}" ≠ "${val}"`);
    }));
    if (eff.rows.length !== exp.rows.length) details.push(`${exp.caption}: ${eff.rows.length} rows ≠ ${exp.rows.length}`);
    if (exp.multiPage) assert.ok(got.pageStart == null || got.pageEnd > got.pageStart, `${exp.caption} should span pages`);
  }
  return {
    precision: extracted.length ? matched / extracted.length : 1,
    recall: truth.length ? matched / truth.length : 1,
    cellAccuracy: cells ? correct / cells : 1,
    details,
  };
}

for (const [name, truth] of Object.entries(expected)) {
  for (const ext of ["pdf", "docx"]) {
    test(`golden: ${name}.${ext}`, async () => {
      const { tables } = await extractTables(`${name}.${ext}`, path.join(FIXTURES, `${name}.${ext}`));
      const s = score(tables, truth);
      const t = THRESHOLDS[ext];
      assert.ok(s.precision >= t.precision, `precision ${s.precision.toFixed(2)} < ${t.precision}\n${s.details.join("\n")}`);
      assert.ok(s.recall >= t.recall, `recall ${s.recall.toFixed(2)} < ${t.recall}\n${s.details.join("\n")}`);
      assert.ok(s.cellAccuracy >= THRESHOLDS.cellAccuracy, `cell accuracy ${s.cellAccuracy.toFixed(3)}\n${s.details.join("\n")}`);
      // Zero ungrounded numbers (NFR).
      for (const tb of tables) assert.strictEqual(tb.groundingIssues, 0, `${tb.caption}: ${tb.groundingIssues} ungrounded`);
      // Caption-derived titles.
      for (const exp of truth) {
        const got = tables.find((x) => norm(x.caption) === norm(exp.caption));
        if (got) assert.strictEqual(got.title, exp.title);
      }
    });
  }
}

test("golden: table of contents and layout tables are not detected", async () => {
  const pdf = await extractTables("research_paper.pdf", path.join(FIXTURES, "research_paper.pdf"));
  assert.ok(!pdf.tables.some((t) => /introduction|contents/i.test(JSON.stringify(t.clean.rows))), "TOC detected as a table");
  const docx = await extractTables("research_paper.docx", path.join(FIXTURES, "research_paper.docx"));
  assert.strictEqual(docx.tables.length, 2);
});

test("golden: units, periods and totals are inferred", async () => {
  const { tables } = await extractTables("annual_report_2025.pdf", path.join(FIXTURES, "annual_report_2025.pdf"));
  const revenue = tables.find((t) => /Revenue by Region/.test(t.caption)).clean;
  assert.strictEqual(revenue.tableUnit, "USD millions");
  assert.deepStrictEqual(revenue.columns.map((c) => c.period || null), [null, "2025", "2024"]);
  assert.deepStrictEqual(revenue.columns[1].headerPath, ["Revenue", "2025"]);
  assert.strictEqual(revenue.rows[3].cells[1].v, -12);
  assert.strictEqual(revenue.rows[4].kind, "total");
});
