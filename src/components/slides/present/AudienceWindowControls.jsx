'use client';
import { useEffect, useRef, useState } from 'react';
import { Maximize, MonitorUp, X } from 'lucide-react';
import { onAudienceControl, onPresentationState, moveAudienceToTab } from './presentationSession';

const HINT_KEY = 'mtd.presenter.audienceDragHintDismissed';
const HOVER_MS = 2000;

function readDismissed() {
  try { return localStorage.getItem(HINT_KEY) === 'true'; } catch (e) { return false; }
}

function goFullScreen() {
  document.documentElement.requestFullscreen?.().catch(() => {});
}

// Browser-only extras for the audience window (spec D5 and browser-forced
// differences 1 and 3), drawn over the unchanged AudienceView:
//   - keeps the window titled "MTD — Audience: <title>" (call apps list it);
//   - closes the window when the show ends;
//   - on a projector: "Click to go full screen" (the browser only allows
//     full screen after a click inside this window);
//   - in window mode: a one-time "Drag this window to the projector, then
//     click to go full screen" card, and "Open as a tab instead" (a tab keeps
//     rendering while covered; a popup window may not).
export default function AudienceWindowControls({ projector: projectorParam, isTab }) {
  const [projector, setProjector] = useState(!!projectorParam);
  const [fullscreen, setFullscreen] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(true);
  const [hover, setHover] = useState(false);
  const hoverTimer = useRef(null);

  useEffect(() => { setHintDismissed(readDismissed()); }, []);

  useEffect(() => onPresentationState((s) => {
    if (s?.title) document.title = `MTD — Audience: ${s.title}`;
    if (s?.mode) setProjector(s.mode === 'projector');
  }), []);

  useEffect(() => onAudienceControl((msg) => {
    if (msg?.type === 'close') window.close();
    else if (msg?.type === 'want-fullscreen') setProjector(true);
    else if (msg?.type === 'exit-fullscreen') {
      setProjector(false);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    } else if (msg?.type === 'focus') window.focus();
  }), []);

  useEffect(() => {
    const update = () => setFullscreen(!!document.fullscreenElement);
    update();
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  useEffect(() => {
    const onMove = () => {
      setHover(true);
      clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => setHover(false), HOVER_MS);
    };
    window.addEventListener('mousemove', onMove);
    return () => { window.removeEventListener('mousemove', onMove); clearTimeout(hoverTimer.current); };
  }, []);

  const dismissHint = () => {
    setHintDismissed(true);
    try { localStorage.setItem(HINT_KEY, 'true'); } catch (e) { /* private mode etc. */ }
  };

  if (fullscreen) return null;

  // On the projector: one click, anywhere, goes full screen.
  if (projector) {
    return (
      <button
        type="button"
        onClick={goFullScreen}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 text-white"
      >
        <span className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gray-800 ring-1 ring-white/10 shadow-2xl text-sm font-medium">
          <Maximize className="w-4 h-4" />Click to go full screen
        </span>
      </button>
    );
  }

  const stop = (e) => e.stopPropagation();

  if (!isTab && !hintDismissed) {
    return (
      <div onClick={stop} onContextMenu={stop} className="fixed bottom-5 right-5 z-50 w-80 rounded-xl bg-gray-800 ring-1 ring-white/10 shadow-2xl p-4 text-sm">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-9 h-9 rounded-full bg-primary-500/20 flex items-center justify-center">
            <MonitorUp className="w-4 h-4 text-primary-300" />
          </div>
          <p className="flex-1 text-gray-300 leading-relaxed">
            Presenting on a projector? Drag this window to the projector, then click to go full screen.
          </p>
          <button type="button" onClick={dismissHint} aria-label="Dismiss" className="shrink-0 text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button type="button" onClick={moveAudienceToTab} className="px-3 py-1.5 rounded-lg text-sm text-gray-300 hover:bg-white/10">Open as a tab instead</button>
          <button type="button" onClick={() => { dismissHint(); goFullScreen(); }} className="px-3 py-1.5 rounded-lg text-sm bg-primary-600 hover:bg-primary-500 text-white font-medium">Full screen</button>
        </div>
      </div>
    );
  }

  // Only while the mouse is over the window, so a shared feed doesn't show it.
  if (!hover) return null;
  return (
    <div onClick={stop} onContextMenu={stop} className="fixed top-3 right-3 z-50 flex gap-1.5">
      {!isTab && (
        <button type="button" onClick={moveAudienceToTab} className="px-3 py-1.5 rounded-lg bg-gray-800/90 ring-1 ring-white/10 text-xs text-gray-200 hover:bg-gray-700">
          Open as a tab instead
        </button>
      )}
      <button type="button" onClick={goFullScreen} className="px-3 py-1.5 rounded-lg bg-gray-800/90 ring-1 ring-white/10 text-xs text-gray-200 hover:bg-gray-700 inline-flex items-center gap-1.5">
        <Maximize className="w-3.5 h-3.5" />Full screen
      </button>
    </div>
  );
}
