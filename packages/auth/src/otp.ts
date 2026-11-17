import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { OtpPurpose as DbOtpPurpose, Prisma, prisma } from "@kisan4u/db";
import { getSmsProvider, isRealSmsConfigured } from "@kisan4u/providers";
import { phoneSchema } from "@kisan4u/validators";

export type OtpPurpose =
  "login" | "dealer_registration" | "seller_apply" | "account_deletion" | "guest_checkout";

const DB_PURPOSE: Record<OtpPurpose, DbOtpPurpose> = {
  login: DbOtpPurpose.LOGIN,
  dealer_registration: DbOtpPurpose.DEALER_REGISTRATION,
  seller_apply: DbOtpPurpose.SELLER_APPLY,
  account_deletion: DbOtpPurpose.ACCOUNT_DELETION,
  guest_checkout: DbOtpPurpose.GUEST_CHECKOUT,
};

function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function config() {
  return {
    ttlMinutes: positiveInt("OTP_TTL_MINUTES", 5),
    cooldownSeconds: positiveInt("OTP_SEND_COOLDOWN_SECONDS", 60),
    phoneHourly: positiveInt("OTP_SEND_PHONE_HOURLY_LIMIT", 5),
    phoneDaily: positiveInt("OTP_SEND_PHONE_DAILY_LIMIT", 10),
    ipHourly: positiveInt("OTP_SEND_IP_HOURLY_LIMIT", 60),
    ipWarning: positiveInt("OTP_SEND_IP_WARNING_THRESHOLD", 20),
    codeAttempts: positiveInt("OTP_CODE_MAX_ATTEMPTS", 5),
    failureHourly: positiveInt("OTP_VERIFY_FAILURE_HOURLY_LIMIT", 10),
    lockoutMinutes: positiveInt("OTP_VERIFY_LOCKOUT_MINUTES", 30),
  };
}

function secret(): string {
  const value = process.env.OTP_HMAC_SECRET;
  if (!value) throw new Error("OTP_HMAC_SECRET is not set.");
  return value;
}

function hmac(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

function hashCode(phone: string, purpose: OtpPurpose, code: string): string {
  return hmac(`otp\0${phone}\0${purpose}\0${code}`);
}

function rateKey(scope: string, value: string): string {
  return hmac(`rate\0${scope}\0${value}`);
}

function generateSixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function windowStart(now: Date, seconds: number): Date {
  return new Date(Math.floor(now.getTime() / (seconds * 1000)) * seconds * 1000);
}

function secondsUntil(until: Date, now = new Date()): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
}

async function incrementBucket(
  tx: Prisma.TransactionClient,
  scope: string,
  identifier: string,
  seconds: number,
  now: Date,
) {
  const start = windowStart(now, seconds);
  const end = new Date(start.getTime() + seconds * 1000);
  const keyHash = rateKey(scope, identifier);
  const bucket = await tx.rateLimitBucket.upsert({
    where: { scope_keyHash_windowStart: { scope, keyHash, windowStart: start } },
    create: {
      scope,
      keyHash,
      windowStart: start,
      count: 1,
      expiresAt: new Date(end.getTime() + 86_400_000),
    },
    update: { count: { increment: 1 }, expiresAt: new Date(end.getTime() + 86_400_000) },
  });
  return { count: bucket.count, resetsAt: end };
}

/** Shared Postgres-backed limiter for security-sensitive non-OTP actions. */
export async function consumeSecurityRateLimit(input: {
  scope: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
  warningThreshold?: number;
}): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const now = new Date();
  const bucket = await prisma.$transaction((tx) =>
    incrementBucket(tx, input.scope, input.identifier, input.windowSeconds, now),
  );
  if (input.warningThreshold && bucket.count === input.warningThreshold) {
    console.warn(
      `[security-rate-limit] ${input.scope} crossed warning threshold (${input.warningThreshold}/${input.windowSeconds}s)`,
    );
  }
  if (bucket.count > input.limit) {
    console.warn(`[security-rate-limit] ${input.scope} limit crossed (${input.limit})`);
    return { ok: false, retryAfter: secondsUntil(bucket.resetsAt, now) };
  }
  return { ok: true };
}

async function claimCooldown(
  tx: Prisma.TransactionClient,
  phone: string,
  seconds: number,
  now: Date,
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const scope = "otp_send_cooldown";
  const keyHash = rateKey(scope, phone);
  const epoch = new Date(0);
  const blockedUntil = new Date(now.getTime() + seconds * 1000);
  const rows = await tx.$queryRaw<Array<{ blockedUntil: Date }>>(Prisma.sql`
    INSERT INTO "RateLimitBucket"
      ("id", "scope", "keyHash", "windowStart", "count", "blockedUntil", "expiresAt", "createdAt", "updatedAt")
    VALUES
      (${randomUUID()}, ${scope}, ${keyHash}, ${epoch}, 1, ${blockedUntil}, ${new Date(blockedUntil.getTime() + 86_400_000)}, ${now}, ${now})
    ON CONFLICT ("scope", "keyHash", "windowStart") DO UPDATE
      SET "count" = "RateLimitBucket"."count" + 1,
          "blockedUntil" = EXCLUDED."blockedUntil",
          "expiresAt" = EXCLUDED."expiresAt",
          "updatedAt" = EXCLUDED."updatedAt"
      WHERE "RateLimitBucket"."blockedUntil" IS NULL OR "RateLimitBucket"."blockedUntil" <= ${now}
    RETURNING "blockedUntil"
  `);
  if (rows.length > 0) return { ok: true };
  const existing = await tx.rateLimitBucket.findUnique({
    where: { scope_keyHash_windowStart: { scope, keyHash, windowStart: epoch } },
    select: { blockedUntil: true },
  });
  return { ok: false, retryAfter: secondsUntil(existing?.blockedUntil ?? blockedUntil, now) };
}

function buildOtpMessage(code: string, ttlMinutes: number): string {
  const template = process.env.SMSHUB_OTP_TEMPLATE?.trim();
  if (!template) return `Your Kisan4U login code is ${code}. It expires in ${ttlMinutes} minutes.`;
  const salutation = process.env.SMSHUB_OTP_SALUTATION?.trim() || "Customer";
  const hasExplicitCodeMarker = /\{code\}|\{otp\}/i.test(template);
  const varSlots = (template.match(/\{#var#\}/g) ?? []).length;
  let seen = 0;
  let out = template.replace(/\{#var#\}/g, () => {
    seen += 1;
    return !hasExplicitCodeMarker && seen === varSlots ? code : salutation;
  });
  out = out.replace(/\{code\}|\{otp\}/gi, code);
  return out;
}

export type RequestOtpResult =
  | { ok: true }
  | { ok: false; code: "RATE_LIMITED"; error: string; retryAfter: number }
  | { ok: false; code: "SMS_SEND_FAILED"; error: string };

export type VerifyOtpResult =
  | { ok: true }
  | { ok: false; code: "INVALID_OR_EXPIRED" }
  | { ok: false; code: "RATE_LIMITED"; retryAfter: number };

export function getTrustedClientIp(headers: Pick<Headers, "get">): string {
  return (
    headers.get("cf-connecting-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function requestOtp(
  rawPhone: string,
  context: { purpose: OtpPurpose; ip: string },
): Promise<RequestOtpResult> {
  const phone = phoneSchema.parse(rawPhone);
  const cfg = config();
  const now = new Date();
  const code = generateSixDigitCode();
  const purpose = DB_PURPOSE[context.purpose];

  const reserved = await prisma.$transaction(async (tx) => {
    const cooldown = await claimCooldown(tx, phone, cfg.cooldownSeconds, now);
    if (!cooldown.ok) return cooldown;
    const phoneHour = await incrementBucket(tx, "otp_send_phone_hour", phone, 3600, now);
    const phoneDay = await incrementBucket(tx, "otp_send_phone_day", phone, 86400, now);
    const ipHour = await incrementBucket(tx, "otp_send_ip_hour", context.ip, 3600, now);
    if (ipHour.count === cfg.ipWarning)
      console.warn(
        `[otp] IP crossed send warning threshold (${cfg.ipWarning}/hour): ${context.ip}`,
      );
    const blocked = [
      {
        exceeded: phoneHour.count > cfg.phoneHourly,
        until: phoneHour.resetsAt,
        label: "phone-hour",
      },
      { exceeded: phoneDay.count > cfg.phoneDaily, until: phoneDay.resetsAt, label: "phone-day" },
      { exceeded: ipHour.count > cfg.ipHourly, until: ipHour.resetsAt, label: "ip-hour" },
    ].find((item) => item.exceeded);
    if (blocked) {
      console.warn(
        `[otp] Send rate limit crossed (${blocked.label}) for phone/IP ending ${phone.slice(-4)}`,
      );
      return { ok: false as const, retryAfter: secondsUntil(blocked.until, now) };
    }
    await tx.otpCode.updateMany({
      where: { phone, purpose, consumedAt: null, supersededAt: null },
      data: { supersededAt: now },
    });
    await tx.otpCode.create({
      data: {
        phone,
        purpose,
        codeHash: hashCode(phone, context.purpose, code),
        ip: context.ip,
        expiresAt: new Date(now.getTime() + cfg.ttlMinutes * 60_000),
      },
    });
    return { ok: true as const };
  });

  if (!reserved.ok) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      error: "Too many verification-code requests. Please wait before trying again.",
      retryAfter: reserved.retryAfter,
    };
  }
  const result = await getSmsProvider().send(phone, buildOtpMessage(code, cfg.ttlMinutes), {
    dltTemplateId: process.env.SMSHUB_OTP_TEMPLATE_ID,
  });
  if (!result.ok) {
    console.error(`[otp] SMS send failed for ${phone}: ${result.error}`);
    return {
      ok: false,
      code: "SMS_SEND_FAILED",
      error: isRealSmsConfigured()
        ? "We couldn't send the verification code right now. Please try again in a moment."
        : "OTP SMS could not be sent.",
    };
  }
  return { ok: true };
}

export async function verifyOtp(
  rawPhone: string,
  code: string,
  context: { purpose: OtpPurpose; ip: string },
): Promise<VerifyOtpResult> {
  const phone = phoneSchema.parse(rawPhone);
  const cfg = config();
  const now = new Date();
  const failureScope = "otp_verify_failures";
  const failureKeyHash = rateKey(failureScope, phone);
  const activeLock = await prisma.rateLimitBucket.findFirst({
    where: { scope: failureScope, keyHash: failureKeyHash, blockedUntil: { gt: now } },
    orderBy: { blockedUntil: "desc" },
    select: { blockedUntil: true },
  });
  if (activeLock?.blockedUntil)
    return {
      ok: false,
      code: "RATE_LIMITED",
      retryAfter: secondsUntil(activeLock.blockedUntil, now),
    };

  const purpose = DB_PURPOSE[context.purpose];
  const otp = await prisma.otpCode.findFirst({
    where: {
      phone,
      purpose,
      consumedAt: null,
      supersededAt: null,
      expiresAt: { gt: now },
      attempts: { lt: cfg.codeAttempts },
    },
    orderBy: { createdAt: "desc" },
  });
  const candidate = Buffer.from(hashCode(phone, context.purpose, code), "hex");
  const stored = Buffer.from(otp?.codeHash ?? "0".repeat(64), "hex");
  if (otp && timingSafeEqual(candidate, stored)) {
    const consumed = await prisma.otpCode.updateMany({
      where: {
        id: otp.id,
        consumedAt: null,
        supersededAt: null,
        expiresAt: { gt: now },
        attempts: { lt: cfg.codeAttempts },
      },
      data: { consumedAt: now },
    });
    if (consumed.count === 1) return { ok: true };
  }

  await prisma.$transaction(async (tx) => {
    if (otp) {
      await tx.otpCode.updateMany({
        where: {
          id: otp.id,
          consumedAt: null,
          supersededAt: null,
          attempts: { lt: cfg.codeAttempts },
        },
        data: { attempts: { increment: 1 } },
      });
    }
    const failures = await incrementBucket(tx, failureScope, phone, 3600, now);
    if (failures.count >= cfg.failureHourly) {
      const blockedUntil = new Date(now.getTime() + cfg.lockoutMinutes * 60_000);
      await tx.rateLimitBucket.update({
        where: {
          scope_keyHash_windowStart: {
            scope: failureScope,
            keyHash: failureKeyHash,
            windowStart: windowStart(now, 3600),
          },
        },
        data: { blockedUntil },
      });
      console.warn(
        `[otp] Verification lockout triggered for phone ending ${phone.slice(-4)} from IP ${context.ip}`,
      );
    }
  });
  const lock = await prisma.rateLimitBucket.findFirst({
    where: { scope: failureScope, keyHash: failureKeyHash, blockedUntil: { gt: now } },
    orderBy: { blockedUntil: "desc" },
    select: { blockedUntil: true },
  });
  if (lock?.blockedUntil)
    return { ok: false, code: "RATE_LIMITED", retryAfter: secondsUntil(lock.blockedUntil, now) };
  return { ok: false, code: "INVALID_OR_EXPIRED" };
}
