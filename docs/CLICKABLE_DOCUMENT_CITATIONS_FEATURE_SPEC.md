# Clickable Document Citations in Project Chat — Implementation Spec (Cloud/SaaS)

## Purpose

This document is the liaison spec for porting the "clickable document names in chat
answers" feature from the desktop Electron app (`mytextdigest`) to this cloud/SaaS
codebase. The desktop version is already built and working — this spec captures the
final design **and** the UX decisions that were explicitly discussed and locked in
along the way, so the implementing agent doesn't have to re-litigate them. Follow this
as the source of truth.

The two codebases are close ports of each other — confirmed while researching this
spec: `src/app/api/projects/ask/route.js` here mirrors the Electron app's
`ask-project` IPC handler almost line for line, and `src/app/(app)/document/page.jsx`
mirrors the Electron `document/page.jsx` (same per-file-type preview switch, same
`mammoth`/`PdfViewer` usage). Most of the design below transfers directly. The
differences that do NOT transfer (S3 signed URLs instead of local file paths, fetch
calls instead of Electron IPC, Prisma instead of better-sqlite3) are called out
explicitly in each section.

## What ships

- In **project chat only** (`src/components/chat/ChatInterface.jsx` / backend
  `src/app/api/projects/ask/route.js`), when the assistant's answer names a specific
  document by its exact filename (e.g. `the image titled "report.png"`), that
  filename renders as a clickable element **inline, inside the same text bubble** —
  not pulled out into a separate "Sources" list below the message.
- Clicking it opens a **modal preview** of that document (reusing the existing
  per-file-type preview rendering: txt / pdf / docx / image / xlsx / xls / csv).
- The modal has an **"Open Document View"** button that navigates to the full
  `/document?id=...` page (with the full chat-about-this-doc / summary / reading-guide
  experience) and closes the modal.
- Single-document chat (`src/app/api/documents/[id]/ask/route.js`, used from
  `document/page.jsx` itself) is **out of scope** — the user is already looking at
  that document, a citation link back to itself is meaningless.

## Locked-in decisions (do not relitigate)

**Inline-clickable text, not a separate sources/citations list.** Inline keeps the
reference exactly where the user's eye already is when reading the answer, instead of
making them cross-reference a "Source: report.png" list below the bubble. This was a
deliberate choice discussed with the user — do not replace it with a footnote-style
citation list.

**A modal preview, not full-page navigation, on click.** In this app's project view,
chat lives in a panel alongside the document list — navigating straight to
`/document?id=...` would blow away the chat scroll position/context, which is
disruptive mid-conversation. A modal keeps the user in the chat. The modal is not a
dead end, though: it has an explicit "Open Document View" button for users who want
the full page (reading guide, per-document chat, summary tabs, zoom/scroll — none of
which the modal tries to replicate). This two-tier design (quick peek vs. full view)
was the user's explicit direction after weighing both options.

**Only documents the model actually names become links — not every retrieved
document.** The RAG context sent to the LLM may include several documents' chunks,
but only the ones the model's answer text actually quotes by filename get turned into
citations. This is enforced by computing citations as *documents whose exact filename
string appears in the final answer text* (see Backend section) — not "all documents
used to build context." Do not change this to "all retrieved docs are citations"; it
would make nearly every answer covered in links regardless of what it actually
discusses.

**Matching is exact-substring, not fuzzy — because the system prompt makes the model
quote filenames verbatim.** No markdown parser or NLP is introduced. The chat already
renders plain text (`whitespace-pre-wrap`, no `react-markdown`, no
`dangerouslySetInnerHTML` for messages) — keep it that way. A single added line in the
system prompt (see below) instructs the model to reproduce the filename exactly as
given in the `Document:` context label, including the extension. Given that, an exact
`String.includes()` check server-side and a regex-escaped split client-side are
sufficient and reliable. Do not attempt semantic/fuzzy filename matching — it's
unnecessary complexity for a problem the prompt already solves.

## Citation contract (schema)

Attached to an assistant `ProjectMessage`, mirroring the existing `chartData Json?
@map("chart_data")` pattern already on that model:

```json
{
  "citations": [
    { "id": "cuid-of-document", "filename": "Screenshot from 2023-12-21 18-59-13.png" }
  ]
}
```

- `citations: null` (or omitted) is the normal case — most answers don't name a
  specific document.
- Only include a document if its filename literally appears in the final answer text.
- `id` is the `Document.id` (cuid) — used directly by the frontend to open
  `GET /api/documents/[id]` for the preview modal.

## Backend implementation

### Prisma schema migration

Add `citations` to `ProjectMessage` **only** — do not add it to `Message` (the
single-document chat model); that surface is out of scope per "What ships" above, and
adding an unused column there is pure noise.

```prisma
model ProjectMessage {
  id             String              @id @default(cuid())
  role           String?
  content        String?
  status         String?             @default("done")
  createdAt      DateTime            @default(now()) @map("created_at")
  conversationId String              @map("conversation_id")
  chartData      Json?               @map("chart_data")
  citations      Json?               @map("citations")
  conversation   ProjectConversation @relation(fields: [conversationId], references: [id])
}
```

Run `npx prisma migrate dev --name add_citations_to_project_messages`.

### Wiring into `src/app/api/projects/ask/route.js`

Two call sites currently build an `assistantText` and persist it: the BM25 fallback
branch (~line 309, "embeddings not ready") and the main cosine-similarity branch
(~line 464). **Only the main branch needs citations** — the BM25 branch is a
transient state while embeddings are still being generated and isn't worth the extra
code path; leave it returning `{ success: true, answer: assistantText }` unchanged.

In the main branch, after `assistantText` is computed (~line 464-466) and before the
`prisma.projectMessage.create` call (~line 474):

```js
// Citations: documents whose exact filename was quoted in the answer.
// `allChunks` (built earlier at ~line 230) already carries { documentId, documentName }
// per chunk — dedupe to one entry per document, then keep only the ones the model
// actually named.
const uniqueDocs = new Map();
for (const c of allChunks) {
  if (!uniqueDocs.has(c.documentId)) uniqueDocs.set(c.documentId, c.documentName);
}
const citations = [...uniqueDocs.entries()]
  .filter(([, filename]) => filename && assistantText.includes(filename))
  .map(([id, filename]) => ({ id, filename }));
```

Persist and return it:

```js
await prisma.projectMessage.create({
  data: {
    conversationId: conv.id,
    role: "assistant",
    content: assistantText,
    status: "done",
    citations: citations.length ? citations : undefined,
  },
});

return NextResponse.json({ success: true, answer: assistantText, citations });
```

(Prisma stores a JS array directly into a `Json?` column — no `JSON.stringify` needed,
unlike the Electron app's raw-SQL `TEXT` column which does require stringifying. Don't
copy the `JSON.stringify`/`JSON.parse` dance from the Electron reference — it's a
SQLite-specific workaround that doesn't apply here.)

Add one line to the system prompt (~line 434, right after "Response format: - Plain
text only..."):

```
- When you refer to a specific document by name, quote its filename exactly as it
  appears after "Document:" in the context above (including the extension), so it can
  be linked back to the source.
```

The three early-return blocking paths (unselected-document mention, etc., ~lines
165-221) should **not** compute citations — they return canned strings, not
RAG-grounded answers, so there's nothing meaningful to cite. Leave them as-is.

### Wiring into `src/app/api/projects/messages/[projectId]/route.js`

The current `mapped` array (~line 34-41) doesn't select `citations` at all (it also
doesn't select `chartData` yet, interestingly — that's a pre-existing gap in the
charts feature, not something to fix here, but don't let it make you think citations
are unnecessary to add). Prisma's default `findMany` already returns all scalar
columns including `citations` once it exists on the model, so just add it to the
mapped shape:

```js
const mapped = messages.map((m) => ({
  id: m.id,
  conversationId: m.conversationId,
  role: m.role,
  content: m.content,
  status: m.status,
  citations: m.citations || null,
  timestamp: m.createdAt,
}));
```

### Security note (no new surface introduced)

The `{id, filename}` pairs in a citation are already scoped to documents the
requesting user owns — `docIds` upstream in `ask/route.js` comes from
`prisma.document.findMany({ where: { projectId, selected: 1 } })`, and `projectId`
itself was verified against `session.user.email` at the top of the route. When the
frontend later opens the preview modal via `GET /api/documents/[id]`, that route
independently re-checks `user: { email: session.user.email }` before returning
anything. So even a tampered citation `id` can't leak another user's document — this
is defense in depth that already exists, not something new to build.

## Frontend implementation

### Rendering clickable filenames — `src/components/chat/ChatInterface.jsx`

Add a small helper above the component (not a new file — this is ~15 lines and only
used here):

```jsx
// Splits message text on cited document filenames and renders each one as a clickable button.
const renderMessageContent = (content, citations, onCitationClick) => {
  if (!citations?.length) return content;

  const names = citations.map(c => c.filename).filter(Boolean);
  if (!names.length) return content;

  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'g');

  return content.split(pattern).map((part, i) => {
    const citation = citations.find(c => c.filename === part);
    if (!citation) return part;
    return (
      <button
        key={i}
        type="button"
        onClick={() => onCitationClick(citation)}
        className="font-medium underline decoration-dotted underline-offset-2 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
      >
        {part}
      </button>
    );
  });
};
```

The regex-escape step matters — filenames routinely contain `.`, `(`, `)`, `[`, `]`
(e.g. `Screenshot from 2023-12-21 18-59-13.png`) which are regex metacharacters.
Skipping the escape will silently mis-split or throw on such names.

Wire it in three places:

1. **State**: add `const [previewDocumentId, setPreviewDocumentId] = useState(null);`
   next to the other UI state.
2. **Message bubble** (~line 375-377): replace `{message.content}` with
   `{renderMessageContent(message.content, message.citations, (c) => setPreviewDocumentId(c.id))}`.
3. **Data plumbing**: both places messages enter local state need `citations` carried
   through — the initial load from `GET /api/projects/messages/[projectId]` (map
   `citations: m.citations || null`) and the response of a new `POST
   /api/projects/ask` call (`citations: res.citations || null` on the new assistant
   message object).
4. **Mount the modal** at the bottom of the component, alongside the existing
   `ExpandedMessageModal`:
   ```jsx
   {previewDocumentId && (
     <DocumentPreviewModal
       documentId={previewDocumentId}
       onClose={() => setPreviewDocumentId(null)}
     />
   )}
   ```

### `DocumentPreviewModal` — new component

Recommend creating `src/components/documents/DocumentPreviewModal.jsx`. Style it after
the existing `src/components/modals/DeleteConfirmationModal.jsx` (backdrop +
`AnimatePresence`/`framer-motion` scale-in, `onClick` on the backdrop closes, a nested
`onClick={(e) => e.stopPropagation()}` div for the modal body) so it matches the rest
of the app's modal chrome, sized larger (e.g. `max-w-4xl h-[85vh]`) to fit a document
preview.

**Important — avoid duplicating the ~250-line `renderDocument()` switch.** The
Electron reference implementation duplicated its per-file-type rendering logic between
`document/page.jsx` and the new modal (acceptable there since it was a small, already
time-boxed change). Here, `document/page.jsx` is already 1580 lines, and this app's
`renderDocument()` (~line 754-870+) is essentially identical in structure to Electron's.
**Extract the per-type preview body into a shared component**, e.g.
`src/components/documents/DocumentPreviewBody.jsx`, taking `{ doc, docxHtml,
spreadsheetData, activeSheetIndex, onActiveSheetChange, imageZoom, onImageZoomChange
}` as props, covering the `txt` / `pdf` / `docx` / image / spreadsheet branches
currently in `renderDocument()`. Have both `document/page.jsx` and the new
`DocumentPreviewModal` import and render it. This is a refactor the Electron app
didn't need to do (single desktop codebase, less pressure to keep it lean) but is the
right call here given the file size and that this is a fresh cloud implementation, not
a quick port. Skip the reading-guide/scroll-tracking props (`onScroll`, page
detection) — the modal doesn't need progressive-reading behavior, only pdf/docx/txt's
plain scroll body.

Cloud-specific data loading inside the modal (all differ from the Electron IPC calls —
use the same client-side patterns `document/page.jsx` already uses, since storage is
S3-backed here, not local files):

```jsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import mammoth from 'mammoth';
// ... AnimatePresence/motion, icons, Button, DocumentPreviewBody

export default function DocumentPreviewModal({ documentId, onClose }) {
  const router = useRouter();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [docxHtml, setDocxHtml] = useState(null);
  const [spreadsheetData, setSpreadsheetData] = useState(null);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [imageZoom, setImageZoom] = useState(1);

  useEffect(() => {
    if (!documentId) return;
    setLoading(true);
    fetch(`/api/documents/${documentId}`)
      .then((r) => r.json())
      .then(setDoc)
      .catch((err) => console.error('Error loading document preview:', err))
      .finally(() => setLoading(false));
  }, [documentId]);

  useEffect(() => {
    if (doc?.filename?.endsWith('.docx') && doc?.fileUrl) {
      fetch(doc.fileUrl)
        .then((res) => res.arrayBuffer())
        .then((buffer) => mammoth.convertToHtml({ arrayBuffer: buffer }))
        .then((result) => setDocxHtml(result.value))
        .catch((err) => console.error('DOCX render error:', err));
    }
  }, [doc]);

  useEffect(() => {
    const ext = doc?.filename?.split('.').pop()?.toLowerCase();
    if (!doc?.id || !['xlsx', 'xls', 'csv'].includes(ext)) return;
    fetch(`/api/spreadsheet-data?documentId=${doc.id}`)
      .then((r) => r.json())
      .then((res) => res?.success && setSpreadsheetData(res.sheets))
      .catch((err) => console.error('Spreadsheet preview error:', err));
  }, [doc?.id]);

  const handleOpenFullView = () => {
    if (!doc) return;
    router.push(`/document?id=${doc.id}`);
    onClose?.();
  };

  // ... Escape-key handler, backdrop click, header with filename + "Open Document
  // View" button + close button, <DocumentPreviewBody .../> body — same shape as the
  // Electron reference DocumentPreviewModal.jsx.
}
```

Reuses that already exist and need no changes: `GET /api/documents/[id]` (ownership +
S3 signed `fileUrl`, already returns everything needed), `GET
/api/spreadsheet-data?documentId=...` (already ownership-checked server-side — verify
this if not already true, since it's called directly from the modal now, a second call
site), and `src/components/documents/PdfViewer.jsx` (`fileUrl` prop is already a
signed URL — works unmodified).

## Verification plan

- Ask a project-chat question whose answer names a specific document (e.g. "is there
  an image with company logos?") — the filename in the reply renders visibly distinct
  (underlined) and clickable; plain answers that don't name a document render
  unchanged (no regression to the plain-text path).
- Click the filename → modal opens showing the correct preview for each file type:
  txt, pdf, docx, image (with zoom controls), xlsx/xls/csv (with sheet tabs if
  multi-sheet).
- "Open Document View" button navigates to `/document?id=...` for the right document
  and the modal closes.
- Escape key and backdrop click both close the modal without navigating.
- Reload the page (or revisit the project) — previously-asked questions still show the
  filename as clickable after being reloaded from `GET
  /api/projects/messages/[projectId]` (i.e. `citations` survives the round trip through
  Postgres, not just the initial POST response).
- A document filename containing parentheses/brackets/multiple dots (e.g. `Screenshot
  from 2023-12-21 18-59-13.png`) still matches and splits correctly — this is the
  regex-escaping edge case called out above.
- An answer naming two different documents renders both as independently clickable,
  each opening its own document in the modal.
- Single-document chat (`document/page.jsx`'s own chat panel) is completely unaffected
  — no citations column read/written there, no clickable text introduced.
- A user cannot open another user's document by guessing/tampering a citation `id` —
  `GET /api/documents/[id]` 404s for non-owned documents, same as today.
