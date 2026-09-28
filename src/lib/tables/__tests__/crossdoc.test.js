import test from "node:test";
import assert from "node:assert";
import { normLabel, alignRows, alignRowsDeterministic } from "../align.js";
import { deriveComparison, convertUnit } from "../derive.js";
import { buildClean } from "../clean.js";
import { makeRawTable } from "../schema.js";

const clean = (grid, caption) => buildClean(makeRawTable(grid, { headerRows: 1 }), { caption });

const report2024 = clean([
  ["Region", "2024", "2023"],
  ["N. America", "1,098,000", "990,500"],
  ["Europe", "790,400", "701,200"],
  ["APAC", "540,300", "498,100"],
  ["Middle East", "10,000", "9,000"],
  ["Total", "2,438,700", "2,198,800"],
], "Revenue by Region (in $ thousands)");

const report2025 = clean([
  ["Region", "2025", "2024"],
  ["North America", "1,234.5", "1,102.0"],
  ["Europe", "845.2", "790.4"],
  ["Asia Pacific", "612.8", "540.3"],
  ["Latin America", "(12.0)", "8.5"],
  ["Total", "2,680.5", "2,441.2"],
], "Revenue by Region (in $ millions)");

const src = (id, name, table, createdAt) => ({ documentId: id, documentName: name, createdAt, tableId: id * 10, tableTitle: "Revenue by Region", pageStart: 3, table });

test("normLabel expands abbreviations and drops noise", () => {
  assert.strictEqual(normLabel("N. America"), normLabel("North America"));
  assert.strictEqual(normLabel("APAC"), normLabel("Asia Pacific region"));
  assert.strictEqual(normLabel("R&D"), normLabel("Research & development"));
  assert.strictEqual(normLabel("General and administrative (a)"), "general and administrative");
});

test("alignRows never uses a label twice", () => {
  const a = [{ id: "a1", label: "Europe" }, { id: "a2", label: "Europe " }];
  const b = [{ id: "b1", label: "europe" }];
  const r = alignRowsDeterministic(a, b);
  assert.strictEqual(r.pairs.length, 1);
  assert.strictEqual(r.unmatchedA.length, 1);
});

test("alignRows LLM pass is validated", async () => {
  const fake = { chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify({ pairs: [["Widgets", "Gadgets"], ["Ghost", "Europe"], ["Widgets", "Other"]] }) } }] }) } } };
  const r = await alignRows([{ id: "a", label: "Widgets" }], [{ id: "b", label: "Gadgets" }, { id: "c", label: "Other" }], { openai: fake });
  assert.strictEqual(r.pairs.length, 1);
  assert.strictEqual(r.pairs[0].b.id, "b");
});

test("convertUnit converts scale only within one currency", () => {
  assert.deepStrictEqual(convertUnit(1500, "USD thousands", "USD millions"), { v: 1.5, converted: true, mismatch: false });
  assert.strictEqual(convertUnit(1500, "EUR thousands", "USD millions").mismatch, true);
  assert.strictEqual(convertUnit(1500, null, "USD millions").mismatch, true);
  assert.strictEqual(convertUnit(1500, "USD millions", "USD millions").converted, false);
});

test("derive: revenue by region across two reports (acceptance criterion 6)", async () => {
  const r = await deriveComparison([src(1, "annual_report_2024.pdf", report2024, "2026-01-01"), src(2, "annual_report_2025.pdf", report2025, "2026-02-01")], {}, { useLLM: false });
  const labels = r.table.columns.map((c) => c.label);
  assert.deepStrictEqual(labels, ["Region", "2024", "2025", "Change", "Change %"]);
  const na = r.table.rows.find((row) => row.cells[0].raw === "North America");
  assert.strictEqual(na.cells[1].v, 1102); // newer document's (restated) 2024 figure
  assert.strictEqual(na.cells[2].v, 1234.5);
  assert.strictEqual(Math.round(na.cells[3].v * 10) / 10, 132.5);
  assert.strictEqual(Math.round(na.cells[4].v * 10) / 10, 12);
  assert.ok(na.cells[2].src && na.cells[2].src.documentId === 2);
  assert.ok(r.warnings.some((w) => w.type === "restatement"));
  assert.ok(r.warnings.some((w) => w.type === "unmatched_rows" && /Middle East/.test(w.message)));
  const latam = r.table.rows.find((row) => row.cells[0].raw === "Latin America");
  assert.strictEqual(Math.round(latam.cells[3].v * 10) / 10, -20.5);
  assert.strictEqual(r.table.rows[r.table.rows.length - 1].kind, "total");
});

test("derive: explicit periods pull from the older report with unit conversion", async () => {
  const r = await deriveComparison([src(1, "a2024.pdf", report2024, "2026-01-01"), src(2, "a2025.pdf", report2025, "2026-02-01")], { periods: ["2023", "2025"], rowFilter: ["Europe"] }, { useLLM: false });
  assert.strictEqual(r.table.rows.length, 1);
  assert.strictEqual(r.table.rows[0].cells[1].v, 701.2); // 701,200 thousands → millions
  assert.strictEqual(r.table.rows[0].cells[1].raw, "701.2");
  assert.ok(r.warnings.some((w) => w.type === "unit_converted"));
});

test("derive: different currencies are flagged, not converted", async () => {
  const eur = clean([["Region", "2025"], ["Europe", "800"], ["Asia", "600"]], "(in € millions)");
  const usd = clean([["Region", "2024"], ["Europe", "700"], ["Asia", "500"]], "(in $ millions)");
  const r = await deriveComparison([src(1, "usd.pdf", usd, "1"), src(2, "eur.pdf", eur, "2")], {}, { useLLM: false });
  assert.ok(r.warnings.some((w) => w.type === "unit_mismatch"));
  assert.strictEqual(r.table.rows[0].cells[1].v, 700);
});

test("derive: zero or missing base gives no percentage", async () => {
  const a = clean([["Item", "2024"], ["A", "0"], ["B", "—"]], "(in $ millions)");
  const b = clean([["Item", "2025"], ["A", "5"], ["B", "3"]], "(in $ millions)");
  const r = await deriveComparison([src(1, "a.pdf", a, "1"), src(2, "b.pdf", b, "2")], {}, { useLLM: false });
  assert.strictEqual(r.table.rows[0].cells[4].v, null);
  assert.strictEqual(r.table.rows[0].cells[3].v, 5);
  assert.strictEqual(r.table.rows[1].cells[3].v, null);
});

test("derive: tables without periods get one column per document", async () => {
  const a = clean([["Metric", "Value"], ["Headcount", "120"], ["Offices", "4"]]);
  const b = clean([["Metric", "Value"], ["Headcount", "150"], ["Offices", "5"]]);
  const r = await deriveComparison([src(1, "a.pdf", a, "1"), src(2, "b.pdf", b, "2")], {}, { useLLM: false });
  const labels = r.table.columns.map((c) => c.label);
  assert.strictEqual(labels[0], "Metric");
  assert.deepStrictEqual(labels.slice(1).sort(), ["a.pdf", "b.pdf"]);
  assert.strictEqual(r.table.rows.find((row) => row.cells[0].raw === "Headcount").cells.length, 3);
});

test("derive: total mismatch is flagged", async () => {
  const a = clean([["Item", "2024"], ["A", "1"], ["B", "2"], ["Total", "3"]], "(in $ millions)");
  const b = clean([["Item", "2025"], ["A", "1"], ["B", "2"], ["Total", "9"]], "(in $ millions)");
  const r = await deriveComparison([src(1, "a.pdf", a, "1"), src(2, "b.pdf", b, "2")], {}, { useLLM: false });
  assert.ok(r.warnings.some((w) => w.type === "total_mismatch"));
});
