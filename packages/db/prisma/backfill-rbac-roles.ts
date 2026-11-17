import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * One-off, idempotent backfill for the RBAC rollout — seeds "Super Admin"
 * (isSystem, every permission on every known module) and "Sales Agent"
 * (pos: VIEW+CREATE only), then backfills every existing AdminProfile with
 * no roleId onto Super Admin. Must be run — and its result verified —
 * BEFORE any route starts calling hasPermission() (packages/auth/src/
 * permissions.ts), since that check fails CLOSED: an admin account left
 * without a role would lose all access the instant a route starts calling
 * it. Deliberately standalone rather than folded into `pnpm db:seed` for a
 * real environment run, since that script also seeds a large amount of
 * unrelated demo data not safe to blindly re-run against a database that
 * already holds real business data. The demo-seed script (seed.ts) runs
 * the same logic for fresh local/dev/CI setups.
 */
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const KNOWN_MODULES = ["pos", "roles", "payment-verification", "account-deletions"] as const;
const PERMISSION_ACTIONS = ["VIEW", "CREATE", "EDIT", "DELETE"] as const;

async function main() {
  const superAdmin = await prisma.role.upsert({
    where: { name: "Super Admin" },
    update: { isSystem: true },
    create: { name: "Super Admin", description: "Full access to every module.", isSystem: true },
  });
  for (const moduleKey of KNOWN_MODULES) {
    for (const action of PERMISSION_ACTIONS) {
      await prisma.rolePermission.upsert({
        where: { roleId_module_action: { roleId: superAdmin.id, module: moduleKey, action } },
        update: { granted: true },
        create: { roleId: superAdmin.id, module: moduleKey, action, granted: true },
      });
    }
  }

  const salesAgent = await prisma.role.upsert({
    where: { name: "Sales Agent" },
    update: {},
    create: { name: "Sales Agent", description: "Can place orders through POS." },
  });
  for (const action of ["VIEW", "CREATE"] as const) {
    await prisma.rolePermission.upsert({
      where: { roleId_module_action: { roleId: salesAgent.id, module: "pos", action } },
      update: { granted: true },
      create: { roleId: salesAgent.id, module: "pos", action, granted: true },
    });
  }

  const paymentVerifier = await prisma.role.upsert({
    where: { name: "Payment Verifier" },
    update: {},
    create: {
      name: "Payment Verifier",
      description:
        "Views the order table and approves/rejects uploaded payment screenshots for partial/full prepaid orders. Nothing else.",
    },
  });
  for (const action of ["VIEW", "EDIT"] as const) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_module_action: { roleId: paymentVerifier.id, module: "payment-verification", action },
      },
      update: { granted: true },
      create: { roleId: paymentVerifier.id, module: "payment-verification", action, granted: true },
    });
  }

  const backfilled = await prisma.adminProfile.updateMany({
    where: { roleId: null },
    data: { roleId: superAdmin.id },
  });

  const stillUnassigned = await prisma.adminProfile.count({ where: { roleId: null } });
  const totalAdminProfiles = await prisma.adminProfile.count();

  console.log("Super Admin role:", superAdmin.id);
  console.log("Sales Agent role:", salesAgent.id);
  console.log("Payment Verifier role:", paymentVerifier.id);
  console.log("AdminProfile rows backfilled this run:", backfilled.count);
  console.log("AdminProfile rows total / still unassigned:", totalAdminProfiles, "/", stillUnassigned);
  if (stillUnassigned > 0) {
    throw new Error(
      `${stillUnassigned} AdminProfile row(s) still have no roleId — do not wire hasPermission() into any route until this is 0.`,
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
