-- Storefront content languages (i18n). EN is the source language and the
-- fallback for every other language.
DO $$ BEGIN
  CREATE TYPE "Language" AS ENUM ('EN', 'HI', 'MR', 'TE', 'TA');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Per-language banner / coupon-banner assets. Existing rows become EN.
ALTER TABLE "PromotionalAsset"
  ADD COLUMN IF NOT EXISTS "language" "Language" NOT NULL DEFAULT 'EN';

-- Replace the (placement, isActive) index with one that also covers the
-- audience + language columns the admin and storefront queries now filter on.
DROP INDEX IF EXISTS "PromotionalAsset_placement_isActive_idx";
CREATE INDEX IF NOT EXISTS "PromotionalAsset_placement_isActive_audience_language_idx"
  ON "PromotionalAsset" ("placement", "isActive", "audience", "language");

-- Per-language overrides for a Product's rich-text description fields. Any
-- column left NULL falls back to the Product's own (English) value at read
-- time. English is never stored here.
CREATE TABLE IF NOT EXISTS "ProductTranslation" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "language" "Language" NOT NULL,
  "shortDescription" TEXT,
  "description" TEXT,
  "ingredients" TEXT,
  "howToUse" TEXT,
  "dosageInstructions" TEXT,
  "technicalInfo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductTranslation_productId_language_key"
  ON "ProductTranslation" ("productId", "language");
CREATE INDEX IF NOT EXISTS "ProductTranslation_productId_idx"
  ON "ProductTranslation" ("productId");

DO $$ BEGIN
  ALTER TABLE "ProductTranslation"
    ADD CONSTRAINT "ProductTranslation_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
