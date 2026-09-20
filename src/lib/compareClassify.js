// src/lib/compareClassify.js
// LLM narrative pass for Document Comparison. Consumes compareAlignment.js's
// deterministic output — the model is only ever asked to classify/explain,
// never to decide onlyInA/onlyInB categories (those are enforced by
// enforceCategory, not trusted from here).
//
// Ported near-verbatim from the desktop app's electron/compare/classify.js,
// plus the selectForClassification cost-control logic (now in
// compareAlignment.js) and a cost cap independent of document size.

// All unmatched chunks (added/removed) are always classified; matched pairs
// are capped at this many total classification calls, independent of
// document size — keeps a large-document comparison bounded in cost/latency.
export const CLASSIFICATION_CAP = 40;

const MATCHED_SYSTEM = `You compare a section from "Document A" against the corresponding section from "Document B". Classify what changed and explain it in plain language for someone who has not read either document. Respond in valid JSON only: {"sectionLabel": string, "category": "same"|"changed", "explanation": string}. "sectionLabel" is a short (2-6 word) human label for what this section is about (e.g. "Termination clause", "Q3 revenue figures"). "category" is "same" only if the two excerpts are substantively equivalent — paraphrasing or reformatting alone still counts as "same"; use "changed" for any substantive difference in meaning, terms, numbers, or scope. "explanation" is 1-2 plain-language sentences grounded only in the two excerpts given.`;

const REMOVED_SYSTEM = `You are given a section that appears in "Document A" but has no corresponding section in "Document B" — it appears to have been removed. Respond in valid JSON only: {"sectionLabel": string, "explanation": string}. "sectionLabel" is a short (2-6 word) label for what this section covered. "explanation" is one sentence describing what content was removed, grounded only in the excerpt given.`;

const ADDED_SYSTEM = `You are given a section that appears in "Document B" but has no corresponding section in "Document A" — it appears to have been added. Respond in valid JSON only: {"sectionLabel": string, "explanation": string}. "sectionLabel" is a short (2-6 word) label for what this section covers. "explanation" is one sentence describing what content was added, grounded only in the excerpt given.`;

export const SUMMARY_CATEGORIES = ["Key Difference", "Key Similarity", "Notable Risk", "Other"];

const SUMMARY_PROMPT = `You are summarizing a completed section-by-section comparison between two documents. You are given the list of findings already produced (each already classified as same/changed/added/removed). Produce between 2 and 7 high-value takeaways a reader would actually want to know — not a restatement of every finding, but the handful that matter most.

Rules:
- Every takeaway must be grounded ONLY in the given findings — do not invent anything not present below.
- "supporting_finding_indexes" lists the 0-based index (from the numbered list below) of every finding that backs up this takeaway. Every index must be a real index from the list; a takeaway with no real support should not be produced.
- "category" must be exactly one of: ${SUMMARY_CATEGORIES.join(", ")}.
- "title" is a short, specific headline (under 12 words). "explanation" is 1-2 plain-language sentences.
- Prefer fewer, well-supported takeaways over padding to reach 7 — if the material only clearly supports 1 or 2, return that many.

Return strict JSON, nothing else:
{"summary": [{"title": string, "explanation": string, "category": string, "supporting_finding_indexes": [int]}]}`;

// unitType is one of "matched" | "onlyInA" | "onlyInB". Excerpts are
// truncated to 2000 chars here — this is a *different*, larger truncation
// than the 800-char one used for what's persisted on the finding row; both
// are intentional, don't unify them into one constant.
export async function classifyUnit({ openai, unitType, excerptA, excerptB, signal }) {
  let system;
  let userContent;

  if (unitType === "matched") {
    system = MATCHED_SYSTEM;
    userContent = `Document A section:\n${(excerptA || "").slice(0, 2000)}\n\nDocument B section:\n${(excerptB || "").slice(0, 2000)}`;
  } else if (unitType === "onlyInA") {
    system = REMOVED_SYSTEM;
    userContent = `Section (Document A only):\n${(excerptA || "").slice(0, 2000)}`;
  } else {
    system = ADDED_SYSTEM;
    userContent = `Section (Document B only):\n${(excerptB || "").slice(0, 2000)}`;
  }

  const completion = await openai.chat.completions.create(
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: "json_object" },
    },
    signal ? { signal } : undefined
  );

  const parsed = JSON.parse(completion.choices[0].message.content || "{}");
  return {
    sectionLabel: typeof parsed.sectionLabel === "string" ? parsed.sectionLabel.trim().slice(0, 120) : null,
    category: typeof parsed.category === "string" ? parsed.category : null,
    explanation: typeof parsed.explanation === "string" ? parsed.explanation.trim().slice(0, 600) : null,
  };
}

function formatFindingsForPrompt(findings) {
  return findings
    .map((f, i) => `${i}. [${f.category}] ${f.sectionLabel || "Untitled section"}${f.explanation ? ` — ${f.explanation}` : ""}`)
    .join("\n");
}

// findings/findingIds share the same order — findingIds[i] is the real
// ComparisonFinding row id for findings[i], assigned after insertion.
export async function buildOverallSummary({ openai, findings, findingIds, signal }) {
  if (!findings.length) return [];

  const prompt = formatFindingsForPrompt(findings).slice(0, 14000);
  const completion = await openai.chat.completions.create(
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1200,
      response_format: { type: "json_object" },
    },
    signal ? { signal } : undefined
  );

  const parsed = JSON.parse(completion.choices[0].message.content || "{}");
  const raw = Array.isArray(parsed.summary) ? parsed.summary : [];

  const results = [];
  for (const item of raw.slice(0, 7)) {
    if (!item || typeof item.title !== "string" || !item.title.trim() || typeof item.explanation !== "string") continue;
    const category = SUMMARY_CATEGORIES.includes(item.category) ? item.category : "Other";
    const indexes = Array.isArray(item.supporting_finding_indexes)
      ? item.supporting_finding_indexes.filter((i) => Number.isInteger(i) && i >= 0 && i < findingIds.length)
      : [];
    // Ungrounded — the model named nothing that resolves to a real finding
    // actually produced this run — drop it (this is a code-level filter,
    // not a prompt instruction).
    if (indexes.length === 0) continue;
    results.push({
      title: item.title.trim().slice(0, 150),
      explanation: item.explanation.trim().slice(0, 600),
      category,
      findingIds: indexes.map((i) => findingIds[i]),
    });
  }
  return results;
}
