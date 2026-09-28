// src/lib/tables/pdf/textLayer.js
// Reads one PDF page into positioned words and ruling lines, both in
// top-left page coordinates (y grows downward), for detect.js/structure.js.
import { createRequire } from "module";

process.env.PDFJS_DISABLE_WORKER = "true";
const require = createRequire(import.meta.url);
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

const OPS = pdfjsLib.OPS;
const LINE_MAX_THICKNESS = 2.5; // pt — thicker filled rects are shading, not rules

async function openPdf(buffer) {
  // Copy: pdfjs transfers (detaches) the array it is given.
  const data = new Uint8Array(buffer);
  return pdfjsLib.getDocument({ data, verbosity: 0, disableFontFace: true, isEvalSupported: false }).promise;
}

function multiply(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// Splits a pdfjs text item into words, estimating each word's x from its
// character offset (items often hold a whole line, "North America  1,234.5").
function itemToWords(item, viewport) {
  const str = item.str || "";
  if (!str.trim()) return [];
  const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
  const fontSize = Math.hypot(tx[2], tx[3]) || item.height || 10;
  const x0 = tx[4];
  const baseline = tx[5];
  const width = Math.abs(item.width * viewport.scale) || fontSize * 0.5 * str.length;
  const charW = width / Math.max(1, str.length);
  const words = [];
  const re = /\S+/g;
  let m;
  let prevEnd = null;
  while ((m = re.exec(str))) {
    const start = m.index;
    const end = start + m[0].length;
    words.push({
      text: m[0],
      x0: x0 + start * charW,
      x1: x0 + end * charW,
      top: baseline - fontSize * 0.8,
      bottom: baseline + fontSize * 0.2,
      baseline,
      fontSize,
      fontName: item.fontName || "",
      // Number of spaces before this word inside the same item; 2+ spaces is a
      // strong column-break hint in PDFs that pad cells with spaces.
      spacesBefore: prevEnd == null ? null : start - prevEnd,
    });
    prevEnd = end;
  }
  return words;
}

// Collects horizontal and vertical ruling segments from the operator list:
// stroked moveTo/lineTo paths and rectangles, plus thin filled rectangles
// (many generators draw rules as filled 0.5pt boxes).
function collectRulings(opList, viewport) {
  const horizontal = [];
  const vertical = [];
  const stack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let pending = null; // segments of the last constructPath awaiting stroke/fill

  const toPage = (x, y) => {
    const [px, py] = apply(ctm, x, y);
    return viewport.convertToViewportPoint(px, py);
  };

  const addSegment = (a, b, thickness = 0) => {
    const dx = Math.abs(a[0] - b[0]);
    const dy = Math.abs(a[1] - b[1]);
    if (dy <= Math.max(1, thickness) && dx >= 4) {
      horizontal.push({ y: (a[1] + b[1]) / 2, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]) });
    } else if (dx <= Math.max(1, thickness) && dy >= 4) {
      vertical.push({ x: (a[0] + b[0]) / 2, y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) });
    }
  };

  const addRect = (x, y, w, h, filled) => {
    const p1 = toPage(x, y);
    const p2 = toPage(x + w, y + h);
    const left = Math.min(p1[0], p2[0]), right = Math.max(p1[0], p2[0]);
    const top = Math.min(p1[1], p2[1]), bottom = Math.max(p1[1], p2[1]);
    const rw = right - left, rh = bottom - top;
    if (rh <= LINE_MAX_THICKNESS && rw >= 4) horizontal.push({ y: (top + bottom) / 2, x0: left, x1: right });
    else if (rw <= LINE_MAX_THICKNESS && rh >= 4) vertical.push({ x: (left + right) / 2, y0: top, y1: bottom });
    else if (!filled && rw >= 4 && rh >= 4) {
      // A stroked box: its four edges are rules (cell borders).
      horizontal.push({ y: top, x0: left, x1: right }, { y: bottom, x0: left, x1: right });
      vertical.push({ x: left, y0: top, y1: bottom }, { x: right, y0: top, y1: bottom });
    }
  };

  const { fnArray, argsArray } = opList;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = multiply(ctm, args);
    else if (fn === OPS.constructPath) {
      const [ops, coords] = args;
      const segs = [];
      const rects = [];
      let ci = 0;
      let cur = null;
      let start = null;
      for (const op of ops) {
        if (op === OPS.moveTo) { cur = [coords[ci], coords[ci + 1]]; start = cur; ci += 2; }
        else if (op === OPS.lineTo) {
          const next = [coords[ci], coords[ci + 1]]; ci += 2;
          if (cur) segs.push([cur, next]);
          cur = next;
        } else if (op === OPS.rectangle) {
          rects.push(coords.slice(ci, ci + 4)); ci += 4;
        } else if (op === OPS.curveTo) { cur = [coords[ci + 4], coords[ci + 5]]; ci += 6; }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { cur = [coords[ci + 2], coords[ci + 3]]; ci += 4; }
        else if (op === OPS.closePath) { if (cur && start) segs.push([cur, start]); cur = start; }
      }
      pending = { segs, rects, ctm };
    } else if (pending && (fn === OPS.stroke || fn === OPS.closeStroke)) {
      const saved = ctm; ctm = pending.ctm;
      for (const [a, b] of pending.segs) addSegment(toPage(a[0], a[1]), toPage(b[0], b[1]));
      for (const r of pending.rects) addRect(r[0], r[1], r[2], r[3], false);
      ctm = saved; pending = null;
    } else if (pending && (fn === OPS.fill || fn === OPS.eoFill || fn === OPS.fillStroke || fn === OPS.eoFillStroke ||
               fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke)) {
      const saved = ctm; ctm = pending.ctm;
      for (const r of pending.rects) addRect(r[0], r[1], r[2], r[3], true);
      // Thin filled polygons drawn with lineTo (rare) — treat their bounding box.
      if (!pending.rects.length && pending.segs.length >= 3) {
        const pts = pending.segs.flat().map((p) => toPage(p[0], p[1]));
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
        if (h <= LINE_MAX_THICKNESS && w >= 4) horizontal.push({ y: (Math.max(...ys) + Math.min(...ys)) / 2, x0: Math.min(...xs), x1: Math.max(...xs) });
        else if (w <= LINE_MAX_THICKNESS && h >= 4) vertical.push({ x: (Math.max(...xs) + Math.min(...xs)) / 2, y0: Math.min(...ys), y1: Math.max(...ys) });
      }
      ctm = saved; pending = null;
    } else if (fn === OPS.endPath || fn === OPS.clip || fn === OPS.eoClip) {
      if (fn === OPS.endPath) pending = null;
    }
  }
  return { horizontal: mergeRulings(horizontal, "h"), vertical: mergeRulings(vertical, "v") };
}

// Joins collinear, touching segments (cell borders are often drawn per cell).
function mergeRulings(lines, dir) {
  const TOL = 1.5;
  const key = dir === "h" ? "y" : "x";
  const a0 = dir === "h" ? "x0" : "y0";
  const a1 = dir === "h" ? "x1" : "y1";
  const sorted = [...lines].sort((p, q) => p[key] - q[key] || p[a0] - q[a0]);
  const out = [];
  for (const l of sorted) {
    const last = out.find((o) => Math.abs(o[key] - l[key]) <= TOL && l[a0] <= o[a1] + 3 && l[a1] >= o[a0] - 3);
    if (last) {
      last[a0] = Math.min(last[a0], l[a0]);
      last[a1] = Math.max(last[a1], l[a1]);
    } else out.push({ ...l });
  }
  return out;
}

async function readPage(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  const words = content.items.flatMap((it) => itemToWords(it, viewport));
  let rulings = { horizontal: [], vertical: [] };
  try {
    rulings = collectRulings(await page.getOperatorList(), viewport);
  } catch (err) {
    console.warn(`⚠️  [tables] Could not read drawing operators on page ${pageNumber}:`, err.message);
  }
  const result = { pageNumber, width: viewport.width, height: viewport.height, words, rulings };
  page.cleanup();
  return result;
}

export { openPdf, readPage, itemToWords, collectRulings, mergeRulings };
