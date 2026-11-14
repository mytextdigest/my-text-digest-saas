'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { deckTheme } from '../deckTheme';
import SlideStage from './SlideStage';
import slidesApi from '@/lib/slidesApi';

// Charts (recharts) animate in; give them time to settle before capture.
const CHART_SETTLE_MS = 1800;

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function hasChart(slide) {
  return !!slide?.chart || (Array.isArray(slide?.elements) && slide.elements.some((e) => e?.kind === 'chart'));
}

// One slide, full window, for worker/deckVideo.js (SLIDE_AUDIO_ROADMAP.md
// Phase 6). The main process calls window.__mtdShowSlide(i), which resolves
// once slide i is fully drawn (fonts, images, chart animations), then
// captures the window.
export default function FrameView({ deckId }) {
  const [deck, setDeck] = useState(null);
  // {index, n}: n bumps on every request, so asking for the slide that's
  // already showing still re-runs the "drawn yet?" check below.
  const [request, setRequest] = useState({ index: -1, n: 0 });
  const pending = useRef(null);
  const index = request.index;

  useEffect(() => {
    let cancelled = false;
    slidesApi.getSlideDeck(deckId).then((res) => { if (!cancelled && res?.success) setDeck(res.deck); });
    return () => { cancelled = true; };
  }, [deckId]);

  const outline = deck?.outline || null;
  const theme = useMemo(() => deckTheme(outline), [outline]);

  useEffect(() => {
    if (!outline) return undefined;
    window.__mtdShowSlide = (i) => new Promise((resolve) => {
      setRequest((r) => {
        pending.current = { n: r.n + 1, resolve };
        return { index: i, n: r.n + 1 };
      });
    });
    window.__mtdSlideCount = outline.slides.length;
    window.__mtdFrameReady = true;
    return () => { window.__mtdFrameReady = false; };
  }, [outline]);

  useEffect(() => {
    const p = pending.current;
    if (!p || p.n !== request.n || !outline) return;
    let cancelled = false;
    (async () => {
      await nextFrame();
      // SlideStage draws nothing until it has measured its box.
      for (let k = 0; k < 100 && !document.querySelector('[data-frame-stage] [data-slide-frame]'); k++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      try { await document.fonts.ready; } catch (e) { /* ignore */ }
      await Promise.all([...document.images].map((img) => (img.complete ? null : img.decode().catch(() => null))));
      if (hasChart(outline.slides[index])) await new Promise((r) => setTimeout(r, CHART_SETTLE_MS));
      await nextFrame();
      if (!cancelled) { pending.current = null; p.resolve(true); }
    })();
    return () => { cancelled = true; };
  }, [request, outline]);

  const slide = index >= 0 ? outline?.slides?.[index] : null;
  return (
    <div className="h-screen w-screen overflow-hidden bg-black">
      {/* Dev-only Next.js overlay must never end up in the video. */}
      <style>{'nextjs-portal{display:none!important}'}</style>
      {/* Always mounted, so its size is measured before the first request. */}
      <div data-frame-stage className="h-full w-full">
        <SlideStage slide={slide} theme={theme} slideIndex={Math.max(0, index)} className="h-full w-full" />
      </div>
    </div>
  );
}
