# Figure & Image Understanding — Implementation Spec (Cloud/SaaS)

## Purpose

This document is the liaison spec for porting "Figure & Image Understanding" (extracting
embedded figures/diagrams from PDF and DOCX documents, captioning them with a vision
model, and making them searchable in chat) from the desktop Electron app (`mytextdigest`)
to this cloud/SaaS codebase. The desktop version is already built, committed, and
verified working — this spec captures the final design **and** the decisions that were
explicitly made along the way, so the implementing agent doesn't have to re-derive them.
Follow this as the source of truth.

The two codebases are close ports of each other for document ingestion and the document
detail page (confirmed previously in `CLICKABLE_DOCUMENT_CITATIONS_FEATURE_SPEC.md`:
`src/app/(app)/document/page.jsx` mirrors the Electron `document/page.jsx` closely). That
correspondence holds for this feature's **frontend** almost exactly. It does **not** hold
for the backend — this app's ingestion pipeline runs as SQS-driven background jobs
consumed by a long-lived `worker/` process (not in-process async functions inside an
Electron main process), storage is S3 (not local disk), the database is Postgres via
Prisma (not SQLite), and — most importantly — **there is no pgvector and no Organization
model here**, unlike what a naive reading of "cloud version" might suggest. Every
divergence from the desktop implementation is called out explicitly below, with the exact
desktop file it replaces.

## What ships

- A **Figures** tab on the document detail page (`src/app/(app)/document/page.jsx`),
  shown only for `.pdf`/`.docx` documents, alongside the existing Chat/Summary/Pagewise
  Summary tabs.
- A gallery of extracted figures (thumbnail + AI caption excerpt + status badge while
  captioning is in progress), and a detail modal (full image with zoom controls, full
  caption, collapsible OCR text, Regenerate/Delete actions).
- Figures become part of the existing chat retrieval for that document — an answer can
  draw on a figure's caption/OCR text exactly like it draws on any text chunk, with
  **zero changes** to either ask route.
- Background extraction + captioning runs as a new SQS job stage that **never blocks**
  the existing pipeline from reaching `Document.status: "ready"`.

**Out of scope** (matching the desktop version's own deferrals):
- Chat-citation thumbnails (an assistant answer linking directly to the figure it used).
- Vector-only diagram detection (charts drawn with no embedded raster image).
- EMF/WMF decoding for DOCX figures (skipped silently — no converter in either app's
  dependency tree).
- A settings toggle to disable/cap figure extraction for cost control.
- Pulling extracted figures into any slide/deck generation feature.

## Locked-in decisions (do not relitigate)

**1. Figures processing is a forked, non-blocking SQS stage — not inserted serially
into the chunk → embed → summarize → cluster chain.** Vision captioning is the slowest
and costliest stage; the existing pipeline's progression to `Document.status: "ready"`
must never wait on it. `processChunkJob` (`worker/index.js:406-419`) already enqueues a
`type:"embed"` job on completion — add a second, parallel `SendMessageCommand` there
enqueuing `type:"figures"` right alongside it. This exactly mirrors the desktop's
`extractFiguresInBackground(...).catch(...)` being called fire-and-forget *alongside*,
not chained into, `generateEmbeddingsInBackground`/`runSummarizationInBackground` inside
`processDocumentInBackground` (`electron/main.js`).

**2. A figures job's internal failures must never flip `Document.status` to
`"failed"`.** The worker's shared `recordJobFailure()` (`worker/index.js:679-695`)
already carves out an exception for `cluster` jobs for exactly this reason — its own
comment explains "clustering failures as non-blocking... marking the doc 'failed' here
would fight with the in-flight cluster job that will still resolve it to 'ready' on its
own." Add `"figures"` to that same exclusion. On top of that, `processFigureJob` itself
must catch every internal error **per figure** (mirroring the desktop's per-figure
try/catch in `captionFiguresInBackground`) and never let an error escape the job handler
at all — an uncaught throw would still trip SQS's redrive/DLQ machinery for what are
individually-recoverable captioning failures, and print alarming logs for a subsystem
that isn't supposed to be able to fail the document.

**3. No pgvector — reuse the existing brute-force JS cosine retrieval as-is.** This
codebase has no pgvector extension and no Organization model (flagging this explicitly
since it's the single biggest structural difference from the desktop app's `sqlite-vec`
setup — don't assume "cloud version" implies a vector index exists). `Chunk.embedding`
is a plain `Json` array, and every retrieval path (`documents/[id]/ask/route.js`,
`projects/ask/route.js`, `src/lib/topicUtils.js`) does brute-force cosine similarity in
JS over `prisma.chunk.findMany({where:{documentId}})`. A figure's synthetic chunk needs
**zero special-casing**: insert it into `Chunk` exactly like a text chunk, in the same
table, and it's automatically included in every existing retrieval call with no code
changes to either ask route — the same "zero changes to retrieval" property the desktop
version achieves via `vec_chunks`/FTS5, arrived at differently because the underlying
retrieval mechanism differs entirely.

**4. PDF image extraction extends `worker/runOcr.js`'s existing technique — not the
desktop's `sharp`-based approach.** This repo has no `sharp`/`canvas` dependency at all.
`runOcr.js` already proves a native-binary-free way to pull embedded image XObjects out
of a PDF via `pdfjs-dist`'s operator list + `page.objs`/`page.commonObjs`, converting raw
pixel data (RGB/RGBA/1bpp) to PNG via `pngjs` (`pixelDataToPngBuffer`,
`worker/runOcr.js:26-67`). That code is *already* safe against a real bug hit during the
desktop implementation: some `paintImageXObject` entries reference glyph/font-mask images
that only ever resolve during actual page rendering (never done here) — awaiting a
callback-based `page.objs.get(id, cb)` for one of those hangs forever, since nothing ever
calls the callback. `runOcr.js` avoids this by construction: it gates every resolution
behind a synchronous `.has()` check first (`worker/runOcr.js:133-137`,
`page.objs.has(name) ? page.objs.get(name) : ...`) rather than the callback-based
`.get(id, cb)` the desktop code originally used (and had to retrofit the same `has()`
guard onto, after hitting the hang in testing). **Copy this exact pattern** — the only
change needed is dropping the "largest image per page only" heuristic
(`runOcr.js:126-146`, built for the OCR use case where a scanned page is one big image):
a figures extractor wants *every* sufficiently-large image XObject per page, not just
one.

**5. DOCX image extraction is new — read `word/media/*` directly from the docx zip via
`jszip`.** The worker's only DOCX handling today (`worker/index.js:266-268`) is
`mammoth.extractRawText({buffer})`, which — like the desktop app before this feature
existed — silently discards every embedded image. `jszip` is already installed
transitively (mammoth's own dependency, confirmed in `node_modules/mammoth/package.json`)
but should be added to `package.json` explicitly rather than relied on as an undeclared
transitive dependency, exactly as was done for the desktop port.

**6. Captions are generated with the exact vision-call shape already proven in this
worker** (`worker/index.js`'s image-file-ingestion branch, ~lines 284-291: `gpt-4o-mini`,
base64 data-URI, `detail: "high"`) — **not** the presigned-URL variant used in
`documents/[id]/ask/route.js:296-304`. The figures job already has the raw image buffer
in memory; there's no reason to round-trip it back out to S3 just to fetch a signed URL
for the same API call. Use `getOpenAIForDocument(docId)` (`worker/openai.js`) for the
client, exactly like every other worker stage — this repo's OpenAI key is per-user
bring-your-own-key, stored in `Setting`, never an env var or a shared module-level
client. A figures job that skips this would silently use the wrong (or no) key.

**7. Markdown in captions is rendered client-side with a ported `MarkdownLite.jsx`, not
`react-markdown`.** The desktop app hit this exact problem — `gpt-4o-mini` keeps emitting
`**bold**`/`### headings`/bullet lists even when the prompt says "plain text only" — and
fixed it with a small (~70-line) dependency-free renderer
(`src/components/documents/MarkdownLite.jsx` in the Electron repo) handling just the
handful of constructs vision models actually produce, plus a `stripMarkdown` helper for
truncated excerpts. This SaaS repo has **no markdown library at all** today (confirmed:
no `react-markdown`/`remark` in `package.json` or anywhere in `src/`), and chat messages
are deliberately plain-text (`whitespace-pre-wrap`, no `dangerouslySetInnerHTML` — see
the citations spec's own locked-in decisions on this point). Port `MarkdownLite.jsx`
verbatim — it's framework-agnostic JSX with zero Node/Electron API usage — rather than
introducing a new dependency for one feature's caption text.

**8. Same cost/quality caps as desktop, unchanged**: minimum 100×100px per figure,
content-hash dedup (drops repeated logos/headers appearing on every page), a 40-figure
cap per document, EMF/WMF images skipped silently (no DB row — no converter available in
either dependency tree).

**9. Figure S3 keys**: `` `uploads/${userId}/${projectId}/${docId}/figures/${figureIndex}.png` ``,
extending the existing upload key convention (`` `uploads/${userId}/${projectId}/${fileName}` ``,
`src/app/api/s3/upload/route.js:45`) with a `figures/` sub-path. No derived-artifact key
convention exists yet in this repo — this establishes it.

**10. Chat-citation thumbnails for figures are explicitly out of scope**, matching the
desktop's own deferral — even though, unlike the desktop's SQLite `messages` table
(which has no `citations` column at all), this repo's `ProjectMessage` already has both
`citations Json?` and `chartData Json?` columns. Figure-level citations would actually be
*more* feasible to build here than on desktop. Worth flagging as a natural fast-follow
once this ships — but keep this port scoped to UI parity with what the desktop version
has today, not to what this platform could additionally support.

## Data model

### Prisma schema migration

New `Figure` model. Deliberately **not** touching `Chunk` at all — unlike the desktop's
`chunks.figure_id` column, a `chunkId` FK living on `Figure` (pointing at the `Chunk` it
generated) covers the same "look up a figure's retrieval chunk" need from the other
direction, with zero schema change to the much hotter `Chunk` table:

```prisma
model Figure {
  id           String   @id @default(cuid())
  documentId   String   @map("document_id")
  figureIndex  Int      @map("figure_index")
  pageNumber   Int?     @map("page_number")
  sourceType   String   @map("source_type")   // "pdf_image" | "docx_media"
  s3Key        String   @map("s3_key")
  width        Int?
  height       Int?
  format       String?
  caption      String?
  ocrText      String?  @map("ocr_text")
  chunkId      String?  @map("chunk_id")
  status       String   @default("pending")   // pending | captioning | ready | error
  errorMessage String?  @map("error_message")
  createdAt    DateTime @default(now()) @map("created_at")
  document     Document @relation(fields: [documentId], references: [id])
  chunk        Chunk?   @relation(fields: [chunkId], references: [id])
}
```

Add the reverse relations:

```prisma
model Document {
  // ...existing fields...
  figures Figure[]
}

model Chunk {
  // ...existing fields...
  figures Figure[]   // usually 0 or 1 — the figure this chunk was generated from, if any
}
```

Run `npx prisma migrate dev --name add_figures`.

No `onDelete: Cascade` is declared here, matching this schema's existing convention
(`Chunk.document`, `prisma/schema.prisma:95`, also has no cascade) — cascade deletes are
handled manually inside a `$transaction`, not at the DB level. See the delete-route
wiring below.

## Backend implementation

### `worker/imageUtils.js` — new shared module (refactor)

`pixelDataToPngBuffer` and the `ImageKind` constant currently live as module-private code
inside `worker/runOcr.js` (not exported). Extract them into a new `worker/imageUtils.js`
and export both, then update `runOcr.js` to import from there instead of defining them
locally. This lets the new figures extractor reuse the exact same, already-proven
pixel-conversion logic instead of duplicating it — do not copy-paste this function into
`extractFigures.js`.

### `worker/extractFigures.js` — new module

Three exported functions, mirroring the desktop's `electron/figures/{pdfExtractor,
docxExtractor, filterDedup}.js` split, adapted to this repo's dependencies:

- **`extractPdfFigures(buffer)`** — extends `runOcr.js`'s `extractPageImages` technique
  (decision 4): for each page, `page.getOperatorList()`, collect **every**
  `paintImageXObject`/`paintJpegXObject`/`paintImageXObjectRepeat` name (not just the
  largest), resolve each via the same `has()`-gated `page.objs`/`page.commonObjs`
  lookup, encode via the now-shared `pixelDataToPngBuffer`. Returns
  `{ buffer, width, height, pageNumber, figureIndex, format: "png" }[]`.
- **`extractDocxFigures(buffer)`** — open via `jszip`, list `word/media/*`, sort by
  filename's numeric suffix for a stable document-order approximation, read PNG/JPEG
  entries directly (skip `.emf`/`.wmf` with a `console.warn`, no throw, no row). Returns
  the same shape with `pageNumber: null` (DOCX has no fixed pagination).
- **`filterAndDedupFigures(rawFigures, {minWidth=100, minHeight=100, maxFigures=40})`**
  — pure function, portable almost verbatim from the desktop's
  `electron/figures/filterDedup.js`: drop images under the size threshold, dedup by
  `crypto.createHash('sha256')` content hash (keep first occurrence — catches repeated
  logos/headers/footers), cap at `maxFigures` **after** filtering/dedup.

### New worker stage: `processFigureJob`

Wire into the dispatcher (`worker/index.js:614-621`):

```js
if (job.type === "figures") return processFigureJob(job);
```

`processFigureJob({ docId, s3Key, filename, projectId, userId })`:

1. Only proceeds for `.pdf`/`.docx` filenames (case-insensitive) — return immediately
   otherwise, matching the desktop's `extractFiguresInBackground` early-return.
2. Downloads the S3 object independently (`GetObjectCommand` + `streamToBuffer`, same
   as `processChunkJob:201-207`) — this is a separate job/invocation from `processChunkJob`
   and doesn't share its in-memory buffer; re-downloading here is consistent with how
   every other stage (`embed`, `summarize`) re-fetches what it needs rather than
   threading state through job payloads.
3. Runs `extractPdfFigures`/`extractDocxFigures` + `filterAndDedupFigures`.
4. For each kept figure: uploads the PNG to S3 at the key from decision 9, then
   `prisma.figure.create({ data: { ..., status: "pending" } })`.
5. For each `pending` figure, bounded concurrency via `p-limit` (`pLimit(3)` — matches
   the desktop's captioning concurrency, lower than the `pLimit(5)` used for text
   embeddings since vision calls are slower/pricier): set `status: "captioning"`, run
   the vision call + Tesseract OCR (decision 6), on success write
   `caption`/`ocrText`/`status: "ready"`, on failure write `status: "error"` +
   `errorMessage` — **caught per-figure**, never thrown out of the loop.
6. For each `ready` figure with no `chunkId` yet: build synthetic chunk text
   `` `[Figure Analysis]\n${caption}\n\n[OCR Text]\n${ocrText || "(no text detected)"}` ``,
   `prisma.chunk.create({ data: { documentId, chunkIndex: 1_000_000 + figureIndex, text,
   metadata: { figureId, pageNumber, sourceType } } })` (the `1_000_000 +` offset mirrors
   the desktop's chunk-index namespacing so figure chunks always sort after real text
   chunks in any `orderBy: chunkIndex` query — cosmetic only, nothing reads it as a real
   index), then `openai.embeddings.create({ model: "text-embedding-3-small", input:
   text.slice(0, 8000) })`, write `Chunk.embedding`, then
   `prisma.figure.update({ where: { id }, data: { chunkId } })`.
7. The entire function body must be wrapped so **no error escapes it** — log and
   return, never throw (decision 2).

### Wiring the second enqueue into `worker/index.js`

Right after the existing `type:"embed"` enqueue (`worker/index.js:406-419`), add a
parallel enqueue — this message needs `s3Key`, unlike `embed`/`summarize`/`cluster`
which don't carry the file itself:

```js
await sqs.send(
  new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify({
      type: "figures",
      docId,
      s3Key,
      filename,
      projectId: projectId || existingDoc.projectId,
      userId: existingDoc.userId,
    }),
  })
);
```

### `recordJobFailure` exclusion (`worker/index.js:679-695`, decision 2)

```js
if (!docId || body.type === "cluster" || body.type === "figures") return;
```

### `package.json`

Add `"jszip": "^3.10.1"` to `dependencies` (decision 5) — already installed
transitively via mammoth, so this is a manifest-only change plus a lockfile update
(`npm install`), no new install risk.

### New API routes

Mirror the existing `src/app/api/documents/[id]/...` nested-route convention exactly:

- **`GET src/app/api/documents/[id]/figures/route.js`** — auth-checked identically to
  every other document-scoped route (`getServerSession()` → 401 if missing →
  `prisma.document.findFirst({where:{id, user:{email}}})` → 404 if not owned). Returns a
  **bare array** (matching the list-route convention from `documents/route.js`, not a
  `{success,...}` envelope): each figure with `imageUrl: await
  generateSignedUrl(figure.s3Key)` (reusing `src/lib/s3SignedUrl.js`, same helper used
  for document file URLs).
- **`POST src/app/api/documents/[id]/figures/[figureId]/regenerate/route.js`** —
  re-captions one figure synchronously within the request (one vision call — small/fast
  enough not to need another SQS round trip), updates the linked `Chunk`'s
  `text`/`embedding` in place if `chunkId` is already set, otherwise creates it (extract
  step 6's logic into a small shared helper used by both the worker job and this route,
  rather than duplicating it). Returns `{ success: true/false, figure }` (matches the
  mutation-route envelope convention seen in `ask`/`regenerate` routes).
- **`DELETE src/app/api/documents/[id]/figures/[figureId]/route.js`** — deletes the S3
  object (best-effort, outside any transaction — matches how the desktop deletes the
  on-disk file *before* its DB transaction), then in a `prisma.$transaction`: delete the
  linked `Chunk` if `chunkId` is set, delete the `Figure` row. Returns `{ success: true }`.

### Cascade cleanup on document delete

`src/app/api/documents/[id]/route.js`'s `DELETE` handler (lines 96-102) currently does:

```js
await prisma.$transaction(async (tx) => {
  await tx.message.deleteMany({ where: { conversation: { documentId: id } } });
  await tx.conversation.deleteMany({ where: { documentId: id } });
  await tx.chunk.deleteMany({ where: { documentId: id } });
  await tx.document.delete({ where: { id } });
});
```

Add a `figure.deleteMany` step **before** the `chunk.deleteMany` — `Figure.chunkId`
references `Chunk`, so figures must be removed first or the chunk delete would leave a
dangling FK:

```js
await tx.figure.deleteMany({ where: { documentId: id } });
```

Also add best-effort S3 cleanup for the document's figure image objects, *before* the
transaction opens (this route notably doesn't currently delete the document's own S3
object either — a pre-existing gap, not something to fix here — but don't let that
convince you figure images don't need cleanup; they're new S3 usage this feature
introduces, and should be cleaned up even though the original document file isn't yet).

### Security note (no new surface introduced)

Same shape as the citations spec's security note: figure IDs/S3 keys are only ever
reachable through routes that first re-verify `document.user.email ===
session.user.email` by loading the parent `Document` scoped to the session user before
touching any `Figure` row. A tampered `figureId` on another user's document 404s the
same way a tampered document `id` does today. No new authorization surface is
introduced.

## Frontend implementation

### Figures tab — `src/app/(app)/document/page.jsx`

- Add `'figures'` alongside the existing tab values (the `useState('chat')` comment at
  line 35 currently says `// 'chat' or 'summary'` — update it too).
- Add a `showFiguresTab` gate next to `noGuideTab` (line 69):
  `const showFiguresTab = ['pdf','docx'].includes(ext);`
- Extend the tab-reset effect (lines 161-163) with:
  `if (!showFiguresTab && activeTab === 'figures') setActiveTab('chat');`
- Add a tab button after the Guide button (~line 922), gated by `showFiguresTab`
  instead of `!noGuideTab`, using the same `Image as ImageIcon` (aliased to avoid
  clashing with the DOM `Image` global — same alias used in the desktop port) +
  `<span>Figures</span>` shape as the existing Chat/Summary/Guide buttons.
- Add a content branch in the ternary chain, between the `guide` branch (line 928) and
  the `chat` branch (line 1035):
  ```jsx
  ) : activeTab === 'figures' ? (
    <div className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900/50 custom-scrollbar">
      <FiguresGallery documentId={id} />
    </div>
  ) : (
  ```

### `src/components/documents/FiguresGallery.jsx` — new component

Near-identical port of the desktop component of the same name, adapted for
fetch-based data loading instead of `window.api`:

- `fetchFigures()` → `fetch(`/api/documents/${documentId}/figures`).then(r => r.json())`.
- Poll via `setInterval`, gated on whether any figure's `status` is `pending` or
  `captioning` — same interval-clear-when-done pattern already used for document-list
  processing status (`src/app/(app)/project/page.jsx:48-141`, `PROCESSING_STATUSES` /
  `stopPolling()`).
- Grid of thumbnails, each `<img src={figure.imageUrl}>` (the signed URL from the list
  response, not a local path), with a spinning-icon status badge while in progress
  (same visual pattern as `DocumentCard.jsx`'s existing badges) and a
  `stripMarkdown`-truncated caption excerpt (import from the ported `MarkdownLite.jsx`).
- Empty state ("No figures found...") when the array is empty and nothing is
  in-progress.

### `src/components/documents/FigureDetailModal.jsx` — new component

Same content as the desktop version — full image with zoom controls reusing
`ZoomIn`/`ZoomOut`/`RotateCcw` from `lucide-react` (already used the same way in
`DocumentPreviewBody.jsx:2,162-182` — copy that exact zoom-state/button pattern), full
caption rendered via `<MarkdownLite text={figure.caption} />`, collapsible OCR text,
Regenerate/Delete buttons — but built on **this repo's actual**
`Modal`/`ModalHeader`/`ModalContent`/`ModalFooter` (`src/components/ui/Modal.jsx`)
instead of the desktop's hand-rolled fixed-overlay `<div>` (the desktop app has no
shared Modal component; this repo does — use it rather than duplicating that chrome).

- Regenerate button → `POST /api/documents/${documentId}/figures/${figure.id}/regenerate`.
- Delete button → `DELETE /api/documents/${documentId}/figures/${figure.id}`.

### `src/components/documents/MarkdownLite.jsx` — ported verbatim

Copy directly from the Electron repo's
`src/components/documents/MarkdownLite.jsx` — pure React/JSX, zero Node/Electron API
usage, including its `stripMarkdown` named export used for gallery-card excerpts. No
adaptation needed.

## Verification plan

- Upload a PDF containing a large embedded diagram, a small icon, and a logo repeated
  on every page, and a DOCX with a pasted PNG + an EMF chart. Confirm via Prisma
  Studio/`psql` that `Figure` rows are sane (icon dropped, logo deduped, EMF absent),
  and that `status` progresses `pending → captioning → ready`.
- Confirm the SQS queue shows a `type:"figures"` message enqueued alongside
  `type:"embed"` right after the chunk stage, and that the main pipeline reaches
  `Document.status: "ready"` **without waiting** for the figures job — upload a
  figure-heavy document and confirm chat/summary become usable before all figures
  finish captioning.
- Open the document page: the Figures tab appears (absent for a `.txt` upload); the
  gallery renders thumbnails + captions with an in-progress indicator until ready,
  updating without a manual reload.
- Click a figure → detail modal opens with working zoom, a rendered (not raw-markdown)
  caption, and collapsible OCR text.
- Ask a single-document chat question whose answer only exists in a figure's caption —
  confirm it's reflected, with zero changes needed in `documents/[id]/ask/route.js`.
- Regenerate a figure's caption — confirm its linked `Chunk.text`/`embedding` update in
  place (not a duplicate chunk).
- Delete a figure — confirm its `Chunk` row, S3 object, and `Figure` row are all gone.
- Delete the whole document — confirm `Figure` rows, their S3 objects, and
  figure-linked `Chunk` rows are all cleaned up alongside the existing cascade
  (messages/conversations/chunks/document).
- A tampered `figureId` on another user's document 404s on regenerate/delete, same as
  tampering a document `id` does today.
