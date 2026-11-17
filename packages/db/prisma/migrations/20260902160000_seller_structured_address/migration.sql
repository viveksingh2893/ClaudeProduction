-- Structured registered address on the seller application.
ALTER TABLE "SellerProfile"
  ADD COLUMN "registeredAddressLine1" TEXT,
  ADD COLUMN "registeredAddressLine2" TEXT,
  ADD COLUMN "registeredCity" TEXT,
  ADD COLUMN "registeredDistrict" TEXT,
  ADD COLUMN "registeredState" TEXT,
  ADD COLUMN "registeredPincode" TEXT;
