"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Auto-scroll a container to the bottom as `count` grows, unless the user has
 * scrolled up — then pause and report how many items arrived since.
 */
export function useStickToBottom(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [seenCount, setSeenCount] = useState(count);
  const programmatic = useRef(false);

  const scrollToEnd = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    programmatic.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => (programmatic.current = false));
  }, []);

  useLayoutEffect(() => {
    if (!paused) scrollToEnd();
  }, [count, paused, scrollToEnd]);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el || programmatic.current) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 16;
    if (paused && atBottom) setPaused(false);
    else if (!paused && !atBottom) {
      setPaused(true);
      setSeenCount(count);
    }
  }, [count, paused]);

  const resume = useCallback(() => {
    setPaused(false);
    scrollToEnd();
  }, [scrollToEnd]);

  return { ref, onScroll, paused, newCount: paused ? Math.max(0, count - seenCount) : 0, resume };
}
