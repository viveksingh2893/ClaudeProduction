"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertBox, Button, FormInput, FormSelect, Modal } from "@kisan4u/ui";
import { ChevronDown } from "lucide-react";
import {
  createSellerLicenceSubmissionAction,
  resubmitSellerLicenceSubmissionAction,
} from "./actions";
import { getActiveRequirementsForNodeAction } from "./taxonomy-actions";
import { LicenceDocumentInput } from "@/components/licence-document-input";
import { CalendarDateField } from "@/components/calendar-date-field";

type TaxonomyNodeType = "CATEGORY" | "SUBCATEGORY" | "SUBSUBCATEGORY";
type GeoType = "PAN_INDIA" | "STATE_WISE";

type RequirementOption = {
  requirement: {
    id: string;
    name: string;
    customerRequired: boolean;
    customerGeoType: GeoType | null;
    dealerRequired: boolean;
    dealerGeoType: GeoType | null;
    sameLicenceForBothAudiences: boolean;
  };
  source: "CATEGORY" | "SUBCATEGORY" | "SUBSUBCATEGORY";
};

export function LicenceFormModal({
  open,
  onClose,
  categories,
  subcategories,
  subSubCategories,
  states,
  resubmitFor,
}: {
  open: boolean;
  onClose: () => void;
  categories: { id: string; name: string }[];
  subcategories: { id: string; name: string; categoryId: string }[];
  subSubCategories: { id: string; name: string; subCategoryId: string }[];
  states: { id: string; name: string }[];
  /** Present when this modal is being used for "edit and resubmit" / "renew" rather than a brand-new submission. */
  resubmitFor?: {
    submissionId: string;
    requirementId: string;
    nodeType: TaxonomyNodeType;
    nodeId: string;
    audience: "CUSTOMER" | "DEALER" | "BOTH";
  };
}) {
  const [nodeType, setNodeType] = useState<TaxonomyNodeType>(resubmitFor?.nodeType ?? "CATEGORY");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [subCategoryId, setSubCategoryId] = useState("");
  const [subSubCategoryId, setSubSubCategoryId] = useState("");
  const [requirements, setRequirements] = useState<RequirementOption[]>([]);
  const [requirementId, setRequirementId] = useState("");
  const [audience, setAudience] = useState<"CUSTOMER" | "DEALER" | "BOTH">("CUSTOMER");
  const [customerStateId, setCustomerStateId] = useState("");
  const [dealerStateId, setDealerStateId] = useState("");
  const [licenceNumber, setLicenceNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const nodeId =
    nodeType === "CATEGORY"
      ? categoryId
      : nodeType === "SUBCATEGORY"
        ? subCategoryId
        : subSubCategoryId;
  const selectedRequirement =
    requirements.find((r) => r.requirement.id === requirementId)?.requirement ?? null;

  const subcategoryOptions = useMemo(
    () => subcategories.filter((s) => s.categoryId === categoryId),
    [subcategories, categoryId],
  );
  const subSubCategoryOptions = useMemo(
    () => subSubCategories.filter((s) => s.subCategoryId === subCategoryId),
    [subSubCategories, subCategoryId],
  );

  useEffect(() => {
    if (!open || !nodeId) return;
    getActiveRequirementsForNodeAction(nodeType, nodeId).then((result) => {
      if (result.ok) setRequirements(result.data as RequirementOption[]);
    });
  }, [open, nodeType, nodeId]);

  useEffect(() => {
    if (!selectedRequirement) return;
    if (selectedRequirement.sameLicenceForBothAudiences) setAudience("BOTH");
    else if (selectedRequirement.customerRequired && !selectedRequirement.dealerRequired)
      setAudience("CUSTOMER");
    else if (!selectedRequirement.customerRequired && selectedRequirement.dealerRequired)
      setAudience("DEALER");
  }, [selectedRequirement]);

  function reset() {
    setNodeType("CATEGORY");
    setCategoryId(categories[0]?.id ?? "");
    setSubCategoryId("");
    setSubSubCategoryId("");
    setRequirements([]);
    setRequirementId("");
    setAudience("CUSTOMER");
    setCustomerStateId("");
    setDealerStateId("");
    setLicenceNumber("");
    setExpiryDate("");
    setFile(null);
    setError(null);
  }

  function handleSubmit() {
    setError(null);
    if (!requirementId) return setError("Select a licence requirement.");
    if (!licenceNumber.trim()) return setError("Enter the licence number.");
    if (!expiryDate) return setError("Select an expiry date.");
    if (!file) return setError("Upload the licence document.");

    const needsCustomerStates =
      (audience === "CUSTOMER" || audience === "BOTH") &&
      selectedRequirement?.customerGeoType === "STATE_WISE";
    const needsDealerStates =
      (audience === "DEALER" || audience === "BOTH") &&
      selectedRequirement?.dealerGeoType === "STATE_WISE";
    if (needsCustomerStates && !customerStateId)
      return setError("Select the state for Customer coverage.");
    if (needsDealerStates && !dealerStateId)
      return setError("Select the state for Dealer coverage.");

    const formData = new FormData();
    formData.set("requirementId", requirementId);
    formData.set("audience", audience);
    formData.set("licenceNumber", licenceNumber);
    formData.set("expiryDate", expiryDate);
    if (needsCustomerStates && customerStateId)
      formData.append("customerStateIds", customerStateId);
    if (needsDealerStates && dealerStateId) formData.append("dealerStateIds", dealerStateId);
    formData.set("document", file);

    startTransition(async () => {
      const result = resubmitFor
        ? await resubmitSellerLicenceSubmissionAction(resubmitFor.submissionId, formData)
        : await createSellerLicenceSubmissionAction(formData);
      if (!result.ok) return setError(result.error);
      reset();
      onClose();
    });
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={resubmitFor ? "Resubmit selling licence" : "Add new selling licence"}
      className="max-w-xl"
    >
      <div className="flex flex-col gap-4">
        {!resubmitFor && (
          <>
            <div>
              <h3 className="mb-1 text-[13px] font-bold text-ink">Step 1 — Taxonomy level</h3>
              <FormSelect
                label=""
                aria-label="Taxonomy level"
                value={nodeType}
                onChange={(e) => setNodeType(e.target.value as TaxonomyNodeType)}
              >
                <option value="CATEGORY">Category</option>
                <option value="SUBCATEGORY">Subcategory</option>
                <option value="SUBSUBCATEGORY">Sub-subcategory</option>
              </FormSelect>
            </div>

            <div>
              <h3 className="mb-1 text-[13px] font-bold text-ink">Step 2 — Select the item</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <FormSelect
                  label="Category"
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                    setSubCategoryId("");
                    setSubSubCategoryId("");
                  }}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </FormSelect>
                {nodeType !== "CATEGORY" && (
                  <FormSelect
                    label="Subcategory"
                    value={subCategoryId}
                    onChange={(e) => {
                      setSubCategoryId(e.target.value);
                      setSubSubCategoryId("");
                    }}
                  >
                    <option value="">— Select —</option>
                    {subcategoryOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </FormSelect>
                )}
                {nodeType === "SUBSUBCATEGORY" && (
                  <FormSelect
                    label="Sub-subcategory"
                    value={subSubCategoryId}
                    onChange={(e) => setSubSubCategoryId(e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {subSubCategoryOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </FormSelect>
                )}
              </div>
            </div>

            <div>
              <h3 className="mb-1 text-[13px] font-bold text-ink">Step 3 — Licence requirement</h3>
              {requirements.length === 0 ? (
                <p className="text-[13px] text-gray-500">
                  No active licence requirements apply to this selection.
                </p>
              ) : (
                <FormSelect
                  label=""
                  aria-label="Licence requirement"
                  value={requirementId}
                  onChange={(e) => setRequirementId(e.target.value)}
                >
                  <option value="">— Select a requirement —</option>
                  {requirements.map(({ requirement, source }) => (
                    <option key={requirement.id} value={requirement.id}>
                      {requirement.name} (
                      {source === "CATEGORY"
                        ? "from category"
                        : source === "SUBCATEGORY"
                          ? "from subcategory"
                          : "direct"}
                      )
                    </option>
                  ))}
                </FormSelect>
              )}
            </div>
          </>
        )}

        {selectedRequirement && (
          <div>
            <h3 className="mb-1 text-[13px] font-bold text-ink">Step 4 — Audience</h3>
            {selectedRequirement.sameLicenceForBothAudiences ? (
              <p className="text-[13px] text-gray-600">
                Common licence for Customer and Dealer (one credential covers both).
              </p>
            ) : selectedRequirement.customerRequired && selectedRequirement.dealerRequired ? (
              <FormSelect
                label=""
                aria-label="Audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value as typeof audience)}
              >
                <option value="CUSTOMER">Customer</option>
                <option value="DEALER">Dealer</option>
              </FormSelect>
            ) : (
              <p className="text-[13px] text-gray-600">
                {selectedRequirement.customerRequired ? "Customer" : "Dealer"} only.
              </p>
            )}
          </div>
        )}

        {selectedRequirement && (
          <div>
            <h3 className="mb-1 text-[13px] font-bold text-ink">Step 5 — Geography</h3>
            {(audience === "CUSTOMER" || audience === "BOTH") && (
              <div className="mb-2">
                <span className="text-[13px] font-semibold text-ink">Customer: </span>
                {selectedRequirement.customerGeoType === "PAN_INDIA" ? (
                  <span className="text-[13px] text-gray-600">Pan India licence</span>
                ) : (
                  <StateSingleSelect
                    states={states}
                    value={customerStateId}
                    onChange={setCustomerStateId}
                    label="Customer"
                  />
                )}
              </div>
            )}
            {(audience === "DEALER" || audience === "BOTH") && (
              <div>
                <span className="text-[13px] font-semibold text-ink">Dealer: </span>
                {selectedRequirement.dealerGeoType === "PAN_INDIA" ? (
                  <span className="text-[13px] text-gray-600">Pan India licence</span>
                ) : (
                  <StateSingleSelect
                    states={states}
                    value={dealerStateId}
                    onChange={setDealerStateId}
                    label="Dealer"
                  />
                )}
              </div>
            )}
          </div>
        )}

        <div>
          <h3 className="mb-1 text-[13px] font-bold text-ink">Step 6 — Details</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormInput
              label="Licence number"
              value={licenceNumber}
              onChange={(e) => setLicenceNumber(e.target.value)}
              required
            />
            <CalendarDateField
              label="Expiry date"
              value={expiryDate}
              onChange={setExpiryDate}
            />
          </div>
          <div className="mt-2">
            <LicenceDocumentInput file={file} onChange={setFile} />
          </div>
        </div>

        {error && <AlertBox tone="danger">{error}</AlertBox>}

        <div className="flex gap-2">
          <Button
            type="button"
            loading={isPending}
            onClick={handleSubmit}
            disabled={!requirementId}
          >
            Submit for approval
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Spec §3 — a state-wise licence covers exactly one state. This is a
 * searchable single-select combobox (not a checkbox grid / multi-select):
 * a closed button showing the current selection, a search input + filtered
 * listbox when open, full keyboard support (Escape closes, Enter commits a
 * single unambiguous match), and click-outside-to-close.
 */
function StateSingleSelect({
  states,
  value,
  onChange,
  label,
}: {
  states: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = states.find((s) => s.id === value) ?? null;
  const filtered = useMemo(
    () => states.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase())),
    [states, query],
  );

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative mt-1 max-w-xs">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`State for ${label} coverage`}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-left text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-green-600"
      >
        <span className={selected ? "text-ink" : "text-gray-500"}>
          {selected ? selected.name : `Select a state for ${label}…`}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-surface shadow-lg">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search states…"
            aria-label={`Search states for ${label} coverage`}
            className="w-full border-b border-border px-3 py-2 text-[13px] outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOpen(false);
                setQuery("");
              }
              if (e.key === "Enter" && filtered.length === 1 && filtered[0]) {
                onChange(filtered[0].id);
                setOpen(false);
                setQuery("");
              }
            }}
          />
          <ul role="listbox" className="max-h-[200px] overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-[13px] text-gray-500">No states match.</li>
            )}
            {filtered.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={s.id === value}
                  onClick={() => {
                    onChange(s.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-bg-dashboard focus:outline-none focus:bg-bg-dashboard ${
                    s.id === value ? "bg-green-50 font-semibold text-green-700" : "text-ink"
                  }`}
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
