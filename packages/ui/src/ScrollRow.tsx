"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Third deliberate exception to this package's normally state-free
 * convention (see Carousel.tsx/Modal.tsx doc comments) — a horizontal
 * "peek several cards, scroll for more" row, distinct from Carousel's
 * one-slide-at-a-time discrete pattern: Shop by Category and the three
 * manually-curated product sections (apps/web/src/components/homepage)
 * all need this exact primitive, so it lives here rather than being
 * duplicated four times.
 *
 * Native `overflow-x-auto` + scroll-snap gives touch swiping and keyboard
 * scrolling for free; the prev/next buttons and their visibility are the
 * only custom behaviour. No auto-rotation — this is a browse control, not
 * a slideshow.
 *
 * The native scrollbar is hidden (`scrollbar-width: none` +
 * `::-webkit-scrollbar`) — a raw scrollbar on top of the peeking cards and
 * the prev/next arrows reads as chrome that doesn't belong on a
 * storefront row. Swiping (touch), the arrows (pointer) and arrow-key
 * scrolling all still work.
 */
export type ScrollRowProps = {
  children: ReactNode[];
  ariaLabel: string;
  className?: string;
  itemClassName?: string;
};

export function ScrollRow({
  children,
  ariaLabel,
  className = "",
  itemClassName = "",
}: ScrollRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  function updateScrollState() {
    const el = ref.current;
    if (!el) return;
    setCanScrollPrev(el.scrollLeft > 4);
    setCanScrollNext(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measure whenever the item count changes (children.length is a stable proxy for identity here)
  }, [children.length]);

  function scrollByPage(direction: 1 | -1) {
    ref.current?.scrollBy({ left: direction * ref.current.clientWidth * 0.9, behavior: "smooth" });
  }

  if (children.length === 0) return null;

  return (
    <div className="relative">
      {canScrollPrev && (
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scrollByPage(-1)}
          className="absolute left-1 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow-card hover:bg-white"
        >
          ‹
        </button>
      )}
      <div
        ref={ref}
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
        className={`flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      >
        {children.map((child, i) => (
          <div key={i} className={`shrink-0 snap-start ${itemClassName}`}>
            {child}
          </div>
        ))}
      </div>
      {canScrollNext && (
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scrollByPage(1)}
          className="absolute right-1 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow-card hover:bg-white"
        >
          ›
        </button>
      )}
    </div>
  );
}
