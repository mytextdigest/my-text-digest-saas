// worker/deckVideo.js
// Export a deck as an MP4 video (SLIDE_AUDIO_ROADMAP.md Phase 6) — a port of
// desktop electron/videoExport.js with Puppeteer's headless Chromium in place
// of the offscreen BrowserWindow (spec D7).
//
//   1. Draw each slide at 1920×1080 in headless Chromium (/present/frame,
//      authorised by a deck-scoped render token) and screenshot it as a PNG
//      (page.screenshot in place of desktop's double-paint capture).
//   2. Encode one segment per slide with ffmpeg: the still image for the
//      slide's length — its narration clip plus the gap, or its target time
//      when it has no clip — with the clip (or silence) as the soundtrack.
//   3. Join the segments (stream copy) into the final file.
//
// Every segment uses identical encoding settings, so the join needs no
// re-encode. The same Chromium renders the talking-points PDF (desktop:
// printToPDF).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { slideBudgetsMs } from "../src/lib/slides/talkingPoints.js";
import { narrationTimelineMs } from "../src/lib/slides/narration.js";
import { signRenderToken } from "../src/lib/slides/renderToken.js";
import { s3GetBytes, s3PutBytes, s3DeletePrefix, exportPrefix } from "../src/lib/slides/deckServer.js";
import { ffmpegPath, runFfmpeg } from "./ffmpeg.js";

const WIDTH = 1920;
const HEIGHT = 1080;
// Slides are still images: 15 fps looks identical to 30 and encodes in half
// the time. The PNG is read once a second and duplicated (decoding it for
// every frame is what's slow).
const FPS = 15;
// ffmpeg encoders running at once. 2 suits 2+ GB workers; set
// VIDEO_ENCODE_CONCURRENCY=1 on a 1 GB instance (t3.micro) to halve the
// encoder memory at the cost of a slower export.
const ENCODE_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.VIDEO_ENCODE_CONCURRENCY) || 2));
// How long one queue message keeps starting new segments before the export
// re-queues itself — well inside the 8-minute job watchdog, leaving room for
// the segment still encoding.
const STAGE_BUDGET_MS = Number(process.env.VIDEO_STAGE_BUDGET_MS) || 5 * 60 * 1000;
// x264 threads per encoder. Left to itself x264 sizes its threads (and their
// frame buffers) to the machine's cores: ~525 MB per encoder on an 8-core box.
// 2 threads + a short lookahead measured ~315 MB at the same speed.
const ENCODE_THREADS = Math.max(1, Math.min(8, Number(process.env.VIDEO_ENCODE_THREADS) || 2));
const FRAME_LOAD_TIMEOUT_MS = 30000;
const SLIDE_RENDER_TIMEOUT_MS = 20000;

function cancelledError() {
  const e = new Error("Cancelled.");
  e.cancelled = true;
  return e;
}

function withTimeout(promise, ms, message) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(t));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function appBaseUrl() {
  const base = process.env.APP_BASE_URL || process.env.NEXTAUTH_URL;
  if (!base) throw new Error("APP_BASE_URL (or NEXTAUTH_URL) is not set on the worker.");
  return base.replace(/\/+$/, "");
}

function frameUrl(deckId) {
  const params = new URLSearchParams({ deckId: String(deckId), renderToken: signRenderToken(deckId) });
  return `${appBaseUrl()}/present/frame?${params}`;
}

// One headless Chromium per job; always closed.
export async function withBrowser(fn) {
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    // Peak ~330 MB (PSS) drawing a deck from the production frame page.
    args: [
      "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--mute-audio", "--font-render-hinting=none",
      "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--disable-component-update",
    ],
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function waitForFrame(page, signal) {
  const started = Date.now();
  for (;;) {
    if (signal.aborted) throw cancelledError();
    const ready = await page.evaluate(() => window.__mtdFrameReady === true).catch(() => false);
    if (ready) return;
    if (Date.now() - started > FRAME_LOAD_TIMEOUT_MS) throw new Error("Couldn't draw the slides for the video.");
    await sleep(200);
  }
}

// The viewport as it is. A `clip` (or capturing beyond the viewport) makes
// Chromium re-size the page for the shot, which re-runs SlideStage's
// ResizeObserver — the capture could then land on a frame where the slide
// had no size yet, and come out black. As desktop re-captured until it had a
// fully painted frame, a completely black capture is taken once more after a
// short wait (a genuinely black slide is kept after that).
async function captureSlide(page) {
  const shoot = () => page.screenshot({ type: "png", captureBeyondViewport: false });
  let buf = await shoot();
  if (isAllBlack(buf)) {
    await sleep(500);
    buf = await shoot();
  }
  return Buffer.from(buf);
}

function isAllBlack(buf) {
  try {
    const { data } = PNG.sync.read(Buffer.from(buf));
    for (let p = 0; p < data.length; p += 4 * 97) {
      if (data[p] > 8 || data[p + 1] > 8 || data[p + 2] > 8) return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

// Draws every slide and saves slide-NNN.png into `dir`.
async function renderSlides({ browser, deckId, count, dir, signal, onProgress }) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    await page.goto(frameUrl(deckId), { waitUntil: "domcontentloaded", timeout: FRAME_LOAD_TIMEOUT_MS });
    await waitForFrame(page, signal);
    // Warm-up: draw the first slide once and discard it, so fonts and the
    // renderer are settled before the first real capture.
    await withTimeout(page.evaluate(() => window.__mtdShowSlide(0)), SLIDE_RENDER_TIMEOUT_MS, "Couldn't draw the slides for the video.");
    await sleep(200);
    const files = [];
    for (let i = 0; i < count; i++) {
      if (signal.aborted) throw cancelledError();
      await withTimeout(
        page.evaluate((n) => window.__mtdShowSlide(n), i),
        SLIDE_RENDER_TIMEOUT_MS,
        `Slide ${i + 1} took too long to draw.`
      );
      // Big images rasterize asynchronously: settle briefly before capture.
      await sleep(250);
      const file = path.join(dir, `slide-${String(i).padStart(3, "0")}.png`);
      fs.writeFileSync(file, await captureSlide(page));
      files.push(file);
      await onProgress(i + 1);
    }
    return files;
  } finally {
    await page.close().catch(() => {});
  }
}

async function encodeSegment({ image, audioFile, durationMs, out, signal }) {
  const seconds = (Math.max(500, durationMs) / 1000).toFixed(3);
  const args = ["-y", "-loop", "1", "-framerate", "1", "-i", image];
  if (audioFile) args.push("-i", audioFile);
  else args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  args.push(
    "-map", "0:v:0", "-map", "1:a:0",
    "-t", seconds,
    "-vf", `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p,fps=${FPS}`,
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-crf", "20",
    "-threads", String(ENCODE_THREADS), "-x264-params", "rc-lookahead=5",
    "-af", "apad",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    out
  );
  const { code, stderr } = await runFfmpeg(args, { signal });
  if (signal.aborted) throw cancelledError();
  if (code !== 0) {
    console.error("❌ ffmpeg segment failed:", stderr.slice(-2000));
    throw new Error("The video encoder failed on one of the slides.");
  }
}

// ---------------------------------------------------------------------------
// Staged export (fits small workers)
// ---------------------------------------------------------------------------
//
// Each queue message gets the worker's 8-minute watchdog, and a small
// instance (t3.micro) encodes slowly. So the export runs in stages that pass
// their work through S3 (slide-exports/<deckId>/work-<jobId>/):
//   1. render: draw every slide, upload the PNGs and a manifest (timeline,
//      clip keys, file name), then go straight on to encoding;
//   2. encode: encode segments one after another, uploading each; once the
//      stage has run STAGE_BUDGET_MS it stops taking new slides and the job
//      re-queues itself to continue from the next one;
//   3. the stage that encodes the last segment joins them all.
// One SlideDeckJob row covers every stage, so the client sees one export.

function workPrefix(deckId, jobId) {
  return `${exportPrefix(deckId)}work-${jobId}/`;
}

const pad3 = (i) => String(i).padStart(3, "0");

export function removeWorkFiles(deckId, jobId) {
  return s3DeletePrefix(workPrefix(deckId, jobId));
}

// Stage 1. → {dir} (the local temp dir, reused by the encode stage that
// follows in the same job). `audioRows`: slideId → SlideAudio row (s3Key).
export async function renderStage({ deckId, jobId, outline, points, audio, audioRows, settings, filenameBase, signal, onProgress }) {
  if (!outline.slides.length) throw new Error("This deck has no slides.");
  if (!ffmpegPath()) throw new Error("The video encoder (ffmpeg) is missing from this installation.");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtd-video-"));
  try {
    const slides = outline.slides;
    const budgets = slideBudgetsMs(slides, points, audio);
    const timeline = narrationTimelineMs({ slides, audio, budgets, gapMs: settings.gapMs });
    const manifest = {
      count: slides.length,
      timeline,
      clips: slides.map((s) => (audio[s.id]?.url ? audioRows[s.id]?.s3Key || null : null)),
      filenameBase,
    };

    await onProgress("render", 0, slides.length);
    const images = await withBrowser((browser) => renderSlides({
      browser, deckId, count: slides.length, dir, signal,
      onProgress: (done) => onProgress("render", done, slides.length),
    }));

    const prefix = workPrefix(deckId, jobId);
    for (let i = 0; i < images.length; i++) {
      if (signal.aborted) throw cancelledError();
      await s3PutBytes(`${prefix}slide-${pad3(i)}.png`, fs.readFileSync(images[i]), "image/png");
    }
    await s3PutBytes(`${prefix}manifest.json`, Buffer.from(JSON.stringify(manifest)), "application/json");
    return { dir };
  } catch (err) {
    removeTempDir(dir);
    throw err;
  }
}

// A work file, from the local temp dir or else S3 (a later stage, possibly on
// another worker).
async function localWorkFile(dir, prefix, name) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, await s3GetBytes(`${prefix}${name}`));
  return file;
}

// Stages 2–3. Encodes from slide `from`; `startedAt` is when this queue
// message's job began (the budget is per message).
// → {next} when it stopped early (re-queue from there), else
//   {file, durationMs, dir} with the joined video.
export async function encodeStage({ deckId, jobId, from = 0, dir, startedAt, signal, onProgress }) {
  dir ||= fs.mkdtempSync(path.join(os.tmpdir(), "mtd-video-"));
  try {
    const prefix = workPrefix(deckId, jobId);
    const manifest = JSON.parse((await s3GetBytes(`${prefix}manifest.json`)).toString("utf8"));
    const { count, timeline, clips } = manifest;

    const clipFiles = new Map(); // s3Key → local path (a clip can be shared after a duplicate)
    const clipFile = async (key) => {
      if (!key) return null;
      if (!clipFiles.has(key)) {
        const file = path.join(dir, `clip-${clipFiles.size}${path.extname(key)}`);
        fs.writeFileSync(file, await s3GetBytes(key));
        clipFiles.set(key, file);
      }
      return clipFiles.get(key);
    };

    await onProgress("encode", from, count);
    let encoded = from;
    let next = from;
    const overBudget = () => Date.now() - startedAt > STAGE_BUDGET_MS;
    const worker = async () => {
      // At least one slide per stage, so a slow slide can't stall the export.
      while (next < count && (next === from || !overBudget())) {
        const i = next++;
        if (signal.aborted) throw cancelledError();
        const out = path.join(dir, `seg-${pad3(i)}.mp4`);
        await encodeSegment({
          image: await localWorkFile(dir, prefix, `slide-${pad3(i)}.png`),
          audioFile: await clipFile(clips[i]),
          durationMs: timeline[i],
          out,
          signal,
        });
        await s3PutBytes(`${prefix}seg-${pad3(i)}.mp4`, fs.readFileSync(out), "video/mp4");
        encoded += 1;
        await onProgress("encode", encoded, count);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(ENCODE_CONCURRENCY, count - from)) }, worker));
    // Workers take slides in order and finish what they take, so slides
    // from..next-1 are all encoded.
    if (next < count) {
      removeTempDir(dir);
      return { next };
    }

    const segments = [];
    for (let i = 0; i < count; i++) segments.push(await localWorkFile(dir, prefix, `seg-${pad3(i)}.mp4`));
    const list = path.join(dir, "segments.txt");
    fs.writeFileSync(list, segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n"));
    const out = path.join(dir, "out.mp4");
    const { code, stderr } = await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out], { signal });
    if (signal.aborted) throw cancelledError();
    if (code !== 0) {
      console.error("❌ ffmpeg concat failed:", stderr.slice(-2000));
      throw new Error("The video encoder couldn't join the slides.");
    }
    return { file: out, durationMs: timeline.reduce((a, b) => a + b, 0), dir, filenameBase: manifest.filenameBase };
  } catch (err) {
    removeTempDir(dir);
    throw err;
  }
}

export function removeTempDir(dir) {
  if (!dir) return;
  if (process.env.MTD_KEEP_VIDEO_TMP) console.log("video export temp kept:", dir);
  else fs.rm(dir, { recursive: true, force: true }, () => {});
}

// The talking-points PDF: the standalone print document rendered by
// Chromium, so the rich text comes out exactly as the browser draws it
// (desktop: a hidden window's printToPDF, JavaScript off).
export async function renderPdf(html) {
  return withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setContent(html, { waitUntil: "load" });
    return page.pdf({ printBackground: true, preferCSSPageSize: true });
  });
}
