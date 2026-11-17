-- AlterTable
ALTER TABLE "PaymentAllocation" ADD COLUMN     "remainingCollectedAmount" DECIMAL(65,30) NOT NULL DEFAULT 0;
