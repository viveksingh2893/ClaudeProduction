-- Same cleanup as the previous migration, for the one table that migration
-- missed (its diff output was inspected with a truncated `tail`, which cut
-- off this third statement).

ALTER TABLE "ProductDealerConfig" ALTER COLUMN "updatedAt" DROP DEFAULT;
