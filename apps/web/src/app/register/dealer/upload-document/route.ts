import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getVerifiedPhoneForOnboardingSession, recordDealerOnboardingUpload } from "@kisan4u/auth";
import {
  deletePrivateDocument,
  uploadPrivateDocument,
  validatePrivateDocumentContent,
} from "@kisan4u/providers";
import { DEALER_ONBOARDING_COOKIE } from "../onboarding-cookie";

/**
 * Uploads a single dealer KYC document (GST or license copy) during
 * registration, before the account exists — gated by the same
 * DealerOnboardingSession cookie the final submit step checks (see
 * ../details/actions.ts), not a real login, since there's no account yet
 * to log in to. Deliberately lives under /register/dealer/... (not
 * /api/...) because that cookie is set with `path: "/register/dealer"`
 * (see ../verify/actions.ts) — a browser only attaches a cookie to
 * requests whose path falls under its own path, so this route has to
 * live inside that same path prefix or the cookie never arrives.
 * Returns a /api/uploads/... path (a separate, unrelated route — see
 * apps/web/src/app/api/uploads/[...path]/route.ts); the client echoes it
 * back as gstDocUrl/licenseDocUrl on final submit
 * (packages/validators/src/registration.ts restricts that field to the
 * same prefix, so a tampered request can't point it elsewhere).
 */
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(DEALER_ONBOARDING_COOKIE)?.value;
  if (!sessionId || !(await getVerifiedPhoneForOnboardingSession(sessionId))) {
    return NextResponse.json(
      { ok: false, error: "Your verification session has expired. Please start again." },
      { status: 401 },
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

  const uploaded = await uploadPrivateDocument(file, "dealer-documents");
  try {
    await recordDealerOnboardingUpload(sessionId, uploaded.storageKey);
  } catch (error) {
    await deletePrivateDocument(uploaded.storageKey);
    throw error;
  }
  return NextResponse.json({ ok: true, url: uploaded.storageKey });
}
