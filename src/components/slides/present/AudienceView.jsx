'use client';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import SlideStage from './SlideStage';
import { usePresentation } from './usePresentation';
import { usePresentationKeys } from './usePresentationKeys';
import slidesApi from '@/lib/slidesApi';

const CURSOR_IDLE_MS = 2000;

// The audience window (TALKING_POINTS_ROADMAP.md Phase 6/10): the slide and
// nothing else — full screen on a projector, or a normal window the presenter
// shares in a video call. Clicking advances; keys work too, so a clicker
// still works if this window happens to have focus.
export default function AudienceView({ deckId }) {
  const { state, outline, theme } = usePresentation(deckId);
  const [pointer, setPointer] = useState(null);
  const [cursorIdle, setCursorIdle] = useState(false);
  const idleTimer = useRef(null);

  useEffect(() => slidesApi.onPresentationPointer((p) => setPointer(p)), []);
  useEffect(() => () => clearTimeout(idleTimer.current), []);

  usePresentationKeys({ state, onEnd: () => slidesApi.presentationEnd() });

  const handleMouseMove = () => {
    setCursorIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setCursorIdle(true), CURSOR_IDLE_MS);
  };

  const index = state?.index ?? 0;
  const slide = outline?.slides?.[index];

  return (
    <div
      className={cn('h-screen w-screen overflow-hidden select-none', state?.screen === 'white' ? 'bg-white' : 'bg-black', cursorIdle && 'cursor-none')}
      onMouseMove={handleMouseMove}
      onClick={() => state && slidesApi.presentationGoto(state.index + 1)}
      onContextMenu={(e) => { e.preventDefault(); if (state) slidesApi.presentationGoto(state.index - 1); }}
    >
      <SlideStage
        slide={slide}
        theme={theme}
        slideIndex={index}
        screen={state?.screen}
        pointer={pointer}
        className="h-full w-full"
      />
    </div>
  );
}
