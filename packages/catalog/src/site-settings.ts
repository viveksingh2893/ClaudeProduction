import { prisma } from "@kisan4u/db";
import type { SiteSettingsInput } from "@kisan4u/validators";

/** Safe defaults if the singleton row is somehow missing (should always exist after seed.ts) — read-only fallback, never blocks the storefront. */
const DEFAULTS = {
  id: "singleton",
  wishlistEnabled: true,
  buyNowEnabled: true,
  addToCartEnabled: true,
  requestSellerEnabled: true,
  ratingDisplayThreshold: 5,
  defaultDeliveryBadgeText: null,
  footerCustomerCareNumber: null,
  footerPolicyLinks: null,
  footerSocialLinks: null,
  loginVideoUrl: null,
  updatedAt: new Date(0),
} as const;

export async function getSiteSettings() {
  const row = await prisma.siteSettings.findUnique({ where: { id: "singleton" } });
  return row ?? DEFAULTS;
}

/**
 * The mobile app's login-screen background video — its own tiny writer,
 * separate from the big saveSiteSettings() form, because it's set from a
 * dedicated admin page (/admin/app-login-video) and is either an uploaded
 * file URL or a pasted external URL. `null` clears it (app shows the
 * gradient fallback).
 */
export async function saveLoginVideoUrl(url: string | null) {
  const value = url?.trim() || null;
  return prisma.siteSettings.upsert({
    where: { id: "singleton" },
    update: { loginVideoUrl: value },
    create: { id: "singleton", loginVideoUrl: value },
  });
}

export async function saveSiteSettings(input: SiteSettingsInput) {
  const data = {
    wishlistEnabled: input.wishlistEnabled,
    buyNowEnabled: input.buyNowEnabled,
    addToCartEnabled: input.addToCartEnabled,
    requestSellerEnabled: input.requestSellerEnabled,
    ratingDisplayThreshold: input.ratingDisplayThreshold,
    defaultDeliveryBadgeText: input.defaultDeliveryBadgeText || null,
    footerCustomerCareNumber: input.footerCustomerCareNumber || null,
    footerPolicyLinks: input.footerPolicyLinks,
    footerSocialLinks: input.footerSocialLinks,
  };
  return prisma.siteSettings.upsert({
    where: { id: "singleton" },
    update: data,
    create: { id: "singleton", ...data },
  });
}
