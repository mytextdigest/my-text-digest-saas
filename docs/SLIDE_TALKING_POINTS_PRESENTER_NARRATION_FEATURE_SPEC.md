# Slide Talking Points, Presenter View, Narration & Video Export — Implementation Spec (Cloud/SaaS)

## Purpose

This spec ports the slide-deck features the desktop app (`mytextdigest`) gained between Oct 26 and Nov 11, 2026 to this codebase. Follow it as the source of truth.

**The UI and UX must be identical to the desktop.** The components are copied, not redesigned. The same layout, wording, spacing, colours, icons, keyboard shortcuts and states must ship. A tester switching between the desktop app and the browser must not see a difference except where the browser makes one unavoidable. Every such difference is listed in "Browser-forced differences"; anything not on that list is a bug.

The desktop design records (read these before starting):
- `mytextdigest/TALKING_POINTS_ROADMAP.md`: talking points, Phases 0–5; presenter view, Phases 6–10.
- `mytextdigest/SLIDE_AUDIO_ROADMAP.md`: narration, narrated playback and video export, Phases 1–6; the Nov 10 changes; number safety.
- Desktop commits, in order:
  - `907c181`: talking points and presenter view.
  - `e8ad25a`: narration, narrated playback and video export, plus the resizable sidebar and larger sidebar text.
  - `222c6d9`: number check for narration scripts.

## Gap analysis

Everything the cloud editor had up to the September desktop work is already here: outline review, AI edit, themes and brand kit, the freeform editor, uploads and AI images, duplicate/delete/undo, and the full-screen Present overlay. All of the following is missing.

| # | Feature (desktop) | Cloud today | Portable? | Notes |
|---|---|---|---|---|
| 1 | Talking points: AI per deck or slide, Tiptap rich text, autosave, "Slide changed" flag, filmstrip dot | none | **Yes, fully** | Whole-deck generation moves to a worker job (it can take over 60 s on Vercel) |
| 2 | Full-script modal | none | **Yes, fully** | |
| 3 | Export menu: deck `.pptx` with talking points as speaker notes; talking points `.pdf` | download button serves the stored `.pptx`, with no notes | **Yes** | The `.pptx` is rebuilt with notes in a route. The PDF is rendered by headless Chromium in the worker (D7) |
| 4 | Present split button: "Present (full screen)" / "Presenter View" | single Present button (`SlideDeckEditor.jsx:1549`) | **Yes, fully** | |
| 5 | Presenter view: current and next slide, editable notes, timer, pace guide, slide grid, black/white screen, laser pointer, keyboard, number + Enter | none | **Yes** | Browser windows synced with `BroadcastChannel` take the place of Electron windows synced by the main process (D4) |
| 6 | Shareable "MTD — Audience" window for video calls | none | **Yes** | The audience window becomes a popup window. See the occlusion caveat |
| 7 | Projector: audience full screen on the 2nd display, swap displays, unplug/replug | none | **Partly** | Chrome/Edge: the Window Management API does the same, after a one-time permission. Firefox/Safari: the user drags the window and clicks a full-screen button. Swap is Chrome/Edge only |
| 8 | Presenter window hidden from whole-screen share (`setContentProtection`) | none | **No** | No browser API exists. It was only ever a safety net; the audience window is the real method |
| 9 | Display stays awake while presenting (`powerSaveBlocker`) | none | **Yes** | Screen Wake Lock API |
| 10 | Narration tab: AI voice for the whole deck, per-slide AI voice, upload, record, script editing, voice / tone / pause settings with sample, out-of-date flags | none | **Yes, fully** | Audio stored in S3. Whole-deck generation runs as a worker job |
| 11 | Number check on narration scripts: digits only, deterministic check, retry, block, confirm, chips, red badges | none | **Yes, fully** | Pure module, copied verbatim |
| 12 | Narrated playback in presenter view: auto-advance, hold for target time, pause on B/W, "Narration finished", "Share sound" hint | none | **Yes, fully** | Audio plays in the presenter window only, as on desktop |
| 13 | Video export (`.mp4`) | none | **Yes** | Worker: headless Chromium draws `/present/frame`, then ffmpeg encodes (D7) |
| 14 | Resizable right sidebar (300 px up to 55% of the window, at most 800 px; double-click resets; remembered) and larger sidebar text | fixed `w-80` (`SlideDeckEditor.jsx:2080`), small text | **Yes, fully** | |
| 15 | Filmstrip badges: talking points (dark / amber) and narration (dark / amber / red) | none | **Yes, fully** | |

**Summary:** everything is portable except item 8, which has no browser equivalent, and the Firefox/Safari part of item 7.

## Locked-in decisions (do not relitigate)

**D1. Copy, don't redesign.** Desktop components are copied with only their import lines changed: `window.api.*` becomes the shim in D2, and Electron-only paths become the routes below. If a desktop component needs a behavioural change here, keep its markup and classes byte-identical and change only the data layer.

**D2. One client shim: `src/lib/slidesApi.js`.** It has the same method names and return shapes as the desktop `preload.js` slide, presentation, narration and video methods (`getTalkingPoints`, `saveTalkingPoints`, `generateTalkingPoints`, `exportTalkingPointsPdf`, `getSlideAudio`, `saveSlideAudio`, …, `exportDeckVideo`, `cancelDeckVideo`). This follows the precedent of `src/lib/tablesApi.js`. Desktop push events become polling inside the shim, so the components stay unchanged:
- `onTalkingPointsChanged`, `onSlideAudioChanged`, `onSlideAudioProgress` and `onDeckVideoProgress` poll at 1.5 s while a job runs.
- The presentation events use `BroadcastChannel` (D4).

**D3. Long work runs on the worker, on a new dedicated queue `SQS_MEDIA_QUEUE_URL` with its own poll loop.** This follows the `SQS_CHAT_QUEUE_URL` precedent. The main queue runs one job at a time and carries document processing, so a 60-second narration run or a 2-minute video must not hold up other users' uploads.
- Worker jobs: `talking-points` (whole deck), `narration` (whole deck, or one slide when a script must be written first), `deck-video`, `talking-points-pdf`.
- Per-slide talking points, saves, settings, uploads and the voice sample run in routes (`maxDuration = 60`).
- Locally, with the variable unset, these jobs go to the main queue, as chat-image does.

**D4. Presenter view runs in browser windows, with the presenter window owning the session.** On desktop the Electron main process owned the session state (`electron/presentation.js`). Here the **presenter window** owns it, and the logic moves into `src/components/slides/present/presentationSession.js`. The audience window is a pure mirror.
- **Channel:** a `BroadcastChannel('mtd-presentation-<deckId>')` carries the same messages the desktop sent over IPC:
  - `presentation:state`, `presentation:pointer` and `presentation:deck-changed`, presenter → audience;
  - goto, screen and end intents, audience → presenter (clicker keys work in either window).
- **Opening the windows:** the editor's "Presenter View" opens the presenter window with `window.open` from the click (so popup blockers allow it). The presenter window then opens the audience window, during the same user gesture.
- **Closing:** closing either window, or pressing Esc, ends both, exactly as on desktop. `beforeunload` sends `end`, and the editor learns the session ended through the same channel, then lands on the slide where the talk stopped.

**D5. Projector placement uses the Window Management API when available.**
- **Chrome/Edge:** `window.getScreenDetails()`, after a one-time "Manage windows" permission prompt shown from the Presenter View click. This gives the desktop behaviour: the audience window goes full screen on the other screen and the presenter stays on the editor's screen. It also enables "Swap displays", and the `screenschange` event provides the unplug/replug fallback.
- **No permission, or Firefox/Safari:** "window" mode, which the desktop also falls back to. The audience popup gets a one-time overlay, "Drag this window to the projector, then click to go full screen", because `requestFullscreen` needs a click inside that window.

**D6. Audio is stored in S3 and served same-origin.**
- Keys follow `slide-audio/<deckId>/<slideId>-<ts>-<rand>.<ext>`.
- Uploads and recordings go through a presigned POST. Do not reuse `/api/s3/upload`, which trusts the client's `userId` (see the chat attachments spec).
- Playback goes through the authed `GET /api/slide-audio/[deckId]/[slideId]/file`, which returns a 302 to a short-lived signed URL. `<audio>` follows the redirect, and the URL keeps working across reloads.
- Clip length is measured in the route for MP3 and WAV (`mp3DurationMs` / `wavDurationMs` from the shared module). Other formats use the browser's measurement, the same fallback as desktop.
- WebM recordings are fixed up in a small `audio-remux` job on the media queue, using ffmpeg's stream copy (`remuxInPlace` on desktop), so their header carries the real length.

**D7. The worker gets headless Chromium (`puppeteer`) and ffmpeg (`ffmpeg-static`).** Video export uses them the same way desktop does:
1. Load `/present/frame?deckId=…&renderToken=…` at 1920×1080.
2. Call `window.__mtdShowSlide(i)` for each slide and take a screenshot.
3. Encode one ffmpeg segment per slide (1 fps input, 15 fps output, H.264/AAC), then join the segments with `-c copy`.

`renderToken` is a deck-scoped token signed with `NEXTAUTH_SECRET` that expires after 10 minutes, accepted only by `GET /api/slide-decks/[deckId]` and the frame page. The same Chromium renders the talking-points PDF with `page.pdf()`, as desktop's `printToPDF`, so "Download talking points (.pdf)" produces a real PDF, not a print dialog.
- **Why not render in the browser** (`html-to-image` + ffmpeg.wasm): it needs CORS on every slide image, its font embedding is unreliable, and encoding is slow and memory-heavy on weak laptops. The desktop result came from a real browser engine, and so must this one.

**D8. The pure modules are copied verbatim, with no edits.** `talkingPoints.js` and `narration.js` (including the number check and `synthesizeSpeech`) move into `src/lib/slides/` with the desktop tests in `src/lib/slides/__tests__/`. They are require-free on desktop precisely so the renderer can import them; keep that true here. Desktop and cloud must never disagree about hashing, staleness, the 15 s fallback hold, the number check or the TTS call.

**D9. AI voice uses the same OpenAI model (`gpt-4o-mini-tts`) through the one `synthesizeSpeech()` function.** It is deprecated by OpenAI, with removal on **2027-01-06**. When desktop switches providers, the same one-function change lands here.

**D10. Settings that live in desktop `localStorage` use the same keys here:**
- notes font size and the dismissed hints: `mtd.presenter.*`;
- sidebar width: `mtd.editor.rightPanelWidth`.

These are per-user conveniences, the same as on desktop.

## Browser-forced differences (the only allowed UI differences)

1. **Projector placement:** see D5. Chrome/Edge works like desktop after one permission prompt. Elsewhere there is a one-time "drag and click to go full screen" overlay in the audience window. "Swap displays" is disabled outside Chrome/Edge (shown greyed, with a tooltip), just as desktop disables it in window mode.
2. **No presenter hiding from whole-screen shares (item 8):** the presenter view's call guidance card and the "Share the MTD — Audience window" chip keep the desktop text. Nothing else changes.
3. **Covered audience window:** Chromium can stop painting a fully covered popup window when the OS reports it occluded, which freezes the shared feed. Desktop avoided this with an Electron switch that a page can't set. Mitigation: Zoom/Teams/Meet can share a **browser tab**, and a tab keeps rendering. The audience window is therefore opened as a minimal popup **and** offers "Open as a tab instead", and the call guidance card gains one line: "If the shared slide freezes while covered, share this as a tab." Verify on Windows and macOS before release (Verification §6).
4. **Popup blockers:** if `window.open` returns `null`, show the desktop-styled inline error "Allow pop-ups for this site to open presenter view."
5. **Microphone:** the browser's permission prompt replaces macOS `askForMediaAccess`. The denied-access message keeps the desktop's text, but refers to the browser's site settings.
6. **Downloads:** `.pptx`, `.pdf` and `.mp4` download through a 302 to a signed URL with `Content-Disposition` (the existing download-route pattern), instead of a native save dialog. The editor header's "Deck saved", "PDF saved" and "Video saved" messages stay.
7. **Video export progress:** desktop's "Drawing slides 3/10", then "Encoding video 5/10", stays word for word, polled from the job row. A "Queued…" state may show first if the media queue is busy.

## Data contract

### Prisma (one migration, `add_slide_talking_points_narration`)

```prisma
model SlideTalkingPoint {          // desktop: slide_talking_points
  deckId      String   @map("deck_id")
  slideId     String   @map("slide_id")
  html        String   @default("")
  origin      String   @default("ai")      // 'ai' | 'user'
  seconds     Int?
  contentHash String?  @map("content_hash")
  updatedAt   DateTime @updatedAt @map("updated_at")
  @@id([deckId, slideId])
  @@map("slide_talking_points")
}

model SlideAudio {                  // desktop: slide_audio
  deckId          String   @map("deck_id")
  slideId         String   @map("slide_id")
  source          String?             // 'generated' | 'uploaded' | 'recorded' | null
  s3Key           String?  @map("s3_key")  // replaces file_path
  mime            String?
  durationMs      Int?     @map("duration_ms")
  script          String?
  scriptOrigin    String?  @map("script_origin")
  notesHash       String?  @map("notes_hash")
  voice           String?
  audioScriptHash String?  @map("audio_script_hash")
  numbersOkHash   String?  @map("numbers_ok_hash")
  updatedAt       DateTime @updatedAt @map("updated_at")
  @@id([deckId, slideId])
  @@map("slide_audio")
}

model SlideNarrationSettings {      // desktop: slide_narration_settings
  deckId String @id @map("deck_id")
  voice  String?
  tone   String?
  gapMs  Int?   @map("gap_ms")
  @@map("slide_narration_settings")
}

model SlideDeckJob {                // progress + result for media-queue jobs (desktop had IPC events)
  id        String   @id @default(cuid())
  deckId    String   @map("deck_id")
  kind      String                      // 'talking-points' | 'narration' | 'deck-video' | 'talking-points-pdf'
  slideId   String?  @map("slide_id")
  status    String   @default("queued") // queued | running | done | error | cancelled
  phase     String?                     // 'script' | 'audio' | 'render' | 'encode'
  done      Int      @default(0)
  total     Int      @default(0)
  result    Json?                       // {generated, failed, blocked, missing} | {s3Key, durationMs}
  error     String?
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  @@index([deckId, kind])
  @@map("slide_deck_jobs")
}
```

Same rules as desktop:
- **Keyed by slide id** (the `slide.id` inside `outlineJson`), never by index, so points and clips follow reorders.
- **No relation to `SlideDeck`**, so an orphan row can never block a delete. `DELETE /api/slide-decks/[deckId]` removes the rows and the `slide-audio/<deckId>/` S3 prefix.
- **`duplicate-slide` copies both rows to the clone**, and copies the S3 object for the clip.

### Routes (all session-authed through `document.user.email`, as in the existing slide-deck routes)

| Route | Desktop IPC it replaces |
|---|---|
| `GET /api/slide-decks/[deckId]/talking-points` | `get-talking-points` |
| `PUT …/talking-points/[slideId]` `{html?, markCurrent?}` | `save-talking-points` |
| `POST …/talking-points/generate` `{slideId?}`: one slide inline; whole deck → `talking-points` job, returns `{jobId}` | `generate-talking-points` |
| `POST …/talking-points/pdf` → job; `GET …/jobs/[jobId]/file` → 302 | `export-talking-points-pdf` |
| `GET …/download`: **changed** to rebuild the `.pptx` with `talkingPointsToPlainText` speaker notes (`buildDeck` in-route), falling back to the stored file | `save-slide-deck` |
| `GET /api/slide-decks/[deckId]/audio` → `{audio, settings}`; each entry's `url` is the `/file` route below | `get-slide-audio` |
| `PUT …/audio/settings` | `save-narration-settings` |
| `POST …/audio/[slideId]/upload-url` → presigned POST; `POST …/audio/[slideId]` `{s3Key, durationMs, source}` | `save-slide-audio` |
| `DELETE …/audio/[slideId]` (keeps the script) | `delete-slide-audio` |
| `PUT …/audio/[slideId]/script` `{script?, markCurrent?, confirmNumbers?}` | `save-narration-script` |
| `POST …/audio/[slideId]/script/generate` | `generate-narration-script` |
| `POST …/audio/generate` `{slideId?, rewriteScript?, redoAll?}` → `narration` job `{jobId}` | `generate-narration-audio` |
| `POST …/jobs/[jobId]/cancel` | `cancel-narration`, `cancel-deck-video` |
| `POST /api/slide-audio/preview` `{voice, tone}`: sample cached in S3 under `slide-audio/_previews/` | `preview-narration-voice` |
| `GET /api/slide-audio/[deckId]/[slideId]/file` → 302 signed URL | (desktop `file://` URL) |
| `POST …/video` → `deck-video` job; `GET …/jobs/[jobId]` (progress); `GET …/jobs/[jobId]/file` → 302 | `export-deck-video` |

## Backend implementation

1. **`src/lib/slides/talkingPoints.js` and `narration.js`:** verbatim copies (D8), plus their tests. Add `npm run test:slides` (`node --test src/lib/slides/__tests__/*.test.js`).
2. **`src/lib/slides/narrationServer.js`:** shared by the routes and the worker. A port of the desktop's `electron/slideAudio.js`, with the same function names:
   - `loadSlideAudio`, `upsert`, `numberCheck`, `numbersCleared`, `scriptItem`, `writeScripts` (batches of 3, temperature 0.2, retry at 0 with the correction), `friendlyTtsError`, and the target and `needsScript` selection from `generate-narration-audio`;
   - S3 put/get/copy/delete replace the `fs` calls.

   This is the one place the narration rules live server-side. Copy the logic line for line, including the comments explaining each rule.
3. **`src/lib/slides/talkingPointsServer.js`:** a port of the `main.js` talking-points block (`loadTalkingPoints`, the save/generate handlers, and stamping `contentHash` with the hash of the content the model saw).
4. **Worker** (`worker/processSlideMedia.js` + `index.js`):
   - Add a `SQS_MEDIA_QUEUE_URL` poll loop and the four job types.
   - Each job updates its `SlideDeckJob` row (`phase/done/total`) where desktop sent progress events. A cancel route sets `status = 'cancelled'`; the job checks it between steps and aborts the OpenAI or ffmpeg calls through an `AbortController`.
   - These jobs must **never** flip `Document.status`; reuse the `cluster` exclusion in `recordJobFailure()`.
   - The 8-minute watchdog is enough: 9 slides took about 35 s on desktop. For decks over 40 slides, split `deck-video` into a render job and an encode job, the same self-chaining pattern as `tables-scan`.
5. **Video:** `worker/deckVideo.js` ports `electron/videoExport.js` with Puppeteer in place of the offscreen `BrowserWindow`.
   - Keep the desktop's readiness rules: the frame page's `[data-slide-frame]` wait, the warm-up draw, the chart-settle delay and the encode settings.
   - Puppeteer's `page.screenshot()` takes the place of the double-paint capture.
   - Install: `npm i puppeteer ffmpeg-static` in the worker's environment. Chromium needs system libraries on the EC2 host (the `apt` list goes in the worker deploy notes). Add these to the README worker section.
6. **Frame page:** `src/app/present/frame/page.jsx` + `FrameView.jsx`, verbatim. It loads the deck through the shim's `getSlideDeck`, which passes `renderToken` when present.

## Frontend implementation

### Files (desktop → cloud)

| Desktop | Cloud | Change |
|---|---|---|
| `src/components/slides/talkingPoints/{TalkingPointsPanel,TalkingPointsEditor,FullScriptModal,useTalkingPoints}.jsx/js` | same paths | import of `window.api` → `slidesApi` |
| `src/components/slides/narration/{NarrationPanel,AudioRecorder,useSlideAudio}.jsx/js` | same paths | same; `requestMicrophoneAccess` resolves `{granted: true}` (the browser prompts itself) |
| `src/components/slides/present/{PresenterView,AudienceView,SlideStage,FrameView,usePresentation,usePresentationKeys,useNarrationPlayback}.jsx/js` | same paths | `usePresentation` reads the session from `presentationSession.js` / `BroadcastChannel` (D4) |
| `src/components/slides/deckTheme.js` | same | none |
| `src/app/present/{presenter,audience,frame}/page.jsx` | `src/app/present/...` (outside `(app)`, so there's no sidebar shell) | session check on mount; redirect to sign-in if missing |
| `src/components/slides/SlideDeckEditor.jsx` (diff of the three desktop commits) | existing file | apply the diff by hand. The cloud file differs in data plumbing (`outlineJson`, polling), so port the **UI** changes exactly (listed below) |
| `src/components/slides/SlideThumbnailRail.jsx` | existing file | add the `talkingPointsStatus` / `audioStatus` badges verbatim |
| `src/app/globals.css` `.tp-editor` / `.tp-presenter` rules | same file | copy verbatim |

**Dependencies:** `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-highlight` and `@tiptap/pm` (the same `^3.32` versions as desktop); `puppeteer` and `ffmpeg-static` (worker only).

### `SlideDeckEditor.jsx` UI changes to port exactly

1. **Header:**
   - An **Export** menu (`ToolbarMenu` from the existing `ViewerToolbar.jsx`) with "Download deck (.pptx)", "Download talking points (.pdf)" and "Download video (.mp4)". The video item shows progress and a Cancel link in the header.
   - The **Present (full screen) | ▾** split button. Its menu has "Present (full screen)" and "Presenter View".
   - While presenting, the header shows "Presenting · End".
2. **Right panel:**
   - Tabs **AI Edit | Talking Points | Narration** (`DocumentTabs`).
   - Drag-to-resize from the left edge (300 px up to 55% of the window, at most 800 px; double-click resets to 380 px; key `mtd.editor.rightPanelWidth`).
   - The desktop text sizes: 14 px body, 12 px labels, a 15 px talking-points editor and 32 px buttons.
3. **`ToolbarMenu` flip-up fix:** port the desktop `useLayoutEffect` that opens the menu upward when there isn't room below. Presenter view's Display settings menu needs it. The cloud `ToolbarMenu` (`ViewerToolbar.jsx:81`) doesn't have it yet.
4. **`DocumentTabs` overflow:** the cloud `DocumentTabs.jsx` (40 lines) predates the desktop's 144-line version, which measures tab widths and moves tabs that don't fit into a "More" menu. Port the desktop file verbatim; three tabs in a narrow sidebar depend on it.
5. **Filmstrip badges** and the **Full script** modal wiring.

## Phases (each shippable and testable on its own)

| Phase | Ships | Depends on |
|---|---|---|
| **0. Foundations** | Pure modules + tests, Prisma migration, `slidesApi.js` skeleton, media queue + `SlideDeckJob`, render token | — |
| **1. Talking points** | Talking Points tab, generation (per slide inline, deck via job), stale flag, filmstrip dot, full-script modal, `.pptx` speaker notes | 0 |
| **2. Editor chrome** | Export menu, split Present button, resizable sidebar, larger text, Narration tab placeholder | 1 |
| **3. Presenter view** | Presenter + audience windows, `BroadcastChannel` sync, timer, pace guide, notes editing in presenter view, grid, black/white, laser, keys, call guidance, Window Management placement, wake lock | 1 |
| **4. Narration storage** | S3 audio, upload (button + drag-and-drop), recording, player, remove, duplicate/delete lifecycle, badges | 0, 2 |
| **5. AI narration + number safety** | Scripts, AI voice per slide and whole deck (job), voice/tone/pause + sample, out-of-date flags, number check / retry / block / confirm, chips, red badges | 4 |
| **6. Narrated playback** | Play narration in presenter view, auto-advance, hold, "Share sound" hint | 3, 5 |
| **7. Chromium on the worker** | Talking-points PDF (job), then video export (job) with progress and cancel | 1, 4 |

Phases 3 and 4 can be built in parallel.

## Verification plan

1. **Side-by-side parity:** for every phase, open the same deck in the desktop app and in Chrome at the same window size, and compare screenshots of each state. These include:
   - empty states;
   - generating;
   - out of date;
   - number check failing;
   - recording (countdown, level meter and timer, then review);
   - presenter view in window and projector modes;
   - black screen;
   - the grid;
   - the "Share sound" hint;
   - export progress.

   Any visual difference that isn't on the "Browser-forced differences" list is a bug.
2. **Unit tests:** the desktop's 57 slide tests pass unchanged in `src/lib/slides/__tests__/`.
3. **Number safety:** reproduce the desktop's slide 7 case. Put "39%" into a script for a slide that says "+29.0%": voicing is blocked with "39% isn't on this slide or in its talking points", and "The numbers are correct" unblocks it. A whole-deck run rewrites an old words-style script with digits.
4. **Jobs:**
   - Whole-deck talking points and narration on a 30-slide deck complete under the watchdog, with progress showing, and Cancel stops them.
   - A document upload by another user during a narration run isn't delayed (media queue isolation).
5. **Presenter view:**
   - keyboard only, from both windows;
   - closing either window ends both;
   - notes edited in presenter view appear in the editor, and vice versa;
   - Chrome with two monitors: the audience window goes full screen on the second screen, swap works, and unplugging falls back to window mode;
   - Firefox: the drag-and-full-screen overlay works.
6. **Calls:** share the audience window in Zoom and Teams, on Windows and on macOS, while presenter view covers it. Change slides and confirm the shared feed follows. If it freezes, the "share as a tab" path must work. Record the result in this spec.
7. **Narrated playback:** clip end + gap advances; slides without audio hold for their target time; Next mid-clip; Pause/Resume; B pauses; the audience window plays no sound.
8. **Video:**
   - Export the desktop test deck: 1920×1080 H.264/AAC, all slides drawn (including the first slide and photos), and audio and silence aligned to the slide boundaries (check with `ffmpeg silencedetect`).
   - Compare frames against the desktop export.

## Decisions needed before starting

These are the recommended defaults the spec is written against. Change them only deliberately.

- **D5 browser support:** full projector behaviour in Chrome/Edge; Firefox/Safari get the drag-and-full-screen fallback.
- **D7 video rendering on the worker with Puppeteer:** this adds about 170 MB of Chromium and system libraries to the EC2 worker. The alternative is in-browser capture, rejected above for fidelity.

---

## Implementation notes (2026-11-13)

All phases (0–7) are implemented. The migration `20261113000000_add_slide_talking_points_narration` has **not** been applied to any real database. Deploy steps are in the README section "Worker: slide talking points, narration and video export".

### Decisions made while building (not in the spec above)

- **Pure modules:** `talkingPoints.js` and `narration.js` are the desktop files with only `module.exports = {` changed to `export {`. The bodies are byte-identical. The same applies to the tests' `require` lines. `differentiation.test.js` was ported too, which is how the count reaches 57.
- **Change events between windows:** "talking points / narration changed in another window" (desktop: `webContents.send` to other windows) uses a `BroadcastChannel('mtd-slides')`, not polling. As on desktop, the window that made the change doesn't receive it. Job progress is polled every 1.5 s, as specified.
- **Long calls stay one call:** the shim's `generateTalkingPoints` (whole deck), `generateNarrationAudio`, `exportTalkingPointsPdf` and `exportDeckVideo` start the job, poll it, and resolve when it finishes. The desktop components still just `await` one call.
- **Inline work gets job rows too:** one slide's talking points, script or voice runs in the route, but still gets a `SlideDeckJob` row with phase `inline` while it runs. This keeps the desktop's "one generation per deck" rule across serverless instances.
  - Inline rows stop counting after 2 minutes; queued and worker rows after 12 minutes.
  - The poll route reports a worker job as failed after 12 minutes without progress.
- **Opening the windows:**
  - The editor's click opens the presenter popup.
  - The presenter window then opens the audience popup by itself. Browsers allow only one popup per click, so this works once pop-ups are allowed for the site.
  - Otherwise presenter view shows an "Open the audience window" card, a browser-forced extension of difference 4. Clicking Open there also asks for the Window Management permission when there is a second screen.
  - The audience window shows "Click to go full screen" on a projector, and the one-time "Drag this window to the projector…" card with "Open as a tab instead" in window mode. On hover it shows small "Open as a tab instead" and "Full screen" buttons.
- **Downloads:**
  - `GET …/download?format=json` returns `{url, filename}`, so the editor can show "Deck saved" or the error. Without the parameter it still redirects (SlidesView's button).
  - All exports live under `slide-exports/<deckId>/`, which the deck delete removes. Use a lifecycle rule on that prefix.
- **Closing the editor tab ends the show**, matching desktop's main-window close.
- **Microphone denied** text: "Allow microphone access for this site in your browser's site settings" (difference 5).

### Video export on small workers (2026-11-14)

- `deck-video` always runs staged, not only above 40 slides:
  1. Render: draw every slide, upload the PNGs and a manifest to `slide-exports/<deckId>/work-<jobId>/`.
  2. Encode: segments one after another, each uploaded. After `VIDEO_STAGE_BUDGET_MS` (default 5 min), the job re-queues itself with `{stage: "encode", next}`, using the same job row, so the client still sees one export.
  3. The stage that encodes the last segment joins them all.

  The work folder is deleted when the export finishes, fails or is cancelled. Verified: a forced 5-second budget produced the identical video across 8 chained stages, and a cancel in the middle of the chain cleaned up.
- **Memory:**
  - ffmpeg is capped at `-threads 2` with `rc-lookahead=5`: about 270–315 MB per encoder, against 525 MB when x264 sized itself to an 8-core machine.
  - The number of encoders running at once is `VIDEO_ENCODE_CONCURRENCY`, which should be 1 on a t3.micro.
  - Measured peak for the whole worker on 2 CPUs: about 440 MB.

### Bugs found and fixed while testing

- **Video:** Puppeteer's clipped `page.screenshot` re-sized the page, and some slides came out black (2–4 of 9 per run). `worker/deckVideo.js` now captures the viewport with `captureBeyondViewport: false` and re-captures once if a frame is completely black: 0 black frames in 27 test captures.
- **Sidebar double-click reset never fired:** the drag overlay mounted on pointer-down and swallowed the double-click. It now mounts on the first move. **The desktop `SlideDeckEditor.jsx` has the same bug** (identical code); the same one-line move fixes it there.

### Verified locally

Test stack: Chrome via Puppeteer, a throwaway Postgres, s3mock behind a virtual-host proxy, ElasticMQ, a fake OpenAI (chat + TTS returning real MP3s), and the desktop's deck 93 with its real clips.

- **Talking points:** generation (deck through the worker, slide inline), autosave, confirm before replacing your edits, full-script modal.
  - `.pptx` notes contain the plain-text points.
  - The PDF is a real 3-page PDF with the formatting.
- **Presenter view:** keys from both windows, number + Enter, grid, B/W and Esc, the laser dot mirrored at the same position.
  - Notes sync both ways; Esc inside the notes doesn't end the show.
  - Esc in the audience window, or closing the presenter window, ends everything, and the editor learns about it.
  - The popup-blocked error, and handing the audience over to a tab.
- **Narration:**
  - Whole deck: scripts in batches of 3; slide 7's "39%" fails the check, gets retried with the correction, then all slides are voiced 3 at a time.
  - Verification §3 exactly: "39% isn't on this slide or in its talking points", the voice refuses, "The numbers are correct" unblocks.
  - MP3 and WAV uploads measured server-side; a fake-mic recording remuxed by the worker (real length written).
  - Remove keeps the script; the voice sample plays; settings persist; the out-of-date flags work.
- **Lifecycle:** duplicate copies the talking points, the clip row and the S3 object. Deck delete empties all four tables and the `slide-audio/`, `slide-exports/` and `slides/` prefixes.
- **Cancel:** stops narration and video mid-run.
- **Narrated playback:** clip + gap advances (7.05 s clip + 1 s gap → about 8.3 s); a slide without audio holds ("Next in 39s"); Next mid-hold; B pauses; "Narration finished". The audience window has no audio element.
- **Video:**
  - 1920×1080 H.264 at 15 fps with 48 kHz AAC; 260.83 s against the 260.75 s timeline.
  - `silencedetect` shows a silence just before every slide boundary.
  - All 9 slides drawn, including the first slide and the photos.
- **Sidebar:** drag, clamp at 800 px, remembered across reload, double-click reset to 380.

### Not verified (needs real hardware or accounts)

- Side-by-side screenshots against the desktop app (§1).
- Two real monitors with Window Management placement, swap and unplug (§5).
- Firefox.
- A real microphone.
- Zoom/Teams sharing on Windows and macOS (§6): record the result here.
- Real OpenAI TTS from the cloud.
- The EC2 Chromium install.
