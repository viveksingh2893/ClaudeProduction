/**
 * Product description fields (spec item #1) are now sanitized HTML —
 * React Native has no HTML renderer, so <AppText> showing that string
 * verbatim would display literal tags. This strips markup down to plain
 * text so mobile shows readable (if unformatted) content instead of raw
 * HTML — a real limitation vs. the web rendering, not a bug: full rich
 * rendering here needs a dedicated React Native HTML renderer (e.g.
 * react-native-render-html), a separate follow-up.
 *
 * Deliberately a standalone local helper, not a re-export of
 * @kisan4u/validators's richTextVisibleLength/htmlToPlainTextExcerpt —
 * that module imports the Node-only sanitize-html package, which has no
 * business being pulled into the Expo/Metro bundle just for this.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}
