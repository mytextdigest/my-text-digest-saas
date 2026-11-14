'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Sparkles, Upload, Mic, Trash2, Loader2, TriangleAlert, X, Play, Square, RefreshCw, Volume2, Check, ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { VOICES, TONES, describeNumberProblem } from '@/lib/slides/narration.js';
import { formatClock } from '../present/usePresentation';
import AudioRecorder from './AudioRecorder';
import slidesApi from '@/lib/slidesApi';

const ACCEPT = '.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.webm,audio/*';
const GAP_OPTIONS = [0, 250, 500, 1000, 1500, 2000, 3000];
const SOURCE_LABEL = { generated: 'AI voice', uploaded: 'Uploaded', recorded: 'Recorded' };

function Message({ tone, children, onDismiss }) {
  return (
    <div className={cn(
      'text-sm px-3 py-2 rounded-md flex items-start gap-2',
      tone === 'error' && 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
      tone === 'info' && 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
    )}>
      <span className="flex-1">{children}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 mt-0.5 opacity-70 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
      )}
    </div>
  );
}

function ActionButton({ icon: Icon, children, onClick, disabled, title, variant = 'outline', spin, className }) {
  return (
    <Button size="sm" variant={variant} onClick={onClick} disabled={disabled} title={title} className={cn('h-8 px-2.5 text-sm flex items-center gap-1.5', className)}>
      <Icon className={cn('w-3.5 h-3.5', spin && 'animate-spin')} />{children}
    </Button>
  );
}

function Confirm({ children, confirmLabel, onConfirm, onCancel, cancelLabel = 'Cancel', danger }) {
  return (
    <div className="text-sm rounded-md bg-gray-100 dark:bg-gray-800 px-3 py-2.5">
      <p className="text-gray-700 dark:text-gray-200 mb-2">{children}</p>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="outline" className="h-8 text-sm" onClick={onCancel}>{cancelLabel}</Button>
        <Button size="sm" className={cn('h-8 text-sm', danger && 'bg-red-600 hover:bg-red-700')} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </div>
  );
}

// Plain-text script box: saves on blur when changed.
function ScriptBox({ initial, onSave, disabled }) {
  const [value, setValue] = useState(initial || '');
  const saved = useRef(initial || '');
  return (
    <textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => { if (value !== saved.current) { saved.current = value; onSave(value); } }}
      disabled={disabled}
      rows={8}
      placeholder="What the narrator says on this slide. Leave it empty and the AI writes it from the talking points."
      aria-label="Narration script"
      className="w-full text-sm leading-relaxed rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-primary-500/40"
    />
  );
}

// Every figure the script quotes, ticked when it matches the slide or its
// talking points (deterministic check, src/lib/slides/narration.js).
function NumberChips({ numbers }) {
  if (!numbers) return null;
  const items = [
    ...numbers.numbers.map((n) => ({ text: n.raw, ok: n.ok })),
    ...numbers.spelled.map((w) => ({ text: `"${w}"`, ok: false, words: true })),
  ];
  // Same figure quoted twice shows once.
  const seen = new Set();
  const unique = items.filter((it) => (seen.has(it.text) ? false : seen.add(it.text)));
  if (!unique.length && !numbers.missing.length) return null;
  return (
    <div className="space-y-1.5">
      {unique.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-500 dark:text-gray-400">Numbers:</span>
          {unique.map((it) => (
            <span
              key={it.text}
              title={it.ok ? 'Matches the slide or its talking points' : it.words ? 'Numbers must be written in digits so they can be checked' : 'Not found on this slide or in its talking points'}
              className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium tabular-nums',
                it.ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
              )}
            >
              {it.ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}{it.text}
            </span>
          ))}
        </div>
      )}
      {numbers.missing.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Not mentioned from the talking points: {numbers.missing.join(', ')}</p>
      )}
    </div>
  );
}

// Voice / tone / pause-between-slides for the whole deck, with a sample.
function VoiceSettings({ na, disabled }) {
  const [previewing, setPreviewing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);
  useEffect(() => () => audioRef.current?.pause(), []);

  const preview = async () => {
    if (playing) { audioRef.current?.pause(); setPlaying(false); return; }
    setPreviewing(true);
    const res = await slidesApi.previewNarrationVoice({ voice: na.settings.voice, tone: na.settings.tone });
    setPreviewing(false);
    if (!res?.success) { na.setError(res?.error || 'Could not play a sample.'); return; }
    audioRef.current?.pause();
    const el = new Audio(res.url);
    audioRef.current = el;
    el.onended = () => setPlaying(false);
    el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const selectClass = 'h-9 min-w-0 w-full text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 px-2';
  const label = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1';
  return (
    <div className="space-y-2.5">
      <div>
        <span className={label}>Voice</span>
        <div className="flex items-center gap-2">
          <select aria-label="Narration voice" value={na.settings.voice} disabled={disabled} onChange={(e) => na.updateSettings({ voice: e.target.value })} className={selectClass}>
            {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label} — {v.hint}</option>)}
          </select>
          <button
            type="button"
            onClick={preview}
            disabled={previewing}
            title={playing ? 'Stop sample' : 'Hear a sample of this voice'}
            aria-label={playing ? 'Stop sample' : 'Hear a sample of this voice'}
            className="shrink-0 h-9 w-9 inline-flex items-center justify-center rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : playing ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className={label}>Tone</span>
          <select aria-label="Narration tone" value={na.settings.tone} disabled={disabled} onChange={(e) => na.updateSettings({ tone: e.target.value })} className={selectClass}>
            {TONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <span className={label} title="Pause after each clip before the next slide">Between slides</span>
          <select aria-label="Pause between slides" value={na.settings.gapMs} onChange={(e) => na.updateSettings({ gapMs: Number(e.target.value) })} className={selectClass}>
            {GAP_OPTIONS.map((ms) => <option key={ms} value={ms}>{ms === 0 ? 'No pause' : `${ms / 1000}s pause`}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

// The "Narration" tab of the slide editor's right panel
// (SLIDE_AUDIO_ROADMAP.md): AI voice for the whole deck at the top, then the
// selected slide's clip (AI voice, upload or recording) and its script.
export default function NarrationPanel({ na, slide, slideIndex, slideCount, deckBusy }) {
  const [recording, setRecording] = useState(false);
  // null | 'replace' | 'rewrite' | 'remove' | 'redoAll'
  const [confirm, setConfirm] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { setRecording(false); setConfirm((c) => (c === 'redoAll' ? c : null)); }, [slide?.id]);

  if (!na.loaded) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
  }
  if (!slide) return null;

  const entry = na.audio[slide.id];
  const status = na.statusBySlide[slideIndex] || {};
  const hasClip = !!entry?.url;
  const busyHere = na.busy && na.busy.slideId === slide.id;
  const busyAll = na.busy?.kind === 'all';
  const anyBusy = !!na.busy || deckBusy;
  const busyHint = deckBusy ? 'Wait for the current AI edit to finish' : undefined;
  const { summary } = na;
  const generatedCount = Object.values(na.audio).filter((a) => a?.url && a.source === 'generated').length;

  const onFile = (file) => { if (file) na.upload(slide.id, file); };

  // AI voice for just this slide: confirm before replacing the user's own
  // audio, or before rewriting a hand-edited script that's out of date.
  const runSlide = (opts) => { setConfirm(null); na.generate(slide.id, opts); };
  const handleSlideGenerate = () => {
    if (hasClip && entry.source !== 'generated' && confirm !== 'replace') { setConfirm('replace'); return; }
    if (status.scriptStale && entry?.scriptOrigin === 'user') { setConfirm('rewrite'); return; }
    runSlide();
  };

  const deckButtonLabel = summary.covered === 0
    ? `Generate AI voice for all ${summary.aiEligible} slides`
    : `Generate AI voice for ${summary.needed} remaining slide${summary.needed === 1 ? '' : 's'}`;

  const slideLabel = slide.title || slide.type || `Slide ${slideIndex + 1}`;
  const statusLine = busyHere
    ? (na.busy.kind === 'script' ? 'Writing script…' : na.busy.kind === 'upload' ? 'Saving…' : 'Creating voice…')
    : hasClip ? `${SOURCE_LABEL[entry.source] || 'Audio'} · ${formatClock(entry.durationMs || 0)}` : 'No audio yet';

  return (
    <div
      className={cn('flex-1 min-h-0 overflow-y-auto custom-scrollbar', dragOver && 'ring-2 ring-inset ring-primary-400/60')}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|opus|webm)$/i.test(f.name));
        if (file && !anyBusy) onFile(file);
      }}
    >
      <div className="p-4 space-y-5">
        {na.error && <Message tone="error" onDismiss={() => na.setError(null)}>{na.error}</Message>}
        {na.notice && <Message tone="info" onDismiss={() => na.setNotice(null)}>{na.notice}</Message>}

        {/* Whole deck */}
        <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-3.5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI voice for the whole deck</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {summary.covered}/{summary.total} slides narrated
              {summary.durationMs > 0 && <span className="tabular-nums"> · {formatClock(summary.durationMs)} total</span>}
              {summary.stale > 0 && <span className="text-amber-600 dark:text-amber-400"> · {summary.stale} out of date</span>}
              {summary.numberIssues > 0 && <span className="text-red-600 dark:text-red-400"> · {summary.numberIssues} need a number check</span>}
            </p>
          </div>

          <VoiceSettings na={na} disabled={!!na.busy} />

          {busyAll ? (
            <div className="rounded-md bg-primary-50 dark:bg-primary-900/20 px-3 py-2.5 text-sm text-primary-700 dark:text-primary-300">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="flex-1">
                  {na.busy.phase === 'script' ? 'Writing scripts' : 'Creating voices'}
                  {na.busy.total ? ` · ${na.busy.done || 0} of ${na.busy.total}` : '…'}
                </span>
                <button type="button" onClick={na.cancel} className="font-medium hover:underline">Cancel</button>
              </div>
              {na.busy.total ? (
                <div className="mt-2 h-1.5 rounded-full bg-primary-200/60 dark:bg-primary-800/60 overflow-hidden">
                  <div className="h-full bg-primary-500 transition-[width]" style={{ width: `${((na.busy.done || 0) / na.busy.total) * 100}%` }} />
                </div>
              ) : null}
            </div>
          ) : confirm === 'redoAll' ? (
            <Confirm
              confirmLabel="Regenerate"
              onCancel={() => setConfirm(null)}
              onConfirm={() => { setConfirm(null); na.generate(undefined, { redoAll: true }); }}
            >
              Re-create the AI voice for {summary.aiEligible} slide{summary.aiEligible === 1 ? '' : 's'} with the voice and tone above?
              {summary.own > 0 && ` Your ${summary.own} uploaded or recorded clip${summary.own === 1 ? ' is' : 's are'} kept.`}
            </Confirm>
          ) : (
            <div className="space-y-2">
              {summary.needed > 0 && (
                <Button
                  size="sm"
                  onClick={() => na.generate()}
                  disabled={anyBusy}
                  title={busyHint}
                  className="w-full h-9 text-sm flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />{deckButtonLabel}
                </Button>
              )}
              {generatedCount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirm('redoAll')}
                  disabled={anyBusy}
                  title={busyHint || 'Use this after changing the voice or tone'}
                  className="w-full h-9 text-sm flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />Regenerate all AI voices
                </Button>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                Writes a script from each slide&apos;s talking points, then voices every slide at once.
                {summary.own > 0 ? ` Your ${summary.own} uploaded or recorded clip${summary.own === 1 ? ' is' : 's are'} never replaced.` : ''}
              </p>
            </div>
          )}
        </section>

        {/* This slide */}
        <section className="space-y-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">Slide {slideIndex + 1} of {slideCount}</div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate" title={slideLabel}>{slideLabel}</div>
            </div>
            <span className={cn('shrink-0 mt-4 text-xs tabular-nums flex items-center gap-1', status.audio === 'check' ? 'text-red-600 dark:text-red-400' : status.audio === 'stale' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400')}>
              {busyHere ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Volume2 className="w-3.5 h-3.5" />}
              {statusLine}
            </span>
          </div>

          {recording ? (
            <AudioRecorder
              saving={na.busy?.kind === 'upload'}
              onCancel={() => setRecording(false)}
              onSave={async (file, durationMs) => {
                const res = await na.upload(slide.id, file, { source: 'recorded', durationMs });
                if (res?.success) setRecording(false);
              }}
            />
          ) : (
            <>
              {hasClip && (
                <div className="flex items-center gap-1">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <audio key={entry.url} controls preload="metadata" src={entry.url} className="flex-1 min-w-0 h-9" />
                  <button
                    type="button"
                    onClick={() => setConfirm('remove')}
                    disabled={anyBusy}
                    title="Remove this slide's audio"
                    aria-label="Remove this slide's audio"
                    className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}

              {status.numbersBlocked && !busyHere && (
                <div className="text-sm px-3 py-2.5 rounded-md bg-red-50 text-red-800 ring-1 ring-red-200 dark:bg-red-900/30 dark:text-red-200 dark:ring-red-800">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      <strong className="font-semibold">Check the numbers.</strong> In the script, {describeNumberProblem(status.numbers)}.
                      {status.audio === 'check' ? ' The audio says it too.' : ' The AI voice won\'t read it until this is fixed.'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 pl-6">
                    <button type="button" onClick={() => na.writeScript(slide.id)} disabled={anyBusy} title={busyHint} className="font-semibold hover:underline disabled:opacity-50">Rewrite with AI</button>
                    <button type="button" onClick={() => na.confirmNumbers(slide.id)} className="font-medium opacity-80 hover:opacity-100 hover:underline">The numbers are correct</button>
                  </div>
                  <p className="pl-6 mt-1 text-xs opacity-80">Or fix the figure in the script below.</p>
                </div>
              )}

              {status.audio === 'stale' && !busyHere && (
                <div className="text-sm px-3 py-2.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  <div className="flex items-start gap-2">
                    <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{status.scriptStale ? 'The talking points changed after this audio was made.' : 'The script changed after this audio was made.'}</span>
                  </div>
                  <div className="flex gap-4 mt-1.5 pl-6">
                    <button type="button" onClick={handleSlideGenerate} disabled={anyBusy} title={busyHint} className="font-semibold hover:underline disabled:opacity-50">Regenerate audio</button>
                    <button type="button" onClick={() => na.markCurrent(slide.id)} className="font-medium opacity-80 hover:opacity-100 hover:underline">Keep as is</button>
                  </div>
                </div>
              )}

              {confirm === 'replace' && (
                <Confirm
                  confirmLabel="Replace"
                  onCancel={() => setConfirm(null)}
                  onConfirm={() => (status.scriptStale && entry?.scriptOrigin === 'user' ? setConfirm('rewrite') : runSlide())}
                >
                  Replace your {entry.source === 'recorded' ? 'recording' : 'uploaded audio'} with an AI voice?
                </Confirm>
              )}
              {confirm === 'rewrite' && (
                <Confirm cancelLabel="Keep my script" confirmLabel="Rewrite" onCancel={() => runSlide()} onConfirm={() => runSlide({ rewriteScript: true })}>
                  You edited this script, and the talking points have changed since. Rewrite the script from the new talking points?
                </Confirm>
              )}
              {confirm === 'remove' && (
                <Confirm danger confirmLabel="Remove" onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); na.remove(slide.id); }}>
                  Remove this slide&apos;s audio? The script is kept.
                </Confirm>
              )}

              {(!confirm || confirm === 'redoAll') && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <ActionButton
                    icon={busyHere && na.busy.kind === 'audio' ? Loader2 : hasClip && entry.source === 'generated' ? RefreshCw : Sparkles}
                    spin={busyHere && na.busy.kind === 'audio'}
                    onClick={handleSlideGenerate}
                    disabled={anyBusy}
                    title={busyHint || 'AI voice for this slide only'}
                  >
                    {hasClip && entry.source === 'generated' ? 'Regenerate' : 'AI voice'}
                  </ActionButton>
                  <ActionButton icon={Upload} onClick={() => fileRef.current?.click()} disabled={anyBusy} title="Upload an audio file (or drop one on this panel)">{hasClip ? 'Replace' : 'Upload'}</ActionButton>
                  <ActionButton icon={Mic} onClick={() => setRecording(true)} disabled={anyBusy} title="Record with your microphone">Record</ActionButton>
                  <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
                </div>
              )}
            </>
          )}

          {/* Script */}
          <div className="pt-1 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Script</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {entry?.script ? (entry.scriptOrigin === 'user' ? 'Edited by you' : 'Written by AI') : 'Not written yet'}
              </span>
              {status.scriptStale && <span className="text-xs text-amber-600 dark:text-amber-400">· notes changed</span>}
            </div>
            {busyHere && na.busy.kind === 'script' ? (
              <p className="text-sm text-primary-600 dark:text-primary-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Writing the script…</p>
            ) : (
              <ScriptBox key={`${slide.id}:${na.epoch}`} initial={entry?.script || ''} onSave={(text) => na.saveScript(slide.id, text)} disabled={anyBusy} />
            )}
            {!(busyHere && na.busy.kind === 'script') && <NumberChips numbers={status.numbers} />}
            <div className="flex items-center gap-3">
              <ActionButton icon={Sparkles} variant="ghost" onClick={() => na.writeScript(slide.id)} disabled={anyBusy} title={busyHint || 'Write the script from this slide\'s talking points'} className="px-2">
                {entry?.script ? 'Rewrite with AI' : 'Write with AI'}
              </ActionButton>
              {status.scriptStale && (
                <button type="button" onClick={() => na.markCurrent(slide.id)} className="text-xs text-gray-500 hover:underline">Keep as is</button>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">The AI voice reads this script. After editing it, press {hasClip && entry?.source === 'generated' ? 'Regenerate' : 'AI voice'}.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
