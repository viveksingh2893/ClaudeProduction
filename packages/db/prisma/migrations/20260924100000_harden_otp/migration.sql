CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'DEALER_REGISTRATION', 'SELLER_APPLY', 'ACCOUNT_DELETION', 'GUEST_CHECKOUT');

-- Existing OTPs are short-lived and cannot be converted to keyed hashes
-- without retaining their plaintext. Invalidate them during deployment.
DELETE FROM "OtpCode";

DROP INDEX IF EXISTS "OtpCode_phone_idx";
ALTER TABLE "OtpCode"
  DROP COLUMN "code",
  ADD COLUMN "codeHash" TEXT NOT NULL,
  ADD COLUMN "purpose" "OtpPurpose" NOT NULL,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ip" TEXT,
  ADD COLUMN "supersededAt" TIMESTAMP(3);

CREATE INDEX "OtpCode_phone_purpose_createdAt_idx" ON "OtpCode"("phone", "purpose", "createdAt");

CREATE TABLE "RateLimitBucket" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "blockedUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RateLimitBucket_scope_keyHash_windowStart_key" ON "RateLimitBucket"("scope", "keyHash", "windowStart");
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");
