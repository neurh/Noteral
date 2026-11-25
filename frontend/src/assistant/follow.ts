import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

/** How close to the bottom (px) still counts as "following". */
const SLACK = 24;

/**
 * Keeps a scrolling box pinned to its newest content while it streams: each time `content`
 * changes the box scrolls to the bottom, unless the reader has scrolled up to look at
 * something earlier. Scrolling back down resumes following. `always` ignores the reader
 * (for previews that can't be scrolled by hand).
 */
export function useFollow<T extends HTMLElement>(content: unknown, always = false): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const following = useRef(true);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || always) return;
    const onScroll = () => {
      following.current = node.scrollHeight - node.scrollTop - node.clientHeight <= SLACK;
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (always || following.current) node.scrollTop = node.scrollHeight;
  }, [content, always]);

  return ref;
}
