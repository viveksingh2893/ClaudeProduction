/**
 * Skeleton for the category product feed — same responsive column ramp as
 * InfiniteProductGrid (2 → 5). Used both as the Suspense fallback for the
 * streamed first page and as a "loading more" placeholder.
 */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-x-3 gap-y-5 md:grid-cols-3 md:gap-x-4 lg:grid-cols-4 xl:grid-cols-5"
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-square w-full rounded-xl bg-neutral-100" />
          <div className="mt-2 h-3 w-4/5 rounded bg-neutral-100" />
          <div className="mt-1.5 h-3 w-2/5 rounded bg-neutral-100" />
        </div>
      ))}
    </div>
  );
}

/** Full category-page skeleton: banner block + two tile rows + first grid page. */
export function CategoryPageSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-[1200px] space-y-3 bg-white pb-6 md:space-y-5"
      aria-hidden="true"
    >
      <div className="px-4 pt-3 md:px-6 lg:px-8">
        <div className="aspect-[2/1] w-full animate-pulse rounded-2xl bg-neutral-100" />
      </div>
      <div className="flex gap-0 overflow-hidden pl-2">
        <div className="grid grid-flow-col grid-rows-2 gap-y-4">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="flex w-[76px] flex-col items-center px-1.5">
              <div className="h-16 w-16 animate-pulse rounded-2xl bg-neutral-100 md:h-[88px] md:w-[88px] lg:h-24 lg:w-24" />
              <div className="mt-1.5 h-2.5 w-12 animate-pulse rounded bg-neutral-100" />
            </div>
          ))}
        </div>
      </div>
      <div className="px-4 md:px-6 lg:px-8">
        <div className="mb-3 h-5 w-40 animate-pulse rounded bg-neutral-100" />
        <ProductGridSkeleton />
      </div>
    </div>
  );
}
