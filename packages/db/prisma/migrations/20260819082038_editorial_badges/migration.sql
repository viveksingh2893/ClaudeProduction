-- Editorial badges become admin-manageable (spec item #3), replacing the
-- hardcoded ProductBadgeType enum (BEST_SELLER | NEW | DEAL).
--
-- Safety: additive first (new enums/table/column), then a verified
-- backfill of every existing non-null Product.badge value into the new
-- EditorialBadge relation, and only THEN the old column/enum are dropped
-- — never before the backfill is proven complete (see the verification
-- query this migration's application-level check runs against, mirrored
-- here as an assertion so a manual `prisma migrate deploy` run is just as
-- safe as one driven through the app's own migration tooling).

-- New enums
CREATE TYPE "ProductBadgeTone" AS ENUM ('SUCCESS', 'WARNING', 'DANGER', 'INFO');
CREATE TYPE "EditorialBadgeKind" AS ENUM ('EDITORIAL', 'DEAL');

-- New table
CREATE TABLE "EditorialBadge" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tone" "ProductBadgeTone" NOT NULL DEFAULT 'SUCCESS',
    "kind" "EditorialBadgeKind" NOT NULL DEFAULT 'EDITORIAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorialBadge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EditorialBadge_slug_key" ON "EditorialBadge"("slug");
CREATE INDEX "EditorialBadge_position_idx" ON "EditorialBadge"("position");

-- Seed rows preserving the exact pre-existing labels/priority behavior:
-- Best Seller and New were resolved into the "editorial" (4th) priority
-- slot; Deal was resolved into the "deal" (2nd) priority slot — see
-- packages/catalog/src/badge-resolution.ts and the pre-migration
-- product-card-adapter.ts this replaces.
INSERT INTO "EditorialBadge" ("id", "name", "slug", "tone", "kind", "isActive", "position", "updatedAt") VALUES
    ('edbadge_best_seller', 'Best Seller', 'best-seller', 'SUCCESS', 'EDITORIAL', true, 0, CURRENT_TIMESTAMP),
    ('edbadge_new',         'New',         'new',         'SUCCESS', 'EDITORIAL', true, 1, CURRENT_TIMESTAMP),
    ('edbadge_deal',        'Deal',        'deal',        'WARNING', 'DEAL',      true, 2, CURRENT_TIMESTAMP);

-- New nullable FK column on Product
ALTER TABLE "Product" ADD COLUMN "editorialBadgeId" TEXT;
ALTER TABLE "Product" ADD CONSTRAINT "Product_editorialBadgeId_fkey" FOREIGN KEY ("editorialBadgeId") REFERENCES "EditorialBadge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: copy every existing badge assignment onto the new relation.
UPDATE "Product" SET "editorialBadgeId" = 'edbadge_best_seller' WHERE "badge" = 'BEST_SELLER';
UPDATE "Product" SET "editorialBadgeId" = 'edbadge_new'         WHERE "badge" = 'NEW';
UPDATE "Product" SET "editorialBadgeId" = 'edbadge_deal'        WHERE "badge" = 'DEAL';

-- Verify the backfill is exact before touching the old column: any
-- mismatch aborts the whole migration transaction (Postgres runs each
-- migration.sql inside one transaction by default), so a bad backfill can
-- never reach the destructive step below.
DO $$
DECLARE
    mismatch_count INTEGER;
BEGIN
    SELECT count(*) INTO mismatch_count
    FROM "Product"
    WHERE ("badge" IS NOT NULL) IS DISTINCT FROM ("editorialBadgeId" IS NOT NULL);

    IF mismatch_count > 0 THEN
        RAISE EXCEPTION 'editorial badge backfill mismatch: % product(s) have badge/editorialBadgeId disagreement', mismatch_count;
    END IF;
END $$;

-- Only now is it safe to drop the old column and enum.
ALTER TABLE "Product" DROP COLUMN "badge";
DROP TYPE "ProductBadgeType";
