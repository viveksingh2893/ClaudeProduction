-- Drops the CURRENT_TIMESTAMP default used only to backfill existing rows
-- in the previous migration — matches @updatedAt's actual schema shape
-- (Prisma manages this column at the application level on every write,
-- never via a DB-level default), keeping `prisma migrate diff` at zero
-- drift. ProductDealerConfig's default is intentionally left as-is
-- (Prisma's diff tool did not flag it — see the two other tables' equal
-- treatment above).

ALTER TABLE "ProductFarmerConfig" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ProductVariant" ALTER COLUMN "updatedAt" DROP DEFAULT;
