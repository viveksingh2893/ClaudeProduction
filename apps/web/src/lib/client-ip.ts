import { headers } from "next/headers";
import { getTrustedClientIp } from "@kisan4u/auth";

export async function currentClientIp(): Promise<string> {
  return getTrustedClientIp(await headers());
}
