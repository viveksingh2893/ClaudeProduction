import { unstable_cache } from "next/cache";
import {
  getFeaturedBlogsForHomepage,
  listPublicBlogs,
  resolvePublicBlogBySlug,
  listBlogCategoriesWithBlogs,
} from "@kisan4u/catalog";

/**
 * Same cache/revalidation contract as homepage-cache.ts's entries — one
 * coarse "blog" tag across every blog-related read here, revalidated by
 * apps/dashboard's blog admin actions via the cross-app bridge (see
 * apps/web/src/app/api/revalidate-blog/route.ts). A single tag rather than
 * per-slug tags: blog content changes are rare admin actions, not
 * high-frequency, so invalidating everything blog-related on any change is
 * cheap and simpler than tracking per-entry tags — matches how "homepage"
 * already blankets its own six-plus independent sections.
 */
export const getCachedFeaturedBlogs = unstable_cache(
  async () => getFeaturedBlogsForHomepage(),
  ["featured-blogs"],
  { tags: ["blog"], revalidate: 60 },
);

export const getCachedPublicBlogs = unstable_cache(
  async (categorySlug: string | null) => listPublicBlogs(categorySlug ?? undefined),
  ["public-blogs"],
  { tags: ["blog"], revalidate: 60 },
);

export const getCachedBlogCategoriesWithBlogs = unstable_cache(
  async () => listBlogCategoriesWithBlogs(),
  ["public-blog-categories"],
  { tags: ["blog"], revalidate: 60 },
);

export const getCachedPublicBlogBySlug = unstable_cache(
  async (slug: string) => resolvePublicBlogBySlug(slug),
  ["public-blog-by-slug"],
  { tags: ["blog"], revalidate: 60 },
);
