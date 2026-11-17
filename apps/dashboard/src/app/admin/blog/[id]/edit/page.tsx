import { notFound } from "next/navigation";
import { getBlogForAdmin, listBlogCategories } from "@kisan4u/catalog";
import { requireSession } from "@/lib/session-guard";
import { BlogForm } from "../../blog-form";

export default async function EditBlogPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession(["ADMIN"]);
  const { id } = await params;

  const [blog, categories] = await Promise.all([getBlogForAdmin(id), listBlogCategories()]);
  if (!blog) notFound();

  return (
    <BlogForm
      mode="edit"
      initial={{
        id: blog.id,
        title: blog.title,
        slug: blog.slug,
        headerImageUrl: blog.headerImageUrl,
        headerImageAlt: blog.headerImageAlt,
        categoryId: blog.categoryId,
        bodyHtml: blog.bodyHtml,
        writer: blog.writer,
        metaDescription: blog.metaDescription,
        featuredPosition: blog.featuredPosition,
      }}
      categories={categories}
      publicBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
    />
  );
}
