// Slide narration (SLIDE_AUDIO_ROADMAP.md): one audio clip per slide —
// AI voice from a narration script, uploaded, or recorded — and the rules for
// playing a deck's narration in presenter view.
//
// Kept free of require()s on purpose (like talkingPoints.js): the renderer
// imports the constants and status/playback helpers directly, so the editor,
// presenter view and main process can never disagree about them. The OpenAI
// client is passed in by the caller.

// ---------------------------------------------------------------------------
// Voice + playback settings
// ---------------------------------------------------------------------------

// OpenAI /v1/audio/speech. NOTE: deprecated by OpenAI, removal announced for
// 2027-01-06 with no drop-in replacement on this endpoint — synthesizeSpeech()
// below is the ONE place to change when switching providers/models.
const TTS_MODEL = "gpt-4o-mini-tts";
const TTS_MAX_SCRIPT_CHARS = 6000; // model limit is 2000 input tokens

const VOICES = [
  { id: "marin", label: "Marin", hint: "Clear, natural (recommended)" },
  { id: "cedar", label: "Cedar", hint: "Warm, natural (recommended)" },
  { id: "alloy", label: "Alloy", hint: "Neutral, balanced" },
  { id: "ash", label: "Ash", hint: "Confident" },
  { id: "ballad", label: "Ballad", hint: "Soft, expressive" },
  { id: "coral", label: "Coral", hint: "Bright, friendly" },
  { id: "echo", label: "Echo", hint: "Even, steady" },
  { id: "fable", label: "Fable", hint: "Storyteller" },
  { id: "nova", label: "Nova", hint: "Upbeat" },
  { id: "onyx", label: "Onyx", hint: "Deep, authoritative" },
  { id: "sage", label: "Sage", hint: "Calm, thoughtful" },
  { id: "shimmer", label: "Shimmer", hint: "Light, gentle" },
  { id: "verse", label: "Verse", hint: "Lively" },
];
const DEFAULT_VOICE = "marin";

const TONES = [
  { id: "natural", label: "Natural", instructions: "Speak like a confident presenter: clear, natural and conversational, at a comfortable pace." },
  { id: "calm", label: "Calm", instructions: "Speak calmly and steadily, with a relaxed pace and gentle emphasis." },
  { id: "energetic", label: "Energetic", instructions: "Speak with energy and enthusiasm, upbeat and engaging, at a lively pace." },
  { id: "formal", label: "Formal", instructions: "Speak in a formal, professional and measured tone, like a business briefing." },
  { id: "warm", label: "Warm", instructions: "Speak warmly and personably, as if talking to a friendly audience." },
];
const DEFAULT_TONE = "natural";

const DEFAULT_GAP_MS = 500;      // pause between a clip ending and the next slide
const MAX_GAP_MS = 5000;
const FALLBACK_HOLD_MS = 15000;  // slide without audio, deck without any timings

function isVoice(id) { return VOICES.some((v) => v.id === id); }
function isTone(id) { return TONES.some((t) => t.id === id); }

function normalizeNarrationSettings(raw) {
  const gap = Number(raw?.gapMs);
  return {
    voice: isVoice(raw?.voice) ? raw.voice : DEFAULT_VOICE,
    tone: isTone(raw?.tone) ? raw.tone : DEFAULT_TONE,
    gapMs: Number.isFinite(gap) ? Math.max(0, Math.min(MAX_GAP_MS, Math.round(gap))) : DEFAULT_GAP_MS,
  };
}

// ---------------------------------------------------------------------------
// Status (renderer + main)
// ---------------------------------------------------------------------------

// `entry`: one slide's row from get-slide-audio. Hashes are computed by the
// caller with talkingPoints.js (textHash / talkingPointsHash), so this file
// stays require-free.
//   scriptStale: the talking points changed after the script was written.
//   audio: null (no clip) | 'ok' | 'stale' — only AI clips go stale: when the
//   script they were made from changed, or the notes behind that script did.
//   Uploaded and recorded clips are the user's own and never flagged.
function narrationStatus(entry, { notesHash, scriptHash }) {
  const hasScript = !!(entry?.script && entry.script.trim());
  const scriptStale = hasScript && !!entry.notesHash && entry.notesHash !== notesHash;
  let audio = null;
  if (entry?.url) {
    audio = "ok";
    if (entry.source === "generated") {
      const scriptChanged = !!entry.audioScriptHash && entry.audioScriptHash !== scriptHash;
      if (scriptChanged || scriptStale) audio = "stale";
    }
  }
  return { hasScript, scriptStale, audio };
}

// How long narrated playback stays on a slide WITHOUT a clip: its target time
// (the pace guide's budget), or FALLBACK_HOLD_MS when the deck has no timings.
function holdMsForSlide(budgets, index) {
  const v = budgets?.[index];
  return Number.isFinite(v) && v > 0 ? v : FALLBACK_HOLD_MS;
}

// Length of each slide in a narrated run-through / exported video: the clip
// plus the gap, else the hold time.
function narrationTimelineMs({ slides, audio, budgets, gapMs = DEFAULT_GAP_MS }) {
  return slides.map((s, i) => {
    const clip = audio?.[s.id]?.durationMs;
    return Number.isFinite(clip) && clip > 0 ? Math.round(clip + gapMs) : holdMsForSlide(budgets, i);
  });
}

// ---------------------------------------------------------------------------
// Audio file helpers (main process)
// ---------------------------------------------------------------------------

const AUDIO_TYPES = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".webm": "audio/webm",
};
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

const MP3_BITRATES = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };

// Duration of an MP3 by walking its frame headers (CBR or VBR). Returns ms,
// or null when no frames were found.
function mp3DurationMs(bytes) {
  const b = bytes;
  let i = 0;
  if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) { // "ID3"
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    i = 10 + size + ((b[5] & 0x10) ? 10 : 0);
  }
  let seconds = 0;
  let frames = 0;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) { i += 1; continue; }
    const versionBits = (b[i + 1] >> 3) & 3;
    const layerBits = (b[i + 1] >> 1) & 3;
    const bitrateIdx = b[i + 2] >> 4;
    const rateIdx = (b[i + 2] >> 2) & 3;
    const padding = (b[i + 2] >> 1) & 1;
    if (versionBits === 1 || layerBits === 0 || bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) { i += 1; continue; }
    const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
    const layer = 4 - layerBits;
    const kbps = MP3_BITRATES[`${version === 1 ? 1 : 2}-${layer}`][bitrateIdx];
    const rate = MP3_RATES[version][rateIdx];
    const samples = layer === 1 ? 384 : layer === 2 ? 1152 : version === 1 ? 1152 : 576;
    const length = layer === 1
      ? (Math.floor((12 * kbps * 1000) / rate) + padding) * 4
      : Math.floor(((samples / 8) * kbps * 1000) / rate) + padding;
    if (length < 4) { i += 1; continue; }
    seconds += samples / rate;
    frames += 1;
    i += length;
  }
  return frames ? Math.round(seconds * 1000) : null;
}

// Duration of a RIFF/WAVE file from its fmt + data chunks.
function wavDurationMs(bytes) {
  const b = bytes;
  const str = (o, n) => String.fromCharCode(...b.slice(o, o + n));
  if (b.length < 12 || str(0, 4) !== "RIFF" || str(8, 4) !== "WAVE") return null;
  const u32 = (o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  let byteRate = 0;
  let o = 12;
  while (o + 8 <= b.length) {
    const id = str(o, 4);
    const size = u32(o + 4);
    if (id === "fmt ") byteRate = u32(o + 16);
    if (id === "data" && byteRate) return Math.round((Math.min(size, b.length - o - 8) / byteRate) * 1000);
    o += 8 + size + (size % 2);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Narration script (talking points → spoken prose)
// ---------------------------------------------------------------------------

const WORDS_PER_SECOND = 2.4; // ~145 words per minute, a comfortable talk
// Low randomness: scripts must copy figures, not get creative with them.
const SCRIPT_TEMPERATURE = 0.2;

function targetWords(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.max(15, Math.min(400, Math.round(seconds * WORDS_PER_SECOND)));
}

const SCRIPT_RULES =
  `Write what the presenter SAYS ALOUD for each slide, as natural spoken prose that will be read by a text-to-speech voice:\n` +
  `- Base it on the slide's talking points (opening line, cues, transition) when they are given; otherwise on the slide's own content.\n` +
  `- Turn bullet cues into flowing sentences. No bullet points, headings, markdown, emoji, URLs or stage directions.\n` +
  `- NUMBERS: copy every number, percentage, money amount, year and date EXACTLY as it is written in the slide or talking points, in digits (e.g. "29%", "$126.8 million", "FY2022", "Q3"). Never spell numbers out in words, never round them, never convert or calculate new ones, and never use a number that isn't given. The voice reads digits correctly.\n` +
  `- Other abbreviations may be written as spoken words (e.g. "YoY" → "year over year").\n` +
  `- Don't say "this slide shows" or "as you can see on the slide"; speak to the audience about the subject.\n` +
  `- Keep the talking points' transition (if any) as the last sentence, so the narration leads into the next slide. The final slide ends with a short closing line instead.\n` +
  `- Never invent facts, names or dates that are not in the talking points or the slide, and don't add your own opinions or explanations of why something happened.\n` +
  `- Match the target length in words when one is given (within about 15%).\n`;

function slidesForScriptPrompt(items) {
  return items.map((it) => ({
    index: it.index,
    slide: it.content,
    talkingPoints: it.notesText || undefined,
    targetWords: targetWords(it.seconds) || undefined,
    // A retry after the number check failed: what was wrong last time.
    correction: it.correction || undefined,
  }));
}

function buildScriptPrompt({ deckTitle, items, totalSlides }) {
  const system =
    `You are a speechwriter turning presenter notes into narration for a slide deck.\n\n` +
    SCRIPT_RULES + `\n` +
    `Respond in valid JSON only:\n{"slides": [{"index": number, "script": string}, ...]}\n` +
    `Include exactly one entry for each slide you are given, using its "index".\n` +
    `If a slide has a "correction", your previous script for it got numbers wrong: follow the correction exactly.`;
  const user =
    `Deck title: ${deckTitle || ""}\n` +
    `The deck has ${totalSlides} slides; the last slide has index ${totalSlides - 1}.\n\n` +
    `Slides to narrate:\n${JSON.stringify(slidesForScriptPrompt(items))}\n\n` +
    `Write the narration script for ${items.length === 1 ? "this slide" : `these ${items.length} slides`} now.`;
  return { system, user };
}

function cleanScript(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\*\*|__|[*#`>]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, TTS_MAX_SCRIPT_CHARS);
}

// `items`: [{index, content, notesText, seconds}] — one or many slides.
// Returns Map<index, script> (possibly partial) or throws a user-facing error.
async function generateNarrationScripts({ openai, deckTitle, items, totalSlides, signal, temperature = SCRIPT_TEMPERATURE }) {
  const { system, user } = buildScriptPrompt({ deckTitle, items, totalSlides });
  const wordsWanted = items.reduce((sum, it) => sum + (targetWords(it.seconds) || 120), 0);
  const completion = await openai.chat.completions.create(
    {
      model: "gpt-4o",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
      temperature,
      max_tokens: Math.min(16000, 400 + Math.round(wordsWanted * 2.2)),
    },
    { signal }
  );
  const content = completion.choices?.[0]?.message?.content;
  let parsed = null;
  try { parsed = JSON.parse(content || ""); } catch (e) { /* handled below */ }
  const wanted = new Set(items.map((it) => it.index));
  const results = new Map();
  (Array.isArray(parsed?.slides) ? parsed.slides : []).forEach((entry, pos) => {
    let idx = Number.isInteger(entry?.index) ? entry.index : items[pos]?.index;
    if (items.length === 1) idx = items[0].index;
    if (!wanted.has(idx) || results.has(idx)) return;
    const script = cleanScript(entry?.script);
    if (script) results.set(idx, script);
  });
  if (results.size === 0) {
    console.warn("generateNarrationScripts: no usable entries, raw model output:", content);
    throw new Error("Couldn't write the narration script. Please try again.");
  }
  return results;
}

// ---------------------------------------------------------------------------
// Number check (figures in a script must come from the slide or its notes)
// ---------------------------------------------------------------------------
//
// Deterministic — never trusts the model. Every number written in digits in
// the script must equal a number in the slide's text or talking points
// (29.0% = 29%, $126.8 million = $126.8M = 126,800,000). Numbers spelled out
// in words above ten ("thirty-nine percent") are flagged too: the script
// rules require digits, and words are how a wrong figure slips past a check.

const SCALE = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, trillion: 1e12 };
const NUMBER_RE = /(\d[\d,]*(?:\.\d+)?)(\s*(?:%|percent\b|k\b|mn\b|m\b|bn\b|b\b|t\b|thousand\b|million\b|billion\b|trillion\b))?/gi;

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const WORD_NUMBER_RE = new RegExp(
  `\\b(?:(?:${TENS.filter(Boolean).join("|")})(?:[- ](?:${UNITS.slice(1, 10).join("|")}))?|${UNITS.slice(11).join("|")}|hundred|thousand)\\b`
  + `|\\b(?:${UNITS.slice(0, 11).join("|")}|a)\\s+(?:hundred|thousand|million|billion|trillion|percent)\\b`,
  "gi"
);

// Numbers written in words in the SOURCE ("three national retailers",
// "twenty-nine"), so a script that writes them in digits still matches.
function wordNumbers(text) {
  const out = [];
  const re = new RegExp(`\\b(${TENS.filter(Boolean).join("|")})(?:[- ](${UNITS.slice(1, 10).join("|")}))?\\b|\\b(${UNITS.join("|")})\\b`, "gi");
  let m;
  while ((m = re.exec(String(text || "")))) {
    if (m[1]) out.push(TENS.indexOf(m[1].toLowerCase()) * 10 + (m[2] ? UNITS.indexOf(m[2].toLowerCase()) : 0));
    else out.push(UNITS.indexOf(m[3].toLowerCase()));
  }
  return out;
}

// [{raw, value, scaled}] for every digit-number in `text`.
function extractNumbers(text) {
  const out = [];
  let m;
  NUMBER_RE.lastIndex = 0;
  const src = String(text || "");
  while ((m = NUMBER_RE.exec(src))) {
    const value = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const unit = (m[2] || "").trim().toLowerCase();
    const scale = SCALE[unit] || 1;
    // "$126.8" right before the match makes the raw read naturally.
    const dollar = src[m.index - 1] === "$" ? "$" : "";
    out.push({ raw: `${dollar}${m[1]}${(m[2] || "").replace(/\s+/g, " ").trimEnd()}`, value, scaled: value * scale });
  }
  return out;
}

function sameNumber(a, b) {
  const eq = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
  return eq(a.value, b.value) || eq(a.scaled, b.scaled) || eq(a.value, b.scaled) || eq(a.scaled, b.value);
}

// What a slide's script may quote: the slide's own text (content fields and
// freeform text boxes — not ids, positions or colours) and its talking points.
const NON_TEXT_KEYS = new Set(["id", "elements", "backgroundColor", "layoutOverrides", "heroImage", "role", "icon", "speakerNotes", "talkingPoints"]);
function slideNumberSources(slide, notesText) {
  const parts = [];
  Object.keys(slide || {}).forEach((k) => { if (!NON_TEXT_KEYS.has(k)) parts.push(JSON.stringify(slide[k])); });
  (Array.isArray(slide?.elements) ? slide.elements : []).forEach((el) => { if (typeof el?.text === "string") parts.push(el.text); });
  if (notesText) parts.push(notesText);
  return parts.join("\n");
}

// → {ok, numbers: [{raw, ok}], unknown: [raw], spelled: [raw], missing: [raw]}
//   unknown: digit-numbers not in the sources (blocks the AI voice)
//   spelled: numbers written as words (blocks — they can't be checked)
//   missing: numbers in the talking points the script never mentions (a hint)
function checkScriptNumbers(script, sourcesText, notesText = "") {
  const sources = extractNumbers(sourcesText).concat(wordNumbers(sourcesText).map((v) => ({ value: v, scaled: v })));
  const found = extractNumbers(script);
  const numbers = found.map((n) => ({ raw: n.raw, ok: sources.some((s) => sameNumber(n, s)) }));
  const uniq = (list) => [...new Set(list)];
  const unknown = uniq(numbers.filter((n) => !n.ok).map((n) => n.raw));
  const spelled = uniq((String(script || "").match(WORD_NUMBER_RE) || []).map((w) => w.trim()));
  const missing = uniq(extractNumbers(notesText).filter((n) => !found.some((f) => sameNumber(f, n))).map((n) => n.raw));
  return { ok: unknown.length === 0 && spelled.length === 0, numbers, unknown, spelled, missing };
}

// One line for the user / the retry prompt.
function describeNumberProblem(check) {
  const bits = [];
  if (check.unknown.length) bits.push(`${check.unknown.join(", ")} ${check.unknown.length === 1 ? "isn't" : "aren't"} on this slide or in its talking points`);
  if (check.spelled.length) {
    const shown = check.spelled.slice(0, 3).map((w) => `"${w}"`).join(", ");
    const more = check.spelled.length > 3 ? ` and ${check.spelled.length - 3} more` : "";
    bits.push(`numbers must be written in digits, not words (${shown}${more})`);
  }
  return bits.join("; ");
}

// Last step before the voice: abbreviations a voice may stumble on. Numbers
// are left exactly as checked.
function prepareForSpeech(script) {
  return String(script || "")
    .replace(/\bYoY\b/g, "year over year")
    .replace(/\bQoQ\b/g, "quarter over quarter")
    .replace(/\bMoM\b/g, "month over month");
}

// ---------------------------------------------------------------------------
// Text-to-speech
// ---------------------------------------------------------------------------

// The single provider call: script → MP3 bytes. Swap this (and TTS_MODEL /
// VOICES) to change providers.
async function synthesizeSpeech({ openai, text, voice, tone, signal }) {
  const input = prepareForSpeech(text).trim().slice(0, TTS_MAX_SCRIPT_CHARS);
  if (!input) throw new Error("The script is empty.");
  const toneDef = TONES.find((t) => t.id === tone) || TONES[0];
  const response = await openai.audio.speech.create(
    {
      model: TTS_MODEL,
      voice: isVoice(voice) ? voice : DEFAULT_VOICE,
      input,
      instructions: toneDef.instructions,
      response_format: "mp3",
    },
    { signal }
  );
  return new Uint8Array(await response.arrayBuffer());
}

const VOICE_PREVIEW_TEXT =
  "Hi there. This is how your slides will sound when I narrate them. Let's get started.";

export {
  TTS_MODEL,
  TTS_MAX_SCRIPT_CHARS,
  VOICES,
  DEFAULT_VOICE,
  TONES,
  DEFAULT_TONE,
  DEFAULT_GAP_MS,
  MAX_GAP_MS,
  FALLBACK_HOLD_MS,
  AUDIO_TYPES,
  MAX_AUDIO_BYTES,
  VOICE_PREVIEW_TEXT,
  normalizeNarrationSettings,
  narrationStatus,
  holdMsForSlide,
  narrationTimelineMs,
  mp3DurationMs,
  wavDurationMs,
  targetWords,
  buildScriptPrompt,
  cleanScript,
  generateNarrationScripts,
  synthesizeSpeech,
  SCRIPT_TEMPERATURE,
  extractNumbers,
  slideNumberSources,
  checkScriptNumbers,
  describeNumberProblem,
  prepareForSpeech,
};
