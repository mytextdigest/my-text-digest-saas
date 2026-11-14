'use client';
import { useEffect } from 'react';
import { useSession } from 'next-auth/react';

// The /present/* windows live outside the (app) route group (no sidebar
// shell), so they check the session themselves on mount and send a
// signed-out viewer to sign in. Renders nothing until the session is known.
export default function RequireSession({ children, fallback = null }) {
  const { status } = useSession();
  useEffect(() => {
    if (status !== 'unauthenticated') return;
    const back = window.location.pathname + window.location.search;
    window.location.replace(`/auth/signin?callbackUrl=${encodeURIComponent(back)}`);
  }, [status]);
  return status === 'authenticated' ? children : fallback;
}
