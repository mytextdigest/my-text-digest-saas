'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { deckTheme } from '../deckTheme';
import slidesApi from '@/lib/slidesApi';

// Live presentation session for a presenter/audience window
// (presentationSession.js owns the state; this mirrors it) plus the deck
// being presented, refetched when it's edited mid-talk.
export function usePresentation(deckId) {
  const [state, setState] = useState(null);
  const [deck, setDeck] = useState(null);

  useEffect(() => {
    if (!deckId) return undefined;
    let cancelled = false;
    const loadDeck = () => slidesApi.getSlideDeck(deckId).then((res) => {
      if (!cancelled && res?.success) setDeck(res.deck);
    });
    loadDeck();
    slidesApi.presentationGetState().then((s) => { if (!cancelled && s) setState(s); });
    const offState = slidesApi.onPresentationState((s) => { if (s) setState(s); });
    const offDeck = slidesApi.onPresentationDeckChanged(() => loadDeck());
    return () => { cancelled = true; offState?.(); offDeck?.(); };
  }, [deckId]);

  const outline = deck?.outline || null;
  const theme = useMemo(() => deckTheme(outline), [outline]);
  return { state, deck, outline, theme };
}

// Re-renders every `intervalMs` — for the clock and the timers, which tick
// locally from the last state broadcast rather than one IPC per second.
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Elapsed talk time and time on the current slide, extrapolated from the
// state's reference timestamp while the timer runs.
export function liveTimes(state, now) {
  if (!state) return { elapsedMs: 0, currentSlideMs: 0 };
  const drift = state.timer.running ? Math.max(0, now - state.timer.at) : 0;
  return { elapsedMs: state.timer.elapsedMs + drift, currentSlideMs: state.currentSlideMs + drift };
}

export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Width/height of an element, kept current with a ResizeObserver.
export function useElementSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}
