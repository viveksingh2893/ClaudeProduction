-- Business Associate (BA) program.
--
-- Referral-driven affiliate scheme: any user fills Form 1, is admin-approved,
-- gets a "BA-XXXXXX" referral code, and earns a flat amount per referred
-- registration (+ a dealer bonus) and a per-seller % of every order a
-- referred user places. Earnings are LOCKED until the triggering order is
-- delivered + the return window elapses, then ELIGIBLE, then paid out once a
-- month via a manual admin bank transfer (BaSettlement). BA can also place a
-- COD "proposed order" on a referred customer's behalf, which that customer
-- approves / rejects / customizes.
--
-- The existing BusinessAssociateProfile / BaSettlement tables were unused
-- placeholders (0 rows) — this reshapes them. Gated at runtime by
-- SiteSettings.baProgramEnabled (default false).

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "BaEarningKind" AS ENUM ('REGISTRATION', 'DEALER_SIGNUP', 'DEALER_APPROVAL', 'ORDER_COMMISSION');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "BaEarningStatus" AS ENUM ('LOCKED', 'ELIGIBLE', 'SETTLED', 'REVERSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ProposedOrderStatus" AS ENUM ('AWAITING_REFEREE', 'APPROVED', 'REJECTED', 'CUSTOMIZED', 'EXPIRED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TYPE "BaStatus" ADD VALUE IF NOT EXISTS 'BANK_SUBMITTED';
ALTER TYPE "BaStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';

-- ----------------------------------------------------------------------------
-- BusinessAssociateProfile — reshape the placeholder (0 rows)
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS "BusinessAssociateProfile_cspCode_key";

ALTER TABLE "BusinessAssociateProfile"
  DROP COLUMN IF EXISTS "cspCode",
  DROP COLUMN IF EXISTS "ifscCode",
  DROP COLUMN IF EXISTS "pan",
  ADD COLUMN IF NOT EXISTS "referralCode" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "firstName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "lastName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "contactNumber" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "email" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "pincode" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "state" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "city" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "panNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "panDocKey" TEXT,
  ADD COLUMN IF NOT EXISTS "bankName" TEXT,
  ADD COLUMN IF NOT EXISTS "bankBranch" TEXT,
  ADD COLUMN IF NOT EXISTS "accountHolderName" TEXT,
  ADD COLUMN IF NOT EXISTS "accountNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "ifsc" TEXT,
  ADD COLUMN IF NOT EXISTS "chequeDocKey" TEXT,
  ADD COLUMN IF NOT EXISTS "bankSubmittedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedById" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectedReason" TEXT,
  ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Drop the bootstrap defaults — the app always supplies these values.
ALTER TABLE "BusinessAssociateProfile"
  ALTER COLUMN "referralCode" DROP DEFAULT,
  ALTER COLUMN "firstName" DROP DEFAULT,
  ALTER COLUMN "lastName" DROP DEFAULT,
  ALTER COLUMN "contactNumber" DROP DEFAULT,
  ALTER COLUMN "email" DROP DEFAULT,
  ALTER COLUMN "pincode" DROP DEFAULT,
  ALTER COLUMN "state" DROP DEFAULT,
  ALTER COLUMN "city" DROP DEFAULT,
  ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS "BusinessAssociateProfile_referralCode_key" ON "BusinessAssociateProfile"("referralCode");
CREATE UNIQUE INDEX IF NOT EXISTS "BusinessAssociateProfile_panNumber_key" ON "BusinessAssociateProfile"("panNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "BusinessAssociateProfile_accountNumber_key" ON "BusinessAssociateProfile"("accountNumber");
CREATE INDEX IF NOT EXISTS "BusinessAssociateProfile_status_idx" ON "BusinessAssociateProfile"("status");

-- ----------------------------------------------------------------------------
-- BaSettlement — reshape the placeholder (0 rows) into the monthly payout batch
-- ----------------------------------------------------------------------------
ALTER TABLE "BaSettlement"
  DROP COLUMN IF EXISTS "fromDate",
  DROP COLUMN IF EXISTS "toDate",
  DROP COLUMN IF EXISTS "tdsAmount",
  DROP COLUMN IF EXISTS "paidAmount",
  ADD COLUMN IF NOT EXISTS "month" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "bankSnapshot" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "transferredById" TEXT,
  ADD COLUMN IF NOT EXISTS "transferredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "note" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "BaSettlement"
  ALTER COLUMN "month" DROP DEFAULT,
  ALTER COLUMN "bankSnapshot" DROP DEFAULT,
  ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS "BaSettlement_baId_month_key" ON "BaSettlement"("baId", "month");
CREATE INDEX IF NOT EXISTS "BaSettlement_status_idx" ON "BaSettlement"("status");

-- ----------------------------------------------------------------------------
-- BaEarning — the earnings ledger
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "BaEarning" (
  "id" TEXT NOT NULL,
  "baId" TEXT NOT NULL,
  "kind" "BaEarningKind" NOT NULL,
  "status" "BaEarningStatus" NOT NULL DEFAULT 'LOCKED',
  "amount" DECIMAL(65,30) NOT NULL,
  "sourceUserId" TEXT NOT NULL,
  "sourceSellerOrderId" TEXT,
  "sourceCheckoutGroupId" TEXT,
  "sellerId" TEXT,
  "ratePercentSnapshot" DECIMAL(65,30),
  "flatAmountSnapshot" DECIMAL(65,30),
  "commissionBaseSnapshot" DECIMAL(65,30),
  "eligibleAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "payoutMonth" TEXT,
  "settlementId" TEXT,
  "reversedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BaEarning_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BaEarning_baId_status_idx" ON "BaEarning"("baId", "status");
CREATE INDEX IF NOT EXISTS "BaEarning_sourceUserId_idx" ON "BaEarning"("sourceUserId");
CREATE INDEX IF NOT EXISTS "BaEarning_sourceSellerOrderId_idx" ON "BaEarning"("sourceSellerOrderId");
CREATE INDEX IF NOT EXISTS "BaEarning_status_payoutMonth_idx" ON "BaEarning"("status", "payoutMonth");

-- ----------------------------------------------------------------------------
-- BaRateConfig — per-seller / per-customer-type commission rate
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "BaRateConfig" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sellerId" TEXT,
  "customerType" "UserRole",
  "commissionPercent" DECIMAL(65,30) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isDemo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BaRateConfig_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BaRateConfig_sellerId_customerType_isActive_idx" ON "BaRateConfig"("sellerId", "customerType", "isActive");

-- ----------------------------------------------------------------------------
-- BaSettings — configurable flat amounts (true singleton)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "BaSettings" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "registrationAmount" DECIMAL(65,30) NOT NULL DEFAULT 50,
  "dealerSignupAmount" DECIMAL(65,30) NOT NULL DEFAULT 50,
  "dealerApprovalAmount" DECIMAL(65,30) NOT NULL DEFAULT 50,
  "defaultCommissionPercent" DECIMAL(65,30) NOT NULL DEFAULT 2,
  "returnWindowHours" INTEGER NOT NULL DEFAULT 48,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BaSettings_pkey" PRIMARY KEY ("id")
);
INSERT INTO "BaSettings" ("id", "updatedAt") VALUES ('singleton', CURRENT_TIMESTAMP)
  ON CONFLICT ("id") DO NOTHING;

-- ----------------------------------------------------------------------------
-- ProposedOrder / ProposedOrderItem — BA order-on-behalf awaiting approval
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ProposedOrder" (
  "id" TEXT NOT NULL,
  "baId" TEXT NOT NULL,
  "refereeUserId" TEXT NOT NULL,
  "status" "ProposedOrderStatus" NOT NULL DEFAULT 'AWAITING_REFEREE',
  "addressSnapshot" JSONB NOT NULL,
  "pricingSnapshot" JSONB NOT NULL,
  "grandTotal" DECIMAL(65,30) NOT NULL,
  "checkoutGroupId" TEXT,
  "note" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProposedOrder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProposedOrder_refereeUserId_status_idx" ON "ProposedOrder"("refereeUserId", "status");
CREATE INDEX IF NOT EXISTS "ProposedOrder_baId_status_idx" ON "ProposedOrder"("baId", "status");

CREATE TABLE IF NOT EXISTS "ProposedOrderItem" (
  "id" TEXT NOT NULL,
  "proposedOrderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "sellerId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "variantLabel" TEXT,
  "sku" TEXT,
  "quantity" INTEGER NOT NULL,
  "unitPrice" DECIMAL(65,30) NOT NULL,
  "lineTotal" DECIMAL(65,30) NOT NULL,
  "stockReservationId" TEXT,
  CONSTRAINT "ProposedOrderItem_pkey" PRIMARY KEY ("id")
);

-- ----------------------------------------------------------------------------
-- SellerSettlement — BA commission deduction columns
-- ----------------------------------------------------------------------------
ALTER TABLE "SellerSettlement"
  ADD COLUMN IF NOT EXISTS "baCommission" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "baCommissionGstRatePercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "baCommissionGst" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sellerOrderBaCommission" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sellerOrderBaCommissionGst" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- ----------------------------------------------------------------------------
-- SiteSettings — program kill switch
-- ----------------------------------------------------------------------------
ALTER TABLE "SiteSettings"
  ADD COLUMN IF NOT EXISTS "baProgramEnabled" BOOLEAN NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- User — BA referral attribution
-- ----------------------------------------------------------------------------
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "referredByBaId" TEXT;
CREATE INDEX IF NOT EXISTS "User_referredByBaId_idx" ON "User"("referredByBaId");

-- ----------------------------------------------------------------------------
-- Foreign keys
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_referredByBaId_fkey"
    FOREIGN KEY ("referredByBaId") REFERENCES "BusinessAssociateProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "BaEarning" ADD CONSTRAINT "BaEarning_baId_fkey"
    FOREIGN KEY ("baId") REFERENCES "BusinessAssociateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "BaEarning" ADD CONSTRAINT "BaEarning_settlementId_fkey"
    FOREIGN KEY ("settlementId") REFERENCES "BaSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "BaRateConfig" ADD CONSTRAINT "BaRateConfig_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ProposedOrder" ADD CONSTRAINT "ProposedOrder_baId_fkey"
    FOREIGN KEY ("baId") REFERENCES "BusinessAssociateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ProposedOrder" ADD CONSTRAINT "ProposedOrder_refereeUserId_fkey"
    FOREIGN KEY ("refereeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ProposedOrderItem" ADD CONSTRAINT "ProposedOrderItem_proposedOrderId_fkey"
    FOREIGN KEY ("proposedOrderId") REFERENCES "ProposedOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
