"use client";

import { useRef, useState, useTransition } from "react";
import { Button, Card, AlertBox } from "@kisan4u/ui";
import { buildStorefrontAssetUrl } from "@/lib/storefront-url";
import { saveAppLoginVideoAction, uploadAppLoginVideoAction } from "./actions";

export function AppLoginVideoManager({
  currentUrl,
  storefrontBaseUrl,
}: {
  currentUrl: string | null;
  storefrontBaseUrl: string | null;
}) {
  const [url, setUrl] = useState(currentUrl ?? "");
  const [savedUrl, setSavedUrl] = useState(currentUrl ?? "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, startSaving] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const previewSrc = url ? buildStorefrontAssetUrl(url, storefrontBaseUrl) : null;
  const dirty = url.trim() !== savedUrl.trim();

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    const result = await uploadAppLoginVideoAction(file);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setUrl(result.url);
    setSaved(false);
  }

  function handleSave(next: string | null) {
    setError(null);
    startSaving(async () => {
      const result = await saveAppLoginVideoAction(next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const applied = next ?? "";
      setUrl(applied);
      setSavedUrl(applied);
      setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-5">
        <div>
          <h2 className="text-base font-bold text-ink">Background video</h2>
          <p className="mt-1 text-sm text-gray-600">
            A silent, looping clip shown behind the Kisan4U app&rsquo;s login screen. Leave it empty
            and the app shows a plain branded gradient instead.
          </p>
          <ul className="mt-2 list-disc pl-5 text-xs text-gray-500">
            <li>MP4 (H.264), no audio · portrait 1080×1920 (9:16) · 8–15 s, seamless loop · 30 fps</li>
            <li>Keep it under 5 MB where you can; hard limit 20 MB (drop to 720×1280 if larger)</li>
            <li>Dark / low-contrast footage — white text sits over the top and bottom</li>
          </ul>
        </div>

        {error && <AlertBox tone="danger">{error}</AlertBox>}
        {saved && <AlertBox tone="success">Saved. The app picks it up on next launch.</AlertBox>}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink">Upload a video file</span>
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            disabled={uploading || isSaving}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-green-700 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
          />
          {uploading && <span className="text-xs text-gray-500">Uploading…</span>}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink">…or paste a direct video URL</span>
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setSaved(false);
            }}
            placeholder="https://…/login.mp4"
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={!dirty || uploading || isSaving}
            onClick={() => handleSave(url.trim() || null)}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
          {savedUrl ? (
            <Button
              variant="outline"
              disabled={uploading || isSaving}
              onClick={() => handleSave(null)}
            >
              Remove video
            </Button>
          ) : null}
        </div>
      </Card>

      {previewSrc && (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-base font-bold text-ink">Preview</h2>
          <video
            key={previewSrc}
            src={previewSrc}
            muted
            loop
            autoPlay
            playsInline
            controls
            className="mx-auto aspect-[9/16] w-full max-w-[280px] rounded-xl bg-black object-cover"
          />
          <p className="break-all text-xs text-gray-500">{url}</p>
        </Card>
      )}
    </div>
  );
}
