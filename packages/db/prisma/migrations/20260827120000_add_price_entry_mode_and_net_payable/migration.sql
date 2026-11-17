-- CreateEnum
CREATE TYPE "PriceEntryMode" AS ENUM ('SELLING_PRICE', 'NET_PAYABLE');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "priceEntryMode" "PriceEntryMode" NOT NULL DEFAULT 'SELLING_PRICE';

-- AlterTable
ALTER TABLE "ProductCustomerConfig" ADD COLUMN     "netPayableAmount" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "ProductDealerConfig" ADD COLUMN     "netPayableAmount" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "netPayableAmount" DECIMAL(65,30);
