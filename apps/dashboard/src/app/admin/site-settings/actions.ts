"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { saveSiteSettings } from "@kisan4u/catalog";
import { siteSettingsInputSchema } from "@kisan4u/validators";
import { requireSession } from "@/lib/session-guard";
import { revalidateStorefrontHomepage } from "@/lib/revalidate-storefront";

type Result = { ok: true } | { ok: false; error: string };

/**
 * The SiteSettings singleton — global feature toggles, rating threshold,
 * default delivery badge text, footer config (Product Card Design Spec
 * §Admin Panel Controls: "Wishlist/Buy Now/Add to Cart: Enable globally").
 * getSiteSettings() is read uncached everywhere on the storefront (see
 * apps/web/src/lib/card-context.ts, components/site-footer.tsx) so a
 * change here is already visible on next request without any cache to
 * invalidate — the revalidateStorefrontHomepage() ping is defensive only,
 * in case SiteSettings ever gets folded into a cached read path later.
 */
export async function saveSiteSettingsAction(rawInput: unknown): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = siteSettingsInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await saveSiteSettings(parsed.data);
  revalidatePath("/admin/site-settings");
  revalidateTag("homepage");
  await revalidateStorefrontHomepage();
  return { ok: true };
}
