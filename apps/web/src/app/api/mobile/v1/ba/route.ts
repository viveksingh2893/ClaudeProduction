import { NextRequest } from "next/server";
import {
  getBaProfileForUser,
  getBaWalletSummary,
  isBaProgramEnabled,
  listProposedOrdersForReferee,
} from "@kisan4u/orders";
import { jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

/** BA dashboard payload for the mobile Account → Business Associate screen. */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    const enabled = await isBaProgramEnabled();
    if (!enabled) return jsonOk({ enabled: false });

    const profile = await getBaProfileForUser(userId);
    const wallet = profile ? await getBaWalletSummary(profile.id) : null;
    const pendingApprovals = (await listProposedOrdersForReferee(userId)).filter(
      (p) => p.status === "AWAITING_REFEREE",
    );

    return jsonOk({
      enabled: true,
      profile,
      wallet,
      pendingApprovals: pendingApprovals.map((p) => ({
        id: p.id,
        grandTotal: Number(p.grandTotal),
        itemCount: p.items.length,
        createdAt: p.createdAt,
      })),
    });
  });
}
