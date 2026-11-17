/**
 * Storefront i18n — the customer + dealer front end supports five content
 * languages (English, Hindi, Marathi, Telugu, Tamil). The supported set and
 * the code⇄DB-enum mapping live in @kisan4u/validators so apps/dashboard and
 * @kisan4u/catalog share exactly the same list; this module just re-exports
 * that plus the storefront-only pieces.
 *
 * How a language is chosen: the `k4u_lang` cookie (set by the language
 * switcher in the green ribbon via setLanguageAction). No URL-locale
 * segment — every page keeps its existing path; only the cookie changes.
 */
export {
  LANGUAGES,
  LANGUAGE_CODES,
  DB_LANGUAGES,
  DEFAULT_LANGUAGE_CODE,
  DEFAULT_DB_LANGUAGE,
  LANGUAGE_COOKIE,
  languageCodeEnum,
  dbLanguageEnum,
  isLanguageCode,
  isDbLanguage,
  toDbLanguage,
  toLanguageCode,
  languageMeta,
  type LanguageCode,
  type DbLanguage,
  type LanguageMeta,
} from "@kisan4u/validators";

/** One year — the switch is an explicit, sticky user choice. */
export const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
