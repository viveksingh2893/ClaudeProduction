/**
 * Kisan4U shared design system — consumed by both apps/web (customer)
 * and apps/dashboard (seller/admin). Tokens live in ./styles/tokens.css
 * (imported once per app via "@kisan4u/ui/tokens.css" in globals.css);
 * components here are deliberately state-free (no "use client") so they
 * render correctly whether the importing file is a Server or Client
 * Component — interactivity is wired by the caller.
 */
export * from "./Button";
export * from "./Badge";
export * from "./Card";
export * from "./Form";
export * from "./Layout";
export * from "./Feedback";
export * from "./Product";
export * from "./SearchBar";
export * from "./OrderStatusTimeline";
export * from "./Table";
export * from "./TableScrollArea";
// Carousel/Modal/ScrollRow/DataTable/RowActionMenu are the documented
// exceptions to "deliberately state-free" above — see their own
// file-level doc comments.
export * from "./Carousel";
export * from "./Modal";
export * from "./ScrollRow";
export * from "./Accordion";
export * from "./DataTable";
export * from "./RowActionMenu";
export * from "./useTableUrlState";
export * from "./TableFilters";
export * from "./Rating";
export * from "./SegmentedToggle";
// VariantPicker is the other documented exception to "deliberately
// state-free" — it owns its own attribute-selection state so the
// customer product page, the dealer product page, and apps/dashboard's
// POS product modal all share the exact same dynamic variant-combination
// UI/logic (packages/catalog/src/variant-compatibility.ts) instead of
// three copies. Moved here from apps/web (which only had it as a
// same-app-local component) specifically so POS could reuse it too.
export * from "./VariantPicker";
// ProductImage moved here from apps/web for the same reason as
// VariantPicker/product-card-adapter — apps/dashboard's POS product grid
// and product-detail modal need the exact same image sizing/fallback
// behaviour as the storefront, not a second implementation.
export * from "./ProductImage";
export * from "./OrderItemSummary";
export * from "./ImageUploadField";
// RichTextEditor and SafeHtml are deliberately NOT re-exported here — each
// pulls in a heavy dependency (Tiptap, sanitize-html) that must never end
// up in the shared client bundle every page gets just for importing
// something unrelated like Badge/Button from this barrel. Import them
// directly from "@kisan4u/ui/RichTextEditor" / "@kisan4u/ui/SafeHtml"
// instead (see packages/ui/package.json's `exports` map).
export * from "./date";
