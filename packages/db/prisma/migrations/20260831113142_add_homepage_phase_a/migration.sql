-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "emoji" TEXT;

-- AlterTable
ALTER TABLE "PromotionalAsset" ADD COLUMN     "categoryId" TEXT;

-- CreateIndex
CREATE INDEX "PromotionalAsset_categoryId_idx" ON "PromotionalAsset"("categoryId");

-- AddForeignKey
ALTER TABLE "PromotionalAsset" ADD CONSTRAINT "PromotionalAsset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
