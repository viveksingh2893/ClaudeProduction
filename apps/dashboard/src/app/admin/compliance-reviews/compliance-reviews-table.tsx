"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AdminDataTable, Button, StatusBadge, type DataTableColumn } from "@kisan4u/ui";
import { resolveComplianceReviewAction, runExpirySweepAction } from "./actions";

export type ComplianceReviewRow = {
  id: string;
  productId: string;
  productName: string;
  sellerName: string;
  requirementName: string | null;
  reason: string;
  affectedAudience: "CUSTOMER" | "DEALER" | "BOTH";
  detail: string;
  status: "OPEN" | "RESOLVED";
  createdAt: string;
};

export function ComplianceReviewsTable({ rows }: { rows: ComplianceReviewRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const columns: DataTableColumn<ComplianceReviewRow>[] = [
    {
      key: "product",
      header: "Product",
      primary: true,
      value: (r) => r.productName,
      render: (r) => (
        <Link
          href={`/admin/products/${r.productId}`}
          className="font-semibold text-green-700 hover:underline"
        >
          {r.productName}
        </Link>
      ),
    },
    {
      key: "seller",
      header: "Seller",
      value: (r) => r.sellerName,
      render: (r) => <span className="text-gray-600">{r.sellerName}</span>,
    },
    {
      key: "requirement",
      header: "Requirement",
      value: (r) => r.requirementName ?? "",
      render: (r) => <span className="text-gray-600">{r.requirementName ?? "—"}</span>,
    },
    {
      key: "reason",
      header: "Reason",
      value: (r) => r.reason,
      render: (r) => <span className="text-gray-600">{r.reason.replace(/_/g, " ")}</span>,
    },
    {
      key: "audience",
      header: "Audience",
      value: (r) => r.affectedAudience,
      render: (r) => <span className="text-gray-600">{r.affectedAudience}</span>,
    },
    {
      key: "detail",
      header: "Detail",
      value: (r) => r.detail,
      render: (r) => <span className="text-xs text-gray-600">{r.detail}</span>,
    },
    {
      key: "status",
      header: "Status",
      value: (r) => r.status,
      render: (r) =>
        r.status === "OPEN" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={isPending}
            onClick={() =>
              startTransition(async () => {
                await resolveComplianceReviewAction(r.id);
                router.refresh();
              })
            }
          >
            Mark resolved
          </Button>
        ) : (
          <StatusBadge status={r.status} />
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={isPending}
          onClick={() =>
            startTransition(async () => {
              await runExpirySweepAction();
              router.refresh();
            })
          }
        >
          Run expiry check now
        </Button>
      </div>
      <AdminDataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Compliance reviews"
        searchPlaceholder="Search…"
        emptyTitle="No compliance reviews"
      />
    </div>
  );
}
