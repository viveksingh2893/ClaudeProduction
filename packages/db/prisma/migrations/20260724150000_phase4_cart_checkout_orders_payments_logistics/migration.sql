-- Phase 4 — cart, checkout, multi-seller orders, payments, logistics/collection
-- charges, pickup points, mock shipment tracking, idempotency, audit log.
--
-- This is a hand-adjusted `prisma migrate diff` output, not the raw
-- auto-generated script — the raw diff ordered several `ALTER TABLE ...
-- ALTER COLUMN ... TYPE` statements against SellerOrder/Payment/
-- PaymentStatusHistory *before* those tables' own `CREATE TABLE`
-- statements (the diff engine assumed columns could be retyped on tables
-- that don't exist yet), which would fail at apply time. Fixed here by:
--   1. Dropping the old `Order`/`Address` tables (and every FK pointing at
--      them) FIRST — both had zero rows and zero application code
--      referencing them (verified against the dev DB before writing this
--      migration), so this is a safe structural redesign, not a data
--      migration.
--   2. Recreating `PaymentMethod`/`PaymentStatus` outright (drop + create)
--      rather than the usual create-new-type/rename dance, since after
--      step 1 no remaining table references the old versions at all.
--   3. Keeping the rename dance only for `OrderStatus`, which
--      `OrderStatusHistory` (a persisting, empty table) still references.
--   4. Moving every `CREATE TABLE` for the new Phase 4 models before any
--      `AddForeignKey`, and after all enum types they use already exist —
--      matching the working pattern already used by every prior migration
--      in this repo.
-- All affected existing tables (Order, OrderItem, OrderStatusHistory,
-- CartItem, CouponRedemption, RefundRequest, Address) were confirmed to
-- have zero rows before this migration was written.

-- CreateEnum
CREATE TYPE "AddressKind" AS ENUM ('HOME', 'FARM', 'SHOP', 'OFFICE', 'OTHER');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('KISAN4U_COURIER', 'TRANSPORT');

-- CreateEnum
CREATE TYPE "ChargePayer" AS ENUM ('CUSTOMER', 'SELLER', 'KISAN4U');

-- CreateEnum
CREATE TYPE "ChargeCalcType" AS ENUM ('FLAT', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "OrderEventSource" AS ENUM ('CUSTOMER', 'SELLER', 'ADMIN', 'PAYMENT_PROVIDER', 'LOGISTICS_PROVIDER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('CREATED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'DELIVERY_FAILED');

-- CreateEnum
CREATE TYPE "PartialPaymentRuleType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'MIN_ADVANCE_PERCENTAGE');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- AlterEnum (additive only — safe on a live enum)
ALTER TYPE "TransactionReason" ADD VALUE 'ORDER_PAYMENT';

-- DropForeignKey (clears every FK touching the tables being dropped/redesigned below)
ALTER TABLE "Address" DROP CONSTRAINT "Address_userId_fkey";
ALTER TABLE "CouponRedemption" DROP CONSTRAINT "CouponRedemption_orderId_fkey";
ALTER TABLE "Order" DROP CONSTRAINT "Order_billingAddressId_fkey";
ALTER TABLE "Order" DROP CONSTRAINT "Order_customerId_fkey";
ALTER TABLE "Order" DROP CONSTRAINT "Order_deliveryManId_fkey";
ALTER TABLE "Order" DROP CONSTRAINT "Order_sellerId_fkey";
ALTER TABLE "Order" DROP CONSTRAINT "Order_shippingAddressId_fkey";
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_orderId_fkey";
ALTER TABLE "OrderStatusHistory" DROP CONSTRAINT "OrderStatusHistory_orderId_fkey";
ALTER TABLE "RefundRequest" DROP CONSTRAINT "RefundRequest_orderId_fkey";

-- DropTable (zero rows in both — confirmed before writing this migration; see header)
DROP TABLE "Order";
DROP TABLE "Address";

-- DropEnum (only ever used by the now-dropped Address table)
DROP TYPE "AddressType";

-- Recreate PaymentMethod/PaymentStatus outright: after dropping "Order"
-- above, zero remaining tables reference either type, so there is nothing
-- left to convert — no rename dance needed.
DROP TYPE "PaymentMethod";
CREATE TYPE "PaymentMethod" AS ENUM ('COD', 'ONLINE_FULL', 'ONLINE_PARTIAL', 'WALLET', 'TRANSPORT_FULL_ONLINE');

DROP TYPE "PaymentStatus";
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'FAILED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED');

-- AlterEnum: OrderStatus — "OrderStatusHistory" is the only surviving table
-- that still references it, so it's the only column converted.
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('PENDING_PAYMENT', 'PAYMENT_PARTIALLY_RECEIVED', 'CONFIRMED', 'SELLER_ACCEPTED', 'PACKED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'DELIVERY_FAILED', 'CANCELLATION_REQUESTED', 'CANCELLED', 'RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_REJECTED', 'REPLACEMENT_APPROVED', 'REPLACEMENT_DISPATCHED', 'REFUND_INITIATED', 'REFUND_COMPLETED', 'RTO_INITIATED', 'RTO_DELIVERED_TO_SELLER', 'CLOSED');
ALTER TABLE "OrderStatusHistory" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "OrderStatus_old";
COMMIT;

-- AlterTable
ALTER TABLE "CartItem" DROP COLUMN "cartGroupId",
DROP COLUMN "priceSnapshot",
ADD COLUMN     "priceAtAdd" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "sellerId" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "CouponRedemption" DROP COLUMN "orderId",
ADD COLUMN     "sellerOrderId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "OrderItem" DROP COLUMN "orderId",
DROP COLUMN "productSnapshot",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "licenseRequiredSnapshot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mrp" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "productImageUrl" TEXT NOT NULL,
ADD COLUMN     "productName" TEXT NOT NULL,
ADD COLUMN     "sellerOrderId" TEXT NOT NULL,
ADD COLUMN     "sku" TEXT NOT NULL,
ADD COLUMN     "subtotal" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "taxRatePercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "totalWeightGrams" INTEGER NOT NULL,
ADD COLUMN     "unit" "BaseUnit" NOT NULL,
ADD COLUMN     "unitWeightGrams" INTEGER NOT NULL,
ADD COLUMN     "variantLabel" TEXT;

-- AlterTable
ALTER TABLE "OrderStatusHistory" DROP COLUMN "changedById",
DROP COLUMN "changedByRole",
DROP COLUMN "orderId",
ADD COLUMN     "actorId" TEXT NOT NULL,
ADD COLUMN     "actorRole" "UserRole" NOT NULL,
ADD COLUMN     "sellerOrderId" TEXT NOT NULL,
ADD COLUMN     "source" "OrderEventSource" NOT NULL;

-- AlterTable
ALTER TABLE "RefundRequest" DROP COLUMN "orderId",
ADD COLUMN     "sellerOrderId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "altMobile" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "landmark" TEXT,
    "cityTown" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "stateId" TEXT,
    "pincode" TEXT NOT NULL,
    "addressType" "AddressKind" NOT NULL DEFAULT 'HOME',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionChargeConfig" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "chargeType" "ChargeCalcType" NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "minCharge" DECIMAL(65,30),
    "maxCharge" DECIMAL(65,30),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionChargeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutGroup" (
    "id" TEXT NOT NULL,
    "groupNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerType" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAddressSnapshot" (
    "id" TEXT NOT NULL,
    "checkoutGroupId" TEXT NOT NULL,
    "sourceAddressId" TEXT,
    "fullName" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "altMobile" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "landmark" TEXT,
    "cityTown" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "stateId" TEXT,
    "pincode" TEXT NOT NULL,
    "addressType" "AddressKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAddressSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "checkoutGroupId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "customerType" "UserRole" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "paymentMethod" "PaymentMethod" NOT NULL,
    "deliveryMethod" "DeliveryMethod" NOT NULL,
    "transportNote" TEXT,
    "pickupPointId" TEXT,
    "subtotal" DECIMAL(65,30) NOT NULL,
    "discountAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "invoiceNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCharge" (
    "id" TEXT NOT NULL,
    "sellerOrderId" TEXT NOT NULL,
    "shipmentWeightGrams" INTEGER NOT NULL,
    "transportationCost" DECIMAL(65,30) NOT NULL,
    "transportationPayer" "ChargePayer" NOT NULL,
    "collectionCharge" DECIMAL(65,30) NOT NULL,
    "collectionChargePayer" "ChargePayer" NOT NULL DEFAULT 'SELLER',
    "customerPayableDelivery" DECIMAL(65,30) NOT NULL,
    "kisan4uCollectedAmount" DECIMAL(65,30) NOT NULL,
    "sellerBorneAmount" DECIMAL(65,30) NOT NULL,
    "slabSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerPickupPoint" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "landmark" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "approvalStatus" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerPickupPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "sellerOrderId" TEXT NOT NULL,
    "pickupPointSnapshot" JSONB NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MOCK',
    "awbNumber" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'CREATED',
    "packageCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentStatusHistory" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "rawProviderResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "checkoutGroupId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "amountPaid" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "providerReference" TEXT,
    "internalReference" TEXT NOT NULL,
    "remainingDueNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "sellerOrderId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentStatusHistory" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "note" TEXT,
    "source" "OrderEventSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartialPaymentConfig" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "appliesTo" "UserRole",
    "ruleType" "PartialPaymentRuleType" NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartialPaymentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderIdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'PENDING',
    "checkoutGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderIdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" "UserRole" NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutGroup_groupNumber_key" ON "CheckoutGroup"("groupNumber");

-- CreateIndex
CREATE UNIQUE INDEX "OrderAddressSnapshot_checkoutGroupId_key" ON "OrderAddressSnapshot"("checkoutGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "SellerOrder_orderNumber_key" ON "SellerOrder"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SellerOrder_invoiceNumber_key" ON "SellerOrder"("invoiceNumber");

-- CreateIndex
CREATE INDEX "SellerOrder_sellerId_idx" ON "SellerOrder"("sellerId");

-- CreateIndex
CREATE INDEX "SellerOrder_customerId_idx" ON "SellerOrder"("customerId");

-- CreateIndex
CREATE INDEX "SellerOrder_status_idx" ON "SellerOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderCharge_sellerOrderId_key" ON "OrderCharge"("sellerOrderId");

-- CreateIndex
CREATE INDEX "SellerPickupPoint_sellerId_idx" ON "SellerPickupPoint"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_sellerOrderId_key" ON "Shipment"("sellerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_internalReference_key" ON "Payment"("internalReference");

-- CreateIndex
CREATE INDEX "Payment_customerId_idx" ON "Payment"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_sellerOrderId_key" ON "PaymentAllocation"("paymentId", "sellerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderIdempotencyKey_key_key" ON "OrderIdempotencyKey"("key");

-- CreateIndex
CREATE UNIQUE INDEX "OrderIdempotencyKey_checkoutGroupId_key" ON "OrderIdempotencyKey"("checkoutGroupId");

-- CreateIndex
CREATE INDEX "OrderIdempotencyKey_userId_idx" ON "OrderIdempotencyKey"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "CartItem_userId_idx" ON "CartItem"("userId");

-- CreateIndex
CREATE INDEX "CartItem_sellerId_idx" ON "CartItem"("sellerId");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_sellerOrderId_idx" ON "OrderStatusHistory"("sellerOrderId");

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "IndianState"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutGroup" ADD CONSTRAINT "CheckoutGroup_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAddressSnapshot" ADD CONSTRAINT "OrderAddressSnapshot_checkoutGroupId_fkey" FOREIGN KEY ("checkoutGroupId") REFERENCES "CheckoutGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrder" ADD CONSTRAINT "SellerOrder_checkoutGroupId_fkey" FOREIGN KEY ("checkoutGroupId") REFERENCES "CheckoutGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrder" ADD CONSTRAINT "SellerOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrder" ADD CONSTRAINT "SellerOrder_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrder" ADD CONSTRAINT "SellerOrder_pickupPointId_fkey" FOREIGN KEY ("pickupPointId") REFERENCES "SellerPickupPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "SellerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "SellerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCharge" ADD CONSTRAINT "OrderCharge_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "SellerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerPickupPoint" ADD CONSTRAINT "SellerPickupPoint_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "SellerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentStatusHistory" ADD CONSTRAINT "ShipmentStatusHistory_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_checkoutGroupId_fkey" FOREIGN KEY ("checkoutGroupId") REFERENCES "CheckoutGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "SellerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentStatusHistory" ADD CONSTRAINT "PaymentStatusHistory_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderIdempotencyKey" ADD CONSTRAINT "OrderIdempotencyKey_checkoutGroupId_fkey" FOREIGN KEY ("checkoutGroupId") REFERENCES "CheckoutGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "SellerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "SellerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
