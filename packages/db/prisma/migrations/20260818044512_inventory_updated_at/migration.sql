-- Adds a "last updated" timestamp to the three stock-holding tables
-- (ProductFarmerConfig/ProductDealerConfig had none at all; ProductVariant
-- had only createdAt) — needed for the inventory table's "Last updated"
-- column/sort. DEFAULT CURRENT_TIMESTAMP backfills every existing row to
-- "now" (the best available value, since there's no true history to
-- recover) in the same statement; every future write goes through
-- Prisma's `@updatedAt`, which keeps it current automatically.

-- AlterTable
ALTER TABLE "ProductDealerConfig" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "ProductFarmerConfig" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "ProductDealerConfig_updatedAt_idx" ON "ProductDealerConfig"("updatedAt");

-- CreateIndex
CREATE INDEX "ProductFarmerConfig_updatedAt_idx" ON "ProductFarmerConfig"("updatedAt");

-- CreateIndex
CREATE INDEX "ProductVariant_updatedAt_idx" ON "ProductVariant"("updatedAt");
