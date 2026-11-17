import { type DbLanguage, DEFAULT_DB_LANGUAGE } from "@kisan4u/validators";

/**
 * Display name of a category / subcategory / sub-sub-category for a
 * storefront viewer's language. The English `name` column is the source
 * and the fallback: for a non-English viewer the name comes from the
 * matching translation row when it has a non-empty `name`, otherwise from
 * the English column. Works for all three hierarchy levels since they
 * share the shape `{ name, translations?: [{ language, name }] }`.
 *
 * `translations` only needs `{ language, name }` selected.
 */
export function resolveCategoryName(
  node: { name: string; translations?: { language: string; name?: string | null }[] } | null | undefined,
  language: DbLanguage = DEFAULT_DB_LANGUAGE,
): string {
  if (!node) return "";
  if (language === DEFAULT_DB_LANGUAGE) return node.name;
  const tr = node.translations?.find((t) => t.language === language);
  const translated = (tr?.name ?? "").trim();
  return translated.length > 0 ? (tr!.name as string) : node.name;
}

/**
 * Same fallback rule as resolveCategoryName, for the optional descriptive
 * paragraph shown on a category / sub-category / sub-sub-category page.
 * Returns "" (never null) when neither the English column nor the
 * matching translation has anything — callers just skip rendering when
 * this comes back empty, same as an absent imageUrl/emoji.
 */
export function resolveCategoryDescription(
  node:
    | { description?: string | null; translations?: { language: string; description?: string | null }[] }
    | null
    | undefined,
  language: DbLanguage = DEFAULT_DB_LANGUAGE,
): string {
  if (!node) return "";
  const english = (node.description ?? "").trim();
  if (language === DEFAULT_DB_LANGUAGE) return english;
  const tr = node.translations?.find((t) => t.language === language);
  const translated = (tr?.description ?? "").trim();
  return translated.length > 0 ? translated : english;
}
