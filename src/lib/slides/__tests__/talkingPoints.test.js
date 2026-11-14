// Talking points (TALKING_POINTS_ROADMAP.md): pure-function layer — content
// fingerprint, HTML sanitizer, plain-text notes conversion, LLM-entry
// validation and the PDF document builder. No API calls, no Electron.
//
// Run: node --test src/lib/slides/__tests__/talkingPoints.test.js
// (or `npm run test:slides` from the repo root)

import test from "node:test";
import assert from "node:assert/strict";

import {
  slideContentHash, sanitizeTalkingPointsHtml, talkingPointsToPlainText,
  validateTalkingPointsEntry, buildTalkingPointsPdfHtml, buildDeckTalkingPointsPrompt,
  buildSlideTalkingPointsPrompt, formatDuration, slideBudgetsMs, computePace,
} from "../talkingPoints.js";

const baseSlide = {
  id: "a1", type: "bullets", title: "Revenue grew", bullets: ["Up 14% YoY", "Driven by EMEA"], icon: "chart",
  elements: [], backgroundColor: null, layoutOverrides: {}, role: "evidence",
};

test("slideContentHash: changes when content changes", () => {
  const h = slideContentHash(baseSlide);
  assert.notEqual(h, slideContentHash({ ...baseSlide, title: "Revenue fell" }));
  assert.notEqual(h, slideContentHash({ ...baseSlide, bullets: ["Up 14% YoY"] }));
});

test("slideContentHash: ignores layout/freeform/decorative fields and key order", () => {
  const h = slideContentHash(baseSlide);
  assert.equal(h, slideContentHash({
    ...baseSlide,
    elements: [{ id: "e", kind: "text", text: "x" }],
    backgroundColor: "FF0000",
    layoutOverrides: { title: { x: 1, y: 2 } },
    heroImage: { src: "file:///x.png" },
    icon: "star",
    role: "hook",
    speakerNotes: "notes",
  }));
  const reordered = { bullets: baseSlide.bullets, title: baseSlide.title, type: baseSlide.type, id: "zz" };
  assert.equal(h, slideContentHash(reordered));
});

test("slideContentHash: whitespace-only differences don't flag a slide as changed", () => {
  assert.equal(slideContentHash(baseSlide), slideContentHash({ ...baseSlide, title: "  Revenue   grew " }));
});

test("sanitizeTalkingPointsHtml: keeps the editor's tags, strips attributes and everything else", () => {
  const dirty = `<p class="x" onclick="evil()">Hi <b>there</b> <a href="javascript:1">link</a></p>` +
    `<script>alert(1)</script><ul><li><p>One <mark data-color="red">hot</mark></p></li></ul>` +
    `<h2 style="color:red">Head</h2><img src=x onerror=alert(1)><!-- c -->`;
  assert.equal(
    sanitizeTalkingPointsHtml(dirty),
    `<p>Hi <strong>there</strong> link</p><ul><li><p>One <mark>hot</mark></p></li></ul><h3>Head</h3>`
  );
  assert.equal(sanitizeTalkingPointsHtml(null), "");
  assert.equal(sanitizeTalkingPointsHtml("a < b > c"), "a &lt; b &gt; c");
});

test("talkingPointsToPlainText: lists become bullet/number lines, entities decoded", () => {
  const html = `<p>Open &amp; <strong>bold</strong></p><ul><li><p>First</p></li><li><p>Second</p></li></ul>` +
    `<ol><li><p>Step</p></li><li><p>Next</p></li></ol><p><em>Transition:</em> onward</p>`;
  const text = talkingPointsToPlainText(html);
  assert.match(text, /^Open & bold/);
  assert.match(text, /• First\n• Second/);
  assert.match(text, /1\. Step\n2\. Next/);
  assert.match(text, /Transition: onward$/);
});

test("talkingPointsToPlainText: nested lists indent without extra blank lines", () => {
  const text = talkingPointsToPlainText(`<p>A</p><ul><li><p>x</p><ul><li><p>y</p></li></ul></li><li><p>z</p></li></ul><p>B</p>`);
  assert.equal(text, "A\n\n• x\n  • y\n• z\n\nB");
});

test("validateTalkingPointsEntry: builds the agreed structure with bolded cues", () => {
  const v = validateTalkingPointsEntry({
    opening: "Let's look at growth.",
    cues: ["Revenue up **14%** year over year", "", "EMEA <drove> most of it"],
    transition: "Which brings us to costs.",
    seconds: 75,
  });
  assert.equal(v.seconds, 75);
  assert.equal(
    v.html,
    `<p>Let's look at growth.</p><ul><li><p>Revenue up <strong>14%</strong> year over year</p></li>` +
    `<li><p>EMEA &lt;drove&gt; most of it</p></li></ul><p><em>Transition:</em> Which brings us to costs.</p>`
  );
});

test("validateTalkingPointsEntry: last slide drops the transition; junk returns null; seconds clamped/estimated", () => {
  const last = validateTalkingPointsEntry({ opening: "Thanks.", cues: ["Questions"], transition: "Next up", seconds: 9999 }, { isLast: true });
  assert.ok(!last.html.includes("Transition"));
  assert.equal(last.seconds, 600);
  assert.equal(validateTalkingPointsEntry({ opening: "", cues: [] }), null);
  assert.equal(validateTalkingPointsEntry("nope"), null);
  const est = validateTalkingPointsEntry({ opening: "Hello there everyone.", cues: ["One", "Two"] });
  assert.ok(est.seconds >= 10);
});

test("prompts: never leak the freeform/layout layer, include document text", () => {
  const outline = { title: "Deck", slides: [baseSlide, { ...baseSlide, id: "b2", title: "Costs" }] };
  const deck = buildDeckTalkingPointsPrompt({ outline, documentText: "DOCTEXT" });
  assert.ok(deck.user.includes("DOCTEXT"));
  assert.ok(!deck.user.includes("layoutOverrides"));
  const one = buildSlideTalkingPointsPrompt({ outline, slideIndex: 1, documentText: "DOCTEXT" });
  assert.ok(one.user.includes("FINAL slide"));
  assert.ok(one.user.includes("Previous slide"));
});

test("buildTalkingPointsPdfHtml: escapes titles, sanitizes points, flags out-of-date slides", () => {
  const s1 = { ...baseSlide, title: "<Growth>" };
  const s2 = { ...baseSlide, id: "b2", title: "Costs" };
  const html = buildTalkingPointsPdfHtml({
    outline: { title: "Q3 & beyond", slides: [s1, s2] },
    points: {
      a1: { html: `<p>Hi<script>x</script></p>`, seconds: 90, contentHash: slideContentHash(s1) },
      b2: { html: `<p>Old</p>`, seconds: 30, contentHash: "stale" },
    },
  });
  assert.ok(html.includes("&lt;Growth&gt;"));
  assert.ok(html.includes("Q3 &amp; beyond"));
  assert.ok(!html.includes("<script>x"));
  assert.equal((html.match(/Slide changed since/g) || []).length, 1);
  assert.ok(html.includes("about 2m speaking time"));
});

test("formatDuration", () => {
  assert.equal(formatDuration(45), "45s");
  assert.equal(formatDuration(60), "1m");
  assert.equal(formatDuration(95), "1m 35s");
});

test("slideBudgetsMs: missing timings borrow the average; none at all → null", () => {
  const slides = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(slideBudgetsMs(slides, { a: { seconds: 60 }, b: { seconds: 30 } }), [60000, 30000, 45000]);
  assert.equal(slideBudgetsMs(slides, { a: { html: "x" } }), null);
});

test("computePace: on pace / behind / ahead", () => {
  const budgets = [60000, 60000, 60000];
  // 30s into slide 0 — on pace, half the slide budget used.
  let p = computePace({ budgets, index: 0, elapsedMs: 30000, currentSlideMs: 30000 });
  assert.equal(p.status, "on-pace");
  assert.equal(p.slideProgress, 0.5);
  assert.equal(p.totalBudgetMs, 180000);
  // Spent 100s on slide 0, now on slide 1 for 10s → 40s behind.
  p = computePace({ budgets, index: 1, elapsedMs: 110000, currentSlideMs: 10000 });
  assert.equal(p.status, "behind");
  assert.equal(p.deltaMs, 40000);
  // Raced through slides 0–1 in 60s total → 60s ahead.
  p = computePace({ budgets, index: 2, elapsedMs: 65000, currentSlideMs: 5000 });
  assert.equal(p.status, "ahead");
  // Overrunning the current slide counts against you.
  p = computePace({ budgets, index: 0, elapsedMs: 90000, currentSlideMs: 90000 });
  assert.equal(p.deltaMs, 30000);
  assert.equal(computePace({ budgets: null, index: 0, elapsedMs: 0, currentSlideMs: 0 }), null);
});
