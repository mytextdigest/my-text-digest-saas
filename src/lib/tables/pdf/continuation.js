// src/lib/tables/pdf/continuation.js
// Merges a table that continues across a page break into one logical table
// (FR-3). Pure.

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9|]+/g, "");
}

function similarity(a, b) {
  const x = norm(a), y = norm(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  if (x === y) return 1;
  // Character bigram Dice coefficient.
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const gx = grams(x), gy = grams(y);
  let overlap = 0;
  for (const [g, c] of gx) overlap += Math.min(c, gy.get(g) || 0);
  return (2 * overlap) / Math.max(1, x.length - 1 + y.length - 1);
}

function sameColumns(a, b) {
  if (a.raw.columns.length !== b.raw.columns.length) return false;
  if (!a.colCentres || !b.colCentres) return true;
  return a.colCentres.every((x, i) => Math.abs(x - b.colCentres[i]) <= 12);
}

function canContinue(a, b) {
  if (b.pageStart !== a.pageEnd + 1) return false;
  if (a.raw.columns.length !== b.raw.columns.length) return false;
  if (b.caption && a.caption && similarity(a.caption, b.caption) < 0.9 && !/continued|cont\.|\(cont/i.test(b.caption)) return false;
  // A near the bottom of its page, B near the top of the next.
  const aLow = a.bottom == null || a.pageHeight == null || a.bottom >= a.pageHeight * 0.6;
  const bHigh = b.top == null || b.pageHeight == null || b.top <= b.pageHeight * 0.4;
  if (!aLow || !bHigh) return false;
  const headerRepeat = a.headerTexts?.length && b.headerTexts?.length &&
    similarity(a.headerTexts.join("|"), b.headerTexts.join("|")) >= 0.9;
  const continuedMarker = /continued|cont\.|\(cont/i.test(b.caption || "");
  const noHeader = !b.headerTexts || b.headerTexts.length === 0;
  return !!(headerRepeat || continuedMarker || (noHeader && sameColumns(a, b)) || (b.caption == null && sameColumns(a, b)));
}

function mergeInto(a, b) {
  const aHeaderCount = a.raw.rows.filter((r) => r.kind === "header").length;
  const bHeaderRows = b.raw.rows.filter((r) => r.kind === "header");
  const dropHeader = bHeaderRows.length && a.headerTexts?.length &&
    similarity(a.headerTexts.join("|"), b.headerTexts.join("|")) >= 0.9;
  const offset = a.raw.rows.length;
  const bRows = b.raw.rows
    .filter((r) => !(dropHeader && r.kind === "header"))
    .map((r) => ({ ...r, kind: r.kind === "header" && aHeaderCount ? "data" : r.kind }));
  const remap = new Map();
  bRows.forEach((r, i) => {
    const oldId = r.id;
    r.id = `r${offset + i}`;
    remap.set(oldId, r.id);
  });
  a.raw.rows.push(...bRows);
  const boxes = { ...(a.raw.provenance?.cellBoxes || {}) };
  for (const [key, box] of Object.entries(b.raw.provenance?.cellBoxes || {})) {
    const [rid, cid] = key.split(":");
    if (remap.has(rid)) boxes[`${remap.get(rid)}:${cid}`] = box;
  }
  a.raw.provenance = {
    ...(a.raw.provenance || {}),
    pages: [...new Set([...(a.raw.provenance?.pages || []), ...(b.raw.provenance?.pages || [])])],
    cellBoxes: boxes,
  };
  a.pageEnd = b.pageEnd;
  // A fragment absorbed into a real table is no longer a fragment; a table
  // that absorbs a fragment stays whatever it was.
  if (!a.fragment || !b.fragment) {
    const dataRows = a.raw.rows.filter((r) => r.kind !== "header" && r.cells.filter((c) => c.raw.trim()).length >= 2).length;
    if (dataRows >= 2) a.fragment = false;
  }
  a.bottom = b.bottom;
  a.pageHeight = b.pageHeight;
  a.confidence = Math.round(((a.confidence + b.confidence) / 2) * 100) / 100;
  a.sourceText = `${a.sourceText}\n${b.sourceText}`;
  a.lines = [...(a.lines || []), ...(b.lines || [])];
  return a;
}

// candidates: in document order. Returns merged list.
function mergeContinuations(candidates) {
  const out = [];
  for (const c of candidates) {
    const prev = out[out.length - 1];
    if (prev && canContinue(prev, c)) {
      // Only the last table on prev's page and the first on c's page qualify.
      const firstOnPage = !out.some((o) => o !== prev && o.pageStart === c.pageStart);
      if (firstOnPage) { mergeInto(prev, c); continue; }
    }
    out.push(c);
  }
  return out;
}

export { mergeContinuations, canContinue, similarity };
