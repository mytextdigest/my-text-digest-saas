// src/lib/tables/schema.js
// Helpers for the canonical table JSON shared by the raw, clean and edited
// layers (see docs/AUTOMATIC_TABLE_EXTRACTION_IMPLEMENTATION_PLAN.md §2).
//
// Raw grids are stored *expanded*: every row has exactly one cell per column.
// A cell that is covered by another cell's colSpan/rowSpan is kept as
// `{ raw: "", spanned: true }` so column positions stay stable everywhere.

const ROW_KINDS = new Set(["header", "data", "section", "subtotal", "total"]);
const COLUMN_TYPES = new Set(["text", "number", "currency", "percent", "date"]);

// grid: string[][] (or cell objects), already rectangular or not — pads it.
// headerRows: how many leading rows are header rows.
function makeRawTable(grid, { headerRows = 0, caption = null, provenance = null, extraCells = null } = {}) {
  const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const columns = Array.from({ length: width }, (_, j) => ({ id: `c${j}` }));
  const rows = grid.map((r, i) => ({
    id: `r${i}`,
    kind: i < headerRows ? "header" : "data",
    cells: Array.from({ length: width }, (_, j) => {
      const c = r[j];
      if (c == null) return { raw: "" };
      if (typeof c === "string") return { raw: c };
      return { ...c, raw: c.raw == null ? "" : String(c.raw) };
    }),
  }));
  const table = { columns, rows, provenance: provenance || {} };
  if (caption) table.caption = caption;
  if (extraCells) Object.assign(table, extraCells);
  return table;
}

function cloneTable(t) {
  return JSON.parse(JSON.stringify(t));
}

// The table a user sees and every downstream feature reads: the user's edit
// when there is one, otherwise the automatically cleaned layer.
function effectiveTableOf(record) {
  if (!record) return null;
  const parse = (s) => {
    if (!s) return null;
    if (typeof s === "object") return s;
    try { return JSON.parse(s); } catch { return null; }
  };
  return parse(record.edited_json) || parse(record.clean_json) || parse(record.raw_json);
}

function cellDisplay(cell) {
  if (!cell) return "";
  return cell.raw == null ? "" : String(cell.raw);
}

// Validates and normalises a table coming from the renderer (edits). Throws
// with a human-readable message on anything structurally wrong; never trusts
// the renderer's `v` values for numbers — callers re-derive them.
function validateTable(input) {
  if (!input || typeof input !== "object") throw new Error("Table must be an object.");
  if (!Array.isArray(input.columns) || input.columns.length === 0) throw new Error("Table needs at least one column.");
  if (!Array.isArray(input.rows)) throw new Error("Table rows must be an array.");
  const width = input.columns.length;
  const seenCol = new Set();
  const columns = input.columns.map((c, j) => {
    let id = c && typeof c.id === "string" && c.id ? c.id : `c${j}`;
    while (seenCol.has(id)) id = `${id}_`;
    seenCol.add(id);
    const col = {
      id,
      label: String(c?.label ?? "").slice(0, 300),
      headerPath: Array.isArray(c?.headerPath) ? c.headerPath.map((h) => String(h).slice(0, 300)) : [String(c?.label ?? "")],
      type: COLUMN_TYPES.has(c?.type) ? c.type : "text",
      unit: c?.unit ? String(c.unit).slice(0, 80) : null,
    };
    if (c?.period) col.period = String(c.period).slice(0, 40);
    if (c?.typeLocked) col.typeLocked = true;
    return col;
  });
  const seenRow = new Set();
  const rows = input.rows.map((r, i) => {
    let id = r && typeof r.id === "string" && r.id ? r.id : `r${i}`;
    while (seenRow.has(id)) id = `${id}_`;
    seenRow.add(id);
    const cells = Array.isArray(r?.cells) ? r.cells : [];
    return {
      id,
      kind: ROW_KINDS.has(r?.kind) && r.kind !== "header" ? r.kind : "data",
      cells: Array.from({ length: width }, (_, j) => {
        const c = cells[j];
        const raw = c == null ? "" : typeof c === "object" ? String(c.raw ?? "") : String(c);
        return { raw: raw.slice(0, 2000) };
      }),
    };
  });
  const out = { columns, rows };
  if (input.tableUnit) out.tableUnit = String(input.tableUnit).slice(0, 80);
  if (Array.isArray(input.notes)) {
    out.notes = input.notes
      .filter((n) => n && n.text)
      .map((n) => ({ marker: String(n.marker ?? "").slice(0, 8), text: String(n.text).slice(0, 1000) }));
  }
  return out;
}

function countCells(t) {
  return (t?.rows?.length || 0) * (t?.columns?.length || 0);
}

export {
  ROW_KINDS,
  COLUMN_TYPES,
  makeRawTable,
  cloneTable,
  effectiveTableOf,
  cellDisplay,
  validateTable,
  countCells,
};
