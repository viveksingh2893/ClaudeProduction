-- AlterTable
ALTER TABLE "ProductCustomerConfig" ADD COLUMN     "legacyProductId" TEXT,
ADD COLUMN     "legacyVariantType" TEXT;

-- AlterTable
ALTER TABLE "ProductDealerConfig" ADD COLUMN     "legacyProductId" TEXT,
ADD COLUMN     "legacyVariantType" TEXT;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "legacyProductId" TEXT,
ADD COLUMN     "legacyVariantType" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ProductCustomerConfig_legacyProductId_legacyVariantType_key" ON "ProductCustomerConfig"("legacyProductId", "legacyVariantType");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDealerConfig_legacyProductId_legacyVariantType_key" ON "ProductDealerConfig"("legacyProductId", "legacyVariantType");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_legacyProductId_legacyVariantType_key" ON "ProductVariant"("legacyProductId", "legacyVariantType");

