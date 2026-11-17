/**
 * Integration test against the real dev Postgres (same connection
 * seed.ts uses). setTopLevelCategoryPosition/normalizeTopLevelCategoryPositions
 * re-rank the WHOLE active top-level Category set (no per-test scoping is
 * possible — there's nothing to scope by, it's a flat top-level list), so
 * assertions here are relative ("A ends up before B") rather than exact
 * position numbers, which would be fragile against however many real
 * categories the seeded/dev data happens to have. Three throwaway
 * fixture categories are created and torn down; no existing category is
 * renamed, deactivated, or deleted.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import {
  setTopLevelCategoryPosition,
  normalizeTopLevelCategoryPositions,
  getNextTopLevelCategoryPosition,
} from "./category-hierarchy";

let catAId: string;
let catBId: string;
let catCId: string;

before(async () => {
  const stamp = Date.now();
  const [a, b, c] = await Promise.all([
    prisma.category.create({
      data: {
        name: `TEST FIXTURE Cat A ${stamp}`,
        slug: `test-fixture-cat-a-${stamp}`,
        isActive: true,
      },
    }),
    prisma.category.create({
      data: {
        name: `TEST FIXTURE Cat B ${stamp}`,
        slug: `test-fixture-cat-b-${stamp}`,
        isActive: true,
      },
    }),
    prisma.category.create({
      data: {
        name: `TEST FIXTURE Cat C ${stamp}`,
        slug: `test-fixture-cat-c-${stamp}`,
        isActive: true,
      },
    }),
  ]);
  catAId = a.id;
  catBId = b.id;
  catCId = c.id;
});

after(async () => {
  await prisma.category.deleteMany({ where: { id: { in: [catAId, catBId, catCId] } } });
});

async function positionOf(id: string): Promise<number> {
  return (await prisma.category.findUniqueOrThrow({ where: { id }, select: { position: true } }))
    .position;
}

test("moving a category to position 1 places it before every other active category", async () => {
  const result = await setTopLevelCategoryPosition(catAId, 1);
  assert.equal(result.ok, true);
  const [posA, posB] = await Promise.all([positionOf(catAId), positionOf(catBId)]);
  assert.ok(posA < posB, `expected A (${posA}) before B (${posB})`);
});

test("reordering never leaves duplicate positions among active top-level categories", async () => {
  await setTopLevelCategoryPosition(catBId, 1);
  const active = await prisma.category.findMany({
    where: { isActive: true },
    select: { position: true },
  });
  const positions = active.map((c) => c.position);
  assert.equal(new Set(positions).size, positions.length, "positions must be unique");
});

test("moving a category between two others shifts them correctly (A < C < B)", async () => {
  await setTopLevelCategoryPosition(catAId, 1);
  const posA = await positionOf(catAId);
  await setTopLevelCategoryPosition(catBId, posA + 1);
  const posAAgain = await positionOf(catAId);
  await setTopLevelCategoryPosition(catCId, posAAgain + 1);

  const [pa, pb, pc] = await Promise.all([
    positionOf(catAId),
    positionOf(catBId),
    positionOf(catCId),
  ]);
  assert.ok(pa < pc && pc < pb, `expected A < C < B, got A=${pa} C=${pc} B=${pb}`);
});

test("getNextTopLevelCategoryPosition places a new category after every currently active one", async () => {
  const [next, active] = await Promise.all([
    getNextTopLevelCategoryPosition(),
    prisma.category.findMany({ where: { isActive: true }, select: { position: true } }),
  ]);
  const maxActive = Math.max(...active.map((c) => c.position));
  assert.ok(next > maxActive, `expected next (${next}) > current max (${maxActive})`);
});

test("normalizeTopLevelCategoryPositions leaves active positions as a contiguous 1..N sequence", async () => {
  await normalizeTopLevelCategoryPositions();
  const active = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { position: "asc" },
    select: { position: true },
  });
  const positions = active.map((c) => c.position);
  const expected = Array.from({ length: positions.length }, (_, i) => i + 1);
  assert.deepEqual(positions, expected);
});

test("setTopLevelCategoryPosition rejects an inactive category", async () => {
  await prisma.category.update({ where: { id: catCId }, data: { isActive: false } });
  try {
    const result = await setTopLevelCategoryPosition(catCId, 1);
    assert.equal(result.ok, false);
  } finally {
    await prisma.category.update({ where: { id: catCId }, data: { isActive: true } });
    await normalizeTopLevelCategoryPositions();
  }
});
