"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Wraps a wide table in two horizontally-scrollable areas — a thin
 * scrollbar strip ABOVE the table plus the usual scroll container around
 * it — and keeps their scroll positions in sync. On a tall table the
 * bottom scrollbar is out of reach without scrolling past every row; this
 * puts one at the top too. The top strip collapses to nothing when the
 * table isn't actually wider than its container, so narrow tables look
 * exactly as before.
 *
 * Deliberate "use client" leaf (same reasoning as DataTable/Modal) —
 * TableShell stays a state-free server-compatible component and just
 * renders this around its children.
 */
export function TableScrollArea({ children }: { children: ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const body = bodyRef.current;
    const spacer = spacerRef.current;
    if (!body || !spacer) return;

    const measure = () => {
      const width = body.scrollWidth;
      spacer.style.width = `${width}px`;
      setOverflowing(width - body.clientWidth > 1);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    if (body.firstElementChild) ro.observe(body.firstElementChild);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [children]);

  const mirror = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || isSyncing.current) return;
    isSyncing.current = true;
    to.scrollLeft = from.scrollLeft;
    // release on the next frame so the programmatic scroll doesn't echo back
    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  };

  return (
    <div>
      <div
        ref={topRef}
        onScroll={() => mirror(topRef.current, bodyRef.current)}
        aria-hidden="true"
        className="overflow-x-auto overflow-y-hidden"
        style={{ height: overflowing ? 12 : 0 }}
      >
        <div ref={spacerRef} style={{ height: 1 }} />
      </div>
      <div
        ref={bodyRef}
        onScroll={() => mirror(bodyRef.current, topRef.current)}
        className="overflow-x-auto"
      >
        {children}
      </div>
    </div>
  );
}
