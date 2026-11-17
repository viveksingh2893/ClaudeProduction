import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "@kisan4u/db";

const LINK_TTL_MS = 5 * 60 * 1000;

function tokenHash(token: string): string {
  const secret = process.env.DOC_URL_SIGNING_SECRET;
  if (!secret) throw new Error("DOC_URL_SIGNING_SECRET is not set.");
  return createHmac("sha256", secret).update(token).digest("hex");
}

export async function issuePrivateDocumentDownload(input: {
  userId: string;
  field: string;
  storageKey: string;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  await prisma.privateDocumentDownload.create({
    data: { ...input, tokenHash: tokenHash(token), expiresAt },
  });
  return { token, expiresAt };
}

export async function redeemPrivateDocumentDownload(
  token: string,
): Promise<{ storageKey: string } | null> {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const hash = tokenHash(token);
  return prisma.$transaction(async (tx) => {
    const row = await tx.privateDocumentDownload.findUnique({ where: { tokenHash: hash } });
    if (!row || row.redeemedAt || row.expiresAt <= new Date()) return null;
    const consumed = await tx.privateDocumentDownload.updateMany({
      where: { id: row.id, redeemedAt: null, expiresAt: { gt: new Date() } },
      data: { redeemedAt: new Date() },
    });
    return consumed.count === 1 ? { storageKey: row.storageKey } : null;
  });
}
