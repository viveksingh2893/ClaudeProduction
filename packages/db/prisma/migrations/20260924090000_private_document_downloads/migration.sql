CREATE TABLE "PrivateDocumentDownload" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrivateDocumentDownload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrivateDocumentDownload_tokenHash_key" ON "PrivateDocumentDownload"("tokenHash");
CREATE INDEX "PrivateDocumentDownload_expiresAt_idx" ON "PrivateDocumentDownload"("expiresAt");
CREATE INDEX "PrivateDocumentDownload_userId_createdAt_idx" ON "PrivateDocumentDownload"("userId", "createdAt");
