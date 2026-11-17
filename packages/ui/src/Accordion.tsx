"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export type AccordionItem = {
  /** Stable key AND the value used for `defaultOpenKeys`. */
  key: string;
  title: ReactNode;
  content: ReactNode;
};

/**
 * Stacked, click-to-expand sections with a chevron — the storefront's
 * Flipkart-style "product details" pattern. State-ful (open set), so it's
 * a "use client" leaf like Modal/Carousel/ScrollRow. Every section is
 * independently collapsible; pass `defaultOpenKeys` to start some open
 * (e.g. the first). Renders nothing when `items` is empty.
 */
export function Accordion({
  items,
  defaultOpenKeys = [],
  className = "",
}: {
  items: AccordionItem[];
  defaultOpenKeys?: string[];
  className?: string;
}) {
  const groupId = useId();
  const [open, setOpen] = useState<Set<string>>(() => new Set(defaultOpenKeys));

  if (items.length === 0) return null;

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className={`divide-y divide-border rounded-2xl border border-border bg-surface ${className}`}>
      {items.map((item) => {
        const isOpen = open.has(item.key);
        const panelId = `${groupId}-${item.key}-panel`;
        const btnId = `${groupId}-${item.key}-btn`;
        return (
          <div key={item.key}>
            <h3>
              <button
                id={btnId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(item.key)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-[15px] font-bold text-ink transition-colors hover:bg-green-50/40 sm:px-6"
              >
                <span>{item.title}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={`h-5 w-5 shrink-0 text-gray-500 transition-transform ${
                    isOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={btnId}
              hidden={!isOpen}
              className="px-5 pb-5 pt-0 text-sm leading-relaxed text-ink sm:px-6"
            >
              {item.content}
            </div>
          </div>
        );
      })}
    </div>
  );
}
