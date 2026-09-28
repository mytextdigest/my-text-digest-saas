// src/lib/tables/repair.js
// LLM repair for low-confidence PDF tables (FR-6). The model may only
// regroup the region's existing tokens into rows and columns — its output is
// rejected unless every token (numbers especially) comes from the source.
import { MODEL_QA } from "./config.js";
import config from "./config.js";
import { makeRawTable } from "./schema.js";
import { verifyGrid } from "./verify.js";

function sourceWords(lines) {
  const set = new Set();
  for (const line of lines || []) for (const seg of line) for (const w of String(seg.text).split(/\s+/)) if (w) set.add(w);
  return set;
}

// Every whitespace-separated word of every output cell must be a source word
// (or a concatenation of adjacent source words, which the model may merge).
function tokensGrounded(grid, words) {
  const joined = [...words].join(" ");
  for (const row of grid) {
    for (const cell of row) {
      for (const w of String(cell || "").split(/\s+/).filter(Boolean)) {
        if (!words.has(w) && !joined.includes(w)) return false;
      }
    }
  }
  return true;
}

async function runLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// candidates: extracted PDF tables (with .lines and .sourceText). Mutates the
// ones it repairs: replaces .raw, sets .repaired = true. Returns count.
async function repairLowConfidence(openai, candidates) {
  if (!openai) return 0;
  const eligible = candidates
    .filter((c) => c.lowConfidence && c.sourceType === "pdf_text" && Array.isArray(c.lines) && c.lines.length)
    .slice(0, config.MAX_REPAIRS_PER_DOCUMENT);
  if (!eligible.length) return 0;

  const outcomes = await runLimited(eligible, 3, async (cand) => {
    try {
      const lines = cand.lines.map((segs) => segs.map((s) => `${s.text}@${s.x}`).join("  ")).join("\n");
      const resp = await openai.chat.completions.create({
        model: MODEL_QA,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You reconstruct a table from text fragments extracted from a PDF. Each input line is one visual line; each fragment is text@x (its left x position). " +
              "Return the table as a grid of rows and columns. Use ONLY these fragments, in this order; you may merge adjacent fragments into one cell and leave cells empty, " +
              "but never alter, invent or reorder characters. Respond with JSON: {\"headerRows\": <number of header rows>, \"rows\": [[\"cell\", ...], ...]}.",
          },
          { role: "user", content: lines.slice(0, 12000) },
        ],
      });
      const parsed = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
      const rows = Array.isArray(parsed.rows) ? parsed.rows.filter(Array.isArray).map((r) => r.map((c) => String(c ?? "").trim())) : [];
      if (rows.length < 2 || Math.max(...rows.map((r) => r.length)) < 2) return false;
      if (!tokensGrounded(rows, sourceWords(cand.lines))) return false;
      if (verifyGrid(rows, cand.sourceText).issues > 0) return false;
      const headerRows = Math.max(0, Math.min(3, Number(parsed.headerRows) || 0));
      const provenance = { pages: cand.raw.provenance?.pages || [cand.pageStart], bbox: cand.raw.provenance?.bbox };
      cand.raw = makeRawTable(rows, { headerRows, caption: cand.caption, provenance });
      cand.repaired = true;
      return true;
    } catch (err) {
      console.warn("⚠️  [tables] Repair failed; keeping heuristic grid:", err.message || err);
      return false;
    }
  });
  return outcomes.filter(Boolean).length;
}

export { repairLowConfidence, tokensGrounded, runLimited };
