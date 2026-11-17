"use client";

import { useState } from "react";

/**
 * Referral code + shareable deep link with one-tap sharing to the common
 * channels. The link is `https://<host>/r/<CODE>` — an Android App Link /
 * iOS Universal Link, so on a phone with the app installed it opens the
 * app straight to sign-up with the code pre-filled; everywhere else it
 * opens the website sign-in with the code pre-filled.
 */
export function ShareReferral({ code, url }: { code: string; url: string }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  const message = `Join Kisan4U with my referral code ${code} and shop seeds, fertilizers & equipment. Sign up here: ${url}`;
  const enc = encodeURIComponent;

  const targets: { label: string; href: string; className: string }[] = [
    {
      label: "WhatsApp",
      href: `https://wa.me/?text=${enc(message)}`,
      className: "bg-[#25D366] text-white",
    },
    {
      label: "X",
      href: `https://twitter.com/intent/tweet?text=${enc(
        `Join Kisan4U with my referral code ${code}`,
      )}&url=${enc(url)}`,
      className: "bg-black text-white",
    },
    {
      label: "Telegram",
      href: `https://t.me/share/url?url=${enc(url)}&text=${enc(
        `Join Kisan4U with my referral code ${code}`,
      )}`,
      className: "bg-[#229ED9] text-white",
    },
    {
      label: "Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
      className: "bg-[#1877F2] text-white",
    },
  ];

  async function copy(what: "code" | "link") {
    try {
      await navigator.clipboard.writeText(what === "code" ? code : url);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard blocked — the value is visible on screen to copy manually */
    }
  }

  async function nativeShare() {
    try {
      await navigator.share?.({ title: "Kisan4U referral", text: message, url });
    } catch {
      /* user dismissed the share sheet */
    }
  }

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div>
      <div className="text-sm text-gray-600">Your referral code</div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-2xl font-extrabold tracking-wide text-green-800">{code}</span>
        <button
          onClick={() => copy("code")}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
        >
          {copied === "code" ? "Copied ✓" : "Copy code"}
        </button>
      </div>

      <div className="mt-3 break-all rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">{url}</div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => copy("link")}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          {copied === "link" ? "Link copied ✓" : "Copy link"}
        </button>
        {canNativeShare && (
          <button
            onClick={nativeShare}
            className="rounded-lg bg-green-700 px-3 py-1.5 text-sm font-semibold text-white"
          >
            Share…
          </button>
        )}
        {targets.map((t) => (
          <a
            key={t.label}
            href={t.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${t.className}`}
          >
            {t.label}
          </a>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-400">
        For Instagram, use “Share…” on a phone, or copy the link into your story/DM.
      </p>
    </div>
  );
}
