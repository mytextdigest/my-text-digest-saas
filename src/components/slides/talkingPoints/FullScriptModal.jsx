'use client';
import { useState } from 'react';
import { X, FileDown, Loader2, Sparkles, PenLine, TriangleAlert, Clock } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/slides/talkingPoints.js';
import SlideRenderer from '../renderer/SlideRenderer';
import TalkingPointsEditor from './TalkingPointsEditor';

const THUMB_SCALE = 12; // same ~160px thumbnails as the filmstrip

// Every slide's talking points in one scroll (TALKING_POINTS_ROADMAP.md
// Phase 4) — for reading the whole talk through, editing in place, and
// downloading the PDF. `tp` is useTalkingPoints()'s return value.
export default function FullScriptModal({ isOpen, onClose, tp, slides, theme, deckTitle, deckBusy, onJumpToSlide }) {
  const [exporting, setExporting] = useState(false);
  const busy = !!tp.generating || deckBusy;

  const handleExport = async () => {
    setExporting(true);
    await tp.exportPdf();
    setExporting(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="full" showCloseButton={false} className="h-[88vh] flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-gray-200 dark:border-gray-700">
        <div className="min-w-0 flex-1">
          <h2 id="modal-title" className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
            Talking points <span className="font-normal text-gray-400 dark:text-gray-500">· {deckTitle || 'Slide deck'}</span>
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {tp.summary.covered}/{tp.summary.total} slides
            {tp.summary.seconds > 0 && <> · about {formatDuration(tp.summary.seconds)} speaking time</>}
            {tp.summary.stale > 0 && <span className="text-amber-600 dark:text-amber-400"> · {tp.summary.stale} out of date</span>}
          </p>
        </div>
        <Button size="sm" onClick={handleExport} disabled={exporting || tp.summary.covered === 0} className="flex items-center gap-1.5">
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
          Download PDF
        </Button>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="h-8 w-8">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {tp.error && (
        <div className="shrink-0 mx-5 mt-3 text-xs px-2 py-1.5 rounded-md bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">{tp.error}</div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <ol className="max-w-4xl mx-auto px-5 py-2 divide-y divide-gray-100 dark:divide-gray-800">
          {slides.map((slide, i) => {
            const entry = tp.points[slide.id];
            const stale = tp.statusBySlide[i] === 'stale';
            const generatingThis = tp.generating === slide.id || tp.generating === 'all';
            return (
              <li key={slide.id || i} className="py-5 flex gap-5">
                <button
                  type="button"
                  onClick={() => onJumpToSlide(i)}
                  title="Go to this slide"
                  className="shrink-0 w-40 self-start rounded-md overflow-hidden border border-gray-200 dark:border-gray-700 hover:ring-2 hover:ring-primary-400/60 transition-shadow"
                >
                  <SlideRenderer slide={slide} theme={theme} scale={THUMB_SCALE} slideIndex={i} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-xs font-semibold text-primary-600 dark:text-primary-400 tabular-nums">{i + 1}</span>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{slide.title || slide.type}</h3>
                    {entry?.seconds ? (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[11px] tabular-nums text-gray-400">
                        <Clock className="w-3 h-3" />~{formatDuration(entry.seconds)}
                      </span>
                    ) : null}
                    {stale && (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                        <TriangleAlert className="w-3 h-3" />Slide changed
                      </span>
                    )}
                  </div>
                  {generatingThis ? (
                    <div className="flex items-center gap-2 text-xs text-primary-600 dark:text-primary-400 py-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />Writing…
                    </div>
                  ) : entry ? (
                    <TalkingPointsEditor
                      key={`${slide.id}:${tp.epoch}`}
                      initialHtml={entry.html}
                      onSave={(html) => tp.save(slide.id, html)}
                      toolbar="focus"
                      ariaLabel={`Talking points for slide ${i + 1}`}
                      contentClassName={cn(
                        'rounded-md -mx-2 px-2 py-1 hover:bg-gray-50 focus:bg-gray-50 dark:hover:bg-gray-800/60 dark:focus:bg-gray-800/60 transition-colors',
                        !entry.html && 'min-h-[2.5rem]'
                      )}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => tp.generate(slide.id)} disabled={busy} className="h-7 text-xs flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3" />Generate
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => tp.save(slide.id, '')} className="h-7 text-xs flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                        <PenLine className="w-3 h-3" />Write my own
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </Modal>
  );
}
