'use client';

import { useRef, useState, useCallback, useEffect } from 'react';

const IMAGE_POLL_INTERVAL_MS = 1500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Shared confirmation-gate mechanics for the "Ask Question" general-knowledge
// tool, used by both ChatInterface.jsx (project chat, `type` message field)
// and document/page.jsx (document chat, `role` message field). The hook only
// owns send/cancel/confirm mechanics and typing/progress/confirmation state —
// message-list shape and field naming stay with each caller.
//
// The subtle part this centralizes: while `pendingConfirmation` is active the
// request is NOT finished (input must stay disabled across the whole
// ask -> confirm -> respond sequence), but `sendMessage`'s `finally` block
// runs unconditionally on every code path, including the `needsConfirmation`
// early return. A local `awaitingConfirmation` flag, set inside the `try` and
// checked in `finally`, prevents that early return from clearing `isTyping`
// and re-enabling the input mid-flow.
//
// Image turns work the same way: when `ask` resolves with `pendingImage`
// (the worker is drawing it), the turn stays open while the job is polled,
// and `progress` carries the desktop's chat-progress shape
// ({ stage: 'generating_image', leadIn, status }) so the placeholder JSX is
// the desktop's. `resumeImageJob` picks a running job back up after a reload.
export function useChatEngine({ ask, onResult, onError, onCancelled }) {
  const [isTyping, setIsTyping] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState(null); // { requestId, query }
  const [progress, setProgress] = useState(null); // { stage: 'consulting_general_knowledge' | 'generating_image', ... } | null

  const abortControllerRef = useRef(null);
  const currentRequestIdRef = useRef(null);
  const imageJobRef = useRef(null); // { kind, messageId } while polling an image job
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  // Stop polling when the chat unmounts; the job itself carries on.
  useEffect(() => () => { imageJobRef.current = null; }, []);

  const finishTurn = useCallback(() => {
    setIsTyping(false);
    setIsCancelling(false);
    setProgress(null);
    abortControllerRef.current = null;
    currentRequestIdRef.current = null;
  }, []);

  // Polls a chat-image job until it leaves "generating". A failed job is a
  // persisted assistant message (the lead-in plus the error), so it arrives
  // through onResult like a normal answer. A cancelled one delivers nothing.
  const pollImageJob = useCallback(async ({ kind, messageId, leadIn, status, conversationId }) => {
    imageJobRef.current = { kind, messageId };
    const isCurrent = () => imageJobRef.current?.messageId === messageId;
    setIsTyping(true);
    setProgress({ stage: 'generating_image', leadIn, status: status || 'Reading the charts…' });
    try {
      while (isCurrent()) {
        await sleep(IMAGE_POLL_INTERVAL_MS);
        if (!isCurrent()) return;
        let job;
        try {
          const res = await fetch(`/api/chat-images/jobs/${encodeURIComponent(messageId)}?kind=${kind}`, { credentials: 'include' });
          if (res.status === 401 || res.status === 404) return;
          if (!res.ok) continue;
          job = await res.json();
        } catch {
          continue; // transient network error — keep polling
        }
        if (!isCurrent()) return;
        if (job.status === 'generating') {
          if (job.progress) setProgress((p) => ({ ...p, status: job.progress }));
          continue;
        }
        if (job.status === 'done') {
          onResultRef.current?.({ success: true, answer: job.answer, attachments: job.attachments || [], conversationId });
        } else if (job.status === 'error') {
          onResultRef.current?.({ success: true, answer: job.answer || job.error, attachments: [], conversationId, status: 'error' });
        }
        return;
      }
    } finally {
      if (isCurrent()) {
        imageJobRef.current = null;
        finishTurn();
      }
    }
  }, [finishTurn]);

  const resumeImageJob = useCallback(({ kind, messageId, leadIn, progress: status }) => {
    if (!messageId || imageJobRef.current?.messageId === messageId) return;
    pollImageJob({ kind, messageId, leadIn, status });
  }, [pollImageJob]);

  const sendMessage = useCallback(async (question, options) => {
    setIsTyping(true);
    setPendingConfirmation(null);
    setProgress(null);

    const controller = new AbortController();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    abortControllerRef.current = controller;
    currentRequestIdRef.current = requestId;

    let awaitingConfirmation = false;
    let awaitingImage = false;

    try {
      const res = await ask(question, requestId, controller.signal, options);

      if (controller.signal.aborted || currentRequestIdRef.current !== requestId) {
        return;
      }

      if (res?.needsConfirmation) {
        awaitingConfirmation = true;
        setPendingConfirmation({ requestId, query: res.query });
        return;
      }

      if (res?.pendingImage) {
        awaitingImage = true;
        pollImageJob({ ...res.pendingImage, conversationId: res.conversationId });
        return;
      }

      if (res?.success) {
        onResult?.(res);
      } else if (!res?.cancelled) {
        onError?.(res);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        onError?.({ error: 'Error contacting chat API.' });
      }
    } finally {
      if (!awaitingConfirmation && !awaitingImage) {
        setIsTyping(false);
        setIsCancelling(false);
        abortControllerRef.current = null;
        currentRequestIdRef.current = null;
      }
    }
  }, [ask, onResult, onError, pollImageJob]);

  const respondToConfirmation = useCallback(async (approved) => {
    const requestId = currentRequestIdRef.current;
    if (!requestId) return;

    setPendingConfirmation(null);
    setProgress({ stage: 'consulting_general_knowledge' });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch('/api/chat/respond-general-knowledge', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ requestId, approved }),
      }).then((r) => r.json());

      if (controller.signal.aborted || currentRequestIdRef.current !== requestId) {
        return;
      }

      if (res?.success) {
        onResult?.(res);
      } else if (!res?.cancelled) {
        onError?.(res);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        onError?.({ error: 'Error contacting chat API.' });
      }
    } finally {
      setIsTyping(false);
      setIsCancelling(false);
      setProgress(null);
      abortControllerRef.current = null;
      currentRequestIdRef.current = null;
    }
  }, [onResult, onError]);

  const cancelRequest = useCallback(async () => {
    const requestId = currentRequestIdRef.current;
    const imageJob = imageJobRef.current;
    if (!requestId && !imageJob) return;

    setIsCancelling(true);
    setIsTyping(false);
    setPendingConfirmation(null);
    setProgress(null);

    // Once the image job is queued, the route is done; cancel the job.
    if (imageJob) {
      imageJobRef.current = null;
      await fetch(`/api/chat-images/jobs/${encodeURIComponent(imageJob.messageId)}/cancel?kind=${imageJob.kind}`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {});
      setIsCancelling(false);
    } else {
      abortControllerRef.current?.abort();

      await fetch('/api/cancel', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      }).catch(() => {});
    }

    onCancelled?.();

    abortControllerRef.current = null;
    currentRequestIdRef.current = null;
  }, [onCancelled]);

  return {
    isTyping,
    isCancelling,
    pendingConfirmation,
    progress,
    sendMessage,
    respondToConfirmation,
    cancelRequest,
    resumeImageJob,
  };
}
