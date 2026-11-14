'use client';
import { useEffect, useState } from 'react';
import {
  Sparkles, Loader2, RefreshCw, Maximize2, TriangleAlert, Check, PenLine, MessageSquareText, Clock, X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/slides/talkingPoints.js';
import TalkingPointsEditor from './TalkingPointsEditor';

function SkeletonLines() {
  return (
    <div className="space-y-2.5 animate-pulse" aria-hidden>
      <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 w-11/12" />
      <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 w-9/12" />
      <div className="pl-4 space-y-2 pt-1">
        <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 w-10/12" />
        <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 w-8/12" />
        <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 w-9/12" />
      </div>
      <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 w-7/12" />
    </div>
  );
}

function Message({ tone, children, onDismiss }) {
  return (
    <div className={cn(
      'mx-3 mt-2 text-sm px-2 py-1.5 rounded-md flex items-start gap-1.5',
      tone === 'error' && 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
      tone === 'info' && 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
    )}>
      <span className="flex-1">{children}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// The "Talking Points" tab of the slide editor's right panel
// (TALKING_POINTS_ROADMAP.md Phase 2-3). Follows the slide selected in the
// filmstrip; `tp` is useTalkingPoints()'s return value.
export default function TalkingPointsPanel({ tp, slide, slideIndex, slideCount, deckBusy, onOpenFullScript }) {
  const [confirmReplace, setConfirmReplace] = useState(false);
  // Slide whose points were just started via "Write my own" — its editor
  // mounts focused so the user can type straight away.
  const [focusSlideId, setFocusSlideId] = useState(null);
  useEffect(() => { setConfirmReplace(false); }, [slide?.id]);

  const entry = slide ? tp.points[slide.id] : null;
  const status = tp.statusBySlide[slideIndex];
  const anyPoints = tp.summary.covered > 0;
  const generatingAll = tp.generating === 'all';
  const generatingThis = tp.generating && tp.generating === slide?.id;
  const busy = !!tp.generating || deckBusy;
  const busyHint = deckBusy ? 'Wait for the current AI edit to finish' : undefined;

  const handleRegenerate = () => {
    if (entry?.origin === 'user' && !confirmReplace) { setConfirmReplace(true); return; }
    setConfirmReplace(false);
    tp.generate(slide.id);
  };

  const messages = (
    <>
      {tp.error && <Message tone="error" onDismiss={() => tp.setError(null)}>{tp.error}</Message>}
      {tp.notice && <Message tone="info" onDismiss={() => tp.setNotice(null)}>{tp.notice}</Message>}
    </>
  );

  if (!tp.loaded) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
  }

  // Nothing generated for this deck yet (or a whole-deck run in progress).
  if (!anyPoints || generatingAll) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        {messages}
        {generatingAll ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            <div className="flex items-center gap-2 text-sm text-primary-600 dark:text-primary-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Writing talking points for {slideCount} slides…</span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 -mt-3">This usually takes 20–40 seconds. You can keep editing slides meanwhile.</p>
            <SkeletonLines />
            <SkeletonLines />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-8">
            <div className="w-12 h-12 rounded-full bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center mb-3">
              <MessageSquareText className="w-6 h-6 text-primary-600 dark:text-primary-400" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Know what to say on every slide</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
              Get an opening line, 3–5 key points drawn from your document, and a transition into the next slide. Everything stays editable.
            </p>
            <Button size="sm" onClick={() => tp.generate()} disabled={busy} title={busyHint} className="w-full flex items-center justify-center gap-2">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Generate for all {slideCount} slides</span>
            </Button>
            {deckBusy && <p className="mt-2 text-xs text-gray-400">{busyHint}…</p>}
          </div>
        )}
      </div>
    );
  }

  const slideLabel = slide?.title || slide?.type || `Slide ${slideIndex + 1}`;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Slide context + per-slide time */}
      <div className="shrink-0 px-3 pt-3 pb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Slide {slideIndex + 1} of {slideCount}
          </div>
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate" title={slideLabel}>{slideLabel}</div>
        </div>
        {entry?.seconds ? (
          <span className="shrink-0 mt-3.5 inline-flex items-center gap-1 text-xs tabular-nums text-gray-500 dark:text-gray-400" title="Suggested speaking time for this slide">
            <Clock className="w-3.5 h-3.5" />~{formatDuration(entry.seconds)}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onOpenFullScript}
          title="Open full script"
          aria-label="Open full script"
          className="shrink-0 mt-2 w-7 h-7 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {messages}

      {status === 'stale' && !generatingThis && (
        <div className="mx-3 mb-2 text-sm px-2.5 py-2 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          <div className="flex items-start gap-1.5">
            <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" />
            <span>This slide changed after these points were written.</span>
          </div>
          <div className="flex gap-3 mt-1.5 pl-5">
            <button type="button" onClick={handleRegenerate} disabled={busy} title={busyHint} className="font-semibold hover:underline disabled:opacity-50 disabled:no-underline">Regenerate</button>
            <button type="button" onClick={() => tp.markCurrent(slide.id)} className="font-medium opacity-80 hover:opacity-100 hover:underline">Keep as is</button>
          </div>
        </div>
      )}

      {/* Editor / per-slide states */}
      <div className="flex-1 min-h-0 mx-3 mb-2 rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden bg-white dark:bg-gray-900">
        {generatingThis ? (
          <div className="p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm text-primary-600 dark:text-primary-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Rewriting talking points…</span>
            </div>
            <SkeletonLines />
          </div>
        ) : entry ? (
          <TalkingPointsEditor
            key={`${slide.id}:${tp.epoch}`}
            initialHtml={entry.html}
            onSave={(html) => tp.save(slide.id, html)}
            autoFocus={focusSlideId === slide.id}
            className="flex-1"
            contentClassName="text-[15px]"
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-6">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">No talking points for this slide yet.</p>
            <div className="flex flex-col gap-1.5 w-full max-w-[200px]">
              <Button size="sm" onClick={() => tp.generate(slide.id)} disabled={busy} title={busyHint} className="flex items-center justify-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Generate for this slide</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setFocusSlideId(slide.id); tp.save(slide.id, ''); }} className="flex items-center justify-center gap-1.5 text-gray-600 dark:text-gray-300">
                <PenLine className="w-3.5 h-3.5" />
                <span>Write my own</span>
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Footer: regenerate + save state + deck totals */}
      <div className="shrink-0 px-3 pb-3 space-y-2">
        {entry && !generatingThis && (
          confirmReplace ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="flex-1 text-gray-600 dark:text-gray-300">Replace your edits?</span>
              <Button size="sm" variant="outline" onClick={() => setConfirmReplace(false)} className="h-8 text-sm">Cancel</Button>
              <Button size="sm" onClick={handleRegenerate} disabled={busy} className="h-8 text-sm">Replace</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleRegenerate} disabled={busy} title={busyHint} className="h-8 text-sm flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" />
                Regenerate
              </Button>
              <span className="flex-1" />
              <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1" aria-live="polite">
                {tp.saveState === 'saving' && (<><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</>)}
                {tp.saveState === 'saved' && (<><Check className="w-3.5 h-3.5" />Saved</>)}
                {tp.saveState === 'error' && <span className="text-red-500">Not saved</span>}
                {tp.saveState === 'idle' && entry.origin === 'user' && 'Edited by you'}
              </span>
            </div>
          )
        )}
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-100 dark:border-gray-800">
          <span>
            {tp.summary.covered}/{tp.summary.total} slides
            {tp.summary.stale > 0 && <span className="text-amber-600 dark:text-amber-400"> · {tp.summary.stale} out of date</span>}
          </span>
          {tp.summary.seconds > 0 && <span className="tabular-nums" title="Estimated total speaking time">Total ~{formatDuration(tp.summary.seconds)}</span>}
        </div>
      </div>
    </div>
  );
}
