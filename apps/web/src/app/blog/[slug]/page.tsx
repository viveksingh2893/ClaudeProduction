import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageContainer, Breadcrumbs, formatDate } from "@kisan4u/ui";
import { SafeHtml } from "@kisan4u/ui/SafeHtml";
import { getCachedPublicBlogBySlug } from "@/lib/blog-cache";
import { getSiteOrigin, toAbsoluteUrl } from "@/lib/site-origin";
import { ShareBlogPanel } from "@/components/share-blog-panel";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lookup = await getCachedPublicBlogBySlug(slug);
  if (lookup.kind !== "found") return {};
  const { blog } = lookup;

  const origin = await getSiteOrigin();
  const url = origin ? `${origin}/blog/${blog.slug}` : `/blog/${blog.slug}`;
  const image = toAbsoluteUrl(blog.headerImageUrl, origin);
  const title = `${blog.title} | Kisan4U Blog`;

  return {
    title,
    description: blog.metaDescription,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: blog.title,
      description: blog.metaDescription,
      url,
      images: [{ url: image, alt: blog.headerImageAlt }],
      publishedTime: new Date(blog.createdAt).toISOString(),
      modifiedTime: new Date(blog.updatedAt).toISOString(),
      authors: [blog.writer],
    },
    twitter: {
      card: "summary_large_image",
      title: blog.title,
      description: blog.metaDescription,
      images: [image],
    },
  };
}

export default async function BlogDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const lookup = await getCachedPublicBlogBySlug(slug);

  if (lookup.kind === "redirect") redirect(`/blog/${lookup.toSlug}`);
  if (lookup.kind === "not_found") notFound();

  const { blog } = lookup;
  const origin = await getSiteOrigin();
  const url = origin ? `${origin}/blog/${blog.slug}` : `/blog/${blog.slug}`;
  const blogListUrl = origin ? `${origin}/blog` : "/blog";
  const image = toAbsoluteUrl(blog.headerImageUrl, origin);

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: blog.title,
    image: [image],
    datePublished: new Date(blog.createdAt).toISOString(),
    dateModified: new Date(blog.updatedAt).toISOString(),
    author: [{ "@type": "Person", name: blog.writer }],
    description: blog.metaDescription,
    mainEntityOfPage: url,
  };
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: origin || "/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: blogListUrl },
      { "@type": "ListItem", position: 3, name: blog.title, item: url },
    ],
  };

  return (
    <PageContainer maxWidth="900px" className="py-8">
      {/* Static, server-generated JSON — never user-controlled HTML. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <Breadcrumbs
        items={[{ label: "Home", href: "/" }, { label: "Blog", href: "/blog" }, { label: blog.title }]}
      />

      <h1 className="mt-3 text-2xl font-extrabold leading-tight text-ink sm:text-4xl">
        {blog.title}
      </h1>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
        <span>Published {formatDate(blog.createdAt)}</span>
        <span aria-hidden="true">·</span>
        <span>Updated {formatDate(blog.updatedAt)}</span>
        <span aria-hidden="true">·</span>
        <span>By {blog.writer}</span>
      </div>

      <div className="mt-5 aspect-[16/9] w-full overflow-hidden rounded-xl bg-bg-dashboard sm:mt-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- same reasoning as ProductImage/BlogCard: no image optimizer/storage-domain loader configured yet */}
        <img
          src={blog.headerImageUrl}
          alt={blog.headerImageAlt}
          className="h-full w-full object-cover"
        />
      </div>

      <ShareBlogPanel url={url} title={blog.title} />

      <SafeHtml html={blog.bodyHtml} className="mt-8 max-w-none" />
    </PageContainer>
  );
}
