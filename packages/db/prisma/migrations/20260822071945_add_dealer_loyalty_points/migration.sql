-- CreateEnum
CREATE TYPE "LoyaltyPointsReason" AS ENUM ('ORDER_DELIVERED', 'ORDER_REFUND_REVERSAL');

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "loyaltyPoints" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LoyaltyPointsTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "reason" "LoyaltyPointsReason" NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyPointsTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoyaltyPointsTransaction_walletId_idx" ON "LoyaltyPointsTransaction"("walletId");

-- AddForeignKey
ALTER TABLE "LoyaltyPointsTransaction" ADD CONSTRAINT "LoyaltyPointsTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
