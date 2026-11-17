import { prisma, type PaymentMethod } from "@kisan4u/db";
import { validateCartLine, type ValidatedLine } from "./line-validation";
import { calculateSellerOrderCharges, type ChargeCalcSuccess } from "./charges";
import { calculateCustomerPromoDiscount } from "./promotional-discount";
import { resolvePosPricing, type PosPricingResolved } from "./pos-pricing";
import { validateAndPriceCoupon } from "./coupons";
import { round2, sum, resolveTaxBreakdown, roundUpToRupee } from "./money";

export type SellerDraft = {
  sellerId: string;
  lines: { cartItemId: string; quantity: number; line: ValidatedLine }[];
  subtotal: number;
  taxAmount: number;
  totalWeightGrams: number;
  charges: ChargeCalcSuccess;
  /** Gross seller-order total (subtotal + tax + customerPayableDelivery) — unaffected by the Kisan4u-borne promo discount; this is the seller's own settlement basis. */
  grossTotal: number;
  /** This seller order's allocated share of the checkout-level promo discount (web/dealer) or the POS payment-mode discount — always 0 for a dealer order. */
  promoDiscountAmount: number;
  /**
   * Tax actually billed to the customer. Equals `taxAmount` (gross) for
   * every non-POS-customer order, since the existing promo discount is
   * netted out of the total without recomputing tax. For a POS customer
   * order, this is tax computed on the DISCOUNTED subtotal per the
   * requested calc order (discount before tax) — see isPosCustomerOrder
   * below — so it differs from `taxAmount`, which stays gross because
   * SellerOrder/OrderItem's own tax fields remain the seller's gross
   * settlement basis (settlement.ts reads OrderItem.subtotal/taxAmount
   * directly; discounting them would silently cut seller payouts, which
   * isn't what this discount is — see promotionalDiscountPayer:"KISAN4U").
   */
  customerTaxAmount: number;
  /** Net of the discount (and, for POS, computed on the discounted-tax basis) — what the customer is actually billed for this seller order. */
  customerPayableTotal: number;
  /** This seller order's allocated share of an applied coupon's discount (see coupons.ts) — 0 when no coupon was applied. Already subtracted out of customerPayableTotal; kept separate here so checkout.ts can persist a CouponRedemption row with the right per-seller amount. */
  couponDiscountAmount: number;
};

export type BuildDraftsContext = {
  role: "CUSTOMER" | "DEALER";
  dealerStateId: string | null;
  /** The customer's resolved delivery-address state — null when not yet known (e.g. a read-only preview rendered before an address is selected). Selling-licence/state eligibility for a CUSTOMER line is only enforced once this is non-null; see line-validation.ts. */
  customerStateId?: string | null;
  deliveryMethod: "KISAN4U_COURIER" | "TRANSPORT";
  /**
   * Known and authoritative during the real checkout transaction. The
   * read-only checkout-page preview passes its currently-selected (or
   * first-allowed) payment method too, so the initial server-rendered
   * preview already reflects the right discount — the client then
   * recalculates instantly on toggle using the same rate table (see
   * packages/validators/src/customer-discount.ts), and the server always
   * recomputes authoritatively from the real submitted value at checkout
   * time. Never trusts a client-submitted discount figure — there isn't
   * one; only this enum value ever crosses the client/server boundary.
   */
  paymentMethod: PaymentMethod;
  /**
   * True only for a CUSTOMER (never DEALER) order placed via POS
   * (checkout.ts's CheckoutContext.placedBy set) — gates the
   * admin-configurable PosPricingConfig discount/prepaid-split in place
   * of the hardcoded getCustomerPromoDiscountPercent table. Scoped this
   * narrowly on purpose: web/dealer checkout and POS-dealer orders keep
   * today's exact behavior unchanged.
   */
  isPosCustomerOrder?: boolean;
  /** Optional shopper-entered coupon code — re-validated and priced from scratch here (see coupons.ts), never trusted as a pre-computed discount figure. An invalid/ineligible code fails the whole checkout with a clear error rather than silently proceeding at full price. */
  couponCode?: string;
};

export type BuildDraftsResult =
  | {
      ok: true;
      drafts: SellerDraft[];
      /** Net of the Kisan4u-borne promo discount — the actual amount charged. */
      grandTotal: number;
      /** Pre-discount total — shown alongside grandTotal so the discount line is visible, never hidden inside a single merged number. */
      grossTotal: number;
      promoDiscountPercent: number;
      promoDiscountTotal: number;
      /** Net tax actually billed — sum of every draft's customerTaxAmount. Equals the gross tax total for every non-POS-customer order. */
      customerTaxTotal: number;
      /** The resolved POS discount rate, or null when isPosCustomerOrder wasn't set. */
      posPricing: PosPricingResolved | null;
      /** Set only when ctx.couponCode was present and validated successfully — checkout.ts uses couponId to create CouponRedemption rows and increment Coupon.usageCount once per checkout. */
      appliedCoupon: { couponId: string; code: string; totalDiscount: number } | null;
    }
  | { ok: false; error: string };

/**
 * Re-validates the cart and computes the seller-wise split + charges —
 * shared by both the real checkout transaction (checkout.ts) and the
 * read-only checkout-page preview (apps/web's /checkout page), so the
 * totals a customer sees before clicking "Place Order" are computed by
 * the exact same code that will actually charge them, never a second,
 * potentially-drifting calculation.
 */
export async function buildCheckoutDrafts(
  userId: string,
  ctx: BuildDraftsContext,
): Promise<BuildDraftsResult> {
  const cartItems = await prisma.cartItem.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  if (cartItems.length === 0) return { ok: false, error: "Your cart is empty." };

  const validatedLines: { cartItemId: string; quantity: number; line: ValidatedLine }[] = [];
  for (const item of cartItems) {
    const result = await validateCartLine(item.productId, item.variantId, item.quantity, {
      role: ctx.role,
      dealerStateId: ctx.dealerStateId,
      customerStateId: ctx.customerStateId ?? null,
    });
    if (!result.ok)
      return {
        ok: false,
        error: `${result.error} Please review your cart before placing the order.`,
      };
    validatedLines.push({ cartItemId: item.id, quantity: item.quantity, line: result.line });
  }

  const bySeller = new Map<
    string,
    { cartItemId: string; quantity: number; line: ValidatedLine }[]
  >();
  for (const vl of validatedLines) {
    const group = bySeller.get(vl.line.sellerId) ?? [];
    group.push(vl);
    bySeller.set(vl.line.sellerId, group);
  }

  type PartialDraft = Omit<
    SellerDraft,
    "promoDiscountAmount" | "customerTaxAmount" | "customerPayableTotal" | "couponDiscountAmount"
  >;
  const partialDrafts: PartialDraft[] = [];
  for (const [sellerId, lines] of bySeller) {
    // Split each line's full price into its taxable value and tax amount
    // (see resolveTaxBreakdown's doc comment) rather than treating
    // sellingPrice as pre-tax and adding tax on top — that used to
    // overcharge every "tax included in selling price" product by its
    // own tax amount a second time. `subtotal` below is genuinely the
    // TAXABLE value now, not sellingPrice*quantity verbatim — `subtotal +
    // taxAmount` still reconstructs the full sellingPrice*quantity sum
    // exactly, which is what every downstream consumer (delivery-charge
    // calc, promo discount, settlement, RapidShyp) already expected of
    // "subtotal" being pre-tax and "subtotal + taxAmount" being gross.
    const lineBreakdowns = lines.map((l) =>
      resolveTaxBreakdown(
        round2(l.line.sellingPrice * l.quantity),
        l.line.taxPercent,
        l.line.taxCalcMode,
      ),
    );
    const subtotal = sum(lineBreakdowns.map((b) => b.taxableValue));
    const taxAmount = sum(lineBreakdowns.map((b) => b.taxAmount));
    const totalWeightGrams = lines.reduce((total, l) => total + l.line.weightGrams * l.quantity, 0);
    const charges = await calculateSellerOrderCharges(totalWeightGrams, subtotal, {
      customerType: ctx.role,
      deliveryMethod: ctx.deliveryMethod,
      sellerId,
    });
    if (!charges.ok) {
      return {
        ok: false,
        error: `Delivery isn't available right now for one of the sellers in your cart (${charges.error}). Please try again later.`,
      };
    }
    const grossTotal = round2(subtotal + taxAmount + charges.customerPayableDelivery);
    partialDrafts.push({
      sellerId,
      lines,
      subtotal,
      taxAmount,
      totalWeightGrams,
      charges,
      grossTotal,
    });
  }

  let drafts: SellerDraft[];
  let promoDiscountPercent: number;
  let promoDiscountTotal: number;
  let posPricing: PosPricingResolved | null = null;

  if (ctx.isPosCustomerOrder) {
    // POS customer discount — admin-configured rate per payment mode,
    // applied to each LINE's own TAXABLE value BEFORE tax (discount, then
    // tax on the discounted taxable base, per line so a mixed-tax-rate
    // cart stays exact) rather than netted off an already-gross total the
    // way the web/dealer promo discount below is. This is what makes
    // customerTaxAmount differ from the gross `taxAmount` stored on
    // SellerOrder/OrderItem — see SellerDraft.customerTaxAmount's doc.
    posPricing = await resolvePosPricing(ctx.paymentMethod);
    const discountPercent = posPricing.discountPercent;
    drafts = partialDrafts.map((d) => {
      // The discount percent applies to each line's TAXABLE value, never
      // its tax-inclusive sticker price: for a product whose selling
      // price already has GST baked in (taxCalcMode INCLUDE_WITH_PRICE), a
      // ₹595 line at 5% tax discounts 2%/5% of ₹566.67, not of ₹595. So
      // split the full price into taxable + tax first (resolveTaxBreakdown,
      // tax-mode-aware), take the discount off the taxable half, then
      // re-charge tax on the reduced taxable base — tax is always
      // taxableValue * rate regardless of the product's inclusive/
      // exclusive mode, hence EXCLUDE-style math on the already-net base.
      // For a tax-exclusive product taxableValue === lineGross, so this is
      // unchanged for those (and for any 0%-tax line).
      const lineResults = d.lines.map((l) => {
        const lineGross = round2(l.line.sellingPrice * l.quantity);
        const full = resolveTaxBreakdown(lineGross, l.line.taxPercent, l.line.taxCalcMode);
        const lineDiscount = round2(full.taxableValue * (discountPercent / 100));
        const discountedTaxable = round2(full.taxableValue - lineDiscount);
        const breakdown = resolveTaxBreakdown(
          discountedTaxable,
          l.line.taxPercent,
          "EXCLUDE_WITH_PRICE",
        );
        return { lineDiscount, ...breakdown };
      });
      const discountAmount = sum(lineResults.map((r) => r.lineDiscount));
      const discountedSubtotal = sum(lineResults.map((r) => r.taxableValue));
      const customerTaxAmount = sum(lineResults.map((r) => r.taxAmount));
      return {
        ...d,
        promoDiscountAmount: discountAmount,
        customerTaxAmount,
        customerPayableTotal: round2(
          discountedSubtotal + customerTaxAmount + d.charges.customerPayableDelivery,
        ),
        couponDiscountAmount: 0,
      };
    });
    promoDiscountPercent = discountPercent;
    promoDiscountTotal = sum(drafts.map((d) => d.promoDiscountAmount));
  } else {
    // Customer online-payment promotional discount — per calc-order step 6,
    // computed off each seller order's own merchandise subtotal (post
    // product-discount, pre-tax, pre-delivery-charge), never off grossTotal.
    const promo = calculateCustomerPromoDiscount(
      ctx.role,
      ctx.paymentMethod,
      partialDrafts.map((d) => d.subtotal),
    );
    drafts = partialDrafts.map((d, i) => {
      const promoDiscountAmount = promo.perSeller[i]!.discountAmount;
      return {
        ...d,
        promoDiscountAmount,
        customerTaxAmount: d.taxAmount,
        customerPayableTotal: round2(d.grossTotal - promoDiscountAmount),
        couponDiscountAmount: 0,
      };
    });
    promoDiscountPercent = promo.percent;
    promoDiscountTotal = promo.checkoutLevelDiscountAmount;
  }

  let appliedCoupon: { couponId: string; code: string; totalDiscount: number } | null = null;
  if (ctx.couponCode) {
    const priced = await validateAndPriceCoupon({
      code: ctx.couponCode,
      userId,
      audience: ctx.role,
      sellerSubtotals: drafts.map((d) => ({ sellerId: d.sellerId, subtotal: d.subtotal })),
    });
    if (!priced.ok) return { ok: false, error: priced.error };
    drafts = drafts.map((d) => {
      const couponDiscountAmount =
        priced.perSeller.find((p) => p.sellerId === d.sellerId)?.discountAmount ?? 0;
      return {
        ...d,
        couponDiscountAmount,
        customerPayableTotal: round2(d.customerPayableTotal - couponDiscountAmount),
      };
    });
    appliedCoupon = {
      couponId: priced.coupon.id,
      code: priced.coupon.code,
      totalDiscount: priced.totalDiscount,
    };
  }

  const grossTotal = sum(drafts.map((d) => d.grossTotal));
  // Customer-facing total is rounded UP to the next whole rupee (Product
  // spec: "round off the checkout amount to upper limit") — every other
  // total here (grossTotal, each SellerDraft's own customerPayableTotal,
  // seller settlement basis) is left at exact paisa precision; only this
  // aggregate figure — what a customer actually sees and pays — is
  // rounded. Partial-payment advances and PaymentAllocation splits (see
  // packages/orders/src/checkout.ts) are computed FROM this already-
  // rounded grandTotal, so they stay consistent with what's charged.
  const grandTotal = roundUpToRupee(sum(drafts.map((d) => d.customerPayableTotal)));
  return {
    ok: true,
    drafts,
    grandTotal,
    grossTotal,
    promoDiscountPercent,
    promoDiscountTotal,
    customerTaxTotal: sum(drafts.map((d) => d.customerTaxAmount)),
    posPricing,
    appliedCoupon,
  };
}
