// src/lib/tables/docx/docxTables.js
// Reads native Word tables (w:tbl) straight from word/document.xml (FR-1).
// mammoth.extractRawText() flattens tables into loose paragraphs, so the
// structure is recovered here instead. Pure: returns raw canonical tables.
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { makeRawTable } from "../schema.js";
import config from "../config.js";

const CAPTION_RE = /^(table|exhibit|schedule)\s+[\dA-Z][\w.\-]*/i;

function children(node, name) {
  const out = [];
  if (!node || !node.childNodes) return out;
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i];
    if (c.nodeType !== 1) continue;
    if (c.nodeName === name) out.push(c);
    // Content controls wrap rows/cells/paragraphs; look through them.
    else if (c.nodeName === "w:sdt") {
      const content = child(c, "w:sdtContent");
      if (content) out.push(...children(content, name));
    }
  }
  return out;
}

function child(node, name) {
  if (!node || !node.childNodes) return null;
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i];
    if (c.nodeType === 1 && c.nodeName === name) return c;
  }
  return null;
}

function attr(node, name) {
  if (!node) return null;
  return node.getAttribute(name) || node.getAttribute(name.replace(/^w:/, "")) || null;
}

// Text of a node: w:t runs, tabs and breaks as spaces, paragraphs joined by
// a space. Nested tables are flattened into the same string.
function textOf(node) {
  const parts = [];
  const walk = (n) => {
    if (!n || !n.childNodes) return;
    for (let i = 0; i < n.childNodes.length; i++) {
      const c = n.childNodes[i];
      if (c.nodeType !== 1) continue;
      if (c.nodeName === "w:t") parts.push(c.textContent || "");
      else if (c.nodeName === "w:tab" || c.nodeName === "w:br" || c.nodeName === "w:cr") parts.push(" ");
      else if (c.nodeName === "w:p") { walk(c); parts.push(" "); }
      else if (c.nodeName === "w:delText" || c.nodeName === "w:instrText") continue;
      else walk(c);
    }
  };
  walk(node);
  return parts.join("").replace(/\s+/g, " ").trim();
}

function paragraphStyle(p) {
  const pPr = child(p, "w:pPr");
  const style = child(pPr, "w:pStyle");
  return attr(style, "w:val") || "";
}

function isCaptionParagraph(p, text) {
  const style = paragraphStyle(p);
  return /caption/i.test(style) || CAPTION_RE.test(text);
}

function isHeadingParagraph(p) {
  return /^(heading|title)/i.test(paragraphStyle(p).replace(/\s+/g, ""));
}

// One w:tbl → expanded grid of cell objects + header row count.
function tableToGrid(tbl) {
  const rows = children(tbl, "w:tr");
  const grid = [];
  let headerRows = 0;
  let headerRun = true;
  const vOrigin = {}; // col → { r, j } of the cell a vMerge continues

  rows.forEach((tr, r) => {
    const trPr = child(tr, "w:trPr");
    const isHeader = !!child(trPr, "w:tblHeader");
    if (headerRun && isHeader) headerRows++;
    else headerRun = false;

    const row = [];
    let col = Number(attr(child(trPr, "w:gridBefore"), "w:val")) || 0;
    for (let k = 0; k < col; k++) row[k] = { raw: "" };

    for (const tc of children(tr, "w:tc")) {
      const tcPr = child(tc, "w:tcPr");
      const span = Math.max(1, Number(attr(child(tcPr, "w:gridSpan"), "w:val")) || 1);
      const vMerge = child(tcPr, "w:vMerge");
      const vMergeVal = vMerge ? attr(vMerge, "w:val") : null;

      if (vMerge && vMergeVal !== "restart" && vOrigin[col]) {
        const o = vOrigin[col];
        grid[o.r][o.j].rowSpan = (grid[o.r][o.j].rowSpan || 1) + 1;
        for (let k = 0; k < span; k++) row[col + k] = { raw: "", spanned: true };
      } else {
        const cell = { raw: textOf(tc) };
        if (span > 1) cell.colSpan = span;
        row[col] = cell;
        for (let k = 1; k < span; k++) row[col + k] = { raw: "", spanned: true };
        if (vMergeVal === "restart") vOrigin[col] = { r, j: col };
        else delete vOrigin[col];
      }
      col += span;
    }
    grid.push(row);
  });

  const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
  grid.forEach((r) => { for (let j = 0; j < width; j++) if (!r[j]) r[j] = { raw: "" }; });
  return { grid, headerRows };
}

// Tables used purely for page layout: a single row/column, a single filled
// column, or a couple of rows of long prose.
function isLayoutTable(grid) {
  if (grid.length < 2) return true;
  const width = grid[0]?.length || 0;
  if (width < config.MIN_COLUMNS) return true;
  const filledCols = new Set();
  let chars = 0, filled = 0;
  grid.forEach((r) => r.forEach((c, j) => {
    const t = String(c.raw || "").trim();
    if (t) { filledCols.add(j); chars += t.length; filled++; }
  }));
  if (filledCols.size < 2) return true;
  if (grid.length <= 3 && filled > 0 && chars / filled > 200) return true;
  return false;
}

async function extractDocxTables(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file("word/document.xml");
  if (!entry) return { tables: [], stats: { candidatesSeen: 0, skippedLayout: 0 } };
  const xml = await entry.async("string");
  const doc = new DOMParser({ onError: () => {} }).parseFromString(xml, "text/xml");
  const body = doc.getElementsByTagName("w:body")[0];
  if (!body) return { tables: [], stats: { candidatesSeen: 0, skippedLayout: 0 } };

  const blocks = [];
  const collect = (node) => {
    for (let i = 0; i < node.childNodes.length; i++) {
      const c = node.childNodes[i];
      if (c.nodeType !== 1) continue;
      if (c.nodeName === "w:p" || c.nodeName === "w:tbl") blocks.push(c);
      else if (c.nodeName === "w:sdt") { const sc = child(c, "w:sdtContent"); if (sc) collect(sc); }
    }
  };
  collect(body);

  const tables = [];
  let candidatesSeen = 0, skippedLayout = 0;
  let lastCaption = null;
  let lastHeading = null;
  let paragraphsSinceCaption = 0;

  blocks.forEach((node, bi) => {
    if (node.nodeName === "w:p") {
      const text = textOf(node);
      if (!text) return;
      if (isCaptionParagraph(node, text)) { lastCaption = text; paragraphsSinceCaption = 0; return; }
      if (isHeadingParagraph(node) || (text.length <= 120 && !/[.!?]$/.test(text))) lastHeading = text;
      paragraphsSinceCaption++;
      if (paragraphsSinceCaption > 2) lastCaption = null;
      return;
    }

    candidatesSeen++;
    const { grid, headerRows } = tableToGrid(node);
    if (isLayoutTable(grid)) { skippedLayout++; return; }

    let caption = lastCaption;
    if (!caption) {
      // Some documents put the caption directly below the table.
      const next = blocks[bi + 1];
      if (next && next.nodeName === "w:p") {
        const t = textOf(next);
        if (t && isCaptionParagraph(next, t)) caption = t;
      }
    }
    tables.push({
      raw: makeRawTable(grid, { headerRows, caption }),
      caption: caption || null,
      nearbyHeading: lastHeading,
      pageStart: null,
      pageEnd: null,
      confidence: 1,
      sourceType: "docx_xml",
      sourceText: null,
    });
    lastCaption = null;
    paragraphsSinceCaption = 0;
  });

  return { tables, stats: { candidatesSeen, skippedLayout } };
}

export { extractDocxTables, tableToGrid, isLayoutTable };
