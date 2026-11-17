import Link from "next/link";
import { formatDate } from "@kisan4u/ui";

export type BlogCardData = {
  slug: string;
  title: string;
  headerImageUrl: string;
  headerImageAlt: string;
  createdAt: Date | string;
  category: { name: string };
};

/**
 * The one blog card — shared by the homepage carousel and /blog's grid
 * (spec: "Do not create inconsistent duplicate card designs"). Uses a
 * plain <img> with object-cover rather than the shared ProductImage
 * component: ProductImage hardcodes object-contain (right for product
 * photography on a white background), while a blog header photo should
 * fill its 16:9 frame edge-to-edge per spec — a real behavioral
 * difference, not a duplicate of the same thing.
 */
export function BlogCard({ blog }: { blog: BlogCardData }) {
  return (
    <Link
      href={`/blog/${blog.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card transition-shadow hover:shadow-lift focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600"
    >
      <div className="aspect-[16/9] w-full shrink-0 overflow-hidden bg-bg-dashboard">
        {/* eslint-disable-next-line @next/next/no-img-element -- same reasoning as ProductImage: no image optimizer/storage-domain loader configured yet */}
        <img
          src={blog.headerImageUrl}
          alt={blog.headerImageAlt}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <span className="inline-flex w-fit items-center rounded-full bg-green-50 px-2.5 py-0.5 text-[11px] font-semibold text-green-800">
          {blog.category.name}
        </span>
        <h3 className="line-clamp-2 text-base font-bold leading-snug text-ink">{blog.title}</h3>
        <span className="mt-auto pt-1 text-xs text-gray-500">{formatDate(blog.createdAt)}</span>
      </div>
    </Link>
  );
}
