import { z } from "zod";

// Shared across packages/validators/src/catalog.ts and pricing.ts — split
// out to a standalone module (no dependency on either) so those two files
// can import from here without a circular import between them.

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens only");

/**
 * Never downloads or stores the remote file — only the URL string itself
 * is persisted (see requirement: "do not pretend the file is uploaded to
 * Kisan4U storage"). Parses with the real `URL` constructor (not a regex)
 * so genuinely malformed input is rejected, and only ever accepts the
 * `http:`/`https:` schemes or a same-origin-relative local path (e.g.
 * "/demo/products/x.jpg", used by seed data since there's no upload/
 * storage provider yet) — `javascript:`, `data:`, and every other scheme
 * fail here structurally, not by pattern-matching a blocklist.
 */
function isSafeMediaUrl(value: string): boolean {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export const mediaUrlSchema = z
  .string()
  .trim()
  .refine(isSafeMediaUrl, "Enter a valid https:// URL (or a local path starting with /)");

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com"]);
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);

/**
 * Same safe-scheme rule as mediaUrlSchema, applied to product videos.
 * Storage is always just the URL — rendering is a separate concern (see
 * apps/web's video-embed component): a YouTube/Vimeo URL is turned into a
 * safe embed built from an extracted video id, anything else renders as a
 * plain link, and raw iframe/HTML is never accepted from user input.
 */
export const videoUrlSchema = z
  .string()
  .trim()
  .refine(isSafeMediaUrl, "Enter a valid https:// video URL");

export type VideoEmbedKind = "youtube" | "vimeo" | "link";

/** Pure, reusable classifier so the schema's notion of "safe video host" and the renderer's embed choice never drift apart. */
export function classifyVideoUrl(value: string): { kind: VideoEmbedKind; embedId: string | null } {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (YOUTUBE_HOSTS.has(host)) {
      const id = host === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
      return { kind: "youtube", embedId: id || null };
    }
    if (VIMEO_HOSTS.has(host)) {
      const id = url.pathname.split("/").filter(Boolean).pop() ?? null;
      return { kind: "vimeo", embedId: id };
    }
  } catch {
    // fall through to "link" for a relative path or anything unparseable
  }
  return { kind: "link", embedId: null };
}

export const moneySchema = z.coerce.number().min(0, "Must be zero or greater");
export const positiveIntSchema = z.coerce.number().int().min(1, "Must be at least 1");
export const nonNegativeIntSchema = z.coerce.number().int().min(0, "Must be zero or greater");

/** Shipment weight is always whole grams — never a fractional/floating kilogram value (matches LogisticsWeightSlab's own precision rule). */
export const weightGramsSchema = z.coerce.number().int().min(1, "Weight must be greater than zero");

export const activeToggleSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean(),
});
export type ActiveToggleInput = z.infer<typeof activeToggleSchema>;

/** Server-side slug generation — the bulk-product-entry translator's fallback when a group's slug field is left blank (spec: "generate it safely from the product name"); mirrors the client-side slugify already used ad hoc in apps/dashboard/src/components/product-form.tsx, centralized here so both entry points agree on the exact same transform. */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}
