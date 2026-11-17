-- Diagnostic-only timestamp for the admin compliance panel — see
-- Product.licenceComplianceCheckedAt doc comment in schema.prisma.
ALTER TABLE "Product" ADD COLUMN     "licenceComplianceCheckedAt" TIMESTAMP(3);
