-- DropIndex
DROP INDEX "User_referredByBaId_idx";

-- AlterTable
ALTER TABLE "SellerOrder" ADD COLUMN     "legacyClosedOut" BOOLEAN NOT NULL DEFAULT false;
