'use client';
import { useEffect, useRef, useState } from 'react';
import slidesApi from '@/lib/slidesApi';

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'n', 'N']);
const PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P']);

// PowerPoint's slide-show keys, shared by the presenter and audience windows
// (a presentation clicker sends PageDown/PageUp to whichever one has focus):
// next/previous, Home/End, number + Enter to jump, B/. black and W/, white
// screen, Esc to end. `extra(e)` handles window-specific keys first and
// returns true when it consumed one. Ignored while typing in an editable
// field, except Esc, which leaves the field instead of ending the show.
// Returns the digits typed so far ("Go to slide 1_" hint).
export function usePresentationKeys({ state, onEnd, extra }) {
  const [digits, setDigits] = useState('');
  const digitsRef = useRef('');
  const timerRef = useRef(null);
  const latest = useRef({});
  latest.current = { state, onEnd, extra };

  useEffect(() => {
    const setBuffer = (value) => {
      digitsRef.current = value;
      setDigits(value);
      clearTimeout(timerRef.current);
      if (value) timerRef.current = setTimeout(() => setBuffer(''), 2000);
    };

    const onKeyDown = (e) => {
      const { state: s, onEnd: end, extra: ex } = latest.current;
      const active = document.activeElement;
      const editing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (editing) {
        if (e.key === 'Escape') { e.preventDefault(); active.blur(); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) { if (ex?.(e)) e.preventDefault(); return; }
      if (ex?.(e)) { e.preventDefault(); return; }
      if (!s) return;
      const last = s.slideCount - 1;
      const goto = (i) => slidesApi.presentationGoto(Math.max(0, Math.min(last, i)));

      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); setBuffer(digitsRef.current + e.key); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (digitsRef.current) { goto(Number(digitsRef.current) - 1); setBuffer(''); } else goto(s.index + 1);
        return;
      }
      if (NEXT_KEYS.has(e.key)) { e.preventDefault(); goto(s.index + 1); }
      else if (PREV_KEYS.has(e.key)) { e.preventDefault(); goto(s.index - 1); }
      else if (e.key === 'Home') { e.preventDefault(); goto(0); }
      else if (e.key === 'End') { e.preventDefault(); goto(last); }
      else if (e.key === 'b' || e.key === 'B' || e.key === '.') { e.preventDefault(); slidesApi.presentationSetScreen(s.screen === 'black' ? 'normal' : 'black'); }
      else if (e.key === 'w' || e.key === 'W' || e.key === ',') { e.preventDefault(); slidesApi.presentationSetScreen(s.screen === 'white' ? 'normal' : 'white'); }
      else if (e.key === 'Escape') {
        e.preventDefault();
        if (s.screen !== 'normal') slidesApi.presentationSetScreen('normal');
        else end?.();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); clearTimeout(timerRef.current); };
  }, []);

  return digits;
}
