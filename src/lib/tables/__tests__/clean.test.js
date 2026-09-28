import test from "node:test";
import assert from "node:assert";
import {
  parseNumber, detectLocale, parsePeriod, inferUnits, promoteHeaders, dropEmpty, buildClean,
  classifyRows, inferColumnTypes, applyAction, recleanEdited,
} from "../clean.js";
import { makeRawTable, validateTable } from "../schema.js";

// [input, expected v, extra expectations]
const NUMBER_CASES = [
  ["1,234.5", 1234.5], ["1234.5", 1234.5], ["0.5", 0.5], [".5", 0.5], ["12", 12], ["1,000,000", 1000000],
  ["(12.0)", -12], ["(1,102)", -1102], ["-123", -123], ["−123", -123], ["–123", -123], ["+4.5", 4.5],
  ["12%", 12, { kind: "percent" }], ["12.5 %", 12.5, { kind: "percent" }], ["(3.2%)", -3.2, { kind: "percent" }], ["-0.4%", -0.4, { kind: "percent" }],
  ["$1.2", 1.2, { kind: "currency", currency: "USD" }], ["$ 1,200", 1200, { currency: "USD" }], ["US$ 45", 45, { currency: "USD" }],
  ["€3m", 3e6, { currency: "EUR" }], ["£2.5bn", 2.5e9, { currency: "GBP" }], ["¥500", 500, { currency: "JPY" }], ["$1.2b", 1.2e9],
  ["$(3.4)", -3.4, { currency: "USD" }], ["-$3.4", -3.4], ["USD 100", 100, { currency: "USD" }], ["1.234,5 €", 1234.5, { locale: "eu", currency: "EUR" }],
  ["1.2x", 1.2, { kind: "multiple" }], ["3.0x", 3, { kind: "multiple" }],
  ["123a", 123, { note: "a" }], ["45*", 45, { note: "*" }], ["(1,102)¹", -1102, { note: "1" }], ["7.5 (b)", 7.5, { note: "b" }], ["88†", 88, { note: "†" }],
  ["1 234 567", 1234567], ["1 234", 1234],
  ["1.234,5", 1234.5, { locale: "eu" }], ["12,5", 12.5, { locale: "eu" }], ["1.234.567", 1234567, { locale: "eu" }], ["(1.234,5)", -1234.5, { locale: "eu" }],
  ["—", null, { kind: "null" }], ["–", null, { kind: "null" }], ["-", null, { kind: "null" }], ["n/a", null, { kind: "null" }], ["N/A", null, { kind: "null" }],
  ["nm", null, { kind: "null" }], ["n.m.", null, { kind: "null" }], ["", null, { kind: "empty" }], ["   ", null, { kind: "empty" }],
  ["Revenue", null, { kind: "text" }], ["North America", null, { kind: "text" }], ["12,5", null, { kind: "text" }], ["abc123", null, { kind: "text" }],
  ["2025", 2025],
];

test("parseNumber handles common formats", () => {
  for (const [input, v, extra = {}] of NUMBER_CASES) {
    const r = parseNumber(input, extra.locale || "en");
    assert.strictEqual(r.v, v, `v for ${JSON.stringify(input)}: got ${r.v}`);
    for (const k of ["kind", "note", "currency"]) if (extra[k] !== undefined) assert.strictEqual(r[k], extra[k], `${k} for ${input}`);
  }
  assert.ok(NUMBER_CASES.length >= 50);
});

test("detectLocale picks the majority convention", () => {
  assert.strictEqual(detectLocale(["1,234.5", "2,000.25", "12.5"]), "en");
  assert.strictEqual(detectLocale(["1.234,5", "2.000,25", "12,5"]), "eu");
});

test("parsePeriod recognises reporting periods", () => {
  const cases = { FY2025: "FY2025", "FY 24": "FY2024", 2024: "2024", "2024E": "2024", "Q1 2025": "Q1 2025", "2025 Q3": "Q3 2025",
    "H2 24": "H2 2024", "2024/25": "2024/25", "Year ended December 31, 2024": "2024", Revenue: null, "12": null };
  for (const [input, want] of Object.entries(cases)) assert.strictEqual(parsePeriod(input), want, input);
});

test("inferUnits reads unit phrases", () => {
  const cases = {
    "Table 1: Revenue by Region (in $ millions)": "USD millions", "USD '000": "USD thousands", "€m": "EUR millions",
    "(%)": "%", "Amounts in thousands of euros": "EUR thousands", "(in millions)": "millions", "£bn": "GBP billions",
    "Table 3: Headcount": null, "": null,
  };
  for (const [input, want] of Object.entries(cases)) assert.strictEqual(inferUnits(input), want, input);
});

test("promoteHeaders flattens spanning multi-row headers", () => {
  const raw = makeRawTable([
    [{ raw: "" }, { raw: "Revenue", colSpan: 2 }, { raw: "", spanned: true }],
    ["Region", "2025", "2024"],
    ["Europe", "845.2", "790.4"],
  ], { headerRows: 2 });
  const t = promoteHeaders(raw);
  assert.deepStrictEqual(t.columns.map((c) => c.label), ["Region", "2025", "2024"]);
  assert.deepStrictEqual(t.columns[1].headerPath, ["Revenue", "2025"]);
  assert.strictEqual(t.rows.length, 1);
});

test("promoteHeaders joins non-shared parents", () => {
  const raw = makeRawTable([
    ["", { raw: "Revenue", colSpan: 2 }, { raw: "", spanned: true }, { raw: "Margin", colSpan: 2 }, { raw: "", spanned: true }],
    ["Segment", "2025", "2024", "2025", "2024"],
    ["A", "1", "2", "3", "4"],
  ], { headerRows: 2 });
  const t = promoteHeaders(raw);
  assert.deepStrictEqual(t.columns.map((c) => c.label), ["Segment", "Revenue › 2025", "Revenue › 2024", "Margin › 2025", "Margin › 2024"]);
});

test("auto header detection when none is marked", () => {
  const t = promoteHeaders(makeRawTable([["Item", "Q1 2025", "Q2 2025"], ["A", "1", "2"], ["B", "3", "4"]]));
  assert.deepStrictEqual(t.columns.map((c) => c.label), ["Item", "Q1 2025", "Q2 2025"]);
  assert.strictEqual(t.rows.length, 2);
});

test("dropEmpty removes empty rows and columns but keeps ids", () => {
  const t = dropEmpty(makeRawTable([["a", "", "1"], ["", "", ""], ["b", "", "2"]]));
  assert.deepStrictEqual(t.columns.map((c) => c.id), ["c0", "c2"]);
  assert.deepStrictEqual(t.rows.map((r) => r.id), ["r0", "r2"]);
});

test("classifyRows finds sections, totals and unlabelled sum rows", () => {
  let t = buildClean(makeRawTable([
    ["Item", "2025"], ["Operating expenses", ""], ["R&D", "10"], ["Sales", "20"], ["Admin", "5"], ["Subtotal", "35"], ["Total costs", "35"],
  ], { headerRows: 1 }));
  assert.deepStrictEqual(t.rows.map((r) => r.kind), ["section", "data", "data", "data", "subtotal", "total"]);
  t = buildClean(makeRawTable([["Item", "Value"], ["A", "10"], ["B", "20"], ["C", "5"], ["", "35"]], { headerRows: 1 }));
  assert.strictEqual(t.rows[t.rows.length - 1].kind, "total");
});

test("inferColumnTypes: 80% rule, percent columns, units", () => {
  const t = buildClean(makeRawTable([["Method", "F1", "Cost"], ["A", "61.2%", "$10"], ["B", "—", "$12"], ["C", "63.0%", "$9"]], { headerRows: 1 }));
  assert.deepStrictEqual(t.columns.map((c) => c.type), ["text", "percent", "currency"]);
  assert.strictEqual(t.columns[1].unit, "%");
  assert.strictEqual(t.columns[2].unit, "USD");
  assert.strictEqual(t.rows[1].cells[1].v, null);
});

test("user actions: transpose, promote header, types, units, removals", () => {
  const base = buildClean(makeRawTable([["Region", "2025", "2024"], ["Europe", "845.2", "790.4"], ["Asia", "612.8", "540.3"]], { headerRows: 1 }));
  const tr = applyAction(base, "transpose");
  assert.deepStrictEqual(tr.columns.map((c) => c.label), ["Region", "Europe", "Asia"]);
  assert.strictEqual(tr.rows[0].cells[1].v, 845.2);

  const raw = buildClean(makeRawTable([["x", "y"], ["Region", "2025"], ["Europe", "1"], ["Asia", "2"]], { headerRows: 0 }));
  const promoted = applyAction(raw, "promoteRowToHeader", { rowId: raw.rows[0].id });
  assert.strictEqual(promoted.columns[1].label, "2025");

  const typed = applyAction(base, "setColumnType", { colId: "c1", type: "text" });
  assert.strictEqual(typed.columns[1].type, "text");
  assert.strictEqual(typed.rows[0].cells[1].v, "845.2");

  const unit = applyAction(base, "setUnit", { unit: "EUR millions" });
  assert.strictEqual(unit.tableUnit, "EUR millions");
  assert.strictEqual(unit.columns[1].unit, "EUR millions");

  assert.strictEqual(applyAction(base, "removeRows", { rowIds: [base.rows[0].id] }).rows.length, 1);
  assert.strictEqual(applyAction(base, "removeCols", { colIds: ["c2"] }).columns.length, 2);
  assert.throws(() => applyAction(base, "nope"));
});

test("edited tables are re-derived from raw text, not trusted values", () => {
  const base = buildClean(makeRawTable([["Region", "2025"], ["Europe", "845.2"], ["Asia", "612.8"]], { headerRows: 1 }));
  const input = JSON.parse(JSON.stringify(base));
  input.rows[0].cells[1] = { raw: "900.0", v: 123456 }; // renderer-supplied v is ignored
  const edited = recleanEdited(validateTable(input), { previous: base });
  assert.strictEqual(edited.rows[0].cells[1].v, 900);
  assert.throws(() => validateTable({ columns: [], rows: [] }));
});
