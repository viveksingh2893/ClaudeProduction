import sanitizeHtml from "sanitize-html";

/**
 * Server-side sanitization for every rich-text product field (spec item
 * #1: shortDescription/description/ingredients/howToUse/
 * dosageInstructions/technicalInfo). This is the ONLY place HTML from the
 * product form is allowed to reach the database — client-side sanitation
 * in the editor is a UX nicety, never the security boundary. A strict
 * allowlist: no <script>, no event-handler attributes (anything not
 * explicitly allowlisted is dropped by sanitize-html by default), no
 * javascript:/data: URLs (allowedSchemes below), no inline style beyond
 * the one property the editor's alignment toolbar actually needs.
 */
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "img",
];

const ALIGNABLE = ["p", "h1", "h2", "h3", "h4", "li", "td", "th"];

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions["allowedAttributes"] = {
  a: ["href", "target", "rel"],
  img: ["src", "alt", "width", "height"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
  ...Object.fromEntries(ALIGNABLE.map((tag) => [tag, ["style"]])),
};

const ALLOWED_STYLES: sanitizeHtml.IOptions["allowedStyles"] = {
  "*": { "text-align": [/^(left|center|right|justify)$/] },
};

export function sanitizeProductRichText(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedStyles: ALLOWED_STYLES,
    // No data:/javascript: — a description image is always a URL already
    // produced by the platform's own upload pipeline, never an inline blob.
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https"] },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow" }),
    },
  }).trim();
}

/** Strips tags/entities down to visible text, for length checks and plain-text excerpts — never used to decide what to render (that's sanitizeProductRichText's job). */
function visibleText(html: string | null | undefined): string {
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

/** Spec: "Empty rich-text markup such as <p><br></p> must be treated as empty during required-field validation." */
export function isRichTextEmpty(html: string | null | undefined): boolean {
  return visibleText(html).length === 0;
}

export function richTextVisibleLength(html: string | null | undefined): number {
  return visibleText(html).length;
}

/** Safe plain-text excerpt for compact UI (product cards) — spec: "Use a safely generated plain-text excerpt where full HTML is unsuitable." */
export function htmlToPlainTextExcerpt(html: string | null | undefined, maxLength: number): string {
  const text = visibleText(html);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
