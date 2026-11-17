-- Business/e-commerce contact + PAN number text on SellerProfile.
-- All nullable, additive only. Kept separate from the login identity on
-- User (User.email / User.phone), which stay the sign-in credentials.
-- The uploaded PAN document itself stays on panDocUrl.
ALTER TABLE "SellerProfile" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "SellerProfile" ADD COLUMN "contactMobile" TEXT;
ALTER TABLE "SellerProfile" ADD COLUMN "panNumber" TEXT;
