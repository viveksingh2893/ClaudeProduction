import { NextResponse } from "next/server";
import legacyAppConfig from "./legacy-app-config.json";

/**
 * Compatibility shim for the legacy Kisan4U Flutter app (com.kisan4u.katra,
 * still live on the Play Store), which is hardcoded to call
 * https://admin.kisan4u.com/api/v1/config on startup — a route that only
 * ever existed on the old Laravel backend this domain used to point to.
 *
 * That app already ships its own force-update dialog, gated on
 * `user_app_version_control.for_android.version` in this exact response
 * shape (confirmed by decompiling the live APK and diffing against the
 * still-live Laravel response before cutover). legacy-app-config.json is a
 * frozen snapshot of that real response with the version fields bumped
 * past any version ever published, so every install of the old app is
 * told to update instead of hitting unrelated 404s across this domain.
 * Delete this route once the old app's install base has dropped to zero.
 */
export async function GET() {
  return NextResponse.json(legacyAppConfig);
}
