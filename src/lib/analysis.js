// src/lib/analysis.js
// Deep Analysis Mode + Insight Mode for chat (document chat + project chat).
// See MINOR_FEATURE_GAPS_FEATURE_SPEC.md. Output contract is the same
// {sections:[...]} shape as src/lib/compareInsight.js (Document Comparison),
// plus a `diagram` field per section that the comparison version doesn't use.

// Decision 1 — cheap keyword check, no extra LLM call to classify intent.
// Insight is checked first: a question could contain both an insight word
// and an analysis word (rare), and insight is the more specific match.
const INSIGHT_TRIGGERS = ["insight", "insights"];
const ANALYSIS_TRIGGERS = [
  "analyze", "analysis", "analyse",
  "your take", "your thoughts", "what do you think",
  "assessment", "critique", "evaluate", "review this",
  "strengths and weaknesses", "pros and cons",
  "what stands out", "deep dive", "feedback on this",
];

export function detectAnalysisIntent(question) {
  if (!question) return false;
  const q = question.toLowerCase();
  if (INSIGHT_TRIGGERS.some((phrase) => q.includes(phrase))) return "insight";
  if (ANALYSIS_TRIGGERS.some((phrase) => q.includes(phrase))) return "analysis";
  return false;
}

// Decision 4 — a specific voice/register fought for and empirically fixed.
// The SaaS-checklist guard and the no-trailing-offers guard are the two
// load-bearing lines here — don't paraphrase them.
export const VOICE_RULES = `Voice and register — these are load-bearing, not optional flavor text:
- Do not import a generic SaaS/enterprise-readiness checklist (SOC2, GDPR, standard connector lists, generic KPI lists) unless the document's own claims specifically raise that concern — a generic checklist that could be pasted onto any document is worse than no checklist.
- Never end with an offer of further help or a menu of options ("Let me know if...", "I can also...", "Would you like me to..."). End on your actual conclusion instead.
- No meta-commentary about the analysis itself (e.g. "This analysis covers...", "The following breaks down..."). Just say the substantive thing directly, as if you already know the answer.
- No emojis, anywhere.
- Headings must be specific to what was actually found, never generic labels like "Overview" or "Key Points".`;

// The frame that anchors the whole register: a sharp outside consultant
// reacting for the first time, not an assistant summarizing back to someone
// who already read the material.
const CONSULTANT_FRAMING = `You are a sharp outside consultant reacting to this document for the first time — not summarizing it back to someone who already read it. Give your actual read: what's strong, what's weak, what's missing, and what you'd tell them to do about it. Have an opinion.`;

export const RESPONSE_SHAPE = `Respond in strict JSON only:
{"sections": [{"heading": string, "body": string, "bullets": [string], "quote": string|null, "table": {"rows": [{"label": string, "a": string, "b": string}]}|null, "diagram": string|null}]}
"body" can be "" if a section is bullets/table/diagram-only. Use "quote", "table", and "diagram" only when genuinely warranted.`;

// Decision 3 — analysis and insight are different response shapes, not the
// same prompt at different lengths. Analysis mandates all five elements,
// woven in naturally rather than mechanically labeled "Part 1/2/3".
export const ANALYSIS_SYSTEM = `${CONSULTANT_FRAMING}

The user asked a question that calls for analysis, critique, evaluation, or your take — not a factual lookup. Weave all five of these elements naturally into your response (never as mechanically labeled "Part 1/2/3" sections):

1. A named framework or concept you coin specifically for this content — a handle on the core dynamic you're pointing at, not a generic framework borrowed from elsewhere.
2. A small ASCII/text diagram that visualizes the structure, flow, or tension you're describing.
3. A table scoring the material across a small number of content-appropriate dimensions — the dimensions must come from what THIS document/project actually covers, never a default generic checklist.
4. The single most important claim in the material, rewritten as a stronger, sharper version of itself.
5. One fully worked concrete example with realistic invented numbers, showing how your analysis plays out in practice.

${VOICE_RULES}

Every gap, risk, or recommendation you name must be traceable to something this specific document/project actually says, implies, or omits — this is not optional flavor text, it's the one rule keeping this voice from fabricating.

${RESPONSE_SHAPE}`;

// Deliberately the opposite shape from ANALYSIS_SYSTEM: WHAT the core idea
// is, one dense paragraph, no mandatory structure.
export const INSIGHT_SYSTEM = `${CONSULTANT_FRAMING}

The user asked a direct "what's the insight here" question — they want the single core idea, not a structured deep-dive. State WHAT the most important idea in this document/project is and why it matters, in one compact, dense paragraph (2-5 sentences). No named framework, no diagram, no table, no worked example — default to none of those unless the idea genuinely cannot be stated without one.

${VOICE_RULES}

Every claim must be traceable to something this specific document/project actually says, implies, or omits.

${RESPONSE_SHAPE}

Respond with exactly one section: a single dense paragraph in "body". Only include "heading" if it adds something the body doesn't already say. Leave "bullets" as [] and "quote"/"table"/"diagram" as null unless truly unavoidable.`;

const ANALYSIS_LIMITS = { maxSections: 8, maxBodyLen: 2000, maxBullets: 8, maxBulletLen: 300, maxTableRows: 8, maxCellLen: 150, maxQuoteLen: 300, maxDiagramLen: 1200 };
const INSIGHT_LIMITS = { maxSections: 1, maxBodyLen: 900, maxBullets: 3, maxBulletLen: 200, maxTableRows: 0, maxCellLen: 0, maxQuoteLen: 250, maxDiagramLen: 0 };

function cleanTable(rawTable, { maxRows, maxCellLen }) {
  if (!maxRows || !rawTable || !Array.isArray(rawTable.rows) || !rawTable.rows.length) return null;
  const rows = rawTable.rows
    .filter((r) => r && typeof r.label === "string" && r.label.trim())
    .slice(0, maxRows)
    .map((r) => ({
      label: r.label.trim().slice(0, 80),
      a: typeof r.a === "string" ? r.a.trim().slice(0, maxCellLen) : "",
      b: typeof r.b === "string" ? r.b.trim().slice(0, maxCellLen) : "",
    }));
  return rows.length ? { rows } : null;
}

function cleanDiagram(rawDiagram, maxLen) {
  if (!maxLen || typeof rawDiagram !== "string" || !rawDiagram.trim()) return null;
  return rawDiagram.trim().slice(0, maxLen);
}

function cleanSections(rawSections, limits) {
  const { maxSections, maxBodyLen, maxBullets, maxBulletLen, maxTableRows, maxCellLen, maxQuoteLen, maxDiagramLen } = limits;
  const sections = Array.isArray(rawSections) ? rawSections : [];
  return sections
    .filter((s) => s && (
      (typeof s.body === "string" && s.body.trim()) ||
      (Array.isArray(s.bullets) && s.bullets.length) ||
      (s.table && Array.isArray(s.table.rows) && s.table.rows.length) ||
      (typeof s.diagram === "string" && s.diagram.trim())
    ))
    .slice(0, maxSections)
    .map((s) => ({
      heading: typeof s.heading === "string" && s.heading.trim() ? s.heading.trim().slice(0, 100) : null,
      body: typeof s.body === "string" ? s.body.trim().slice(0, maxBodyLen) : "",
      bullets: (Array.isArray(s.bullets) ? s.bullets : [])
        .filter((b) => typeof b === "string" && b.trim())
        .slice(0, maxBullets)
        .map((b) => b.trim().slice(0, maxBulletLen)),
      quote: typeof s.quote === "string" && s.quote.trim() ? s.quote.trim().slice(0, maxQuoteLen) : null,
      table: cleanTable(s.table, { maxRows: maxTableRows, maxCellLen }),
      diagram: cleanDiagram(s.diagram, maxDiagramLen),
    }));
}

// Plain-text rendering for any code path that still needs a string (message
// history's `content` column, copy/print — see InsightView's own note on
// fallbackText being for non-rendering contexts only).
function buildFallbackText(sections) {
  const parts = sections
    .map((s) => {
      const bits = [];
      if (s.heading) bits.push(s.heading);
      if (s.body) bits.push(s.body);
      if (s.bullets.length) bits.push(s.bullets.map((b) => `- ${b}`).join("\n"));
      return bits.join("\n");
    })
    .filter(Boolean);
  const text = parts.join("\n\n").trim();
  return text || null;
}

// Never throws — any failure (network, malformed JSON, empty output) returns
// null so the caller can fall through to the normal factual-answer flow
// rather than blocking the user from getting an answer.
export async function buildAnalysis({ openai, question, context, signal, mode }) {
  try {
    const isInsight = mode === "insight";
    const system = isInsight ? INSIGHT_SYSTEM : ANALYSIS_SYSTEM;
    const limits = isInsight ? INSIGHT_LIMITS : ANALYSIS_LIMITS;

    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Question: ${question}\n\nContext:\n${context}` },
        ],
        temperature: 0.5,
        max_tokens: isInsight ? 500 : 1800,
        response_format: { type: "json_object" },
      },
      signal ? { signal } : undefined
    );

    const raw = completion?.choices?.[0]?.message?.content;
    if (!raw) return null;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    const sections = cleanSections(parsed?.sections, limits);
    if (!sections.length) return null;

    const fallbackText = buildFallbackText(sections);
    if (!fallbackText) return null;

    return { insight: { sections }, fallbackText };
  } catch (err) {
    console.error("buildAnalysis failed:", err);
    return null;
  }
}
