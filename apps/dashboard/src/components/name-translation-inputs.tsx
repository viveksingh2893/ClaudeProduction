"use client";

import { FormInput } from "@kisan4u/ui";
import { languageMeta, type CategoryNameTranslationInput } from "@kisan4u/validators";

export const NON_ENGLISH_DB_LANGS = ["HI", "MR", "TE", "TA"] as const;
export type NonEnglishDbLang = (typeof NON_ENGLISH_DB_LANGS)[number];
export type NameTranslationMap = Record<NonEnglishDbLang, string>;

export const EMPTY_NAME_TRANSLATIONS: NameTranslationMap = { HI: "", MR: "", TE: "", TA: "" };

/** Seed the editable map from stored `{ language, name }[]` translation rows. */
export function nameTranslationsFromRows(
  rows: { language: string; name: string | null }[] | undefined,
): NameTranslationMap {
  const map = { ...EMPTY_NAME_TRANSLATIONS };
  for (const r of rows ?? []) {
    if ((NON_ENGLISH_DB_LANGS as readonly string[]).includes(r.language)) {
      map[r.language as NonEnglishDbLang] = r.name ?? "";
    }
  }
  return map;
}

/** Convert the editable map to the action payload (all four langs always sent, so cleared ones get deleted server-side). */
export function nameTranslationsToPayload(
  map: NameTranslationMap,
): CategoryNameTranslationInput[] {
  return NON_ENGLISH_DB_LANGS.map((lang) => ({ language: lang, name: map[lang] || undefined }));
}

/**
 * The "Name in other languages" block — the same pattern as the product
 * form's Basic-info name row (apps/dashboard/src/components/product-form.tsx).
 * Each is optional and falls back to the English name on the storefront.
 */
export function NameTranslationInputs({
  value,
  onChange,
  englishName,
  disabled,
  label = "Name in other languages",
}: {
  value: NameTranslationMap;
  onChange: (next: NameTranslationMap) => void;
  englishName: string;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3 sm:col-span-2">
      <span className="text-xs font-semibold text-gray-600">
        {label}{" "}
        <span className="font-normal text-gray-400">
          — optional; each falls back to the English name on the storefront and app
        </span>
      </span>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {NON_ENGLISH_DB_LANGS.map((lang) => (
          <FormInput
            key={`name-${lang}`}
            label={`Name in ${languageMeta(lang).label} (${languageMeta(lang).nativeLabel})`}
            placeholder={englishName || "Same as English"}
            value={value[lang]}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, [lang]: e.target.value })}
          />
        ))}
      </div>
    </div>
  );
}
