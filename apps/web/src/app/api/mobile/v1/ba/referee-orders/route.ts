import { NextRequest } from "next/server";
import {
  getBaProfileForUser,
  isBaProgramEnabled,
  listBaRefereeOrders,
} from "@kisan4u/orders";
import { jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

/** Recent orders belonging to customers referred by the active BA. */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    if (!(await isBaProgramEnabled())) return jsonOk({ orders: [] });

    const profile = await getBaProfileForUser(userId);
    if (!profile || (profile.frontendStatus !== "APPROVED" && profile.frontendStatus !== "APPROVED_NO_BANK")) {
      return jsonOk({ orders: [] });
    }

    const orders = await listBaRefereeOrders(profile.id);
    return jsonOk({ orders });
  });
}
