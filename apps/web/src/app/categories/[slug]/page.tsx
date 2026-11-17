import Link from "next/link";
import { notFound } from "next/navigation";
import { getCategoryBySlug, getCustomerCatalogue, resolveCustomerCatalogueStateId } from "@kisan4u/catalog";
import { prisma } from "@kisan4u/db";
import { auth } from "@/auth";

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const session = await auth();
  const customerStateId =
    session?.user.role === "CUSTOMER"
      ? await resolveCustomerCatalogueStateId(session.user.id)
      : undefined;

  const [subcategories, products] = await Promise.all([
    prisma.subcategory.findMany({
      where: { categoryId: category.id, isActive: true },
      orderBy: { name: "asc" },
    }),
    getCustomerCatalogue({ categorySlug: slug, customerStateId }),
  ]);

  return (
    <main style={{ padding: "3rem", maxWidth: 960, margin: "0 auto" }}>
      <h1>{category.name}</h1>

      {subcategories.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          {subcategories.map((s) => (
            <Link
              key={s.id}
              href={`/products?category=${slug}&subCategory=${s.slug}`}
              style={{ marginRight: "1rem" }}
            >
              {s.name}
            </Link>
          ))}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: "1.5rem",
        }}
      >
        {products.map((p) => (
          <Link
            key={p.id}
            href={`/products/${p.slug}`}
            style={{
              display: "block",
              border: "1px solid #ddd",
              borderRadius: 6,
              padding: "1rem",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <div style={{ fontWeight: 600 }}>{p.name}</div>
            {p.customerConfig && <div>₹{p.customerConfig.sellingPrice.toString()}</div>}
          </Link>
        ))}
        {products.length === 0 && (
          <p style={{ color: "#666" }}>No products in this category yet.</p>
        )}
      </div>
    </main>
  );
}
