"use client";

import { useMemo, useState } from "react";
import {
  AdminDataTable,
  Button,
  StatusBadge,
  Truncate,
  formatDateDDMMYYYY,
  type DataTableColumn,
} from "@kisan4u/ui";
import { FileText, Plus } from "lucide-react";
import { LicenceFormModal } from "./licence-form-modal";
import { LicenceDetailModal } from "@/components/licence-detail-modal";

export type SellerLicenceRow = {
  id: string;
  requirementName: string;
  taxonomyPathLabel: string;
  source: string;
  audience: "CUSTOMER" | "DEALER" | "BOTH";
  geoLabel: string;
  licenceNumber: string;
  expiryDate: string;
  submittedAt: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXPIRED" | "REVOKED";
  rejectionReason: string | null;
  revocationReason: string | null;
  requirementId: string;
  taxonomyNodeType: "CATEGORY" | "SUBCATEGORY" | "SUBSUBCATEGORY";
  taxonomyNodeId: string;
};

const STATUS_LABEL: Record<SellerLicenceRow["status"], string> = {
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved / Active",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  REVOKED: "Revoked",
};

export function SellerLicencesTable({
  rows,
  categories,
  subcategories,
  subSubCategories,
  states,
}: {
  rows: SellerLicenceRow[];
  categories: { id: string; name: string }[];
  subcategories: { id: string; name: string; categoryId: string }[];
  subSubCategories: { id: string; name: string; subCategoryId: string }[];
  states: { id: string; name: string }[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [resubmitRow, setResubmitRow] = useState<SellerLicenceRow | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  const summary = useMemo(() => {
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    return {
      active: rows.filter((r) => r.status === "APPROVED" && new Date(r.expiryDate).getTime() > now)
        .length,
      pending: rows.filter((r) => r.status === "PENDING_APPROVAL").length,
      rejected: rows.filter((r) => r.status === "REJECTED").length,
      expiringSoon: rows.filter(
        (r) =>
          r.status === "APPROVED" &&
          new Date(r.expiryDate).getTime() - now <= thirtyDays &&
          new Date(r.expiryDate).getTime() > now,
      ).length,
      expired: rows.filter((r) => r.status === "EXPIRED").length,
    };
  }, [rows]);

  const visible = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows;

  const columns: DataTableColumn<SellerLicenceRow>[] = [
    {
      key: "name",
      header: "Licence",
      primary: true,
      sortable: true,
      value: (r) => r.requirementName,
      render: (r) => (
        <div>
          <div className="font-semibold text-ink">{r.requirementName}</div>
          <div className="text-xs text-gray-500">{r.taxonomyPathLabel}</div>
        </div>
      ),
    },
    {
      key: "audience",
      header: "Audience",
      value: (r) => r.audience,
      render: (r) => (
        <span className="text-gray-600">
          {r.audience === "BOTH"
            ? "Customer & Dealer"
            : r.audience === "CUSTOMER"
              ? "Customer"
              : "Dealer"}
        </span>
      ),
    },
    {
      key: "geo",
      header: "Coverage",
      value: (r) => r.geoLabel,
      render: (r) => <span className="text-gray-600">{r.geoLabel}</span>,
    },
    {
      key: "number",
      header: "Licence #",
      value: (r) => r.licenceNumber,
      render: (r) => (
        <Truncate value={r.licenceNumber} maxWidth="140px" className="font-mono text-xs" />
      ),
    },
    {
      key: "expiry",
      header: "Expiry",
      sortable: true,
      value: (r) => r.expiryDate,
      render: (r) => <span className="text-gray-600">{formatDateDDMMYYYY(r.expiryDate)}</span>,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      value: (r) => r.status,
      render: (r) => (
        <div className="flex flex-col gap-1">
          <StatusBadge status={r.status} />
          {(r.rejectionReason || r.revocationReason) && (
            <span className="text-xs text-danger">{r.rejectionReason ?? r.revocationReason}</span>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      value: () => "",
      render: (r) => (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setViewingId(r.id)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 hover:underline"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" /> View document
          </button>
          {(r.status === "REJECTED" || r.status === "EXPIRED" || r.status === "APPROVED") && (
            <button
              type="button"
              className="text-left text-xs font-semibold text-green-700 hover:underline"
              onClick={() => setResubmitRow(r)}
            >
              {r.status === "APPROVED" ? "Renew" : "Edit & resubmit"}
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(
          [
            ["Active", summary.active, "text-success"],
            ["Pending", summary.pending, "text-warning"],
            ["Rejected", summary.rejected, "text-danger"],
            ["Expiring soon", summary.expiringSoon, "text-warning"],
            ["Expired", summary.expired, "text-danger"],
          ] as const
        ).map(([label, count, cls]) => (
          <div key={label} className="rounded-lg border border-border bg-surface p-3 text-center">
            <div className={`text-xl font-extrabold ${cls}`}>{count}</div>
            <div className="text-xs text-gray-500">{label}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border-[1.5px] border-border px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button type="button" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add New Licence
        </Button>
      </div>

      <AdminDataTable
        data={visible}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Selling licences"
        searchPlaceholder="Search licences…"
        emptyTitle="No selling licences yet"
        emptyDescription="Add your first licence using the button above."
      />

      <LicenceFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        categories={categories}
        subcategories={subcategories}
        subSubCategories={subSubCategories}
        states={states}
      />
      {resubmitRow && (
        <LicenceFormModal
          open={resubmitRow !== null}
          onClose={() => setResubmitRow(null)}
          categories={categories}
          subcategories={subcategories}
          subSubCategories={subSubCategories}
          states={states}
          resubmitFor={{
            submissionId: resubmitRow.id,
            requirementId: resubmitRow.requirementId,
            nodeType: resubmitRow.taxonomyNodeType,
            nodeId: resubmitRow.taxonomyNodeId,
            audience: resubmitRow.audience,
          }}
        />
      )}
      {viewingId && (
        <LicenceDetailModal submissionId={viewingId} onClose={() => setViewingId(null)} />
      )}
    </div>
  );
}
