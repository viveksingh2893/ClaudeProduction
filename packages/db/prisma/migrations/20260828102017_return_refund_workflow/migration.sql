/*
  Warnings:

  - Added the required column `refundMethod` to the `RefundRequest` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('WALLET', 'ORIGINAL_SOURCE', 'BANK_TRANSFER');

-- AlterTable
ALTER TABLE "RefundRequest" ADD COLUMN     "bankAccountHolderName" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankIfsc" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "externalReference" TEXT,
ADD COLUMN     "refundMethod" "RefundMethod" NOT NULL;
