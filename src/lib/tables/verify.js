// src/lib/tables/verify.js
// Grounding check (FR-9): every number shown for a table must come from the
// source document. LLM repair output is checked against the source tokens of
// its region; the clean layer is checked against its own raw text.
import { parseNumber } from "./clean.js";

// Numeric tokens in a string, normalised: thousands separators, currency
// symbols and spaces removed; decimal point kept. "(1,234.5)" → "1234.5".
function rawNumericTokens(text) {
  // A space continues a number only as a thousands separator ("1 234 567"):
  // exactly three digits must follow. "2025 2024" is two tokens. A trailing
  // separator is kept so wrapped halves ("2,437," + "200") rejoin exactly.
  const re = /\d(?:[\d,.]|[\u00a0\u202f ](?=\d{3}(?![\d.,])))*[\d,.]|\d/g;
  return String(text ?? "").match(re) || [];
}

function numericTokens(text) {
  return rawNumericTokens(text).map((t) => normaliseNumber(t.replace(/[.,]$/, ""))).filter(Boolean);
}

function normaliseNumber(part) {
  const p = String(part).replace(/[   ]/g, "");
  if (!/\d/.test(p)) return null;
  // Normalise both 1,234.5 and 1.234,5 to digits-with-one-dot.
  let digits = p;
  const lastSep = Math.max(p.lastIndexOf("."), p.lastIndexOf(","));
  if (lastSep >= 0 && p.length - lastSep - 1 !== 3) {
    digits = p.slice(0, lastSep).replace(/[.,]/g, "") + "." + p.slice(lastSep + 1);
  } else {
    digits = p.replace(/[.,]/g, "");
  }
  digits = digits.replace(/^0+(?=\d)/, "");
  return digits;
}

function multiset(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

// Checks a grid (array of rows of strings, or a canonical table) against a
// source text or token list. Cells containing a number that is not in the
// source are flagged. Returns { issues, flagged: Set<"rowIdx:colIdx"> }.
// Counting is by presence, not multiplicity — the same value legitimately
// appears in several cells (e.g. a total repeated in a sub-table).
function verifyGrid(grid, source) {
  const sourceTokens = Array.isArray(source) ? source : numericTokens(source);
  const available = multiset(sourceTokens);
  // A number wrapped across lines inside a narrow cell ("2,437,20" / "0")
  // is rejoined by the structure step; joins of adjacent source tokens are
  // still made only of source characters, so they count as grounded.
  if (!Array.isArray(source)) {
    const raws = rawNumericTokens(source);
    // "842 701" reads as one space-grouped number or two adjacent cells;
    // either way each piece is made of source digits.
    for (const r of raws) {
      if (!/[\u00a0\u202f ]/.test(r)) continue;
      for (const piece of r.split(/[\u00a0\u202f ]+/)) {
        const n = normaliseNumber(piece.replace(/[.,]$/, ""));
        if (n) available.set(n, (available.get(n) || 0) + 1);
      }
    }
    for (let i = 0; i + 1 < raws.length; i++) {
      // The other half may sit a line or two further on in reading order
      // (a two-line cell vertically centred against its row's label).
      for (let j = i + 1; j <= i + 3 && j < raws.length; j++) {
        const two = normaliseNumber(raws[i] + raws[j]);
        if (two) available.set(two, (available.get(two) || 0) + 1);
      }
      if (i + 2 < raws.length) {
        const three = normaliseNumber(raws[i] + raws[i + 1] + raws[i + 2]);
        if (three) available.set(three, (available.get(three) || 0) + 1);
      }
    }
  }
  const flagged = new Set();
  const rows = gridRows(grid);
  rows.forEach((cells, i) => {
    cells.forEach((text, j) => {
      for (const tok of numericTokens(text)) {
        if (!available.has(tok)) { flagged.add(`${i}:${j}`); break; }
      }
    });
  });
  return { issues: flagged.size, flagged };
}

function gridRows(grid) {
  if (Array.isArray(grid)) return grid.map((r) => (Array.isArray(r) ? r.map((c) => (typeof c === "object" && c ? c.raw : c)) : []));
  if (grid && Array.isArray(grid.rows)) return grid.rows.map((r) => r.cells.map((c) => c.raw));
  return [];
}

// Clean layer: each numeric `v` must be what parseNumber derives from the
// cell's own raw text (the reverse mapping). Mutates cells to add
// flag:"ungrounded" and returns the count.
function verifyCleanAgainstRaw(clean) {
  let issues = 0;
  const locale = clean.locale || "en";
  for (const row of clean.rows || []) {
    row.cells.forEach((cell, j) => {
      const col = clean.columns[j];
      if (!col || col.type === "text") return;
      if (typeof cell.v !== "number") return;
      const p = parseNumber(cell.raw, locale);
      if (p.v == null || Math.abs(p.v - cell.v) > 1e-9 * Math.max(1, Math.abs(cell.v))) {
        cell.flag = "ungrounded";
        issues++;
      }
    });
  }
  return issues;
}

// Applies verifyGrid flags to a canonical raw table in place.
function flagRawTable(raw, source) {
  const { issues, flagged } = verifyGrid(raw, source);
  for (const key of flagged) {
    const [i, j] = key.split(":").map(Number);
    const cell = raw.rows[i]?.cells[j];
    if (cell) cell.flag = "ungrounded";
  }
  return issues;
}

export { numericTokens, verifyGrid, verifyCleanAgainstRaw, flagRawTable };
