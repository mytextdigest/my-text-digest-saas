// Step 8 of the slide-generation improvement plan (see
// SLIDE_GENERATION_PIPELINE_ANALYSIS.md): regression tests for the
// deterministic, pure-function layer that Steps 1-7 built — the guarantee
// that "presentationType/customPrompt/visualStyle actually change the
// output" is a property of code (prompt builders, validators, config maps),
// not of the LLM's mood. These run with zero API calls and zero Electron
// runtime, so they're fast, free, and safe to run on every change.
//
// Deliberately NOT covered here (see the doc's own Step 8 risk note): actual
// LLM output (generateStructuredOutline's model call — inherently
// non-deterministic, would need network + an API key + cost money) and
// anything in electron/main.js (mergeFreeform's role/heroImage edit-fallback
// logic, attachGeneratedImages) — main.js requires the `electron` module at
// load time and cannot be required outside the Electron runtime without
// mocking it, which is out of scope for this pass. What IS covered is
// exactly the layer that determines whether a difference *can* reach the
// model/renderer at all: if these pass but a real deck still looks generic,
// the bug is in the model's compliance with the prompt, not in this
// pipeline's plumbing — a useful triage signal on its own.
//
// Run: node --test src/lib/slides/__tests__/differentiation.test.js
// (or `npm run test:slides` from the repo root)

import test from "node:test";
import assert from "node:assert/strict";

import * as outline from "../outline.js";
import { scoreDeckAgainstIntent, PRESENTATION_INTENT_RULES, LEANED_TYPES_BY_PRESENTATION_TYPE } from "../intent.js";
import { buildDeckSubjectLine, buildImagePrompt, pickPeopleAllowedIndices, IMAGE_ELIGIBLE_TYPES } from "../imagePrompt.js";
import { getStyle } from "../theme.js";

const PRESENTATION_TYPES = ["pitch-deck", "sales", "university", "internal-report", "conference-talk", "minimal"];

// ---------------------------------------------------------------------------
// Step 2: deckIntent
// ---------------------------------------------------------------------------

test("buildDeckIntent: differs by presentationType, customPrompt, generateImages, visualStyle", () => {
  const a = outline.buildDeckIntent({ presentationType: "pitch-deck", customPrompt: "focus on traction", generateImages: true, visualStyle: "more-visual" });
  const b = outline.buildDeckIntent({ presentationType: "university", customPrompt: "", generateImages: false, visualStyle: "" });
  assert.notEqual(a.presentationType, b.presentationType);
  assert.notEqual(a.customPrompt, b.customPrompt);
  assert.notEqual(a.generateImages, b.generateImages);
  assert.notEqual(a.visualStyle, b.visualStyle);
});

test("buildDeckIntent: unknown visualStyle is rejected, not silently passed through", () => {
  const intent = outline.buildDeckIntent({ presentationType: "pitch-deck", visualStyle: "bogus-style" });
  assert.equal(intent.visualStyle, null);
});

test("buildDeckIntent: missing everything still returns a well-formed object (older-caller safety)", () => {
  const intent = outline.buildDeckIntent({});
  assert.deepEqual(intent, { presentationType: null, customPrompt: "", generateImages: false, visualStyle: null, imageMode: outline.DEFAULT_IMAGE_MODE });
});

// ---------------------------------------------------------------------------
// Step 9a: image selection mode
// ---------------------------------------------------------------------------

test("buildDeckIntent: imageMode defaults to DEFAULT_IMAGE_MODE when missing or invalid", () => {
  assert.equal(outline.buildDeckIntent({}).imageMode, outline.DEFAULT_IMAGE_MODE);
  assert.equal(outline.buildDeckIntent({ imageMode: "all" }).imageMode, outline.DEFAULT_IMAGE_MODE);
  assert.equal(outline.DEFAULT_IMAGE_MODE, "important");
});

test("buildDeckIntent: a valid imageMode is preserved verbatim", () => {
  for (const mode of outline.IMAGE_MODES) {
    assert.equal(outline.buildDeckIntent({ imageMode: mode }).imageMode, mode);
  }
});

test("IMAGE_MODES: 'all' is deliberately not a supported mode yet (gated on Step 9b's layout slots)", () => {
  assert.ok(!outline.IMAGE_MODES.includes("all"));
});

// ---------------------------------------------------------------------------
// Step 1 + Step 7: customPrompt and visualStyle reach the structuring prompt
// ---------------------------------------------------------------------------

const SAMPLE_SLIDES = [{ title: "Overview", body: "A single sentence about the company." }];

test("buildStructurePrompt: customPrompt text appears in the system prompt when given", () => {
  const withPrompt = outline.buildStructurePrompt({ title: "T", slides: SAMPLE_SLIDES, customPrompt: "focus on investor traction and end with a funding ask" });
  const withoutPrompt = outline.buildStructurePrompt({ title: "T", slides: SAMPLE_SLIDES, customPrompt: "" });
  assert.match(withPrompt.system, /focus on investor traction and end with a funding ask/);
  assert.doesNotMatch(withoutPrompt.system, /investor traction/);
});

test("buildStructurePrompt: visualStyle adds its guidance line only when set to a known value", () => {
  const visual = outline.buildStructurePrompt({ title: "T", slides: SAMPLE_SLIDES, visualStyle: "more-visual" });
  const analytical = outline.buildStructurePrompt({ title: "T", slides: SAMPLE_SLIDES, visualStyle: "more-analytical" });
  const minimal = outline.buildStructurePrompt({ title: "T", slides: SAMPLE_SLIDES, visualStyle: "minimal" });
  const balanced = outline.buildStructurePrompt({ title: "T", slides: SAMPLE_SLIDES, visualStyle: "" });
  const bogus = outline.buildStructurePrompt({ title: "T", slides: SAMPLE_SLIDES, visualStyle: "not-a-real-style" });

  assert.match(visual.system, /MORE VISUAL/);
  assert.match(analytical.system, /MORE ANALYTICAL/);
  assert.match(minimal.system, /MINIMAL style/);
  for (const p of [balanced, bogus]) {
    assert.doesNotMatch(p.system, /MORE VISUAL/);
    assert.doesNotMatch(p.system, /MORE ANALYTICAL/);
    assert.doesNotMatch(p.system, /MINIMAL style/);
  }
});

test("buildStructurePrompt: every slide gets a distinct role field in the JSON shape instructions", () => {
  const { system } = outline.buildStructurePrompt({ title: "T", slides: SAMPLE_SLIDES });
  assert.match(system, /also pick ONE "role"/);
  const roleFieldCount = (system.match(/"role": string/g) || []).length;
  assert.ok(roleFieldCount >= 8, `expected the JSON shape block to mention "role" for every example type, got ${roleFieldCount}`);
});

// ---------------------------------------------------------------------------
// Step 4: intent scoring config genuinely differs by presentationType
// ---------------------------------------------------------------------------

test("PRESENTATION_INTENT_RULES / LEANED_TYPES_BY_PRESENTATION_TYPE: every presentationType has a distinct entry", () => {
  for (const type of PRESENTATION_TYPES) {
    assert.ok(LEANED_TYPES_BY_PRESENTATION_TYPE[type], `missing LEANED_TYPES entry for ${type}`);
    assert.ok(PRESENTATION_INTENT_RULES[type], `missing PRESENTATION_INTENT_RULES entry for ${type}`);
  }
  // Closing role expectations must differ across at least these three
  // (the doc's own worked example) — a regression that collapsed them to
  // the same value would silently defeat the entire point of Step 4.
  const closings = new Set([
    PRESENTATION_INTENT_RULES["pitch-deck"].closingRole,
    PRESENTATION_INTENT_RULES["university"].closingRole,
    PRESENTATION_INTENT_RULES["internal-report"].closingRole,
  ]);
  assert.equal(closings.size, 3, `expected 3 distinct closing roles, got [${[...closings].join(", ")}]`);
});

test("scoreDeckAgainstIntent: a well-formed pitch deck scores 1.0 with no warnings", () => {
  const goodDeck = {
    slides: [
      { type: "title", role: "hook" },
      { type: "bullets", role: "problem" },
      { type: "stat_callout", role: "solution" },
      { type: "comparison", role: "proof" },
      { type: "closing", role: "ask" },
    ],
  };
  const result = scoreDeckAgainstIntent(goodDeck, "pitch-deck");
  assert.equal(result.score, 1);
  assert.deepEqual(result.warnings, []);
});

test("scoreDeckAgainstIntent: a deck that ignores every pitch-deck expectation scores low with specific warnings", () => {
  const badDeck = {
    slides: [
      { type: "bullets", role: "content" },
      { type: "bullets", role: "content" },
      { type: "bullets", role: "content" },
      { type: "closing", role: "conclusion" },
    ],
  };
  const result = scoreDeckAgainstIntent(badDeck, "pitch-deck");
  assert.ok(result.score < 1);
  assert.ok(result.warnings.some((w) => w.startsWith("leaned-type-usage")));
  assert.ok(result.warnings.some((w) => w.startsWith("required-role:problem")));
  assert.ok(result.warnings.some((w) => w.startsWith("required-role:solution")));
  assert.ok(result.warnings.some((w) => w.startsWith("closing-role")));
  assert.ok(result.warnings.some((w) => w.startsWith("type-diversity")));
});

test("scoreDeckAgainstIntent: returns null when there's nothing to score against", () => {
  const deck = { slides: [{ type: "title", role: "hook" }] };
  assert.equal(scoreDeckAgainstIntent(deck, undefined), null);
  assert.equal(scoreDeckAgainstIntent(deck, "not-a-real-type"), null);
  assert.equal(scoreDeckAgainstIntent({ slides: [] }, "pitch-deck"), null);
});

// ---------------------------------------------------------------------------
// Step 5: layout variant config (the hero-kicker's on/off signal)
// ---------------------------------------------------------------------------

test("getStyle: heroFontDelta sign differs across presentationType (drives the Step 5 hero-kicker variant)", () => {
  const energetic = ["pitch-deck", "conference-talk"];
  const toneddown = ["internal-report", "minimal"];
  for (const type of energetic) {
    const delta = getStyle({ presentationType: type }).heroFontDelta ?? 0;
    assert.ok(delta > 0, `expected ${type} to have a positive heroFontDelta (hero-kicker should show), got ${delta}`);
  }
  for (const type of toneddown) {
    const delta = getStyle({ presentationType: type }).heroFontDelta ?? 0;
    assert.ok(delta <= 0, `expected ${type} to NOT have a positive heroFontDelta (hero-kicker should stay hidden), got ${delta}`);
  }
});

// ---------------------------------------------------------------------------
// Step 6: image prompts differ by type and are grounded in the deck subject
// ---------------------------------------------------------------------------

test("buildImagePrompt: style hint differs across presentationType for the same slide", () => {
  const slide = { type: "title", title: "Acme Corp", subtitle: "We make things" };
  const theme = { palette: { primary: "111111", secondary: "222222" } };
  const pitchPrompt = buildImagePrompt(slide, theme, "pitch-deck", "", "");
  const uniPrompt = buildImagePrompt(slide, theme, "university", "", "");
  assert.notEqual(pitchPrompt, uniPrompt);
});

test("buildDeckSubjectLine + buildImagePrompt: a thin closing slide's image prompt is grounded in the deck's actual subject", () => {
  const deckOutline = {
    title: "Solstice Robotics FY2022 Financial Overview",
    slides: [
      { type: "title", title: "Solstice Robotics", subtitle: "Designs automation solutions for industrial and logistics markets" },
      { type: "closing", title: "Thanks" },
    ],
  };
  const subject = buildDeckSubjectLine(deckOutline);
  const theme = { palette: { primary: "111111", secondary: "222222" } };

  const closingPrompt = buildImagePrompt(deckOutline.slides[1], theme, "pitch-deck", "", subject);
  assert.match(closingPrompt, /industrial and logistics/);

  // The title slide IS the source of that grounding text — repeating it back
  // to itself would be redundant, not additive (see imagePrompt.js).
  const titlePrompt = buildImagePrompt(deckOutline.slides[0], theme, "pitch-deck", "", subject);
  assert.doesNotMatch(titlePrompt, /This image is one slide in a deck about/);
});

test("IMAGE_ELIGIBLE_TYPES: stays exactly the hero-style types with genuine free background space", () => {
  assert.deepEqual([...IMAGE_ELIGIBLE_TYPES].sort(), ["closing", "quote", "section_header", "title"]);
});

// ---------------------------------------------------------------------------
// Image-relevance fix: content-bearing slides don't inherit the deck-wide subject, and
// people are capped to a minority of a deck's images with expression
// constrained (client feedback, 2026-08-27 — every image was rendering the
// deck's literal subject, e.g. robots on an unrelated finance slide, and
// people carried theatrical/exaggerated expressions)
// ---------------------------------------------------------------------------

test("buildImagePrompt: a content-bearing slide (e.g. icon_list) does NOT inherit the deck-wide subject", () => {
  const deckOutline = {
    title: "Solstice Robotics FY2022 Financial Overview",
    slides: [
      { type: "title", title: "Solstice Robotics", subtitle: "Designs automation solutions for industrial and logistics markets" },
      { type: "icon_list", title: "Cash Flow Highlights", items: [] },
    ],
  };
  const subject = buildDeckSubjectLine(deckOutline);
  const theme = { palette: { primary: "111111", secondary: "222222" } };

  const iconListPrompt = buildImagePrompt(deckOutline.slides[1], theme, "pitch-deck", "", subject);
  assert.doesNotMatch(iconListPrompt, /This image is one slide in a deck about/);
  assert.doesNotMatch(iconListPrompt, /industrial and logistics/);
  assert.match(iconListPrompt, /Cash Flow Highlights/);
});

test("buildImagePrompt: peopleNote flips between excluding people and constraining their expression", () => {
  const slide = { type: "title", title: "Acme Corp", subtitle: "We make things" };
  const theme = { palette: { primary: "111111", secondary: "222222" } };

  const noPeoplePrompt = buildImagePrompt(slide, theme, "pitch-deck", "", "", false);
  assert.match(noPeoplePrompt, /Do not include people/);

  const constrainedPrompt = buildImagePrompt(slide, theme, "pitch-deck", "", "", true);
  assert.match(constrainedPrompt, /calm and neutral/);
  assert.doesNotMatch(constrainedPrompt, /Do not include people/);
});

test("pickPeopleAllowedIndices: caps people to roughly a quarter of eligible slides, prioritizing quote slides", () => {
  const eligible = [
    { slide: { type: "quote" }, index: 0 },
    { slide: { type: "title" }, index: 1 },
    { slide: { type: "closing" }, index: 2 },
    { slide: { type: "section_header" }, index: 3 },
  ];
  const allowed = pickPeopleAllowedIndices(eligible);
  assert.equal(allowed.size, 1);
  assert.ok(allowed.has(0), "the sole quote slide should get first claim on the one people-allowed slot");
});

test("pickPeopleAllowedIndices: an empty or tiny eligible list allows no people rather than rounding up", () => {
  assert.equal(pickPeopleAllowedIndices([]).size, 0);
  assert.equal(pickPeopleAllowedIndices([{ slide: { type: "title" }, index: 0 }]).size, 0);
});

// ---------------------------------------------------------------------------
// Step 3: role field — backward compatibility with pre-Step-3 outlines
// ---------------------------------------------------------------------------

test("validateSlide: a legacy raw slide with no role field at all still validates (backward compatible)", () => {
  const legacyRaw = {
    type: "bullets",
    title: "Traction",
    bullets: [
      "Revenue grew 40 percent year over year across all product lines",
      "Signed twelve new enterprise logos in the last two quarters",
      "Expanded operations into three new EU markets this year",
      "Reduced customer churn to under 2 percent company wide",
    ],
    // no `role` key — exactly what every outline persisted before Step 3 looks like
  };
  const validated = outline.validateSlide(legacyRaw);
  assert.ok(validated, "legacy slide with no role should still validate");
  assert.equal(validated.role, undefined, "validateSlide should leave role undefined, not throw or reject, when absent");
});

test("validateStructuredSlide: defaults role to DEFAULT_SLIDE_ROLE when the model omits it", () => {
  const approved = { title: "Traction", body: "- Revenue grew 40 percent year over year across all product lines\n- Signed twelve new enterprise logos in the last two quarters\n- Expanded operations into three new EU markets this year\n- Reduced customer churn to under 2 percent company wide" };
  const raw = {
    type: "bullets",
    title: "Traction",
    bullets: [
      "Revenue grew 40 percent year over year across all product lines",
      "Signed twelve new enterprise logos in the last two quarters",
      "Expanded operations into three new EU markets this year",
      "Reduced customer churn to under 2 percent company wide",
    ],
  };
  const result = outline.validateStructuredSlide(raw, approved, false);
  assert.equal(result.role, outline.DEFAULT_SLIDE_ROLE);
});

test("validateStructuredSlide: preserves a valid model-supplied role instead of overwriting it", () => {
  const approved = { title: "Traction", body: "- Revenue grew 40 percent year over year across all product lines\n- Signed twelve new enterprise logos in the last two quarters\n- Expanded operations into three new EU markets this year\n- Reduced customer churn to under 2 percent company wide" };
  const raw = {
    type: "bullets",
    title: "Traction",
    role: "proof",
    bullets: [
      "Revenue grew 40 percent year over year across all product lines",
      "Signed twelve new enterprise logos in the last two quarters",
      "Expanded operations into three new EU markets this year",
      "Reduced customer churn to under 2 percent company wide",
    ],
  };
  const result = outline.validateStructuredSlide(raw, approved, false);
  assert.equal(result.role, "proof");
});

test("SLIDE_ROLES: DEFAULT_SLIDE_ROLE is itself a member of SLIDE_ROLES", () => {
  assert.ok(outline.SLIDE_ROLES.includes(outline.DEFAULT_SLIDE_ROLE));
});
