"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, EyeOff, MessageSquareText, Star, X } from "lucide-react";
import {
  ActiveFilterSummary,
  AdminDataTable,
  AlertBox,
  Badge,
  ConfirmDialog,
  FilterDrawer,
  FormTextarea,
  IdentityCell,
  RowActionMenu,
  StatusBadge,
  TableFilterDateRange,
  TableFilterSelect,
  Thumbnail,
  Truncate,
  formatDate,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
  type DataTableColumn,
  type RowAction,
} from "@kisan4u/ui";
import type { ReviewModerationStatus } from "@kisan4u/db";
import { moderateReviewAction } from "./actions";

export type ReviewRow = {
  id: string;
  rating: number;
  comment: string | null;
  moderationStatus: ReviewModerationStatus;
  source: "WEBSITE" | "MANUAL_OFFLINE";
  verifiedPurchase: boolean;
  manualCustomerName: string | null;
  moderationNote: string | null;
  sourceReference: string | null;
  createdAt: Date;
  product: { id: string; name: string; primaryImageUrl: string };
  customer: { id: string; name: string } | null;
  orderNumber: string | null;
};

const FILTER_KEYS = ["status", "rating", "verified", "source", "dateFrom", "dateTo"];

function Stars({ rating }: { rating: number }) {
  return (
    <span
      aria-label={`${rating} out of 5 stars`}
      className="inline-flex items-center gap-0.5 text-warning"
    >
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i < rating ? "fill-current" : "fill-none text-border"}`}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

export function ReviewsTable({
  rows,
  total,
  page,
  pageSize,
}: {
  rows: ReviewRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(FILTER_KEYS);
  const [isPending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<{ review: ReviewRow; decision: "REJECT" | "HIDE" } | null>(
    null,
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function moderate(review: ReviewRow, decision: "APPROVE" | "REJECT" | "HIDE", withNote?: string) {
    setError(null);
    startTransition(async () => {
      const result = await moderateReviewAction(review.id, decision, withNote);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirm(null);
      setNote("");
      router.refresh();
    });
  }

  const columns: DataTableColumn<ReviewRow>[] = [
    {
      key: "product",
      header: "Product",
      primary: true,
      value: (r) => r.product.name,
      render: (r) => (
        <div className="flex min-w-0 items-center gap-3">
          <Thumbnail src={r.product.primaryImageUrl} alt="" size="sm" />
          <span className="truncate font-semibold text-ink">{r.product.name}</span>
        </div>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      value: (r) => r.customer?.name ?? r.manualCustomerName ?? "",
      render: (r) =>
        r.customer ? (
          <IdentityCell
            name={r.customer.name}
            subtitle={r.orderNumber ? `Order ${r.orderNumber}` : undefined}
          />
        ) : (
          <IdentityCell
            name={r.manualCustomerName ?? "Unknown"}
            subtitle={r.sourceReference ?? "Manual entry"}
          />
        ),
    },
    {
      key: "rating",
      header: "Rating",
      sortable: true,
      value: (r) => r.rating,
      render: (r) => <Stars rating={r.rating} />,
    },
    {
      key: "comment",
      header: "Comment",
      truncate: true,
      value: (r) => r.comment ?? "",
      render: (r) =>
        r.comment ? (
          <Truncate value={r.comment} maxWidth="260px" className="text-gray-600" />
        ) : (
          <span className="text-gray-400">—</span>
        ),
      mobileHidden: true,
    },
    {
      key: "source",
      header: "Source & verification",
      value: (r) => r.source,
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={r.source === "WEBSITE" ? "info" : "neutral"}>
            {r.source === "WEBSITE" ? "Website" : "Manual/offline"}
          </Badge>
          {r.verifiedPurchase && <Badge tone="success">Verified purchase</Badge>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      value: (r) => r.moderationStatus,
      render: (r) => (
        <div className="flex flex-col gap-1">
          <StatusBadge status={r.moderationStatus} />
          {r.moderationNote && (
            <span className="text-[11px] text-gray-500">{r.moderationNote}</span>
          )}
        </div>
      ),
    },
    {
      key: "createdAt",
      header: "Date",
      sortable: true,
      value: (r) => r.createdAt,
      render: (r) => <span className="text-gray-600">{formatDate(r.createdAt)}</span>,
      hideBelow: "lg",
      mobileHidden: true,
    },
  ];

  function actionsFor(review: ReviewRow): RowAction[] {
    const actions: RowAction[] = [];
    if (review.moderationStatus !== "APPROVED") {
      actions.push({
        label: "Approve",
        icon: <Check className="h-4 w-4" aria-hidden="true" />,
        onClick: () => moderate(review, "APPROVE"),
        disabled: isPending,
      });
    }
    if (review.moderationStatus !== "REJECTED") {
      actions.push({
        label: "Reject",
        icon: <X className="h-4 w-4" aria-hidden="true" />,
        tone: "danger",
        onClick: () => setConfirm({ review, decision: "REJECT" }),
        disabled: isPending,
      });
    }
    if (review.moderationStatus === "APPROVED") {
      actions.push({
        label: "Hide",
        icon: <EyeOff className="h-4 w-4" aria-hidden="true" />,
        tone: "danger",
        onClick: () => setConfirm({ review, decision: "HIDE" }),
        disabled: isPending,
      });
    }
    return actions;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <AlertBox tone="danger">{error}</AlertBox>}
      <AdminDataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.id}
        renderActions={(r) => <RowActionMenu actions={actionsFor(r)} maxInline={1} />}
        caption="Product reviews"
        searchPlaceholder="Search by product, customer, or comment…"
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
              paramKey="status"
              label="Any status"
              options={[
                { value: "PENDING", label: "Pending" },
                { value: "APPROVED", label: "Approved" },
                { value: "REJECTED", label: "Rejected" },
                { value: "HIDDEN", label: "Hidden" },
              ]}
            />
            <TableFilterSelect
              paramKey="rating"
              label="Any rating"
              options={[5, 4, 3, 2, 1].map((n) => ({
                value: String(n),
                label: `${n} star${n === 1 ? "" : "s"}`,
              }))}
            />
            <TableFilterSelect
              paramKey="verified"
              label="Any purchase"
              options={[
                { value: "yes", label: "Verified purchase" },
                { value: "no", label: "Not verified" },
              ]}
            />
            <TableFilterSelect
              paramKey="source"
              label="Any source"
              options={[
                { value: "WEBSITE", label: "Website" },
                { value: "MANUAL_OFFLINE", label: "Manual/offline" },
              ]}
            />
            <TableFilterDateRange fromParamKey="dateFrom" toParamKey="dateTo" label="Date" />
          </FilterDrawer>
        }
        clearFiltersAction={
          <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
        }
        emptyIcon={<MessageSquareText className="h-8 w-8" aria-hidden="true" />}
        emptyTitle="No reviews yet"
      />

      <ConfirmDialog
        open={!!confirm}
        onClose={() => {
          setConfirm(null);
          setNote("");
        }}
        onConfirm={() => confirm && moderate(confirm.review, confirm.decision, note)}
        title={confirm?.decision === "REJECT" ? "Reject this review?" : "Hide this review?"}
        confirmLabel={confirm?.decision === "REJECT" ? "Reject" : "Hide"}
        isPending={isPending}
        description={
          <div className="flex flex-col gap-3">
            <span>
              {confirm?.decision === "REJECT"
                ? "The review stays on record for audit but never appears publicly. This does not change the customer's original comment."
                : "Unpublishes a previously-approved review without marking it as rejected content."}
            </span>
            <FormTextarea
              label="Internal note"
              hint="Optional, admin-only"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </div>
        }
      />
    </div>
  );
}
