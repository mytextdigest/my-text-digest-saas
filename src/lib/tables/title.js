// src/lib/tables/title.js
// Table titles (FR-10, FR-11): caption first; everything else in ONE batched
// LLM call per document; deterministic fallback when the LLM is off or fails.
import { MODEL_QA } from "./config.js";
import { colLabel } from "./clean.js";

const CAPTION_TITLE_RE = /^(?:table|exhibit|schedule)\s+[\dA-Z][\w.\-]*\s*[:.\-–—]\s*(.+)$/i;
const UNIT_SUFFIX_RE = /\s*\((?:in|amounts in|all amounts in|expressed in|unaudited)[^)]*\)\s*$/i;

function tidy(s) {
  return String(s || "").replace(/\s+/g, " ").trim().replace(/[.:;,]+$/, "");
}

// "Table 1: Revenue by Region (in $ millions)" → "Revenue by Region".
function titleFromCaption(caption) {
  if (!caption) return null;
  const m = String(caption).trim().match(CAPTION_TITLE_RE);
  if (!m) return null;
  const t = tidy(m[1].replace(UNIT_SUFFIX_RE, ""));
  return t.length >= 2 ? t.slice(0, 120) : null;
}

function fallbackTitle(clean, index) {
  if (clean && Array.isArray(clean.columns)) {
    const labelIdx = clean.columns.findIndex((c) => c.type === "text");
    const label = labelIdx >= 0 ? colLabel(clean.columns[labelIdx], labelIdx) : "";
    const numeric = clean.columns.filter((c) => c.type !== "text");
    const parent = numeric.map((c) => (c.headerPath || []).length > 1 ? c.headerPath[0] : null).find(Boolean);
    const metric = parent || numeric.map((c) => c.label).find((l) => l && !/^(19|20)\d{2}$/.test(l) && !/^(FY|Q[1-4]|H[12])/i.test(l));
    if (metric && label) return `${metric} by ${label}`;
    if (metric) return metric;
  }
  return `Table ${index + 1}`;
}

// Makes titles unique within a document by appending a period or page.
function dedupeTitles(items) {
  const seen = new Map();
  for (const it of items) {
    const key = (it.title || "").toLowerCase();
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  const used = new Set();
  for (const it of items) {
    const key = (it.title || "").toLowerCase();
    if (seen.get(key) > 1) {
      const period = (it.clean?.columns || []).map((c) => c.period).filter(Boolean)[0];
      let cand = period ? `${it.title} (${period})` : it.pageStart ? `${it.title} (p. ${it.pageStart})` : it.title;
      let n = 2;
      while (used.has(cand.toLowerCase())) cand = `${it.title} (${n++})`;
      it.title = cand;
    }
    used.add(it.title.toLowerCase());
  }
  return items;
}

function describeForPrompt(it, i) {
  const clean = it.clean || {};
  const labelIdx = (clean.columns || []).findIndex((c) => c.type === "text");
  const firstColumnLabels = labelIdx >= 0
    ? (clean.rows || []).slice(0, 10).map((r) => String(r.cells[labelIdx]?.raw || "").trim()).filter(Boolean)
    : [];
  return {
    i,
    where: it.sheetName ? `sheet ${it.sheetName}` : it.pageStart ? `page ${it.pageStart}` : `table ${i + 1}`,
    nearbyHeading: it.nearbyHeading || null,
    caption: it.caption || null,
    headers: (clean.columns || []).map((c, j) => (c.headerPath || [colLabel(c, j)]).join(" › ")),
    units: clean.tableUnit || null,
    firstColumnLabels,
  };
}

// items: [{ clean, caption, nearbyHeading, pageStart, sheetName, title? }].
// Mutates items: sets title, titleSource, description. Returns { llmUsed }.
async function titleTables(openai, items, { docName = "", useLLM = true } = {}) {
  items.forEach((it, i) => {
    if (it.title && it.titleSource) return;
    const fromCaption = titleFromCaption(it.caption);
    if (fromCaption) { it.title = fromCaption; it.titleSource = "caption"; }
    else if (it.sourceType === "spreadsheet" && it.title) { it.titleSource = "sheet"; }
  });

  // Everything still untitled — plus captioned tables, which still need a
  // description — goes into one call.
  let llmUsed = false;
  if (useLLM && openai && items.length) {
    try {
      const payload = items.map(describeForPrompt);
      const resp = await openai.chat.completions.create({
        model: MODEL_QA,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You name tables extracted from a document. For each table return a short title (2–6 words) that says what the table contains, " +
              "e.g. \"Revenue by Region\" or \"Operating Expenses\" — never \"Table 3\" or a description of the layout — and a one-sentence " +
              "description (max 20 words). Use only the information given. Respond with JSON: {\"tables\":[{\"i\":0,\"title\":\"…\",\"description\":\"…\"}]}.",
          },
          { role: "user", content: `Document: ${docName}\n\n${JSON.stringify(payload)}` },
        ],
      });
      const parsed = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
      for (const r of parsed.tables || []) {
        const it = items[r.i];
        if (!it) continue;
        const title = tidy(r.title).slice(0, 80);
        if (!it.title && title && title.split(/\s+/).length <= 10 && !/^table\s*\d+$/i.test(title)) {
          it.title = title;
          it.titleSource = "generated";
        }
        const description = tidy(r.description).slice(0, 240);
        if (description && !it.description) it.description = description;
      }
      llmUsed = true;
    } catch (err) {
      console.warn("⚠️  [tables] Title generation failed; using fallbacks:", err.message || err);
    }
  }

  items.forEach((it, i) => {
    if (!it.title) { it.title = fallbackTitle(it.clean, i); it.titleSource = "generated"; }
    if (!it.titleSource) it.titleSource = "generated";
  });
  dedupeTitles(items);
  return { llmUsed };
}

export { titleFromCaption, fallbackTitle, dedupeTitles, titleTables };
