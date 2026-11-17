/**
 * Pure unit test — no DB dependency (unlike most tests in this repo),
 * since signing/verifying a JWT never touches Prisma. Covers the
 * properties the mobile API layer actually relies on: a signed token
 * round-trips, access and refresh tokens are never interchangeable, and a
 * token signed with a different secret (e.g. a stale/rotated
 * MOBILE_AUTH_SECRET) is rejected rather than silently accepted.
 */
import "dotenv/config";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  issueMobileTokenPair,
  signMobileAccessToken,
  signMobileRefreshToken,
  verifyMobileAccessToken,
  verifyMobileRefreshToken,
} from "./mobile-tokens";

before(() => {
  process.env.MOBILE_AUTH_SECRET ??= "test-only-secret-not-for-production-use";
});

const payload = { uid: "user_123", role: "CUSTOMER" as const, sessionVersion: 0 };

test("issueMobileTokenPair round-trips through verify", async () => {
  const tokens = await issueMobileTokenPair(payload);
  const verifiedAccess = await verifyMobileAccessToken(tokens.accessToken);
  const verifiedRefresh = await verifyMobileRefreshToken(tokens.refreshToken);

  assert.ok(verifiedAccess);
  assert.equal(verifiedAccess?.uid, payload.uid);
  assert.equal(verifiedAccess?.role, payload.role);
  assert.equal(verifiedAccess?.typ, "access");

  assert.ok(verifiedRefresh);
  assert.equal(verifiedRefresh?.typ, "refresh");
});

test("an access token is rejected by verifyMobileRefreshToken and vice versa", async () => {
  const accessToken = await signMobileAccessToken(payload);
  const refreshToken = await signMobileRefreshToken(payload);

  assert.equal(await verifyMobileRefreshToken(accessToken), null);
  assert.equal(await verifyMobileAccessToken(refreshToken), null);
});

test("a garbage/tampered token is rejected", async () => {
  const accessToken = await signMobileAccessToken(payload);
  const tampered =
    accessToken.slice(0, -2) + (accessToken.at(-2) === "a" ? "b" : "a") + accessToken.at(-1);

  assert.equal(await verifyMobileAccessToken(tampered), null);
  assert.equal(await verifyMobileAccessToken("not-a-jwt-at-all"), null);
});

test("sessionVersion is carried through so revocation checks can compare it", async () => {
  const tokens = await issueMobileTokenPair({ ...payload, sessionVersion: 7 });
  const verified = await verifyMobileAccessToken(tokens.accessToken);
  assert.equal(verified?.sessionVersion, 7);
});

test("session-backed tokens carry the server session and refresh-token ids", async () => {
  const access = await signMobileAccessToken({ ...payload, sessionId: "session_123" });
  const refresh = await signMobileRefreshToken({
    ...payload,
    sessionId: "session_123",
    refreshTokenId: "refresh_123",
  });
  const verifiedAccess = await verifyMobileAccessToken(access);
  const verifiedRefresh = await verifyMobileRefreshToken(refresh);
  assert.equal(verifiedAccess?.sessionId, "session_123");
  assert.equal(verifiedAccess?.legacy, false);
  assert.equal(verifiedRefresh?.refreshTokenId, "refresh_123");
  assert.equal(verifiedRefresh?.legacy, false);
});

test("legacy tokens stop verifying after the configured cutoff", async () => {
  const token = await signMobileAccessToken(payload);
  const previous = process.env.MOBILE_LEGACY_TOKEN_CUTOFF;
  process.env.MOBILE_LEGACY_TOKEN_CUTOFF = "2000-01-01T00:00:00Z";
  try {
    assert.equal(await verifyMobileAccessToken(token), null);
  } finally {
    if (previous === undefined) delete process.env.MOBILE_LEGACY_TOKEN_CUTOFF;
    else process.env.MOBILE_LEGACY_TOKEN_CUTOFF = previous;
  }
});
