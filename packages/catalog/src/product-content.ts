import { type DbLanguage, DEFAULT_DB_LANGUAGE } from "@kisan4u/validators";

/**
 * Resolves a product's translatable text (name + the six rich-text
 * description fields) for a storefront viewer's language. English lives on
 * the Product row and is both the source language and the per-field
 * fallback: for a non-English viewer, each field comes from the matching
 * ProductTranslation row when that field is non-empty there, otherwise from
 * the English column. So a product with only its `description` translated
 * still shows its English name / ingredients / how-to-use / etc., never a
 * blank.
 */
export type ProductDescriptionFields = {
  name: string;
  shortDescription: string;
  description: string;
  ingredients: string | null;
  howToUse: string | null;
  dosageInstructions: string | null;
  technicalInfo: string | null;
};

type TranslationRow = {
  language: string;
  name?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  ingredients?: string | null;
  howToUse?: string | null;
  dosageInstructions?: string | null;
  technicalInfo?: string | null;
};

type LocalizableProduct = {
  name: string;
  shortDescription: string;
  description: string;
  ingredients?: string | null;
  howToUse?: string | null;
  dosageInstructions?: string | null;
  technicalInfo?: string | null;
  translations?: TranslationRow[];
};

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? (value as string) : null;
}

/**
 * Just the display name for a viewer's language — the light path for
 * product cards / listings, which don't need the description fields.
 * `translations` only needs `{ language, name }` selected.
 */
export function resolveProductName(
  product: { name: string; translations?: { language: string; name?: string | null }[] },
  language: DbLanguage = DEFAULT_DB_LANGUAGE,
): string {
  if (language === DEFAULT_DB_LANGUAGE) return product.name;
  const tr = product.translations?.find((t) => t.language === language);
  return nonEmpty(tr?.name) ?? product.name;
}

export function resolveProductContent(
  product: LocalizableProduct,
  language: DbLanguage = DEFAULT_DB_LANGUAGE,
): ProductDescriptionFields {
  const base: ProductDescriptionFields = {
    name: product.name,
    shortDescription: product.shortDescription,
    description: product.description,
    ingredients: nonEmpty(product.ingredients),
    howToUse: nonEmpty(product.howToUse),
    dosageInstructions: nonEmpty(product.dosageInstructions),
    technicalInfo: nonEmpty(product.technicalInfo),
  };
  if (language === DEFAULT_DB_LANGUAGE) return base;

  const tr = product.translations?.find((t) => t.language === language);
  if (!tr) return base;

  return {
    name: nonEmpty(tr.name) ?? base.name,
    shortDescription: nonEmpty(tr.shortDescription) ?? base.shortDescription,
    description: nonEmpty(tr.description) ?? base.description,
    ingredients: nonEmpty(tr.ingredients) ?? base.ingredients,
    howToUse: nonEmpty(tr.howToUse) ?? base.howToUse,
    dosageInstructions: nonEmpty(tr.dosageInstructions) ?? base.dosageInstructions,
    technicalInfo: nonEmpty(tr.technicalInfo) ?? base.technicalInfo,
  };
}
