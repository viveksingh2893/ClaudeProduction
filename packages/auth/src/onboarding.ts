import { prisma } from "@kisan4u/db";

const ONBOARDING_TTL_MINUTES = 10;

/**
 * Server-side, one-time, short-lived ticket proving `phone` was just
 * OTP-verified for dealer registration. The browser only ever holds this
 * row's opaque id (in an httpOnly cookie set by the verify step) — never
 * the phone number itself — so the final registration form/submit can
 * resolve the phone from here instead of trusting client input. See
 * PHASE_2_FIXES notes in apps/web/src/app/register/dealer/*.
 */
export async function createDealerOnboardingSession(phone: string): Promise<string> {
  const expiresAt = new Date(Date.now() + ONBOARDING_TTL_MINUTES * 60 * 1000);
  const session = await prisma.dealerOnboardingSession.create({ data: { phone, expiresAt } });
  return session.id;
}

/**
 * Resolves the verified phone for a still-valid (unexpired, unconsumed)
 * onboarding session id, or null. Does NOT consume it — call
 * consumeDealerOnboardingSession separately once registration actually
 * completes, so a user re-visiting the details page mid-fill-out (e.g.
 * refresh) doesn't get logged out of their own in-progress session.
 */
export async function getVerifiedPhoneForOnboardingSession(
  sessionId: string,
): Promise<string | null> {
  const session = await prisma.dealerOnboardingSession.findFirst({
    where: { id: sessionId, consumedAt: null, expiresAt: { gt: new Date() } },
  });
  return session?.phone ?? null;
}

/** Marks the ticket used — a consumed or expired ticket can't open or submit the form again. */
export async function consumeDealerOnboardingSession(sessionId: string): Promise<void> {
  await prisma.dealerOnboardingSession.updateMany({
    where: { id: sessionId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
}

export async function recordDealerOnboardingUpload(
  sessionId: string,
  storageKey: string,
): Promise<void> {
  await prisma.dealerOnboardingUpload.create({ data: { sessionId, storageKey } });
}

const SELLER_ONBOARDING_TTL_MINUTES = 15;

export async function createSellerOnboardingSession(phone: string, ip: string): Promise<string> {
  const ttl = Number(process.env.SELLER_ONBOARDING_TTL_MINUTES);
  const ttlMinutes = Number.isInteger(ttl) && ttl > 0 ? ttl : SELLER_ONBOARDING_TTL_MINUTES;
  await prisma.sellerOnboardingSession.updateMany({
    where: { phone, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  const session = await prisma.sellerOnboardingSession.create({
    data: { phone, ip, expiresAt: new Date(Date.now() + ttlMinutes * 60_000) },
  });
  return session.id;
}

export async function getVerifiedPhoneForSellerOnboardingSession(
  sessionId: string,
): Promise<string | null> {
  const session = await prisma.sellerOnboardingSession.findFirst({
    where: { id: sessionId, consumedAt: null, expiresAt: { gt: new Date() } },
    select: { phone: true },
  });
  return session?.phone ?? null;
}

export async function reserveSellerOnboardingUpload(
  sessionId: string,
): Promise<"OK" | "SESSION_EXPIRED" | "LIMIT_REACHED"> {
  const configured = Number(process.env.SELLER_ONBOARDING_MAX_UPLOADS);
  const maxUploads = Number.isInteger(configured) && configured > 0 ? configured : 6;
  const reserved = await prisma.sellerOnboardingSession.updateMany({
    where: {
      id: sessionId,
      consumedAt: null,
      expiresAt: { gt: new Date() },
      uploadCount: { lt: maxUploads },
    },
    data: { uploadCount: { increment: 1 } },
  });
  if (reserved.count === 1) return "OK";
  const active = await getVerifiedPhoneForSellerOnboardingSession(sessionId);
  return active ? "LIMIT_REACHED" : "SESSION_EXPIRED";
}

export async function releaseSellerOnboardingUpload(sessionId: string): Promise<void> {
  await prisma.sellerOnboardingSession.updateMany({
    where: { id: sessionId, uploadCount: { gt: 0 } },
    data: { uploadCount: { decrement: 1 } },
  });
}

export async function recordSellerOnboardingUpload(
  sessionId: string,
  storageKey: string,
): Promise<void> {
  await prisma.sellerOnboardingUpload.create({ data: { sessionId, storageKey } });
}

export async function sellerOnboardingOwnsDocuments(
  sessionId: string,
  storageKeys: readonly string[],
): Promise<boolean> {
  const unique = [...new Set(storageKeys)];
  const count = await prisma.sellerOnboardingUpload.count({
    where: { sessionId, storageKey: { in: unique } },
  });
  return count === unique.length;
}

export async function consumeSellerOnboardingSession(sessionId: string): Promise<void> {
  await prisma.sellerOnboardingSession.updateMany({
    where: { id: sessionId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
}

const STATUS_VIEW_TTL_HOURS = 24;

/**
 * Issued once, immediately after a successful dealer registration (see
 * apps/web/src/app/register/dealer/details/actions.ts), so the dealer can
 * land on /dealer/status and see their pending-verification message
 * without the current OTP architecture having any way to grant them a
 * real NextAuth session from inside a Server Action. Deliberately NOT
 * single-consume like DealerOnboardingSession — the dealer may reload
 * this page any number of times while waiting, so it's valid for its
 * full TTL, not just once.
 */
export async function createDealerStatusViewSession(dealerProfileId: string): Promise<string> {
  const expiresAt = new Date(Date.now() + STATUS_VIEW_TTL_HOURS * 60 * 60 * 1000);
  const session = await prisma.dealerStatusViewSession.create({
    data: { dealerProfileId, expiresAt },
  });
  return session.id;
}

/**
 * Resolves the dealer profile for a still-valid status-view ticket, or
 * null. The browser only ever holds this row's opaque id (in an httpOnly
 * cookie) — there is no dealerId/profileId anywhere in the URL for this
 * to be exploitable via, so a ticket can only ever resolve to the exact
 * profile it was issued for.
 */
export async function getDealerProfileForStatusViewSession(sessionId: string) {
  const session = await prisma.dealerStatusViewSession.findFirst({
    where: { id: sessionId, expiresAt: { gt: new Date() } },
  });
  if (!session) return null;
  return prisma.dealerProfile.findUnique({
    where: { id: session.dealerProfileId },
    include: { user: { select: { phone: true } } },
  });
}
