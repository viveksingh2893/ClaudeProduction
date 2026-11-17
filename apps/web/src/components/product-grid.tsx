/** Responsive listing grid for MiniProductCard tiles (catalogue, wishlist, tag pages, deal of the day). */
export function ProductGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}
