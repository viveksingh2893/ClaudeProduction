-- Phase 3 improvements. Statement order is deliberate and hand-adjusted
-- from the raw `prisma migrate diff` output for two reasons (both learned
-- from the previous catalog migration):
--   1. The DiscountType enum-recreate block must only touch columns that
--      already exist in the live database at the moment it runs.
--      ProductVariant.discountType/discountValue are NEW columns being
--      added in this same migration — they must be added AFTER the enum
--      is renamed, not cast inside the same block (which would fail with
--      "column does not exist").
--   2. Renamed columns (discountAmount -> discountValue) use a real
--      RENAME COLUMN instead of Prisma's default drop-then-add, so no
--      existing discount data is lost.
-- Existing data is also explicitly reconciled rather than defaulted away:
-- see the "Data migration" section below for why and how.

-- CreateEnum (additive, safe)
ALTER TYPE "ApplicationStatus" ADD VALUE 'INACTIVE';

-- AlterEnum: DiscountType NONE/FLAT/PERCENTAGE, touching only the columns
-- that exist today (ProductFarmerConfig, ProductDealerConfig, Coupon).
BEGIN;
CREATE TYPE "DiscountType_new" AS ENUM ('NONE', 'FLAT', 'PERCENTAGE');
ALTER TABLE "ProductDealerConfig" ALTER COLUMN "discountType" DROP DEFAULT;
ALTER TABLE "ProductFarmerConfig" ALTER COLUMN "discountType" DROP DEFAULT;
ALTER TABLE "ProductFarmerConfig" ALTER COLUMN "discountType" TYPE "DiscountType_new" USING ("discountType"::text::"DiscountType_new");
ALTER TABLE "ProductDealerConfig" ALTER COLUMN "discountType" TYPE "DiscountType_new" USING ("discountType"::text::"DiscountType_new");
ALTER TABLE "Coupon" ALTER COLUMN "discountType" TYPE "DiscountType_new" USING ("discountType"::text::"DiscountType_new");
ALTER TYPE "DiscountType" RENAME TO "DiscountType_old";
ALTER TYPE "DiscountType_new" RENAME TO "DiscountType";
DROP TYPE "DiscountType_old";
ALTER TABLE "ProductDealerConfig" ALTER COLUMN "discountType" SET DEFAULT 'NONE';
ALTER TABLE "ProductFarmerConfig" ALTER COLUMN "discountType" SET DEFAULT 'NONE';
COMMIT;

-- DropForeignKey (frees up ProductAttributeValue / crop / problem for removal)
ALTER TABLE "ProductAttributeValue" DROP CONSTRAINT "ProductAttributeValue_attributeId_fkey";
ALTER TABLE "ProductVariantValue" DROP CONSTRAINT "ProductVariantValue_attributeValueId_fkey";
ALTER TABLE "_CropToProduct" DROP CONSTRAINT "_CropToProduct_A_fkey";
ALTER TABLE "_CropToProduct" DROP CONSTRAINT "_CropToProduct_B_fkey";
ALTER TABLE "_ProblemToProduct" DROP CONSTRAINT "_ProblemToProduct_A_fkey";
ALTER TABLE "_ProblemToProduct" DROP CONSTRAINT "_ProblemToProduct_B_fkey";

-- AlterTable: Brand / Manufacturer ownership + approval workflow
ALTER TABLE "Brand" DROP COLUMN "isActive",
ADD COLUMN     "ownerSellerId" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "status" "ApplicationStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Prisma's `@updatedAt` is client-managed, not a DB default — backfill
-- existing rows with the temporary default above, then drop it so the
-- column shape matches the schema exactly (verified via migrate diff).
ALTER TABLE "Brand" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "Manufacturer" DROP COLUMN "isActive",
ADD COLUMN     "ownerSellerId" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "status" "ApplicationStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Manufacturer" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable: rename discountAmount -> discountValue (real rename, preserves data)
ALTER TABLE "ProductFarmerConfig" RENAME COLUMN "discountAmount" TO "discountValue";
ALTER TABLE "ProductDealerConfig" RENAME COLUMN "discountAmount" TO "discountValue";

-- AlterTable: ProductVariant gets discountType/discountValue as NEW columns
-- — safe now, DiscountType already has 'NONE' from the rename above.
ALTER TABLE "ProductVariant" ADD COLUMN     "discountType" "DiscountType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "discountValue" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- CreateTable: product-scoped attribute values (replaces the global list)
CREATE TABLE "ProductVariantAttributeValue" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductVariantAttributeValue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductVariantAttributeValue_productId_attributeId_value_key" ON "ProductVariantAttributeValue"("productId", "attributeId", "value");
CREATE UNIQUE INDEX "ProductVariantAttributeValue_productId_attributeId_slug_key" ON "ProductVariantAttributeValue"("productId", "attributeId", "slug");

ALTER TABLE "ProductVariantAttributeValue" ADD CONSTRAINT "ProductVariantAttributeValue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductVariantAttributeValue" ADD CONSTRAINT "ProductVariantAttributeValue_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "ProductAttribute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: logistics pricing (net new, zero risk)
CREATE TABLE "LogisticsPricingConfig" (
    "id" TEXT NOT NULL,
    "maxWeightGrams" INTEGER NOT NULL,
    "aboveMaxPrice" DECIMAL(65,30) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LogisticsPricingConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LogisticsWeightSlab" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "lowerWeightGrams" INTEGER NOT NULL,
    "upperWeightGrams" INTEGER NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LogisticsWeightSlab_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LogisticsWeightSlab_configId_lowerWeightGrams_key" ON "LogisticsWeightSlab"("configId", "lowerWeightGrams");

ALTER TABLE "LogisticsWeightSlab" ADD CONSTRAINT "LogisticsWeightSlab_configId_fkey" FOREIGN KEY ("configId") REFERENCES "LogisticsPricingConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Data migration: preserve existing catalog data through the shape change.
-- ============================================================================

-- 1) For every (product, attribute, value) combination actually in use by an
--    existing variant, create the equivalent product-scoped row, copying
--    from the global list it used to point at. A global value used by
--    variants of two different products (e.g. "10Gmx10Nos" used by both
--    seeded dealer products) gets one row PER product, by design — that's
--    the whole point of the new model.
INSERT INTO "ProductVariantAttributeValue" (id, "productId", "attributeId", "value", "slug", "position", "isActive")
SELECT gen_random_uuid()::text, combo."productId", combo."attributeId", combo."value", combo."slug", 0, combo."isActive"
FROM (
    SELECT DISTINCT v."productId", pav."attributeId", pav."value", pav."slug", pav."isActive"
    FROM "ProductVariantValue" pvv
    JOIN "ProductVariant" v ON v.id = pvv."variantId"
    JOIN "ProductAttributeValue" pav ON pav.id = pvv."attributeValueId"
) combo;

-- 2) Repoint every existing ProductVariantValue row at its new product-scoped
--    counterpart instead of the old global row — same variants, same SKUs,
--    same prices, just a different (equivalent) value row underneath.
UPDATE "ProductVariantValue" pvv
SET "attributeValueId" = new_val.id
FROM "ProductVariant" v, "ProductAttributeValue" old_val, "ProductVariantAttributeValue" new_val
WHERE pvv."variantId" = v.id
  AND old_val.id = pvv."attributeValueId"
  AND new_val."productId" = v."productId"
  AND new_val."attributeId" = old_val."attributeId"
  AND new_val."value" = old_val."value";

-- 3) Now safe to add the new FK (every attributeValueId now points at a row
--    that exists in the new table) and drop the old global table.
ALTER TABLE "ProductVariantValue" ADD CONSTRAINT "ProductVariantValue_attributeValueId_fkey" FOREIGN KEY ("attributeValueId") REFERENCES "ProductVariantAttributeValue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
DROP TABLE "ProductAttributeValue";

-- 4) Crop/Problem removal — seed-only data (3 crops, 3 problems), no real
--    usage to preserve.
DROP TABLE "Crop";
DROP TABLE "Problem";
DROP TABLE "_CropToProduct";
DROP TABLE "_ProblemToProduct";

-- 5) Discount reconciliation: recompute discountValue = mrp - sellingPrice
--    for every existing farmer/dealer config and variant, so the stored
--    discount is always consistent with the PRESERVED selling price
--    (never the other way around — an already-approved product's price
--    must never change as a side effect of this migration). Rows where
--    mrp already equals sellingPrice are correctly left at the new
--    default (NONE / 0).
UPDATE "ProductFarmerConfig" SET "discountValue" = GREATEST(mrp - "sellingPrice", 0) WHERE mrp <> "sellingPrice";
UPDATE "ProductDealerConfig" SET "discountValue" = GREATEST(mrp - "sellingPrice", 0) WHERE mrp <> "sellingPrice";
UPDATE "ProductVariant" SET "discountType" = 'FLAT', "discountValue" = GREATEST(mrp - "sellingPrice", 0) WHERE mrp <> "sellingPrice";

-- 6) Brand/Manufacturer ownership FKs (added last, after the column exists).
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_ownerSellerId_fkey" FOREIGN KEY ("ownerSellerId") REFERENCES "SellerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Manufacturer" ADD CONSTRAINT "Manufacturer_ownerSellerId_fkey" FOREIGN KEY ("ownerSellerId") REFERENCES "SellerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
