import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@kisan4u/db";

/**
 * Guest checkout: a not-signed-in visitor still needs a place to put cart
 * items (CartItem.userId is non-nullable), so the first time a guest adds
 * to cart we create a lightweight placeholder User (`isGuest: true`, no
 * phone/password) and hand the browser a signed cookie holding its id.
 * Every cart/checkout read then accepts that cookie in place of a session
 * (see requireBuyerContext({ allowGuest: true })). On the checkout page
 * the guest verifies a mobile number by OTP, which signs them into their
 * real account (or auto-creates one); claimGuestCartAction then re-points
 * the placeholder's cart rows onto that account and deactivates the
 * placeholder. Nothing the guest selected is ever lost in that hand-off.
 *
 * The cookie value is `<userId>.<hmac>` where the HMAC is keyed by
 * AUTH_SECRET — same secret the auth stack already requires — so a
 * tampered/forged id is rejected before it ever hits the database.
 */

const COOKIE_NAME = "k4u_guest";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 60; // 60 days

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) {
    throw new Error("AUTH_SECRET is not set — it is required to sign the guest cart cookie.");
  }
  return value;
}

function sign(userId: string): string {
  return createHmac("sha256", secret()).update(userId).digest("hex");
}

function serialize(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

/** Returns the id only if the signature checks out — never trusts the raw cookie. */
function parse(raw: string | undefined): string | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expected = sign(userId);
  if (mac.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(expected, "hex"))) return null;
  } catch {
    return null;
  }
  return userId;
}

/**
 * Read-only: the guest buyer id from the cookie, but only if it still
 * resolves to a live placeholder account. Safe to call from a Server
 * Component (never writes a cookie). Returns null for a signed-out
 * visitor who hasn't added anything yet, or a stale/claimed cookie.
 */
export async function getGuestBuyerId(): Promise<string | null> {
  const jar = await cookies();
  const userId = parse(jar.get(COOKIE_NAME)?.value);
  if (!userId) return null;
  const user = await prisma.user.findFirst({
    where: { id: userId, isGuest: true, isActive: true },
    select: { id: true },
  });
  return user?.id ?? null;
}

/**
 * Creates a bare placeholder buyer row — no phone, no password, `isGuest`.
 * Shared by getOrCreateGuestBuyerId (web, cookie-based) and the mobile
 * POST /api/mobile/v1/auth/guest route (bearer-token-based) so "what a
 * guest User row looks like" is defined in exactly one place.
 */
export async function createGuestUser(): Promise<{ id: string; sessionVersion: number }> {
  return prisma.user.create({
    data: {
      role: "CUSTOMER",
      isGuest: true,
      isPhoneVerified: false,
      referralCode: `GUEST-${randomUUID()}`,
    },
    select: { id: true, sessionVersion: true },
  });
}

/**
 * Re-points every cart row from a guest placeholder onto a now-verified
 * real account (summing quantities where a line already exists), then
 * deactivates the placeholder. Returns how many guest rows were moved.
 * The web checkout page wraps this with cookie-clearing + revalidation
 * (claimGuestCartAction); the mobile OTP-verify route calls it directly
 * once it knows the caller was holding a guest bearer token.
 */
export async function claimGuestCart(
  guestUserId: string,
  targetUserId: string,
): Promise<number> {
  if (guestUserId === targetUserId) return 0;
  return prisma.$transaction(async (tx) => {
    const guestItems = await tx.cartItem.findMany({ where: { userId: guestUserId } });
    let count = 0;
    for (const item of guestItems) {
      const dupe = await tx.cartItem.findFirst({
        where: { userId: targetUserId, productId: item.productId, variantId: item.variantId },
      });
      if (dupe) {
        await tx.cartItem.update({
          where: { id: dupe.id },
          data: { quantity: dupe.quantity + item.quantity },
        });
        await tx.cartItem.delete({ where: { id: item.id } });
      } else {
        await tx.cartItem.update({ where: { id: item.id }, data: { userId: targetUserId } });
      }
      count += 1;
    }
    // Deactivate rather than delete — an isGuest row is inert and excluded
    // everywhere, may carry incidental FK-bound children, and a later cron
    // can sweep it.
    await tx.user.update({ where: { id: guestUserId }, data: { isActive: false } });
    return count;
  });
}

/**
 * Deletes every cart row for a guest placeholder and deactivates it — the
 * discard counterpart to claimGuestCart, used when a guest's checkout OTP
 * turns out to belong to a registered dealer. Signing into that dealer
 * account has nothing to do with this guest cart (the dealer has their own
 * cart), so it's dropped instead of merged; the buyer was warned before
 * confirming.
 */
export async function discardGuestCart(guestUserId: string): Promise<void> {
  await prisma.$transaction([
    prisma.cartItem.deleteMany({ where: { userId: guestUserId } }),
    prisma.user.update({ where: { id: guestUserId }, data: { isActive: false } }),
  ]);
}

/**
 * Get-or-create: used by addToCartAction (a Server Action, so it may set
 * the cookie). Creates the placeholder User + cookie on the first add.
 */
export async function getOrCreateGuestBuyerId(): Promise<string> {
  const existing = await getGuestBuyerId();
  if (existing) return existing;

  const user = await createGuestUser();

  const jar = await cookies();
  jar.set(COOKIE_NAME, serialize(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return user.id;
}

/** Drop the cookie once the guest cart has been claimed into a real account. */
export async function clearGuestCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
