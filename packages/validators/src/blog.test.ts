import { test } from "node:test";
import assert from "node:assert/strict";
import { blogSlugSchema, blogInputSchema } from "./blog";

test("blogSlugSchema: accepts letters, numbers, and hyphens; preserves casing exactly", () => {
  const result = blogSlugSchema.safeParse("Dealer-Benifit");
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data, "Dealer-Benifit"); // never lowercased
});

test("blogSlugSchema: trims accidental whitespace", () => {
  const result = blogSlugSchema.safeParse("  Dealer-Benifit  ");
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data, "Dealer-Benifit");
});

test("blogSlugSchema: rejects slashes, question marks, and hashes", () => {
  for (const bad of ["dealer/benifit", "dealer?benifit", "dealer#benifit"]) {
    assert.equal(blogSlugSchema.safeParse(bad).success, false, bad);
  }
});

test("blogSlugSchema: rejects spaces and other symbols", () => {
  for (const bad of ["dealer benifit", "dealer_benifit", "dealer.benifit", "dealer@benifit"]) {
    assert.equal(blogSlugSchema.safeParse(bad).success, false, bad);
  }
});

test("blogSlugSchema: rejects an empty or whitespace-only value", () => {
  assert.equal(blogSlugSchema.safeParse("").success, false);
  assert.equal(blogSlugSchema.safeParse("   ").success, false);
});

test("blogSlugSchema: rejects reserved route segments", () => {
  for (const reserved of ["new", "edit", "admin", "category", "New", "ADMIN"]) {
    assert.equal(blogSlugSchema.safeParse(reserved).success, false, reserved);
  }
});

test("blogInputSchema: featuredPosition accepts null, a positive integer, or omission — never zero or negative", () => {
  const base = {
    title: "A valid title",
    slug: "a-valid-slug",
    headerImageUrl: "/demo/x.jpg",
    headerImageAlt: "alt",
    categoryId: "cat_1",
    bodyHtml: "<p>content</p>",
    metaDescription: "A description.",
  };
  assert.equal(blogInputSchema.safeParse({ ...base, featuredPosition: null }).success, true);
  assert.equal(blogInputSchema.safeParse({ ...base, featuredPosition: 3 }).success, true);
  assert.equal(blogInputSchema.safeParse(base).success, true); // omitted entirely
  assert.equal(blogInputSchema.safeParse({ ...base, featuredPosition: 0 }).success, false);
  assert.equal(blogInputSchema.safeParse({ ...base, featuredPosition: -1 }).success, false);
});
