"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { LANGUAGES, type DbLanguage } from "@kisan4u/validators";
import { LanguageTabs } from "@/components/language-tabs";

const OPTIONS: { value: DbLanguage; label: string }[] = LANGUAGES.map((l) => ({
  value: l.dbValue,
  label: l.code === "en" ? "English" : l.nativeLabel,
}));

/**
 * URL-driven (?lang=EN|HI|MR|TE|TA), the same convention as the sibling
 * AudienceToggle — reload / back-forward restores which language's banners
 * you were managing. All three banner sections (hero, second, coupon)
 * re-scope together, so you upload a full set per language.
 */
export function LanguageToggle({ language }: { language: DbLanguage }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setLanguage(next: DbLanguage) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "EN") params.delete("lang");
    else params.set("lang", next);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <LanguageTabs
      options={OPTIONS}
      value={language}
      onChange={setLanguage}
      ariaLabel="Banner language"
      className="w-full sm:w-auto"
    />
  );
}
