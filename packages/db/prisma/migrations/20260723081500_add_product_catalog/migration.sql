-- Phase 3: product catalog. Product/ProductVariant/ProductPricing/Category/
-- Brand all have zero rows in every environment this has run in (verified
-- before writing this migration) — so this rewrites the catalog shape
-- outright rather than casting/preserving old enum values. Statement order
-- matters here specifically because ProductAudience is dropped and
-- recreated with new values: every column/table using the OLD enum must be
-- dropped BEFORE "DROP TYPE", and the new "audience" columns are added
-- AFTER "CREATE TYPE" recreates it with the new value set.

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('PHYSICAL', 'DIGITAL');

-- CreateEnum
CREATE TYPE "BaseUnit" AS ENUM ('G', 'KG', 'ML', 'L', 'PIECE');

-- CreateEnum
CREATE TYPE "ShippingCalcMode" AS ENUM ('INCLUDE_WITH_PRODUCT', 'EXCLUDE_WITH_PRODUCT');

-- CreateEnum
CREATE TYPE "ProductLifecycleStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProductStockStatus" AS ENUM ('NOT_TRACKED', 'IN_STOCK', 'OUT_OF_STOCK');

-- CreateEnum
CREATE TYPE "VariantAudience" AS ENUM ('FARMER', 'DEALER');

-- DropForeignKey
ALTER TABLE "Category" DROP CONSTRAINT "Category_parentId_fkey";

-- DropForeignKey
ALTER TABLE "ProductPricing" DROP CONSTRAINT "ProductPricing_productId_fkey";

-- DropForeignKey
ALTER TABLE "_ProductTags" DROP CONSTRAINT "_ProductTags_A_fkey";

-- DropForeignKey
ALTER TABLE "_ProductTags" DROP CONSTRAINT "_ProductTags_B_fkey";

-- Drop every remaining user of the old 3-value ProductAudience enum before
-- dropping the type itself (Product.productFor, ProductVariant.audience,
-- and the whole ProductPricing table, which has its own audience column).
ALTER TABLE "Product" ALTER COLUMN "productFor" DROP DEFAULT;
ALTER TABLE "Product" DROP COLUMN "productFor";
ALTER TABLE "ProductVariant" DROP COLUMN "audience";
DROP TABLE "ProductPricing";

-- Recreate ProductAudience with the new 3-value set — safe because nothing
-- references it anymore (see above), so there is no data to cast/preserve.
DROP TYPE "ProductAudience";
CREATE TYPE "ProductAudience" AS ENUM ('FARMER_ONLY', 'DEALER_ONLY', 'BOTH_FARMER_AND_DEALER');

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "slug" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Category" DROP COLUMN "icon",
DROP COLUMN "isRegulated",
DROP COLUMN "parentId",
DROP COLUMN "showOnHome",
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "DealerProfile" ADD COLUMN     "stateId" TEXT;

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "approvalStatus",
DROP COLUMN "imageUrls",
DROP COLUMN "states",
DROP COLUMN "status",
DROP COLUMN "thumbnailUrl",
DROP COLUMN "unit",
ADD COLUMN     "audience" "ProductAudience" NOT NULL,
ADD COLUMN     "baseUnit" "BaseUnit" NOT NULL,
ADD COLUMN     "canonicalUrl" TEXT,
ADD COLUMN     "dealerVisible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "dosageInstructions" TEXT,
ADD COLUMN     "farmerVisible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "featuredPosition" INTEGER,
ADD COLUMN     "hsnCode" TEXT NOT NULL,
ADD COLUMN     "licenseRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lifecycleStatus" "ProductLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "manufacturerId" TEXT,
ADD COLUMN     "metaImageUrl" TEXT,
ADD COLUMN     "packageSize" TEXT NOT NULL,
ADD COLUMN     "primaryImageUrl" TEXT NOT NULL,
ADD COLUMN     "productType" "ProductType" NOT NULL DEFAULT 'PHYSICAL',
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "searchTags" TEXT[],
ADD COLUMN     "shortDescription" TEXT NOT NULL,
ADD COLUMN     "sku" TEXT NOT NULL,
ADD COLUMN     "stockStatus" "ProductStockStatus" NOT NULL DEFAULT 'NOT_TRACKED',
ADD COLUMN     "subCategoryId" TEXT,
ADD COLUMN     "subSubCategoryId" TEXT,
ADD COLUMN     "technicalInfo" TEXT,
ADD COLUMN     "videoUrl" TEXT;

-- AlterTable
ALTER TABLE "ProductVariant" DROP COLUMN "optionLabel",
DROP COLUMN "price",
DROP COLUMN "purchasePrice",
DROP COLUMN "stock",
ADD COLUMN     "audience" "VariantAudience" NOT NULL,
ADD COLUMN     "breadth" DECIMAL(65,30),
ADD COLUMN     "combinationKey" TEXT NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "height" DECIMAL(65,30),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "length" DECIMAL(65,30),
ADD COLUMN     "loyaltyPoints" INTEGER,
ADD COLUMN     "minOrderQty" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "mrp" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "sellingPrice" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "shippingCalcMode" "ShippingCalcMode" NOT NULL DEFAULT 'INCLUDE_WITH_PRODUCT',
ADD COLUMN     "shippingCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "sku" TEXT NOT NULL,
ADD COLUMN     "stockQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "weight" DECIMAL(65,30);

-- DropTable
DROP TABLE "Tag";

-- DropTable
DROP TABLE "_ProductTags";

-- DropEnum
DROP TYPE "ApprovalStatus";

-- DropEnum
DROP TYPE "ProductStatus";

-- CreateTable
CREATE TABLE "Subcategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "imageUrl" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subcategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubSubCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "imageUrl" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "subCategoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubSubCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manufacturer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Manufacturer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Crop" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Crop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndianState" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndianState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAttribute" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAttributeValue" (
    "id" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductAttributeValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFarmerConfig" (
    "productId" TEXT NOT NULL,
    "mrp" DECIMAL(65,30) NOT NULL,
    "sellingPrice" DECIMAL(65,30) NOT NULL,
    "minOrderQty" INTEGER NOT NULL DEFAULT 1,
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "discountType" "DiscountType" NOT NULL DEFAULT 'FLAT',
    "discountAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxPercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "height" DECIMAL(65,30),
    "breadth" DECIMAL(65,30),
    "length" DECIMAL(65,30),
    "weight" DECIMAL(65,30),
    "shippingCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "shippingCalcMode" "ShippingCalcMode" NOT NULL DEFAULT 'INCLUDE_WITH_PRODUCT',

    CONSTRAINT "ProductFarmerConfig_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "ProductDealerConfig" (
    "productId" TEXT NOT NULL,
    "mrp" DECIMAL(65,30) NOT NULL,
    "sellingPrice" DECIMAL(65,30) NOT NULL,
    "minOrderQty" INTEGER NOT NULL DEFAULT 1,
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "discountType" "DiscountType" NOT NULL DEFAULT 'FLAT',
    "discountAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxPercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "height" DECIMAL(65,30),
    "breadth" DECIMAL(65,30),
    "length" DECIMAL(65,30),
    "weight" DECIMAL(65,30),
    "shippingCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "shippingCalcMode" "ShippingCalcMode" NOT NULL DEFAULT 'INCLUDE_WITH_PRODUCT',

    CONSTRAINT "ProductDealerConfig_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "ProductVariantValue" (
    "variantId" TEXT NOT NULL,
    "attributeValueId" TEXT NOT NULL,

    CONSTRAINT "ProductVariantValue_pkey" PRIMARY KEY ("variantId","attributeValueId")
);

-- CreateTable
CREATE TABLE "_CropToProduct" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CropToProduct_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ProblemToProduct" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProblemToProduct_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_IndianStateToProduct" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_IndianStateToProduct_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subcategory_slug_key" ON "Subcategory"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SubSubCategory_slug_key" ON "SubSubCategory"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Manufacturer_name_key" ON "Manufacturer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Manufacturer_slug_key" ON "Manufacturer"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Crop_name_key" ON "Crop"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Crop_slug_key" ON "Crop"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Problem_name_key" ON "Problem"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Problem_slug_key" ON "Problem"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "IndianState_code_key" ON "IndianState"("code");

-- CreateIndex
CREATE UNIQUE INDEX "IndianState_name_key" ON "IndianState"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAttribute_name_key" ON "ProductAttribute"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAttribute_slug_key" ON "ProductAttribute"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAttributeValue_attributeId_value_key" ON "ProductAttributeValue"("attributeId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAttributeValue_attributeId_slug_key" ON "ProductAttributeValue"("attributeId", "slug");

-- CreateIndex
CREATE INDEX "_CropToProduct_B_index" ON "_CropToProduct"("B");

-- CreateIndex
CREATE INDEX "_ProblemToProduct_B_index" ON "_ProblemToProduct"("B");

-- CreateIndex
CREATE INDEX "_IndianStateToProduct_B_index" ON "_IndianStateToProduct"("B");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_audience_combinationKey_key" ON "ProductVariant"("productId", "audience", "combinationKey");

-- AddForeignKey
ALTER TABLE "DealerProfile" ADD CONSTRAINT "DealerProfile_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "IndianState"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subcategory" ADD CONSTRAINT "Subcategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubSubCategory" ADD CONSTRAINT "SubSubCategory_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "Subcategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttributeValue" ADD CONSTRAINT "ProductAttributeValue_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "ProductAttribute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Manufacturer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "Subcategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_subSubCategoryId_fkey" FOREIGN KEY ("subSubCategoryId") REFERENCES "SubSubCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFarmerConfig" ADD CONSTRAINT "ProductFarmerConfig_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDealerConfig" ADD CONSTRAINT "ProductDealerConfig_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantValue" ADD CONSTRAINT "ProductVariantValue_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantValue" ADD CONSTRAINT "ProductVariantValue_attributeValueId_fkey" FOREIGN KEY ("attributeValueId") REFERENCES "ProductAttributeValue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CropToProduct" ADD CONSTRAINT "_CropToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "Crop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CropToProduct" ADD CONSTRAINT "_CropToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProblemToProduct" ADD CONSTRAINT "_ProblemToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProblemToProduct" ADD CONSTRAINT "_ProblemToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IndianStateToProduct" ADD CONSTRAINT "_IndianStateToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "IndianState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IndianStateToProduct" ADD CONSTRAINT "_IndianStateToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
