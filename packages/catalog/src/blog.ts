import { prisma } from "@kisan4u/db";
import { blogInputSchema, blogCategoryInputSchema, type BlogInput } from "@kisan4u/validators";
import { sanitizeProductRichText, slugify } from "@kisan4u/validators";

export type MutationResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const DEFAULT_WRITER = "Kisan4U Editor";

function normalizeWriter(writer: string | undefined): string {
  const trimmed = writer?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_WRITER;
}

// ---------------------------------------------------------------------------
// Featured position — same "remove then reinsert at index over the full
// ordered list, one transaction" algorithm as
// category-hierarchy.ts's setTopLevelCategoryPosition, adapted to Blog's
// nullable featuredPosition (null = not on the homepage at all, rather than
// Category's isActive-gated "always positioned while active"). Kept in this
// same file (not split out) since nothing else needs it in isolation.
// ---------------------------------------------------------------------------

async function applyBlogFeaturedPosition(
  blogId: string,
  desiredPosition: number | null,
): Promise<void> {
  const others = await prisma.blog.findMany({
    where: { featuredPosition: { not: null }, id: { not: blogId } },
    orderBy: { featuredPosition: "asc" },
    select: { id: true },
  });
  const ids = others.map((b) => b.id);

  if (desiredPosition == null) {
    // Clear this blog's own position and close the gap among the rest —
    // one transaction so a crash mid-way can never leave a duplicate or a
    // skipped number.
    await prisma.$transaction([
      prisma.blog.update({ where: { id: blogId }, data: { featuredPosition: null } }),
      ...ids.map((id, i) => prisma.blog.update({ where: { id }, data: { featuredPosition: i + 1 } })),
    ]);
    return;
  }

  const clamped = Math.min(Math.max(Math.trunc(desiredPosition), 1), ids.length + 1);
  ids.splice(clamped - 1, 0, blogId);
  await prisma.$transaction(
    ids.map((id, i) => prisma.blog.update({ where: { id }, data: { featuredPosition: i + 1 } })),
  );
}

// ---------------------------------------------------------------------------
// Blog category
// ---------------------------------------------------------------------------

export async function listBlogCategories() {
  return prisma.blogCategory.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  });
}

/** Only categories with at least one blog — spec: "Do not display categories with no available blogs." "All" is added by the caller, not here. */
export async function listBlogCategoriesWithBlogs() {
  const categories = await prisma.blogCategory.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true, _count: { select: { blogs: true } } },
  });
  return categories
    .filter((c) => c._count.blogs > 0)
    .map((c) => ({ id: c.id, name: c.name, slug: c.slug }));
}

export async function createBlogCategory(input: {
  name: string;
}): Promise<MutationResult<{ id: string; name: string; slug: string }>> {
  const parsed = blogCategoryInputSchema.safeParse({ name: input.name, slug: slugify(input.name) });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const existing = await prisma.blogCategory.findFirst({
    where: {
      OR: [
        { name: { equals: parsed.data.name, mode: "insensitive" } },
        { slug: { equals: parsed.data.slug, mode: "insensitive" } },
      ],
    },
  });
  if (existing) return { ok: false, error: "A category with this name already exists." };

  const category = await prisma.blogCategory.create({
    data: { name: parsed.data.name, slug: parsed.data.slug },
    select: { id: true, name: true, slug: true },
  });
  return { ok: true, data: category };
}

// ---------------------------------------------------------------------------
// Blog — admin
// ---------------------------------------------------------------------------

export type AdminBlogFilters = {
  search?: string;
  categoryId?: string;
  featured?: "featured" | "not_featured";
  page?: number;
  pageSize?: number;
};

export async function listBlogsForAdmin(filters: AdminBlogFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;

  const where = {
    ...(filters.search
      ? { title: { contains: filters.search, mode: "insensitive" as const } }
      : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.featured === "featured"
      ? { featuredPosition: { not: null } }
      : filters.featured === "not_featured"
        ? { featuredPosition: null }
        : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.blog.findMany({
      where,
      include: { category: { select: { name: true } } },
      orderBy: [{ featuredPosition: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.blog.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}

export async function getBlogForAdmin(id: string) {
  return prisma.blog.findUnique({ where: { id }, include: { category: true } });
}

/** Case-insensitive slug uniqueness against every live Blog.slug AND every other blog's old-redirect slugs — a slug that used to belong to a different blog's history shouldn't be claimable by a new one (spec doesn't say this explicitly, but leaving it possible would make redirects behave unpredictably). `excludeBlogId` lets an edit ignore its own current slug/redirect rows. */
async function assertBlogSlugAvailable(slug: string, excludeBlogId?: string): Promise<boolean> {
  const [liveConflict, redirectConflict] = await Promise.all([
    prisma.blog.findFirst({
      where: {
        slug: { equals: slug, mode: "insensitive" },
        ...(excludeBlogId ? { id: { not: excludeBlogId } } : {}),
      },
      select: { id: true },
    }),
    prisma.blogRedirect.findFirst({
      where: {
        oldSlug: { equals: slug, mode: "insensitive" },
        ...(excludeBlogId ? { blogId: { not: excludeBlogId } } : {}),
      },
      select: { id: true },
    }),
  ]);
  return !liveConflict && !redirectConflict;
}

export async function createBlog(input: BlogInput): Promise<MutationResult<{ id: string }>> {
  const parsed = blogInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  if (!(await assertBlogSlugAvailable(parsed.data.slug))) {
    return { ok: false, error: "This custom URL is already in use." };
  }

  const category = await prisma.blogCategory.findUnique({ where: { id: parsed.data.categoryId } });
  if (!category) return { ok: false, error: "Select a valid category." };

  const bodyHtml = sanitizeProductRichText(parsed.data.bodyHtml);

  const blog = await prisma.blog.create({
    data: {
      title: parsed.data.title,
      slug: parsed.data.slug,
      headerImageUrl: parsed.data.headerImageUrl,
      headerImageAlt: parsed.data.headerImageAlt,
      categoryId: parsed.data.categoryId,
      bodyHtml,
      writer: normalizeWriter(parsed.data.writer),
      metaDescription: parsed.data.metaDescription,
      featuredPosition: null,
    },
    select: { id: true },
  });

  if (parsed.data.featuredPosition != null) {
    await applyBlogFeaturedPosition(blog.id, parsed.data.featuredPosition);
  }

  return { ok: true, data: { id: blog.id } };
}

export async function updateBlog(
  id: string,
  input: BlogInput,
): Promise<MutationResult<{ id: string }>> {
  const existing = await prisma.blog.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Blog not found." };

  const parsed = blogInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  if (!(await assertBlogSlugAvailable(parsed.data.slug, id))) {
    return { ok: false, error: "This custom URL is already in use." };
  }

  const category = await prisma.blogCategory.findUnique({ where: { id: parsed.data.categoryId } });
  if (!category) return { ok: false, error: "Select a valid category." };

  const bodyHtml = sanitizeProductRichText(parsed.data.bodyHtml);
  const slugChanged = existing.slug.toLowerCase() !== parsed.data.slug.toLowerCase();

  await prisma.$transaction(async (tx) => {
    await tx.blog.update({
      where: { id },
      data: {
        title: parsed.data.title,
        slug: parsed.data.slug,
        headerImageUrl: parsed.data.headerImageUrl,
        headerImageAlt: parsed.data.headerImageAlt,
        categoryId: parsed.data.categoryId,
        bodyHtml,
        writer: normalizeWriter(parsed.data.writer),
        metaDescription: parsed.data.metaDescription,
      },
    });

    if (slugChanged) {
      // Reverting back to a URL this same blog used to have — that old
      // redirect row is now pointless (the slug is live again) and would
      // otherwise sit there stale.
      await tx.blogRedirect.deleteMany({
        where: { blogId: id, oldSlug: { equals: parsed.data.slug, mode: "insensitive" } },
      });
      await tx.blogRedirect.create({
        data: { oldSlug: existing.slug, blogId: id },
      });
    }
  });

  await applyBlogFeaturedPosition(id, parsed.data.featuredPosition ?? null);

  return { ok: true, data: { id } };
}

// ---------------------------------------------------------------------------
// Blog — public
// ---------------------------------------------------------------------------

const PUBLIC_BLOG_CARD_SELECT = {
  id: true,
  title: true,
  slug: true,
  headerImageUrl: true,
  headerImageAlt: true,
  createdAt: true,
  featuredPosition: true,
  category: { select: { id: true, name: true, slug: true } },
} as const;

export async function getFeaturedBlogsForHomepage() {
  return prisma.blog.findMany({
    where: { featuredPosition: { not: null } },
    orderBy: { featuredPosition: "asc" },
    select: PUBLIC_BLOG_CARD_SELECT,
  });
}

export async function listPublicBlogs(categorySlug?: string) {
  return prisma.blog.findMany({
    where: categorySlug
      ? { category: { slug: { equals: categorySlug, mode: "insensitive" } } }
      : undefined,
    orderBy: { createdAt: "desc" },
    select: PUBLIC_BLOG_CARD_SELECT,
  });
}

export type PublicBlogLookup =
  | { kind: "found"; blog: NonNullable<Awaited<ReturnType<typeof getPublicBlogRow>>> }
  | { kind: "redirect"; toSlug: string }
  | { kind: "not_found" };

async function getPublicBlogRow(slug: string) {
  return prisma.blog.findFirst({
    where: { slug: { equals: slug, mode: "insensitive" } },
    include: { category: { select: { id: true, name: true, slug: true } } },
  });
}

/** The one lookup /blog/[slug] uses — checks the live slug first, then falls back to the redirect table before giving up (spec: "preserve the old path and permanently redirect it to the new path"). */
export async function resolvePublicBlogBySlug(slug: string): Promise<PublicBlogLookup> {
  const blog = await getPublicBlogRow(slug);
  if (blog) return { kind: "found", blog };

  const redirect = await prisma.blogRedirect.findFirst({
    where: { oldSlug: { equals: slug, mode: "insensitive" } },
    include: { blog: { select: { slug: true } } },
  });
  if (redirect) return { kind: "redirect", toSlug: redirect.blog.slug };

  return { kind: "not_found" };
}
