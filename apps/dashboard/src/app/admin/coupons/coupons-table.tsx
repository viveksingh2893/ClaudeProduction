"use client";

import { useState } from "react";
import { PlusCircle } from "lucide-react";
import { AdminDataTable, Badge, Button, formatDate, type DataTableColumn } from "@kisan4u/ui";
import { toggleCouponActiveAction } from "./actions";
import { CouponFormModal } from "./coupon-form-modal";

export type CouponRow = {
  id: string;
  code: string;
  audience: "CUSTOMER_ONLY" | "DEALER_ONLY" | "BOTH_CUSTOMER_AND_DEALER";
  discountType: "NONE" | "FLAT" | "PERCENTAGE";
  discountValue: number;
  minPurchase: number;
  maxDiscount: number | null;
  usageLimit: number | null;
  perUserLimit: number | null;
  usageCount: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  createdAt: string;
  redemptionCount: number;
};

const AUDIENCE_LABEL: Record<CouponRow["audience"], string> = {
  CUSTOMER_ONLY: "Customer",
  DEALER_ONLY: "Dealer",
  BOTH_CUSTOMER_AND_DEALER: "Both",
};

function couponStatus(
  row: CouponRow,
): { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" } {
  if (!row.isActive) return { label: "Paused", tone: "neutral" };
  const now = Date.now();
  if (now < new Date(row.startDate).getTime()) return { label: "Upcoming", tone: "info" };
  if (now > new Date(row.endDate).getTime()) return { label: "Expired", tone: "danger" };
  if (row.usageLimit !== null && row.usageCount >= row.usageLimit)
    return { label: "Used up", tone: "warning" };
  return { label: "Active", tone: "success" };
}

export function CouponsTable({ coupons }: { coupons: CouponRow[] }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CouponRow | null>(null);

  const columns: DataTableColumn<CouponRow>[] = [
    {
      key: "code",
      header: "Code",
      primary: true,
      sortable: true,
      value: (c) => c.code,
      render: (c) => <span className="font-mono font-bold text-ink">{c.code}</span>,
    },
    {
      key: "audience",
      header: "Audience",
      value: (c) => AUDIENCE_LABEL[c.audience],
      render: (c) => <span className="text-gray-600">{AUDIENCE_LABEL[c.audience]}</span>,
    },
    {
      key: "discount",
      header: "Discount",
      value: (c) => c.discountValue,
      render: (c) => (
        <span className="font-semibold text-ink">
          {c.discountType === "PERCENTAGE" ? `${c.discountValue}%` : `₹${c.discountValue}`}
          {c.discountType === "PERCENTAGE" && c.maxDiscount !== null && (
            <span className="ml-1 text-xs font-normal text-gray-500">(max ₹{c.maxDiscount})</span>
          )}
        </span>
      ),
    },
    {
      key: "validity",
      header: "Validity",
      sortable: true,
      value: (c) => new Date(c.startDate).getTime(),
      render: (c) => (
        <span className="text-gray-600">
          {formatDate(c.startDate)} – {formatDate(c.endDate)}
        </span>
      ),
    },
    {
      key: "usage",
      header: "Usage",
      value: (c) => c.usageCount,
      render: (c) => (
        <span className="text-gray-600">
          {c.usageCount} / {c.usageLimit ?? "∞"}
          {c.perUserLimit !== null && (
            <span className="ml-1 text-xs text-gray-500">({c.perUserLimit}/user)</span>
          )}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      value: (c) => couponStatus(c).label,
      render: (c) => {
        const s = couponStatus(c);
        return <Badge tone={s.tone}>{s.label}</Badge>;
      },
    },
    {
      key: "createdAt",
      header: "Created",
      sortable: true,
      value: (c) => new Date(c.createdAt).getTime(),
      render: (c) => <span className="text-gray-600">{formatDate(c.createdAt)}</span>,
    },
  ];

  return (
    <>
      <AdminDataTable
        data={coupons}
        columns={columns}
        rowKey={(c) => c.id}
        renderActions={(c) => (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs font-bold text-green-700 hover:underline"
              onClick={() => {
                setEditing(c);
                setModalOpen(true);
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="text-xs font-bold text-gray-600 hover:underline"
              onClick={() => toggleCouponActiveAction({ id: c.id, isActive: !c.isActive })}
            >
              {c.isActive ? "Pause" : "Resume"}
            </button>
          </div>
        )}
        caption="Coupons"
        searchPlaceholder="Search by code…"
        toolbarActions={
          <Button
            type="button"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <PlusCircle className="h-4 w-4" aria-hidden="true" />
            New Coupon
          </Button>
        }
        emptyIcon={<PlusCircle className="h-8 w-8" aria-hidden="true" />}
        emptyTitle="No coupons yet"
        emptyDescription="Click New Coupon to create your first discount code."
      />

      <CouponFormModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        editing={editing}
      />
    </>
  );
}
