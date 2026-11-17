import type { ReactNode } from "react";

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
  neutral: "bg-border text-gray-600",
};

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-bold leading-none ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * One tone lookup shared by every status enum in the Prisma schema
 * (OrderStatus, PaymentStatus, ApplicationStatus, ProductLifecycleStatus,
 * SellerProductRequestStatus, ShipmentStatus). The enums never collide on
 * meaning for a shared key — e.g. PENDING/CANCELLED/APPROVED/REJECTED mean
 * the same "in progress / stopped / accepted / declined" thing regardless
 * of which status this happens to be — so one flat map is enough instead
 * of one per enum.
 */
const STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: "warning",
  PENDING_PAYMENT: "warning",
  PAYMENT_PARTIALLY_RECEIVED: "warning",
  PARTIALLY_PAID: "warning",
  SUBMITTED: "warning",
  CANCELLATION_REQUESTED: "warning",
  RETURN_REQUESTED: "warning",
  REFUND_INITIATED: "warning",
  REFUND_PENDING: "warning",
  RTO_INITIATED: "warning",

  CONFIRMED: "info",
  SELLER_ACCEPTED: "info",
  PACKED: "info",
  PICKUP_SCHEDULED: "info",
  PICKED_UP: "info",
  IN_TRANSIT: "info",
  VIEWED: "info",
  RETURN_APPROVED: "info",
  REPLACEMENT_APPROVED: "info",
  REPLACEMENT_DISPATCHED: "info",
  REFUNDED: "info",

  DELIVERED: "success",
  PAID: "success",
  APPROVED: "success",
  RESPONDED: "success",
  REFUND_COMPLETED: "success",

  DELIVERY_FAILED: "danger",
  CANCELLED: "danger",
  REJECTED: "danger",
  SUSPENDED: "danger",
  FAILED: "danger",
  RETURN_REJECTED: "danger",
  RTO_DELIVERED_TO_SELLER: "danger",

  CREATED: "neutral",
  CLOSED: "neutral",
  INACTIVE: "neutral",
  DRAFT: "neutral",

  // ReviewModerationStatus.HIDDEN — was public, later unpublished without
  // being a content rejection (see ProductReview's schema doc comment).
  HIDDEN: "warning",

  // SettlementStatus (see packages/db/prisma/schema.prisma) — PENDING and
  // FAILED already share the tones above, only the settlement-specific
  // values need their own entries.
  ON_HOLD: "warning",
  ELIGIBLE: "info",
  PROCESSING: "info",
  SETTLED: "success",
  PARTIALLY_SETTLED: "warning",
  REVERSED: "danger",
  NEEDS_REVIEW: "danger",
};

function humanize(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Renders any Prisma status enum value as a color-coded pill. Pass `label` to reuse an existing human-readable label map instead of auto-humanizing. */
export function StatusBadge({
  status,
  label,
  className = "",
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return (
    <Badge tone={tone} className={className}>
      {label ?? humanize(status)}
    </Badge>
  );
}

/** Yes/No-style boolean cell for "is active" flags — same pill language as StatusBadge so active/inactive reads consistently next to real status enums. */
export function ActiveBadge({
  active,
  activeLabel = "Active",
  inactiveLabel = "Inactive",
}: {
  active: boolean;
  activeLabel?: string;
  inactiveLabel?: string;
}) {
  return (
    <Badge tone={active ? "success" : "danger"}>{active ? activeLabel : inactiveLabel}</Badge>
  );
}
