import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  consumeSecurityRateLimit,
  getVerifiedPhoneForSellerOnboardingSession,
  recordSellerOnboardingUpload,
  releaseSellerOnboardingUpload,
  reserveSellerOnboardingUpload,
} from "@kisan4u/auth";
import {
  deletePrivateDocument,
  uploadPrivateDocument,
  validatePrivateDocumentContent,
} from "@kisan4u/providers";
import { currentClientIp } from "@/lib/client-ip";
import { SELLER_ONBOARDING_COOKIE } from "../onboarding-cookie";

/**
 * Uploads a seller-application document only for the OTP-verified,
 * short-lived onboarding session established by the verify action.
 */
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SELLER_ONBOARDING_COOKIE)?.value;
  if (!sessionId || !(await getVerifiedPhoneForSellerOnboardingSession(sessionId))) {
    return NextResponse.json(
      { ok: false, error: "Your verification session has expired. Please start again." },
      { status: 401 },
    );
  }

  const ip = await currentClientIp();
  const configuredLimit = Number(process.env.SELLER_UPLOAD_IP_HOURLY_LIMIT);
  const configuredWarning = Number(process.env.SELLER_UPLOAD_IP_WARNING_THRESHOLD);
  const rateLimit = await consumeSecurityRateLimit({
    scope: "seller_onboarding_upload_ip",
    identifier: ip,
    limit: Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 60,
    windowSeconds: 3600,
    warningThreshold:
      Number.isInteger(configuredWarning) && configuredWarning > 0 ? configuredWarning : 20,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "Too many uploads. Please wait before trying again.",
        retryAfter: rateLimit.retryAfter,
      },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } },
    );
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No file provided." }, { status: 400 });
  }
  const validation = await validatePrivateDocumentContent(file);
  if (validation === "FILE_TOO_LARGE") {
    return NextResponse.json({ ok: false, error: "File is larger than 5 MB." }, { status: 400 });
  }
  if (validation) {
    return NextResponse.json(
      {
        ok: false,
        error:
          validation === "CONTENT_MISMATCH"
            ? "File content doesn't match its extension."
            : validation === "UNSAFE_PDF"
              ? "PDFs containing scripts or automatic actions aren't allowed."
              : "Only PDF, JPG, PNG, or WEBP files are allowed.",
      },
      { status: 400 },
    );
  }

  const reservation = await reserveSellerOnboardingUpload(sessionId);
  if (reservation !== "OK") {
    return NextResponse.json(
      {
        ok: false,
        error:
          reservation === "LIMIT_REACHED"
            ? "This application has reached its six-file upload limit."
            : "Your verification session has expired. Please start again.",
      },
      { status: reservation === "LIMIT_REACHED" ? 429 : 401 },
    );
  }

  let storageKey: string | null = null;
  try {
    const uploaded = await uploadPrivateDocument(file, "seller-documents");
    storageKey = uploaded.storageKey;
    await recordSellerOnboardingUpload(sessionId, storageKey);
    return NextResponse.json({ ok: true, url: storageKey });
  } catch (error) {
    await releaseSellerOnboardingUpload(sessionId);
    if (storageKey) await deletePrivateDocument(storageKey);
    console.error("[seller-onboarding] document upload failed", error);
    return NextResponse.json(
      { ok: false, error: "Upload failed. Please try again." },
      { status: 500 },
    );
  }
}
