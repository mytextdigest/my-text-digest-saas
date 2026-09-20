// src/lib/slides/layouts.js
// One builder function per outline slide "type". Each function is
// `async (pres, slideData, theme, slideIndex) => Slide` — pres.addSlide() +
// PptxGenJS calls only, no LLM/content decisions here (those live in
// outline.js). `slideIndex` is this slide's position in the deck, used to
// rotate accent colors across slides that repeat a single-icon treatment.
//
// Ported near-verbatim from electron/slides/layouts.js — `pptxgenjs` itself
// is unchanged (it's pure JS, no native binary, and was never the source of
// the `sharp` dependency problem this port needed to solve). Two changes:
//   1. Icon/gradient rasterization import from this port's sharp-free
//      icons.js/gradientRaster.js instead of calling `sharp` directly.
//   2. Freeform image elements / hero images now carry an S3 HTTPS URL as
//      `src` (this repo has no local filesystem, so no more `file://` +
//      `url.fileURLToPath`) — passed straight through as pptxgenjs's `path`,
//      which fetches `http(s)://` sources itself via Node's `https` module
//      (confirmed in pptxgenjs's own `encodeSlideMediaRels`), so no manual
//      download step is needed here.
//
// Follows the PptxGenJS pitfalls from Anthropic's pptx skill:
//  - hex colors never prefixed with "#"
//  - bullet: true, never unicode "•"
//  - breakLine: true between text runs
//  - margin: 0 on text boxes aligned with shapes
//  - a fresh shadow object per addShape call (PptxGenJS mutates them in place)
//  - opacity via the `opacity` property, never an 8-char hex color
//  - NEVER a decorative color bar / accent stripe / single-side border —
//    an explicit AI-generated-slide tell. Motifs here are icons in colored
//    circles, rounded cards, and soft off-canvas background circles instead.
//  - ROUNDED_RECTANGLE cards never have a second shape (header bar, accent
//    strip) overlaid on their corners — that combination doesn't render
//    correctly. Where a card needs a colored "header," the color/label is
//    text on a single rounded shape, never a second stacked rectangle.

import { SLIDE_W, SLIDE_H, MARGIN, TYPE_SCALE, contrastText, rotatingColor, ensureReadableOnLight, mixHex, getStyle, PLAIN_STYLE, HERO_IMAGE_PANEL_W } from "./theme.js";
import { iconToBase64Png } from "./icons.js";
import { gradientToBase64Png } from "./gradientRaster.js";

const CONTENT_X = MARGIN;
const CONTENT_W = SLIDE_W - MARGIN * 2;
const TITLE_Y = 0.5;
const TITLE_H = 0.9;
const BODY_Y = 1.6;
const BODY_H = SLIDE_H - BODY_Y - MARGIN;
const MUTED = "64748B";
const LIGHT_BG = "FAFAFA";
const CARD_BG = "FFFFFF";
const CARD_BORDER = "E5E7EB";
const CARD_RADIUS = 0.12;
// Caps how far a short bullet/two_column list gets vertically centered
// within BODY_H — true centering of a genuinely short list (a handful of
// one-line bullets) leaves a large, equal empty gap ABOVE and BELOW the
// block, which reads as an under-filled slide rather than a deliberately
// spacious one. Pinning the block closer to the top (empty space only below,
// which is where a viewer's eye expects a short slide to trail off) looks
// less sparse than floating it in the middle. Only kicks in when the true
// centering gap would exceed this — a list that already fills most of
// BODY_H still centers normally.
const MAX_BULLETS_TOP_GAP = 1.0;

function cardShadow() {
  return { type: "outer", color: "000000", blur: 6, offset: 2, angle: 135, opacity: 0.15 };
}

// "warm" style's tinted card/row fill — mixed from theme.palette.PRIMARY,
// not secondary: several of the 10 fixed palettes intentionally keep
// secondary very pale (Cherry Bold's is FCF6F5, Charcoal Minimal's is
// F2F2F2), which made this tint visually imperceptible on exactly those
// palettes. Primary is a strong, non-pale anchor color on every palette, so
// mixing from it toward white guarantees a visible tint regardless of which
// palette is active. Kept conservative (0.85 toward white) specifically
// because several builders hardcode description text to MUTED (64748B)
// regardless of background — a stronger tint risks that text going
// contrast-marginal.
function warmFillColor(theme) {
  return mixHex(theme.palette.primary, "FFFFFF", 0.85);
}

// Card shapes gate on `useCard = CARD_DRAWING_SHAPES.has(style.shape)`
// wherever this is used — kept as one shared constant so a card-drawing
// builder can't drift out of sync with cardChromeFor's own shape handling.
const CARD_DRAWING_SHAPES = new Set(["bold", "warm", "outline"]);
// PptxGenJS fill/line/shadow options for a "card" shape, shared by every
// builder that draws a per-item/per-row card (icon_grid, icon_list,
// addChecklistRows) so a new shape only has to be taught to this ONE place
// instead of three. "outline" (added for the "minimal" preset): no fill, no
// shadow, a slightly bolder border in the theme's own primary color — the
// most understated of the 3 card-drawing shapes.
function cardChromeFor(theme, style) {
  if (style.shape === "outline") {
    return { fill: { type: "none" }, line: { color: ensureReadableOnLight(theme.palette.primary), width: 1.5 } };
  }
  if (style.shape === "warm") {
    return { fill: { color: warmFillColor(theme) }, line: { color: CARD_BORDER, width: 1 }, shadow: cardShadow() };
  }
  // "bold" (the only other CARD_DRAWING_SHAPES member) shares plain's white-
  // card look here — bold's OWN distinct chrome (no card at all) already
  // lives in stat_callout's separate 3-branch treatment, not this helper.
  return { fill: { color: CARD_BG }, line: { color: CARD_BORDER, width: 1 }, shadow: cardShadow() };
}

// STYLE_BY_PRESENTATION_TYPE/PLAIN_STYLE/getStyle now live in ./theme.js
// (pure data, no PptxGenJS dependency) so SlideRenderer.jsx's live preview
// resolves style from the exact same source instead of a locally duplicated
// copy that could drift out of sync — imported at the top of this file.

// Character-width heuristic for estimating how many lines a text run will
// wrap to at a given box width/font size — used below to shrink a
// description's font size when it would otherwise overflow the fixed/
// computed box a layout gives it. Node has no text-measurement API (unlike
// SlideRenderer.jsx's browser DOM), so this uses the same average-character-
// width approximation typeface metrics tables use: ~0.5em per character for
// the proportional serif/sans fonts in FONT_PAIRS. Deliberately conservative
// (slightly overestimates average character width -> underestimates chars
// per line -> reserves MORE height than strictly needed) since overshooting
// (a little unused space) is far less bad than undershooting (clipped text).
function estimateLines(text, boxWidthIn, fontSizePt) {
  if (!text) return 0;
  const avgCharWidthIn = (fontSizePt * 0.52) / 72;
  const charsPerLine = Math.max(1, Math.floor(boxWidthIn / avgCharWidthIn));
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

// Shrinks fontSize (0.5pt steps) until estimateLines' wrapped line count fits
// the given box height, down to a floor of minFontSize — never grows the box
// itself, since callers here already have carefully tuned geometry (grid/row
// centering math) that a content-length-driven resize would fight against.
// This is a last-resort safety net for the specific case a fixed per-type
// character cap (see outline.js's MAX_ITEM_DESC_LEN_BY_TYPE) still lets
// through: a description that's short enough to pass validation but long
// enough, at that box's actual width, to wrap past what the box reserves.
function fitFontSize(text, boxWidthIn, boxHeightIn, startFontSize, minFontSize = 9) {
  const lineHOf = (fs) => (fs * 1.2) / 72;
  let fontSize = startFontSize;
  while (fontSize > minFontSize) {
    const lines = estimateLines(text, boxWidthIn, fontSize);
    if (lines * lineHOf(fontSize) <= boxHeightIn) break;
    fontSize -= 0.5;
  }
  return fontSize;
}

// slideData.backgroundColor (set via the left tools panel's Background
// tool, never by the LLM — see outline.js's validateSlide) overrides the
// template's default background — either a solid hex string or a 2-stop
// gradient descriptor { type: "gradient", angle, stops: [hexA, hexB] }.
// Text color is computed against this EFFECTIVE background, not always the
// theme default — otherwise a light custom background under a "dark" slide
// type (or vice versa) would leave template text unreadable. For a
// gradient, contrast is computed against the midpoint of its two stops
// (mixHex(..., 0.5)) — mirrors SlideRenderer.jsx's identical computation
// for the live preview.
async function addBackground(slide, theme, variant, slideData) {
  const defaultColor = variant === "dark" ? theme.palette.primary : LIGHT_BG;
  const bg = slideData?.backgroundColor;

  if (bg && typeof bg === "object" && bg.type === "gradient") {
    const data = gradientToBase64Png(bg.angle, bg.stops);
    if (data) {
      slide.background = { data };
      return contrastText(mixHex(bg.stops[0], bg.stops[1], 0.5));
    }
    // Rasterization failed — fall through to the plain default color rather
    // than leaving the slide with no background at all.
  }

  const effectiveColor = (typeof bg === "string" && bg) || defaultColor;
  slide.background = { color: effectiveColor };
  return contrastText(effectiveColor);
}

// Soft, large circles bleeding off two corners — the repeating "dark slide"
// motif (title/section/quote/closing), instead of an accent stripe. Always
// the same placement/size so it reads as one consistent motif across the
// deck, per the "commit to a motif" design rule.
// style.heroScale (default 1) resizes both circles; the top-right circle's Y
// offset is deliberately NOT a flat multiple of r1 — it's pinned so the
// circle's BOTTOM EDGE stays fixed at the plain baseline regardless of size.
// A naive proportional offset was verified (via exact geometry, not just
// eyeballing) to push the enlarged circle's bottom edge into closing's and
// quote's title text bounding boxes at heroScale=1.15/1.25 — this keeps the
// circle visibly bigger (more reach across the top edge via the unchanged
// x-offset) without ever growing downward into the title-safe zone.
// Transparency is intentionally NOT varied by style — it's the one lever
// that directly reduces circle-vs-text contrast, and size/color already
// carry the differentiation.
function addDecorativeCircles(pres, slide, theme, style = PLAIN_STYLE) {
  const heroScale = style.heroScale ?? 1;
  const R1_BOTTOM = 4.6 * 0.45;
  const r1 = 4.6 * heroScale;
  const secondaryColor = style.shape === "warm" ? mixHex(theme.palette.secondary, theme.palette.primary, 0.3) : theme.palette.secondary;
  slide.addShape(pres.shapes.OVAL, {
    x: SLIDE_W - r1 * 0.62, y: R1_BOTTOM - r1, w: r1, h: r1,
    fill: { color: secondaryColor, transparency: 72 },
    line: { type: "none" },
  });
  const r2 = 3.0 * heroScale;
  const accentColor = style.shape === "warm" ? mixHex(theme.palette.accent, theme.palette.primary, 0.3) : theme.palette.accent;
  slide.addShape(pres.shapes.OVAL, {
    x: -r2 * 0.55, y: SLIDE_H - r2 * 0.5, w: r2, h: r2,
    fill: { color: accentColor, transparency: 80 },
    line: { type: "none" },
  });
}

// slideData.layoutOverrides (set via dragging/resizing/rotating a template
// field in the live preview — see SlideRenderer.jsx's TextBox/BulletList —
// never by the LLM) overrides a field's computed default box, same
// independent-override-layer pattern as backgroundColor/elements.
// `fieldPath` must match the exact string SlideRenderer.jsx uses for the
// same field, or the two would silently drift apart. Every override field
// is independently optional — a resize-only override has no x/y, so each
// falls back to its own default rather than the whole box falling back
// together. Style fields (fontSize/color/bold/italic/align) are only
// resolved when the caller's `defaults` includes them — most `addShape`
// geometry-only callers only ever pass x/y/w/h, so those fields stay
// undefined and are simply never spread into the pptxgenjs call.
function resolveBox(slideData, fieldPath, defaults) {
  const override = slideData.layoutOverrides?.[fieldPath];
  const box = {
    x: override?.x ?? defaults.x,
    y: override?.y ?? defaults.y,
    w: override?.w ?? defaults.w,
    h: override?.h ?? defaults.h,
    rotation: override?.rotation ?? defaults.rotation ?? 0,
  };
  if (defaults.fontSize !== undefined) box.fontSize = override?.fontSize ?? defaults.fontSize;
  if (defaults.color !== undefined) box.color = override?.color ?? defaults.color;
  if (defaults.bold !== undefined) box.bold = override?.bold ?? defaults.bold;
  if (defaults.italic !== undefined) box.italic = override?.italic ?? defaults.italic;
  if (defaults.align !== undefined) box.align = override?.align ?? defaults.align;
  if (defaults.radius !== undefined) box.radius = override?.radius ?? defaults.radius;
  return box;
}

// Every non-title-type layout's own title always maps to the slide's
// top-level "title" field — same fieldPath SlideRenderer.jsx's TitleText
// uses, so a title dragged/resized/rotated in the live preview lands in the
// same spot here.
function addTitleText(slideData, slide, theme, text, { color, y = TITLE_Y, size = TYPE_SCALE.slideTitle, align = "left", w = CONTENT_W }) {
  const box = resolveBox(slideData, "title", { x: CONTENT_X, y, w, h: TITLE_H, fontSize: size, color, bold: true, italic: false, align });
  slide.addText(text, {
    x: box.x, y: box.y, w: box.w, h: box.h, rotate: box.rotation,
    fontSize: box.fontSize, fontFace: theme.fonts.header, bold: box.bold, italic: box.italic,
    color: box.color, align: box.align, valign: "top", margin: 0,
  });
}

// `fieldPath`/`slideData` resolve a drag/resize/rotate override the same way
// every template TEXT field already does — `w`/`h` are both driven by `d`
// since these circles are always aspect-locked (see SlideRenderer.jsx's
// InteractiveCircle), so the override only ever needs to carry one size
// value, reusing `w`.
async function addIconCircle(pres, slide, { iconName, x, y, d, circleColor, iconColor, slideData, fieldPath }) {
  const box = resolveBox(slideData, fieldPath, { x, y, w: d, h: d });
  slide.addShape(pres.shapes.OVAL, { x: box.x, y: box.y, w: box.w, h: box.h, rotate: box.rotation, fill: { color: circleColor }, shadow: cardShadow() });
  // The model occasionally names an icon outside our whitelist (e.g.
  // "chat-bubble" instead of "message-circle") — iconToBase64Png degrades
  // to null for that name rather than throwing, but silently skipping the
  // image leaves a bare, obviously-broken-looking circle. Fall back to a
  // safe default so every circle always shows something.
  let iconData = await iconToBase64Png(iconName || "lightbulb", iconColor, 256);
  if (!iconData) iconData = await iconToBase64Png("lightbulb", iconColor, 256);
  if (iconData) {
    const pad = box.w * 0.28;
    slide.addImage({ data: iconData, x: box.x + pad, y: box.y + pad, w: box.w - 2 * pad, h: box.h - 2 * pad, rotate: box.rotation });
  }
}

// AgendaSlide's row-number badges, TimelineSlide's step dots — same
// interactive-circle override treatment as addIconCircle, just with a
// number instead of an icon image.
function addNumberedCircle(pres, slide, { number, x, y, d, circleColor, textColor, fontFace, fontSize, slideData, fieldPath }) {
  const box = resolveBox(slideData, fieldPath, { x, y, w: d, h: d });
  slide.addShape(pres.shapes.OVAL, { x: box.x, y: box.y, w: box.w, h: box.h, rotate: box.rotation, fill: { color: circleColor }, shadow: cardShadow() });
  slide.addText(String(number), {
    x: box.x, y: box.y, w: box.w, h: box.h, rotate: box.rotation, margin: 0,
    fontSize, bold: true, fontFace, color: textColor, align: "center", valign: "middle",
  });
}

// Each bullet gets its own text box (fieldPath `${basePath}[i]`) instead of
// multiple runs sharing one box — mirrors SlideRenderer.jsx's BulletList
// exactly, so a bullet dragged in the live preview exports to the same
// position. The cursor steps down by THIS bullet's own estimateLines()-based
// line count (no floor) — a genuinely long bullet that wraps to 3+ lines
// pushes every later bullet down, while a short one-line bullet steps by
// exactly one line. The box's OWN height is floored at 2 lines (a separate,
// purely cosmetic pad — text boxes don't clip by height in
// PptxGenJS/PowerPoint, so this never crops anything) — mistakenly using
// that same 2-line floor for the cursor step too would inflate the gap
// after every short bullet and, once summed by bulletBlockHeight below,
// push whole short bullet lists down via the centering math (visible as the
// block floating with a large empty gap above it).
function addBulletList(slide, slideData, bullets, { x, y, w, color, fontFace, fontSize, basePath = "bullets" }) {
  const lineH = (fontSize * 1.2) / 72;
  const gapH = 10 / 72;
  let cursorY = y;
  bullets.forEach((b, i) => {
    const lines = estimateLines(b, w, fontSize);
    const boxH = Math.max(2, lines) * lineH;
    const box = resolveBox(slideData, `${basePath}[${i}]`, { x, y: cursorY, w, h: boxH, fontSize, color, bold: false, italic: false, align: "left" });
    slide.addText(b, {
      x: box.x, y: box.y, w: box.w, h: box.h, rotate: box.rotation,
      fontSize: box.fontSize, fontFace, color: box.color, bold: box.bold, italic: box.italic, bullet: true, align: box.align, valign: "top", margin: 0,
    });
    cursorY += lines * lineH + gapH;
  });
}

// Estimates a bullet list's natural rendered height — sum of each bullet's
// own estimateLines()-based height (no floor, matching addBulletList's
// cursor-step math exactly, NOT its separate box-height floor) plus gaps —
// so callers can center a short list within a taller available area instead
// of pinning it to the top and leaving empty space below, same "uneven gaps"
// fix already applied to icon_grid's cell height and timeline's block
// height. Takes the actual bullet text + box width (not just a count) so the
// estimate reflects real wrapping, not an assumed single line.
function bulletBlockHeight(bullets, fontSize, boxWidthIn) {
  const lineH = (fontSize * 1.2) / 72;
  const gapH = 10 / 72;
  return (
    bullets.reduce((sum, b) => sum + estimateLines(b, boxWidthIn, fontSize) * lineH, 0) +
    Math.max(0, bullets.length - 1) * gapH
  );
}

// Checklist-style item rows: small check-icon + bold label + muted
// description, stacked vertically. Always rendered on a light background in
// this codebase (the feature_split panel is a separate shape), so the
// description is always MUTED rather than parameterized.
//
// "style" defaults to plain (today's behavior: rows packed with ZERO
// inter-row gap, `rowY += rowH` exactly). bold/warm/outline reserve a real
// gap before drawing a per-row card — without it, adjacent cards' borders
// would visually merge and their shadows would overlap into the next row.
async function addChecklistRows(pres, slide, { items, x, y, w, h, theme, textColor, checkColor, style = PLAIN_STYLE, slideData, basePath = "items" }) {
  const useCard = CARD_DRAWING_SHAPES.has(style.shape);
  const spaceScale = style.spaceScale ?? 1;
  const iconScale = style.iconScale ?? 1;
  const gap = useCard ? 0.12 * spaceScale : 0;
  const rowH = Math.min(1.15 * spaceScale, (h - gap * (items.length - 1)) / items.length);
  const iconD = 0.3 * iconScale;
  const pad = useCard ? 0.12 : 0;
  let rowY = y + Math.max(0, (h - (rowH * items.length + gap * (items.length - 1))) / 2);
  const checkData = await iconToBase64Png("check", checkColor, 128);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (useCard) {
      const chrome = cardChromeFor(theme, style);
      const cardBox = resolveBox(slideData, `${basePath}[${i}].card`, { x, y: rowY, w, h: rowH, radius: CARD_RADIUS });
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: cardBox.x, y: cardBox.y, w: cardBox.w, h: cardBox.h, rotate: cardBox.rotation,
        fill: chrome.fill, line: chrome.line, shadow: chrome.shadow, rectRadius: cardBox.radius,
      });
    }
    const innerX = x + pad;
    const innerY = rowY + pad;
    const innerW = w - 2 * pad;
    if (checkData) {
      slide.addImage({ data: checkData, x: innerX, y: innerY + 0.05, w: iconD, h: iconD });
    }
    const labelBox = resolveBox(slideData, `${basePath}[${i}].label`, { x: innerX + iconD + 0.25, y: innerY, w: innerW - iconD - 0.25, h: 0.35, fontSize: TYPE_SCALE.body + (style.boldLabel ? 2 : 0), color: textColor, bold: true, italic: false, align: "left" });
    slide.addText(item.label, {
      x: labelBox.x, y: labelBox.y, w: labelBox.w, h: labelBox.h, rotate: labelBox.rotation,
      fontSize: labelBox.fontSize, bold: labelBox.bold, italic: labelBox.italic, fontFace: theme.fonts.body, color: labelBox.color,
      align: labelBox.align, valign: "top", margin: 0,
    });
    if (item.description) {
      const descW = innerW - iconD - 0.25;
      const descH = Math.max(0, rowH - 2 * pad - 0.4);
      const descFontSize = fitFontSize(item.description, descW, descH, TYPE_SCALE.caption + 1, 9);
      const descBox = resolveBox(slideData, `${basePath}[${i}].description`, { x: innerX + iconD + 0.25, y: innerY + 0.35, w: descW, h: descH, fontSize: descFontSize, color: MUTED, bold: false, italic: false, align: "left" });
      slide.addText(item.description, {
        x: descBox.x, y: descBox.y, w: descBox.w, h: descBox.h, rotate: descBox.rotation,
        fontSize: descBox.fontSize, fontFace: theme.fonts.body, color: descBox.color, bold: descBox.bold, italic: descBox.italic,
        align: descBox.align, valign: "top", margin: 0,
      });
    }
    rowY += rowH + gap;
  }
}

// Freeform (Canva-style) editor overlay elements — draw AFTER the template
// so they always win visually. `slideData.elements` is only ever written by
// the layout-patch API route, never by the LLM (see outline.js's
// validateSlide). The background override (`slideData.backgroundColor`) is
// applied earlier, inside addBackground() above — before any template text
// color is computed from it — not here.
function applyFreeformElements(pres, slide, slideData) {
  const elements = Array.isArray(slideData.elements) ? slideData.elements : [];
  for (const el of elements) {
    const opts = { x: el.x, y: el.y, w: el.w, h: el.h, rotate: el.rotation || 0 };
    if (el.kind === "text") {
      slide.addText(el.text || "", {
        ...opts,
        fontSize: el.fontSize, fontFace: el.fontFamily, color: el.color,
        bold: !!el.bold, italic: !!el.italic, align: el.align || "left",
        valign: "top", margin: 0,
      });
    } else if (el.kind === "rect" || el.kind === "ellipse") {
      // `opacity` fades the whole shape in the live preview (fill AND
      // border together, via CSS `opacity` on the element) — apply the same
      // transparency to both fill and line here too, not just fill,
      // otherwise an exported semi-transparent shape's border would render
      // fully opaque while its fill correctly fades. `?? 1` (not `|| 1`) so
      // an explicit strokeWidth of 0 isn't silently bumped up to the
      // default.
      const transparency = Math.round((1 - (el.opacity ?? 1)) * 100);
      slide.addShape(el.kind === "ellipse" ? pres.shapes.OVAL : pres.shapes.RECTANGLE, {
        ...opts,
        fill: el.fill ? { color: el.fill, transparency } : { type: "none" },
        line: el.stroke ? { color: el.stroke, width: el.strokeWidth ?? 1, transparency } : { type: "none" },
      });
    } else if (el.kind === "line") {
      // The live preview renders a "line" element as a horizontal border
      // pinned to the top of its box, ignoring `h` entirely (dragging a
      // resize handle to change a line's height has no visual effect there)
      // — force h: 0 here too, otherwise a line whose height drifted away
      // from 0 via a resize gesture would export as a DIAGONAL line instead
      // of matching the still-horizontal live preview.
      slide.addShape(pres.shapes.LINE, {
        x: el.x, y: el.y, w: el.w, h: 0, rotate: el.rotation || 0,
        line: { color: el.stroke || "1A1A1A", width: el.strokeWidth ?? 2 },
      });
    } else if (el.kind === "image") {
      // el.src is an S3 HTTPS URL (see elements.js's validateElement) —
      // passed straight through as `path`; pptxgenjs fetches http(s) sources
      // itself in its Node build. `sizing: cover` matches the live preview's
      // `objectFit: cover` (SlideRenderer.jsx) so a non-original aspect
      // ratio box still fully fills its frame instead of letterboxing.
      const transparency = Math.round((1 - (el.opacity ?? 1)) * 100);
      slide.addImage({ ...opts, path: el.src, transparency, sizing: { type: "cover", w: el.w, h: el.h } });
    }
  }
}

// Every builder funnels through here at the end.
function finish(pres, slide, slideData) {
  applyFreeformElements(pres, slide, slideData);
  if (slideData.speakerNotes) slide.addNotes(slideData.speakerNotes);
  return slide;
}

// `slideData.heroImage` — an AI-generated accent image for title/
// section_header/closing/quote slides. Deliberately a DEDICATED field, not
// a freeform `elements[]` entry like user-placed images: freeform elements
// always draw last (see applyFreeformElements/finish above), which is
// correct for a user's own manual overlay but wrong here — a hero image
// needs to draw BEFORE the slide's title/subtitle text, and that text's box
// needs to be narrowed by HERO_IMAGE_PANEL_W so it never wraps underneath
// the image. Confirmed happening in practice with the elements[] approach:
// long-enough title/subtitle text wrapped into the image's own column and
// was visually covered by it. Returns whether an image was actually drawn,
// so the caller knows whether to narrow its own text boxes.
function drawHeroImage(slide, slideData) {
  const heroImage = slideData.heroImage;
  if (!heroImage || typeof heroImage.src !== "string") return false;
  // Position/size/rotation is overridable via layoutOverrides["heroImage"]
  // — same resolveBox mechanism every other template field uses, so a
  // drag/resize/rotate in the live preview round-trips into the export.
  const box = resolveBox(slideData, "heroImage", { x: SLIDE_W - HERO_IMAGE_PANEL_W, y: 0, w: HERO_IMAGE_PANEL_W, h: SLIDE_H });
  slide.addImage({ path: heroImage.src, x: box.x, y: box.y, w: box.w, h: box.h, rotate: box.rotation, sizing: { type: "cover", w: box.w, h: box.h } });
  return true;
}

// A small accent bar above a hero slide's title, on title/closing only for
// now. Deliberately reuses getStyle()'s existing heroFontDelta signal
// (already the "how energetic is this presentationType" marker — positive
// for pitch-deck/conference-talk, negative for internal-report/minimal,
// absent for the rest) rather than introducing a second, parallel per-type
// config map for one boolean. Non-interactive decorative chrome (like
// addDecorativeCircles) — not resolveBox'd, since it's derived from
// presentationType, not user content.
function addHeroKicker(pres, slide, theme, style, titleBox) {
  if (!((style.heroFontDelta ?? 0) > 0)) return;
  slide.addShape(pres.shapes.RECTANGLE, {
    x: titleBox.x, y: titleBox.y - 0.3, w: 0.55, h: 0.08,
    fill: { color: theme.palette.accent }, line: { type: "none" },
  });
}

async function buildTitleSlide(pres, slideData, theme) {
  const slide = pres.addSlide();
  const style = getStyle(theme);
  const color = await addBackground(slide, theme, "dark", slideData);
  addDecorativeCircles(pres, slide, theme, style);
  const hasHeroImage = drawHeroImage(slide, slideData);
  const textW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  const titleBox = resolveBox(slideData, "title", { x: CONTENT_X, y: 2.7, w: textW, h: 1.6, fontSize: TYPE_SCALE.title + (style.heroFontDelta ?? 0), color, bold: true, italic: false, align: "left" });
  addHeroKicker(pres, slide, theme, style, titleBox);
  slide.addText(slideData.title, {
    x: titleBox.x, y: titleBox.y, w: titleBox.w, h: titleBox.h, rotate: titleBox.rotation,
    fontSize: titleBox.fontSize, fontFace: theme.fonts.header, bold: titleBox.bold, italic: titleBox.italic,
    color: titleBox.color, align: titleBox.align, valign: "middle", margin: 0,
  });
  if (slideData.subtitle) {
    const subtitleBox = resolveBox(slideData, "subtitle", { x: CONTENT_X, y: 4.3, w: textW, h: 0.7, fontSize: TYPE_SCALE.body + 4, color, bold: false, italic: true, align: "left" });
    slide.addText(slideData.subtitle, {
      x: subtitleBox.x, y: subtitleBox.y, w: subtitleBox.w, h: subtitleBox.h, rotate: subtitleBox.rotation,
      fontSize: subtitleBox.fontSize, fontFace: theme.fonts.body, italic: subtitleBox.italic, bold: subtitleBox.bold,
      color: subtitleBox.color, align: subtitleBox.align, valign: "top", margin: 0,
    });
  }
  return finish(pres, slide, slideData);
}

async function buildSectionHeaderSlide(pres, slideData, theme) {
  const slide = pres.addSlide();
  const style = getStyle(theme);
  const color = await addBackground(slide, theme, "dark", slideData);
  addDecorativeCircles(pres, slide, theme, style);
  const hasHeroImage = drawHeroImage(slide, slideData);
  const textW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  const titleBox = resolveBox(slideData, "title", { x: CONTENT_X, y: 2.7, w: textW, h: 1.3, fontSize: TYPE_SCALE.sectionTitle + (style.heroFontDelta ?? 0), color, bold: true, italic: false, align: "left" });
  slide.addText(slideData.title, {
    x: titleBox.x, y: titleBox.y, w: titleBox.w, h: titleBox.h, rotate: titleBox.rotation,
    fontSize: titleBox.fontSize, fontFace: theme.fonts.header, bold: titleBox.bold, italic: titleBox.italic,
    color: titleBox.color, align: titleBox.align, valign: "middle", margin: 0,
  });
  const subtitleBox = resolveBox(slideData, "subtitle", { x: CONTENT_X, y: 4.0, w: hasHeroImage ? textW : CONTENT_W - 2, h: 0.9, fontSize: TYPE_SCALE.body + 3, color, bold: false, italic: false, align: "left" });
  slide.addText(slideData.subtitle, {
    x: subtitleBox.x, y: subtitleBox.y, w: subtitleBox.w, h: subtitleBox.h, rotate: subtitleBox.rotation,
    fontSize: subtitleBox.fontSize, fontFace: theme.fonts.body, bold: subtitleBox.bold, italic: subtitleBox.italic,
    color: subtitleBox.color, align: subtitleBox.align, valign: "top", margin: 0,
  });
  return finish(pres, slide, slideData);
}

async function buildClosingSlide(pres, slideData, theme) {
  const slide = pres.addSlide();
  const style = getStyle(theme);
  const color = await addBackground(slide, theme, "dark", slideData);
  addDecorativeCircles(pres, slide, theme, style);
  const hasHeroImage = drawHeroImage(slide, slideData);
  const textW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  const titleBox = resolveBox(slideData, "title", { x: CONTENT_X, y: 2.1, w: textW, h: 1.1, fontSize: TYPE_SCALE.sectionTitle + (style.heroFontDelta ?? 0), color, bold: true, italic: false, align: "left" });
  addHeroKicker(pres, slide, theme, style, titleBox);
  slide.addText(slideData.title, {
    x: titleBox.x, y: titleBox.y, w: titleBox.w, h: titleBox.h, rotate: titleBox.rotation,
    fontSize: titleBox.fontSize, fontFace: theme.fonts.header, bold: titleBox.bold, italic: titleBox.italic,
    color: titleBox.color, align: titleBox.align, valign: "middle", margin: 0,
  });
  if (slideData.subtitle) {
    const subtitleBox = resolveBox(slideData, "subtitle", { x: CONTENT_X, y: 3.2, w: hasHeroImage ? textW : CONTENT_W - 2, h: 1.0, fontSize: TYPE_SCALE.body + 3, color, bold: false, italic: false, align: "left" });
    slide.addText(slideData.subtitle, {
      x: subtitleBox.x, y: subtitleBox.y, w: subtitleBox.w, h: subtitleBox.h, rotate: subtitleBox.rotation,
      fontSize: subtitleBox.fontSize, fontFace: theme.fonts.body, bold: subtitleBox.bold, italic: subtitleBox.italic,
      color: subtitleBox.color, align: subtitleBox.align, valign: "top", margin: 0,
    });
  }
  if (slideData.bullets && slideData.bullets.length) {
    slide.addText(slideData.bullets.join("   |   "), {
      x: CONTENT_X, y: SLIDE_H - MARGIN - 0.5, w: textW, h: 0.4,
      fontSize: TYPE_SCALE.caption + 1, fontFace: theme.fonts.body, color,
      align: "left", valign: "top", margin: 0,
    });
  }
  return finish(pres, slide, slideData);
}

async function buildAgendaSlide(pres, slideData, theme) {
  const slide = pres.addSlide();
  const color = await addBackground(slide, theme, "light", slideData);
  const hasHeroImage = drawHeroImage(slide, slideData);
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  addTitleText(slideData, slide, theme, slideData.title, { color, w: contentW });

  const items = slideData.bullets;
  const rowH = Math.min(0.9, BODY_H / items.length);
  const gap = 0.15;
  let y = BODY_Y;
  const d = rowH - gap;
  items.forEach((item, i) => {
    const circleColor = rotatingColor(theme, i);
    addNumberedCircle(pres, slide, {
      number: i + 1, x: CONTENT_X, y, d,
      circleColor, textColor: contrastText(circleColor),
      fontFace: theme.fonts.body, fontSize: TYPE_SCALE.body + 2,
      slideData, fieldPath: `bullets[${i}].badge`,
    });
    const itemBox = resolveBox(slideData, `bullets[${i}]`, { x: CONTENT_X + d + 0.3, y, w: contentW - d - 0.3, h: d, fontSize: TYPE_SCALE.body + 2, color, bold: false, italic: false, align: "left" });
    slide.addText(item, {
      x: itemBox.x, y: itemBox.y, w: itemBox.w, h: itemBox.h, rotate: itemBox.rotation,
      fontSize: itemBox.fontSize, fontFace: theme.fonts.body, bold: itemBox.bold, italic: itemBox.italic,
      color: itemBox.color, align: itemBox.align, valign: "middle", margin: 0,
    });
    y += rowH;
  });
  return finish(pres, slide, slideData);
}

async function buildBulletsSlide(pres, slideData, theme, slideIndex) {
  const slide = pres.addSlide();
  const color = await addBackground(slide, theme, "light", slideData);
  // The icon circle below already floats in the CONTENT_X+7.6+0.6..+2.8
  // zone, which overlaps HERO_IMAGE_PANEL_W's x-range almost exactly — when
  // an image is present it takes over that same "visual accent" role
  // instead of narrowing already-fixed-width bullet text.
  const hasHeroImage = drawHeroImage(slide, slideData);
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  addTitleText(slideData, slide, theme, slideData.title, { color, w: contentW });

  const bulletsW = 7.6;
  const bulletFontSize = TYPE_SCALE.body + 1;
  const bulletsH = Math.min(BODY_H, bulletBlockHeight(slideData.bullets, bulletFontSize, bulletsW));
  const bulletsY = BODY_Y + Math.min(MAX_BULLETS_TOP_GAP, Math.max(0, (BODY_H - bulletsH) / 2));
  addBulletList(slide, slideData, slideData.bullets, { x: CONTENT_X, y: bulletsY, w: bulletsW, color, fontFace: theme.fonts.body, fontSize: bulletFontSize });

  if (!hasHeroImage) {
    // Centered on the bullets' own (now possibly shorter) block, not the
    // full BODY_H, so the icon stays visually paired with the text instead
    // of floating below it when there are only a few short bullets.
    const d = 2.8;
    const circleColor = rotatingColor(theme, slideIndex);
    await addIconCircle(pres, slide, {
      iconName: slideData.icon || "lightbulb",
      x: CONTENT_X + bulletsW + 0.6, y: bulletsY + (bulletsH - d) / 2, d,
      circleColor, iconColor: contrastText(circleColor), slideData, fieldPath: "icon",
    });
  }
  return finish(pres, slide, slideData);
}

async function buildTwoColumnSlide(pres, slideData, theme, slideIndex) {
  const slide = pres.addSlide();
  const color = await addBackground(slide, theme, "light", slideData);
  // The colored card+icon below (cardX..cardX+cardW) sits almost exactly in
  // HERO_IMAGE_PANEL_W's x-range — when an image is present it replaces
  // that card as the right column's visual accent, same reasoning as
  // buildBulletsSlide.
  const hasHeroImage = drawHeroImage(slide, slideData);
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  addTitleText(slideData, slide, theme, slideData.title, { color, w: contentW });

  const leftW = 6.8;
  const bulletFontSize = TYPE_SCALE.body + 1;
  const bulletsH = Math.min(BODY_H, bulletBlockHeight(slideData.bullets, bulletFontSize, leftW));
  const bulletsY = BODY_Y + Math.min(MAX_BULLETS_TOP_GAP, Math.max(0, (BODY_H - bulletsH) / 2));
  addBulletList(slide, slideData, slideData.bullets, { x: CONTENT_X, y: bulletsY, w: leftW, color, fontFace: theme.fonts.body, fontSize: bulletFontSize });

  if (!hasHeroImage) {
    const cardX = CONTENT_X + leftW + 0.5;
    const cardW = CONTENT_W - leftW - 0.5;
    const cardColor = rotatingColor(theme, slideIndex);
    const cardBox = resolveBox(slideData, "card", { x: cardX, y: BODY_Y, w: cardW, h: BODY_H, radius: CARD_RADIUS });
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: cardBox.x, y: cardBox.y, w: cardBox.w, h: cardBox.h, rotate: cardBox.rotation,
      fill: { color: cardColor }, shadow: cardShadow(), rectRadius: cardBox.radius,
    });
    const d = 2.2;
    const circleColor = rotatingColor(theme, slideIndex + 1);
    await addIconCircle(pres, slide, {
      iconName: slideData.icon || "lightbulb",
      x: cardX + (cardW - d) / 2, y: BODY_Y + (BODY_H - d) / 2 - 0.2, d,
      circleColor, iconColor: contrastText(circleColor), slideData, fieldPath: "icon",
    });
  }
  return finish(pres, slide, slideData);
}

async function buildIconGridSlide(pres, slideData, theme) {
  const slide = pres.addSlide();
  const color = await addBackground(slide, theme, "light", slideData);
  const hasHeroImage = drawHeroImage(slide, slideData);
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  addTitleText(slideData, slide, theme, slideData.title, { color, w: contentW });

  const items = slideData.items;
  const style = getStyle(theme);
  const useCard = CARD_DRAWING_SHAPES.has(style.shape);
  const spaceScale = style.spaceScale ?? 1;

  const cols = items.length <= 3 ? items.length : 3;
  const rows = Math.ceil(items.length / cols);
  const gap = 0.35 * spaceScale;
  const cellW = (contentW - gap * (cols - 1)) / cols;
  // Cap cell height and center the grid block within BODY_H — filling the
  // full body height to a single row (e.g. 3 items) left a huge empty gap
  // below the content, which is exactly the "uneven gaps" anti-pattern.
  const maxCellH = 2.6 * spaceScale;
  const cellH = Math.min(maxCellH, (BODY_H - gap * (rows - 1)) / rows);
  const gridH = rows * cellH + gap * (rows - 1);
  const gridY = BODY_Y + Math.max(0, (BODY_H - gridH) / 2);

  // "bold"/"warm"/"outline": each item gets its own card, reusing this
  // file's own CARD_BG/CARD_BORDER/CARD_RADIUS/cardShadow() vocabulary (the
  // same one stat_callout's card look already uses) instead of inventing new
  // chrome — cardChromeFor() swaps the fill/border per shape. Padding stays
  // small (0.15in, not a generous 0.3in) because the grid math above is
  // already tuned tight at 6 items — insetting content further shrinks the
  // exact width the original labelH/gap values were sized against, so
  // d/labelGap/labelH are independently tuned smaller for this path only.
  // The plain path (no card) is untouched byte-for-byte from before this
  // change when style.iconScale/spaceScale are both 1 (pad=0 collapses
  // every inner* value back to the original cell-relative ones).
  const pad = useCard ? 0.15 : 0;
  const d = (useCard ? 0.6 : 0.75) * (style.iconScale ?? 1);
  const labelGap = useCard ? 0.1 : 0.15;
  const labelH = (useCard ? 0.55 : 0.62) * (style.iconScale ?? 1);
  const labelFontSize = TYPE_SCALE.body + 1 + (style.boldLabel ? 2 : 0);

  for (let i = 0; i < items.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = CONTENT_X + col * (cellW + gap);
    const cellY = gridY + row * (cellH + gap);
    const circleColor = style.uniformColor ? ensureReadableOnLight(theme.palette.primary) : rotatingColor(theme, i);

    if (useCard) {
      const chrome = cardChromeFor(theme, style);
      const cardBox = resolveBox(slideData, `items[${i}].card`, { x: cellX, y: cellY, w: cellW, h: cellH, radius: CARD_RADIUS });
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: cardBox.x, y: cardBox.y, w: cardBox.w, h: cardBox.h, rotate: cardBox.rotation,
        fill: chrome.fill, line: chrome.line, shadow: chrome.shadow, rectRadius: cardBox.radius,
      });
    }

    const innerX = cellX + pad;
    const innerY = cellY + pad;
    const innerW = cellW - 2 * pad;
    const innerBottom = cellY + cellH - pad;

    await addIconCircle(pres, slide, {
      iconName: items[i].icon, x: innerX, y: innerY, d,
      circleColor, iconColor: contrastText(circleColor), slideData, fieldPath: `items[${i}].icon`,
    });
    // Reserve room for a 2-line label (long labels wrap at this column
    // width) — a fixed single-line box here let a wrapped second line
    // collide with the description text starting right below it.
    const labelBox = resolveBox(slideData, `items[${i}].label`, { x: innerX, y: innerY + d + labelGap, w: innerW, h: labelH, fontSize: labelFontSize, color, bold: true, italic: false, align: "left" });
    slide.addText(items[i].label, {
      x: labelBox.x, y: labelBox.y, w: labelBox.w, h: labelBox.h, rotate: labelBox.rotation,
      fontSize: labelBox.fontSize, bold: labelBox.bold, italic: labelBox.italic, fontFace: theme.fonts.body, color: labelBox.color,
      align: labelBox.align, valign: "top", margin: 0,
    });
    if (items[i].description) {
      const descY = innerY + d + labelGap + labelH;
      const descH = Math.max(0, innerBottom - descY);
      // icon_grid's cells are the narrowest box any description renders in
      // (as little as ~3.5in at 3 columns) — shrink the font if the fixed
      // per-item description height above can't fit it at the default size,
      // rather than letting PptxGenJS silently clip it.
      const descFontSize = fitFontSize(items[i].description, innerW, descH, TYPE_SCALE.caption + 1, 8);
      const descBox = resolveBox(slideData, `items[${i}].description`, { x: innerX, y: descY, w: innerW, h: descH, fontSize: descFontSize, color: MUTED, bold: false, italic: false, align: "left" });
      slide.addText(items[i].description, {
        x: descBox.x, y: descBox.y, w: descBox.w, h: descBox.h, rotate: descBox.rotation,
        fontSize: descBox.fontSize, fontFace: theme.fonts.body, color: descBox.color, bold: descBox.bold, italic: descBox.italic,
        align: descBox.align, valign: "top", margin: 0,
      });
    }
  }
  return finish(pres, slide, slideData);
}

// Single-column variant of icon_grid — one icon-in-circle row per item, for
// items that need a longer 1-2 sentence description rather than a short
// caption. A very common professional-deck pattern that a multi-column grid
// can't accommodate gracefully.
async function buildIconListSlide(pres, slideData, theme) {
  const slide = pres.addSlide();
  const color = await addBackground(slide, theme, "light", slideData);
  const hasHeroImage = drawHeroImage(slide, slideData);
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  addTitleText(slideData, slide, theme, slideData.title, { color, w: contentW });

  const items = slideData.items;
  const style = getStyle(theme);
  const useCard = CARD_DRAWING_SHAPES.has(style.shape);
  const spaceScale = style.spaceScale ?? 1;
  const iconScale = style.iconScale ?? 1;

  // Reserve a real inter-row gap only when a card gets drawn per row — the
  // plain path below keeps the original zero-gap packing (`y += rowH`
  // exactly) so it stays byte-identical to before this change. Without a
  // gap, per-row cards would visually merge at the borders and their
  // shadows would overlap into the next row, worst at the 5-item ceiling.
  const gap = useCard ? 0.15 * spaceScale : 0;
  const rowH = Math.min(1.35 * spaceScale, (BODY_H - gap * (items.length - 1)) / items.length);
  const d = 0.55 * iconScale;
  const pad = useCard ? 0.15 : 0;
  let y = BODY_Y + Math.max(0, (BODY_H - (rowH * items.length + gap * (items.length - 1))) / 2);

  for (let i = 0; i < items.length; i++) {
    if (useCard) {
      const chrome = cardChromeFor(theme, style);
      const cardBox = resolveBox(slideData, `items[${i}].card`, { x: CONTENT_X, y, w: contentW, h: rowH, radius: CARD_RADIUS });
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: cardBox.x, y: cardBox.y, w: cardBox.w, h: cardBox.h, rotate: cardBox.rotation,
        fill: chrome.fill, line: chrome.line, shadow: chrome.shadow, rectRadius: cardBox.radius,
      });
    }
    const innerX = CONTENT_X + pad;
    const innerY = y + pad;
    const innerW = contentW - 2 * pad;
    const innerH = rowH - 2 * pad;
    const circleColor = style.uniformColor ? ensureReadableOnLight(theme.palette.primary) : rotatingColor(theme, i);
    await addIconCircle(pres, slide, {
      iconName: items[i].icon, x: innerX, y: innerY + (innerH - d) / 2 - (useCard ? 0 : 0.15), d,
      circleColor, iconColor: contrastText(circleColor), slideData, fieldPath: `items[${i}].icon`,
    });
    const labelBox = resolveBox(slideData, `items[${i}].label`, { x: innerX + d + 0.35, y: innerY, w: innerW - d - 0.35, h: 0.4, fontSize: TYPE_SCALE.body + 2 + (style.boldLabel ? 2 : 0), color, bold: true, italic: false, align: "left" });
    slide.addText(items[i].label, {
      x: labelBox.x, y: labelBox.y, w: labelBox.w, h: labelBox.h, rotate: labelBox.rotation,
      fontSize: labelBox.fontSize, bold: labelBox.bold, italic: labelBox.italic, fontFace: theme.fonts.body, color: labelBox.color,
      align: labelBox.align, valign: "top", margin: 0,
    });
    if (items[i].description) {
      const descW = innerW - d - 0.35;
      const descH = Math.max(0, innerH - 0.45);
      const descFontSize = fitFontSize(items[i].description, descW, descH, TYPE_SCALE.body - 1, 9);
      const descBox = resolveBox(slideData, `items[${i}].description`, { x: innerX + d + 0.35, y: innerY + 0.4, w: descW, h: descH, fontSize: descFontSize, color: MUTED, bold: false, italic: false, align: "left" });
      slide.addText(items[i].description, {
        x: descBox.x, y: descBox.y, w: descBox.w, h: descBox.h, rotate: descBox.rotation,
        fontSize: descBox.fontSize, fontFace: theme.fonts.body, color: descBox.color, bold: descBox.bold, italic: descBox.italic,
        align: descBox.align, valign: "top", margin: 0,
      });
    }
    y += rowH + gap;
  }
  return finish(pres, slide, slideData);
}

// Asymmetric slide: one highlighted feature panel (colored rounded card,
// icon + caption) next to a checklist of supporting points. For a single
// concept that deserves emphasis plus detail — the flat icon_grid/bullets
// layouts can't give one idea this much visual weight.
async function buildFeatureSplitSlide(pres, slideData, theme, slideIndex) {
  const slide = pres.addSlide();
  const color = await addBackground(slide, theme, "light", slideData);
  const hasHeroImage = drawHeroImage(slide, slideData);
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  addTitleText(slideData, slide, theme, slideData.title, { color, w: contentW });

  const style = getStyle(theme);
  const panelW = 3.9;
  const panelColor = rotatingColor(theme, slideIndex);
  const panelTextColor = contrastText(panelColor);
  const panelBox = resolveBox(slideData, "panel", { x: CONTENT_X, y: BODY_Y, w: panelW, h: BODY_H, radius: CARD_RADIUS });
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: panelBox.x, y: panelBox.y, w: panelBox.w, h: panelBox.h, rotate: panelBox.rotation,
    fill: { color: panelColor }, shadow: cardShadow(), rectRadius: panelBox.radius,
  });

  const d = 1.5 * (style.iconScale ?? 1);
  const circleColor = rotatingColor(theme, slideIndex + 1);
  await addIconCircle(pres, slide, {
    iconName: slideData.icon || "shield",
    x: CONTENT_X + (panelW - d) / 2, y: BODY_Y + 0.6, d,
    circleColor, iconColor: contrastText(circleColor), slideData, fieldPath: "icon",
  });
  const panelLabelBox = resolveBox(slideData, "panelLabel", { x: CONTENT_X + 0.3, y: BODY_Y + 0.6 + d + 0.3, w: panelW - 0.6, h: 1.3, fontSize: TYPE_SCALE.body + 4 + (style.boldLabel ? 2 : 0), color: panelTextColor, bold: true, italic: false, align: "center" });
  slide.addText(slideData.panelLabel, {
    x: panelLabelBox.x, y: panelLabelBox.y, w: panelLabelBox.w, h: panelLabelBox.h, rotate: panelLabelBox.rotation,
    fontSize: panelLabelBox.fontSize, bold: panelLabelBox.bold, italic: panelLabelBox.italic, fontFace: theme.fonts.header, color: panelLabelBox.color,
    align: panelLabelBox.align, valign: "top", margin: 0,
  });

  const listX = CONTENT_X + panelW + 0.6;
  const listW = contentW - panelW - 0.6;
  await addChecklistRows(pres, slide, {
    items: slideData.items, x: listX, y: BODY_Y, w: listW, h: BODY_H,
    theme, textColor: color, checkColor: ensureReadableOnLight(theme.palette.primary), style, slideData,
  });
  return finish(pres, slide, slideData);
}

async function buildStatCalloutSlide(pres, slideData, theme) {
  const slide = pres.addSlide();
  const color = await addBackground(slide, theme, "light", slideData);
  const hasHeroImage = drawHeroImage(slide, slideData);
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  addTitleText(slideData, slide, theme, slideData.title, { color, w: contentW });

  // The context sentence is what stops this slide from being just bare
  // numbers — it sits between the title and the stat cards, so the cards
  // get correspondingly less of BODY_H than other slide types.
  const contextH = 0.6;
  const contextBox = resolveBox(slideData, "context", { x: CONTENT_X, y: TITLE_Y + TITLE_H, w: contentW, h: contextH, fontSize: TYPE_SCALE.body + 1, color: MUTED, bold: false, italic: false, align: "left" });
  slide.addText(slideData.context, {
    x: contextBox.x, y: contextBox.y, w: contextBox.w, h: contextBox.h, rotate: contextBox.rotation,
    fontSize: contextBox.fontSize, fontFace: theme.fonts.body, color: contextBox.color, bold: contextBox.bold, italic: contextBox.italic,
    align: contextBox.align, valign: "top", margin: 0,
  });

  const statsY = TITLE_Y + TITLE_H + contextH + 0.15;
  const statsH = SLIDE_H - MARGIN - statsY;

  // iconScale/spaceScale only ever come from internal-report/conference-talk
  // (the two "plain"-shaped records with modifiers) — they default to 1 for
  // every other style, so multiplying by them unconditionally below can
  // never affect "bold"/"warm", which never carry those fields.
  const style = getStyle(theme);
  const scale = style.iconScale ?? 1;
  const spaceScale = style.spaceScale ?? 1;
  const numberColorFor = (i) => (style.uniformColor ? ensureReadableOnLight(theme.palette.primary) : rotatingColor(theme, i));
  const numberFontSize = TYPE_SCALE.statNumber * scale;

  const stats = slideData.stats;
  const gap = 0.4 * spaceScale;
  const cardW = (contentW - gap * (stats.length - 1)) / stats.length;
  const cardH = Math.min(3.2, statsH);
  const y = statsY + Math.max(0, (statsH - cardH) / 2);

  if (style.shape === "bold") {
    // No card shapes — each number sits directly on the page background for
    // a more "dashboard headline" look, with a short divider separating
    // number from label. The divider is capped to a small fixed width
    // (never scaled to cardW) deliberately: MAX_STATS is 4 but the real
    // minimum is 1, where cardW is nearly the full slide width — a divider
    // sized to cardW there would span almost the entire slide directly under
    // one number, which is indistinguishable from the exact "decorative
    // accent stripe" this file's own anti-pattern rule forbids. Staying
    // content-scoped (underlining just this number, at any stat count) is
    // what keeps it from crossing that line.
    const numberH = 1.5;
    const dividerGap = 0.15;
    const dividerH = 0.05;
    const labelGap = 0.15;
    stats.forEach((stat, i) => {
      const x = CONTENT_X + i * (cardW + gap);
      const numberColor = numberColorFor(i);
      // A fixed statNumber size (64pt, before any style scale) was never
      // checked against how wide the actual value STRING is — with 3-4
      // stats (MAX_STATS), cardW is only ~2-3in, and a value like "$482.3M"
      // at 64pt is wider than that, so it silently clipped left/right
      // (centered text overflows symmetrically). Shrink per-stat to the
      // longest value actually needs, down to a floor that keeps it
      // legible as a "big number."
      const valueFontSize = fitFontSize(stat.value, cardW * 0.9, numberH, numberFontSize, 24);
      const valueBox = resolveBox(slideData, `stats[${i}].value`, { x, y, w: cardW, h: numberH, fontSize: valueFontSize, color: numberColor, bold: true, italic: false, align: "center" });
      slide.addText(stat.value, {
        x: valueBox.x, y: valueBox.y, w: valueBox.w, h: valueBox.h, rotate: valueBox.rotation,
        fontSize: valueBox.fontSize, bold: valueBox.bold, italic: valueBox.italic, fontFace: theme.fonts.header, color: valueBox.color,
        align: valueBox.align, valign: "middle", margin: 0,
      });
      const dividerW = Math.min(1.3, cardW * 0.5);
      slide.addShape(pres.shapes.RECTANGLE, {
        x: x + (cardW - dividerW) / 2, y: y + numberH + dividerGap, w: dividerW, h: dividerH,
        fill: { color: numberColor }, line: { type: "none" },
      });
      const labelBox = resolveBox(slideData, `stats[${i}].label`, { x: x + 0.15, y: y + numberH + dividerGap + dividerH + labelGap, w: cardW - 0.3, h: cardH - numberH - dividerGap - dividerH - labelGap, fontSize: TYPE_SCALE.body, color: MUTED, bold: false, italic: false, align: "center" });
      slide.addText(stat.label, {
        x: labelBox.x, y: labelBox.y, w: labelBox.w, h: labelBox.h, rotate: labelBox.rotation,
        fontSize: labelBox.fontSize, fontFace: theme.fonts.body, color: labelBox.color, bold: labelBox.bold, italic: labelBox.italic,
        align: labelBox.align, valign: "top", margin: 0,
      });
    });
    return finish(pres, slide, slideData);
  }

  if (style.shape === "warm") {
    // Bordered card shell (tinted, not white) with a colored circular badge
    // behind each number instead of bold's thin divider — reuses the same
    // OVAL-behind-content mechanics addIconCircle already uses for icons.
    // The number renders at full size ON TOP of the badge (not shrunk to
    // fit inside it) so its legibility never depends on precise text-in-
    // circle containment; the badge is a soft accent layer, not a strict
    // container. Badge diameter is capped (never scaled to cardW), same
    // reasoning as bold's divider cap: at 1 stat, cardW is nearly the full
    // slide width.
    const badgeD = Math.min(2.0, cardW * 0.55);
    stats.forEach((stat, i) => {
      const x = CONTENT_X + i * (cardW + gap);
      const numberColor = numberColorFor(i);
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x, y, w: cardW, h: cardH,
        fill: { color: warmFillColor(theme) }, line: { color: CARD_BORDER, width: 1 },
        shadow: cardShadow(), rectRadius: CARD_RADIUS,
      });
      slide.addShape(pres.shapes.OVAL, {
        x: x + (cardW - badgeD) / 2, y: y + 0.25, w: badgeD, h: badgeD,
        // Same primary-not-secondary reasoning as warmFillColor, mixed less
        // toward white (0.65 vs the card's 0.85) so the badge reads as a
        // visibly distinct accent layer on top of the card's lighter tint.
        fill: { color: mixHex(theme.palette.primary, "FFFFFF", 0.65) }, line: { type: "none" },
      });
      const valueFontSize = fitFontSize(stat.value, cardW * 0.9, badgeD, numberFontSize, 24);
      const valueBox = resolveBox(slideData, `stats[${i}].value`, { x, y: y + 0.25, w: cardW, h: badgeD, fontSize: valueFontSize, color: numberColor, bold: true, italic: false, align: "center" });
      slide.addText(stat.value, {
        x: valueBox.x, y: valueBox.y, w: valueBox.w, h: valueBox.h, rotate: valueBox.rotation,
        fontSize: valueBox.fontSize, bold: valueBox.bold, italic: valueBox.italic, fontFace: theme.fonts.header, color: valueBox.color,
        align: valueBox.align, valign: "middle", margin: 0,
      });
      const labelY = y + 0.25 + badgeD + 0.15;
      const labelBox = resolveBox(slideData, `stats[${i}].label`, { x: x + 0.3, y: labelY, w: cardW - 0.6, h: Math.max(0, y + cardH - 0.15 - labelY), fontSize: TYPE_SCALE.body, color: MUTED, bold: false, italic: false, align: "center" });
      slide.addText(stat.label, {
        x: labelBox.x, y: labelBox.y, w: labelBox.w, h: labelBox.h, rotate: labelBox.rotation,
        fontSize: labelBox.fontSize, fontFace: theme.fonts.body, color: labelBox.color, bold: labelBox.bold, italic: labelBox.italic,
        align: labelBox.align, valign: "top", margin: 0,
      });
    });
    return finish(pres, slide, slideData);
  }

  // "plain" shape (university/default, plus internal-report/conference-talk
  // scaled via style.iconScale/spaceScale/uniformColor) — identical
  // structure to before this feature existed; those modifiers default to
  // 1/false for university/default, so this collapses back to byte-identical
  // output there.
  stats.forEach((stat, i) => {
    const x = CONTENT_X + i * (cardW + gap);
    const numberColor = numberColorFor(i);
    const cardBox = resolveBox(slideData, `stats[${i}].card`, { x, y, w: cardW, h: cardH, radius: CARD_RADIUS });
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: cardBox.x, y: cardBox.y, w: cardBox.w, h: cardBox.h, rotate: cardBox.rotation,
      fill: { color: CARD_BG }, line: { color: CARD_BORDER, width: 1 }, shadow: cardShadow(), rectRadius: cardBox.radius,
    });
    const valueFontSize = fitFontSize(stat.value, cardW * 0.9, 1.4, numberFontSize, 24);
    const valueBox = resolveBox(slideData, `stats[${i}].value`, { x, y: y + 0.35, w: cardW, h: 1.4, fontSize: valueFontSize, color: numberColor, bold: true, italic: false, align: "center" });
    slide.addText(stat.value, {
      x: valueBox.x, y: valueBox.y, w: valueBox.w, h: valueBox.h, rotate: valueBox.rotation,
      fontSize: valueBox.fontSize, bold: valueBox.bold, italic: valueBox.italic, fontFace: theme.fonts.header, color: valueBox.color,
      align: valueBox.align, valign: "middle", margin: 0,
    });
    const labelBox = resolveBox(slideData, `stats[${i}].label`, { x: x + 0.3, y: y + 1.75, w: cardW - 0.6, h: cardH - 1.85, fontSize: TYPE_SCALE.body, color: MUTED, bold: false, italic: false, align: "center" });
    slide.addText(stat.label, {
      x: labelBox.x, y: labelBox.y, w: labelBox.w, h: labelBox.h, rotate: labelBox.rotation,
      fontSize: labelBox.fontSize, fontFace: theme.fonts.body, color: labelBox.color, bold: labelBox.bold, italic: labelBox.italic,
      align: labelBox.align, valign: "top", margin: 0,
    });
  });
  return finish(pres, slide, slideData);
}

// Alternating light/dark rounded cards, each a single shape (label + body
// text sit on top of it) — no stacked header bar, which would visibly clip
// at the card's rounded corners.
async function buildComparisonSlide(pres, slideData, theme) {
  const slide = pres.addSlide();
  const color = await addBackground(slide, theme, "light", slideData);
  const hasHeroImage = drawHeroImage(slide, slideData);
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  addTitleText(slideData, slide, theme, slideData.title, { color, w: contentW });

  const style = getStyle(theme);
  const items = slideData.items;
  const gap = 0.4;
  const colW = (contentW - gap * (items.length - 1)) / items.length;

  items.forEach((item, i) => {
    const x = CONTENT_X + i * (colW + gap);
    const isDark = i % 2 === 1;
    // Only the light/even card varies by style — the dark/odd card (filled
    // with theme.palette.primary) already differs maximally in lightness
    // from it by design, so it's the light card that needs a style hook to
    // stop looking identical across all 6 styles. "bold" is intentionally
    // left as plain white here — it already matches the white-card look
    // used elsewhere for bold, no separate delta needed. "outline" reuses
    // cardChromeFor rather than a bespoke fill/border pair here, same as
    // every other card-drawing builder — its fill is `{type:"none"}`, so the
    // effective background behind the text is the page's own LIGHT_BG, not a
    // real card color.
    const lightChrome = cardChromeFor(theme, style);
    const lightBgForContrast = style.shape === "warm" ? warmFillColor(theme) : LIGHT_BG;
    const textColor = contrastText(isDark ? theme.palette.primary : lightBgForContrast);
    const cardBox = resolveBox(slideData, `items[${i}].card`, { x, y: BODY_Y, w: colW, h: BODY_H, radius: CARD_RADIUS });
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: cardBox.x, y: cardBox.y, w: cardBox.w, h: cardBox.h, rotate: cardBox.rotation,
      fill: isDark ? { color: theme.palette.primary } : lightChrome.fill,
      line: isDark ? { type: "none" } : lightChrome.line,
      shadow: isDark ? cardShadow() : lightChrome.shadow,
      rectRadius: cardBox.radius,
    });
    const labelBox = resolveBox(slideData, `items[${i}].label`, { x: x + 0.3, y: BODY_Y + 0.35, w: colW - 0.6, h: 0.6, fontSize: TYPE_SCALE.body + 4 + (style.boldLabel ? 2 : 0), color: textColor, bold: true, italic: false, align: "left" });
    slide.addText(item.label, {
      x: labelBox.x, y: labelBox.y, w: labelBox.w, h: labelBox.h, rotate: labelBox.rotation, margin: 0,
      fontSize: labelBox.fontSize, bold: labelBox.bold, italic: labelBox.italic, fontFace: theme.fonts.header,
      color: labelBox.color, align: labelBox.align, valign: "top",
    });
    let contentY = BODY_Y + 1.05;
    if (item.description) {
      // Fixed 0.6in box (originally sized for ~1 line at TYPE_SCALE.body) —
      // shrink the font rather than letting a longer description wrap into
      // the bullets that start right below it, which the fixed `contentY`
      // offset below has no way to account for otherwise.
      const descW = colW - 0.6;
      const descFontSize = fitFontSize(item.description, descW, 0.6, TYPE_SCALE.body, 10);
      const descBox = resolveBox(slideData, `items[${i}].description`, { x: x + 0.3, y: contentY, w: descW, h: 0.6, fontSize: descFontSize, color: textColor, bold: false, italic: false, align: "left" });
      slide.addText(item.description, {
        x: descBox.x, y: descBox.y, w: descBox.w, h: descBox.h, rotate: descBox.rotation,
        fontSize: descBox.fontSize, fontFace: theme.fonts.body, color: descBox.color, bold: descBox.bold, italic: descBox.italic,
        align: descBox.align, valign: "top", margin: 0,
      });
      contentY += 0.65;
    }
    // A card sized to fill BODY_H with only a one-line description looked
    // mostly empty — a short bullet list gives each option real substance,
    // matching the reference "checklist per option" comparison pattern.
    if (item.bullets && item.bullets.length) {
      addBulletList(slide, slideData, item.bullets, {
        x: x + 0.3, y: contentY, w: colW - 0.6, color: textColor, fontFace: theme.fonts.body, fontSize: TYPE_SCALE.body,
        basePath: `items[${i}].bullets`,
      });
    }
  });
  return finish(pres, slide, slideData);
}

async function buildTimelineSlide(pres, slideData, theme) {
  const slide = pres.addSlide();
  const color = await addBackground(slide, theme, "light", slideData);
  const hasHeroImage = drawHeroImage(slide, slideData);
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  addTitleText(slideData, slide, theme, slideData.title, { color, w: contentW });

  const items = slideData.items;
  const gap = 0.3;
  const stepW = (contentW - gap * (items.length - 1)) / items.length;
  const d = 0.6;
  // Center the block within BODY_H instead of pinning to the top — a short
  // timeline (few items, short descriptions) otherwise leaves a large empty
  // gap below, same "uneven gaps" issue as the icon grid.
  const maxDescH = 1.3;
  const naturalH = d + 0.85 + maxDescH;
  const blockY = BODY_Y + Math.max(0, (BODY_H - naturalH) / 2);
  const lineY = blockY + d / 2;
  // The connecting line is a meaningful diagram element (the process flow
  // itself), not decorative chrome, so it's exempt from the no-stripes rule.
  const connectorBox = resolveBox(slideData, "connector", { x: CONTENT_X + d / 2, y: lineY - 0.02, w: contentW - d, h: 0.04 });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: connectorBox.x, y: connectorBox.y, w: connectorBox.w, h: connectorBox.h, rotate: connectorBox.rotation,
    fill: { color: ensureReadableOnLight(theme.palette.secondary) },
  });

  items.forEach((item, i) => {
    const x = CONTENT_X + i * (stepW + gap);
    const dotColor = rotatingColor(theme, i);
    addNumberedCircle(pres, slide, {
      number: i + 1, x, y: blockY, d,
      circleColor: dotColor, textColor: contrastText(dotColor),
      fontFace: theme.fonts.body, fontSize: TYPE_SCALE.body,
      slideData, fieldPath: `items[${i}].dot`,
    });
    const labelBox = resolveBox(slideData, `items[${i}].label`, { x, y: blockY + d + 0.25, w: stepW, h: 0.6, fontSize: TYPE_SCALE.body, color, bold: true, italic: false, align: "left" });
    slide.addText(item.label, {
      x: labelBox.x, y: labelBox.y, w: labelBox.w, h: labelBox.h, rotate: labelBox.rotation,
      fontSize: labelBox.fontSize, bold: labelBox.bold, italic: labelBox.italic, fontFace: theme.fonts.body, color: labelBox.color,
      align: labelBox.align, valign: "top", margin: 0,
    });
    if (item.description) {
      const descFontSize = fitFontSize(item.description, stepW, maxDescH, TYPE_SCALE.caption + 1, 8);
      const descBox = resolveBox(slideData, `items[${i}].description`, { x, y: blockY + d + 0.85, w: stepW, h: maxDescH, fontSize: descFontSize, color: MUTED, bold: false, italic: false, align: "left" });
      slide.addText(item.description, {
        x: descBox.x, y: descBox.y, w: descBox.w, h: descBox.h, rotate: descBox.rotation,
        fontSize: descBox.fontSize, fontFace: theme.fonts.body, color: descBox.color, bold: descBox.bold, italic: descBox.italic,
        align: descBox.align, valign: "top", margin: 0,
      });
    }
  });
  return finish(pres, slide, slideData);
}

async function buildQuoteSlide(pres, slideData, theme) {
  const slide = pres.addSlide();
  const style = getStyle(theme);
  const color = await addBackground(slide, theme, "dark", slideData);
  addDecorativeCircles(pres, slide, theme, style);
  const hasHeroImage = drawHeroImage(slide, slideData);
  const textW = (hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W) - 1;
  const quoteBox = resolveBox(slideData, "quote", { x: CONTENT_X + 0.5, y: 2.2, w: textW, h: 2.6, fontSize: TYPE_SCALE.sectionHeader + 4 + (style.heroFontDelta ?? 0), color, bold: false, italic: true, align: "left" });
  slide.addText(`"${slideData.quote}"`, {
    x: quoteBox.x, y: quoteBox.y, w: quoteBox.w, h: quoteBox.h, rotate: quoteBox.rotation,
    fontSize: quoteBox.fontSize, italic: quoteBox.italic, bold: quoteBox.bold, fontFace: theme.fonts.header,
    color: quoteBox.color, align: quoteBox.align, valign: "middle", margin: 0,
  });
  if (slideData.attribution) {
    const attributionBox = resolveBox(slideData, "attribution", { x: CONTENT_X + 0.5, y: 5.0, w: textW, h: 0.6, fontSize: TYPE_SCALE.body + 2, color, bold: false, italic: false, align: "left" });
    slide.addText(`— ${slideData.attribution}`, {
      x: attributionBox.x, y: attributionBox.y, w: attributionBox.w, h: attributionBox.h, rotate: attributionBox.rotation, margin: 0,
      fontSize: attributionBox.fontSize, fontFace: theme.fonts.body, bold: attributionBox.bold, italic: attributionBox.italic,
      color: attributionBox.color, align: attributionBox.align, valign: "top",
    });
  }
  return finish(pres, slide, slideData);
}

const CHART_TYPE_MAP = { bar: "BAR", line: "LINE", pie: "PIE" };

async function buildChartSlide(pres, slideData, theme) {
  const slide = pres.addSlide();
  const color = await addBackground(slide, theme, "light", slideData);
  addTitleText(slideData, slide, theme, slideData.title, { color });

  const { chart } = slideData;
  const chartType = pres.charts[CHART_TYPE_MAP[chart.chartType]] || pres.charts.BAR;
  const chartData = chart.series.map((s) => ({
    name: s.name,
    labels: chart.categories,
    values: s.data.map((v) => (typeof v === "number" ? v : 0)),
  }));
  // PptxGenJS cycles chartColors across data points for a single-series
  // chart — an unguarded near-white accent/secondary produces an invisible
  // bar/slice against the white chart area, same bug as rotatingColor.
  const chartColors = [theme.palette.primary, theme.palette.secondary, theme.palette.accent].map(ensureReadableOnLight);

  const baseOpts = {
    x: CONTENT_X, y: BODY_Y, w: CONTENT_W, h: BODY_H - 0.2,
    chartColors,
    chartArea: { fill: { color: CARD_BG }, roundedCorners: true },
    showLegend: chartData.length > 1,
    legendPos: "b",
  };

  if (chart.chartType === "pie") {
    slide.addChart(chartType, chartData, {
      ...baseOpts,
      showPercent: true,
      dataLabelColor: "1E293B",
    });
  } else {
    slide.addChart(chartType, chartData, {
      ...baseOpts,
      barDir: "col",
      lineSmooth: chart.chartType === "line",
      catAxisLabelColor: MUTED,
      valAxisLabelColor: MUTED,
      valGridLine: { color: "E2E8F0", size: 0.5 },
      catGridLine: { style: "none" },
      showValue: true,
      dataLabelPosition: "outEnd",
      dataLabelColor: "1E293B",
    });
  }
  return finish(pres, slide, slideData);
}

// "table": genuine tabular data — rows/columns is the one shape none of the
// other types cover (chart visualizes NUMBERS as a graphic; table shows
// arbitrary short text/number cells side by side, e.g. a spec/pricing
// comparison). The header bar and row-divider lines are the table's own
// structural grid, not decorative chrome — same exemption reasoning as
// timeline's connecting line: a table's grid lines ARE the content's own
// structure, not an add-on.
async function buildTableSlide(pres, slideData, theme) {
  const slide = pres.addSlide();
  const color = await addBackground(slide, theme, "light", slideData);
  const hasHeroImage = drawHeroImage(slide, slideData);
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  addTitleText(slideData, slide, theme, slideData.title, { color, w: contentW });

  const { headers, rows } = slideData.table;
  const cols = headers.length;
  const headerHDefault = 0.55;
  // Cap row height so a small table (2-3 rows) doesn't stretch into
  // oversized rows — center the resulting (possibly shorter) block instead,
  // same "uneven gaps" treatment as every other short-content type here.
  const maxRowH = 0.7;
  const rowsHDefault = Math.min(BODY_H - headerHDefault, maxRowH * rows.length);
  const tableYDefault = BODY_Y + Math.max(0, (BODY_H - (headerHDefault + rowsHDefault)) / 2);
  const headerFrac = headerHDefault / (headerHDefault + rowsHDefault);

  // Moves/resizes as one block — same resolveBox mechanism every other
  // field uses. No rotation: pptxgenjs can't rotate a group of shapes as one
  // rigid body, so a rotated table would scatter into individually-rotated
  // cells on export — the live editor deliberately never writes a rotation
  // for this fieldPath (see SlideRenderer.jsx's TableSlide), so box.rotation
  // here is always 0, but it's still read for forward-compatibility with
  // resolveBox's generic shape.
  const box = resolveBox(slideData, "table", { x: CONTENT_X, y: tableYDefault, w: contentW, h: headerHDefault + rowsHDefault });
  const colW = box.w / cols;
  const headerH = box.h * headerFrac;
  const rowsH = box.h - headerH;
  const rowH = rowsH / rows.length;

  const headerColor = ensureReadableOnLight(theme.palette.primary);
  const headerTextColor = contrastText(headerColor);
  slide.addShape(pres.shapes.RECTANGLE, {
    x: box.x, y: box.y, w: box.w, h: headerH,
    fill: { color: headerColor }, line: { type: "none" },
  });
  headers.forEach((h, i) => {
    slide.addText(h, {
      x: box.x + i * colW + 0.15, y: box.y, w: colW - 0.3, h: headerH,
      fontSize: TYPE_SCALE.body, bold: true, fontFace: theme.fonts.body, color: headerTextColor,
      align: "left", valign: "middle", margin: 0,
    });
  });

  rows.forEach((row, r) => {
    const rowY = box.y + headerH + r * rowH;
    if (r > 0) {
      slide.addShape(pres.shapes.RECTANGLE, {
        x: box.x, y: rowY, w: box.w, h: 0.01,
        fill: { color: CARD_BORDER }, line: { type: "none" },
      });
    }
    row.forEach((cell, c) => {
      slide.addText(cell, {
        x: box.x + c * colW + 0.15, y: rowY, w: colW - 0.3, h: rowH,
        fontSize: TYPE_SCALE.body, fontFace: theme.fonts.body, color: MUTED,
        align: "left", valign: "middle", margin: 0,
      });
    });
  });

  return finish(pres, slide, slideData);
}

// "process_steps": single-column counterpart to timeline (same relationship
// icon_list has to icon_grid) — same numbered-circle-and-connector
// vocabulary as timeline, but stacked VERTICALLY so each step gets a
// full-width row for its description instead of a narrow horizontal column.
// The connecting line is the sequence itself (a meaningful diagram element),
// not decorative chrome — same exemption as timeline's own connector.
async function buildProcessStepsSlide(pres, slideData, theme) {
  const slide = pres.addSlide();
  const color = await addBackground(slide, theme, "light", slideData);
  const hasHeroImage = drawHeroImage(slide, slideData);
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  addTitleText(slideData, slide, theme, slideData.title, { color, w: contentW });

  const items = slideData.items;
  const d = 0.5;
  const gap = 0.25;
  const rowH = Math.min(1.1, (BODY_H - gap * (items.length - 1)) / items.length);
  const startY = BODY_Y + Math.max(0, (BODY_H - (rowH * items.length + gap * (items.length - 1))) / 2);

  const lineX = CONTENT_X + d / 2;
  const firstCenterY = startY + d / 2;
  const lastCenterY = startY + (items.length - 1) * (rowH + gap) + d / 2;
  slide.addShape(pres.shapes.RECTANGLE, {
    x: lineX - 0.02, y: firstCenterY, w: 0.04, h: Math.max(0, lastCenterY - firstCenterY),
    fill: { color: ensureReadableOnLight(theme.palette.secondary) },
  });

  items.forEach((item, i) => {
    const y = startY + i * (rowH + gap);
    const dotColor = rotatingColor(theme, i);
    addNumberedCircle(pres, slide, {
      number: i + 1, x: CONTENT_X, y, d,
      circleColor: dotColor, textColor: contrastText(dotColor),
      fontFace: theme.fonts.body, fontSize: TYPE_SCALE.body,
      slideData, fieldPath: `items[${i}].dot`,
    });
    const textX = CONTENT_X + d + 0.4;
    const textW = contentW - d - 0.4;
    const labelBox = resolveBox(slideData, `items[${i}].label`, { x: textX, y, w: textW, h: 0.4, fontSize: TYPE_SCALE.body + 1, color, bold: true, italic: false, align: "left" });
    slide.addText(item.label, {
      x: labelBox.x, y: labelBox.y, w: labelBox.w, h: labelBox.h, rotate: labelBox.rotation,
      fontSize: labelBox.fontSize, bold: labelBox.bold, italic: labelBox.italic, fontFace: theme.fonts.body, color: labelBox.color,
      align: labelBox.align, valign: "top", margin: 0,
    });
    if (item.description) {
      const descH = Math.max(0, rowH - 0.45);
      const descFontSize = fitFontSize(item.description, textW, descH, TYPE_SCALE.body - 1, 9);
      const descBox = resolveBox(slideData, `items[${i}].description`, { x: textX, y: y + 0.4, w: textW, h: descH, fontSize: descFontSize, color: MUTED, bold: false, italic: false, align: "left" });
      slide.addText(item.description, {
        x: descBox.x, y: descBox.y, w: descBox.w, h: descBox.h, rotate: descBox.rotation,
        fontSize: descBox.fontSize, fontFace: theme.fonts.body, color: descBox.color, bold: descBox.bold, italic: descBox.italic,
        align: descBox.align, valign: "top", margin: 0,
      });
    }
  });

  return finish(pres, slide, slideData);
}

export const LAYOUT_BUILDERS = {
  title: buildTitleSlide,
  agenda: buildAgendaSlide,
  section_header: buildSectionHeaderSlide,
  bullets: buildBulletsSlide,
  two_column: buildTwoColumnSlide,
  icon_grid: buildIconGridSlide,
  icon_list: buildIconListSlide,
  feature_split: buildFeatureSplitSlide,
  stat_callout: buildStatCalloutSlide,
  comparison: buildComparisonSlide,
  timeline: buildTimelineSlide,
  chart: buildChartSlide,
  quote: buildQuoteSlide,
  closing: buildClosingSlide,
  table: buildTableSlide,
  process_steps: buildProcessStepsSlide,
};
