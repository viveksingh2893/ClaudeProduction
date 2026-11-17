-- AlterTable
ALTER TABLE "SellerProfile" ADD COLUMN     "rapidshypPickupName" TEXT;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "courierName" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "rapidshypOrderId" TEXT,
ADD COLUMN     "trackingStatusCode" TEXT,
ADD COLUMN     "trackingStatusDesc" TEXT;
