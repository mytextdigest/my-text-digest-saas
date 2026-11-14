// Talking points for a slide deck (TALKING_POINTS_ROADMAP.md): AI-generated,
// rich-text-editable presenter cues per slide, stored in the
// slide_talking_points table keyed by (deck_id, slide_id) — deliberately NOT
// on the outline itself, so no read-modify-write of outline_json (AI edits,
// reorders, layout patches) can ever clobber a user's in-flight edits.
//
// Kept free of require()s on purpose: the renderer bundle imports this file
// directly (same as theme.js) for slideContentHash, so the out-of-date check
// in the editor and the hash stored at generation time can never drift.

const MAX_DOC_CHARS = 120000; // same budget as outline.js / edit.js
const MAX_HTML_LEN = 20000;
const MIN_SECONDS = 10;
const MAX_SECONDS = 600;

// ---------------------------------------------------------------------------
// Content fingerprint (out-of-date detection)
// ---------------------------------------------------------------------------

// Fields that are never "what the slide says": the freeform/layout override
// layer, images, ids, the legacy short notes, and purely decorative picks.
// Everything else (title, bullets, items, stats, chart data, table cells,
// quote, ...) counts as content.
const NON_CONTENT_KEYS = new Set([
  "id", "elements", "backgroundColor", "layoutOverrides", "heroImage",
  "speakerNotes", "talkingPoints", "role", "icon",
]);

function collectContent(value, out) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    out.push("[");
    value.forEach((v) => collectContent(v, out));
    out.push("]");
  } else if (typeof value === "object") {
    Object.keys(value).sort().forEach((k) => {
      if (NON_CONTENT_KEYS.has(k)) return;
      out.push(`${k}:`);
      collectContent(value[k], out);
    });
  } else {
    out.push(String(value).replace(/\s+/g, " ").trim());
  }
}

// Strips the non-content fields from a slide — the exact view the hash and
// the generation prompt both see.
function slideContentView(slide) {
  const view = {};
  Object.keys(slide || {}).forEach((k) => {
    if (!NON_CONTENT_KEYS.has(k)) view[k] = slide[k];
  });
  return view;
}

// FNV-1a 32-bit over a canonical (sorted-key) serialization of the slide's
// content. Not cryptographic — it only has to notice that the text changed.
function textHash(str) {
  const text = String(str ?? "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}-${text.length.toString(36)}`;
}

function slideContentHash(slide) {
  const parts = [];
  collectContent(slide, parts);
  return textHash(parts.join("\u0001"));
}

// ---------------------------------------------------------------------------
// HTML sanitizing / conversion
// ---------------------------------------------------------------------------

// The Tiptap editor (TalkingPointsEditor.jsx) only produces these, without
// attributes. Anything else is unwrapped to its text; script/style dropped
// with their contents.
const ALLOWED_TAGS = new Set(["p", "br", "strong", "em", "u", "s", "mark", "ul", "ol", "li", "h3"]);
const TAG_ALIASES = { b: "strong", i: "em", strike: "s", del: "s", h1: "h3", h2: "h3", h4: "h3", h5: "h3", h6: "h3" };
const VOID_TAGS = new Set(["br"]);

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeTalkingPointsHtml(html) {
  if (typeof html !== "string") return "";
  let src = html
    .slice(0, MAX_HTML_LEN * 2)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|template)\b[\s\S]*?<\/\1\s*>/gi, "");

  let out = "";
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let last = 0;
  let m;
  while ((m = tagRe.exec(src))) {
    out += src.slice(last, m.index).replace(/</g, "&lt;").replace(/>/g, "&gt;");
    last = tagRe.lastIndex;
    const closing = m[1] === "/";
    let tag = m[2].toLowerCase();
    tag = TAG_ALIASES[tag] || tag;
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (VOID_TAGS.has(tag)) { if (!closing) out += `<${tag}>`; continue; }
    out += closing ? `</${tag}>` : `<${tag}>`;
  }
  out += src.slice(last).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return out.slice(0, MAX_HTML_LEN).trim();
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

// Plain-text rendering for PPTX speaker notes (PowerPoint notes can't hold
// formatting): list items become "• " / "1. " lines, blocks become lines.
function talkingPointsToPlainText(html) {
  const lists = [];
  let out = "";
  const tagRe = /<(\/?)([a-z0-9]+)>/g;
  let last = 0;
  let m;
  const src = sanitizeTalkingPointsHtml(html);
  while ((m = tagRe.exec(src))) {
    out += src.slice(last, m.index);
    last = tagRe.lastIndex;
    const [, closing, tag] = m;
    if (tag === "ul" || tag === "ol") {
      // Only a top-level list gets surrounding blank lines; nested ones flow
      // straight on from their parent item.
      if (closing) { lists.pop(); if (!lists.length) out += "\n\n"; }
      else { if (!lists.length) out += "\n"; lists.push({ type: tag, n: 0 }); }
    } else if (tag === "li" && !closing) {
      const list = lists[lists.length - 1];
      const indent = "  ".repeat(Math.max(0, lists.length - 1));
      if (list) list.n += 1;
      out += `\n${indent}${list?.type === "ol" ? `${list.n}. ` : "• "}`;
    } else if ((tag === "p" || tag === "h3") && closing) {
      // A <p> inside a list item: the item's own "\n• " already broke the line.
      if (!lists.length) out += "\n";
    } else if (tag === "br") {
      out += "\n";
    }
  }
  out += src.slice(last);
  return decodeEntities(out)
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .filter((l, i, arr) => l.trim() || (i > 0 && arr[i - 1].trim()))
    .join("\n")
    .trim();
}

// Fingerprint of what the talking points SAY (formatting ignored) — a
// narration script stores it, so editing the notes flags the script and any
// AI audio made from it as out of date (SLIDE_AUDIO_ROADMAP.md).
function talkingPointsHash(html) {
  return textHash(talkingPointsToPlainText(html || "").replace(/\s+/g, " ").trim());
}

function countWords(html) {
  return talkingPointsToPlainText(html).split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// LLM generation
// ---------------------------------------------------------------------------

// "**term**" → <strong>term</strong>, on already-escaped text.
function inlineMarkdownToHtml(text) {
  return escapeHtml(String(text || "").trim()).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

// The model returns structure ({opening, cues, transition}), never HTML — the
// agreed format is enforced here in code, not left to the prompt.
function buildTalkingPointsHtml({ opening, cues, transition }) {
  const parts = [];
  if (opening) parts.push(`<p>${inlineMarkdownToHtml(opening)}</p>`);
  if (cues.length) parts.push(`<ul>${cues.map((c) => `<li><p>${inlineMarkdownToHtml(c)}</p></li>`).join("")}</ul>`);
  if (transition) parts.push(`<p><em>Transition:</em> ${inlineMarkdownToHtml(transition)}</p>`);
  return sanitizeTalkingPointsHtml(parts.join(""));
}

function cleanString(value, maxLen) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLen) : "";
}

// Validates one model-produced slide entry. Returns null if there's nothing
// usable (caller leaves that slide's existing points untouched).
function validateTalkingPointsEntry(raw, { isLast } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const opening = cleanString(raw.opening, 400);
  const cues = (Array.isArray(raw.cues) ? raw.cues : [])
    .map((c) => cleanString(c, 300))
    .filter(Boolean)
    .slice(0, 6);
  const transition = isLast ? "" : cleanString(raw.transition, 300);
  if (!opening && cues.length === 0) return null;

  const html = buildTalkingPointsHtml({ opening, cues, transition });
  let seconds = Number(raw.seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    seconds = Math.round((countWords(html) / 130) * 60 * 1.6); // cues get expanded when spoken
  }
  seconds = Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, Math.round(seconds)));
  return { html, seconds };
}

const FORMAT_RULES =
  `For each slide write:\n` +
  `- "opening": ONE conversational sentence the presenter says to introduce the slide. Do not just read the slide title back.\n` +
  `- "cues": 3-5 short talking-point cues (6-18 words each) — prompts to glance at, NOT full sentences to read aloud. ` +
  `Each cue must add something the slide itself doesn't say — the reason behind a number, what drove it, how it compares, an example, or what it means for the audience — taken from the document. ` +
  `Never just restate a bullet or number that is already on the slide; if you mention one, pair it with its cause or significance. ` +
  `Wrap the single most important number or term in each cue in **double asterisks**. ` +
  `Title, section-divider and closing slides need only 2-3 cues.\n` +
  `- "transition": ONE sentence that bridges naturally into the NEXT slide's topic. Use "" for the final slide of the deck.\n` +
  `- "seconds": realistic speaking time for this slide in seconds (typically 30-120).\n\n` +
  `Rules:\n` +
  `- Ground every fact and number in the document text. Never invent statistics, names, or dates.\n` +
  `- Infer the audience and tone from the document and deck; default to clear, confident, conversational.\n` +
  `- Don't repeat the same cue across slides.\n`;

function deckSlidesForPrompt(slides) {
  return slides.map((s, i) => ({ index: i, ...slideContentView(s) }));
}

function buildDeckTalkingPointsPrompt({ outline, documentText }) {
  const system =
    `You are a presentation coach writing presenter talking points for every slide of a deck.\n\n` +
    FORMAT_RULES + `\n` +
    `Respond in valid JSON only:\n` +
    `{"slides": [{"index": number, "opening": string, "cues": [string, ...], "transition": string, "seconds": number}, ...]}\n` +
    `Include exactly one entry per slide, in order, using each slide's "index".`;

  const user =
    `Deck title: ${outline.title || ""}\n\n` +
    `Slides (${outline.slides.length}):\n${JSON.stringify(deckSlidesForPrompt(outline.slides))}\n\n` +
    `Document content (source material for the talking points):\n${(documentText || "").slice(0, MAX_DOC_CHARS)}\n\n` +
    `Write the talking points for all ${outline.slides.length} slides now.`;

  return { system, user };
}

function buildSlideTalkingPointsPrompt({ outline, slideIndex, documentText }) {
  const slides = outline.slides;
  const prev = slides[slideIndex - 1];
  const next = slides[slideIndex + 1];
  const isLast = slideIndex === slides.length - 1;

  const system =
    `You are a presentation coach writing presenter talking points for ONE slide of a deck. ` +
    `Its neighbours are shown so the opening follows on from the previous slide and the transition leads into the next one.\n\n` +
    FORMAT_RULES + `\n` +
    `Respond in valid JSON only:\n` +
    `{"slides": [{"index": ${slideIndex}, "opening": string, "cues": [string, ...], "transition": string, "seconds": number}]}`;

  const user =
    `Deck title: ${outline.title || ""}\n\n` +
    `All slide titles, for context: ${JSON.stringify(slides.map((s, i) => ({ index: i, title: s.title || s.type })))}\n\n` +
    (prev ? `Previous slide (index ${slideIndex - 1}):\n${JSON.stringify(slideContentView(prev))}\n\n` : `This is the first slide.\n\n`) +
    `TARGET slide (index ${slideIndex}):\n${JSON.stringify(slideContentView(slides[slideIndex]))}\n\n` +
    (next ? `Next slide (index ${slideIndex + 1}):\n${JSON.stringify(slideContentView(next))}\n\n` : "") +
    (isLast ? `This is the FINAL slide — use "" for the transition.\n\n` : "") +
    `Document content (source material):\n${(documentText || "").slice(0, MAX_DOC_CHARS)}\n\n` +
    `Write the talking points for slide ${slideIndex} only.`;

  return { system, user };
}

// Returns Map<slideIndex, {html, seconds}> (possibly partial), or throws with
// a user-facing message. `slideIndex` undefined → whole deck.
async function generateTalkingPoints({ openai, outline, documentText, slideIndex, signal }) {
  const single = Number.isInteger(slideIndex);
  const { system, user } = single
    ? buildSlideTalkingPointsPrompt({ outline, slideIndex, documentText })
    : buildDeckTalkingPointsPrompt({ outline, documentText });

  const completion = await openai.chat.completions.create(
    {
      model: "gpt-4o",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.5,
      max_tokens: single ? 1500 : Math.min(16000, 600 + outline.slides.length * 450),
    },
    { signal }
  );

  const content = completion.choices?.[0]?.message?.content;
  let parsed;
  try { parsed = JSON.parse(content || ""); } catch (e) { parsed = null; }
  const entries = Array.isArray(parsed?.slides) ? parsed.slides : [];

  const lastIndex = outline.slides.length - 1;
  const results = new Map();
  entries.forEach((entry, pos) => {
    // Trust the model's "index" when it's sane, else its position.
    let idx = Number.isInteger(entry?.index) ? entry.index : (single ? slideIndex : pos);
    if (single) idx = slideIndex;
    if (idx < 0 || idx > lastIndex || results.has(idx)) return;
    const valid = validateTalkingPointsEntry(entry, { isLast: idx === lastIndex });
    if (valid) results.set(idx, valid);
  });

  if (results.size === 0) {
    console.warn("generateTalkingPoints: no usable entries, raw model output:", content);
    throw new Error("Couldn't generate talking points. Please try again.");
  }
  return results;
}

// ---------------------------------------------------------------------------
// PDF export
// ---------------------------------------------------------------------------

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem}s`;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

// Standalone print document for webContents.printToPDF. `points` is the
// slideId → row map from the slide_talking_points table.
function buildTalkingPointsPdfHtml({ outline, points, generatedAt = new Date() }) {
  const slides = outline.slides || [];
  const totalSeconds = slides.reduce((sum, s) => sum + (points[s.id]?.seconds || 0), 0);
  const covered = slides.filter((s) => points[s.id]?.html).length;

  const sections = slides.map((s, i) => {
    const p = points[s.id];
    const stale = p && p.contentHash && p.contentHash !== slideContentHash(s);
    const meta = [
      p?.seconds ? `~${formatDuration(p.seconds)}` : null,
      stale ? `<span class="stale">Slide changed since these were written</span>` : null,
    ].filter(Boolean).join(" · ");
    const body = p?.html ? sanitizeTalkingPointsHtml(p.html) : `<p class="empty">No talking points for this slide.</p>`;
    return (
      `<section class="slide">` +
      `<header><span class="num">${i + 1}</span><div><h2>${escapeHtml(s.title || s.type || `Slide ${i + 1}`)}</h2>` +
      (meta ? `<div class="meta">${meta}</div>` : "") +
      `</div></header>` +
      `<div class="points">${body}</div>` +
      `</section>`
    );
  }).join("");

  const dateStr = generatedAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(outline.title || "Talking points")}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #1f2937; font-size: 11pt; line-height: 1.5; margin: 0; }
  .cover { border-bottom: 2px solid #7c3aed; padding-bottom: 14px; margin-bottom: 22px; }
  .cover .kicker { font-size: 9pt; letter-spacing: .08em; text-transform: uppercase; color: #7c3aed; font-weight: 600; }
  .cover h1 { font-size: 22pt; line-height: 1.2; margin: 4px 0 8px; color: #111827; }
  .cover .facts { font-size: 9.5pt; color: #6b7280; }
  .slide { break-inside: avoid-page; page-break-inside: avoid; padding: 12px 0 14px; border-bottom: 1px solid #e5e7eb; }
  .slide:last-child { border-bottom: 0; }
  .slide header { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 6px; }
  .num { flex: none; width: 24px; height: 24px; border-radius: 6px; background: #ede9fe; color: #6d28d9; font-size: 10pt; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; margin-top: 1px; }
  h2 { font-size: 13pt; margin: 0; color: #111827; line-height: 1.3; }
  .meta { font-size: 9pt; color: #6b7280; margin-top: 1px; }
  .stale { color: #b45309; font-weight: 600; }
  .points { padding-left: 36px; }
  .points p { margin: 0 0 6px; }
  .points h3 { font-size: 11.5pt; margin: 8px 0 4px; color: #111827; }
  .points ul, .points ol { margin: 0 0 6px; padding-left: 20px; }
  .points li { margin: 2px 0; }
  .points li p { margin: 0; }
  .points mark { background: #fef08a; padding: 0 1px; border-radius: 2px; }
  .points .empty { color: #9ca3af; font-style: italic; }
</style></head><body>
<div class="cover">
  <div class="kicker">Talking points</div>
  <h1>${escapeHtml(outline.title || "Slide deck")}</h1>
  <div class="facts">${slides.length} slide${slides.length === 1 ? "" : "s"}${totalSeconds ? ` · about ${formatDuration(totalSeconds)} speaking time` : ""}${covered < slides.length ? ` · ${covered} of ${slides.length} slides have talking points` : ""} · ${escapeHtml(dateStr)}</div>
</div>
${sections}
</body></html>`;
}

// ---------------------------------------------------------------------------
// Pace guide (presenter view, Phase 8)
// ---------------------------------------------------------------------------

const PACE_TOLERANCE_MS = 15000;

// Per-slide time budgets (ms) from the talking points' suggested seconds.
// A slide with a narration clip (`audio`: slideId → {durationMs}) uses the
// clip's real length instead. Slides with neither borrow the average of
// those that have one; null when no slide has timings at all (pace guide
// hidden).
function slideBudgetsMs(slides, points, audio) {
  const own = slides.map((s) => {
    const clip = audio?.[s.id]?.durationMs;
    if (Number.isFinite(clip) && clip > 0) return clip;
    const v = points?.[s.id]?.seconds;
    return Number.isFinite(v) && v > 0 ? v * 1000 : null;
  });
  const known = own.filter((v) => v !== null);
  if (known.length === 0) return null;
  const avg = known.reduce((a, b) => a + b, 0) / known.length;
  return own.map((v) => Math.round(v ?? avg));
}

// How the talk is tracking against the budgets. deltaMs > 0 = behind.
// Time already spent before this slide is compared with the budget of the
// slides before it; on the current slide only an overrun counts (being
// partway through a slide isn't "ahead").
function computePace({ budgets, index, elapsedMs, currentSlideMs }) {
  if (!budgets || !budgets.length) return null;
  const i = Math.max(0, Math.min(index, budgets.length - 1));
  const budgetBefore = budgets.slice(0, i).reduce((a, b) => a + b, 0);
  const budgetCurrent = budgets[i];
  const actualBefore = Math.max(0, elapsedMs - currentSlideMs);
  const deltaMs = (actualBefore - budgetBefore) + Math.max(0, currentSlideMs - budgetCurrent);
  const status = deltaMs > PACE_TOLERANCE_MS ? "behind" : deltaMs < -PACE_TOLERANCE_MS ? "ahead" : "on-pace";
  return {
    status,
    deltaMs,
    totalBudgetMs: budgets.reduce((a, b) => a + b, 0),
    slideBudgetMs: budgetCurrent,
    slideProgress: budgetCurrent > 0 ? currentSlideMs / budgetCurrent : 0,
  };
}

export {
  textHash,
  slideContentHash,
  talkingPointsHash,
  slideContentView,
  sanitizeTalkingPointsHtml,
  talkingPointsToPlainText,
  countWords,
  buildTalkingPointsHtml,
  validateTalkingPointsEntry,
  buildDeckTalkingPointsPrompt,
  buildSlideTalkingPointsPrompt,
  generateTalkingPoints,
  formatDuration,
  buildTalkingPointsPdfHtml,
  slideBudgetsMs,
  computePace,
};
