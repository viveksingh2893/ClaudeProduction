import { NextRequest } from "next/server";
import { restoreAccount } from "@kisan4u/orders";
import { jsonError, jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    const result = await restoreAccount(userId);
    if (!result.ok) return jsonError(409, "RESTORE_FAILED", result.error);
    return jsonOk({ restored: true });
  });
}
