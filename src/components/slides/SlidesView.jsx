'use client'
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Presentation, Sparkles, Download, Trash2, Loader2, AlertCircle, Calendar, Eye, ListChecks,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/LoadingSpinner';
import { cn, formatDate } from '@/lib/utils';
import BrandKitModal from './BrandKitModal';

const POLL_INTERVAL_MS = 3000;

// Ported from electron/slides/SlidesView.jsx — "Show in folder" dropped
// entirely (decision 12: no web equivalent), Download becomes a plain
// browser download link instead of a native save-dialog round-trip, and
// every `window.api.*` IPC call is replaced with a `fetch()` against this
// port's API routes.
function DeckCard({ deck, onDownload, onDelete, onPreview, onReviewOutline }) {
  const isGenerating = deck.status === 'generating';
  const isError = deck.status === 'error';
  const isOutlineReview = deck.status === 'outline_review';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card className="group relative overflow-hidden">
        <CardContent className="p-4 flex items-center gap-4">
          <div className="w-11 h-11 shrink-0 bg-primary-100 dark:bg-primary-900/50 rounded-xl flex items-center justify-center">
            {isGenerating ? (
              <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
            ) : isError ? (
              <AlertCircle className="w-5 h-5 text-red-500" />
            ) : isOutlineReview ? (
              <ListChecks className="w-5 h-5 text-amber-500" />
            ) : (
              <Presentation className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">
              {isGenerating ? 'Generating slide deck…' : (deck.title || 'Untitled Deck')}
            </h3>
            <div className="flex items-center flex-wrap gap-2 mt-1 text-xs text-gray-500 dark:text-gray-400">
              <div className="flex items-center">
                <Calendar className="w-3 h-3 mr-1" />
                {formatDate(deck.createdAt)}
              </div>
              {isGenerating && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                  Generating…
                </span>
              )}
              {isOutlineReview && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  Outline Ready — Review
                </span>
              )}
              {isError && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                  Failed
                </span>
              )}
              {deck.status === 'ready' && (
                <>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                    {deck.slideCount} slides
                  </span>
                  {deck.theme && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 truncate max-w-32">
                      {deck.theme}
                    </span>
                  )}
                </>
              )}
            </div>
            {isError && deck.errorMessage && (
              <p className="text-xs text-red-500 dark:text-red-400 mt-1 truncate">{deck.errorMessage}</p>
            )}
          </div>

          {isOutlineReview && (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onReviewOutline(deck)}
                className="text-xs h-8 px-3"
                title="Review Outline"
              >
                <ListChecks className="w-3 h-3 mr-1" />
                Review Outline
              </Button>
            </div>
          )}
          {deck.status === 'ready' && (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPreview(deck)}
                className="text-xs h-8 px-3"
                title="Preview & Edit"
              >
                <Eye className="w-3 h-3 mr-1" />
                Preview & Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDownload(deck)}
                className="text-xs h-8 px-3"
                title="Download PPTX"
              >
                <Download className="w-3 h-3 mr-1" />
                Download
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(deck)}
            className="h-8 w-8 text-gray-400 hover:text-red-600 shrink-0"
            title="Delete deck"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function SlidesView({ docId }) {
  const router = useRouter();
  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRequesting, setIsRequesting] = useState(false);
  const [showBrandModal, setShowBrandModal] = useState(false);
  const pollRef = useRef(null);

  const fetchDecks = async () => {
    const res = await fetch(`/api/documents/${docId}/slides`).then((r) => r.json()).catch(() => null);
    if (Array.isArray(res?.decks)) setDecks(res.decks);
  };

  useEffect(() => {
    if (!docId) return;
    setLoading(true);
    fetchDecks().finally(() => setLoading(false));
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  useEffect(() => {
    const hasGenerating = decks.some((d) => d.status === 'generating');
    clearInterval(pollRef.current);
    if (hasGenerating) {
      pollRef.current = setInterval(fetchDecks, POLL_INTERVAL_MS);
    }
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decks]);

  const handleGenerate = async ({ brandKit } = {}) => {
    setIsRequesting(true);
    try {
      const res = await fetch(`/api/documents/${docId}/slides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandKit }),
      }).then((r) => r.json());
      if (res?.success) await fetchDecks();
    } catch (err) {
      console.error('Failed to start slide generation:', err);
    } finally {
      setIsRequesting(false);
      setShowBrandModal(false);
    }
  };

  // Plain browser download of a server-generated file (decision 12) — the
  // route redirects to a signed S3 URL with a forced attachment filename.
  const handleDownload = (deck) => {
    window.open(`/api/slide-decks/${deck.id}/download`, '_blank');
  };

  const handleDelete = async (deck) => {
    try {
      await fetch(`/api/slide-decks/${deck.id}`, { method: 'DELETE' });
      await fetchDecks();
    } catch (err) {
      console.error('Failed to delete deck:', err);
    }
  };

  if (loading) {
    return <LoadingSkeleton count={2} />;
  }

  if (decks.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center py-16 text-center"
      >
        <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
          <Presentation className="w-8 h-8 text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
          No slide decks yet
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-xs">
          Generate a professionally designed PPTX deck from this document — varied layouts, charts, and icons, ready to download.
        </p>
        <Button onClick={() => setShowBrandModal(true)} disabled={isRequesting}>
          {isRequesting ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4 mr-2" />
          )}
          Generate Slides
        </Button>
        <BrandKitModal
          isOpen={showBrandModal}
          onClose={() => setShowBrandModal(false)}
          onGenerate={handleGenerate}
          isGenerating={isRequesting}
          docId={docId}
        />
      </motion.div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setShowBrandModal(true)} disabled={isRequesting} className="text-xs h-8">
          {isRequesting ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
          )}
          Generate New Deck
        </Button>
      </div>
      <BrandKitModal
        isOpen={showBrandModal}
        onClose={() => setShowBrandModal(false)}
        onGenerate={handleGenerate}
        isGenerating={isRequesting}
        docId={docId}
      />
      {decks.map((deck) => (
        <DeckCard
          key={deck.id}
          deck={deck}
          onDownload={handleDownload}
          onDelete={handleDelete}
          onPreview={(d) => router.push(`/slides?deckId=${d.id}&docId=${docId}`)}
          onReviewOutline={(d) => router.push(`/slides/review?deckId=${d.id}&docId=${docId}`)}
        />
      ))}
    </div>
  );
}
