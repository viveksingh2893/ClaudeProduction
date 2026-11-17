"use client";

import { useEffect, useState } from "react";
import { MessageCircle, Link2, Share2, Check } from "lucide-react";

/**
 * Small monogram badges rather than a new icon-library dependency —
 * lucide-react (the one icon set already used throughout this app) ships
 * no brand marks in the installed version (confirmed: Facebook/Twitter/
 * Linkedin/Instagram all undefined here), and adding a second icon
 * package for five glyphs isn't warranted. WhatsApp reuses lucide's own
 * MessageCircle instead, since a chat-bubble shape needs no brand-specific
 * path to read correctly.
 */
function Monogram({ label, className }: { label: string; className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-extrabold text-white ${className}`}
    >
      {label}
    </span>
  );
}

function ShareLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className="rounded-full transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600"
    >
      {children}
    </a>
  );
}

export function ShareBlogPanel({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && "share" in navigator);
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied by the browser — the link is still
      // visible/selectable in the address bar, so this is a soft failure.
    }
  }

  async function handleNativeShare() {
    if (!navigator.share) return;
    try {
      await navigator.share({ title, url });
    } catch {
      // AbortError when the user cancels the native sheet — not an error.
    }
  }

  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4">
      <span className="text-sm font-bold text-ink">Share:</span>

      <ShareLink
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
        label="Share on Facebook"
      >
        <Monogram label="f" className="bg-[#1877F2]" />
      </ShareLink>
      <ShareLink
        href={`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`}
        label="Share on X (Twitter)"
      >
        <Monogram label="X" className="bg-ink" />
      </ShareLink>
      <ShareLink
        href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`}
        label="Share on LinkedIn"
      >
        <Monogram label="in" className="bg-[#0A66C2]" />
      </ShareLink>
      <ShareLink
        href={`https://api.whatsapp.com/send?text=${encodedTitle}%20${encodedUrl}`}
        label="Share on WhatsApp"
      >
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#25D366] text-white"
        >
          <MessageCircle className="h-[18px] w-[18px]" fill="currentColor" aria-hidden="true" />
        </span>
      </ShareLink>
      <ShareLink
        href={`https://pinterest.com/pin/create/button/?url=${encodedUrl}&description=${encodedTitle}`}
        label="Share on Pinterest"
      >
        <Monogram label="P" className="bg-[#E60023]" />
      </ShareLink>

      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy link"
        title="Copy link"
        className="flex h-9 items-center gap-1.5 rounded-full border-[1.5px] border-border px-3 text-xs font-bold text-ink transition-colors hover:border-green-600 hover:text-green-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600"
      >
        {copied ? (
          <Check className="h-4 w-4 text-success" aria-hidden="true" />
        ) : (
          <Link2 className="h-4 w-4" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy Link"}
      </button>

      {/* Enhancement only, shown when the platform actually supports it —
          the buttons above already work as full fallbacks everywhere. */}
      {canNativeShare && (
        <button
          type="button"
          onClick={handleNativeShare}
          aria-label="More sharing options"
          title="More sharing options"
          className="flex h-9 items-center gap-1.5 rounded-full border-[1.5px] border-border px-3 text-xs font-bold text-ink transition-colors hover:border-green-600 hover:text-green-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600"
        >
          <Share2 className="h-4 w-4" aria-hidden="true" />
          More
        </button>
      )}
    </div>
  );
}
