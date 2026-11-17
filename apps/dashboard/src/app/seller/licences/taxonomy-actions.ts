"use server";

import { getActiveRequirementsForTaxonomyNode } from "@kisan4u/catalog";
import { requireApprovedSeller } from "@/lib/require-approved-seller";

export async function getActiveRequirementsForNodeAction(
  nodeType: "CATEGORY" | "SUBCATEGORY" | "SUBSUBCATEGORY",
  nodeId: string,
) {
  await requireApprovedSeller();
  const data = await getActiveRequirementsForTaxonomyNode(nodeType, nodeId);
  return { ok: true as const, data };
}
