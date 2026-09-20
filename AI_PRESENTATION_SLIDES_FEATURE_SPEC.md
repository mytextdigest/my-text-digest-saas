# AI Presentation / Slides — Implementation Spec (Cloud/SaaS)

## Purpose

This document is the liaison spec for porting the desktop Electron app's slide
generation pipeline and WYSIWYG deck editor (`mytextdigest`) to this cloud/SaaS
codebase — by far the largest feature ported in this series (10,600+ lines across
generation, layout/rendering, and editor code on desktop). The desktop version is a
mature, twice-reworked feature (a "narrative roles / intent scoring / smarter image
generation" pass landed on top of an earlier version) with many specific, hard-won
fixes baked into prompts, validators, and UI mechanics via code comments — this spec
exists to carry all of those forward, not just the happy path. Follow this as the
source of truth; re-deriving this feature from a blank slate would silently drop most
of the fixes below.

**This is the single biggest architecture gap of any feature ported so far.** The
desktop app renders decks with `pptxgenjs` + `sharp` running natively in the Electron
main process, writes a real `.pptx` file to local disk, and lets the user Save via a
native OS dialog / reveal it in the file manager. None of that exists here. This repo
has **no `pptxgenjs`, no `sharp`, no filesystem, no native dialogs** — rendering must
move to the SQS worker (which already proves a `sharp`-free image pipeline in
`worker/runOcr.js`/`worker/extractFigures.js` — reuse those techniques, don't
reintroduce `sharp`), the artifact must live in S3, and "Save"/"Show in folder" must
become a browser download / be dropped entirely. Every divergence is called out below.

The editor's **rendering layer** (`SlideRenderer.jsx` and its primitives) and the
**theme/layout math** (`electron/slides/theme.js`'s constants) are the one part of this
feature that is genuinely framework-portable — pure React/CSS/math, zero Electron API
usage — and should port close to verbatim for UI parity ("uncanny" similarity, per the
explicit ask). The generation prompts, validators, and PPTX-specific rendering
(`layouts.js`) are portable *logic* that needs a new export target.

## What ships

- **Generation**: from a document's Slides tab, a brand-kit modal (logo/colors/
  presentation type/visual style/custom instructions/"remember brand"), then a
  two-step outline flow — plain-text outline review/edit, then AI structuring into the
  full typed slide schema — then a rendered deck.
- **Editor** (`/slides?deckId=...`, its own full-page route, no app chrome): a
  Canva-style WYSIWYG surface — select/edit template content fields and freeform
  overlay elements (text boxes, 12 shape kinds, images) via drag/resize/rotate,
  multi-select + marquee-select + align/distribute, undo/redo (50 steps, session-local),
  keyboard shortcuts, background/gradient editing, in-editor AI image generation
  (prompt + aspect ratio) or upload-your-own, element layering, palette switching
  (including "your brand" as a pinned option), whole-deck/single-slide AI free-text
  editing, a thumbnail rail with drag-to-reorder/duplicate/delete, and a fullscreen
  Present mode.
- **Download**: as a real, standards-compliant `.pptx` file — the actual deliverable
  users take out of the product, since this is a presentation tool.

**Out of scope** (matching the desktop version's own state):
- The "bespoke pipeline" (Presentation Director/Scene Graph/Scene Compiler) — that work
  exists only on the desktop repo's separate `bespoke-pipeline` git branch, not on its
  `main`. This spec ports what's actually shipped on desktop `main` (the
  template/layout-catalog pipeline described below), not the unmerged bespoke system.
- "Show in folder" — no web equivalent, drop entirely (see decision 12).

## Locked-in decisions (do not relitigate)

**1. Outline generation is a deliberate two-LLM-call flow, not one — this exists
specifically to stop human edits from corrupting structured data.** An earlier
single-call design generated the full typed JSON directly, mechanically flattened it to
text for review, and re-parsed a human's free-text edits back into that same rigid
schema — an edit that didn't match the flattening convention exactly silently produced
malformed data with no LLM in the loop to catch it. The fix, which must be preserved:
**Step 1** (`generateTextOutline`) asks for a loose `{title, slides:[{title, body}]}`
shape where `body` is lightweight Markdown (`- ` bullets, `**bold**`) — nothing here is
rigid enough for a human edit to break. The user reviews/edits this plain-text form.
**Step 2** (`generateStructuredOutline`), only after explicit user confirmation, takes
the *approved* prose and asks the model to pick `type`/`role`/palette/font/icons per
slide and reshape the body into the full typed schema. Do not collapse this back into
one call.

**2. Generation always reuses already-ingested chunks — never re-reads the raw file,
never a summary.** Both outline calls concatenate `Chunk.text` (ordered by
`chunkIndex`) with `\n\n`, truncated to `MAX_DOC_CHARS = 120000` chars, and send that
as the source material. This means slide generation has a hard dependency on chunking
having already completed — gate the "Generate Slides" action on `Document.status`
being past the chunking stage, same as chat/comparison/graph already implicitly assume.

**3. Structuring can never drop a slide, by construction — not by retry.** The
structuring call's response is validated per-slide (`validateStructuredSlide`); if a
given slide's response is missing, malformed, or the model swapped in a
content-light type (`title`/`section_header`/`quote`) despite the approved body having
real substantive content — **a confirmed real production bug where the model fabricated
a generic title card in place of a substantive slide** — the code falls back to
`buildFallbackSlide`: a deterministic, LLM-free conversion of the approved Markdown
body into a plain `bullets` slide (or `title` for slide 1 if its body is one line).
This guarantees `outline.slides.length === approved.slides.length` always, with **no
retry loop** for this failure class. There is also an index-misalignment guard (title
topic-overlap check) to catch the case where the model silently dropped an earlier
slide and shifted every later one up by one position — confirmed as the actual root
cause of a real "3 approved slides vanished" incident. Port both guards; a naive "if the
response array is short, just don't render those slides" implementation reintroduces
the exact bug this was built to close.

**4. A holistic word-count floor (`MIN_SLIDE_WORDS = 20`, summed across every text
field) replaces a series of one-off per-field content-thinness checks.** Each earlier
fix caught one specific field that could sneak thin content through; this closes the
whole class at once rather than adding a 5th, 6th, 7th special case. Keep it holistic,
not per-field, if extending validation further.

**5. Topic-redundancy dedup uses token-overlap (overlap coefficient, threshold 0.6),
not exact-string matching.** Two slides can legitimately re-tread the same topic with
different wording (e.g. "Two Deployment Models" vs. a later "Deployment Models" slide)
— exact-string dedup never caught real cases in practice. Deck-name tokens are excluded
from the comparison (the brand name legitimately recurs). Only one `section_header`
slide is kept per deck (the first).

**6. A "bullets" slide that's actually a metric list gets auto-converted to
`icon_list` in code, not by prompting alone.** `looksLikeMetricList` (≥75% of lines
match `"Label: <digit-containing value>"`) triggers `convertMetricBulletsToIconList` —
a metric list renders far better as full-width icon rows than a narrow bullet column,
and the prompt alone didn't reliably steer this. Applied only at outline/structuring
time, **not** inside the single-slide content validator (a metric list appearing mid-AI-edit
must not silently change `type`, since single-slide edits have their own hard rule that
`type` never changes — decision 9).

**7. Generation temperature is tuned per stage, not uniform — preserve the exact
values.** Fresh generation: `0.4` (explicit note: `0.7` caused inconsistent
rule-following across regenerations of the *same* document, given how rule-dense the
prompt is — 0.4 trades phrasing variety for reliability). Repair pass and structuring:
`0.3` (should faithfully apply/format, not creatively reinterpret). Whole-deck AI edit:
`0.4`. Single-slide edit: uses the same lower-temperature-for-fidelity reasoning.

**8. The repair pass and the structuring call are both deliberately never re-sent the
source document** — restricted to reorganizing/reformatting material already in the
draft/approved outline. This is a structural guarantee against fabrication (they
*cannot* invent a new fact not already present), not just a cost optimization; preserve
this even if it seems like sending the source again would "help."

**9. Single-slide AI edits can never change slide `type` or deck-wide color/palette/
font — enforced in the prompt AND in code.** If the model changes `type` anyway despite
the prompt's hard rule, the whole response is rejected (`return null`), not partially
applied. Color/palette/font changes always escalate to a whole-deck edit instead
(`detectColorIntent` — a cheap keyword heuristic mirroring `chartSpec.js`'s
`detectChartIntent` pattern already used elsewhere in this codebase) — a single slide
breaking from the deck's shared palette would undermine visual cohesion.

**10. Every AI edit (whole-deck or single-slide) must have the pre-edit slide's
freeform data merged back in afterward — an edit LLM never sees, and must never be
allowed to silently drop, a user's manual editor work.** After either edit call
returns, restore `elements`/`backgroundColor`/`layoutOverrides`/`heroImage` from the
**pre-edit** slide unconditionally, and restore `role` only if the edit response didn't
supply one (the edit LLM does see and may legitimately update `role`, unlike the
freeform fields it never sees at all). Skipping this merge step means an AI edit can
silently wipe out a hero image or manual background a user just set.

**11. An AI edit's failure must leave the deck in `status: "ready"`, not `"error"`.**
A failed edit never touches the last-good outline/rendered file, so
Download/Preview/Edit must stay fully usable afterward — reverting to `"error"` would
make an already-good deck appear broken for no reason.

**12. Native-only desktop features have no web equivalent and must be replaced, not
approximated.** "Save" (native `dialog.showSaveDialog` + `fs.copyFileSync`) becomes a
plain browser download of a server-generated file (S3 object streamed through a route
with `Content-Disposition: attachment`, or a signed S3 URL). "Show in folder"
(`shell.showItemInFolder`) has no substitute at all — drop the button entirely, don't
try to simulate it.

**13. PPTX export has no native gradient-fill support (confirmed via `pptxgenjs`'s own
type defs) — gradients must be rasterized to a PNG background image at export time,
cached by `angle:stopA:stopB`.** The desktop version does this via `sharp`+SVG. This
repo has no `sharp` — port the rasterization technique the Figures/Graph specs already
established for this codebase (`pngjs` + a manually-constructed pixel buffer, or an SVG
string rendered through a `sharp`-free library available in this repo's dependency
tree) rather than adding `sharp` as a new native-binary dependency purely for this one
code path.

**14. Icon rendering must be identical across PowerPoint/Keynote/LibreOffice regardless
of whether the viewer's machine has any particular icon font installed — icons are
rasterized to PNG at build time, never embedded as font glyphs.** Desktop does this via
`react-icons/lu` → `react-dom/server` SVG → `sharp`. Port the same **whitelist of ~57
Lucide icon names** (`electron/slides/icons.js`'s `ICONS`/`ICON_NAMES`) so the model can
only ever reference a known-good name (a hallucinated name silently degrades to "no
icon," never a crash), but rasterize via an `sharp`-free SVG→PNG path (matching decision
13's constraint) — a memory cache keyed `name:color:size` is still correct to keep,
these are static assets for the process lifetime.

**15. The font whitelist (7 fonts: Arial, Calibri, Cambria, Times New Roman, Courier
New, Bookman Old Style, Century Schoolbook) is a fidelity constraint, not an aesthetic
one.** These render true-to-width in LibreOffice-based rendering paths and ship with
Office; there is no automated per-deck visual QA in this pipeline (on desktop or in
this port), so an "unreliable" font is a real text-overflow risk, not just a preview
quirk. Do not expand this list without adding real overflow verification first.

**16. Structural visual decisions (card "shape" per presentation type — bold/warm/
plain/outline chrome, palette curation per type) are deterministic from
`presentationType` in code, never left to the LLM to choose.** This is a repeated
pattern in this codebase's design: push structural/visual decisions into code, keep the
LLM responsible only for content. Preserve `STYLE_BY_PRESENTATION_TYPE`/
`PALETTE_SUGGESTIONS_BY_PRESENTATION_TYPE` as data tables the renderer reads, not model
output.

**17. Undo/redo is session-local, in-memory, and scoped only to the freeform overlay +
slide deletion — not template content edits, not AI edits.** 50-entry stack, 500ms
same-key coalescing (so a continuous color-drag or keystroke burst collapses into one
undo entry). This narrower scope (vs. "undo everything") is intentional — it's the
manual, structurally-risky editing surface that benefits from undo; AI edits are
already non-destructive to the freeform layer (decision 10) and regenerable by
re-issuing the instruction.

**18. Every discrete freeform mutation persists to the server immediately on gesture-
end (drag/resize/rotate-end, color-picker mouseup, add/delete/duplicate) — no debounce
at that layer.** The only client-side batching is for **per-keystroke** edits (typing
into a font-size box, dragging inside a color picker), which update local React state
only and flush to the server on blur. Do not add a debounce to discrete gesture-end
actions; do not remove the blur-flush batching for continuous/keystroke input (removing
it would fire a full deck rebuild per keystroke).

## Data model

### Prisma schema migration

```prisma
model SlideDeck {
  id            String   @id @default(cuid())
  documentId    String   @map("document_id")
  title         String?
  theme         String?           // palette NAME, not hex
  slideCount    Int      @default(0) @map("slide_count")
  s3Key         String?  @map("s3_key")         // rendered .pptx object key, replaces file_path
  status        String   @default("generating")  // generating|outline_review|ready|error
  errorMessage  String?  @map("error_message")
  outlineJson   Json?    @map("outline_json")     // full structured outline, or transient plain-text shape during outline_review
  brandKitJson  Json?    @map("brand_kit_json")
  customPrompt  String?  @map("custom_prompt")
  createdAt     DateTime @default(now()) @map("created_at")

  document Document @relation(fields: [documentId], references: [id])

  @@index([documentId])
}

model SlideImage {
  id         String   @id @default(cuid())
  documentId String   @map("document_id")
  s3Key      String   @map("s3_key")
  width      Int?
  height     Int?
  format     String?
  source     String   @default("upload")  // "upload" | "generated"
  prompt     String?                       // only set when source = "generated"
  createdAt  DateTime @default(now()) @map("created_at")

  document Document @relation(fields: [documentId], references: [id])

  @@index([documentId])
}
```

Add `Document.slideDecks SlideDeck[]` and `Document.slideImages SlideImage[]` reverse
relations. Run `npx prisma migrate dev --name add_slides`.

Note what's deliberately **not** a DB column, mirroring the desktop schema exactly:
`outline.deckIntent` (presentationType/customPrompt/generateImages/visualStyle/
imageMode, normalized once at generation time) and `outline.brandKit` both live
*inside* `outlineJson`, not as separate columns — every operation that round-trips
`outlineJson` (reorder, edit, theme-swap, layout patch) carries them forward with zero
extra plumbing. Preserve this — do not hoist them into columns.

No S3-key equivalent table for AI-generated hero images (`slide.heroImage`) — those
live purely inside `outlineJson` per-slide, with their own S3 key under a
deck-scoped prefix (`slides/<deckId>/hero-<slideIndex>.png`), deleted wholesale with
the deck. This is distinct from `SlideImage` (document-scoped, user-facing
upload/generate pool for the Uploads panel — mirrors the existing `slides/<docId>`/
`figures/<docId>` S3 prefix convention established in
`FIGURE_AND_IMAGE_UNDERSTANDING_FEATURE_SPEC.md`'s decision 9).

## Backend implementation

### Porting the outline/validation/theme logic — new `src/lib/slides/` modules

Port these near-verbatim from `electron/slides/*.js` — they are pure prompt-building,
JSON validation, and data-table logic with no Electron/SQLite API usage (only the DB
read/write call sites at the edges change from `better-sqlite3` to Prisma):

- **`src/lib/slides/outline.js`** — ported from `electron/slides/outline.js` (1420
  lines, the core orchestrator). Port verbatim: `SLIDE_TYPES` (16 types),
  `SLIDE_ROLES` (12 narrative roles, independent of `type` — decision 16's sibling
  concept), all per-type length/count caps and their reasoning comments,
  `buildSlideTypeSchema`, `PRESENTATION_TYPE_FRAMING` (per-type narrative arcs,
  including pitch-deck's hard rule that security/governance/compliance detail never
  gets a standalone slide), `buildContentDepthRules`, `buildTextOutlinePrompt` (Step
  1), `buildStructurePrompt` (Step 2, injecting `VISUAL_STYLE_GUIDANCE` and
  `customPrompt`), `validateSlide`/`validateOutline` (decisions 4–5),
  `applyMetricListBackstop` (decision 6), `validateStructuredSlide`/
  `validateStructuredOutline`/`buildFallbackSlide` (decision 3),
  `generateStructuredOutline`, `buildDeckIntent` (`IMAGE_MODES = ["important", "none",
  "manual"]`). Drop (or keep only as dead code, matching desktop's own apparent state)
  `buildOutlinePrompt`/`generateOutline`, the single-call legacy path — confirm with
  the current desktop `main.js` wiring that only the two-step flow is actually called
  before deciding; do not wire a legacy path this port doesn't need.
- **`src/lib/slides/content.js`** — ported from `electron/slides/content.js` (123
  lines): `EDITABLE_FIELDS_BY_TYPE`, `sanitizeField`/`sanitizeItem`/`sanitizeTable`
  (length/shape caps only, never rejects for thinness — this is the human-direct-edit
  path, deliberately more permissive than AI-generation validation),
  `validateContentPatch`.
- **`src/lib/slides/theme.js`** — ported from `electron/slides/theme.js` (222 lines):
  `PALETTES` (10 named), `FONT_PAIRS` (8, decision 15's whitelist),
  `PALETTE_SUGGESTIONS_BY_PRESENTATION_TYPE`, `HERO_IMAGE_PANEL_W = 4.3`,
  `STYLE_BY_PRESENTATION_TYPE`/`getStyle` (decision 16), `ensureReadableOnLight`/
  `rotatingColor` (near-white palette values blended toward black when used as a mark,
  not just text), `resolveTheme(paletteName, fontPairName, customPalette)`. **This file
  must be importable from both the worker (server-side render) and the frontend
  (live-preview render)** — put it somewhere both can reach (e.g. `src/lib/slides/theme.js`
  imported by both `worker/` via a relative path and by client components), matching
  how the desktop app has both `SlideDeckEditor.jsx`/`SlideRenderer.jsx` import the
  *same* `electron/slides/theme.js` file the export pipeline uses, specifically so
  in-app preview and exported `.pptx` never silently drift apart (a confirmed desktop
  bug before this sharing was set up: presentation-type chrome only ever showed in the
  export, never the live preview).
- **`src/lib/slides/elements.js`** — ported from `electron/slides/elements.js` (248
  lines): `KINDS` (14, including the 12-shape catalog), `validateElement` (per-kind
  whitelist, clamps to slide bounds, drops unusable ones — `image` kind drops rather
  than substitutes on a bad `src`), `validateBackgroundColor`, `validateLayoutOverrides`
  (per-field-path position/style overrides, intentionally not checked against whether
  the field still exists), `validateHeroImage`. Note **`src:` must become an S3 URL
  check, not a `file://` check** — this is the one place the validator's shape check
  needs an actual change, not just a verbatim port.
- **`src/lib/slides/intent.js`** — ported from `electron/slides/intent.js` (108
  lines): `scoreDeckAgainstIntent` — diagnostics-only (logged, never gates/retries
  generation), port as-is including the explicit non-decision to build a "repair on low
  score" pass (still out of scope here too).
- **`src/lib/slides/edit.js`** — ported from `electron/slides/edit.js` (194 lines):
  `buildWholeDeckEditPrompt`/`generateWholeDeckEdit` (decision 1's Step-2-shaped full
  re-send), `buildSlideEditPrompt`/`generateSlideEdit` (decision 9's hard
  type/color/font-change rejection, enforced again in code not just the prompt),
  `detectColorIntent` (decision 9's escalation heuristic).
- **`src/lib/slides/icons.js`** — ported from `electron/slides/icons.js` (131 lines),
  **adapted per decision 14**: same `ICONS`/`ICON_NAMES` whitelist (~57 Lucide names),
  same per-`name:color:size` memory cache, but swap the `sharp`-based rasterization for
  an `sharp`-free SVG→PNG technique consistent with this repo's existing
  `worker/imageUtils.js` (`pixelDataToPngBuffer` + `pngjs`, established in the Figures
  spec) — render the Lucide SVG string, rasterize via whatever headless-SVG-to-pixels
  path this repo's dependency tree supports without adding a `sharp`/`canvas` native
  binary.

### `src/lib/slides/imagePrompt.js` — ported with API call preserved exactly

Port `electron/slides/imagePrompt.js` (207 lines) verbatim — model call
(`openai.images.generate({model: "gpt-image-1", size, quality: "medium", n: 1})`,
base64 PNG response), `GENERATE_IMAGE_SIZES`, `IMAGE_ELIGIBLE_TYPES`/
`IMAGE_CAPABLE_TYPES` (decision on which slide types get automatic vs. manual-only
images — `chart` deliberately excluded from both, no shrink-to-fit exists for a
narrowed chart), `buildImagePrompt` including:
- **`buildDeckSubjectLine`** — reuses the deck's own title-slide subtitle as shared
  grounding context for thin-text hero slides (section_header/closing/quote) only,
  **never** for `title` itself or content-bearing types (folding it into every prompt
  previously made every image converge on the same motif — confirmed client
  feedback). Port this exact scoping.
- **`allowPeople`/`pickPeopleAllowedIndices`** — caps people to ~25% of a deck's
  generated images (quote slides get first claim), constrains expression to "calm and
  neutral... documentary-style" rather than banning people outright — a confirmed fix
  for `gpt-image-1`'s default tendency toward "uncanny" theatrically-engaged business-
  photo expressions. Port verbatim, including the ~25% figure.
- `buildOnDemandImagePrompt` — the separate in-editor "Generate" tab flow, where the
  user's typed prompt IS the subject (slide/deck/palette context are optional additive
  grounding via a checkbox, never overriding the user's own prompt).

### `src/lib/slides/layouts.js` — rendering logic, target changes from `pptxgenjs` to whatever this port's PPTX writer is

This is the one module whose **implementation**, not just its call signature, must
change, since it currently emits `pptxgenjs` API calls directly. Port the **decisions**
(one builder per slide type dispatched by exact `type` string match via a
`LAYOUT_BUILDERS` map — 16 entries; `buildDeck.js` throws loudly, never silently
continues, if a type has no registered builder — decision below; shared plumbing:
`resolveBox` merging `layoutOverrides` onto default geometry, `addBackground`
resolving solid/gradient background + contrast text color, `fitFontSize` shrink-to-fit
safety net, `applyFreeformElements` drawing the elements[] overlay last,
`drawHeroImage` as a **dedicated rendering field, not a freeform element** — it must
draw *before* title/subtitle text and that text must be narrowed by
`HERO_IMAGE_PANEL_W`, confirmed necessary after a real bug where long text wrapped
underneath and got covered by the image when this was attempted via the elements[]
approach) against **`pptxgenjs`, which remains the correct choice** — add it as a
worker-side dependency (it's pure JS, no native binary, runs fine in a Node worker
process; it was never the source of the `sharp` dependency problem). Port the anti-
pattern rules verbatim too (never a decorative color-bar/accent-stripe — "an explicit
AI-generated-slide tell"; hex colors never `#`-prefixed in `pptxgenjs` calls;
`bullet: true` never a literal bullet character; a fresh shadow object per shape call,
since `pptxgenjs` mutates objects in place; the chart-color-cycling-on-single-series
bug needing the same `ensureReadableOnLight` guard as theme.js).

### `src/lib/slides/buildDeck.js` — target output changes from local file to S3

Port `buildDeck(outline)` from `electron/slides/buildDeck.js` (83 lines) with the
final step changed: instead of `pres.writeFile({ fileName: filePath })` (local disk),
use `pptxgenjs`'s `pres.write("nodebuffer")` (or equivalent buffer-output API) and
upload the resulting buffer to S3 at a key like
`` `decks/${userId}/${projectId}/${docId}/${deckId}.pptx` ``, storing the key on
`SlideDeck.s3Key`. Preserve: `pres.layout = "LAYOUT_WIDE"`; theme resolved via
`resolveTheme(outline.paletteName, outline.fontPairName, brandKit?.colors)`;
`outline.presentationType` set on `theme` **unconditionally** (not nested inside a
logo-present check); slides rendered **sequentially, not `Promise.all`** (order must
match, and per-slide rendering is cheap enough that parallelizing buys little);
**throws loudly on an unregistered slide type** (decision, no silent `continue`);
brand-kit logo drawn on every slide uniformly, outside any per-type builder.

### Worker jobs — this port's biggest architectural decision

Every desktop IPC handler that runs `buildDeck()` inline (theme swap, reorder,
duplicate, delete slide, layout-patch, content-patch) does so **synchronously,
awaited, inside the handler** — a fast, native, in-process PptxGenJS render. In this
codebase, `pptxgenjs` rendering + an S3 upload per edit is still fast (no vision calls,
no OCR — it's synchronous CPU/IO work, typically well under a second per deck), so
**most of these can stay synchronous HTTP request/response**, unlike Document
Comparison's alignment/classification (which involves dozens of LLM calls) or Knowledge
Graph's extraction (which involves per-chunk LLM calls). Only the two LLM-driven stages
need the SQS-worker + poll treatment:

- **`worker/processSlideOutline.js`** — `type: "slide-outline"` job: runs
  `generateTextOutline` (Step 1), writes `SlideDeck.outlineJson` (the transient
  plain-text shape) + `status: "outline_review"`.
- **`worker/processSlideBuild.js`** — `type: "slide-build"` job: runs
  `generateStructuredOutline` (Step 2) on the user-approved outline, optionally
  `attachGeneratedImages` (bounded concurrency `p-limit(2)`, per-image failure isolated
  — never blocks the rest of the deck), then `buildDeck()` → S3 upload, `status:
  "ready"`/`"error"`.
- **`worker/processSlideEdit.js`** — `type: "slide-edit"` job: whole-deck or
  single-slide AI edit (decisions 9–11), `buildDeck()` → S3 upload, `status` reverts to
  `"ready"` on failure (decision 11), never `"error"`.

All three: never throw past their own handler; on a genuine crash, write `status:
"error"` + `errorMessage`. Add `"slide-outline"`/`"slide-build"`/`"slide-edit"` handling
into `worker/index.js`'s dispatcher.

Every **synchronous** editing route (theme, reorder, duplicate, delete, restore,
layout-patch, content-patch) follows one shared shape, matching the desktop IPC
handlers' identical pattern: load the deck row → parse `outlineJson` → mutate the
in-memory outline → `await buildDeck(outline)` → upload to S3 (overwrite the same
`s3Key`, or a fresh key + update the column — either is fine, but **be consistent** so
cached signed URLs don't serve stale content) → write back `outlineJson` +
refreshed `title`/`theme`/`slideCount` → return the updated deck + parsed outline
directly in the HTTP response (no polling needed for these — they're synchronous by
design, same as desktop).

### New API routes

Mirror the existing `src/app/api/documents/[id]/...` nested convention:

| Route | Mirrors (desktop IPC) | Sync/async |
|---|---|---|
| `POST .../documents/[id]/slides` | `generate-slides` | enqueues `slide-outline` job |
| `GET .../documents/[id]/slides` | `list-slide-decks` | sync |
| `GET .../slide-decks/[deckId]` | `get-slide-deck` | sync (includes the lazy-migration backfill of `id`/`elements`/`backgroundColor`/`layoutOverrides` on slides missing them, for decks created before the freeform editor existed — if this port ships the editor from day one, this backfill may be unnecessary; keep it only if outlines can ever be persisted without these fields) |
| `GET .../slide-decks/[deckId]/download` | `save-slide-deck` | streams the S3 object with `Content-Disposition: attachment; filename="<slug>.pptx"` (decision 12) |
| `DELETE .../slide-decks/[deckId]` | `delete-slide-deck` | sync — deletes the DB row + its `.pptx` S3 object + its `generated-slide-images/<deckId>/` S3 prefix |
| `POST .../slide-decks/[deckId]/confirm-outline` | `confirm-slide-outline` | persists edited `{title, slides, imageMode, imageSlideIndices}`, enqueues `slide-build` job |
| `POST .../slide-decks/[deckId]/edit` | `edit-slide-deck` | enqueues `slide-edit` job |
| `POST .../slide-decks/[deckId]/theme` | `update-slide-deck-theme` | sync |
| `POST .../slide-decks/[deckId]/reorder` | `reorder-slide` | sync |
| `POST .../slide-decks/[deckId]/duplicate-slide` | `duplicate-slide` | sync |
| `POST .../slide-decks/[deckId]/delete-slide` | `delete-slide` | sync — returns `removedSlide` for client-side undo |
| `POST .../slide-decks/[deckId]/restore-slide` | `restore-slide` | sync — undo's counterpart |
| `POST .../slide-decks/[deckId]/layout` | `update-slide-layout` | sync — validated via `elements.js` |
| `POST .../slide-decks/[deckId]/content` | `update-slide-content` | sync — validated via `content.js` |
| `POST .../documents/[id]/brand-logo` | `upload-brand-logo` | multipart upload (decision below) → S3 + dominant-color extraction |
| `POST .../documents/[id]/slide-images` | `upload-slide-image` | multipart upload → S3, `SlideImage` row |
| `POST .../documents/[id]/slide-images/generate` | `generate-slide-image` | direct `await` (one `gpt-image-1` call, same posture as other single-call routes in this series) → S3, `SlideImage` row `source: "generated"` |
| `GET .../documents/[id]/slide-images` | `list-slide-images` | sync, resolves signed S3 URLs |
| `DELETE .../slide-images/[imageId]` | `delete-slide-image` | sync |
| `GET/POST .../settings/default-brand-kit` | `get-default-brand-kit`/`save-default-brand-kit` | sync — reuse the existing `Setting` model (same `{userId, key, value}` shape already used for `openai_api_key`) rather than a new table |

**File uploads** (brand logo, slide image) change from "read `File.arrayBuffer()`,
send raw bytes over IPC" to a normal `multipart/form-data` `POST` to an API route (or
this repo's existing presigned-POST-to-S3 pattern from `src/app/api/s3/upload/route.js`
— prefer reusing that established flow over inventing a second upload mechanism).
**Dominant-color extraction** (currently `sharp`-based on desktop) needs an
`sharp`-free approach — a plain average/k-means-ish scan over decoded pixel data is
sufficient and avoids adding a native binary; this repo already decodes images without
`sharp` elsewhere (Figures spec) — reuse whatever decode path that established.

### Cascade cleanup

`src/app/api/documents/[id]/route.js`'s `DELETE` transaction gains: delete every
`SlideDeck` for this document (their `.pptx` and hero-image S3 objects, best-effort,
outside the transaction, same posture as the Figures spec's cleanup note) and every
`SlideImage` (its S3 object too) before the document row itself.

## Frontend implementation

### Routes — ported near-verbatim (framework-portable, no Electron API usage)

- **`src/app/(app)/slides/page.jsx`**, ported from `src/app/slides/page.jsx` (29
  lines): reads `deckId`/`docId` from `useSearchParams` (wrap in `<Suspense>`), renders
  `<SlideDeckEditor deckId={deckId} onClose={...} />`. **Deliberately its own full-page
  route, not a modal** — port this decision, don't wrap it in the app's normal
  navbar/sidebar chrome.
- **`src/app/(app)/slides/review/page.jsx`**, ported from `src/app/slides/review/page.jsx`:
  same param shape, renders `<OutlineReview deckId={deckId} onDone={...} />`.

### `src/components/slides/SlidesView.jsx` — ported near-verbatim

Deck gallery in a document's Slides tab: empty-state "Generate Slides" button opening
`BrandKitModal`; non-empty state list of `DeckCard`s with status pills
(`generating`/`outline_review` with a "Review Outline" button/`error`/`ready` with
slide count + theme pill + Preview&Edit/Download/Delete actions — **drop the
"Show in folder" button entirely**, decision 12). Polls every 3s (`POLL_INTERVAL_MS`)
while any deck is `generating`. Replace `window.api.listSlideDecks`/`generateSlides`/
`saveSlideDeck`/`deleteSlideDeck` calls with the matching `fetch()` calls; `Download`
becomes a plain `<a href="/api/slide-decks/[id]/download" download>` or
`window.open(...)` rather than a native save-dialog round-trip.

### `src/components/slides/BrandKitModal.jsx` — ported near-verbatim

Same fields/flow: logo drag-and-drop (5MB cap), 3 color swatches auto-filled from the
logo's extracted colors but always editable, 6 presentation-type pills (auto-filling
the custom-prompt textarea with a canned starter sentence per type, only if the
textarea is still empty), 4 visual-style pills, free-text instruction, "Remember this
brand" checkbox (fire-and-forget save, pre-fills on next open via
`GET .../default-brand-kit`). `buildBrandKit()` returns `null` (not an empty object)
when nothing was touched, so a truly-skipped generation sends no brandKit at all —
preserve this distinction, some downstream logic may depend on `null` vs. `{}`.

### `src/components/slides/OutlineReview.jsx` — ported near-verbatim

Editable deck title, per-slide numbered cards with an editable title input and a
**deliberately uncontrolled** `contentEditable` body editor (seeded once from a
hand-rolled `markdownToHtml` restricted to paragraphs/`- `bullets/`**bold**`, never
re-applied after mount — this avoids the classic React-controlled-contentEditable
caret-reset bug; port this uncontrolled pattern exactly, do not "fix" it into a
controlled component). On confirm, walk the live DOM back into the same markdown
dialect (`htmlNodeToMarkdown`, handling both `<p>` and Chromium's Enter-key-default
`<div>` as paragraph blocks). An "AI Images" mode selector (important/none/manual);
manual mode reveals a per-slide image toggle, seeded once (`{first, last}`) via a ref
flag so re-visiting doesn't stomp a user's manual picks. Drops any slide whose title is
empty on confirm, remaps manual-image indices onto the post-filter array.

### `src/components/slides/ThemeSelector.jsx` — ported near-verbatim

Palette grid (diagonal-gradient swatches, from the ported `theme.js`'s `PALETTES`),
click applies immediately (no LLM round-trip — synchronous theme-route call). A pinned
"Your Brand" swatch above the grid (own section, ✨ icon) when the deck has real brand
colors — kept visually distinct from presets, not folded in as an 11th option.

### `src/components/slides/SlideThumbnailRail.jsx` — ported near-verbatim

**New dependency: `@dnd-kit/core`** — already present in this repo's `package.json`
(confirmed), no new install needed. Port the exact drag mechanics: `useDraggable`+
`useDroppable` sharing one id per thumbnail, `PointerSensor` with
`activationConstraint: {distance: 8}` (plain click still selects without initiating a
drag), duplicate/delete icons using `onPointerDown` `stopPropagation` (not just
`onClick`) to avoid also starting a drag. Renders a live `<SlideRenderer scale={12}
.../>` per thumbnail (real preview, not a static image).

### `src/components/slides/renderer/icons.js` — port with the same rasterization-technique change as decision 14's backend counterpart

Frontend icon map is browser-side (`react-icons/lu` React components directly, no
rasterization needed here — only the export path needs pixels) — port verbatim, no
change needed beyond keeping its keys in sync with the backend whitelist.

### `src/components/slides/toolbar/*.jsx` — ported near-verbatim

`LeftToolsPanel` (stateless 4-icon rail), `PanelHeader` (shared title+close), `TextPanel`
(generic text box + 3 styled presets), `ShapesPanel` (12-shape grid, each swatch's
`clip-path` matching the real shape's SVG polygon points so what's clicked visually
matches what's inserted), `BackgroundPanel` (custom color, brand-kit row if present,
15 default swatches, 10 default gradients — no custom gradient editor). `UploadsPanel`
(the most complex — Uploaded/Generate tabs, shared `ImageGrid`): replace
`window.api.uploadSlideImage`/`listSlideImages`/`deleteSlideImage`/`generateSlideImage`
with the matching `fetch()` calls; port the aspect-ratio picker exactly (Square
1024×1024, Portrait 1024×1536 default, Landscape 1536×1024 — these three sizes are
what `gpt-image-1` actually supports, don't add others), the 400-char client-enforced
prompt cap, and the "include this slide's context/topic/palette" checkbox (default
checked, only shown when deck/slide context is actually available).

### `src/components/slides/SlideDeckEditor.jsx` — the core editor, ported with maximum fidelity

This is the largest and most interaction-dense single file (2225 lines on desktop) —
port structure and mechanics exactly, changing only the data-access layer
(`window.api.X()` → `fetch()`):

- **Layout**: header bar (Close/title/Present) anchoring floating contextual toolbars
  (`absolute top-full`, overlay without shifting layout) → 3-pane body (icon rail |
  optional flyout | canvas | right panel: `ThemeSelector` + Whole-Deck/Current-Slide AI
  edit form) → bottom horizontal `SlideThumbnailRail`. Present mode is a separate fixed
  fullscreen overlay sibling, not nested in the normal layout.
- **Two parallel, mutually-exclusive selection systems** — freeform elements
  (`selectedElementIds`/`editingElementId`) vs. template content fields
  (`selectedFieldPath`/`editingFieldPath`, plus `selectedFieldDefaults` reported by
  `SlideRenderer` at selection time since template fields don't store their own inherent
  style). Click semantics, identical for both: **first click selects** (blue outline +
  `react-moveable` handles), **second click on the already-selected item (or
  double-click) starts editing** (contentEditable, text only). Clicking canvas
  background deselects both.
- **New dependency: `react-selecto`** (marquee/rubber-band multi-select) — not
  currently in this repo, add it. Scoped to the scrollable preview pane (not the tight
  slide bounds), `selectableTargets: ['[data-freeform-id]', '[data-field-path]']`,
  `hitRate={0}`. On drag-start, bail if the gesture began on an existing
  element/field (hand it to that element's own click/Moveable handling instead). On
  select-end: any matched freeform element wins outright; otherwise, among matched
  field-path elements, pick the **smallest bounding-box area** one (not DOM-outermost —
  a card and its label/icon are DOM siblings, not nested, so "outermost" rarely
  resolves to what the user meant) and synthetically click it. A short-lived
  suppress-next-deselect flag (cleared via a zero-delay `setTimeout`) prevents the
  marquee's own trailing click from immediately re-triggering the background
  deselect handler.
- **New dependency: `react-moveable`** (drag/resize/rotate) — not currently in this
  repo, add it. Every interactive element mutates the DOM node's inline
  `style.left/top/width/height/transform` directly during the gesture (no React
  re-render mid-drag, for performance); only `*End` handlers (gated to ignore a
  click-without-movement) convert px→inches (divide by the current px-per-inch
  `scale`) and commit **once per gesture**, never per-frame. Rotation normalized to
  `(-180, 180]` on commit. **Aspect-ratio locking varies by kind** — port exactly:
  image elements always locked on every handle; text (freeform or template field)
  locked only on corner handles (this is what lets a corner-drag proportionally scale
  `fontSize` too, via `scaleRatio = ((newW/w)+(newH/h))/2` clamped to `[6,200]` — two
  earlier approaches, area-ratio and min-dimension-ratio, are noted in desktop comments
  as having produced wrong results and were replaced by this corner-lock approach, so
  don't reintroduce either); shapes never locked (free independent resize); the
  icon-in-circle `InteractiveCircle` primitive always locked unconditionally (an oval
  badge looks broken); tables have **no rotation at all** (`pptxgenjs` has no
  group-rotate primitive — a rotated table couldn't round-trip to the exported file
  faithfully). **Snapping** (freeform elements only): snap to slide edges/center and to
  every *other* element's edges/center on the same slide (a shared node registry each
  element registers into on mount), 5px threshold.
- **Undo/redo** — port `UNDO_STACK_LIMIT = 50`, `UNDO_COALESCE_MS = 500` exactly
  (decision 17). Two snapshot shapes on one stack: freeform (`{slideIndex, elements,
  backgroundColor, layoutOverrides, heroImage}`, safe to store by reference since every
  mutation always produces new objects, never mutates in place) and structural
  (`{type: 'delete-slide', slideIndex, slide}`, restored via the dedicated
  restore-slide route since "add a slide back" can't be expressed as a layout patch).
  Same-key-within-500ms pushes coalesce (bump timestamp only, don't push a new entry) —
  a continuous color-drag or keystroke burst becomes one undo step. A discrete action
  (button click, gesture-end, add/delete/duplicate) always gets a fresh entry (no
  coalesce key passed). Undo/redo pop-and-replay never itself pushes a new undo entry.
- **Persistence — one funnel function** (`persistFreeform` on desktop): optimistic
  local state update → `await` the layout-patch route → replace local state with the
  server's authoritative response (which reflects the rebuilt deck) on success, roll
  back to pre-mutation state on failure. **No debounce for discrete actions** (decision
  18) — every gesture-end fires a real patch request immediately. Per-keystroke local
  edits (font-size number input, color-picker drag) update React state only and flush
  on blur via a separate explicit persist call. Template *content* edits go through the
  **separate** content-patch route, never the layout-patch path — keep AI-owned content
  and the human freeform overlay independently addressable, as on desktop.
- **Keyboard shortcuts** (all skipped while focus is in an input/textarea/
  contentEditable, and while presenting): Ctrl/Cmd+Z / +Shift+Z (undo/redo), Ctrl/Cmd+D
  (duplicate selection, 0.3in offset, placed above in z-order), Ctrl/Cmd+C/V (in-memory
  clipboard ref only — no OS clipboard integration, lost on tab close — paste targets
  whatever slide is currently selected, which may differ from the copy source), plain
  arrow keys (nudge selection 0.05in, 0.25in with Shift, clamped to slide bounds,
  coalesced per selection-set — or, with nothing selected, navigate slides instead,
  which also works during Present mode alongside Space/PageUp/PageDown/Escape),
  Delete/Backspace (delete selected element(s), or the array item of a selected
  deletable template field).
- **Element layering**: forward/backward one step at a time (swap with the
  zIndex-sorted neighbor, then reassign sequential `0..n-1` across the whole array to
  keep it gap-free) — the buttons are commonly labeled "Bring forward"/"Send backward,"
  not true front/back, despite icon choice; port that exact one-step behavior, not a
  full front/back jump.
- **Multi-select align/distribute**: left/right/h-center/top/bottom/v-middle (≥2
  selected) and distribute-horizontal/vertical (≥3 selected — evens the *gaps between
  bounding-box edges*, the standard design-tool behavior: `gap = (right-left-totalWidth)
  / (n-1)`, then places each element left-to-right/top-to-bottom with that gap).
- **In-editor AI image generation and upload** — two insertion paths from the same
  `UploadsPanel`: as a new freeform image element (aspect-correct box, capped at 4in on
  the long side from the real image's pixel dimensions), or as a **replacement for the
  slide's AI-generated hero image** (only reachable via a "Replace image" button on the
  hero image's own floating toolbar, which sets a pick-target flag and opens the
  Uploads panel) — writing `heroImage.src` while preserving any existing
  `layoutOverrides.heroImage` position/size. The panel itself doesn't distinguish
  uploaded vs. generated images at insertion time — same callback either way.
- **Background/gradient editing**: `handleSetBackground` pushes a coalesced undo entry
  (native color inputs fire continuously while dragging) then persists. Value shape:
  solid hex string | `null` (reset to theme default) | `{type:'gradient', angle,
  stops:[hexA,hexB]}`. Contrast-text computation against a gradient background uses the
  midpoint mix of its two stops.
- **AI free-text edit form**: Whole-Deck/Current-Slide mode toggle + textarea + Apply →
  the enqueue-and-poll route (`status` flips to `generating`, `POLL_INTERVAL_MS=3000`
  picks up completion, same pattern as `SlidesView`). Shows a persistent banner when any
  slide has manual freeform edits, warning that an AI edit preserves their
  position/color but content may still be rewritten (decisions 9–10 are what make this
  guarantee true — the banner is just surfacing it).
- **Palette/theme**: synchronous theme-route call, no LLM — including the "your brand
  palette" toggle as a distinct call variant, not a palette-list entry.
- **Present mode**: `fixed inset-0 z-70` overlay (sibling, not nested), single
  full-bleed `SlideRenderer` letterboxed to fit (`min(width/13.3, height/7.5)`), real
  browser Fullscreen API (`requestFullscreen()`, not just CSS — listen for
  `fullscreenchange` to stay in sync if the user exits via a browser/OS shortcut
  outside the app's own controls; exit fullscreen on unmount too). Click-anywhere
  advances; explicit prev/next/close controls; Escape/arrows/Space/PageUp/PageDown
  navigate.
- **Delete slide**: refuses on the deck's last slide; optimistic splice + the
  delete-slide route; on success, pushes a structural undo entry with the exact removed
  slide the route hands back.

### `src/components/slides/renderer/SlideRenderer.jsx` — the data model + renderer, ported with maximum fidelity for UI parity

This is the file the "uncanny" visual-parity request most depends on — port its exact
data model and positioning math, not an approximation:

- **Data model** (port exactly, including the specific field names — anything reading
  `outlineJson` on both the worker's PPTX exporter and this renderer must agree byte-
  for-byte): a `Slide` is a discriminated union on `type` (16 values, `LAYOUT_COMPONENTS`
  map kept in sync with the backend's `LAYOUT_BUILDERS`), with common fields `id`,
  `title`/`subtitle`, `bullets`, `items`, `stats`, `table {headers, rows}`, `chart
  {chartType, categories, series}`, `quote`/`attribution`, `icon`/`context`/
  `panelLabel`, `heroImage {src}|null`, `backgroundColor` (solid hex | gradient
  descriptor | `null`), `elements[]` (the freeform overlay), `layoutOverrides`
  (sparse `{fieldPath: {x,y,w,h,rotation,fontSize,color,bold,italic,align,radius}}`,
  each override key independently merges only the fields it names — a resize-only
  override on one field must never clobber a previously-set color override on the same
  path). An `Element` (`slide.elements[]` entry): `{id, kind, x, y, w, h, rotation,
  zIndex, ...kind-specific fields}`, coordinates/sizes **in inches** (matching PPTX's
  native unit) — `scale` (px-per-inch) is the only thing that differs between the
  thumbnail rail (`scale=12`), the interactive canvas
  (`scale=(previewWidth-32)/13.3 * zoom`), and Present mode
  (`scale=min(width/13.3, height/7.5)`). **Colors are unprefixed 6-hex-digit strings
  everywhere** (`"CADCFC"`, never `"#CADCFC"`) in both slide/element JSON — a shared
  `hex()` helper prepends `#` only at render time; preserve this convention exactly,
  since it's shared with the theme math ported above.
- **Shared rendering primitives**, ported near-verbatim: `TextBox` (the universal
  editable-text primitive — resolves effective geometry/style by merging
  `layoutOverrides[fieldPath]` over the layout's computed default, handles
  select/edit/drag/resize/rotate in one component via a `layoutCtx` bag threaded from
  the root), `Shape` (same override-merge for template chrome, optional `radius`/
  `shadow`, select+transform only, no edit mode), `InteractiveCircle`/`IconCircle`/
  `NumberedCircle` (always aspect-locked, render-prop children for inner icon sizing),
  `BulletList` (**each bullet is its own independently-draggable `TextBox`**,
  `fieldPath="bullets[i]"`, not one flowed list — default vertical stepping mirrors the
  same per-item height math the layout builder uses, so an unedited list still reads as
  one coherent block by default), `ChecklistRows`/`HeroImage`/`HeroKicker`/
  `DecorativeCircles`, `ChartSlide` (via **`recharts`**, already a dependency in this
  repo — pivot `{categories, series}` into recharts' row format, color from
  `[theme.palette.primary, secondary, accent]`), `TableSlide` (the whole table moves/
  resizes as one rigid unit, no rotation — individual cells are separately editable
  `TextBox`es with `interactiveTransform={false}`, selectable/editable in place but
  never independently draggable), `FreeformLayer` (renders `elements[]` sorted by
  `zIndex` on top of everything — plain `<div>` for text/rect/ellipse/roundRect/line,
  `<img>` for image, an inline `<svg><polygon>` in a `0 0 100 100` viewBox for the
  remaining basic-shape kinds, chosen over CSS `clip-path` specifically because a
  border after `clip-path` doesn't correctly outline a clipped shape).
- **Text-fitting heuristics — port the exact formulas**, since they must visually match
  what the PPTX exporter computes: `estimateLines` assumes ~0.52em average character
  width; `fitFontSize` shrinks in 0.5pt steps until the estimated wrapped line count
  fits the box height (floor 9pt); `bulletBlockHeight` sums estimated per-bullet height
  to decide whether a short list should vertically center (capped at 1.0in of centering
  slack) rather than pin to the top.
- Root component resolves `style = getStyle(theme)` (the presentation-type chrome
  variant — decision 16), computes effective background/contrast color (gradient
  midpoint-mixed if applicable), builds `layoutCtx`, renders the type component +
  `FreeformLayer` + an optional brand-logo image (bottom-right, aspect-capped at
  0.55×1.8in) on top of everything.
- Header-comment caveat worth preserving as a code comment in the port too: this
  renderer is **not** pixel-identical to the exported `.pptx` (font/wrap/shadow
  differences are expected) — the exported file remains the source of truth for exact
  fidelity; this is a faithful *approximation* for live editing, not a guarantee.

## Verification plan

- Generate a deck end to end: brand kit → outline review (edit a title, edit a bullet
  body, switch image mode to manual and pick 2 slides) → confirm → structured build →
  ready deck with the picked slides carrying hero images and no others.
- Confirm generation is blocked/queued correctly if attempted before a document's
  chunks exist (decision 2).
- Force a structuring-response edge case (if testable — e.g. a deliberately thin
  approved body) and confirm the deck still has the exact same slide count as approved,
  with a deterministic fallback slide rendered rather than a dropped/mismatched slide
  (decision 3).
- Feed an outline containing an obvious metric-heavy bullet list — confirm it renders
  as `icon_list`, not `bullets` (decision 6).
- Feed two slides covering the same real topic in different words — confirm the
  redundancy filter drops the paraphrased duplicate, not just an exact-string repeat
  (decision 5).
- Editor: select/edit a template text field and a freeform text box independently;
  confirm the two selection systems never conflict (selecting one clears the other).
- Marquee-select 3+ elements, confirm align/distribute works correctly on the group.
- Undo/redo: drag an element, resize it, change its color via continuous drag (should
  coalesce into one undo step), delete a slide, undo the deletion (slide returns
  intact) — confirm the full sequence reverses correctly and the 50-step cap holds.
- Drag/resize every element kind and confirm aspect-lock behavior matches decision
  above exactly per kind (image always locked, text only on corners, shapes never,
  circles always, table has no rotate handle at all).
- Set a gradient background, confirm it renders correctly both live and in the
  downloaded `.pptx` (rasterized correctly per decision 13).
- Generate an in-editor AI image and both insert it as a new element and use it to
  replace a slide's hero image — confirm the hero-image replacement preserves any
  existing `layoutOverrides.heroImage` sizing.
- Run a whole-deck AI edit on a deck with manual freeform edits on some slides —
  confirm those slides' positions/colors/hero images survive unchanged while unrelated
  content updates (decision 10); force an edit failure (e.g. malformed response, if
  testable) and confirm `status` reverts to `"ready"`, not `"error"` (decision 11).
- Run a single-slide edit attempting to change color — confirm it escalates to a
  whole-deck edit instead of applying inconsistently to one slide (decision 9).
- Reorder, duplicate, and delete slides via the thumbnail rail; confirm the exported
  `.pptx` slide order always matches the editor's order.
- Download the deck — confirm a valid `.pptx` opens correctly in PowerPoint/Keynote/
  LibreOffice, with icons, fonts, and gradients rendering correctly (not just in this
  app's own preview).
- Enter Present mode, confirm real fullscreen (not just CSS), navigation via click/
  keys, and clean exit/re-entry.
- Delete a deck — confirm its `.pptx` and hero-image S3 objects are gone, not just the
  DB row; delete the parent document — confirm all its decks and slide-image pool are
  cleaned up too.
- A tampered `deckId`/`imageId` on another user's document 404s on every route.
