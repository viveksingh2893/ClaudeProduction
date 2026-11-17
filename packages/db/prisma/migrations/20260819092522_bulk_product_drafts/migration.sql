-- Additive-only: three new tables (BulkProductDraft/Group/Row) + one
-- new enum for the "Add Multiple Products" bulk-entry feature. No existing
-- table, column, or enum is touched.

-- CreateEnum
CREATE TYPE "BulkDraftStatus" AS ENUM ('OPEN', 'SUBMITTING', 'COMPLETED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "BulkProductDraft" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sellerId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "status" "BulkDraftStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkProductDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkProductGroup" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "existingProductId" TEXT,
    "hasVariants" BOOLEAN NOT NULL DEFAULT false,
    "audience" "ProductAudience",
    "sharedData" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkProductGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkProductRow" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "audience" "VariantAudience" NOT NULL,
    "existingVariantId" TEXT,
    "rowData" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkProductRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulkProductDraft_sellerId_idx" ON "BulkProductDraft"("sellerId");

-- CreateIndex
CREATE INDEX "BulkProductDraft_createdByUserId_idx" ON "BulkProductDraft"("createdByUserId");

-- CreateIndex
CREATE INDEX "BulkProductDraft_status_idx" ON "BulkProductDraft"("status");

-- CreateIndex
CREATE INDEX "BulkProductGroup_draftId_idx" ON "BulkProductGroup"("draftId");

-- CreateIndex
CREATE INDEX "BulkProductGroup_existingProductId_idx" ON "BulkProductGroup"("existingProductId");

-- CreateIndex
CREATE UNIQUE INDEX "BulkProductGroup_draftId_groupKey_key" ON "BulkProductGroup"("draftId", "groupKey");

-- CreateIndex
CREATE INDEX "BulkProductRow_groupId_idx" ON "BulkProductRow"("groupId");

-- CreateIndex
CREATE INDEX "BulkProductRow_existingVariantId_idx" ON "BulkProductRow"("existingVariantId");

-- AddForeignKey
ALTER TABLE "BulkProductDraft" ADD CONSTRAINT "BulkProductDraft_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkProductDraft" ADD CONSTRAINT "BulkProductDraft_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkProductGroup" ADD CONSTRAINT "BulkProductGroup_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "BulkProductDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkProductRow" ADD CONSTRAINT "BulkProductRow_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "BulkProductGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

