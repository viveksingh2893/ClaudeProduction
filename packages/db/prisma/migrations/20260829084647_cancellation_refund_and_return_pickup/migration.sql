-- DropForeignKey
ALTER TABLE "RefundRequest" DROP CONSTRAINT "RefundRequest_orderItemId_fkey";

-- AlterTable
ALTER TABLE "RefundRequest" ALTER COLUMN "orderItemId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SellerOrder" ADD COLUMN     "cancellationRefundMethod" "RefundMethod";

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "returnRapidshypOrderId" TEXT,
ADD COLUMN     "returnRequestedAt" TIMESTAMP(3),
ADD COLUMN     "returnShipmentId" TEXT;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
