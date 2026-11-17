"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { usePathname } from "next/navigation";

const PACKAGE_NAME = "com.kisan4u.katra";
const STAY_UNTIL_KEY = "kisan4u:web-stay-until";
const DISMISS_KEY = "kisan4u:app-prompt-dismissed";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SUPPORTED_PATHS = [
  /^\/products\/[^/]+\/?$/,
  /^\/dealer\/products\/[^/]+\/?$/,
  /^\/c\/[^/]+(?:\/[^/]+){0,2}\/?$/,
  /^\/crops\/[^/]+\/?$/,
  /^\/pest-disease\/[^/]+\/?$/,
  /^\/register\/dealer\/?$/,
  /^\/account\/ba\/?$/,
];

type RelatedApplication = { platform?: string; id?: string };

declare global {
  interface Navigator {
    getInstalledRelatedApps?: () => Promise<RelatedApplication[]>;
  }
}

export function OpenInAppPrompt() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [installed, setInstalled] = useState(false);
  const supported = useMemo(
    () => SUPPORTED_PATHS.some((pattern) => pattern.test(pathname)),
    [pathname],
  );

  useEffect(() => {
    setVisible(false);
    if (!supported || !/Android/i.test(navigator.userAgent)) return;
    const now = Date.now();
    if (Number(localStorage.getItem(STAY_UNTIL_KEY) || 0) > now) return;
    if (sessionStorage.getItem(DISMISS_KEY) === pathname) return;

    let cancelled = false;
    const detect = async () => {
      try {
        const apps = await navigator.getInstalledRelatedApps?.();
        if (!cancelled)
          setInstalled(!!apps?.some((app) => app.platform === "play" && app.id === PACKAGE_NAME));
      } catch {
        // Detection is not available in many in-app browsers; show the compact prompt.
      }
      if (!cancelled) setVisible(true);
    };
    void detect();
    return () => {
      cancelled = true;
    };
  }, [pathname, supported]);

  if (!visible) return null;

  const pageUrl = window.location.href;
  const intentPath = `${window.location.host}${pathname}${window.location.search}`;
  const intentUrl = `intent://${intentPath}#Intent;scheme=https;package=${PACKAGE_NAME};S.browser_fallback_url=${encodeURIComponent(pageUrl)};end`;

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, pathname);
    setVisible(false);
  }

  function stayOnSite() {
    localStorage.setItem(STAY_UNTIL_KEY, String(Date.now() + SEVEN_DAYS_MS));
    setVisible(false);
  }

  return (
    <aside
      className={`fixed inset-x-3 z-[80] rounded-2xl border border-green-200 bg-white p-4 shadow-2xl ${installed ? "bottom-4" : "bottom-20 md:bottom-4"}`}
      aria-label="Open in Kisan4U app"
    >
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-3 top-3 rounded-full p-1 text-gray-500"
        aria-label="Dismiss"
      >
        <X className="h-5 w-5" aria-hidden />
      </button>
      <p className="pr-8 font-bold text-ink">
        {installed ? "Open this page in Kisan4U?" : "Have the Kisan4U app?"}
      </p>
      {installed && (
        <p className="mt-1 text-sm text-gray-600">
          Continue exactly where you left off in the app.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={intentUrl}
          className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-bold text-white"
        >
          <ExternalLink className="h-4 w-4" aria-hidden /> Open in app
        </a>
        {installed && (
          <button
            type="button"
            onClick={stayOnSite}
            className="rounded-lg border border-border px-4 py-2 text-sm font-bold text-ink"
          >
            Continue on website
          </button>
        )}
      </div>
    </aside>
  );
}
