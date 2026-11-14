// worker/ffmpeg.js
// The ffmpeg binary (ffmpeg-static, or FFMPEG_PATH) and small helpers around
// it — a port of desktop electron/ffmpeg.js. Used by video export and to
// tidy up in-app recordings.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let cachedPath;

export function ffmpegPath() {
  if (cachedPath !== undefined) return cachedPath;
  let p = process.env.FFMPEG_PATH || null;
  if (!p) {
    try { p = require("ffmpeg-static"); } catch (e) { p = null; }
  }
  if (p && !fs.existsSync(p)) p = null;
  cachedPath = p;
  return p;
}

// Runs ffmpeg with `args`. Resolves {code, stderr}; rejects only if it can't
// start. `signal` (AbortSignal) kills it. `onStderr` sees output as it comes
// (progress parsing).
export function runFfmpeg(args, { signal, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath();
    if (!bin) { reject(new Error("The video encoder (ffmpeg) is missing from this installation.")); return; }
    const child = spawn(bin, ["-hide_banner", "-nostdin", ...args], { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d) => {
      const text = d.toString();
      stderr = (stderr + text).slice(-20000);
      onStderr?.(text);
    });
    const onAbort = () => { try { child.kill("SIGKILL"); } catch (e) { /* already gone */ } };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (err) => { signal?.removeEventListener("abort", onAbort); reject(err); });
    child.on("close", (code) => { signal?.removeEventListener("abort", onAbort); resolve({ code, stderr }); });
  });
}

// Duration from ffmpeg's "Duration: 00:01:02.34" banner; null if unknown.
export async function probeDurationMs(file) {
  try {
    const { stderr } = await runFfmpeg(["-i", file]);
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
    if (!m) return null;
    const ms = Math.round(((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000);
    return ms > 0 ? ms : null;
  } catch (e) {
    return null;
  }
}

// MediaRecorder's WebM has no duration in its header, so players show a
// broken length and can't seek. A stream-copy remux writes one. Returns true
// when `file` was replaced.
export async function remuxInPlace(file) {
  const tmp = `${file}.remux${path.extname(file)}`;
  try {
    const { code } = await runFfmpeg(["-y", "-i", file, "-c", "copy", tmp]);
    if (code !== 0 || !fs.existsSync(tmp) || fs.statSync(tmp).size === 0) throw new Error("remux failed");
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    fs.rm(tmp, { force: true }, () => {});
    return false;
  }
}
