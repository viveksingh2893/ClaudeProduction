/**
 * One-time backfill for DealerProfile.hasMissingDocuments on dealers that
 * existed before this field did. Computes it the same way
 * migrate-legacy-dealers.ts now does going forward: true when APPROVED and
 * either gstDocUrl or licenseDocUrl is null. Idempotent — safe to re-run,
 * always recomputes from the current gstDocUrl/licenseDocUrl state rather
 * than only ever setting true.
 *
 * Usage:
 *   tsx prisma/backfill-dealer-missing-documents.ts --dry-run
 *   tsx prisma/backfill-dealer-missing-documents.ts
 */
import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const approved = await prisma.dealerProfile.findMany({
    where: { status: "APPROVED" },
    select: { id: true, gstDocUrl: true, licenseDocUrl: true, hasMissingDocuments: true },
  });

  const shouldBeMissing = approved.filter((d) => !d.gstDocUrl || !d.licenseDocUrl);
  const shouldBeComplete = approved.filter((d) => d.gstDocUrl && d.licenseDocUrl);
  const toFlagTrue = shouldBeMissing.filter((d) => !d.hasMissingDocuments);
  const toFlagFalse = shouldBeComplete.filter((d) => d.hasMissingDocuments);

  console.log(`${approved.length} APPROVED dealers total.`);
  console.log(`  missing a document: ${shouldBeMissing.length} (${toFlagTrue.length} need flagging true)`);
  console.log(`  fully documented: ${shouldBeComplete.length} (${toFlagFalse.length} need flagging false)`);

  if (dryRun) {
    console.log("Dry run — nothing written.");
    return;
  }

  if (toFlagTrue.length > 0) {
    const r = await prisma.dealerProfile.updateMany({
      where: { id: { in: toFlagTrue.map((d) => d.id) } },
      data: { hasMissingDocuments: true },
    });
    console.log(`Flagged true: ${r.count}`);
  }
  if (toFlagFalse.length > 0) {
    const r = await prisma.dealerProfile.updateMany({
      where: { id: { in: toFlagFalse.map((d) => d.id) } },
      data: { hasMissingDocuments: false },
    });
    console.log(`Flagged false: ${r.count}`);
  }
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
