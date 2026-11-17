import { sanitizeProductRichText } from "@kisan4u/validators";

/**
 * The one place stored rich-text product HTML (spec item #1) is ever
 * rendered — a Server Component (no "use client") so sanitize-html's
 * Node-only htmlparser2 path runs server-side, never in the browser.
 * Re-sanitizes at render time even though packages/catalog/src/
 * product-submission.ts already sanitized at save time: defense in
 * depth, and the only way to safely render content saved before this
 * feature existed as plain, unsanitized text (sanitizing already-plain
 * text is a no-op — it has no tags to strip).
 */
export function SafeHtml({
  html,
  className,
}: {
  html: string | null | undefined;
  className?: string;
}) {
  const clean = sanitizeProductRichText(html);
  if (!clean) return null;
  return (
    <div
      className={`k4u-rich-content ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
