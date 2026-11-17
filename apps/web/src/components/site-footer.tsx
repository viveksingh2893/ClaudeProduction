import Link from "next/link";
import { CookieSettingsLink } from "@/components/meta/meta-tracking";
import { getSiteSettings } from "@kisan4u/catalog";
import { PageContainer } from "@kisan4u/ui";
import { LEGAL_LINKS } from "@/components/legal-page";
import { getT } from "@/i18n/server";
import { getBecomeDealerCta, becomeDealerCtaLabel } from "@/lib/become-dealer-cta";

type FooterLink = { label: string; href: string };
type SocialLink = { platform: string; href: string };

function asLinks(value: unknown): FooterLink[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is FooterLink => typeof v === "object" && v !== null && "label" in v && "href" in v,
  );
}
function asSocialLinks(value: unknown): SocialLink[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is SocialLink => typeof v === "object" && v !== null && "platform" in v && "href" in v,
  );
}

/**
 * Complete Design/Admin Spec §7.9: config-driven footer — marketing links
 * come from SiteSettings (admin/site-settings). The Legal column
 * (LEGAL_LINKS) and the registered-office block are static and always
 * rendered: they are mandatory for a payment-gateway / e-commerce review
 * and must never depend on an admin having configured them.
 */
export async function SiteFooter() {
  const [settings, { t }, dealerCta] = await Promise.all([
    getSiteSettings(),
    getT(),
    getBecomeDealerCta(),
  ]);
  const policyLinks = asLinks(settings.footerPolicyLinks).filter(
    // Drop any config link that duplicates a static Legal link.
    (l) => !LEGAL_LINKS.some((s) => s.href === l.href),
  );
  const socialLinks = asSocialLinks(settings.footerSocialLinks);
  const careNumber = settings.footerCustomerCareNumber || "+91 98265 75663";

  return (
    <footer className="mt-10 border-t border-border bg-green-900 px-4 py-10 text-white sm:px-6 lg:px-8">
      <PageContainer maxWidth="1400px">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-lg font-extrabold">Kisan4U</div>
            <p className="mt-2 max-w-xs text-sm text-white/75">{t("footer.tagline")}</p>
            <div className="mt-3 space-y-1 text-sm text-white/85">
              <p>
                Kisan4u Marketing Pvt. Ltd.
                <br />
                1304, Marathon Icon, NextGen Campus,
                <br />
                Lower Parel (West), Mumbai&nbsp;&ndash;&nbsp;400013
              </p>
              <p>
                {t("footer.customerCare")}: <span className="font-bold">{careNumber}</span>
              </p>
              <p>
                <a href="mailto:support@kisan4u.com" className="hover:text-white">
                  support@kisan4u.com
                </a>
              </p>
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-white/60">
              {t("footer.shop")}
            </div>
            <nav className="flex flex-col gap-1.5 text-sm text-white/85">
              <Link href="/products" className="hover:text-white">
                {t("footer.allProducts")}
              </Link>
              <Link href="/orders" className="hover:text-white">
                {t("footer.trackOrder")}
              </Link>
              {dealerCta.show && (
                <Link href={dealerCta.href} className="hover:text-white">
                  {dealerCta.status === "none"
                    ? t("footer.becomeDealer")
                    : becomeDealerCtaLabel(dealerCta.status)}
                </Link>
              )}
              <Link href="/seller/apply" className="hover:text-white">
                {t("footer.becomeSeller")}
              </Link>
            </nav>
          </div>

          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-white/60">
              {t("footer.legal")}
            </div>
            <nav className="flex flex-col gap-1.5 text-sm text-white/85">
              {LEGAL_LINKS.map((link) => (
                <Link key={link.href} href={link.href} className="hover:text-white">
                  {link.label}
                </Link>
              ))}
              {process.env.NEXT_PUBLIC_META_PIXEL_ID && (
                <CookieSettingsLink className="text-left hover:text-white" />
              )}
            </nav>
          </div>

          {policyLinks.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-white/60">
                {t("footer.more")}
              </div>
              <nav className="flex flex-col gap-1.5 text-sm text-white/85">
                {policyLinks.map((link) => (
                  <Link key={link.href} href={link.href} className="hover:text-white">
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>
          )}
        </div>

        {socialLinks.length > 0 && (
          <div className="mt-8 flex gap-4 border-t border-white/15 pt-6">
            {socialLinks.map((s) => (
              <a
                key={s.href}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.platform}
                className="text-sm font-semibold text-white/75 hover:text-white"
              >
                {s.platform}
              </a>
            ))}
          </div>
        )}

        <p className="mt-8 text-xs text-white/50">
          © {new Date().getFullYear()} Kisan4u Marketing Pvt. Ltd. All rights reserved.
        </p>
      </PageContainer>
    </footer>
  );
}
