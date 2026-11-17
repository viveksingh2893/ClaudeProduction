-- AlterEnum
ALTER TYPE "MerchandisingType" ADD VALUE 'FEATURED_BY_SUBCATEGORY';

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "CategoryTranslation" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "MerchandisingCollection" ADD COLUMN     "subCategoryId" TEXT;

-- AlterTable
ALTER TABLE "SubSubCategory" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "SubSubCategoryTranslation" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "Subcategory" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "SubcategoryTranslation" ADD COLUMN     "description" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MerchandisingCollection_type_subCategoryId_key" ON "MerchandisingCollection"("type", "subCategoryId");

-- AddForeignKey
ALTER TABLE "MerchandisingCollection" ADD CONSTRAINT "MerchandisingCollection_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "Subcategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
