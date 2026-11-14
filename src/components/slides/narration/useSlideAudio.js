'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { textHash, talkingPointsHash, talkingPointsToPlainText } from '@/lib/slides/talkingPoints.js';
import {
  narrationStatus, normalizeNarrationSettings, checkScriptNumbers, slideNumberSources,
} from '@/lib/slides/narration.js';
import slidesApi from '@/lib/slidesApi';

// State + IPC for a deck's narration (SLIDE_AUDIO_ROADMAP.md), shared by the
// editor's Narration section and presenter view. `audio` is the slideId →
// {source, url, durationMs, script, scriptOrigin, notesHash, voice,
// audioScriptHash} map from src/lib/slides/narrationServer.js; `points` the talking
// points map (for the out-of-date checks).
//
// `epoch` bumps when scripts are replaced from outside the script box
// (generation, another window), so callers remount it with fresh text.
export function useSlideAudio(deckId, slides, points) {
  const [audio, setAudio] = useState({});
  const [settings, setSettings] = useState(() => normalizeNarrationSettings(null));
  const [loaded, setLoaded] = useState(false);
  // null | {kind: 'all' | 'audio' | 'script' | 'upload', slideId?, phase?, done?, total?}
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [epoch, setEpoch] = useState(0);

  const reload = useCallback(() => {
    if (!deckId) return Promise.resolve();
    return slidesApi.getSlideAudio(deckId).then((res) => {
      if (!res?.success) return;
      setAudio(res.audio || {});
      setSettings(normalizeNarrationSettings(res.settings));
      setLoaded(true);
    });
  }, [deckId]);

  // Reload when the deck's slides change (duplicate copies a clip, undoing a
  // delete brings one back), and when another window changed something.
  const slideIdsKey = (slides || []).map((s) => s.id).join('|');
  useEffect(() => { reload(); }, [reload, slideIdsKey]);
  useEffect(() => {
    if (!deckId) return undefined;
    return slidesApi.onSlideAudioChanged?.((data) => {
      if (String(data?.deckId) !== String(deckId)) return;
      reload().then(() => setEpoch((e) => e + 1));
    });
  }, [deckId, reload]);
  useEffect(() => {
    if (!deckId) return undefined;
    return slidesApi.onSlideAudioProgress?.((p) => {
      if (String(p?.deckId) !== String(deckId)) return;
      setBusy((b) => (b ? { ...b, phase: p.phase, done: p.done, total: p.total } : b));
    });
  }, [deckId]);

  const apply = (res, fallbackError) => {
    if (res?.audio) setAudio(res.audio);
    if (!res?.success && !res?.cancelled) setError(res?.error || fallbackError);
    return res;
  };

  const upload = useCallback(async (slideId, file, { source = 'uploaded', durationMs } = {}) => {
    setError(null);
    setBusy({ kind: 'upload', slideId });
    try {
      const measured = durationMs ?? await measureFileDuration(file);
      const buffer = await file.arrayBuffer();
      const res = await slidesApi.saveSlideAudio({ deckId, slideId, filename: file.name, buffer, durationMs: measured, source });
      return apply(res, 'Could not save the audio.');
    } finally {
      setBusy(null);
    }
  }, [deckId]);

  const remove = useCallback(async (slideId) => {
    setError(null);
    return apply(await slidesApi.deleteSlideAudio({ deckId, slideId }), 'Could not remove the audio.');
  }, [deckId]);

  const saveScript = useCallback(async (slideId, script) => {
    return apply(await slidesApi.saveNarrationScript({ deckId, slideId, script }), 'Could not save the script.');
  }, [deckId]);

  // "The numbers are correct" — accept this script's figures as they are.
  const confirmNumbers = useCallback(async (slideId) => {
    return apply(await slidesApi.saveNarrationScript({ deckId, slideId, confirmNumbers: true }), 'Could not save that.');
  }, [deckId]);

  const markCurrent = useCallback(async (slideId) => {
    return apply(await slidesApi.saveNarrationScript({ deckId, slideId, markCurrent: true }), 'Could not update the narration.');
  }, [deckId]);

  const writeScript = useCallback(async (slideId) => {
    setError(null);
    setBusy({ kind: 'script', slideId });
    const res = await slidesApi.generateNarrationScript({ deckId, slideId });
    setBusy(null);
    setEpoch((e) => e + 1);
    return apply(res, "Couldn't write the script.");
  }, [deckId]);

  // slideId → that slide; undefined → every slide without (current) AI audio.
  const generate = useCallback(async (slideId, { rewriteScript, redoAll } = {}) => {
    setError(null);
    setNotice(null);
    setBusy({ kind: slideId ? 'audio' : 'all', slideId });
    const res = await slidesApi.generateNarrationAudio({ deckId, slideId, rewriteScript, redoAll });
    setBusy(null);
    setEpoch((e) => e + 1);
    if (res?.success && res.skipped) setNotice('Every slide already has narration.');
    else if (res?.success && (res.failed > 0 || res.blocked > 0)) {
      const parts = [];
      if (res.blocked > 0) parts.push(`${res.blocked} slide${res.blocked === 1 ? '' : 's'} weren't voiced because their script has numbers that don't match the slide (marked in red). Open ${res.blocked === 1 ? 'it' : 'them'} to check.`);
      if (res.failed > 0) parts.push(`${res.failed} slide${res.failed === 1 ? '' : 's'} didn't get narration. Try again.`);
      setNotice(parts.join(' '));
    }
    return apply(res, "Couldn't create the narration.");
  }, [deckId]);

  const cancel = useCallback(() => slidesApi.cancelNarration(deckId), [deckId]);

  const updateSettings = useCallback(async (patch) => {
    setSettings((s) => normalizeNarrationSettings({ ...s, ...patch }));
    const res = await slidesApi.saveNarrationSettings({ deckId, ...patch });
    if (res?.success) setSettings(res.settings);
  }, [deckId]);

  // Per-slide status, aligned with `slides`. `numbers` is the deterministic
  // number check of the script (null when there's no script);
  // `numbersBlocked` means the AI voice will refuse it. An AI clip voiced from
  // a script that fails the check shows as audio 'check'.
  const statusBySlide = useMemo(() => (slides || []).map((s) => {
    const entry = audio[s.id];
    if (!entry) return { hasScript: false, scriptStale: false, audio: null, numbers: null, numbersBlocked: false };
    const scriptHash = textHash(entry.script || '');
    const base = narrationStatus(entry, { notesHash: talkingPointsHash(points?.[s.id]?.html || ''), scriptHash });
    let numbers = null;
    let numbersBlocked = false;
    if (entry.script?.trim()) {
      const notesText = points?.[s.id]?.html ? talkingPointsToPlainText(points[s.id].html) : '';
      numbers = checkScriptNumbers(entry.script, slideNumberSources(s, notesText), notesText);
      numbersBlocked = !numbers.ok && entry.numbersOkHash !== scriptHash;
    }
    // 'check' only when the clip was voiced from THIS script (so it says the
    // bad figure); a clip from an earlier version is just out of date.
    const spokeThisScript = !entry.audioScriptHash || entry.audioScriptHash === scriptHash;
    const audioStatus = base.audio && entry.source === 'generated' && numbersBlocked && spokeThisScript ? 'check' : base.audio;
    return { ...base, audio: audioStatus, numbers, numbersBlocked };
  }), [slides, audio, points]);

  const summary = useMemo(() => {
    const list = slides || [];
    const withAudio = list.filter((s) => audio[s.id]?.url);
    return {
      covered: withAudio.length,
      total: list.length,
      durationMs: withAudio.reduce((sum, s) => sum + (audio[s.id].durationMs || 0), 0),
      stale: statusBySlide.filter((st) => st.audio === 'stale').length,
      numberIssues: statusBySlide.filter((st) => st.numbersBlocked).length,
      needed: list.filter((s, i) => !audio[s.id]?.url || statusBySlide[i]?.audio === 'stale' || statusBySlide[i]?.audio === 'check').length,
      // Slides a whole-deck AI run can (re)voice: everything but the user's
      // own uploads and recordings.
      aiEligible: list.filter((s) => !audio[s.id]?.url || audio[s.id].source === 'generated').length,
      own: list.filter((s) => audio[s.id]?.url && audio[s.id].source !== 'generated').length,
    };
  }, [slides, audio, statusBySlide]);

  return {
    audio, settings, loaded, busy, error, setError, notice, setNotice, epoch,
    upload, remove, saveScript, markCurrent, confirmNumbers, writeScript, generate, cancel, updateSettings,
    statusBySlide, summary,
  };
}

// Length of an audio File/Blob in ms via a throwaway <audio>; null if the
// browser can't tell (the main process measures MP3/WAV itself).
export function measureFileDuration(file) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const el = new Audio();
    const done = (ms) => { URL.revokeObjectURL(objectUrl); resolve(ms); };
    const timer = setTimeout(() => done(null), 8000);
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      clearTimeout(timer);
      done(Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 1000) : null);
    };
    el.onerror = () => { clearTimeout(timer); done(null); };
    el.src = objectUrl;
  });
}
