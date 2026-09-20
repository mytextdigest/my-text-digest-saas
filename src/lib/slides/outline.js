// src/lib/slides/outline.js
// Slide outline generation: asks the model for structured JSON content only
// (never layout/positioning) — mirrors the prompt-builder + never-throws
// validation pattern used in src/lib/chartSpec.js. Visual design (palette
// hex values, spacing, typography) lives entirely in theme.js/layouts.js;
// the model only picks a palette/font-pair *name* and writes content.
//
// Ported from electron/slides/outline.js (desktop), with one deliberate
// omission: the legacy single-call `buildOutlinePrompt`/`generateOutline`
// path (plus its `buildRepairPrompt` verify/repair pass, only ever called
// from within `generateOutline`) is dropped — confirmed via desktop
// `electron/main.js` that only the two-step `generateTextOutline` /
// `generateStructuredOutline` flow is actually wired to any IPC handler.
// Everything else here is a straight port.

import crypto from "crypto";
import { PALETTES, FONT_PAIRS, DEFAULT_PALETTE_NAME, DEFAULT_FONT_PAIR_NAME, PALETTE_SUGGESTIONS_BY_PRESENTATION_TYPE } from "./theme.js";
import { ICON_NAMES } from "./iconNames.js";
import { scoreDeckAgainstIntent } from "./intent.js";

export const SLIDE_TYPES = [
  "title", "agenda", "section_header", "bullets", "two_column", "icon_grid",
  "icon_list", "feature_split", "stat_callout", "comparison", "timeline",
  "chart", "quote", "closing", "table", "process_steps",
];
export const CHART_TYPES = ["bar", "line", "pie"];

// Narrative purpose of a slide, independent of its visual "type" — e.g. a
// pitch deck's closing "ask" and a university deck's closing "conclusion"
// can both render through the "closing" type but mean different things.
// Missing/invalid role always falls back to DEFAULT_SLIDE_ROLE.
export const SLIDE_ROLES = [
  "hook", "problem", "solution", "proof", "market", "method",
  "risk", "comparison", "next_steps", "ask", "conclusion", "content",
];
export const DEFAULT_SLIDE_ROLE = "content";

const MIN_SLIDES = 3;
const MAX_SLIDES = 26;
export const MAX_TITLE_LEN = 100;
export const MAX_BULLET_LEN = 140;
export const MAX_BULLETS = 6;
export const MAX_ITEMS = 6;
export const MAX_ITEM_DESC_LEN = 200;
// icon_grid's cells (as narrow as ~3.5in at 3 columns) and timeline's steps
// (similarly narrow, split across up to 6 columns) render a description in a
// far narrower box than icon_list/feature_split's full-width single-column
// rows — the same 200-char cap applied to all of them meant a description
// that fit fine in icon_list would reliably overflow icon_grid's fixed
// 2-line label allowance. Per-type caps close that gap at the source, on top
// of (not instead of) layouts.js's fitFontSize shrink-to-fit safety net.
export const MAX_ITEM_DESC_LEN_BY_TYPE = {
  icon_grid: 110,
  timeline: 110,
};
export const MAX_STATS = 4;
const MAX_CHART_CATEGORIES = 12;
const MAX_CHART_SERIES = 4;
// "table": kept small deliberately — a table is the one type whose whole
// point is scannable rows/columns, not a data dump. 4 columns is what
// layouts.js's equal-width column math stays legible at against CONTENT_W;
// 6 rows (+ header) is what fits BODY_H at a readable row height without
// needing per-row font shrinking.
export const MAX_TABLE_COLS = 4;
export const MAX_TABLE_ROWS = 6;
export const MAX_TABLE_CELL_LEN = 40;
// "process_steps": single-column variant of timeline (see timeline's own
// 2-6 item range) — same ceiling, since it's still one row per step.
const MAX_PROCESS_STEPS = 6;
// "close to the max, not the minimum" — the same philosophy already applied
// to comparison (3-bullet floor) and feature_split (3-item floor) had never
// been applied to plain bullets/agenda/two_column, which is how a 1-bullet
// "slide" passed validation.
const MIN_LIST_BULLETS = 4;
// A degenerate-fragment floor, NOT the 6-word isSubstantive() floor used for
// item descriptions — bullets are legitimately short scannable phrases by
// design (e.g. "No cloud dependency" is 3 words). This only catches true
// single-word/fragment bullets.
const MIN_BULLET_WORDS = 2;
// Holistic defense-in-depth backstop: every prior round of this project found
// a NEW specific field that could sneak thin content through one at a time
// (item descriptions, then stats, then comparison bullets, then top-level
// bullets) — this closes the whole class of bug instead of the next one-off
// instance, by summing words across every text field on the finished slide.
// 20, not 25: a legitimate stat_callout with 2 real stats and a concise
// (but already isSubstantive-checked) context sentence can land right around
// 20 words — the floor only needs to be high enough to catch genuinely thin
// slides (a bare-label 4-bullet slide lands around 9 words), not to demand
// maximum density on every slide.
const MIN_SLIDE_WORDS = 20;
// Intentionally terse by design, exempt from the holistic word floor: title
// and quote are meant to be short, section_header is capped at one sentence,
// agenda's "bullets" are short section names (per its own schema text) not
// informative clauses, closing's schema explicitly calls for "1-2 sentence
// closing statement, not a bullet list", and table cells are meant to be a
// number/short label/single word ("$9/mo", "Yes") — a legitimate minimal
// table (2 columns, 2 rows) can easily land under the 20-word floor built
// for prose-bearing types, and a table's whole point is being scannable, not
// dense. All six are short by design, not thin by accident.
const WORD_FLOOR_EXEMPT_TYPES = new Set(["title", "quote", "section_header", "agenda", "closing", "table"]);
// Matches each type's own documented schema range (buildSlideTypeSchema
// below): icon_grid "2-6", icon_list "3-5", timeline "2-6" items.
const MIN_ITEMS_BY_TYPE = { icon_grid: 2, icon_list: 3, timeline: 2, process_steps: 2 };
const MIN_TABLE_ROWS = 2;
// gpt-4o's context window comfortably fits far more than this — raised from
// 50k so a genuinely long report/whitepaper doesn't get silently cut off
// before the model ever sees most of it.
const MAX_DOC_CHARS = 120000;

function truncateString(value, maxLen) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}

// A bare label ("Knowledge silos") passes a non-empty-string check but isn't
// content — it's a topic tag. Word count is a cheap, reliable proxy for "a
// real informative clause" without hand-rolling a grammar check. 4 words let
// through weak-but-technically-compliant clauses like "Maintains consistency
// and compliance" — 6 pushes toward reference density (~9-12 words) without
// rejecting every naturally short sentence.
function isSubstantive(text, minWords = 6) {
  if (!text) return false;
  return text.trim().split(/\s+/).filter(Boolean).length >= minWords;
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// A flat "6-16 slides" target ignored how much material the document
// actually has — a 2-page doc and a 20-page report got the same range. Tie
// the target to the input actually sent to the model (roughly chars/5.5 ≈
// words) so a text-heavy document is explicitly asked for a longer deck
// instead of leaving that to the model's discretion.
export function suggestSlideRange(charCount) {
  const words = Math.round(charCount / 5.5);
  if (words < 600) return { min: 6, max: 8, words };
  if (words < 1800) return { min: 8, max: 11, words };
  if (words < 4000) return { min: 10, max: 14, words };
  if (words < 9000) return { min: 13, max: 18, words };
  return { min: 16, max: 22, words };
}

// Per-slide-type schema description, keyed by type — used both for the full
// type catalog in buildTextOutlinePrompt/buildStructurePrompt and,
// standalone, so a single-slide edit prompt (edit.js) can describe just the
// ONE type it's editing without duplicating this text.
export function buildSlideTypeSchema({ maxBullets = MAX_BULLETS, chartTypes = CHART_TYPES } = {}) {
  return {
    title: `  - "title": deck opener. Use "title" and "subtitle" fields.\n`,
    agenda: `  - "agenda": numbered overview of the deck's sections. Use "bullets" (short section names). Skip this type entirely for decks under 12 slides — a table-of-contents slide has no real content and taxes a short deck's slide budget; spend that slide on substance instead. Only include it when the deck is long/structured enough that a roadmap genuinely helps.\n`,
    section_header: `  - "section_header": a divider slide introducing a new section. Use "title" AND "subtitle" (one supporting sentence — never leave this slide with only a title, it must not look empty).\n`,
    bullets: `  - "bullets": title + up to ${maxBullets} short bullets, each under 12 words, plus ONE relevant "icon" for the slide.\n`,
    two_column: `  - "two_column": title + "bullets" (left column content) + "icon" (right column visual).\n`,
    icon_grid: `  - "icon_grid": title + "items" array (2-6 of {icon, label, description}), one icon-in-circle block per item, arranged in a grid.\n`,
    icon_list: `  - "icon_list": title + "items" array (3-5 of {icon, label, description}), one icon-in-circle row per item stacked in a SINGLE column — use this instead of "icon_grid" when each item needs a longer 1-2 sentence description rather than a short caption.\n`,
    feature_split: `  - "feature_split": an asymmetric slide with ONE highlighted feature/concept on one side and a checklist on the other. Use "title", "icon" + "panelLabel" (a short 2-4 word caption for the highlighted panel, e.g. "Privacy-First Architecture"), and "items" array (3-5 of {label, description}) rendered as a checklist. Use this ONLY for a single concept — if you're describing 2-3 named, parallel options (e.g. "Cloud vs Desktop," "Basic vs Pro," before/after), that is a "comparison" slide instead. Never merge multiple named options into one feature_split panel — each option needs its own card. Concretely: if the document has both a "Cloud Version" and a "Desktop Version" (or any 2-3 named variants), that is ALWAYS "comparison" with one full card per variant, never a single feature_split slide squeezing both into one panel with a merged label.\n`,
    stat_callout: `  - "stat_callout": title + "context" (one full sentence explaining what these numbers mean or why they matter — required, this is what keeps the slide from being just bare numbers) + "stats" array (1-4 of {value, label}) — big numbers with short labels, e.g. {value: "42%", label: "faster onboarding"}. Every value must be a real number stated in or directly computable from the document — never a made-up score.\n`,
    comparison: `  - "comparison": title + "items" array of exactly 2-3 {label, bullets} blocks presented side-by-side, one card per named option (e.g. "Cloud Version" / "Desktop Version", before/after, pros/cons). "bullets" is 3-5 short informative points about that option — the card has real vertical room, use it, this is what the reader actually reads. Use this whenever the document names 2-3 parallel alternatives — don't collapse them into a single feature_split or bullets list.\n`,
    timeline: `  - "timeline": title + "items" array (2-6 of {label, description}) as ordered process/timeline steps, laid out horizontally with a connecting line — best for a genuinely chronological/dated sequence (a roadmap, a history) where each step's short description fits comfortably in a narrow column. Use "process_steps" instead when steps need more room per description or aren't date-anchored.\n`,
    chart: `  - "chart": title + "chart" object {chartType: one of ${chartTypes.join("/")}, title, categories: [string,...], series: [{name, data: [number,...]}]}. ONLY use this type when the document actually contains numbers/data worth visualizing. Every number must be real — if you're inventing a plausible-looking score or percentage to fill the chart (e.g. rating something "90/100" with no source), don't use "chart"; use "icon_list" or "bullets" instead and describe it qualitatively.\n`,
    quote: `  - "quote": a single striking sentence pulled or paraphrased from the document. Use "quote" and "attribution" fields.\n`,
    closing: `  - "closing": deck closer (summary/thank you). Use "title" and "subtitle" (1-2 sentence closing statement, not a bullet list) plus optional "bullets" only for a short credits/contact line.\n`,
    table: `  - "table": title + "table" object {headers: [string, ...] (2-${MAX_TABLE_COLS} column names), rows: [[string, ...], ...] (${MIN_TABLE_ROWS}-${MAX_TABLE_ROWS} rows, each with exactly as many cells as there are headers)} — genuine tabular data, either (a) multiple columns of comparable values per row (e.g. a product/spec comparison, a pricing table, period-over-period figures side by side), OR (b) a longer list of 4+ uniform "Line item: value" rows where every value is just a short number/figure with no descriptive phrase — e.g. an income statement, a balance sheet, a spec sheet — rendered as a 2-column {headers: ["Line Item", "Value"]} table. Keep every cell SHORT (a number, a short label, a single word like "Yes"/"No") — a table cell is not a sentence; if a row's content needs a full sentence or explanatory phrase per item (not just a bare number), use "icon_list" instead, and if the list is under 4 items, prefer "icon_list" or "stat_callout" over a sparse table.\n`,
    process_steps: `  - "process_steps": title + "items" array (2-${MAX_PROCESS_STEPS} of {label, description}) as an ordered, numbered sequence of steps, stacked vertically in a single column with a connecting line — the single-column counterpart to "timeline" (same relationship "icon_list" has to "icon_grid"): use this instead of "timeline" when steps aren't calendar/date-anchored (a workflow, a how-it-works sequence, an onboarding process) or when each step's description needs more than a couple of short words to explain.\n`,
  };
}

// Short framing phrases for the presentation-type quick-select in the brand
// kit modal — purely a prompt-steering hint, not a new slide type or schema
// change. Unrecognized/omitted keys simply add no framing (identical output
// to today).
export const PRESENTATION_TYPE_FRAMING = {
  "pitch-deck": "This is a pitch deck for investors — emphasize traction, market opportunity, differentiation, and a clear ask, in punchy, high-impact language (the content-depth rules below apply regardless of this tone — punchy means word choice, not fewer facts). Structure the narrative arc as: hook/problem → your solution → why it's different or better → any traction, metrics, or proof the document supports → market/business context if the document has it → a closing ask (next steps, a demo, funding, or adoption — never a generic 'thank you'). Don't walk through every feature or technical/security/deployment detail in document order the way a product manual would. HARD RULE, not a suggestion: security, governance, compliance, and deployment/technical-implementation detail must NEVER get their own standalone slide in a pitch deck, no matter how much space the document gives that material — 'compress it onto one slide' is not enough, because sales and university decks also naturally land on one slide for it, which is exactly the sameness investors would notice. If one fact from that material is genuinely differentiating, fold it as a single bullet inside a broader differentiation/traction/why-us slide; otherwise omit it entirely. Spend the slides you save on the problem/solution/traction arc instead. Lean heavily on stat_callout, comparison, timeline, and icon_grid/icon_list slides to keep it punchy and visual (use 'table' instead of icon_list for a longer run of bare-number financial line items, e.g. a multi-row revenue/margin breakdown); for any point that needs real elaboration (e.g. market opportunity or differentiation — never security/governance/deployment, per the hard rule above), use icon_grid/icon_list even in a punchy deck — never fall back to plain bullets for a multi-point topic.",
  "university": "This is an academic/university presentation — favor thorough explanation, precise terminology, and a measured, informative tone over a sales pitch. Structure the narrative to mirror the document's own expository logic (context/background → the problem or question → approach or how it works → findings or capabilities in depth → implications → conclusion) rather than a sales-style pitch arc — follow the SOURCE material's actual organization and cover it thoroughly, including sections a pitch or sales deck would compress or cut. Close with a summary/conclusion or open questions, not a call-to-action. Lean on bullets, two_column, and icon_list slides that have room for real explanation, and 'process_steps' for a methodology/approach that unfolds as a sequence of stages; avoid over-using terse stat_callout slides that don't leave room for nuance. Depth matters more than punchiness here — never trim a real explanation down to a bare label.",
  "sales": "This is a sales deck for prospective customers — emphasize benefits, outcomes, and proof points over internal process detail, in punchy, high-impact language (the content-depth rules below apply regardless of this tone — punchy means word choice, not fewer facts). Structure the narrative arc as: the buyer's pain point(s) → your solution and how it resolves them → concrete proof (comparisons, stats, differentiators) → a closing call-to-action (contact, demo, trial — never a generic 'thank you'). Unlike a pitch deck, buyer-facing depth on capabilities like security, deployment options, and governance IS valuable proof here — cover it, just frame each as a benefit to the buyer rather than a bare feature list. Lean on feature_split, comparison, stat_callout, and icon_grid/icon_list slides that make the value proposition concrete (use 'table' for a spec/pricing comparison with several rows of bare values); for any point that needs real elaboration, use icon_grid/icon_list even in a punchy deck — never fall back to plain bullets for a multi-point topic.",
  "internal-report": "This is an internal report for colleagues/leadership — favor clear status, metrics, and next steps over external polish, in punchy, high-impact language (the content-depth rules below apply regardless of this tone — punchy means word choice, not fewer facts). Structure the narrative arc as: current status/summary → key metrics or results → issues, risks, or challenges → what's planned next (owners, timeline, asks). Close with next steps and asks, not a generic thank-you. Lean on stat_callout, chart, timeline, table, and icon_grid/icon_list slides that communicate status at a glance (use 'table' for a multi-row metrics breakdown, 'process_steps' for a non-dated plan/workflow of what's next); for any point that needs real elaboration, use icon_grid/icon_list even in a punchy deck — never fall back to plain bullets for a multi-point topic.",
  "conference-talk": "This is a conference/talk deck — favor a narrative arc and memorable, punchy statements suited to a live audience. Structure it as a story: open with a hook or provocative framing (never a dry agenda), build context or tension, reveal the key insight, then land on one memorable closing statement or call to action — not a feature recap. Lean on section_header, quote, and icon_grid slides, and keep bullets short enough to read at a glance from the back of a room — but every point still needs a specific, informative clause, never a bare label.",
  "minimal": "This is a minimal, editorial-style presentation — understated and text-forward, letting whitespace, typography, and restrained color carry the design rather than bold color blocking or heavy card chrome (this governs VISUAL style only, applied automatically — it does not change the content-depth rules below, which still apply in full). Structure the narrative to mirror the document's own expository logic, the same as an academic deck would, favoring clarity and calm pacing over a sales-style pitch arc. Lean on bullets, icon_list, quote, and table slides — quote in particular suits this style's editorial feel; use stat_callout sparingly, only for numbers that genuinely warrant a large-number treatment, not as a default way to show every figure.",
};

// Shared between the text-outline prompt and the structure prompt so the
// substance bar never drifts out of sync between the two. The opening line
// makes tone and content-density explicitly INDEPENDENT axes.
function buildContentDepthRules() {
  return (
    `Content depth — this is the most common way decks go wrong, avoid it. These requirements apply EQUALLY regardless of presentation style or tone (see above, if any) — a "punchy" or "concise" style governs word choice and pacing, never how many real facts a slide contains. Never trade substance for brevity.\n` +
    `- Ground every slide in SPECIFIC facts, numbers, names, and terminology drawn directly from the document. Never write generic filler like "Team performed well" or "Significant progress was made" — write what actually happened, e.g. "Support tickets dropped from 340/week to 190/week after the Q2 rollout." If the document doesn't support a specific claim, don't invent one — cut the bullet instead of padding with vague language.\n` +
    `- Every bullet and every item "description" must be a real, informative clause of roughly 10-16 words — never a bare 2-4 word label and never a single terse 4-5 word sentence either, and don't stop at the shortest sentence that would technically pass. Bad: "Knowledge silos". Also bad (too short to be useful): "Maintains consistency and compliance." Also too thin, even though it IS a real sentence — it states only WHAT, then stops: "Finds information based on meaning, not just keywords." Fix it by adding the mechanism or the payoff, not just restating the feature name in sentence form: "Uses semantic search to surface documents by meaning and context, not just exact keyword matches, so users find what they need even from a vague query." Good: "Knowledge stays siloed in individual inboxes and drives, so teams can't find what colleagues already know." Good: "Structured management processes ensure consistency, accountability, and regulatory compliance across every department." A reader who only sees your bullets should understand the actual point AND a specific supporting detail, not just a topic tag — if you can't add a second fact (how it works, why it matters, or a concrete number/example), that's a sign the point needs more than a restated feature name.\n` +
    `- Use close to the MAXIMUM item/bullet count each slide type allows, not the minimum, whenever the document has enough real substance — a grid with 3 items when 6 would fit looks unfinished, and a "comparison" card with only 3 bullets when 5 would fit looks unfinished too. Specifically: comparison cards should almost always carry 4-5 bullets, not the 3-bullet floor — the card has the vertical room, use it. Only use fewer when the document genuinely doesn't support more (never pad with filler to hit a count).\n` +
    `- One distinct idea per slide, and each distinct idea gets exactly ONE slide — never split a single topic across two slides that just restate the same points in different words or formats (e.g. a punchy "problem" bullets slide followed later by a full icon_grid breakdown of those same points). Before finishing, check every slide's title and content against every other slide's — if two slides would read as covering the same ground, merge them or cut one. If the document covers several genuinely SEPARATE features, challenges, steps, or sections, give EACH its own slide instead of compressing 2-3 of them onto a single crowded bullets slide — that's what makes a deck feel thin even when the source material isn't. Splitting distinct ideas apart is good; splitting one idea into two near-duplicate slides is not.\n` +
    `- When NO presentation style is specified above, let the document's own structure and content shape the deck's structure — don't default to a generic title → agenda → bullets → chart → quote → closing template. A narrative document might lean on section_header + timeline + quote; a data-heavy report might lean on stat_callout + chart + comparison. When a presentation style IS specified above, its narrative arc and topic selection take priority instead — actively reorder, re-emphasize, compress, or omit source material to fit that arc rather than reproducing the document's own section order; two different presentation types built from the same document should read as different decks, not the same deck with different words. Use at least 5 distinct slide types across the deck (beyond title/closing).\n` +
    `- Divider slides ("section_header") are intentionally sparse — at most 90% of the canvas is a title and one sentence. Use "section_header" AT MOST ONCE in the whole deck, and only for a genuine multi-topic pivot (e.g. moving from "the problem" to "the solution"). Never use it right after the title slide, never use it to introduce every new topic, and never use two of them within 3 slides of each other. When in doubt, replace it with a content-bearing slide (icon_grid, icon_list, stat_callout) whose title itself signals the new topic — that slide is never empty.\n` +
    `- Prefer icon_grid, stat_callout, comparison, and timeline over plain "bullets" whenever the document's content actually fits that shape — they read as more substantial than another bullet list.\n\n`
  );
}

function validateChartData(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!CHART_TYPES.includes(raw.chartType)) return null;

  const title = truncateString(raw.title, MAX_TITLE_LEN) || "Chart";
  const categories = Array.isArray(raw.categories)
    ? raw.categories.slice(0, MAX_CHART_CATEGORIES).map((c) => truncateString(String(c), 60))
    : [];
  if (categories.length === 0) return null;

  const series = (Array.isArray(raw.series) ? raw.series.slice(0, MAX_CHART_SERIES) : [])
    .map((s) => ({
      name: truncateString(s && s.name, 60) || "Series",
      data: (Array.isArray(s && s.data) ? s.data.slice(0, categories.length) : []).map((v) => toFiniteNumber(v)),
    }))
    .filter((s) => s.data.some((v) => v !== null));

  if (series.length === 0) return null;
  return { chartType: raw.chartType, title, categories, series };
}

function validateTableData(raw) {
  if (!raw || typeof raw !== "object") return null;
  const headers = Array.isArray(raw.headers)
    ? raw.headers.slice(0, MAX_TABLE_COLS).map((h) => truncateString(String(h ?? ""), MAX_TABLE_CELL_LEN)).filter(Boolean)
    : [];
  if (headers.length < 2) return null;

  const rows = (Array.isArray(raw.rows) ? raw.rows : [])
    .slice(0, MAX_TABLE_ROWS)
    .map((row) => {
      if (!Array.isArray(row)) return null;
      const cells = row.slice(0, headers.length).map((c) => truncateString(String(c ?? ""), MAX_TABLE_CELL_LEN));
      // Every row must have a real cell under every header column — a short
      // row (the model dropped a trailing cell) would misalign under the
      // wrong header when rendered; reject rather than render misaligned
      // data, same "don't render a known-broken shape" reasoning as
      // comparison's item-count floor.
      if (cells.length !== headers.length || cells.some((c) => !c)) return null;
      return cells;
    })
    .filter(Boolean);
  if (rows.length < MIN_TABLE_ROWS) return null;

  return { headers, rows };
}

function validateItems(raw, { needsIcon = false, needsBullets = false, needsDescription = true, maxDescLen = MAX_ITEM_DESC_LEN } = {}) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_ITEMS)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const label = truncateString(item.label, MAX_TITLE_LEN);
      if (!label) return null;
      const description = truncateString(item.description, maxDescLen);
      // A bare-label item (description missing or a 2-3 word tag) renders as
      // a label with nothing underneath — drop the item rather than let a
      // thin one through, since the model doesn't reliably follow the
      // "always write a real description" prompt instruction on its own.
      if (needsDescription && !isSubstantive(description)) return null;
      const result = {
        icon: needsIcon && typeof item.icon === "string" ? item.icon : undefined,
        label,
        description,
      };
      if (needsBullets) {
        const bullets = validateBullets(item.bullets).slice(0, 5);
        // The schema documents "3-5 bullets" but the model kept writing
        // exactly 2-3 (satisfying an old floor of 2) against a reference
        // that consistently uses 5 — the card has the vertical room, so
        // require 3 as the real floor to push usage toward that range.
        if (bullets.length < 3) return null;
        result.bullets = bullets;
      }
      return result;
    })
    .filter(Boolean);
}

function validateStats(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_STATS)
    .map((s) => {
      if (!s || typeof s !== "object") return null;
      const value = truncateString(s.value, 20);
      const label = truncateString(s.label, 80);
      if (!value || !label) return null;
      // A stat_callout's whole reason to exist is a big NUMBER — a value
      // like "Role-Based" or "Privacy-First" is a feature label the model
      // padded in to hit a stat count, not a statistic. Reject anything
      // without at least one digit rather than rendering a feature name in
      // 64pt "number" styling.
      if (!/\d/.test(value)) return null;
      return { value, label };
    })
    .filter(Boolean);
}

// minWords defaults to the degenerate-fragment floor (see MIN_BULLET_WORDS),
// but agenda callers pass 1 — an agenda "bullet" is a short section name by
// design (e.g. "Introduction"), not an informative clause, so the 2-word
// floor that catches real fragments elsewhere would wrongly reject it here.
function validateBullets(raw, { minWords = MIN_BULLET_WORDS } = {}) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_BULLETS)
    .map((b) => truncateString(typeof b === "string" ? b : "", MAX_BULLET_LEN))
    .filter((b) => isSubstantive(b, minWords));
}

// Sums words across every text field a validated slide can carry — the
// holistic backstop described at MIN_SLIDE_WORDS above. Deliberately reads
// only from the already-validated `slide` object (not the raw model output),
// so it measures what will actually render.
function countSlideWords(slide) {
  const texts = [];
  const push = (t) => {
    if (typeof t === "string" && t) texts.push(t);
  };
  push(slide.title);
  push(slide.subtitle);
  push(slide.context);
  push(slide.quote);
  push(slide.attribution);
  push(slide.panelLabel);
  if (Array.isArray(slide.bullets)) slide.bullets.forEach(push);
  if (Array.isArray(slide.items)) {
    for (const item of slide.items) {
      push(item.label);
      push(item.description);
      if (Array.isArray(item.bullets)) item.bullets.forEach(push);
    }
  }
  if (Array.isArray(slide.stats)) {
    for (const s of slide.stats) {
      push(s.value);
      push(s.label);
    }
  }
  if (slide.chart) {
    push(slide.chart.title);
    if (Array.isArray(slide.chart.categories)) slide.chart.categories.forEach(push);
    if (Array.isArray(slide.chart.series)) slide.chart.series.forEach((s) => push(s.name));
  }
  if (slide.table) {
    if (Array.isArray(slide.table.headers)) slide.table.headers.forEach(push);
    if (Array.isArray(slide.table.rows)) slide.table.rows.forEach((row) => row.forEach(push));
  }
  return texts.join(" ").trim().split(/\s+/).filter(Boolean).length;
}

// Catches a "bullets" slide whose bullets are actually structured
// Label: metric pairs (e.g. "Industrial Automation: $301.4M, up 14% YoY.")
// rather than genuine prose points. "icon_list" renders this exact content
// far better — full-width rows with room for a label + value and its own
// icon — than "bullets"'s narrow left column with a large empty icon circle
// on the right, which reads as a sparse, under-filled slide for a short
// metric list. buildStructurePrompt (below) already asks the model to
// prefer icon_list/icon_grid/stat_callout for this shape of content, but
// that instruction alone wasn't reliably followed in practice — this is the
// code-level backstop, same "prompting alone didn't stop this from
// recurring, enforce it in code instead" pattern already used elsewhere in
// this file (see feature_split's 2-item rejection, section_header's cap).
//
// The VALUE side must contain a digit (a real metric, not just any colon —
// "Note: see appendix for details" has no digit and is left as prose) and
// stay short (<=8 words) — a genuine explanatory clause runs well past that
// per the content-depth rules' own 10-16-word target, so this only fires on
// the tight "label: number" shape, not an ordinary sentence that happens to
// contain a colon.
const LABEL_VALUE_BULLET_RE = /^([^:]{2,60}):\s*(.+)$/;
function isLabelValueBullet(bullet) {
  const m = LABEL_VALUE_BULLET_RE.exec(bullet.trim());
  if (!m) return false;
  const [, label, value] = m;
  const valueWords = value.trim().split(/\s+/).filter(Boolean);
  return /\d/.test(value) && valueWords.length > 0 && valueWords.length <= 8 && label.trim().length > 0;
}
// A supermajority (not "any"), so a bullets slide with one incidental
// "Label: value" line among genuinely prose bullets doesn't get swept into
// the conversion below.
function looksLikeMetricList(bullets) {
  if (!Array.isArray(bullets) || bullets.length < MIN_ITEMS_BY_TYPE.icon_list) return false;
  const matches = bullets.filter(isLabelValueBullet).length;
  return matches / bullets.length >= 0.75;
}
// Splits each "Label: value" bullet into an icon_list item. Every item
// reuses the bullets slide's own single `icon` field (bullets only ever
// carries one icon for the whole slide, not per-bullet) — icon_list's own
// rendering already varies each item's circle COLOR via rotatingColor, so a
// shared icon glyph across items still reads as a coherent row of distinct
// cards, not a visual bug.
function convertMetricBulletsToIconList(slide) {
  const items = slide.bullets
    .map((b) => {
      const m = LABEL_VALUE_BULLET_RE.exec(b.trim());
      if (!m) return null;
      return {
        icon: slide.icon,
        label: truncateString(m[1], MAX_TITLE_LEN),
        description: truncateString(m[2], MAX_ITEM_DESC_LEN),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
  if (items.length < MIN_ITEMS_BY_TYPE.icon_list) return slide;
  const { bullets, icon, ...rest } = slide;
  return { ...rest, type: "icon_list", items };
}
// Applies the metric-list backstop to one already-validated slide. Only
// "bullets" itself, never "agenda" (short section names, not metrics) or
// "two_column" (already has a card+icon on the right; the narrow-column
// complaint doesn't apply the same way there).
export function applyMetricListBackstop(slide) {
  if (slide.type === "bullets" && looksLikeMetricList(slide.bullets)) {
    return convertMetricBulletsToIconList(slide);
  }
  return slide;
}

// Validates one slide. Returns null if the slide has nothing usable (caller
// drops it rather than rendering an empty/broken slide).
export function validateSlide(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!SLIDE_TYPES.includes(raw.type)) return null;

  const base = {
    type: raw.type,
    title: truncateString(raw.title, MAX_TITLE_LEN),
    speakerNotes: truncateString(raw.speakerNotes, 500) || undefined,
    icon: typeof raw.icon === "string" ? raw.icon : undefined,
    // Left undefined (not defaulted) when missing/invalid — callers with
    // access to a prior slide (edits) fall back to its old role; callers
    // with no prior slide (fresh structuring) default to DEFAULT_SLIDE_ROLE
    // themselves. Defaulting here would make those two cases
    // indistinguishable downstream.
    role: SLIDE_ROLES.includes(raw.role) ? raw.role : undefined,
  };

  let slide;
  switch (raw.type) {
    case "title":
      if (!base.title) return null;
      slide = { ...base, subtitle: truncateString(raw.subtitle, 160) };
      break;
    case "section_header": {
      // Required (not optional) — a title-only divider slide is a mostly
      // empty slide, exactly the "same pattern, no content" complaint.
      const subtitle = truncateString(raw.subtitle, 200);
      if (!base.title || !subtitle) return null;
      slide = { ...base, subtitle };
      break;
    }
    case "closing": {
      const subtitle = truncateString(raw.subtitle, 240);
      if (!base.title) return null;
      slide = { ...base, subtitle, bullets: validateBullets(raw.bullets) };
      break;
    }
    case "agenda":
    case "bullets":
    case "two_column": {
      const bullets = validateBullets(raw.bullets, raw.type === "agenda" ? { minWords: 1 } : undefined);
      // Was ">0", so a single-bullet slide passed — every other type in this
      // file already has a real minimum (comparison, feature_split); this is
      // the same "close to the max, not the minimum" floor applied here.
      if (!base.title || bullets.length < MIN_LIST_BULLETS) return null;
      slide = { ...base, bullets };
      break;
    }
    case "icon_grid":
    case "icon_list":
    case "timeline": {
      const items = validateItems(raw.items, { needsIcon: true, maxDescLen: MAX_ITEM_DESC_LEN_BY_TYPE[raw.type] || MAX_ITEM_DESC_LEN });
      // The prompt schema documents real minimums here (icon_grid "2-6",
      // icon_list "3-5", timeline "2-6" items) but this check only ever
      // required ">0" — the same "validator floor weaker than the
      // documented minimum" gap already found and fixed for plain bullets.
      // A 1-item icon_grid/timeline or a 1-2 item icon_list is a thin slide
      // that should have been a smaller part of a fuller one instead.
      if (!base.title || items.length < MIN_ITEMS_BY_TYPE[raw.type]) return null;
      slide = { ...base, items };
      break;
    }
    case "feature_split": {
      const items = validateItems(raw.items, { needsIcon: false });
      const panelLabel = truncateString(raw.panelLabel, 60);
      // A feature_split with only 2 items is, in practice, almost always a
      // "Cloud Version vs Desktop Version"-shaped comparison the model
      // squeezed into one panel instead of giving each option its own
      // comparison card — prompt wording alone didn't stop this from
      // recurring. The documented shape is "3-5 items" for a reason: a
      // single-concept checklist genuinely has that many facets; 2 items is
      // the fingerprint of a merged pair of options. Reject rather than
      // silently render the anti-pattern.
      if (!base.title || items.length < 3 || !panelLabel) return null;
      slide = { ...base, panelLabel, items };
      break;
    }
    case "comparison": {
      const items = validateItems(raw.items, { needsIcon: false, needsBullets: true, needsDescription: false }).slice(0, 3);
      if (!base.title || items.length < 2) return null;
      slide = { ...base, items };
      break;
    }
    case "stat_callout": {
      const stats = validateStats(raw.stats);
      // Stats without any surrounding narrative are just numbers on a card —
      // the least content-dense slide shape in the deck. Require the one
      // sentence that gives them meaning, same treatment as section_header's
      // required subtitle.
      const context = truncateString(raw.context, 220);
      if (!base.title || stats.length === 0 || !isSubstantive(context)) return null;
      slide = { ...base, context, stats };
      break;
    }
    case "chart": {
      const chart = validateChartData(raw.chart);
      if (!base.title || !chart) return null;
      slide = { ...base, chart };
      break;
    }
    case "quote": {
      const quote = truncateString(raw.quote, 300);
      if (!quote) return null;
      slide = { ...base, quote, attribution: truncateString(raw.attribution, 100) };
      break;
    }
    case "table": {
      const table = validateTableData(raw.table);
      if (!base.title || !table) return null;
      slide = { ...base, table };
      break;
    }
    case "process_steps": {
      // No per-item icon — rendered with numbered circles (same visual
      // vocabulary as timeline's steps), never an icon glyph, so there's no
      // point asking the model for one it would just never see used.
      const items = validateItems(raw.items, { needsIcon: false });
      if (!base.title || items.length < MIN_ITEMS_BY_TYPE.process_steps) return null;
      slide = { ...base, items };
      break;
    }
    default:
      return null;
  }

  // The "bullets used for a metric list" backstop (looksLikeMetricList /
  // convertMetricBulletsToIconList, defined above) is deliberately NOT
  // applied here — validateSlide is also used by generateSlideEdit for
  // single-slide AI edits, which explicitly rejects any model-proposed type
  // change before ever calling this function (see edit.js: "a mid-edit type
  // change was never asked for here"). Silently converting a user's edited
  // bullets slide to icon_list mid-edit would violate that same invariant.
  // Instead it's applied as an explicit post-processing step in
  // validateOutline and validateStructuredSlide below, the two places a type
  // decision/correction is actually expected to happen.

  // Defense-in-depth: reject any otherwise-valid slide that's still thin
  // overall, even if it passed every field-level check above. See
  // MIN_SLIDE_WORDS.
  if (!WORD_FLOOR_EXEMPT_TYPES.has(slide.type) && countSlideWords(slide) < MIN_SLIDE_WORDS) {
    return null;
  }

  // Freeform editor fields (see elements.js) — the LLM never produces or
  // sees these. `id` is a pass-through: kept if the model echoed it back
  // verbatim (it's told to preserve unrelated fields on an edit), otherwise
  // freshly minted. `elements`/`backgroundColor`/`layoutOverrides` are
  // ALWAYS reset here regardless of raw input, then restored from the
  // pre-edit slide by the caller's freeform-merge step — so a model
  // response can never inject fake freeform data, and a normal AI edit can
  // never silently drop a user's manual one.
  slide.id = (typeof raw.id === "string" && raw.id.trim()) ? raw.id.trim() : crypto.randomUUID();
  slide.elements = [];
  slide.backgroundColor = null;
  // {fieldPath: {x, y}} manual position overrides for this slide's OWN
  // template content (title/bullets/item labels/...) — same independent-
  // override-layer treatment as elements/backgroundColor above. See
  // elements.js's validateLayoutOverrides.
  slide.layoutOverrides = {};

  return slide;
}

// Exact-string matching (the first version of this dedup logic) turned out
// too brittle: real duplicate-topic slides almost never repeat a title/label
// verbatim — e.g. an item labeled "Two Deployment Models" followed later by
// a slide titled "Deployment Models" is the same re-tread, but no exact
// string ever matches. Token-overlap catches paraphrased-but-still-the-same
// topic without needing verbatim repetition.
const REDUNDANCY_STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "for", "and", "or", "to", "with", "is", "are",
  "this", "that", "your", "our", "from", "by", "as", "at", "two", "three", "four",
  "five", "six", "seven", "eight", "nine", "ten",
]);
// brandTokens excludes the deck/product's own name (e.g. "Text"/"Digest"
// from a deck titled "My Text Digest") — confirmed to otherwise cause false
// positives, since the product name legitimately recurs across many
// unrelated slide titles ("Introducing My Text Digest", "Business Impact of
// My Text Digest", ...) as branding, not as a sign two slides share a topic.
function significantTokens(text, brandTokens) {
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !REDUNDANCY_STOPWORDS.has(w) && !(brandTokens && brandTokens.has(w)))
  );
}
// Overlap coefficient (shared / smaller set size), not Jaccard — this is
// specifically measuring "is the SHORTER label essentially a subset of the
// longer one," which is exactly the re-tread pattern (a short item label
// like "deployment" fully contained in a longer slide title "deployment
// models", or vice versa), regardless of how much extra text the longer one
// carries.
function topicOverlap(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / Math.min(a.size, b.size);
}
const TITLE_REDUNDANCY_THRESHOLD = 0.6;
const ITEM_REDUNDANCY_THRESHOLD = 0.6;
const ITEMS_REDUNDANCY_MAJORITY = 0.5;

// Never throws — a malformed/unusable response degrades to null so deck
// generation reports a clean error instead of producing a broken file.
export function validateOutline(rawJsonString) {
  let parsed;
  try {
    parsed = JSON.parse(rawJsonString);
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const title = truncateString(parsed.title, MAX_TITLE_LEN) || "Untitled Deck";
  const paletteName = PALETTES[parsed.paletteName] ? parsed.paletteName : DEFAULT_PALETTE_NAME;
  const fontPairName = FONT_PAIRS[parsed.fontPairName] ? parsed.fontPairName : DEFAULT_FONT_PAIR_NAME;

  let sectionHeaderSeen = false;
  // The deck/product's own name (e.g. "Text"/"Digest") recurs in most slide
  // titles as branding — excluded from redundancy comparisons so it never
  // counts as two slides "sharing a topic."
  const brandTokens = significantTokens(title);
  // Each entry is a token set "fingerprint" of one earlier KEPT slide's
  // title or one of its item labels — the growing pool a new slide gets
  // checked against for topic re-tread.
  const seenTopics = [];
  const slides = (Array.isArray(parsed.slides) ? parsed.slides : [])
    .map(validateSlide)
    .filter(Boolean)
    .map(applyMetricListBackstop)
    // Enforced in code, not just prompted: a divider slide carries no real
    // content (title + one sentence), so more than one in a deck is dead
    // weight that drags down content density. Keep only the first.
    .filter((s) => {
      if (s.type !== "section_header") return true;
      if (sectionHeaderSeen) return false;
      sectionHeaderSeen = true;
      return true;
    })
    // Two distinct re-tread patterns, both confirmed happening in practice
    // repeatedly (e.g. an item labeled "Two Deployment Models" followed
    // later by a whole slide titled "Deployment Models" going over the same
    // Cloud/Desktop split again) and NOT reliably stopped by prompting alone
    // — enforced in code instead, same reasoning as the section_header cap
    // above. Uses fuzzy token-overlap (see topicOverlap), not exact string
    // equality: real re-treads almost never repeat a title/label verbatim,
    // they paraphrase it, so exact matching missed most real cases.
    //  1. This slide's TITLE is essentially the same topic as an earlier
    //     slide's title or one of its item labels (e.g. "Deployment Models"
    //     vs. an earlier item "Two Deployment Models").
    //  2. A majority of THIS slide's own items are each essentially the same
    //     topic as something already seen (e.g. both slides' items are
    //     "Cloud Version" / "Desktop Version"). Requires >=2 items and a
    //     majority match so that two slides sharing ONE incidental item
    //     among several different ones (a normal, non-redundant overlap,
    //     confirmed to happen for real with "Conversational Access" showing
    //     up in two different capability slides) isn't flagged.
    .filter((s) => {
      const titleTokens = significantTokens(s.title, brandTokens);
      const titleReTreadsEarlierTopic =
        titleTokens.size > 0 && seenTopics.some((t) => topicOverlap(titleTokens, t) >= TITLE_REDUNDANCY_THRESHOLD);

      let itemsReTreadEarlierTopic = false;
      const itemTokenSets = Array.isArray(s.items) ? s.items.map((i) => significantTokens(i.label, brandTokens)) : [];
      if (itemTokenSets.length >= 2) {
        const matchedCount = itemTokenSets.filter(
          (it) => it.size > 0 && seenTopics.some((t) => topicOverlap(it, t) >= ITEM_REDUNDANCY_THRESHOLD)
        ).length;
        if (matchedCount / itemTokenSets.length >= ITEMS_REDUNDANCY_MAJORITY) itemsReTreadEarlierTopic = true;
      }

      const isReTread = titleReTreadsEarlierTopic || itemsReTreadEarlierTopic;
      // Only register a KEPT slide's topics — a dropped re-tread shouldn't
      // pollute the pool with a near-duplicate of what's already there.
      if (!isReTread) {
        if (titleTokens.size > 0) seenTopics.push(titleTokens);
        for (const it of itemTokenSets) if (it.size > 0) seenTopics.push(it);
      }
      return !isReTread;
    })
    .slice(0, MAX_SLIDES);

  if (slides.length < MIN_SLIDES) return null;

  return { title, paletteName, fontPairName, slides };
}

// --- Two-step outline flow ---------------------------------------------
// Step 1 (generateTextOutline) asks for a loose {title, slides:[{title,
// body}]} shape where `body` is lightweight Markdown — nothing rigid enough
// for a human edit to break. The user reviews/edits this plain-text form.
// Step 2 (generateStructuredOutline), only after explicit user confirmation,
// takes the approved prose and asks the model to pick type/role/palette/
// font/icons per slide and reshape the body into the full typed schema.

export function buildTextOutlinePrompt({ filename, documentText, customPrompt = "", presentationType = "" }) {
  const truncatedText = documentText.slice(0, MAX_DOC_CHARS);
  const slideRange = suggestSlideRange(truncatedText.length);

  const styleFraming = PRESENTATION_TYPE_FRAMING[presentationType];
  const hasCustomPrompt = !!customPrompt.trim();
  const styleSection =
    styleFraming || hasCustomPrompt
      ? `IMPORTANT — presentation style for this deck, apply it throughout (tone, content, AND narrative arc):\n` +
        (styleFraming ? `- ${styleFraming}\n` : ``) +
        (hasCustomPrompt ? `- Additional instruction from the user, follow it alongside the rule above: ${customPrompt.trim()}\n` : ``) +
        `\n`
      : ``;

  const system =
    styleSection +
    `You are drafting the OUTLINE for a professional slide deck — plain text only. Don't decide slide layout, colors, icons, charts, or any other visual/design detail yet; a later step handles that. Your only job here is deciding what each slide actually SAYS, the way a presentation designer sketches an outline before building the real slides.\n\n` +
    buildContentDepthRules() +
    `Structure rules:\n` +
    `- Produce ${slideRange.min}-${slideRange.max} slides — this document is approximately ${slideRange.words} words, and that range is sized to cover it thoroughly (one slide per distinct idea, per the rule above) without padding.\n` +
    `- The first slide should be a title slide (deck title in "title", a one-line subtitle as its "body"). The last slide should be a closing/summary slide.\n` +
    `- Every slide needs a short "title" (under 10 words) and a "body" written in lightweight Markdown:\n` +
    `  - Whenever a slide's content contains MULTIPLE distinct facts, numbers, or points — even ones that could grammatically fit into one run-on sentence — write EACH as its own bullet line starting with "- ", one point per line, not as a single dense paragraph. A reader should be able to scan the slide at a glance. Bad: "Revenue reached $482M, up 18%. Net income rose to $54M, up 36%. Margins improved to 46%." Good:\n` +
    `    - Revenue: $482M (+18% YoY)\n` +
    `    - Net income: $54M (+36% YoY)\n` +
    `    - Gross margin: 46%\n` +
    `  - Use a plain line (no leading "-") only for genuinely single-sentence content: a title's subtitle, a quote, a section divider's supporting line, or a short intro sentence that comes before a slide's bullet points.\n` +
    `  - Use "**bold**" sparingly, around the single most important number, name, or phrase in a line — not whole sentences.\n` +
    `  - Every number must be real — stated in or directly computable from the document, never invented.\n` +
    `- When a slide describes 2-3 NAMED parallel alternatives (e.g. "Cloud Version" vs "Desktop Version"), write each alternative as its own clearly labeled bullet block within the body (e.g. a bold label line followed by that alternative's own bullets) — this becomes a side-by-side layout later, so keep the alternatives visually separable.\n` +
    `- When a slide describes an ordered sequence of steps, write them as bullet lines in order.\n\n` +
    `Respond in valid JSON only, matching this shape:\n` +
    `{"title": string, "slides": [{"title": string, "body": string}, ...]}\n` +
    `Example "body" for a stats-heavy slide: "Q2 results beat targets on every metric:\\n- Revenue: **$482M** (+18% YoY)\\n- Net income: $54M (+36% YoY)\\n- Gross margin: 46%"`;

  const user =
    `Document filename: ${filename}\n\n` +
    `Document content:\n${truncatedText}\n\n` +
    `Draft the slide-by-slide outline now. Return the JSON now.`;

  return { system, user };
}

// Collapses slide 1's body down to a single plain sentence — enforces
// buildTextOutlinePrompt's "a one-line subtitle" instruction for the first
// slide IN CODE, because the prompt instruction alone wasn't reliably
// followed: confirmed happening in practice, the model wrote a multi-fact
// bulleted intro (headquarters, employee count, segment list) as slide 1's
// body instead of one sentence. This runs BEFORE the outline is shown to
// the user for review, so the review UI itself shows a clean one-line intro
// instead of a bulleted one, not just the later-structured deck. Only the
// FIRST line survives — later facts belong on a real content slide, not
// crammed into the title card's one-line subtitle (same "keep only the
// first point" precedent as buildFallbackSlide's own title fallback below).
function collapseToTitleSubtitle(body) {
  const firstLine = (body || "").split("\n").map((l) => l.trim()).filter(Boolean)[0] || "";
  const clean = firstLine.replace(/^[-*]\s+/, "").replace(/\*\*(.+?)\*\*/g, "$1");
  return truncateString(clean, 160);
}

// Never throws — same convention as validateOutline.
export function validateTextOutline(rawJsonString) {
  let parsed;
  try {
    parsed = JSON.parse(rawJsonString);
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const title = truncateString(parsed.title, MAX_TITLE_LEN) || "Untitled Deck";
  const slides = (Array.isArray(parsed.slides) ? parsed.slides : [])
    .map((s, i) => {
      if (!s || typeof s !== "object") return null;
      const slideTitle = truncateString(s.title, MAX_TITLE_LEN);
      if (!slideTitle) return null;
      const rawBody = typeof s.body === "string" ? s.body.trim().slice(0, 4000) : "";
      const body = i === 0 ? collapseToTitleSubtitle(rawBody) : rawBody;
      return { title: slideTitle, body };
    })
    .filter(Boolean)
    .slice(0, MAX_SLIDES);

  if (slides.length < MIN_SLIDES) return null;
  return { title, slides };
}

export async function generateTextOutline({ openai, filename, documentText, customPrompt, presentationType, signal }) {
  try {
    const { system, user } = buildTextOutlinePrompt({ filename, documentText, customPrompt, presentationType });
    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.5,
        max_tokens: 6000,
      },
      { signal }
    );

    const content = completion.choices?.[0]?.message?.content;
    if (!content) return null;

    const outline = validateTextOutline(content);
    if (!outline) {
      console.warn("generateTextOutline: no usable outline after validation, raw model output:", content);
    }
    return outline;
  } catch (err) {
    console.error("generateTextOutline error:", err.message || err);
    return null;
  }
}

// The modal's optional "Visual Style" selector — an independent axis from
// presentationType (a pitch deck can still ask to be "more analytical"), so
// this is additive to PRESENTATION_TYPE_FRAMING's own type-leaning prose,
// not a replacement. "" (Balanced) intentionally has no entry — no nudge,
// default behavior.
const VISUAL_STYLE_GUIDANCE = {
  "more-visual": `Additionally, the user asked for a MORE VISUAL style: lean toward icon-forward, visually rich types (icon_grid, icon_list, stat_callout, chart, comparison, table) wherever the content genuinely fits one, and avoid plain "bullets" whenever a more visual type would work just as well.`,
  "more-analytical": `Additionally, the user asked for a MORE ANALYTICAL style: lean toward data-dense, structured types (table, chart, stat_callout, comparison) — prioritize precise numbers and structured comparisons over decorative icon treatments.`,
  "minimal": `Additionally, the user asked for a MINIMAL style: lean toward simpler, less decorated types (bullets, quote, plain title-style slides) over icon-grid/icon-heavy visual types — keep each slide's visual footprint restrained and text-forward.`,
};

// `slides` here is the user-approved/edited {title, body}[] from the review
// step — deliberately NOT re-sent the source document (restricts the model
// to material already in front of it, so it can't fabricate content the
// user never approved, and keeps this call cheap). This is the ONLY place
// slide "type" gets decided in the two-step flow.
export function buildStructurePrompt({ title, slides, excludePaletteNames = [], presentationType = "", customPrompt = "", visualStyle = "" }) {
  // Recently-used palettes are dropped from the offered list (not just
  // discouraged in prose) so back-to-back decks don't converge on the same
  // "safe" choice — keep at least half the palettes available so the model
  // still has real room to match the document's tone.
  const allPaletteNames = PALETTE_SUGGESTIONS_BY_PRESENTATION_TYPE[presentationType] || Object.keys(PALETTES);
  const availablePaletteNames =
    allPaletteNames.length - excludePaletteNames.length >= allPaletteNames.length / 2
      ? allPaletteNames.filter((n) => !excludePaletteNames.includes(n))
      : allPaletteNames;
  const paletteNames = availablePaletteNames.join(", ");
  const fontPairNames = Object.keys(FONT_PAIRS).join(", ");
  const iconNames = ICON_NAMES.join(", ");
  const typeSchema = buildSlideTypeSchema();
  const styleFraming = PRESENTATION_TYPE_FRAMING[presentationType];
  const hasCustomPrompt = !!customPrompt.trim();
  const roleNames = SLIDE_ROLES.join(", ");

  const system =
    `You are formatting an ALREADY-APPROVED slide outline into its final structured form. The user reviewed and edited this outline themselves — your ONLY job is picking the best-fitting slide type/layout for each slide and populating the schema fields from the content already given. Never invent a new fact, number, sentence, or point — in ANY field, including "subtitle"/"context"/"quote", not just bullets/items/stats — that isn't already present in that slide's own approved content. If a slide's content is thin, format it as-is rather than padding it with invented material.\n\n` +
    `Each slide's "body" below is written in lightweight Markdown: lines starting with "- " are that slide's distinct points — map these directly to "bullets"/"items"/"stats" entries (one per line) for whichever type you choose, don't merge multiple bullet lines into one. "**text**" marks emphasis; when copying content into a schema field, strip the "**" markers and use the plain text — the deck schema has no inline rich-text formatting, plain strings only. A body may open with a plain (non-bulleted) sentence before its bullets — treat that as introductory context (e.g. stat_callout's "context" field, or fold it into the title/subtitle) rather than a bullet itself.\n\n` +
    `You must produce EXACTLY ${slides.length} slides, in the SAME ORDER as given below — one structured slide per input slide, at the SAME index. Never merge, split, reorder, add, or drop a slide, and never leave an entry out of the "slides" array — every one of the ${slides.length} approved slides below must map to exactly one output slide.\n\n` +
    `For each input slide, choose the "type" that best fits its content:\n` +
    SLIDE_TYPES.map((t) => typeSchema[t]).join("") +
    (styleFraming ? `\nPresentation style, for tone/wording only (slide selection and order are already fixed above): ${styleFraming}\n` : ``) +
    (hasCustomPrompt
      ? `\nThe user gave this additional instruction when generating the deck: "${customPrompt.trim()}". Slide content and order are already fixed above, so this can't add new facts or slides — but use it to guide layout/type choice (e.g. more visual vs. more analytical), emphasis, CTA/closing framing, and tone within each slide's existing content.\n`
      : ``) +
    (VISUAL_STYLE_GUIDANCE[visualStyle] ? `\n${VISUAL_STYLE_GUIDANCE[visualStyle]}\n` : ``) +
    `\nFor each slide, also pick ONE "role" describing its narrative purpose from: ${roleNames}. Use "content" for a slide that's just informative body content with no more specific role (most slides). Use the others when they genuinely fit: "hook" (an attention-grabbing opener), "problem", "solution", "proof" (evidence/traction/results), "market", "method" (how something works), "risk", "comparison", "next_steps", "ask" (a call to action/funding/adoption ask), "conclusion" (a wrap-up/summary, not a CTA). This is independent of "type" — e.g. a slide can be "type": "closing" with "role": "ask" (a pitch deck's funding ask) or "role": "conclusion" (a university deck's summary).\n` +
    `\nFormatting rules:\n` +
    `- IMPORTANT — prefer "icon_list", "icon_grid", "stat_callout", or "table" over plain "bullets" whenever a slide's content is a list of NAMED items or metrics — e.g. a body that reads as a series of "Label: Value" or "Name" + "Metric: $X" lines (segment names with a revenue figure each, balance-sheet line items, cash-flow lines, KPIs). "bullets" renders in a narrow left column with a large empty icon on the right, which looks sparse and under-filled for this kind of content — "icon_list" gives each item its own full-width row with its own icon, "stat_callout" gives each metric a large number treatment, and "table" (2 columns: item + value) is often the cleanest fit once there are 4+ rows and every value is just a bare number with no descriptive phrase (a full income statement or balance sheet, for instance, reads better as one table than as five icon_list rows). This applies even when the body only has 3-5 short lines — a short list of metrics is exactly the case icon_list/stat_callout exist for, not a sign the slide should default to bullets. Reserve "bullets" for content that's genuinely prose-style scannable points (a paragraph's worth of narrative statements), not structured label/value data.\n` +
    `- IMPORTANT — avoid using the SAME slide type on 3 or more CONSECUTIVE slides, even when each slide's content independently fits that type well. Three table slides (or three icon_list slides) back to back reads as repetitive and generic, even though each one is individually the "correct" choice by the rules above. This comes up most with a run of similar structured-data slides (e.g. an income statement, a balance sheet, and a cash flow summary, each just label/value rows) — when that happens, alternate between at least two different well-fitting types across the run instead of picking the same one every time (e.g. table / icon_list / table, or table / stat_callout for the slide whose single most important number deserves a big-number treatment / table — not table / table / table).\n` +
    `- Copy each slide's "title" field EXACTLY as given below, verbatim — don't shorten, "clean up", or reword it, even slightly, even if it seems long or redundant. The user edited these titles themselves.\n` +
    `- Reshape each slide's "body" text into its chosen type's fields as needed (e.g. splitting lines into "bullets" or "items", or lifting out a number into "stats") — stay grounded in what's actually written there, don't summarize away specific facts/numbers, and don't add sub-points the body doesn't contain.\n` +
    `- IMPORTANT — do NOT default the first slide (or any slide) to a generic "title" deck-opener card just because it comes first. Only use "type": "title" (or "section_header"/"quote") for a slide whose OWN approved body is itself genuinely just a short title/subtitle-length sentence with no other content. If an approved slide's body has MULTIPLE distinct lines (several "- " bullet points or several separate sentences) — real substance — format THAT content using a content-bearing type (bullets, icon_list, stat_callout, comparison, etc.); never discard it in favor of a generic title card. But if an approved body is exactly ONE single line/sentence — even a fact-dense one that happens to mention several details (e.g. "Designs automation solutions for industrial and logistics markets, headquartered in Austin with 3,000+ employees") — do NOT fragment that one sentence into separate bullet points; keep it whole as "subtitle" under "type": "title" (or "quote"/"section_header"). This especially applies to the first slide, whose body the outline step deliberately keeps to one sentence so it reads as the deck's opening card — splitting it into bullets defeats that. The overall deck name is already carried in the top-level "title" JSON field below — don't re-introduce it as a fabricated slide. The same first-slide logic applies in reverse to the LAST slide when the presentation style above describes a closing ask/CTA: if its approved body reads as a short wrap-up statement (1-3 forward-looking sentences — "seeking investment," "let's talk next steps," not a recap of specific facts/figures already covered elsewhere), use "type": "closing" with that statement as the subtitle, rather than "bullets" — that's exactly the shape "closing" exists for. Still use "bullets" for a genuine multi-point recap slide.\n` +
    `- Pick ONE palette name from: ${paletteNames}. Pick a palette that fits this deck's topic and tone.\n` +
    `- Pick ONE font pair name from: ${fontPairNames}.\n` +
    `- Icons: reference ONLY these names (or omit the field): ${iconNames}.\n` +
    `- Every slide except "title", "quote" needs a visual element (icon, stat, chart, or items grid) — never a text-only slide.\n\n` +
    `Respond in valid JSON only, matching this shape (every slide also takes a "role" field, per the "role" instruction above):\n` +
    `{"title": string, "paletteName": string, "fontPairName": string, "slides": [\n` +
    `  {"type": "title", "title": string, "subtitle": string, "role": string, "speakerNotes": string},\n` +
    `  {"type": "bullets", "title": string, "bullets": [string, ...], "icon": string, "role": string, "speakerNotes": string},\n` +
    `  {"type": "icon_list", "title": string, "items": [{"icon": string, "label": string, "description": string}, ...], "role": string},\n` +
    `  {"type": "feature_split", "title": string, "icon": string, "panelLabel": string, "items": [{"label": string, "description": string}, ...], "role": string},\n` +
    `  {"type": "comparison", "title": string, "items": [{"label": string, "bullets": [string, ...]}, ...], "role": string},\n` +
    `  {"type": "stat_callout", "title": string, "context": string, "stats": [{"value": string, "label": string}], "role": string, "speakerNotes": string},\n` +
    `  {"type": "chart", "title": string, "chart": {"chartType": "bar", "title": string, "categories": [string, ...], "series": [{"name": string, "data": [number, ...]}]}, "role": string},\n` +
    `  {"type": "table", "title": string, "table": {"headers": [string, ...], "rows": [[string, ...], ...]}, "role": string}\n` +
    `]}`;

  const user =
    `Approved outline title: ${title}\n\n` +
    `Approved slides:\n${JSON.stringify(slides, null, 2)}\n\n` +
    `Format this into the final structured deck JSON now. Return the JSON now.`;

  return { system, user };
}

// Deterministic, always-valid fallback for one slide — used whenever the
// structuring LLM's response for that slide is missing or doesn't validate.
// Never calls the LLM, never fails: parses the approved body's own "- "
// markdown bullet lines (the exact convention the text-outline step already
// writes) directly into a plain "bullets" slide, the one type with no field
// requirements beyond a title. This is the guarantee that an approved slide
// can NEVER be silently dropped from the final deck, no matter what the
// structuring call returns.
//
// `isFirst` (the only context this function has beyond the approved slide
// itself) special-cases the deck's own opening slide: when its approved body
// has no real bullet structure (0-1 lines — a single plain sentence, exactly
// what the text-outline prompt asks slide 1's body to be, NOT multiple "- "
// points), fall back to "title" instead of "bullets". Without this, a failed
// structuring response for slide 1 always produced a sparse one-bullet
// "bullets" slide (title + one bullet + a stranded icon circle) instead of
// the deck's own opening/title card — confirmed happening in practice.
export function buildFallbackSlide(approvedSlide, { isFirst = false } = {}) {
  const title = truncateString(approvedSlide?.title, MAX_TITLE_LEN) || "Untitled Slide";
  const bodyLines = (approvedSlide?.body || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = bodyLines
    .map((l) => l.replace(/^[-*]\s+/, "").replace(/\*\*(.+?)\*\*/g, "$1"))
    .map((b) => truncateString(b, MAX_BULLET_LEN))
    .filter(Boolean)
    .slice(0, MAX_BULLETS);

  const base = { id: crypto.randomUUID(), elements: [], backgroundColor: null, layoutOverrides: {}, role: DEFAULT_SLIDE_ROLE };

  if (isFirst && bullets.length <= 1) {
    // Re-derive from bodyLines[0] rather than reusing bullets[0]: bullets[]
    // is truncated to MAX_BULLET_LEN (140 chars, right for an actual list
    // item), but a "title" slide's subtitle field allows up to 160 chars
    // (see validateSlide's own "title" case) — the same cap
    // collapseToTitleSubtitle already truncates slide 1's body to. Reusing
    // the tighter cap here cut a genuinely-fitting sentence off mid-word.
    const firstLine = bodyLines[0]
      ? truncateString(bodyLines[0].replace(/^[-*]\s+/, "").replace(/\*\*(.+?)\*\*/g, "$1"), 160)
      : "";
    return { ...base, type: "title", title, subtitle: firstLine || undefined };
  }

  return { ...base, type: "bullets", title, bullets: bullets.length > 0 ? bullets : [title] };
}

// Deliberately does NOT reuse validateOutline/validateSlide's content-quality
// floors (word-count minimums, required "context"/isSubstantive checks) or
// topic-redundancy deduplication wholesale the way the old single-call
// design did — those exist to filter a model's FREE, unconstrained first
// draft, where a thin or duplicate slide is a real risk worth dropping. Here
// the input is a user-approved outline; silently dropping any of it is data
// loss, not quality control (confirmed: this is exactly what caused an
// 8-slide approved outline to build as a 5-slide deck). validateSlide's
// field-shaping (truncation, per-type shape) is still reused where a slide
// DOES validate, but nothing here is allowed to remove a slide outright —
// see buildFallbackSlide.
// The metric-list backstop applies to a fallback slide too, not just the
// successful validateSlide path below — buildFallbackSlide's own default is
// "bullets" (see its own isFirst special-case for the title exception), and
// a fallback is exactly as likely to be a metric list as a model response
// that validated cleanly (confirmed: a structuring response with fewer than
// MIN_LIST_BULLETS metric bullets falls back here, and without this it would
// silently skip the conversion a successfully-validated response with the
// same content would get).
function fallbackStructuredSlide(approvedSlide, isFirst) {
  return applyMetricListBackstop(buildFallbackSlide(approvedSlide, { isFirst }));
}

export function validateStructuredSlide(raw, approvedSlide, isFirst = false) {
  const approvedWordCount = (approvedSlide?.body || "").trim().split(/\s+/).filter(Boolean).length;
  // A content-light type (title/section_header/quote) legitimately fits only
  // a short subtitle-length approved slide — if the approved body actually
  // has real content, the model choosing a content-light type is the
  // observed failure mode (replacing a substantive slide with a fabricated
  // generic title card), not a genuine formatting choice. Force the
  // fallback instead of trusting it.
  const isContentLightType = raw && ["title", "section_header", "quote"].includes(raw.type);
  if (isContentLightType && approvedWordCount > 15) {
    return fallbackStructuredSlide(approvedSlide, isFirst);
  }
  // Mirror image of the guard above, for the deck's opening slide
  // specifically: collapseToTitleSubtitle (the text-outline validation
  // step) deliberately collapses slide 1's body down to ONE plain sentence
  // so it reads as a title card here. A single fact-dense sentence (e.g.
  // naming the company's markets, HQ, and headcount all in one clause)
  // still has enough real words to read as "substance" — confirmed
  // happening in practice: the model chooses "bullets" and fragments that
  // one sentence into 3-4 separate bullet points instead of keeping it
  // whole as a subtitle. Unlike the guard above (word count), what actually
  // distinguishes "genuinely thin" from "genuinely substantive" here is
  // LINE count, not word count — a single line is exactly the shape the
  // outline step intentionally produced, no matter how many words are
  // packed into it.
  const approvedBodyLines = (approvedSlide?.body || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (isFirst && !isContentLightType && approvedBodyLines.length <= 1) {
    return fallbackStructuredSlide(approvedSlide, isFirst);
  }
  if (!raw || typeof raw !== "object" || !SLIDE_TYPES.includes(raw.type)) {
    return fallbackStructuredSlide(approvedSlide, isFirst);
  }
  // Guards against index misalignment — if the model dropped an earlier
  // slide and shifted the rest up by one position (observed in practice:
  // this is HOW 3 approved slides vanished while the remaining ones kept
  // their own valid-looking content, just one slot too early), a raw entry
  // can be structurally valid while belonging to a different approved slide
  // than the one it's about to be assigned to. Reuses the same
  // significantTokens/topicOverlap helpers the free-draft redundancy filter
  // uses, for the opposite purpose: confirming a match, not penalizing one.
  // Majority overlap (>=0.5), not "any shared word" — several of this file's
  // real titles share one generic word (e.g. "...Summary") while covering
  // completely different content.
  const rawTitleTokens = significantTokens(raw.title);
  const approvedTitleTokens = significantTokens(approvedSlide?.title);
  if (approvedTitleTokens.size > 0 && rawTitleTokens.size > 0 && topicOverlap(rawTitleTokens, approvedTitleTokens) < 0.5) {
    return fallbackStructuredSlide(approvedSlide, isFirst);
  }
  const validated = validateSlide(raw);
  if (!validated) return fallbackStructuredSlide(approvedSlide, isFirst);
  // Structuring is exactly where a type decision/correction belongs (unlike
  // generateSlideEdit's single-slide edits, which explicitly forbid a type
  // change) — apply the metric-list backstop here.
  const converted = applyMetricListBackstop(validated);
  // The title has no structural reshaping to do (unlike body -> bullets/
  // items/stats, which genuinely requires the model to parse and split
  // text) — there's no reason for it to differ from what the user approved
  // at all. Confirmed happening in practice: the model quietly "cleaned up"
  // an edited title ("...Highlights of solstice" -> "...Highlights"),
  // silently discarding a user edit even though the slide otherwise
  // structured correctly. Force it verbatim rather than trusting the
  // model's own title field, exactly like buildFallbackSlide already does.
  converted.title = truncateString(approvedSlide?.title, MAX_TITLE_LEN) || converted.title;
  // No prior slide to fall back to here (this is fresh structuring, not an
  // edit) — default outright rather than leaving it undefined.
  converted.role = converted.role || DEFAULT_SLIDE_ROLE;
  return converted;
}

// Index-matched against the APPROVED slides, not filtered from the model's
// raw array — this is what guarantees slides.length always equals
// approved.slides.length, by construction, with no separate count-check or
// retry loop needed for that specific failure mode.
export function validateStructuredOutline(rawJsonString, approved) {
  let parsed;
  try {
    parsed = JSON.parse(rawJsonString);
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const title = truncateString(parsed.title, MAX_TITLE_LEN) || approved.title || "Untitled Deck";
  const paletteName = PALETTES[parsed.paletteName] ? parsed.paletteName : DEFAULT_PALETTE_NAME;
  const fontPairName = FONT_PAIRS[parsed.fontPairName] ? parsed.fontPairName : DEFAULT_FONT_PAIR_NAME;
  const rawSlides = Array.isArray(parsed.slides) ? parsed.slides : [];

  const slides = approved.slides.map((approvedSlide, i) => validateStructuredSlide(rawSlides[i], approvedSlide, i === 0));

  return { title, paletteName, fontPairName, slides };
}

export async function generateStructuredOutline({ openai, title, slides, excludePaletteNames, presentationType, customPrompt, visualStyle, signal }) {
  const approved = { title, slides };

  const callOnce = async () => {
    const { system, user } = buildStructurePrompt({ title, slides, excludePaletteNames, presentationType, customPrompt, visualStyle });
    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 10000,
      },
      { signal }
    );
    return completion.choices?.[0]?.message?.content;
  };

  try {
    let content = await callOnce();
    let outline = content ? validateStructuredOutline(content, approved) : null;
    // The only way validateStructuredOutline returns null is genuinely
    // unparseable/non-object JSON (a missing or invalid PER-SLIDE entry is
    // always recovered via buildFallbackSlide instead, not a hard failure)
    // — one retry covers a transient bad response without needing a whole
    // separate repair-pass pipeline.
    if (!outline) {
      content = await callOnce();
      outline = content ? validateStructuredOutline(content, approved) : null;
    }
    if (!outline) {
      console.warn("generateStructuredOutline: no usable JSON after retry");
    } else if (presentationType) {
      const result = scoreDeckAgainstIntent(outline, presentationType);
      if (result && result.score < 1) {
        console.warn(
          `generateStructuredOutline: deck scored ${result.score.toFixed(2)} against "${presentationType}" intent — ${result.warnings.join(" | ")}`
        );
      }
    }
    return outline;
  } catch (err) {
    console.error("generateStructuredOutline error:", err.message || err);
    return null;
  }
}

// Normalizes the modal's raw inputs (presentationType/customPrompt/
// generateImages) into one object carried on the outline itself — same
// pattern as outline.brandKit/outline.presentationType, so it survives
// reorders/edits/theme-swaps without a DB migration. Which slides the user
// wants an image for, decided at outline-review time (not brand-kit-modal
// time). "important" is the default; "all" is deliberately not a valid
// value yet.
export const IMAGE_MODES = ["important", "none", "manual"];
export const DEFAULT_IMAGE_MODE = "important";

export function buildDeckIntent({ presentationType, customPrompt, generateImages, visualStyle, imageMode }) {
  return {
    presentationType: presentationType || null,
    customPrompt: (customPrompt || "").trim(),
    generateImages: !!generateImages,
    visualStyle: VISUAL_STYLE_GUIDANCE[visualStyle] ? visualStyle : null,
    imageMode: IMAGE_MODES.includes(imageMode) ? imageMode : DEFAULT_IMAGE_MODE,
  };
}
