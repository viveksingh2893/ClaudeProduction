-- Selling-licence module.
--
-- SellerLicense had zero rows in every environment this was generated
-- against (no writer ever existed for it) — safe to drop outright, no data
-- to preserve.
--
-- Product.licenseRequired had zero TRUE rows — safe to drop; there is no
-- LicenceRequirement data yet for it to map onto, and per the module's
-- design an admin must deliberately activate requirements per taxonomy
-- node going forward (see spec §11), not have them auto-inferred from this
-- legacy flag.
--
-- _IndianStateToProduct (the old unified Product.availableStates join
-- table) DOES hold real data and is preserved below — but only into the
-- new dealer-side table, not customer-side. Historically this table was
-- consulted only by the dealer catalogue/checkout path (see
-- packages/catalog/src/queries.ts getDealerCatalogue/getDealerProductDetail
-- pre-migration) — the farmer/customer catalogue never filtered by state at
-- all. Leaving every product's new customerAvailableStates empty (which
-- means "nationwide" under this schema's established convention) is what
-- actually keeps customer-facing behavior unchanged; copying the old rows
-- into the customer side too would silently introduce brand-new customer
-- restrictions that never existed before this migration.

-- CreateEnum
CREATE TYPE "TaxonomyNodeType" AS ENUM ('CATEGORY', 'SUBCATEGORY', 'SUBSUBCATEGORY');

-- CreateEnum
CREATE TYPE "LicenceGeoType" AS ENUM ('PAN_INDIA', 'STATE_WISE');

-- CreateEnum
CREATE TYPE "SellerLicenceAudience" AS ENUM ('CUSTOMER', 'DEALER', 'BOTH');

-- CreateEnum
CREATE TYPE "LicenceStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ComplianceReviewReason" AS ENUM ('LICENCE_EXPIRED', 'LICENCE_REJECTED', 'LICENCE_REVOKED', 'REQUIREMENT_ACTIVATED', 'REQUIREMENT_CHANGED');

-- CreateEnum
CREATE TYPE "ComplianceReviewStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "LicenceRequirement" (
    "id" TEXT NOT NULL,
    "taxonomyNodeType" "TaxonomyNodeType" NOT NULL,
    "taxonomyNodeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "customerRequired" BOOLEAN NOT NULL DEFAULT false,
    "customerGeoType" "LicenceGeoType",
    "dealerRequired" BOOLEAN NOT NULL DEFAULT false,
    "dealerGeoType" "LicenceGeoType",
    "sameLicenceForBothAudiences" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "previousVersionId" TEXT,
    "changeReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenceRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerLicenceSubmission" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "audience" "SellerLicenceAudience" NOT NULL,
    "licenceNumber" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "documentStorageKey" TEXT NOT NULL,
    "documentMimeType" TEXT NOT NULL,
    "documentSizeBytes" INTEGER NOT NULL,
    "status" "LicenceStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "rejectionReason" TEXT,
    "revocationReason" TEXT,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "previousRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerLicenceSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductComplianceReview" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "requirementId" TEXT,
    "submissionId" TEXT,
    "reason" "ComplianceReviewReason" NOT NULL,
    "affectedAudience" "SellerLicenceAudience" NOT NULL,
    "detail" TEXT NOT NULL,
    "status" "ComplianceReviewStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "ProductComplianceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ProductCustomerStates" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProductCustomerStates_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ProductDealerStates" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProductDealerStates_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_SellerLicenceCustomerStates" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SellerLicenceCustomerStates_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_SellerLicenceDealerStates" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SellerLicenceDealerStates_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "LicenceRequirement_previousVersionId_key" ON "LicenceRequirement"("previousVersionId");

-- CreateIndex
CREATE INDEX "LicenceRequirement_taxonomyNodeType_taxonomyNodeId_idx" ON "LicenceRequirement"("taxonomyNodeType", "taxonomyNodeId");

-- CreateIndex
CREATE INDEX "LicenceRequirement_isActive_idx" ON "LicenceRequirement"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SellerLicenceSubmission_previousRevisionId_key" ON "SellerLicenceSubmission"("previousRevisionId");

-- CreateIndex
CREATE INDEX "SellerLicenceSubmission_sellerId_idx" ON "SellerLicenceSubmission"("sellerId");

-- CreateIndex
CREATE INDEX "SellerLicenceSubmission_requirementId_idx" ON "SellerLicenceSubmission"("requirementId");

-- CreateIndex
CREATE INDEX "SellerLicenceSubmission_status_idx" ON "SellerLicenceSubmission"("status");

-- CreateIndex
CREATE INDEX "SellerLicenceSubmission_expiryDate_idx" ON "SellerLicenceSubmission"("expiryDate");

-- CreateIndex
CREATE INDEX "ProductComplianceReview_productId_idx" ON "ProductComplianceReview"("productId");

-- CreateIndex
CREATE INDEX "ProductComplianceReview_sellerId_idx" ON "ProductComplianceReview"("sellerId");

-- CreateIndex
CREATE INDEX "ProductComplianceReview_status_idx" ON "ProductComplianceReview"("status");

-- CreateIndex
CREATE INDEX "_ProductCustomerStates_B_index" ON "_ProductCustomerStates"("B");

-- CreateIndex
CREATE INDEX "_ProductDealerStates_B_index" ON "_ProductDealerStates"("B");

-- CreateIndex
CREATE INDEX "_SellerLicenceCustomerStates_B_index" ON "_SellerLicenceCustomerStates"("B");

-- CreateIndex
CREATE INDEX "_SellerLicenceDealerStates_B_index" ON "_SellerLicenceDealerStates"("B");

-- AddForeignKey
ALTER TABLE "LicenceRequirement" ADD CONSTRAINT "LicenceRequirement_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "LicenceRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerLicenceSubmission" ADD CONSTRAINT "SellerLicenceSubmission_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerLicenceSubmission" ADD CONSTRAINT "SellerLicenceSubmission_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "LicenceRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerLicenceSubmission" ADD CONSTRAINT "SellerLicenceSubmission_previousRevisionId_fkey" FOREIGN KEY ("previousRevisionId") REFERENCES "SellerLicenceSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductComplianceReview" ADD CONSTRAINT "ProductComplianceReview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductComplianceReview" ADD CONSTRAINT "ProductComplianceReview_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductComplianceReview" ADD CONSTRAINT "ProductComplianceReview_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "LicenceRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductComplianceReview" ADD CONSTRAINT "ProductComplianceReview_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "SellerLicenceSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductCustomerStates" ADD CONSTRAINT "_ProductCustomerStates_A_fkey" FOREIGN KEY ("A") REFERENCES "IndianState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductCustomerStates" ADD CONSTRAINT "_ProductCustomerStates_B_fkey" FOREIGN KEY ("B") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductDealerStates" ADD CONSTRAINT "_ProductDealerStates_A_fkey" FOREIGN KEY ("A") REFERENCES "IndianState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductDealerStates" ADD CONSTRAINT "_ProductDealerStates_B_fkey" FOREIGN KEY ("B") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SellerLicenceCustomerStates" ADD CONSTRAINT "_SellerLicenceCustomerStates_A_fkey" FOREIGN KEY ("A") REFERENCES "IndianState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SellerLicenceCustomerStates" ADD CONSTRAINT "_SellerLicenceCustomerStates_B_fkey" FOREIGN KEY ("B") REFERENCES "SellerLicenceSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SellerLicenceDealerStates" ADD CONSTRAINT "_SellerLicenceDealerStates_A_fkey" FOREIGN KEY ("A") REFERENCES "IndianState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SellerLicenceDealerStates" ADD CONSTRAINT "_SellerLicenceDealerStates_B_fkey" FOREIGN KEY ("B") REFERENCES "SellerLicenceSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing dealer-state availability data (see header note) before
-- dropping the old unified join table.
INSERT INTO "_ProductDealerStates" ("A", "B") SELECT "A", "B" FROM "_IndianStateToProduct";

-- DropForeignKey
ALTER TABLE "SellerLicense" DROP CONSTRAINT "SellerLicense_sellerId_fkey";

-- DropForeignKey
ALTER TABLE "_IndianStateToProduct" DROP CONSTRAINT "_IndianStateToProduct_A_fkey";

-- DropForeignKey
ALTER TABLE "_IndianStateToProduct" DROP CONSTRAINT "_IndianStateToProduct_B_fkey";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "licenseRequired";

-- DropTable
DROP TABLE "SellerLicense";

-- DropTable
DROP TABLE "_IndianStateToProduct";

-- DropEnum
DROP TYPE "LicenseScope";

-- DropEnum
DROP TYPE "LicenseStatus";
