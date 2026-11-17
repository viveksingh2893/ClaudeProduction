-- Legacy customer migration prep (schema-only step): splits User.name into
-- firstName/lastName, and adds legacyId (User, CustomerAddress) + isBilling
-- (CustomerAddress) so the upcoming ETL script (migrate-legacy-customers.ts)
-- can safely upsert ~67,880 old accounts + ~28,220 addresses. Also relaxes
-- CustomerAddress.district to nullable, since the legacy `address` column is
-- one free-text blob we deliberately don't parse district out of.
--
-- Safety: additive first (new nullable columns), then a verified backfill of
-- every existing User.name value into firstName/lastName, and only THEN is
-- the old column dropped — same additive->backfill->verify->drop pattern as
-- 20260819082038_editorial_badges/migration.sql.

-- New nullable columns on User.
ALTER TABLE "User" ADD COLUMN "firstName" TEXT, ADD COLUMN "lastName" TEXT;

-- Backfill: split existing name values on the first space. Everything
-- before the first space becomes firstName; everything after (trimmed,
-- collapsed to NULL if empty) becomes lastName. Single-word names get a
-- firstName and a NULL lastName.
UPDATE "User" SET
  "firstName" = split_part("name", ' ', 1),
  "lastName" = NULLIF(trim(substring("name" from position(' ' in "name"))), '');

-- Verify the backfill is complete before touching the old column: any
-- row left with a NULL firstName aborts the whole migration transaction
-- (Postgres runs each migration.sql inside one transaction by default),
-- so a bad backfill can never reach the destructive step below.
DO $$
DECLARE
    missing_count INTEGER;
BEGIN
    SELECT count(*) INTO missing_count
    FROM "User"
    WHERE "firstName" IS NULL;

    IF missing_count > 0 THEN
        RAISE EXCEPTION 'User.name backfill incomplete: % row(s) have a NULL firstName after split', missing_count;
    END IF;
END $$;

-- Only now is it safe to drop the old column.
ALTER TABLE "User" DROP COLUMN "name";

-- Legacy-id tracking, for idempotent upserts and for the next migration
-- phase (orders) to resolve an old orders.customer_id to this User.id.
ALTER TABLE "User" ADD COLUMN "legacyId" TEXT;
CREATE UNIQUE INDEX "User_legacyId_key" ON "User"("legacyId");

-- CustomerAddress: preserve the legacy is_billing flag and legacy id, and
-- relax district to nullable since the legacy `address` blob is imported
-- verbatim into line1 without being parsed into district/pincode/etc.
ALTER TABLE "CustomerAddress" ALTER COLUMN "district" DROP NOT NULL;
ALTER TABLE "CustomerAddress" ADD COLUMN "isBilling" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerAddress" ADD COLUMN "legacyId" TEXT;
CREATE UNIQUE INDEX "CustomerAddress_legacyId_key" ON "CustomerAddress"("legacyId");
