"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import {
  META_CONSENT_COOKIE,
  META_CONSENT_MAX_AGE,
  isTrackableHost,
  type MetaConsent,
  type MetaUserMatch,
} from "@/lib/meta/shared";
import { loadMetaPixelScript, markMetaPixelStarted, trackMetaEvent } from "@/lib/meta/track";

/** Fired by the footer's "Cookie settings" link to show the banner again. */
export const OPEN_COOKIE_SETTINGS_EVENT = "k4u:open-cookie-settings";

/**
 * Cookie consent banner + Meta Pixel loader (root layout). Nothing from
 * Meta loads until the visitor taps Accept; declining (now or later, via
 * the footer's "Cookie settings") keeps / turns it off. After Accept the
 * page refreshes its server data so the layout can pass the signed-in
 * buyer's hashed match data (`userMatch`), then the pixel starts and a
 * PageView fires on every route change.
 */
export function MetaTracking({
  pixelId,
  serverConsent,
  userMatch,
}: {
  /** NEXT_PUBLIC_META_PIXEL_ID — null means tracking is off entirely (no banner either). */
  pixelId: string | null;
  /** The consent cookie as the server read it for this render. */
  serverConsent: MetaConsent | null;
  userMatch: MetaUserMatch;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [bannerOpen, setBannerOpen] = useState(!!pixelId && serverConsent === null);
  const [pixelReady, setPixelReady] = useState(false);
  const lastPageView = useRef<string | null>(null);

  useEffect(() => {
    const open = () => setBannerOpen(true);
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, open);
  }, []);

  // Start the pixel once the server has seen the consent (so userMatch is
  // present). Runs once — later router.refresh() calls hand in a new
  // userMatch object but must not re-init.
  useEffect(() => {
    if (pixelReady || !pixelId || serverConsent !== "granted") return;
    if (!isTrackableHost(window.location.hostname)) return;
    loadMetaPixelScript();
    window.fbq?.("consent", "grant");
    // Turn off Meta's automatic configuration, which otherwise reports every
    // button tap as a "SubscribedButtonClick" event (plus page microdata) —
    // noise next to the events we send ourselves. Must come before init.
    window.fbq?.("set", "autoConfig", false, pixelId);
    window.fbq?.("init", pixelId, userMatch);
    markMetaPixelStarted();
    setPixelReady(true);
  }, [pixelReady, pixelId, serverConsent, userMatch]);

  // One PageView per route (the first one included).
  useEffect(() => {
    if (!pixelReady || lastPageView.current === pathname) return;
    lastPageView.current = pathname;
    trackMetaEvent("PageView");
  }, [pixelReady, pathname]);

  function choose(consent: MetaConsent) {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${META_CONSENT_COOKIE}=${consent}; Path=/; Max-Age=${META_CONSENT_MAX_AGE}; SameSite=Lax${secure}`;
    setBannerOpen(false);
    if (consent === "denied") window.fbq?.("consent", "revoke");
    router.refresh();
  }

  if (!bannerOpen) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t("cookieConsent.title")}
      className="fixed inset-x-3 bottom-20 z-50 mx-auto max-w-xl rounded-xl border border-border bg-white p-4 shadow-lg md:bottom-4"
    >
      <p className="text-sm font-bold text-ink">{t("cookieConsent.title")}</p>
      <p className="mt-1 text-xs leading-relaxed text-gray-600">
        {t("cookieConsent.message")}{" "}
        <Link href="/privacy" className="font-semibold text-green-700 underline">
          {t("cookieConsent.privacy")}
        </Link>
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => choose("granted")}
          className="flex-1 rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white hover:bg-green-800"
        >
          {t("cookieConsent.accept")}
        </button>
        <button
          type="button"
          onClick={() => choose("denied")}
          className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
        >
          {t("cookieConsent.decline")}
        </button>
      </div>
    </div>
  );
}

/** Footer link that reopens the banner so a visitor can change their choice. */
export function CookieSettingsLink({ className }: { className?: string }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS_EVENT))}
      className={className}
    >
      {t("cookieConsent.settings")}
    </button>
  );
}
