-- AlterTable: add the new single, product-level tax rate
ALTER TABLE "Product" ADD COLUMN     "taxPercent" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- Backfill: existing products get MAX(old customer tax, old dealer tax) —
-- product decision (2026-08-25) when the two per-audience tax fields were
-- consolidated into one, never charge less tax than either audience was
-- already configured with.
UPDATE "Product" p
SET "taxPercent" = GREATEST(
  COALESCE((SELECT c."taxPercent" FROM "ProductCustomerConfig" c WHERE c."productId" = p."id"), 0),
  COALESCE((SELECT d."taxPercent" FROM "ProductDealerConfig" d WHERE d."productId" = p."id"), 0)
);

-- AlterTable: drop the now-redundant per-audience tax fields
ALTER TABLE "ProductCustomerConfig" DROP COLUMN "taxPercent";
ALTER TABLE "ProductDealerConfig" DROP COLUMN "taxPercent";
