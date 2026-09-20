// src/lib/compareInsight.js
// Narrative insight generation for the compare page's Insights tab. Reuses
// the already-computed findings/summary (never re-reads raw document text
// beyond the short excerpts already stored on each finding), same grounding
// discipline as compareClassify.js's buildOverallSummary — the model only
// ever narrates what's already been extracted, it never sees the full
// source documents directly.
//
// Output contract is the same {sections:[...]} shape shared with chat's Deep
// Analysis Mode (see MINOR_FEATURE_GAPS_FEATURE_SPEC.md / InsightView.jsx),
// minus the `diagram` field — comparison insight never uses diagrams.
//
// Ported near-verbatim from the desktop app's electron/compare/insight.js.

// Findings may come from two different shapes: the worker's in-memory
// findings (camelCase — sectionLabel, documentAExcerpt/documentBExcerpt) or
// a fresh `prisma.comparisonFinding.findMany()` read-back (same camelCase
// via Prisma's field mapping, but normalized here regardless so this module
// doesn't care which one it got).
function normalizeFinding(f) {
  return {
    category: f.category,
    sectionLabel: f.sectionLabel ?? null,
    explanation: f.explanation ?? null,
    documentAExcerpt: f.documentAExcerpt ?? null,
    documentBExcerpt: f.documentBExcerpt ?? null,
  };
}

// Findings include short excerpts (not just the category/label/explanation
// that compareClassify.js's own prompt formatter uses for the summary pass)
// so the model has real, quotable material to draw one or two short
// verbatim-style lines from.
export function formatFindingsWithExcerpts(findings) {
  return findings
    .map((raw, i) => {
      const f = normalizeFinding(raw);
      const a = f.documentAExcerpt ? ` A:"${f.documentAExcerpt.slice(0, 220).replace(/\s+/g, " ")}"` : "";
      const b = f.documentBExcerpt ? ` B:"${f.documentBExcerpt.slice(0, 220).replace(/\s+/g, " ")}"` : "";
      return `${i}. [${f.category}] ${f.sectionLabel || "Untitled section"}${f.explanation ? ` — ${f.explanation}` : ""}${a}${b}`;
    })
    .join("\n");
}

// Shared across both styles: tone, heading discipline, natural doc naming.
const VOICE_RULES_BASE = `Write the way a sharp analyst actually talks when explaining a comparison out loud — not the way a template-generated report talks. Concretely:
- Never write meta-commentary about the document you're producing ("This report compares...", "The following points outline...", "The changes present certain risks that stakeholders should consider..."). Just say the substantive thing directly, as if you already know the answer.
- Headings must be specific to what you actually found (e.g. "Termination notice tightened from 30 to 60 days", "The biggest difference: scope vs depth"), never generic template labels like "Overview", "Key Differences", "Notable Risks", or "Bottom Line".
- Refer to the two documents by a short natural name (derive it from the filename — drop the extension, drop redundant version suffixes when a plain reference reads fine) instead of repeating "Document A" / "Document B" over and over. It's fine to clarify once near the top which is which.`;

const VOICE_RULES = `${VOICE_RULES_BASE}
- Where a finding's excerpt gives you real quotable material, use "quote" on that section to show a short (under 200 characters) verbatim-feeling line — this is what makes it feel grounded instead of generic. Don't force a quote where the excerpts don't support one.
- If there's a clean, small set of dimensions worth comparing side by side (e.g. a handful of concrete terms, figures, or scope differences), put them in one "table" instead of restating them as prose elsewhere.`;

const RESPONSE_SHAPE = `Respond in strict JSON only:
{"sections": [{"heading": string, "body": string, "bullets": [string], "quote": string|null, "table": {"rows": [{"label": string, "a": string, "b": string}]}|null}]}
"body" can be "" if a section is bullets/table-only. "bullets" can be [] if a section is prose-only. Use "quote" and "table" sparingly and only when genuinely warranted — most sections will have both as null/[].`;

// This is "the insight" in the same sense as chat's Deep Analysis Mode
// insight mode — WHAT the core idea is, not a mini-report on HOW the two
// documents differ point by point. The Descriptive tab (below) is where the
// full walkthrough lives; this one answers the single question someone
// actually asks first.
const COMPACT_SYSTEM = `You are answering a direct "what's the insight" question about comparing these two document versions — the single underlying idea, not a walkthrough of every difference. You're given the comparison's already-computed findings (with short excerpts) and key takeaways below; ground everything only in what's given, never invent anything not present there.

Answer WHAT the core insight of this comparison is: the one thing that matters most about how these two documents differ and why it matters — not HOW the comparison was done, and not a list of every change in turn. If there are several differences, say what they collectively mean.

Be compact. Respond with exactly one section: a single dense paragraph (2-5 sentences) that states the insight directly and specifically to this comparison. No heading needed unless it adds something the body doesn't already say. Skip bullets, quotes, and tables unless the insight genuinely cannot be stated in prose.

${VOICE_RULES_BASE}

${RESPONSE_SHAPE}`;

const DESCRIPTIVE_SYSTEM = `You are giving someone a long, thorough walkthrough of how two document versions compare — they haven't read either one, and this is the "give me everything" version, not a summary. You're given the comparison's already-computed findings (with short excerpts) and key takeaways below; ground everything only in what's given — where the material is thin, say so briefly rather than padding with generic language. Aim for real depth, roughly 1200-2000 words total, across 6-9 sections, each earning its own specific heading based on what it actually covers (a section can be about one meaningful difference if that difference deserves its own treatment).

${VOICE_RULES}

${RESPONSE_SHAPE}`;

function formatSummaryForPrompt(summary) {
  if (!summary?.length) return "(no key takeaways were produced for this comparison)";
  return summary.map((s, i) => `${i + 1}. [${s.category}] ${s.title} — ${s.explanation}`).join("\n");
}

function cleanTable(rawTable, { maxRows, maxCellLen }) {
  if (!rawTable || !Array.isArray(rawTable.rows) || !rawTable.rows.length) return null;
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

function cleanSections(rawSections, { maxSections, maxBodyLen, maxBullets, maxBulletLen, maxTableRows, maxCellLen }) {
  const sections = Array.isArray(rawSections) ? rawSections : [];
  return sections
    .filter((s) => s && (
      (typeof s.body === "string" && s.body.trim()) ||
      (Array.isArray(s.bullets) && s.bullets.length) ||
      (s.table && Array.isArray(s.table.rows) && s.table.rows.length)
    ))
    .slice(0, maxSections)
    .map((s) => ({
      heading: typeof s.heading === "string" && s.heading.trim() ? s.heading.trim().slice(0, 100) : null,
      body: typeof s.body === "string" ? s.body.trim().slice(0, maxBodyLen) : "",
      bullets: (Array.isArray(s.bullets) ? s.bullets : [])
        .filter((b) => typeof b === "string" && b.trim())
        .slice(0, maxBullets)
        .map((b) => b.trim().slice(0, maxBulletLen)),
      quote: typeof s.quote === "string" && s.quote.trim() ? s.quote.trim().slice(0, 300) : null,
      table: cleanTable(s.table, { maxRows: maxTableRows, maxCellLen }),
    }));
}

// Deterministic post-processing caps, independent of the prompt — applied
// regardless of what the model returns. This is a backstop, not a
// suggestion to the model.
const COMPACT_LIMITS = { maxSections: 2, maxBodyLen: 700, maxBullets: 3, maxBulletLen: 250, maxTableRows: 3, maxCellLen: 120 };
const DESCRIPTIVE_LIMITS = { maxSections: 9, maxBodyLen: 2500, maxBullets: 10, maxBulletLen: 400, maxTableRows: 10, maxCellLen: 200 };

export async function buildInsight({ openai, findings, summary, style, documentAName, documentBName, signal }) {
  const isDescriptive = style === "descriptive";
  const system = isDescriptive ? DESCRIPTIVE_SYSTEM : COMPACT_SYSTEM;
  const userContent = `Document A filename: ${documentAName || "Document A"}\nDocument B filename: ${documentBName || "Document B"}\n\nFindings:\n${formatFindingsWithExcerpts(findings).slice(0, 14000)}\n\nKey takeaways:\n${formatSummaryForPrompt(summary)}`;

  const completion = await openai.chat.completions.create(
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      temperature: 0.4,
      max_tokens: isDescriptive ? 3400 : 700,
      response_format: { type: "json_object" },
    },
    signal ? { signal } : undefined
  );

  const parsed = JSON.parse(completion.choices[0].message.content || "{}");
  const sections = cleanSections(parsed.sections, isDescriptive ? DESCRIPTIVE_LIMITS : COMPACT_LIMITS);
  return { sections };
}
