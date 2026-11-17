import { NextRequest } from "next/server";
import { prisma } from "@kisan4u/db";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileAuth,
  withMobileApi,
} from "@/lib/mobile-api";

export async function PATCH(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    const body = (await parseJsonBody(req)) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
    if (!name || name.length > 120) return jsonError(400, "VALIDATION_ERROR", "Enter your name.");
    const [firstName, ...rest] = name.split(" ");
    const user = await prisma.user.update({
      where: { id: userId },
      data: { firstName, lastName: rest.join(" ") || null },
      select: { firstName: true, lastName: true },
    });
    return jsonOk({ user });
  });
}
