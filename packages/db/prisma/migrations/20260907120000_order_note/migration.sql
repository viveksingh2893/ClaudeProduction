-- Internal free-text remarks on an order, addable at any stage
-- (independent of OrderStatusHistory). Append-only, admin/scheduling only.
CREATE TABLE IF NOT EXISTS "OrderNote" (
  "id" TEXT NOT NULL,
  "sellerOrderId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  "authorRole" "UserRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OrderNote_sellerOrderId_createdAt_idx"
  ON "OrderNote" ("sellerOrderId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "OrderNote"
    ADD CONSTRAINT "OrderNote_sellerOrderId_fkey"
    FOREIGN KEY ("sellerOrderId") REFERENCES "SellerOrder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
