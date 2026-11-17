"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertBox, Button, Card, FormInput, FormTextarea, Modal } from "@kisan4u/ui";
import { Plus } from "lucide-react";
import {
  getTaxonomyNodeLicenceRequirementsAction,
  previewTaxonomyNodeLicenceImpactAction,
  createLicenceRequirementAction,
  renameLicenceRequirementAction,
  reviseLicenceRequirementAction,
  deleteLicenceRequirementAction,
} from "@/lib/licence-requirement-actions";

type TaxonomyNodeType = "CATEGORY" | "SUBCATEGORY" | "SUBSUBCATEGORY";
type GeoType = "PAN_INDIA" | "STATE_WISE";

type RequirementRow = {
  id: string;
  name: string;
  isActive: boolean;
  customerRequired: boolean;
  customerGeoType: GeoType | null;
  dealerRequired: boolean;
  dealerGeoType: GeoType | null;
  sameLicenceForBothAudiences: boolean;
  version: number;
};

type FormState = {
  name: string;
  customerRequired: boolean;
  customerGeoType: GeoType;
  dealerRequired: boolean;
  dealerGeoType: GeoType;
  sameLicenceForBothAudiences: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  customerRequired: true,
  customerGeoType: "PAN_INDIA",
  dealerRequired: false,
  dealerGeoType: "PAN_INDIA",
  sameLicenceForBothAudiences: false,
};

function toFormState(r: RequirementRow): FormState {
  return {
    name: r.name,
    customerRequired: r.customerRequired,
    customerGeoType: r.customerGeoType ?? "PAN_INDIA",
    dealerRequired: r.dealerRequired,
    dealerGeoType: r.dealerGeoType ?? "PAN_INDIA",
    sameLicenceForBothAudiences: r.sameLicenceForBothAudiences,
  };
}

/** True when the two forms differ in any field that requires a versioned revision (name-only changes are cosmetic — see reviseLicenceRequirement's doc comment). */
function isMaterialChange(a: FormState, b: RequirementRow): boolean {
  return (
    a.customerRequired !== b.customerRequired ||
    (a.customerRequired && a.customerGeoType !== (b.customerGeoType ?? "PAN_INDIA")) ||
    a.dealerRequired !== b.dealerRequired ||
    (a.dealerRequired && a.dealerGeoType !== (b.dealerGeoType ?? "PAN_INDIA")) ||
    a.sameLicenceForBothAudiences !== b.sameLicenceForBothAudiences
  );
}

function RequirementFields({
  value,
  onChange,
  disabled,
}: {
  value: FormState;
  onChange: (v: FormState) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <FormInput
        label="Licence name"
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
        required
        disabled={disabled}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-3">
          <label className="mb-2 flex items-center gap-2 text-[13px] font-bold text-ink">
            <input
              type="checkbox"
              checked={value.customerRequired}
              onChange={(e) => onChange({ ...value, customerRequired: e.target.checked })}
              disabled={disabled}
            />
            Applies to Customer
          </label>
          {value.customerRequired && (
            <div className="flex flex-col gap-1 pl-6 text-[13px] text-ink">
              <label className="flex items-center gap-1.5 text-ink focus-within:ring-2 focus-within:ring-green-600">
                <input
                  type="radio"
                  name="customerGeo"
                  checked={value.customerGeoType === "PAN_INDIA"}
                  onChange={() => onChange({ ...value, customerGeoType: "PAN_INDIA" })}
                  disabled={disabled}
                />
                Pan India
              </label>
              <label className="flex items-center gap-1.5 text-ink focus-within:ring-2 focus-within:ring-green-600">
                <input
                  type="radio"
                  name="customerGeo"
                  checked={value.customerGeoType === "STATE_WISE"}
                  onChange={() => onChange({ ...value, customerGeoType: "STATE_WISE" })}
                  disabled={disabled}
                />
                State-wise
              </label>
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border p-3">
          <label className="mb-2 flex items-center gap-2 text-[13px] font-bold text-ink">
            <input
              type="checkbox"
              checked={value.dealerRequired}
              onChange={(e) => onChange({ ...value, dealerRequired: e.target.checked })}
              disabled={disabled}
            />
            Applies to Dealer
          </label>
          {value.dealerRequired && (
            <div className="flex flex-col gap-1 pl-6 text-[13px] text-ink">
              <label className="flex items-center gap-1.5 text-ink focus-within:ring-2 focus-within:ring-green-600">
                <input
                  type="radio"
                  name="dealerGeo"
                  checked={value.dealerGeoType === "PAN_INDIA"}
                  onChange={() => onChange({ ...value, dealerGeoType: "PAN_INDIA" })}
                  disabled={disabled}
                />
                Pan India
              </label>
              <label className="flex items-center gap-1.5 text-ink focus-within:ring-2 focus-within:ring-green-600">
                <input
                  type="radio"
                  name="dealerGeo"
                  checked={value.dealerGeoType === "STATE_WISE"}
                  onChange={() => onChange({ ...value, dealerGeoType: "STATE_WISE" })}
                  disabled={disabled}
                />
                State-wise
              </label>
            </div>
          )}
        </div>
      </div>
      {value.customerRequired && value.dealerRequired && (
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input
            type="checkbox"
            checked={value.sameLicenceForBothAudiences}
            onChange={(e) => onChange({ ...value, sameLicenceForBothAudiences: e.target.checked })}
            disabled={disabled}
          />
          Same licence for Customer and Dealer (one credential covers both — geography is still
          evaluated independently)
        </label>
      )}
    </div>
  );
}

function RequirementCard({
  requirement,
  nodeType,
  nodeId,
  onSaved,
}: {
  requirement: RequirementRow;
  nodeType: TaxonomyNodeType;
  nodeId: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(toFormState(requirement));
  const [reason, setReason] = useState("");
  const [impact, setImpact] = useState<{
    affectedSellerCount: number;
    affectedProductCount: number;
  } | null>(null);
  const [pendingAction, setPendingAction] = useState<"save" | "deactivate" | null>(null);
  const confirming = pendingAction !== null;
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  function deleteRequirement() {
    setDeleteError(null);
    if (
      !confirm(
        `Permanently delete "${requirement.name}" and all of its earlier versions? This cannot be undone.`,
      )
    )
      return;
    startDeleteTransition(async () => {
      const result = await deleteLicenceRequirementAction(requirement.id);
      if (!result.ok) return setDeleteError(result.error);
      onSaved();
    });
  }

  function startEdit() {
    setForm(toFormState(requirement));
    setReason("");
    setPendingAction(null);
    setImpact(null);
    setError(null);
    setEditing(true);
  }

  return (
    <Card className="p-4">
      {!editing ? (
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="text-[13px]">
              <div className="font-bold text-ink">
                {requirement.name}{" "}
                {!requirement.isActive && (
                  <span className="ml-1 rounded bg-gray-200 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600">
                    Inactive
                  </span>
                )}
              </div>
              <div className="mt-1 text-gray-600">
                {requirement.customerRequired && (
                  <div>
                    Customer —{" "}
                    {requirement.customerGeoType === "PAN_INDIA" ? "Pan India" : "State-wise"}
                  </div>
                )}
                {requirement.dealerRequired && (
                  <div>
                    Dealer —{" "}
                    {requirement.dealerGeoType === "PAN_INDIA" ? "Pan India" : "State-wise"}
                  </div>
                )}
                {requirement.sameLicenceForBothAudiences && (
                  <div className="text-gray-500">Same licence for both audiences</div>
                )}
                <div className="text-gray-400">v{requirement.version}</div>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="outline" size="sm" onClick={startEdit}>
                Edit
              </Button>
              {/* Only once deactivated — deleting an active requirement
                  would change eligibility; deleting an inactive one never
                  does (see deleteLicenceRequirement's doc comment). */}
              {!requirement.isActive && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="!text-danger"
                  loading={isDeleting}
                  onClick={deleteRequirement}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>
          {deleteError && (
            <div className="mt-2">
              <AlertBox tone="danger">{deleteError}</AlertBox>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <RequirementFields value={form} onChange={setForm} disabled={isPending || confirming} />
          {/* Shown whenever a reason will actually be required: for a field
              change (isMaterialChange) OR for Deactivate, which is always a
              material change on an unmodified form — without the `isActive`
              check here, Deactivate had no textarea to type into at all and
              its click handler would just error every time. */}
          {(isMaterialChange(form, requirement) || requirement.isActive) && (
            <FormTextarea
              label="Reason for this change"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              required
              disabled={confirming}
            />
          )}
          {impact && (
            <AlertBox tone="warning">
              This change will affect approximately {impact.affectedSellerCount} seller(s) and{" "}
              {impact.affectedProductCount} product(s) currently listed under this taxonomy node.
              Confirm to apply it.
            </AlertBox>
          )}
          {error && <AlertBox tone="danger">{error}</AlertBox>}
          <div className="flex gap-2">
            {!confirming ? (
              <Button
                type="button"
                size="sm"
                loading={isPending}
                onClick={() => {
                  setError(null);
                  if (!isMaterialChange(form, requirement)) {
                    startTransition(async () => {
                      const result = await renameLicenceRequirementAction({
                        id: requirement.id,
                        name: form.name,
                      });
                      if (!result.ok) return setError(result.error);
                      setEditing(false);
                      onSaved();
                    });
                    return;
                  }
                  if (!reason.trim()) return setError("A reason is required for this change.");
                  startTransition(async () => {
                    const preview = await previewTaxonomyNodeLicenceImpactAction(nodeType, nodeId);
                    setImpact(preview);
                    setPendingAction("save");
                  });
                }}
              >
                Save
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                loading={isPending}
                onClick={() => {
                  startTransition(async () => {
                    const deactivating = pendingAction === "deactivate";
                    const result = await reviseLicenceRequirementAction(
                      requirement.id,
                      deactivating
                        ? { isActive: false }
                        : {
                            name: form.name,
                            isActive: form.customerRequired || form.dealerRequired,
                            customerRequired: form.customerRequired,
                            customerGeoType: form.customerRequired ? form.customerGeoType : null,
                            dealerRequired: form.dealerRequired,
                            dealerGeoType: form.dealerRequired ? form.dealerGeoType : null,
                            sameLicenceForBothAudiences: form.sameLicenceForBothAudiences,
                          },
                      reason,
                    );
                    if (!result.ok) return setError(result.error);
                    setEditing(false);
                    setPendingAction(null);
                    onSaved();
                  });
                }}
              >
                Confirm change
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(false);
                setPendingAction(null);
                setImpact(null);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            {requirement.isActive && !confirming && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-auto !text-danger"
                loading={isPending}
                onClick={() => {
                  setError(null);
                  if (!reason.trim())
                    return setError("A reason is required to deactivate this requirement.");
                  startTransition(async () => {
                    const preview = await previewTaxonomyNodeLicenceImpactAction(nodeType, nodeId);
                    setImpact(preview);
                    setPendingAction("deactivate");
                  });
                }}
              >
                Deactivate
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function AddRequirementForm({
  nodeType,
  nodeId,
  onAdded,
}: {
  nodeType: TaxonomyNodeType;
  nodeId: string;
  onAdded: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [impact, setImpact] = useState<{
    affectedSellerCount: number;
    affectedProductCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!adding) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
        <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add licence requirement
      </Button>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3">
        <RequirementFields value={form} onChange={setForm} disabled={isPending} />
        {impact && (
          <AlertBox tone="warning">
            This will affect approximately {impact.affectedSellerCount} seller(s) and{" "}
            {impact.affectedProductCount} product(s) currently listed under this taxonomy node.
            Confirm to continue.
          </AlertBox>
        )}
        {error && <AlertBox tone="danger">{error}</AlertBox>}
        <div className="flex gap-2">
          {!impact ? (
            <Button
              type="button"
              size="sm"
              loading={isPending}
              onClick={() => {
                setError(null);
                if (!form.name.trim()) return setError("Enter a licence name.");
                if (!form.customerRequired && !form.dealerRequired)
                  return setError("Select at least one audience.");
                startTransition(async () => {
                  const preview = await previewTaxonomyNodeLicenceImpactAction(nodeType, nodeId);
                  setImpact(preview);
                });
              }}
            >
              Preview impact
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              loading={isPending}
              onClick={() => {
                startTransition(async () => {
                  const result = await createLicenceRequirementAction({
                    taxonomyNodeType: nodeType,
                    taxonomyNodeId: nodeId,
                    name: form.name,
                    customerRequired: form.customerRequired,
                    customerGeoType: form.customerRequired ? form.customerGeoType : undefined,
                    dealerRequired: form.dealerRequired,
                    dealerGeoType: form.dealerRequired ? form.dealerGeoType : undefined,
                    sameLicenceForBothAudiences: form.sameLicenceForBothAudiences,
                  });
                  if (!result.ok) return setError(result.error);
                  setAdding(false);
                  setForm(EMPTY_FORM);
                  setImpact(null);
                  onAdded();
                });
              }}
            >
              Confirm &amp; add
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setAdding(false);
              setImpact(null);
              setError(null);
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function LicenceRequirementsModal({
  open,
  onClose,
  nodeType,
  nodeId,
  nodeName,
}: {
  open: boolean;
  onClose: () => void;
  nodeType: TaxonomyNodeType;
  nodeId: string;
  nodeName: string;
}) {
  const [data, setData] = useState<{
    direct: RequirementRow[];
    inherited: { requirement: RequirementRow; source: "CATEGORY" | "SUBCATEGORY" }[];
  } | null>(null);
  const [loading, setLoading] = useState(false);

  function reload() {
    setLoading(true);
    getTaxonomyNodeLicenceRequirementsAction(nodeType, nodeId).then((result) => {
      setData(result as typeof data);
      setLoading(false);
    });
  }

  useEffect(() => {
    if (open) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload is stable enough for this modal's lifecycle; re-running only on open/nodeId change is intentional
  }, [open, nodeId]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Selling licences — ${nodeName}`}
      className="max-w-2xl"
    >
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {data && (
        <div className="flex flex-col gap-5">
          {data.inherited.length > 0 && (
            <div>
              <h3 className="mb-2 text-[13px] font-bold text-ink">
                Inherited requirements (read-only)
              </h3>
              <div className="flex flex-col gap-2">
                {data.inherited.map(({ requirement, source }) => (
                  <Card key={requirement.id} className="bg-bg-dashboard p-3 text-[13px]">
                    <div className="font-semibold text-ink">
                      {requirement.name}{" "}
                      <span className="font-normal text-gray-500">
                        (inherited from {source === "CATEGORY" ? "category" : "subcategory"})
                      </span>
                    </div>
                    <div className="text-gray-600">
                      {requirement.customerRequired && (
                        <span className="mr-3">
                          Customer —{" "}
                          {requirement.customerGeoType === "PAN_INDIA" ? "Pan India" : "State-wise"}
                        </span>
                      )}
                      {requirement.dealerRequired && (
                        <span>
                          Dealer —{" "}
                          {requirement.dealerGeoType === "PAN_INDIA" ? "Pan India" : "State-wise"}
                        </span>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-[13px] font-bold text-ink">Direct requirements</h3>
            <div className="flex flex-col gap-2">
              {data.direct.map((r) => (
                <RequirementCard
                  key={r.id}
                  requirement={r}
                  nodeType={nodeType}
                  nodeId={nodeId}
                  onSaved={reload}
                />
              ))}
              {data.direct.length === 0 && (
                <p className="text-[13px] text-gray-500">
                  No direct requirements on this node yet.
                </p>
              )}
            </div>
          </div>

          <AddRequirementForm nodeType={nodeType} nodeId={nodeId} onAdded={reload} />
        </div>
      )}
    </Modal>
  );
}
