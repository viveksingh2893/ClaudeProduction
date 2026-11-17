import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { PromoHeader } from "@/components/promo-header";
import { SiteHeader } from "@/components/site-header";
import { CategoryBar } from "@/components/category-bar";
import { SiteFooter } from "@/components/site-footer";
import { BottomNav } from "@/components/bottom-nav";
import { PdpFooterSpacer } from "@/components/pdp-footer-spacer";
import { MetaTracking } from "@/components/meta/meta-tracking";
import { getStorefrontCartCount } from "@/lib/cart-badge";
import { META_CONSENT_COOKIE, type MetaConsent, type MetaUserMatch } from "@/lib/meta/shared";
import { hashedUserMatch } from "@/lib/meta/user-data";
import { getLanguage } from "@/i18n/server";
import { I18nProvider } from "@/i18n/client";
import { auth } from "@/auth";
import { Providers } from "./providers";
import { OpenInAppPrompt } from "@/components/open-in-app-prompt";

export const metadata: Metadata = {
  title: "Kisan4U — Storefront",
  description: "Kisan4U customer storefront for customers and dealers.",
  manifest: "/manifest.webmanifest",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [lang, cartCount, meta] = await Promise.all([
    getLanguage(),
    getStorefrontCartCount(),
    getMetaTrackingProps(),
  ]);
  return (
    <html lang={lang}>
      <body>
        <Providers>
          <I18nProvider lang={lang}>
            <PromoHeader />
            <SiteHeader />
            <CategoryBar />
            <div className="pb-16 md:pb-0">{children}</div>
            <SiteFooter />
            <PdpFooterSpacer />
            <BottomNav cartCount={cartCount} />
            <MetaTracking {...meta} />
            <OpenInAppPrompt />
          </I18nProvider>
        </Providers>
      </body>
    </html>
  );
}

/**
 * Consent as the server sees it, plus the signed-in buyer's hashed
 * phone / email for Meta's advanced matching — looked up only once they've
 * accepted cookies. See components/meta/meta-tracking.tsx.
 */
async function getMetaTrackingProps(): Promise<{
  pixelId: string | null;
  serverConsent: MetaConsent | null;
  userMatch: MetaUserMatch;
}> {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID || null;
  const raw = (await cookies()).get(META_CONSENT_COOKIE)?.value;
  const serverConsent: MetaConsent | null = raw === "granted" || raw === "denied" ? raw : null;
  if (!pixelId || serverConsent !== "granted") return { pixelId, serverConsent, userMatch: {} };
  const session = await auth();
  const userMatch = session?.user.id ? await hashedUserMatch(session.user.id) : {};
  return { pixelId, serverConsent, userMatch };
}
