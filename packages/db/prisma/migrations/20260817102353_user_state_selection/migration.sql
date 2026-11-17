-- Customer account-level state selection (nullable, one-time-settable by
-- the customer, admin-only thereafter — enforced in application code, not
-- the database). Existing rows backfill to NULL ("state not selected").
-- See User.stateId doc comment in schema.prisma.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "stateId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "IndianState"("id") ON DELETE SET NULL ON UPDATE CASCADE;
