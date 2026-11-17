-- CreateEnum
CREATE TYPE "ProductBadgeType" AS ENUM ('BEST_SELLER', 'NEW', 'DEAL');

-- CreateEnum
CREATE TYPE "ProductAvailabilityBadgeMode" AS ENUM ('AUTOMATIC', 'MANUAL', 'OFF');

-- CreateEnum
CREATE TYPE "HomepageSectionType" AS ENUM ('HERO_BANNER', 'TRUST_STRIP', 'COUPON_STRIP', 'TOP_CATEGORIES', 'DEAL_OF_THE_DAY', 'PRODUCT_DISCOVERY_TRENDING', 'PRODUCT_DISCOVERY_BEST_SELLERS', 'PRODUCT_DISCOVERY_NEW_ARRIVALS', 'JOIN_DEALER_SELLER', 'FEATURED_BY_CATEGORY', 'SHOP_BY_BRAND');

-- CreateEnum
CREATE TYPE "SectionAudience" AS ENUM ('CUSTOMER', 'DEALER', 'COMMON');

-- CreateEnum
CREATE TYPE "PromotionalPlacement" AS ENUM ('HERO', 'COUPON', 'JOIN_DEALER', 'JOIN_SELLER');

-- CreateEnum
CREATE TYPE "MerchandisingType" AS ENUM ('TRENDING', 'BEST_SELLERS', 'NEW_ARRIVALS', 'FEATURED_BY_CATEGORY');

-- CreateEnum
CREATE TYPE "MerchandisingMode" AS ENUM ('MANUAL', 'AUTOMATIC');

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "homepagePosition" INTEGER;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "availabilityBadgeMode" "ProductAvailabilityBadgeMode" NOT NULL DEFAULT 'AUTOMATIC',
ADD COLUMN     "availabilityBadgeText" TEXT,
ADD COLUMN     "badge" "ProductBadgeType",
ADD COLUMN     "deliveryBadgeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deliveryBadgeText" TEXT,
ADD COLUMN     "ratingAverage" DECIMAL(2,1),
ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "subtitle" TEXT;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WishlistItem" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "SiteSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "wishlistEnabled" BOOLEAN NOT NULL DEFAULT true,
    "buyNowEnabled" BOOLEAN NOT NULL DEFAULT true,
    "addToCartEnabled" BOOLEAN NOT NULL DEFAULT true,
    "requestSellerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ratingDisplayThreshold" INTEGER NOT NULL DEFAULT 5,
    "defaultDeliveryBadgeText" TEXT,
    "footerCustomerCareNumber" TEXT,
    "footerPolicyLinks" JSONB,
    "footerSocialLinks" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomepageSection" (
    "id" TEXT NOT NULL,
    "type" "HomepageSectionType" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "audience" "SectionAudience" NOT NULL DEFAULT 'COMMON',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomepageSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionalAsset" (
    "id" TEXT NOT NULL,
    "placement" "PromotionalPlacement" NOT NULL,
    "audience" "SectionAudience" NOT NULL DEFAULT 'COMMON',
    "desktopImageUrl" TEXT NOT NULL,
    "mobileImageUrl" TEXT,
    "altText" TEXT NOT NULL,
    "linkUrl" TEXT,
    "ctaLabel" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionalAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryHomepageAsset" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryHomepageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealOfTheDay" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "dealPrice" DECIMAL(65,30) NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealOfTheDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchandisingCollection" (
    "id" TEXT NOT NULL,
    "type" "MerchandisingType" NOT NULL,
    "mode" "MerchandisingMode" NOT NULL DEFAULT 'AUTOMATIC',
    "categoryId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchandisingCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchandisingItem" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchandisingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomepageSection_type_audience_key" ON "HomepageSection"("type", "audience");

-- CreateIndex
CREATE INDEX "PromotionalAsset_placement_isActive_idx" ON "PromotionalAsset"("placement", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryHomepageAsset_categoryId_key" ON "CategoryHomepageAsset"("categoryId");

-- CreateIndex
CREATE INDEX "DealOfTheDay_isActive_startAt_endAt_idx" ON "DealOfTheDay"("isActive", "startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "MerchandisingCollection_type_categoryId_key" ON "MerchandisingCollection"("type", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchandisingItem_collectionId_productId_key" ON "MerchandisingItem"("collectionId", "productId");

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryHomepageAsset" ADD CONSTRAINT "CategoryHomepageAsset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealOfTheDay" ADD CONSTRAINT "DealOfTheDay_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealOfTheDay" ADD CONSTRAINT "DealOfTheDay_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandisingCollection" ADD CONSTRAINT "MerchandisingCollection_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandisingItem" ADD CONSTRAINT "MerchandisingItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MerchandisingCollection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandisingItem" ADD CONSTRAINT "MerchandisingItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
