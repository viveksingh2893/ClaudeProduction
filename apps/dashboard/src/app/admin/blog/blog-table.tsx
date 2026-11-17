"use client";

import Link from "next/link";
import { PlusCircle } from "lucide-react";
import {
  AdminDataTable,
  FilterDrawer,
  TableFilterSelect,
  ActiveFilterSummary,
  Thumbnail,
  formatDate,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
  type DataTableColumn,
} from "@kisan4u/ui";

export type BlogRow = {
  id: string;
  title: string;
  headerImageUrl: string;
  headerImageAlt: string;
  category: { name: string };
  createdAt: Date | string;
  featuredPosition: number | null;
};

const FILTER_KEYS = ["categoryId", "featured"];

export function BlogTable({
  rows,
  total,
  page,
  pageSize,
  categories,
}: {
  rows: BlogRow[];
  total: number;
  page: number;
  pageSize: number;
  categories: { id: string; name: string }[];
}) {
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(FILTER_KEYS);

  const columns: DataTableColumn<BlogRow>[] = [
    {
      key: "image",
      header: "Image",
      value: () => "",
      render: (b) => <Thumbnail src={b.headerImageUrl} alt={b.headerImageAlt} />,
    },
    {
      key: "title",
      header: "Title",
      primary: true,
      sortable: true,
      value: (b) => b.title,
      render: (b) => <span className="font-semibold text-ink">{b.title}</span>,
    },
    {
      key: "category",
      header: "Category",
      value: (b) => b.category.name,
      render: (b) => <span className="text-gray-600">{b.category.name}</span>,
    },
    {
      key: "createdAt",
      header: "Date created",
      sortable: true,
      value: (b) => new Date(b.createdAt).getTime(),
      render: (b) => <span className="text-gray-600">{formatDate(b.createdAt)}</span>,
    },
    {
      key: "featuredPosition",
      header: "Featured position",
      value: (b) => b.featuredPosition ?? 0,
      render: (b) =>
        b.featuredPosition != null ? (
          <span className="font-semibold text-ink">{b.featuredPosition}</span>
        ) : (
          <span className="text-gray-400">Not featured</span>
        ),
    },
  ];

  return (
    <AdminDataTable
      data={rows}
      columns={columns}
      rowKey={(b) => b.id}
      renderActions={(b) => (
        <Link
          href={`/admin/blog/${b.id}/edit`}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-bold text-green-700 transition-colors hover:bg-green-50"
        >
          Edit
        </Link>
      )}
      caption="Blogs"
      searchPlaceholder="Search by title…"
      server={{
        totalItems: total,
        page,
        pageSize,
        onPageChange: table.setPage,
        onPageSizeChange: table.setPageSize,
        searchValue: table.searchInput,
        onSearchChange: table.setSearchInput,
        onSearchSubmit: table.submitSearch,
        sortKey: table.sortKey,
        sortDir: table.sortDir,
        onSortChange: table.setSort,
      }}
      hasActiveFilters={activeFilterCount > 0}
      filters={
        <FilterDrawer count={activeFilterCount}>
          <TableFilterSelect
            paramKey="categoryId"
            label="Any category"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
          <TableFilterSelect
            paramKey="featured"
            label="Featured or not"
            options={[
              { value: "featured", label: "Featured" },
              { value: "not_featured", label: "Not featured" },
            ]}
          />
        </FilterDrawer>
      }
      clearFiltersAction={
        <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
      }
      toolbarActions={
        <Link
          href="/admin/blog/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-green-700 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-green-800"
        >
          <PlusCircle className="h-4 w-4" aria-hidden="true" />
          Add New Blog
        </Link>
      }
      emptyIcon={<PlusCircle className="h-8 w-8" aria-hidden="true" />}
      emptyTitle="No blogs yet"
      emptyDescription="Click Add New Blog to publish your first post."
    />
  );
}
