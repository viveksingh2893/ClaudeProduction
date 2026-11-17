"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  LANGUAGE_COOKIE,
  LANGUAGE_COOKIE_MAX_AGE,
  DEFAULT_LANGUAGE_CODE,
  isLanguageCode,
} from "./config";

/**
 * Persist the storefront language choice in the `k4u_lang` cookie and
 * re-render every route so server-rendered chrome + per-language content
 * (banners, product descriptions) pick it up. Called by the language
 * switcher in the green ribbon.
 */
export async function setLanguageAction(lang: string): Promise<void> {
  const value = isLanguageCode(lang) ? lang : DEFAULT_LANGUAGE_CODE;
  const store = await cookies();
  store.set(LANGUAGE_COOKIE, value, {
    path: "/",
    maxAge: LANGUAGE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}
