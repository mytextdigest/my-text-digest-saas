# Workspace UI Redesign — Document & Project Pages (port from desktop)

## Purpose

The desktop app (`/home/johurul/my-text-digest-ws/mytextdigest`, branch `document-page-redesign`) redesigned the **document page** and **project page** as full-window workspaces. The cloud app must look and behave **identically**. Someone switching between desktop and cloud should not be able to tell which one they're in, apart from things only a browser or only Electron can do.

**The desktop code is the source of truth.** Both commits are on the desktop repo's `document-page-redesign` branch:

| Commit | What |
|---|---|
| `a3dc9b3` | Document page redesign + shared chat components, PDF viewer rewrite, answer feedback, CSS fixes |
| `148937d` | Project page redesign |

Read the diffs with `git -C /home/johurul/my-text-digest-ws/mytextdigest show a3dc9b3` and `… show 148937d`, and read the finished files directly. **Copy markup and class names verbatim.** Don't re-derive spacing, colours or sizes from screenshots or this document, which only summarises them.

## What ships

### Both pages
1. **Full-window layout:** the page fills the window under the nav bar, with no 90%-wide container, padding or grey margin. This is opt-in through a `fullBleed` prop on `Layout`.
2. **Draggable splitter between the columns:** a 1px line with a wider invisible hit area and a grip in the middle. It moves with the arrow keys too and is limited to 30–70%. Each page remembers its position in `localStorage` (`split:document`, `split:project`).
3. **One header row (`h-12`) across the page:** the left column's header and the right column's header line up exactly, with a full-width line under them.
4. **Right column has no card:** a header row with tab buttons (filled blue when active, plain otherwise, not underlined) that scroll sideways when space runs out, plus 🗑 clear-chat at the far right, shown only on the Chat tab.
5. **Chat messages (shared `ChatMessage` component):**
   - **Assistant:** no bubble; a neutral violet bot avatar and markdown with real headings and nested lists.
   - **User:** a light-blue bubble with the send time underneath; copy/print/expand appear beside the time on hover.
   - **Action row:** a bordered copy/print/expand group, with 👍/👎 on the right.
6. **👍/👎 feedback** is saved to the database. Clicking the selected thumb again clears it, and "Thanks for the feedback" shows briefly.
7. **New input (`ChatComposer`):**
   - **Above the box:** a **+** button (menu: "Attach image") and removable context chips.
   - **The box:** a multi-line text area that grows up to 40% of the chat panel and then scrolls, with 📎 at the bottom-left and a round send/stop button at the bottom-right.
   - **Keys:** Enter sends, Shift+Enter adds a line, and the input-method composing guard applies.

### Document page
8. **Left header row:** a bordered "← Back" button, the filename (cut off with …), then the viewer's controls. The viewer toolbars render into this header.
9. **PDF viewer:**
   - **Drawing:** only pages near the visible area are drawn, sharp on high-DPI screens, and re-drawn after zoom, resize and rotate.
   - **Controls:** page navigation with an editable page box; zoom −/%/+ with a menu (fit to width, actual size, 50–400%) and Ctrl+scroll; the hand tool; fit to width; a thumbnail strip; rotate; download; print; ⋮.
10. **Controls collapse into ⋮ by available width** (container queries on the header row): below 48rem, thumbnails, the hand tool and fit-to-width move; below 36rem, the −/+ zoom buttons, download and print move. The ⋮ menu only lists the controls that are currently hidden.
11. **Image, DOCX, TXT and spreadsheet viewers** share the same toolbar parts (`FileViewerFrame`). The image viewer zooms by real size, not a CSS transform.
12. **Pinned table** ("Ask about this table"): shown as a removable chip in the composer.

### Project page
13. **Left header row:** "← Back", the project name (the description goes in its tooltip), and a blue **Upload** button.
14. **One controls row:** search, the All / Starred / Unselected pills (a `<select>` when the column is below 36rem), and the grid/list toggle. The big centred title block is removed.
15. **Project chat:** same right-column treatment as the document page, and the same composer with no chips.

### Global CSS fixes (both exist in this repo too, verified)
16. **The invalid global border rule:** `src/app/globals.css:278` `* { border-color: hsl(var(--border)); }` with a hex `--border` is invalid. Because it isn't in a layer, it overrides every Tailwind `border-*` colour, so borders render near-black. Replace it with the desktop's `@layer base { *, ::before, ::after { border-color: var(--border); } }`.
17. **Primary colours as hand-written classes:** they're unlayered (`.bg-primary-500 { … }` near line 101), so every `hover:`/`focus:`/`dark:`/`/opacity` primary variant silently does nothing. Copy the desktop's `@theme inline { --color-primary-50: var(--primary-50); … }` block and **delete all 40 hand-written `.bg/.text/.border/.ring-primary-*` classes**.

## Decisions already made (do not reopen)

- **Visual parity is the goal.** Port the desktop components file by file and keep their class names. Where something must differ, the reason is in the adaptation table below. Don't "improve" the design.
- **No PDF text search,** and no custom title bar or window controls.
- **Assistant avatar:** a neutral `Bot` icon in a violet ring. Not the OpenAI logo.
- **Tabs:** coloured buttons, not underlines; they scroll sideways and don't collapse into a "More" menu.
- **The + menu** has one item today ("Attach image"). Keep it as a list of items so more can be added later.
- **Height cap:** the composer grows up to 40% of the panel (no drag handle).
- **Upload** is in the project header row, and the project **description** is only in the name's tooltip.
- **Chat answers are markdown.** The cloud repo currently forces plain text in three places; all of them must go (Backend §3).
- **Feedback values:** `1`, `-1` or null, plus a timestamp, on both message models.

## Desktop to cloud file map

Paths are relative to each repo's root. "Port" means copy the desktop file, then apply only the adaptations listed in the next section.

| Desktop | Cloud | Action |
|---|---|---|
| `src/components/layout/Layout.jsx` | same | add `fullBleed` (the cloud header is also `h-16`, so `h-[calc(100vh-4rem)]` holds; check that `SubscriptionLayout`/banners don't add height) |
| `src/components/layout/TwoColumnLayout.jsx` | same | port: `resizable` prop, slim divider, `useIsDesktop()` so only one layout variant mounts. The cloud version still mounts both and hides one with CSS, which double-mounts the chat and PDF. |
| `src/app/globals.css` | same | §16 and §17 above |
| `src/styles/scrollbar.css` | same | add `.no-scrollbar` |
| `src/components/documents/document/{DocumentTabs,SummaryTab,GuideTab}.jsx` | same | port. SummaryTab and GuideTab are moved, unchanged, out of `page.jsx`; take the **cloud** page's current summary/guide JSX and data flow, not the desktop's, where they differ. |
| `src/components/documents/viewer/*` (`ViewerToolbar`, `FileViewerFrame`, `ImageViewer`, `PdfPage`, `PdfThumbnails`, `useNearPages`) | same | port (adaptations A1–A4) |
| `src/components/documents/PdfViewer.jsx` | same | port, replacing the cloud version (A1–A4; keep `jumpTo` and highlight behaviour) |
| `src/components/documents/DocumentPreviewModal.jsx` | same, plus `DocumentPreviewBody.jsx` | pass `docId`/`filename` to `PdfViewer`. In the modal the toolbar renders inside the frame, because there's no host. |
| `src/components/chat/MarkdownMessage.jsx` | **new** in cloud | port verbatim, **with** the `variant="rich"` and bold-only-paragraph heading rules; add `react-markdown@^10.1.0` and `remark-gfm` (same versions as desktop `package.json`) |
| `src/components/chat/ChatMessage.jsx` | **new** | port (A5, A6) |
| `src/components/chat/MessageActions.jsx` | same | port (neutral style, `trailing`, `className`) |
| `src/components/chat/MessageFeedback.jsx` | **new** | port (A7) |
| `src/components/chat/ChatComposer.jsx` | **new** | port verbatim |
| `src/components/chat/ChatImages.jsx` | same | add the `AttachFileInput` export, as desktop did |
| `src/components/chat/ExpandedMessageModal.jsx` | same | `align="right"` on `MessageActions`, `variant="rich"` on markdown |
| `src/components/chat/ChatInterface.jsx` | same | port the structure from desktop `148937d` and `a3dc9b3` (A5, A8) |
| `src/components/tables/DerivedTableCard.jsx` | same | port the larger `TableCitationChips` style |
| `src/components/topics/TopicsView.jsx` | same | port the single controls row; Upload removed from the row and the empty state kept |
| `src/app/document/page.jsx` | `src/app/(app)/document/page.jsx` | rebuild `documentPanel`/`chatPanel`/`renderDocument` as on desktop (A1, A9) |
| `src/app/project/page.jsx` | `src/app/(app)/project/page.jsx` | rebuild `documentPanel` and the layout as on desktop |

## Adaptations (the only allowed differences)

**A1. Downloading the original file.** Desktop: `window.api.saveDocumentCopy(docId)`. Cloud: add `GET /api/documents/[id]/download`, which checks the session user owns the document, then redirects (302) to an S3 signed URL with `ResponseContentDisposition: attachment; filename="<original filename>"`. `useDocumentFileActions.download` then just navigates there (`window.location.href = …`, or a temporary `<a>`). A plain `<a download>` doesn't work because the signed URL is on another origin.

**A2. "Open in default app".** Cloud: label it **"Open in new tab"** (keep the `ExternalLink` icon) and `window.open(doc.fileUrl, '_blank', 'noopener')`. Everything else in the ⋮ menu stays the same.

**A3. Printing.** Desktop: the `print-html` and `print-images` IPC calls. Cloud: add `src/lib/printDocument.js` with `printHtml(html)` and `printImages(srcs, title)`.
- **How:** write the same HTML the desktop main process builds (copy the `@page`/`img` print CSS from desktop `electron/main.js`, handler `print-images`) into a hidden `<iframe>`. Wait for its images to load, call `iframe.contentWindow.print()`, then remove the iframe.
- **Results:** return `{ success: true }`, or `{ success: false, error }` on failure.
- **Callers:** the PDF viewer (pages drawn to JPEG data URLs, scale 2), the image viewer (`doc.fileUrl`), and DOCX/TXT (the desktop page's `printableHtml()` helper; copy it).

**A4. pdf.js 2.16 (cloud) vs 3.11 (desktop).** The calls used are all available in 2.16: `getDocument(url).promise`, `getPage`, `page.getViewport({ scale, rotation })`, `page.rotate`, `page.render({ canvasContext, viewport })` returning a task with `.promise`/`.cancel()`, `pdf.destroy()`, and the `RenderingCancelledException` name. Keep the worker path `/pdf/pdf.worker.min.js`. If anything misbehaves, fix it inside `PdfPage.jsx`/`PdfViewer.jsx` without changing the UI. **Don't** upgrade pdfjs as part of this work, because the worker (`worker/runOcr.js`) depends on 2.16.

**A5. Message IDs.** The cloud uses cuid **strings**, and desktop shows thumbs only when `typeof message.id === 'number'`.
- **Mapping:** in both chats' `mapAskResult` and `mapHistoryMessage`, set `id: res.messageId ?? <temp id>` and **`saved: !!res.messageId`** (history rows are always `saved: true`).
- **Thumbs:** `ChatMessage` renders `MessageFeedback` when `feedbackTable && message.saved`. Use `feedbackTable` values `'document'` and `'project'`.
- **Errors and temp messages** (`assistant-error-*`) are never `saved`.

**A6. Messages that generate images.** The cloud saves the assistant message with `status: "generating"` and polls `imageProgress`; desktop shows the progress only in the transient typing row. Keep the cloud's existing rendering of a `generating` message (progress line plus placeholder) and put it *inside* `ChatMessage`'s assistant branch, styled like the desktop's in-progress row: `MarkdownMessage variant="rich"` lead-in, then `<ImageGeneratingPlaceholder status=…/>`. Once it's done, it's an ordinary saved message with thumbs.

**A7. Saving feedback.** Desktop: `window.api.setMessageFeedback({ table, messageId, value })`. Cloud: `POST /api/chat/feedback` with body `{ kind: 'document' | 'project', messageId, value: 1 | -1 | null }` (Backend §2). `MessageFeedback` makes that call; the optimistic update, rollback and "Thanks" timing stay exactly as on desktop.

**A8. Project chat specifics.** The cloud's `ChatInterface.jsx` currently renders messages with its own `renderMessageContent()` (citation linkify over `whitespace-pre-wrap`). Delete it; the desktop's `MarkdownMessage` does citation linkifying (`citation:` links), and `ChatMessage` passes `onCitationClick`. Keep the cloud's message field names: project messages use `type`, not `role`, in places (see `CHAT_IMAGE_ATTACHMENTS_FEATURE_SPEC.md`). Normalise them to `role` in the map functions so `ChatMessage` sees the same shape on both pages.

**A9. Document page data flow.** Keep the cloud page's own loading, polling, conversation start and API calls. Only replace the presentation: the left/right panels, `renderDocument`, the tab bar and the composer. Desktop helpers that only exist because of IPC don't come across; everything visual does.

## Backend implementation

### 1. Prisma migration: answer feedback
Add the following to both `Message` and `ProjectMessage` in `prisma/schema.prisma`:
```prisma
  feedback               Int?                // 1 = helpful, -1 = not helpful, null = none
  feedbackAt             DateTime?    @map("feedback_at")
```
Create the migration `prisma/migrations/20261014000000_add_message_feedback/migration.sql` (two `ALTER TABLE … ADD COLUMN` statements per table; follow the naming and quoting in the existing migrations). Run `npx prisma generate`.

### 2. `POST /api/chat/feedback`
- **Auth:** require a session, and return 401 otherwise.
- **Validation:** `kind ∈ {'document','project'}` and `value ∈ {1, -1, null}`, else 400.
- **Lookup:** find the message with its conversation (`Message → Conversation.userId`, `ProjectMessage → ProjectConversation.userId`). Return 404 unless it exists, `role === 'assistant'`, and its conversation's `userId` equals the session user.
- **Update:** `{ feedback: value, feedbackAt: value === null ? null : new Date() }`, then return `{ success: true }`.
- **Note:** don't trust a client-supplied `userId` (the same rule as for `/api/s3/upload` in the chat attachments spec).

### 3. Allow markdown in chat answers (parity with desktop)
Three places force plain text today.
- **Prompts:** replace the plain-text rules with the desktop wording, verbatim:
  - `src/app/api/documents/[id]/ask/route.js:395` `- Plain text only (no markdown, no bullets, no special formatting).`
  - `src/app/api/projects/ask/route.js:745` `- Plain text only (no markdown, no lists, no special formatting).`

  The desktop wording is in `electron/main.js` around lines 5104 and 5839:
  > You may use light markdown formatting where it aids clarity — **bold** for key terms or figures, short bullet lists for multiple items. Keep it natural and sparing; this is a chat reply, not a report.

  Grep for any other plain-text rule on a **chat answer** path (the general-knowledge follow-up, the KG/tables answer prompts) and align it the same way. Leave non-chat prompts alone (slides outline, chart JSON, summaries).
- **Stripping step:** remove `stripMarkdownArtifacts(...)` from every chat answer path. There are 11 calls:
  - `documents/[id]/ask/route.js`: lines 523, 573 and 626
  - `projects/ask/route.js`: lines 436, 478, 523, 830, 902, 950 and 999
  - `chat/respond-general-knowledge/route.js`: line 60

  Keep the function in `src/lib/textFormat.js` if anything else still imports it; otherwise delete it. Old saved answers are already plain text and still render fine.
- **Copy/print:** `src/lib/messageActions.js` `stripMarkdown` stays as it is; it's for copying and printing, not display.

### 4. Return the stored `messageId` from every assistant write
Each `prisma.message.create`/`prisma.projectMessage.create` with `role: "assistant"` must capture the created row and add **`messageId: created.id`** to the JSON response for that path. There are 19 sites today:
- `documents/[id]/ask/route.js`: lines 275, 465, 529, 579 and 642
- `projects/ask/route.js`: lines 442, 482, 534, 646, 855, 908, 956 and 1015
- `chat/respond-general-knowledge/route.js`: lines 89 and 118
- `chat-attachments/[id]/improve/route.js`: line 47
- `src/lib/chatImages/turn.js`: lines 47 and 56 (`finish()`, used by the image turn)

Error replies that are saved as assistant messages (`status: "error"`) can return their ID too; the UI won't show thumbs on them because they're built as error messages.

### 5. Include `feedback` in history
Every endpoint that returns chat history (document conversation messages, and `GET /api/projects/messages` or its equivalent) must include `feedback` on each message. The front-end mappers read `m.feedback ?? null`.

## Frontend implementation order

1. **CSS fixes (§16–17), `no-scrollbar`, `Layout` `fullBleed`, `TwoColumnLayout`.** Check other pages for unintended changes; hover, focus and dark states starting to work is intended.
2. **`MarkdownMessage` + dependencies, then `MessageActions`, `ChatMessage`, `MessageFeedback`, `ChatComposer`, `AttachFileInput`, `TableCitationChips`.**
3. **Backend §1–5.**
4. **Viewer parts (`viewer/*`), `PdfViewer`, `printDocument.js`, the download route.**
5. **Document page rebuild:**
   - `ViewerToolbarHost` provider with `toolbarHost` state and `useMemo` slot;
   - the left header row with `@container`;
   - the frameless viewers;
   - the right header row with `DocumentTabs` and 🗑;
   - `ChatComposer` with the pinned-table chip.
6. **Project page rebuild:** `TopicsView`, the header row with Upload, `ChatInterface`, and `resizable="project"`.

## Watch out for

- **Tailwind only generates classes written out in full in the source.** The collapse classes live in the `COLLAPSE` map in `ViewerToolbar.jsx` as full strings (`"hidden @xl:inline-flex"`, `"hidden @xl:block"`, `"@xl:hidden"`, and the `@3xl` equivalents). Never build them with string replacement.
- **Container queries** need `@container` on an **ancestor**: the left header row (hosted toolbars), the in-frame toolbar wrapper (preview modal), and the `TopicsView` controls row.
- **`ViewerToolbar` returns `null` until the host element exists** (`slot && !slot.host`), so the toolbar never flashes inside the frame.
- **`TwoColumnLayout` uses `useIsDesktop()`** (matchMedia `min-width: 1024px`) to mount one variant only. This also stops the hidden mobile copy from loading the PDF a second time.
- **The PDF viewer uses `scrollbarGutter: 'stable'`** so fit-to-width can't flip back and forth as the scrollbar appears and disappears. Keep it.
- **Zoom steps read `zoomRef.current`,** which is updated eagerly, so rapid clicks step correctly.
- **Dark mode in the cloud comes from `next-themes`** (`attribute="class"`), so the desktop `dark:` classes work unchanged.

## Verification plan

**Look at the desktop app first.** Run the desktop app (in `mytextdigest`: `npm run dev`) and the cloud app (`npm run dev` and `npm run dev:worker`) side by side at the same window size (1600×1000), with the same document (upload the Northwind annual report PDF to both) and the same chat question. Compare the following, in light **and** dark mode:

1. **Document page, Chat tab:** the header row lines up across both columns; there's no outer margin, card or frame; the toolbar buttons and their order match; the composer matches.
2. **Narrow the left column with the splitter:** controls move into ⋮ at the same widths, and the menu lists only the hidden items.
3. **PDF viewer:**
   - **Toolbar controls:** thumbnails, zoom ±, the % menu, Ctrl+scroll, hand-drag, rotate, and page input + Enter.
   - **"Show in document" from the Tables tab:** the highlight box lands on the table.
   - **High-DPI:** pages are sharp (`canvas.width === clientWidth × devicePixelRatio`).
4. **Download** saves the file with its original name, **Print** opens the print dialog with every page, and **Open in new tab** works. Check these for a PDF, an image, a DOCX and a TXT.
5. **Ask a question that produces headings and bullets** ("What does the table Revenue by Region show?"). "Key Insights" should render as an 18px heading, with nested-list bullets and a larger citation chip.
6. **👍** on a **new** answer, then reload: it's still filled, and the database row has `feedback = 1` and `feedback_at` set. Click again to clear it, then reload: it's empty and both fields are null. Repeat in project chat.
7. **Composer:**
   - **Growth:** grows at 3 lines, is capped at 40% of the panel and scrolls.
   - **Keys:** Enter sends, Shift+Enter adds a line, and Enter with nothing typed sends nothing.
   - **Attachments:** + → Attach image and 📎 both open the file picker.
   - **Pinned table:** "Ask" on a table shows the chip, and × removes it.
8. **Project page:**
   - **Header row:** Back, name with tooltip, and Upload, lined up with the tabs row.
   - **Controls row:** the filter pills become a `<select>` when the column is narrow.
   - **Splitter:** its position is saved under `split:project`, independently of `split:document`.
   - **Tabs:** 🗑 only on the Chat tab; Graph, Comparisons and Tables still work.
9. **Narrow window (< 1024px):** the single-column variant with the Documents/Chat switcher; only one copy of each column is mounted.
10. **Other pages** (home, settings, slides, compare): nothing broken by the CSS fixes. Primary hover and focus states now work, which is intended.
