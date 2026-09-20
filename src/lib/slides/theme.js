// src/lib/slides/theme.js
// Design system constants for AI-generated slide decks. Pure data — no
// PptxGenJS calls here — so layouts.js and buildDeck.js stay decoupled from
// the actual rendering. Palette/font-pair names double as the enum the LLM
// is constrained to pick from in outline.js.
//
// Ported near-verbatim from electron/slides/theme.js (desktop). Must be
// importable from both worker/ (server-side .pptx render) and the frontend
// (live-preview render in SlideRenderer.jsx) so presentation-type chrome and
// palette resolution can never silently drift between the exported file and
// the in-app preview — a confirmed desktop bug before this file was shared
// by both.

export const PALETTES = {
  "Midnight Executive": { primary: "1E2761", secondary: "CADCFC", accent: "FFFFFF" },
  "Forest & Moss": { primary: "2C5F2D", secondary: "97BC62", accent: "F5F5F5" },
  "Coral Energy": { primary: "F96167", secondary: "F9E795", accent: "2F3C7E" },
  "Warm Terracotta": { primary: "B85042", secondary: "E7E8D1", accent: "A7BEAE" },
  "Ocean Gradient": { primary: "065A82", secondary: "1C7293", accent: "21295C" },
  "Charcoal Minimal": { primary: "36454F", secondary: "F2F2F2", accent: "212121" },
  "Teal Trust": { primary: "028090", secondary: "00A896", accent: "02C39A" },
  "Berry & Cream": { primary: "6D2E46", secondary: "A26769", accent: "ECE2D0" },
  "Sage Calm": { primary: "84B59F", secondary: "69A297", accent: "50808E" },
  "Cherry Bold": { primary: "990011", secondary: "FCF6F5", accent: "2F3C7E" },
};

// Safe-list only (Arial, Calibri, Cambria, Times New Roman, Courier New,
// Bookman Old Style, Century Schoolbook) — these render true-to-width in
// LibreOffice-based rendering paths *and* ship with Office, so there's no
// overflow-risk gap between what we preview and what the user's real
// PowerPoint shows. There is no automated per-deck visual QA in this
// pipeline, so an "unreliable" font is a real text-overflow risk, not just a
// preview quirk. Do not expand this list without adding real overflow
// verification first.
export const FONT_PAIRS = {
  "Cambria / Calibri": { header: "Cambria", body: "Calibri" },
  "Cambria / Arial": { header: "Cambria", body: "Arial" },
  "Bookman Old Style / Calibri": { header: "Bookman Old Style", body: "Calibri" },
  "Bookman Old Style / Times New Roman": { header: "Bookman Old Style", body: "Times New Roman" },
  "Century Schoolbook / Arial": { header: "Century Schoolbook", body: "Arial" },
  "Century Schoolbook / Calibri": { header: "Century Schoolbook", body: "Calibri" },
  "Times New Roman / Arial": { header: "Times New Roman", body: "Arial" },
  "Calibri / Arial": { header: "Calibri", body: "Arial" },
};

export const DEFAULT_PALETTE_NAME = "Midnight Executive";
export const DEFAULT_FONT_PAIR_NAME = "Cambria / Calibri";

// Curated palette subset per presentation type — layered on top of
// STYLE_BY_PRESENTATION_TYPE below, which only ever varies card chrome/scale,
// never color. Without this, palette selection was fully independent of
// presentationType, so a pitch-deck and an internal-report built from
// similar source material could land on the same or a visually similar
// palette — the single biggest differentiator two decks of different types
// actually have. Each subset is picked for tone fit (energetic/bold for
// pitch-deck & sales, muted/uniform for internal-report, calm for
// university, high-contrast for conference-talk), and every subset still
// has 4 entries so the "exclude recently used, keep at least half
// available" rotation logic in outline.js keeps working meaningfully
// instead of collapsing to 1-2 forced choices.
export const PALETTE_SUGGESTIONS_BY_PRESENTATION_TYPE = {
  "pitch-deck": ["Coral Energy", "Cherry Bold", "Midnight Executive", "Ocean Gradient"],
  "sales": ["Coral Energy", "Warm Terracotta", "Cherry Bold", "Teal Trust"],
  "university": ["Sage Calm", "Forest & Moss", "Charcoal Minimal", "Berry & Cream"],
  "internal-report": ["Charcoal Minimal", "Midnight Executive", "Ocean Gradient", "Sage Calm"],
  "conference-talk": ["Cherry Bold", "Coral Energy", "Midnight Executive", "Berry & Cream"],
  "minimal": ["Charcoal Minimal", "Sage Calm", "Berry & Cream", "Ocean Gradient"],
};

// Slide dimensions for LAYOUT_WIDE, in inches.
export const SLIDE_W = 13.3;
export const SLIDE_H = 7.5;

export const MARGIN = 0.5;

// Fixed width of the AI-generated hero-image panel on title/section_header/
// closing/quote slides (imagePrompt.js's IMAGE_ELIGIBLE_TYPES) — a
// right-edge, full-height panel. Lives here (not layouts.js, where it's
// consumed) so layouts.js's PptxGenJS export AND SlideRenderer.jsx's live
// preview narrow their title/subtitle text boxes by the exact same amount
// the panel actually occupies — one number two independently-implemented
// renderers must agree on, not two numbers that can silently drift apart.
export const HERO_IMAGE_PANEL_W = 4.3;

export const SPACING = {
  marginSm: 0.3,
  marginMd: 0.5,
  blockGap: 0.4,
};

export const TYPE_SCALE = {
  title: 40,
  sectionTitle: 32,
  slideTitle: 28,
  sectionHeader: 22,
  body: 15,
  caption: 11,
  statNumber: 64,
};

function luminanceOf(hex) {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Text color to use on top of a given background — always high contrast
// (never light-on-light or dark-on-dark).
export function contrastText(bgHex) {
  return luminanceOf(bgHex) > 0.6 ? "1A1A1A" : "FFFFFF";
}

export function mixHex(hexA, hexB, t) {
  const a = [0, 2, 4].map((i) => parseInt(hexA.slice(i, i + 2), 16));
  const b = [0, 2, 4].map((i) => parseInt(hexB.slice(i, i + 2), 16));
  return a
    .map((v, i) => Math.round(v * (1 - t) + b[i] * t))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

// Several palettes have an intentionally light/near-white accent or
// secondary tone (e.g. "Midnight Executive" accent is literal FFFFFF) —
// that reads fine as text on a dark slide, but every current use of palette
// colors as a *mark* (icon circle, chart bar, stat number) sits on a light
// page background or a white card. A near-white mark on a near-white
// surface isn't just low-contrast, it's invisible. Blend it toward black
// until it's guaranteed readable rather than silently dropping content.
export function ensureReadableOnLight(hex) {
  return luminanceOf(hex) > 0.6 ? mixHex(hex, "000000", 0.55) : hex;
}

// Rotates through accent/secondary/primary for a given index — used wherever
// a layout repeats an element (grid items, timeline steps, stat cards) so a
// deck actually shows its supporting tones instead of leaning on primary for
// everything. Accent first: primary already dominates via the full-bleed
// dark slides (title/section/quote/closing), so per-item accents are what
// makes the palette's secondary/accent tones visible at all. Every candidate
// is passed through ensureReadableOnLight since all current call sites draw
// on a light surface.
export function rotatingColor(theme, index) {
  const sequence = [theme.palette.accent, theme.palette.secondary, theme.palette.primary].map(ensureReadableOnLight);
  return sequence[index % sequence.length];
}

// Named "style," not "variant" — layouts.js's addBackground() already uses
// "variant" for its own unrelated light/dark axis. Deterministic from
// theme.presentationType (set in buildDeck.js from the outline, itself set
// at generation time from the brand-kit modal, and mirrored onto the live
// preview's theme object) rather than an LLM-chosen field — structural/
// visual decisions are pushed into code, the LLM stays responsible only for
// content.
//
// Lives here (not in layouts.js, where it originated) so both the PptxGenJS
// export path AND the browser preview (SlideRenderer.jsx) resolve style from
// the exact same data/function — the two were previously able to drift apart
// silently on desktop (pitch-deck/sales's bold/warm card chrome only ever
// showed up in the exported .pptx, never in the live in-app preview, before
// this sharing was set up).
//
// Not 6 independent flat styles — really 4 structural SHAPES (genuinely
// different chrome, need bespoke per-builder code in both renderers) plus 2
// parametric modifiers (compact/editorial: pure scale/color-uniformity
// changes layered on top of the "plain" shape's existing code, never
// combined with "bold"/"warm"/"outline" chrome). Keeping that distinction in
// the data means compact/editorial can never silently drift onto
// bold/warm/outline chrome later without it being a deliberate schema change
// here. "outline" (added for the "minimal" preset) is a card WITHOUT a fill
// or shadow — a colored border only — the most understated of the 4 shapes;
// every card-drawing builder branches on it the same three-way way it
// already branches on bold vs. warm vs. plain, never a bolted-on 4th special
// case. heroScale/heroFontDelta are deliberately separate from
// iconScale/spaceScale (used only by the card-based types) — reusing those
// for the dark hero slides would silently change already-verified
// icon_grid/icon_list/feature_split/stat_callout sizing the moment a record
// gained a dark-slide delta.
export const STYLE_BY_PRESENTATION_TYPE = {
  "pitch-deck": { shape: "bold", heroScale: 1.15, heroFontDelta: 2 },
  "sales": { shape: "warm" },
  "university": { shape: "plain" },
  "internal-report": { shape: "plain", iconScale: 0.8, spaceScale: 0.85, uniformColor: true, heroScale: 0.85, heroFontDelta: -2 },
  "conference-talk": { shape: "plain", iconScale: 1.28, spaceScale: 1.15, boldLabel: true, heroScale: 1.25, heroFontDelta: 4 },
  "minimal": { shape: "outline", heroScale: 0.92, heroFontDelta: -1 },
};
export const PLAIN_STYLE = { shape: "plain" };
export function getStyle(theme) {
  return STYLE_BY_PRESENTATION_TYPE[theme.presentationType] || PLAIN_STYLE;
}

// `customPalette` (optional) — a brand-kit-supplied {primary, secondary,
// accent} hex triplet, used in place of the named PALETTES lookup when
// present. PALETTES itself stays a fixed enum; a custom palette is a
// parallel input, never merged into it.
export function resolveTheme(paletteName, fontPairName, customPalette) {
  const hasCustomPalette = !!(customPalette && customPalette.primary && customPalette.secondary && customPalette.accent);
  const palette = hasCustomPalette ? customPalette : (PALETTES[paletteName] || PALETTES[DEFAULT_PALETTE_NAME]);
  const fonts = FONT_PAIRS[fontPairName] || FONT_PAIRS[DEFAULT_FONT_PAIR_NAME];
  return {
    paletteName: hasCustomPalette ? "Custom Brand" : (PALETTES[paletteName] ? paletteName : DEFAULT_PALETTE_NAME),
    fontPairName: FONT_PAIRS[fontPairName] ? fontPairName : DEFAULT_FONT_PAIR_NAME,
    palette,
    fonts,
  };
}
