import { z } from "zod";

/**
 * Single source of truth for the storefront's supported content languages.
 * Shared by apps/web (the translation runtime + language switcher),
 * apps/dashboard (the per-language Banners / product-description filters)
 * and @kisan4u/catalog (per-language queries).
 *
 * Two spellings of every language travel through the system:
 *   - `code`    lowercase BCP-47-ish tag ("en", "hi", …) — used in the
 *               `k4u_lang` cookie and the <html lang> attribute.
 *   - `dbValue` the Prisma `Language` enum member ("EN", "HI", …) — stored
 *               on PromotionalAsset.language and ProductTranslation.language,
 *               and used verbatim as the dashboard `?lang=` URL param
 *               (mirrors how the audience toggle uses "CUSTOMER"/"DEALER").
 * Keep in sync with the `Language` enum in packages/db/prisma/schema.prisma.
 */
export const LANGUAGES = [
  { code: "en", dbValue: "EN", label: "English", nativeLabel: "English", shortLabel: "EN" },
  { code: "hi", dbValue: "HI", label: "Hindi", nativeLabel: "हिंदी", shortLabel: "हिं" },
  { code: "mr", dbValue: "MR", label: "Marathi", nativeLabel: "मराठी", shortLabel: "मरा" },
  { code: "te", dbValue: "TE", label: "Telugu", nativeLabel: "తెలుగు", shortLabel: "తె" },
  { code: "ta", dbValue: "TA", label: "Tamil", nativeLabel: "தமிழ்", shortLabel: "த" },
] as const;

export type LanguageMeta = (typeof LANGUAGES)[number];
export type LanguageCode = LanguageMeta["code"];
export type DbLanguage = LanguageMeta["dbValue"];

export const DEFAULT_LANGUAGE_CODE: LanguageCode = "en";
export const DEFAULT_DB_LANGUAGE: DbLanguage = "EN";

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as LanguageCode[];
export const DB_LANGUAGES = LANGUAGES.map((l) => l.dbValue) as DbLanguage[];

export const languageCodeEnum = z.enum(
  LANGUAGE_CODES as [LanguageCode, ...LanguageCode[]],
);
export const dbLanguageEnum = z.enum(
  DB_LANGUAGES as [DbLanguage, ...DbLanguage[]],
);

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && LANGUAGE_CODES.includes(value as LanguageCode);
}

export function isDbLanguage(value: unknown): value is DbLanguage {
  return typeof value === "string" && DB_LANGUAGES.includes(value as DbLanguage);
}

/** Cookie/URL code → Prisma enum member. Falls back to EN for anything unknown. */
export function toDbLanguage(code: string | null | undefined): DbLanguage {
  const hit = LANGUAGES.find((l) => l.code === code || l.dbValue === code);
  return hit ? hit.dbValue : DEFAULT_DB_LANGUAGE;
}

/** Prisma enum member → lowercase code. Falls back to "en". */
export function toLanguageCode(dbValue: string | null | undefined): LanguageCode {
  const hit = LANGUAGES.find((l) => l.dbValue === dbValue || l.code === dbValue);
  return hit ? hit.code : DEFAULT_LANGUAGE_CODE;
}

export function languageMeta(codeOrDb: string | null | undefined): LanguageMeta {
  return (
    LANGUAGES.find((l) => l.code === codeOrDb || l.dbValue === codeOrDb) ?? LANGUAGES[0]
  );
}

/** Name of the cookie the storefront reads to pick a content language. */
export const LANGUAGE_COOKIE = "k4u_lang";
