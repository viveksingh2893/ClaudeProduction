ALTER TABLE "SellerProfile"
  ADD COLUMN "agreementStorageKey" TEXT,
  ADD COLUMN "agreementFileName" TEXT,
  ADD COLUMN "agreementUploadedAt" TIMESTAMP(3);
