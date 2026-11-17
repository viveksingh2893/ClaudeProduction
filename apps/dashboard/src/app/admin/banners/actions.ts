"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import {
  listPromotionalAssets,
  savePromotionalAsset,
  deletePromotionalAsset,
} from "@kisan4u/catalog";
import { bannerInputSchema, dbLanguageEnum, type DbLanguage } from "@kisan4u/validators";
import { uploadCatalogImage, catalogImagePaths } from "@kisan4u/providers";
import { requireSession } from "@/lib/session-guard";
import { revalidateStorefrontHomepage } from "@/lib/revalidate-storefront";

type Result = { ok: true } | { ok: false; error: string };
type UploadResult = { ok: true; url: string } | { ok: false; error: string };

/** Upload one banner image (desktop or mobile). Returns the stored asset path to drop into the form's image field. */
export async function uploadBannerImageAction(file: File): Promise<UploadResult> {
  await requireSession(["ADMIN"]);
  const result = await uploadCatalogImage(file, catalogImagePaths.banner());
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "FILE_TOO_LARGE"
          ? "File is too large — the maximum size is 5MB."
          : result.error === "SIGNATURE_MISMATCH"
            ? "This file doesn't look like a real image."
            : "Unsupported file type — upload a JPEG, PNG, or WEBP image.",
    };
  }
  return { ok: true, url: result.url };
}
type BannerPlacement = "HERO" | "COUPON" | "HERO_SECONDARY";
type BannerAudience = "CUSTOMER" | "DEALER" | "COMMON";

/**
 * Dedicated admin surface for the homepage banner carousels — a focused
 * subset of PromotionalAsset (no schedule/CTA fields) rather than a new
 * model; see packages/validators/src/homepage.ts's bannerInputSchema doc
 * comment. Serves both the HERO carousel and the COUPON carousel (see
 * apps/web/src/components/homepage/coupon-banner-carousel.tsx), each
 * identified by its `placement` param, and now also split by `audience` —
 * customer and dealer viewers can see different banners (see the page's
 * AudienceToggle). Existing `COMMON` rows (shown to every viewer) are
 * preserved as-is on edit unless explicitly changed; every NEW banner is
 * always saved against whichever audience the admin currently has
 * selected, never COMMON. The old combined Homepage CMS "Hero, coupon &
 * join banners" screen (apps/dashboard/src/app/admin/homepage/banners)
 * still exists in the codebase but is no longer linked from admin nav —
 * this is now the only reachable way to manage HERO/COUPON banners, so this
 * and that screen must never both be reachable at once (two competing
 * editors for the same rows).
 */
async function revalidateBanners() {
  revalidatePath("/admin/banners");
  revalidateTag("homepage");
  await revalidateStorefrontHomepage();
}

export async function listBannersAction(
  placement: BannerPlacement = "HERO",
  audience?: "CUSTOMER" | "DEALER",
  language?: DbLanguage,
) {
  await requireSession(["ADMIN"]);
  return listPromotionalAssets(placement, audience, language);
}

export async function saveBannerAction(
  placement: BannerPlacement,
  audience: BannerAudience,
  // The banner's language. Like `audience`, this is passed explicitly rather
  // than living in bannerInputSchema so an edit preserves the row's own
  // language instead of silently reassigning it to the page toggle's value.
  language: DbLanguage,
  rawInput: unknown,
): Promise<Result> {
  await requireSession(["ADMIN"]);
  const lang = dbLanguageEnum.catch("EN").parse(language);
  const parsed = bannerInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await savePromotionalAsset({
    id: parsed.data.id,
    placement,
    audience,
    language: lang,
    categoryId: parsed.data.categoryId || "",
    desktopImageUrl: parsed.data.desktopImageUrl,
    mobileImageUrl: parsed.data.mobileImageUrl,
    altText: parsed.data.altText,
    linkUrl: parsed.data.linkUrl,
    priority: parsed.data.priority,
    isActive: parsed.data.isActive,
  });
  await revalidateBanners();
  return { ok: true };
}

export async function deleteBannerAction(placement: BannerPlacement, id: string): Promise<Result> {
  await requireSession(["ADMIN"]);
  await deletePromotionalAsset(id);
  await revalidateBanners();
  return { ok: true };
}
