import { prisma, getFullName, type UserRole } from "@kisan4u/db";
import { round2, sum } from "./money";
import { paidSoFarFor, netPayableForOrder } from "./payment-collection";
import { REDACTED_CONTACT } from "./contact-redaction";

/** Same labels shown elsewhere (apps/dashboard's order-status-labels.ts) — duplicated here rather than imported since this package must stay app-independent. Keep in sync if a payment method is ever added. */
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  COD: "Cash On Delivery",
  ONLINE_FULL: "Paid in full online",
  ONLINE_PARTIAL: "Partial online payment",
  WALLET: "Kisan4U Wallet",
  TRANSPORT_FULL_ONLINE: "Paid in full online (Transport)",
};

export type InvoiceAddress = {
  fullName: string;
  mobile: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  cityTown: string;
  district: string;
  state: string;
  pincode: string;
};

export type InvoiceLineItem = {
  srNo: number;
  productName: string;
  variantLabel: string | null;
  hsnCode: string;
  quantity: number;
  rate: number;
  taxableValue: number;
  taxRatePercent: number;
  taxAmount: number;
  lineTotal: number;
};

export type InvoiceData = {
  orderNumber: string;
  /** Deliberately the same string as orderNumber — see order-numbering.ts's generateInvoiceNumber doc comment. Kept as its own field so a template never has to know that decision. */
  invoiceNumber: string;
  orderDate: Date;
  invoiceDate: Date;

  placeOfSupply: string;
  natureOfSupply: "Goods";

  seller: {
    shopName: string;
    gstNumber: string | null;
    addressLines: string[];
  };

  shippingAddress: InvoiceAddress;
  billingAddress: InvoiceAddress;
  buyerGstNumber: string | null;

  lineItems: InvoiceLineItem[];

  totals: {
    beforeTax: number;
    /** The applied coupon's discount for this seller order (0 when none was applied) — previously always hardcoded 0; now the one real, labeled source of this line (see couponCode). */
    discounts: number;
    extraDiscounts: number;
    /** Kisan4U Wallet money this seller order used (0 when none). Printed on the same "Extra Discount / Wallet" line as extraDiscounts, and already taken off afterTax / paidAmount below so the printed arithmetic ties out. */
    walletApplied: number;
    taxTotal: number;
    shippingCharges: number;
    /** What the buyer owes AFTER the wallet — i.e. the net payable minus walletApplied. */
    afterTax: number;
    afterTaxInWords: string;
    /** Live — computed fresh from PaymentAllocation/Payment at read time, never a stored/cached figure. Excludes the wallet share (that is on the "Extra Discount / Wallet" line instead). */
    paidAmount: number;
    /** Live, same basis as paidAmount. */
    balanceAmount: number;
  };
  /** Set only when a coupon was redeemed against this seller order — see CouponRedemption. Labels the `discounts` total above instead of leaving it as an anonymous figure. */
  couponCode?: string;

  paymentMethod: string;
};

export type InvoiceResult = { ok: true; invoice: InvoiceData } | { ok: false; error: string };

const invoiceOrderInclude = {
  items: true,
  charge: true,
  paymentAllocations: { include: { payment: true } },
  seller: { select: { shopName: true, gstNumber: true, registeredAddress: true } },
  pickupPoint: true,
  customer: {
    select: {
      firstName: true,
      lastName: true,
      deletedAt: true,
      dealerProfile: { select: { gstNumber: true } },
    },
  },
  checkoutGroup: { include: { addressSnapshot: true } },
  couponRedemptions: { include: { coupon: { select: { code: true } } } },
} as const;

type InvoiceOrder = NonNullable<
  Awaited<ReturnType<typeof fetchInvoiceOrderById>>
>;

async function fetchInvoiceOrderById(sellerOrderId: string) {
  return prisma.sellerOrder.findUnique({
    where: { id: sellerOrderId },
    include: invoiceOrderInclude,
  });
}

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function twoDigitsToWords(n: number): string {
  if (n < 20) return ONES[n]!;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones ? `${TENS[tens]} ${ONES[ones]}` : TENS[tens]!;
}

function threeDigitsToWords(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(twoDigitsToWords(rest));
  return parts.join(" ");
}

/** Indian-style grouping (crore/lakh/thousand) — every displayed amount here is INR. Words are of the whole-rupee amount only, matching the reference invoice ("₹1,420" → "one thousand four hundred twenty", paise dropped). */
export function amountToWords(amount: number): string {
  const whole = Math.round(Math.abs(amount));
  if (whole === 0) return "Zero";

  const crore = Math.floor(whole / 10000000);
  const lakh = Math.floor((whole % 10000000) / 100000);
  const thousand = Math.floor((whole % 100000) / 1000);
  const hundred = whole % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigitsToWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigitsToWords(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigitsToWords(thousand)} Thousand`);
  if (hundred) parts.push(threeDigitsToWords(hundred));

  return parts.join(" ");
}

function addressLinesFromPickupPoint(
  pickupPoint: { line1: string; city: string; district: string; state: string; pincode: string } | null,
): string[] {
  if (!pickupPoint) return [];
  return [
    pickupPoint.line1,
    `${pickupPoint.city}, ${pickupPoint.district}`,
    `${pickupPoint.state} - ${pickupPoint.pincode}`,
  ].filter((v) => v.trim().length > 0);
}

/**
 * The "Sold By" address on the invoice — sits between the shop name and
 * the GSTIN line. Uses the seller's registered place of business
 * (SellerProfile.registeredAddress — what a GSTIN is registered under, and
 * what a tax invoice should show) when it's on file, falling back to the
 * order's pickup-point address for sellers whose registered address hasn't
 * been captured yet.
 */
function sellerAddressLines(
  registeredAddress: string | null,
  pickupPoint: Parameters<typeof addressLinesFromPickupPoint>[0],
): string[] {
  const trimmed = registeredAddress?.trim();
  if (trimmed) return [trimmed];
  return addressLinesFromPickupPoint(pickupPoint);
}

function toInvoiceAddress(snapshot: {
  fullName: string;
  mobile: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  cityTown: string;
  district: string;
  state: string;
  pincode: string;
}): InvoiceAddress {
  return {
    fullName: snapshot.fullName,
    mobile: snapshot.mobile,
    line1: snapshot.line1,
    line2: snapshot.line2,
    landmark: snapshot.landmark,
    cityTown: snapshot.cityTown,
    district: snapshot.district,
    state: snapshot.state,
    pincode: snapshot.pincode,
  };
}

async function resolveHsnCodes(
  items: { productId: string }[],
  // SellerOrder.customerType is a UserRole snapshot but only ever holds
  // CUSTOMER or DEALER in practice (see CheckoutGroup.customerType's doc
  // comment) — any other value falls back to the CUSTOMER-side config.
  customerType: UserRole,
): Promise<Map<string, string>> {
  const productIds = [...new Set(items.map((i) => i.productId))];
  if (productIds.length === 0) return new Map();
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      hsnCode: true,
      customerConfig: { select: { hsnCode: true } },
      dealerConfig: { select: { hsnCode: true } },
    },
  });
  const map = new Map<string, string>();
  for (const p of products) {
    const audienceHsn =
      customerType === "DEALER" ? p.dealerConfig?.hsnCode : p.customerConfig?.hsnCode;
    map.set(p.id, audienceHsn ?? p.hsnCode);
  }
  return map;
}

/** Pure transform — no DB access, no ownership check. Every caller below fetches with its own scope, then hands the row here. */
async function buildInvoiceData(order: InvoiceOrder): Promise<InvoiceResult> {
  const address = order.checkoutGroup.addressSnapshot;
  if (!address) return { ok: false, error: "Delivery address is missing for this order." };

  const hsnByProduct = await resolveHsnCodes(order.items, order.customerType);

  const lineItems: InvoiceLineItem[] = order.items.map((item, index) => {
    const taxableValue = Number(item.subtotal);
    const taxAmount = Number(item.taxAmount);
    return {
      srNo: index + 1,
      productName: item.productName,
      variantLabel: item.variantLabel,
      hsnCode: hsnByProduct.get(item.productId) ?? "",
      quantity: item.quantity,
      rate: Number(item.unitPrice),
      taxableValue,
      taxRatePercent: Number(item.taxRatePercent),
      taxAmount,
      lineTotal: round2(taxableValue + taxAmount),
    };
  });

  const beforeTax = round2(sum(lineItems.map((l) => l.taxableValue)));
  const taxTotal = round2(sum(lineItems.map((l) => l.taxAmount)));
  const shippingCharges = order.charge ? Number(order.charge.customerPayableDelivery) : 0;

  // Live — the authoritative "what the customer actually owes" figure,
  // same helper the admin/seller order pages and payment-collection use.
  // Never re-derived from beforeTax/taxTotal directly: a POS order can
  // compute customer-facing tax on an already-discounted base (see
  // checkout-draft.ts's SellerDraft.customerTaxAmount doc comment), so
  // beforeTax/taxTotal here (always the GROSS, pre-discount figures
  // stored on OrderItem) would silently drift from the real total in that
  // case. "Extra Discounts" below is instead solved for as the balancing
  // figure, guaranteeing the printed arithmetic always ties out to this
  // authoritative number exactly, regardless of which checkout path
  // produced the order.
  const netPayable = round2(
    netPayableForOrder({
      totalAmount: order.totalAmount,
      charge: order.charge ? { customerPayableTotal: order.charge.customerPayableTotal } : null,
    }),
  );
  // Real, labeled discount source (was hardcoded 0 before coupons existed).
  // "Extra Discounts" below still absorbs whatever's left of the
  // arithmetic gap (currently just the existing promo discount) as a
  // balancing figure, same as before — it just no longer has to also
  // silently carry the coupon amount now that this has its own line.
  const couponDiscount = round2(
    sum(order.couponRedemptions.map((r) => Number(r.discountAmount))),
  );
  const couponCode = order.couponRedemptions[0]?.coupon.code;
  const discounts = couponDiscount;
  const extraDiscounts = round2(
    Math.max(0, beforeTax + taxTotal + shippingCharges - discounts - netPayable),
  );

  // Wallet money is shown on the "Extra Discount / Wallet" line rather than
  // as a payment: it comes off the total and off the paid amount alike
  // (paidSoFarFor counts the wallet share as paid), so the balance is exactly
  // what it was and nothing is counted twice.
  const walletApplied = round2(
    sum(order.paymentAllocations.map((a) => Number(a.walletAmountApplied))),
  );
  const afterTax = round2(Math.max(0, netPayable - walletApplied));
  const paidAmount = round2(Math.max(0, paidSoFarFor(order.paymentAllocations) - walletApplied));
  const balanceAmount = round2(Math.max(0, afterTax - paidAmount));

  const buyerName = order.customer.deletedAt
    ? address.fullName
    : (getFullName(order.customer) ?? address.fullName);
  const shippingAddress = toInvoiceAddress(address);
  const billingAddress: InvoiceAddress = { ...shippingAddress, fullName: buyerName };

  return {
    ok: true,
    invoice: {
      orderNumber: order.orderNumber,
      invoiceNumber: order.invoiceNumber ?? order.orderNumber,
      orderDate: order.createdAt,
      invoiceDate: order.createdAt,

      placeOfSupply: address.state,
      natureOfSupply: "Goods",

      seller: {
        shopName: order.seller.shopName,
        gstNumber: order.seller.gstNumber,
        addressLines: sellerAddressLines(order.seller.registeredAddress, order.pickupPoint),
      },

      shippingAddress,
      billingAddress,
      buyerGstNumber: order.buyerGstNumberSnapshot ?? order.customer.dealerProfile?.gstNumber ?? null,

      lineItems,

      totals: {
        beforeTax,
        discounts,
        extraDiscounts,
        walletApplied,
        taxTotal,
        shippingCharges,
        afterTax,
        afterTaxInWords: amountToWords(afterTax),
        paidAmount,
        balanceAmount,
      },
      couponCode,

      paymentMethod: PAYMENT_METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod,
    },
  };
}

/** Admin — no ownership restriction, admin can view/print any seller order's invoice. */
export async function getInvoiceDataForAdmin(sellerOrderId: string): Promise<InvoiceResult> {
  const order = await fetchInvoiceOrderById(sellerOrderId);
  if (!order) return { ok: false, error: "Order not found." };
  return buildInvoiceData(order);
}

/** Seller — scoped to their own orders only (same ownership discipline as getOrderTagData). */
export async function getInvoiceDataForSeller(
  sellerId: string,
  sellerOrderId: string,
): Promise<InvoiceResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: sellerOrderId, sellerId },
    include: invoiceOrderInclude,
  });
  if (!order) return { ok: false, error: "Order not found." };
  const result = await buildInvoiceData(order);
  if (!result.ok) return result;
  // Sellers never see a buyer's phone number — not even on the invoice they
  // download. Only the number is masked; name and address stay (they are
  // what the invoice legally has to carry).
  const { invoice } = result;
  return {
    ok: true,
    invoice: {
      ...invoice,
      shippingAddress: { ...invoice.shippingAddress, mobile: REDACTED_CONTACT },
      billingAddress: { ...invoice.billingAddress, mobile: REDACTED_CONTACT },
    },
  };
}

/** Customer/dealer — scoped to their own orders only (matches apps/web's orders/[groupId]/[sellerOrderId] ownership check). */
export async function getInvoiceDataForCustomer(
  customerId: string,
  sellerOrderId: string,
): Promise<InvoiceResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: sellerOrderId, customerId },
    include: invoiceOrderInclude,
  });
  if (!order) return { ok: false, error: "Order not found." };
  return buildInvoiceData(order);
}

/** POS staff — "My POS Orders" scoping: only orders this exact staff member placed (same discipline as admin/pos/orders/page.tsx's listCheckoutGroupsForPlacedBy). */
export async function getInvoiceDataForPlacedBy(
  placedByUserId: string,
  sellerOrderId: string,
): Promise<InvoiceResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: sellerOrderId, placedByUserId },
    include: invoiceOrderInclude,
  });
  if (!order) return { ok: false, error: "Order not found." };
  return buildInvoiceData(order);
}
