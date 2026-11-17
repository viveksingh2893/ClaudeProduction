"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PromotionalAssetDTO } from "@kisan4u/catalog";

/**
 * Hero banner carousel for the Home tab and each category page (Flipkart
 * build spec §1/§5). A native scroll-snap track: exactly one centered
 * banner per view on mobile (no half-peek), ~1.5-2.3 with the next
 * peeking from `md:` up. Auto-advances on an eased
 * scroll every ~4s, pausing on hover / touch / when the tab is hidden. The
 * progress indicator is a row of dashes whose active one fills over the
 * autoplay interval. `aspect` differs by surface (2/1 home, 8/5 category).
 */
const AUTOPLAY_MS = 4000;

export function BannerCarousel({
  banners,
  aspect = "aspect-[2/1]",
}: {
  banners: PromotionalAssetDTO[];
  aspect?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const count = banners.length;

  const goTo = useCallback((i: number) => {
    const track = trackRef.current;
    if (!track) return;
    const slide = track.children[i] as HTMLElement | undefined;
    if (!slide) return;
    track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: "smooth" });
  }, []);

  // Reflect the nearest snapped slide back into `index` as the user scrolls.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const children = Array.from(track.children) as HTMLElement[];
        const mid = track.scrollLeft + track.clientWidth / 2;
        let nearest = 0;
        let best = Infinity;
        children.forEach((c, i) => {
          const center = c.offsetLeft - track.offsetLeft + c.clientWidth / 2;
          const d = Math.abs(center - mid);
          if (d < best) {
            best = d;
            nearest = i;
          }
        });
        setIndex(nearest);
      });
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      track.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (count <= 1 || paused) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    const id = setInterval(() => {
      setIndex((i) => {
        const next = (i + 1) % count;
        goTo(next);
        return next;
      });
    }, AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [count, paused, goTo]);

  if (count === 0) return null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Promotional banners"
      className="pt-3"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div
        ref={trackRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-4 [scrollbar-width:none] md:gap-6 md:px-6 lg:px-8 [&::-webkit-scrollbar]:hidden"
      >
        {banners.map((banner) => (
          <div
            key={banner.id}
            className="shrink-0 basis-full snap-center md:basis-[64%] md:snap-start lg:basis-[44%]"
          >
            <div className={`overflow-hidden rounded-2xl bg-neutral-100 ${aspect}`}>
              <BannerSlide banner={banner} />
            </div>
          </div>
        ))}
      </div>

      {count > 1 && (
        <div className="mt-3 flex justify-center gap-2" role="tablist" aria-label="Choose banner">
          {banners.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Go to banner ${i + 1}`}
              onClick={() => {
                setIndex(i);
                goTo(i);
              }}
              className={`h-1 overflow-hidden rounded-full bg-black/15 transition-[width] ${
                i === index ? "w-12" : "w-3"
              }`}
            >
              {i === index && (
                <span
                  key={`fill-${index}-${paused}`}
                  className="block h-full rounded-full bg-green-600"
                  style={
                    paused
                      ? { width: "100%" }
                      : { animation: `k4u-banner-fill ${AUTOPLAY_MS}ms linear forwards` }
                  }
                />
              )}
            </button>
          ))}
          <style>{`@keyframes k4u-banner-fill { from { width: 0% } to { width: 100% } }`}</style>
        </div>
      )}
    </section>
  );
}

function BannerSlide({ banner }: { banner: PromotionalAssetDTO }) {
  const image = (
    <picture>
      {banner.mobileImageUrl && (
        <source media="(max-width: 640px)" srcSet={banner.mobileImageUrl} />
      )}
      <img
        src={banner.desktopImageUrl}
        alt={banner.altText}
        className="h-full w-full object-cover"
        loading="eager"
        decoding="async"
      />
    </picture>
  );

  if (!banner.linkUrl) return image;

  const isExternal = /^https?:\/\//i.test(banner.linkUrl);
  if (isExternal) {
    return (
      <a href={banner.linkUrl} rel="noopener noreferrer" className="block h-full w-full">
        {image}
      </a>
    );
  }
  return (
    <Link href={banner.linkUrl} className="block h-full w-full">
      {image}
    </Link>
  );
}
