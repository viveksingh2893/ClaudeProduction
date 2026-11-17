"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";

export type LightboxImage = { id: string; url: string; altText?: string | null };

const MAX_SCALE = 4;
const MIN_SCALE = 1;
const DOUBLE_TAP_SCALE = 2.5;

/**
 * Full-screen zoomable viewer for the product gallery. Opened by clicking
 * the main image (or its magnifier button). Click / tap the image to
 * toggle a 2.5x zoom centred on the point pressed; scroll-wheel zooms
 * finely on desktop; drag to pan while zoomed. Arrow keys / on-screen
 * arrows move between images; Esc, the ✕, or a click on the backdrop
 * closes it. Portalled to <body> so the gallery's own overflow-hidden /
 * transformed ancestors can't clip it.
 */
export function ProductImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: LightboxImage[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const originRef = useRef({ x: 50, y: 50 });
  const dragRef = useRef<{
    x: number;
    y: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null>(null);
  const imgWrapRef = useRef<HTMLDivElement>(null);

  const current = images[index];

  const resetZoom = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    originRef.current = { x: 50, y: 50 };
  }, []);

  const go = useCallback(
    (delta: number) => {
      if (images.length < 2) return;
      resetZoom();
      onIndexChange((index + delta + images.length) % images.length);
    },
    [images.length, index, onIndexChange, resetZoom],
  );

  useEffect(() => {
    setMounted(true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [go, onClose]);

  if (!mounted || !current) return null;

  function pointFromEvent(e: { clientX: number; clientY: number }) {
    const el = imgWrapRef.current;
    if (!el) return { x: 50, y: 50 };
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)),
      y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)),
    };
  }

  function toggleZoom(e: React.MouseEvent) {
    if (dragRef.current?.moved) return;
    if (scale > 1) {
      resetZoom();
    } else {
      originRef.current = pointFromEvent(e);
      setScale(DOUBLE_TAP_SCALE);
    }
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale - Math.sign(e.deltaY) * 0.35));
    if (next === 1) {
      resetZoom();
      return;
    }
    if (scale === 1) originRef.current = pointFromEvent(e);
    setScale(next);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (scale <= 1) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y, moved: false };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    setOffset({ x: d.ox + dx, y: d.oy + dy });
  }

  function onPointerUp() {
    // keep `moved` readable for the click handler that fires right after,
    // then clear on the next tick
    const d = dragRef.current;
    setTimeout(() => {
      if (dragRef.current === d) dragRef.current = null;
    }, 0);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Product image viewer"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            aria-label="Previous image"
            className="absolute left-2 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:left-4"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            aria-label="Next image"
            className="absolute right-2 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:right-4"
          >
            <ChevronRight className="h-6 w-6" aria-hidden="true" />
          </button>
        </>
      )}

      <div
        ref={imgWrapRef}
        className="relative flex h-full w-full items-center justify-center p-6 sm:p-12"
        onClick={(e) => e.stopPropagation()}
        onWheel={onWheel}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={current.altText ?? ""}
          draggable={false}
          onClick={toggleZoom}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: `${originRef.current.x}% ${originRef.current.y}%`,
            transition: dragRef.current ? "none" : "transform 0.18s ease-out",
            cursor: scale > 1 ? "grab" : "zoom-in",
            touchAction: "none",
          }}
          className="max-h-full max-w-full select-none object-contain"
        />
      </div>

      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white">
          {index + 1} / {images.length}
        </div>
      )}
    </div>,
    document.body,
  );
}

/** Small magnifier affordance overlaid on the inline gallery image. */
export function ZoomHintButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Zoom image"
      className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-ink shadow-sm backdrop-blur-sm transition-colors hover:bg-white"
    >
      <ZoomIn className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
