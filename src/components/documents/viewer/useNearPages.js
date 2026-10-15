"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Tracks which page elements are on screen or within `margin` of it, so only
// those get drawn. Returns the set of page numbers plus a ref-callback factory:
// <div ref={register(pageNum)} …>.
export function useNearPages(rootRef, margin = "150% 0px", enabled = true) {
  const [near, setNear] = useState(() => new Set());
  const observerRef = useRef(null);
  const elements = useRef(new Map());

  useEffect(() => {
    if (!enabled || !rootRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setNear((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const n = Number(e.target.dataset.page);
            if (e.isIntersecting) next.add(n);
            else next.delete(n);
          }
          return next;
        });
      },
      { root: rootRef.current, rootMargin: margin }
    );
    observerRef.current = observer;
    elements.current.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [rootRef, margin, enabled]);

  const callbacks = useRef(new Map());
  const register = useCallback((pageNum) => {
    if (!callbacks.current.has(pageNum)) {
      callbacks.current.set(pageNum, (el) => {
        const prev = elements.current.get(pageNum);
        if (prev && prev !== el) observerRef.current?.unobserve(prev);
        if (el) {
          elements.current.set(pageNum, el);
          observerRef.current?.observe(el);
        } else {
          elements.current.delete(pageNum);
        }
      });
    }
    return callbacks.current.get(pageNum);
  }, []);

  return { near, register, elements };
}
