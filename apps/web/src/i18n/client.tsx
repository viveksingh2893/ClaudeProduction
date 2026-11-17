"use client";

import { createContext, useContext, useMemo } from "react";
import { getDictionary, makeT, type Dictionary, type TranslateFn } from "./translate";
import { DEFAULT_LANGUAGE_CODE, type LanguageCode } from "./config";

type I18nValue = {
  lang: LanguageCode;
  dict: Dictionary;
  t: TranslateFn;
};

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Wraps the app so Client Components can call useT(). The chosen language
 * comes from the Server layout (which read the cookie); the dictionaries
 * themselves are bundled (chrome strings only — a few KB) so client-side
 * fallback to English works without another round-trip.
 */
export function I18nProvider({
  lang,
  children,
}: {
  lang: LanguageCode;
  children: React.ReactNode;
}) {
  const value = useMemo<I18nValue>(() => {
    const dict = getDictionary(lang);
    return { lang, dict, t: makeT(dict) };
  }, [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  // Defensive: a client component rendered outside the provider still gets
  // working English rather than a thrown error.
  const dict = getDictionary(DEFAULT_LANGUAGE_CODE);
  return { lang: DEFAULT_LANGUAGE_CODE, dict, t: makeT(dict) };
}

export function useT(): TranslateFn {
  return useI18n().t;
}
