/**
 * Placeholder shown in the product-grid slot on a category / sub-category
 * / sub-sub-category page that has no products yet — keeps the page from
 * ending abruptly on a bare heading.
 */
export function ComingSoon({ label = "More products coming soon" }: { label?: string }) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-neutral-50 px-6 py-12 text-center">
      <span aria-hidden="true" className="text-3xl">
        🌱
      </span>
      <p className="text-sm font-semibold text-gray-600">{label}</p>
    </div>
  );
}
