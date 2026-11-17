import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as SecureStore from "expo-secure-store";
import {
  DEFAULT_LANGUAGE_CODE,
  isLanguageCode,
  toDbLanguage,
  type DbLanguage,
  type LanguageCode,
} from "@kisan4u/validators";
import { getDictionary, makeT, type TranslateFn } from "@/i18n/translate";

/**
 * The app's content language — the mobile equivalent of the storefront's
 * `k4u_lang` cookie (see apps/web/src/i18n). Chosen from the language
 * switcher in the green utility ribbon, persisted to the device, and sent
 * as `?lang=` on catalog API calls so banners / product text come back
 * localized. `t()` translates the app's own chrome from the same
 * dictionaries the website uses.
 */

const LANG_KEY = "kisan4u.lang";

type LanguageContextValue = {
  lang: LanguageCode;
  /** Prisma enum form (EN/HI/MR/TE/TA) — pass to the API as ?lang=. */
  dbLang: DbLanguage;
  setLang: (next: LanguageCode) => void;
  t: TranslateFn;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LanguageCode>(DEFAULT_LANGUAGE_CODE);

  useEffect(() => {
    SecureStore.getItemAsync(LANG_KEY)
      .then((stored) => {
        if (stored && isLanguageCode(stored)) setLangState(stored);
      })
      .catch(() => {});
  }, []);

  const setLang = useCallback((next: LanguageCode) => {
    setLangState(next);
    SecureStore.setItemAsync(LANG_KEY, next).catch(() => {});
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      dbLang: toDbLanguage(lang),
      setLang,
      t: makeT(getDictionary(lang)),
    }),
    [lang, setLang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside <LanguageProvider>.");
  return ctx;
}

/** Convenience for components that only need the translate fn. */
export function useT(): TranslateFn {
  return useLanguage().t;
}
