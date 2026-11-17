import { unstable_cache } from "next/cache";
import { getDealerProfileForUser } from "@kisan4u/auth";
import { getCategoryNavTree, resolveCategoryName } from "@kisan4u/catalog";
import { auth } from "@/auth";
import { getDbLanguage } from "@/i18n/server";
import { CategoryNav } from "./category-nav";

/**
 * Server wrapper for the category ribbon, mounted once in the root layout
 * directly below SiteHeader. The ribbon (a client component) keeps its DOM
 * across every navigation because it lives in the persistent layout, so
 * switching tabs never unmounts or blinks it — only the active styling
 * changes. The nav tree is cached (revalidated by the admin category
 * mutations' "homepage" tag) so a tab switch doesn't re-hit the DB.
 */
const getCachedCategoryNavTree = unstable_cache(() => getCategoryNavTree(), ["category-nav-tree"], {
  tags: ["homepage"],
  revalidate: 300,
});

export async function CategoryBar() {
  const session = await auth();
  const sessionRole = session?.user.role;

  let isDealer = false;
  if (sessionRole === "DEALER" && session) {
    const profile = await getDealerProfileForUser(session.user.id);
    isDealer = profile?.status === "APPROVED";
  }

  const [rawTree, dbLang] = await Promise.all([getCachedCategoryNavTree(), getDbLanguage()]);
  // The tree is cached language-agnostically (it carries every translation
  // row); names are resolved for this request's language here, after the
  // cache boundary.
  const tree = rawTree.map((cat) => ({
    ...cat,
    name: resolveCategoryName(cat, dbLang),
    subCategories: cat.subCategories.map((sub) => ({
      ...sub,
      name: resolveCategoryName(sub, dbLang),
      subSubCategories: sub.subSubCategories.map((ss) => ({
        ...ss,
        name: resolveCategoryName(ss, dbLang),
      })),
    })),
  }));
  const hrefPrefix = isDealer ? "/dealer/products" : "/products";
  // Every ribbon tab (customer and approved dealer alike) opens that
  // category's own page ("/c/[slug]"); the page renders audience-aware
  // banners + pricing. `hrefPrefix` stays only as the dealer/customer
  // fallback base CategoryNav uses when categoryBasePath isn't set.

  return <CategoryNav tree={tree} hrefPrefix={hrefPrefix} categoryBasePath="/c" />;
}
