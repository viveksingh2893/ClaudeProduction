-- AlterTable
ALTER TABLE "SellerSettlement" ADD COLUMN     "deliveredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SettlementRateConfig" DROP COLUMN "tcsPercent",
DROP COLUMN "tdsPercent";

