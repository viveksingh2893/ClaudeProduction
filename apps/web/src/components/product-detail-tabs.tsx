"use client";

import { Accordion } from "@kisan4u/ui";

/**
 * Product detail sections as stacked Flipkart-style collapsibles
 * (Description / Ingredients / How to Use / Dosage) — only the sections
 * the page passed in (it already drops any with no content). The first
 * section starts open. `content` is server-sanitized HTML.
 */
export function ProductDetailTabs({
  tabs,
}: {
  tabs: { key: string; label: string; content: string }[];
}) {
  if (tabs.length === 0) return null;

  return (
    <Accordion
      defaultOpenKeys={tabs[0] ? [tabs[0].key] : []}
      items={tabs.map((tab) => ({
        key: tab.key,
        title: tab.label,
        content: (
          <div
            className="k4u-rich-content text-sm leading-relaxed text-ink"
            dangerouslySetInnerHTML={{ __html: tab.content }}
          />
        ),
      }))}
    />
  );
}
