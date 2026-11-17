-- Per-language product name (storefront i18n). Nullable — a blank name for
-- a language falls back to the Product's own (English) name at read time.
ALTER TABLE "ProductTranslation" ADD COLUMN IF NOT EXISTS "name" TEXT;
