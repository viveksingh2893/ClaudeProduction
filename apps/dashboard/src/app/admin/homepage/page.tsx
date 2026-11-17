import { listHomepageSections } from "@kisan4u/catalog";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import Link from "next/link";
import { requireSession } from "@/lib/session-guard";
import { HomepageSectionsManager } from "./homepage-sections-manager";

const SUB_SCREENS = [
  { href: "/admin/homepage/banners", label: "Hero / Coupon / Join banners" },
  { href: "/admin/homepage/top-categories", label: "Top Categories" },
  { href: "/admin/homepage/deal-of-the-day", label: "Deal of the Day" },
  { href: "/admin/homepage/discovery", label: "Trending / Best Sellers / New Arrivals" },
  { href: "/admin/homepage/featured-by-category", label: "Featured by Category" },
  { href: "/admin/homepage/featured-by-subcategory", label: "Featured by Sub-category" },
  { href: "/admin/homepage/brands", label: "Shop by Brand ordering" },
];

export default async function AdminHomepagePage() {
  await requireSession(["ADMIN"]);
  const sections = await listHomepageSections();

  return (
    <PageContainer maxWidth="900px" className="py-8">
      <PageHeader
        title="Homepage CMS"
        description="Enable/disable and schedule each homepage section. Header, category navigation, and footer are structurally protected and not listed here."
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {SUB_SCREENS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-50"
          >
            {s.label} →
          </Link>
        ))}
      </div>

      <HomepageSectionsManager sections={sections} />
    </PageContainer>
  );
}
