import { NextResponse } from "next/server";
import { prisma } from "@kisan4u/db";
import { deletePrivateDocument } from "@kisan4u/providers";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = request.headers.get("authorization");
  const supplied = bearer?.startsWith("Bearer ")
    ? bearer.slice("Bearer ".length)
    : request.headers.get("x-cron-secret");
  return supplied === expected;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const otpRetentionCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [abandonedSellerSessions, abandonedDealerSessions] = await Promise.all([
    prisma.sellerOnboardingSession.findMany({
      where: { consumedAt: null, createdAt: { lt: otpRetentionCutoff } },
      select: { uploads: { select: { storageKey: true } } },
    }),
    prisma.dealerOnboardingSession.findMany({
      where: { consumedAt: null, createdAt: { lt: otpRetentionCutoff } },
      select: { uploads: { select: { storageKey: true } } },
    }),
  ]);
  const abandonedKeys = [...abandonedSellerSessions, ...abandonedDealerSessions].flatMap(
    (session) => session.uploads.map((upload) => upload.storageKey),
  );
  await Promise.all(abandonedKeys.map((storageKey) => deletePrivateDocument(storageKey)));

  const [otpCodes, rateLimitBuckets, documentLinks, sellerSessions, dealerSessions] =
    await prisma.$transaction([
      prisma.otpCode.deleteMany({ where: { expiresAt: { lt: otpRetentionCutoff } } }),
      prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.privateDocumentDownload.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.sellerOnboardingSession.deleteMany({
        where: { createdAt: { lt: otpRetentionCutoff } },
      }),
      prisma.dealerOnboardingSession.deleteMany({
        where: { createdAt: { lt: otpRetentionCutoff } },
      }),
    ]);

  return NextResponse.json({
    ok: true,
    deleted: {
      otpCodes: otpCodes.count,
      rateLimitBuckets: rateLimitBuckets.count,
      privateDocumentLinks: documentLinks.count,
      abandonedOnboardingFiles: abandonedKeys.length,
      sellerOnboardingSessions: sellerSessions.count,
      dealerOnboardingSessions: dealerSessions.count,
    },
  });
}
