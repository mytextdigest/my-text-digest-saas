'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import FrameView from '@/components/slides/present/FrameView';
import RequireSession from '@/components/slides/present/RequireSession';

// Opened by the worker's headless Chromium (worker/deckVideo.js) to draw
// each slide for video export — never navigated to from inside the app. The
// worker authenticates with a deck-scoped `renderToken` (no session), which
// getSlideDeck passes on to the deck route.
function Inner() {
  const params = useSearchParams();
  const deckId = params.get('deckId');
  if (!deckId) return null;
  const view = <FrameView deckId={deckId} />;
  return params.get('renderToken') ? view : <RequireSession>{view}</RequireSession>;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-black" />}>
      <Inner />
    </Suspense>
  );
}
