import { api } from "@/lib/api-client";

export type SiteSettingsDTO = {
  wishlistEnabled: boolean;
  buyNowEnabled: boolean;
  addToCartEnabled: boolean;
  requestSellerEnabled: boolean;
  footerCustomerCareNumber: string | null;
  /** Silent looping video for the login-screen background; null = gradient fallback. */
  loginVideoUrl: string | null;
};

export function getSiteSettings() {
  return api.get<SiteSettingsDTO>("/api/mobile/v1/site-settings", { auth: false });
}
