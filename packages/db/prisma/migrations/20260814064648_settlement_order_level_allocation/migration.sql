-- AlterTable
ALTER TABLE "SellerSettlement" ADD COLUMN     "lineWeightGrams" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "logisticsSlabSnapshot" JSONB,
ADD COLUMN     "sellerOrderCollectionCharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "sellerOrderCollectionTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "sellerOrderLogisticsCharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "sellerOrderLogisticsTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "sellerOrderTotalNetValue" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "sellerOrderTotalWeightGrams" INTEGER NOT NULL DEFAULT 0;
