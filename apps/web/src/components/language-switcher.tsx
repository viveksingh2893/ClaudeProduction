"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Globe } from "lucide-react";
import { LANGUAGES, type LanguageCode } from "@/i18n/config";
import { useT } from "@/i18n/client";
import { setLanguageAction } from "@/i18n/actions";

/**
 * Language picker for the green utility ribbon (PromoHeader). A native
 * <select> is layered transparently over the visible chip so it opens the
 * OS-native picker on mobile and a plain dropdown on desktop — no portal,
 * accessible for free. On mobile only the globe shows (so all three ribbon
 * controls fit on one line); from `sm:` up the current language and a
 * caret are shown too.
 */
export function LanguageSwitcher({ current }: { current: LanguageCode }) {
  const router = useRouter();
  const t = useT();
  const [isPending, startTransition] = useTransition();

  const currentMeta = LANGUAGES.find((l) => l.code === current) ?? LANGUAGES[0];
  const currentLabel = currentMeta.code === "en" ? currentMeta.label : currentMeta.nativeLabel;

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    if (next === current) return;
    startTransition(async () => {
      await setLanguageAction(next);
      router.refresh();
    });
  }

  return (
    <div
      className={`relative inline-flex shrink-0 items-center gap-1 rounded-full border border-white/40 py-1 pl-2 pr-2 text-white transition-opacity hover:bg-white/10 sm:pr-1.5 ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="hidden text-xs font-bold sm:inline">{currentLabel}</span>
      <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-80 sm:block" aria-hidden="true" />
      <select
        value={current}
        onChange={onChange}
        disabled={isPending}
        aria-label={t("ribbon.chooseLanguage")}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 [&>option]:text-ink"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.code === "en" ? l.label : l.nativeLabel}
          </option>
        ))}
      </select>
    </div>
  );
}
