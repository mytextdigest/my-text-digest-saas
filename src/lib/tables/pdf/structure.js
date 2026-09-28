// src/lib/tables/pdf/structure.js
// Region → raw grid: rows, columns, spans, header rows, caption and
// per-cell provenance boxes. Pure.
import { makeRawTable } from "../schema.js";
import { isPeriodLabel } from "../clean.js";
import {
  median,
  isNumericToken,
  isCaption,
  columnsFromProjection,
  columnsFromRulings,
  rowRules,
  scoreCandidate,
} from "./detect.js";

const UNIT_NOTE_RE = /\((?:in|amounts in|all amounts in|expressed in)\b[^)]*\)|^\s*(?:in|amounts in)\s+(?:thousands|millions|billions|[$€£¥])/i;

function targetsFor(seg, cols) {
  const hits = [];
  cols.forEach((c, j) => {
    const overlap = Math.min(seg.x1, c[1] + 1) - Math.max(seg.x0, c[0] - 1);
    if (overlap > Math.min(3, (seg.x1 - seg.x0) * 0.3)) hits.push(j);
  });
  if (hits.length) return hits;
  const cx = (seg.x0 + seg.x1) / 2;
  let best = 0, bestD = Infinity;
  cols.forEach((c, j) => {
    const d = cx < c[0] ? c[0] - cx : cx > c[1] ? cx - c[1] : 0;
    if (d < bestD) { bestD = d; best = j; }
  });
  return [best];
}

function centreColumn(seg, cols, targets) {
  const cx = (seg.x0 + seg.x1) / 2;
  return targets.find((j) => cx >= cols[j][0] - 1 && cx <= cols[j][1] + 1) ?? targets[0];
}

function emptyRow(width) {
  return Array.from({ length: width }, () => ({ raw: "", box: null, segs: [] }));
}

function addToCell(cell, seg) {
  // A number wrapped inside a narrow cell ("1,234." / "5") rejoins without a space.
  const glue = cell.raw && /[\d.,]$/.test(cell.raw) && /^\d/.test(seg.text) && isNumericToken(`${cell.raw}${seg.text}`);
  cell.raw = cell.raw ? (glue ? `${cell.raw}${seg.text}` : `${cell.raw} ${seg.text}`) : seg.text;
  cell.segs.push(seg);
  const b = [seg.x0, seg.top, seg.x1, seg.bottom];
  cell.box = cell.box
    ? [Math.min(cell.box[0], b[0]), Math.min(cell.box[1], b[1]), Math.max(cell.box[2], b[2]), Math.max(cell.box[3], b[3])]
    : b;
}

function rowHasValues(row) {
  return row.slice(1).some((c) => c.raw.trim() && isNumericToken(c.raw.trim()) && !isPeriodLabel(c.raw.trim()));
}

function filledCount(row) {
  return row.filter((c) => c.raw.trim()).length;
}

// Finds a caption above (or just below) the region and the nearest heading.
function findContext(region, lines) {
  const first = region.lines[0];
  const last = region.lines[region.lines.length - 1];
  const fs = region.fontSize || 10;
  const startIdx = lines.indexOf(first);
  const endIdx = lines.indexOf(last);
  let caption = null, unitNote = null, nearbyHeading = null;
  for (let i = startIdx - 1, seen = 0; i >= 0 && seen < 5; i--, seen++) {
    const l = lines[i];
    if (first.top - l.bottom > 8 * fs) break;
    if (!caption && isCaption(l)) caption = l.text.trim();
    if (!unitNote && UNIT_NOTE_RE.test(l.text)) unitNote = l.text.trim();
    if (caption) break;
  }
  if (!caption) {
    for (let i = endIdx + 1; i < lines.length && i <= endIdx + 2; i++) {
      const l = lines[i];
      if (l.top - last.bottom > 4 * fs) break;
      if (isCaption(l)) { caption = l.text.trim(); break; }
    }
  }
  for (let i = startIdx - 1, seen = 0; i >= 0 && seen < 20; i--, seen++) {
    const l = lines[i];
    if (isCaption(l)) continue;
    const words = l.words.length;
    const text = l.text.trim();
    if (text.length < 3 || !/[A-Za-z]{2}/.test(text) || /\.{4,}/.test(text)) continue;
    if (l.fontSize >= fs * 1.15 || (words <= 8 && !/[.,;:]$/.test(text) && (l.segments || []).length <= 1)) {
      nearbyHeading = text;
      break;
    }
  }
  return { caption, unitNote, nearbyHeading };
}

function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

// Share of columns whose body cells line up on a left, right or centre edge.
function columnAlignment(bodyRows, width, fontSize) {
  let aligned = 0, counted = 0;
  const tol = Math.max(2, 0.35 * fontSize);
  for (let j = 0; j < width; j++) {
    const boxes = bodyRows.map((r) => r[j]?.box).filter(Boolean);
    if (boxes.length < 2) continue;
    counted++;
    const best = Math.min(stdev(boxes.map((b) => b[0])), stdev(boxes.map((b) => b[2])), stdev(boxes.map((b) => (b[0] + b[2]) / 2)));
    if (best <= tol) aligned++;
  }
  return counted ? aligned / counted : 1;
}

// Builds one candidate table from a region. Returns null when the region
// doesn't hold together as a grid.
function buildCandidate(region, page, lines) {
  const verticals = page.rulings?.vertical || [];
  const horizontals = page.rulings?.horizontal || [];
  let cols = columnsFromRulings(region, verticals);
  const ruledCols = !!cols;
  if (!cols) cols = columnsFromProjection(region);
  if (!cols || cols.length < 2) return null;
  const width = cols.length;

  // Re-split body segments that straddle a column channel (tight tables
  // where "North America 1,234.5" came through as one segment). Spanning
  // header lines keep their segments so "Total revenue" stays one cell.
  const extra = region.extraHeaderLines || 0;
  region.lines.forEach((line, li) => {
    if (li < extra) return;
    const out = [];
    for (const seg of line.segments) {
      const targets = targetsFor(seg, cols);
      if (targets.length < 2 || seg.words.length < 2) { out.push(seg); continue; }
      let cur = null, curCol = -1;
      for (const w of seg.words) {
        const col = centreColumn(w, cols, targetsFor(w, cols));
        if (cur && col === curCol) {
          cur.words.push(w); cur.text += " " + w.text; cur.x1 = Math.max(cur.x1, w.x1);
          cur.top = Math.min(cur.top, w.top); cur.bottom = Math.max(cur.bottom, w.bottom);
        } else {
          if (cur) out.push(cur);
          cur = { words: [w], text: w.text, x0: w.x0, x1: w.x1, top: w.top, bottom: w.bottom };
          curCol = col;
        }
      }
      if (cur) out.push(cur);
    }
    line.segments = out;
  });

  // Rows: bands between horizontal rules when there are enough, else lines.
  const rules = rowRules(region, horizontals, cols);
  const banded = rules.length >= 3;
  const rowsOfLines = [];
  if (banded) {
    const bands = new Map();
    const outside = [];
    for (const line of region.lines) {
      const y = (line.top + line.bottom) / 2;
      let b = -1;
      for (let i = 0; i + 1 < rules.length; i++) if (y > rules[i] && y < rules[i + 1]) { b = i; break; }
      if (b < 0) outside.push(line);
      else { if (!bands.has(b)) bands.set(b, []); bands.get(b).push(line); }
    }
    const ordered = [...outside.map((l) => ({ y: l.top, lines: [l] })), ...[...bands.entries()].map(([, ls]) => ({ y: ls[0].top, lines: ls }))];
    ordered.sort((a, b) => a.y - b.y);
    ordered.forEach((o) => rowsOfLines.push(o.lines));
  } else {
    // Lines whose boxes overlap vertically belong to one row: a cell that
    // wraps onto two lines is often centred against a one-line label.
    for (const l of region.lines) {
      const group = rowsOfLines[rowsOfLines.length - 1];
      const gTop = group ? Math.min(...group.map((g) => g.top)) : 0;
      const gBottom = group ? Math.max(...group.map((g) => g.bottom)) : 0;
      if (group && Math.min(gBottom, l.bottom) - Math.max(gTop, l.top) > 1) group.push(l);
      else rowsOfLines.push([l]);
    }
  }

  let rows = rowsOfLines.map((ls) => {
    const row = emptyRow(width);
    row.lines = ls;
    const ordered = [...ls].sort((a, b) => a.baseline - b.baseline);
    for (const line of ordered) {
      for (const seg of line.segments) {
        const targets = targetsFor(seg, cols);
        const j = targets[0];
        addToCell(row[j], seg);
        if (targets.length > 1) row[j].span = Math.max(row[j].span || 1, targets[targets.length - 1] - j + 1);
      }
    }
    return row;
  });

  // Wrapped lines (unruled only): a label-only line starting lowercase
  // continues the previous row's label; a label-only line directly above a
  // row whose label starts lowercase is that row's first half.
  let wrapped = 0;
  if (!banded) {
    const fs = region.fontSize || 10;
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const labelOnly = filledCount(row) === 1 && row[0].raw.trim();
      const prev = out[out.length - 1];
      const next = rows[i + 1];
      if (labelOnly && prev && rowHasValues(prev) && /^[a-z(]/.test(row[0].raw.trim())) {
        addToCell(prev[0], { ...row[0].segs[0], text: row[0].raw });
        wrapped++;
        continue;
      }
      if (labelOnly && next && rowHasValues(next) && /^[a-z]/.test(next[0].raw.trim()) &&
          next.lines[0].top - row.lines[row.lines.length - 1].bottom < fs * 0.8) {
        const nextLabel = next[0].raw;
        next[0].raw = "";
        addToCell(next[0], { ...row[0].segs[0], text: row[0].raw });
        next[0].raw = `${row[0].raw} ${nextLabel}`.trim();
        wrapped++;
        continue;
      }
      out.push(row);
    }
    rows = out;
  }

  // Header rows: rows above the first row that carries numeric values.
  // (extra header line count declared above)
  let firstData = rows.findIndex((r, i) => i >= extra && rowHasValues(r));
  let headerRows;
  if (firstData < 0) headerRows = rows.length >= 3 ? Math.max(1, extra) : extra;
  else headerRows = Math.min(firstData, 3 + extra);

  // Spans only make sense in header rows; in data rows put the text in the
  // column under its centre.
  rows.forEach((row, i) => {
    if (i < headerRows) return;
    row.forEach((cell, j) => {
      if (!cell.span) return;
      delete cell.span;
      const seg = cell.segs.length ? { x0: cell.box[0], x1: cell.box[2] } : null;
      if (!seg) return;
      const targets = targetsFor(seg, cols);
      const k = centreColumn(seg, cols, targets);
      if (k !== j && !row[k].raw) { row[k] = cell; row[j] = { raw: "", box: null, segs: [] }; }
    });
  });

  const grid = rows.map((r) => r.map((c) => c.raw.trim()));
  const ruled = ruledCols || banded;
  const score = scoreCandidate({ grid, headerRows, ruled, wrapped, alignment: ruled ? 1 : columnAlignment(rows.slice(headerRows), width, region.fontSize || 10) });

  const cellBoxes = {};
  const rawGrid = rows.map((r, i) => r.map((c, j) => {
    const cell = { raw: c.raw.trim() };
    if (c.span > 1) {
      cell.colSpan = c.span;
    }
    if (c.box) cellBoxes[`r${i}:c${j}`] = [page.pageNumber, ...c.box.map((v) => Math.round(v * 10) / 10)];
    return cell;
  }));
  // Expand colSpan into spanned placeholders so every row stays width-aligned.
  rawGrid.forEach((r) => r.forEach((c, j) => {
    for (let k = 1; k < (c.colSpan || 1) && j + k < width; k++) if (!r[j + k].raw) r[j + k] = { raw: "", spanned: true };
  }));

  const ctx = findContext(region, lines);
  const top = Math.min(...region.lines.map((l) => l.top));
  const bottom = Math.max(...region.lines.map((l) => l.bottom));
  const raw = makeRawTable(rawGrid, {
    headerRows,
    caption: ctx.caption,
    provenance: { pages: [page.pageNumber], cellBoxes, bbox: [page.pageNumber, region.x0, top, region.x1, bottom] },
  });
  if (ctx.unitNote && !ctx.caption) raw.unitNote = ctx.unitNote;

  return {
    raw,
    caption: ctx.caption || null,
    unitNote: ctx.unitNote || null,
    nearbyHeading: ctx.nearbyHeading || null,
    pageStart: page.pageNumber,
    pageEnd: page.pageNumber,
    confidence: Math.round(score.confidence * 100) / 100,
    rejected: score.rejected,
    sourceType: "pdf_text",
    sourceText: [ctx.caption, ...region.lines.map((l) => l.text)].filter(Boolean).join("\n"),
    // For continuation.js and repair.js
    colCentres: cols.map((c) => (c[0] + c[1]) / 2),
    headerTexts: grid.slice(0, headerRows).map((r) => r.join("|")),
    top,
    bottom,
    pageHeight: page.height,
    fontSize: region.fontSize || median(region.lines.map((l) => l.fontSize)),
    lines: region.lines.map((l) => l.segments.map((s) => ({ text: s.text, x: Math.round(s.x0) }))),
  };
}

export { buildCandidate, findContext, targetsFor };
