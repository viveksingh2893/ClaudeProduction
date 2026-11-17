-- AlterTable
ALTER TABLE "BulkProductGroup" ADD COLUMN     "sellerId" TEXT;

-- CreateIndex
CREATE INDEX "BulkProductGroup_sellerId_idx" ON "BulkProductGroup"("sellerId");

-- AddForeignKey
ALTER TABLE "BulkProductGroup" ADD CONSTRAINT "BulkProductGroup_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
