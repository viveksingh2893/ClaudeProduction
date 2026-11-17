import { listBlogsForAdmin, listBlogCategories } from "@kisan4u/catalog";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
import { BlogTable } from "./blog-table";

export default async function AdminBlogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSession(["ADMIN"]);
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;
  const featured =
    sp.featured === "featured" || sp.featured === "not_featured" ? sp.featured : undefined;

  const [{ rows, total }, categories] = await Promise.all([
    listBlogsForAdmin({
      search: sp.q || undefined,
      categoryId: sp.categoryId || undefined,
      featured,
      page,
      pageSize,
    }),
    listBlogCategories(),
  ]);

  return (
    <PageContainer maxWidth="1300px" className="py-10">
      <PageHeader title="Blogs" />
      <BlogTable
        rows={rows.map((b) => ({
          id: b.id,
          title: b.title,
          headerImageUrl: resolveStorefrontAssetUrl(b.headerImageUrl) ?? "",
          headerImageAlt: b.headerImageAlt,
          category: { name: b.category.name },
          createdAt: b.createdAt,
          featuredPosition: b.featuredPosition,
        }))}
        total={total}
        page={page}
        pageSize={pageSize}
        categories={categories}
      />
    </PageContainer>
  );
}
