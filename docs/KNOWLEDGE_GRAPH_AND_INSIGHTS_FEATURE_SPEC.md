# Knowledge Graph & Insights — Implementation Spec (Cloud/SaaS)

## Purpose

This document is the liaison spec for porting "Knowledge Graph & Insights" (per-document
and cross-document entity/relationship extraction, an interactive force-directed graph
canvas, narrative insight cards with graph highlighting, and a chat tool) from the
desktop Electron app (`mytextdigest`) to this cloud/SaaS codebase. The desktop version
is fully built and iterated through several real bug-fix/UX rounds (perf, coreference,
visual redesign, insight layer) — this spec captures the final design **and** the
specific failure modes already found and fixed, so they aren't rediscovered here.
Follow this as the source of truth.

The **entire frontend rendering stack is framework-agnostic React** — `EntityNode.jsx`,
`FloatingEdge.jsx`, `graphLayout.js`, `entityStyles.js`, `insightStyles.js` use zero
Electron/Node APIs and port **verbatim, unmodified**. The backend diverges completely:
no pgvector, no Organization model, SQS-worker background processing instead of
in-process Electron calls, and — critically — a hard-won **manual-trigger-only**
posture that must be preserved exactly (see decision 2).

## What ships

- A **Graph** tab on the document detail page (always shown, unlike Figures which is
  PDF/DOCX-only — entities can come from any document type), and a **Graph** tab in
  project chat, both showing an interactive force-directed canvas of extracted
  entities/relationships.
- **Manual generation only** — never triggered automatically at upload/ingestion.
- Entity detail panel (rename/delete/merge duplicates), a project-level cross-document
  view where the same real-world entity resolved across documents appears once.
- **Graph-derived insight cards** (3–7 narrative cards per document or project, each
  with supporting entities/relationships and real quoted evidence) with a "Show on
  graph" action that highlights the card's supporting nodes/edges and dims the rest.
- A `query_knowledge_graph` chat tool, available in both document and project chat,
  answering relationship-shaped questions ("How is X connected to Y?") by traversing
  the extracted graph — inline, no confirmation gate.

**Out of scope** (matching the desktop version's own explicit deferrals):
- "Why?" click-to-explain traversal UX on causal edges (scoped, deferred, not built).
- Cross-document insight graph (document-to-document edges like "contradicts"/"cites").

## Locked-in decisions (do not relitigate)

**1. Entity resolution is project-scoped, mirroring topic clustering exactly.**
Exact normalized-name match first (free, in-memory), then embedding cosine similarity
against same-type candidates already in the project, batched — **one** OpenAI
embeddings call per chunk's unmatched entities (`input: string[]`), never one call per
entity. A single high-confidence threshold, **no** middle "assign to closest" zone
(unlike topic clustering): `STRONG_MATCH = 0.86`. Below it, a new entity is created
rather than guessed into an existing one — deliberately biased toward under-merging.
**This batching is not an optimization, it's a fix for a real production bug**: the
original per-entity-call version took 7+ minutes on a 2-page document (20+ serial
OpenAI round-trips, each subject to the SDK's own retry/backoff, stacked on 3 other
pipelines already hitting the same account at upload time). Do not regress to
per-entity calls.

**2. Graph generation is 100% manual — never triggered from document ingestion.**
This was a deliberate reversal after the desktop version was first shipped with
automatic fire-and-forget generation at upload time: it recreated exactly the
rate-limit contention decision 1 above describes, because it stacked as a *fourth*
simultaneous pipeline alongside chunk-embedding (`pLimit(5)`), summarization
(`pLimit(5)`), and figure captioning (`pLimit(3)`) already firing at that moment. **Any
future automatic-at-upload trigger for this feature must be weighed against the 3+
pipelines already firing simultaneously at upload time in this codebase** — the
`type: "figures"` job (already shipped) is exactly at that ceiling; do not add a
`type: "graph"` job as a fourth automatic one. The UI shows an explicit "Generate
Graph" button in the empty state instead.

**3. The LLM is never trusted to invent facts — validated three separate times, not
once.** (a) Extraction (`extractor.js`): a relationship's `source`/`target` must
exactly match an entity name extracted from the *same chunk* — endpoints that don't
resolve are silently dropped. (b) Document-level insight synthesis
(`insights.js`): every inferred edge must connect two entities that **already exist**
for this document — nothing new invented, and a literal restatement of an existing
`(source, target, relation)` triple is rejected (deduping is keyed on the full triple,
not just the pair — a document can legitimately have both a structural relation *and* a
distinct causal one between the same two entities, and pair-only dedup wrongly dropped
the second one in testing; keep the triple key). (c) Narrative insight cards
(`narrativeInsights.js`): every cited entity name and relationship triple is resolved
against the real data server-side — an unresolved citation is dropped, not trusted;
evidence quotes are **never asked of the LLM at all** — they're pulled directly from
`entity_mentions`/`relationships` rows for whichever ids actually resolved, so evidence
cannot be hallucinated even if a citation elsewhere were wrong.

**4. Document-structure labels are not entities.** The extraction prompt explicitly
tells the model to skip section/table headings ("Cash Flow Summary," "Table 3") and
extract the actual facts under them instead — a real early-version failure mode
(floating orphan nodes with no relationships, named after headings, cluttering the
graph with nothing to connect to).

**5. Generic self-references ("the Company," "the Corporation," "the Firm"...) resolve
to a running per-document "primary organization" anchor, not through name/embedding
matching.** A document that introduces "Solstice Robotics, Inc." once and then refers
to itself as "the Company" for the rest of the text previously produced **two separate
disconnected entity nodes** — neither exact-name nor embedding similarity reliably
connects a generic placeholder phrase to a proper name + its description closely enough
to clear the 0.86 threshold. This split real facts across two nodes and specifically
blocked causal-insight synthesis (two facts that belonged together were attached to
different nodes). Fix: a fixed `GENERIC_ORG_REFERENCES` set routes straight to the
document's established anchor (preferring a proper name resolved in the *same batch*
over one carried in from earlier chunks). **Preserve this special case explicitly** —
it is not covered by the general resolution algorithm and won't reappear on its own if
dropped.

**6. `metric` is a first-class entity type carrying `value`/`unit`/`period`, not a
generic `misc`/`concept`.** A quantified fact ("46.2%", "gross margin," "FY2022") gets
its own type so it can be rendered distinctly (bold value on the node itself) instead
of being an indistinguishable label. When a metric could plausibly recur for a
different period (this year's figure vs. last year's), the period is baked into the
entity **name itself** (e.g. "Gross margin (FY2022)," not "Gross margin") specifically
so the two don't collide into one resolved entity.

**7. Visual design is deliberate and specific — port it exactly, not approximately.**
Filled circular nodes (not outlined pills) sized by **graph degree** (relationships
touching it, not raw mention count — a date mentioned twice but connected to nothing
shouldn't outsize a well-connected entity), colored by entity type from a fixed
8-slot categorical palette (a 9th type, `metric`, deliberately has **no own hue** — it
aliases `misc`'s fill and is differentiated by showing its value/unit as bold text on
the node instead, per the dataviz convention that a validated palette's slot count is
fixed and a 9th series folds into "Other" rather than getting an invented color).
Force-directed layout (`d3-force`, 300 fixed ticks, no live animation — a knowledge
graph doesn't reshape after load). Edges are "floating" (computed against each node's
actual circle boundary via node-center-to-node-center geometry, not from a fixed
handle side) so they visually radiate toward whichever node they connect to instead of
producing a tangled fixed-side mess — this was a specific fix after an earlier version
using a static circular ring layout with fixed-side handles looked "cluttered." Inferred
edges (from decision 3b's synthesis pass) render **dashed**, same color, not a new hue
— texture, not color, is the accessible secondary channel here. Degree-0 nodes render
at `opacity: 0.55` (still findable, visually recessive) rather than hidden. Edge stroke
colors are specific, contrast-checked values (`#6b6a63` light / `#9c9b93` dark) — an
earlier version's edge color measured only ~2:1 contrast and was reported as "hardly
visible"; do not pick new colors without checking contrast against both surface
themes.

**8. Insight cards are a distinct layer from synthesized graph edges — do not conflate
them.** `insights.js`'s output (decision 3b) is single graph EDGES with
`is_inferred=1`/`insight_type`, rendered as dashed lines on the canvas itself.
`narrativeInsights.js`'s output is a **higher-level** synthesis — a title + explanation
that can cite *multiple* entities/relationships plus concrete evidence at once,
rendered as cards in a side panel, not on the canvas directly (only via the "Show on
graph" highlight action). Both exist; build both as separate layers, not one merged
into the other.

**9. The Insights panel and the entity-detail panel share one screen slot — never
stack them.** Opening one closes the other (same z-index tier, same slide-over shell
pattern) since both occupy the same right-side space in both normal and fullscreen
mode.

## Data model

### Prisma schema migration

```prisma
model Entity {
  id             String   @id @default(cuid())
  projectId      String   @map("project_id")
  name           String
  normalizedName String   @map("normalized_name")
  type           String   // person|organization|location|product|concept|event|date|metric|misc
  description    String?
  value          String?  // metric only
  unit           String?  // metric only
  period         String?  // metric only
  embedding      Json?
  mentionCount   Int      @default(0) @map("mention_count")
  documentCount  Int      @default(0) @map("document_count")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  project             Project             @relation(fields: [projectId], references: [id])
  entityDocuments      EntityDocument[]
  mentions             EntityMention[]
  sourceRelationships  Relationship[]      @relation("RelSource")
  targetRelationships  Relationship[]      @relation("RelTarget")

  @@index([projectId])
  @@index([projectId, normalizedName])
}

model EntityDocument {
  id         String   @id @default(cuid())
  entityId   String   @map("entity_id")
  documentId String   @map("document_id")
  confidence Float    @default(0.0)
  assignedAt DateTime @default(now()) @map("assigned_at")

  entity   Entity   @relation(fields: [entityId], references: [id])
  document Document @relation(fields: [documentId], references: [id])

  @@unique([entityId, documentId])
  @@index([documentId])
}

model EntityMention {
  id          String   @id @default(cuid())
  entityId    String   @map("entity_id")
  documentId  String   @map("document_id")
  chunkId     String   @map("chunk_id")
  mentionText String?  @map("mention_text")
  createdAt   DateTime @default(now()) @map("created_at")

  entity Entity @relation(fields: [entityId], references: [id])
  chunk  Chunk  @relation(fields: [chunkId], references: [id])

  @@index([entityId])
  @@index([chunkId])
}

model Relationship {
  id             String   @id @default(cuid())
  projectId      String   @map("project_id")
  sourceEntityId String   @map("source_entity_id")
  targetEntityId String   @map("target_entity_id")
  relation       String
  description    String?
  documentId     String   @map("document_id")
  chunkId        String?  @map("chunk_id")          // nullable — synthesized edges aren't grounded in one chunk
  confidence     Float    @default(0.0)
  status         String   @default("ready")
  isInferred     Boolean  @default(false) @map("is_inferred")
  insightType    String?  @map("insight_type")      // "causal" | "comparative" | "trend" | null
  createdAt      DateTime @default(now()) @map("created_at")

  sourceEntity Entity @relation("RelSource", fields: [sourceEntityId], references: [id])
  targetEntity Entity @relation("RelTarget", fields: [targetEntityId], references: [id])

  @@index([sourceEntityId])
  @@index([targetEntityId])
  @@index([projectId])
}

model GraphExtractionLog {
  id           String    @id @default(cuid())
  documentId   String    @unique @map("document_id")
  status       String    @default("pending")  // pending|extracting|resolving|ready|error
  chunksTotal  Int       @default(0) @map("chunks_total")
  chunksDone   Int       @default(0) @map("chunks_done")
  errorMessage String?   @map("error_message")
  startedAt    DateTime? @map("started_at")
  completedAt  DateTime? @map("completed_at")

  document Document @relation(fields: [documentId], references: [id])
}

model GraphInsight {
  id               String   @id @default(cuid())
  projectId        String   @map("project_id")
  documentId       String?  @map("document_id")     // null = project-level/cross-document
  title            String
  explanation      String
  category         String   // Growth|Financial|Operations|Risk|Market|Strategic|Other
  entityIds        Json     @map("entity_ids")       // array of Entity.id
  relationshipIds  Json     @map("relationship_ids") // array of Relationship.id
  evidence         Json     // [{documentId, filename, pageNumber, quote}]
  createdAt        DateTime @default(now()) @map("created_at")

  project  Project   @relation(fields: [projectId], references: [id])
  document Document? @relation(fields: [documentId], references: [id])

  @@index([documentId])
  @@index([projectId])
}
```

Add reverse relations on `Project`, `Document`, and `Chunk` (`entityMentions
EntityMention[]`). Run `npx prisma migrate dev --name add_knowledge_graph`.

Note the desktop schema's `entities.value/unit/period` and the nullable
`relationships.chunk_id`/`is_inferred`/`insight_type` were bolted on via two later
SQLite migrations (their own migrations #30/#31) — since this is a fresh Postgres
migration, include all of it in one pass, no staged-migration equivalent needed.

## Backend implementation

### `src/lib/graph/extractor.js` — new module, ported near-verbatim

Pure — no DB access. Ported from `electron/graph/extractor.js` (88 lines):

- `ENTITY_TYPES = ["person","organization","location","product","concept","event","date","metric","misc"]`.
- `extractEntitiesFromChunk(openai, chunkText)` — `gpt-4o-mini`, `temperature: 0`,
  `max_tokens: 1500`, `response_format: { type: "json_object" }`. Port the exact
  `EXTRACTION_PROMPT` (decisions 4 and 6 are encoded in its wording — copy verbatim,
  including the metric period-in-name instruction and the document-structure-labels
  exclusion). Output validated/truncated in code: entity names ≤200 chars, descriptions
  ≤500 chars, `value`/`unit`/`period` only kept for `type === "metric"`; relationships
  filtered to only those whose `source`/`target` match an extracted entity name in the
  same chunk (case-insensitive).

### `src/lib/graph/resolver.js` — new module

Ported from `electron/graph/resolver.js` (236 lines):

- `THRESHOLDS = { STRONG_MATCH: 0.86 }` (decision 1).
- `normalizeName`, `GENERIC_ORG_REFERENCES` set + `isGenericOrgReference` (decision 5,
  port the fixed set verbatim: "the company," "company," "the corporation,"
  "corporation," "the firm," "firm," "the organization," "the organisation," "the
  group," "the business," "the enterprise," "the parent company," "the issuer," "the
  registrant").
- `buildCache(projectId, prisma)` — loads every existing project entity once per
  document run into an in-memory `{byKey: Map, byType: Map}` structure, kept in sync
  in-place as new entities are created during the run (no repeated DB round-trips
  within one document's extraction pass). Replace `db.prepare(...).all()` with
  `prisma.entity.findMany({ where: { projectId } })`.
- `matchAgainstCache(embedding, type, cache)` — cosine similarity against same-type
  cached candidates, returns a match only at/above `STRONG_MATCH`.
- `resolveEntitiesBatch(drafts, { projectId, prisma, openai, cache, primaryOrgId })` —
  **the batching decision-1 fix**: exact-name matches are free; every remaining
  unmatched draft is embedded in **one** `openai.embeddings.create({ input: [...] })`
  call, matched against the cache, or inserted as new. Generic org references
  (decision 5) are resolved in a second pass after every proper-named organization in
  the same batch has resolved, preferring a same-batch anchor over one carried in from
  earlier chunks, falling back to ordinary resolution only if no anchor exists anywhere
  in the document yet. Returns `{ results: Map<lowercasedName, {entityId, confidence,
  isNew}>, primaryOrgId }` — `primaryOrgId` threaded by the caller into the next
  chunk's call, reset to `null` once per document run.

### `src/lib/graph/insights.js` — new module (edge synthesis, decision 3b)

Ported from `electron/graph/insights.js` (170 lines):

- `synthesizeDocumentInsights(documentId, projectId, prisma, openai)` — runs once per
  document, after all per-chunk extraction+resolution is committed. Loads the
  document's full resolved entity set (`Entity` join `EntityDocument` where
  `documentId`) + already-extracted non-inferred relationships for the document. Bails
  with no LLM call below `MIN_ENTITIES_TO_BOTHER = 4`. One `gpt-4o-mini` call
  (`temperature: 0.2`, `max_tokens: 1500`, JSON mode) asking for up to
  `MAX_INSIGHTS = 12` comparative/causal/trend connections **between entities that
  already exist for this document** (port `SYNTHESIS_PROMPT` verbatim). Every
  source/target validated against the known entity-name set; self-loops dropped;
  **triple-keyed** dedup (`source::target::relation`, decision 3b) against both
  existing relationships and insights already added this run. Inserted as
  `Relationship` rows with `isInferred: true`, `chunkId: null`, `confidence: 0.75`,
  `insightType` one of `causal|comparative|trend` (defaults to `comparative` on
  malformed output).

### `src/lib/graph/narrativeInsights.js` — new module (insight cards, decision 8)

Ported from `electron/graph/narrativeInsights.js` (314 lines):

- `CATEGORIES = ["Growth","Financial","Operations","Risk","Market","Strategic","Other"]`.
- `generateInsights({ prisma, openai, projectId, documentId })` — `documentId` set =
  document-scope, omitted = project-scope (every entity/relationship in the project).
  Loads entities (capped `MAX_ENTITIES = 150`) + relationships (capped
  `MAX_RELATIONSHIPS = 200`, including inferred ones — tagged `[inferred causal]` etc.
  in the prompt text so the model doesn't treat them as a literal document quote).
  Bails below `MIN_ENTITIES_TO_BOTHER = 4`. One `gpt-4o-mini` call (`temperature: 0.3`,
  `max_tokens: 2000`, JSON mode, `MAX_INSIGHTS = 7`) — port `INSIGHTS_PROMPT` verbatim.
- **Grounding enforced in code** (decision 3c): every `supporting_entities` name and
  `supporting_relationships` triple is resolved against the real loaded data (triple
  match falls back to a same-pair match if the model paraphrases the relation text —
  still requires the *pair* to be real, `relByTriple`/`relByPair` maps). An insight
  with zero resolved support is dropped entirely.
- `buildEvidence(prisma, entityIds, relationshipIds)` — **never asks the LLM for
  evidence**; pulls real `EntityMention` rows (filename/page/quote) and
  `Relationship`-joined-`Document` rows for the resolved ids directly, capped
  `MAX_EVIDENCE_PER_INSIGHT = 6`, deduped by `(documentId, pageNumber, text)`.
- `generateAndStoreInsights({ prisma, openai, projectId, documentId })` — generate,
  then **replace** whatever was previously stored for this exact scope (delete-then-
  insert in one transaction) — but only on success; a hard API error leaves existing
  stored insights untouched rather than wiping them for nothing. A "skipped" (too
  little material) result still clears+stores an empty set, since that's a real answer.
- `getStoredInsights(prisma, { projectId, documentId })` — read-back, parsing the
  `Json` array columns.

### `src/lib/graph/queryTool.js` — new module (chat tool)

Ported from `electron/graph/queryTool.js` (148 lines):

- `QUERY_KNOWLEDGE_GRAPH_TOOL` — OpenAI function tool, `name:
  "query_knowledge_graph"`, params `{entity: string (required), maxHops: 1|2 (default
  1)}`. Port the description verbatim (it's what makes the model call this instead of
  answering from chunk context alone for relationship-shaped questions).
- `findEntity(prisma, name, { documentId, projectId })` — exact normalized-name match
  within the document (or project) scope first, then a `contains` fallback ordered by
  `mentionCount` descending.
- `getDirectEdges(prisma, entityId, { documentId, projectId })` — all relationships
  touching this entity within scope, including the source/target entity names (and,
  project-scope, the document filename) via `include`.
- `runKnowledgeGraphQuery({ prisma, entity, maxHops, documentId, projectId })` — BFS
  frontier expansion 1 or 2 hops, capped `MAX_EDGES = 30`, returns a **plain-text
  summary** (never throws — degrades to a "not found"/"no relationships" message
  string), each edge formatted as `"{source} {relation} {target}{source filename if
  project-scope}{[inferred causal, not a direct quote] if isInferred}"`. This is
  **synchronous, no DB writes** — safe to call inline mid-chat-turn (Prisma
  `findMany`/`findFirst` calls, not a job).

### Worker job — `worker/processGraph.js` + `worker/index.js` wiring

Ported orchestration from `electron/graph/index.js` (199 lines) as
`processGraphJob(job)`:

```js
if (job.type === "graph") return processGraphJob(job);
```

`processGraphJob({ documentId, projectId })`:

1. If no `projectId` — skip entirely (resolution is project-scoped; nothing to resolve
   against without one), matching desktop's own early-return.
2. Load chunks (`prisma.chunk.findMany({ where: { documentId }, orderBy: { chunkIndex:
   "asc" } })`), cap at `CHUNK_CAP = 40` (mirrors the Figures spec's identical cap).
3. Upsert a `GraphExtractionLog` row to `status: "extracting"`.
4. Per-chunk extraction with bounded concurrency (`p-limit(5)`) — **each chunk's
   failure caught and isolated** (empty result, never throws the batch); increment
   `chunksDone` on the log row after each.
5. Status → `"resolving"`. `buildCache` once, then loop each chunk's extracted drafts
   through `resolveEntitiesBatch` **sequentially across chunks** (not parallel — each
   chunk's resolution needs the running `primaryOrgId` anchor and the cache updated by
   the previous chunk), writing `EntityMention`/`EntityDocument`/incrementing
   `mentionCount`/`documentCount`, then inserting validated `Relationship` rows for
   that chunk.
6. `synthesizeDocumentInsights` (decision 3b) — one extra pass over the fully-committed
   entity/relationship set.
7. `GraphExtractionLog` → `status: "ready"`, `completedAt`, `errorMessage` set to a
   "Skipped N chunk(s) beyond the cap" note if `CHUNK_CAP` was hit, else `null`.
8. **The entire function must never throw past its own handler** — same posture as
   `processFigureJob`; catch everything, write `status: "error"` +
   `errorMessage` on the log row. Add `"graph"` to `worker/index.js`'s
   `recordJobFailure` exclusion list (`|| body.type === "graph"`) for the same reason
   figures/cluster are excluded — a graph failure must never flip a document's own
   `Document.status` to `"failed"`; the per-document `GraphExtractionLog.status` is the
   correct place for this feature's own failure state.

### New API routes

Mirror `src/app/api/documents/[id]/...`/`src/app/api/projects/[id]/...` conventions,
ownership-checked before touching anything:

- **`POST src/app/api/documents/[id]/graph/generate/route.js`** — the **only** trigger
  for single-document extraction (decision 2 — never called automatically). Upserts
  `GraphExtractionLog` to `pending`/`extracting`, enqueues `{ type: "graph", documentId,
  projectId: doc.projectId }`, returns immediately.
- **`GET src/app/api/documents/[id]/graph/route.js`** — returns `{ nodes: Entity[],
  edges: Relationship[], status, errorMessage }` for this document (nodes = entities
  joined via `EntityDocument`, edges = relationships where `documentId` matches). This
  is the endpoint `GraphView.jsx`'s poll hits.
- **`POST src/app/api/projects/[id]/graph/generate/route.js`** — batch-generates every
  project document lacking a `ready` `GraphExtractionLog`, **sequentially, not in
  parallel across documents** (mirrors desktop's explicit choice — avoids recreating
  decision 1's contention), enqueuing one `graph` job at a time and awaiting its
  completion (poll the log row) before enqueueing the next. Given this repo's
  request-timeout constraints, implement this as a **route that enqueues a single
  `type: "graph-batch"` coordinator job** (new worker job type that itself loops and
  enqueues/awaits per-document `graph` jobs) rather than blocking the HTTP request for
  the full batch duration — the frontend then polls per-document status the same way
  it already does for single-document generation, no new push/websocket mechanism
  needed (same "no server-push" reasoning as `ASK_QUESTION_TOOL_FEATURE_SPEC.md`'s
  decision, applied here to a different feature).
- **`GET src/app/api/projects/[id]/graph/route.js`** — returns the full project graph
  (every entity where `projectId` matches, every relationship where `projectId`
  matches) **plus** `documentsTotal`/`documentsProcessed` (count of project documents
  with `GraphExtractionLog.status === "ready"`) — this coverage count is required, not
  optional: the desktop version initially shipped without it and a project with 3
  documents but only 1 graph-generated looked like a scoping bug (it wasn't — the
  aggregation was correct, just under-populated with no way to tell). Ship the coverage
  banner from day one.
- **`GET src/app/api/entities/[entityId]/route.js`** — one entity's full detail
  (description, value/unit/period, mention count, source documents, relationships).
- **`PATCH src/app/api/entities/[entityId]/route.js`** — body `{ name }`, rename.
- **`DELETE src/app/api/entities/[entityId]/route.js`** — delete the entity + cascade
  its `EntityMention`/`EntityDocument` rows + any `Relationship` touching it (all in
  one `$transaction`).
- **`POST src/app/api/entities/[entityId]/merge/route.js`** — body `{ mergeIntoId }`
  (or the inverse naming, match whichever reads clearer — desktop's is `{keepId,
  mergeId}`): repoints every `EntityMention`/`EntityDocument`/`Relationship` reference
  from the merged-away entity onto the kept one, sums `mentionCount`, unions
  `documentCount`, deletes the merged-away row — all in one `$transaction`.
- **`GET src/app/api/documents/[id]/graph/insights/route.js`** — `getStoredInsights`.
- **`POST src/app/api/documents/[id]/graph/insights/generate/route.js`** —
  `generateAndStoreInsights` — **synchronous, direct `await` in the route handler**
  (one LLM call, a few seconds — same posture as the comparison insight route in
  `DOCUMENT_COMPARISON_FEATURE_SPEC.md`, no queue needed).
- **`GET src/app/api/projects/[id]/graph/insights/route.js`** /
  **`POST src/app/api/projects/[id]/graph/insights/generate/route.js`** — same, project-scoped
  (`documentId: null`).

### Cascade cleanup

`src/app/api/documents/[id]/route.js`'s `DELETE` transaction gains a
`removeGraphDataForDocument`-equivalent step (mirrors desktop's `main.js` helper,
called from both single-document delete and project delete): delete `GraphInsight` rows
for this document **and** any project-level (`documentId: null`) `GraphInsight` that
cites an entity this document contributed (since a project-level card may dangle
otherwise), delete `EntityMention`/`EntityDocument` rows for this document, delete
`Relationship` rows where `documentId` matches, delete the `GraphExtractionLog` row.
**Entities themselves are not deleted** unless they end up with zero remaining
`EntityDocument` rows afterward (an entity can be shared across documents) — check and
clean up orphaned entities as a final step.

### Chat tool wiring — both `documents/[id]/ask/route.js` and `projects/ask/route.js`

Unlike `COMPARE_DOCUMENTS_TOOL` (project chat only, per
`DOCUMENT_COMPARISON_FEATURE_SPEC.md`), `QUERY_KNOWLEDGE_GRAPH_TOOL` belongs in **both**
chat surfaces — a single document's own chat can meaningfully ask "how is X connected to
Y" within that one document's graph. Add it to both routes' `tools` arrays:
`tools: [GENERAL_KNOWLEDGE_TOOL, QUERY_KNOWLEDGE_GRAPH_TOOL]` for document chat
(currently just `[GENERAL_KNOWLEDGE_TOOL]` per `ASK_QUESTION_TOOL_FEATURE_SPEC.md`),
and `tools: [GENERAL_KNOWLEDGE_TOOL, QUERY_KNOWLEDGE_GRAPH_TOOL,
COMPARE_DOCUMENTS_TOOL]` for project chat, in **every** tool-bearing branch each spec
already identified (document route's single call site; project route's BM25-fallback
and main branches).

Also add one line to both routes' STEP-0 system prompt (right after the existing
"consult_general_knowledge" STEP-0 block, before the "Rules"/"Do NOT" section):

```
If the question is about how a specific person, organization, or other named entity is
connected or related to something else (e.g. "How is X connected to Y?", "Who does X work
for?", "What did X acquire?"), call the query_knowledge_graph tool with that entity's name
instead of relying solely on the document context below — the connecting facts may live in
a different part of the document than what was retrieved.
```

After the completion call, check `tool_calls[0].function.name === "query_knowledge_graph"`
**alongside** the existing `"consult_general_knowledge"` check (both routes already
branch on tool name once `COMPARE_DOCUMENTS_TOOL` is added per the Compare spec — this
is a third branch in the same `if/else if` chain): unlike general knowledge, this runs
**inline, no confirmation, no stash/resume** — parse `entity`/`maxHops` from the tool
call arguments, call `runKnowledgeGraphQuery({ prisma, entity, maxHops, documentId:
docId, projectId: undefined })` (document route) or `..., documentId: undefined,
projectId })` (project route), feed the plain-text result back as a `role: "tool"`
message alongside the original assistant message, make a second completion call (no
`tools`) for the final answer — same three-message shape already established for
`compare_documents` in the sibling spec.

### Security note (no new surface introduced)

Every entity/relationship/insight is reached only through routes that first verify the
owning project's `userId` against the session — same shape as every prior spec. A
tampered `entityId` 404s.

## Frontend implementation

### Ported verbatim (zero Electron/Node API usage — copy the files as-is)

- `src/components/graph/graphLayout.js` — `computeForceLayout(entities, relationships)`
  (`d3-force`, 300 fixed ticks, degree-based radius 26–60px). **New dependency:
  `d3-force`** (not currently in this repo).
- `src/components/graph/entityStyles.js` — `ENTITY_TYPES`, `TYPE_LABELS`,
  `TYPE_STYLES` (Tailwind badge/legend classes), `NODE_FILL` (the validated 8-slot
  categorical fill palette + computed-contrast text color per type, `metric` aliasing
  `misc`'s fill per decision 7).
- `src/components/graph/insightStyles.js` — `INSIGHT_CATEGORIES`, `CATEGORY_STYLES`
  (separate concept from entity-type styles, not bound by the categorical-hue rule
  since these are plain UI chips).
- `src/components/graph/EntityNode.jsx` — filled circular `@xyflow/react` custom node,
  degree-0 opacity 0.55, highlight/dim props for the Insights "Show on graph" feature,
  metric value/unit shown as bold primary text with entity name as smaller caption.
- `src/components/graph/FloatingEdge.jsx` — the node-center-to-circle-boundary geometry
  (decision 7) — standard React Flow "floating edge" pattern, zero repo-specific code.

**New dependency: `@xyflow/react` (React Flow v12), not the older `reactflow` package**
— verify this repo's React version; the desktop app is on React 19 and only
`@xyflow/react` declares `react: >=17` compatibility. Also add `d3-force` as noted
above.

### `src/components/graph/EntityGraphCanvas.jsx` — port with no logic changes

Ported from the desktop file: `buildFlowNodes`/`buildFlowEdges` (highlight/dim mapping
for the Insights integration), the `Legend` component (type color key + a "Stated in
document" solid-line / "Inferred insight" dashed-line key, shown only when the graph
has at least one inferred edge), the dark-mode CSS custom-property block for edge
color/label chrome (`--kg-edge-color`, etc. — port these exact hex values, decision 7).
Props: `{ nodes, edges, onNodeClick, highlight }` where `highlight` is `{ entityIds:
Set<number|string>, relationshipIds: Set<...> } | null`.

**Must be loaded via `next/dynamic({ ssr: false })`** — the force layout measures real
DOM node sizes, which cannot happen during SSR (same reasoning as this repo's own
`GraphView.jsx` already dynamically importing `EntityGraphCanvas`, and the Figures
spec's precedent for anything measuring real layout).

### `src/components/graph/EntityDetailModal.jsx` and `src/components/graph/InsightsPanel.jsx` — new components, ported with API-call adaptation only

Port structure/interactions verbatim; replace every `window.api.X(...)` call with the
matching `fetch()` call to the routes above:

- `EntityDetailModal`: `getEntity` → `GET /api/entities/[id]`; `renameEntity` → `PATCH`;
  `deleteEntity` → `DELETE`; `mergeEntities` → `POST .../merge`. Same slide-over shell,
  same z-index tier as the Insights panel (decision 9 — mutually exclusive with it, not
  stacked).
- `InsightsPanel`: `getDocumentInsights`/`getProjectInsights` → the two `GET .../graph/insights`
  routes; `generateDocumentInsights`/`generateProjectInsights` → the two `POST
  .../graph/insights/generate` routes. Each card: title, category badge
  (`insightStyles.js`), explanation, expandable evidence list (quoted excerpts with
  filename/page), and a "Show on graph" button calling `onShowOnGraph(insight)` →
  parent sets `highlight = { entityIds: new Set(insight.entityIds), relationshipIds:
  new Set(insight.relationshipIds), insightId: insight.id }`.

### `src/components/documents/GraphView.jsx` — document-tab content, new component

Ported from the desktop file (211 lines) near-verbatim:

- Empty state (`status: "pending"`, no nodes): "No knowledge graph yet" + a
  **"Generate Graph"** button → `POST /api/documents/[id]/graph/generate` (decision 2
  — this is the *only* trigger). Never auto-polls before this button is clicked.
- In-progress (`status ∈ {extracting, resolving}`): spinner + "Building knowledge
  graph… This can take a minute or two," polling `GET .../graph` every 3s
  (`POLL_INTERVAL_MS = 3000`) until `ready`/`error`.
- Error state: message + "Try again" (re-calls generate).
- Ready with zero entities found: "No entities found" + "Regenerate" (distinct message
  from the pending-empty state — this document was processed, nothing usable was
  extracted).
- Ready with entities: renders `EntityGraphCanvas` + a top-right button row
  (Regenerate, Insights, Fullscreen/Close) + `EntityDetailModal` +
  `InsightsPanel`. Fullscreen swaps the container to `fixed inset-0 z-60`
  — **no Escape-key handler and no backdrop-click-to-close, only the explicit Close
  button** (a deliberate desktop decision, port it as-is). Insights panel and
  entity-detail modal are mutually exclusive (opening one closes the other, decision
  9); closing Insights also clears any active highlight.

### `src/components/graph/ProjectGraphView.jsx` — project-tab content, new component

Ported near-verbatim, same shell as `GraphView.jsx` but project-scoped:

- Shows the coverage banner when `documentsProcessed < documentsTotal`: amber banner
  "Showing X of Y documents — Z not generated yet" + a "Generate (Z remaining)" button
  → `POST /api/projects/[id]/graph/generate` (decision 2's batch route).
- **Polling replaces the desktop's IPC push event** (`project-graph-generation-update`)
  — this codebase has no server-push mechanism (same constraint
  `ASK_QUESTION_TOOL_FEATURE_SPEC.md` hit for its own progress indicator). Poll `GET
  /api/projects/[id]/graph` every 3s while any document lacks a `ready` log row (the
  `documentsProcessed`/`documentsTotal` counts drive the same "Generating (2/5)"-style
  label the desktop version showed from its push event, just pulled rather than
  pushed).

### Mounting the tabs

- **Document page** (`src/app/(app)/document/page.jsx`): add `'graph'` to the tab
  state, **always shown** (no gate like Figures' `showFiguresTab` — entities can come
  from any document type), following the exact same tab-button/content-branch pattern
  documented in `FIGURE_AND_IMAGE_UNDERSTANDING_FEATURE_SPEC.md`'s Frontend section
  (same `CardHeader` tab row, same `activeTab === 'figures' ? (...) : (...)` ternary
  shape — insert a `'graph'` branch the same way).
- **Project chat** (`src/components/chat/ChatInterface.jsx`): add a Chat/Graph tab row
  to the `CardHeader` (this repo's `ChatInterface.jsx` currently has no tabs at all —
  this is the first tab added there; use the identical `Button variant={active ?
  'default' : 'ghost'}` + `flex space-x-1` pattern already used on the document page's
  own tab row, for visual consistency across the app). Render `ProjectGraphView` when
  the Graph tab is active, in place of the chat body.

## Verification plan

- Generate a document graph for a document with several named entities and
  relationships — confirm entities/relationships appear correctly typed, a `metric`
  entity shows its value/unit on the node, and generation is **never** triggered
  without clicking "Generate Graph" (upload a fresh document, confirm no graph
  auto-appears).
- A document using "the Company"/generic self-reference alongside its proper name —
  confirm both resolve to one node, not two (decision 5).
- Generate insights for that document — confirm every evidence quote traces to a real
  `EntityMention`/`Relationship`, and any ungrounded model citation was silently
  dropped (check server logs / a deliberately-adversarial test entity name).
- Click "Show on graph" on an insight card — confirm exactly its supporting
  nodes/edges highlight (amber ring, full opacity) and everything else dims, and that
  closing Insights clears the highlight.
- Generate a project graph across 3+ documents where entities overlap (e.g. the same
  organization mentioned in two documents) — confirm cross-document resolution merges
  them into one node with `documentCount >= 2`, and the coverage banner correctly
  reflects partial generation before all documents are processed.
- Rename and delete an entity — confirm the graph refetch reflects it immediately.
- Merge two duplicate entities — confirm mentions/relationships/document-links all
  repoint to the kept entity and the merged-away one is gone.
- Delete a document with graph data — confirm its entities/relationships/mentions are
  cleaned up, any project-level insight citing one of its entities is also removed, and
  an entity that becomes fully orphaned (zero remaining `EntityDocument` rows) is
  deleted; an entity still referenced by another document is preserved.
- Ask document chat "how is X connected to Y?" for two entities that are connected only
  through a 2-hop path — confirm the tool call fires, `maxHops` handling returns the
  path, and the answer correctly flags an inferred edge (if any) as
  "[inferred ..., not a direct quote]" rather than citing it as a literal quote.
- Ask project chat a relationship question spanning two different documents — confirm
  the tool resolves the entity project-wide and the formatted result includes the
  source filename per edge.
- Toggle light/dark theme with a graph on screen — confirm edge/label contrast stays
  legible in both (decision 7's specific hex values).
- Fullscreen mode — confirm it can only be closed via the explicit Close button, not
  Escape or backdrop click.
- Kill/restart the worker mid-extraction — confirm the `GraphExtractionLog` row is left
  in `"extracting"`/`"resolving"` and a subsequent "Regenerate" click still works
  cleanly.
- A tampered `entityId`/document-scoped graph route on another user's project 404s.
