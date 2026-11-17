import { getSiteSettings } from "@kisan4u/catalog";
import { jsonOk, withMobileApi } from "@/lib/mobile-api";

/** Public, admin-controlled feature flags + contact info — never exposes anything beyond what the website's footer/feature gates already show publicly. */
export async function GET() {
  return withMobileApi(async () => {
    const settings = await getSiteSettings();
    return jsonOk({
      wishlistEnabled: settings.wishlistEnabled,
      buyNowEnabled: settings.buyNowEnabled,
      addToCartEnabled: settings.addToCartEnabled,
      requestSellerEnabled: settings.requestSellerEnabled,
      footerCustomerCareNumber: settings.footerCustomerCareNumber,
      // Silent looping clip for the app's login-screen background (null = gradient fallback).
      loginVideoUrl: settings.loginVideoUrl ?? null,
    });
  });
}
