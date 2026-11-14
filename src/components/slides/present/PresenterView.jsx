'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pause, Play, RotateCcw, ChevronLeft, ChevronRight, X, LayoutGrid, Square, MonitorCog, Pointer,
  MonitorUp, ArrowLeftRight, PenLine, TriangleAlert, Minus, Plus, MonitorPlay, Clock, Sparkles, Loader2,
  Volume2, Headphones,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ToolbarMenu } from '@/components/documents/viewer/ViewerToolbar';
import { slideBudgetsMs, computePace, formatDuration } from '@/lib/slides/talkingPoints.js';
import TalkingPointsEditor from '../talkingPoints/TalkingPointsEditor';
import { useTalkingPoints } from '../talkingPoints/useTalkingPoints';
import { useSlideAudio } from '../narration/useSlideAudio';
import { useNarrationPlayback } from './useNarrationPlayback';
import SlideStage from './SlideStage';
import { usePresentation, useNow, liveTimes, formatClock } from './usePresentation';
import { usePresentationKeys } from './usePresentationKeys';
import slidesApi from '@/lib/slidesApi';
import { presenterInfo, onPresenterInfo } from './presentationSession';

const FONT_KEY = 'mtd.presenter.notesFontPx';
const HINT_KEY = 'mtd.presenter.shareHintDismissed';
const SOUND_HINT_KEY = 'mtd.presenter.shareSoundHintDismissed';
const FONT_MIN = 12;
const FONT_MAX = 36;

function readStored(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function writeStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode etc. */ }
}

function IconButton({ icon: Icon, label, onClick, active, disabled, className }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-9 w-9 inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-30 disabled:pointer-events-none',
        active ? 'bg-primary-600 text-white' : 'text-gray-300 hover:bg-white/10 hover:text-white',
        className
      )}
    >
      <Icon className="w-[18px] h-[18px]" />
    </button>
  );
}

function PacePill({ pace }) {
  if (!pace) return null;
  const amount = formatDuration(Math.abs(pace.deltaMs) / 1000);
  const label = pace.status === 'behind' ? `${amount} behind` : pace.status === 'ahead' ? `${amount} ahead` : 'On pace';
  return (
    <span
      title="Compared with the suggested speaking time for the slides so far"
      className={cn(
        'px-2.5 py-1 rounded-full text-xs font-medium tabular-nums',
        pace.status === 'behind' && 'bg-amber-500/15 text-amber-300',
        pace.status === 'ahead' && 'bg-sky-500/15 text-sky-300',
        pace.status === 'on-pace' && 'bg-emerald-500/15 text-emerald-300'
      )}
    >
      {label}
    </span>
  );
}

function SlideBudgetBar({ pace, currentSlideMs }) {
  if (!pace) return null;
  const over = pace.slideProgress > 1;
  return (
    <div className="flex items-center gap-2.5 min-w-[180px]" title="Time on this slide vs. its suggested speaking time">
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-[width] duration-1000 ease-linear', over ? 'bg-amber-400' : 'bg-emerald-400')}
          style={{ width: `${Math.min(100, pace.slideProgress * 100)}%` }}
        />
      </div>
      <span className={cn('text-xs tabular-nums', over ? 'text-amber-300' : 'text-gray-400')}>
        {formatClock(currentSlideMs)} / {formatClock(pace.slideBudgetMs)}
      </span>
    </div>
  );
}

// Play / pause narration + where the current slide's clip (or hold) is.
// Rendered on a 250ms tick while playing.
function NarrationControl({ playback, slideHasClip }) {
  useNow(playback.playing ? 250 : 60000);
  const p = playback.progress();
  if (playback.finished) {
    return (
      <span className="flex items-center gap-2 text-xs text-gray-400">
        <Volume2 className="w-3.5 h-3.5" />Narration finished
        <button type="button" onClick={playback.restart} className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-gray-100">Play from start</button>
      </span>
    );
  }
  const ratio = p && p.durationMs > 0 ? Math.min(1, p.positionMs / p.durationMs) : 0;
  return (
    <span className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={playback.playing ? playback.pause : playback.start}
        title={playback.playing ? 'Pause narration' : 'Play the slides\' narration — slides move on by themselves'}
        className={cn(
          'h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium transition-colors',
          playback.playing ? 'bg-primary-600 text-white hover:bg-primary-500' : 'bg-white/10 text-gray-100 hover:bg-white/20'
        )}
      >
        {playback.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        {playback.playing ? 'Pause narration' : p ? 'Resume narration' : 'Play narration'}
      </button>
      {p && (
        <span className="flex items-center gap-2 min-w-[150px]" title={p.kind === 'clip' ? 'Narration for this slide' : 'Time until the next slide'}>
          <span className="w-24 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <span className={cn('block h-full rounded-full', p.kind === 'clip' ? 'bg-primary-400' : 'bg-gray-400')} style={{ width: `${ratio * 100}%` }} />
          </span>
          <span className="text-xs tabular-nums text-gray-400">
            {p.kind === 'clip' ? `${formatClock(p.positionMs)} / ${formatClock(p.durationMs)}` : `Next in ${Math.ceil((p.remainingMs || 0) / 1000)}s`}
          </span>
        </span>
      )}
      {!p && !slideHasClip && <span className="text-xs text-gray-500">No audio on this slide</span>}
    </span>
  );
}

function SlideGrid({ slides, theme, current, onPick, onClose }) {
  return (
    <div className="fixed inset-0 z-40 bg-gray-950/95 backdrop-blur-sm flex flex-col" role="dialog" aria-label="All slides">
      <div className="shrink-0 flex items-center justify-between px-6 py-4">
        <h2 className="text-sm font-semibold text-gray-100">All slides</h2>
        <IconButton icon={X} label="Close (Esc)" onClick={onClose} />
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-8">
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {slides.map((s, i) => (
            <button
              key={s.id || i}
              type="button"
              onClick={() => onPick(i)}
              className="group text-left"
            >
              <div className={cn(
                'rounded-lg overflow-hidden ring-2 transition-shadow',
                i === current ? 'ring-primary-500' : 'ring-transparent group-hover:ring-white/40'
              )}>
                <SlideStage slide={s} theme={theme} slideIndex={i} className="aspect-[13.3/7.5] w-full" />
              </div>
              <div className="mt-1.5 flex gap-2 text-xs">
                <span className={cn('tabular-nums font-semibold', i === current ? 'text-primary-400' : 'text-gray-500')}>{i + 1}</span>
                <span className="text-gray-300 truncate">{s.title || s.type}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// The presenter's own screen (TALKING_POINTS_ROADMAP.md Phases 7–10): current
// slide, next slide, editable talking points, timer, pace guide, tools.
export default function PresenterView({ deckId }) {
  const { state, outline, theme } = usePresentation(deckId);
  const slides = outline?.slides || [];
  const tp = useTalkingPoints(deckId, slides);
  const na = useSlideAudio(deckId, slides, tp.points);
  const now = useNow(1000);
  const [fontPx, setFontPx] = useState(18);
  const [hintDismissed, setHintDismissed] = useState(true);
  const [soundHintDismissed, setSoundHintDismissed] = useState(true);
  const [gridOpen, setGridOpen] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [laserOn, setLaserOn] = useState(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [localPointer, setLocalPointer] = useState(null);
  const [focusSlideId, setFocusSlideId] = useState(null);
  // Browser only: is the audience window open / was it blocked (pop-ups),
  // and can this browser place windows on screens (Chrome/Edge).
  const [windowInfo, setWindowInfo] = useState(() => presenterInfo());
  useEffect(() => onPresenterInfo(setWindowInfo), []);
  const pointerFrame = useRef(null);
  const pendingPointer = useRef(undefined);

  useEffect(() => {
    setFontPx(readStored(FONT_KEY, 18));
    setHintDismissed(readStored(HINT_KEY, false));
    setSoundHintDismissed(readStored(SOUND_HINT_KEY, false));
  }, []);

  const index = state?.index ?? 0;
  const slide = slides[index];
  const nextSlide = slides[index + 1];
  const entry = slide ? tp.points[slide.id] : null;
  const stale = tp.statusBySlide[index] === 'stale';
  const { elapsedMs, currentSlideMs } = liveTimes(state, now);
  // A slide's narration clip, when it has one, is its target time.
  const budgets = useMemo(() => slideBudgetsMs(slides, tp.points, na.audio), [slides, tp.points, na.audio]);
  const playback = useNarrationPlayback({ state, slides, audio: na.audio, budgets, gapMs: na.settings.gapMs });
  const hasNarration = na.summary.covered > 0;
  const pace = budgets && state ? computePace({ budgets, index, elapsedMs, currentSlideMs }) : null;
  const laserActive = laserOn || ctrlHeld;

  const end = () => slidesApi.presentationEnd();
  const goto = (i) => slidesApi.presentationGoto(i);
  const setScreen = (value) => slidesApi.presentationSetScreen(state?.screen === value ? 'normal' : value);

  const digits = usePresentationKeys({
    state,
    onEnd: end,
    extra: (e) => {
      if (gridOpen && e.key === 'Escape') { setGridOpen(false); return true; }
      if (mirror && e.key === 'Escape') { setMirror(false); return true; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) { setLaserOn((v) => !v); return true; }
      if (e.ctrlKey || e.metaKey) return false;
      if (e.key === 'g' || e.key === 'G') { setGridOpen((v) => !v); return true; }
      if (e.key === 'l' || e.key === 'L') { setLaserOn((v) => !v); return true; }
      return false;
    },
  });

  // Hold Ctrl for a momentary laser pointer (PowerPoint style).
  useEffect(() => {
    const down = (e) => { if (e.key === 'Control') setCtrlHeld(true); };
    const up = (e) => { if (e.key === 'Control') setCtrlHeld(false); };
    const blur = () => setCtrlHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  // Laser dot → audience, at most once per animation frame.
  const sendPointer = (point) => {
    pendingPointer.current = point;
    if (pointerFrame.current) return;
    pointerFrame.current = requestAnimationFrame(() => {
      pointerFrame.current = null;
      slidesApi.presentationPointer(pendingPointer.current);
    });
  };
  useEffect(() => {
    if (!laserActive) { setLocalPointer(null); slidesApi.presentationPointer(null); }
  }, [laserActive]);

  const handlePointer = (point) => {
    if (!laserActive) return;
    setLocalPointer(point);
    sendPointer(point);
  };

  const changeFont = (delta) => {
    setFontPx((px) => {
      const next = Math.max(FONT_MIN, Math.min(FONT_MAX, px + delta));
      writeStored(FONT_KEY, next);
      return next;
    });
  };

  const dismissHint = () => { setHintDismissed(true); writeStored(HINT_KEY, true); };
  const dismissSoundHint = () => { setSoundHintDismissed(true); writeStored(SOUND_HINT_KEY, true); };

  if (!state || !outline) {
    return <div className="dark h-screen w-screen bg-gray-950" />;
  }

  // "Presenter view off": this screen shows the slide too (PowerPoint's
  // Duplicate Slide Show). Keys keep working; Esc or the button comes back.
  if (mirror) {
    return (
      <div className="dark group relative h-screen w-screen bg-black select-none">
        <SlideStage slide={slide} theme={theme} slideIndex={index} screen={state.screen} pointer={localPointer} onPointer={handlePointer} className="h-full w-full" />
        <button
          type="button"
          onClick={() => setMirror(false)}
          className="absolute top-4 right-4 px-3 py-2 rounded-lg bg-white/10 text-white text-sm opacity-0 group-hover:opacity-100 hover:bg-white/20 transition-opacity"
        >
          Show presenter view
        </button>
      </div>
    );
  }

  const displayItems = [
    {
      label: 'Swap displays', icon: ArrowLeftRight, onClick: () => slidesApi.presentationSwapDisplays(), disabled: state.mode !== 'projector',
      title: windowInfo && !windowInfo.canPlaceOnScreens ? 'Moving the slides between screens needs Chrome or Edge' : undefined,
    },
    { label: 'Show the Audience window', icon: MonitorUp, onClick: () => slidesApi.presentationShowAudience(), disabled: state.mode === 'rehearse' },
    { label: 'Presenter view off (duplicate slide)', icon: MonitorPlay, onClick: () => setMirror(true) },
  ];

  return (
    <div className="dark h-screen w-screen flex flex-col bg-gray-950 text-gray-100 select-none overflow-hidden">
      {/* Top bar: timer, pace, mode, clock, end */}
      <header className="shrink-0 h-14 flex items-center gap-3 px-4 border-b border-white/10">
        <span className="text-lg font-semibold tabular-nums tracking-wide min-w-[72px]" title="Elapsed time">{formatClock(elapsedMs)}</span>
        <IconButton
          icon={state.timer.running ? Pause : Play}
          label={state.timer.running ? 'Pause timer' : 'Resume timer'}
          onClick={() => slidesApi.presentationTimer(state.timer.running ? 'pause' : 'resume')}
        />
        <IconButton icon={RotateCcw} label="Restart timer" onClick={() => slidesApi.presentationTimer('reset')} />
        <span className="w-px h-6 bg-white/10 mx-1" />
        <PacePill pace={pace} />
        {pace && (
          <span className="text-xs text-gray-500 tabular-nums" title="Sum of the suggested speaking times">
            Target {formatDuration(pace.totalBudgetMs / 1000)}
          </span>
        )}

        <span className="flex-1" />

        {state.mode === 'window' && (
          <span className="flex items-center gap-2 pl-3 pr-1 py-1 rounded-full bg-primary-500/15 text-primary-200 text-xs">
            <MonitorUp className="w-3.5 h-3.5" />
            <span>Share the <strong className="font-semibold">MTD — Audience</strong> window in your call</span>
            <button
              type="button"
              onClick={() => slidesApi.presentationShowAudience()}
              className="px-2 py-0.5 rounded-full bg-primary-500/30 hover:bg-primary-500/50 text-white font-medium"
            >
              Show
            </button>
          </span>
        )}
        {state.mode === 'projector' && <span className="text-xs text-gray-400">Audience view on external display</span>}
        {state.mode === 'rehearse' && <span className="text-xs text-gray-400">Rehearsal — no audience window</span>}

        <span className="text-sm text-gray-400 tabular-nums" title="Current time">
          {new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </span>
        <button
          type="button"
          onClick={end}
          className="ml-1 h-9 px-3.5 inline-flex items-center rounded-lg bg-white/10 hover:bg-red-600 text-sm font-medium transition-colors"
        >
          End show
        </button>
      </header>

      <div className="flex-1 min-h-0 flex gap-5 p-5">
        {/* Current slide + tools */}
        <section className="flex-1 min-w-0 flex flex-col gap-3">
          <SlideStage
            slide={slide}
            theme={theme}
            slideIndex={index}
            screen="normal"
            pointer={laserActive ? localPointer : null}
            onPointer={handlePointer}
            className="flex-1"
            frameClassName={cn('rounded-md shadow-2xl ring-1 ring-white/10', laserActive && 'cursor-none')}
          >
            {state.screen !== 'normal' && (
              <div className="absolute inset-x-0 top-0 flex justify-center pt-3 pointer-events-none">
                <span className={cn('px-3 py-1 rounded-full text-xs font-semibold shadow', state.screen === 'black' ? 'bg-black text-white ring-1 ring-white/30' : 'bg-white text-gray-900')}>
                  Audience sees a {state.screen} screen — press {state.screen === 'black' ? 'B' : 'W'} or Esc to return
                </span>
              </div>
            )}
          </SlideStage>
          <div className="shrink-0 flex items-center gap-1">
            <IconButton icon={Pointer} label="Laser pointer (L, or hold Ctrl)" active={laserActive} onClick={() => setLaserOn((v) => !v)} />
            <IconButton icon={LayoutGrid} label="See all slides (G)" onClick={() => setGridOpen(true)} />
            <IconButton icon={Square} label="Black screen (B)" active={state.screen === 'black'} onClick={() => setScreen('black')} className="[&_svg]:fill-current" />
            <IconButton icon={Square} label="White screen (W)" active={state.screen === 'white'} onClick={() => setScreen('white')} />
            <ToolbarMenu
              align="left"
              items={displayItems}
              trigger={({ open, toggle }) => <IconButton icon={MonitorCog} label="Display settings" active={open} onClick={toggle} />}
            />
            {hasNarration && (
              <>
                <span className="w-px h-6 bg-white/10 mx-2" />
                <NarrationControl playback={playback} slideHasClip={!!(slide && na.audio[slide.id]?.url)} />
              </>
            )}
            <span className="flex-1" />
            <SlideBudgetBar pace={pace} currentSlideMs={currentSlideMs} />
          </div>
        </section>

        {/* Next slide + talking points */}
        <aside className="w-[38%] min-w-[340px] max-w-[620px] flex flex-col gap-4 min-h-0">
          <div className="shrink-0">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-1.5">Next slide</div>
            {nextSlide ? (
              <button type="button" onClick={() => goto(index + 1)} className="block w-full rounded-md overflow-hidden ring-1 ring-white/10 hover:ring-white/30" title="Go to next slide">
                <SlideStage slide={nextSlide} theme={theme} slideIndex={index + 1} className="aspect-[13.3/7.5] w-full" />
              </button>
            ) : (
              <div className="aspect-[13.3/7.5] w-full rounded-md ring-1 ring-white/10 flex items-center justify-center text-sm text-gray-500">
                End of presentation
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 flex flex-col rounded-lg bg-white/[0.03] ring-1 ring-white/10">
            <div className="shrink-0 flex items-center gap-2 px-4 pt-3 pb-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-100 truncate">
                  <span className="text-primary-400 tabular-nums mr-1.5">{index + 1}</span>{slide?.title || slide?.type}
                </div>
                {(entry?.seconds || stale) && (
                  <div className="flex items-center gap-2 text-[11px] mt-0.5">
                    {entry?.seconds ? <span className="inline-flex items-center gap-1 text-gray-500"><Clock className="w-3 h-3" />~{formatDuration(entry.seconds)}</span> : null}
                    {stale && <span className="inline-flex items-center gap-1 text-amber-400"><TriangleAlert className="w-3 h-3" />Slide changed since these were written</span>}
                  </div>
                )}
              </div>
              <IconButton icon={Minus} label="Smaller notes text" onClick={() => changeFont(-2)} disabled={fontPx <= FONT_MIN} className="h-7 w-7" />
              <IconButton icon={Plus} label="Larger notes text" onClick={() => changeFont(2)} disabled={fontPx >= FONT_MAX} className="h-7 w-7" />
            </div>
            <div
              className="tp-presenter flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 pb-4 pt-9 select-text"
              style={{ '--tp-font-size': `${fontPx}px` }}
            >
              {entry ? (
                <TalkingPointsEditor
                  key={`${slide.id}:${tp.epoch}`}
                  initialHtml={entry.html}
                  onSave={(html) => tp.save(slide.id, html)}
                  toolbar="focus"
                  autoFocus={focusSlideId === slide.id}
                  ariaLabel={`Talking points for slide ${index + 1}`}
                  contentClassName="rounded-md -mx-2 px-2 py-1 min-h-[3rem] hover:bg-white/[0.04] focus:bg-white/[0.06] transition-colors"
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 -mt-9">
                  {tp.generating ? (
                    <p className="inline-flex items-center gap-2 text-sm text-gray-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {tp.generating === 'all' ? `Writing talking points for ${slides.length} slides…` : 'Writing talking points…'}
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-gray-500">
                        {tp.summary.covered === 0 ? 'This deck has no talking points yet.' : 'No talking points for this slide.'}
                      </p>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {/* No points anywhere → generate the whole deck; otherwise just this slide. */}
                        <button
                          type="button"
                          onClick={() => tp.generate(tp.summary.covered === 0 ? undefined : slide.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-sm text-white"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          {tp.summary.covered === 0 ? `Generate for all ${slides.length} slides` : 'Generate for this slide'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setFocusSlideId(slide.id); tp.save(slide.id, ''); }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
                        >
                          <PenLine className="w-3.5 h-3.5" />Write notes
                        </button>
                      </div>
                    </>
                  )}
                  {tp.error && <p className="text-xs text-red-400">{tp.error}</p>}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Bottom: navigation + progress */}
      <footer className="shrink-0 h-16 flex items-center justify-center gap-4 border-t border-white/10 relative">
        <IconButton icon={ChevronLeft} label="Previous slide (←)" onClick={() => goto(index - 1)} disabled={index === 0} className="h-10 w-10 rounded-full ring-1 ring-white/20" />
        <div className="w-40 text-center">
          <div className="text-sm tabular-nums">Slide {index + 1} of {state.slideCount}</div>
          <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-primary-500 rounded-full transition-[width]" style={{ width: `${((index + 1) / state.slideCount) * 100}%` }} />
          </div>
        </div>
        <IconButton icon={ChevronRight} label="Next slide (→)" onClick={() => goto(index + 1)} disabled={index >= state.slideCount - 1} className="h-10 w-10 rounded-full ring-1 ring-white/20" />
        {digits && (
          <span className="absolute left-1/2 -translate-x-1/2 -top-12 px-3 py-1.5 rounded-lg bg-gray-800 text-sm shadow-lg">
            Go to slide <strong className="tabular-nums">{digits}</strong> — press Enter
          </span>
        )}
      </footer>

      {/* First run in window mode: how to share safely */}
      {state.mode === 'window' && !hintDismissed && (
        <div className="fixed bottom-20 right-5 z-30 w-80 rounded-xl bg-gray-800 ring-1 ring-white/10 shadow-2xl p-4">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-9 h-9 rounded-full bg-primary-500/20 flex items-center justify-center">
              <MonitorUp className="w-4 h-4 text-primary-300" />
            </div>
            <div className="text-sm">
              <p className="font-semibold text-gray-100 mb-1">Presenting in a call?</p>
              <p className="text-gray-300 leading-relaxed">
                Share the window named <strong>MTD — Audience</strong>, not your whole screen. Viewers see only the slide, even while this view covers it. Leave it open behind this one — don&apos;t minimize it.
              </p>
              <p className="text-gray-300 leading-relaxed mt-1.5">If the shared slide freezes while covered, share this as a tab.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => slidesApi.presentationShowAudience()} className="px-3 py-1.5 rounded-lg text-sm text-gray-300 hover:bg-white/10">Show it</button>
            <button type="button" onClick={dismissHint} className="px-3 py-1.5 rounded-lg text-sm bg-primary-600 hover:bg-primary-500 text-white font-medium">Got it</button>
          </div>
        </div>
      )}

      {/* Browser only: the pop-up blocker stopped the audience window. */}
      {state.mode !== 'rehearse' && windowInfo?.blocked && !windowInfo.audienceOpen && (
        <div className="fixed bottom-20 left-5 z-30 w-80 rounded-xl bg-gray-800 ring-1 ring-white/10 shadow-2xl p-4">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-9 h-9 rounded-full bg-primary-500/20 flex items-center justify-center">
              <MonitorUp className="w-4 h-4 text-primary-300" />
            </div>
            <div className="text-sm">
              <p className="font-semibold text-gray-100 mb-1">Open the audience window</p>
              <p className="text-gray-300 leading-relaxed">
                Your browser blocked it. Click Open, or allow pop-ups for this site so it opens by itself next time.
              </p>
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <button type="button" onClick={() => slidesApi.presentationShowAudience()} className="px-3 py-1.5 rounded-lg text-sm bg-primary-600 hover:bg-primary-500 text-white font-medium">Open</button>
          </div>
        </div>
      )}

      {/* Narration in a call: the call app has to send this computer's sound. */}
      {hasNarration && playback.playing && state.mode === 'window' && !soundHintDismissed && (
        <div className="fixed top-16 left-5 z-30 w-80 rounded-xl bg-gray-800 ring-1 ring-white/10 shadow-2xl p-4">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-9 h-9 rounded-full bg-primary-500/20 flex items-center justify-center">
              <Headphones className="w-4 h-4 text-primary-300" />
            </div>
            <div className="text-sm">
              <p className="font-semibold text-gray-100 mb-1">Can your audience hear it?</p>
              <p className="text-gray-300 leading-relaxed">
                The narration plays on this computer. In your call, turn on <strong>Share sound</strong> (Zoom) or <strong>Include computer sound</strong> (Teams) when you share the Audience window.
              </p>
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <button type="button" onClick={dismissSoundHint} className="px-3 py-1.5 rounded-lg text-sm bg-primary-600 hover:bg-primary-500 text-white font-medium">Got it</button>
          </div>
        </div>
      )}

      {gridOpen && (
        <SlideGrid
          slides={slides}
          theme={theme}
          current={index}
          onPick={(i) => { goto(i); setGridOpen(false); }}
          onClose={() => setGridOpen(false)}
        />
      )}
    </div>
  );
}
