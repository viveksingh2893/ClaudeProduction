import { NextRequest } from "next/server";
import { submitBaForm1 } from "@kisan4u/orders";
import { baForm1Schema } from "@kisan4u/validators";
import { jsonError, jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    const parsed = baForm1Schema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError(400, "INVALID", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const res = await submitBaForm1(userId, parsed.data);
    if (!res.ok) return jsonError(400, "REJECTED", res.error);
    return jsonOk({ baId: res.baId });
  });
}
