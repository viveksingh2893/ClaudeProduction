import { prisma } from "@kisan4u/db";
import { delhiveryGenerateLabel, type DelhiveryAccountKey } from "@kisan4u/providers";

/**
 * Resolves the shipping-label PDF URL for a seller order's shipment, with
 * the same ownership discipline as getInvoiceDataFor*.
 *
 * RapidShyp's label URL is a permanent public S3 link stored on
 * Shipment.labelUrl at dispatch (or backfilled by its tracking poll) — we
 * just read it back. Delhivery's packing-slip URL is a *presigned* S3
 * link that expires in ~24h, so for a Delhivery shipment this re-fetches
 * a fresh URL on every request (falling back to the stored one only if
 * the live call fails). Either way the caller gets `{ url, orderNumber }`.
 */
export type RapidShypLabelFetch =
  | { ok: true; url: string; orderNumber: string }
  | { ok: false; error: string };

const LABEL_SELECT = {
  orderNumber: true,
  shipment: {
    select: { provider: true, labelUrl: true, awbNumber: true, delhiveryAccount: true },
  },
} as const;

type LabelOrder = {
  orderNumber: string;
  shipment: {
    provider: string;
    labelUrl: string | null;
    awbNumber: string | null;
    delhiveryAccount: string | null;
  } | null;
} | null;

async function toFetch(order: LabelOrder): Promise<RapidShypLabelFetch> {
  if (!order || !order.shipment) return { ok: false, error: "No shipment for this order." };
  const { provider, labelUrl, awbNumber, delhiveryAccount } = order.shipment;

  if (provider === "DELHIVERY" && awbNumber) {
    const account = (delhiveryAccount ?? "MARKETING1") as DelhiveryAccountKey;
    const fresh = await delhiveryGenerateLabel(account, awbNumber);
    if (fresh.ok) return { ok: true, url: fresh.data.labelUrl, orderNumber: order.orderNumber };
    if (labelUrl) return { ok: true, url: labelUrl, orderNumber: order.orderNumber };
    return { ok: false, error: `Delhivery: ${fresh.error}` };
  }

  // RapidShyp (permanent URL) or any other provider that stored one.
  if (!labelUrl) return { ok: false, error: "No shipping label is available for this shipment yet." };
  return { ok: true, url: labelUrl, orderNumber: order.orderNumber };
}

/** Admin / orders-section: any seller order. */
export async function getRapidShypLabelForAdmin(sellerOrderId: string): Promise<RapidShypLabelFetch> {
  return toFetch(
    await prisma.sellerOrder.findFirst({ where: { id: sellerOrderId }, select: LABEL_SELECT }),
  );
}

/** Seller: scoped to their own orders only (sellerId is the SellerProfile id). */
export async function getRapidShypLabelForSeller(
  sellerId: string,
  sellerOrderId: string,
): Promise<RapidShypLabelFetch> {
  return toFetch(
    await prisma.sellerOrder.findFirst({
      where: { id: sellerOrderId, sellerId },
      select: LABEL_SELECT,
    }),
  );
}
