"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Copy,
  Trash2,
  ChevronDown,
  ChevronRight,
  Layers,
  Save,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { AlertBox, Badge, Button } from "@kisan4u/ui";
import {
  normalizeAudienceSku,
  parseBulkGroupSharedData,
  parseBulkRowData,
  type AudienceSkuAudience,
  type BulkGroupSharedDataInput,
  type BulkRowDataInput,
} from "@kisan4u/validators";
import type { SellingLicenceEligibilityResult } from "@kisan4u/catalog";
import { getProductLicenceEligibilityAction } from "@/lib/licence-eligibility-action";
import { LicenceStatesSelector } from "@/components/licence-states-selector";
import { GridTextInput, GridSelect, SearchableSelect, ChecklistPopover } from "./cell-primitives";
import { DescriptionModal } from "./DescriptionModal";
import { ImageManagerModal } from "./ImageManagerModal";
import type { BulkGroupState, BulkRowState, BulkReferenceData } from "./types";

type ActionResult = { ok: true; data?: { id: string } } | { ok: false; error: string; conflict?: boolean };

export type BulkProductGridActions = {
  upsertGroup: (
    draftId: string,
    version: number,
    input: {
      groupId?: string;
      groupKey: string;
      hasVariants: boolean;
      audience: BulkGroupState["audience"];
      sharedData: BulkGroupState["shared"];
      sellerId?: string | null;
    },
  ) => Promise<ActionResult>;
  deleteGroup: (draftId: string, version: number, groupId: string) => Promise<ActionResult>;
  upsertRow: (
    draftId: string,
    version: number,
    input: {
      rowId?: string;
      groupId: string;
      audience: "CUSTOMER" | "DEALER";
      rowData: BulkRowState["data"];
      existingVariantId?: string | null;
    },
  ) => Promise<ActionResult>;
  deleteRow: (draftId: string, version: number, rowId: string) => Promise<ActionResult>;
  loadExistingProduct: (productId: string) => Promise<
    | {
        ok: true;
        product: { id: string; name: string; hasVariants: boolean; sharedData: BulkGroupSharedDataInput; audience: NonNullable<BulkGroupState["audience"]> };
        rows: Array<{ variantId: string | null; audience: "CUSTOMER" | "DEALER"; rowData: BulkRowDataInput }>;
      }
    | { ok: false; error: string }
  >;
  uploadImage: (draftId: string, groupKey: string, file: File) => Promise<{ ok: true; urls: { url: string } } | { ok: false; error: string }>;
  uploadImageFromUrl: (draftId: string, groupKey: string, url: string) => Promise<{ ok: true; urls: { url: string } } | { ok: false; error: string }>;
  validateDraft: (draftId: string) => Promise<
    | { ok: true; results: Array<{ groupKey: string; ok: boolean; fieldErrors?: string[]; isVariantProduct: boolean; audience: string; customerRowCount: number; dealerRowCount: number; isNewProduct: boolean }> }
    | { ok: false; error: string }
  >;
  submitDraft: (draftId: string) => Promise<
    | { ok: true; results: Array<{ groupKey: string; ok: boolean; productId?: string; productHref?: string; error?: string; fieldErrors?: string[] }> }
    | { ok: false; error: string }
  >;
};

const EMPTY_ROW_DATA: BulkRowState["data"] = {
  attributeValueRefs: [],
  skuBase: "",
  hsnCode: "",
  mrp: "",
  sellingPrice: "",
  taxPercent: "0",
  minOrderQty: "1",
  currentStock: "0",
  minStockQty: "5",
  reorderLevel: "10",
  weight: "",
  weightUnit: "G",
  height: "",
  breadth: "",
  length: "",
  dimensionUnit: "CM",
  shippingIncluded: "YES",
  imageUrl: "",
  imageAlt: "",
  isActive: true,
};

function genGroupKey(): string {
  return `GRP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}
function tempId(): string {
  return `tmp_${crypto.randomUUID()}`;
}

function discountPercent(mrp: string, sellingPrice: string): string {
  const m = Number(mrp);
  const s = Number(sellingPrice);
  if (!m || m <= 0 || !Number.isFinite(s)) return "—";
  return `${(((m - s) / m) * 100).toFixed(1)}%`;
}

export function BulkProductGrid({
  draftId,
  isAdmin,
  sellerId,
  reference,
  initialGroups,
  initialVersion,
  actions,
}: {
  draftId: string;
  isAdmin: boolean;
  /** Fixed for a seller draft (their own seller id — every group belongs to them). Always null for an admin draft, where the owning seller is chosen per-group instead (see BulkGroupState.sellerId). */
  sellerId: string | null;
  reference: BulkReferenceData;
  initialGroups: BulkGroupState[];
  initialVersion: number;
  actions: BulkProductGridActions;
}) {
  const router = useRouter();
  const [groups, setGroups] = useState<BulkGroupState[]>(initialGroups);
  const [version, setVersion] = useState(initialVersion);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validation, setValidation] = useState<
    Array<{ groupKey: string; ok: boolean; fieldErrors?: string[] }> | null
  >(null);
  const [submitResults, setSubmitResults] = useState<
    Array<{ groupKey: string; ok: boolean; productId?: string; productHref?: string; error?: string; fieldErrors?: string[] }> | null
  >(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [descriptionModal, setDescriptionModal] = useState<{
    groupId: string;
    field: "shortDescription" | "description" | "ingredients" | "howToUse" | "dosageInstructions" | "technicalInfo";
  } | null>(null);
  const [imageModal, setImageModal] = useState<{ groupId: string } | null>(null);
  const [audienceFilter, setAudienceFilter] = useState<"ALL" | "CUSTOMER" | "DEALER">("ALL");
  const [hasVariantsFilter, setHasVariantsFilter] = useState<"ALL" | "YES" | "NO">("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const dirtyRef = useRef<Set<string>>(new Set()); // group ids with unsaved changes
  const dirtyRowsRef = useRef<Set<string>>(new Set());
  const deletedGroupIdsRef = useRef<Set<string>>(new Set());
  const deletedRowIdsRef = useRef<Set<string>>(new Set());
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markGroupDirty = useCallback((groupId: string) => {
    dirtyRef.current.add(groupId);
  }, []);
  const markRowDirty = useCallback((rowId: string) => {
    dirtyRowsRef.current.add(rowId);
  }, []);

  const subcategoryOptions = useCallback(
    (categoryId: string) => reference.subcategories.filter((s) => s.categoryId === categoryId),
    [reference.subcategories],
  );
  const subSubCategoryOptions = useCallback(
    (subCategoryId: string) => reference.subSubCategories.filter((s) => s.subCategoryId === subCategoryId),
    [reference.subSubCategories],
  );

  function updateGroup(groupId: string, patch: Partial<BulkGroupState>) {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, ...patch } : g)));
    markGroupDirty(groupId);
    scheduleAutosave();
  }
  function updateShared(groupId: string, patch: Partial<BulkGroupState["shared"]>) {
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, shared: { ...g.shared, ...patch } } : g)),
    );
    markGroupDirty(groupId);
    scheduleAutosave();
  }
  function updateRow(rowId: string, patch: Partial<BulkRowState["data"]>) {
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        rows: g.rows.map((r) => (r.id === rowId ? { ...r, data: { ...r.data, ...patch } } : r)),
      })),
    );
    markRowDirty(rowId);
    scheduleAutosave();
  }

  function scheduleAutosave() {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => void saveDraft(), 2000);
  }

  async function saveDraft(): Promise<boolean> {
    if (dirtyRef.current.size === 0 && dirtyRowsRef.current.size === 0 &&
      deletedGroupIdsRef.current.size === 0 && deletedRowIdsRef.current.size === 0) {
      return true;
    }
    setSaveStatus("saving");
    setSaveError(null);
    let v = version;
    try {
      for (const groupId of deletedGroupIdsRef.current) {
        const result = await actions.deleteGroup(draftId, v, groupId);
        if (!result.ok) throw new Error(result.error);
        v += 1;
      }
      deletedGroupIdsRef.current.clear();
      for (const rowId of deletedRowIdsRef.current) {
        const result = await actions.deleteRow(draftId, v, rowId);
        if (!result.ok) throw new Error(result.error);
        v += 1;
      }
      deletedRowIdsRef.current.clear();

      for (const groupId of dirtyRef.current) {
        const group = groups.find((g) => g.id === groupId);
        if (!group) continue;
        const result = await actions.upsertGroup(draftId, v, {
          groupId: group.isNew ? undefined : group.id,
          groupKey: group.groupKey,
          hasVariants: group.hasVariants,
          audience: group.audience,
          sharedData: group.shared,
          sellerId: group.sellerId,
        });
        if (!result.ok) throw new Error(result.error);
        v += 1;
        if (group.isNew && result.data) {
          const realId = result.data.id;
          setGroups((prev) =>
            prev.map((g) => (g.id === groupId ? { ...g, id: realId, isNew: false } : g)),
          );
        }
      }
      dirtyRef.current.clear();

      // Re-read groups after any id remaps above.
      for (const rowId of dirtyRowsRef.current) {
        let row: BulkRowState | undefined;
        let parentGroupId = "";
        setGroups((prev) => {
          for (const g of prev) {
            const found = g.rows.find((r) => r.id === rowId);
            if (found) {
              row = found;
              parentGroupId = g.id;
            }
          }
          return prev;
        });
        if (!row) continue;
        const result = await actions.upsertRow(draftId, v, {
          rowId: row.isNew ? undefined : row.id,
          groupId: parentGroupId,
          audience: row.audience,
          rowData: row.data,
          ...(row.isNew ? { existingVariantId: row.existingVariantId } : {}),
        });
        if (!result.ok) throw new Error(result.error);
        v += 1;
        if (row.isNew && result.data) {
          const realRowId = result.data.id;
          setGroups((prev) =>
            prev.map((g) => ({
              ...g,
              rows: g.rows.map((r) => (r.id === rowId ? { ...r, id: realRowId, isNew: false } : r)),
            })),
          );
        }
      }
      dirtyRowsRef.current.clear();

      setVersion(v);
      setSaveStatus("saved");
      return true;
    } catch (err) {
      setSaveStatus("error");
      setSaveError(err instanceof Error ? err.message : "Failed to save.");
      return false;
    }
  }

  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, []);

  function addGroup() {
    const groupId = tempId();
    const newGroup: BulkGroupState = {
      id: groupId,
      isNew: true,
      groupKey: genGroupKey(),
      hasVariants: false,
      audience: "CUSTOMER_ONLY",
      existingProductId: null,
      sellerId: null,
      status: "NEW",
      collapsed: false,
      shared: {
        name: "",
        categoryId: reference.categories[0]?.id ?? "",
        baseUnit: "PIECE",
        productType: "PHYSICAL",
      },
      rows: [
        {
          id: tempId(),
          isNew: true,
          groupId,
          audience: "CUSTOMER",
          existingVariantId: null,
          data: { ...EMPTY_ROW_DATA },
        },
      ],
    };
    setGroups((prev) => [...prev, newGroup]);
    markGroupDirty(groupId);
    markRowDirty(newGroup.rows[0]!.id);
    scheduleAutosave();
  }

  function duplicateGroup(sourceId: string) {
    const source = groups.find((g) => g.id === sourceId);
    if (!source) return;
    const groupId = tempId();
    const newGroup: BulkGroupState = {
      ...source,
      id: groupId,
      isNew: true,
      groupKey: genGroupKey(),
      existingProductId: null,
      status: "NEW",
      shared: { ...source.shared, name: `${source.shared.name ?? ""} (copy)` },
      rows: source.rows.map((r) => ({
        ...r,
        id: tempId(),
        isNew: true,
        groupId,
        existingVariantId: null,
      })),
    };
    setGroups((prev) => [...prev, newGroup]);
    markGroupDirty(groupId);
    newGroup.rows.forEach((r) => markRowDirty(r.id));
    scheduleAutosave();
  }

  function deleteGroupLocal(groupId: string) {
    if (!window.confirm("Delete this entire Product Group, including all its rows? This cannot be undone.")) return;
    const group = groups.find((g) => g.id === groupId);
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
    dirtyRef.current.delete(groupId);
    if (group && !group.isNew) deletedGroupIdsRef.current.add(groupId);
    scheduleAutosave();
  }

  function addRow(groupId: string, audience: "CUSTOMER" | "DEALER") {
    const rowId = tempId();
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              rows: [
                ...g.rows,
                { id: rowId, isNew: true, groupId, audience, existingVariantId: null, data: { ...EMPTY_ROW_DATA } },
              ],
            }
          : g,
      ),
    );
    markRowDirty(rowId);
    scheduleAutosave();
  }

  function duplicateRow(rowId: string) {
    setGroups((prev) =>
      prev.map((g) => {
        const source = g.rows.find((r) => r.id === rowId);
        if (!source) return g;
        const newId = tempId();
        return {
          ...g,
          rows: [
            ...g.rows,
            { ...source, id: newId, isNew: true, existingVariantId: null, data: { ...source.data } },
          ],
        };
      }),
    );
    markRowDirty(rowId);
    scheduleAutosave();
  }

  function copyRowAsOtherAudience(rowId: string) {
    setGroups((prev) =>
      prev.map((g) => {
        const source = g.rows.find((r) => r.id === rowId);
        if (!source) return g;
        const targetAudience: "CUSTOMER" | "DEALER" = source.audience === "CUSTOMER" ? "DEALER" : "CUSTOMER";
        const suffix: AudienceSkuAudience = targetAudience;
        const skuResult = normalizeAudienceSku(source.data.skuBase.replace(/-(cus|dea)$/i, ""), suffix);
        const newId = tempId();
        return {
          ...g,
          rows: [
            ...g.rows,
            {
              id: newId,
              isNew: true,
              groupId: g.id,
              audience: targetAudience,
              existingVariantId: null,
              data: {
                ...source.data,
                skuBase: skuResult.ok ? skuResult.sku : source.data.skuBase,
                currentStock: "0",
                shippingIncluded: targetAudience === "DEALER" ? "NO" : "YES",
              },
            },
          ],
        };
      }),
    );
    scheduleAutosave();
    setGroups((prev) => {
      for (const g of prev) {
        const justAdded = g.rows[g.rows.length - 1];
        if (justAdded) markRowDirty(justAdded.id);
      }
      return prev;
    });
  }

  function deleteRowLocal(rowId: string) {
    let isExistingRow = false;
    setGroups((prev) =>
      prev.map((g) => {
        const row = g.rows.find((r) => r.id === rowId);
        if (row && !row.isNew) isExistingRow = true;
        return { ...g, rows: g.rows.filter((r) => r.id !== rowId) };
      }),
    );
    dirtyRowsRef.current.delete(rowId);
    if (isExistingRow) deletedRowIdsRef.current.add(rowId);
    scheduleAutosave();
  }

  /**
   * Generates variant rows for ONE audience from a value selection scoped to
   * that same audience's own generation panel (see VariantGenerationPanel) —
   * Customer and Dealer can therefore end up with entirely different
   * combinations (e.g. Customer sells Red/Blue/Green, Dealer only sells
   * Red in bulk packs), mirroring how the single-product form's
   * VariantsEditor runs two fully independent generate flows for
   * customerVariants/dealerVariants against the same shared attributeValues
   * pool (see product-form.tsx). The underlying pool of possible values
   * (group.shared.attributeValues) stays shared/global; only which
   * combinations get generated as rows is audience-specific.
   */
  function generateVariantCombinationsForAudience(
    groupId: string,
    audience: "CUSTOMER" | "DEALER",
    selectedByAttr: Record<string, string[]>,
  ) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const values = group.shared.attributeValues ?? [];
    const attributeIdsWithSelection = Object.keys(selectedByAttr).filter(
      (id) => (selectedByAttr[id] ?? []).length > 0,
    );
    if (attributeIdsWithSelection.length === 0) {
      window.alert("Select at least one value under at least one attribute first.");
      return;
    }
    const valuesByAttr = attributeIdsWithSelection.map((attrId) =>
      (selectedByAttr[attrId] ?? []).map((slug) => ({ attributeId: attrId, slug })),
    );
    let combos: Array<Array<{ attributeId: string; slug: string }>> = [[]];
    for (const vals of valuesByAttr) {
      const next: Array<Array<{ attributeId: string; slug: string }>> = [];
      for (const combo of combos) {
        for (const v of vals) {
          next.push([...combo, v]);
        }
      }
      combos = next;
    }
    const audienceLabel = audience === "CUSTOMER" ? "Customer" : "Dealer";
    if (combos.length > 200) {
      if (!window.confirm(`This will generate ${combos.length} ${audienceLabel} rows. Continue?`)) return;
    } else if (!window.confirm(`Generate ${combos.length} ${audienceLabel} combination(s)?`)) {
      return;
    }

    const existingKeys = new Set(
      group.rows
        .filter((r) => r.audience === audience)
        .map((r) => JSON.stringify([...r.data.attributeValueRefs].sort((a, b) => a.attributeId.localeCompare(b.attributeId)))),
    );
    const newRows: BulkRowState[] = [];
    for (const combo of combos) {
      const sortedCombo = [...combo].sort((a, b) => a.attributeId.localeCompare(b.attributeId));
      const key = JSON.stringify(sortedCombo);
      if (existingKeys.has(key)) continue;
      const label = combo
        .map((c) => values.find((v) => v.attributeId === c.attributeId && v.slug === c.slug)?.value ?? c.slug)
        .join("-")
        .toUpperCase()
        .replace(/[^A-Z0-9-]+/g, "");
      newRows.push({
        id: tempId(),
        isNew: true,
        groupId,
        audience,
        existingVariantId: null,
        data: {
          ...EMPTY_ROW_DATA,
          attributeValueRefs: combo,
          skuBase: `${group.groupKey}-${label}`,
          shippingIncluded: audience === "DEALER" ? "NO" : "YES",
        },
      });
    }
    if (newRows.length === 0) {
      window.alert("Every selected combination already exists below.");
      return;
    }
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, rows: [...g.rows, ...newRows] } : g)),
    );
    newRows.forEach((r) => markRowDirty(r.id));
    scheduleAutosave();
  }

  async function recallExistingProduct(groupId: string, productId: string) {
    const result = await actions.loadExistingProduct(productId);
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    const choice = window.confirm(
      `"${result.product.name}" already exists.\n\nOK = load it for editing (updates the live product on submit)\nCancel = keep entering a brand-new product under this Group ID instead`,
    );
    if (!choice) return;
    const newRows: BulkRowState[] = result.rows.map((r) => ({
      id: tempId(),
      isNew: true,
      groupId,
      audience: r.audience,
      existingVariantId: r.variantId,
      data: parseBulkRowData(r.rowData),
    }));
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              existingProductId: result.product.id,
              status: "EXISTING",
              hasVariants: result.product.hasVariants,
              audience: result.product.audience,
              shared: parseBulkGroupSharedData(result.product.sharedData),
              rows: newRows,
            }
          : g,
      ),
    );
    markGroupDirty(groupId);
    newRows.forEach((r) => markRowDirty(r.id));
    scheduleAutosave();
  }

  async function handleValidateAll() {
    const saved = await saveDraft();
    if (!saved) return;
    const result = await actions.validateDraft(draftId);
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    setValidation(result.results);
  }

  async function handleSubmitAll() {
    const saved = await saveDraft();
    if (!saved) return;
    setIsSubmitting(true);
    setSubmitResults(null);
    try {
      const result = await actions.submitDraft(draftId);
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      setSubmitResults(result.results);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  const visibleGroups = useMemo(() => {
    return groups.filter((g) => {
      if (hasVariantsFilter !== "ALL" && (g.hasVariants ? "YES" : "NO") !== hasVariantsFilter) return false;
      if (audienceFilter !== "ALL" && !g.rows.some((r) => r.audience === audienceFilter)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const inName = (g.shared.name ?? "").toLowerCase().includes(q);
        const inKey = g.groupKey.toLowerCase().includes(q);
        const inSku = g.rows.some((r) => r.data.skuBase.toLowerCase().includes(q));
        if (!inName && !inKey && !inSku) return false;
      }
      return true;
    });
  }, [groups, hasVariantsFilter, audienceFilter, searchQuery]);

  const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2.5 border-b border-border bg-white/95 py-3 backdrop-blur">
        <Button type="button" onClick={addGroup} variant="primary" size="sm">
          <Plus className="h-4 w-4" aria-hidden="true" /> Add product group
        </Button>
        <GridTextInput
          placeholder="Search name, Group ID, or SKU…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-64"
        />
        <GridSelect value={audienceFilter} onChange={(v) => setAudienceFilter(v as typeof audienceFilter)}>
          <option value="ALL">All audiences</option>
          <option value="CUSTOMER">Customer</option>
          <option value="DEALER">Dealer</option>
        </GridSelect>
        <GridSelect value={hasVariantsFilter} onChange={(v) => setHasVariantsFilter(v as typeof hasVariantsFilter)}>
          <option value="ALL">Variants: all</option>
          <option value="YES">Has variants</option>
          <option value="NO">No variants</option>
        </GridSelect>

        <div className="ml-auto flex items-center gap-2">
          <SaveStatusBadge status={saveStatus} error={saveError} />
          <Button type="button" variant="outline" size="sm" onClick={() => void saveDraft()}>
            <Save className="h-3.5 w-3.5" aria-hidden="true" /> Save draft
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleValidateAll()}>
            Validate all
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={() => void handleSubmitAll()} loading={isSubmitting}>
            Submit all ({groups.length} groups, {totalRows} rows)
          </Button>
        </div>
      </div>

      {validation && (
        <ValidationSummary
          results={validation}
          onJump={(groupKey) => {
            const g = groups.find((x) => x.groupKey === groupKey);
            if (g) document.getElementById(`group-${g.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          onClose={() => setValidation(null)}
        />
      )}
      {submitResults && (
        <SubmissionResults results={submitResults} onClose={() => setSubmitResults(null)} />
      )}

      {visibleGroups.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center text-sm text-gray-500">
          <Layers className="h-8 w-8 text-gray-300" aria-hidden="true" />
          {groups.length === 0 ? "No product groups yet — Add product group to start." : "No groups match the current filters."}
        </div>
      )}

      {visibleGroups.map((group) => (
        <GroupCard
          key={group.id}
          group={group}
          isAdmin={isAdmin}
          sellerId={sellerId}
          reference={reference}
          subcategoryOptions={subcategoryOptions}
          subSubCategoryOptions={subSubCategoryOptions}
          onUpdateGroup={(patch) => updateGroup(group.id, patch)}
          onUpdateShared={(patch) => updateShared(group.id, patch)}
          onUpdateRow={updateRow}
          onDeleteGroup={() => deleteGroupLocal(group.id)}
          onDuplicateGroup={() => duplicateGroup(group.id)}
          onAddRow={(audience) => addRow(group.id, audience)}
          onDuplicateRow={duplicateRow}
          onDeleteRow={deleteRowLocal}
          onCopyAsOtherAudience={copyRowAsOtherAudience}
          onGenerateForAudience={(audience, selectedByAttr) =>
            generateVariantCombinationsForAudience(group.id, audience, selectedByAttr)
          }
          onOpenDescription={(field) => setDescriptionModal({ groupId: group.id, field })}
          onOpenImages={() => setImageModal({ groupId: group.id })}
          onRecallExisting={(productId) => void recallExistingProduct(group.id, productId)}
          onToggleCollapse={() => updateGroup(group.id, { collapsed: !group.collapsed })}
        />
      ))}

      {descriptionModal && (
        <DescriptionModal
          field={descriptionModal.field}
          value={(groups.find((g) => g.id === descriptionModal.groupId)?.shared[descriptionModal.field] as string) ?? ""}
          onUploadImage={(file) => {
            const group = groups.find((g) => g.id === descriptionModal.groupId)!;
            return actions.uploadImage(draftId, group.groupKey, file).then((r) =>
              r.ok ? { ok: true as const, url: r.urls.url } : { ok: false as const, error: r.error },
            );
          }}
          onSave={(html) => {
            updateShared(descriptionModal.groupId, { [descriptionModal.field]: html });
            setDescriptionModal(null);
          }}
          onClose={() => setDescriptionModal(null)}
        />
      )}
      {imageModal && (
        <ImageManagerModal
          group={groups.find((g) => g.id === imageModal.groupId)!}
          onUploadImage={(file) => actions.uploadImage(draftId, groups.find((g) => g.id === imageModal.groupId)!.groupKey, file)}
          onUploadImageFromUrl={(url) => actions.uploadImageFromUrl(draftId, groups.find((g) => g.id === imageModal.groupId)!.groupKey, url)}
          onSave={(primaryImageUrl, images) => {
            updateShared(imageModal.groupId, { primaryImageUrl, images });
            setImageModal(null);
          }}
          onClose={() => setImageModal(null)}
        />
      )}
    </div>
  );
}

function SaveStatusBadge({ status, error }: { status: "idle" | "saving" | "saved" | "error"; error: string | null }) {
  if (status === "saving") {
    return (
      <span className="flex items-center gap-1 text-xs text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-green-700">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Saved
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-danger" title={error ?? undefined}>
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Save failed
      </span>
    );
  }
  return null;
}

function ValidationSummary({
  results,
  onJump,
  onClose,
}: {
  results: Array<{ groupKey: string; ok: boolean; fieldErrors?: string[] }>;
  onJump: (groupKey: string) => void;
  onClose: () => void;
}) {
  const failing = results.filter((r) => !r.ok);
  if (failing.length === 0) {
    return (
      <AlertBox tone="success">
        All {results.length} group(s) passed validation.{" "}
        <button type="button" className="underline" onClick={onClose}>
          Dismiss
        </button>
      </AlertBox>
    );
  }
  return (
    <AlertBox tone="danger" title={`${failing.length} of ${results.length} group(s) have errors`}>
      <ul className="mt-1 flex flex-col gap-2">
        {failing.map((r) => (
          <li key={r.groupKey}>
            <button type="button" className="text-left font-bold underline" onClick={() => onJump(r.groupKey)}>
              {r.groupKey}
            </button>
            <ul className="ml-4 list-disc text-xs">
              {r.fieldErrors?.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </li>
        ))}
      </ul>
      <button type="button" className="mt-2 text-xs underline" onClick={onClose}>
        Dismiss
      </button>
    </AlertBox>
  );
}

function SubmissionResults({
  results,
  onClose,
}: {
  results: Array<{ groupKey: string; ok: boolean; productId?: string; productHref?: string; error?: string; fieldErrors?: string[] }>;
  onClose: () => void;
}) {
  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  return (
    <AlertBox tone={failed.length === 0 ? "success" : "warning"} title="Submission results">
      <p className="text-xs">
        {succeeded.length} succeeded, {failed.length} failed out of {results.length}.
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {results.map((r) => (
          <li key={r.groupKey} className="text-xs">
            <strong>{r.groupKey}</strong>:{" "}
            {r.ok ? (
              <a href={r.productHref} className="text-green-700 underline" target="_blank" rel="noreferrer">
                Success — view product
              </a>
            ) : (
              <span className="text-danger">{r.error ?? "Failed"}</span>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="mt-2 text-xs underline" onClick={onClose}>
        Dismiss
      </button>
    </AlertBox>
  );
}

function GroupCard(props: {
  group: BulkGroupState;
  isAdmin: boolean;
  sellerId: string | null;
  reference: BulkReferenceData;
  subcategoryOptions: (categoryId: string) => BulkReferenceData["subcategories"];
  subSubCategoryOptions: (subCategoryId: string) => BulkReferenceData["subSubCategories"];
  onUpdateGroup: (patch: Partial<BulkGroupState>) => void;
  onUpdateShared: (patch: Partial<BulkGroupState["shared"]>) => void;
  onUpdateRow: (rowId: string, patch: Partial<BulkRowState["data"]>) => void;
  onDeleteGroup: () => void;
  onDuplicateGroup: () => void;
  onAddRow: (audience: "CUSTOMER" | "DEALER") => void;
  onDuplicateRow: (rowId: string) => void;
  onDeleteRow: (rowId: string) => void;
  onCopyAsOtherAudience: (rowId: string) => void;
  onGenerateForAudience: (audience: "CUSTOMER" | "DEALER", selectedByAttr: Record<string, string[]>) => void;
  onOpenDescription: (field: "shortDescription" | "description" | "ingredients" | "howToUse" | "dosageInstructions" | "technicalInfo") => void;
  onOpenImages: () => void;
  onRecallExisting: (productId: string) => void;
  onToggleCollapse: () => void;
}) {
  const {
    group, isAdmin, sellerId, reference, subcategoryOptions, subSubCategoryOptions,
    onUpdateGroup, onUpdateShared, onUpdateRow, onDeleteGroup, onDuplicateGroup,
    onAddRow, onDuplicateRow, onDeleteRow, onCopyAsOtherAudience, onGenerateForAudience,
    onOpenDescription, onOpenImages, onRecallExisting, onToggleCollapse,
  } = props;

  const [switchWarning, setSwitchWarning] = useState(false);
  const isDigital = group.shared.productType === "DIGITAL";
  const needsCustomer = group.audience === "CUSTOMER_ONLY" || group.audience === "BOTH_CUSTOMER_AND_DEALER";
  const needsDealer = group.audience === "DEALER_ONLY" || group.audience === "BOTH_CUSTOMER_AND_DEALER";

  // Selling-licence module — same pattern as product-form.tsx: fetch once
  // per (owning seller, taxonomy path), reused for the requirement summary,
  // audience-option gating, and both LicenceStatesSelector instances.
  // effectiveSellerId is the seller's own id on a seller draft, or this
  // group's admin-assigned seller on an admin draft (null until assigned,
  // in which case eligibility is skipped — same as the single-product form
  // treats a not-yet-known seller: every state shown unrestricted).
  const effectiveSellerId = isAdmin ? group.sellerId : sellerId;
  const categoryId = group.shared.categoryId ?? "";
  const subCategoryId = group.shared.subCategoryId ?? "";
  const subSubCategoryId = group.shared.subSubCategoryId ?? "";
  const [eligibility, setEligibility] = useState<SellingLicenceEligibilityResult | null>(null);
  useEffect(() => {
    if (!effectiveSellerId || !categoryId) {
      setEligibility(null);
      return;
    }
    let cancelled = false;
    getProductLicenceEligibilityAction(effectiveSellerId, {
      categoryId,
      subCategoryId: subCategoryId || null,
      subSubCategoryId: subSubCategoryId || null,
    }).then((result) => {
      if (!cancelled && result.ok) setEligibility(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveSellerId, categoryId, subCategoryId, subSubCategoryId]);

  const customerAudienceEnabled = !eligibility || eligibility.customer.eligibleStateIds.length > 0;
  const dealerAudienceEnabled = !eligibility || eligibility.dealer.eligibleStateIds.length > 0;

  function handleHasVariantsChange(next: boolean) {
    if (!next && group.hasVariants && group.rows.length > 0) {
      setSwitchWarning(true);
      return;
    }
    applyHasVariantsChange(next);
  }
  function applyHasVariantsChange(next: boolean) {
    onUpdateGroup({ hasVariants: next });
    if (!next) {
      onUpdateShared({ selectedAttributeIds: [], attributeValues: [] });
    }
    setSwitchWarning(false);
  }

  return (
    <div id={`group-${group.id}`} className="rounded-lg border border-border bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-bg-dashboard/50 px-4 py-3">
        <button type="button" onClick={onToggleCollapse} className="text-gray-500 hover:text-ink" aria-label="Toggle group">
          {group.collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
        <GridTextInput
          value={group.groupKey}
          onChange={(e) => onUpdateGroup({ groupKey: e.target.value })}
          className="w-48 font-mono text-sm font-bold"
          title="Product Group ID"
        />
        <Badge tone={group.status === "EXISTING" ? "info" : group.status === "NEW" ? "success" : "warning"}>
          {group.status}
        </Badge>
        <GridTextInput
          value={group.shared.name ?? ""}
          onChange={(e) => onUpdateShared({ name: e.target.value })}
          placeholder="Product name"
          className="w-72 text-sm font-semibold"
        />
        <span className="text-xs text-gray-500">{group.rows.length} row(s)</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={onDuplicateGroup} title="Duplicate group">
            <Copy className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button type="button" variant="danger" size="sm" onClick={onDeleteGroup} title="Delete group">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {!group.collapsed && (
        <div className="flex flex-col gap-5 p-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <LabeledField label="Recall existing product">
              <GridTextInput
                placeholder="Paste an existing Product ID…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const value = (e.target as HTMLInputElement).value.trim();
                    if (value) onRecallExisting(value);
                  }
                }}
              />
            </LabeledField>
            <LabeledField label="Does this product have variants?">
              <GridSelect
                value={group.hasVariants ? "YES" : "NO"}
                onChange={(v) => handleHasVariantsChange(v === "YES")}
              >
                <option value="NO">No</option>
                <option value="YES">Yes</option>
              </GridSelect>
            </LabeledField>
            <LabeledField label="Audience">
              <GridSelect
                value={group.audience ?? "CUSTOMER_ONLY"}
                onChange={(v) => onUpdateGroup({ audience: v as BulkGroupState["audience"] })}
              >
                <option value="CUSTOMER_ONLY" disabled={!customerAudienceEnabled}>
                  Customer only{!customerAudienceEnabled ? " (no licensed state available)" : ""}
                </option>
                <option value="DEALER_ONLY" disabled={!dealerAudienceEnabled}>
                  Dealer only{!dealerAudienceEnabled ? " (no licensed state available)" : ""}
                </option>
                <option
                  value="BOTH_CUSTOMER_AND_DEALER"
                  disabled={!customerAudienceEnabled || !dealerAudienceEnabled}
                >
                  Customer and Dealer
                  {!customerAudienceEnabled || !dealerAudienceEnabled
                    ? " (no licensed state available for one audience)"
                    : ""}
                </option>
              </GridSelect>
            </LabeledField>
            <LabeledField label="Product type">
              <GridSelect
                value={group.shared.productType ?? "PHYSICAL"}
                onChange={(v) => onUpdateShared({ productType: v as "PHYSICAL" | "DIGITAL" })}
              >
                <option value="PHYSICAL">Physical</option>
                <option value="DIGITAL">Digital</option>
              </GridSelect>
            </LabeledField>
            {isAdmin && (
              <LabeledField label="Seller (admin only)">
                <SearchableSelect
                  value={group.sellerId ?? ""}
                  onChange={(id) => onUpdateGroup({ sellerId: id || null })}
                  options={reference.sellers}
                  placeholder={group.existingProductId ? "— Uses the existing product's owner —" : "— Select a seller —"}
                />
              </LabeledField>
            )}
            <LabeledField label="Base unit">
              <GridSelect value={group.shared.baseUnit ?? "PIECE"} onChange={(v) => onUpdateShared({ baseUnit: v as never })}>
                <option value="PIECE">Piece</option>
                <option value="KG">kg</option>
                <option value="G">g</option>
                <option value="L">L</option>
                <option value="ML">ml</option>
              </GridSelect>
            </LabeledField>
            <LabeledField label="Category">
              <SearchableSelect
                value={group.shared.categoryId ?? ""}
                onChange={(id) => onUpdateShared({ categoryId: id, subCategoryId: "", subSubCategoryId: "" })}
                options={reference.categories}
              />
            </LabeledField>
            <LabeledField label="Subcategory">
              <SearchableSelect
                value={group.shared.subCategoryId ?? ""}
                onChange={(id) => onUpdateShared({ subCategoryId: id, subSubCategoryId: "" })}
                options={subcategoryOptions(group.shared.categoryId ?? "")}
                placeholder="— None —"
              />
            </LabeledField>
            <LabeledField label="Sub-subcategory">
              <SearchableSelect
                value={group.shared.subSubCategoryId ?? ""}
                onChange={(id) => onUpdateShared({ subSubCategoryId: id })}
                options={subSubCategoryOptions(group.shared.subCategoryId ?? "")}
                placeholder="— None —"
              />
            </LabeledField>
            <LabeledField label="Brand">
              <SearchableSelect
                value={group.shared.brandId ?? ""}
                onChange={(id) => onUpdateShared({ brandId: id })}
                options={reference.brands}
                placeholder="— None —"
              />
            </LabeledField>
            <LabeledField label="Manufacturer">
              <SearchableSelect
                value={group.shared.manufacturerId ?? ""}
                onChange={(id) => onUpdateShared({ manufacturerId: id })}
                options={reference.manufacturers}
                placeholder="— None —"
              />
            </LabeledField>
            <LabeledField label="Short description">
              <button
                type="button"
                onClick={() => onOpenDescription("shortDescription")}
                className="w-full truncate rounded-md border-[1.5px] border-border bg-white px-3 py-2 text-left text-sm text-ink hover:border-green-600"
              >
                {plainPreview(group.shared.shortDescription) || <span className="text-gray-400">Click to edit…</span>}
              </button>
            </LabeledField>
            <LabeledField label="Full description">
              <button
                type="button"
                onClick={() => onOpenDescription("description")}
                className="w-full truncate rounded-md border-[1.5px] border-border bg-white px-3 py-2 text-left text-sm text-ink hover:border-green-600"
              >
                {plainPreview(group.shared.description) || <span className="text-gray-400">Click to edit…</span>}
              </button>
            </LabeledField>
            <LabeledField label="Images">
              <button
                type="button"
                onClick={onOpenImages}
                className="w-full rounded-md border-[1.5px] border-border bg-white px-3 py-2 text-left text-sm text-ink hover:border-green-600"
              >
                {group.shared.primaryImageUrl ? "1 main" : "No main image"}
                {(group.shared.images?.length ?? 0) > 0 ? ` + ${group.shared.images!.length} more` : ""}
              </button>
            </LabeledField>
          </div>

          {effectiveSellerId && eligibility && eligibility.requirements.length > 0 && (
            <AlertBox
              tone={
                eligibility.customer.eligibleStateIds.length === 0 &&
                eligibility.dealer.eligibleStateIds.length === 0
                  ? "danger"
                  : "info"
              }
            >
              This category path requires {eligibility.requirements.length} selling licence
              {eligibility.requirements.length === 1 ? "" : "s"}. Customer:{" "}
              {eligibility.customer.eligibleStateIds.length === 0
                ? "blocked — the assigned seller does not have all the required approved selling licences."
                : eligibility.customer.isPanIndia
                  ? "approved for all states."
                  : `approved for ${eligibility.customer.eligibleStateIds.length} state(s).`}{" "}
              Dealer:{" "}
              {eligibility.dealer.eligibleStateIds.length === 0
                ? "blocked — the assigned seller does not have all the required approved selling licences."
                : eligibility.dealer.isPanIndia
                  ? "approved for all states."
                  : `approved for ${eligibility.dealer.eligibleStateIds.length} state(s).`}{" "}
              See the state availability section below for full details.
            </AlertBox>
          )}
          {isAdmin && !effectiveSellerId && (
            <AlertBox tone="warning">
              Assign a seller above to see licence eligibility and enforce state availability for this
              group.
            </AlertBox>
          )}

          <div className="grid grid-cols-1 gap-4 rounded-md border border-border bg-bg-dashboard/40 p-4 sm:grid-cols-2">
            {needsCustomer && (
              <LicenceStatesSelector
                audienceLabel="Customer state availability"
                audience="customer"
                states={reference.states}
                value={group.shared.customerStateIds ?? []}
                onChange={(ids) => onUpdateShared({ customerStateIds: ids })}
                eligibility={eligibility}
              />
            )}
            {needsDealer && (
              <LicenceStatesSelector
                audienceLabel="Dealer state availability"
                audience="dealer"
                states={reference.states}
                value={group.shared.dealerStateIds ?? []}
                onChange={(ids) => onUpdateShared({ dealerStateIds: ids })}
                eligibility={eligibility}
              />
            )}
          </div>

          <div className={`grid grid-cols-1 gap-4 rounded-md border p-4 sm:grid-cols-2 ${group.hasVariants ? "border-green-200 bg-green-50/30" : "border-border bg-bg-dashboard/40 opacity-60"}`}>
            <LabeledField label="Selected attributes">
              <ChecklistPopover
                label="Selected attributes"
                selectedIds={group.shared.selectedAttributeIds ?? []}
                onChange={(ids) => onUpdateShared({ selectedAttributeIds: ids })}
                options={reference.attributes}
                disabled={!group.hasVariants}
              />
            </LabeledField>
            <LabeledField label="Allowed attribute values (shared pool — which combinations get generated is chosen separately below, per audience)">
              <AllowedValuesEditor
                group={group}
                reference={reference}
                onChange={(values) => onUpdateShared({ attributeValues: values })}
                disabled={!group.hasVariants}
              />
            </LabeledField>
            {!group.hasVariants && (
              <p className="col-span-2 text-xs text-gray-500">
                Not applicable — this product does not have variants.
              </p>
            )}
          </div>

          {group.hasVariants && (needsCustomer || needsDealer) && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {needsCustomer && (
                <VariantGenerationPanel
                  group={group}
                  audience="CUSTOMER"
                  reference={reference}
                  onGenerate={(selected) => onGenerateForAudience("CUSTOMER", selected)}
                />
              )}
              {needsDealer && (
                <VariantGenerationPanel
                  group={group}
                  audience="DEALER"
                  reference={reference}
                  onGenerate={(selected) => onGenerateForAudience("DEALER", selected)}
                />
              )}
            </div>
          )}

          {switchWarning && (
            <AlertBox tone="warning">
              Switching to "No" will remove {group.rows.length} variant row(s) and every selected
              attribute/value for this group, converting it to one base row per audience.
              <div className="mt-2 flex gap-2">
                <Button type="button" variant="danger" size="sm" onClick={() => applyHasVariantsChange(false)}>
                  Yes, remove variants
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setSwitchWarning(false)}>
                  Cancel
                </Button>
              </div>
            </AlertBox>
          )}

          <RowsTable
            group={group}
            isAdmin={isAdmin}
            isDigital={isDigital}
            needsCustomer={needsCustomer}
            needsDealer={needsDealer}
            onUpdateRow={onUpdateRow}
            onAddRow={onAddRow}
            onDuplicateRow={onDuplicateRow}
            onDeleteRow={onDeleteRow}
            onCopyAsOtherAudience={onCopyAsOtherAudience}
          />

          {isAdmin && (
            <div className="grid grid-cols-2 gap-4 rounded-md border border-border bg-bg-dashboard/40 p-4 sm:grid-cols-4">
              <LabeledField label="Editorial badge (admin only)">
                <GridSelect
                  value={group.shared.editorialBadgeId ?? ""}
                  onChange={(v) => onUpdateShared({ editorialBadgeId: v })}
                >
                  <option value="">— None —</option>
                  {reference.editorialBadges
                    .filter((b) => b.isActive || b.id === group.shared.editorialBadgeId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </GridSelect>
              </LabeledField>
              <LabeledField label="Featured position (admin only)">
                <GridTextInput
                  type="number"
                  value={group.shared.featuredPosition != null ? String(group.shared.featuredPosition) : ""}
                  onChange={(e) => onUpdateShared({ featuredPosition: e.target.value ? Number(e.target.value) : undefined })}
                />
              </LabeledField>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      {children}
    </div>
  );
}

function plainPreview(html: string | undefined): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

function AllowedValuesEditor({
  group,
  reference,
  onChange,
  disabled,
}: {
  group: BulkGroupState;
  reference: BulkReferenceData;
  onChange: (values: NonNullable<BulkGroupState["shared"]["attributeValues"]>) => void;
  disabled: boolean;
}) {
  const selectedAttrIds = group.shared.selectedAttributeIds ?? [];
  const values = group.shared.attributeValues ?? [];
  const [open, setOpen] = useState(false);
  const [newValueText, setNewValueText] = useState<Record<string, string>>({});

  const summary =
    selectedAttrIds
      .map((attrId) => {
        const attr = reference.attributes.find((a) => a.id === attrId);
        const vals = values.filter((v) => v.attributeId === attrId).map((v) => v.value);
        return vals.length ? `${attr?.name ?? "?"}: ${vals.join(", ")}` : null;
      })
      .filter(Boolean)
      .join(" | ") || "— None —";

  function addValue(attributeId: string) {
    const text = (newValueText[attributeId] ?? "").trim();
    if (!text) return;
    const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
    if (values.some((v) => v.attributeId === attributeId && v.slug === slug)) return;
    onChange([
      ...values,
      { attributeId, value: text, slug, position: values.length, isActive: true },
    ]);
    setNewValueText((prev) => ({ ...prev, [attributeId]: "" }));
  }
  function removeValue(attributeId: string, slug: string) {
    onChange(values.filter((v) => !(v.attributeId === attributeId && v.slug === slug)));
  }

  if (disabled) {
    return <div className="rounded-md border-[1.5px] border-border bg-bg-dashboard px-3 py-2 text-sm text-gray-400">Not applicable</div>;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full truncate rounded-md border-[1.5px] border-border bg-white px-3 py-2 text-left text-sm text-ink hover:border-green-600"
      >
        {summary}
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+2px)] z-30 flex w-96 flex-col gap-3 rounded-md border border-border bg-white p-3.5 shadow-lg">
          {selectedAttrIds.length === 0 && (
            <p className="text-sm text-gray-400">Select at least one attribute first.</p>
          )}
          {selectedAttrIds.map((attrId) => {
            const attr = reference.attributes.find((a) => a.id === attrId);
            const attrValues = values.filter((v) => v.attributeId === attrId);
            return (
              <div key={attrId} className="flex flex-col gap-1.5">
                <span className="text-sm font-bold text-ink">{attr?.name ?? "?"}</span>
                <div className="flex flex-wrap gap-1">
                  {attrValues.map((v) => (
                    <span
                      key={v.slug}
                      className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs text-green-800"
                    >
                      {v.value}
                      <button type="button" onClick={() => removeValue(attrId, v.slug)} className="font-bold">
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-1">
                  <input
                    value={newValueText[attrId] ?? ""}
                    onChange={(e) => setNewValueText((prev) => ({ ...prev, [attrId]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && addValue(attrId)}
                    placeholder="Type a value, Enter to add"
                    className="w-full rounded-md border border-border px-2.5 py-1.5 text-sm outline-none focus:border-green-600"
                  />
                  <Button type="button" size="sm" variant="outline" onClick={() => addValue(attrId)}>
                    Add
                  </Button>
                </div>
              </div>
            );
          })}
          <Button type="button" size="sm" variant="primary" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * One audience's own combination picker + Generate button — Customer and
 * Dealer each get their own instance with independent local selection
 * state, so the exact same "Allowed attribute values" pool (Red/Blue,
 * S/M/L, ...) can produce a DIFFERENT set of sellable combinations per
 * audience (e.g. Customer sells every size, Dealer only sells L/XL bulk
 * packs) — mirrors product-form.tsx's VariantsEditor, which is likewise
 * instantiated once per audience against one shared attributeValues list.
 */
function VariantGenerationPanel({
  group,
  audience,
  reference,
  onGenerate,
}: {
  group: BulkGroupState;
  audience: "CUSTOMER" | "DEALER";
  reference: BulkReferenceData;
  onGenerate: (selectedByAttr: Record<string, string[]>) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const selectedAttrIds = group.shared.selectedAttributeIds ?? [];
  const values = group.shared.attributeValues ?? [];
  const existingCount = group.rows.filter((r) => r.audience === audience).length;

  function toggleValue(attributeId: string, slug: string) {
    setSelected((prev) => {
      const current = prev[attributeId] ?? [];
      const next = current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug];
      return { ...prev, [attributeId]: next };
    });
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border bg-white p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-ink">
          {audience === "CUSTOMER" ? "Customer" : "Dealer"} combinations
        </span>
        <span className="text-xs text-gray-500">{existingCount} row(s) so far</span>
      </div>
      {selectedAttrIds.length === 0 ? (
        <p className="text-xs text-gray-400">Select attributes above first.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {selectedAttrIds.map((attributeId) => {
            const attr = reference.attributes.find((a) => a.id === attributeId);
            const rows = values.filter((v) => v.attributeId === attributeId && v.isActive);
            if (rows.length === 0) return null;
            return (
              <div key={attributeId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <strong className="text-ink">{attr?.name}:</strong>
                {rows.map((v) => (
                  <label key={v.slug} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={(selected[attributeId] ?? []).includes(v.slug)}
                      onChange={() => toggleValue(attributeId, v.slug)}
                      className="h-4 w-4 accent-green-600"
                    />
                    {v.value}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={selectedAttrIds.length === 0}
        onClick={() => onGenerate(selected)}
      >
        Generate {audience === "CUSTOMER" ? "Customer" : "Dealer"} combinations
      </Button>
    </div>
  );
}

function RowsTable({
  group,
  isAdmin,
  isDigital,
  needsCustomer,
  needsDealer,
  onUpdateRow,
  onAddRow,
  onDuplicateRow,
  onDeleteRow,
  onCopyAsOtherAudience,
}: {
  group: BulkGroupState;
  isAdmin: boolean;
  isDigital: boolean;
  needsCustomer: boolean;
  needsDealer: boolean;
  onUpdateRow: (rowId: string, patch: Partial<BulkRowState["data"]>) => void;
  onAddRow: (audience: "CUSTOMER" | "DEALER") => void;
  onDuplicateRow: (rowId: string) => void;
  onDeleteRow: (rowId: string) => void;
  onCopyAsOtherAudience: (rowId: string) => void;
}) {
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  function fillDown(field: keyof BulkRowState["data"]) {
    const ids = [...selectedRowIds];
    if (ids.length < 2) {
      window.alert("Select at least two rows (checkbox on the left) to fill a value down.");
      return;
    }
    const source = group.rows.find((r) => r.id === ids[0]);
    if (!source) return;
    const value = source.data[field];
    for (const id of ids.slice(1)) {
      onUpdateRow(id, { [field]: value } as Partial<BulkRowState["data"]>);
    }
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[1680px] border-collapse text-sm">
        <thead className="sticky top-[64px] z-10 bg-bg-dashboard">
          <tr>
            <Th></Th>
            <Th sticky>Audience</Th>
            {group.hasVariants && <Th>Variant values</Th>}
            <Th>SKU base</Th>
            <Th>Final SKU</Th>
            <Th>HSN</Th>
            <Th>MRP</Th>
            <Th>Selling price</Th>
            <Th>Discount %</Th>
            <Th>Tax %</Th>
            <Th>MOQ</Th>
            <Th>Current stock</Th>
            <Th>Min qty</Th>
            <Th>Reorder level</Th>
            {!isDigital && <Th>Weight</Th>}
            {!isDigital && <Th>Dimensions (H×B×L)</Th>}
            <Th>Shipping included</Th>
            <Th>Active</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row) => (
            <RowLine
              key={row.id}
              row={row}
              isAdmin={isAdmin}
              isDigital={isDigital}
              hasVariants={group.hasVariants}
              selected={selectedRowIds.has(row.id)}
              onToggleSelect={() =>
                setSelectedRowIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(row.id)) next.delete(row.id);
                  else next.add(row.id);
                  return next;
                })
              }
              onUpdate={(patch) => onUpdateRow(row.id, patch)}
              onDuplicate={() => onDuplicateRow(row.id)}
              onDelete={() => onDeleteRow(row.id)}
              onCopyAsOtherAudience={() => onCopyAsOtherAudience(row.id)}
            />
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-2.5 border-t border-border bg-bg-dashboard/40 p-3">
        {needsCustomer && (
          <Button type="button" size="sm" variant="outline" onClick={() => onAddRow("CUSTOMER")}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Customer row
          </Button>
        )}
        {needsDealer && (
          <Button type="button" size="sm" variant="outline" onClick={() => onAddRow("DEALER")}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Dealer row
          </Button>
        )}
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="text-xs text-gray-500">{selectedRowIds.size} row(s) selected —</span>
        <Button type="button" size="sm" variant="outline" onClick={() => fillDown("mrp")}>
          Fill MRP down
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => fillDown("sellingPrice")}>
          Fill selling price down
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => fillDown("taxPercent")}>
          Fill tax % down
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => fillDown("currentStock")}>
          Fill stock down
        </Button>
      </div>
    </div>
  );
}

function Th({ children, sticky }: { children?: React.ReactNode; sticky?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap border-b border-border px-3 py-3 text-left text-[11.5px] font-bold uppercase tracking-wide text-gray-500 ${
        sticky ? "sticky left-0 z-10 bg-bg-dashboard" : ""
      }`}
    >
      {children}
    </th>
  );
}

function RowLine({
  row,
  isAdmin,
  isDigital,
  hasVariants,
  selected,
  onToggleSelect,
  onUpdate,
  onDuplicate,
  onDelete,
  onCopyAsOtherAudience,
}: {
  row: BulkRowState;
  isAdmin: boolean;
  isDigital: boolean;
  hasVariants: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onUpdate: (patch: Partial<BulkRowState["data"]>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onCopyAsOtherAudience: () => void;
}) {
  void isAdmin;
  const suffix: AudienceSkuAudience = row.audience;
  const finalSkuResult = normalizeAudienceSku(row.data.skuBase || "—", suffix);
  const finalSku = finalSkuResult.ok ? finalSkuResult.sku : "Invalid SKU";
  const isDealer = row.audience === "DEALER";

  return (
    <tr className="border-b border-border last:border-0 hover:bg-bg-dashboard/30">
      <td className="px-3 py-2">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} className="h-4 w-4 accent-green-600" />
      </td>
      <td className="sticky left-0 z-10 bg-white px-3 py-2">
        <Badge tone={row.audience === "DEALER" ? "info" : "success"}>
          {row.audience === "DEALER" ? "Dealer" : "Customer"}
        </Badge>
      </td>
      {hasVariants && (
        <td className="px-3 py-2 text-xs text-gray-600">
          {row.data.attributeValueRefs.length > 0
            ? row.data.attributeValueRefs.map((r) => r.slug).join(" / ")
            : "— generate combinations —"}
        </td>
      )}
      <td className="px-3 py-2">
        <GridTextInput value={row.data.skuBase} onChange={(e) => onUpdate({ skuBase: e.target.value })} className="w-40" />
      </td>
      <td className="px-3 py-2 font-mono text-xs text-gray-500">{finalSku}</td>
      <td className="px-3 py-2">
        <GridTextInput value={row.data.hsnCode} onChange={(e) => onUpdate({ hsnCode: e.target.value })} className="w-28" />
      </td>
      <td className="px-3 py-2">
        <GridTextInput type="number" value={row.data.mrp} onChange={(e) => onUpdate({ mrp: e.target.value })} className="w-24" />
      </td>
      <td className="px-3 py-2">
        <GridTextInput
          type="number"
          value={row.data.sellingPrice}
          onChange={(e) => onUpdate({ sellingPrice: e.target.value })}
          className="w-24"
        />
      </td>
      <td className="px-3 py-2 text-gray-500">{discountPercent(row.data.mrp, row.data.sellingPrice)}</td>
      <td className="px-3 py-2">
        <GridTextInput type="number" value={row.data.taxPercent} onChange={(e) => onUpdate({ taxPercent: e.target.value })} className="w-20" />
      </td>
      <td className="px-3 py-2">
        <GridTextInput type="number" value={row.data.minOrderQty} onChange={(e) => onUpdate({ minOrderQty: e.target.value })} className="w-20" />
      </td>
      <td className="px-3 py-2">
        <GridTextInput
          type="number"
          value={row.data.currentStock}
          onChange={(e) => onUpdate({ currentStock: e.target.value })}
          className="w-20"
        />
      </td>
      <td className="px-3 py-2">
        <GridTextInput type="number" value={row.data.minStockQty} onChange={(e) => onUpdate({ minStockQty: e.target.value })} className="w-20" />
      </td>
      <td className="px-3 py-2">
        <GridTextInput type="number" value={row.data.reorderLevel} onChange={(e) => onUpdate({ reorderLevel: e.target.value })} className="w-20" />
      </td>
      {!isDigital && (
        <td className="px-3 py-2">
          <div className="flex gap-1.5">
            <GridTextInput type="number" value={row.data.weight} onChange={(e) => onUpdate({ weight: e.target.value })} className="w-20" />
            <GridSelect value={row.data.weightUnit} onChange={(v) => onUpdate({ weightUnit: v as "G" | "KG" })}>
              <option value="G">g</option>
              <option value="KG">kg</option>
            </GridSelect>
          </div>
        </td>
      )}
      {!isDigital && (
        <td className="px-3 py-2">
          <div className="flex gap-1.5">
            <GridTextInput type="number" value={row.data.height} onChange={(e) => onUpdate({ height: e.target.value })} className="w-16" placeholder="H" />
            <GridTextInput type="number" value={row.data.breadth} onChange={(e) => onUpdate({ breadth: e.target.value })} className="w-16" placeholder="B" />
            <GridTextInput type="number" value={row.data.length} onChange={(e) => onUpdate({ length: e.target.value })} className="w-16" placeholder="L" />
            <GridSelect value={row.data.dimensionUnit} onChange={(v) => onUpdate({ dimensionUnit: v as "CM" | "M" })}>
              <option value="CM">cm</option>
              <option value="M">m</option>
            </GridSelect>
          </div>
        </td>
      )}
      <td className="px-3 py-2">
        {isDealer ? (
          <span className="text-xs text-gray-400" title="Dealer shipping is always excluded — locked">
            No (locked)
          </span>
        ) : (
          <GridSelect value={row.data.shippingIncluded} onChange={(v) => onUpdate({ shippingIncluded: v as "YES" | "NO" })}>
            <option value="YES">Yes</option>
            <option value="NO">No</option>
          </GridSelect>
        )}
      </td>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={row.data.isActive}
          onChange={(e) => onUpdate({ isActive: e.target.checked })}
          className="h-4 w-4 accent-green-600"
        />
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <div className="flex gap-1.5">
          <button type="button" onClick={onDuplicate} title="Duplicate row" className="rounded p-1.5 text-gray-400 hover:bg-bg-dashboard hover:text-ink">
            <Copy className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onCopyAsOtherAudience}
            title={row.audience === "CUSTOMER" ? "Copy as Dealer row" : "Copy as Customer row"}
            className="rounded p-1.5 text-gray-400 hover:bg-bg-dashboard hover:text-ink"
          >
            <Layers className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={onDelete} title="Delete row" className="rounded p-1.5 text-gray-400 hover:bg-danger-bg hover:text-danger">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </td>
    </tr>
  );
}
