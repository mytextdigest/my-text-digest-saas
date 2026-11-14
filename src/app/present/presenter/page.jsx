'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import PresenterView from '@/components/slides/present/PresenterView';
import RequireSession from '@/components/slides/present/RequireSession';
import { attachPresentationWindow } from '@/components/slides/present/presentationSession';

// Opened by the slide editor's "Presenter View" (presentationSession.js) in
// its own window — never navigated to from inside the app. This window owns
// the presentation session.
function Inner() {
  const params = useSearchParams();
  const deckId = params.get('deckId');
  const start = params.get('start');
  // During the first render, before PresenterView mounts and asks for the state.
  useState(() => {
    if (deckId && typeof window !== 'undefined') {
      attachPresentationWindow({
        role: 'presenter', deckId, startIndex: start !== null ? Number(start) : undefined, mode: params.get('mode') || undefined,
      });
    }
    return null;
  });
  return deckId ? <PresenterView deckId={deckId} /> : null;
}

export default function Page() {
  const fallback = <div className="h-screen w-screen bg-black" />;
  return (
    <Suspense fallback={fallback}>
      <RequireSession fallback={fallback}>
        <Inner />
      </RequireSession>
    </Suspense>
  );
}
