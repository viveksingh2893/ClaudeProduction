import "server-only";
import { cookies } from "next/headers";
import {
  LANGUAGE_COOKIE,
  DEFAULT_LANGUAGE_CODE,
  isLanguageCode,
  toDbLanguage,
  type LanguageCode,
  type DbLanguage,
} from "./config";
import { getDictionary, makeT, type Dictionary, type TranslateFn } from "./translate";

/** The storefront language for the current request, from the `k4u_lang` cookie. */
export async function getLanguage(): Promise<LanguageCode> {
  const store = await cookies();
  const raw = store.get(LANGUAGE_COOKIE)?.value;
  return isLanguageCode(raw) ? raw : DEFAULT_LANGUAGE_CODE;
}

/** Same choice as getLanguage(), as the Prisma `Language` enum member. */
export async function getDbLanguage(): Promise<DbLanguage> {
  return toDbLanguage(await getLanguage());
}

export type ServerT = {
  lang: LanguageCode;
  dbLang: DbLanguage;
  dict: Dictionary;
  t: TranslateFn;
};

/** One call for a Server Component that needs both the language and `t`. */
export async function getT(): Promise<ServerT> {
  const lang = await getLanguage();
  const dict = getDictionary(lang);
  return { lang, dbLang: toDbLanguage(lang), dict, t: makeT(dict) };
}
