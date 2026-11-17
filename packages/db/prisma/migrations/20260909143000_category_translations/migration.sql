-- Per-language name overrides for the 3-level category hierarchy
-- (Category / Subcategory / SubSubCategory). English lives on the row
-- itself and is the source + fallback: a NULL/blank name here falls back
-- to the English column at read time. Mirrors ProductTranslation.

CREATE TABLE IF NOT EXISTS "CategoryTranslation" (
  "id" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "language" "Language" NOT NULL,
  "name" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CategoryTranslation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CategoryTranslation_categoryId_language_key"
  ON "CategoryTranslation" ("categoryId", "language");
CREATE INDEX IF NOT EXISTS "CategoryTranslation_categoryId_idx"
  ON "CategoryTranslation" ("categoryId");
DO $$ BEGIN
  ALTER TABLE "CategoryTranslation"
    ADD CONSTRAINT "CategoryTranslation_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "SubcategoryTranslation" (
  "id" TEXT NOT NULL,
  "subCategoryId" TEXT NOT NULL,
  "language" "Language" NOT NULL,
  "name" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubcategoryTranslation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SubcategoryTranslation_subCategoryId_language_key"
  ON "SubcategoryTranslation" ("subCategoryId", "language");
CREATE INDEX IF NOT EXISTS "SubcategoryTranslation_subCategoryId_idx"
  ON "SubcategoryTranslation" ("subCategoryId");
DO $$ BEGIN
  ALTER TABLE "SubcategoryTranslation"
    ADD CONSTRAINT "SubcategoryTranslation_subCategoryId_fkey"
    FOREIGN KEY ("subCategoryId") REFERENCES "Subcategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "SubSubCategoryTranslation" (
  "id" TEXT NOT NULL,
  "subSubCategoryId" TEXT NOT NULL,
  "language" "Language" NOT NULL,
  "name" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubSubCategoryTranslation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SubSubCategoryTranslation_subSubCategoryId_language_key"
  ON "SubSubCategoryTranslation" ("subSubCategoryId", "language");
CREATE INDEX IF NOT EXISTS "SubSubCategoryTranslation_subSubCategoryId_idx"
  ON "SubSubCategoryTranslation" ("subSubCategoryId");
DO $$ BEGIN
  ALTER TABLE "SubSubCategoryTranslation"
    ADD CONSTRAINT "SubSubCategoryTranslation_subSubCategoryId_fkey"
    FOREIGN KEY ("subSubCategoryId") REFERENCES "SubSubCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
