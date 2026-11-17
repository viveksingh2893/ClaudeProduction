import { parseBulkGroupSharedData, parseBulkRowData } from "@kisan4u/validators";
import type { BulkGroupState, BulkRowState } from "./types";

type DbGroup = {
  id: string;
  groupKey: string;
  hasVariants: boolean;
  audience: BulkGroupState["audience"];
  existingProductId: string | null;
  sellerId: string | null;
  sharedData: unknown;
  rows: DbRow[];
};
type DbRow = {
  id: string;
  audience: "CUSTOMER" | "DEALER";
  existingVariantId: string | null;
  rowData: unknown;
};

/** Server-loaded draft (Prisma Json columns) -> the grid's typed client state — the one place this conversion happens, so the editor page and any future caller can't disagree on the shape. */
export function dbGroupsToState(groups: DbGroup[]): BulkGroupState[] {
  return groups.map((g) => {
    const shared = parseBulkGroupSharedData(g.sharedData);
    return {
      id: g.id,
      isNew: false,
      groupKey: g.groupKey,
      hasVariants: g.hasVariants,
      audience: g.audience,
      existingProductId: g.existingProductId,
      sellerId: g.sellerId,
      status: g.existingProductId ? "EXISTING" : "DRAFT",
      collapsed: false,
      shared,
      rows: g.rows.map(
        (r): BulkRowState => ({
          id: r.id,
          isNew: false,
          groupId: g.id,
          audience: r.audience,
          existingVariantId: r.existingVariantId,
          data: parseBulkRowData(r.rowData),
        }),
      ),
    };
  });
}
