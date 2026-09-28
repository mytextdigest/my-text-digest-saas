import test from "node:test";
import assert from "node:assert";
import * as XLSX from "xlsx";
import { verifyGrid, verifyCleanAgainstRaw, numericTokens } from "../verify.js";
import { repairLowConfidence } from "../repair.js";
import { titleTables, titleFromCaption, fallbackTitle } from "../title.js";
import { sanitiseSheetName, exportTable, exportAll } from "../export.js";
import { mergeContinuations } from "../pdf/continuation.js";
import { toChunkTexts, toCSV, toMarkdown, toContextBlock, signature } from "../serialize.js";
import { buildClean } from "../clean.js";
import { makeRawTable } from "../schema.js";
import { tableToFacts } from "../toFacts.js";
import { computeTableStats } from "../stats.js";

const fakeOpenAI = (content) => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) } } });

test("verify rejects an injected number", () => {
  const source = "Region 2025 2024\nEurope 845.2 790.4\nAsia 612.8 540.3";
  assert.strictEqual(verifyGrid([["Europe", "845.2", "790.4"]], source).issues, 0);
  assert.strictEqual(verifyGrid([["Europe", "845.2", "999.9"]], source).issues, 1);
  assert.deepStrictEqual(numericTokens("(1,234.5) and 2025 2024"), ["1234.5", "2025", "2024"]);
});

test("verify accepts adjacent 3-digit cells that look space-grouped", () => {
  assert.strictEqual(verifyGrid([["Engineering", "842", "701"]], "Engineering 842 701").issues, 0);
  assert.strictEqual(verifyGrid([["Engineering", "843", "701"]], "Engineering 842 701").issues, 1);
});

test("verify accepts a number wrapped across lines", () => {
  assert.strictEqual(verifyGrid([["Total", "2,437,200"]], "2,437,20\nTotal 2,205,700\n0").issues, 0);
});

test("verifyCleanAgainstRaw flags values not derivable from raw", () => {
  const t = buildClean(makeRawTable([["Item", "2025"], ["A", "10"], ["B", "20"]], { headerRows: 1 }));
  assert.strictEqual(verifyCleanAgainstRaw(t), 0);
  t.rows[0].cells[1].v = 11;
  assert.strictEqual(verifyCleanAgainstRaw(t), 1);
  assert.strictEqual(t.rows[0].cells[1].flag, "ungrounded");
});

test("repair: tampered LLM output (new number) is rejected, faithful output accepted", async () => {
  const cand = () => ({
    lowConfidence: true, sourceType: "pdf_text", pageStart: 1, caption: null,
    raw: makeRawTable([["Europe 845.2", "790.4"]]),
    lines: [[{ text: "Region", x: 10 }, { text: "2025", x: 100 }], [{ text: "Europe", x: 10 }, { text: "845.2", x: 100 }], [{ text: "Asia", x: 10 }, { text: "612.8", x: 100 }]],
    sourceText: "Region 2025\nEurope 845.2\nAsia 612.8",
  });
  const tampered = cand();
  assert.strictEqual(await repairLowConfidence(fakeOpenAI({ headerRows: 1, rows: [["Region", "2025"], ["Europe", "845.9"], ["Asia", "612.8"]] }), [tampered]), 0);
  assert.ok(!tampered.repaired);
  const invented = cand();
  assert.strictEqual(await repairLowConfidence(fakeOpenAI({ headerRows: 1, rows: [["Region", "2025"], ["Europa", "845.2"], ["Asia", "612.8"]] }), [invented]), 0);
  const good = cand();
  assert.strictEqual(await repairLowConfidence(fakeOpenAI({ headerRows: 1, rows: [["Region", "2025"], ["Europe", "845.2"], ["Asia", "612.8"]] }), [good]), 1);
  assert.strictEqual(good.raw.rows.length, 3);
});

test("titles: caption first, one batched LLM call, fallback, de-duplication", async () => {
  assert.strictEqual(titleFromCaption("Table 1: Revenue by Region (in $ millions)"), "Revenue by Region");
  assert.strictEqual(titleFromCaption("Exhibit 4.2 – Headcount"), "Headcount");
  assert.strictEqual(titleFromCaption("Some paragraph"), null);

  let calls = 0;
  const openai = { chat: { completions: { create: async () => { calls++; return { choices: [{ message: { content: JSON.stringify({ tables: [{ i: 1, title: "Operating Expenses", description: "Costs by category." }, { i: 2, title: "Operating Expenses", description: "" }] }) } }] }; } } } };
  const t = buildClean(makeRawTable([["Region", "2025"], ["Europe", "1"], ["Asia", "2"]], { headerRows: 1 }));
  const items = [
    { clean: t, caption: "Table 1: Revenue by Region" },
    { clean: t, caption: null, pageStart: 4 },
    { clean: t, caption: null, pageStart: 9 },
  ];
  await titleTables(openai, items, { docName: "x.pdf" });
  assert.strictEqual(calls, 1);
  assert.strictEqual(items[0].title, "Revenue by Region");
  assert.strictEqual(items[0].titleSource, "caption");
  assert.strictEqual(items[1].title, "Operating Expenses (2025)");
  assert.notStrictEqual(items[1].title, items[2].title);

  const off = [{ clean: buildClean(makeRawTable([["", { raw: "Revenue", colSpan: 2 }, { raw: "", spanned: true }], ["Region", "2025", "2024"], ["EU", "1", "2"]], { headerRows: 2 })) }];
  await titleTables(null, off, { useLLM: false });
  assert.strictEqual(off[0].title, "Revenue by Region");
  assert.strictEqual(fallbackTitle(null, 2), "Table 3");
});

test("export: sheet names are sanitised and unique; XLSX keeps numbers numeric", () => {
  const used = new Set();
  assert.strictEqual(sanitiseSheetName("Revenue [by]: region/area?*", used), "Revenue by region area");
  assert.strictEqual(sanitiseSheetName("Revenue [by]: region/area?*", used), "Revenue by region area (2)");
  assert.ok(sanitiseSheetName("x".repeat(50), used).length <= 31);

  const t = buildClean(makeRawTable([["Region", "2025"], ["Europe", "1,234.5"], ["Asia", "(12.0)"]], { headerRows: 1 }), { caption: "(in $ millions)" });
  const { data } = exportTable(t, "xlsx", { title: "Revenue by Region" });
  const wb = XLSX.read(data, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  assert.strictEqual(ws.A1.v, "Region");
  assert.strictEqual(ws.B1.v, "2025 (USD millions)");
  assert.strictEqual(ws.B2.t, "n");
  assert.strictEqual(ws.B2.v, 1234.5);
  assert.strictEqual(ws.B3.v, -12);

  const all = XLSX.read(exportAll([{ table: t, title: "Revenue by Region", pageStart: 3 }, { table: t, title: "Revenue by Region", pageStart: 5 }], { docName: "r.pdf" }), { type: "buffer" });
  assert.strictEqual(all.SheetNames.length, 3);
  assert.strictEqual(all.SheetNames[0], "Index");
  assert.notStrictEqual(all.SheetNames[1], all.SheetNames[2]);

  assert.strictEqual(toCSV(t).split("\r\n")[2], "Asia,-12");
});

test("continuation merges a table split across pages and drops the repeated header", () => {
  const part = (page, rows, top, bottom) => ({
    raw: makeRawTable([["City", "Stores"], ...rows], { headerRows: 1, provenance: { pages: [page], cellBoxes: {} } }),
    pageStart: page, pageEnd: page, caption: page === 2 ? "Table 3: Stores" : null, confidence: 0.9,
    headerTexts: ["City|Stores"], colCentres: [80, 200], top, bottom, pageHeight: 842, sourceText: "", lines: [],
  });
  const merged = mergeContinuations([part(2, [["Boston", "5"], ["Paris", "3"]], 400, 800), part(3, [["Rome", "4"]], 40, 120)]);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].pageEnd, 3);
  assert.strictEqual(merged[0].raw.rows.length, 4);
  assert.strictEqual(new Set(merged[0].raw.rows.map((r) => r.id)).size, 4);

  const notMerged = mergeContinuations([part(2, [["a", "1"], ["b", "2"]], 100, 300), part(3, [["c", "3"]], 40, 120)]);
  assert.strictEqual(notMerged.length, 2, "a table in the middle of a page does not continue");
});

test("serialize: chunk text, markdown, context block, signature", () => {
  const t = buildClean(makeRawTable([["Region", "2025"], ["Europe", "845.2"], ["Total", "845.2"]], { headerRows: 1 }), { caption: "(in $ millions)" });
  const [chunk] = toChunkTexts(t, { docName: "r.pdf", tableIndex: 1, title: "Revenue by Region", pageStart: 12 });
  assert.match(chunk, /^\[Document: r\.pdf\] \[Table 2: Revenue by Region\] \[Page 12\] \[Units: USD millions\]/);
  assert.match(chunk, /Row 1: Region=Europe, 2025=845.2/);
  assert.match(toMarkdown(t), /\| \*\*Total\*\* \| 845.2 \|/);
  const big = buildClean(makeRawTable([["k", "v"], ...Array.from({ length: 500 }, (_, i) => [`row ${i}`, String(i)])], { headerRows: 1 }));
  assert.ok(toContextBlock(big, { title: "Big" }, 1000).length <= 1100);
  assert.ok(toChunkTexts(big, { title: "Big" }, 2000).length > 1);
  assert.match(signature(t, { title: "Revenue by Region" }), /Rows: Europe/);
});

test("toFacts and stats use exact cell values and skip totals", () => {
  const t = buildClean(makeRawTable([["", { raw: "Revenue", colSpan: 1 }], ["Region", "2025"], ["Europe", "845.2"], ["Asia", "612.8"], ["Total", "1,458.0"]], { headerRows: 2 }), { caption: "(in $ millions)" });
  const facts = tableToFacts({ title: "Revenue by Region", page_start: 3 }, t);
  assert.strictEqual(facts[0].name, "Europe Revenue (2025)");
  assert.strictEqual(facts[0].value, "845.2");
  assert.strictEqual(facts[0].unit, "USD millions");
  const stats = computeTableStats(t);
  assert.strictEqual(stats.rowCount, 2);
  assert.strictEqual(stats.columns[1].sum, 1458);
  assert.strictEqual(stats.columns[1].maxLabel, "Europe");
});
