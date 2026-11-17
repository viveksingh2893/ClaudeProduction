import { randomUUID } from "node:crypto";
import { prisma, type UserRole } from "@kisan4u/db";
import {
  signMobileAccessToken,
  signMobileRefreshToken,
  type MobileTokenPair,
  type VerifiedMobileToken,
} from "./mobile-tokens";

type SessionIdentity = { uid: string; role: UserRole; sessionVersion: number };
export type MobileDevice = { id: string; name: string };

export function mobileDeviceFromHeaders(headers: Pick<Headers, "get">): MobileDevice {
  const suppliedId = headers.get("x-device-id")?.trim();
  const suppliedName = headers.get("x-device-name")?.trim();
  return {
    id: suppliedId && suppliedId.length <= 200 ? suppliedId : randomUUID(),
    name:
      suppliedName && suppliedName.length <= 200
        ? suppliedName
        : (headers.get("user-agent")?.slice(0, 200) ?? "Unknown device"),
  };
}

async function tokensFor(
  identity: SessionIdentity,
  sessionId: string,
  refreshTokenId: string,
): Promise<MobileTokenPair> {
  const [accessToken, refreshToken] = await Promise.all([
    signMobileAccessToken({ ...identity, sessionId }),
    signMobileRefreshToken({ ...identity, sessionId, refreshTokenId }),
  ]);
  return { accessToken, refreshToken, expiresIn: 60 * 60 };
}

export async function createMobileSessionTokenPair(
  identity: SessionIdentity,
  device: MobileDevice,
): Promise<MobileTokenPair> {
  const refreshTokenId = randomUUID();
  const session = await prisma.$transaction(async (tx) => {
    await tx.mobileSession.updateMany({
      where: { userId: identity.uid, deviceId: device.id, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "REPLACED_BY_LOGIN" },
    });
    return tx.mobileSession.create({
      data: {
        userId: identity.uid,
        deviceId: device.id,
        deviceName: device.name,
        refreshTokenId,
      },
    });
  });
  return tokensFor(identity, session.id, refreshTokenId);
}

export type RotateMobileSessionResult =
  { ok: true; tokens: MobileTokenPair } | { ok: false; reason: "INVALID" | "REUSED" };

export async function rotateMobileSessionTokenPair(
  token: VerifiedMobileToken,
): Promise<RotateMobileSessionResult> {
  if (!token.sessionId || !token.refreshTokenId) return { ok: false, reason: "INVALID" };
  const nextRefreshTokenId = randomUUID();
  const now = new Date();
  const rotated = await prisma.mobileSession.updateMany({
    where: {
      id: token.sessionId,
      userId: token.uid,
      refreshTokenId: token.refreshTokenId,
      revokedAt: null,
    },
    data: { refreshTokenId: nextRefreshTokenId, lastUsedAt: now },
  });
  if (rotated.count !== 1) {
    const existing = await prisma.mobileSession.findFirst({
      where: { id: token.sessionId, userId: token.uid },
      select: { revokedAt: true },
    });
    if (existing && !existing.revokedAt) {
      await prisma.mobileSession.updateMany({
        where: { id: token.sessionId, userId: token.uid, revokedAt: null },
        data: { revokedAt: now, revokeReason: "REFRESH_TOKEN_REUSE" },
      });
      return { ok: false, reason: "REUSED" };
    }
    return { ok: false, reason: "INVALID" };
  }
  return {
    ok: true,
    tokens: await tokensFor(
      { uid: token.uid, role: token.role, sessionVersion: token.sessionVersion },
      token.sessionId,
      nextRefreshTokenId,
    ),
  };
}

export async function revokeMobileSession(
  userId: string,
  sessionId: string,
  reason = "LOGOUT",
): Promise<void> {
  await prisma.mobileSession.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
}
