-- CreateEnum
CREATE TYPE "PosPaymentProofStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "PosPaymentProofSubmission" (
    "id" TEXT NOT NULL,
    "checkoutGroupId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "screenshotStorageKey" TEXT NOT NULL,
    "screenshotMimeType" TEXT NOT NULL,
    "screenshotSizeBytes" INTEGER NOT NULL,
    "status" "PosPaymentProofStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "previousSubmissionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosPaymentProofSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosPaymentProofSubmission_previousSubmissionId_key" ON "PosPaymentProofSubmission"("previousSubmissionId");

-- CreateIndex
CREATE INDEX "PosPaymentProofSubmission_checkoutGroupId_idx" ON "PosPaymentProofSubmission"("checkoutGroupId");

-- CreateIndex
CREATE INDEX "PosPaymentProofSubmission_status_idx" ON "PosPaymentProofSubmission"("status");

-- AddForeignKey
ALTER TABLE "PosPaymentProofSubmission" ADD CONSTRAINT "PosPaymentProofSubmission_checkoutGroupId_fkey" FOREIGN KEY ("checkoutGroupId") REFERENCES "CheckoutGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPaymentProofSubmission" ADD CONSTRAINT "PosPaymentProofSubmission_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPaymentProofSubmission" ADD CONSTRAINT "PosPaymentProofSubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPaymentProofSubmission" ADD CONSTRAINT "PosPaymentProofSubmission_previousSubmissionId_fkey" FOREIGN KEY ("previousSubmissionId") REFERENCES "PosPaymentProofSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
