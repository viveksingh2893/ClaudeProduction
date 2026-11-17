-- AlterTable
ALTER TABLE "ShipmentStatusHistory" ADD COLUMN     "courierStatusCode" TEXT,
ADD COLUMN     "courierStatusDesc" TEXT,
ALTER COLUMN "status" DROP NOT NULL;
