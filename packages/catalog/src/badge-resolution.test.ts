/** Pure-function tests, no DB — priority-order coverage for resolveCardBadge. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCardBadge } from "./badge-resolution";

test("no candidates returns null", () => {
  assert.equal(resolveCardBadge({}), null);
});

test("availability outranks everything else", () => {
  const result = resolveCardBadge({
    availability: { text: "Out of Stock", tone: "danger" },
    deal: { text: "Deal of the Day", tone: "warning" },
    delivery: { text: "Express Delivery", tone: "info" },
    editorial: { text: "Best Seller", tone: "success" },
  });
  assert.deepEqual(result, { text: "Out of Stock", tone: "danger" });
});

test("deal outranks delivery and editorial when availability is absent", () => {
  const result = resolveCardBadge({
    deal: { text: "Deal of the Day", tone: "warning" },
    delivery: { text: "Express Delivery", tone: "info" },
    editorial: { text: "Best Seller", tone: "success" },
  });
  assert.deepEqual(result, { text: "Deal of the Day", tone: "warning" });
});

test("delivery outranks editorial when availability and deal are absent", () => {
  const result = resolveCardBadge({
    delivery: { text: "Express Delivery", tone: "info" },
    editorial: { text: "Best Seller", tone: "success" },
  });
  assert.deepEqual(result, { text: "Express Delivery", tone: "info" });
});

test("editorial shows only when nothing higher-priority is present", () => {
  const result = resolveCardBadge({ editorial: { text: "New", tone: "success" } });
  assert.deepEqual(result, { text: "New", tone: "success" });
});

test("exactly one badge is ever returned, never a combination", () => {
  const result = resolveCardBadge({
    availability: { text: "Out of Stock", tone: "danger" },
    deal: { text: "Deal of the Day", tone: "warning" },
  });
  assert.equal(Object.keys(result ?? {}).length <= 2, true);
  assert.equal(result?.text, "Out of Stock");
});
