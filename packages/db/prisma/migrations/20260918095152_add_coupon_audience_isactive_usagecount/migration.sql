/*
  Warnings:

  - Added the required column `audience` to the `Coupon` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "audience" "ProductAudience" NOT NULL,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "usageCount" INTEGER NOT NULL DEFAULT 0;
