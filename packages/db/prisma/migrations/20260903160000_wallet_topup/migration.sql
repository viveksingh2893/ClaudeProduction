-- Manual admin wallet credit reason
ALTER TYPE "TransactionReason" ADD VALUE IF NOT EXISTS 'ADMIN_CREDIT';

-- Self-service wallet top-up via Razorpay
DO $$ BEGIN
  CREATE TYPE "WalletTopupStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "WalletTopup" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "ownerType" "WalletOwnerType" NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "status" "WalletTopupStatus" NOT NULL DEFAULT 'PENDING',
  "provider" TEXT NOT NULL DEFAULT 'RAZORPAY',
  "razorpayOrderId" TEXT,
  "razorpayPaymentId" TEXT,
  "walletTransactionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "WalletTopup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WalletTopup_razorpayOrderId_key" ON "WalletTopup"("razorpayOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "WalletTopup_walletTransactionId_key" ON "WalletTopup"("walletTransactionId");
CREATE INDEX IF NOT EXISTS "WalletTopup_ownerId_idx" ON "WalletTopup"("ownerId");
