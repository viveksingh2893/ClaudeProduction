"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock3, IndianRupee, ShieldAlert, Users } from "lucide-react";
import {
  AdminDataTable,
  AlertBox,
  Badge,
  Button,
  FormInput,
  IdentityCell,
  Modal,
  formatCurrency,
  type DataTableColumn,
} from "@kisan4u/ui";
import { StatCard, StatCardsRow } from "@/components/admin/stat-cards";
import { buildBaBatchAction, markBaBatchPaidAction, discardBaBatchAction } from "./actions";

type Row = {
  baId: string;
  referralCode: string;
  name: string;
  status: string;
  hasBankDetails: boolean;
  eligibleUnbatched: number;
  batchedPending: number;
  paid: number;
  settlementId: string | null;
  settlementStatus: string | null;
};
type Overview = {
  monthKey: string;
  monthLabel: string;
  cycles: { key: string; label: string }[];
  rows: Row[];
  totals: { eligibleUnbatched: number; batchedPending: number; paid: number };
};

type Feedback = { tone: "success" | "danger"; text: string };

/** A money column: right-aligned, and a zero reads as a quiet dash instead of a wall of ₹0.00. */
function Money({ value, emphasis }: { value: number; emphasis?: boolean }) {
  if (value <= 0) return <span className="text-gray-300">—</span>;
  return <span className={emphasis ? "font-bold text-ink" : "text-ink"}>{formatCurrency(value)}</span>;
}

function BatchBadge({ status }: { status: string | null }) {
  if (status === "PAID") return <Badge tone="success">Paid</Badge>;
  if (status === "PENDING") return <Badge tone="warning">Awaiting transfer</Badge>;
  if (status) return <Badge tone="neutral">{status}</Badge>;
  return <span className="text-gray-300">—</span>;
}

export function BaSettlementsClient({ overview }: { overview: Overview }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, start] = useTransition();
  const [payTarget, setPayTarget] = useState<Row | null>(null);
  const [discardTarget, setDiscardTarget] = useState<Row | null>(null);
  const [reference, setReference] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, successText: string, after?: () => void) => {
    setFeedback(null);
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setFeedback({ tone: "success", text: successText });
        after?.();
        router.refresh();
      } else {
        setFeedback({ tone: "danger", text: r.error ?? "Something went wrong." });
      }
    });
  };

  const needsBank = overview.rows.filter(
    (r) => !r.hasBankDetails && (r.eligibleUnbatched > 0 || r.batchedPending > 0),
  ).length;

  const columns: DataTableColumn<Row>[] = [
    {
      key: "name",
      header: "Business Associate",
      primary: true,
      sortable: true,
      value: (r) => r.name,
      render: (r) => (
        <Link href={`/admin/business-associates/${r.baId}`} className="hover:underline">
          <IdentityCell name={r.name} subtitle={r.referralCode} />
        </Link>
      ),
    },
    {
      key: "bank",
      header: "Bank details",
      value: (r) => (r.hasBankDetails ? 1 : 0),
      sortable: true,
      render: (r) =>
        r.hasBankDetails ? (
          <Badge tone="success">On file</Badge>
        ) : (
          <Badge tone="warning">
            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
            Pending
          </Badge>
        ),
    },
    {
      key: "eligible",
      header: "Eligible",
      align: "right",
      sortable: true,
      value: (r) => r.eligibleUnbatched,
      render: (r) => <Money value={r.eligibleUnbatched} emphasis />,
    },
    {
      key: "batched",
      header: "Batched",
      align: "right",
      sortable: true,
      value: (r) => r.batchedPending,
      render: (r) => <Money value={r.batchedPending} />,
    },
    {
      key: "paid",
      header: "Paid",
      align: "right",
      sortable: true,
      value: (r) => r.paid,
      render: (r) => <Money value={r.paid} />,
    },
    {
      key: "batch",
      header: "Batch status",
      value: (r) => r.settlementStatus ?? "",
      sortable: true,
      render: (r) => <BatchBadge status={r.settlementStatus} />,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <StatCardsRow>
        <StatCard
          icon={<IndianRupee className="h-5 w-5" aria-hidden="true" />}
          label="Eligible to batch"
          value={formatCurrency(overview.totals.eligibleUnbatched)}
          hint="Earned, not yet in a batch"
          tone="green"
        />
        <StatCard
          icon={<Clock3 className="h-5 w-5" aria-hidden="true" />}
          label="Awaiting transfer"
          value={formatCurrency(overview.totals.batchedPending)}
          hint="In a batch, not yet paid"
          tone="amber"
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
          label="Paid"
          value={formatCurrency(overview.totals.paid)}
          hint={overview.monthLabel}
          tone="blue"
        />
        <StatCard
          icon={<Users className="h-5 w-5" aria-hidden="true" />}
          label="Business Associates"
          value={overview.rows.length}
          hint={needsBank > 0 ? `${needsBank} still need bank details` : "All payable"}
          tone={needsBank > 0 ? "red" : "neutral"}
          valueTone="neutral"
        />
      </StatCardsRow>

      {feedback && <AlertBox tone={feedback.tone}>{feedback.text}</AlertBox>}

      <AdminDataTable
        data={overview.rows}
        columns={columns}
        rowKey={(r) => r.baId}
        caption="Business Associate settlements"
        searchPlaceholder="Search by name or referral code…"
        defaultPageSize={20}
        toolbarActions={
          <label className="flex items-center gap-2 text-sm text-gray-500">
            Cycle
            <select
              value={overview.monthKey}
              onChange={(e) => router.push(`/admin/ba-settlements?month=${e.target.value}`)}
              className="rounded-md border border-border bg-surface px-2.5 py-2 text-sm font-semibold text-ink"
            >
              {overview.cycles.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        }
        renderActions={(r) => (
          <div className="flex items-center justify-end gap-2">
            {!r.settlementId && r.hasBankDetails && r.eligibleUnbatched > 0 && (
              <Button
                size="sm"
                variant="primary"
                disabled={pending}
                onClick={() =>
                  run(() => buildBaBatchAction(r.baId, overview.monthKey), `Batch built for ${r.name}.`)
                }
              >
                Build batch
              </Button>
            )}
            {!r.settlementId && !r.hasBankDetails && r.eligibleUnbatched > 0 && (
              <span className="text-[11px] text-gray-500">Needs bank details</span>
            )}
            {r.settlementId && r.settlementStatus === "PENDING" && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => {
                    setReference("");
                    setPayTarget(r);
                  }}
                >
                  Mark paid
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setDiscardTarget(r)}
                >
                  Discard
                </Button>
              </>
            )}
          </div>
        )}
        emptyIcon={<Users className="h-8 w-8" aria-hidden="true" />}
        emptyTitle="Nothing to settle for this cycle"
        emptyDescription="Business Associates appear here once they have an eligible or batched earning up to this cycle."
      />

      <Modal
        open={payTarget !== null}
        onClose={() => setPayTarget(null)}
        title="Mark batch as paid"
        className="max-w-md"
      >
        {payTarget && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600">
              Confirm you have transferred <strong className="text-ink">{formatCurrency(payTarget.batchedPending)}</strong>{" "}
              to <strong className="text-ink">{payTarget.name}</strong> ({payTarget.referralCode}). This
              settles every earning in the batch.
            </p>
            <FormInput
              label="Transfer reference / note (optional)"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. UTR number"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPayTarget(null)} disabled={pending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={pending}
                onClick={() => {
                  const target = payTarget;
                  run(
                    () => markBaBatchPaidAction(target.settlementId!, reference.trim() || undefined),
                    `Marked ${target.name}'s batch as paid.`,
                    () => setPayTarget(null),
                  );
                }}
              >
                Mark paid
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={discardTarget !== null}
        onClose={() => setDiscardTarget(null)}
        title="Discard this batch?"
        className="max-w-md"
      >
        {discardTarget && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600">
              The pending batch for <strong className="text-ink">{discardTarget.name}</strong> (
              {formatCurrency(discardTarget.batchedPending)}) is removed and its earnings go back to
              eligible, ready to be batched again.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDiscardTarget(null)} disabled={pending}>
                Keep batch
              </Button>
              <Button
                variant="danger"
                loading={pending}
                onClick={() => {
                  const target = discardTarget;
                  run(
                    () => discardBaBatchAction(target.settlementId!),
                    `Discarded ${target.name}'s batch.`,
                    () => setDiscardTarget(null),
                  );
                }}
              >
                Discard batch
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
