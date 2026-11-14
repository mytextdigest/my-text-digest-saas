'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, RotateCcw, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { formatClock } from '../present/usePresentation';
import slidesApi from '@/lib/slidesApi';

const MAX_RECORDING_MS = 10 * 60 * 1000;
const COUNTDOWN_FROM = 3;

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t)) || '';
}

function extensionFor(mime) {
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('mp4')) return '.m4a';
  return '.webm';
}

function micErrorMessage(err) {
  const name = err?.name || '';
  // The browser asks for the microphone itself (spec browser-forced
  // difference 5); a denial is undone in its site settings.
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access is blocked. Allow microphone access for this site in your browser\'s site settings, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Plug one in and try again.';
  if (name === 'NotReadableError') return 'The microphone is being used by another app. Close it and try again.';
  return err?.message || 'Could not start recording.';
}

// In-app recording for one slide (SLIDE_AUDIO_ROADMAP.md Phase 5):
// 3-2-1 countdown → recording (level meter + time) → listen back, re-record
// or save. The slide's talking points stay visible above it as a prompt.
export default function AudioRecorder({ onSave, onCancel, saving }) {
  const [phase, setPhase] = useState('starting'); // starting | countdown | recording | review | error
  const [count, setCount] = useState(COUNTDOWN_FROM);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState(null);
  const [take, setTake] = useState(null); // {blob, url, durationMs, ext}
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);
  const timersRef = useRef([]);
  const startedAtRef = useRef(0);
  const takeUrlRef = useRef(null);
  // Each begin() gets a token; anything still awaiting from an older attempt
  // (or after unmount) sees it's stale and lets go of the microphone.
  const sessionRef = useRef(null);

  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current.forEach(clearInterval); timersRef.current = []; };

  const releaseMic = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
  };

  const begin = async () => {
    const session = {};
    sessionRef.current = session;
    const stale = () => sessionRef.current !== session;
    setError(null);
    setPhase('starting');
    try {
      const access = await slidesApi.requestMicrophoneAccess?.();
      if (stale()) return;
      if (access && access.granted === false) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (stale()) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;

      // Level meter.
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
        setLevel((prev) => Math.max(peak, prev * 0.85));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      setCount(COUNTDOWN_FROM);
      setPhase('countdown');
      for (let i = 1; i <= COUNTDOWN_FROM; i++) {
        timersRef.current.push(setTimeout(() => {
          if (stale()) return;
          if (i < COUNTDOWN_FROM) setCount(COUNTDOWN_FROM - i);
          else startRecording(stream);
        }, i * 1000));
      }
    } catch (err) {
      if (stale()) return;
      releaseMic();
      setError(micErrorMessage(err));
      setPhase('error');
    }
  };

  const startRecording = (stream) => {
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const durationMs = Date.now() - startedAtRef.current;
      const type = recorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type });
      releaseMic();
      if (!blob.size) { setError('Nothing was recorded. Check your microphone and try again.'); setPhase('error'); return; }
      if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
      const objectUrl = URL.createObjectURL(blob);
      takeUrlRef.current = objectUrl;
      setTake({ blob, url: objectUrl, durationMs, ext: extensionFor(type) });
      setPhase('review');
    };
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    recorder.start(1000);
    setElapsed(0);
    setPhase('recording');
    const iv = setInterval(() => {
      const ms = Date.now() - startedAtRef.current;
      setElapsed(ms);
      if (ms >= MAX_RECORDING_MS) stop();
    }, 250);
    timersRef.current.push(iv);
  };

  const stop = () => {
    clearTimers();
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    else releaseMic();
  };

  const cancel = () => {
    sessionRef.current = null;
    clearTimers();
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    releaseMic();
    onCancel();
  };

  const save = () => {
    if (!take) return;
    const file = new File([take.blob], `recording${take.ext}`, { type: take.blob.type });
    onSave(file, take.durationMs);
  };

  useEffect(() => {
    begin();
    return () => {
      sessionRef.current = null;
      clearTimers();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      releaseMic();
      if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800/50">
      {phase === 'error' && (
        <>
          <p className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onCancel}>Close</Button>
            <Button size="sm" className="h-7 text-xs" onClick={begin}>Try again</Button>
          </div>
        </>
      )}

      {(phase === 'starting' || phase === 'countdown' || phase === 'recording') && (
        <div className="flex items-center gap-3">
          <div className={cn(
            'shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white',
            phase === 'recording' ? 'bg-red-500 animate-pulse' : 'bg-gray-400 dark:bg-gray-600'
          )}>
            {phase === 'countdown' ? <span className="text-base font-bold tabular-nums">{count}</span>
              : phase === 'starting' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-gray-800 dark:text-gray-100">
              {phase === 'starting' && 'Getting the microphone ready…'}
              {phase === 'countdown' && 'Recording starts in…'}
              {phase === 'recording' && <span className="tabular-nums">Recording · {formatClock(elapsed)}</span>}
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden" title="Microphone level">
              <div className={cn('h-full rounded-full transition-[width] duration-75', level > 0.9 ? 'bg-red-500' : 'bg-emerald-500')} style={{ width: `${Math.min(100, level * 140)}%` }} />
            </div>
          </div>
          {phase === 'recording' ? (
            <Button size="sm" onClick={stop} className="h-8 text-xs bg-red-600 hover:bg-red-700 flex items-center gap-1.5">
              <Square className="w-3 h-3 fill-current" />Stop
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={cancel} className="h-8 w-8 p-0" aria-label="Cancel recording"><X className="w-4 h-4" /></Button>
          )}
        </div>
      )}

      {phase === 'review' && take && (
        <>
          <div className="text-xs font-medium text-gray-800 dark:text-gray-100 mb-1.5 tabular-nums">Your recording · {formatClock(take.durationMs)}</div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={take.url} className="w-full h-8 mb-2" />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={cancel} disabled={saving} className="h-7 text-xs px-2">Cancel</Button>
            <span className="flex-1" />
            <Button size="sm" variant="outline" onClick={() => { setTake(null); begin(); }} disabled={saving} className="h-7 text-xs flex items-center gap-1">
              <RotateCcw className="w-3 h-3" />Re-record
            </Button>
            <Button size="sm" onClick={save} disabled={saving} className="h-7 text-xs flex items-center gap-1">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}Save
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
