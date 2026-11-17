import Link from "next/link";
import { PageContainer } from "@kisan4u/ui";
import type { PromotionalAssetDTO } from "@kisan4u/catalog";
import { getBecomeDealerCta, becomeDealerCtaLabel } from "@/lib/become-dealer-cta";

/** Complete Design/Admin Spec §7.8: two equal side-by-side cards on desktop, stacked on mobile. Falls back to the standard join copy/links when an admin hasn't uploaded a banner image yet — the section still needs its two CTAs, it just doesn't invent imagery. */
export async function JoinDealerSeller({
  dealerAsset,
  sellerAsset,
}: {
  dealerAsset: PromotionalAssetDTO | null;
  sellerAsset: PromotionalAssetDTO | null;
}) {
  // Hidden for an already-approved dealer; relabelled to the application
  // status for a customer mid-application (see @/lib/become-dealer-cta).
  const dealerCta = await getBecomeDealerCta();
  return (
    <PageContainer
      maxWidth="1400px"
      className={`grid grid-cols-1 gap-6 py-14 ${dealerCta.show ? "sm:grid-cols-2" : ""}`}
    >
      {dealerCta.show && (
        <Link
          href={dealerCta.status === "none" ? dealerAsset?.linkUrl || dealerCta.href : dealerCta.href}
          className="flex flex-col justify-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-br from-green-800 to-green-600 p-8 text-white"
        >
          <div className="text-xs font-bold uppercase tracking-widest text-earth-100">For Businesses</div>
          <h3 className="text-xl font-extrabold">
            {dealerCta.status === "none"
              ? dealerAsset?.ctaLabel || "Become a Dealer"
              : becomeDealerCtaLabel(dealerCta.status)}
          </h3>
          <p className="text-sm leading-relaxed text-white/90">
            Get bulk pricing and connect directly with sellers across every category on Kisan4U.
          </p>
        </Link>
      )}
      <Link
        href={sellerAsset?.linkUrl || "/seller/apply"}
        className="flex flex-col justify-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-br from-earth-700 to-earth-500 p-8 text-white"
      >
        <div className="text-xs font-bold uppercase tracking-widest text-green-50">For Individual Sellers</div>
        <h3 className="text-xl font-extrabold">{sellerAsset?.ctaLabel || "Become a Seller"}</h3>
        <p className="text-sm leading-relaxed text-white/90">
          Reach customers and dealers nationwide with logistics and secure payments built in.
        </p>
      </Link>
    </PageContainer>
  );
}
