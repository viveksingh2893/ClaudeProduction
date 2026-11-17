CREATE TABLE "DealerOnboardingUpload" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DealerOnboardingUpload_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SellerOnboardingSession" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "ip" TEXT,
    "uploadCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SellerOnboardingSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SellerOnboardingUpload" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SellerOnboardingUpload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DealerOnboardingUpload_storageKey_key" ON "DealerOnboardingUpload"("storageKey");
CREATE INDEX "DealerOnboardingUpload_sessionId_createdAt_idx" ON "DealerOnboardingUpload"("sessionId", "createdAt");
CREATE INDEX "SellerOnboardingSession_phone_idx" ON "SellerOnboardingSession"("phone");
CREATE INDEX "SellerOnboardingSession_expiresAt_idx" ON "SellerOnboardingSession"("expiresAt");
CREATE UNIQUE INDEX "SellerOnboardingUpload_storageKey_key" ON "SellerOnboardingUpload"("storageKey");
CREATE INDEX "SellerOnboardingUpload_sessionId_createdAt_idx" ON "SellerOnboardingUpload"("sessionId", "createdAt");

ALTER TABLE "DealerOnboardingUpload" ADD CONSTRAINT "DealerOnboardingUpload_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "DealerOnboardingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SellerOnboardingUpload" ADD CONSTRAINT "SellerOnboardingUpload_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "SellerOnboardingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
