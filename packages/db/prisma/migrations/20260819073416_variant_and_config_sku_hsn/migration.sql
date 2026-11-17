-- Audience-specific SKU + HSN (spec item #4/#5): a sellable unit — a
-- variant row, or a simple product's per-audience base config — now
-- carries its own commercial identity instead of sharing the parent
-- Product's single sku/hsnCode.
--
-- sku columns are added NULL and left NULL on every existing row
-- (explicit product decision: the "-cus"/"-dea" suffix convention applies
-- going forward only; existing SKUs are never touched). Every read site
-- must fall back to the parent Product.sku when a row's own sku is null.
--
-- hsnCode columns are added NULL and then backfilled by COPYING the
-- parent Product.hsnCode onto every existing row — additive only, changes
-- nothing on Product itself, drops no data, and is safe to run more than
-- once (the WHERE hsnCode IS NULL guard makes the backfill idempotent, so
-- retrying this migration through the normal deploy process never
-- clobbers an hsnCode a later save already diverged from the parent).

-- ProductCustomerConfig
ALTER TABLE "ProductCustomerConfig" ADD COLUMN "sku" TEXT;
ALTER TABLE "ProductCustomerConfig" ADD COLUMN "hsnCode" TEXT;
CREATE UNIQUE INDEX "ProductCustomerConfig_sku_key" ON "ProductCustomerConfig"("sku");
UPDATE "ProductCustomerConfig" AS c
SET "hsnCode" = p."hsnCode"
FROM "Product" AS p
WHERE p.id = c."productId" AND c."hsnCode" IS NULL;

-- ProductDealerConfig
ALTER TABLE "ProductDealerConfig" ADD COLUMN "sku" TEXT;
ALTER TABLE "ProductDealerConfig" ADD COLUMN "hsnCode" TEXT;
CREATE UNIQUE INDEX "ProductDealerConfig_sku_key" ON "ProductDealerConfig"("sku");
UPDATE "ProductDealerConfig" AS c
SET "hsnCode" = p."hsnCode"
FROM "Product" AS p
WHERE p.id = c."productId" AND c."hsnCode" IS NULL;

-- ProductVariant
ALTER TABLE "ProductVariant" ADD COLUMN "hsnCode" TEXT;
UPDATE "ProductVariant" AS v
SET "hsnCode" = p."hsnCode"
FROM "Product" AS p
WHERE p.id = v."productId" AND v."hsnCode" IS NULL;
