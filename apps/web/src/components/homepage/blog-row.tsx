import Link from "next/link";
import { PageContainer, SectionHeader, ScrollRow } from "@kisan4u/ui";
import { BlogCard, type BlogCardData } from "@/components/blog-card";

/**
 * Featured-blog homepage carousel — same structural pattern as
 * product-row.tsx (PageContainer + SectionHeader + ScrollRow), which
 * already satisfies the "several cards desktop / fewer tablet / ~1 mobile,
 * touch swipe, accessible controls, no aggressive autoplay" requirements
 * via native scroll-snap. Hidden entirely when there are no featured blogs.
 */
export function BlogRow({ blogs }: { blogs: BlogCardData[] }) {
  if (blogs.length === 0) return null;

  return (
    <PageContainer maxWidth="1400px" className="py-10">
      <SectionHeader
        title="Latest from Kisan4U"
        action={
          <Link href="/blog" className="text-sm font-bold text-green-700 hover:underline">
            View All
          </Link>
        }
      />
      <ScrollRow ariaLabel="Latest from Kisan4U" itemClassName="w-[80%] sm:w-[46%] lg:w-[31%] xl:w-[23%]">
        {blogs.map((blog) => (
          <BlogCard key={blog.slug} blog={blog} />
        ))}
      </ScrollRow>
    </PageContainer>
  );
}
