-- CreateEnum
CREATE TYPE "BaBankStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "BusinessAssociateProfile" ADD COLUMN     "bankRejectionReason" TEXT,
ADD COLUMN     "bankReviewedAt" TIMESTAMP(3),
ADD COLUMN     "bankReviewedById" TEXT,
ADD COLUMN     "bankStatus" "BaBankStatus" NOT NULL DEFAULT 'NOT_SUBMITTED';

-- Backfill: a BA who already submitted bank details under the old
-- zero-review flow (bankSubmittedAt already set) enters the new admin
-- review queue as PENDING_APPROVAL rather than reading as "not submitted."
UPDATE "BusinessAssociateProfile" SET "bankStatus" = 'PENDING_APPROVAL' WHERE "bankSubmittedAt" IS NOT NULL;
