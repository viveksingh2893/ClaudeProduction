import { NextRequest } from "next/server";
import { getBaProfileForUser, isBaProgramEnabled, listBaReferees } from "@kisan4u/orders";
import { jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

/** Read-only referral roster for an approved Business Associate. */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    if (!(await isBaProgramEnabled())) return jsonOk({ referees: [] });

    const profile = await getBaProfileForUser(userId);
    if (!profile || (profile.frontendStatus !== "APPROVED" && profile.frontendStatus !== "APPROVED_NO_BANK")) {
      return jsonOk({ referees: [] });
    }

    const rows = await listBaReferees(profile.id);
    return jsonOk({
      referees: rows.map((row) => ({
        id: row.id,
        name:
          [row.firstName, row.lastName].filter(Boolean).join(" ") || row.phone || "Customer",
        phone: row.phone,
        role: row.role,
        joinedAt: row.joinedAt,
        orderCount: row.orderCount,
        orderValue: row.orderValue,
      })),
    });
  });
}
