-- Rename SellerStatus -> ApplicationStatus (identical enum values: PENDING,
-- APPROVED, REJECTED, SUSPENDED), now shared by both SellerProfile and
-- DealerProfile. A plain rename preserves existing SellerProfile.status
-- data instead of dropping/recreating the column.
ALTER TYPE "SellerStatus" RENAME TO "ApplicationStatus";

-- DealerProfile gets the same admin-approval status field, separate from
-- the existing kycStatus (which tracks document-submission progress).
ALTER TABLE "DealerProfile" ADD COLUMN "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING';

-- SellerProfile gets a rejection-reason field, symmetric with DealerProfile.
ALTER TABLE "SellerProfile" ADD COLUMN "rejectionReason" TEXT;
