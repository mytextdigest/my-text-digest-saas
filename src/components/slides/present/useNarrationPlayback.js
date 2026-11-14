'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { holdMsForSlide } from '@/lib/slides/narration.js';
import slidesApi from '@/lib/slidesApi';

// Narrated playback for presenter view (SLIDE_AUDIO_ROADMAP.md Phase 2).
// Audio plays in THIS window only (never the audience window).
//
//   - A slide with a clip plays it; when it ends, wait `gapMs`, next slide.
//   - A slide without one stays up for its target time (`budgets`, the pace
//     guide's per-slide budget) or FALLBACK_HOLD_MS, then moves on.
//   - Any slide change while playing (Next/Prev/grid/clicker) plays that
//     slide's clip from the start.
//   - Pause stops audio and auto-advance; black/white screen pauses too.
//   - After the last slide: stays there, `finished`.
//
// The main process still owns the current slide: advancing just sends the
// usual presentation:goto, and the state broadcast that comes back is what
// starts the next clip — so both windows stay in sync.
export function useNarrationPlayback({ state, slides, audio, budgets, gapMs }) {
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const elRef = useRef(null);
  const timerRef = useRef(null);
  // What's loaded: {index, phase: 'clip' | 'gap' | 'hold', holdMs, remainingMs, startedAt}
  const stepRef = useRef(null);
  const latest = useRef({});
  latest.current = { state, slides, audio, budgets, gapMs, playing };

  const index = state?.index ?? 0;
  const slideCount = state?.slideCount ?? slides.length;

  useEffect(() => {
    const el = new Audio();
    el.preload = 'auto';
    elRef.current = el;
    return () => { el.pause(); el.removeAttribute('src'); clearTimeout(timerRef.current); };
  }, []);

  const clearTimer = () => { clearTimeout(timerRef.current); timerRef.current = null; };

  const advance = useCallback(() => {
    const { state: s } = latest.current;
    clearTimer();
    if (!s) return;
    if (s.index >= s.slideCount - 1) {
      stepRef.current = null;
      setPlaying(false);
      setFinished(true);
      return;
    }
    slidesApi.presentationGoto(s.index + 1);
  }, []);

  const wait = useCallback((ms, phase) => {
    clearTimer();
    stepRef.current = { ...stepRef.current, phase, holdMs: stepRef.current?.phase === phase ? stepRef.current.holdMs : ms, remainingMs: ms, startedAt: Date.now() };
    timerRef.current = setTimeout(advance, Math.max(0, ms));
  }, [advance]);

  // Starts slide `i` from the beginning.
  const beginSlide = useCallback((i) => {
    const { slides: list, audio: clips, budgets: b, gapMs: gap } = latest.current;
    const el = elRef.current;
    clearTimer();
    el.onended = null;
    el.pause();
    const clip = clips?.[list[i]?.id];
    if (clip?.url) {
      stepRef.current = { index: i, phase: 'clip', durationMs: clip.durationMs };
      el.onended = () => { if (latest.current.playing) wait(gap ?? 0, 'gap'); };
      if (el.src !== clip.url) el.src = clip.url;
      el.currentTime = 0;
      el.play().catch(() => {
        // Unplayable file: treat it like a slide without audio.
        if (latest.current.playing) wait(holdMsForSlide(b, i), 'hold');
      });
    } else {
      stepRef.current = { index: i, phase: null };
      wait(holdMsForSlide(b, i), 'hold');
    }
  }, [wait]);

  const start = useCallback(() => {
    const s = latest.current.state;
    if (!s) return;
    setFinished(false);
    setPlaying(true);
    latest.current.playing = true;
    const step = stepRef.current;
    if (step && step.index === s.index && step.phase) {
      // Resume where we paused.
      if (step.phase === 'clip') elRef.current.play().catch(() => beginSlide(s.index));
      else wait(step.remainingMs ?? 0, step.phase);
    } else {
      beginSlide(s.index);
    }
  }, [beginSlide, wait]);

  const pause = useCallback(() => {
    setPlaying(false);
    latest.current.playing = false;
    elRef.current?.pause();
    const step = stepRef.current;
    if (step && (step.phase === 'gap' || step.phase === 'hold') && timerRef.current) {
      step.remainingMs = Math.max(0, (step.remainingMs ?? 0) - (Date.now() - step.startedAt));
    }
    clearTimer();
  }, []);

  const restart = useCallback(() => {
    stepRef.current = null;
    setFinished(false);
    if (latest.current.state?.index === 0) {
      setPlaying(true);
      latest.current.playing = true;
      beginSlide(0);
    } else {
      setPlaying(true);
      latest.current.playing = true;
      slidesApi.presentationGoto(0); // the index change below starts slide 1
    }
  }, [beginSlide]);

  // Slide changed (auto-advance or the presenter navigating).
  useEffect(() => {
    if (!state) return;
    if (playing) {
      if (stepRef.current?.index !== index) beginSlide(index);
    } else if (stepRef.current && stepRef.current.index !== index) {
      // Paused and moved: the next Play starts this slide fresh.
      elRef.current?.pause();
      stepRef.current = null;
      if (finished && index < slideCount - 1) setFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Black/white screen pauses the narration.
  useEffect(() => {
    if (state?.screen && state.screen !== 'normal' && latest.current.playing) pause();
  }, [state?.screen, pause]);

  // Progress of the current step, for the UI (call on a ticking render).
  const progress = () => {
    const step = stepRef.current;
    if (!step || step.index !== index) return null;
    if (step.phase === 'clip') {
      const el = elRef.current;
      const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration * 1000 : step.durationMs || 0;
      return { kind: 'clip', positionMs: el.currentTime * 1000, durationMs: dur };
    }
    if (step.phase === 'hold' || step.phase === 'gap') {
      const total = step.phase === 'hold' ? step.holdMs : (latest.current.gapMs ?? 0);
      const remaining = playing ? Math.max(0, (step.remainingMs ?? 0) - (Date.now() - step.startedAt)) : (step.remainingMs ?? 0);
      return { kind: step.phase, positionMs: Math.max(0, total - remaining), durationMs: total, remainingMs: remaining };
    }
    return null;
  };

  return { playing, finished, start, pause, restart, progress };
}
