// Slide narration (SLIDE_AUDIO_ROADMAP.md): pure-function layer — settings,
// out-of-date status, playback timing, audio duration parsing, script
// cleanup and the prompt/response handling. No API calls, no Electron.
//
// Run: node --test src/lib/slides/__tests__/narration.test.js
// (or `npm run test:slides` from the repo root)

import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeNarrationSettings, narrationStatus, holdMsForSlide, narrationTimelineMs,
  mp3DurationMs, wavDurationMs, cleanScript, targetWords, buildScriptPrompt,
  generateNarrationScripts, synthesizeSpeech, DEFAULT_VOICE, DEFAULT_TONE, DEFAULT_GAP_MS, FALLBACK_HOLD_MS,
} from "../narration.js";
import { textHash, talkingPointsHash, slideBudgetsMs } from "../talkingPoints.js";

test("settings are normalized to known voices/tones and a bounded gap", () => {
  assert.deepEqual(normalizeNarrationSettings(null), { voice: DEFAULT_VOICE, tone: DEFAULT_TONE, gapMs: DEFAULT_GAP_MS });
  assert.deepEqual(normalizeNarrationSettings({ voice: "onyx", tone: "calm", gapMs: 1200 }), { voice: "onyx", tone: "calm", gapMs: 1200 });
  const bad = normalizeNarrationSettings({ voice: "robot", tone: "angry", gapMs: 99999 });
  assert.equal(bad.voice, DEFAULT_VOICE);
  assert.equal(bad.tone, DEFAULT_TONE);
  assert.equal(bad.gapMs, 5000);
  assert.equal(normalizeNarrationSettings({ gapMs: -5 }).gapMs, 0);
});

test("talkingPointsHash ignores formatting but not wording", () => {
  assert.equal(talkingPointsHash("<p><strong>Revenue</strong> grew</p>"), talkingPointsHash("<p>Revenue grew</p>"));
  assert.notEqual(talkingPointsHash("<p>Revenue grew</p>"), talkingPointsHash("<p>Revenue fell</p>"));
  assert.equal(talkingPointsHash(""), talkingPointsHash(null));
});

test("narrationStatus: AI clips go stale when notes or script change; own clips never do", () => {
  const notes = talkingPointsHash("<p>Revenue grew 12%</p>");
  const script = "Revenue grew twelve percent.";
  const ai = { url: "file:///a.mp3", source: "generated", script, notesHash: notes, audioScriptHash: textHash(script) };

  assert.deepEqual(narrationStatus(ai, { notesHash: notes, scriptHash: textHash(script) }), { hasScript: true, scriptStale: false, audio: "ok" });
  // Notes edited after the script was written.
  const notesChanged = narrationStatus(ai, { notesHash: talkingPointsHash("<p>Revenue grew 15%</p>"), scriptHash: textHash(script) });
  assert.equal(notesChanged.scriptStale, true);
  assert.equal(notesChanged.audio, "stale");
  // Script edited after the audio was made.
  const scriptChanged = narrationStatus({ ...ai, script: "New words." }, { notesHash: notes, scriptHash: textHash("New words.") });
  assert.equal(scriptChanged.scriptStale, false);
  assert.equal(scriptChanged.audio, "stale");
  // Uploaded / recorded clips are the user's own.
  for (const source of ["uploaded", "recorded"]) {
    const own = narrationStatus({ ...ai, source }, { notesHash: "different", scriptHash: "different" });
    assert.equal(own.audio, "ok");
  }
  // Script only, no clip.
  assert.equal(narrationStatus({ script, notesHash: notes }, { notesHash: notes, scriptHash: textHash(script) }).audio, null);
});

test("slideBudgetsMs uses a clip's real length over the suggested seconds", () => {
  const slides = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const points = { a: { seconds: 60 }, b: { seconds: 30 } };
  assert.deepEqual(slideBudgetsMs(slides, points), [60000, 30000, 45000]);
  assert.deepEqual(slideBudgetsMs(slides, points, { b: { durationMs: 42500 } }), [60000, 42500, 51250]);
  // Audio alone is enough for timings.
  assert.deepEqual(slideBudgetsMs(slides, {}, { c: { durationMs: 20000 } }), [20000, 20000, 20000]);
  assert.equal(slideBudgetsMs(slides, {}), null);
});

test("slides without audio hold for their target time, else the 15s fallback", () => {
  assert.equal(holdMsForSlide([30000, 45000], 1), 45000);
  assert.equal(holdMsForSlide(null, 0), FALLBACK_HOLD_MS);
  assert.equal(FALLBACK_HOLD_MS, 15000);
  const slides = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const audio = { a: { url: "x", durationMs: 10000 } };
  assert.deepEqual(narrationTimelineMs({ slides, audio, budgets: null, gapMs: 500 }), [10500, 15000, 15000]);
  assert.deepEqual(narrationTimelineMs({ slides, audio, budgets: [10000, 30000, 20000], gapMs: 0 }), [10000, 30000, 20000]);
});

test("mp3DurationMs sums frame durations (and skips an ID3 tag)", () => {
  // MPEG-1 Layer III, 128 kbps, 44.1 kHz, no padding: 417-byte frames of 1152 samples.
  const header = [0xff, 0xfb, 0x90, 0x00];
  const frame = new Uint8Array(417);
  frame.set(header);
  const frames = 100;
  const id3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 20, ...new Array(20).fill(0)]);
  const bytes = new Uint8Array(id3.length + frame.length * frames);
  bytes.set(id3);
  for (let i = 0; i < frames; i++) bytes.set(frame, id3.length + i * frame.length);
  assert.equal(mp3DurationMs(bytes), Math.round((frames * 1152 * 1000) / 44100));
  assert.equal(mp3DurationMs(new Uint8Array([1, 2, 3, 4, 5])), null);
});

test("wavDurationMs reads byte rate and data size", () => {
  const sampleRate = 24000;
  const seconds = 2;
  const dataSize = sampleRate * 2 * seconds;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(dataSize, 40);
  assert.equal(wavDurationMs(new Uint8Array(buf)), 2000);
  assert.equal(wavDurationMs(new Uint8Array([0, 1, 2])), null);
});

test("cleanScript strips markdown and bullets", () => {
  assert.equal(cleanScript("**Revenue** grew.\n- First point\n• Second"), "Revenue grew.\nFirst point\nSecond");
  assert.equal(cleanScript(42), "");
});

test("targetWords follows ~145 words per minute, bounded", () => {
  assert.equal(targetWords(60), 144);
  assert.equal(targetWords(2), 15);
  assert.equal(targetWords(1000), 400);
  assert.equal(targetWords(null), null);
});

test("buildScriptPrompt carries notes, slide content and target length", () => {
  const { system, user } = buildScriptPrompt({
    deckTitle: "Q3 review",
    totalSlides: 5,
    items: [{ index: 2, content: { title: "Revenue" }, notesText: "Revenue grew 12%", seconds: 50 }],
  });
  assert.match(system, /JSON/);
  assert.match(user, /Q3 review/);
  assert.match(user, /"index":2/);
  assert.match(user, /Revenue grew 12%/);
  assert.match(user, /"targetWords":120/);
  assert.match(user, /last slide has index 4/);
});

function fakeOpenAI(content) {
  return { chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } } };
}

test("generateNarrationScripts maps entries back to slide indexes", async () => {
  const items = [{ index: 3, content: {}, notesText: "a" }, { index: 4, content: {}, notesText: "b" }];
  const res = await generateNarrationScripts({
    openai: fakeOpenAI(JSON.stringify({ slides: [{ index: 3, script: "Hello **there**." }, { index: 9, script: "ignored" }, { script: "Fourth by position" }] })),
    deckTitle: "T", items, totalSlides: 5,
  });
  assert.equal(res.get(3), "Hello there.");
  assert.equal(res.has(9), false);
  await assert.rejects(
    generateNarrationScripts({ openai: fakeOpenAI("not json"), deckTitle: "T", items, totalSlides: 5 }),
    /Couldn't write the narration script/
  );
});

test("synthesizeSpeech sends the script, voice and tone instructions", async () => {
  let sent;
  const openai = { audio: { speech: { create: async (params) => { sent = params; return { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; } } } };
  const bytes = await synthesizeSpeech({ openai, text: "  Hello.  ", voice: "cedar", tone: "calm" });
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.equal(sent.input, "Hello.");
  assert.equal(sent.voice, "cedar");
  assert.equal(sent.response_format, "mp3");
  assert.match(sent.instructions, /calm/i);
  await assert.rejects(synthesizeSpeech({ openai, text: "   " }), /empty/);
});

// --- Number check (figures must come from the slide or its notes) ---------
import { checkScriptNumbers, slideNumberSources, extractNumbers, describeNumberProblem, prepareForSpeech, SCRIPT_TEMPERATURE } from "../narration.js";

const SLIDE_7 = {
  id: "9f15a81f-c2ea-414e-802e-34f22ebb3778",
  type: "bullets",
  title: "Segment Performance",
  bullets: [
    "Industrial Automation",
    "Revenue: $301.4 million (+14.0% YoY)",
    "Logistics Robotics",
    "Revenue: $126.8 million (+29.0% YoY)",
    "Growth from new warehouse-automation contracts signed with three national retailers",
  ],
  elements: [{ id: "e1", kind: "text", x: 1.5, y: 2.25, text: "Source: FY2022 annual report" }],
};
const NOTES = "Here's how each of our segments performed in FY2022.\n• Industrial Automation: $301.4M, up 14%\n• Logistics Robotics: 29% growth";
const SOURCES = slideNumberSources(SLIDE_7, NOTES);

test("number check: the real slide 7 mistake (39% for 29%) is caught, in digits or words", () => {
  const digits = checkScriptNumbers("Logistics Robotics grew 39%, reaching $126.8 million.", SOURCES, NOTES);
  assert.equal(digits.ok, false);
  assert.deepEqual(digits.unknown, ["39%"]);
  assert.match(describeNumberProblem(digits), /39% isn't on this slide/);

  const words = checkScriptNumbers("Logistics Robotics saw a thirty-nine percent growth in revenue.", SOURCES, NOTES);
  assert.equal(words.ok, false);
  assert.ok(words.spelled.includes("thirty-nine"));
  assert.match(describeNumberProblem(words), /digits, not words/);
});

test("number check: correct figures pass, whatever the formatting", () => {
  const res = checkScriptNumbers(
    "In FY2022 Industrial Automation earned $301.4M, up 14%, and Logistics Robotics grew 29.0% to $126,800,000, with 3 national retailers.",
    SOURCES, NOTES
  );
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(res.numbers.every((n) => n.ok));
});

test("number check: ids, positions and colours are not sources; text boxes are", () => {
  // "34" appears only inside the slide id; 1.5 / 2.25 only as element positions.
  assert.deepEqual(checkScriptNumbers("We have 34 plants.", SOURCES).unknown, ["34"]);
  assert.deepEqual(checkScriptNumbers("Over 2.25 years.", SOURCES).unknown, ["2.25"]);
  assert.equal(checkScriptNumbers("As the FY2022 annual report shows.", SOURCES).ok, true);
});

test("number check: rounding is a mismatch; small number words and missing figures are reported but not blocking", () => {
  assert.deepEqual(checkScriptNumbers("Revenue was about $127 million.", SOURCES).unknown, ["$127 million"]);
  const res = checkScriptNumbers("Both of our two segments grew.", SOURCES, NOTES);
  assert.equal(res.ok, true);
  assert.ok(res.missing.includes("$301.4M"));
});

test("extractNumbers reads scale words and keeps the figure as written", () => {
  const nums = extractNumbers("$126.8 million, 54.1M and 1,240 units, up 29.0%");
  assert.deepEqual(nums.map((n) => n.raw), ["$126.8 million", "54.1M", "1,240", "29.0%"]);
  assert.equal(nums[0].scaled, 126.8e6);
  assert.equal(nums[2].value, 1240);
});

test("scripts keep digits: the prompt says so, temperature is low, speech prep leaves numbers alone", () => {
  const { system } = buildScriptPrompt({ deckTitle: "T", totalSlides: 1, items: [{ index: 0, content: {}, notesText: "" }] });
  assert.match(system, /in digits/);
  assert.doesNotMatch(system, /twelve percent/);
  assert.ok(SCRIPT_TEMPERATURE <= 0.2);
  assert.equal(prepareForSpeech("Revenue rose 29.0% YoY to $126.8 million."), "Revenue rose 29.0% year over year to $126.8 million.");
});

test("a retry prompt carries the correction for that slide", () => {
  const { system, user } = buildScriptPrompt({
    deckTitle: "T", totalSlides: 9,
    items: [{ index: 6, content: SLIDE_7, notesText: NOTES, correction: "39% isn't on this slide" }],
  });
  assert.match(system, /correction/);
  assert.match(user, /39% isn't on this slide/);
});
