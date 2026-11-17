-- Settlement payout cycles + 48h hold.

-- AlterTable: the frozen payout batch a settlement row belongs to.
ALTER TABLE "SellerSettlement" ADD COLUMN "cyclePayoutDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SellerSettlement_cyclePayoutDate_idx" ON "SellerSettlement"("cyclePayoutDate");
CREATE INDEX "SellerSettlement_cyclePayoutDate_sellerId_idx" ON "SellerSettlement"("cyclePayoutDate", "sellerId");

-- AlterTable: hold period / return window is now 48 hours by default.
ALTER TABLE "SettlementSettings" ALTER COLUMN "holdDays" SET DEFAULT 2;

-- Flip the live singleton to 48h (was 7 days). Admin can still change it.
UPDATE "SettlementSettings" SET "holdDays" = 2 WHERE "id" = 'singleton';

-- Backfill cyclePayoutDate for existing rows from their eligibility instant
-- (eligibleAt, else deliveredAt, else createdAt). Mirrors
-- packages/orders/src/settlement-cycle.ts: all day-of-month boundaries in
-- IST (UTC+5:30, no DST); the "29th" payout clamps to the last day of a
-- short month; stored value is 00:00 IST on the payout day.
WITH src AS (
  SELECT
    s."id" AS sid,
    (COALESCE(s."eligibleAt", s."deliveredAt", s."createdAt") + INTERVAL '5 hours 30 minutes') AS ist_eligible
  FROM "SellerSettlement" s
  WHERE s."cyclePayoutDate" IS NULL
),
calc AS (
  SELECT
    sid,
    EXTRACT(DAY FROM ist_eligible)::int AS dom,
    date_trunc('month', ist_eligible) AS month_start
  FROM src
),
payout AS (
  SELECT
    sid,
    CASE
      WHEN dom BETWEEN 1 AND 7   THEN month_start + INTERVAL '8 days'
      WHEN dom BETWEEN 8 AND 17  THEN month_start + INTERVAL '18 days'
      WHEN dom BETWEEN 18 AND 27 THEN LEAST(month_start + INTERVAL '28 days', month_start + INTERVAL '1 month' - INTERVAL '1 day')
      ELSE month_start + INTERVAL '1 month' + INTERVAL '8 days'
    END AS ist_payout_midnight
  FROM calc
)
UPDATE "SellerSettlement" s
SET "cyclePayoutDate" = (p.ist_payout_midnight - INTERVAL '5 hours 30 minutes')
FROM payout p
WHERE s."id" = p.sid;
