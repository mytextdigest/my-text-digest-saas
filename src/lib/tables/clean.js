// src/lib/tables/clean.js
// Deterministic normalisation: raw layer → clean layer (FR-12), plus the
// user actions of FR-14. Pure functions only — no LLM, no I/O. Every `v`
// produced here is derived from its cell's own `raw` text (verify.js checks).
import { cloneTable } from "./schema.js";
import config from "./config.js";

// ---------------------------------------------------------------------------
// Number parsing
// ---------------------------------------------------------------------------

const NULL_TOKENS = new Set(["—", "–", "-", "−", "--", "---", "n/a", "na", "nm", "n.m.", "n.a.", "n/m", "nil", "…", "..."]);
const SUPERSCRIPTS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const CURRENCY_SYMBOLS = { "$": "USD", "US$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR", "C$": "CAD", "A$": "AUD" };
const CURRENCY_CODES = new Set(["USD", "EUR", "GBP", "JPY", "INR", "CAD", "AUD", "CHF", "CNY", "SEK", "NOK", "DKK"]);

const EN_NUM = /^\d{1,3}(,\d{3})+(\.\d+)?$|^\d+(\.\d+)?$|^\.\d+$/;
const EU_NUM = /^\d{1,3}(\.\d{3})+(,\d+)?$|^\d+(,\d+)?$/;
const SPACE_NUM = /^\d{1,3}([   ]\d{3})+([.,]\d+)?$/;

// Parses one cell. Returns { v, kind, note?, currency? } where kind is one of
// empty | null | number | percent | currency | multiple | text.
// `locale` is "en" (1,234.5) or "eu" (1.234,5).
function parseNumber(input, locale = "en") {
  if (input == null) return { v: null, kind: "empty" };
  let s = String(input).trim();
  if (!s) return { v: null, kind: "empty" };
  if (NULL_TOKENS.has(s.toLowerCase())) return { v: null, kind: "null" };

  let note;
  // Trailing footnote markers: 123a, 123*, 123¹, 123 (a), 123†
  let m = s.match(/^(.*?\d[%x)]?)\s*(\([a-z]\)|[a-e]|\*{1,3}|[†‡§]|[⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/);
  // "$1.2b" is a scale suffix, not footnote "b".
  if (m && m[2] === "b" && /^[(\-−–\s]*(US\$|C\$|A\$|[$€£¥₹])/.test(s)) m = null;
  if (m) {
    s = m[1].trim();
    note = m[2].replace(/[()]/g, "");
    if (/^[⁰¹²³⁴⁵⁶⁷⁸⁹]+$/.test(note)) note = [...note].map((ch) => SUPERSCRIPTS.indexOf(ch)).join("");
  }

  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  if (/^[-−–]/.test(s)) { negative = true; s = s.slice(1).trim(); }
  else if (/^\+/.test(s)) s = s.slice(1).trim();

  let currency = null;
  m = s.match(/^(US\$|C\$|A\$|[$€£¥₹])\s*/);
  if (m) { currency = CURRENCY_SYMBOLS[m[1]]; s = s.slice(m[0].length); }
  else {
    m = s.match(/^([A-Z]{3})\s+/);
    if (m && CURRENCY_CODES.has(m[1])) { currency = m[1]; s = s.slice(m[0].length); }
  }
  // Negative inside currency: $(123) or $-123
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  if (/^[-−–]/.test(s)) { negative = true; s = s.slice(1).trim(); }

  let kind = currency ? "currency" : "number";
  if (/%$/.test(s)) { kind = "percent"; s = s.slice(0, -1).trim(); }
  else if (/^\d[\d.,]*\s?x$/i.test(s)) { kind = "multiple"; s = s.slice(0, -1).trim(); }
  // Trailing scale letters stuck to currency values, e.g. $1.2bn / €3m
  let scale = 1;
  if (currency) {
    const sm = s.match(/^([\d.,]+)\s?(k|m|mn|bn|b)$/i);
    if (sm) {
      s = sm[1];
      const suf = sm[2].toLowerCase();
      scale = suf === "k" ? 1e3 : suf === "m" || suf === "mn" ? 1e6 : 1e9;
    }
  }
  // Trailing currency symbol (European style 1.234,5 €)
  m = s.match(/\s?([€£$¥₹])$/);
  if (m && !currency) { currency = CURRENCY_SYMBOLS[m[1]]; kind = "currency"; s = s.slice(0, -m[0].length).trim(); }

  let v = null;
  if (SPACE_NUM.test(s)) {
    const cleaned = s.replace(/[   ]/g, "");
    v = Number(locale === "eu" ? cleaned.replace(",", ".") : cleaned.replace(",", "."));
  } else if (locale === "eu" ? EU_NUM.test(s) : EN_NUM.test(s)) {
    v = locale === "eu" ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s.replace(/,/g, ""));
  } else if (locale === "eu" && EN_NUM.test(s) && !/,/.test(s)) {
    v = Number(s);
  } else if (locale === "en" && EU_NUM.test(s) && /^\d+,\d{1,2}$/.test(s)) {
    // "12,5" in an otherwise English table — ambiguous; treat as text.
    v = null;
  }
  if (v == null || !Number.isFinite(v)) return { v: null, kind: "text" };

  v = v * scale;
  if (negative) v = -v;
  const out = { v, kind };
  if (note) out.note = note;
  if (currency) out.currency = currency;
  return out;
}

// Infers the decimal convention from the numbers in a table. Returns "en" or "eu".
function detectLocale(strings) {
  let en = 0, eu = 0;
  for (const raw of strings) {
    const s = String(raw || "").replace(/[()$€£¥%\s-]/g, "");
    if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^\d+,\d{1,2}$/.test(s)) eu++;
    else if (/^\d{1,3}(,\d{3})+\.\d+$/.test(s) || /^\d+\.\d{1,2}$/.test(s)) en++;
    else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) eu++;
    else if (/^\d{1,3}(,\d{3}){2,}$/.test(s)) en++;
  }
  return eu > en ? "eu" : "en";
}

// ---------------------------------------------------------------------------
// Periods and units
// ---------------------------------------------------------------------------

// Returns a normalised period string ("2025", "FY2025", "Q1 2025", "H1 2025",
// "2024/25") when the label names a reporting period, else null.
function parsePeriod(label) {
  const s = String(label || "").trim().replace(/\s+/g, " ");
  if (!s) return null;
  let m = s.match(/^(FY|CY)\s?'?(\d{2}|\d{4})([AEFP])?$/i);
  if (m) return `${m[1].toUpperCase()}${expandYear(m[2])}`;
  m = s.match(/^((?:19|20)\d{2})([AEFP])?$/);
  if (m) return m[1];
  m = s.match(/^((?:19|20)\d{2})\s?[/–-]\s?(\d{2}|\d{4})$/);
  if (m) return `${m[1]}/${m[2].slice(-2)}`;
  m = s.match(/^(Q[1-4]|H[12])\s?'?((?:19|20)?\d{2})$/i);
  if (m) return `${m[1].toUpperCase()} ${expandYear(m[2])}`;
  m = s.match(/^((?:19|20)\d{2})\s?(Q[1-4]|H[12])$/i);
  if (m) return `${m[2].toUpperCase()} ${m[1]}`;
  m = s.match(/^(?:year ended|fiscal year|fy)\b.*?((?:19|20)\d{2})$/i);
  if (m) return m[1];
  m = s.match(/^(?:dec(?:ember)?|mar(?:ch)?|jun(?:e)?|sep(?:tember)?)\.?\s+\d{0,2},?\s*((?:19|20)\d{2})$/i);
  if (m) return m[1];
  return null;
}

function expandYear(y) {
  if (y.length === 4) return y;
  const n = Number(y);
  return String(n >= 70 ? 1900 + n : 2000 + n);
}

function isPeriodLabel(s) {
  return parsePeriod(s) != null;
}

// Numeric sort key for a period, used to pick "latest" and order columns.
function periodSortKey(period) {
  if (!period) return -Infinity;
  const y = String(period).match(/(19|20)\d{2}/);
  if (!y) return -Infinity;
  let key = Number(y[0]) * 10;
  const q = String(period).match(/Q([1-4])/i);
  const h = String(period).match(/H([12])/i);
  if (q) key += Number(q[1]) * 2 - 8;
  else if (h) key += Number(h[1]) * 4 - 8;
  return key;
}

const SCALE_PATTERNS = [
  { re: /\b(billions?|bn)\b|[$€£¥]\s?b(n)?\b/i, scale: "billions" },
  { re: /\b(millions?|mn|mm|mio)\b|[$€£¥]\s?m\b/i, scale: "millions" },
  { re: /\b(thousands?|k)\b|'000s?|\b000s\b|[$€£¥]\s?k\b|\$000/i, scale: "thousands" },
];
const CURRENCY_PATTERNS = [
  { re: /\bUSD\b|US\$|U\.S\. dollars?|\bdollars?\b|\$/i, code: "USD" },
  { re: /\bEUR\b|€|\beuros?\b/i, code: "EUR" },
  { re: /\bGBP\b|£|\bpounds? sterling\b/i, code: "GBP" },
  { re: /\bJPY\b|¥|\byen\b/i, code: "JPY" },
  { re: /\bINR\b|₹|\brupees?\b/i, code: "INR" },
  { re: /\bCHF\b|\bswiss francs?\b/i, code: "CHF" },
  { re: /\bCAD\b|C\$/i, code: "CAD" },
];

// Reads units out of free text such as "(in $ millions)", "USD '000", "€m",
// "(%)". Returns e.g. "USD millions", "EUR thousands", "millions", "%", or null.
function inferUnits(text) {
  const s = String(text || "");
  if (!s.trim()) return null;
  // Only look at unit-ish fragments: parentheticals, "in ...", or the whole
  // string when it's short (a header).
  const fragments = [];
  const paren = s.match(/\(([^)]{1,60})\)/g);
  if (paren) fragments.push(...paren);
  const inPhrase = s.match(/\b(?:in|amounts in|expressed in|figures in)\s+[^.;:]{1,50}/gi);
  if (inPhrase) fragments.push(...inPhrase);
  if (s.length <= 40) fragments.push(s);
  for (const raw of fragments) {
    // "Dollars per thousand board feet" is a rate: the scale word belongs to
    // the denominator, so the values are plain dollars, not thousands.
    const f = raw.replace(/\bper\s+(?:a\s+|one\s+)?(?:hundred|thousand|million|billion|1[,.]?000)\b.*$/i, "");
    if (/^\(?\s*%\s*\)?$/.test(f.trim()) || /\bin\s+%|\(%\)|\bpercent(age)?\b/i.test(f)) return "%";
    const scale = SCALE_PATTERNS.find((p) => p.re.test(f))?.scale || null;
    const currency = CURRENCY_PATTERNS.find((p) => p.re.test(f))?.code || null;
    if (scale || (currency && /\(|\bin\b/i.test(f))) {
      return [currency, scale].filter(Boolean).join(" ") || null;
    }
  }
  return null;
}

// Splits "USD millions" → { currency: "USD", scale: 1e6 }.
function unitParts(unit) {
  const u = String(unit || "");
  const currency = (u.match(/\b(USD|EUR|GBP|JPY|INR|CHF|CAD|AUD|CNY)\b/) || [])[1] || null;
  const scale = /billion/i.test(u) ? 1e9 : /million/i.test(u) ? 1e6 : /thousand/i.test(u) ? 1e3 : 1;
  const percent = u.trim() === "%";
  return { currency, scale, percent, known: !!u.trim() };
}

// ---------------------------------------------------------------------------
// Structure clean-up
// ---------------------------------------------------------------------------

function isBlank(cell) {
  return !cell || !String(cell.raw ?? "").trim();
}

function dropEmpty(table) {
  const t = cloneTable(table);
  t.rows = t.rows.filter((r) => r.cells.some((c) => !isBlank(c)));
  const keep = t.columns.map((_, j) => t.rows.some((r) => !isBlank(r.cells[j])));
  t.columns = t.columns.filter((_, j) => keep[j]);
  t.rows.forEach((r) => { r.cells = r.cells.filter((_, j) => keep[j]); });
  return t;
}

function looksNumeric(raw) {
  const s = String(raw || "").trim();
  if (!s || isPeriodLabel(s)) return false;
  const p = parseNumber(s);
  return p.v != null;
}

// When the raw layer marks no header rows, decide whether the first row is a
// header: it is when it has no numeric (non-period) values and some later row does,
// or when every row is text and the first row is fully populated.
function autoHeaderRows(t) {
  if (t.rows.some((r) => r.kind === "header")) return t;
  if (t.rows.length < 2) return t;
  const first = t.rows[0];
  const firstNumeric = first.cells.filter((c) => looksNumeric(c.raw)).length;
  const laterNumeric = t.rows.slice(1).some((r) => r.cells.some((c) => looksNumeric(c.raw)));
  const filled = first.cells.filter((c) => !isBlank(c)).length;
  if (firstNumeric === 0 && (laterNumeric || filled >= Math.ceil(first.cells.length * 0.75))) {
    first.kind = "header";
    // A second label-only row directly under the first (e.g. years under
    // "Revenue") is part of the header too.
    const second = t.rows[1];
    if (second && t.rows.length > 3 && isBlank(second.cells[0]) &&
        second.cells.slice(1).every((c) => isBlank(c) || !looksNumeric(c.raw))) {
      second.kind = "header";
    }
  }
  return t;
}

// Flattens header rows into column.headerPath / column.label and removes them
// from rows. Spanned header cells inherit their origin's text.
function promoteHeaders(table) {
  const t = autoHeaderRows(cloneTable(table));
  const headerRows = t.rows.filter((r) => r.kind === "header");
  const width = t.columns.length;
  const grid = headerRows.map((r) => r.cells.map((c) => String(c.raw || "").trim()));
  // Fill colSpan to the right and rowSpan downward.
  headerRows.forEach((r, hi) => {
    r.cells.forEach((c, j) => {
      const span = Math.max(1, Number(c.colSpan) || 1);
      for (let k = 1; k < span && j + k < width; k++) if (!grid[hi][j + k]) grid[hi][j + k] = grid[hi][j];
    });
  });
  headerRows.forEach((r, hi) => {
    r.cells.forEach((c, j) => {
      if (c.spanned && !grid[hi][j] && hi > 0) {
        // rowSpan continuation: only inherit if the cell above spans down
        const above = headerRows[hi - 1].cells[j];
        if (above && Number(above.rowSpan) > 1) grid[hi][j] = grid[hi - 1][j];
      }
    });
  });

  const paths = t.columns.map((_, j) => {
    const path = [];
    for (let hi = 0; hi < grid.length; hi++) {
      const text = grid[hi][j];
      if (text && path[path.length - 1] !== text) path.push(text);
    }
    return path;
  });
  const parents = paths.filter((p) => p.length > 1).map((p) => p.slice(0, -1).join(" › "));
  const sharedParent = parents.length > 0 && parents.every((p) => p === parents[0]);

  t.columns = t.columns.map((col, j) => {
    const path = paths[j];
    let label = "";
    if (path.length === 1) label = path[0];
    else if (path.length > 1) label = sharedParent ? path[path.length - 1] : path.join(" › ");
    return { ...col, label, headerPath: path.length ? path : [label] };
  });
  t.rows = t.rows.filter((r) => r.kind !== "header");
  return t;
}

// ---------------------------------------------------------------------------
// Types, values and row kinds
// ---------------------------------------------------------------------------

function majority(values) {
  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// Decides each column's type/unit/period and fills every cell's `v`.
// Columns with `typeLocked` keep their type (user choice, FR-14).
function inferColumnTypes(table, { tableUnit = null, locale = null } = {}) {
  const t = cloneTable(table);
  const loc = locale || detectLocale(t.rows.flatMap((r) => r.cells.map((c) => c.raw)));
  t.locale = loc;
  t.columns = t.columns.map((col, j) => {
    const cells = t.rows.filter((r) => r.kind !== "section").map((r) => r.cells[j]).filter((c) => !isBlank(c));
    const parsed = cells.map((c) => parseNumber(c.raw, loc));
    const numeric = parsed.filter((p) => p.v != null || p.kind === "null");
    const realNumbers = parsed.filter((p) => p.v != null);
    const isNumeric = cells.length > 0 && realNumbers.length > 0 && numeric.length / cells.length >= config.NUMERIC_COLUMN_RATIO;

    let type = col.typeLocked ? col.type : "text";
    if (!col.typeLocked && isNumeric) {
      const kinds = realNumbers.map((p) => p.kind);
      const k = majority(kinds);
      type = k === "percent" ? "percent" : k === "currency" ? "currency" : "number";
    }
    const headerText = (col.headerPath || [col.label]).join(" ");
    let unit = col.unitLocked ? col.unit : null;
    if (!col.unitLocked && type !== "text") {
      unit = inferUnits(headerText) || (type === "percent" ? "%" : null) || (type !== "percent" ? tableUnit : null);
      if (!unit && type === "currency") {
        const cur = majority(realNumbers.map((p) => p.currency).filter(Boolean));
        if (cur) unit = cur;
      }
    }
    const period = parsePeriod(col.label) ||
      (col.headerPath || []).map(parsePeriod).find(Boolean) || null;
    const out = { ...col, type, unit: unit || null };
    if (period) out.period = period; else delete out.period;
    return out;
  });
  t.rows.forEach((r) => {
    r.cells = r.cells.map((c, j) => {
      const col = t.columns[j];
      const raw = String(c.raw ?? "");
      const base = { raw };
      if (c.flag) base.flag = c.flag;
      if (col.type === "text") {
        base.v = raw.trim() || null;
        return base;
      }
      const p = parseNumber(raw, t.locale);
      if (col.type === "percent" && p.v != null && p.kind !== "percent" && /%/.test(col.unit || "")) {
        // A bare number in a percent column still means percent.
      }
      base.v = p.v;
      if (p.v == null && p.kind === "text") base.v = raw.trim() || null;
      if (p.note) base.note = p.note;
      return base;
    });
  });
  return t;
}

const TOTAL_RE = /\b(total|totals|sum|overall|grand total)\b/i;
const SUBTOTAL_RE = /\b(sub-?total)\b/i;

function isNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function classifyRows(table) {
  const t = cloneTable(table);
  const numericCols = t.columns.map((c, j) => (c.type !== "text" ? j : -1)).filter((j) => j >= 0);
  const labelCol = t.columns.findIndex((c) => c.type === "text");
  t.rows.forEach((r) => {
    if (r.kind === "header") return;
    const label = labelCol >= 0 ? String(r.cells[labelCol]?.raw || "").trim() : "";
    const others = r.cells.filter((_, j) => j !== labelCol);
    if (label && others.every(isBlank) && t.columns.length > 1) { r.kind = "section"; return; }
    if (SUBTOTAL_RE.test(label)) { r.kind = "subtotal"; return; }
    if (TOTAL_RE.test(label)) { r.kind = "total"; return; }
    r.kind = "data";
  });
  // Unlabelled last row equal to the column sums → total.
  const data = t.rows.filter((r) => r.kind === "data");
  if (data.length >= 3 && numericCols.length) {
    const last = data[data.length - 1];
    const before = data.slice(0, -1);
    let matches = 0, checked = 0;
    for (const j of numericCols) {
      const lv = last.cells[j]?.v;
      if (!isNum(lv)) continue;
      const vals = before.map((r) => r.cells[j]?.v).filter(isNum);
      if (vals.length < 2) continue;
      checked++;
      const sum = vals.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - lv) <= Math.max(Math.abs(lv) * config.TOTAL_TOLERANCE, 0.5)) matches++;
    }
    if (checked >= 1 && matches === checked) last.kind = "total";
  }
  return t;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

// raw → clean. `caption` feeds unit inference ("(in $ millions)").
function buildClean(raw, { caption = null } = {}) {
  let t = dropEmpty(raw);
  t = promoteHeaders(t);
  const tableUnit = inferUnits(caption || "") || inferUnits(raw.caption || "") || null;
  t = inferColumnTypes(t, { tableUnit });
  t = classifyRows(t);
  if (tableUnit) t.tableUnit = tableUnit;
  else {
    // Only a unit every numeric (non-percent) column shares is table-wide;
    // "Opened | Floor area | Revenue ($m)" has no single unit.
    const numeric = t.columns.filter((c) => c.type !== "text" && c.type !== "percent");
    const units = [...new Set(numeric.map((c) => c.unit || null))];
    if (numeric.length && units.length === 1 && units[0]) t.tableUnit = units[0];
  }
  t.notes = collectNotes(t, raw);
  delete t.provenance;
  if (raw.caption) t.caption = raw.caption;
  return t;
}

function collectNotes(t, raw) {
  const notes = Array.isArray(raw.notes) ? [...raw.notes] : [];
  const markers = new Set();
  t.rows.forEach((r) => r.cells.forEach((c) => { if (c.note) markers.add(c.note); }));
  for (const m of markers) if (!notes.some((n) => n.marker === m)) notes.push({ marker: m, text: "" });
  return notes;
}

// Re-derives values of an edited table (renderer-supplied, already passed
// through schema.validateTable). Keeps the user's row kinds and locked types.
function recleanEdited(edited, { previous = null } = {}) {
  let t = cloneTable(edited);
  if (previous) {
    const prevCols = new Map((previous.columns || []).map((c) => [c.id, c]));
    t.columns = t.columns.map((c) => {
      const p = prevCols.get(c.id);
      if (!p) return c;
      const out = { ...c };
      if (p.typeLocked) { out.type = p.type; out.typeLocked = true; }
      if (p.unitLocked) { out.unit = p.unit; out.unitLocked = true; }
      return out;
    });
  }
  const kinds = t.rows.map((r) => r.kind);
  t = inferColumnTypes(t, { tableUnit: edited.tableUnit || null, locale: previous?.locale || null });
  t.rows.forEach((r, i) => { r.kind = kinds[i] || "data"; });
  if (edited.tableUnit) t.tableUnit = edited.tableUnit;
  if (edited.notes) t.notes = edited.notes;
  return t;
}

// ---------------------------------------------------------------------------
// User actions (FR-14). Each takes the effective table and returns a new one.
// ---------------------------------------------------------------------------

function colLabel(col, j) {
  return (col && col.label) || (j === 0 ? "" : `Column ${j + 1}`);
}

function transpose(table) {
  const t = cloneTable(table);
  const newColumns = [
    { id: "c0", label: colLabel(t.columns[0], 0), headerPath: [colLabel(t.columns[0], 0)], type: "text", unit: null },
    ...t.rows.map((r, i) => {
      const label = String(r.cells[0]?.raw || "").trim() || `Row ${i + 1}`;
      return { id: `c${i + 1}`, label, headerPath: [label], type: "text", unit: null };
    }),
  ];
  const newRows = t.columns.slice(1).map((col, j) => ({
    id: `r${j}`,
    kind: "data",
    cells: [{ raw: colLabel(col, j + 1) }, ...t.rows.map((r) => ({ raw: String(r.cells[j + 1]?.raw ?? "") }))],
  }));
  const out = { columns: newColumns, rows: newRows, notes: t.notes || [] };
  if (t.tableUnit) out.tableUnit = t.tableUnit;
  return inferColumnTypes(out, { tableUnit: t.tableUnit || null, locale: t.locale });
}

function promoteRowToHeader(table, rowId) {
  const t = cloneTable(table);
  const idx = t.rows.findIndex((r) => r.id === rowId);
  if (idx < 0) throw new Error("Row not found.");
  const row = t.rows[idx];
  t.columns = t.columns.map((c, j) => {
    const text = String(row.cells[j]?.raw || "").trim();
    if (!text) return c;
    const headerPath = [...(c.headerPath || []).filter(Boolean), text];
    return { ...c, label: text, headerPath };
  });
  t.rows.splice(idx, 1);
  return inferColumnTypes(t, { tableUnit: t.tableUnit || null, locale: t.locale });
}

function setColumnType(table, colId, type) {
  const t = cloneTable(table);
  const col = t.columns.find((c) => c.id === colId);
  if (!col) throw new Error("Column not found.");
  if (!["text", "number", "currency", "percent", "date"].includes(type)) throw new Error("Unknown column type.");
  col.type = type;
  col.typeLocked = true;
  return inferColumnTypes(t, { tableUnit: t.tableUnit || null, locale: t.locale });
}

function setUnit(table, colId, unit) {
  const t = cloneTable(table);
  const clean = unit ? String(unit).trim().slice(0, 80) : null;
  if (!colId) {
    t.tableUnit = clean;
    t.columns.forEach((c) => { if (c.type !== "text" && c.type !== "percent" && !c.unitLocked) c.unit = clean; });
    return t;
  }
  const col = t.columns.find((c) => c.id === colId);
  if (!col) throw new Error("Column not found.");
  col.unit = clean;
  col.unitLocked = true;
  return t;
}

function removeRows(table, rowIds) {
  const t = cloneTable(table);
  const ids = new Set(rowIds || []);
  t.rows = t.rows.filter((r) => !ids.has(r.id));
  return t;
}

function removeCols(table, colIds) {
  const t = cloneTable(table);
  const ids = new Set(colIds || []);
  const keep = t.columns.map((c) => !ids.has(c.id));
  if (!keep.some(Boolean)) throw new Error("A table needs at least one column.");
  t.columns = t.columns.filter((_, j) => keep[j]);
  t.rows.forEach((r) => { r.cells = r.cells.filter((_, j) => keep[j]); });
  return t;
}

function setRowKind(table, rowId, kind) {
  const t = cloneTable(table);
  const row = t.rows.find((r) => r.id === rowId);
  if (!row) throw new Error("Row not found.");
  if (!["data", "section", "subtotal", "total"].includes(kind)) throw new Error("Unknown row kind.");
  row.kind = kind;
  return t;
}

const ACTIONS = {
  transpose: (t) => transpose(t),
  promoteRowToHeader: (t, a) => promoteRowToHeader(t, a?.rowId),
  setColumnType: (t, a) => setColumnType(t, a?.colId, a?.type),
  setUnit: (t, a) => setUnit(t, a?.colId || null, a?.unit),
  removeRows: (t, a) => removeRows(t, a?.rowIds),
  removeCols: (t, a) => removeCols(t, a?.colIds),
  setRowKind: (t, a) => setRowKind(t, a?.rowId, a?.kind),
};

function applyAction(table, action, args) {
  const fn = ACTIONS[action];
  if (!fn) throw new Error(`Unknown table action: ${action}`);
  return fn(table, args || {});
}

export {
  parseNumber,
  detectLocale,
  parsePeriod,
  isPeriodLabel,
  periodSortKey,
  inferUnits,
  unitParts,
  dropEmpty,
  promoteHeaders,
  inferColumnTypes,
  classifyRows,
  buildClean,
  recleanEdited,
  looksNumeric,
  colLabel,
  applyAction,
  transpose,
  promoteRowToHeader,
  setColumnType,
  setUnit,
  removeRows,
  removeCols,
  setRowKind,
};
