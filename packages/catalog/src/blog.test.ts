/**
 * Integration tests against the real dev Postgres (same convention as
 * category-hierarchy.test.ts). Featured position is a flat, whole-table
 * concept (like Category.position) — the 3 seeded sample blogs and
 * whatever else exists in the dev DB already occupy real positions, so
 * assertions here are relative ("ends up right after X") rather than
 * fixed position numbers, same reasoning as that file's own doc comment.
 * Throwaway fixture blogs/categories are created and torn down; nothing
 * pre-existing is renamed or deleted.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import {
  createBlog,
  updateBlog,
  createBlogCategory,
  resolvePublicBlogBySlug,
} from "./blog";
import { isRichTextEmpty } from "@kisan4u/validators";

const STAMP = Date.now();
let categoryId: string;
const cleanupBlogIds: string[] = [];
const cleanupCategoryIds: string[] = [];

async function makeInput(overrides: Partial<Parameters<typeof createBlog>[0]> = {}) {
  return {
    title: `TEST FIXTURE Blog ${STAMP}`,
    slug: `Test-Fixture-Blog-${STAMP}`,
    headerImageUrl: "/demo/blog/test.jpg",
    headerImageAlt: "Test image",
    categoryId,
    bodyHtml: "<p>Real body content.</p>",
    writer: "",
    metaDescription: "A test blog for automated coverage.",
    featuredPosition: null,
    ...overrides,
  };
}

async function cleanupBlog(id: string) {
  await prisma.blogRedirect.deleteMany({ where: { blogId: id } });
  await prisma.blog.delete({ where: { id } }).catch(() => {});
}

before(async () => {
  const category = await prisma.blogCategory.create({
    data: { name: `TEST FIXTURE Category ${STAMP}`, slug: `test-fixture-category-${STAMP}` },
  });
  categoryId = category.id;
  cleanupCategoryIds.push(category.id);
});

after(async () => {
  for (const id of cleanupBlogIds) await cleanupBlog(id);
  for (const id of cleanupCategoryIds) await prisma.blogCategory.delete({ where: { id } }).catch(() => {});
});

test("createBlog: writer defaults to 'Kisan4U Editor' when left blank", async () => {
  const result = await createBlog(await makeInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  cleanupBlogIds.push(result.data.id);

  const blog = await prisma.blog.findUniqueOrThrow({ where: { id: result.data.id } });
  assert.equal(blog.writer, "Kisan4U Editor");
});

test("createBlog: bodyHtml with only empty markup is rejected", async () => {
  const result = await createBlog(
    await makeInput({ slug: `Test-Fixture-Empty-Body-${STAMP}`, bodyHtml: "<p><br></p>" }),
  );
  assert.equal(result.ok, false);
  assert.equal(isRichTextEmpty("<p><br></p>"), true);
});

test("createBlog: rich-text body is sanitized — a script tag never survives", async () => {
  const result = await createBlog(
    await makeInput({
      slug: `Test-Fixture-Xss-${STAMP}`,
      bodyHtml: '<p>Safe text</p><script>alert("xss")</script><p onclick="alert(1)">Click</p>',
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  cleanupBlogIds.push(result.data.id);

  const blog = await prisma.blog.findUniqueOrThrow({ where: { id: result.data.id } });
  assert.equal(blog.bodyHtml.includes("<script"), false);
  assert.equal(blog.bodyHtml.includes("onclick"), false);
  assert.equal(blog.bodyHtml.includes("Safe text"), true);
});

test("createBlog: custom URL uniqueness is case-insensitive, casing is preserved as entered", async () => {
  const slug = `Test-Fixture-Casing-${STAMP}`;
  const first = await createBlog(await makeInput({ slug }));
  assert.equal(first.ok, true);
  if (!first.ok) return;
  cleanupBlogIds.push(first.data.id);

  const stored = await prisma.blog.findUniqueOrThrow({ where: { id: first.data.id } });
  assert.equal(stored.slug, slug); // exact casing preserved, never lowercased

  const duplicate = await createBlog(
    await makeInput({ slug: slug.toLowerCase(), title: "A different title" }),
  );
  assert.equal(duplicate.ok, false);
});

test("createBlogCategory: name uniqueness is case-insensitive", async () => {
  const name = `TEST FIXTURE Unique Cat ${STAMP}`;
  const first = await createBlogCategory({ name });
  assert.equal(first.ok, true);
  if (first.ok) cleanupCategoryIds.push(first.data.id);

  const duplicate = await createBlogCategory({ name: name.toLowerCase() });
  assert.equal(duplicate.ok, false);
});

test("updateBlog: changing the custom URL creates a redirect from the old slug to the new one", async () => {
  const oldSlug = `Test-Fixture-Old-Slug-${STAMP}`;
  const newSlug = `Test-Fixture-New-Slug-${STAMP}`;
  const created = await createBlog(await makeInput({ slug: oldSlug }));
  assert.equal(created.ok, true);
  if (!created.ok) return;
  cleanupBlogIds.push(created.data.id);

  const updated = await updateBlog(created.data.id, await makeInput({ slug: newSlug }));
  assert.equal(updated.ok, true);

  const viaOldSlug = await resolvePublicBlogBySlug(oldSlug);
  assert.equal(viaOldSlug.kind, "redirect");
  if (viaOldSlug.kind === "redirect") assert.equal(viaOldSlug.toSlug, newSlug);

  const viaNewSlug = await resolvePublicBlogBySlug(newSlug);
  assert.equal(viaNewSlug.kind, "found");

  // Redirect resolution is also case-insensitive, matching every other
  // slug lookup in this feature.
  const viaOldSlugDifferentCase = await resolvePublicBlogBySlug(oldSlug.toLowerCase());
  assert.equal(viaOldSlugDifferentCase.kind, "redirect");
});

test("resolvePublicBlogBySlug: an unknown slug resolves to not_found", async () => {
  const result = await resolvePublicBlogBySlug(`does-not-exist-${STAMP}`);
  assert.equal(result.kind, "not_found");
});

test("featured position: assigning an already-occupied position shifts the other blog along, without duplicates", async () => {
  const a = await createBlog(
    await makeInput({ slug: `Test-Fixture-Pos-A-${STAMP}`, featuredPosition: null }),
  );
  const b = await createBlog(
    await makeInput({ slug: `Test-Fixture-Pos-B-${STAMP}`, featuredPosition: null }),
  );
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (!a.ok || !b.ok) return;
  cleanupBlogIds.push(a.data.id, b.data.id);

  // Give A a position, then ask for B to take that EXACT same position —
  // A must move, not be silently overwritten or duplicated.
  await updateBlog(a.data.id, await makeInput({ slug: `Test-Fixture-Pos-A-${STAMP}`, featuredPosition: 1 }));
  const aAfterFirst = await prisma.blog.findUniqueOrThrow({ where: { id: a.data.id } });

  await updateBlog(
    b.data.id,
    await makeInput({ slug: `Test-Fixture-Pos-B-${STAMP}`, featuredPosition: aAfterFirst.featuredPosition! }),
  );

  const aFinal = await prisma.blog.findUniqueOrThrow({ where: { id: a.data.id } });
  const bFinal = await prisma.blog.findUniqueOrThrow({ where: { id: b.data.id } });

  assert.equal(bFinal.featuredPosition, aAfterFirst.featuredPosition); // B got the requested slot
  assert.notEqual(aFinal.featuredPosition, bFinal.featuredPosition); // no duplicate position
  assert.equal(aFinal.featuredPosition, bFinal.featuredPosition! + 1); // A shifted one place down

  // Every featured position across the whole table is still a clean,
  // gap-free, duplicate-free 1..N sequence after the shift.
  const allFeatured = await prisma.blog.findMany({
    where: { featuredPosition: { not: null } },
    orderBy: { featuredPosition: "asc" },
    select: { featuredPosition: true },
  });
  const positions = allFeatured.map((f) => f.featuredPosition);
  assert.deepEqual(positions, Array.from({ length: positions.length }, (_, i) => i + 1));
});

test("featured position: clearing it removes the blog from the homepage and closes the gap", async () => {
  const a = await createBlog(
    await makeInput({ slug: `Test-Fixture-Clear-A-${STAMP}`, featuredPosition: null }),
  );
  const b = await createBlog(
    await makeInput({ slug: `Test-Fixture-Clear-B-${STAMP}`, featuredPosition: null }),
  );
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (!a.ok || !b.ok) return;
  cleanupBlogIds.push(a.data.id, b.data.id);

  await updateBlog(a.data.id, await makeInput({ slug: `Test-Fixture-Clear-A-${STAMP}`, featuredPosition: 1 }));
  const aAfterFirst = await prisma.blog.findUniqueOrThrow({ where: { id: a.data.id } });
  await updateBlog(
    b.data.id,
    await makeInput({
      slug: `Test-Fixture-Clear-B-${STAMP}`,
      featuredPosition: aAfterFirst.featuredPosition! + 1,
    }),
  );
  const bAfterFirst = await prisma.blog.findUniqueOrThrow({ where: { id: b.data.id } });

  // Clear A — B (which came right after it) must close the gap and move up one.
  await updateBlog(a.data.id, await makeInput({ slug: `Test-Fixture-Clear-A-${STAMP}`, featuredPosition: null }));

  const aFinal = await prisma.blog.findUniqueOrThrow({ where: { id: a.data.id } });
  const bFinal = await prisma.blog.findUniqueOrThrow({ where: { id: b.data.id } });

  assert.equal(aFinal.featuredPosition, null); // off the homepage
  assert.equal(bFinal.featuredPosition, bAfterFirst.featuredPosition! - 1); // gap closed
});
