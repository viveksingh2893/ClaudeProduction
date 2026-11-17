import type { Prisma, PrismaClient } from "@kisan4u/db";
import type { CategoryNameTranslationInput } from "@kisan4u/validators";

type Tx = Prisma.TransactionClient | PrismaClient;

/** Which hierarchy level's translation table + FK column to write. */
type Level = "category" | "subcategory" | "subSubCategory";

const CONFIG = {
  category: { delegate: "categoryTranslation", fk: "categoryId" },
  subcategory: { delegate: "subcategoryTranslation", fk: "subCategoryId" },
  subSubCategory: { delegate: "subSubCategoryTranslation", fk: "subSubCategoryId" },
} as const;

/**
 * Upsert/delete per-language name overrides for one category-hierarchy row,
 * mirroring the ProductTranslation loop in
 * packages/catalog/src/product-submission.ts:
 *   - `nameTranslations` undefined  -> existing rows left untouched
 *   - an entry with a blank name    -> that language's row is deleted
 *   - an entry with a name          -> upserted
 * Runs against the caller's `tx` so it commits with the row create/update.
 */
export async function applyCategoryNameTranslations(
  tx: Tx,
  level: Level,
  rowId: string,
  nameTranslations: CategoryNameTranslationInput[] | undefined,
): Promise<void> {
  if (!nameTranslations) return;
  const { delegate, fk } = CONFIG[level];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- delegate name is a runtime string
  const model = (tx as any)[delegate];
  for (const tr of nameTranslations) {
    const name = (tr.name ?? "").trim();
    if (!name) {
      await model.deleteMany({ where: { [fk]: rowId, language: tr.language } });
      continue;
    }
    await model.upsert({
      where: { [`${fk}_language`]: { [fk]: rowId, language: tr.language } },
      create: { [fk]: rowId, language: tr.language, name },
      update: { name },
    });
  }
}
