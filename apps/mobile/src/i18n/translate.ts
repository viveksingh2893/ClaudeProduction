/**
 * Translation helpers for the app — ported verbatim from
 * apps/web/src/i18n/translate.ts so the storefront and the app share the
 * same dictionary shape and lookup rules. The only difference: the active
 * language comes from LanguageProvider (context + secure-store), not a
 * cookie.
 */
import { DEFAULT_LANGUAGE_CODE, type LanguageCode } from "@kisan4u/validators";
import { en, type Dictionary } from "./dictionaries/en";
import { hi } from "./dictionaries/hi";
import { mr } from "./dictionaries/mr";
import { te } from "./dictionaries/te";
import { ta } from "./dictionaries/ta";

export type { Dictionary };

export const dictionaries: Record<LanguageCode, Dictionary> = { en, hi, mr, te, ta };

export function getDictionary(lang: LanguageCode): Dictionary {
  return dictionaries[lang] ?? dictionaries[DEFAULT_LANGUAGE_CODE];
}

function resolvePath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

export type TranslateFn = (path: string, vars?: Record<string, string | number>) => string;

/**
 * Lookup order: active language → English → the key itself (never blank).
 * `{name}` placeholders are interpolated from `vars`.
 */
export function makeT(dict: Dictionary): TranslateFn {
  return (path, vars) => {
    const raw = resolvePath(dict, path) ?? resolvePath(en, path) ?? path;
    const value = typeof raw === "string" ? raw : path;
    if (!vars) return value;
    return value.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
  };
}
