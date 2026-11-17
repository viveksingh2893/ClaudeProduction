-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "taxCalcMode" "TaxCalcMode" NOT NULL DEFAULT 'EXCLUDE_WITH_PRICE';
