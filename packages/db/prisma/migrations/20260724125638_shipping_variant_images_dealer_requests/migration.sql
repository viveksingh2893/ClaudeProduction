-- CreateEnum
CREATE TYPE "SellerProductRequestStatus" AS ENUM ('PENDING', 'VIEWED', 'RESPONDED', 'CLOSED', 'CANCELLED');

-- AlterTable
-- weight: was always NULL in every existing row (verified before writing
-- this migration) -- Decimal->Integer is a safe implicit cast for NULLs.
-- shippingCost: was always literal 0 in every existing row -- dropping
-- NOT NULL/DEFAULT preserves those 0 values exactly; going forward NULL
-- means "no active logistics-pricing config yet", never a silent zero.
ALTER TABLE "ProductDealerConfig" ALTER COLUMN "weight" SET DATA TYPE INTEGER,
ALTER COLUMN "shippingCost" DROP NOT NULL,
ALTER COLUMN "shippingCost" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductFarmerConfig" ALTER COLUMN "weight" SET DATA TYPE INTEGER,
ALTER COLUMN "shippingCost" DROP NOT NULL,
ALTER COLUMN "shippingCost" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "imageAlt" TEXT,
ADD COLUMN     "imageUrl" TEXT,
ALTER COLUMN "shippingCost" DROP NOT NULL,
ALTER COLUMN "shippingCost" DROP DEFAULT,
ALTER COLUMN "weight" SET DATA TYPE INTEGER;

-- CreateTable
CREATE TABLE "DealerStatusViewSession" (
    "id" TEXT NOT NULL,
    "dealerProfileId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealerStatusViewSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerProductRequest" (
    "id" TEXT NOT NULL,
    "dealerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL,
    "deliveryAddress" TEXT NOT NULL,
    "deliveryStateId" TEXT NOT NULL,
    "note" TEXT,
    "status" "SellerProductRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerProductRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DealerStatusViewSession_dealerProfileId_idx" ON "DealerStatusViewSession"("dealerProfileId");

-- CreateIndex
CREATE INDEX "SellerProductRequest_dealerId_idx" ON "SellerProductRequest"("dealerId");

-- CreateIndex
CREATE INDEX "SellerProductRequest_sellerId_idx" ON "SellerProductRequest"("sellerId");

-- CreateIndex
CREATE INDEX "SellerProductRequest_productId_idx" ON "SellerProductRequest"("productId");

-- AddForeignKey
ALTER TABLE "SellerProductRequest" ADD CONSTRAINT "SellerProductRequest_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "DealerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerProductRequest" ADD CONSTRAINT "SellerProductRequest_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerProductRequest" ADD CONSTRAINT "SellerProductRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerProductRequest" ADD CONSTRAINT "SellerProductRequest_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerProductRequest" ADD CONSTRAINT "SellerProductRequest_deliveryStateId_fkey" FOREIGN KEY ("deliveryStateId") REFERENCES "IndianState"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
