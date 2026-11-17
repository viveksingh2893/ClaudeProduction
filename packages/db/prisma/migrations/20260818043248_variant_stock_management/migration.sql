-- Variant-level stock management: inventory thresholds, adjustment
-- ledger, restock subscriptions, and a notification click-through link.
-- Purely additive:
--   * minStockQty/reorderLevel are new NOT NULL columns with DEFAULT 5/10
--     — Postgres backfills every existing ProductVariant/
--     ProductFarmerConfig/ProductDealerConfig row with those values in
--     the same ALTER TABLE, no separate UPDATE needed, no existing data
--     touched.
--   * StockAdjustment/RestockSubscription are brand-new tables — no
--     existing rows affected.
--   * Notification.linkUrl is a new nullable column — every existing
--     notification row gets NULL, exactly the "no link" behavior it had
--     implicitly before this column existed.

-- CreateEnum
CREATE TYPE "StockAdjustmentType" AS ENUM ('MANUAL_ADD', 'MANUAL_CORRECTION', 'ORDER_SALE', 'ORDER_CANCELLATION_RESTORE', 'RETURN_RESTORE', 'ADMIN_CORRECTION', 'MIGRATION_OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "StockAdjustmentSource" AS ENUM ('SELLER', 'ADMIN', 'ORDER', 'CANCELLATION', 'RETURN', 'MIGRATION');

-- CreateEnum
CREATE TYPE "RestockSubscriptionStatus" AS ENUM ('ACTIVE', 'FULFILLED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "linkUrl" TEXT;

-- AlterTable
ALTER TABLE "ProductDealerConfig" ADD COLUMN     "minStockQty" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "reorderLevel" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "ProductFarmerConfig" ADD COLUMN     "minStockQty" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "reorderLevel" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "minStockQty" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "reorderLevel" INTEGER NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "audience" "VariantAudience" NOT NULL,
    "previousQty" INTEGER NOT NULL,
    "changeQty" INTEGER NOT NULL,
    "newQty" INTEGER NOT NULL,
    "adjustmentType" "StockAdjustmentType" NOT NULL,
    "sourceType" "StockAdjustmentSource" NOT NULL,
    "reason" TEXT,
    "relatedOrderId" TEXT,
    "performedByUserId" TEXT NOT NULL,
    "performedByRole" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestockSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL DEFAULT '',
    "audience" "VariantAudience" NOT NULL,
    "status" "RestockSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "RestockSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockAdjustment_productId_variantId_idx" ON "StockAdjustment"("productId", "variantId");

-- CreateIndex
CREATE INDEX "StockAdjustment_sellerId_idx" ON "StockAdjustment"("sellerId");

-- CreateIndex
CREATE INDEX "StockAdjustment_createdAt_idx" ON "StockAdjustment"("createdAt");

-- CreateIndex
CREATE INDEX "RestockSubscription_productId_variantId_audience_status_idx" ON "RestockSubscription"("productId", "variantId", "audience", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RestockSubscription_userId_productId_variantId_audience_key" ON "RestockSubscription"("userId", "productId", "variantId", "audience");

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockSubscription" ADD CONSTRAINT "RestockSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockSubscription" ADD CONSTRAINT "RestockSubscription_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
