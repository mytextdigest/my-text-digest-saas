// src/lib/slidesApi.js
// Client shim with the same method names and return shapes as the desktop
// preload.js slide-deck, talking-points, presentation, narration and video
// methods (spec D2), so the slide components copied from the desktop differ
// from it by their import line only. Each method calls the matching route
// and resolves to `{ success, ... }` like the IPC handler did. Follows the
// precedent of src/lib/tablesApi.js.
//
// Differences the platform forces:
// - Long work (whole-deck talking points, narration, the talking-points
//   PDF, video) runs as a media-queue job; the method starts it, polls the
//   job every 1.5 s (reporting progress through the same on…Progress
//   callbacks desktop fed from IPC events) and resolves when it finishes —
//   so callers still just await one call.
// - Exports download through a signed URL instead of a native save dialog.
// - "Something changed in another window" events (talking points, narration)
//   travel between this site's windows on a BroadcastChannel; like desktop,
//   the window that made the change doesn't hear its own event.
// - Presentation calls go to presentationSession.js (BroadcastChannel
//   between the editor, presenter and audience windows — spec D4).

import * as presentation from '@/components/slides/present/presentationSession';

const JOB_POLL_INTERVAL_MS = 1500;
const JOB_POLL_MAX_ERRORS = 8;

const enc = encodeURIComponent;
const deckUrl = (deckId) => `/api/slide-decks/${enc(deckId)}`;

async function call(url, { method = 'GET', body } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && data.success === undefined) return { success: false, error: data.error || `Request failed (${res.status})` };
    return data;
  } catch (err) {
    return { success: false, error: err.message || 'Network error' };
  }
}

// Hands a same-origin download route (which redirects to a signed URL with
// an attachment disposition) or a signed URL to the browser.
function triggerDownload(url) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Polls a SlideDeckJob until it settles. `onProgress(job)` sees every poll
// while it runs. Resolves the final job, or {status: 'error', error}.
async function waitForJob(deckId, jobId, { onProgress } = {}) {
  let errors = 0;
  for (;;) {
    await sleep(JOB_POLL_INTERVAL_MS);
    const res = await call(`${deckUrl(deckId)}/jobs/${enc(jobId)}`);
    if (!res?.success || !res.job) {
      errors += 1;
      if (errors >= JOB_POLL_MAX_ERRORS) return { status: 'error', error: res?.error || 'Lost track of the job.' };
      continue;
    }
    errors = 0;
    const { job } = res;
    if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') return job;
    onProgress?.(job);
  }
}

// ---------------------------------------------------------------------------
// Cross-window change events (desktop: webContents.send to other windows)
// ---------------------------------------------------------------------------

let bus = null;
const busListeners = new Map(); // type → Set(cb)
function getBus() {
  if (bus || typeof BroadcastChannel === 'undefined') return bus;
  bus = new BroadcastChannel('mtd-slides');
  bus.onmessage = (e) => {
    const { type, payload } = e.data || {};
    busListeners.get(type)?.forEach((cb) => { try { cb(payload); } catch (err) { console.error(err); } });
  };
  return bus;
}
function emitChanged(type, deckId) {
  getBus()?.postMessage({ type, payload: { deckId: String(deckId) } });
}
function onBus(type, cb) {
  getBus();
  if (!busListeners.has(type)) busListeners.set(type, new Set());
  busListeners.get(type).add(cb);
  return () => busListeners.get(type).delete(cb);
}

// In-window progress events (desktop: slide-audio:progress, deck-video:progress).
const localListeners = { audioProgress: new Set(), videoProgress: new Set() };
function emitLocal(kind, payload) {
  localListeners[kind].forEach((cb) => { try { cb(payload); } catch (err) { console.error(err); } });
}
function onLocal(kind, cb) {
  localListeners[kind].add(cb);
  return () => localListeners[kind].delete(cb);
}

// ---------------------------------------------------------------------------
// Slide deck
// ---------------------------------------------------------------------------

// `deck.outline` mirrors desktop's parsed outline_json. A renderToken in the
// page URL (the worker's headless Chromium drawing /present/frame) is passed
// along so the route accepts the request without a session.
export async function getSlideDeck(deckId) {
  let url = deckUrl(deckId);
  if (typeof window !== 'undefined') {
    const token = new URLSearchParams(window.location.search).get('renderToken');
    if (token) url += `?renderToken=${enc(token)}`;
  }
  const res = await call(url);
  if (!res?.deck) return { success: false, error: res?.error || 'Slide deck not found' };
  return { success: true, deck: { ...res.deck, outline: res.deck.outlineJson || null } };
}

// "Download deck (.pptx)": rebuilt with the talking points as speaker notes.
export async function saveSlideDeck(deckId) {
  const res = await call(`${deckUrl(deckId)}/download?format=json`);
  if (!res?.success) return { success: false, error: res?.error || 'Could not save the deck.' };
  triggerDownload(res.url);
  return { success: true, filePath: res.filename };
}

// ---------------------------------------------------------------------------
// Talking points
// ---------------------------------------------------------------------------

export function getTalkingPoints(deckId) {
  return call(`${deckUrl(deckId)}/talking-points`);
}

export async function saveTalkingPoints({ deckId, slideId, html, markCurrent }) {
  const res = await call(`${deckUrl(deckId)}/talking-points/${enc(slideId)}`, { method: 'PUT', body: { html, markCurrent } });
  if (res?.success) emitChanged('talking-points:changed', deckId);
  return res;
}

// One slide runs in the route; the whole deck is a worker job.
export async function generateTalkingPoints({ deckId, slideId }) {
  const res = await call(`${deckUrl(deckId)}/talking-points/generate`, { method: 'POST', body: { slideId } });
  if (!res?.success || !res.jobId) {
    if (res?.success) emitChanged('talking-points:changed', deckId);
    return res;
  }
  const job = await waitForJob(deckId, res.jobId);
  if (job.status !== 'done') {
    return { success: false, error: job.status === 'cancelled' ? 'Cancelled.' : (job.error || "Couldn't generate talking points.") };
  }
  const fresh = await getTalkingPoints(deckId);
  if (!fresh?.success) return fresh;
  emitChanged('talking-points:changed', deckId);
  return { success: true, points: fresh.points, missing: job.result?.missing || 0 };
}

// Rendered by the worker's headless Chromium (desktop: printToPDF).
export async function exportTalkingPointsPdf({ deckId }) {
  const res = await call(`${deckUrl(deckId)}/talking-points/pdf`, { method: 'POST', body: {} });
  if (!res?.success) return res;
  const job = await waitForJob(deckId, res.jobId);
  if (job.status !== 'done') return { success: false, error: job.error || 'Could not create the PDF.' };
  triggerDownload(`${deckUrl(deckId)}/jobs/${enc(res.jobId)}/file`);
  return { success: true, filePath: job.result?.filename };
}

export const onTalkingPointsChanged = (cb) => onBus('talking-points:changed', cb);

// ---------------------------------------------------------------------------
// Presenter view (presentationSession.js)
// ---------------------------------------------------------------------------

// Synchronous inside the click (popup blockers) — wrapped in a promise for
// desktop's invoke() shape.
export function presentationStart(args) {
  return Promise.resolve(presentation.presentationStart(args));
}
export const presentationGetState = () => presentation.presentationGetState();
export const presentationGoto = (index) => presentation.presentationGoto(index);
export const presentationSetScreen = (value) => presentation.presentationSetScreen(value);
export const presentationTimer = (action) => presentation.presentationTimer(action);
export const presentationPointer = (point) => presentation.presentationPointer(point);
export const presentationSwapDisplays = () => presentation.presentationSwapDisplays();
export const presentationShowAudience = () => presentation.presentationShowAudience();
export const presentationEnd = () => presentation.presentationEnd();
export const presentationDeckChanged = (deckId) => presentation.presentationDeckChanged(deckId);
export const onPresentationState = (cb) => presentation.onPresentationState(cb);
export const onPresentationPointer = (cb) => presentation.onPresentationPointer(cb);
export const onPresentationDeckChanged = (cb) => presentation.onPresentationDeckChanged(cb);
export const onPresentationEnded = (cb) => presentation.onPresentationEnded(cb);

// ---------------------------------------------------------------------------
// Narration
// ---------------------------------------------------------------------------

const activeNarrationJob = new Map(); // deckId → jobId

export function getSlideAudio(deckId) {
  return call(`${deckUrl(deckId)}/audio`);
}

export async function saveNarrationSettings({ deckId, voice, tone, gapMs }) {
  const res = await call(`${deckUrl(deckId)}/audio/settings`, { method: 'PUT', body: { voice, tone, gapMs } });
  if (res?.success) emitChanged('slide-audio:changed', deckId);
  return res;
}

// Upload or in-app recording: straight to S3 with a presigned POST, then the
// route records it (measuring MP3/WAV itself; `durationMs` is the browser's
// measurement for the rest).
export async function saveSlideAudio({ deckId, slideId, filename, buffer, durationMs, source }) {
  const base = `${deckUrl(deckId)}/audio/${enc(slideId)}`;
  const presign = await call(`${base}/upload-url`, { method: 'POST', body: { filename, size: buffer?.byteLength || 0 } });
  if (!presign?.success) return presign;
  try {
    const form = new FormData();
    Object.entries(presign.fields).forEach(([k, v]) => form.append(k, v));
    form.append('file', new Blob([buffer], { type: presign.fields['Content-Type'] }));
    const up = await fetch(presign.url, { method: 'POST', body: form });
    if (!up.ok) return { success: false, error: 'Could not upload the audio.' };
  } catch (err) {
    return { success: false, error: 'Could not upload the audio.' };
  }
  const res = await call(base, { method: 'POST', body: { s3Key: presign.key, durationMs, source } });
  if (res?.success) emitChanged('slide-audio:changed', deckId);
  return res;
}

export async function deleteSlideAudio({ deckId, slideId }) {
  const res = await call(`${deckUrl(deckId)}/audio/${enc(slideId)}`, { method: 'DELETE' });
  if (res?.success) emitChanged('slide-audio:changed', deckId);
  return res;
}

export async function saveNarrationScript({ deckId, slideId, script, markCurrent, confirmNumbers }) {
  const res = await call(`${deckUrl(deckId)}/audio/${enc(slideId)}/script`, {
    method: 'PUT', body: { script, markCurrent, confirmNumbers },
  });
  if (res?.success) emitChanged('slide-audio:changed', deckId);
  return res;
}

export async function generateNarrationScript({ deckId, slideId }) {
  const res = await call(`${deckUrl(deckId)}/audio/${enc(slideId)}/script/generate`, { method: 'POST', body: {} });
  if (res?.success) emitChanged('slide-audio:changed', deckId);
  return res;
}

// One slide whose script already exists runs in the route; anything that
// needs scripts written, or the whole deck, is a worker job.
export async function generateNarrationAudio({ deckId, slideId, rewriteScript, redoAll }) {
  const res = await call(`${deckUrl(deckId)}/audio/generate`, { method: 'POST', body: { slideId, rewriteScript, redoAll } });
  if (!res?.jobId) {
    if (res?.success || res?.audio) emitChanged('slide-audio:changed', deckId);
    return res;
  }
  const key = String(deckId);
  activeNarrationJob.set(key, res.jobId);
  if (res.phase) emitLocal('audioProgress', { deckId: key, phase: res.phase, done: 0, total: res.total });
  try {
    const job = await waitForJob(deckId, res.jobId, {
      onProgress: (j) => { if (j.phase) emitLocal('audioProgress', { deckId: key, phase: j.phase, done: j.done, total: j.total }); },
    });
    const fresh = await getSlideAudio(deckId);
    const audio = fresh?.success ? fresh.audio : undefined;
    emitChanged('slide-audio:changed', deckId);
    if (job.status === 'cancelled') return { success: false, cancelled: true, audio };
    if (job.status !== 'done') return { success: false, error: job.error || "Couldn't create the narration.", audio };
    return { ...(job.result || { success: true }), audio };
  } finally {
    if (activeNarrationJob.get(key) === res.jobId) activeNarrationJob.delete(key);
  }
}

export function cancelNarration(deckId) {
  const jobId = activeNarrationJob.get(String(deckId)) || 'active';
  return call(`${deckUrl(deckId)}/jobs/${enc(jobId)}/cancel`, { method: 'POST', body: { kind: 'narration' } });
}

export function previewNarrationVoice({ voice, tone }) {
  return call('/api/slide-audio/preview', { method: 'POST', body: { voice, tone } });
}

// The browser shows its own microphone prompt on getUserMedia.
export function requestMicrophoneAccess() {
  return Promise.resolve({ granted: true });
}

export const onSlideAudioChanged = (cb) => onBus('slide-audio:changed', cb);
export const onSlideAudioProgress = (cb) => onLocal('audioProgress', cb);

// ---------------------------------------------------------------------------
// Video export
// ---------------------------------------------------------------------------

let runningVideo = null; // {deckId, jobId}

export async function exportDeckVideo({ deckId }) {
  const res = await call(`${deckUrl(deckId)}/video`, { method: 'POST', body: {} });
  if (!res?.success) return res;
  runningVideo = { deckId: String(deckId), jobId: res.jobId };
  try {
    const job = await waitForJob(deckId, res.jobId, {
      onProgress: (j) => { if (j.phase) emitLocal('videoProgress', { phase: j.phase, done: j.done, total: j.total }); },
    });
    if (job.status === 'cancelled') return { success: false, cancelled: true };
    if (job.status !== 'done') return { success: false, error: job.error || 'Could not create the video.' };
    triggerDownload(`${deckUrl(deckId)}/jobs/${enc(res.jobId)}/file`);
    return { success: true, filePath: job.result?.filename, durationMs: job.result?.durationMs };
  } finally {
    if (runningVideo?.jobId === res.jobId) runningVideo = null;
  }
}

export function cancelDeckVideo() {
  if (!runningVideo) return Promise.resolve({ success: true });
  const { deckId, jobId } = runningVideo;
  return call(`${deckUrl(deckId)}/jobs/${enc(jobId)}/cancel`, { method: 'POST', body: {} });
}

export const onDeckVideoProgress = (cb) => onLocal('videoProgress', cb);

// Grouped like desktop's window.api, for components that read it as one object.
const slidesApi = {
  getSlideDeck, saveSlideDeck,
  getTalkingPoints, saveTalkingPoints, generateTalkingPoints, exportTalkingPointsPdf, onTalkingPointsChanged,
  presentationStart, presentationGetState, presentationGoto, presentationSetScreen, presentationTimer,
  presentationPointer, presentationSwapDisplays, presentationShowAudience, presentationEnd, presentationDeckChanged,
  onPresentationState, onPresentationPointer, onPresentationDeckChanged, onPresentationEnded,
  getSlideAudio, saveNarrationSettings, saveSlideAudio, deleteSlideAudio, saveNarrationScript,
  generateNarrationScript, generateNarrationAudio, cancelNarration, previewNarrationVoice, requestMicrophoneAccess,
  onSlideAudioChanged, onSlideAudioProgress,
  exportDeckVideo, cancelDeckVideo, onDeckVideoProgress,
};

export default slidesApi;
