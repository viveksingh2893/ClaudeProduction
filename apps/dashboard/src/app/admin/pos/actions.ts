"use server";

import { prisma, getFullName, type PaymentMethod } from "@kisan4u/db";
import {
  searchCustomersForPos,
  searchApprovedDealersForPos,
  createCustomerForPos,
  registerPosDealer,
  type PosCustomerResult,
  type PosDealerResult,
} from "@kisan4u/auth";
export type { PosCustomerResult, PosDealerResult };
import {
  listAddresses,
  createAddress,
  updateAddress,
  addressMatchesDealerState,
  validateCartLine,
  addToCart,
  updateCartItemQuantity,
  removeCartItem,
  clearCart,
  getCartForUser,
  buildCheckoutDrafts,
  validatePaymentMethodRules,
  getWalletSummary,
  checkout,
  listSellerOrdersForAdmin,
  resolveOrderItemImageUrls,
  type LineValidationResult,
  type CartView,
  type BuildDraftsResult,
  type WalletSummary,
} from "@kisan4u/orders";
import {
  searchCustomerCatalogueForPos,
  searchDealerCatalogueForPos,
  getCustomerProductById,
  getDealerProductDetail,
  getCategoryNavTree,
  getSiteSettings,
  adaptCustomerProduct,
  adaptDealerProduct,
  createProductRequest,
  type ProductCardData,
} from "@kisan4u/catalog";
import type { PlainVariant } from "@kisan4u/ui";
import {
  posCreateCustomerSchema,
  posDealerRegistrationSchema,
  customerAddressInputSchema,
  addToCartInputSchema,
  updateCartItemQuantityInputSchema,
  checkoutInputSchema,
  type ProductRequestInput,
} from "@kisan4u/validators";
import { uploadPrivateDocument, validatePrivateDocumentContent } from "@kisan4u/providers";
import { requirePosAccess } from "@/lib/pos-guard";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
import { resolvePosOrderContext } from "./lib/pos-context";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function searchPosCustomersAction(
  q: string,
): Promise<ActionResult<PosCustomerResult[]>> {
  await requirePosAccess();
  const results = await searchCustomersForPos(q);
  return { ok: true, data: results };
}

export async function searchPosDealersAction(q: string): Promise<ActionResult<PosDealerResult[]>> {
  await requirePosAccess();
  const results = await searchApprovedDealersForPos(q);
  return { ok: true, data: results };
}

export type CreatePosCustomerResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      error: string;
      existingCustomer?: {
        id: string;
        name: string;
        maskedPhone: string | null;
        email: string | null;
      };
    };

export async function createPosCustomerAction(rawInput: unknown): Promise<CreatePosCustomerResult> {
  await requirePosAccess();
  const parsed = posCreateCustomerSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  return createCustomerForPos(parsed.data);
}

export type RegisterPosDealerResult =
  { ok: true; dealerProfileId: string } | { ok: false; error: string };

/**
 * Reuses `registerDealer` completely unchanged — the resulting dealer
 * is PENDING, exactly like public self-registration, and only becomes
 * selectable in POS (or anywhere else) after the existing admin approval
 * workflow (apps/dashboard/src/app/admin/dealers) approves them. POS
 * grants no shortcut here.
 */
export async function registerPosDealerAction(rawInput: unknown): Promise<RegisterPosDealerResult> {
  await requirePosAccess();
  const parsed = posDealerRegistrationSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  return registerPosDealer(parsed.data);
}

/**
 * Admin-authenticated equivalent of apps/web's public dealer-document
 * upload route (see .../register/dealer/upload-document/route.ts) — same
 * size/type rules and the same underlying storage provider, gated by an
 * admin session (requirePosAccess) instead of an anonymous onboarding
 * cookie, since this is the admin operating POS on the dealer's behalf,
 * not the dealer themself. Returns a `/api/uploads/...` path servable by
 * apps/web (see UPLOAD_STORAGE_ROOT in packages/providers/src/storage.ts
 * for why this lands there and not under apps/dashboard's own storage).
 */
export async function uploadPosDealerDocumentAction(
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  await requirePosAccess();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file provided." };
  const validation = await validatePrivateDocumentContent(file);
  if (validation === "FILE_TOO_LARGE")
    return { ok: false, error: "File is larger than 5 MB." };
  if (validation)
    return { ok: false, error: validation === "CONTENT_MISMATCH" ? "File content doesn't match its extension." : validation === "UNSAFE_PDF" ? "PDFs containing scripts or automatic actions aren't allowed." : "Only PDF, JPG, PNG, or WEBP files are allowed." };

  const uploaded = await uploadPrivateDocument(file, "dealer-documents");
  return { ok: true, data: { url: uploaded.storageKey } };
}

export async function listPosIndianStatesAction(): Promise<
  ActionResult<{ id: string; name: string }[]>
> {
  await requirePosAccess();
  const states = await prisma.indianState.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  return { ok: true, data: states };
}

export type PosAddressView = Awaited<ReturnType<typeof listAddresses>>[number] & {
  eligible: boolean;
};

/**
 * Every address is returned (never silently hidden), each flagged
 * `eligible` — spec §9's "existing dealer addresses outside the approved
 * state must not be eligible for SELECTION" is a UI-selectability rule,
 * not a visibility rule, and actual order placement re-enforces this
 * regardless (checkout() -> resolveCheckoutAddress runs the identical
 * addressMatchesDealerState check, so a manipulated request selecting an
 * ineligible address here still fails server-side at Place Order).
 */
export async function listPosAddressesAction(
  targetUserId: string,
): Promise<ActionResult<PosAddressView[]>> {
  await requirePosAccess();
  const ctx = await resolvePosOrderContext(targetUserId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const addresses = await listAddresses(targetUserId);
  const withEligibility: PosAddressView[] = addresses.map((address) => ({
    ...address,
    eligible: ctx.role === "CUSTOMER" ? true : addressMatchesDealerState(address, ctx.dealerState),
  }));
  return { ok: true, data: withEligibility };
}

/** `dealerLock` is never accepted from the client — resolvePosOrderContext re-derives it fresh from the target user's own DealerProfile every time (spec §9 "do not allow the restriction to be bypassed by editing frontend requests"). */
export async function addPosAddressAction(
  targetUserId: string,
  rawInput: unknown,
): Promise<ActionResult<{ addressId: string }>> {
  await requirePosAccess();
  const ctx = await resolvePosOrderContext(targetUserId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const parsed = customerAddressInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const dealerLock = ctx.role === "DEALER" ? ctx.dealerState : null;
  const result = await createAddress(targetUserId, dealerLock, parsed.data);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: { addressId: result.addressId } };
}

export async function updatePosAddressAction(
  targetUserId: string,
  rawInput: unknown,
): Promise<ActionResult<{ addressId: string }>> {
  await requirePosAccess();
  const ctx = await resolvePosOrderContext(targetUserId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const parsed = customerAddressInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const dealerLock = ctx.role === "DEALER" ? ctx.dealerState : null;
  const result = await updateAddress(targetUserId, dealerLock, parsed.data);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: { addressId: result.addressId } };
}

export async function listPosCategoriesAction(): Promise<
  ActionResult<Awaited<ReturnType<typeof getCategoryNavTree>>>
> {
  await requirePosAccess();
  const categories = await getCategoryNavTree();
  return { ok: true, data: categories };
}

export async function listPosBrandsAction(): Promise<ActionResult<{ id: string; name: string }[]>> {
  await requirePosAccess();
  const brands = await prisma.brand.findMany({
    where: { status: "APPROVED" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return { ok: true, data: brands };
}

export type PosCatalogueBrowseInput = {
  targetUserId: string;
  categorySlug?: string;
  brandId?: string;
  search?: string;
  availableOnly?: boolean;
  page?: number;
  pageSize?: number;
};

export type PosCatalogueBrowseResult = {
  cards: (ProductCardData & { productId: string })[];
  total: number;
  page: number;
  pageSize: number;
  role: "CUSTOMER" | "DEALER";
};

/**
 * The one entry point POS's product grid calls — determines catalogue
 * (customer vs. dealer), audience-correct pricing, and state-availability
 * from `resolvePosOrderContext(targetUserId)`, never from anything the
 * client claims about which customer type is active (spec §10/§11). Cards
 * are built with the exact same `adaptCustomerProduct`/`adaptDealerProduct`
 * the storefront's own product grid uses, so a card here can never
 * disagree with what that same product looks like on the website.
 */
export async function browsePosCatalogueAction(
  input: PosCatalogueBrowseInput,
): Promise<ActionResult<PosCatalogueBrowseResult>> {
  await requirePosAccess();
  const ctx = await resolvePosOrderContext(input.targetUserId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const siteSettings = await getSiteSettings();
  const opts = { ratingThreshold: siteSettings.ratingDisplayThreshold, wishlisted: false };

  if (ctx.role === "CUSTOMER") {
    const { rows, total, page, pageSize } = await searchCustomerCatalogueForPos({
      categorySlug: input.categorySlug,
      brandId: input.brandId,
      search: input.search,
      page: input.page,
      pageSize: input.pageSize,
    });
    const cards = rows.map((p) => {
      const card = adaptCustomerProduct(p, opts);
      return {
        ...card,
        imageUrls: card.imageUrls.map((u) => resolveStorefrontAssetUrl(u) ?? u),
        productId: p.id,
      };
    });
    return { ok: true, data: { cards, total, page, pageSize, role: "CUSTOMER" } };
  }

  const { rows, total, page, pageSize } = await searchDealerCatalogueForPos(ctx.dealerState.id, {
    categorySlug: input.categorySlug,
    brandId: input.brandId,
    search: input.search,
    availableOnly: input.availableOnly,
    page: input.page,
    pageSize: input.pageSize,
  });
  const cards = rows.map((p) => {
    const card = adaptDealerProduct(p, opts);
    return {
      ...card,
      imageUrls: card.imageUrls.map((u) => resolveStorefrontAssetUrl(u) ?? u),
      productId: p.id,
    };
  });
  return { ok: true, data: { cards, total, page, pageSize, role: "DEALER" } };
}

function toPlainVariants(
  variants: Array<{
    id: string;
    isActive: boolean;
    isDefault?: boolean;
    stockQty: number;
    sku: string;
    mrp: { toString(): string };
    sellingPrice: { toString(): string };
    minOrderQty: number;
    imageUrl: string | null;
    imageAlt: string | null;
    values: Array<{
      attributeValue: {
        id: string;
        value: string;
        attributeId: string;
        attribute: { name: string };
      };
    }>;
  }>,
): PlainVariant[] {
  return variants.map((v) => ({
    id: v.id,
    isActive: v.isActive,
    stockQty: v.stockQty,
    sku: v.sku,
    mrp: v.mrp.toString(),
    sellingPrice: v.sellingPrice.toString(),
    minOrderQty: v.minOrderQty,
    imageUrl: v.imageUrl,
    imageAlt: v.imageAlt,
    // POS has no gallery/video/loyalty/per-unit-price UI — never fetched for this path.
    images: [],
    videoUrl: null,
    loyaltyPoints: null,
    perUnitMrp: null,
    attributeValues: v.values.map((val) => ({
      attributeId: val.attributeValue.attributeId,
      attributeName: val.attributeValue.attribute.name,
      valueId: val.attributeValue.id,
      value: val.attributeValue.value,
    })),
  }));
}

export type PosProductDetail = {
  productId: string;
  name: string;
  shortDescription: string;
  sellerName: string | null;
  images: { id: string; url: string; altText: string | null }[];
  variants: PlainVariant[];
  defaultVariantId: string | null;
  baseConfig: { minOrderQty: number; mrp: number; sellingPrice: number } | null;
  /** Keyed "" for the no-variant base product, otherwise by variantId — always computed via validateCartLine, the exact same source of truth cart/checkout use, never a simplified stock-only heuristic. */
  eligibility: Record<string, LineValidationResult>;
  role: "CUSTOMER" | "DEALER";
  /** Only meaningful for a dealer product blocked by STATE_UNAVAILABLE — spec §8's "Request This Product" gate re-checks this server-side again at submit time regardless. */
  canRequestProduct: boolean;
};

/**
 * POS's product-detail modal (spec §12) — mirrors apps/web's own customer/
 * dealer product-detail pages exactly (same VariantPicker, same
 * validateCartLine-sourced eligibility for the dealer "Request This
 * Product vs. Add to Cart" decision) but returns a plain, role-agnostic
 * DTO instead of rendering, since the two audiences share this one modal
 * component in the dashboard app.
 */
export async function getPosProductDetailAction(
  targetUserId: string,
  productId: string,
): Promise<ActionResult<PosProductDetail>> {
  await requirePosAccess();
  const ctx = await resolvePosOrderContext(targetUserId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  if (ctx.role === "CUSTOMER") {
    const product = await getCustomerProductById(productId);
    if (!product) return { ok: false, error: "Product not found." };

    const lineCtx = { role: "CUSTOMER" as const, dealerStateId: null };
    const hasVariants = product.variants.length > 0;
    const eligibility: Record<string, LineValidationResult> = {};
    if (hasVariants) {
      for (const v of product.variants)
        eligibility[v.id] = await validateCartLine(product.id, v.id, v.minOrderQty, lineCtx);
    } else if (product.customerConfig) {
      eligibility[""] = await validateCartLine(
        product.id,
        null,
        product.customerConfig.minOrderQty,
        lineCtx,
      );
    }

    return {
      ok: true,
      data: {
        productId: product.id,
        name: product.name,
        shortDescription: product.shortDescription,
        sellerName: product.seller?.shopName ?? null,
        images: (product.images.length > 0
          ? product.images
          : [{ id: "primary", url: product.primaryImageUrl, altText: product.name }]
        ).map((img) => ({ ...img, url: resolveStorefrontAssetUrl(img.url) ?? img.url })),
        variants: toPlainVariants(product.variants),
        defaultVariantId: product.variants.find((v) => v.isDefault)?.id ?? null,
        baseConfig: product.customerConfig
          ? {
              minOrderQty: product.customerConfig.minOrderQty,
              mrp: Number(product.customerConfig.mrp),
              sellingPrice: Number(product.customerConfig.sellingPrice),
            }
          : null,
        eligibility,
        role: "CUSTOMER",
        canRequestProduct: false,
      },
    };
  }

  const product = await getDealerProductDetail(productId, ctx.dealerState.id);
  if (!product) return { ok: false, error: "Product not found." };

  const lineCtx = { role: "DEALER" as const, dealerStateId: ctx.dealerState.id };
  const hasVariants = product.variants.length > 0;
  const eligibility: Record<string, LineValidationResult> = {};
  if (hasVariants) {
    for (const v of product.variants)
      eligibility[v.id] = await validateCartLine(product.id, v.id, v.minOrderQty, lineCtx);
  } else if (product.dealerConfig) {
    eligibility[""] = await validateCartLine(
      product.id,
      null,
      product.dealerConfig.minOrderQty,
      lineCtx,
    );
  }
  const canRequestProduct = !product.availableInState;

  return {
    ok: true,
    data: {
      productId: product.id,
      name: product.name,
      shortDescription: product.shortDescription,
      sellerName: product.seller?.shopName ?? null,
      images: (product.images.length > 0
        ? product.images
        : [{ id: "primary", url: product.primaryImageUrl, altText: product.name }]
      ).map((img) => ({ ...img, url: resolveStorefrontAssetUrl(img.url) ?? img.url })),
      variants: toPlainVariants(product.variants),
      defaultVariantId: product.variants.find((v) => v.isDefault)?.id ?? null,
      baseConfig: product.dealerConfig
        ? {
            minOrderQty: product.dealerConfig.minOrderQty,
            mrp: Number(product.dealerConfig.mrp),
            sellingPrice: Number(product.dealerConfig.sellingPrice),
          }
        : null,
      eligibility,
      role: "DEALER",
      canRequestProduct,
    },
  };
}

export type CreatePosProductRequestResult =
  { ok: true; requestId: string; publicRequestNumber: string } | { ok: false; error: string };

/**
 * POS's "Request This Product" (spec §8/§11/§13) reuses createProductRequest
 * completely unchanged — same PENDING request, same admin-approval →
 * seller-visible-summary flow, same dealer-anonymity guarantees toward the
 * seller — never a parallel/simplified request path. `targetUserId`'s
 * dealerProfileId is re-derived here (never trusted from the client), and
 * the four eligibility conditions (approved dealer, dealer-configured
 * product, actually state-unavailable, not already requestable elsewhere)
 * are re-checked inside createProductRequest itself, exactly as they would
 * be for a dealer submitting this from the storefront.
 */
export async function createPosProductRequestAction(
  targetUserId: string,
  rawInput: unknown,
): Promise<CreatePosProductRequestResult> {
  await requirePosAccess();
  const ctx = await resolvePosOrderContext(targetUserId);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (ctx.role !== "DEALER")
    return { ok: false, error: "Only a dealer order can request an unavailable product." };

  return createProductRequest(ctx.dealerProfileId, rawInput as ProductRequestInput);
}

/**
 * POS never keeps its own parallel cart representation — every "add to
 * cart" click writes a real `CartItem` row for the TARGET customer/dealer
 * (never the logged-in admin), through the exact same addToCart/
 * updateCartItemQuantity/removeCartItem/getCartForUser/clearCart
 * (packages/orders/src/cart.ts) the storefront itself uses. That single
 * choice is what makes seller-wise splitting, per-line revalidation,
 * pricing, and stock checks identical between POS and the website with no
 * separate cart logic to keep in sync — and it's also how "switching
 * customer/person clears the cart" (spec §3) is enforced for real: clearing
 * literally deletes that customer's CartItem rows, not just some POS UI
 * state.
 */
function toLineCtx(ctx: Extract<Awaited<ReturnType<typeof resolvePosOrderContext>>, { ok: true }>) {
  return { role: ctx.role, dealerStateId: ctx.role === "DEALER" ? ctx.dealerState.id : null };
}

/** getCartForUser (packages/orders) is shared with the real storefront cart, where a relative "/api/uploads/..." path is correct as-is — resolving it to an absolute apps/web url only makes sense for this POS UI, which runs on apps/dashboard's own separate origin. */
function resolveCartViewImages(cart: CartView): CartView {
  return {
    ...cart,
    sellerGroups: cart.sellerGroups.map((group) => ({
      ...group,
      items: group.items.map((item) => ({
        ...item,
        productImageUrl: resolveStorefrontAssetUrl(item.productImageUrl) ?? item.productImageUrl,
      })),
    })),
  };
}

export async function getPosCartAction(targetUserId: string): Promise<ActionResult<CartView>> {
  await requirePosAccess();
  const ctx = await resolvePosOrderContext(targetUserId);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const cart = await getCartForUser(targetUserId, toLineCtx(ctx));
  return { ok: true, data: resolveCartViewImages(cart) };
}

export async function addToPosCartAction(
  targetUserId: string,
  rawInput: unknown,
): Promise<ActionResult<{ cartItemId: string }>> {
  await requirePosAccess();
  const ctx = await resolvePosOrderContext(targetUserId);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const parsed = addToCartInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const result = await addToCart(targetUserId, toLineCtx(ctx), parsed.data);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: { cartItemId: result.cartItemId } };
}

export async function updatePosCartItemQuantityAction(
  targetUserId: string,
  rawInput: unknown,
): Promise<ActionResult<{ cartItemId: string }>> {
  await requirePosAccess();
  const ctx = await resolvePosOrderContext(targetUserId);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const parsed = updateCartItemQuantityInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const result = await updateCartItemQuantity(targetUserId, toLineCtx(ctx), parsed.data);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: { cartItemId: result.cartItemId } };
}

export async function removePosCartItemAction(
  targetUserId: string,
  cartItemId: string,
): Promise<ActionResult<{ cartItemId: string }>> {
  await requirePosAccess();
  const result = await removeCartItem(targetUserId, cartItemId);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: { cartItemId: result.cartItemId } };
}

/** Called both by an explicit Cancel Order and automatically before switching the active customer/dealer (spec §3/§18) — always scoped to whichever userId is being left behind, never the newly-selected one. */
export async function clearPosCartAction(
  targetUserId: string,
): Promise<ActionResult<{ removed: number }>> {
  await requirePosAccess();
  const result = await clearCart(targetUserId);
  return { ok: true, data: result };
}

const ALL_PAYMENT_METHODS: PaymentMethod[] = [
  "COD",
  "ONLINE_FULL",
  "ONLINE_PARTIAL",
  "TRANSPORT_FULL_ONLINE",
];

export type PosCheckoutPreview = {
  role: "CUSTOMER" | "DEALER";
  deliveryMethod: "KISAN4U_COURIER" | "TRANSPORT";
  allowedPaymentMethods: PaymentMethod[];
  draft: BuildDraftsResult;
  wallet: WalletSummary;
};

/**
 * The read-only "what would this order cost" preview (spec §13/§14/§15/
 * §16), computed the exact same way as apps/web's own checkout page —
 * buildCheckoutDrafts (packages/orders/src/checkout-draft.ts) is the same
 * charge calculation checkout() itself runs, so a total shown in POS can
 * never drift from what Place Order actually charges. `deliveryMethod` is
 * forced to KISAN4U_COURIER for a customer regardless of what's passed in,
 * exactly like the storefront checkout page (a customer has no Transport
 * option to begin with).
 */
export async function getPosCheckoutPreviewAction(
  targetUserId: string,
  input: {
    deliveryMethod: "KISAN4U_COURIER" | "TRANSPORT";
    paymentMethod: PaymentMethod;
    couponCode?: string;
  },
): Promise<ActionResult<PosCheckoutPreview>> {
  await requirePosAccess();
  const ctx = await resolvePosOrderContext(targetUserId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const deliveryMethod =
    ctx.role === "DEALER" && input.deliveryMethod === "TRANSPORT" ? "TRANSPORT" : "KISAN4U_COURIER";
  const allowedPaymentMethods = ALL_PAYMENT_METHODS.filter(
    (m) => validatePaymentMethodRules(ctx.role, deliveryMethod, m).ok,
  );
  const paymentMethod = allowedPaymentMethods.includes(input.paymentMethod)
    ? input.paymentMethod
    : (allowedPaymentMethods[0] ?? "COD");

  const draft = await buildCheckoutDrafts(targetUserId, {
    role: ctx.role,
    dealerStateId: ctx.role === "DEALER" ? ctx.dealerState.id : null,
    deliveryMethod,
    paymentMethod,
    // Every call in this file is inherently "placed via POS" — the only
    // remaining condition is CUSTOMER (never DEALER), matching checkout.ts.
    isPosCustomerOrder: ctx.role === "CUSTOMER",
    couponCode: input.couponCode,
  });

  const wallet = await getWalletSummary(targetUserId, ctx.role);

  return {
    ok: true,
    data: {
      role: ctx.role,
      deliveryMethod,
      allowedPaymentMethods,
      draft,
      wallet,
    },
  };
}

export type PlacePosOrderInput = {
  targetUserId: string;
  deliveryMethod: "KISAN4U_COURIER" | "TRANSPORT";
  paymentMethod: PaymentMethod;
  transportNote?: string;
  addressId?: string;
  walletAmountApplied?: number;
  idempotencyKey: string;
  /**
   * ONLINE_PARTIAL only — the operator-typed rupee amount to collect now
   * (customer or dealer). For a CUSTOMER order this is entered against
   * the already-discounted total (see checkout.ts's isPosCustomerOrder
   * branch for the discount computation) — "post-discount total minus
   * this amount" is what's left as the COD balance. Re-validated
   * authoritatively inside checkout() itself (> 0 and < grand total); the
   * check here is a fast-fail UX nicety, not a security boundary.
   */
  posAdvanceAmount?: number;
  couponCode?: string;
};

export type PlacePosOrderResult =
  { ok: true; checkoutGroupId: string; groupNumber: string } | { ok: false; error: string };

/**
 * The one Place Order entry point (spec §18) — every precondition is
 * re-verified here from scratch (role/dealer-approval/state via
 * resolvePosOrderContext, payment-method legality via
 * validatePaymentMethodRules — enforced again inside checkout() itself too)
 * rather than trusting anything the POS UI computed client-side. Order
 * creation itself is `checkout()` (packages/orders/src/checkout.ts) — the
 * same transactional, idempotent, multi-seller-splitting service the
 * storefront uses, so every downstream effect (inventory, wallet ledger,
 * payment records, notifications, seller/admin/customer/dealer visibility)
 * is identical between POS and the website — EXCEPT that a non-COD order
 * placed here never auto-confirms: `requiresManualPaymentApproval: true`
 * (see checkout.ts's applyInitialPayment) leaves it at PENDING_PAYMENT
 * until an admin approves an uploaded payment-proof screenshot (see
 * packages/orders/src/pos-payment-proof.ts and
 * apps/dashboard/src/app/admin/pos/orders/).
 */
export async function placePosOrderAction(input: PlacePosOrderInput): Promise<PlacePosOrderResult> {
  const staffSession = await requirePosAccess();
  const ctx = await resolvePosOrderContext(input.targetUserId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const deliveryMethod =
    ctx.role === "DEALER" && input.deliveryMethod === "TRANSPORT" ? "TRANSPORT" : "KISAN4U_COURIER";
  const paymentRule = validatePaymentMethodRules(ctx.role, deliveryMethod, input.paymentMethod);
  if (!paymentRule.ok) return { ok: false, error: paymentRule.error };

  // The amount to collect now is entered against what is left after the
  // wallet, so a wallet that covers the whole order needs none — checkout()
  // itself re-validates it (> 0 and < what is left) whenever there IS a
  // balance to split.
  if (
    input.paymentMethod === "ONLINE_PARTIAL" &&
    !(input.posAdvanceAmount && input.posAdvanceAmount > 0) &&
    !(input.walletAmountApplied && input.walletAmountApplied > 0)
  ) {
    return { ok: false, error: "Enter the amount to collect now." };
  }

  const checkoutInput = checkoutInputSchema.safeParse({
    addressId: input.addressId,
    deliveryMethod,
    paymentMethod: input.paymentMethod,
    transportNote: input.transportNote,
    walletAmountApplied: input.walletAmountApplied,
    idempotencyKey: input.idempotencyKey,
    couponCode: input.couponCode,
  });
  if (!checkoutInput.success)
    return { ok: false, error: checkoutInput.error.issues[0]?.message ?? "Invalid input" };

  const dealerState = ctx.role === "DEALER" ? ctx.dealerState : null;
  const placedByName =
    getFullName({ firstName: staffSession.user.firstName, lastName: staffSession.user.lastName }) ??
    staffSession.user.email ??
    "Staff";
  return checkout(
    input.targetUserId,
    {
      role: ctx.role,
      dealerState,
      placedBy: { id: staffSession.user.id, name: placedByName },
      requiresManualPaymentApproval: input.paymentMethod !== "COD",
      // Never undefined for a partial POS order (0 when wallet-covered):
      // undefined would silently fall back to the percentage rule.
      posAdvanceAmount:
        input.paymentMethod === "ONLINE_PARTIAL" ? (input.posAdvanceAmount ?? 0) : undefined,
    },
    checkoutInput.data,
  );
}

// ── Buyer order history (for the sales agent to see what they ordered before) ──

export type PosOrderHistoryItem = {
  name: string;
  variantLabel: string | null;
  quantity: number;
  unit: string;
  imageUrl: string | null;
};

export type PosOrderHistoryEntry = {
  orderNumber: string;
  createdAt: string;
  status: string;
  sellerShopName: string;
  totalAmount: string;
  items: PosOrderHistoryItem[];
};

/**
 * The selected customer's / dealer's own past orders (most recent first) so
 * a POS sales agent can see what they've bought before and suggest what
 * they might need next. Reuses the admin order query scoped by customerId.
 */
export async function loadPosOrderHistoryAction(
  targetUserId: string,
): Promise<ActionResult<PosOrderHistoryEntry[]>> {
  await requirePosAccess();
  const { rows } = await listSellerOrdersForAdmin({
    customerId: targetUserId,
    page: 1,
    pageSize: 25,
    sortKey: "createdAt",
    sortDir: "desc",
  });
  const imageByItemId = await resolveOrderItemImageUrls(
    rows.flatMap((o) => o.items.map((it) => ({ ...it, key: it.id }))),
  );
  const data: PosOrderHistoryEntry[] = rows.map((o) => ({
    orderNumber: o.orderNumber,
    createdAt: o.createdAt.toISOString(),
    status: o.status,
    sellerShopName: o.seller.shopName,
    totalAmount: Number(o.totalAmount).toFixed(2),
    items: o.items.map((it) => ({
      name: it.productName,
      variantLabel: it.variantLabel,
      quantity: it.quantity,
      unit: it.unit,
      imageUrl: resolveStorefrontAssetUrl(imageByItemId.get(it.id) ?? null),
    })),
  }));
  return { ok: true, data };
}
