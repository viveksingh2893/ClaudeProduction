-- AlterTable
ALTER TABLE "ProductCustomerConfig" ADD COLUMN     "loyaltyPoints" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProductDealerConfig" ADD COLUMN     "loyaltyPoints" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "perUnitMrp" DECIMAL(65,30);

