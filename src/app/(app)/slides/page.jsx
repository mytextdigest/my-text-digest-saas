'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import SlideDeckEditor from '@/components/slides/SlideDeckEditor';

// Deliberately its own full-page route, not a modal — port this decision,
// don't wrap it in the app's normal navbar/sidebar chrome. Sits under the
// (app) route group for the group's auth/subscription/API-key gate (see
// (app)/layout.jsx), but never imports the shared <Layout> chrome those
// gated pages otherwise opt into, so it renders with zero navbar/sidebar.
function SlidesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deckId = searchParams.get('deckId');
  const docId = searchParams.get('docId');

  const handleClose = () => {
    if (docId) {
      router.push(`/document?id=${docId}&tab=slides`);
    } else {
      router.back();
    }
  };

  return <SlideDeckEditor deckId={deckId} onClose={handleClose} />;
}

export default function SlidesPage() {
  return (
    <Suspense fallback={<div className="h-screen w-full bg-white dark:bg-gray-900" />}>
      <SlidesPageInner />
    </Suspense>
  );
}
