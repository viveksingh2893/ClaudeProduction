-- CreateEnum
CREATE TYPE "ReviewModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "ReviewSource" AS ENUM ('WEBSITE', 'MANUAL_OFFLINE');

-- DropForeignKey
ALTER TABLE "ProductReview" DROP CONSTRAINT "ProductReview_customerId_fkey";

-- AlterTable: add new columns first (moderationStatus/source/verifiedPurchase/
-- consentConfirmed all have defaults so they backfill safely on existing rows;
-- updatedAt is added nullable, backfilled from createdAt below, then locked
-- to NOT NULL — a bare "ADD COLUMN ... NOT NULL" with no default would fail
-- outright on a non-empty table).
ALTER TABLE "ProductReview"
  ADD COLUMN     "consentConfirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN     "createdByAdminId" TEXT,
  ADD COLUMN     "manualCustomerName" TEXT,
  ADD COLUMN     "moderatedAt" TIMESTAMP(3),
  ADD COLUMN     "moderatedByAdminId" TEXT,
  ADD COLUMN     "moderationNote" TEXT,
  ADD COLUMN     "moderationStatus" "ReviewModerationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN     "orderItemId" TEXT,
  ADD COLUMN     "source" "ReviewSource" NOT NULL DEFAULT 'WEBSITE',
  ADD COLUMN     "updatedAt" TIMESTAMP(3),
  ADD COLUMN     "variantSnapshot" JSONB,
  ADD COLUMN     "verifiedPurchase" BOOLEAN NOT NULL DEFAULT false,
  ALTER COLUMN "customerId" DROP NOT NULL;

-- Backfill: every pre-existing row's old boolean state maps onto the new
-- enum (true -> APPROVED, false -> PENDING, matching what isApproved=false
-- meant before — "not yet moderated", never "rejected", since the old
-- model could only hard-delete a rejection). updatedAt backfills from
-- createdAt as the closest available approximation for rows that predate
-- this column.
UPDATE "ProductReview" SET "moderationStatus" = 'APPROVED' WHERE "isApproved" = true;
UPDATE "ProductReview" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

ALTER TABLE "ProductReview"
  ALTER COLUMN "updatedAt" SET NOT NULL,
  DROP COLUMN "isApproved";

-- CreateIndex
CREATE INDEX "ProductReview_productId_idx" ON "ProductReview"("productId");

-- CreateIndex
CREATE INDEX "ProductReview_moderationStatus_idx" ON "ProductReview"("moderationStatus");

-- CreateIndex
CREATE INDEX "ProductReview_orderItemId_idx" ON "ProductReview"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReview_customerId_productId_key" ON "ProductReview"("customerId", "productId");

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
