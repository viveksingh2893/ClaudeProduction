-- AlterEnum
ALTER TYPE "WalletOwnerType" ADD VALUE 'DEALER';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "walletAmountApplied" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PaymentAllocation" ADD COLUMN     "walletAmountApplied" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "walletRefunded" BOOLEAN NOT NULL DEFAULT false;
