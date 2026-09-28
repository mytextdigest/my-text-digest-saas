# Charts & Graphs in Chat — Implementation Spec (Cloud/SaaS)

## Purpose

This document is the liaison spec for porting the "charts and graphs in chat" feature
from the desktop Electron app (`mytextdigest`) to this cloud/SaaS codebase. The desktop
version is already built, tested, and debugged — this spec captures the final design
**and** the specific mistakes made and fixed along the way, so they aren't
re-discovered here. Follow this as the source of truth; it is more current and more
detailed than re-deriving the feature from scratch would be.

The two codebases are close ports of each other (confirmed while researching this
spec: `src/app/api/documents/[id]/ask/route.js` here is close to line-for-line
the same logic as the Electron app's `ask-document` IPC handler), so most of the
design below transfers directly. The differences that do NOT transfer are called out
explicitly in each section.

## What ships

- Chart generation available in **both** chat surfaces: document chat
  (`src/app/(app)/document/page.jsx`, backend `src/app/api/documents/[id]/ask/route.js`)
  and project chat (`src/components/chat/ChatInterface.jsx`, backend
  `src/app/api/projects/ask/route.js`).
- **All 5 chart types from day one**: bar, line, area, pie, scatter. No phased rollout.
- **PNG is the only export format**, uniform across all chart types. No SVG/CSV export.
- Charts are additive: if generation fails or the data doesn't support a chart, the
  normal text answer is unaffected — the chat surfaces behave exactly as they do today
  when no chart is produced.

## Locked-in decisions (do not relitigate)

**Do not use an image-generation model (DALL·E / gpt-image) to draw charts.** Two
reasons: it is the most expensive option per chart, and diffusion image models cannot
reliably encode exact numbers — bars end up the wrong height, labels get garbled,
legends mismatch the data. They are bad at the one thing a chart needs to be: precise.

The correct pattern, used here: the LLM emits a **small structured JSON chart spec**
(numbers + labels only, no visual styling), the app renders it deterministically with a
real charting library (Recharts), and that rendered chart is rasterized client-side to
PNG for download. This is simultaneously the cheapest option (near-zero marginal token
cost, gated behind a keyword trigger so it essentially never fires on non-chart
questions) and the most accurate one (no hallucinated axis values) — there is no
cost/quality tradeoff to manage here.

## Chart spec schema (contract between backend and frontend)

```json
{
  "chart": {
    "type": "bar" | "line" | "area" | "pie" | "scatter",
    "title": "string, <=120 chars",
    "xAxisLabel": "string, optional, ignored for pie",
    "yAxisLabel": "string, optional, ignored for pie",
    "categories": ["string", "..."],   // <=50 entries; x-axis / pie slice labels; UNUSED for scatter
    "series": [
      { "name": "string", "data": [number, ...] }        // bar/line/area/pie: parallel to categories
      // scatter only: "data": [{ "x": number, "y": number }, ...]
    ]  // 1-6 series
  } | null
}
```

`chart: null` is the explicit "don't show a chart" signal. There are **no color/styling
fields** — colors are assigned entirely client-side from a validated palette, never
trusted from the model (see Frontend section).

## Server-side validation

Write a pure, synchronous `validateChartSpec(rawJsonString, fallbackTitle)` function
that **never throws** and always degrades to `{ chart: null }` on any problem (bad
JSON, bad type, empty data, etc.) — a malformed or hallucinated response must never
break the chat response, only silently omit the chart.

Rules:
1. `JSON.parse` in try/catch → parse failure = no chart.
2. Allowlist `type` against the 5 values; anything else = no chart.
3. Truncate `title`/axis labels to length caps; synthesize a title from the question if
   the model omits one.
4. Cap `categories` to 50 entries, `series` to 6 — **truncate**, don't reject, if the
   model overshoots.
5. Coerce every data value through `Number()`.

   > **Gotcha hit in the reference implementation, fixed — do not repeat it:** the
   > first version of this validator *filtered out* non-finite values
   > (`.filter(v => v !== null)`). That's a real bug: dropping an entry from the middle
   > of a parallel array shifts every subsequent value out of alignment with
   > `categories` (e.g. a bad 3rd value silently made the 4th value render under the
   > 3rd category's label). The fix: **map non-finite values to `null` in place**,
   > never filter/drop them. `null` is a valid "gap" value for bar/line/area charts —
   > Recharts renders it as a gap, not a shift. Only drop a whole series if *every*
   > value in it is null.
6. For scatter, each point needs a finite `x` and `y`; drop invalid points (dropping
   whole `{x,y}` pairs is fine here since scatter points aren't positionally parallel
   to anything else).
7. If after coercion `categories` is empty (non-scatter) or every series is empty,
   degrade to `chart: null`.

## Prompt design

Two things matter here, both already fixed in the reference implementation — build
them in from the start rather than discovering them again:

### 1. The model reliably fills `categories` for bar/line, but not for pie, unless told to

**Bug hit in the reference implementation:** for a pie chart request, the model
consistently returned the right numbers but an **empty `categories` array** — it maps
"categories = x-axis ticks" intuitively for bar/line, but doesn't automatically map
"categories = slice labels" for pie. The validator correctly rejected the empty-labels
response (a chart with numbers and no labels is useless), so this is a prompt problem,
not a validation bug.

**Fix — bake this into the system prompt from the start:**

```
"categories" is REQUIRED and must have exactly one label per data point, in the same
order as each series' "data" array — this applies to EVERY type, including "pie": for a
pie chart, "categories" holds the slice labels (e.g. ["Engineering", "Marketing"]) and
"series" has exactly one entry whose "data" holds the matching slice values (e.g. [34, 18]).
Never leave "categories" empty for a non-scatter chart.
For "scatter" only, each series' "data" must be [{"x": number, "y": number}, ...] instead,
and "categories" is omitted. Use at most 6 series and 50 categories.

Example for a pie chart: {"chart": {"type": "pie", "title": "Budget by Department",
"categories": ["Engineering", "Marketing", "Support"],
"series": [{"name": "Budget", "data": [34, 22, 18]}]}}
```

The worked example at the end matters — it's what reliably anchors the model's format
for pie specifically (verified with 5/5 repeated live calls after adding it, vs.
consistent failure before).

### 2. The order of the two OpenAI calls matters — chart-spec call must run BEFORE the main text answer

**Bug hit in the reference implementation:** the first version ran the main text
answer first, then separately generated the chart spec, then attached it to the
response. Since the two calls are independent, when a user asked "please make a pie
chart," the *text* model (which has no idea a chart is coming) correctly-per-its-own-
instructions answered "I cannot create a chart, I can only provide text responses" —
while a valid chart was silently attached below it anyway. Text and chart contradicted
each other.

**Fix — generate the chart first, then tell the main-answer prompt what happened:**

```js
// 1) Detect intent and generate the chart spec FIRST, before the main answer call.
const wantsChart = detectChartIntent(question);
let chartSpec = null;
if (wantsChart) {
  chartSpec = await generateChartSpec({ openai, question, contextText, extraData, signal });
}

// 2) Inject a note into the main answer's system prompt reflecting the outcome.
const chartNote = !wantsChart ? "" : chartSpec
  ? `\nA ${chartSpec.type} chart has been generated from the document data and will be displayed ` +
    `to the user right below your answer. Do NOT say you are unable to create charts or visuals, ` +
    `and do not claim you can only provide text — instead briefly acknowledge the chart is shown ` +
    `below, and still give a concise text summary of the data.`
  : `\nA chart could not be generated from the available document data for this request. Briefly ` +
    `let the user know a visual isn't available this time, then answer with the information in text form.`;

// 3) Append chartNote to the existing systemMsg.content (both ask-document and ask-project
//    system prompts already end with a "Rules"/"Constraints" block — append chartNote after it).
```

This only changes the *order* of the two calls, not the count (still 1 call when no
chart is requested, 2 when one is) — no added cost for the common case, and the two
responses can never contradict each other again. Verified live: with a chart
successfully generated, the text answer changed from "I cannot create a pie chart..."
to "The pie chart... is shown below." — and the no-chart branch reads as "A visual
isn't available this time, but I can provide the information in text form" rather than
just silently omitting any mention of a chart.

## Detection heuristic (keep it cheap)

Do **not** run a separate classification LLM call to decide "is this a chart
request" — that doubles API cost for every single message. Use a plain keyword
check, matching the style of the existing `isGenerative`/keyword-trigger pattern
already used in this codebase's project-ask route (unselected-document / generative-
intent detection):

```js
const CHART_TRIGGERS = [
  "chart", "graph", "plot", "visualiz", "visualis",
  "pie chart", "bar chart", "line chart", "trend",
  "breakdown", "distribution", "compare", "over time",
];
function detectChartIntent(question) {
  if (!question) return false;
  const q = question.toLowerCase();
  return CHART_TRIGGERS.some((word) => q.includes(word));
}
```

This has false negatives (a chart request that doesn't use any of these words won't
trigger) — that's an accepted tradeoff, not a bug: it costs nothing for the ~95% of
messages that aren't chart requests, and a missed request just means the user gets a
text answer and can re-ask more explicitly. Since this SaaS runs on **per-user OpenAI
keys** (`getUserOpenAIKey`, `src/utils/key_helper.js`), keeping the trigger cheap and
conservative matters even more here than in the desktop app — a false positive burns a
user's own quota on a wasted call.

## Backend implementation

### New shared module

Create `src/lib/chartSpec.js` (matching the existing convention of shared
non-component logic living in `src/lib/`, alongside `messageActions.js` and
`requestCancellation.js`), exporting:

- `detectChartIntent(question)` — the heuristic above.
- `buildChartPrompt({ question, contextText, extraData })` → `{ system, user }` message
  pair, with the pie-categories instruction and worked example baked in as described
  above.
- `validateChartSpec(rawJsonString, fallbackTitle)` — the validator above.
- `generateChartSpec({ openai, question, contextText, extraData, signal })` —
  orchestrates: build prompt → one `openai.chat.completions.create(...)` call with
  `response_format: { type: "json_object" }` → validate → return the normalized spec or
  `null`. **Never throws** — catch everything internally.
  - Also log `console.warn("generateChartSpec: no chart after validation, raw model
    output:", content)` whenever parsing succeeds but validation still returns `null`.
    This was added after a real debugging session where a silently-dropped chart was
    completely invisible — don't skip this, it's cheap and it's the only way to
    diagnose the next prompt-format mismatch that comes up.

### Prisma schema migration

Add a nullable JSON column to both message models (this repo already uses `Json?` for
flexible payloads — see `Chunk.embedding`/`Chunk.metadata` and
`Topic.centroidEmbedding`/`Topic.keywordDistribution` — so this is a native Postgres
`jsonb` column here, cleaner than the desktop app's `TEXT` + manual
`JSON.stringify`/`JSON.parse`, though the round-trip is otherwise identical):

```prisma
model Message {
  // ...existing fields
  chartData Json?  @map("chart_data")
}

model ProjectMessage {
  // ...existing fields
  chartData Json?  @map("chart_data")
}
```

Run `npx prisma migrate dev --name add_chart_data_to_messages`. Since Prisma's `Json?`
already round-trips objects natively, you do **not** need to `JSON.stringify`/`JSON.parse`
manually the way the desktop SQLite version does — just pass `chartSpec` (or `null`)
directly as the Prisma `data.chartData` value.

### Wiring into `src/app/api/documents/[id]/ask/route.js`

The context string is built as `contextText` around line 199 of the current file.
Insert the chart-generation step right after that (before `systemMsg` is constructed at
line 217), following the call-ordering fix above:

1. `const wantsChart = detectChartIntent(question);`
2. If the document is a spreadsheet (check the file extension the same way `isImage`
   is already checked at line 244-246), fetch precise row data via the existing
   `GET /api/spreadsheet-data?documentId=` logic (or call its underlying parsing
   function directly server-side — don't round-trip through HTTP) instead of relying on
   the lossy top-8 `contextText` chunks. Pass a capped, `Number()`-coerced subset as
   `extraData`.
3. Call `generateChartSpec({ openai, question, contextText, extraData, signal:
   controller.signal })` — reuse the same `controller` already created for
   cancellation (line 23-24) so a cancelled request aborts both calls with zero new
   plumbing.
4. Build `chartNote` and append it into `systemMsg.content` before the main
   `chat.completions.create` call at line 263.
5. In the `prisma.message.create` call that persists the assistant reply (line
   325-330), add `chartData: chartSpec` (Prisma serializes `null` fine).
6. Add `chart: chartSpec` to the route's JSON response alongside `success`/`answer`.
7. Also update wherever chat history is loaded (`GET` handler / `getMessages`
   equivalent) to include `chartData` in the Prisma `select`, and pass it through to
   the client as `chart` on each message — so reloading the page still shows
   previously-generated charts.

### Wiring into `src/app/api/projects/ask/route.js`

This route has **more branching** than the document version — during research two
separate context/systemMsg construction sites were found (one around lines 264-297,
apparently a single-document-mentioned fast path, and a general multi-document path
around lines 392-474). Apply the same pattern — generate the chart before the answer,
inject `chartNote` into whichever `systemMsg` is actually used, persist `chartData` on
the `prisma.projectMessage.create` call, return `chart` in the response — to **each**
branch that actually reaches an `openai.chat.completions.create` call for a
question-with-context. Branches that short-circuit with a canned answer (e.g.
unselected-document blocking, if this route has similar guard rails to the desktop
version) should skip chart generation entirely, same as the text-answer call is skipped
there.

Additional data source unique to project chat: when the question also references
topics/categories (keyword match: `"topic"`, `"cluster"`, `"categor"`, `"group"`),
fetch topic counts via the same query the existing
`GET /api/projects/[id]/topics` endpoint uses
(`{ id, name, documentCount }` sorted by `documentCount desc`) and pass as a second
`extraData` channel — this lets a "documents per topic" chart use exact counts instead
of guessing from retrieved chunks.

### Cancellation

Both routes already use `activeRequests` (`src/lib/requestCancellation.js`) +
`AbortController` + a `req.signal` listener. Thread the same `controller.signal`
through the `generateChartSpec` call — no new cancellation plumbing needed, exactly
like the desktop version.

## Frontend implementation

### New dependencies

Add `recharts` and `html-to-image`. Neither exists in this repo yet (confirmed via
`package.json`) — same as the desktop app before this feature was built there.

- **Recharts** over Chart.js/react-chartjs-2: renders to SVG (not canvas), composes
  naturally with this codebase's component style, and rasterizes to PNG more reliably
  than canvas-based charts. Covers all 5 required types with one dependency.
- **html-to-image**'s `toPng(node, { backgroundColor, pixelRatio: 2 })` over
  `html2canvas`: handles inline SVG more reliably, one-call API.

### Chart chrome: fixed light surface, independent of app theme

This app uses `next-themes` (`src/utils/theme-provider.jsx`) to toggle a `.dark` class
on `<html>`, and most components use Tailwind `dark:` variants + this app's
`--primary-*` CSS custom properties (`src/app/globals.css`).

**Do not** make the chart's own colors follow `next-themes` dark mode. In the desktop
reference implementation, the chart card intentionally renders on a **fixed light
surface** (white background, dark ink) regardless of the app's current theme — this
was a deliberate simplification, not an oversight: it guarantees the on-screen chart,
the downloaded PNG, and the printed page are always visually identical. (The
alternative — adapting chart colors to dark mode — creates a real bug: if you rasterize
a dark-themed chart with a forced-white export background, dark-mode text becomes
invisible white-on-white in the download.) The outer message-bubble card can still
respect the app's theme (border/shadow via `dark:` classes); only the chart's own
plotting surface (axis, grid, title, marks) should stay fixed-light.

Use a validated categorical palette for series colors (assign by fixed slot order,
never cycled/generated) — reference values used in the desktop version:

```js
export const CATEGORICAL = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"];
export const CHROME = {
  surface: "#fcfcfb", primaryInk: "#0b0b0b", secondaryInk: "#52514e",
  mutedInk: "#898781", gridline: "#e1e0d9", axis: "#c3c2b7",
};
```

If this app has its own brand palette validated for chart use, prefer that; otherwise
these values are pre-validated for colorblind-safety and contrast and are safe to reuse
as-is. Put them in `src/lib/chartPalette.js`, mirroring `src/lib/utils.js`'s role as a
shared frontend helper module.

### `src/components/chat/ChartMessage.jsx` — new shared component

Build **one** shared component, imported by both `ChatInterface.jsx` (project chat) and
`document/page.jsx` (document chat) — there's already a working precedent for this in
this exact codebase: `MessageActions.jsx` and `ExpandedMessageModal.jsx` are already
shared components pulled into both surfaces, even though the two chat surfaces'
send/receive plumbing itself is separately implemented (`ChatInterface.jsx`'s own
handler vs. `document/page.jsx`'s inline `handleAsk`).

Props: `{ spec }` only — no knowledge of documentId/projectId/conversationId.

- Renders the right Recharts component (`BarChart`/`LineChart`/`AreaChart`/`PieChart`/
  `ScatterChart`) based on `spec.type`, wrapped in a card matching this app's existing
  card conventions (`src/components/ui/Card.jsx`), with `spec.title` as a header.
- Wrap the `<ResponsiveContainer>` in a `<div ref={chartRef}>` — this is the PNG
  rasterization target (exclude the action-button row from this ref).
- Action row below the chart: **Download PNG** and **Print**.
- **Download**: `toPng(chartRef.current, { backgroundColor: chrome.surface, pixelRatio:
  2 })` → dataURL → synthetic `<a href={dataUrl} download="chart-<slug>.png">.click()`.
  This is a pure client-side browser mechanism — it works identically in a normal
  browser tab as it does in Electron's renderer, so it transfers directly with **no S3
  upload, no server round-trip, no new API endpoint needed**. This repo has no existing
  file-download pattern to reuse (confirmed — `messageActions.js`'s
  `printMessage`/`copyMessage` are clipboard/print only), so this is net-new but
  self-contained.
- **Print**: this is the one place the mechanism must differ from the desktop version.
  The desktop app routes printing through an Electron IPC call
  (`window.api.printHTML` → an offscreen `BrowserWindow` +
  `webContents.print()`) because `window.open()`/`window.print()` had a Windows-specific
  bug in Electron. **That bug is Electron-specific and does not apply here.** This
  repo's existing `printMessage()` (`src/lib/messageActions.js`) already uses the
  plain browser pattern — reuse that exact pattern for the chart: `window.open("",
  "_blank")`, write an HTML document embedding `<img src="${dataUrl}">` plus the title,
  call `printWindow.print()`. Do not introduce any Electron-style IPC print path here —
  there is none in this codebase and none is needed.

### Wiring into `ChatInterface.jsx` and `document/page.jsx`

Both currently render plain text only:
```jsx
<p className="whitespace-pre-wrap text-sm leading-relaxed break-words overflow-wrap-anywhere">{message.content}</p>
```//
In both files:
- Add `chart: m.chart || null` (or `m.chartData`, whatever the API response field ends
  up named — keep it consistent, e.g. always expose it as `chart` in every API
  response and message-history payload) when mapping loaded history and when
  constructing the new assistant message from a fresh response.
- After the message bubble, conditionally render:
  `{message.role === 'assistant' && message.chart && <ChartMessage spec={message.chart} />}`
- Import `ChartMessage` from `@/components/chat/ChartMessage`.

`ExpandedMessageModal.jsx` (used by both surfaces already) can optionally also render
`<ChartMessage spec={message.chart} />` in its body if present — cheap to add since
the component is already shared and stateless, not required for v1.

## Verification plan

This repo has no automated test suite covering chat (confirm before assuming
otherwise). Verify manually, end-to-end, against a real dev server (`npm run dev`):

- Ask for each of the 5 chart types explicitly, in **both** document chat and project
  chat; confirm correct chart type, plausible data, sensible title, and that the text
  answer's wording matches whether a chart actually appeared (no more "I cannot create
  a chart" next to a rendered chart).
- Cross-check a spreadsheet-sourced chart's values against the existing
  spreadsheet-data preview table (`GET /api/spreadsheet-data`) — should match exactly,
  not be rounded/approximated.
- Ask a project-chat "documents per topic" style question; cross-check counts against
  `GET /api/projects/[id]/topics` / the Topics view UI.
- Run a batch of ordinary non-chart questions in both surfaces — confirm answers are
  unchanged from pre-feature behavior, no chart card appears, and no extra latency is
  observable (proves `detectChartIntent` is short-circuiting correctly).
- Cancel mid-request in both surfaces — confirm the existing `activeRequests` +
  `AbortController` cancellation still works cleanly with the chart call in the mix.
- Toggle the app's light/dark theme with a chart on screen — confirm the chart card
  stays legible (fixed light surface) regardless of the surrounding UI's theme, and that
  downloaded/printed output always looks the same as what's on screen.
- Open a downloaded PNG in an image viewer for each chart type — confirm valid,
  non-corrupt, correctly labeled.
- **If a chart silently fails to appear**: check the server log for the
  `generateChartSpec: no chart after validation, raw model output: ...` line before
  assuming it's a code bug — in the reference implementation, an apparent "project
  chat charts don't work but document chat does" report turned out to be the user's
  OpenAI key having hit a quota/billing limit between two rounds of testing (confirmed
  by testing a plain, unrelated `chat.completions.create` and an `embeddings.create`
  call directly — both failed identically, proving it was an account-level issue, not
  a code path specific to either chat surface). Since this repo uses **per-user** keys
  (`getUserOpenAIKey`), this exact failure mode is a real possibility in production for
  any given user and is worth a clear error/toast rather than a silent no-op, if this
  repo doesn't already surface `insufficient_quota` errors distinctly from the generic
  error path.
