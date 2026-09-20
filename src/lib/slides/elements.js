// src/lib/slides/elements.js
// Freeform (Canva-style) per-slide overlay: user-authored text boxes and
// shapes placed directly in the editor, independent of the LLM-generated
// template content in outline.js. Never touched by the LLM (see
// outline.js's validateSlide) — this file's validators exist purely as a
// defense-in-depth bounds check on data the editor UI writes directly via
// the layout-patch API route.
//
// Ported near-verbatim from electron/slides/elements.js (desktop). The one
// deliberate change: image `src` is validated as an S3-hosted URL instead of
// a `file://` URL (this repo has no local filesystem) — everywhere else is a
// straight port.

import crypto from "crypto";
import { SLIDE_W, SLIDE_H } from "./theme.js";

export const KINDS = [
  "text", "rect", "ellipse", "line",
  // Additional basic shapes, all sharing the same fill/stroke/strokeWidth/
  // opacity schema as rect/ellipse (see validateElement's generic catchall
  // below); only their rendering (SlideRenderer.jsx) and PPTX export
  // shape-type mapping (layouts.js) differ per kind.
  "triangle", "diamond", "pentagon", "hexagon", "star", "rightArrow", "roundRect", "octagon", "parallelogram",
  "image",
];
const MAX_TEXT_LEN = 500;
const MAX_ELEMENTS_PER_SLIDE = 100;

export const DEFAULT_ELEMENT_BY_KIND = {
  text: { w: 3, h: 1, text: "Text", fontSize: 18, fontFamily: "Calibri", color: "1A1A1A", align: "left", bold: false, italic: false },
  rect: { w: 2, h: 1.2, fill: "CADCFC", stroke: null, strokeWidth: 1, opacity: 1 },
  ellipse: { w: 2, h: 2, fill: "CADCFC", stroke: null, strokeWidth: 1, opacity: 1 },
  line: { w: 3, h: 0, fill: null, stroke: "1A1A1A", strokeWidth: 2, opacity: 1 },
  triangle: { w: 2, h: 1.8, fill: "CADCFC", stroke: null, strokeWidth: 1, opacity: 1 },
  diamond: { w: 2, h: 2, fill: "CADCFC", stroke: null, strokeWidth: 1, opacity: 1 },
  pentagon: { w: 2, h: 1.9, fill: "CADCFC", stroke: null, strokeWidth: 1, opacity: 1 },
  hexagon: { w: 2.2, h: 1.9, fill: "CADCFC", stroke: null, strokeWidth: 1, opacity: 1 },
  star: { w: 2, h: 2, fill: "CADCFC", stroke: null, strokeWidth: 1, opacity: 1 },
  rightArrow: { w: 2.4, h: 1.2, fill: "CADCFC", stroke: null, strokeWidth: 1, opacity: 1 },
  roundRect: { w: 2, h: 1.2, fill: "CADCFC", stroke: null, strokeWidth: 1, opacity: 1 },
  octagon: { w: 2, h: 2, fill: "CADCFC", stroke: null, strokeWidth: 1, opacity: 1 },
  parallelogram: { w: 2.2, h: 1.2, fill: "CADCFC", stroke: null, strokeWidth: 1, opacity: 1 },
  // w/h here are only a validator fallback — real inserts (SlideDeckEditor's
  // handleAddImage) always pass an explicit aspect-correct w/h computed from
  // the uploaded image's actual pixel dimensions.
  image: { w: 4, h: 3, src: null, opacity: 1 },
};

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function truncateString(value, maxLen) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}

function isHexColor(value) {
  return typeof value === "string" && /^[0-9a-fA-F]{6}$/.test(value);
}

// This repo stores images in S3 and hands out signed HTTPS URLs — the
// desktop equivalent of a `file://` URL check. Deliberately permissive
// (scheme-only, not a same-bucket/domain check) since this is a bounds
// validator, not a security boundary — real access control happens at the
// S3/document-ownership layer, same permissive-shape-only stance the rest
// of this file takes.
function isValidImageSrc(value) {
  return typeof value === "string" && /^https:\/\//i.test(value);
}

// null is a valid "no fill"/"no stroke" value, distinct from "unset" (which
// falls back to the kind's default) — so a caller can explicitly clear a
// color, not just never set one.
function resolveOptionalColor(raw, fallback) {
  if (raw === null) return null;
  return isHexColor(raw) ? raw : fallback;
}

// Accepts either a solid hex color (unchanged) or a 2-stop gradient
// descriptor { type: "gradient", angle, stops: [hexA, hexB] } — dropped
// entirely (returns null) if fewer than 2 of `stops` are valid hex colors,
// same "drop if unusable" stance validateElement already takes for its own
// required fields.
export function validateBackgroundColor(raw) {
  if (raw === null || raw === undefined) return null;
  if (isHexColor(raw)) return raw;
  if (raw && typeof raw === "object" && raw.type === "gradient") {
    const stops = Array.isArray(raw.stops) ? raw.stops.filter(isHexColor) : [];
    if (stops.length < 2) return null;
    const angle = clampNum(raw.angle, -360, 360, 135);
    return { type: "gradient", angle, stops: [stops[0], stops[1]] };
  }
  return null;
}

// Validates one freeform element, dropping it (returns null) if it's
// unusable. Mirrors validateSlide's never-throws, whitelist-per-kind style
// in outline.js.
export function validateElement(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!KINDS.includes(raw.kind)) return null;
  const defaults = DEFAULT_ELEMENT_BY_KIND[raw.kind];

  const base = {
    id: (typeof raw.id === "string" && raw.id.trim()) ? raw.id.trim() : crypto.randomUUID(),
    kind: raw.kind,
    x: clampNum(raw.x, 0, SLIDE_W, 0),
    y: clampNum(raw.y, 0, SLIDE_H, 0),
    w: clampNum(raw.w, 0.1, SLIDE_W, defaults.w),
    h: clampNum(raw.h, 0, SLIDE_H, defaults.h),
    rotation: clampNum(raw.rotation, -360, 360, 0),
    zIndex: clampNum(raw.zIndex, 0, 9999, 0),
  };

  if (raw.kind === "text") {
    return {
      ...base,
      text: truncateString(raw.text, MAX_TEXT_LEN) || defaults.text,
      fontSize: clampNum(raw.fontSize, 6, 200, defaults.fontSize),
      fontFamily: truncateString(raw.fontFamily, 60) || defaults.fontFamily,
      color: resolveOptionalColor(raw.color, defaults.color) || defaults.color,
      align: ["left", "center", "right"].includes(raw.align) ? raw.align : defaults.align,
      bold: !!raw.bold,
      italic: !!raw.italic,
    };
  }

  if (raw.kind === "image") {
    // Unlike every other kind, there's no sensible default image — an
    // element with a missing/invalid src is unusable, so drop it entirely
    // (same as an unrecognized kind), rather than falling back to a
    // placeholder the way text falls back to "Text".
    if (!isValidImageSrc(raw.src)) return null;
    return {
      ...base,
      src: raw.src,
      opacity: clampNum(raw.opacity, 0, 1, defaults.opacity),
    };
  }

  // rect / ellipse / line / every other basic shape kind — all share this
  // same fill/stroke/strokeWidth/opacity schema; only rendering and PPTX
  // export differ per kind.
  return {
    ...base,
    fill: resolveOptionalColor(raw.fill, defaults.fill),
    stroke: resolveOptionalColor(raw.stroke, defaults.stroke),
    strokeWidth: clampNum(raw.strokeWidth, 0, 40, defaults.strokeWidth),
    opacity: clampNum(raw.opacity, 0, 1, defaults.opacity),
  };
}

export function validateElements(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_ELEMENTS_PER_SLIDE).map(validateElement).filter(Boolean);
}

// Validates a direct (non-AI) replace/remove of slide.heroImage — same src
// shape as an "image" freeform element (must be a valid S3-hosted URL),
// since this is the same upload/generate pipeline just writing to a
// different slot. null clears it entirely ("Remove image").
export function validateHeroImage(raw) {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== "object") return null;
  if (!isValidImageSrc(raw.src)) return null;
  return { src: raw.src };
}

const MAX_LAYOUT_OVERRIDES = 50;
const MAX_FIELD_PATH_LEN = 100;

// Per-slide {fieldPath: {x?, y?, w?, h?, rotation?, fontSize?, color?,
// bold?, italic?, align?}} overrides for EXISTING template content
// (title/bullets/item labels/...), keyed by the same fieldPath strings
// content.js's validateContentPatch and SlideRenderer's onCommitField
// already use — an independent override layer on top of the AI-generated
// content, same as elements/backgroundColor above. Never touched by the
// LLM. Field legitimacy (whether "bullets[4]" actually exists on this
// slide) isn't checked here, same permissive-shape-only stance
// validateElement takes — a stale entry for a field that no longer exists
// after content changes is simply never read back by anything, not a
// validity problem.
//
// Every field is independently optional — a resize-only commit shouldn't
// need to resend x/y, and vice versa, since SlideDeckEditor merges a
// gesture's/toolbar edit's partial patch onto the existing per-fieldPath
// entry rather than replacing it wholesale. fontSize/color/bold/italic/align
// are the same style fields the freeform text toolbar already exposes for
// `elements[]` — same clamp ranges validateElement uses.
export function validateLayoutOverrides(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  let count = 0;
  for (const [fieldPath, box] of Object.entries(raw)) {
    if (count >= MAX_LAYOUT_OVERRIDES) break;
    if (typeof fieldPath !== "string" || !fieldPath.trim()) continue;
    if (!box || typeof box !== "object") continue;

    const entry = {};
    if (box.x !== undefined) {
      const x = clampNum(box.x, 0, SLIDE_W, null);
      if (x !== null) entry.x = x;
    }
    if (box.y !== undefined) {
      const y = clampNum(box.y, 0, SLIDE_H, null);
      if (y !== null) entry.y = y;
    }
    if (box.w !== undefined) {
      const w = clampNum(box.w, 0.1, SLIDE_W, null);
      if (w !== null) entry.w = w;
    }
    if (box.h !== undefined) {
      const h = clampNum(box.h, 0, SLIDE_H, null);
      if (h !== null) entry.h = h;
    }
    if (box.rotation !== undefined) {
      const rotation = clampNum(box.rotation, -360, 360, null);
      if (rotation !== null) entry.rotation = rotation;
    }
    if (box.fontSize !== undefined) {
      const fontSize = clampNum(box.fontSize, 6, 200, null);
      if (fontSize !== null) entry.fontSize = fontSize;
    }
    if (box.color !== undefined) {
      if (isHexColor(box.color)) entry.color = box.color;
    }
    if (box.bold !== undefined) entry.bold = !!box.bold;
    if (box.italic !== undefined) entry.italic = !!box.italic;
    if (box.align !== undefined) {
      if (["left", "center", "right"].includes(box.align)) entry.align = box.align;
    }
    // Corner radius override for rect-shaped chrome (cards/panels), in
    // inches, same unit x/y/w/h already use. Not applicable to circles
    // (aspect-locked, always fully round) or the timeline connector line,
    // but harmless to accept generically here same as every other field —
    // a stray entry for a field that doesn't read it back is simply never
    // used, same permissive stance the rest of this validator already
    // takes.
    if (box.radius !== undefined) {
      const radius = clampNum(box.radius, 0, 2, null);
      if (radius !== null) entry.radius = radius;
    }
    if (Object.keys(entry).length === 0) continue;

    out[fieldPath.trim().slice(0, MAX_FIELD_PATH_LEN)] = entry;
    count++;
  }
  return out;
}

export { isHexColor };
