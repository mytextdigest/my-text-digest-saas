# Document Comparison — Implementation Spec (Cloud/SaaS)

## Purpose

This document is the liaison spec for porting "Document Comparison" (AI-aligned
side-by-side comparison of two documents in a project — Same/Changed/Added/Removed
triage, a redline reading view, an AI narrative insight, PDF export, and a chat tool)
from the desktop Electron app (`mytextdigest`) to this cloud/SaaS codebase. The desktop
version is a real, working feature (some of its files are still uncommitted
work-in-progress on the desktop side as of this writing, but the logic is complete and
runnable) — this spec captures its exact design, including several non-obvious
grounding/cost-control decisions baked into the code via comments, so the implementing
agent doesn't have to re-derive them. Follow this as the source of truth.

As with every prior port in this series, the frontend is the close-parity part and the
backend is where the architecture genuinely diverges: this codebase has **no
pgvector**, **no background-job queue used synchronously** (SQS + a long-lived
`worker/` process instead of in-process Electron async calls), and **no filesystem/
native-dialog access** (S3 + HTTP download instead of `fs.writeFileSync` +
`dialog.showSaveDialog`). Every divergence is called out explicitly below, with the
exact desktop file it replaces.

## What ships

- A **Comparisons** tab in project chat (`src/components/chat/ChatInterface.jsx`),
  listing every past comparison in the project, with a "New Comparison" button that
  opens a two-document picker.
- **Three view modes** on a comparison's own page (`/compare?id=...`):
  1. **Findings** — filterable tabs (All/Same/Changed/Added/Removed) with per-category
     counts, one card per aligned section, side-by-side excerpts, a "View source" link
     into the full document.
  2. **Document View** — a redline-style side-by-side reading view, in each document's
     own original reading order (not similarity order): removed text struck through on
     a red background, added text underlined on a green background.
  3. **Insight** — an AI narrative (Compact = one dense paragraph, or Descriptive =
     6–9 sections), rendered by the **same shared `InsightView` component** the chat's
     Deep Analysis Mode uses (see `MINOR_FEATURE_GAPS_FEATURE_SPEC.md`) — build this as
     one shared component from day one, not two parallel renderers.
- **Regenerate** (creates a fresh comparison row, old one becomes history) and
  **Delete**, plus a history list of other past comparisons for the same document pair.
- **Insight PDF export** for whichever style (compact/descriptive) has already been
  generated.
- A `compare_documents` **chat tool**, available only in **project** chat (never
  document chat — comparison inherently needs two documents), that lets a user ask
  "compare X and Y" in plain language and get a grounded summary plus a "View full
  comparison" link under that message.

**Out of scope** (matching the desktop version's own scope):
- Comparing more than 2 documents at once.
- Comparing documents across different projects.
- Any UI for adjusting the alignment threshold or classification section cap — both are
  fixed constants, not user-facing settings, on desktop and should stay that way here.

## Locked-in decisions (do not relitigate)

**1. Alignment is a "section" = a chunk, not a semantic/paragraph boundary.** Comparison
does no chunking or embedding of its own — it operates purely on whatever `Chunk` rows
ingestion already produced (this repo's existing ~1800–2200-char chunks,
`worker/index.js`'s `chunkText()`). Comparison granularity is therefore inherited
entirely from the ingestion pipeline, not defined by this feature.

**2. Alignment is deterministic and LLM-free — mutual-best-match above a high
threshold.** For every chunk in document A, brute-force cosine similarity against every
chunk in document B, keep only the single highest-scoring match. Two chunks are
"matched" **only if each is the other's best match AND the score is ≥ 0.82** —
deliberately *higher* than this codebase's topic-clustering match threshold (its
`STRONG_MATCH` constants run lower, e.g. `resolver.js`'s entity-resolution threshold is
0.86, topic clustering's is lower still) because **a false "same section" match is
worse than a missed one**: a missed match just falls through to "added"/"removed"
(still surfaced to the user), whereas a wrong match silently pairs two unrelated
sections. Do not lower this threshold to catch more matches — that trades a visible,
recoverable gap for a silent, wrong pairing.

**3. The LLM is never trusted to decide added/removed — only to explain.** Whether a
section is "added" or "removed" is 100% determined by which side of the alignment it
fell on (unmatched-in-A → removed, unmatched-in-B → added), never asked of the model.
For matched pairs, the model may say "changed" or "same," but a malformed/missing model
response defaults to "same," never crashes the category into an invalid state. This is
the single most important invariant in the whole feature — it means a hallucinating or
misparsing LLM call can degrade only the *label/explanation text quality* of a finding,
never its added/removed/changed/same bucket. Preserve this `enforceCategory`-style
gate exactly; do not let a future "let the model classify everything" refactor erode it.

**4. Classification is cost-capped at 40 LLM calls per comparison, independent of
document size.** All unmatched chunks (added/removed — "structurally certain," so they
still get an explanation call) are always classified. Matched pairs are sorted by
similarity **ascending** (least-similar, i.e. most-likely-to-actually-differ, first)
and only the first N up to a 40-total cap get an LLM classification call; the rest are
recorded directly as `same` with `sectionLabel: null` / `explanation: null` — the UI
must render these as "Untitled section" gracefully, not error. Do not remove this cap
or make it document-size-proportional without an explicit decision to do so — it is
what keeps a large-document comparison bounded in cost and latency.

**5. Compact insight is precomputed with every comparison; descriptive insight is
generated lazily, once, then cached.** Compact costs little and is likely to be opened
immediately, so it's built as part of the main run using findings/summary already in
memory (no extra DB round-trip). Descriptive is materially more expensive (6–9 sections,
higher `max_tokens`) and not every comparison's Insight tab gets opened — generate it
only on first user request, then persist it on the comparison row so it is never paid
for twice, same as desktop's `insight_compact`/`insight_descriptive` columns.

**6. Comparison generation moves from synchronous-in-request (desktop) to an SQS worker
job + poll (cloud) — this is the single biggest architectural change in this port.**
The desktop's `runComparison()` runs the entire alignment→classification→summary→
compact-insight pipeline synchronously inside one Electron IPC call, blocking the
renderer for up to "a minute for long documents" (the picker modal's own copy). That
posture doesn't transfer: an HTTP request handler in this codebase should not block for
a minute doing 40 sequential-ish OpenAI calls. Port the *entire algorithm* verbatim
(alignment math, classification prompts, `enforceCategory`, summary/insight
generation), but move its execution into a new `type: "compare"` SQS job consumed by
`worker/`, with the `DocumentComparison.status` column (`generating` → `ready`/`error`)
already modeling exactly the state machine the frontend needs to poll — same
`setInterval`-while-in-progress pattern already used by `FiguresGallery.jsx` and
`GraphView.jsx` (`GraphView.jsx`'s `POLL_INTERVAL_MS = 3000` / `IN_PROGRESS_STATUSES`
pattern is the closest precedent; reuse that shape here too).

**7. Grounding-by-construction appears three times — preserve all three, not just the
prompts.** (a) `enforceCategory` (decision 3). (b) The overall-summary pass discards
any takeaway whose `supporting_finding_indexes` don't resolve to real findings actually
produced in this run. (c) Insight generation only ever sees already-extracted findings
and their (800-char-truncated) excerpts — never raw document text — and its output
sections are deterministically truncated/cleaned (`cleanSections`/`cleanTable`
equivalents) regardless of what the model returns, independent of the prompt. This
triple redundancy — never single-point-of-failure trusting the LLM — is what keeps
hallucination blast radius small; port all three checks, not just the ones that are
easiest to translate.

**8. The chat tool (`compare_documents`) runs inline, with reuse-before-regenerate — no
confirmation gate.** Unlike `consult_general_knowledge` (which requires the Yes/No
confirmation round-trip from `ASK_QUESTION_TOOL_FEATURE_SPEC.md`, because it reaches
outside the project's own data), `compare_documents` and `query_knowledge_graph`
(`KNOWLEDGE_GRAPH_AND_INSIGHTS_FEATURE_SPEC.md`) both only touch data the project
already owns — no user confirmation needed, run them the moment the model calls them.
Before creating a new comparison, always check for an existing `status: "ready"`
comparison for the same unordered document pair and reuse it rather than regenerating —
this is the explicit cost/latency control for the chat path. An `error`/`generating`
row for the same pair is *not* reused (only `ready` counts), so a previously failed
chat-triggered comparison always gets a fresh attempt.

**9. PDF export is server-rendered and streamed, not a native save dialog.** The
desktop's `insightPdf.js` uses `@react-pdf/renderer`'s `renderToBuffer` directly in the
Electron main process (no DOM needed), then a native `dialog.showSaveDialog` +
`fs.writeFileSync`. The rendering logic (`@react-pdf/renderer`'s `Document`/`Page`/
`Text`/`View`/`StyleSheet` tree) is framework-portable and runs identically in a
Next.js Route Handler's Node runtime — only the save-dialog/filesystem half is
Electron-specific and gets replaced with a `Response` that has
`Content-Disposition: attachment` headers, letting the browser's own download UI do
what the native dialog did on desktop.

## Data model

### Prisma schema migration

```prisma
model DocumentComparison {
  id                 String   @id @default(cuid())
  projectId          String   @map("project_id")
  documentAId        String   @map("document_a_id")
  documentBId        String   @map("document_b_id")
  status             String   @default("generating")   // "generating" | "ready" | "error"
  summaryJson        Json?    @map("summary_json")      // [{title,explanation,category,findingIds}]
  errorMessage       String?  @map("error_message")
  insightCompact     Json?    @map("insight_compact")      // {sections:[...]}
  insightDescriptive Json?    @map("insight_descriptive")  // {sections:[...]}, lazy
  createdAt          DateTime @default(now()) @map("created_at")
  completedAt        DateTime? @map("completed_at")

  project   Project    @relation(fields: [projectId], references: [id])
  documentA Document   @relation("ComparisonsAsA", fields: [documentAId], references: [id])
  documentB Document   @relation("ComparisonsAsB", fields: [documentBId], references: [id])
  findings  ComparisonFinding[]

  @@index([projectId])
  @@index([documentAId, documentBId])
}

model ComparisonFinding {
  id                String   @id @default(cuid())
  comparisonId      String   @map("comparison_id")
  category          String   // "same" | "changed" | "added" | "removed"
  sectionLabel      String?  @map("section_label")
  documentAChunkId  String?  @map("document_a_chunk_id")   // null for "added"
  documentAExcerpt  String?  @map("document_a_excerpt")    // chunk text, truncated to 800 chars
  documentBChunkId  String?  @map("document_b_chunk_id")   // null for "removed"
  documentBExcerpt  String?  @map("document_b_excerpt")
  explanation       String?
  similarity        Float?   // null for added/removed
  sortOrder         Int      @default(0) @map("sort_order") // similarity-ascending, unmatched-first
  createdAt         DateTime @default(now()) @map("created_at")

  comparison     DocumentComparison @relation(fields: [comparisonId], references: [id])
  documentAChunk Chunk?             @relation("FindingChunkA", fields: [documentAChunkId], references: [id])
  documentBChunk Chunk?             @relation("FindingChunkB", fields: [documentBChunkId], references: [id])

  @@index([comparisonId])
}
```

Add reverse relations: `Project.comparisons DocumentComparison[]`;
`Document.comparisonsAsA DocumentComparison[] @relation("ComparisonsAsA")` and
`comparisonsAsB DocumentComparison[] @relation("ComparisonsAsB")`; `Chunk` needs two
back-relations too (`findingsAsA ComparisonFinding[] @relation("FindingChunkA")`,
`findingsAsB ... @relation("FindingChunkB")`) since Prisma requires named relations
when two FKs on one model point at the same target table.

Also add, mirroring the citations spec's precedent of linking an assistant message to
richer data it produced:

```prisma
model ProjectMessage {
  // ...existing fields
  comparisonId String? @map("comparison_id")
}
```

Run `npx prisma migrate dev --name add_document_comparison`.

No `onDelete: Cascade` — matches this schema's existing convention (see the Figures
spec's identical note); cascade deletes are handled manually in a `$transaction`
(see Backend section).

## Backend implementation

### `src/lib/compareAlignment.js` — new shared module, pure/deterministic

Ported near-verbatim from `electron/compare/alignment.js` (97 lines, no Electron/SQLite
API usage — pure math over arrays of `{id, embedding}`):

- `cosineSimilarity(a, b)` — reuse the existing implementation already duplicated in
  `src/lib/topicUtils.js` and `worker/cluster.js` in this repo rather than writing a
  third copy; if consolidating, extract to this new file and have `topicUtils.js`/
  `worker/cluster.js` import it, but that consolidation is optional — not required for
  this feature to work correctly.
- `bestMatches(source, target)` — for each chunk, the single highest cosine-similarity
  match in the other set (`null` if no embedding).
- `alignChunks(chunksA, chunksB)` — mutual-best-match filter at `STRONG_MATCH = 0.82`
  (decision 2) → `{ matchedPairs: [{aId, bId, similarity}], onlyInA: [id...], onlyInB:
  [id...] }`.
- `THRESHOLDS = { STRONG_MATCH: 0.82 }` exported for reuse/testing.

O(|A|×|B|) brute force, same as desktop — acceptable at typical chunk counts (tens to
low hundreds per document); this repo has no pgvector to offload it to (see the Figures
spec's decision 3 — this is a repeat of the same "no vector index" constraint, not a
new one).

### `src/lib/compareClassify.js` — new shared module

Ported from `electron/compare/classify.js` (116 lines) + the `selectForClassification`
cost-control logic (decision 4):

- `selectForClassification(matchedPairs, onlyInA, onlyInB, { cap = 40 })` — always
  includes every `onlyInA`/`onlyInB` unit; fills remaining slots (up to `cap` total)
  with matched pairs sorted by similarity ascending; the rest become `autoSame` units
  (`category: "same"`, `sectionLabel: null`, `explanation: null`, no LLM call).
- `classifyUnit({ openai, unitType, excerptA, excerptB, signal })` — `unitType` one of
  `"matched" | "onlyInA" | "onlyInB"`, dispatches to one of three system prompts
  (`MATCHED_SYSTEM`/`REMOVED_SYSTEM`/`ADDED_SYSTEM`, ported verbatim — the "paraphrasing
  alone still counts as same" instruction on `MATCHED_SYSTEM` matters, keep it word for
  word), `gpt-4o-mini`, `temperature: 0.2`, `max_tokens: 300`,
  `response_format: {type:"json_object"}`. Truncate each excerpt to 2000 chars before
  sending (this is a *different*, larger truncation than the 800-char one used for
  what's persisted — see decision 7's excerpt-length note, both truncations are
  intentional and both must be kept, don't unify them into one constant).
- `enforceCategory(unitType, modelCategory)` — decision 3's gate, ported exactly:
  `onlyInA` → always `"removed"`; `onlyInB` → always `"added"`; `matched` → `"changed"`
  only on an exact `"changed"` string match from the model, else `"same"`.
- `buildOverallSummary({ openai, findings, signal })` — second call, `gpt-4o-mini`,
  `temperature: 0.3`, `max_tokens: 1200`, JSON mode. Input: findings formatted as a
  numbered list, truncated to 14000 chars. Output: 2–7 takeaways
  `{title, explanation, category, supportingFindingIndexes}`,
  `category ∈ ["Key Difference","Key Similarity","Notable Risk","Other"]`. **Drop any
  takeaway whose `supportingFindingIndexes` don't resolve to real indexes into the
  findings array actually produced this run** (decision 7b) — this is a code-level
  filter, not a prompt instruction, keep it in code.

### `src/lib/compareInsight.js` — new shared module

Ported from `electron/compare/insight.js` (148 lines):

- `buildInsight({ openai, findings, summary, style, documentAName, documentBName,
  signal })` — `style` is `"compact" | "descriptive"`.
- `formatFindingsWithExcerpts(findings)` — includes real quoted excerpts (≤220 chars
  each side, whitespace-collapsed) alongside category/label/explanation — richer than
  `compareClassify.js`'s own prompt formatter, because insight generation wants
  quotable material for its `quote` field.
- Two system prompts (`COMPACT_SYSTEM`/`DESCRIPTIVE_SYSTEM`), ported verbatim including
  the shared voice rules (no meta-commentary; specific, non-generic headings — "Bottom
  Line"/"Overview"/"Key Differences" explicitly banned as headings; refer to documents
  by a short name derived from filename, not "Document A"/"Document B" repeated).
  Compact: exactly one section, one dense 2–5 sentence paragraph, `max_tokens: 700`,
  `temperature: 0.4`. Descriptive: 6–9 sections, 1200–2000 words total, told explicitly
  to say where material is thin rather than pad, `max_tokens: 3400`, `temperature: 0.4`.
- Output contract — **the same `{sections:[...]}` shape used by
  `MINOR_FEATURE_GAPS_FEATURE_SPEC.md`'s Deep Analysis Mode port**, minus the `diagram`
  field (comparison insight never uses diagrams):
  ```json
  {"sections": [{
    "heading": "string",
    "body": "string",
    "bullets": ["string"],
    "quote": "string|null",
    "table": {"rows": [{"label": "string", "a": "string", "b": "string"}]} | null
  }]}
  ```
- **Deterministic post-processing caps, independent of the prompt** (decision 7c) —
  compact: `maxSections: 2, maxBodyLen: 700, maxBullets: 3, maxBulletLen: 250,
  maxTableRows: 3, maxCellLen: 120`; descriptive: `maxSections: 9, maxBodyLen: 2500,
  maxBullets: 10, maxBulletLen: 400, maxTableRows: 10, maxCellLen: 200`. Apply these
  regardless of what the model returns — this is a backstop, not a suggestion to the
  model.

### `src/lib/compareInsightPdf.js` — new shared module

Add `@react-pdf/renderer` as a new dependency (not present in this repo today). Port
`renderInsightPdf({ comparison, insight, style })` from `electron/compare/insightPdf.js`
near-verbatim — it's already framework-portable (`renderToBuffer`, no DOM dependency,
no Electron API). Same visual spec: A4, 48pt padding, Helvetica 11pt; title
`"{filenameA} vs {filenameB}"`; style badge; generated-date meta; per section: bold
12pt heading, body paragraph, left-border italic quote block, bullet list, bordered
table with the two document (short) names as column headers; empty state
`"No insight was generated for this comparison."`.

### `worker/compareWorker.js` — new module, the ported orchestrator

Ported from `electron/compare/index.js` (154 lines) as `processCompareJob(job)`,
consumed by `worker/index.js`'s dispatcher (decision 6):

```js
if (job.type === "compare") return processCompareJob(job);
```

`processCompareJob({ comparisonId, documentAId, documentBId, projectId })`:

1. Loads both documents' `Chunk` rows via Prisma (`where: { documentId, embedding: {
   not: null }, text: { not: null } }`) — fails fast (catch below sets `status:
   "error"`) if either side has zero embedded chunks.
2. `alignChunks` (from `compareAlignment.js`).
3. `selectForClassification` (cap 40).
4. Classify selected units via `p-limit(3)` (matches desktop's
   `CLASSIFY_CONCURRENCY = 3`) — **a single unit's classification failure must be
   caught and isolated** (log it, fall back to `enforceCategory`-only with no
   label/explanation), never fail the whole job over one bad OpenAI call.
5. Build `ComparisonFinding` rows for classified units + `autoSame` units, sort by
   similarity ascending (unmatched/`null`-similarity findings sort first, same as
   desktop), `prisma.comparisonFinding.createMany(...)` with `sortOrder` = insertion
   index.
6. `buildOverallSummary` → `summaryJson`.
7. `buildInsight({ ..., style: "compact" })` → `insightCompact` (decision 5 — generated
   now, descriptive is not).
8. `prisma.documentComparison.update({ where: { id: comparisonId }, data: { status:
   "ready", summaryJson, insightCompact, completedAt: new Date() } })`.
9. On any uncaught error in this whole function: catch it,
   `prisma.documentComparison.update({ data: { status: "error", errorMessage:
   String(err.message).slice(0, 2000) } })`. **This job must never throw past its own
   handler** — same posture as `processFigureJob`. Add `"compare"` to
   `recordJobFailure`'s exclusion list (`worker/index.js`'s `if (!docId ||
   body.type === "cluster" || body.type === "figures") return;` → add
   `|| body.type === "compare"`), because this job intentionally has no `docId` at all
   (it spans two documents, not one) — `recordJobFailure` would throw trying to update
   a non-existent document with this job's payload shape if not excluded, and there is
   already a per-comparison `status`/`errorMessage` mechanism that does the right
   user-facing thing independent of `recordJobFailure`.

### New API routes

Mirror the existing `src/app/api/projects/[id]/...` nested-route convention, all
ownership-checked via `prisma.project.findFirst({ where: { id, userId: session.user.id
} })` (or the `user: { email: session.user.email }` variant already used elsewhere in
this codebase — match whichever this repo's project routes already use) before
touching anything comparison-related:

- **`POST src/app/api/projects/[id]/comparisons/route.js`** — body
  `{ documentAId, documentBId }`; validates both exist, belong to this project, and are
  different; `prisma.documentComparison.create({ data: { status: "generating", ... } })`
  then enqueues `SendMessageCommand({ type: "compare", comparisonId, documentAId,
  documentBId, projectId })`; returns `{ success: true, comparisonId }` immediately
  (does **not** wait for the worker — decision 6).
- **`GET src/app/api/projects/[id]/comparisons/route.js`** — list, newest first, with
  both documents' filenames joined in.
- **`GET src/app/api/comparisons/[comparisonId]/route.js`** — full comparison + findings
  (ordered by `sortOrder`), parsed `summaryJson`/`insightCompact`/`insightDescriptive`.
  Ownership check via the comparison's `project.userId`.
- **`POST src/app/api/comparisons/[comparisonId]/insight/route.js`** — body
  `{ style }`; cache-check the relevant column first (return `{ cached: true, insight }`
  if already populated); else requires `status === "ready"`, calls `buildInsight`
  synchronously (fast enough — one `gpt-4o-mini` call, no queue needed, matching how
  `ASK_QUESTION_TOOL_FEATURE_SPEC.md`'s general-knowledge sub-call is also a direct
  `await` inside a route, not a queued job), persists, returns `{ insight }`.
- **`GET src/app/api/comparisons/[comparisonId]/insight-pdf/route.js`** — query param
  `?style=compact|descriptive`; 400 if that column isn't populated yet ("Generate this
  version first," matching desktop's exact error); `renderInsightPdf` →
  `renderToBuffer` → `new Response(buffer, { headers: { "Content-Type":
  "application/pdf", "Content-Disposition": 'attachment; filename="{docA}-vs-{docB}-
  {style}-insight.pdf"' } })` (decision 9 — replaces the native save dialog).
- **`POST src/app/api/comparisons/[comparisonId]/regenerate/route.js`** — looks up the
  existing row's `projectId`/`documentAId`/`documentBId`, creates a **new**
  `DocumentComparison` row + enqueues a new `compare` job (old row is left alone,
  becomes history) — mirrors desktop's "regenerate creates a new id" behavior exactly;
  do not make this update-in-place.
- **`DELETE src/app/api/comparisons/[comparisonId]/route.js`** — `$transaction`: delete
  `ComparisonFinding` rows then the `DocumentComparison` row.

### Cascade cleanup

`src/app/api/documents/[id]/route.js`'s `DELETE` handler needs a
`removeComparisonsForDocument`-equivalent step (mirrors desktop's `main.js:1609`
helper): before deleting the document, find every `DocumentComparison` where
`documentAId` or `documentBId` matches, delete their `ComparisonFinding` rows, then
those `DocumentComparison` rows, all inside the same `$transaction` the route already
uses for its other cascades. Add the equivalent to the project-delete route as a
belt-and-suspenders pass, same as desktop's project-deletion safety net.

### Chat tool — `src/lib/compareQueryTool.js`

Ported from `electron/compare/queryTool.js` (102 lines):

- `COMPARE_DOCUMENTS_TOOL` — OpenAI function tool, `name: "compare_documents"`, params
  `{document_a: string, document_b: string}` (both required), description tells the
  model when to call it ("user asks how two specific documents differ, or to
  compare/diff two documents by name").
- `resolveDocumentName(name, projectDocuments)` — normalize (lowercase, strip
  extension, collapse non-alnum to spaces) and bidirectional-substring-match against
  project document filenames. **0 matches → return a clarifying-question error; 2+
  matches → return an error listing the candidates** — never silently guess (matches
  this codebase's existing `consult_general_knowledge` grounding-discipline tone).
- `runCompareDocumentsTool({ prisma, sqs, openai, projectId, documentA, documentB })` —
  resolves both names; **checks for an existing `status: "ready"` comparison for this
  exact unordered pair first and reuses it** (decision 8) rather than enqueueing a new
  job; if none exists, creates the row + enqueues the `compare` job **and polls/awaits
  its completion inline** (unlike the picker-driven flow, the chat tool call needs a
  result *now*, within the same completion round-trip — poll
  `DocumentComparison.status` every ~1s up to a bounded timeout, e.g. 45s; on timeout,
  return a "comparison is still generating, ask again shortly" tool result rather than
  hanging the chat request indefinitely — this bounded-wait pattern has no desktop
  equivalent since desktop's version was synchronous by construction, but is required
  here given decision 6's architecture change). Returns `{ comparisonId, resultText }`
  — `resultText` is a plain-text rendering of the summary takeaways
  (`- [category] title: explanation`), or `"No significant differences or similarities
  were flagged."` if empty; **never the raw findings list** — keep the tool-result
  message small.

### Wiring into `src/app/api/projects/ask/route.js`

Add `COMPARE_DOCUMENTS_TOOL` to the `tools` array **only** in this route (project chat)
— not `src/app/api/documents/[id]/ask/route.js` (document chat has no compare tool,
same as desktop). Both existing tool-bearing branches (BM25-fallback and main
cosine-similarity, per `ASK_QUESTION_TOOL_FEATURE_SPEC.md`'s own line references) get
`tools: [GENERAL_KNOWLEDGE_TOOL, QUERY_KNOWLEDGE_GRAPH_TOOL, COMPARE_DOCUMENTS_TOOL]`.
After the completion call, check `tool_calls[0].function.name`:

- `"consult_general_knowledge"` → existing stash/resume flow, unchanged.
- `"query_knowledge_graph"` → existing inline flow from
  `KNOWLEDGE_GRAPH_AND_INSIGHTS_FEATURE_SPEC.md`, unchanged.
- `"compare_documents"` → **new**, inline (decision 8, no confirmation): parse
  `document_a`/`document_b` from `toolCall.function.arguments`, call
  `runCompareDocumentsTool(...)`, feed `resultText` back as a `role: "tool"` message,
  make a second completion call (no `tools` this time) for the final assistant text —
  same three-message shape (`[...baseMessages, assistantMessage, {role:"tool",
  tool_call_id, content}]`) already used for `query_knowledge_graph`. If
  `runCompareDocumentsTool` returned a `comparisonId`, persist it on the new
  `ProjectMessage` row's `comparisonId` column so the frontend can render a "View full
  comparison" link.

### Security note (no new surface introduced)

Every comparison/finding is reached only through routes that first verify the
comparison's `project.userId === session.user.id` (or the equivalent
`user.email` check this codebase's other routes use) before returning or mutating
anything — same defense-in-depth shape as every prior spec's security note. A tampered
`comparisonId` 404s, same as a tampered `documentId` does today.

## Frontend implementation

### `ComparisonsView.jsx` — new component (`src/components/documents/ComparisonsView.jsx`)

Ported from the desktop component of the same name: lists a project's comparisons
newest-first (each row: both filenames, status badge, created date), a "New
Comparison" button (disabled when the project has fewer than 2 documents), clicking a
row navigates to `/compare?id=...`.

### `ComparePickerModal.jsx` — new component (`src/components/documents/ComparePickerModal.jsx`)

Ported from the desktop component: a searchable checklist of the project's documents,
**excluding documents still mid-pipeline** (statuses like `processing`/`chunked`/
`embedding`/`summarizing`/`clustering` — anything short of `ready`), "exactly two"
selection (a third click deselects the oldest or is a no-op, match desktop's exact
behavior), a "Compare" button that `POST`s to `/api/projects/[id]/comparisons` and
routes to `/compare?id=<comparisonId>` on success.

### Mounting into `ChatInterface.jsx`

Add a "Comparisons" tab alongside project chat, same `CardHeader` tab-row pattern
already established for adding a tab in this codebase (see the Figures/Graph tab
pattern documented in the other two specs) — render `ComparisonsView` when active.

### `src/app/(app)/compare/page.jsx` — new route, ported from `src/app/compare/page.jsx`

This is the single largest frontend piece (697 lines on desktop). Port near-verbatim,
adapting only data loading (fetch instead of `window.api`) and native APIs:

- **State**: `comparison`, `findings[]`, `history[]` (other comparisons for the *same*
  document pair, filtered client-side), `loading`, `error`, `activeTab`
  (`'all'|'same'|'changed'|'added'|'removed'`), `viewMode`
  (`'findings'|'document'|'insight'`), `insightStyle` (`'compact'|'descriptive'`),
  `generatingInsight`, `insightError`, `downloadingInsight`, `textSize`, `regenerating`,
  delete-modal state.
- **Data loading**: `useEffect` on `comparisonId` (from `useSearchParams`, wrap the page
  in `<Suspense>` for this, same as desktop) → `GET /api/comparisons/[id]` → also
  `GET /api/projects/[id]/comparisons` filtered client-side to the same document pair
  for `history`. If `status === "generating"`, poll every ~3s (same pattern as
  `GraphView.jsx`) until `ready`/`error`.
- **Header**: back button, title (`{filenameA} vs {filenameB}`), generated-date +
  error badge, text-size zoom control (Normal/Large/Larger/Largest via CSS `zoom` on
  the wrapper — port this exact mechanism, not per-element Tailwind sizing; desktop
  defaults to "Large" after user feedback that "Normal" read too small — default this
  port to "Large" too), Regenerate button (`POST .../regenerate` then
  `router.replace('/compare?id=' + newId)` — **creates a new id, do not update in
  place**), Delete button (existing `DeleteConfirmationModal`).
- **Summary cards**: grid above the tab content, one per `summaryJson` takeaway —
  lightbulb icon + title + category badge (Key Difference=amber, Key Similarity=gray,
  Notable Risk=red, Other=blue) + explanation.
- **View mode 1 — Findings** (`ListFilter` icon): sub-tabs All/Same/Changed/Added/
  Removed with live counts; each finding as a `FindingCard` — section label + category
  badge + explanation, then a 2-column excerpt grid (dashed+italic "Not present in this
  document" for the empty side), each side with a "View source" link (only if that
  side's `chunkId` exists) → `/document?id=<docId>`. Sorted by `sortOrder`.
- **View mode 2 — Document View** (`BookOpen` icon, container `max-w-7xl` instead of
  the default `max-w-4xl` — needs the extra width): findings re-sorted into each
  document's **original reading order** via `chunkIndex` (not similarity order) — pull
  `chunkIndex` from the joined `Chunk` rows via the `GET /api/comparisons/[id]` route
  (Prisma `include`, replacing desktop's two `LEFT JOIN chunks`). Two-column CSS grid,
  each finding is one row spanning both columns for its label/explanation, then a
  `DocumentCell` per side. Redline styling: removed = red background + strikethrough;
  added = green background + underline; changed = A cell gets removed-styling, B cell
  gets added-styling; same = neutral gray, no strike/underline. Use a `React.Fragment`
  per finding (not a wrapping `<div>`) so cells land as direct grid siblings.
- **View mode 3 — Insight** (`Sparkles` icon): Compact/Descriptive sub-toggle; lazily
  `POST .../insight { style }` on first switch to an ungenerated style (spinner:
  "Writing the detailed version…"); "Download PDF" button (disabled until that style
  has sections) → `GET .../insight-pdf?style=...`, trigger via a plain `<a
  href download>` or `window.open`, no special client-side PDF handling needed since the
  route returns the file directly. Render via the shared `InsightView` component
  (`src/components/insights/InsightView.jsx`, ported per
  `MINOR_FEATURE_GAPS_FEATURE_SPEC.md`) — **pass no `dividers` prop** (defaults to
  `true`, the horizontal-rule-between-sections look this page wants, as opposed to the
  chat insight views which explicitly pass `dividers={false}`).
- **History section**: shown only if non-empty, each row clickable (jumps to that
  comparison) with a status badge.

### Wiring the "View full comparison" chat link

In `ChatInterface.jsx`'s message rendering, when an assistant `ProjectMessage` has a
`comparisonId`, render a small button/link under that message: `"View full
comparison" → router.push('/compare?id=' + comparisonId)`.

## Verification plan

- Compare two clearly different versions of similar content (e.g. a contract v1 vs v2)
  via the picker — confirm findings correctly bucket into same/changed/added/removed,
  and that `enforceCategory` holds (spot-check: no "added" finding has a
  `documentAChunkId`, no "removed" finding has a `documentBChunkId`).
- Compare two completely unrelated documents — confirm the 0.82 threshold prevents
  spurious matches (expect mostly added/removed, not false "same"/"changed" pairs).
- Compare two very large documents (enough chunks to exceed the 40-call cap) — confirm
  some findings come back as `category: "same"` with `sectionLabel: null` and the UI
  renders "Untitled section" instead of erroring.
- Findings view: tab counts match the actual filtered list; "View source" opens the
  right document at roughly the right spot.
- Document View: redline styling correct for all four categories; reading order
  (not similarity order) is visibly different from Findings view's order on a document
  with reordered content.
- Insight tab: Compact loads immediately (precomputed); switching to Descriptive shows
  the loading state then generates once, is cached on a second visit (no second LLM
  call — verify via a server log or network tab).
- Download PDF for both styles — confirm content matches on-screen Insight, opens
  cleanly in a PDF viewer.
- Regenerate — confirm a **new** `comparisonId` appears in the URL and the old
  comparison still exists and appears in History.
- Delete a comparison — confirm its findings are gone too (no orphaned rows).
- Delete one of the two source documents — confirm any comparison referencing it (and
  its findings) is also gone.
- Chat path: ask project chat "compare X and Y" by name — confirm the permission-free
  inline flow works, a "View full comparison" link appears and navigates correctly, and
  asking the *same* comparison again reuses the existing ready row (verify via a
  server log showing no second `compare` job enqueued, or via `completedAt` staying
  identical across both asks).
- Chat path ambiguity: ask to compare using a name matching 0 or 2+ documents — confirm
  the model relays a clarifying question rather than guessing.
- A tampered `comparisonId` on another user's comparison 404s on every route (get,
  insight, insight-pdf, regenerate, delete).
- Kill/restart the worker mid-comparison-job — confirm the comparison row is left in
  `"generating"` (matching the existing "stuck job" characteristic already accepted for
  other job types in this codebase, not something this feature needs to newly solve)
  and that a user-triggered Regenerate still works cleanly afterward.
