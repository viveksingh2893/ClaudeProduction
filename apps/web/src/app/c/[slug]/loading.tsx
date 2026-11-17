import { CategoryPageSkeleton } from "@/components/homepage/product-grid-skeleton";

/**
 * Route-level Suspense fallback for a category tab. Shown the instant a
 * ribbon tab is tapped, so the persistent shell (header + ribbon + bottom
 * nav) stays frozen while this category's data streams in.
 */
export default function CategoryLoading() {
  return <CategoryPageSkeleton />;
}
