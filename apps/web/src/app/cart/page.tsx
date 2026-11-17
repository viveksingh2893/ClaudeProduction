import Link from "next/link";
import { getCartForUser } from "@kisan4u/orders";
import { AlertBox, Card, EmptyState, LinkButton, PageContainer, PageHeader } from "@kisan4u/ui";
import { requireBuyerContext } from "@/lib/buyer-context";
import { CartItemRow } from "./cart-item-row";
import { ClearCartButton } from "./clear-cart-button";

export default async function CartPage() {
  const ctx = await requireBuyerContext({ allowGuest: true });
  const cart = await getCartForUser(ctx.userId, {
    role: ctx.role,
    dealerStateId: ctx.dealerState?.id ?? null,
  });
  const isEmpty = cart.sellerGroups.every((group) => group.items.length === 0);

  if (isEmpty) {
    return (
      <PageContainer maxWidth="900px" className="py-10">
        <EmptyState
          icon="🛒"
          title="Your cart is empty"
          description="Looks like you haven't added anything yet. Explore the catalogue to find seeds, fertilizers, equipment and more."
          action={
            <LinkButton href="/products" variant="primary">
              Continue Shopping
            </LinkButton>
          }
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="1200px" className="py-8">
      <PageHeader title="Your Cart" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          {cart.sellerGroups.map((group) => (
            <Card key={group.sellerId} className="p-5">
              <div className="mb-1 text-base font-extrabold text-green-800">
                Sold by {group.sellerName}
              </div>
              <div className="divide-y divide-border">
                {group.items.map((item) => (
                  <CartItemRow key={item.cartItemId} item={item} />
                ))}
              </div>
              <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-sm text-gray-600">
                <div className="flex justify-between">
                  <span>Seller subtotal</span>
                  <span className="font-semibold text-ink">₹{group.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Shipment weight</span>
                  <span>{group.totalWeightGrams} g</span>
                </div>
                <div className="flex justify-between">
                  <span>Estimated logistics</span>
                  <span className="font-semibold text-ink">
                    {group.logisticsEstimate.ok
                      ? `₹${group.logisticsEstimate.price.toFixed(2)}`
                      : group.logisticsEstimate.error}
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card className="p-5">
            <div className="mb-4 text-base font-extrabold text-green-800">Order Summary</div>
            <div className="flex justify-between border-b border-border pb-4 text-lg font-extrabold text-ink">
              <span>Cart Total</span>
              <span>₹{cart.overallTotal.toFixed(2)}</span>
            </div>

            {cart.hasValidationErrors && (
              <div className="mt-4">
                <AlertBox tone="danger">
                  Some items in your cart need attention before you can check out — remove or fix
                  them above.
                </AlertBox>
              </div>
            )}

            <div className="mt-4">
              {cart.hasValidationErrors ? (
                <span className="block cursor-not-allowed rounded-md bg-border py-3 text-center text-sm font-bold text-gray-600">
                  Proceed to Checkout
                </span>
              ) : (
                <LinkButton href="/checkout" variant="primary" fullWidth>
                  Proceed to Checkout →
                </LinkButton>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between">
              <Link
                href="/products"
                className="text-xs font-semibold text-green-700 hover:underline"
              >
                ← Continue shopping
              </Link>
              <ClearCartButton />
            </div>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}
