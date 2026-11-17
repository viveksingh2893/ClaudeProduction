/**
 * Isomorphic translation helpers — safe to import from both Server and
 * Client Components (no next/headers, no "server-only"). The server entry
 * (./server.ts) reads the cookie and hands the chosen language here; the
 * client provider (./client.tsx) does the same from a prop.
 */
import { en, type Dictionary } from "./dictionaries/en";
import { hi } from "./dictionaries/hi";
import { mr } from "./dictionaries/mr";
import { te } from "./dictionaries/te";
import { ta } from "./dictionaries/ta";
import { DEFAULT_LANGUAGE_CODE, type LanguageCode } from "./config";

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

export type TranslateFn = (
  path: string,
  vars?: Record<string, string | number>,
) => string;

/**
 * Returns `t(key)` for a dictionary. Lookup order: the active language →
 * English → the key itself (so a typo or an un-added key is visible in dev
 * but never renders blank in production). `{name}`-style placeholders are
 * interpolated from `vars`.
 */
export function makeT(dict: Dictionary): TranslateFn {
  return (path, vars) => {
    const raw = resolvePath(dict, path) ?? resolvePath(en, path) ?? path;
    const value = typeof raw === "string" ? raw : path;
    if (!vars) return value;
    return value.replace(/\{(\w+)\}/g, (_, k: string) =>
      k in vars ? String(vars[k]) : `{${k}}`,
    );
  };
}
