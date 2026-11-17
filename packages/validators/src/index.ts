/**
 * Shared Zod schemas per NEXTJS_ARCHITECTURE_PLAN.md §4/§12. Auth
 * schemas landed in Phase 1; the rest (cart, checkout, product forms,
 * KYC uploads, etc.) arrive alongside the domain modules that need them
 * — see BUILD_PHASES.md.
 */
export * from "./auth";
export * from "./language";
export * from "./indian-states";
export * from "./registration";
export * from "./admin";
export * from "./gst";
export * from "./pricing";
export * from "./net-payable";
export * from "./variant-combinations";
export * from "./shipping";
export * from "./catalog";
export * from "./rich-text";
export * from "./bulk-product";
export * from "./product-request";
export * from "./address";
export * from "./cart";
export * from "./checkout";
export * from "./order-actions";
export * from "./customer-discount";
export * from "./licence";
export * from "./partial-payment";
export * from "./site-settings";
export * from "./pos-pricing";
export * from "./homepage";
export * from "./mobile";
export * from "./reviews";
export * from "./wallet";
export * from "./blog";
export * from "./pos";
export * from "./legal-content";
export * from "./ba";
export * from "./coupon";
