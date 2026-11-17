import type { BulkGroupSharedDataInput, BulkRowDataInput } from "@kisan4u/validators";

export type BulkReferenceData = {
  categories: Array<{ id: string; name: string }>;
  subcategories: Array<{ id: string; name: string; categoryId: string }>;
  subSubCategories: Array<{ id: string; name: string; subCategoryId: string }>;
  brands: Array<{ id: string; name: string }>;
  manufacturers: Array<{ id: string; name: string }>;
  attributes: Array<{ id: string; name: string }>;
  states: Array<{ id: string; name: string }>;
  /** Admin-only — always [] for a seller (see the seller reference-data loader). */
  editorialBadges: Array<{ id: string; name: string; isActive: boolean }>;
  /** Admin-only — always [] for a seller (a seller can only ever create for themselves). Name here is shopName. */
  sellers: Array<{ id: string; name: string }>;
};

export type BulkAudience = "CUSTOMER" | "DEALER";
export type BulkGroupAudience = "CUSTOMER_ONLY" | "DEALER_ONLY" | "BOTH_CUSTOMER_AND_DEALER";

export type BulkRowState = {
  id: string; // real DB id once saved, a client-minted temp id before first save
  isNew: boolean;
  groupId: string;
  audience: BulkAudience;
  existingVariantId: string | null;
  data: Required<BulkRowDataInput> & { attributeValueRefs: NonNullable<BulkRowDataInput["attributeValueRefs"]> };
};

export type BulkGroupState = {
  id: string;
  isNew: boolean;
  groupKey: string;
  hasVariants: boolean;
  audience: BulkGroupAudience | null;
  existingProductId: string | null;
  /** Admin-only assignment of which seller a NEW product will be created under — see bulk-product-draft.ts's upsertBulkGroup. Always null on a seller-owned draft (irrelevant there; a seller always creates for themselves). Ignored by submission once existingProductId is set (an UPDATE re-derives the real owner from the product itself). */
  sellerId: string | null;
  status: "NEW" | "DRAFT" | "EXISTING";
  collapsed: boolean;
  shared: BulkGroupSharedDataInput;
  rows: BulkRowState[];
};

export type CellErrorMap = Record<string, string>; // key: `${groupId}` or `${rowId}.${field}`
