import "server-only";
import { cookies } from "next/headers";
import { META_CONSENT_COOKIE } from "./shared";

/** Pixel configured AND this visitor accepted cookies — server actions skip gathering tracking data otherwise. */
export async function metaTrackingAllowed(): Promise<boolean> {
  if (!process.env.NEXT_PUBLIC_META_PIXEL_ID) return false;
  return (await cookies()).get(META_CONSENT_COOKIE)?.value === "granted";
}
