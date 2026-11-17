import { listBlogCategories } from "@kisan4u/catalog";
import { requireSession } from "@/lib/session-guard";
import { BlogForm } from "../blog-form";

export default async function NewBlogPage() {
  await requireSession(["ADMIN"]);
  const categories = await listBlogCategories();

  return (
    <BlogForm
      mode="create"
      categories={categories}
      publicBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
    />
  );
}
