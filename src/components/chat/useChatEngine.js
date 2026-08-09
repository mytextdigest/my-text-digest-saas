'use client';

import { useRef, useState, useCallback } from 'react';

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
export function useChatEngine({ ask, onResult, onError, onCancelled }) {
  const [isTyping, setIsTyping] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState(null); // { requestId, query }
  const [progress, setProgress] = useState(null); // { stage: 'consulting_general_knowledge' } | null

  const abortControllerRef = useRef(null);
  const currentRequestIdRef = useRef(null);

  const sendMessage = useCallback(async (question) => {
    setIsTyping(true);
    setPendingConfirmation(null);
    setProgress(null);

    const controller = new AbortController();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    abortControllerRef.current = controller;
    currentRequestIdRef.current = requestId;

    let awaitingConfirmation = false;

    try {
      const res = await ask(question, requestId, controller.signal);

      if (controller.signal.aborted || currentRequestIdRef.current !== requestId) {
        return;
      }

      if (res?.needsConfirmation) {
        awaitingConfirmation = true;
        setPendingConfirmation({ requestId, query: res.query });
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
      if (!awaitingConfirmation) {
        setIsTyping(false);
        setIsCancelling(false);
        abortControllerRef.current = null;
        currentRequestIdRef.current = null;
      }
    }
  }, [ask, onResult, onError]);

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
    if (!requestId) return;

    setIsCancelling(true);
    setIsTyping(false);
    setPendingConfirmation(null);
    setProgress(null);

    abortControllerRef.current?.abort();

    await fetch('/api/cancel', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId }),
    }).catch(() => {});

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
  };
}
