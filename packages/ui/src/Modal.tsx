"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Deliberate exception to this package's normally state-free convention
 * (see Carousel.tsx's doc comment for the same reasoning) — built on the
 * native <dialog> element, which already provides focus-trapping,
 * Escape-to-close, and top-layer stacking for free; this component only
 * wires that element's imperative API to a declarative `open` prop.
 */
export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
};

export function Modal({ open, onClose, title, children, className = "" }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Native <dialog> fills the viewport when open; a click that lands
        // on the backdrop area (the dialog element itself, not its content
        // wrapper below) means the user clicked outside the modal body.
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto max-h-[85vh] w-full max-w-lg rounded-xl border border-border bg-surface p-0 shadow-lift backdrop:bg-black/40 ${className}`}
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 id="modal-title" className="text-base font-bold text-ink">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-gray-600 hover:bg-green-50 hover:text-ink"
        >
          ✕
        </button>
      </div>
      <div className="max-h-[calc(85vh-57px)] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
}
