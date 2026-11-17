-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SellerProductRequestStatus" ADD VALUE 'APPROVED';
ALTER TYPE "SellerProductRequestStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "SellerProductRequest" ADD COLUMN     "adminNotes" TEXT,
ADD COLUMN     "publicRequestNumber" TEXT NOT NULL,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "sellerVisibleSummary" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SellerProductRequest_publicRequestNumber_key" ON "SellerProductRequest"("publicRequestNumber");
