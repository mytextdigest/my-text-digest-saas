// Shared display helpers for the Tables UI. Values shown are always the
// cell's own `raw` text (what the document says); `v` is only used for
// sorting, charts and alignment.

export function colLabel(col, j) {
  return (col && col.label) || (j === 0 ? '' : `Column ${j + 1}`);
}

export function isNumericCol(col) {
  return !!col && col.type && col.type !== 'text';
}

export function pageLabel(t) {
  if (!t) return null;
  if (t.sheet_name) return `Sheet ${t.sheet_name}`;
  if (t.page_start == null) return null;
  return t.page_end && t.page_end !== t.page_start ? `pp. ${t.page_start}–${t.page_end}` : `p. ${t.page_start}`;
}

export function cellText(cell) {
  if (!cell) return '';
  return cell.raw == null ? '' : String(cell.raw);
}

// Raw layer → display grid: header rows first, spans honoured.
export function rawToDisplay(raw) {
  if (!raw) return { headerRows: [], bodyRows: [] };
  const headerRows = raw.rows.filter((r) => r.kind === 'header');
  const bodyRows = raw.rows.filter((r) => r.kind !== 'header');
  return { headerRows, bodyRows };
}

export function tableToEditable(table) {
  return JSON.parse(JSON.stringify(table));
}

let idSeq = 0;
export function newId(prefix) {
  idSeq += 1;
  return `${prefix}n${Date.now().toString(36)}${idSeq}`;
}

// Tables a vision model read from a picture (scanned page, uploaded image,
// or an image embedded in a PDF/Word file) rather than from document text.
export const VISION_SOURCES = {
  pdf_vision: 'scanned page',
  image_vision: 'image',
  figure_vision: 'embedded image',
};

export function isVisionTable(t) {
  return !!t && Object.prototype.hasOwnProperty.call(VISION_SOURCES, t.source_type);
}

export function confidenceLabel(c) {
  if (c == null) return null;
  if (c >= 0.75) return null;
  return 'Low confidence';
}

// Sorts data rows by a column; total/subtotal rows stay at the bottom.
export function sortRows(rows, colIdx, dir, numeric) {
  const body = rows.filter((r) => r.kind !== 'total' && r.kind !== 'subtotal');
  const tail = rows.filter((r) => r.kind === 'total' || r.kind === 'subtotal');
  const val = (r) => {
    const c = r.cells[colIdx];
    if (numeric) return typeof c?.v === 'number' ? c.v : null;
    return cellText(c).toLowerCase();
  };
  const sorted = [...body].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    const cmp = numeric ? x - y : String(x).localeCompare(String(y));
    return dir === 'asc' ? cmp : -cmp;
  });
  return [...sorted, ...tail];
}
