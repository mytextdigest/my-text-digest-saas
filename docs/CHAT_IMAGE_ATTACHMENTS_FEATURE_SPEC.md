# Chat Image Attachments & Image Generation — Implementation Spec (Cloud/SaaS)

## Purpose

This spec ports **image attachments and image generation in chat** from the desktop Electron app (`mytextdigest`) to this codebase, for both **project chat** and **document chat**. Follow it as the source of truth.

The feature came from a customer request. They had tried this in ChatGPT:
1. upload two graph images and ask to "combine them into a slide": two graphs side by side
2. then ask to "combine the graphs into one graph": a single merged chart

The desktop version does this, generalised: users can attach images to any chat message, and the assistant either answers about them in text or produces a new image (combine, merge, redraw, restyle, convert a chart type, …). It was demoed and well received. Latency and cost were then tuned (see "Measured cost and latency").

**The UI and UX must be indistinguishable from the desktop.** That covers:
- the paperclip, paste and drag-and-drop composer
- the thumbnails on the user's message
- the lead-in paragraph shown before the image
- the shimmering placeholder with its status line
- the generated-image card with Download / Save to project / Improve quality and the quality badge
- the full-screen viewer

The desktop components are copied, not redesigned. Everything that differs is backend plumbing, and each difference is called out below with the desktop code it replaces.

Desktop references (the design record; read them before starting):
- **Pipeline:** `mytextdigest/electron/chat/imageTurn.js`. Pure functions:
  - `planImageTurn`: route + output description
  - `buildImagePrompt`: chart transcription → SOURCE DATA block + `CHART_RULES`
  - `generateCheckedImage`: low-quality draw → read back → one medium-quality retry
  - `generateImageFromImages`
  - `answerAboutImages`
  - `addDocumentFactsToPrompt`
  - `friendlyImageError`
- **Wiring:** `mytextdigest/electron/main.js`, under `--- Chat attachments (images in chat) ---`:
  - `storeChatImage`, `chatAttachmentToClient`, `bindChatAttachments`
  - the upload / discard / save-to-project / save-image-as / copy-image IPC handlers
  - `collectTurnImages`, `retrieveImageTurnContext`, `runImageTurn` and the `improve-chat-image` handler
  - the `2️⃣b` hook in both `ask-document` and `ask-project`
- **Models:** `mytextdigest/electron/config/models.js`, specifically `MODEL_IMAGE` and `MODEL_CHAT_VISION`.
- **UI:**
  - `mytextdigest/src/components/chat/ChatImages.jsx`: `MessageImageThumbs`, `GeneratedImage` + `ImproveQualityMenu`, `ImageGeneratingPlaceholder`, `ComposerAttachments`, `AttachButton`, `DropOverlay`, `ChatImageViewer`
  - `mytextdigest/src/components/chat/useChatImages.js`: `useComposerAttachments`, `useChatImageActions`
  - `mytextdigest/src/components/ui/ImageViewerModal.jsx`
  - call sites in `mytextdigest/src/components/chat/ChatInterface.jsx` and `mytextdigest/src/app/document/page.jsx`

The pattern matches every earlier port: the frontend is the close-parity part and the backend diverges. This repo has:
- **no long-running in-process work**: Vercel functions, an SQS queue and a long-lived `worker/` on EC2
- **no IPC push events**: polling instead
- **no `sharp`**: `pngjs` / `jpeg-js` via `src/lib/tables/vision/imageOps.js`
- **no filesystem or native dialogs**: S3, browser downloads and the Clipboard API
- **per-user OpenAI keys** (`Setting.openai_api_key`), so every model call is billed to the user's own key

---

## What ships

Parity with the desktop, in both project chat and document chat:

1. **Composer attachments.**
   - A paperclip button left of the input, plus paste and drag-and-drop onto the chat.
   - Drag-and-drop shows a dashed "Drop images to attach (PNG, JPG, WEBP — up to 4)" overlay.
   - Up to **4** images, PNG/JPG/WEBP. Thumbnails (64 px) show a spinner while uploading, a red error state on failure, and an ✕ to remove.
   - While images are attached the placeholder changes to "Say what to do with the images...".
   - Send is enabled with text, images, or both. An image-only message is valid.
2. **User message.** Attached images render as 112 px-high thumbnails above the bubble. The bubble is omitted when there's no text, and message actions are hidden when there's no text.
3. **Image turns.** When a message has images, or follows up on images in the last few messages ("now combine them into one graph", with no re-upload), a planner routes the turn:
   - **generate_image**: the **lead-in paragraph** appears immediately (1–3 sentences: what will be made and how). Below it, a 3:2 shimmering placeholder shows a status line that updates: "Reading the charts…" → "Creating the image… this can take up to a minute" → "Checking the chart against the source data…" (→ "Fixing a data mismatch and redrawing…"). Then the image appears.
   - **answer_image**: a normal text answer read off the images.
   - **documents**: not about the images; the normal document RAG flow runs unchanged.
4. **Generated-image card** (max 560 px wide, aspect from the image). Clicking opens the viewer. Below it:
   - **Download**
   - **Save to project** (→ "Saved to project" ✓)
   - **Improve quality ▾**: a menu that opens upwards over the image and lists only the tiers above the current one:
     - **Standard** "~30 s · ~5¢": "Cleaner lines and labels. Good for most slides."
     - **High detail** "~70 s · ~18¢": "Sharpest text and fine detail, for dense charts or a final export."
     - The menu note says "Redraws this image as a new message, so you can compare the two."
   - A right-aligned **quality badge**: Quick draft / Standard / High detail. On Quick draft the tooltip is "Generated quickly. Use Improve quality for a sharper version."

   While a redraw runs, the button area shows "Redrawing in High detail… Cancel". Errors appear under the card. The redraw arrives as a new assistant message, "Here's a sharper version (High detail quality)." with its own card.
5. **Full-screen viewer** (generic, reusable):
   - zoom by wheel, buttons and `+`/`-`/`0` keys, anchored at the cursor
   - drag to pan; double-click toggles fit ↔ 2.5×
   - a % readout; clicking it gives actual size
   - fit, Copy, Download, Close (Esc), and a backdrop click to close
   - arrows plus a thumbnail strip when there are several images
   - an extra-actions slot (Save to project)
6. **Save to project** adds the image as a normal project document, so it gets captioning, tables-from-images and so on. It works from the card and from the viewer, and is idempotent. In document chat it saves into that document's project.
7. **Document chat scoping.** A request that needs document facts ("does this chart match the report?") uses only that document's chunks. In project chat it uses the selected documents.
8. **Persistence.** Images and image turns survive reloads. A generation still running when the page loads resumes its placeholder and finishes in place.
9. **Cleanup.** Clearing a chat, deleting a document, or deleting a project removes its chat images (DB rows and S3 objects). Uploads that were staged but never sent expire.

**Out of scope:** an up-front quality question, an "ambiguity" clarifying question (both rejected by product), a "default image quality" setting, non-image attachments, and counting chat images toward the storage quota (see decision 12).

---

## Locked-in decisions (do not relitigate)

1. **Copy the desktop pipeline and UI; do not rewrite them.**
   - `electron/chat/imageTurn.js` becomes `src/lib/chatImages/imageTurn.js` (CommonJS → ESM). Prompts, JSON schemas, `CHART_RULES`, tolerances and comments stay byte-for-byte; they are tuned (see "Why the pipeline looks like this").
   - `ChatImages.jsx`, `useChatImages.js` and `ImageViewerModal.jsx` are copied. The only changes are replacing `window.api.X(...)` with `chatImagesApi.X(...)` (decision 3) and the polling additions in decision 5.
2. **Pure modules in `src/lib/chatImages/`.** Both the API routes (planner, answers) and the worker (transcription, generation, check) import them. This follows the `src/lib/tables/` and `src/lib/figureChunk.js` precedent.
3. **UI parity through a client shim, `src/lib/chatImagesApi.js`.** It exports the desktop preload method names and return shapes:
   - `uploadChatAttachment({ messageTable, filename, buffer | file })`, returning `{ success, attachment }`
   - `discardChatAttachment(id)`
   - `saveChatAttachmentToProject({ attachmentId, projectId })`, returning `{ success, documentId, alreadySaved? }`
   - `improveChatImage({ attachmentId, quality, requestId })`, returning `{ success, answer, attachments } | { cancelled } | { error }`. This one hides the enqueue + poll, so it resolves only when the redraw is done, exactly like the desktop IPC call.
   - `saveImageAs({ fileUrl, defaultName })`
   - `copyImageToClipboard({ fileUrl })`
   - `cancelRequest(requestId)`

   This is the `src/lib/tablesApi.js` precedent: components differ from the desktop by an import line, and future desktop UI changes port by diff.
4. **Image generation runs in the worker, not in the request.**
   - Generation takes about 13–70 s, and the retry and High-detail paths take longer. Routes here use `maxDuration = 60` on Vercel, and the repo's rule is no long-blocking requests and no server push (see `KNOWLEDGE_GRAPH_AND_INSIGHTS_FEATURE_SPEC.md`).
   - The **planner and text answers run in the ask route** (about 3–5 s, like any chat answer). The **generation runs as an SQS job**.
   - Rejected: `after()`/`waitUntil` inside the route. It is still capped by the function's `maxDuration`, and High detail plus a retry can exceed 60 s.
5. **Progress via polling, with the same visuals.**
   - Desktop pushes `chat-progress` events (`{ stage: 'generating_image', leadIn, status }`). Here the ask route returns `{ success, pendingImage: { kind, messageId, leadIn } }`. The client polls `GET /api/chat-images/jobs/[messageId]?kind=…` every **1.5 s** and maps the response to exactly the desktop `progress` object, so the placeholder JSX is unchanged.
   - The status line is stored in a message column (`imageProgress`), which the worker updates at each step.
6. **A dedicated queue for chat-image jobs.** The worker processes one message at a time from one queue (`worker/index.js` `mainLoop`). An image request would otherwise wait behind a 200-page PDF's chunk → embed → summarize chain.
   - Add `SQS_CHAT_QUEUE_URL` and run a second, independent poll loop on it in the same worker process. Refactor `mainLoop()` into `pollLoop(queueUrl, label)` and start two of them.
   - If the env var is unset (local dev), chat-image jobs go to the main queue.
   - Add the queue to `docker/elasticmq.conf` for local runs.
7. **Images are served same-origin through an authenticated route, not as signed S3 URLs in the payload.**
   - `GET /api/chat-attachments/[id]/file` checks ownership and streams the S3 object, with `Cache-Control: private, max-age=31536000, immutable`. The bytes for an id never change.
   - `?download=1` adds `Content-Disposition: attachment; filename="…"`.
   - Why:
     - (a) history URLs never expire. Signed URLs expire after 1 h (and after 7 days for slides, where it is a known bug).
     - (b) Copy-to-clipboard needs a `fetch` of the bytes, which cross-origin S3 would block without bucket CORS changes.
     - (c) `fileUrl` stays an opaque string to the components, as on desktop.
8. **Uploads go browser → S3 via a presigned POST, then are registered.**
   - Don't reuse `/api/s3/upload`. It trusts a client-sent `userId` and is keyed by document filename with a duplicate check.
   - Add `POST /api/chat-attachments/presign`. It derives the key from the session: `chat/{userId}/staged/{uuid}.{ext}`, max 20 MB, and image content types only.
   - Then `POST /api/chat-attachments` with `{ key, kind, originalName }`. It validates the prefix and normalises the image (decision 9).
9. **Normalisation without sharp.**
   - **PNG and JPEG** are decoded with `decodeImage` from `src/lib/tables/vision/imageOps.js`, downscaled to fit 2048 px with its `resize`, and re-encoded as PNG. Export the currently private `encodePng` from that file. This mirrors desktop `storeChatImage`, which used sharp: rotate, fit inside 2048, PNG. EXIF rotation is not available in pure JS; accept that, since phone photos of charts are the rare case.
   - **WebP** has no decoder here. Store it unchanged with `mime: image/webp` and null width/height. The vision models and `images.edit` accept WebP. The UI handles null dimensions: no aspect-ratio style, so the image keeps its natural size.
   - Reject anything else.
10. **Polymorphic attachments table without FKs, like the desktop.** One `ChatAttachment` model, keyed by `messageKind` (`"project"` | `"document"`) and `messageId`, nullable while staged. A `userId` column gives one-query ownership checks. Cleanup is explicit, in the delete and clear routes (decision 13).
11. **Models.** Add `src/lib/models.js`, mirroring desktop `electron/config/models.js`:
    - `MODEL_IMAGE = "gpt-image-2"`
    - `MODEL_CHAT_VISION = "gpt-4.1-mini"`

    `gpt-image-2` rejects `input_fidelity`; never send it.

    **Phase 0 (urgent, independent):** `src/lib/slides/imagePrompt.js` `generateSlideImageBuffer` still calls `gpt-image-1`, which **OpenAI shuts down on 2026-10-23**. Switch it to `MODEL_IMAGE`. The desktop already did this and verified slide generation with gpt-image-2 at `quality: "medium"`.
12. **Costs go to the user's key; no quota.** Chat images do not count toward `storageUsedBytes` in v1. Save to project does count, because it creates a real document through the same storage-limit check as `documents/ingest` (decision 14).
13. **Cleanup.** Delete S3 objects best-effort, after the DB rows, following the slide-image pattern in `documents/[id]/route.js`:
    - `projects/clear` and `documents/[id]/clear-conversation`: attachments of the deleted messages.
    - `documents/[id]` DELETE: attachments of that document's conversations.
    - `projects/[id]` DELETE: attachments of the project chat and of every document chat in it.
    - Staged uploads: an S3 lifecycle rule expires `chat/*/staged/` after 2 days. The register route also deletes that user's staged rows older than 24 h, which replaces the desktop's startup sweep.
14. **Save to project reuses ingest.**
    - Extract the post-validation body of `documents/ingest/route.js` (storage-limit check, `Document` create, `storageUsedBytes` increment, `chunk` job enqueue) into `src/lib/documents/createDocumentFromS3.js({ userId, projectId, s3Key, filename, visibility })`. Use it in both places.
    - Save-to-project `CopyObject`s the attachment to `uploads/{userId}/{projectId}/{filename}`. The filename is `chat-image-YYYY-MM-DD-HH-MM-SS.png` for generated images, or the original name for uploads, with a `-2`, `-3` suffix on clashes (the duplicate-filename rule).
15. **Cancel.**
    - Before a job is enqueued, cancel works as today (`/api/cancel` aborts the route).
    - Once enqueued, `chatImagesApi.cancelRequest` / the Stop button calls `POST /api/chat-images/jobs/[messageId]/cancel?kind=…`, which sets the message `status = "cancelled"`. The worker checks the status before each paid step and before storing, and drops the result if cancelled.
    - An in-flight OpenAI call cannot be aborted across processes. The UI behaves as on desktop (the placeholder disappears and input is re-enabled), but that one call is still billed. Accept this.

---

## Why the pipeline looks like this (don't simplify it away)

These were found by testing on desktop with real charts:
- **The planner cannot also transcribe chart data.** Asked in the same call (even with a strict schema and field ordering), gpt-4o returned `charts: []` every time. Hence a **separate transcription call**, whose output is formatted into a `SOURCE DATA` block plus `CHART_RULES`.
- **Without the data block, the image model invents.** gpt-image-1 dropped a bar twice, drew a 47 above a 0–40 axis, and garbled axis titles. gpt-image-2 with the data block was correct.
- **Low quality is enough when the data is in the prompt.** In tests it was as accurate as high quality at about 1/35 the output cost and about 1/5 the time. The **check** (re-transcribe the output, compare every source value with tolerance `max(3% of value, 1.5% of axis max)`) catches a dropped or changed value and triggers **one medium-quality retry**; the better attempt is kept. The check compares values, not bar heights or layout. Merged charts at low quality can have small cosmetic flaws, which is what Improve quality is for.
- **gpt-4.1-mini reads charts as well as gpt-4o at about 1/5 the cost.** gpt-4o-mini is *not* cheaper for images, because it bills images at many more tokens.
- **Routing before retrieval.** Image turns must not get document chunks unless the planner sets `use_documents`. Otherwise retrieved numbers leak into a redrawn chart, `detectChartIntent("combine the graphs")` attaches an unrelated chart built from document text, and the "use only the document context" prompt causes refusals. When documents are needed, they go in as a short fact list (`addDocumentFactsToPrompt`), never raw chunks.

### Measured cost and latency (desktop, 2026-10-03, per turn with two input charts)

| | Time | Cost (user's key) |
|---|---|---|
| Combine into a slide (low + check) | ~21 s | ~$0.022 |
| Merge into one chart (low + check) | ~21 s | ~$0.022 |
| A failed check, so a medium retry | +~25 s | +~$0.05 |
| Improve → Standard (medium) | ~30 s | ~$0.054 |
| Improve → High detail (high) | ~70 s | ~$0.18 |
| Text answer about an image | ~4 s | ~$0.002 |

These are the figures shown in the Improve quality menu; keep them in sync if prices change. Prices: gpt-image-2 $5 text-in / $8 image-in / $30 image-out per 1M tokens; gpt-4.1-mini $0.40 / $1.60. On SaaS, add about 1–3 s for queue pickup and polling.

---

## Data contract

### Prisma (one migration, `add_chat_attachments`)

```prisma
model ChatAttachment {
  id              String   @id @default(cuid())
  userId          String   @map("user_id")
  messageKind     String   @map("message_kind")   // "project" | "document"
  messageId       String?  @map("message_id")     // null while staged in the composer
  direction       String                          // "input" | "output"
  s3Key           String   @map("s3_key")
  originalName    String?  @map("original_name")
  mime            String
  width           Int?
  height          Int?
  sizeBytes       Int?     @map("size_bytes")
  savedDocumentId String?  @map("saved_document_id")
  generationJson  Json?    @map("generation_json") // outputs only: { prompt, size, quality, inputAttachmentIds, improvedFrom? }
  createdAt       DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id])

  @@index([messageKind, messageId])
  @@index([userId, createdAt])
}
```

On **both** `Message` and `ProjectMessage` add:

```prisma
  imageProgress String?  @map("image_progress")  // live status line while status = "generating"
  imageJobJson  Json?    @map("image_job_json")  // the queued job's inputs (below); cleared when done
```

`status` gains the values `"generating"` and `"cancelled"` (it is a free-form string today). `generationJson` is the desktop's `generation_json` recipe (desktop migration 45). It is what lets Improve quality redraw without re-running the planner or transcription.

`imageJobJson` (written by the route, read by the worker):

```js
{
  mode: "generate" | "improve",
  inputAttachmentIds: [...],      // in planner order
  size: "1536x1024" | "1024x1024" | "1024x1536",
  // generate only:
  imagePrompt: "...",             // planner's output description (before SOURCE DATA is added)
  question: "...",                // for addDocumentFactsToPrompt
  documentContext: "...",         // only when the planner set use_documents; already-retrieved chunk text
  leadIn: "...",
  // improve only:
  quality: "medium" | "high",
  sourceAttachmentId: "...",
}
```

### Client attachment shape (`chatAttachmentToClient`, identical to desktop)

```js
{ id, fileUrl: `/api/chat-attachments/${id}/file`, width, height, name, direction,
  savedDocumentId: string | null,
  quality: "low" | "medium" | "high" | null }  // null = not redrawable (inputs, legacy)
```

### Routes

| Route | Replaces desktop | Notes |
|---|---|---|
| `POST /api/chat-attachments/presign` `{ kind, fileName, fileType }` | — | Session-derived key under `chat/{userId}/staged/`. Only `image/png|jpeg|webp`, ≤ 20 MB. |
| `POST /api/chat-attachments` `{ key, kind, originalName }` | `upload-chat-attachment` | Validates prefix, normalises (decision 9), writes the normalised object to `chat/{userId}/{kind}/{uuid}.png` (WebP: `.webp`) and deletes the staged object. Creates a row with `messageId: null`. Sweeps that user's staged rows older than 24 h. |
| `DELETE /api/chat-attachments/[id]` | `discard-chat-attachment` | Only when `messageId` is null (staged). |
| `GET /api/chat-attachments/[id]/file[?download=1]` | `fileUrl` (file://) + `save-image-as` | Ownership via `userId`. Streams from S3. |
| `POST /api/chat-attachments/[id]/save-to-project` `{ projectId }` | `save-chat-attachment-to-project` | The project must be the user's. Idempotent: returns `alreadySaved` if `savedDocumentId` still exists. Uses `createDocumentFromS3` (decision 14) and passes through its 413 storage error. |
| `POST /api/chat-attachments/[id]/improve` `{ quality }` | `improve-chat-image` | `quality ∈ {medium, high}`. Output rows with `generationJson.prompt` only. All inputs must still exist, else "The original images are no longer available, so this image can't be redrawn." Creates an assistant message (`status: "generating"`, content `Here's a sharper version (${label} quality).`) and enqueues. Returns `{ success, pending: { kind, messageId } }`. |
| `GET /api/chat-images/jobs/[messageId]?kind=` | `chat-progress` events | Returns `{ status, progress, leadIn, answer?, attachments?, error? }`. `attachments` is present when `status === "done"`. |
| `POST /api/chat-images/jobs/[messageId]/cancel?kind=` | `cancel-request` | Sets `status = "cancelled"` if the message is still `generating`. |
| `POST /api/projects/ask`, `POST /api/documents/[id]/ask` | `ask-project`, `ask-document` | Accept `attachmentIds: string[]`. `question` may be empty when attachments are present. Image turns return `{ success, conversationId?, answer, attachments }` (answer_image) or `{ success, conversationId?, pendingImage: { kind, messageId, leadIn } }` (generate_image). |
| `GET /api/projects/messages/[projectId]`, `GET /api/documents/messages/[conversationId]` | `get-project-messages`, `get-messages` | Each message gains `attachments: [...]`, `status`, and for `generating` messages `imageProgress`. |

Worker job (on `SQS_CHAT_QUEUE_URL`, falling back to the main queue):

```js
{ type: "chat-image", kind: "project" | "document", messageId, userId }
```

---

## Backend implementation

### Phase 0: gpt-image-1 shutdown (do first, ship separately)

- Add `src/lib/models.js` with `MODEL_IMAGE` and `MODEL_CHAT_VISION` (decision 11).
- In `src/lib/slides/imagePrompt.js`, `generateSlideImageBuffer` uses `model: MODEL_IMAGE`. Also update the gpt-image-1 mentions in comments in that file and in `documents/[id]/slide-images/generate/route.js`.
- Smoke-test: generate one slide image from the Uploads panel, and build one deck with hero images.

### 1. `src/lib/chatImages/imageTurn.js`

A copy of desktop `electron/chat/imageTurn.js`, converted to ESM, importing `MODEL_IMAGE` and `MODEL_CHAT_VISION` from `@/lib/models` (the worker uses relative `../src/lib/...`, as the tables code already does). Keep the exports unchanged:
- `planImageTurn`
- `buildImagePrompt`, which returns `{ prompt, charts }`
- `generateCheckedImage`, which returns `{ buffer, quality }` and takes `onStatus`
- `generateImageFromImages`
- `answerAboutImages`
- `addDocumentFactsToPrompt`
- `friendlyImageError`
- `MAX_INPUT_IMAGES`

Image inputs are `{ buffer, mime, name, direction, isCurrent }`, exactly as on desktop.

### 2. `src/lib/chatImages/server.js` (shared by routes and worker)

Ports of the desktop helpers:
- `MESSAGE_MODEL = { project: "projectMessage", document: "message" }`, used to pick the Prisma delegate for a kind.
- `chatAttachmentToClient(row)`: the shape above. `quality` comes from `generationJson.prompt ? generationJson.quality : null`.
- `bindChatAttachments(kind, messageId, userId, ids)`: `updateMany where { id in ids, userId, messageKind: kind, messageId: null, direction: "input" }`. Returns the ids actually bound; a project-chat upload can't be bound in document chat.
- `loadAttachments(kind, messageIds)` and `attachmentsByMessage(kind, messageIds)`, for the history routes.
- `readAttachmentBuffer(row)`: S3 `GetObject` → Buffer, using the `streamToBuffer` pattern from `slide-images/route.js`.
- `collectTurnImages(kind, conversationId, userMessageId)`: desktop logic with `IMAGE_TURN_LOOKBACK = 6`:
  - take the current message's attachments
  - if there are none, take those of the last 2 recent messages that have any, capped at `MAX_INPUT_IMAGES`
  - order by `createdAt` (cuid ids aren't numeric, so don't compare ids)
- `retrieveImageTurnContext({ openai, docIds, text })`: embed `text` with `text-embedding-3-small`, brute-force cosine over those documents' `Chunk.embedding`, top 6, formatted `Document: {filename}\n{text}`. This matches the repo's existing no-pgvector retrieval, which is inlined in each ask route today. Write it as a small function; don't refactor the ask routes' own retrieval.
- `deleteAttachmentsForMessages(kind, messageIds)`: delete the rows, then best-effort delete the S3 objects.
- `enqueueChatImageJob(body)`: like `tables/routeUtils.js` `enqueueJob`, but to `process.env.SQS_CHAT_QUEUE_URL || process.env.SQS_QUEUE_URL`.

### 3. `runImageTurn` in the ask routes

`src/lib/chatImages/turn.js` exports `runImageTurn({ openai, kind, conversationId, userMessageId, userId, question, docIds })`. It is a port of desktop `runImageTurn` with one change: the generate branch **enqueues instead of generating**.

```text
images = collectTurnImages(...)               → none? return null
history = last 4 messages before the user message (role, content)
plan = planImageTurn(...)                     → route "documents"? return null
documentContext = plan.useDocuments ? retrieveImageTurnContext(...) : ""
answer_image   → answerAboutImages(...); mark user msg done; create assistant msg; return { success, answer, attachments: [] }
generate_image → mark user msg done
                 create assistant msg { content: leadIn, status: "generating",
                                        imageProgress: "Reading the charts…",
                                        imageJobJson: { mode: "generate", inputAttachmentIds: selected ids,
                                                        size, imagePrompt, question, documentContext, leadIn } }
                 enqueueChatImageJob({ type: "chat-image", kind, messageId, userId })
                 return { success, pendingImage: { kind, messageId, leadIn } }
```

If enqueueing fails, set the assistant message to `status: "error"` and content to `${leadIn}\n\n⚠️ I couldn't start the image: …`, and return that as a normal answer.

**Hook points:**

- **`src/app/api/projects/ask/route.js`:**
  - Relax the `!question` 400 check (around line 104) to `!question && !attachmentIds.length`.
  - Right after the user `projectMessage.create` (around line 159), and **before** the unselected-document checks and the "No documents found" early return (around line 244): bind the attachments.
  - If `question` is empty and nothing was bound, mark the message `error` and return `{ success: false, error: "The attached images could not be found. Please attach them again." }`.
  - Then call `runImageTurn` with `docIds` set to the selected documents. A non-null result is returned as-is.
  - This also covers follow-ups with no new attachments.
- **`src/app/api/documents/[id]/ask/route.js`:** same as project chat:
  - Relax the check at line 44.
  - Hook in right after the user `message.create` (line 105) and **before** chunk loading and missing-embedding regeneration (line 115). Image turns must not pay for that.
  - Use `docIds: [documentId]`.
  - Return `conversationId` too, as the route already does for normal answers.
  - Note: this route only accepts `selected: 1` documents, which is existing behaviour; keep it.

### 4. Worker: `worker/processChatImage.js` + loop changes

`processChatImageJob({ kind, messageId, userId })`:
1. Load the message. If its status isn't `generating`, stop (it was cancelled or is a duplicate delivery).
2. `openai = getOpenAIForUser(userId)`. Add this beside `getOpenAIForDocument` in `src/lib/openaiForDocument.js`, using the same key lookup and a `timeout: 120_000`. Load the input attachments and read the buffers from S3.
3. `setProgress(text)` updates `imageProgress`, but only while the status is still `generating`. If the message was cancelled, it throws a sentinel that the job catches silently.
4. **Generate:**
   - `setProgress("Reading the charts…")`, then `buildImagePrompt`.
   - If there is `documentContext`, run `addDocumentFactsToPrompt`.
   - `setProgress("Creating the image… this can take up to a minute")`, then `generateCheckedImage({ …, onStatus: setProgress })`.
   - Store the result: upload the PNG to `chat/{userId}/{kind}/{uuid}.png`, and create a `ChatAttachment` (`direction: "output"`, `messageId`, `generationJson: { prompt, size, quality, inputAttachmentIds }`).
5. **Improve:** `generateImageFromImages({ prompt: source.generationJson.prompt, size, quality })`, then store with `generationJson: { ...source.generationJson, quality, improvedFrom: sourceAttachmentId }`.
6. Re-check for cancellation before storing. Then update the message: `status: "done"`, `imageProgress: null`, `imageJobJson: null`.
7. **On error:** set `status: "error"` and `content = ${leadIn}\n\n⚠️ ${friendlyImageError(err)}`. This matches the desktop's error message. For improve, `content` stays and the error is surfaced through the poll as `error`. The job **never throws**. Add `"chat-image"` to the `recordJobFailure` exclusion list with the usual comment (it is keyed by `messageId`, not `docId`). Also handle a watchdog timeout there by setting the message to `error`, like the `slide-*` jobs do.

Loop: refactor `mainLoop` into `pollLoop(queueUrl, label)` and run `Promise.all([pollLoop(QUEUE_URL, "main"), CHAT_QUEUE_URL && pollLoop(CHAT_QUEUE_URL, "chat")])`. Each loop keeps its own one-message-at-a-time semantics and watchdog. Register `if (job.type === "chat-image") return processChatImageJob(job);` in `processJob`.

**Deploy:**
- Create the SQS queue: visibility timeout 600 s, the same DLQ policy as the main queue.
- Add `SQS_CHAT_QUEUE_URL` to the EC2 worker `.env` and to Vercel.
- Add the S3 lifecycle rule (decision 13).

### 5. History, clear and delete

- **`projects/messages/[projectId]`:** add `status`, `imageProgress` and `attachments` (via `attachmentsByMessage("project", ids)`) to the mapping.
- **`documents/messages/[conversationId]`:** it returns raw rows. Add `attachments` per row.
- **`projects/clear` and `documents/[id]/clear-conversation`:** collect the message ids first, then `deleteAttachmentsForMessages`, then delete the messages.
- **`documents/[id]` DELETE** (around line 152): delete the attachments of `message where conversation.documentId = id` inside the existing transaction ordering; do the S3 cleanup after commit, as for figures and slide images.
- **`projects/[id]` DELETE** (around lines 140 and 168): the same for document chats and the project chat.

---

## Frontend implementation

### Files

| New / changed file | Source |
|---|---|
| `src/components/ui/ImageViewerModal.jsx` (new) | Copy of desktop. Replace the two `window.api?.saveImageAs` / `copyImageToClipboard` uses with `chatImagesApi`. Show Copy only when `navigator.clipboard?.write` exists. |
| `src/components/chat/ChatImages.jsx` (new) | Copy of desktop. The only change is the viewer import path. |
| `src/components/chat/useChatImages.js` (new) | Copy of desktop. `window.api.*` → `chatImagesApi.*`, and `messageTable` → `kind` ("project" / "document"). |
| `src/lib/chatImagesApi.js` (new) | The shim (decision 3). See below. |
| `src/components/chat/useChatEngine.js` | `pendingImage` support (below). |
| `src/components/chat/ChatInterface.jsx` | Same call-site changes as desktop `ChatInterface.jsx`, adapted to this file's `type` field. |
| `src/app/(app)/document/page.jsx` | Same call-site changes as desktop `src/app/document/page.jsx`. |

### `chatImagesApi.js`

- **`uploadChatAttachment({ messageTable: kind, filename, file })`** → presign → `fetch(url, { method: "POST", body: formData(fields + file) })` → `POST /api/chat-attachments`. The desktop hook passes an `ArrayBuffer`. The copied hook should pass the `File` it already has (`item.file`), so change the one line building `buffer`.
- **`improveChatImage({ attachmentId, quality, requestId })`** → `POST …/improve`, then poll `jobs/[messageId]` every 1.5 s until the status isn't `generating`. Resolve with `{ success, answer, attachments }`, or `{ success: false, error }`, or `{ cancelled: true }`. Keep a `requestId → { kind, messageId }` map so `cancelRequest(requestId)` can call the job cancel route; otherwise it falls back to `/api/cancel`.
- **`saveImageAs({ fileUrl, defaultName })`** → create an `<a href={fileUrl + "?download=1&name=" + …} download>` and click it. Return `{ success: true }`. The viewer's "Image saved" toast then shows as on desktop.
- **`copyImageToClipboard({ fileUrl })`** → `fetch(fileUrl)` → blob. If it isn't PNG, convert it via `createImageBitmap` → `OffscreenCanvas`/canvas → `toBlob("image/png")`. Then `navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])`. Return `{ success }` or `{ success: false, error }`.

### `useChatEngine.js`: generation progress with desktop visuals

Add an optional `pollImageJob` mechanism, handled like the existing `awaitingConfirmation`:
- If `ask` resolves with `res.pendingImage`:
  1. Keep `isTyping` true.
  2. Set `progress = { stage: "generating_image", leadIn: res.pendingImage.leadIn, status: "Reading the charts…" }`.
  3. Poll `GET /api/chat-images/jobs/[messageId]?kind=` every 1.5 s, updating `progress.status` from `progress`.
  4. On `done`, call `onResult({ success: true, answer, attachments, conversationId })`. On `error`, call `onResult` with the error content (it is a persisted assistant message, as on desktop). On `cancelled`, call nothing.
  5. Then run the usual finish.
- `cancelRequest` while polling → the job cancel route, then finish the turn.
- Expose `resumeImageJob({ kind, messageId, leadIn, progress })`. Callers invoke it after loading history if the last assistant message has `status === "generating"`, so a reload resumes the placeholder. Remove that message from the rendered list while resuming; the result replaces it.

The placeholder JSX in both chats is then copied verbatim from desktop:
- `progress?.stage === 'generating_image'` renders the lead-in bubble plus `<ImageGeneratingPlaceholder status={progress.status} />`
- it sits next to the existing `consulting_general_knowledge` branch

### Call sites (port of the desktop diff)

Mirror exactly what desktop `ChatInterface.jsx` and `document/page.jsx` do:
- **Hooks:**
  - `const composer = useComposerAttachments({ messageTable: "project" | "document", disabled: isTyping })`
  - `const imageActions = useChatImageActions({ projectId /* document chat: doc.projectId */, setMessages, mapAskResult /* or this file's result→message mapper */, onDocumentAdded })`
  - `canSend = !composer.isUploading && (text.trim() || composer.readyAttachments.length)`
- **`ask`** sends `attachmentIds: attachments.map(a => a.id)`. The optimistic user message carries `attachments`. Clear the composer after sending.
- **Result and history mappers** carry `attachments` (and `status`).
- **Rendering:**
  - `<MessageImageThumbs>` above the user bubble; the bubble is hidden when there's no text
  - `<GeneratedImage {...imageActions.generatedImageProps(img)} />` under assistant bubbles
  - for messages with images, use the full-width column class
  - `MessageActions` only when there is text
- **Composer:**
  - the chat area wrapper gets `relative` + `{...composer.dropHandlers}` + `<DropOverlay>`
  - the form gets `<ComposerAttachments>` above the input row and `<AttachButton>` left of the input
  - the input gets `onPaste={composer.handlePaste}` and the dynamic placeholder
- **Modals:** `<ChatImageViewer actions={imageActions} />` next to `ExpandedMessageModal`.
- **Project chat refresh:** `onDocumentAdded` refreshes the project's document list (the parent's existing loader), as desktop `project/page.jsx` passes `loadDocuments`.
- **Field-name difference:** project chat here uses `type: 'user' | 'assistant'` where desktop uses `role`. Adapt the conditions; don't rename the field.

---

## Verification plan

1. **Unit-level:** port the desktop's routing checks as a small script against the real API (dev key). For two charts already in the conversation, it must route:
   - "What was Q3 revenue?" → `answer_image`
   - "Summarise the key risks in the annual report" → `documents`
   - "Does the Q4 revenue in this chart match what the annual report says?" → `answer_image` + `use_documents`
   - "make the revenue bars green" → `generate_image`
2. **End-to-end (dev, ElasticMQ + local worker):** use the four test charts from desktop `mytextdigest/temp/chat_image_test/`. Pair 1 is two bar charts in $M; pair 2 is a $M bar chart plus a line chart in thousands.
   1. Attach pair 1 → "Combine them into a slide."
      - The lead-in appears within ~5 s.
      - The status line steps through the stages.
      - The image arrives in ~20–25 s.
      - All 8 values, axes and titles are correct.
      - The badge says Quick draft.
   2. Without re-uploading: "Can you now combine the graphs together into one graph?"
      - The planner picks the original charts, not the slide.
      - A grouped chart is produced.
   3. Pair 2 → merge → a dual-axis chart with all 12 values.
   4. Improve → High detail → "Redrawing in High detail…" → a new message with the "High detail" badge. The menu no longer offers anything for it.
   5. Cancel mid-generation:
      - The placeholder goes away.
      - No image is stored.
      - The message shows as cancelled after a reload.
   6. Reload mid-generation → the placeholder resumes and the image lands.
   7. Viewer:
      - wheel zoom at the cursor, pan, double-click, % → actual size, fit
      - arrows across a multi-image user message
      - Download saves a PNG
      - Copy pastes into another app
      - Esc and a backdrop click close it, but a click on the image does not
   8. Save to project:
      - from the card and from the viewer
      - the document appears in the project and is processed (caption / tables)
      - a second click is a no-op
      - over the storage limit → error shown under the card
   9. Document chat: steps 1, 2 and 4, plus "does this chart match the report" using only that document.
   10. Clear chat, delete document, delete project → the `ChatAttachment` rows are gone and the S3 keys are deleted. A staged-but-removed upload is deleted immediately; a staged-but-abandoned one is swept.
   11. Security:
       - another user's attachment id returns 404 on `file`, `improve`, `save-to-project` and `DELETE`
       - a presign key outside `chat/{userId}/staged/` is rejected on register
       - binding a project-chat upload in document chat is ignored
3. **Queue isolation:** upload a large PDF and immediately run an image turn. The image must not wait for ingestion (separate loop).
4. **Phase 0:** the slide image generate route and deck hero images work on `gpt-image-2`.
