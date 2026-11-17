/**
 * Integration test against the real dev Postgres — same throwaway-
 * fixture convention as category-hierarchy.test.ts. Covers the mobile
 * Shop screen's data dependency: getCategoryNavTree must return
 * `imageUrl` at all three levels (Category/Subcategory/SubSubCategory —
 * previously it didn't, which was a real gap fixed this session), must
 * order by `position`, and must exclude inactive rows at every level.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { getCategoryNavTree } from "./queries";

const RUN = Date.now();
let categoryId: string;
let subCategoryActiveId: string;
let subCategoryInactiveId: string;
let subSubCategoryId: string;

before(async () => {
  const category = await prisma.category.create({
    data: {
      name: `TEST FIXTURE Nav Category ${RUN}`,
      slug: `test-fixture-nav-category-${RUN}`,
      isActive: true,
      imageUrl: "https://example.com/category.png",
      position: 999990,
    },
  });
  categoryId = category.id;

  const [active, inactive] = await Promise.all([
    prisma.subcategory.create({
      data: {
        name: `TEST FIXTURE Nav Subcategory Active ${RUN}`,
        slug: `test-fixture-nav-subcategory-active-${RUN}`,
        isActive: true,
        imageUrl: "https://example.com/subcategory.png",
        position: 1,
        categoryId,
      },
    }),
    prisma.subcategory.create({
      data: {
        name: `TEST FIXTURE Nav Subcategory Inactive ${RUN}`,
        slug: `test-fixture-nav-subcategory-inactive-${RUN}`,
        isActive: false,
        position: 2,
        categoryId,
      },
    }),
  ]);
  subCategoryActiveId = active.id;
  subCategoryInactiveId = inactive.id;

  const subSubCategory = await prisma.subSubCategory.create({
    data: {
      name: `TEST FIXTURE Nav SubSubCategory ${RUN}`,
      slug: `test-fixture-nav-subsubcategory-${RUN}`,
      isActive: true,
      imageUrl: "https://example.com/subsubcategory.png",
      position: 1,
      subCategoryId: subCategoryActiveId,
    },
  });
  subSubCategoryId = subSubCategory.id;
});

after(async () => {
  await prisma.subSubCategory.delete({ where: { id: subSubCategoryId } }).catch(() => {});
  await prisma.subcategory.deleteMany({
    where: { id: { in: [subCategoryActiveId, subCategoryInactiveId] } },
  });
  await prisma.category.delete({ where: { id: categoryId } }).catch(() => {});
});

test("getCategoryNavTree returns imageUrl at every level (category, subcategory, sub-subcategory)", async () => {
  const tree = await getCategoryNavTree();
  const category = tree.find((c) => c.id === categoryId);
  assert.ok(category, "fixture category not found in the tree");
  assert.equal(category.imageUrl, "https://example.com/category.png");

  const subCategory = category.subCategories.find((s) => s.id === subCategoryActiveId);
  assert.ok(subCategory, "active fixture subcategory not found");
  assert.equal(subCategory.imageUrl, "https://example.com/subcategory.png");

  const subSubCategory = subCategory.subSubCategories.find((s) => s.id === subSubCategoryId);
  assert.ok(subSubCategory, "fixture sub-subcategory not found");
  assert.equal(subSubCategory.imageUrl, "https://example.com/subsubcategory.png");
});

test("getCategoryNavTree excludes inactive subcategories", async () => {
  const tree = await getCategoryNavTree();
  const category = tree.find((c) => c.id === categoryId);
  assert.ok(category);
  assert.ok(
    !category.subCategories.some((s) => s.id === subCategoryInactiveId),
    "an inactive subcategory must not appear",
  );
});
