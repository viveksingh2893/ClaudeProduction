"use server";

import { revalidatePath } from "next/cache";
import { saveLoginVideoUrl } from "@kisan4u/catalog";
import { uploadAppLoginVideo } from "@kisan4u/providers";
import { requireSession } from "@/lib/session-guard";

type UploadResult = { ok: true; url: string } | { ok: false; error: string };
type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * The mobile app's login-screen background video. One SiteSettings field
 * (`loginVideoUrl`), set here as either an uploaded MP4 (served from
 * apps/web's /api/uploads, same as banner images) or a pasted external
 * URL. The app reads it via /api/mobile/v1/site-settings and plays it
 * silent + looping; null = a branded gradient fallback.
 */
export async function uploadAppLoginVideoAction(file: File): Promise<UploadResult> {
  await requireSession(["ADMIN"]);
  const result = await uploadAppLoginVideo(file);
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "FILE_TOO_LARGE"
          ? "That file is over the 20 MB limit — compress it or lower the resolution to 720×1280."
          : "Unsupported file — upload an .mp4 (H.264), .webm or .mov video.",
    };
  }
  return { ok: true, url: result.url };
}

export async function saveAppLoginVideoAction(rawUrl: string | null): Promise<SaveResult> {
  await requireSession(["ADMIN"]);
  const url = rawUrl?.trim() || null;
  if (url && !/^(https?:\/\/|\/api\/uploads\/)/i.test(url)) {
    return {
      ok: false,
      error: "Enter a full https:// URL, or upload a file (which fills this in for you).",
    };
  }
  await saveLoginVideoUrl(url);
  revalidatePath("/admin/app-login-video");
  return { ok: true };
}
