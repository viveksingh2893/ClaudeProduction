"use client";

import { useEffect, useState, useTransition } from "react";
import { FormSelect, SegmentedToggle, Button, EmptyState, LoadingState } from "@kisan4u/ui";
import { Search } from "lucide-react";
import {
  browsePosCatalogueAction,
  listPosCategoriesAction,
  listPosBrandsAction,
  type PosCatalogueBrowseResult,
} from "../actions";
import { PosProductCard } from "./pos-product-card";

const PAGE_SIZE = 24;

export function ProductPanel({
  targetUserId,
  refreshKey,
  onSelectProduct,
}: {
  targetUserId: string;
  /** Bumped by the parent after a cart mutation or address/customer-type change, so availability/pricing shown here can never go stale. */
  refreshKey: number;
  onSelectProduct: (productId: string) => void;
}) {
  const [categories, setCategories] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [categorySlug, setCategorySlug] = useState("");
  const [brandId, setBrandId] = useState("");
  const [search, setSearch] = useState("");
  const [availableOnly, setAvailableOnly] = useState<"all" | "available">("all");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PosCatalogueBrowseResult | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    listPosCategoriesAction().then((r) => {
      if (r.ok) setCategories(r.data);
    });
    listPosBrandsAction().then((r) => {
      if (r.ok) setBrands(r.data);
    });
  }, []);

  useEffect(() => {
    setPage(1);
  }, [categorySlug, brandId, search, availableOnly, targetUserId]);

  useEffect(() => {
    startTransition(async () => {
      const r = await browsePosCatalogueAction({
        targetUserId,
        categorySlug: categorySlug || undefined,
        brandId: brandId || undefined,
        search: search || undefined,
        availableOnly: availableOnly === "available",
        page,
        pageSize: PAGE_SIZE,
      });
      if (r.ok) setResult(r.data);
    });
  }, [targetUserId, categorySlug, brandId, search, availableOnly, page, refreshKey]);

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-col gap-3 border-b border-border pb-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search by product name, SKU, or variant SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border-[1.5px] border-border bg-surface py-2.5 pl-9 pr-3.5 text-sm text-ink placeholder:text-gray-400 focus:border-green-600 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <FormSelect
            label=""
            value={categorySlug}
            onChange={(e) => setCategorySlug(e.target.value)}
            className="w-auto min-w-[160px]"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label=""
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            className="w-auto min-w-[160px]"
          >
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </FormSelect>
          <SegmentedToggle
            options={[
              { value: "all", label: "All products" },
              { value: "available", label: "Available only" },
            ]}
            value={availableOnly}
            onChange={setAvailableOnly}
          />
          <span className="ml-auto text-xs font-semibold text-gray-500">
            {result ? `${result.total} product${result.total === 1 ? "" : "s"}` : ""}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isPending && !result && <LoadingState label="Loading products…" />}
        {result && result.cards.length === 0 && (
          <EmptyState
            title="No products match these filters"
            description="Try a different search term, category, or turn off Available only."
          />
        )}
        {result && result.cards.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {result.cards.map((card) => (
              <PosProductCard
                key={card.productId}
                card={card}
                onClick={() => onSelectProduct(card.productId)}
              />
            ))}
          </div>
        )}
      </div>

      {result && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 border-t border-border pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <span className="text-xs font-semibold text-gray-600">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
