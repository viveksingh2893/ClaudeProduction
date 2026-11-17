import { prisma } from "@kisan4u/db";

export const PRIVATE_DOCUMENT_FIELDS = [
  "dealer-gst",
  "dealer-licence",
  "seller-gst",
  "seller-pan",
  "ba-pan",
  "ba-cheque",
] as const;
export type PrivateDocumentField = (typeof PRIVATE_DOCUMENT_FIELDS)[number];

export function isPrivateDocumentField(value: string): value is PrivateDocumentField {
  return (PRIVATE_DOCUMENT_FIELDS as readonly string[]).includes(value);
}

export async function getUserPrivateDocumentKey(userId: string, field: PrivateDocumentField) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      dealerProfile: { select: { gstDocUrl: true, licenseDocUrl: true } },
      sellerProfile: { select: { gstDocUrl: true, panDocUrl: true } },
      baProfile: { select: { panDocKey: true, chequeDocKey: true } },
    },
  });
  if (!user) return null;
  const fields: Record<PrivateDocumentField, string | null | undefined> = {
    "dealer-gst": user.dealerProfile?.gstDocUrl,
    "dealer-licence": user.dealerProfile?.licenseDocUrl,
    "seller-gst": user.sellerProfile?.gstDocUrl,
    "seller-pan": user.sellerProfile?.panDocUrl,
    "ba-pan": user.baProfile?.panDocKey,
    "ba-cheque": user.baProfile?.chequeDocKey,
  };
  return fields[field] ?? null;
}
