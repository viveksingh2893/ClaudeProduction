-- Terminology rename: "Farmer" -> "Customer" across the catalog/audience
-- model, matching the term already used everywhere else (UserRole.CUSTOMER,
-- CheckoutGroup.customerType, Product.customerAvailableStates, etc.).
-- Every statement below is a pure rename (enum value / table / column /
-- constraint / index) — no data is dropped, recreated, or duplicated.

-- Enum values
ALTER TYPE "VariantAudience" RENAME VALUE 'FARMER' TO 'CUSTOMER';
ALTER TYPE "ProductAudience" RENAME VALUE 'FARMER_ONLY' TO 'CUSTOMER_ONLY';
ALTER TYPE "ProductAudience" RENAME VALUE 'BOTH_FARMER_AND_DEALER' TO 'BOTH_CUSTOMER_AND_DEALER';

-- Table + its constraints/index
ALTER TABLE "ProductFarmerConfig" RENAME TO "ProductCustomerConfig";
ALTER TABLE "ProductCustomerConfig" RENAME CONSTRAINT "ProductFarmerConfig_pkey" TO "ProductCustomerConfig_pkey";
ALTER TABLE "ProductCustomerConfig" RENAME CONSTRAINT "ProductFarmerConfig_productId_fkey" TO "ProductCustomerConfig_productId_fkey";
ALTER INDEX "ProductFarmerConfig_updatedAt_idx" RENAME TO "ProductCustomerConfig_updatedAt_idx";

-- Column
ALTER TABLE "Product" RENAME COLUMN "farmerVisible" TO "customerVisible";
