/**
 * One-off: registers every APPROVED seller pickup point as a pickup location
 * on RapidShyp and on every configured Delhivery account — the catch-up for
 * points approved before courier-pickup-sync.ts existed (until then only
 * Delhivery was registered on approval, and RapidShyp used one hand-typed
 * name per SELLER, so a multi-warehouse seller always shipped from one
 * address).
 *
 * RapidShyp locations that already exist are adopted instead of duplicated:
 * a point whose seller had a hand-mapped SellerProfile.rapidshypPickupName
 * adopts that location when its pincode matches the point's; a point whose
 * K4U-<id> name is already on RapidShyp adopts that. Everything else is
 * created. Delhivery registration is idempotent (an existing warehouse
 * answers "already exists"), so every point is re-sent to every account.
 *
 * Run from the main checkout with the dashboard's env loaded (courier
 * credentials + DATABASE_URL):
 *
 *   DOTENV_CONFIG_PATH=../../apps/dashboard/.env pnpm --filter @kisan4u/orders exec tsx scripts/sync-pickup-points-to-couriers.ts
 *
 * Options:
 *   (default)        Dry run: prints the plan, including the exact RapidShyp
 *                    payload per new location. No courier calls that write,
 *                    no database writes. Works before the migration is applied.
 *   --apply          Adopt/create/register for real.
 *   --point=<id>     Only this pickup point.
 *   --skip=<id,...>  Leave these pickup points out.
 *   --delay-ms=<n>   Pause between points in --apply (default 1000).
 */
import "dotenv/config";
import { prisma } from "@kisan4u/db";
import { configuredDelhiveryAccounts, rapidshypFetchPickupLocations } from "@kisan4u/providers";
import {
  courierLocationNameFor,
  rapidshypLocationNameFor,
  pickupAddressText,
  rapidshypPickupLocationPayload,
  syncPickupPointToCouriers,
} from "../src/courier-pickup-sync";

const APPLY = process.argv.includes("--apply");
const pointArg = process.argv.find((a) => a.startsWith("--point="));
const ONLY_POINT = pointArg?.split("=")[1];
const skipArg = process.argv.find((a) => a.startsWith("--skip="));
const SKIP = skipArg ? skipArg.split("=")[1]!.split(",").filter(Boolean) : [];
const delayArg = process.argv.find((a) => a.startsWith("--delay-ms="));
const DELAY_MS = delayArg ? Number(delayArg.split("=")[1]) : 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Plan =
  | { kind: "adopt"; name: string; why: string }
  | { kind: "create"; name: string; payload: ReturnType<typeof rapidshypPickupLocationPayload>; problems: string[] }
  | { kind: "already-synced"; name: string };

async function main() {
  // Explicit select of pre-migration columns only, so the dry run works
  // against a database that hasn't had the courier-sync migration yet.
  const points = await prisma.sellerPickupPoint.findMany({
    where: {
      approvalStatus: "APPROVED",
      ...(ONLY_POINT ? { id: ONLY_POINT } : {}),
      ...(SKIP.length ? { id: { notIn: SKIP } } : {}),
    },
    select: {
      id: true,
      sellerId: true,
      name: true,
      contactPerson: true,
      mobile: true,
      line1: true,
      landmark: true,
      city: true,
      state: true,
      pincode: true,
      isActive: true,
      delhiveryWarehouseName: true,
      seller: { select: { shopName: true, contactEmail: true, rapidshypPickupName: true } },
    },
    orderBy: [{ seller: { shopName: "asc" } }, { createdAt: "asc" }],
  });

  const rsList = await rapidshypFetchPickupLocations();
  if (!rsList.ok) throw new Error(`Could not list RapidShyp pickup locations: ${rsList.error}`);
  const rsByName = new Map(rsList.data.map((l) => [l.pickupName, l]));

  const synced = APPLY
    ? new Map(
        (
          await prisma.sellerPickupPoint.findMany({
            where: { id: { in: points.map((p) => p.id) } },
            select: { id: true, rapidshypPickupName: true, rapidshypSyncedRevision: true, courierAddressRevision: true },
          })
        ).map((p) => [p.id, p]),
      )
    : new Map<string, { rapidshypPickupName: string | null; rapidshypSyncedRevision: number | null; courierAddressRevision: number }>();

  const plans = points.map((p): { point: (typeof points)[number]; plan: Plan } => {
    const s = synced.get(p.id);
    if (s?.rapidshypPickupName && s.rapidshypSyncedRevision === s.courierAddressRevision) {
      return { point: p, plan: { kind: "already-synced", name: s.rapidshypPickupName } };
    }
    const ownName = rapidshypLocationNameFor(p.id, s?.courierAddressRevision ?? 0);
    if (rsByName.has(ownName)) {
      return { point: p, plan: { kind: "adopt", name: ownName, why: "already on RapidShyp under its K4U name" } };
    }
    const sellerName = p.seller.rapidshypPickupName;
    const sellerLoc = sellerName ? rsByName.get(sellerName) : undefined;
    if (sellerName && sellerLoc && sellerLoc.pinCode === p.pincode && sellerLoc.status === "enabled") {
      return {
        point: p,
        plan: { kind: "adopt", name: sellerName, why: `seller's existing RapidShyp location, same pincode ${p.pincode}` },
      };
    }
    const payload = rapidshypPickupLocationPayload(
      {
        ...p,
        courierAddressRevision: 0,
        rapidshypPickupName: null,
        rapidshypSyncedRevision: null,
        delhiverySyncedRevision: null,
      },
      ownName,
      p.seller.contactEmail,
    );
    const problems: string[] = [];
    if (!/^[6-9]\d{9}$/.test(payload.contactNumber)) problems.push(`mobile "${p.mobile}" is not a valid 10-digit number`);
    if (!/^\d{6}$/.test(payload.pincode)) problems.push(`pincode "${p.pincode}" is not 6 digits`);
    if (payload.addressLine.length < 3) problems.push("address line is under 3 characters");
    if (payload.truncated) problems.push("address longer than 200 chars — the tail is dropped");
    if (payload.contactName !== p.contactPerson.trim()) problems.push(`contact name sent as "${payload.contactName}" (letters only)`);
    return { point: p, plan: { kind: "create", name: ownName, payload, problems } };
  });

  const accounts = configuredDelhiveryAccounts();
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${points.length} approved pickup point(s); Delhivery accounts: ${accounts.join(", ") || "(none configured)"}`);
  console.log(`RapidShyp currently has: ${rsList.data.map((l) => `${l.pickupName} (${l.pinCode}, ${l.status})`).join("; ")}\n`);

  for (const { point: p, plan } of plans) {
    console.log(`• ${p.seller.shopName} — ${p.name} (${p.pincode})${p.isActive ? "" : " [inactive]"}  id=${p.id}`);
    console.log(`    address: ${pickupAddressText(p)}, ${p.city}, ${p.state}`);
    if (plan.kind === "already-synced") console.log(`    RapidShyp: already registered as "${plan.name}"`);
    if (plan.kind === "adopt") console.log(`    RapidShyp: ADOPT "${plan.name}" (${plan.why})`);
    if (plan.kind === "create") {
      const { truncated: _t, ...payload } = plan.payload;
      console.log(`    RapidShyp: CREATE "${plan.name}"`);
      console.log(`      contact: ${payload.contactName} / ${payload.contactNumber} / ${payload.email}`);
      console.log(`      line1:   ${payload.addressLine}`);
      if (payload.addressLine2) console.log(`      line2:   ${payload.addressLine2}`);
      for (const problem of plan.problems) console.log(`      ⚠ ${problem}`);
    }
    console.log(`    Delhivery: register "${p.delhiveryWarehouseName ?? courierLocationNameFor(p.id)}" on ${accounts.length} account(s) (no-op where it exists)`);
  }

  const counts = plans.reduce<Record<string, number>>((acc, { plan }) => {
    acc[plan.kind] = (acc[plan.kind] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\nRapidShyp plan: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ")}`);

  if (!APPLY) {
    console.log("\nDry run only — re-run with --apply to register.");
    return;
  }

  let failed = 0;
  for (const { point: p, plan } of plans) {
    if (plan.kind === "adopt") {
      await prisma.sellerPickupPoint.update({
        where: { id: p.id },
        data: { rapidshypPickupName: plan.name, rapidshypSyncedRevision: synced.get(p.id)?.courierAddressRevision ?? 0 },
      });
    }
    const result = await syncPickupPointToCouriers(p.id);
    const rs = result.rapidshyp.ok ? `RapidShyp ✓ ${result.rapidshyp.name}` : `RapidShyp ✗ ${result.rapidshyp.error}`;
    const dl = result.delhivery
      .map((d) => `${d.account} ${d.result.ok ? "✓" : `✗ ${d.result.error}`}`)
      .join(", ");
    if (result.warning) failed += 1;
    console.log(`${result.warning ? "✗" : "✓"} ${p.seller.shopName} — ${p.name}: ${rs}; Delhivery ${dl}`);
    await sleep(DELAY_MS);
  }
  console.log(`\nDone: ${plans.length - failed} fully registered, ${failed} with failures (see courierSyncError on the admin pickup points page).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
