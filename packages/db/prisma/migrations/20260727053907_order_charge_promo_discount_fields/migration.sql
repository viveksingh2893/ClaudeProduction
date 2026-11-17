-- AlterTable
ALTER TABLE "OrderCharge" ADD COLUMN     "collectionChargeSnapshot" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "customerPayableTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "kisan4uBorneAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "promotionalDiscountAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "promotionalDiscountPayer" "ChargePayer" NOT NULL DEFAULT 'KISAN4U',
ADD COLUMN     "promotionalDiscountPercent" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- Backfill: every pre-existing OrderCharge row predates the promotional
-- discount feature, so its true customerPayableTotal is simply the seller
-- order's existing totalAmount (0% discount, 0 Kisan4u-borne) — never leave
-- it at the column default of 0, which would misrepresent what the
-- customer actually paid on those historical orders.
UPDATE "OrderCharge" AS oc
SET "customerPayableTotal" = so."totalAmount"
FROM "SellerOrder" AS so
WHERE so.id = oc."sellerOrderId";
