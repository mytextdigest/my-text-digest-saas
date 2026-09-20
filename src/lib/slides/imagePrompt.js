// src/lib/slides/imagePrompt.js
// AI-generated slide imagery. Two responsibilities, deliberately kept
// separate: building the image prompt (pure, testable without an API key)
// and calling openai.images.generate to actually produce the image bytes.
// Orchestration (which slides qualify, concurrency, uploading to S3,
// attaching freeform elements) lives in worker/processSlideBuild.js.
//
// Ported verbatim from electron/slides/imagePrompt.js — including the
// gpt-image-1 model call, sizes, and the people/subject-line scoping rules.

// The dark, full-bleed hero slide types have genuine empty background space
// for a right-side image panel without fighting existing content for room —
// title/section_header/closing/quote all render their text left-aligned
// within a box that rarely fills the slide's full width. This is the set
// "Important slides" mode (the default) auto-generates for — deliberately
// kept narrow by product decision so the default path's image count/cost/
// visual density doesn't change.
export const IMAGE_ELIGIBLE_TYPES = new Set(["title", "section_header", "closing", "quote"]);

// Every OTHER layout type also reserves the same right-side panel and
// narrows its own content when `slide.heroImage` is set (see layouts.js/
// SlideRenderer.jsx — each builder computes `contentW` the same way the
// hero types already did). Used only by "Choose slides" (manual) mode's
// eligibility check — a user's explicit per-slide pick now has somewhere to
// go for any of these types, not just the 4 in IMAGE_ELIGIBLE_TYPES above.
//
// "chart" is deliberately excluded: it can carry up to 12 categories × 4
// series (see outline.js's MAX_CHART_CATEGORIES/MAX_CHART_SERIES) with no
// shrink-to-fit fallback the way text boxes have via fitFontSize — narrowing
// it by HERO_IMAGE_PANEL_W risks unreadable, overlapping axis labels.
export const IMAGE_CAPABLE_TYPES = new Set([
  ...IMAGE_ELIGIBLE_TYPES,
  "icon_grid", "icon_list", "stat_callout", "comparison", "timeline",
  "table", "process_steps", "agenda", "feature_split", "bullets", "two_column",
]);

const STYLE_HINT_BY_PRESENTATION_TYPE = {
  "pitch-deck": "dynamic, high-energy photographic style, shot like modern startup marketing photography",
  "sales": "polished, aspirational commercial photography showing a benefit or outcome",
  "university": "clean, documentary-style photography, thoughtful and academic in tone",
  "internal-report": "clean, minimal, understated stock-photo style",
  "conference-talk": "bold, striking, high-contrast photography with dramatic lighting",
  "minimal": "minimal, editorial photography with lots of negative space, muted tones",
};
const DEFAULT_STYLE_HINT = "clean, professional photographic style suited to a business presentation";

// Shared closing quality guard, appended both by buildImagePrompt (deck
// generation) and the Uploads panel's on-demand "Generate" tab — a
// presentation slide image is always meant as a clean visual accent, never
// a place for the model to render its own text/logo.
export const NO_TEXT_GUARD = "IMPORTANT: no text, no words, no letters, no numbers, no logos, no watermark anywhere in the image — a single clean photographic scene only, no collage, no borders.";

// Pulls the one or two lines of text a slide actually shows for its hero
// content — the only fields IMAGE_ELIGIBLE_TYPES slides have — rather than
// trying to generalize across every slide type's schema.
function textForImagePrompt(slide) {
  if (slide.type === "quote") {
    return slide.attribution ? `${slide.quote} — ${slide.attribution}` : slide.quote;
  }
  return [slide.title, slide.subtitle].filter(Boolean).join(". ");
}

// A per-slide subject alone is often too thin to ground a genuinely on-topic
// image — a "closing" slide's own text is frequently just "Thanks" or a
// short CTA, giving the image generator nothing about what the deck is
// actually about, so it falls back to generic stock-photo business imagery.
// The deck's own title slide (subtitle in particular — the outline step
// deliberately keeps it to one fact-dense sentence) is the richest domain
// description already available with zero extra LLM calls, so reuse it as
// shared context for EVERY generated image in the deck, not just the title
// slide's own.
export function buildDeckSubjectLine(outline) {
  const titleSlide = (outline?.slides || []).find((s) => s.type === "title");
  return [outline?.title, titleSlide?.subtitle].filter(Boolean).join(" — ").slice(0, 300);
}

// theme: the resolved {palette, fonts, ...} object from resolveTheme() —
// only palette hex values are used here, to nudge (not force) generated
// imagery toward the deck's existing color story rather than clashing.
// customPrompt: the user's original deck-generation instruction
// (deckIntent.customPrompt, see outline.js's buildDeckIntent) — previously
// only reached the outline text, never the image, so a request like "warm
// autumn tones" or "use forest imagery" had no effect on generated images.
// Only folded in when it plausibly carries visual guidance; kept short
// since it's steering style, not dictating the subject (the slide's own
// text already does that).
// deckSubject: buildDeckSubjectLine(outline)'s output, computed once per
// deck and passed to every slide's prompt — see that function's comment.
// allowPeople: decided per-slide by pickPeopleAllowedIndices below — false
// for most slides in a deck by default. Without an explicit instruction
// either way, gpt-image-1's default "photographic, business" style tends to
// add a person with a theatrical, overly-engaged expression to look
// dynamic, which reads as uncanny/off for a slide background. Rather than
// ban people outright (a quote's speaker, a team slide legitimately want
// one), constrain expression when they're allowed and exclude them
// otherwise.
export function buildImagePrompt(slide, theme, presentationType, customPrompt, deckSubject, allowPeople) {
  const subject = textForImagePrompt(slide).slice(0, 300);
  const styleHint = STYLE_HINT_BY_PRESENTATION_TYPE[presentationType] || DEFAULT_STYLE_HINT;
  const customStyleNote = (customPrompt || "").trim().slice(0, 200);
  // Skipped for the title slide itself (the source buildDeckSubjectLine
  // draws from — repeating it back would be redundant, not additive), and
  // for every content-bearing type (icon_list, table, stat_callout, etc.,
  // see IMAGE_CAPABLE_TYPES) — those already have a specific, rich subject
  // of their own (their title/subtitle), and forcing the deck-wide subject
  // into every one of them was making every image in a deck converge on the
  // same motif regardless of what that particular slide was actually about.
  // Only the thin-text hero types (section_header/closing/quote) still need
  // the deck subject to have anything concrete to draw from.
  const subjectNote = slide.type !== "title" && IMAGE_ELIGIBLE_TYPES.has(slide.type) ? (deckSubject || "").trim() : "";
  const peopleNote = allowPeople
    ? `If the image includes a person, keep their expression calm and neutral and their pose natural and relaxed — candid, documentary-style realism, not a theatrical or exaggerated reaction. `
    : `Do not include people or human figures in the image — focus on objects, environments, textures, or abstract visual elements only. `;
  return (
    `A photographic image to use as a presentation slide's visual accent panel. ` +
    `Subject/theme: ${subject}. ` +
    (subjectNote ? `This image is one slide in a deck about: ${subjectNote}. Reflect that actual subject matter rather than generic, unrelated stock imagery. ` : ``) +
    `Style: ${styleHint}. ` +
    (customStyleNote ? `If relevant, also reflect this user guidance for the deck's visual style: "${customStyleNote}". ` : ``) +
    `Color palette should feel compatible with hex #${theme.palette.primary} and #${theme.palette.secondary}. ` +
    peopleNote +
    NO_TEXT_GUARD
  );
}

// A deck where every generated image includes a person reads as repetitive,
// and it's the only way the exaggerated-expression problem above can
// surface. Rather than ban people outright — a `quote` slide's speaker, or a
// deck that genuinely wants a human presence, are legitimate — cap it to a
// minority of a deck's generated images (~25%) and let buildImagePrompt's
// peopleNote constrain expression for the ones that are allowed to. `quote`
// slides get first claim on those slots since they're the one type
// structurally tied to an actual person (the attribution); the rest are
// picked at random so it isn't always the same slide position across decks.
export function pickPeopleAllowedIndices(eligible, ratio = 0.25) {
  const count = Math.round(eligible.length * ratio);
  if (count <= 0) return new Set();
  const quotesFirst = eligible.filter(({ slide }) => slide.type === "quote");
  const rest = eligible.filter(({ slide }) => slide.type !== "quote");
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return new Set([...quotesFirst, ...rest].slice(0, count).map(({ index }) => index));
}

// On-demand generation from the Uploads panel's "Generate" tab — distinct
// from buildImagePrompt above, which runs at deck-generation time and
// treats the SLIDE's own text as the subject. Here the user's typed prompt
// is always the actual subject (that's the whole point of letting them type
// one); slide content, the deck's topic, and the palette are optional
// grounding folded in only when the panel's "Include slide & deck context"
// checkbox is on — additive context, never a substitute for what the user
// asked for.
export function buildOnDemandImagePrompt(userPrompt, { slide, outline, theme } = {}) {
  const subject = (userPrompt || "").trim().slice(0, 400);
  const parts = [
    `A photographic image to use as a presentation slide's visual accent panel.`,
    `Subject/theme: ${subject}.`,
  ];
  const slideText = slide ? textForImagePrompt(slide).trim().slice(0, 300) : "";
  if (slideText) {
    parts.push(`This image will sit on a slide whose own content is: "${slideText}". Keep the image relevant to that.`);
  }
  const deckSubject = outline ? buildDeckSubjectLine(outline) : "";
  if (deckSubject) {
    parts.push(`The wider deck this slide belongs to is about: ${deckSubject}.`);
  }
  if (theme?.palette?.primary && theme?.palette?.secondary) {
    parts.push(`Color palette should feel compatible with hex #${theme.palette.primary} and #${theme.palette.secondary}.`);
  }
  parts.push(NO_TEXT_GUARD);
  return parts.join(" ");
}

// The 3 shapes gpt-image-1 actually supports (plus "auto", which we never
// pass — the Uploads panel's aspect-ratio picker always sends one of these
// explicitly). Exported so the generate-slide-image route can whitelist the
// `size` a request is allowed to ask for, same never-trust-the-payload
// discipline as elements.js's validators.
export const GENERATE_IMAGE_SIZES = new Set(["1024x1024", "1024x1536", "1536x1024"]);
// Portrait — matches the hero-image right-side panel every eligible slide
// type reserves, so it's the sensible default when a caller doesn't ask for
// a specific shape.
export const DEFAULT_GENERATE_IMAGE_SIZE = "1024x1536";

// "medium" quality balances cost/latency against a deck that may need
// several of these per generation.
export async function generateSlideImageBuffer(openai, prompt, size = DEFAULT_GENERATE_IMAGE_SIZE) {
  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size: GENERATE_IMAGE_SIZES.has(size) ? size : DEFAULT_GENERATE_IMAGE_SIZE,
    quality: "medium",
    n: 1,
  });
  const b64 = response?.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image generation returned no data");
  return Buffer.from(b64, "base64");
}
