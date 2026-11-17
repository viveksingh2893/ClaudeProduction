-- CreateTable
CREATE TABLE "PosPricingConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "codDiscountPercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "fullPrepaidDiscountPercent" DECIMAL(65,30) NOT NULL DEFAULT 5,
    "partialPrepaidDiscountPercent" DECIMAL(65,30) NOT NULL DEFAULT 2,
    "partialPrepaidPercent" DECIMAL(65,30) NOT NULL DEFAULT 20,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosPricingConfig_pkey" PRIMARY KEY ("id")
);
