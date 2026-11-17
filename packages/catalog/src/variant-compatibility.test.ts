/** Pure unit tests — no database, no fixtures beyond plain in-memory objects. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  getVariantAttributes,
  getAvailableValuesForAttribute,
  isSelectionComplete,
  resolveVariant,
  applySelection,
  getInitialSelection,
  type CompatibilityVariant,
} from "./variant-compatibility";

// --- Fixtures ---------------------------------------------------------------

const COLOUR = "attr-colour";
const SIZE = "attr-size";
const RED = "val-red";
const BLUE = "val-blue";
const S30 = "val-30";
const S32 = "val-32";
const S33 = "val-33";

function av(attributeId: string, attributeName: string, valueId: string, value: string) {
  return { attributeId, attributeName, valueId, value };
}

/**
 * The exact example from the spec: Red is available in 30/32; Blue is
 * available in 30/32/33. Four real SKUs, no combination for Red+33.
 */
function redBlueSizeVariants(
  overrides: Partial<Record<string, Partial<CompatibilityVariant>>> = {},
): CompatibilityVariant[] {
  const base: CompatibilityVariant[] = [
    {
      id: "v-red-30",
      isActive: true,
      stockQty: 5,
      attributeValues: [av(COLOUR, "Colour", RED, "Red"), av(SIZE, "Size", S30, "30")],
    },
    {
      id: "v-red-32",
      isActive: true,
      stockQty: 5,
      attributeValues: [av(COLOUR, "Colour", RED, "Red"), av(SIZE, "Size", S32, "32")],
    },
    {
      id: "v-blue-30",
      isActive: true,
      stockQty: 5,
      attributeValues: [av(COLOUR, "Colour", BLUE, "Blue"), av(SIZE, "Size", S30, "30")],
    },
    {
      id: "v-blue-32",
      isActive: true,
      stockQty: 5,
      attributeValues: [av(COLOUR, "Colour", BLUE, "Blue"), av(SIZE, "Size", S32, "32")],
    },
    {
      id: "v-blue-33",
      isActive: true,
      stockQty: 5,
      attributeValues: [av(COLOUR, "Colour", BLUE, "Blue"), av(SIZE, "Size", S33, "33")],
    },
  ];
  return base.map((v) => ({ ...v, ...overrides[v.id] }));
}

describe("getVariantAttributes", () => {
  test("derives attributes and values from the variant matrix, not a hard-coded list", () => {
    const attrs = getVariantAttributes(redBlueSizeVariants());
    assert.equal(attrs.length, 2);
    assert.equal(attrs[0]!.attributeId, COLOUR);
    assert.deepEqual(
      attrs[0]!.options.map((o) => o.value),
      ["Red", "Blue"],
    );
    assert.equal(attrs[1]!.attributeId, SIZE);
    assert.deepEqual(
      attrs[1]!.options.map((o) => o.value),
      ["30", "32", "33"],
    );
  });

  test("works for a single attribute (no assumption that Colour+Size always exist together)", () => {
    const oneAttr: CompatibilityVariant[] = [
      { id: "v-s", isActive: true, stockQty: 1, attributeValues: [av(SIZE, "Size", S30, "30")] },
      { id: "v-m", isActive: true, stockQty: 1, attributeValues: [av(SIZE, "Size", S32, "32")] },
    ];
    const attrs = getVariantAttributes(oneAttr);
    assert.equal(attrs.length, 1);
    assert.equal(attrs[0]!.options.length, 2);
  });

  test("returns nothing for a product with no variants", () => {
    assert.deepEqual(getVariantAttributes([]), []);
  });
});

describe("getAvailableValuesForAttribute — the Red/Blue/30/32/33 example", () => {
  test("no selection yet: every colour and every size is available", () => {
    const variants = redBlueSizeVariants();
    const colours = getAvailableValuesForAttribute(variants, {}, COLOUR);
    assert.deepEqual(
      colours.map((c) => [c.value, c.available]),
      [
        ["Red", true],
        ["Blue", true],
      ],
    );
    const sizes = getAvailableValuesForAttribute(variants, {}, SIZE);
    assert.deepEqual(
      sizes.map((s) => [s.value, s.available]),
      [
        ["30", true],
        ["32", true],
        ["33", true],
      ],
    );
  });

  test("Red selected: sizes 30 and 32 stay available, 33 becomes unavailable", () => {
    const variants = redBlueSizeVariants();
    const sizes = getAvailableValuesForAttribute(variants, { [COLOUR]: RED }, SIZE);
    assert.deepEqual(
      sizes.map((s) => [s.value, s.available]),
      [
        ["30", true],
        ["32", true],
        ["33", false],
      ],
    );
  });

  test("Blue selected: all three sizes stay available", () => {
    const variants = redBlueSizeVariants();
    const sizes = getAvailableValuesForAttribute(variants, { [COLOUR]: BLUE }, SIZE);
    assert.ok(sizes.every((s) => s.available));
  });

  test("size 33 selected: only Blue is available for colour", () => {
    const variants = redBlueSizeVariants();
    const colours = getAvailableValuesForAttribute(variants, { [SIZE]: S33 }, COLOUR);
    assert.deepEqual(
      colours.map((c) => [c.value, c.available]),
      [
        ["Red", false],
        ["Blue", true],
      ],
    );
  });

  test("a candidate's own current selection doesn't block itself", () => {
    // Selecting Red should still show Red itself as available when asked
    // "what colours are compatible with {colour: Red}" — the function
    // ignores attributeId's own entry in `selection` while evaluating it.
    const variants = redBlueSizeVariants();
    const colours = getAvailableValuesForAttribute(variants, { [COLOUR]: RED }, COLOUR);
    assert.ok(colours.find((c) => c.valueId === RED)?.available);
  });
});

describe("out-of-stock and inactive variants", () => {
  test("a combination with zero stock is still selectable (available) but flagged not in stock", () => {
    const variants = redBlueSizeVariants({ "v-red-32": { stockQty: 0 } });
    const sizes = getAvailableValuesForAttribute(variants, { [COLOUR]: RED }, SIZE);
    const size32 = sizes.find((s) => s.value === "32")!;
    assert.equal(size32.available, true);
    assert.equal(size32.inStock, false);
  });

  test("a deactivated variant's combination is treated as unavailable, not just out of stock", () => {
    const variants = redBlueSizeVariants({ "v-red-32": { isActive: false } });
    const sizes = getAvailableValuesForAttribute(variants, { [COLOUR]: RED }, SIZE);
    const size32 = sizes.find((s) => s.value === "32")!;
    assert.equal(size32.available, false);
    assert.equal(size32.inStock, false);
  });

  test("resolveVariant never resolves to a deactivated variant even if the combination exists", () => {
    const variants = redBlueSizeVariants({ "v-red-30": { isActive: false } });
    const resolved = resolveVariant(variants, { [COLOUR]: RED, [SIZE]: S30 });
    assert.equal(resolved, null);
  });
});

describe("resolveVariant", () => {
  test("resolves a complete, valid selection to exactly the right SKU", () => {
    const variants = redBlueSizeVariants();
    const resolved = resolveVariant(variants, { [COLOUR]: BLUE, [SIZE]: S33 });
    assert.equal(resolved?.id, "v-blue-33");
  });

  test("returns null for an incomplete selection", () => {
    const variants = redBlueSizeVariants();
    assert.equal(resolveVariant(variants, { [COLOUR]: RED }), null);
    assert.equal(resolveVariant(variants, {}), null);
  });

  test("returns null for a selection with no matching variant (Red + 33 doesn't exist)", () => {
    const variants = redBlueSizeVariants();
    assert.equal(resolveVariant(variants, { [COLOUR]: RED, [SIZE]: S33 }), null);
  });

  test("resolution is based on attribute-value ids, not display text — two values that render identically but have different ids never collide", () => {
    const trickyVariants: CompatibilityVariant[] = [
      {
        id: "v-a",
        isActive: true,
        stockQty: 1,
        attributeValues: [av(COLOUR, "Colour", "id-1", "Red"), av(SIZE, "Size", "id-3", "30")],
      },
      {
        id: "v-b",
        isActive: true,
        stockQty: 1,
        attributeValues: [av(COLOUR, "Colour", "id-2", "Red"), av(SIZE, "Size", "id-3", "30")],
      },
    ];
    const resolvedA = resolveVariant(trickyVariants, { [COLOUR]: "id-1", [SIZE]: "id-3" });
    const resolvedB = resolveVariant(trickyVariants, { [COLOUR]: "id-2", [SIZE]: "id-3" });
    assert.equal(resolvedA?.id, "v-a");
    assert.equal(resolvedB?.id, "v-b");
  });
});

describe("isSelectionComplete", () => {
  test("false until every attribute has a value, true once it does", () => {
    const variants = redBlueSizeVariants();
    assert.equal(isSelectionComplete(variants, {}), false);
    assert.equal(isSelectionComplete(variants, { [COLOUR]: RED }), false);
    assert.equal(isSelectionComplete(variants, { [COLOUR]: RED, [SIZE]: S30 }), true);
  });

  test("false for a product with zero variants (never claims complete on nothing)", () => {
    assert.equal(isSelectionComplete([], {}), false);
  });
});

describe("applySelection", () => {
  test("picking Red after Size 33 was selected clears only Size, not the whole selection", () => {
    const variants = redBlueSizeVariants();
    const { selection, clearedAttributeIds } = applySelection(
      variants,
      { [SIZE]: S33 },
      COLOUR,
      RED,
    );
    assert.deepEqual(clearedAttributeIds, [SIZE]);
    assert.deepEqual(selection, { [COLOUR]: RED });
  });

  test("picking Blue after Size 33 was selected clears nothing — Blue+33 is a real combination", () => {
    const variants = redBlueSizeVariants();
    const { selection, clearedAttributeIds } = applySelection(
      variants,
      { [SIZE]: S33 },
      COLOUR,
      BLUE,
    );
    assert.deepEqual(clearedAttributeIds, []);
    assert.deepEqual(selection, { [SIZE]: S33, [COLOUR]: BLUE });
  });

  test("a no-op change (re-picking the same value) never clears anything", () => {
    const variants = redBlueSizeVariants();
    const { clearedAttributeIds } = applySelection(
      variants,
      { [COLOUR]: RED, [SIZE]: S30 },
      COLOUR,
      RED,
    );
    assert.deepEqual(clearedAttributeIds, []);
  });
});

describe("getInitialSelection", () => {
  test("pre-fills from the marked default variant when it's active", () => {
    const variants = redBlueSizeVariants();
    const selection = getInitialSelection(variants, "v-blue-32");
    assert.deepEqual(selection, { [COLOUR]: BLUE, [SIZE]: S32 });
  });

  test("falls back to the first active variant when there is no default / the default is inactive", () => {
    const variants = redBlueSizeVariants({ "v-red-30": { isActive: false } });
    const selection = getInitialSelection(variants, "v-red-30");
    assert.deepEqual(selection, { [COLOUR]: RED, [SIZE]: S32 });
  });

  test("returns an empty selection for a product with no variants", () => {
    assert.deepEqual(getInitialSelection([], null), {});
  });
});
