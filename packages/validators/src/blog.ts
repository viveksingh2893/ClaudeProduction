import { z } from "zod";
import { slugSchema, mediaUrlSchema } from "./primitives";
import { isRichTextEmpty } from "./rich-text";

export { slugSchema as blogCategorySlugSchema };

// Reserved top-level segments under /blog/ — a custom URL can never collide
// with one of these even though no such routes exist yet (spec: "Do not
// allow a custom URL that conflicts with a reserved blog route").
export const RESERVED_BLOG_SLUGS = new Set([
  "new",
  "edit",
  "admin",
  "category",
  "categories",
  "page",
  "pages",
  "tag",
  "tags",
  "rss",
  "feed",
  "sitemap",
  "search",
  "api",
]);

/**
 * The "Custom URL" field — the path segment after /blog/. Deliberately NOT
 * the shared `slugSchema` from primitives.ts: that one lowercases on parse,
 * which is correct for every other slug in this codebase but wrong here —
 * spec requires preserving the admin's exact casing ("Dealer-Benifit" stays
 * "Dealer-Benifit") while still restricting the character set to letters/
 * numbers/hyphens and rejecting "/", "?", "#", whitespace, and stray
 * leading/trailing/doubled hyphens. Case-INSENSITIVE uniqueness is enforced
 * separately at the query layer (packages/catalog/src/blog.ts, `mode:
 * "insensitive"` — the same convention already used elsewhere in this
 * codebase for duplicate checks; there's no citext/collation trick here).
 */
export const blogSlugSchema = z
  .string()
  .trim()
  .min(1, "Enter a custom URL")
  .max(200, "Custom URL is too long")
  .regex(
    /^[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*$/,
    "Use only letters, numbers, and hyphens — no spaces or symbols",
  )
  .refine((v) => !RESERVED_BLOG_SLUGS.has(v.toLowerCase()), {
    message: "This URL is reserved — choose a different one",
  });

export const blogFeaturedPositionSchema = z
  .union([z.coerce.number().int().positive("Must be a positive whole number"), z.null()])
  .optional();

/**
 * `body` is validated separately from the rest via isRichTextEmpty (spec:
 * "Body: required and cannot contain only empty markup" — TipTap saves an
 * empty editor as "<p></p>", which .min(1) alone would happily accept).
 * Sanitization itself happens at the mutation layer
 * (sanitizeProductRichText, reused as-is — see packages/catalog/src/blog.ts)
 * right before this schema's own validation, so what's checked here is
 * already-clean HTML.
 */
export const blogInputSchema = z.object({
  title: z.string().trim().min(3, "Enter a title").max(200, "Title is too long"),
  slug: blogSlugSchema,
  headerImageUrl: mediaUrlSchema,
  headerImageAlt: z.string().trim().min(1, "Enter alt text for the header image").max(200),
  categoryId: z.string().min(1, "Select a category"),
  bodyHtml: z.string().refine((v) => !isRichTextEmpty(v), "Write the blog body"),
  // Blank/whitespace-only is normalized to "Kisan4U Editor" at the mutation
  // layer, not here — this schema only rejects something actively invalid
  // (there isn't anything to reject for an optional free-text name).
  writer: z.string().trim().max(120).optional().or(z.literal("")),
  metaDescription: z
    .string()
    .trim()
    .min(1, "Enter a meta description")
    .max(300, "Meta description is too long"),
  featuredPosition: blogFeaturedPositionSchema,
});
export type BlogInput = z.infer<typeof blogInputSchema>;

export const blogCategoryInputSchema = z.object({
  name: z.string().trim().min(2, "Enter a category name").max(80, "Category name is too long"),
  slug: slugSchema,
});
export type BlogCategoryInput = z.infer<typeof blogCategoryInputSchema>;
