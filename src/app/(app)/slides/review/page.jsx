'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import OutlineReview from '@/components/slides/OutlineReview';

// Same no-chrome, own-route treatment as ../page.jsx.
function OutlineReviewPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deckId = searchParams.get('deckId');
  const docId = searchParams.get('docId');

  const handleDone = () => {
    if (docId) {
      router.push(`/document?id=${docId}&tab=slides`);
    } else {
      router.back();
    }
  };

  return <OutlineReview deckId={deckId} onDone={handleDone} />;
}

export default function OutlineReviewPage() {
  return (
    <Suspense fallback={<div className="h-screen w-full bg-white dark:bg-gray-900" />}>
      <OutlineReviewPageInner />
    </Suspense>
  );
}
