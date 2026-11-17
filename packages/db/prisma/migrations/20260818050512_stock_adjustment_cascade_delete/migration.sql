-- StockAdjustment's seller/product FKs now cascade on delete. Discovered
-- while wiring order checkout/cancellation through the new ledger: many
-- existing test fixtures create a product, run a real checkout (which now
-- writes StockAdjustment rows as a side effect), then hard-delete that
-- product in cleanup — RESTRICT (Prisma's implicit default) blocked that
-- delete. Production never hard-deletes a product or seller (both use
-- lifecycleStatus/status soft states), so this only ever fires in test
-- cleanup or a genuine account-deletion flow, where losing that seller's/
-- product's own stock history along with it is the correct behavior.

-- DropForeignKey
ALTER TABLE "StockAdjustment" DROP CONSTRAINT "StockAdjustment_productId_fkey";

-- DropForeignKey
ALTER TABLE "StockAdjustment" DROP CONSTRAINT "StockAdjustment_sellerId_fkey";

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
