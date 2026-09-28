# Automatic Table Extraction — Implementation Spec (Cloud/SaaS)

## Purpose

This spec ports **Automatic Table Extraction** from the desktop Electron app (`mytextdigest`) to this codebase. The port includes the v2 extension, **tables from images**. Follow it as the source of truth.

The desktop feature:
- finds every data table in an uploaded document: text PDFs, DOCX, spreadsheets, scanned PDF pages, uploaded images, and table pictures pasted inside PDF/DOCX files
- turns each one into clean, editable, exportable data
- makes tables first-class in chat: exact numbers in context, cross-document table comparison, charts from exact rows
- feeds the Compare view and the Knowledge Graph

**The UI and UX must match the desktop exactly**: same tabs, labels, badges, banners, empty states, colours, buttons and order of actions. The desktop components are copied, not redesigned. Everything that differs is backend plumbing, and each difference is called out below with the desktop file it replaces.

Desktop references (read these; they are the design record):
- `mytextdigest/docs/AUTOMATIC_TABLE_EXTRACTION_REQUIREMENTS.md`: FRs, acceptance criteria, v2 goals.
- `mytextdigest/docs/AUTOMATIC_TABLE_EXTRACTION_IMPLEMENTATION_PLAN.md`: module design (§4) and the canonical table JSON (§2). §13 (as built, v1) and §14 (as built, tables from images) record deviations from the original plan. **§13 and §14 win over earlier sections.**
- Code:
  - `mytextdigest/electron/tables/**`: pure logic, with 50 `node:test` tests in `__tests__/`
  - `mytextdigest/src/components/tables/**`: UI
  - wiring in `mytextdigest/electron/main.js`: search for `--- Automatic Table Extraction pipeline ---` and the `list-tables` … `compare-tables` IPC handlers

As with every earlier port, the frontend is the close-parity part and the backend diverges. This repo has:
- no in-process background work: an SQS job queue and a long-lived `worker/` process instead
- no `sharp` or `canvas`: `pngjs`, `jpeg-js` and pdfjs pixel data instead
- no filesystem or native dialogs: S3 and HTTP downloads instead
- no IPC events: polling instead
- no pgvector: brute-force cosine similarity over `Chunk.embedding`, as today

## What ships

Parity with the desktop:

1. **Tables tab** on the document page, next to Figures, for PDF, DOCX, XLSX/XLS/CSV and image documents (JPG, PNG, WebP, GIF, BMP). It shows "N tables found" and a list. Each row has:
   - title, page or sheet, rows × cols
   - badges: Edited, Low confidence, a yellow warning icon for grounding issues, and an image icon for tables read from pictures

   Clicking a row opens the **table viewer**, which has:
   - inline-editable title and description
   - a Table / As extracted / Analyze toggle
   - actions: Edit, Clean up ▾, Export ▾, Copy, Ask, Show in document, Delete
   - the yellow "could not be matched" banner
   - the "Read by AI from a scanned page / image / embedded image" note, with a **Show image** toggle
   - wavy yellow underlines on unconfirmed values
2. **Clean and edit**: header promotion, unit and period inference, total and section rows, a type per column. Actions are transpose, promote header, set type or unit, remove rows or columns, and set row kind. Cell editing supports Save, Cancel and Reset to extracted. Edits are never overwritten by a re-extract.
3. **Export**: CSV, XLSX, Markdown and JSON per table, and "Export all" as one XLSX workbook per document. **Copy** puts TSV on the clipboard.
4. **Analyze**: an instant chart from the table's exact cells, using the existing `ChartMessage`, with column pickers and per-column statistics.
5. **Chat**:
   - Retrieved table chunks expand into exact table blocks in the context.
   - The `find_tables` and `compare_tables` tools are available.
   - A **derived table card** in the reply shows a sortable cross-document table with warnings, sources and export.
   - Table citation chips appear under answers.
   - Charts are built from exact table rows.
6. **Project → Tables tab** in project chat (next to Graph and Comparisons). It lists every table in the project with search. Selecting two tables and clicking "Compare tables" shows a derived table card in a modal.
7. **Compare view → Tables mode**: a fourth mode in the existing Findings / Document / Insight toggle. It shows the matched tables of the two documents with exact value deltas.
8. **Knowledge Graph**: table values enter the graph as exact metric facts (`toFacts`), not as LLM-extracted guesses.
9. **Tables from images (v2)**:
   - scanned PDF pages, read by a vision model after a free OCR pre-screen
   - uploaded images
   - table pictures inside PDF/DOCX, read after figure captioning

   Every number is checked against Tesseract OCR of the same image. A table with too few confirmed values is dropped; unconfirmed values are underlined. When a PDF has more scanned pages than the automatic cap, the Tables tab shows a **"Check remaining pages"** banner with a cost estimate and a confirm step.
10. **Document card / upload toast**: "· N tables" once tables are found (desktop `DocumentCard.jsx:136`, `:304`).

## Locked-in decisions (do not relitigate)

1. **Copy the desktop logic and UI. Do not rewrite them.**
   - `electron/tables/**` becomes `src/lib/tables/**`, converted from CommonJS to ESM. The algorithms, thresholds and comments stay the same.
   - `src/components/tables/**` is copied verbatim. The only change is replacing `window.api.X(...)` with `tablesApi.X(...)`; see decision 3.
   - The 50 desktop tests come along and must pass unchanged, apart from the ESM import syntax. If a test fails after porting, the port is wrong, not the test.
2. **Pure modules live in `src/lib/tables/`** so both the worker and API routes import them. This follows the precedent of `src/lib/figureChunk.js` and `compareAlignment.js`, which the worker already imports via `../src/lib/...`.
   - API routes use `clean.js`, `schema.js`, `derive.js`, `serialize.js`, `export.js` and `stats.js`, for edits, compare-tables, export and stats.
   - The worker uses everything.
3. **UI parity through a client shim.** Add `src/lib/tablesApi.js`, which exports the same method names and return shapes as desktop `preload.js`: `listTables`, `getTable`, `updateTable`, `applyTableAction`, `resetTable`, `deleteTable`, `extractTables`, `extractScannedTables`, `exportTable`, `exportAllTables`, `copyTable`, `getTableStats`, `listProjectTables`, `compareTables`, `getDerivedTable` and `exportDerivedTable`.
   - Each method `fetch`es the matching route and returns `{ success, ... }` exactly like the IPC handler.
   - Components then differ from the desktop by an import line only. Future desktop UI changes port by diff.
4. **Events become polling.** Desktop components subscribe to `onTableExtractionUpdate`. Replace that with `tablesApi.onTableExtractionUpdate(docId, cb)`, a small poller:
   - It polls `GET /api/documents/:id/tables` every 3 s while `log.status === 'running'` or `log.visionJson.progress` is set, and stops otherwise. The interval matches `FiguresGallery.jsx`'s `POLL_INTERVAL_MS`.
   - It calls `cb` with the same payload shape: `{ docId, status, tablesFound, done, total }`.
   - It returns an unsubscribe function, so `TablesView.jsx` stays unchanged.
   - The worker writes progress to `TableExtractionLog.visionJson.progress = { done, total }` instead of broadcasting it.
5. **Table extraction is a non-blocking forked stage, like figures.**
   - It never touches `Document.status`.
   - Every table job type is added to `recordJobFailure`'s exclusion list (`worker/index.js`, next to `"figures"`).
   - Each job catches its own errors onto `TableExtractionLog.status/errorMessage`, as `processFigureJob` and `processCompareJob` do.
6. **Small jobs, not one big job.** The worker's watchdog is 8 minutes (`JOB_TIMEOUT_MS`), and OCR plus vision take seconds per page. Scanned pages are therefore processed in batches of **8 pages per SQS message**. Each batch job enqueues the next batch, following the `graph-batch` self-chaining precedent. Automatic runs stop at the desktop caps; see decision 9.
7. **Numbers are never invented.** These are the desktop grounding rules, unchanged:
   - `verify.js` checks every layer.
   - All arithmetic happens in `derive.js`.
   - LLM repair can only regroup source tokens.
   - Vision output is checked against OCR (`vision/read.js groundVisionGrid`, `VISION_MIN_GROUNDED = 0.5`).
   - The narrative is written only from the derived table.
8. **No `sharp` or `canvas`.**
   - Image preprocessing (grayscale, Otsu threshold, ruling-line erase, upscale, downscale, PNG encode) is reimplemented in pure JS on `pngjs` and `jpeg-js`, in `src/lib/tables/vision/imageOps.js`. The algorithm is the one in desktop `vision/render.js`: `otsu`, `eraseRuns`, and the `cleanForOcr` thresholds `max(70, 5% width)` and `max(70, 3% height)`. Only the pixel I/O changes. **Do not skip the line erase**: without it Tesseract garbles bordered tables and they are never confirmed. The desktop hit exactly this.
   - Scanned PDF pages are rasterised with the existing `worker/runOcr.js` technique: the largest image XObject per page from pdfjs `page.objs`, then `pixelDataToPngBuffer`, not canvas rendering. Pages with no raster image (vector-only, no text) are skipped and counted as checked. This is a documented limitation.
   - WebP, GIF and BMP uploads, which have no pure-JS decoder here, skip preprocessing. The original buffer goes to Tesseract, which decodes them, and to the model, matching today's upload path.
9. **Cost controls are the desktop's.**
   - Uploaded images always get one vision call.
   - Scanned pages are pre-screened free by OCR, using `looksTabular`.
   - Automatic caps: `VISION_AUTO_MAX_PAGES = 25`, `VISION_AUTO_MAX_CALLS = 12` and `VISION_AUTO_MAX_FIGURES = 15`.
   - Anything beyond the caps waits for "Check remaining pages". The cost estimate is `VISION_COST_PER_CALL_USD = 0.015` per pending page, and an on-demand run reads at most 300 pages.
   - The model is `gpt-4o`, via `getOpenAIForDocument(docId)` so the user's own key is used when they set one.
10. **Settings are per-user `Setting` rows**, with the same keys as desktop: `tables_enabled`, `tables_llm_enabled` and `tables_vision_enabled`. All default to on when the row is absent. There is no settings UI, as on desktop.
11. **Table chunks are retrieval-only.** They must be excluded wherever the desktop excludes them:
    - summarisation (`processSummarizationJob` maps summaries by `chunkIndex` position)
    - graph LLM extraction (`processGraph.js`)
    - comparison text alignment (`compareWorker.js loadChunks`)
    - re-embedding in `processEmbeddingJob`

    Filter with `tableId: null`. Table values reach the graph through `toFacts` and the comparison through table pairs.
12. **`Chunk.tableId` is a real column, not `metadata.tableId`.** Cascade deletes and "which table is this chunk" lookups run on every chat answer. This deliberately deviates from the figures port, which uses `metadata`.
13. **Deleting a figure keeps its table** and sets `DocumentTable.figureId` to null, as on desktop.

## Desktop → SaaS mapping

| Concern | Desktop | SaaS |
|---|---|---|
| Pure logic | `electron/tables/**` (CJS) | `src/lib/tables/**` (ESM, same file names) |
| Inputs | `extractTables(filename, filePath)` reads with `fs` | `extractTables(filename, buffer)`. Change `openPdf`, `extractDocxTables`, `extractSpreadsheetTables` and `readImageFile` to take buffers. Nothing else changes |
| Orchestration | `runTableExtraction`, `extractFigureTablesInBackground`, `extractRemainingScannedTables` in `main.js` | `worker/processTables.js`: job types `tables`, `tables-scan`, `tables-figures`, `tables-reembed` |
| Per-doc serialisation | `queueTableJob` promise chain | One message at a time per worker loop, plus `@@unique([documentId, tableIndex])`. Allocate the index inside a transaction |
| Storage | SQLite `document_tables`, `table_extraction_log`, `derived_tables` | Prisma `DocumentTable`, `TableExtractionLog`, `DerivedTable` |
| Events | `table-extraction-update` IPC | Polling (decision 4) |
| IPC handlers | `ipcMain.handle("list-tables" …)` | Route handlers under `src/app/api/documents/[id]/tables/…`, `src/app/api/tables/[tableId]/…`, `src/app/api/projects/[id]/tables/…` |
| Export | `dialog.showSaveDialog` + `fs.writeFileSync` | Route returns the file with `Content-Disposition: attachment`; the shim triggers a blob download |
| Copy | `clipboard.writeText` in main | The route returns TSV; the shim calls `navigator.clipboard.writeText` |
| Source image | `file://` URL | `sourceImageUrl` is a signed S3 URL (`src/lib/s3SignedUrl.js`) of the `Figure.s3Key` or of the image document |
| PDF page jump | `PdfViewer` `jumpTo` prop (desktop) | Add the same `jumpTo` prop to `src/components/documents/PdfViewer.jsx`, ported from desktop |
| Image preprocessing | `sharp` + `canvas` | `imageOps.js` on `pngjs`/`jpeg-js`; page rasters from `runOcr.js` |
| Vector search | `vec_chunks` / cosine fallback | Cosine over `Chunk.embedding` (unchanged) |

## Data model

### Prisma schema migration (`prisma/migrations/<ts>_add_tables/`)

```prisma
model DocumentTable {
  id                 String    @id @default(cuid())
  documentId         String    @map("document_id")
  tableIndex         Int       @map("table_index")
  pageStart          Int?      @map("page_start")
  pageEnd            Int?      @map("page_end")
  sheetName          String?   @map("sheet_name")
  sourceType         String    @map("source_type") // docx_xml | pdf_text | spreadsheet | pdf_vision | image_vision | figure_vision
  title              String?
  titleSource        String?   @map("title_source") // caption | generated | sheet | user
  description        String?
  caption            String?
  confidence         Float?
  rowCount           Int?      @map("row_count")
  colCount           Int?      @map("col_count")
  rawJson            Json      @map("raw_json")
  cleanJson          Json?     @map("clean_json")
  editedJson         Json?     @map("edited_json")
  editedAt           DateTime? @map("edited_at")
  groundingIssues    Int       @default(0) @map("grounding_issues")
  signature          String?
  signatureEmbedding Json?     @map("signature_embedding")
  chunkId            String?   @map("chunk_id")
  figureId           String?   @map("figure_id") // no FK: deleting a figure keeps the table
  status             String    @default("ready")
  errorMessage       String?   @map("error_message")
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")
  document           Document  @relation(fields: [documentId], references: [id])

  @@unique([documentId, tableIndex])
  @@index([documentId])
}

model TableExtractionLog {
  documentId     String    @id @map("document_id")
  status         String    // running | ready | error | disabled
  tablesFound    Int       @default(0) @map("tables_found")
  candidatesSeen Int       @default(0) @map("candidates_seen")
  skippedLowConf Int       @default(0) @map("skipped_low_conf")
  skippedForCap  Int       @default(0) @map("skipped_for_cap")
  repairedByLlm  Int       @default(0) @map("repaired_by_llm")
  visionJson     Json?     @map("vision_json") // { scannedPages, checkedPages, calls, progress? }
  errorMessage   String?   @map("error_message")
  startedAt      DateTime  @default(now()) @map("started_at")
  completedAt    DateTime? @map("completed_at")
  document       Document  @relation(fields: [documentId], references: [id])
}

model DerivedTable {
  id             String   @id @default(cuid())
  projectId      String?  @map("project_id")
  documentId     String?  @map("document_id")
  kind           String   // compare | select
  title          String?
  requestJson    Json?    @map("request_json")
  tableJson      Json     @map("table_json")
  sourceTableIds String[] @map("source_table_ids") // Postgres text[]: cascade via `hasSome`
  warningsJson   Json?    @map("warnings_json")
  createdAt      DateTime @default(now()) @map("created_at")

  @@index([projectId])
}
```

Column additions:
- `Chunk.tableId String? @map("table_id")` with `@@index([tableId])`
- `Figure.tableScan String? @map("table_scan")`, one of `found | none | not-table | error`
- `Message.derivedTableId String?`, `Message.tableCitations Json?`
- `ProjectMessage.derivedTableId String?`, `ProjectMessage.tableCitations Json?`
- `DocumentComparison.tablePairsJson Json? @map("table_pairs_json")`
- back-relations on `Document`: `tables DocumentTable[]`, `tableExtractionLog TableExtractionLog?`

The JSON layers use the canonical shape from desktop plan §2, stored *expanded*: one cell per column, with `spanned` placeholders. Use `Json`, not `String`, so routes don't parse. Keep the effective-table rule `edited ?? clean ?? raw` (`schema.js effectiveTableOf`). Make it accept objects as well as strings, which it already does.

Table chunk index: `2_000_000 + tableIndex * 100 + part` (`config.CHUNK_INDEX_BASE`). This is cosmetic, and never read back by index; figures use `1_000_000`.

## Backend implementation

### `src/lib/tables/**`: the ported pure modules

Copy these one to one from `mytextdigest/electron/tables/`:
- `config.js`, `schema.js`, `clean.js`, `verify.js`, `repair.js`, `title.js`, `serialize.js`, `export.js`, `stats.js`, `match.js`, `align.js`, `derive.js`, `pairing.js`, `toFacts.js`, `queryTool.js`, `spreadsheet.js`, `index.js`
- `pdf/{textLayer,detect,structure,continuation,index}.js`
- `docx/docxTables.js`
- `vision/{prefilter,read,index,ocr}.js`

Changes allowed, and nothing else:
- `require` becomes `import` and `module.exports` becomes `export`.
- Buffer inputs replace file paths (see the mapping table).
- Add `MODEL_VISION = "gpt-4o"` and `MODEL_QA = "gpt-4o-mini"` to `config.js`. The desktop keeps these in `electron/config/models.js`, which has no counterpart here.
- **pdfjs version.** This repo has `pdfjs-dist@2.16`; the desktop has 3.11. `textLayer.js` uses `getTextContent`, `getOperatorList`, `OPS.constructPath/rectangle` and `Util.transform`, all present in 2.16. The one thing to verify is the argument layout of `constructPath` (`[ops, args, minMax]`), which the ruling-line reader depends on. Add a unit test on a ruled fixture PDF before relying on it.
- `vision/render.js` is **replaced** by:
  - `vision/imageOps.js`: pure-JS pixel operations (decision 8)
  - `vision/pageImages.js`: wraps `runOcr.js`'s page-image extraction as `pageImagePng(pdfBuffer, pageNumbers, onPage)`

  Refactor `extractPageImages` in `worker/runOcr.js` into a shared helper rather than copying it.
- `vision/ocr.js`: tesseract.js v7 is already a dependency. Keep `setParameters({ user_defined_dpi: "300", preserve_interword_spaces: "1" })` and the `blocks: true` output.

New dependency: `@xmldom/xmldom` (DOCX `w:tbl` parsing). `jszip`, `xlsx`, `pngjs`, `jpeg-js`, `tesseract.js` and `p-limit` are already present.

Tests: copy `__tests__/*.test.js` and `fixtures/` to `src/lib/tables/__tests__/`. Add the script `"test:tables": "node --test src/lib/tables/__tests__/"`. All 50 tests must pass before any wiring work starts.

### `worker/processTables.js`: new stage (replaces the desktop `main.js` orchestration)

Everything is wrapped so no error escapes, exactly like `processFigureJob`. Four job types:

**`tables`** `{ docId, s3Key, filename, projectId, userId, rerun? }`. Enqueue it from `processChunkJob` right after the `figures` enqueue (`worker/index.js`, the second `SendMessageCommand`), with the same payload fields. Steps (the desktop's `runTableExtraction`):
1. If the type is unsupported, or `tables_enabled` is off, upsert the log as `disabled` and return.
2. Upsert the log as `running` with zeroed counters and `visionJson: null`.
3. Download from S3, then `extractTables(filename, buffer)`. This step is pure.
4. If this is an **image**, and the LLM and vision settings are on: `readImageFile(openai, buffer)` gives vision candidates, finished with `finaliseTables`.
5. If this is a **PDF** with `stats.scannedPageNumbers`:
   - Write `visionJson.scannedPages`.
   - If vision is on, enqueue the first `tables-scan` batch with `auto: true`.
   - Otherwise leave the pages pending, and the banner explains that vision is off.
6. `finishTables(openai, [...textTables, ...imageTables])` runs repair and batched titles. On a `rerun`, carry user edits over with the desktop's `preserveEdits` key `${tableIndex}:${pageStart}:${sheetName}`.
7. Insert all rows in one transaction, allocating `tableIndex` from `max + 1`.
8. Set `tablesFound`, then embed (see below), then set the log to `ready`. When scan batches are still queued, the log stays `running` until the last batch finishes.

**`tables-scan`** `{ docId, s3Key, filename, pages, auto, remaining }`. Reads up to 8 pages with `readScannedPages`:
- `maxPages` is the batch size.
- `maxCalls` is what's left of `VISION_AUTO_MAX_CALLS` across batches when `auto`; track it in `visionJson.calls`.

Then it:
1. appends the results to `checkedPages`
2. writes `visionJson.progress = { done, total }`
3. inserts and titles the found tables
4. embeds them
5. enqueues the next batch from `remaining`

`auto` runs stop at the caps: the pages left over stay pending. The last batch clears `progress` and sets the log to `ready`.

**`tables-figures`** `{ docId }`. Enqueue it at the end of `processFigureJob`, after the `Promise.all` over captions and outside the per-figure try. Steps (the desktop's `extractFigureTablesInBackground`):
- Select figures with `status = 'ready'` and `tableScan = null`.
- Mark figures on `visionJson.scannedPages` as `not-table`.
- For the rest, run `readFigures(openai, figures)` with images fetched from S3 by `s3Key`.
- Write each outcome to `Figure.tableScan`, then insert, title and embed the tables with `figureId` set.

**`tables-reembed`** `{ tableId }`. Delete the table's chunks and re-run the embedding for that one table. Enqueue it from the edit, action, reset and rename routes. Duplicate messages are harmless, because the job always embeds the current state. This replaces the desktop's 1.5 s debounce.

**Embedding** (the desktop's `embedTableChunks`):
- For every non-spreadsheet table, create chunks from `toChunkTexts(...)` with `tableId` set, embed them, and store `DocumentTable.chunkId` as the first chunk.
- Every table, spreadsheets included, gets `signature` and `signatureEmbedding`, which `find_tables` and `compare_tables` use.
- Use `pLimit(5)` for embeddings.

Add every table job type to the `processJob` switch and to the `recordJobFailure` exclusion list, and update the comment block that explains those exclusions.

### API routes (the IPC surface, same names and shapes)

Every route checks ownership through the document or project `userId`, like the figures routes, and calls `requireActiveSubscriptionApi` where the sibling routes do.

| Route | Method | Desktop IPC |
|---|---|---|
| `/api/documents/[id]/tables` | GET | `list-tables`: summary rows, `log`, and `vision { scannedPages, pendingPages, estimatedCostUsd, enabled }` |
| `/api/documents/[id]/tables/extract` | POST | `extract-tables`: unlink and delete non-edited tables, reset `Figure.tableScan`, enqueue `tables {rerun:true}`. `tables-figures` is enqueued at the end of the re-run |
| `/api/documents/[id]/tables/extract-scanned` | POST | `extract-scanned-tables`: enqueue `tables-scan {auto:false}` over the pending pages |
| `/api/documents/[id]/tables/export` | GET | `export-all-tables`: an XLSX workbook |
| `/api/tables/[tableId]` | GET, PATCH, DELETE | `get-table` (adds `sourceImageUrl`), `update-table` (validate, then `recleanEdited`, then enqueue a re-embed), `delete-table` |
| `/api/tables/[tableId]/action` | POST | `apply-table-action` |
| `/api/tables/[tableId]/reset` | POST | `reset-table` |
| `/api/tables/[tableId]/export?format=` | GET | `export-table` |
| `/api/tables/[tableId]/tsv` | GET | `copy-table` |
| `/api/tables/[tableId]/stats` | GET | `get-table-stats` |
| `/api/projects/[id]/tables?q=` | GET | `list-project-tables` |
| `/api/projects/[id]/tables/compare` | POST | `compare-tables`: runs `derive`, saves a `DerivedTable`, returns it |
| `/api/derived-tables/[id]` | GET | `get-derived-table` |
| `/api/derived-tables/[id]/export?format=` | GET | `export-derived-table` |

These routes run pure `src/lib/tables` code only. Nothing here calls the vision model; that happens only in the worker.

### Cascade cleanup

Mirror the desktop's `removeTablesForDocument`, `removeTableChunks`, `removeDerivedTablesFor` and `deleteChunksAndReferences`:
- **`DELETE /api/documents/[id]`**, inside the existing transaction and before `tx.chunk.deleteMany`:
  1. Set `messages.derivedTableId` to null for derived tables whose `sourceTableIds hasSome` this document's table ids.
  2. Delete those derived tables.
  3. Delete `DocumentTable` rows, then `TableExtractionLog`.

  The existing `chunk.deleteMany` covers table chunks. Graph facts from `toFacts` hang off those chunks, so run the graph mention and relationship cleanup the route already does *before* the chunk delete.
- **`DELETE /api/projects/[id]`**: the same steps, per document, inside the project transaction.
- **Figure delete**: `updateMany({ where: { figureId }, data: { figureId: null } })`.
- **Re-extract and table delete**: delete the table's chunks, and the graph mentions and relationships that reference them, in one transaction. better-sqlite3 enforced this ordering on desktop, and Postgres foreign keys will enforce it here.

### Chat (`src/app/api/documents/[id]/ask/route.js`, `src/app/api/projects/ask/route.js`)

These are the desktop plan §7 changes, with the "as built" deviations in desktop plan §13:
1. **Table expansion.** After the cosine top-k, collect distinct `tableId`s from the top chunks, up to `MAX_TABLES_IN_CONTEXT` (3). Prepend `toContextBlock(effectiveTable)` under `TABLES (exact extracted data — prefer these numbers):`. Honour `pinnedTableId`, sent by the viewer's **Ask** button, as desktop `ask-document` does.
2. **Tools.** Add `FIND_TABLES_TOOL` and `COMPARE_TABLES_TOOL` (`src/lib/tables/queryTool.js`) next to the existing `GENERAL_KNOWLEDGE_TOOL` and `QUERY_KNOWLEDGE_GRAPH_TOOL`. Dispatch them the same way. `compare_tables` persists a `DerivedTable` and sets `derivedTableId` on the saved message.
3. **Charts.** When the question wants a chart and a table is in context or was derived, pass the exact rows (`serialize.toChartData`) as `extraData` to `generateChartSpec`. This works the same way the spreadsheet `chartExtraData` does today.
4. **Citations and persistence.** Save `tableCitations` (`[{ tableId, title, page, documentId }]`) and `derivedTableId` on `Message` and `ProjectMessage`. Return both from `/api/documents/messages/[conversationId]` and `/api/projects/messages/[projectId]`.

### Compare (`worker/compareWorker.js`) and Graph (`worker/processGraph.js`)

- **Compare.** After the text alignment, run `pairTables(tablesA, tablesB)` from `src/lib/tables/pairing.js` and store `DocumentComparison.tablePairsJson`. Exclude table chunks from `loadChunks` (decision 11).
- **Graph.** Exclude table chunks from `allChunks`. After extraction, add `tableToFacts` facts for each table, anchored on its chunk, as metric entities with exact values and `source = 'table'`, following the desktop wiring in `electron/graph/index.js`.

## Frontend implementation

Copy `mytextdigest/src/components/tables/*` into `src/components/tables/` **verbatim**. That is `TablesView`, `TableViewer`, `TableGrid`, `TableExportMenu`, `TableChartPanel`, `DerivedTableCard`, `ProjectTablesView`, `TablePairsView` and `tableFormat` (about 1,300 lines). Replace `window.api` with `tablesApi` (decision 3). Keep:
- the same yellow grounding banner and wavy yellow underline (red only for `total_mismatch`)
- the same amber "Check remaining pages" banner, with its two-step confirm
- the same image icon and "Show image" toggle
- the same empty-state copy

The UI primitives (`Button`, `Card`, `Modal`) and `cn` already exist with the same APIs.

Wiring, mirroring the desktop diffs:
- **`src/app/(app)/document/page.jsx`**:
  - Add `showTablesTab`: pdf, docx, xlsx, xls, csv, jpg, jpeg, png, webp, gif, bmp.
  - Add a tab button right after Figures, in the same button pattern as the existing tabs (lines ~898–935), with the count badge.
  - `activeTab === 'tables'` renders `<TablesView docId onAsk onShowInDocument onCountChange initialTableId>`.
  - Read `?tab=tables&table=` for deep links from derived-table sources.
  - Wire `onShowInDocument` to the new `PdfViewer jumpTo` prop.
- **`src/components/documents/PdfViewer.jsx`**: port the desktop `jumpTo` prop.
- **`src/components/chat/ChatInterface.jsx`** (project):
  - Add `'tables'` to `activeTab` alongside `'graph' | 'comparisons'`, with a **Tables** tab button in the same style, rendering `<ProjectTablesView projectId>`.
  - Render `<DerivedTableCard derivedTableId>` and `<TableCitationChips>` on messages, as the desktop `ChatInterface.jsx:348` does.
- **`ExpandedMessageModal.jsx`** and the document-page chat: the same card and chips (desktop `ExpandedMessageModal.jsx:206`, `document/page.jsx:26`).
- **`src/app/(app)/compare/page.jsx`**: add a `'tables'` value to `viewMode`, with a fourth toggle button in the existing group (lines ~557–590), rendering `<TablePairsView pairs={comparison.tablePairsJson}>`.
- **`DocumentCard.jsx`** and the project page: show "· N tables". Include `tablesFound` (from `TableExtractionLog`) in the documents list response. The project page's existing document poll picks it up, which replaces the desktop `onTableExtractionUpdate` listener.

## Delivery phases

| Phase | Scope | Exit check |
|---|---|---|
| 0 | Prisma migration, `src/lib/tables` port, `test:tables` | 50/50 tests pass, including a pdfjs 2.16 ruled-PDF test |
| 1 | `tables` job (text PDF, DOCX, spreadsheet), list/get routes, Tables tab (read-only), polling shim | Desktop golden fixtures show the same tables and titles in the UI |
| 2 | Edit, actions, reset, delete, re-extract with preserved edits, `tables-reembed` | An edit survives a re-extract; chat sees the edited value |
| 3 | Export, copy, stats, Analyze | XLSX opens in Excel with numeric cells; the chart matches the cells |
| 4 | Chat: expansion, tools, derived table card, citations, charts, Project Tables tab | Cross-document "revenue by region 2024 vs 2025" gives an exact derived table |
| 5 | Compare Tables mode, graph `toFacts`, cascades | Deleting a document removes its tables, derived tables and facts with no FK errors |
| 6 | Vision: `imageOps`, page images, `tables-scan`, `tables-figures`, image uploads, "Check remaining pages" | Every file in `mytextdigest/temp/test-docs/` gives the table counts listed in its `README.md` |

## Verification plan

1. **Unit.** `npm run test:tables`. Add an `imageOps` test that `eraseRuns` removes a 1 px ruled grid but keeps 25 px glyph strokes, and that its Otsu threshold matches `sharp`'s to within ±2 on a fixture.
2. **Golden parity with the desktop.** Run both pipelines on `mytextdigest/electron/tables/__tests__/fixtures/*` and compare the `raw_json` and `clean_json` per table. They must be identical for text sources.
3. **Vision parity.** Upload the five files in `mytextdigest/temp/test-docs/`:
   - the scanned bulletin gives 3 tables, and its cover page makes no vision call
   - each JPG gives 1 table
   - the memo PDF and DOCX each give 1 figure table

   Every table must have a header row and 21 or more rows. Confirm that a bordered table, such as Table 1 of the bulletin, is **kept**; this proves the line erase works without `sharp`.
4. **Cost caps.** Upload a PDF of 30 scanned pages or more. The auto run checks at most 25 pages and makes at most 12 calls, and the banner shows the pending count and the estimate. After confirming, the log shows batches of 8 and the progress text updates while it runs.
5. **Resilience.** Kill the worker in the middle of a `tables-scan` batch. SQS redelivers it, `Document.status` is unchanged, and re-running doesn't duplicate tables (unique index plus `checkedPages`).
6. **UX side by side.** Put the desktop and SaaS Tables tab, viewer, project Tables tab, derived card and Compare Tables mode next to each other on the same document. Labels, badges, colours, button order and empty states must match. Differences are bugs.
7. **Regression.**
   - Summaries, graph extraction and comparison alignment are unchanged for a document with tables, because table chunks are excluded.
   - Figures, spreadsheet chat and charts are unchanged.
