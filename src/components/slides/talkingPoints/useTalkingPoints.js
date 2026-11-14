'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { slideContentHash } from '@/lib/slides/talkingPoints.js';
import slidesApi from '@/lib/slidesApi';

// State + IPC for a deck's talking points (TALKING_POINTS_ROADMAP.md),
// shared by the side panel and the full-script view. `points` is the
// slideId → {html, origin, seconds, contentHash, updatedAt} map from the
// slide_talking_points table.
//
// `epoch` bumps whenever points are replaced from outside an editor
// (generation, or closing the full-script view). Editors are uncontrolled,
// so callers fold it into their `key` to remount with the fresh content.
export function useTalkingPoints(deckId, slides) {
  const [points, setPoints] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(null); // null | 'all' | slideId
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [epoch, setEpoch] = useState(0);

  // Reloaded whenever the deck's set of slides changes, not just on mount —
  // duplicate-slide copies a row server-side, and undoing a delete brings a
  // slide (and its existing row) back.
  const slideIdsKey = (slides || []).map((s) => s.id).join('|');
  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    slidesApi.getTalkingPoints(deckId).then((res) => {
      if (cancelled) return;
      if (res?.success) setPoints(res.points || {});
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [deckId, slideIdsKey]);

  // Points edited in another window (presenter view ↔ editor): refetch and
  // remount editors with the fresh content. The main process never sends this
  // to the window that made the change.
  useEffect(() => {
    if (!deckId) return undefined;
    return slidesApi.onTalkingPointsChanged?.((data) => {
      if (String(data?.deckId) !== String(deckId)) return;
      slidesApi.getTalkingPoints(deckId).then((res) => {
        if (!res?.success) return;
        setPoints(res.points || {});
        setEpoch((e) => e + 1);
      });
    });
  }, [deckId]);

  const save = useCallback(async (slideId, html) => {
    setSaveState('saving');
    const res = await slidesApi.saveTalkingPoints({ deckId, slideId, html });
    if (res?.success) {
      setPoints(res.points || {});
      setSaveState('saved');
    } else {
      setSaveState('error');
      setError(res?.error || 'Could not save your changes.');
    }
    return res;
  }, [deckId]);

  // "Keep as is" on the out-of-date banner.
  const markCurrent = useCallback(async (slideId) => {
    const res = await slidesApi.saveTalkingPoints({ deckId, slideId, markCurrent: true });
    if (res?.success) setPoints(res.points || {});
    else setError(res?.error || 'Could not update the talking points.');
  }, [deckId]);

  const generate = useCallback(async (slideId) => {
    setGenerating(slideId || 'all');
    setError(null);
    setNotice(null);
    const res = await slidesApi.generateTalkingPoints({ deckId, slideId });
    setGenerating(null);
    if (res?.success) {
      setPoints(res.points || {});
      setEpoch((e) => e + 1);
      if (res.missing > 0) {
        setNotice(`${res.missing} slide${res.missing === 1 ? '' : 's'} didn't get talking points. Open ${res.missing === 1 ? 'it' : 'them'} and use "Generate for this slide".`);
      }
    } else {
      setError(res?.error || "Couldn't generate talking points.");
    }
    return res;
  }, [deckId]);

  const exportPdf = useCallback(async () => {
    setError(null);
    const res = await slidesApi.exportTalkingPointsPdf({ deckId });
    if (!res?.success && !res?.canceled) setError(res?.error || 'Could not create the PDF.');
    return res;
  }, [deckId]);

  const refreshEditors = useCallback(() => setEpoch((e) => e + 1), []);

  // Per-slide status, aligned with `slides`: null (none) | 'ok' | 'stale'.
  const statusBySlide = useMemo(() => (slides || []).map((s) => {
    const p = points[s.id];
    if (!p) return null;
    return p.contentHash && p.contentHash !== slideContentHash(s) ? 'stale' : 'ok';
  }), [slides, points]);

  const summary = useMemo(() => {
    const list = slides || [];
    const withPoints = list.filter((s) => points[s.id]);
    return {
      covered: withPoints.length,
      total: list.length,
      seconds: withPoints.reduce((sum, s) => sum + (points[s.id].seconds || 0), 0),
      stale: statusBySlide.filter((st) => st === 'stale').length,
    };
  }, [slides, points, statusBySlide]);

  return {
    points, loaded, generating, error, setError, notice, setNotice, saveState, epoch,
    save, markCurrent, generate, exportPdf, refreshEditors, statusBySlide, summary,
  };
}
