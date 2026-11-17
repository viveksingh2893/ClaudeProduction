"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Deliberate exception to this package's normally state-free convention
 * (see index.tsx's doc comment) — a carousel needs pointer/keyboard/timer
 * state, and both the unified ProductCard's image carousel (apps/web) and
 * the homepage hero banner (apps/web) need the exact same primitive, so it
 * has to live here rather than being duplicated per call site.
 */
export type CarouselProps = {
  slides: ReactNode[];
  /** Omit for no auto-rotation. Ignored when prefers-reduced-motion is set. */
  autoRotateMs?: number;
  showDots?: boolean;
  showArrows?: boolean;
  ariaLabel: string;
  className?: string;
  /**
   * Optional Tailwind aspect-ratio class (e.g. "aspect-[2/1]") applied to
   * every slide wrapper, so the carousel reserves the right height before
   * images load — used by the homepage/category hero banners. Omit and the
   * carousel takes whatever height its content/parent gives it (the
   * ProductCard usage, unchanged).
   */
  aspectRatio?: string;
  /**
   * "dots" (default) — small round dots. "progress" — the Flipkart-style
   * dash row: a wide active pill whose fill animates over one
   * autoRotateMs, short inactive dashes. Used by the hero banners.
   */
  indicator?: "dots" | "progress";
  /**
   * Optional controlled mode — pass both to let an external thumbnail
   * strip or variant selector drive (and observe) the active slide, e.g.
   * apps/web's ProductGallery. Omit both (the original usage, ProductCard
   * and the homepage hero) and the carousel manages its own index exactly
   * as before.
   */
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
};

export function Carousel({
  slides,
  autoRotateMs,
  showDots = true,
  showArrows = true,
  ariaLabel,
  className = "",
  aspectRatio,
  indicator = "dots",
  activeIndex,
  onActiveIndexChange,
}: CarouselProps) {
  const [internalIndex, setInternalIndex] = useState(0);
  const isControlled = activeIndex !== undefined;
  const index = isControlled ? activeIndex : internalIndex;
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const count = slides.length;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    if (!autoRotateMs || reducedMotion || paused || count <= 1 || isControlled) return;
    const id = setInterval(() => setInternalIndex((i) => (i + 1) % count), autoRotateMs);
    return () => clearInterval(id);
  }, [autoRotateMs, reducedMotion, paused, count, isControlled]);

  // Clamp if the slide count shrinks (e.g. an admin deactivates a banner) — uncontrolled mode only, a controlled index is the caller's responsibility.
  useEffect(() => {
    if (!isControlled && index >= count && count > 0) setInternalIndex(count - 1);
  }, [count, index, isControlled]);

  if (count === 0) return null;

  function goTo(next: number) {
    const clamped = ((next % count) + count) % count;
    if (isControlled) onActiveIndexChange?.(clamped);
    else setInternalIndex(clamped);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (count <= 1) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(index - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goTo(index + 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      goTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      goTo(count - 1);
    }
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current == null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartX.current;
    const delta = endX - touchStartX.current;
    touchStartX.current = null;
    const SWIPE_THRESHOLD = 40;
    if (delta > SWIPE_THRESHOLD) goTo(index - 1);
    else if (delta < -SWIPE_THRESHOLD) goTo(index + 1);
  }

  return (
    <div
      className={`relative h-full w-full ${className}`}
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{ touchAction: "pan-y" }}
    >
      {/*
        h-full/w-full on every level here (this div, and each slide
        wrapper below) is what lets a caller's fixed-aspect-ratio
        container (e.g. ProductCard/ProductGallery's `aspect-square`
        frame) actually reach the slide content — without it, a
        percentage height with no definite ancestor resolves to `auto`,
        so the slide silently falls back to its own image's intrinsic
        aspect ratio instead of the frame's. That was the real cause of
        "product cards aren't the same size": single-image products
        (no Carousel) rendered correctly; any multi-image product's
        card collapsed to that specific photo's own proportions.
        Callers that DON'T give this component a definite-height parent
        (the homepage banner/coupon carousels, which size themselves via
        aspect-ratio directly on their own <img>) are unaffected —
        h-full/w-full against an auto-height ancestor still just
        resolves to auto, so nothing changes for them.
      */}
      <div
        className="h-full w-full overflow-hidden"
        style={reducedMotion ? undefined : { transition: "opacity 200ms ease" }}
      >
        {slides.map((slide, i) => (
          <div
            key={i}
            aria-hidden={i !== index}
            hidden={i !== index}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}`}
            className={`h-full w-full ${aspectRatio ?? ""}`}
          >
            {slide}
          </div>
        ))}
      </div>

      {showArrows && count > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous slide"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              goTo(index - 1);
            }}
            className="absolute left-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow-card hover:bg-white"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next slide"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              goTo(index + 1);
            }}
            className="absolute right-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow-card hover:bg-white"
          >
            ›
          </button>
        </>
      )}

      {showDots && count > 1 && indicator === "dots" && (
        <div
          className="absolute inset-x-0 bottom-2 z-10 flex justify-center gap-1.5"
          role="tablist"
          aria-label="Slide selection"
        >
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Go to slide ${i + 1}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                goTo(i);
              }}
              className={`h-2 w-2 rounded-full transition-colors ${i === index ? "bg-earth-600" : "bg-white/70"}`}
            />
          ))}
        </div>
      )}

      {showDots && count > 1 && indicator === "progress" && (
        <div
          className="absolute inset-x-0 bottom-3 z-10 flex justify-center gap-2"
          role="tablist"
          aria-label="Slide selection"
        >
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Go to slide ${i + 1}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                goTo(i);
              }}
              className={`h-1 overflow-hidden rounded-full bg-black/15 transition-[width] ${
                i === index ? "w-12" : "w-3"
              }`}
            >
              {i === index && (
                <span
                  key={`fill-${index}`}
                  className="block h-full rounded-full bg-green-600"
                  style={
                    autoRotateMs && !reducedMotion && !paused
                      ? {
                          animation: `k4u-carousel-fill ${autoRotateMs}ms linear forwards`,
                        }
                      : { width: "100%" }
                  }
                />
              )}
            </button>
          ))}
          <style>{`@keyframes k4u-carousel-fill { from { width: 0% } to { width: 100% } }`}</style>
        </div>
      )}
    </div>
  );
}
