import { listPromotionalAssets } from "@kisan4u/catalog";
import { prisma } from "@kisan4u/db";
import { isDbLanguage, type DbLanguage } from "@kisan4u/validators";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { BannersManager } from "./banners-manager";
import { AudienceToggle } from "./audience-toggle";
import { LanguageToggle } from "./language-toggle";

export default async function AdminBannersPage({
  searchParams,
}: {
  searchParams: Promise<{ audience?: string; lang?: string }>;
}) {
  await requireSession(["ADMIN"]);
  const sp = await searchParams;
  const audience = sp.audience === "DEALER" ? "DEALER" : "CUSTOMER";
  const language: DbLanguage = isDbLanguage(sp.lang) ? sp.lang : "EN";

  const [heroBanners, secondBanners, couponBanners, categories] = await Promise.all([
    listPromotionalAssets("HERO", audience, language),
    listPromotionalAssets("HERO_SECONDARY", audience, language),
    listPromotionalAssets("COUPON", audience, language),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  return (
    <PageContainer maxWidth="900px" className="py-8">
      <PageHeader
        title="Banners"
        description="Manages the homepage banner carousels. Customer and dealer viewers can each see different banners, and each language can have its own set — switch below. When a language has no banner for a slot, the storefront falls back to the English one."
        actions={
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <AudienceToggle audience={audience} />
            <LanguageToggle language={language} />
          </div>
        }
      />
      <BannersManager
        key={`hero-${audience}-${language}`}
        banners={heroBanners}
        placement="HERO"
        audience={audience}
        language={language}
        categories={categories}
        storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
      />

      <div className="mt-10">
        <PageHeader
          title="Second banner"
          description="A second banner carousel further down the homepage (after Best Sellers). Same options as the hero banner above."
        />
        <BannersManager
          key={`hero2-${audience}-${language}`}
          banners={secondBanners}
          placement="HERO_SECONDARY"
          audience={audience}
          language={language}
          categories={categories}
          storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
        />
      </div>

      <div className="mt-10">
        <PageHeader
          title="Coupon banners"
          description="Manages the small coupon banner carousel shown directly below the hero banner on the homepage."
        />
        <BannersManager
          key={`coupon-${audience}-${language}`}
          banners={couponBanners}
          placement="COUPON"
          audience={audience}
          language={language}
          categories={categories}
          storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
        />
      </div>
    </PageContainer>
  );
}
