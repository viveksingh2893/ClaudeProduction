-- Account deletion is an anonymization workflow: the User row and all
-- financial/order relations remain, while personal data is scrubbed later.
CREATE TYPE "AccountDeletionStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'COMPLETED', 'BLOCKED', 'PENDING_REVIEW');
CREATE TYPE "AccountDeletionSource" AS ENUM ('SELF', 'ADMIN');

ALTER TABLE "User"
  ADD COLUMN "deletionRequestedAt" TIMESTAMP(3),
  ADD COLUMN "deletionScheduledFor" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "SellerOrder" ADD COLUMN "buyerGstNumberSnapshot" TEXT;

UPDATE "SellerOrder" AS so
SET "buyerGstNumberSnapshot" = dp."gstNumber"
FROM "DealerProfile" AS dp
WHERE dp."userId" = so."customerId";

CREATE TABLE "AccountDeletionRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "AccountDeletionStatus" NOT NULL,
  "source" "AccountDeletionSource" NOT NULL,
  "reason" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scheduledFor" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "phoneHash" TEXT,
  "emailHash" TEXT,
  "blockersSnapshot" JSONB,
  CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "User_deletionScheduledFor_idx" ON "User"("deletionScheduledFor");
CREATE INDEX "AccountDeletionRequest_userId_requestedAt_idx" ON "AccountDeletionRequest"("userId", "requestedAt");
CREATE INDEX "AccountDeletionRequest_status_scheduledFor_idx" ON "AccountDeletionRequest"("status", "scheduledFor");

ALTER TABLE "AccountDeletionRequest"
  ADD CONSTRAINT "AccountDeletionRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
