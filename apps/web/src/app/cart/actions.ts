"use server";

import { revalidatePath } from "next/cache";
import { addToCart, updateCartItemQuantity, removeCartItem, clearCart } from "@kisan4u/orders";
import { addToCartInputSchema, updateCartItemQuantityInputSchema } from "@kisan4u/validators";
import { auth } from "@/auth";
import { requireBuyerContext, resolveDefaultCustomerStateId } from "@/lib/buyer-context";
import { getOrCreateGuestBuyerId } from "@/lib/guest-cart";
import { metaTrackingAllowed } from "@/lib/meta/consent";
import { metaProductInfo, type MetaProductInfo } from "@/lib/meta/product-data";

type Result = { ok: true } | { ok: false; error: string };

type LineCtx = Awaited<ReturnType<typeof requireBuyerContext>>;

async function toLineCtx(ctx: LineCtx) {
  return {
    role: ctx.role,
    dealerStateId: ctx.dealerState?.id ?? null,
    customerStateId:
      ctx.role === "CUSTOMER" ? await resolveDefaultCustomerStateId(ctx.userId) : null,
  };
}

/**
 * A signed-in CUSTOMER/DEALER goes through the normal buyer context. A
 * not-signed-in visitor gets (and, on this first add, creates) a guest
 * placeholder account + cookie so the line has an owner — see
 * apps/web/src/lib/guest-cart.ts. Guests are always CUSTOMER-priced.
 */
async function resolveCartActor(): Promise<LineCtx> {
  const session = await auth();
  if (session?.user) return requireBuyerContext();
  const guestId = await getOrCreateGuestBuyerId();
  return { userId: guestId, role: "CUSTOMER", dealerState: null, isGuest: true };
}

/** Quantity and product/variant identity are the only client input trusted here — price, seller id, and stock are always re-derived server-side (see @kisan4u/orders' validateCartLine). */
export async function addToCartAction(
  rawInput: unknown,
): Promise<{ ok: true; meta: MetaProductInfo | null } | { ok: false; error: string }> {
  const parsed = addToCartInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await resolveCartActor();
  const result = await addToCart(ctx.userId, await toLineCtx(ctx), parsed.data);
  if (!result.ok) return result;
  revalidatePath("/cart");
  // SKU / price for the caller's Meta "AddToCart" event (lib/meta/track.ts).
  const meta = (await metaTrackingAllowed())
    ? await metaProductInfo(parsed.data.productId, parsed.data.variantId, ctx.role)
    : null;
  return { ok: true, meta };
}

export async function updateCartItemQuantityAction(rawInput: unknown): Promise<Result> {
  const ctx = await requireBuyerContext({ allowGuest: true });
  const parsed = updateCartItemQuantityInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = await updateCartItemQuantity(ctx.userId, await toLineCtx(ctx), parsed.data);
  if (result.ok) revalidatePath("/cart");
  return result.ok ? { ok: true } : result;
}

/** Ownership is enforced inside removeCartItem itself (scoped by userId) — a cartItemId belonging to another user simply resolves to "not found." */
export async function removeCartItemAction(cartItemId: string): Promise<Result> {
  const ctx = await requireBuyerContext({ allowGuest: true });
  const result = await removeCartItem(ctx.userId, cartItemId);
  if (result.ok) revalidatePath("/cart");
  return result.ok ? { ok: true } : result;
}

export async function clearCartAction(): Promise<Result> {
  const ctx = await requireBuyerContext({ allowGuest: true });
  await clearCart(ctx.userId);
  revalidatePath("/cart");
  return { ok: true };
}
