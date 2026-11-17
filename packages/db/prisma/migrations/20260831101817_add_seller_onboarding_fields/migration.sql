-- AlterTable
ALTER TABLE "SellerProfile" ADD COLUMN     "bankBranch" TEXT,
ADD COLUMN     "companyWebsite" TEXT,
ADD COLUMN     "contactPersonName" TEXT,
ADD COLUMN     "ifscCode" TEXT,
ADD COLUMN     "registeredAddress" TEXT;

-- CreateTable
CREATE TABLE "_SellerSellingStates" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SellerSellingStates_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_SellerSellingStates_B_index" ON "_SellerSellingStates"("B");

-- AddForeignKey
ALTER TABLE "_SellerSellingStates" ADD CONSTRAINT "_SellerSellingStates_A_fkey" FOREIGN KEY ("A") REFERENCES "IndianState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SellerSellingStates" ADD CONSTRAINT "_SellerSellingStates_B_fkey" FOREIGN KEY ("B") REFERENCES "SellerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
