# Minor Feature Gaps — Implementation Spec (Cloud/SaaS)

## Purpose

This document covers the smaller desktop-vs-cloud gaps that don't warrant their own
full liaison spec. As of this writing there is really only **one** genuine gap in this
bucket: **Deep Analysis Mode** in chat. A second item flagged in an earlier audit
("Topics Filter Tabs") was re-verified against the actual desktop source while writing
this spec and turned out to **already be at parity** — see the correction note below —
so it is not included as a port task.

## Correction: "Topics Filter Tabs" is not a gap

An earlier pass of this audit flagged the Topics view's filter tabs (All Documents /
Starred / Unselected) as a possible UI-parity gap ("desktop might use per-topic-name
tabs instead of these three"). On closer inspection, **desktop's
`src/components/topics/TopicsView.jsx` uses the exact same three filter keys and labels**
(`all` → "All Documents", `starred` → "Starred", `unselected` → "Unselected"), rendered
with the same pill-button pattern, as this cloud repo's own
`src/components/topics/TopicsView.jsx` already does. There is nothing to port here —
disregard the earlier flag.

## What ships: Deep Analysis Mode

- In **both** chat surfaces (document chat and project chat), a question that asks the
  AI to analyze, critique, evaluate, or share a take on the document/project — rather
  than answer a specific factual question — gets a **structured, opinionated response**
  instead of a plain-text paragraph: a named framework/concept coined for this specific
  content, a small ASCII/text diagram, a table scoring the material across a few
  content-appropriate dimensions, the single most important claim rewritten as a
  stronger version, and a fully worked concrete example with realistic invented
  numbers — woven together, not mechanically labeled "Part 1/2/3."
- A **separate, narrower "insight" mode**: a direct "what's the insight here" question
  gets one compact, direct paragraph stating the core idea — not the full five-part
  deep-dive above.
- Rendered via the **same shared `InsightView` component** used by Document Comparison's
  Insight tab (`DOCUMENT_COMPARISON_FEATURE_SPEC.md`) — build this as one component from
  day one if it doesn't already exist from that port, not two parallel renderers for
  what is, on the backend, the exact same `{sections:[...]}` JSON contract (minus a
  `diagram` field the comparison version doesn't use, which chat's version does).
- Falls through to the normal factual-Q&A flow (including chart generation and the
  general-knowledge/knowledge-graph tools) if analysis mode produces no result —
  never blocks the user from getting an answer.

## Locked-in decisions (do not relitigate)

**1. Detection is a cheap keyword check, evaluated before chart/tool detection —
no extra LLM call to classify intent.** Two trigger word lists, checked in this exact
order (insight checked first, since a question could contain both an insight word and
an analysis word — rare, but insight is the more specific match and should win):

```js
const INSIGHT_TRIGGERS = ["insight", "insights"];
const ANALYSIS_TRIGGERS = [
  "analyze", "analysis", "analyse",
  "your take", "your thoughts", "what do you think",
  "assessment", "critique", "evaluate", "review this",
  "strengths and weaknesses", "pros and cons",
  "what stands out", "deep dive", "feedback on this",
];
function detectAnalysisIntent(question) {
  if (!question) return false;
  const q = question.toLowerCase();
  if (INSIGHT_TRIGGERS.some((phrase) => q.includes(phrase))) return "insight";
  if (ANALYSIS_TRIGGERS.some((phrase) => q.includes(phrase))) return "analysis";
  return false;
}
```

Port this function and both lists verbatim.

**2. Analysis mode is checked, and short-circuits, before chart generation and before
the main factual-answer call — not layered on top of them.** If
`detectAnalysisIntent` returns truthy, the analysis/insight path runs *instead of* the
normal chart-detection + STEP-0-tool-routing + factual-answer flow, not in addition to
it. If the analysis call succeeds, persist and return immediately. If it returns
`null` (empty model output or malformed JSON), **fall through to the existing flow
unchanged** — a failure here must never block a user from getting *some* answer.

**3. Insight mode and Analysis mode are genuinely different response shapes, not the
same prompt at different lengths.** Insight: WHAT the core idea is, one dense
paragraph, no mandatory structure. Analysis: HOW the material works, mandatory
inclusion of all five elements (named framework, diagram, scored table, rewritten core
claim, worked example) woven in naturally. Keep them as two separate system prompts,
not one prompt with a "brief vs. detailed" flag — the shapes aren't just longer/shorter
versions of each other.

**4. A specific voice/register was explicitly fought for and must be preserved.** Two
concrete failure modes were found and fixed empirically on the desktop version (not
theoretical — verified via a real prior debugging pass against a document-experiment
baseline):
  - The model's default register for this kind of task drifts toward a generic
    SaaS-vendor-checklist (SOC2, GDPR, standard connector lists) that isn't actually
    grounded in what the specific document says. **Fix, must be kept in the prompt
    verbatim**: "Do not import a generic SaaS/enterprise-readiness checklist (SOC2,
    GDPR, standard connector lists, generic KPI lists) unless the document's own claims
    specifically raise that concern — a generic checklist that could be pasted onto any
    document is worse than no checklist."
  - The model reliably ends with a "which would you like next?" menu of offers even
    when not asked to. **Fix, must be kept verbatim**: "Never end with an offer of
    further help or a menu of options ('Let me know if...', 'I can also...', 'Would you
    like me to...'). End on your actual conclusion instead."
  - Also keep: no meta-commentary about the analysis itself ("This analysis covers...");
    no emojis, anywhere; headings must be specific to what was actually found, never
    generic labels like "Overview" or "Key Points."

**5. Every claim must be grounded in the retrieved context — this is not optional
flavor text in the prompt, it's the one rule keeping the "sharp outside consultant"
voice from fabricating.** "Every gap, risk, or recommendation you name must be
traceable to something this specific document actually says, implies, or omits."

## Data model

### Prisma schema migration

```prisma
model Message {
  // ...existing fields
  insightJson Json? @map("insight_json")
}

model ProjectMessage {
  // ...existing fields
  insightJson Json? @map("insight_json")
}
```

Run `npx prisma migrate dev --name add_insight_json`. Same `{sections:[...]}` shape
already established for `DocumentComparison.insightCompact`/`insightDescriptive` in the
sibling Comparison spec — reuse the identical JSON contract, don't invent a variant
shape for chat.

## Backend implementation

### `src/lib/analysis.js` — new shared module, ported near-verbatim

Ported from `electron/analysis.js` (236 lines) — pure prompt-building + OpenAI call +
response cleaning, no Electron/SQLite API usage:

- `detectAnalysisIntent(question)` — decision 1, verbatim.
- `VOICE_RULES` — decision 4, verbatim (the SaaS-checklist guard and the
  no-trailing-offers guard are the two load-bearing lines; don't paraphrase them).
- `RESPONSE_SHAPE` — the JSON contract instruction:
  ```
  Respond in strict JSON only:
  {"sections": [{"heading": string, "body": string, "bullets": [string], "quote": string|null, "table": {"rows": [{"label": string, "a": string, "b": string}]}|null, "diagram": string|null}]}
  "body" can be "" if a section is bullets/table/diagram-only. Use "quote", "table", and "diagram" only when genuinely warranted.
  ```
- `ANALYSIS_SYSTEM` — the five-mandatory-elements prompt (named framework/concept,
  diagram, scored table with content-appropriate dimensions — not a default generic
  checklist, the single most important claim rewritten stronger, one fully worked
  concrete example with realistic invented numbers), `${VOICE_RULES}`, `${RESPONSE_SHAPE}`.
  Port the "sharp outside consultant... not summarizing it back to someone who already
  read it" framing verbatim — it's what anchors the register decision 4 depends on.
- `INSIGHT_SYSTEM` — the compact single-paragraph "what's the core idea" prompt,
  deliberately the opposite shape from `ANALYSIS_SYSTEM` (decision 3).
- `buildAnalysis({ openai, question, context, signal, mode })` — `mode` is
  `"analysis" | "insight"` (whichever `detectAnalysisIntent` returned), one
  `gpt-4o-mini`-or-whatever-model-this-repo-standardizes-on call,
  `response_format: { type: "json_object" }`, parses and cleans the response (drop
  empty/malformed sections, truncate fields — reuse whatever cleaning helper
  `compareInsight.js` from the Comparison spec already established, since the output
  contract is identical minus the `diagram` field), returns `{ insight, fallbackText }`
  where `fallbackText` is a short plain-text summary (for any code path that still needs
  a plain string, e.g. a notification or a non-rendering context) or `null` on any
  failure — **never throws**.

### Wiring into `src/app/api/documents/[id]/ask/route.js`

Per `ASK_QUESTION_TOOL_FEATURE_SPEC.md`'s own line references (current file, post-that
port): context (`contextBlocks`) is built, then the STEP-0 `systemMsg` is constructed
around line 269. Insert the analysis-mode check **between context construction and
`systemMsg` construction** — before chart detection, before the tool-bearing completion
call:

```js
const analysisMode = detectAnalysisIntent(preprocessedQuestion); // or `question`, whichever this route already uses for chart/tool detection
if (!controller.signal.aborted && analysisMode) {
  const analysisResult = await buildAnalysis({
    openai, question: preprocessedQuestion, context: contextBlocks, signal: controller.signal, mode: analysisMode,
  });
  if (analysisResult) {
    await prisma.message.update({ where: { id: userMsg.id }, data: { status: "done" } });
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        role: "assistant",
        content: analysisResult.fallbackText,
        status: "done",
        insightJson: analysisResult.insight,
      },
    });
    return NextResponse.json({ success: true, answer: analysisResult.fallbackText, insight: analysisResult.insight });
  }
  // falls through to the existing chart/tool/factual flow below on a null result
}
```

Decision 2 — this must run *before* `detectChartIntent`/the tools-bearing completion
call, and must return early only on a non-null result.

### Wiring into `src/app/api/projects/ask/route.js`

Same pattern, applied to **only the main cosine-similarity branch** (mirrors the
Comparison and Citations specs' own precedent of the BM25-fallback branch being a
transient state not worth the extra code path — apply the same judgment call here
unless this repo's actual current BM25 branch already carries chart/tool parity, in
which case add it there too for consistency, matching whatever precedent the Charts/
Ask-Question ports already set for that branch). Persist onto `ProjectMessage` with
`insightJson` instead of `Message`.

### Message-history routes

Add `insightJson`/`insight` to wherever `chartData`/`citations`/
`externalKnowledgeQuery` were already added to the message-history mapping, in both
`src/app/api/documents/messages/[conversationId]/route.js` (if it does any
`select`/mapping — per the Ask-Question spec's own note, this route may return raw rows
with no mapping, in which case nothing to do) and
`src/app/api/projects/messages/[projectId]/route.js`'s `mapped` array.

## Frontend implementation

### `src/components/insights/InsightView.jsx` — new shared component, ported verbatim

Port `src/components/insights/InsightView.jsx` (124 lines) from the desktop repo
exactly — pure React/Tailwind, zero Electron API usage, already designed to be shared
between chat-insight/analysis output and (per the Comparison spec) comparison-insight
output:

- Renders real HTML headings/lists/tables/blockquotes from the `{sections:[...]}` data
  — **never parses markdown**, since the model is instructed to output structured data,
  not markdown text.
- `SIZE_SCALE` — four text-size tiers (`sm`/`md`/`lg`/`xl`) driving heading/body/table/
  diagram font sizes, so this component slots directly into
  `ExpandedMessageModal`'s existing independent text-size control with zero extra
  wiring.
- `stripOuterQuotes` — strips wrapping quote marks the model sometimes includes inside
  its own `quote` field (it's quoting an already-quoted source passage), preventing a
  visible doubled-quote artifact.
- `dividers` prop — `true` (default, horizontal rule between sections) for the
  Comparison page's Insight tab; **`false`** for chat's analysis/insight rendering
  (plain spacing instead — a border-per-section reads too much like a generic
  ChatGPT-style "---" report break, which is exactly the genericness this feature's
  voice rules are fighting). **Pass `dividers={false}` at both chat call sites.**
- `columns`/`documentAName`/`documentBName` props are Comparison-specific (table column
  headers) — chat's usage passes neither, table rows render with blank column headers
  by default, which is fine since chat's analysis tables are rarely two-document
  comparisons.
- The `min-w-0 max-w-full` wrapper is load-bearing (noted in the source's own comment):
  this component sits inside a flex row (the chat bubble); without it, an unwrapped
  diagram line can push the whole bubble past the viewport instead of wrapping/
  scrolling within it. Don't drop it as apparently-redundant CSS.

### Wiring into `ChatInterface.jsx` and `document/page.jsx`

Both currently render `message.content` as plain text (or, post-Charts/Citations
ports, conditionally a `ChartMessage`/citation-linked text). Add, in both files:

- Carry `insight: m.insightJson || null` (or whatever field name the API responses
  above end up using — keep it consistent) through history-loading and new-message
  construction, same shape as `chart`/`citations` were added in the prior two ports.
- Render branch: `{message.role === 'assistant' && message.insight ? <InsightView
  insight={message.insight} dividers={false} textSize={...} /> : <p>{message.content}</p>}`
  — when an insight is present, it **replaces** the plain-text bubble content entirely
  (the `fallbackText` persisted alongside it is for non-rendering contexts only, e.g.
  copy/print — see below — not for simultaneous display).
- `MessageActions`' Copy/Print (ported per the base feature set) should use
  `message.content` (`fallbackText`) for a plain-text copy, not attempt to serialize
  the structured `insight` object — this is exactly what `fallbackText` is for.
- `ExpandedMessageModal` — pass `insight`/`dividers={false}` through the same way,
  reusing its existing independent text-size control (`InsightView`'s `SIZE_SCALE`
  already matches that modal's tier names).

## Verification plan

- Ask a document-chat question containing an analysis trigger word ("analyze this
  document") — confirm a structured response with all five elements present (named
  framework, diagram, scored table, a rewritten core claim, a worked example), no
  generic SaaS-checklist content unless the document itself raises those concerns, and
  no trailing "would you like me to..." offer.
- Ask a question containing "insight"/"insights" — confirm a single dense paragraph,
  not the five-element deep-dive structure.
- Ask a question containing both an insight word and an analysis word — confirm insight
  mode wins (decision 1's stated priority).
- Ask the same analysis question twice — confirm headings are specific to what was
  actually found each time, not a repeated generic label.
- Force a malformed/empty model response (if testable via a mock) — confirm the request
  falls through to the normal factual-answer flow rather than erroring or showing
  nothing.
- Reload the page / revisit the conversation — confirm a previously-generated
  insight/analysis renders identically from persisted `insightJson`, not just on first
  generation.
- Copy and Print a message containing a rendered insight — confirm they use the plain
  `fallbackText`, not a broken serialization of the structured object.
- Toggle text size in the expanded-message modal on an insight message — confirm
  `InsightView`'s own size tiers respond correctly.
- Confirm this path is mutually exclusive with chart generation and the general-
  knowledge/knowledge-graph tool calls for the same message — an analysis-mode question
  never also shows a chart or triggers a tool-confirmation prompt in the same turn.
- Run a batch of ordinary factual questions — confirm none of them false-trigger
  analysis/insight mode (none contain the trigger words) and behavior is unchanged from
  before this feature.
