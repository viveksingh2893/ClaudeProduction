import { prisma } from "@kisan4u/db";
import { calculateShippingCostForWeight } from "@kisan4u/catalog";
import type {
  AddToCartInput,
  UpdateCartItemQuantityInput,
  ShippingMatchResult,
} from "@kisan4u/validators";
import {
  validateCartLine,
  type LineValidationContext,
  type LineValidationErrorCode,
} from "./line-validation";
import { round2, sum } from "./money";

export type CartMutationResult = { ok: true; cartItemId: string } | { ok: false; error: string };

/**
 * Every add/update mutation re-runs validateCartLine (Phase 4 spec §B3) —
 * quantity is the only thing ever taken from the client input alongside
 * product/variant identity; price, seller id, and weight are always
 * re-derived. Re-adding an already-in-cart product+variant increases
 * quantity rather than creating a duplicate line.
 */
export async function addToCart(
  userId: string,
  ctx: LineValidationContext,
  input: AddToCartInput,
): Promise<CartMutationResult> {
  const variantId = input.variantId ?? null;
  const existing = await prisma.cartItem.findFirst({
    where: { userId, productId: input.productId, variantId },
  });
  const requestedQuantity = existing ? existing.quantity + input.quantity : input.quantity;

  const result = await validateCartLine(input.productId, variantId, requestedQuantity, ctx);
  if (!result.ok) return result;
  const { line } = result;

  if (existing) {
    const updated = await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: requestedQuantity, priceAtAdd: line.sellingPrice, sellerId: line.sellerId },
    });
    return { ok: true, cartItemId: updated.id };
  }

  const created = await prisma.cartItem.create({
    data: {
      userId,
      productId: line.productId,
      variantId: line.variantId,
      sellerId: line.sellerId,
      quantity: input.quantity,
      priceAtAdd: line.sellingPrice,
    },
  });
  return { ok: true, cartItemId: created.id };
}

/** Ownership-scoped: returns "not found" (never the row) if the cart item belongs to another user — a user must not modify another user's cart item by guessing/changing an id (Phase 4 spec §B2). */
export async function updateCartItemQuantity(
  userId: string,
  ctx: LineValidationContext,
  input: UpdateCartItemQuantityInput,
): Promise<CartMutationResult> {
  const item = await prisma.cartItem.findFirst({ where: { id: input.cartItemId, userId } });
  if (!item) return { ok: false, error: "Cart item not found." };

  const result = await validateCartLine(item.productId, item.variantId, input.quantity, ctx);
  if (!result.ok) return result;

  const updated = await prisma.cartItem.update({
    where: { id: item.id },
    data: {
      quantity: input.quantity,
      priceAtAdd: result.line.sellingPrice,
      sellerId: result.line.sellerId,
    },
  });
  return { ok: true, cartItemId: updated.id };
}

export async function removeCartItem(
  userId: string,
  cartItemId: string,
): Promise<CartMutationResult> {
  const item = await prisma.cartItem.findFirst({ where: { id: cartItemId, userId } });
  if (!item) return { ok: false, error: "Cart item not found." };
  await prisma.cartItem.delete({ where: { id: item.id } });
  return { ok: true, cartItemId: item.id };
}

export async function clearCart(userId: string): Promise<{ removed: number }> {
  const result = await prisma.cartItem.deleteMany({ where: { userId } });
  return { removed: result.count };
}

/** Lightweight count for the nav bar's cart badge — deliberately not getCartForUser, which re-validates every line against live product/state/licence rules on every call; the badge only needs a row count, not a full revalidation pass. */
export async function getCartItemCount(userId: string): Promise<number> {
  return prisma.cartItem.count({ where: { userId } });
}

export type CartLineView = {
  cartItemId: string;
  productId: string;
  productName: string;
  productImageUrl: string;
  variantId: string | null;
  variantLabel: string | null;
  sku: string;
  quantity: number;
  unitWeightGrams: number | null;
  totalWeightGrams: number | null;
  currentPrice: number | null;
  priceAtAdd: number;
  priceChanged: boolean;
  mrp: number | null;
  minOrderQty: number | null;
  currentStock: number | null;
  lineSubtotal: number | null;
  /** Non-null means this line can no longer be checked out — shown to the customer before checkout, per §B1 ("see cart validation errors before checkout"). */
  validationError: string | null;
  /** Machine-readable pairing for validationError — lets the UI add scenario-specific guidance (e.g. STATE_UNAVAILABLE/LICENSE_MISSING get a "this depends on your delivery address, not your account state" note) without string-matching the message. */
  validationErrorCode: LineValidationErrorCode | null;
};

export type SellerGroupView = {
  sellerId: string;
  sellerName: string;
  items: CartLineView[];
  subtotal: number;
  totalWeightGrams: number;
  logisticsEstimate: ShippingMatchResult;
};

export type CartView = {
  sellerGroups: SellerGroupView[];
  overallTotal: number;
  hasValidationErrors: boolean;
};

/**
 * The cart-page read model — grouped by seller (Phase 4 spec §B5) since
 * checkout will split into one order per seller. Re-validates every line
 * live (so a price change, a product going inactive, or a stock drop is
 * always shown immediately, never a stale value — §B4) but does NOT
 * remove invalid lines automatically; the customer can still see and
 * remove them.
 */
export async function getCartForUser(
  userId: string,
  ctx: LineValidationContext,
): Promise<CartView> {
  const items = await prisma.cartItem.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });

  type LineWithSeller = CartLineView & { sellerId: string; sellerNameForGroup: string };
  const lines: LineWithSeller[] = [];

  for (const item of items) {
    const result = await validateCartLine(item.productId, item.variantId, item.quantity, ctx);

    if (!result.ok) {
      const fallback = await prisma.product.findUnique({
        where: { id: item.productId },
        select: { name: true, primaryImageUrl: true, sku: true },
      });
      lines.push({
        cartItemId: item.id,
        productId: item.productId,
        productName: fallback?.name ?? "Unavailable product",
        productImageUrl: fallback?.primaryImageUrl ?? "",
        variantId: item.variantId,
        variantLabel: null,
        sku: fallback?.sku ?? "",
        quantity: item.quantity,
        unitWeightGrams: null,
        totalWeightGrams: null,
        currentPrice: null,
        priceAtAdd: Number(item.priceAtAdd),
        priceChanged: false,
        mrp: null,
        minOrderQty: null,
        currentStock: null,
        lineSubtotal: null,
        validationError: result.error,
        validationErrorCode: result.code,
        sellerId: item.sellerId,
        sellerNameForGroup: "Unavailable seller",
      });
      continue;
    }

    const { line } = result;
    lines.push({
      cartItemId: item.id,
      productId: line.productId,
      productName: line.productName,
      productImageUrl: line.productImageUrl,
      variantId: line.variantId,
      variantLabel: line.variantLabel,
      sku: line.sku,
      quantity: item.quantity,
      unitWeightGrams: line.weightGrams,
      totalWeightGrams: line.weightGrams * item.quantity,
      currentPrice: line.sellingPrice,
      priceAtAdd: Number(item.priceAtAdd),
      priceChanged: round2(Number(item.priceAtAdd)) !== round2(line.sellingPrice),
      mrp: line.mrp,
      minOrderQty: line.minOrderQty,
      currentStock: line.currentStock,
      lineSubtotal: round2(line.sellingPrice * item.quantity),
      validationError: null,
      validationErrorCode: null,
      sellerId: line.sellerId,
      sellerNameForGroup: line.sellerName,
    });
  }

  const bySeller = new Map<string, LineWithSeller[]>();
  for (const line of lines) {
    const group = bySeller.get(line.sellerId) ?? [];
    group.push(line);
    bySeller.set(line.sellerId, group);
  }

  const sellerGroups: SellerGroupView[] = [];
  for (const [sellerId, groupLines] of bySeller) {
    const subtotal = sum(groupLines.map((l) => l.lineSubtotal ?? 0));
    const totalWeightGrams = groupLines.reduce((total, l) => total + (l.totalWeightGrams ?? 0), 0);
    const logisticsEstimate: ShippingMatchResult =
      totalWeightGrams > 0
        ? await calculateShippingCostForWeight(totalWeightGrams)
        : { ok: false, error: "Add a purchasable item to estimate shipping." };

    sellerGroups.push({
      sellerId,
      sellerName: groupLines[0]!.sellerNameForGroup,
      items: groupLines.map(({ sellerNameForGroup: _drop, ...rest }) => rest),
      subtotal,
      totalWeightGrams,
      logisticsEstimate,
    });
  }

  return {
    sellerGroups,
    overallTotal: sum(sellerGroups.map((g) => g.subtotal)),
    hasValidationErrors: lines.some((l) => l.validationError != null),
  };
}
