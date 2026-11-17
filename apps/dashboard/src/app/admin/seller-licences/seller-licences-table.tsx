"use client";

import { Fragment, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ActiveFilterSummary,
  AlertBox,
  Button,
  Card,
  EmptyState,
  FilterDrawer,
  FormInput,
  FormTextarea,
  Modal,
  Pagination,
  RowActionMenu,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableShell,
  TableFilterSelect,
  Truncate,
  formatDate,
  formatDateDDMMYYYY,
  toDateInputValue,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
  type RowAction,
} from "@kisan4u/ui";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock,
  Eye,
  FileText,
  Search,
  Users,
  XCircle,
} from "lucide-react";
import {
  decideSellerLicenceSubmissionAction,
  adminEditSellerLicenceSubmissionAction,
  adminDeleteSellerLicenceSubmissionAction,
  getSellerLicenceRowsForAdminAction,
} from "./actions";
import { AdminLicenceFormModal } from "./admin-licence-form-modal";
import { LicenceDetailModal } from "@/components/licence-detail-modal";
import { CalendarDateField } from "@/components/calendar-date-field";
import type { AdminLicenceKpis, AdminLicenceSellerSummary } from "@kisan4u/catalog";

export type AdminLicenceRow = {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerContactName: string;
  sellerContactEmail: string | null;
  requirementName: string;
  taxonomyPathLabel: string;
  audience: "CUSTOMER" | "DEALER" | "BOTH";
  customerStates: string[];
  dealerStates: string[];
  customerGeoType: "PAN_INDIA" | "STATE_WISE" | null;
  dealerGeoType: "PAN_INDIA" | "STATE_WISE" | null;
  licenceNumber: string;
  expiryDate: string;
  submittedAt: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXPIRED" | "REVOKED";
  rejectionReason: string | null;
  revocationReason: string | null;
  createdByAdmin: boolean;
};

const FILTER_KEYS = ["status", "audience", "coverage", "requirementId"];

/** Coverage reads off the audience-relevant geography — dealer-only rows read dealerGeoType/dealerStates, everything else (CUSTOMER or BOTH) reads customer's. Mirrors the identical rule in packages/catalog/src/licence-queries.ts's coverage filter. */
function coverageLabel(row: AdminLicenceRow): string {
  const geoType = row.audience === "DEALER" ? row.dealerGeoType : row.customerGeoType;
  const states = row.audience === "DEALER" ? row.dealerStates : row.customerStates;
  if (geoType === "PAN_INDIA") return "Pan India";
  if (states.length === 1) return states[0]!;
  if (states.length > 1) return `${states.length} States`;
  return "—";
}

const AVATAR_PALETTE = [
  "bg-teal-100 text-teal-700",
  "bg-orange-100 text-orange-700",
  "bg-purple-100 text-purple-700",
  "bg-green-100 text-green-700",
  "bg-blue-100 text-blue-700",
  "bg-pink-100 text-pink-700",
];

function avatarClass(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function KpiCard({
  icon,
  iconClass,
  label,
  value,
  sublabel,
}: {
  icon: ReactNode;
  iconClass: string;
  label: string;
  value: number;
  sublabel: string;
}) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-gray-500">{label}</div>
        <div className="text-2xl font-extrabold text-ink">{value.toLocaleString("en-IN")}</div>
        <div className="text-[11px] text-gray-400">{sublabel}</div>
      </div>
    </Card>
  );
}

function KpiCardsRow({ kpis }: { kpis: AdminLicenceKpis }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <KpiCard
        icon={<Users className="h-5 w-5" aria-hidden="true" />}
        iconClass="bg-blue-100 text-blue-700"
        label="Total Sellers"
        value={kpis.totalSellers}
        sublabel="All time"
      />
      <KpiCard
        icon={<FileText className="h-5 w-5" aria-hidden="true" />}
        iconClass="bg-indigo-100 text-indigo-700"
        label="Total Licences"
        value={kpis.totalLicences}
        sublabel="All time"
      />
      <KpiCard
        icon={<Clock className="h-5 w-5" aria-hidden="true" />}
        iconClass="bg-amber-100 text-amber-700"
        label="Pending Approval"
        value={kpis.pendingApproval}
        sublabel="Needs review"
      />
      <KpiCard
        icon={<CircleCheck className="h-5 w-5" aria-hidden="true" />}
        iconClass="bg-green-100 text-green-700"
        label="Approved"
        value={kpis.approved}
        sublabel="Active"
      />
      <KpiCard
        icon={<XCircle className="h-5 w-5" aria-hidden="true" />}
        iconClass="bg-red-100 text-red-700"
        label="Rejected"
        value={kpis.rejected}
        sublabel="All time"
      />
      <KpiCard
        icon={<CalendarClock className="h-5 w-5" aria-hidden="true" />}
        iconClass="bg-purple-100 text-purple-700"
        label="Expiring Soon"
        value={kpis.expiringSoon}
        sublabel="Within 30 days"
      />
    </div>
  );
}

function EditModal({ row, onClose }: { row: AdminLicenceRow; onClose: () => void }) {
  const router = useRouter();
  const [licenceNumber, setLicenceNumber] = useState(row.licenceNumber);
  const [expiryDate, setExpiryDate] = useState(toDateInputValue(row.expiryDate));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Modal open onClose={onClose} title={`Edit licence — ${row.requirementName}`}>
      <div className="flex flex-col gap-3">
        <FormInput
          label="Licence number"
          value={licenceNumber}
          onChange={(e) => setLicenceNumber(e.target.value)}
          required
        />
        <CalendarDateField label="Expiry date" value={expiryDate} onChange={setExpiryDate} />
        {error && <AlertBox tone="danger">{error}</AlertBox>}
        <div className="flex gap-2">
          <Button
            type="button"
            loading={isPending}
            onClick={() => {
              setError(null);
              if (!licenceNumber.trim()) return setError("Enter the licence number.");
              if (!expiryDate) return setError("Select an expiry date.");
              startTransition(async () => {
                const result = await adminEditSellerLicenceSubmissionAction(row.id, {
                  licenceNumber,
                  expiryDate,
                });
                if (!result.ok) return setError(result.error);
                router.refresh();
                onClose();
              });
            }}
          >
            Save changes
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DecisionModal({
  row,
  action,
  onClose,
}: {
  row: AdminLicenceRow;
  action: "REJECT" | "REVOKE";
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Modal
      open
      onClose={onClose}
      title={`${action === "REJECT" ? "Reject" : "Revoke"} licence — ${row.requirementName}`}
    >
      <div className="flex flex-col gap-3">
        <FormTextarea
          label="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          required
        />
        {error && <AlertBox tone="danger">{error}</AlertBox>}
        <div className="flex gap-2">
          <Button
            type="button"
            loading={isPending}
            onClick={() => {
              if (!reason.trim()) return setError("A reason is required.");
              startTransition(async () => {
                const result = await decideSellerLicenceSubmissionAction({
                  submissionId: row.id,
                  action,
                  reason,
                });
                if (!result.ok) return setError(result.error);
                router.refresh();
                onClose();
              });
            }}
          >
            Confirm {action === "REJECT" ? "rejection" : "revocation"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteModal({ row, onClose }: { row: AdminLicenceRow; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Modal open onClose={onClose} title={`Delete licence — ${row.requirementName}`}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-600">
          This permanently deletes this {row.status.toLowerCase().replace("_", " ")} licence record
          for {row.sellerName}. It is already inactive and has no effect on the seller's selling
          eligibility, so deleting it changes nothing else. This cannot be undone.
        </p>
        {error && <AlertBox tone="danger">{error}</AlertBox>}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="danger"
            loading={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await adminDeleteSellerLicenceSubmissionAction(row.id);
                if (!result.ok) return setError(result.error);
                router.refresh();
                onClose();
              });
            }}
          >
            Delete permanently
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** One expanded seller's licence table — Sr No-less, matching the reference's Licence/Coverage/Licence #/Issued On/Expiry Date/Status/Actions columns. */
function SellerLicenceRows({
  rows,
  actionsFor,
  onView,
}: {
  rows: AdminLicenceRow[];
  actionsFor: (r: AdminLicenceRow) => RowAction[];
  onView: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const VISIBLE_CAP = 5;
  const visible = showAll ? rows : rows.slice(0, VISIBLE_CAP);
  const hiddenCount = rows.length - visible.length;

  return (
    // Deliberately no `overflow-x-auto` of its own — this renders nested
    // inside the outer seller table's <td>, which already sits inside
    // that table's own overflow-x-auto (see the "hidden md:block
    // overflow-x-auto" wrapper below). A second, independent scroll
    // boundary here would clip anything absolutely-positioned near this
    // sub-table's own right edge (RowActionMenu's kebab dropdown isn't a
    // portal — it clips against its nearest overflow ancestor) even
    // though there's plenty of room in the outer container. Letting the
    // outer wrapper be the only horizontal scroll boundary means the
    // whole grouped table scrolls together on narrow viewports instead of
    // two independently-scrolling regions, which is also just more
    // correct UX.
    <div className="border-y border-green-100 bg-green-50/40">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
            <tr className="text-[11px] font-bold uppercase tracking-wide text-green-800">
              <th className="px-4 py-2 text-left">Licence Name &amp; Type</th>
              <th className="px-4 py-2 text-left">Coverage</th>
              <th className="px-4 py-2 text-left">Licence #</th>
              <th className="px-4 py-2 text-left">Issued On</th>
              <th className="px-4 py-2 text-left">Expiry Date</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-green-100">
            {visible.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5 align-top">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="font-semibold text-ink">
                        {r.requirementName}
                        {r.createdByAdmin && (
                          <span className="ml-1 text-xs font-normal text-gray-400">
                            (admin-added)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{r.taxonomyPathLabel}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 align-top">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                      coverageLabel(r) === "Pan India"
                        ? "bg-blue-50 text-blue-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {coverageLabel(r)}
                  </span>
                </td>
                <td className="px-4 py-2.5 align-top">
                  <Truncate value={r.licenceNumber} maxWidth="120px" className="font-mono text-xs" />
                </td>
                <td className="px-4 py-2.5 align-top text-ink">
                  {formatDateDDMMYYYY(r.submittedAt)}
                </td>
                <td className="px-4 py-2.5 align-top">
                  <div className="text-ink">{formatDateDDMMYYYY(r.expiryDate)}</div>
                  <div className="text-xs text-gray-400">{daysUntil(r.expiryDate)}</div>
                </td>
                <td className="px-4 py-2.5 align-top">
                  <div className="flex flex-col gap-1">
                    <StatusBadge status={r.status} />
                    {(r.rejectionReason || r.revocationReason) && (
                      <span className="text-xs text-danger">
                        {r.rejectionReason ?? r.revocationReason}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 align-top">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => onView(r.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-green-600 px-2.5 py-1 text-xs font-semibold text-green-700 hover:bg-green-50"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Review
                    </button>
                    {actionsFor(r).length > 0 && (
                      <RowActionMenu actions={actionsFor(r)} maxInline={0} />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      {hiddenCount > 0 && (
        <div className="border-t border-green-100 py-2 text-center">
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 hover:underline"
          >
            View all {rows.length} licences <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

function daysUntil(dateIso: string): string {
  const days = Math.ceil((new Date(dateIso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) return `Expired ${Math.abs(days)} days ago`;
  if (days === 0) return "Expires today";
  return `in ${days} days`;
}

type ExpandState = {
  expanded: boolean;
  loading: boolean;
  error: string | null;
  rows: AdminLicenceRow[] | null;
};

export function SellerLicencesAdminTable({
  kpis,
  sellers,
  total,
  page,
  pageSize,
  categories,
  subcategories,
  subSubCategories,
  states,
  allSellers,
  requirements,
}: {
  kpis: AdminLicenceKpis;
  sellers: AdminLicenceSellerSummary[];
  total: number;
  page: number;
  pageSize: number;
  categories: { id: string; name: string }[];
  subcategories: { id: string; name: string; categoryId: string }[];
  subSubCategories: { id: string; name: string; subCategoryId: string }[];
  states: { id: string; name: string }[];
  allSellers: { id: string; shopName: string }[];
  requirements: { id: string; name: string }[];
}) {
  const router = useRouter();
  const table = useAdminTableUrlState({ defaultPageSize: 10 });
  const activeFilterCount = useActiveFilterCount(FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(FILTER_KEYS);
  const [decision, setDecision] = useState<{
    row: AdminLicenceRow;
    action: "REJECT" | "REVOKE";
  } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<AdminLicenceRow | null>(null);
  const [deletingRow, setDeletingRow] = useState<AdminLicenceRow | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expandedBySeller, setExpandedBySeller] = useState<Record<string, ExpandState>>({});

  function fetchSellerRows(sellerId: string) {
    startTransition(async () => {
      const result = await getSellerLicenceRowsForAdminAction(sellerId);
      setExpandedBySeller((prev) => ({
        ...prev,
        [sellerId]: result.ok
          ? { expanded: true, loading: false, error: null, rows: result.data }
          : { expanded: true, loading: false, error: "Could not load this seller's licences.", rows: null },
      }));
    });
  }

  function toggleSeller(sellerId: string) {
    const current = expandedBySeller[sellerId];
    const willExpand = !current?.expanded;
    setExpandedBySeller((prev) => ({
      ...prev,
      [sellerId]: {
        expanded: willExpand,
        loading: willExpand && !current?.rows,
        error: null,
        rows: current?.rows ?? null,
      },
    }));
    if (willExpand && !current?.rows) fetchSellerRows(sellerId);
  }

  /** Re-fetches one seller's expanded licence list (after an action changes it) and refreshes the page's own server-fetched summaries/KPIs. */
  function refreshAfterAction(sellerId: string) {
    router.refresh();
    if (expandedBySeller[sellerId]?.expanded) fetchSellerRows(sellerId);
  }

  function approve(row: AdminLicenceRow) {
    setError(null);
    startTransition(async () => {
      const result = await decideSellerLicenceSubmissionAction({
        submissionId: row.id,
        action: "APPROVE",
      });
      if (!result.ok) return setError(result.error);
      refreshAfterAction(row.sellerId);
    });
  }

  /**
   * Every status gets Review + kebab menu (spec §6: "Rejected and expired
   * licences must still have View and History actions"). Edit is
   * available on the still-relevant statuses (pending/approved), not on
   * terminal ones (rejected/expired/revoked), since a rejected/expired/
   * revoked submission's compliance evidence should stay exactly as
   * originally submitted — a seller who wants to fix it resubmits a new
   * revision instead.
   */
  function actionsFor(r: AdminLicenceRow): RowAction[] {
    const actions: RowAction[] = [];
    if (r.status === "PENDING_APPROVAL") {
      actions.push({ label: "Approve", onClick: () => approve(r), disabled: isPending });
      actions.push({
        label: "Reject",
        onClick: () => setDecision({ row: r, action: "REJECT" }),
        disabled: isPending,
      });
      actions.push({ label: "Edit", onClick: () => setEditingRow(r), disabled: isPending });
    }
    if (r.status === "APPROVED") {
      actions.push({ label: "Edit", onClick: () => setEditingRow(r), disabled: isPending });
      actions.push({
        label: "Revoke",
        onClick: () => setDecision({ row: r, action: "REVOKE" }),
        disabled: isPending,
      });
    }
    if (r.status === "REJECTED" || r.status === "EXPIRED" || r.status === "REVOKED") {
      actions.push({
        label: "Delete",
        onClick: () => setDeletingRow(r),
        disabled: isPending,
        tone: "danger",
      });
    }
    return actions;
  }

  // The Edit/Decision/Delete modals close over whichever row triggered
  // them, sourced from a per-seller expanded list — refresh that same
  // seller's rows (not just router.refresh()) once the modal's own
  // onClose fires, so the newly-changed status is visible without having
  // to collapse and re-expand the row.
  function withRefresh<T extends { sellerId: string }>(row: T, onClose: () => void) {
    return () => {
      onClose();
      refreshAfterAction(row.sellerId);
    };
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-4">
      {error && <AlertBox tone="danger">{error}</AlertBox>}

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1" />
        <Button type="button" onClick={() => setAddOpen(true)}>
          Add licence for seller
        </Button>
      </div>

      <KpiCardsRow kpis={kpis} />

      <TableShell
        toolbar={
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <div className="relative min-w-[240px] flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={table.searchInput}
                onChange={(e) => table.setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") table.submitSearch();
                }}
                placeholder="Search by seller name, email, or licence number…"
                aria-label="Search by seller name, email, or licence number"
                className="w-full rounded-md border-[1.5px] border-border py-2 pl-9 pr-3 text-sm text-ink outline-none transition-colors focus:border-green-600"
              />
            </div>
            <FilterDrawer count={activeFilterCount}>
              <TableFilterSelect
                paramKey="status"
                label="Any status"
                options={[
                  { value: "PENDING_APPROVAL", label: "Pending approval" },
                  { value: "APPROVED", label: "Approved / Active" },
                  { value: "REJECTED", label: "Rejected" },
                  { value: "EXPIRED", label: "Expired" },
                  { value: "REVOKED", label: "Revoked" },
                ]}
              />
              <TableFilterSelect
                paramKey="requirementId"
                label="Any licence type"
                options={requirements.map((r) => ({ value: r.id, label: r.name }))}
              />
              <TableFilterSelect
                paramKey="coverage"
                label="Any coverage"
                options={[
                  { value: "PAN_INDIA", label: "Pan India" },
                  { value: "STATE_WISE", label: "State-wise" },
                ]}
              />
              <TableFilterSelect
                paramKey="audience"
                label="Any audience"
                options={[
                  { value: "CUSTOMER", label: "Customer" },
                  { value: "DEALER", label: "Dealer" },
                  { value: "BOTH", label: "Customer & Dealer" },
                ]}
              />
            </FilterDrawer>
            <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
            <span className="text-xs font-medium text-gray-600" role="status" aria-live="polite">
              {total} {total === 1 ? "seller" : "sellers"}
            </span>
          </div>
        }
      >
        {sellers.length === 0 ? (
          <EmptyState
            title="No sellers found"
            description="Nothing matches your search and filters. Try a different term or clear filters."
          />
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell className="w-10" />
                    <TableHeaderCell>Seller</TableHeaderCell>
                    <TableHeaderCell align="right">Total Licences</TableHeaderCell>
                    <TableHeaderCell align="right">Pending</TableHeaderCell>
                    <TableHeaderCell align="right">Approved</TableHeaderCell>
                    <TableHeaderCell align="right">Rejected</TableHeaderCell>
                    <TableHeaderCell align="right">Expiring Soon</TableHeaderCell>
                    <TableHeaderCell>Last Updated</TableHeaderCell>
                    <TableHeaderCell align="right">Actions</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {sellers.map((s) => {
                    const expand = expandedBySeller[s.sellerId];
                    return (
                      <Fragment key={s.sellerId}>
                        <TableRow>
                          <TableCell>
                            <button
                              type="button"
                              onClick={() => toggleSeller(s.sellerId)}
                              aria-label={expand?.expanded ? "Collapse" : "Expand"}
                              aria-expanded={!!expand?.expanded}
                              className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-gray-500 hover:bg-green-50"
                            >
                              {expand?.expanded ? (
                                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                            </button>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div
                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarClass(s.sellerId)}`}
                                aria-hidden="true"
                              >
                                {initials(s.shopName)}
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-ink">{s.shopName}</div>
                                <div className="truncate text-xs text-gray-500">
                                  {s.contactEmail ?? "—"}
                                </div>
                                <div className="text-xs text-gray-400">
                                  Joined on {formatDateDDMMYYYY(s.joinedAt)}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell align="right">
                            <span className="font-semibold text-ink">{s.totalLicences}</span>
                          </TableCell>
                          <TableCell align="right">
                            <span
                              className={s.pending > 0 ? "font-semibold text-amber-600" : "text-gray-400"}
                            >
                              {s.pending}
                            </span>
                          </TableCell>
                          <TableCell align="right">
                            <span
                              className={s.approved > 0 ? "font-semibold text-green-700" : "text-gray-400"}
                            >
                              {s.approved}
                            </span>
                          </TableCell>
                          <TableCell align="right">
                            <span
                              className={s.rejected > 0 ? "font-semibold text-danger" : "text-gray-400"}
                            >
                              {s.rejected}
                            </span>
                          </TableCell>
                          <TableCell align="right">
                            <span
                              className={
                                s.expiringSoon > 0 ? "font-semibold text-purple-700" : "text-gray-400"
                              }
                            >
                              {s.expiringSoon}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-gray-600">
                              {s.lastUpdated ? formatDate(s.lastUpdated, true) : "—"}
                            </span>
                          </TableCell>
                          <TableCell align="right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button variant="outline" size="sm" onClick={() => toggleSeller(s.sellerId)}>
                                View Details
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        {expand?.expanded && (
                          <tr>
                            <td colSpan={9} className="p-0">
                              {expand.loading && (
                                <div className="border-y border-green-100 bg-green-50/40 p-4 text-sm text-gray-500">
                                  Loading licences…
                                </div>
                              )}
                              {expand.error && (
                                <div className="border-y border-green-100 bg-green-50/40 p-4">
                                  <AlertBox tone="danger">{expand.error}</AlertBox>
                                </div>
                              )}
                              {expand.rows && (
                                <SellerLicenceRows
                                  rows={expand.rows}
                                  actionsFor={actionsFor}
                                  onView={setViewingId}
                                />
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: card list instead of a 9-column table. */}
            <ul className="divide-y divide-border md:hidden">
              {sellers.map((s) => {
                const expand = expandedBySeller[s.sellerId];
                return (
                  <li key={s.sellerId} className="flex flex-col gap-2 px-4 py-3.5">
                    <button
                      type="button"
                      onClick={() => toggleSeller(s.sellerId)}
                      className="flex items-center gap-3 text-left"
                    >
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarClass(s.sellerId)}`}
                        aria-hidden="true"
                      >
                        {initials(s.shopName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-ink">{s.shopName}</div>
                        <div className="truncate text-xs text-gray-500">{s.contactEmail ?? "—"}</div>
                      </div>
                      {expand?.expanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                      )}
                    </button>
                    <dl className="grid grid-cols-3 gap-x-2 gap-y-1 pl-12 text-xs">
                      <div>
                        <dt className="text-gray-400">Total</dt>
                        <dd className="font-semibold text-ink">{s.totalLicences}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-400">Pending</dt>
                        <dd className="font-semibold text-ink">{s.pending}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-400">Approved</dt>
                        <dd className="font-semibold text-ink">{s.approved}</dd>
                      </div>
                    </dl>
                    {expand?.expanded && (
                      <div className="-mx-4">
                        {expand.loading && (
                          <div className="bg-green-50/40 p-4 text-sm text-gray-500">
                            Loading licences…
                          </div>
                        )}
                        {expand.error && (
                          <div className="bg-green-50/40 p-4">
                            <AlertBox tone="danger">{expand.error}</AlertBox>
                          </div>
                        )}
                        {expand.rows && (
                          <SellerLicenceRows
                            rows={expand.rows}
                            actionsFor={actionsFor}
                            onView={setViewingId}
                          />
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <Pagination
              page={page}
              totalPages={totalPages}
              pageSize={pageSize}
              totalItems={total}
              pageSizeOptions={[10, 20, 50]}
              onPageChange={table.setPage}
              onPageSizeChange={table.setPageSize}
            />
          </>
        )}
      </TableShell>

      {decision && (
        <DecisionModal
          row={decision.row}
          action={decision.action}
          onClose={withRefresh(decision.row, () => setDecision(null))}
        />
      )}
      {editingRow && (
        <EditModal row={editingRow} onClose={withRefresh(editingRow, () => setEditingRow(null))} />
      )}
      {deletingRow && (
        <DeleteModal row={deletingRow} onClose={withRefresh(deletingRow, () => setDeletingRow(null))} />
      )}
      {viewingId && (
        <LicenceDetailModal submissionId={viewingId} onClose={() => setViewingId(null)} />
      )}
      <AdminLicenceFormModal
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          router.refresh();
          setExpandedBySeller({});
        }}
        categories={categories}
        subcategories={subcategories}
        subSubCategories={subSubCategories}
        states={states}
        sellers={allSellers}
      />
    </div>
  );
}
