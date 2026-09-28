// src/lib/tables/pdf/detect.js
// Finds table regions on a page (FR-2) and filters out look-alikes (FR-5).
//
// One pass does the work of the plan's two detectors: ruling lines, when a
// region has them, fix the column (and row) boundaries; otherwise columns
// come from whitespace channels shared by the region's lines. Pure.
import { looksNumeric } from "../clean.js";

const CAPTION_RE = /^(table|exhibit|schedule)\s+[\dA-Z][\w.\-]*\s*[:.\-–—]?/i;

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function isNumericToken(text) {
  return looksNumeric(text) || /^[(\-−–]?[$€£¥]?\d[\d,.]*%?\)?$/.test(text);
}

// ---------------------------------------------------------------------------
// Words → lines → segments
// ---------------------------------------------------------------------------

function groupLines(words) {
  const fs = median(words.map((w) => w.fontSize)) || 10;
  const sorted = [...words].sort((a, b) => a.baseline - b.baseline || a.x0 - b.x0);
  const lines = [];
  for (const w of sorted) {
    const tol = Math.max(1.5, 0.4 * Math.min(w.fontSize, fs * 1.5));
    let line = null;
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 3; i--) {
      if (Math.abs(lines[i].baseline - w.baseline) <= tol) { line = lines[i]; break; }
    }
    if (line) {
      line.words.push(w);
      line.baseline = (line.baseline * (line.words.length - 1) + w.baseline) / line.words.length;
    } else lines.push({ baseline: w.baseline, words: [w] });
  }
  for (const l of lines) {
    l.words.sort((a, b) => a.x0 - b.x0);
    // Generators often split one word across several text items (kerning
    // runs: "410." + "2"); glue pieces that touch back together.
    const glued = [];
    for (const w of l.words) {
      const prev = glued[glued.length - 1];
      if (prev && w.spacesBefore == null && w.x0 - prev.x1 < 0.12 * Math.max(prev.fontSize, w.fontSize) && w.x0 >= prev.x0) {
        prev.text += w.text;
        prev.x1 = Math.max(prev.x1, w.x1);
        prev.top = Math.min(prev.top, w.top);
        prev.bottom = Math.max(prev.bottom, w.bottom);
      } else glued.push({ ...w });
    }
    l.words = glued;
    l.top = Math.min(...l.words.map((w) => w.top));
    l.bottom = Math.max(...l.words.map((w) => w.bottom));
    l.fontSize = median(l.words.map((w) => w.fontSize));
    l.x0 = l.words[0].x0;
    l.x1 = Math.max(...l.words.map((w) => w.x1));
    l.text = l.words.map((w) => w.text).join(" ");
  }
  return lines.sort((a, b) => a.baseline - b.baseline);
}

function verticalRuleBetween(verticals, x0, x1, top, bottom) {
  return verticals.some((v) => v.x > x0 - 0.5 && v.x < x1 + 0.5 && v.y0 <= bottom + 2 && v.y1 >= top - 2);
}

// Splits each line into cell-like segments at wide gaps, padded spaces,
// number-to-number gaps and vertical rules.
function segmentLine(line, verticals) {
  const segs = [];
  let cur = null;
  for (const w of line.words) {
    if (cur) {
      const prev = cur.words[cur.words.length - 1];
      const gap = w.x0 - prev.x1;
      const fs = Math.max(prev.fontSize, w.fontSize);
      const prevNumeric = isNumericToken(prev.text);
      const nextNumeric = isNumericToken(w.text);
      const split =
        gap > 0.9 * fs ||
        (w.spacesBefore != null && w.spacesBefore >= 2) ||
        (prevNumeric && nextNumeric && gap > 0.3 * fs) ||
        // label → value ("North America  1,234.5") in tight tables
        (!prevNumeric && nextNumeric && gap > 0.4 * fs) ||
        verticalRuleBetween(verticals, prev.x1, w.x0, line.top, line.bottom);
      if (!split) {
        cur.words.push(w);
        cur.x1 = Math.max(cur.x1, w.x1);
        cur.text += " " + w.text;
        continue;
      }
      segs.push(cur);
    }
    cur = { words: [w], x0: w.x0, x1: w.x1, text: w.text };
  }
  if (cur) segs.push(cur);
  for (const s of segs) {
    s.top = Math.min(...s.words.map((w) => w.top));
    s.bottom = Math.max(...s.words.map((w) => w.bottom));
  }
  return segs;
}

// ---------------------------------------------------------------------------
// Document-level: repeated page header/footer bands (FR-5)
// ---------------------------------------------------------------------------

function bandKey(line, pageHeight) {
  const y = Math.round(line.baseline / 3) * 3;
  const text = line.text.replace(/\d+/g, "#").toLowerCase().replace(/\s+/g, " ").trim();
  const edge = line.baseline < pageHeight * 0.1 || line.baseline > pageHeight * 0.9;
  return edge ? `${y}|${text}` : null;
}

// pages: [{ lines, height }] — returns Set of band keys to drop.
function findRepeatedBands(pages) {
  if (pages.length < 3) return new Set();
  const counts = new Map();
  for (const p of pages) {
    const seen = new Set();
    for (const l of p.lines) {
      if ((l.segments || []).length >= 3) continue; // repeated table headers are not page furniture
      const k = bandKey(l, p.height);
      if (k && !seen.has(k)) { seen.add(k); counts.set(k, (counts.get(k) || 0) + 1); }
    }
  }
  const out = new Set();
  for (const [k, c] of counts) if (c >= 3 && c > pages.length * 0.5) out.add(k);
  return out;
}

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

function isCaption(line) {
  return CAPTION_RE.test(line.text.trim());
}

function isTabularLine(line, pageWidth) {
  const segs = line.segments;
  if (segs.length < 2) return false;
  // Justified prose sometimes splits at one wide gap: two long runs of words.
  const words = line.words.length;
  if (segs.length === 2 && words > 12 && !segs.some((s) => isNumericToken(s.text))) return false;
  // A sentence that merely ends in a number ("…grew to 2024") isn't a row.
  if (segs.some((s) => s.words.length > 10)) return false;
  // A bullet or list marker followed by text ("•  Launch the new …") is a
  // list item, not a row. Markers are often glyphs without Unicode text.
  const marker = segs[0].text.trim();
  if (segs.length === 2 && (!/[A-Za-z0-9]/.test(marker) || /^\(?[a-z0-9]{1,3}[.)]$/i.test(marker)) && marker.length <= 3) return false;
  if (isCaption(line) && segs.length <= 2) return false;
  // A page header like "Annual Report 2025        Page 3" — two segments far apart,
  // both short, at the page edge — is handled by band removal; nothing to do here.
  return (line.x1 - line.x0) <= pageWidth;
}

// Groups tabular lines into candidate regions. Single-segment lines are
// allowed inside a region (section labels, wrapped cells) when a tabular
// line follows closely.
function findRegions(lines, page) {
  const regions = [];
  const fs = median(lines.map((l) => l.fontSize)) || 10;
  const maxGap = 4.2 * fs;
  let cur = null;
  let pendingSingles = [];

  const close = () => {
    if (cur) {
      // Trailing label/value fragments that overlap the last row vertically
      // (a wrapped cell centred on its row) still belong to the table.
      const last = cur.lines[cur.lines.length - 1];
      for (const s of pendingSingles) if (s.top < last.bottom + 0.3 * fs) cur.lines.push(s);
    }
    if (cur && cur.lines.filter((l) => l.tabular).length >= 2) regions.push(cur);
    cur = null;
    pendingSingles = [];
  };
  // Two lines inside the same ruled box are connected whatever the gap
  // (tall rows in bordered tables).
  const verticals = page?.rulings?.vertical || [];
  const bridged = (a, b) => verticals.filter((v) => v.y0 <= a.top + 2 && v.y1 >= b.bottom - 2 &&
    v.x >= Math.min(a.x0, b.x0) - 20 && v.x <= Math.max(a.x1, b.x1) + 20).length >= 2;

  for (const line of lines) {
    if (line.tabular) {
      const last = cur ? cur.lines[cur.lines.length - 1] : null;
      const gapFrom = pendingSingles.length ? pendingSingles[pendingSingles.length - 1] : last;
      if (cur && gapFrom && (line.top - gapFrom.bottom <= maxGap || bridged(gapFrom, line)) && compatible(cur, line)) {
        cur.lines.push(...pendingSingles, line);
      } else {
        close();
        cur = { lines: [line] };
      }
      pendingSingles = [];
      extend(cur, line);
      continue;
    }
    if (!cur) continue;
    const last = pendingSingles.length ? pendingSingles[pendingSingles.length - 1] : cur.lines[cur.lines.length - 1];
    const withinX = line.x0 >= cur.x0 - fs && line.x1 <= cur.x1 + fs * 2;
    const shortish = line.x1 - line.x0 <= Math.max(cur.x1 - cur.x0, 1) * 0.75;
    if (line.top - last.bottom <= maxGap && withinX && shortish && !isCaption(line) && pendingSingles.length < 2 &&
        Math.abs(line.fontSize - cur.fontSize) <= cur.fontSize * 0.2) {
      pendingSingles.push(line);
    } else {
      close();
    }
  }
  close();
  return regions;
}

function extend(region, line) {
  region.x0 = Math.min(region.x0 ?? Infinity, line.x0);
  region.x1 = Math.max(region.x1 ?? -Infinity, line.x1);
  region.fontSize = region.fontSize || line.fontSize;
}

// A new tabular line joins a region only if it plausibly shares its columns:
// its segments must not be wildly outside the region's x-extent.
function compatible(region, line) {
  const width = region.x1 - region.x0;
  return line.x0 >= region.x0 - width * 0.5 && line.x1 <= region.x1 + width * 0.8;
}

// Pulls short label lines directly above a region into it as header rows
// (spanning headers such as "Revenue" over "2025 | 2024"), stopping at a
// caption, a heading-sized line or prose.
function extendHeaderUp(region, lines) {
  const first = region.lines[0];
  let idx = lines.indexOf(first);
  const fs = region.fontSize;
  const added = [];
  while (idx > 0 && added.length < 3) {
    const cand = lines[idx - 1];
    const below = added.length ? added[added.length - 1] : first;
    if (below.top - cand.bottom > 3 * fs) break;
    if (isCaption(cand) || cand.tabular) break;
    if (Math.abs(cand.fontSize - fs) > fs * 0.2) break;
    if (cand.x0 < region.x0 - fs || cand.x1 > region.x1 + fs) break;
    if (cand.words.length > 8) break;
    added.push(cand);
    idx--;
  }
  if (added.length) {
    region.lines = [...added.reverse(), ...region.lines];
    region.extraHeaderLines = added.length;
  }
  return region;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

// Column intervals from whitespace channels: x positions covered by at most
// a small share of the region's lines separate columns.
//
// Coverage is measured on *words*, not segments, so tight tables whose label
// runs close to the first number still split. A channel only counts when, in
// the lines that have words on both sides of it, the gap is wider than an
// ordinary word space (or the words are numbers) — otherwise "North | America"
// would become two columns.
function columnsFromProjection(region) {
  const extra = region.extraHeaderLines || 0;
  const body = region.lines.slice(extra).filter((l) => l.tabular || l.segments.length === 1);
  const fs = region.fontSize || 10;
  const x0 = Math.floor(Math.min(...region.lines.map((l) => l.x0)));
  const x1 = Math.ceil(Math.max(...region.lines.map((l) => l.x1)));
  const width = x1 - x0 + 1;
  const hist = new Array(width).fill(0);
  for (const l of body) {
    for (const w of l.words) {
      for (let x = Math.max(0, Math.floor(w.x0) - x0); x <= Math.min(width - 1, Math.ceil(w.x1) - x0); x++) hist[x]++;
    }
  }
  const threshold = Math.floor(body.length * 0.12);
  const cols = [];
  let start = null;
  for (let i = 0; i < width; i++) {
    const covered = hist[i] > threshold;
    if (covered && start == null) start = i;
    if (!covered && start != null) { cols.push([start + x0, i - 1 + x0]); start = null; }
  }
  if (start != null) cols.push([start + x0, width - 1 + x0]);

  const realChannel = (left, right) => {
    let straddle = 0, real = 0;
    for (const l of body) {
      const before = l.words.filter((w) => w.x1 <= left + 1).pop();
      const after = l.words.find((w) => w.x0 >= right - 1);
      if (!before || !after) continue;
      straddle++;
      const gap = after.x0 - before.x1;
      if (gap >= 0.4 * fs || isNumericToken(after.text) || isNumericToken(before.text)) real++;
    }
    return straddle === 0 || real / straddle >= 0.5;
  };

  const merged = [];
  for (const c of cols) {
    const last = merged[merged.length - 1];
    if (last && (c[0] - last[1] < 2 || !realChannel(last[1], c[0]))) last[1] = c[1];
    else merged.push([...c]);
  }
  return merged;
}

// Column intervals from vertical rules that span most of the region.
function columnsFromRulings(region, verticals) {
  const top = Math.min(...region.lines.map((l) => l.top));
  const bottom = Math.max(...region.lines.map((l) => l.bottom));
  const height = Math.max(1, bottom - top);
  const spanning = verticals.filter((v) => Math.min(v.y1, bottom) - Math.max(v.y0, top) >= height * 0.6);
  // The outer borders can sit well outside the text (wide padded cells):
  // take the nearest rule at or left of the text and at or right of it.
  const leftEdge = Math.max(-Infinity, ...spanning.filter((v) => v.x <= region.x0 + 3).map((v) => v.x));
  const rightEdge = Math.min(Infinity, ...spanning.filter((v) => v.x >= region.x1 - 3).map((v) => v.x));
  const lo = Number.isFinite(leftEdge) ? leftEdge : region.x0 - 15;
  const hi = Number.isFinite(rightEdge) ? rightEdge : region.x1 + 15;
  const xs = spanning
    .filter((v) => v.x >= lo - 0.5 && v.x <= hi + 0.5)
    .map((v) => v.x)
    .sort((a, b) => a - b)
    .filter((x, i, arr) => i === 0 || x - arr[i - 1] > 3);
  if (xs.length < 3) return null;
  const cols = [];
  for (let i = 0; i + 1 < xs.length; i++) cols.push([xs[i], xs[i + 1]]);
  return cols.filter((c) => region.lines.some((l) => l.segments.some((s) => (s.x0 + s.x1) / 2 > c[0] && (s.x0 + s.x1) / 2 < c[1])));
}

// Horizontal rules crossing most of the region's width → row bands.
function rowRules(region, horizontals, cols) {
  const left = cols[0][0], right = cols[cols.length - 1][1];
  const width = Math.max(1, right - left);
  const top = Math.min(...region.lines.map((l) => l.top));
  const bottom = Math.max(...region.lines.map((l) => l.bottom));
  return horizontals
    .filter((h) => h.y >= top - 12 && h.y <= bottom + 12)
    .filter((h) => Math.min(h.x1, right) - Math.max(h.x0, left) >= width * 0.5)
    .map((h) => h.y)
    .sort((a, b) => a - b)
    .filter((y, i, arr) => i === 0 || y - arr[i - 1] > 2);
}

// ---------------------------------------------------------------------------
// Filters and confidence
// ---------------------------------------------------------------------------

function isTableOfContents(rows) {
  const texts = rows.map((r) => r.join(" "));
  const leaders = texts.filter((t) => /\.{4,}|(\.\s){4,}|…{2,}/.test(t)).length;
  if (leaders >= Math.max(2, rows.length * 0.5)) return true;
  const last = rows.map((r) => r[r.length - 1]).filter(Boolean);
  const ints = last.map((t) => (/^\d{1,4}$/.test(t.trim()) ? Number(t) : null));
  if (ints.length >= 3 && ints.every((n) => n != null) && ints.every((n, i) => i === 0 || n >= ints[i - 1])) {
    const otherNumeric = rows.some((r) => r.slice(0, -1).some((c) => c && isNumericToken(c)));
    if (!otherNumeric) return true;
  }
  return false;
}

// Bulleted or numbered lists laid out with hanging indents look like a
// narrow first column; they aren't tables.
const BULLET_RE = /^([•◦▪▫■□●○‣⁃∙·*–—-]|\(?[a-z0-9]{1,3}[.)])$/i;

// grid: string[][] of the candidate (headers included); headerRows count.
// alignment: 0..1 share of columns whose cells share a left, right or centre
// edge (1 for ruled tables) — ragged "columns" mean a layout, not a table.
function scoreCandidate({ grid, headerRows, ruled, wrapped, alignment = 1 }) {
  const width = grid[0]?.length || 0;
  const body = grid.slice(headerRows);
  const dataRows = body.filter((r) => r.filter((c) => c && c.trim()).length >= 2);
  const reasons = [];
  if (width < 2) reasons.push("fewer than 2 columns");
  if (dataRows.length < 2) reasons.push("fewer than 2 data rows");
  const cells = body.flat().filter((c) => c && c.trim());
  const avgWords = cells.length ? cells.reduce((a, c) => a + c.trim().split(/\s+/).length, 0) / cells.length : 0;
  if (avgWords > 8 && !ruled) reasons.push("prose");
  if (isTableOfContents(body)) reasons.push("table of contents");

  const valueCells = body.flatMap((r) => r.slice(1)).filter((c) => c && c.trim());
  const numericDensity = valueCells.length ? valueCells.filter((c) => isNumericToken(c.trim())).length / valueCells.length : 0;

  // Justified prose split at wide word gaps: long rows, few numbers.
  const wordsPerRow = body.length ? body.reduce((a, r) => a + r.join(" ").trim().split(/\s+/).filter(Boolean).length, 0) / body.length : 0;
  if (!ruled && wordsPerRow >= 10 && numericDensity < 0.3 && !reasons.includes("prose")) reasons.push("prose");
  const firstCol = body.map((r) => (r[0] || "").trim()).filter(Boolean);
  if (firstCol.length >= 2 && firstCol.filter((c) => BULLET_RE.test(c)).length >= firstCol.length * 0.6) reasons.push("list");
  const filledEnough = body.length ? body.filter((r) => r.filter((c) => c && c.trim()).length >= Math.max(2, width - 1)).length / body.length : 0;
  if (!ruled && numericDensity === 0 && width < 3) reasons.push("two text columns without rules");

  const confidence =
    0.2 * (ruled ? 1 : 0) +
    0.3 * filledEnough +
    0.3 * numericDensity +
    0.15 * (headerRows > 0 ? 1 : 0) +
    0.1 * (1 - Math.min(1, body.length ? wrapped / body.length : 0)) +
    (ruled && numericDensity === 0 ? 0.05 : 0);
  const adjusted = ruled ? confidence : confidence * (0.6 + 0.4 * alignment);
  return { confidence: Math.min(1, adjusted), rejected: reasons.length ? reasons : null, numericDensity };
}

export {
  CAPTION_RE,
  median,
  isNumericToken,
  groupLines,
  segmentLine,
  findRepeatedBands,
  bandKey,
  isCaption,
  isTabularLine,
  findRegions,
  extendHeaderUp,
  columnsFromProjection,
  columnsFromRulings,
  rowRules,
  isTableOfContents,
  scoreCandidate,
};
