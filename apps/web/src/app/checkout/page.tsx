import { redirect } from "next/navigation";
import { prisma, getFullName } from "@kisan4u/db";
import {
  getCartForUser,
  listAddresses,
  buildCheckoutDrafts,
  computeAdvanceAmount,
  getActivePartialPaymentRule,
  validatePaymentMethodRules,
  getWalletSummary,
  getBaProfileForUser,
  round2,
} from "@kisan4u/orders";
import {
  AlertBox,
  Card,
  OrderItemSummary,
  PageContainer,
  PageHeader,
  SectionHeader,
} from "@kisan4u/ui";
import { requireBuyerContext, resolveDefaultCustomerStateId } from "@/lib/buyer-context";
import { MetaInitiateCheckout } from "@/components/meta/meta-checkout-events";
import type { MetaCartSummary } from "@/lib/meta/shared";
import { CheckoutForm } from "./checkout-form";

// WALLET is not in this list — it's an additive amount applied on top of
// whichever of these is chosen, never a selectable payment method (see
// packages/orders/src/wallet.ts).
const ALL_PAYMENT_METHODS = [
  "COD",
  "ONLINE_FULL",
  "ONLINE_PARTIAL",
  "TRANSPORT_FULL_ONLINE",
] as const;

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ delivery?: string }>;
}) {
  const ctx = await requireBuyerContext({ allowGuest: true });
  const cart = await getCartForUser(ctx.userId, {
    role: ctx.role,
    dealerStateId: ctx.dealerState?.id ?? null,
  });
  const isEmpty = cart.sellerGroups.every((group) => group.items.length === 0);
  if (isEmpty || cart.hasValidationErrors) redirect("/cart");

  const { delivery } = await searchParams;
  // Customers always ship via Kisan4U Courier — the `delivery` query param is
  // deliberately ignored unless the session is a DEALER, so a customer can
  // never reach TRANSPORT even via a forged/hand-typed URL (server-side
  // enforcement, not just "the UI never shows the toggle").
  const deliveryMethod: "KISAN4U_COURIER" | "TRANSPORT" =
    ctx.role === "DEALER" && delivery === "TRANSPORT" ? "TRANSPORT" : "KISAN4U_COURIER";

  const allowedPaymentMethods = ALL_PAYMENT_METHODS.filter(
    (method) => validatePaymentMethodRules(ctx.role, deliveryMethod, method).ok,
  );
  const initialPaymentMethod = allowedPaymentMethods[0] ?? "COD";

  const draftResult = await buildCheckoutDrafts(ctx.userId, {
    role: ctx.role,
    dealerStateId: ctx.dealerState?.id ?? null,
    customerStateId:
      ctx.role === "CUSTOMER" ? await resolveDefaultCustomerStateId(ctx.userId) : null,
    deliveryMethod,
    paymentMethod: initialPaymentMethod,
  });

  const [addresses, states, partialPaymentRule, wallet] = await Promise.all([
    ctx.isGuest ? Promise.resolve([]) : listAddresses(ctx.userId),
    ctx.role === "CUSTOMER"
      ? prisma.indianState.findMany({ where: { isActive: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    getActivePartialPaymentRule(ctx.role),
    // Never provision a Wallet row for a throwaway guest placeholder — a
    // guest has no balance to spend anyway.
    ctx.isGuest
      ? Promise.resolve({ balance: 0, loyaltyPoints: 0, recent: [] })
      : getWalletSummary(ctx.userId, ctx.role),
  ]);

  let advancePreview: { advanceAmount: number; remainingAmount: number; ruleLabel: string } | null =
    null;
  if (draftResult.ok) {
    const advanceResult = await computeAdvanceAmount(draftResult.grandTotal, ctx.role);
    if (advanceResult.ok) advancePreview = advanceResult.plan;
  }

  // BA "order on behalf of a referee" — only offered to a signed-in,
  // approved-or-bank-pending Business Associate (never a guest). When
  // present, CheckoutForm shows an "Order for" picker above the address
  // section; picking a referee swaps the address book, forces COD, and
  // routes submission through createProposedOrder() instead of checkout().
  let referredCustomers: {
    id: string;
    name: string;
    addresses: {
      id: string;
      fullName: string;
      line1: string;
      line2: string | null;
      landmark: string | null;
      cityTown: string;
      district: string | null;
      state: string;
      stateId: string | null;
      pincode: string;
    }[];
  }[] | null = null;
  if (!ctx.isGuest) {
    const baProfile = await getBaProfileForUser(ctx.userId);
    if (baProfile && (baProfile.status === "APPROVED" || baProfile.status === "BANK_SUBMITTED")) {
      const referred = await prisma.user.findMany({
        where: { referredByBaId: baProfile.id, role: "CUSTOMER", isActive: true },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          addresses: {
            select: {
              id: true,
              fullName: true,
              line1: true,
              line2: true,
              landmark: true,
              cityTown: true,
              district: true,
              state: true,
              stateId: true,
              pincode: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      referredCustomers = referred.map((r) => ({
        id: r.id,
        name: getFullName(r) ?? r.phone ?? "Customer",
        addresses: r.addresses,
      }));
    }
  }

  // The checkout-wide price summary's itemized rows — selling price (post
  // product-discount, pre-tax), tax, and delivery-charge-to-customer.
  // Collection charge is deliberately excluded from every customer-facing
  // total: it's always seller-borne (see packages/orders/src/charges.ts),
  // an internal Kisan4u/seller settlement figure the customer never pays
  // and must never see quoted as if it were part of their bill.
  const sellingPriceTotal = draftResult.ok
    ? round2(draftResult.drafts.reduce((sum, d) => sum + d.subtotal, 0))
    : 0;
  const deliveryChargeTotal = draftResult.ok
    ? round2(draftResult.drafts.reduce((sum, d) => sum + d.charges.customerPayableDelivery, 0))
    : 0;
  // Meta InitiateCheckout / AddPaymentInfo — SKUs from the cart, value = the
  // total the buyer is shown (incl. tax and delivery).
  const metaCart: MetaCartSummary = {
    contents: cart.sellerGroups.flatMap((g) =>
      g.items.map((i) => ({ id: i.sku, quantity: i.quantity, item_price: i.currentPrice ?? i.priceAtAdd })),
    ),
    value: draftResult.ok ? round2(draftResult.grossTotal) : round2(cart.overallTotal),
  };

  return (
    <PageContainer maxWidth="1100px" className="py-8">
      <PageHeader title="Checkout" />

      {!draftResult.ok && <AlertBox tone="danger">{draftResult.error}</AlertBox>}

      {draftResult.ok && (
        <div className="flex flex-col gap-6">
          <Card className="p-5 sm:p-6">
            <SectionHeader title="Order Summary" />
            <div className="flex flex-col divide-y divide-border">
              {draftResult.drafts.map((draft) => (
                <div key={draft.sellerId} className="flex flex-col gap-1.5 py-3 text-sm">
                  <div className="font-semibold text-ink">
                    {draft.lines.length} item(s) · {draft.totalWeightGrams} g
                  </div>
                  <div className="flex flex-col gap-1.5 py-1">
                    {draft.lines.map((l) => (
                      <OrderItemSummary
                        key={`${l.line.productId}-${l.line.variantId ?? "base"}`}
                        size="sm"
                        imageUrl={l.line.productImageUrl}
                        name={l.line.productName}
                        variantLabel={l.line.variantLabel}
                        quantity={l.quantity}
                        trailing={
                          <span className="text-ink">
                            ₹{(l.line.sellingPrice * l.quantity).toFixed(2)}
                          </span>
                        }
                      />
                    ))}
                  </div>
                  {ctx.role === "DEALER" && (
                    <div className="flex justify-between text-gray-600">
                      <span>
                        Transportation (
                        {draft.charges.transportationPayer === "SELLER" ? "seller-borne" : "you pay"})
                      </span>
                      <span>₹{draft.charges.customerPayableDelivery.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <MetaInitiateCheckout cart={metaCart} />
          <CheckoutForm
            metaCart={metaCart}
            role={ctx.role}
            isGuest={ctx.isGuest}
            deliveryMethod={deliveryMethod}
            addresses={addresses}
            states={states}
            dealerLockedState={ctx.dealerState}
            allowedPaymentMethods={allowedPaymentMethods}
            sellerSubtotals={draftResult.drafts.map((d) => d.subtotal)}
            sellingPriceTotal={sellingPriceTotal}
            taxTotal={draftResult.customerTaxTotal}
            deliveryChargeTotal={deliveryChargeTotal}
            grossTotal={draftResult.grossTotal}
            advancePreview={advancePreview}
            partialPaymentRule={partialPaymentRule}
            walletBalance={wallet.balance}
            referredCustomers={referredCustomers}
            cartLines={draftResult.drafts.flatMap((d) =>
              d.lines.map((l) => ({
                productId: l.line.productId,
                variantId: l.line.variantId,
                quantity: l.quantity,
              })),
            )}
          />
        </div>
      )}
    </PageContainer>
  );
}
