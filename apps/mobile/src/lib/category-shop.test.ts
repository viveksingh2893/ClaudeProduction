import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSelectedCategoryId, findCategoryById } from "./category-shop";
import type { CategoryNode } from "./api/types";

function makeCategory(id: string, name: string): CategoryNode {
  return { id, name, slug: name.toLowerCase(), emoji: null, imageUrl: null, subCategories: [] };
}

test("initial category selection: with no previous selection, resolves to the first category (already position-ordered by the API)", () => {
  const categories = [makeCategory("a", "Agri Inputs"), makeCategory("b", "Electronics")];
  assert.equal(resolveSelectedCategoryId(categories, null), "a");
});

test("empty category list resolves to no selection", () => {
  assert.equal(resolveSelectedCategoryId([], null), null);
});

test("switching categories: an existing previous selection is kept, not reset to the first category", () => {
  const categories = [
    makeCategory("a", "Agri Inputs"),
    makeCategory("b", "Electronics"),
    makeCategory("c", "Fashion"),
  ];
  assert.equal(resolveSelectedCategoryId(categories, "c"), "c");
});

test("a previous selection that no longer exists (deactivated/deleted) falls back to the first category", () => {
  const categories = [makeCategory("a", "Agri Inputs"), makeCategory("b", "Electronics")];
  assert.equal(resolveSelectedCategoryId(categories, "stale-id"), "a");
});

test("findCategoryById returns the matching node", () => {
  const categories = [makeCategory("a", "Agri Inputs"), makeCategory("b", "Electronics")];
  assert.equal(findCategoryById(categories, "b")?.name, "Electronics");
});

test("findCategoryById is null-safe for no selection and for a missing id", () => {
  const categories = [makeCategory("a", "Agri Inputs")];
  assert.equal(findCategoryById(categories, null), null);
  assert.equal(findCategoryById(categories, "missing"), null);
});
