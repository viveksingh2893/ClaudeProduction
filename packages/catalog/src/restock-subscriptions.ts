import { prisma, Prisma, type VariantAudience } from "@kisan4u/db";
import { isProductAvailableForState } from "./availability";
import type { StockTarget } from "./inventory";

type TxClient = Prisma.TransactionClient | typeof prisma;

type EligibilityProduct = {
  lifecycleStatus: string;
  customerVisible: boolean;
  dealerVisible: boolean;
  customerAvailableStates: { id: string }[];
  dealerAvailableStates: { id: string }[];
};

/**
 * Reuses the product's already-licence-reconciled availableStates lists
 * (kept in sync with real licence approval by
 * packages/catalog/src/licence-compliance.ts's reconcile functions) rather
 * than re-deriving licence eligibility from scratch — the same source of
 * truth getCustomerCatalogue/getDealerCatalogue already read from, so a
 * restock alert can never fire for someone the catalogue itself wouldn't
 * currently show the product to.
 */
function isEligibleProductForAudience(
  product: EligibilityProduct,
  audience: VariantAudience,
  stateId: string | null,
): boolean {
  if (product.lifecycleStatus !== "APPROVED") return false;
  if (audience === "CUSTOMER") {
    if (!product.customerVisible) return false;
    return isProductAvailableForState(product.customerAvailableStates, stateId);
  }
  if (!product.dealerVisible) return false;
  return isProductAvailableForState(product.dealerAvailableStates, stateId);
}

type TargetContext = {
  productId: string;
  audience: VariantAudience;
  availableQty: number;
  product: EligibilityProduct;
};

const ELIGIBILITY_SELECT = {
  lifecycleStatus: true,
  customerVisible: true,
  dealerVisible: true,
  customerAvailableStates: { select: { id: true } },
  dealerAvailableStates: { select: { id: true } },
} as const;

async function loadTargetContext(
  client: TxClient,
  target: StockTarget,
): Promise<TargetContext | null> {
  if (target.kind === "variant") {
    const variant = await client.productVariant.findUnique({
      where: { id: target.variantId },
      select: {
        audience: true,
        stockQty: true,
        product: { select: { id: true, ...ELIGIBILITY_SELECT } },
      },
    });
    if (!variant) return null;
    return {
      productId: variant.product.id,
      audience: variant.audience,
      availableQty: variant.stockQty,
      product: variant.product,
    };
  }
  const product = await client.product.findUnique({
    where: { id: target.productId },
    select: {
      id: true,
      ...ELIGIBILITY_SELECT,
      customerConfig: { select: { currentStock: true } },
      dealerConfig: { select: { currentStock: true } },
    },
  });
  if (!product) return null;
  const availableQty =
    target.audience === "CUSTOMER"
      ? (product.customerConfig?.currentStock ?? 0)
      : (product.dealerConfig?.currentStock ?? 0);
  return { productId: product.id, audience: target.audience, availableQty, product };
}

export type SubscribeResult = { ok: true; subscriptionId: string } | { ok: false; error: string };

/**
 * "Notify me when stock is available" — spec §9. Idempotent: an existing
 * ACTIVE row is returned as-is (never a duplicate), and a FULFILLED/
 * CANCELLED row is reactivated in place rather than creating a second row
 * — the unique constraint on (userId, productId, variantId, audience)
 * makes a true duplicate impossible even under a race between two
 * concurrent requests from the same user (the loser's create fails the
 * constraint; callers can safely retry, though in practice this endpoint
 * is only ever hit from one browser tab at a time).
 */
export async function subscribeToRestock(
  userId: string,
  target: StockTarget,
): Promise<SubscribeResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, stateId: true },
  });
  if (!user || (user.role !== "CUSTOMER" && user.role !== "DEALER")) {
    return { ok: false, error: "Only signed-in customers or dealers can request a restock alert." };
  }
  const requiredAudience: VariantAudience = user.role === "CUSTOMER" ? "CUSTOMER" : "DEALER";

  const context = await loadTargetContext(prisma, target);
  if (!context) return { ok: false, error: "Item not found." };
  if (context.audience !== requiredAudience) {
    return { ok: false, error: "This item is not available to your account type." };
  }
  if (context.availableQty > 0) {
    return { ok: false, error: "This item is currently in stock." };
  }

  const stateId =
    user.role === "CUSTOMER"
      ? user.stateId
      : ((await prisma.dealerProfile.findUnique({ where: { userId }, select: { stateId: true } }))
          ?.stateId ?? null);
  if (!isEligibleProductForAudience(context.product, requiredAudience, stateId)) {
    return {
      ok: false,
      error:
        "This item isn't currently available to your account — a stock alert would never fire.",
    };
  }

  const variantIdKey = target.kind === "variant" ? target.variantId : "";
  const existing = await prisma.restockSubscription.findUnique({
    where: {
      userId_productId_variantId_audience: {
        userId,
        productId: context.productId,
        variantId: variantIdKey,
        audience: requiredAudience,
      },
    },
  });
  if (existing) {
    if (existing.status === "ACTIVE") return { ok: true, subscriptionId: existing.id };
    const reactivated = await prisma.restockSubscription.update({
      where: { id: existing.id },
      data: { status: "ACTIVE", subscribedAt: new Date(), notifiedAt: null, cancelledAt: null },
    });
    return { ok: true, subscriptionId: reactivated.id };
  }

  const created = await prisma.restockSubscription.create({
    data: {
      userId,
      productId: context.productId,
      variantId: variantIdKey,
      audience: requiredAudience,
    },
  });
  return { ok: true, subscriptionId: created.id };
}

export type CancelResult = { ok: true } | { ok: false; error: string };

export async function cancelRestockSubscription(
  userId: string,
  subscriptionId: string,
): Promise<CancelResult> {
  const sub = await prisma.restockSubscription.findUnique({ where: { id: subscriptionId } });
  if (!sub || sub.userId !== userId) return { ok: false, error: "Subscription not found." };
  if (sub.status !== "ACTIVE")
    return { ok: false, error: "This subscription is no longer active." };
  await prisma.restockSubscription.update({
    where: { id: subscriptionId },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  return { ok: true };
}

/** UI button state — "Notify me" (NONE/CANCELLED-effectively-NONE) vs "Notification requested" (ACTIVE) vs already fulfilled once (FULFILLED, still offered again since the item went back out of stock or the user wants a fresh alert only after a genuinely new stock-out — the product page itself decides whether to show FULFILLED as "Notify me" again based on current live stock). */
export async function getRestockSubscriptionStatus(
  userId: string,
  productId: string,
  variantId: string | null,
  audience: VariantAudience,
): Promise<"NONE" | "ACTIVE" | "FULFILLED"> {
  const sub = await prisma.restockSubscription.findUnique({
    where: {
      userId_productId_variantId_audience: {
        userId,
        productId,
        variantId: variantId ?? "",
        audience,
      },
    },
  });
  if (!sub || sub.status === "CANCELLED") return "NONE";
  return sub.status;
}

/** Batched counterpart of getRestockSubscriptionStatus for a product detail page with several variants — one query instead of one per variant. Keyed by variantId, with "" for the non-variant/base row. */
export async function getRestockSubscriptionStatusesForProduct(
  userId: string,
  productId: string,
  audience: VariantAudience,
): Promise<Map<string, { status: "ACTIVE" | "FULFILLED"; subscriptionId: string }>> {
  const subs = await prisma.restockSubscription.findMany({
    where: { userId, productId, audience, status: { in: ["ACTIVE", "FULFILLED"] } },
  });
  return new Map(
    subs.map((s) => [
      s.variantId,
      { status: s.status as "ACTIVE" | "FULFILLED", subscriptionId: s.id },
    ]),
  );
}

function variantLabelFromValues(
  values: Array<{ attributeValue: { value: string; attribute: { name: string } } }>,
): string {
  return values
    .map((v) => `${v.attributeValue.attribute.name}: ${v.attributeValue.value}`)
    .join(", ");
}

/**
 * Called only from packages/catalog/src/inventory.ts's recordStockChange,
 * inside the SAME transaction as the stock write that crossed 0 -> positive
 * — spec §10: a rolled-back transaction must never send an alert, which
 * this satisfies for free by living inside that transaction rather than
 * being scheduled after it. Every recipient's audience/state/licence
 * eligibility (via the product's already-reconciled state lists) and the
 * product's approval/publish status are all rechecked here, right before
 * sending — never trusted from subscription time, which may be stale.
 */
export async function triggerRestockNotifications(
  tx: TxClient,
  params: { productId: string; variantId: string | null; audience: VariantAudience },
): Promise<void> {
  const variantIdKey = params.variantId ?? "";
  const subs = await tx.restockSubscription.findMany({
    where: {
      productId: params.productId,
      variantId: variantIdKey,
      audience: params.audience,
      status: "ACTIVE",
    },
  });
  if (subs.length === 0) return;

  const product = await tx.product.findUnique({
    where: { id: params.productId },
    select: { name: true, slug: true, primaryImageUrl: true, ...ELIGIBILITY_SELECT },
  });
  if (!product) return;

  let variantImageUrl: string | null = null;
  let variantLabel: string | null = null;
  if (params.variantId) {
    const variant = await tx.productVariant.findUnique({
      where: { id: params.variantId },
      select: {
        imageUrl: true,
        values: {
          select: {
            attributeValue: { select: { value: true, attribute: { select: { name: true } } } },
          },
        },
      },
    });
    if (variant) {
      variantImageUrl = variant.imageUrl;
      variantLabel = variantLabelFromValues(variant.values);
    }
  }
  const imageUrl = variantImageUrl || product.primaryImageUrl;
  const linkUrl =
    params.audience === "DEALER"
      ? `/dealer/products/${params.productId}`
      : `/products/${product.slug}`;
  const body = variantLabel
    ? `${variantLabel} of ${product.name} is back in stock.`
    : `${product.name} is back in stock.`;

  for (const sub of subs) {
    const stateId =
      params.audience === "CUSTOMER"
        ? await tx.user.findUnique({
            where: { id: sub.userId },
            select: { role: true, stateId: true },
          })
        : null;
    if (params.audience === "CUSTOMER") {
      if (!stateId || stateId.role !== "CUSTOMER") continue;
      if (!isEligibleProductForAudience(product, "CUSTOMER", stateId.stateId)) continue;
    } else {
      const [user, dealer] = await Promise.all([
        tx.user.findUnique({ where: { id: sub.userId }, select: { role: true } }),
        tx.dealerProfile.findUnique({ where: { userId: sub.userId }, select: { stateId: true } }),
      ]);
      if (!user || user.role !== "DEALER" || !dealer) continue;
      if (!isEligibleProductForAudience(product, "DEALER", dealer.stateId)) continue;
    }

    await tx.notification.create({
      data: { userId: sub.userId, title: "Back in stock", body, imageUrl, linkUrl },
    });
    await tx.restockSubscription.update({
      where: { id: sub.id },
      data: { status: "FULFILLED", notifiedAt: new Date() },
    });
  }
}
