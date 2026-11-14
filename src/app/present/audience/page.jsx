'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AudienceView from '@/components/slides/present/AudienceView';
import AudienceWindowControls from '@/components/slides/present/AudienceWindowControls';
import RequireSession from '@/components/slides/present/RequireSession';
import { attachPresentationWindow } from '@/components/slides/present/presentationSession';

// Opened by presenter view (presentationSession.js) in its own window — never
// navigated to from inside the app.
function Inner() {
  const params = useSearchParams();
  const deckId = params.get('deckId');
  useState(() => {
    if (deckId && typeof window !== 'undefined') attachPresentationWindow({ role: 'audience', deckId });
    return null;
  });
  if (!deckId) return null;
  return (
    <>
      <AudienceView deckId={deckId} />
      <AudienceWindowControls
        deckId={deckId}
        projector={params.get('display') === 'projector'}
        isTab={params.get('tab') === '1'}
      />
    </>
  );
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
