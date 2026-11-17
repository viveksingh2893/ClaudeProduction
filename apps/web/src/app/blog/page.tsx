import Link from "next/link";
import type { Metadata } from "next";
import { PageContainer, Breadcrumbs, EmptyState } from "@kisan4u/ui";
import { BlogCard } from "@/components/blog-card";
import { getCachedPublicBlogs, getCachedBlogCategoriesWithBlogs } from "@/lib/blog-cache";

export const metadata: Metadata = {
  title: "Blog | Kisan4U",
  description:
    "Guides and updates from Kisan4U — dealer sourcing, buying guides, and platform how-tos for our multi-seller marketplace.",
};

function CategoryPill({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`inline-flex shrink-0 items-center rounded-full border-[1.5px] px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 ${
        active
          ? "border-green-700 bg-green-700 text-white"
          : "border-border bg-surface text-ink hover:border-green-600 hover:text-green-700"
      }`}
    >
      {label}
    </Link>
  );
}

export default async function BlogListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const activeCategorySlug = sp.category || null;

  const [categories, blogs] = await Promise.all([
    getCachedBlogCategoriesWithBlogs(),
    getCachedPublicBlogs(activeCategorySlug),
  ]);

  const activeCategory = activeCategorySlug
    ? categories.find((c) => c.slug.toLowerCase() === activeCategorySlug.toLowerCase())
    : null;

  return (
    <PageContainer maxWidth="1400px" className="py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Blog" }]} />
      <h1 className="mt-2 text-2xl font-extrabold text-ink sm:text-3xl">Blog</h1>

      {categories.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">
            Categories
          </h2>
          <div className="flex flex-wrap gap-2">
            <CategoryPill label="All" href="/blog" active={!activeCategorySlug} />
            {categories.map((c) => (
              <CategoryPill
                key={c.id}
                label={c.name}
                href={`/blog?category=${encodeURIComponent(c.slug)}`}
                active={activeCategorySlug?.toLowerCase() === c.slug.toLowerCase()}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-8">
        {blogs.length === 0 ? (
          <EmptyState
            title={activeCategory ? `No blogs in ${activeCategory.name} yet` : "No blogs yet"}
            description="Check back soon for new posts."
          />
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {blogs.map((blog) => (
              <BlogCard key={blog.slug} blog={blog} />
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
