/**
 * Loose response types for the mobile API — deliberately not a 1:1 mirror
 * of every Prisma include shape (that lives server-side and can evolve
 * independently); these cover exactly the fields the app's screens read.
 * Money fields arrive as strings (Prisma Decimal's JSON serialization) —
 * parse with Number(...) at render time, never trust client-side math for
 * anything that affects a total (the server always re-derives those).
 */

export type ProductImage = { id: string; url: string; altText: string | null };
export type CategoryRef = { id: string; name: string; slug: string };
export type NameRef = { id: string; name: string } | null;
export type BrandRef = { id: string; name: string; slug: string } | null;

export type ProductVariantAttributeValue = {
  attributeValue: { id: string; value: string; attributeId: string; attribute: { name: string } };
};

export type ProductVariantDTO = {
  id: string;
  sku: string;
  isActive: boolean;
  isDefault?: boolean;
  stockQty: number;
  minOrderQty: number;
  mrp: string;
  sellingPrice: string;
  weight?: number | null;
  imageUrl: string | null;
  imageAlt?: string | null;
  values: ProductVariantAttributeValue[];
};

type ProductCommon = {
  id: string;
  name: string;
  slug: string;
  subtitle: string | null;
  badge: string | null;
  deliveryBadgeEnabled: boolean;
  deliveryBadgeText: string | null;
  availabilityBadgeMode: string;
  availabilityBadgeText: string | null;
  ratingAverage: string | number | null;
  ratingCount: number;
  primaryImageUrl: string;
  videoUrl?: string | null;
  category: CategoryRef;
  subCategory: NameRef;
  subSubCategory?: NameRef;
  brand: BrandRef;
  manufacturer: NameRef;
  images: ProductImage[];
  variants: ProductVariantDTO[];
  seller?: { shopName: string; slug?: string } | null;
  shortDescription?: string;
  description?: string;
  ingredients?: string | null;
  howToUse?: string | null;
  dosageInstructions?: string | null;
  featuredPosition?: number | null;
};

export type CustomerProductDTO = ProductCommon & {
  customerConfig: {
    mrp: string;
    sellingPrice: string;
    minOrderQty: number;
    currentStock: number;
  } | null;
};

export type DealerProductDTO = ProductCommon & {
  dealerConfig: {
    mrp: string;
    sellingPrice: string;
    minOrderQty: number;
    currentStock: number;
  } | null;
  availableInState: boolean;
  sellerId?: string;
};

export type CategoryNode = {
  id: string;
  name: string;
  slug: string;
  emoji: string | null;
  imageUrl: string | null;
  subCategories: {
    id: string;
    name: string;
    slug: string;
    imageUrl: string | null;
    subSubCategories: { id: string; name: string; slug: string; imageUrl: string | null }[];
  }[];
};

/** Top-level category for the homepage's image-based category row — same source as the website's Shop by Category (Category.imageUrl, Category.position). */
export type HomepageCategoryDTO = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
};

/** Approved, homepage-positioned brand for the Shop by Brand rail (Brand.imageUrl, Brand.homepagePosition). */
export type HomepageBrandDTO = { id: string; name: string; slug: string; imageUrl: string | null };

/** "Shop by Crop" / "Shop by Pest & Disease" homepage chip — mirrors @kisan4u/catalog CropPestChip. */
export type HomepageCropPestDTO = {
  id: string;
  name: string;
  slug: string;
  emoji: string | null;
  imageUrl: string | null;
};

/** One per-category homepage rail — mirrors getHomepageCategoryRows on web. */
export type HomepageCategoryRowDTO = {
  category: { id: string; name: string; slug: string };
  products: CustomerProductDTO[];
};

/** One per-subcategory homepage rail, shown after every category row — mirrors getHomepageSubcategoryRows on web. */
export type HomepageSubcategoryRowDTO = {
  subCategory: { id: string; name: string; slug: string; categorySlug: string };
  products: CustomerProductDTO[];
};

/** Hero banner carousel slide — mirrors PromotionalAsset; mobileImageUrl is preferred, desktopImageUrl is the fallback (see banner-carousel.tsx on web). */
export type HeroBannerDTO = {
  id: string;
  desktopImageUrl: string;
  mobileImageUrl: string | null;
  altText: string;
  linkUrl: string | null;
};

export type ReviewRow = {
  id: string;
  rating: number;
  comment: string | null;
  verifiedPurchase: boolean;
  source: string;
  manualCustomerName: string | null;
  createdAt: string;
  customerName: string | null;
};

export type LineValidationErrorCode =
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_INACTIVE"
  | "VARIANT_NOT_FOUND"
  | "VARIANT_INACTIVE"
  | "STATE_UNAVAILABLE"
  | "LICENSE_MISSING"
  | "OUT_OF_STOCK"
  | "BELOW_MIN_QTY"
  | "CONFIG_MISSING";

export type LineEligibility =
  { ok: true; line: unknown } | { ok: false; error: string; code: LineValidationErrorCode };

export type CartLineDTO = {
  cartItemId: string;
  productId: string;
  productName: string;
  productImageUrl: string;
  variantId: string | null;
  variantLabel: string | null;
  sku: string;
  quantity: number;
  currentPrice: number | null;
  priceAtAdd: number;
  priceChanged: boolean;
  mrp: number | null;
  minOrderQty: number | null;
  currentStock: number | null;
  lineSubtotal: number | null;
  validationError: string | null;
};

export type SellerGroupDTO = {
  sellerId: string;
  sellerName: string;
  items: CartLineDTO[];
  subtotal: number;
  totalWeightGrams: number;
  logisticsEstimate: { ok: true; cost: number; label?: string } | { ok: false; error: string };
};

export type CartDTO = {
  sellerGroups: SellerGroupDTO[];
  overallTotal: number;
  hasValidationErrors: boolean;
};

export type AddressDTO = {
  id: string;
  fullName: string;
  mobile: string;
  altMobile: string | null;
  line1: string;
  line2: string | null;
  landmark: string | null;
  cityTown: string;
  district: string;
  state: string;
  stateId: string | null;
  pincode: string;
  addressType: "HOME" | "FARM" | "SHOP" | "OFFICE" | "OTHER";
  isDefault: boolean;
};

export type OrderStatusHistoryRow = {
  id: string;
  status: string;
  note: string | null;
  createdAt: string;
};
export type OrderItemRow = {
  id: string;
  productName: string;
  productImageUrl: string;
  variantLabel: string | null;
  quantity: number;
  unitPrice: string;
  mrp: string;
  subtotal: string;
};
export type OrderChargeDTO = {
  transportationCost: string;
  collectionCharge: string;
  customerPayableDelivery: string;
  customerPayableTotal: string;
  promotionalDiscountAmount: string;
};

export type PaymentAllocationDTO = {
  amount: string;
  walletAmountApplied: string;
  payment: { method: string; status: string; walletAmountApplied: string };
};

export type RefundStatus = "PENDING" | "APPROVED" | "REJECTED" | "REFUNDED";
export type RefundMethod = "WALLET" | "ORIGINAL_SOURCE" | "BANK_TRANSFER";

export type RefundRequestDTO = {
  id: string;
  /** null = the refund for a whole-order cancellation; set = a per-item return. */
  orderItemId: string | null;
  status: RefundStatus;
  refundMethod: RefundMethod;
  amount: string;
  reason: string;
  createdAt: string;
};

export type SellerOrderDTO = {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: string;
  deliveryMethod: string;
  transportNote?: string | null;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  invoiceNumber: string;
  createdAt: string;
  items: OrderItemRow[];
  charge: OrderChargeDTO | null;
  statusHistory: OrderStatusHistoryRow[];
  seller?: { id: string; shopName: string };
  checkoutGroup?: { addressSnapshot: unknown };
  paymentAllocations?: PaymentAllocationDTO[];
  /** Newest first. Per-item returns + (orderItemId null) a cancellation refund. */
  refundRequests?: RefundRequestDTO[];
};

export type CheckoutGroupOrderItemDTO = {
  id: string;
  productName: string;
  productImageUrl: string;
  variantLabel: string | null;
  quantity: number;
};

export type CheckoutGroupDTO = {
  id: string;
  groupNumber: string;
  createdAt: string;
  sellerOrders: {
    id: string;
    orderNumber: string;
    status: string;
    totalAmount: string;
    seller: { shopName: string };
    items: CheckoutGroupOrderItemDTO[];
  }[];
};

export type DealerProfileDTO = {
  id: string;
  storeName: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
  kycStatus: string;
  rejectionReason: string | null;
  stateId: string | null;
  state: string | null;
};

export type SellerProfileDTO = {
  id: string;
  shopName: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
  rejectionReason: string | null;
};

export type ProductRequestDTO = {
  id: string;
  productId: string;
  quantity: number;
  status: string;
  deliveryAddress: string;
  note: string | null;
  createdAt: string;
};
