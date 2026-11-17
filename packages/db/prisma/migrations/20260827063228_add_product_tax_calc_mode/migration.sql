-- CreateEnum
CREATE TYPE "TaxCalcMode" AS ENUM ('INCLUDE_WITH_PRICE', 'EXCLUDE_WITH_PRICE');

-- AlterTable
ALTER TABLE "ProductCustomerConfig" ADD COLUMN     "taxCalcMode" "TaxCalcMode" NOT NULL DEFAULT 'INCLUDE_WITH_PRICE';

-- AlterTable
ALTER TABLE "ProductDealerConfig" ADD COLUMN     "taxCalcMode" "TaxCalcMode" NOT NULL DEFAULT 'INCLUDE_WITH_PRICE';

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "taxCalcMode" "TaxCalcMode" NOT NULL DEFAULT 'INCLUDE_WITH_PRICE';
