-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'ON_HOLD', 'ELIGIBLE', 'PROCESSING', 'SETTLED', 'PARTIALLY_SETTLED', 'REVERSED', 'FAILED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "SettlementAdjustmentReason" AS ENUM ('RETURN', 'REFUND', 'CANCELLATION', 'RTO', 'CHARGEBACK', 'MANUAL_CORRECTION');

-- CreateTable
CREATE TABLE "SettlementSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "holdDays" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementRateConfig" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sellerId" TEXT,
    "customerType" "UserRole",
    "commissionGstPercent" DECIMAL(65,30) NOT NULL,
    "logisticsGstPercent" DECIMAL(65,30) NOT NULL,
    "collectionChargeGstPercent" DECIMAL(65,30) NOT NULL,
    "tcsPercent" DECIMAL(65,30) NOT NULL,
    "tdsPercent" DECIMAL(65,30) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementRateConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerSettlement" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "checkoutGroupId" TEXT NOT NULL,
    "sellerOrderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "orderDateTime" TIMESTAMP(3) NOT NULL,
    "financialStatusSnapshot" "PaymentStatus" NOT NULL,
    "orderStatusSnapshot" "OrderStatus" NOT NULL,
    "shippingStateSnapshot" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "shopNameSnapshot" TEXT NOT NULL,
    "customerNameSnapshot" TEXT NOT NULL,
    "customerTypeSnapshot" "UserRole" NOT NULL,
    "paymentMethodSnapshot" "PaymentMethod" NOT NULL,
    "fulfilledQty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "unitPriceNetOfDeductions" DECIMAL(65,30) NOT NULL,
    "unitPriceIncTax" DECIMAL(65,30) NOT NULL,
    "totalSales" DECIMAL(65,30) NOT NULL,
    "netSalesExclTax" DECIMAL(65,30) NOT NULL,
    "gstRatePercent" DECIMAL(65,30) NOT NULL,
    "gstTax" DECIMAL(65,30) NOT NULL,
    "commissionType" "CommissionType" NOT NULL DEFAULT 'PERCENTAGE',
    "commissionValuePercent" DECIMAL(65,30) NOT NULL,
    "commissionBase" DECIMAL(65,30) NOT NULL,
    "grossCommission" DECIMAL(65,30) NOT NULL,
    "commissionGstRatePercent" DECIMAL(65,30) NOT NULL,
    "grossCommissionTax" DECIMAL(65,30) NOT NULL,
    "logisticSellerBorne" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "logisticGstRatePercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "logisticTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "collectionCharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "collectionChargeGstRatePercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "collectionChargeTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "tcsRatePercent" DECIMAL(65,30) NOT NULL,
    "tcsAmount" DECIMAL(65,30) NOT NULL,
    "tdsRatePercent" DECIMAL(65,30) NOT NULL,
    "tdsAmount" DECIMAL(65,30) NOT NULL,
    "payableToSeller" DECIMAL(65,30) NOT NULL,
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "eligibleAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementAdjustment" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "reason" "SettlementAdjustmentReason" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "note" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "createdByRole" "UserRole" NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettlementRateConfig_sellerId_customerType_isActive_idx" ON "SettlementRateConfig"("sellerId", "customerType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SellerSettlement_orderItemId_key" ON "SellerSettlement"("orderItemId");

-- CreateIndex
CREATE INDEX "SellerSettlement_sellerId_idx" ON "SellerSettlement"("sellerId");

-- CreateIndex
CREATE INDEX "SellerSettlement_sellerOrderId_idx" ON "SellerSettlement"("sellerOrderId");

-- CreateIndex
CREATE INDEX "SellerSettlement_checkoutGroupId_idx" ON "SellerSettlement"("checkoutGroupId");

-- CreateIndex
CREATE INDEX "SellerSettlement_status_idx" ON "SellerSettlement"("status");

-- CreateIndex
CREATE INDEX "SettlementAdjustment_settlementId_idx" ON "SettlementAdjustment"("settlementId");

-- AddForeignKey
ALTER TABLE "SettlementRateConfig" ADD CONSTRAINT "SettlementRateConfig_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerSettlement" ADD CONSTRAINT "SellerSettlement_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerSettlement" ADD CONSTRAINT "SellerSettlement_checkoutGroupId_fkey" FOREIGN KEY ("checkoutGroupId") REFERENCES "CheckoutGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerSettlement" ADD CONSTRAINT "SellerSettlement_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "SellerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerSettlement" ADD CONSTRAINT "SellerSettlement_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAdjustment" ADD CONSTRAINT "SettlementAdjustment_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "SellerSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
