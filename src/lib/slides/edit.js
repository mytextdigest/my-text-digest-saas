// src/lib/slides/edit.js
// Slide deck editing: given an EXISTING validated outline plus a
// natural-language instruction, produces a revised outline (whole-deck mode)
// or a revised single slide (current-slide mode). Mirrors the
// buildXPrompt/validateX/generateX convention outline.js already follows for
// fresh generation — this file adds the edit variants and reuses outline.js's
// validators directly rather than duplicating them.
//
// Ported verbatim from electron/slides/edit.js.

import { PALETTES, FONT_PAIRS } from "./theme.js";
import { ICON_NAMES } from "./iconNames.js";
import { SLIDE_TYPES, buildSlideTypeSchema, validateOutline, validateSlide } from "./outline.js";

const MAX_DOC_CHARS = 120000; // same constant as outline.js — small enough to not warrant a shared export

const COLOR_TRIGGERS = [
  "color", "colour", "palette", "theme", "scheme", "font", "typography",
  "background", "darker", "brighter", "vibrant", "bolder", "warmer", "cooler",
  "monochrome", "contrast",
];

// Cheap keyword heuristic — mirrors detectChartIntent in src/lib/chartSpec.js.
// Used only for ROUTING (does a single-slide edit need to escalate to a
// whole-deck edit to keep the palette cohesive), never for content.
export function detectColorIntent(instruction) {
  if (!instruction) return false;
  const text = instruction.toLowerCase();
  return COLOR_TRIGGERS.some((word) => text.includes(word));
}

// Every AI edit (whole-deck or single-slide) must have the pre-edit slide's
// freeform data merged back in afterward — an edit LLM never sees, and must
// never be allowed to silently drop, a user's manual editor work (decision
// 10). `elements`/`backgroundColor`/`layoutOverrides`/`heroImage` are
// restored from the PRE-EDIT slide unconditionally; `role` is restored only
// if the edit response didn't supply one (the edit LLM does see and may
// legitimately update `role`, unlike the freeform fields it never sees at
// all). Skipping this merge means an AI edit can silently wipe out a hero
// image or manual background a user just set.
export function mergeFreeformIntoSlide(preEditSlide, editedSlide) {
  return {
    ...editedSlide,
    elements: preEditSlide.elements,
    backgroundColor: preEditSlide.backgroundColor,
    layoutOverrides: preEditSlide.layoutOverrides,
    heroImage: preEditSlide.heroImage,
    role: editedSlide.role || preEditSlide.role,
  };
}

export function buildWholeDeckEditPrompt({ outline, instruction, documentText }) {
  const paletteNames = Object.keys(PALETTES).join(", ");
  const fontPairNames = Object.keys(FONT_PAIRS).join(", ");
  const iconNames = ICON_NAMES.join(", ");
  const truncatedText = (documentText || "").slice(0, MAX_DOC_CHARS);
  const typeSchema = buildSlideTypeSchema();

  const system =
    `You edit the CONTENT of an existing professional slide deck outline. You never decide pixel positions, colors as hex, or fonts by name — you only pick from the fixed options given below, and code renders the actual slide.\n\n` +
    `This is an EDIT to an existing outline, not a fresh design. Preserve every slide, title, bullet, item, and field that is not clearly relevant to the instruction below, verbatim — copy it through unchanged. Only change what the instruction actually asks for.\n` +
    `- If the instruction asks to add/expand content or increase depth: follow the same content-depth bar as fresh generation — specific facts from the document, 8-15 word clauses (never bare 2-4 word labels), near-maximum item/bullet counts, one distinct idea per slide.\n` +
    `- If the instruction asks to remove/shorten/simplify content: cut whole slides or items rather than leaving thin, half-empty ones behind.\n` +
    `- If the instruction asks for a color, palette, theme, or font change: pick a new "paletteName" and/or "fontPairName" from the fixed lists below — never invent hex values, and apply it deck-wide (every slide shares one palette, by design).\n` +
    `- If the instruction only concerns one topic/section, leave every other slide's content untouched.\n\n` +
    `Design rules:\n` +
    `- Pick ONE palette name from: ${paletteNames}.\n` +
    `- Pick ONE font pair name from: ${fontPairNames}.\n` +
    `- Each slide's "type" must be one of: ${SLIDE_TYPES.join(", ")}.\n` +
    SLIDE_TYPES.map((t) => typeSchema[t]).join("") +
    `- Icons: reference ONLY these names (or omit the field): ${iconNames}.\n` +
    `- Every slide except "title", "quote" needs a visual element (icon, stat, chart, or items grid) — never a text-only slide.\n\n` +
    `Respond in valid JSON only, matching this shape:\n` +
    `{"title": string, "paletteName": string, "fontPairName": string, "slides": [ ... same slide shapes as above ... ]}`;

  const user =
    `Current outline JSON:\n${JSON.stringify(outline)}\n\n` +
    `Edit instruction: ${instruction}\n\n` +
    `Document content (for grounding any new or expanded factual content):\n${truncatedText}\n\n` +
    `Return the FULL revised outline JSON now, in the same shape as the current outline above.`;

  return { system, user };
}

export function buildSlideEditPrompt({ outline, slideIndex, instruction, documentText }) {
  const targetSlide = outline.slides[slideIndex];
  const typeSchema = buildSlideTypeSchema();
  const iconNames = ICON_NAMES.join(", ");
  const truncatedText = (documentText || "").slice(0, MAX_DOC_CHARS);

  const otherSlides = outline.slides
    .map((s, i) => ({ index: i, type: s.type, title: s.title }))
    .filter((s) => s.index !== slideIndex);

  const system =
    `You edit ONE slide of an existing professional slide deck. You never decide pixel positions, colors as hex, or fonts by name.\n\n` +
    `Preserve everything in this slide that is not related to the instruction — only change what's asked. Ground any new or expanded content in the provided document text; never invent facts or numbers.\n` +
    `Do NOT change this slide's "type" — keep it exactly "${targetSlide.type}".\n` +
    `Do NOT make any color, palette, or font change — if the instruction asks for one, that is handled elsewhere; address only the content part of the instruction, if any.\n` +
    `Do NOT reuse a title that duplicates another slide's title in this deck (listed below).\n` +
    `If expanding content, follow the same content-depth bar as fresh generation: specific facts from the document, 8-15 word clauses (never bare 2-4 word labels), near-maximum item/bullet counts for this slide type.\n\n` +
    `This slide's type schema:\n${typeSchema[targetSlide.type] || ""}` +
    `Icons: reference ONLY these names (or omit the field): ${iconNames}.\n\n` +
    `Respond in valid JSON only, matching the shape of ONE slide object of type "${targetSlide.type}" as described above (no surrounding {"slides": [...]} wrapper — just the one slide object).`;

  const user =
    `Deck title: ${outline.title}\n\n` +
    `Other slides in this deck (for context — do not duplicate their titles):\n${JSON.stringify(otherSlides)}\n\n` +
    `Current slide JSON (index ${slideIndex}):\n${JSON.stringify(targetSlide)}\n\n` +
    `Edit instruction: ${instruction}\n\n` +
    `Document content (for grounding any new or expanded content):\n${truncatedText}\n\n` +
    `Return ONLY the revised slide JSON for this one slide now.`;

  return { system, user };
}

// Never throws — degrades to null on any failure, same convention as
// outline.js's generation functions.
export async function generateWholeDeckEdit({ openai, outline, instruction, documentText, signal }) {
  try {
    const { system, user } = buildWholeDeckEditPrompt({ outline, instruction, documentText });
    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        // Lower than fresh generation's text-outline temperature — an edit
        // should faithfully apply the instruction to the existing deck, not
        // creatively re-imagine it.
        temperature: 0.4,
        max_tokens: 10000,
      },
      { signal }
    );

    const content = completion.choices?.[0]?.message?.content;
    if (!content) return null;

    const revised = validateOutline(content);
    if (!revised) {
      console.warn("generateWholeDeckEdit: no usable outline after validation, raw model output:", content);
    }
    return revised;
  } catch (err) {
    console.error("generateWholeDeckEdit error:", err.message || err);
    return null;
  }
}

// Never throws — degrades to null on any failure. Validates via
// validateSlide() directly (NOT validateOutline()), since validateOutline's
// whole-deck-only post-processing (section_header dedup, cross-slide
// duplicate-title-vs-item-label filtering) would incorrectly operate on a
// single spliced slide compared against itself.
export async function generateSlideEdit({ openai, outline, slideIndex, instruction, documentText, signal }) {
  try {
    const targetSlide = outline.slides[slideIndex];
    if (!targetSlide) return null;

    const { system, user } = buildSlideEditPrompt({ outline, slideIndex, instruction, documentText });
    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 2000,
      },
      { signal }
    );

    const content = completion.choices?.[0]?.message?.content;
    if (!content) return null;

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.warn("generateSlideEdit: model response was not valid JSON:", content);
      return null;
    }

    // A rogue type change is rejected outright — the rest of the pipeline
    // (LAYOUT_BUILDERS, SlideRenderer) dispatches on type, and a mid-edit
    // type change was never asked for here (see buildSlideEditPrompt).
    if (parsed && parsed.type !== targetSlide.type) {
      console.warn("generateSlideEdit: model changed slide type, rejecting:", parsed.type, "!==", targetSlide.type);
      return null;
    }

    const revised = validateSlide(parsed);
    if (!revised) {
      console.warn("generateSlideEdit: no usable slide after validation, raw model output:", content);
    }
    return revised;
  } catch (err) {
    console.error("generateSlideEdit error:", err.message || err);
    return null;
  }
}
