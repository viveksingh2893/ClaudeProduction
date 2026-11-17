-- AlterTable
ALTER TABLE "SellerPickupPoint" ADD COLUMN     "courierAddressRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "courierSyncError" TEXT,
ADD COLUMN     "delhiverySyncedRevision" INTEGER,
ADD COLUMN     "rapidshypPickupName" TEXT,
ADD COLUMN     "rapidshypSyncedRevision" INTEGER;
