import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@kisan4u/db";
import type { MetaUserMatch } from "./shared";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Meta wants digits only, with country code: "98765 43210" / "+91 98765…" / "098765…" → "919876543210". */
export function normalizePhoneForMeta(phone: string): string | null {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 11 ? digits : null;
}

/**
 * The signed-in buyer's phone / email / user id, normalized and SHA-256
 * hashed as Meta requires — only the hashes ever leave this server. Used
 * for the pixel's advanced matching and the Conversions API's user_data.
 * Only ever called when the visitor has accepted cookies.
 */
export async function hashedUserMatch(userId: string): Promise<MetaUserMatch> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true, email: true },
  });
  const phone = user?.phone ? normalizePhoneForMeta(user.phone) : null;
  const email = user?.email?.trim().toLowerCase();
  return {
    ...(phone ? { ph: sha256(phone) } : {}),
    ...(email ? { em: sha256(email) } : {}),
    external_id: sha256(userId),
  };
}
