import { z } from "zod";
import { mediaUrlSchema } from "./primitives";

/** [{ label, href }] — the config-driven footer link list (Complete Design/Admin Spec §7.9/§11.4). */
export const footerLinkSchema = z.object({
  label: z.string().trim().min(1, "Enter a label"),
  href: mediaUrlSchema,
});
export type FooterLinkInput = z.infer<typeof footerLinkSchema>;

export const footerSocialLinkSchema = z.object({
  platform: z.string().trim().min(1, "Enter a platform name"),
  href: mediaUrlSchema,
});
export type FooterSocialLinkInput = z.infer<typeof footerSocialLinkSchema>;

/** The SiteSettings singleton — global feature toggles + footer config (Product Card Design Spec §Admin Panel Controls). */
export const siteSettingsInputSchema = z.object({
  wishlistEnabled: z.boolean().default(true),
  buyNowEnabled: z.boolean().default(true),
  addToCartEnabled: z.boolean().default(true),
  requestSellerEnabled: z.boolean().default(true),
  ratingDisplayThreshold: z.coerce.number().int().min(0, "Must be zero or greater").default(5),
  defaultDeliveryBadgeText: z.string().trim().max(40).optional().or(z.literal("")),
  footerCustomerCareNumber: z.string().trim().max(30).optional().or(z.literal("")),
  footerPolicyLinks: z.array(footerLinkSchema).default([]),
  footerSocialLinks: z.array(footerSocialLinkSchema).default([]),
});
export type SiteSettingsInput = z.infer<typeof siteSettingsInputSchema>;
export type SiteSettingsRawInput = z.input<typeof siteSettingsInputSchema>;
