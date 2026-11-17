-- AlterTable
ALTER TABLE "CheckoutGroup" ADD COLUMN     "legacyGroupId" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "legacyOrderDetailId" TEXT;

-- AlterTable
ALTER TABLE "SellerOrder" ADD COLUMN     "legacyOrderId" TEXT,
ADD COLUMN     "legacySellerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutGroup_legacyGroupId_key" ON "CheckoutGroup"("legacyGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_legacyOrderDetailId_key" ON "OrderItem"("legacyOrderDetailId");

-- CreateIndex
CREATE UNIQUE INDEX "SellerOrder_legacyOrderId_legacySellerId_key" ON "SellerOrder"("legacyOrderId", "legacySellerId");
