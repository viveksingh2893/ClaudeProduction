/**
 * One-off catch-up for courier shipments stuck at DELIVERY_FAILED.
 *
 * Until the fix alongside this script, neither tracking poller re-checked a
 * DELIVERY_FAILED shipment, and a courier reporting delivery after a failed
 * attempt crashed the transition (it tried to walk the order from PACKED).
 * So orders the courier later re-delivered or sent back (RTO) never moved on
 * the portal. This re-syncs every such shipment through the normal refresh
 * path — refreshRapidShypTrackingStatus / refreshDelhiveryTrackingStatus —
 * so delivered orders get the usual DELIVERED side effects (payment
 * collection, settlement rows, loyalty points, buyer notification) and
 * RTO'd orders get the usual RTO refund handling.
 *
 * Run from the main checkout with the dashboard's env loaded (courier
 * credentials + DATABASE_URL):
 *
 *   pnpm --filter @kisan4u/orders exec tsx scripts/backfill-delivery-failed-shipments.ts --dry-run
 *
 * Options:
 *   --dry-run          Ask each courier for its live status and print what
 *                      WOULD happen. No database writes at all.
 *   --order=<number>   Only this seller order (e.g. K4U-20260911-6743-S1).
 *   --delay-ms=<n>     Pause between courier calls (default 1500).
 */
import "dotenv/config";
import { prisma, type OrderStatus } from "@kisan4u/db";
import {
  delhiveryTrackShipment,
  rapidshypTrackOrder,
  resolveDelhiveryShipmentStatus,
  resolveRapidShypForwardStatus,
  type DelhiveryAccountKey,
} from "@kisan4u/providers";
import { refreshDelhiveryTrackingStatus } from "../src/delhivery-shipping";
import { refreshRapidShypTrackingStatus } from "../src/rapidshyp-shipping";
import {
  isRepeatOfCurrentShipmentStatus,
  planForwardShipmentSteps,
  type ShipmentTransitionEvent,
} from "../src/order-workflow";

const DRY_RUN = process.argv.includes("--dry-run");
const orderArg = process.argv.find((a) => a.startsWith("--order="));
const ONLY_ORDER = orderArg?.split("=")[1];
const delayArg = process.argv.find((a) => a.startsWith("--delay-ms="));
const DELAY_MS = delayArg ? Number(delayArg.split("=")[1]) : 1500;

const ACTOR_ID = "system:delivery-failed-backfill";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Shipment = Awaited<ReturnType<typeof loadShipments>>[number];

function loadShipments() {
  return prisma.shipment.findMany({
    where: {
      status: "DELIVERY_FAILED",
      provider: { in: ["RAPIDSHYP", "DELHIVERY"] },
      ...(ONLY_ORDER ? { sellerOrder: { orderNumber: ONLY_ORDER } } : {}),
    },
    select: {
      provider: true,
      awbNumber: true,
      rapidshypOrderId: true,
      delhiveryAccount: true,
      trackingStatusCode: true,
      sellerOrder: { select: { id: true, orderNumber: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** The courier's live code + our mapping of it, fetched read-only. */
async function fetchLiveStatus(
  s: Shipment,
): Promise<{ code?: string; desc?: string; mapped?: ShipmentTransitionEvent; error?: string }> {
  if (s.provider === "RAPIDSHYP") {
    if (!s.rapidshypOrderId) return { error: "no RapidShyp order id" };
    const tracked = await rapidshypTrackOrder({ orderId: s.rapidshypOrderId });
    if (!tracked.ok) return { error: tracked.error };
    const code = tracked.data.shipment?.statusCode;
    return {
      code,
      desc: tracked.data.shipment?.statusDesc,
      mapped: code ? resolveRapidShypForwardStatus(code) : undefined,
    };
  }
  if (!s.awbNumber) return { error: "no AWB" };
  const account = (s.delhiveryAccount ?? "MARKETING1") as DelhiveryAccountKey;
  const tracked = await delhiveryTrackShipment(account, s.awbNumber);
  if (!tracked.ok) return { error: tracked.error };
  return {
    code: tracked.data.status,
    desc: tracked.data.statusDesc,
    mapped: resolveDelhiveryShipmentStatus(tracked.data.status, tracked.data.statusType),
  };
}

/** What refresh would do to the order, mirroring advanceShipmentToStatus. */
function describeOutcome(current: OrderStatus, mapped: ShipmentTransitionEvent | undefined): string {
  if (!mapped || isRepeatOfCurrentShipmentStatus(current, mapped)) return "no change";
  if (mapped === "RTO_INITIATED") return "→ RTO_INITIATED (+ RTO refund handling)";
  if (mapped === "RTO_DELIVERED_TO_SELLER")
    return current === "RTO_INITIATED"
      ? "→ RTO_DELIVERED_TO_SELLER"
      : "→ RTO_INITIATED → RTO_DELIVERED_TO_SELLER (+ RTO refund handling)";
  if (mapped === "DELIVERY_FAILED") return "no change";
  const plan = planForwardShipmentSteps(current, mapped);
  if (!plan.ok) return `ERROR: ${plan.error}`;
  if (plan.steps.length === 0) return "no change";
  return `→ ${plan.steps.join(" → ")}`;
}

async function main() {
  const shipments = await loadShipments();
  console.log(
    `${shipments.length} DELIVERY_FAILED shipment(s)${ONLY_ORDER ? ` for ${ONLY_ORDER}` : ""}` +
      `${DRY_RUN ? " — DRY RUN, nothing will be written" : ""}\n`,
  );

  const tally = new Map<string, number>();
  const bump = (key: string) => tally.set(key, (tally.get(key) ?? 0) + 1);

  for (const [i, s] of shipments.entries()) {
    if (i > 0) await sleep(DELAY_MS);
    const order = s.sellerOrder;
    const prefix = `${order.orderNumber.padEnd(22)} ${s.provider.padEnd(9)} portal ${order.status}`;

    if (DRY_RUN) {
      const live = await fetchLiveStatus(s);
      if (live.error) {
        console.log(`${prefix} | courier ERROR: ${live.error}`);
        bump("courier error");
        continue;
      }
      const outcome = describeOutcome(order.status, live.mapped);
      console.log(`${prefix} | courier ${live.code ?? "-"} (${live.desc ?? "-"}) | ${outcome}`);
      bump(
        outcome.startsWith("ERROR")
          ? "would error"
          : outcome.includes("RTO_DELIVERED_TO_SELLER")
            ? "would go to RTO (back with seller)"
            : outcome.includes("RTO")
              ? "would go to RTO (on its way back)"
              : outcome.endsWith("DELIVERED")
                ? "would go to DELIVERED"
                : outcome.endsWith("IN_TRANSIT")
                  ? "would go to IN_TRANSIT (re-attempt)"
                  : "would stay DELIVERY_FAILED",
      );
      continue;
    }

    const result =
      s.provider === "RAPIDSHYP"
        ? await refreshRapidShypTrackingStatus(ACTOR_ID, order.id)
        : await refreshDelhiveryTrackingStatus(ACTOR_ID, order.id);
    const after = await prisma.sellerOrder.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    console.log(
      `${prefix} → now ${after.status}${result.ok ? "" : ` | ERROR: ${result.error}`}`,
    );
    bump(result.ok ? after.status : "error");
  }

  console.log("\nSummary:");
  for (const [key, count] of [...tally.entries()].sort()) console.log(`  ${key.padEnd(28)} ${count}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
