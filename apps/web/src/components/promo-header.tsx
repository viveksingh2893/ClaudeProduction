import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { getT } from "@/i18n/server";
import { getBecomeDealerCta, becomeDealerCtaLabel } from "@/lib/become-dealer-cta";
import { LanguageSwitcher } from "./language-switcher";

const CORPORATE_WEBSITE_URL = "https://corporate.kisan4u.com/";

/**
 * A slim green utility bar above the main SiteHeader/TopNav, mounted once
 * in the root layout so it appears on every page of the storefront —
 * never sticky (the TopNav below it already is), so it scrolls away with
 * the page instead of permanently eating viewport height.
 *
 * All three controls stay on a single line at every width: the language
 * switcher collapses to just its globe icon on mobile (see
 * LanguageSwitcher), and the two pills shrink their padding/text so the
 * row never wraps.
 */
export async function PromoHeader() {
  const [{ t, lang }, dealerCta] = await Promise.all([getT(), getBecomeDealerCta()]);
  return (
    <div className="bg-green-800 px-3 py-2 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1400px] flex-nowrap items-center justify-between gap-2">
        <LanguageSwitcher current={lang} />
        <div className="flex flex-nowrap items-center justify-end gap-1.5 sm:gap-2">
          {dealerCta.show && (
            <Link
              href={dealerCta.href}
              className="whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-green-800 transition-colors hover:bg-green-50 sm:px-4 sm:py-1.5 sm:text-[13px]"
            >
              {dealerCta.status === "none"
                ? t("ribbon.becomeDealer")
                : becomeDealerCtaLabel(dealerCta.status)}
            </Link>
          )}
          <a
            href={CORPORATE_WEBSITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-white/60 px-2.5 py-1 text-[11px] font-bold text-white transition-colors hover:bg-white/10 sm:gap-1.5 sm:px-4 sm:py-1.5 sm:text-[13px]"
          >
            {t("ribbon.corporateWebsite")}
            <ExternalLink className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}
