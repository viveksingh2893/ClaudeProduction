import { NextRequest } from "next/server";
import { prisma, getFullName } from "@kisan4u/db";
import { getBaProfileForUser, isBaProgramEnabled } from "@kisan4u/orders";
import { jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

/**
 * Referred-customer picker for the mobile "Place an order for a customer"
 * screen — mirrors apps/web/src/app/account/ba/place/page.tsx exactly (same
 * query, same active-BA gate). Only customers who signed up with this BA's
 * own referral code appear, each with their saved addresses (a customer
 * with none can't be ordered for until they add one).
 */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    if (!(await isBaProgramEnabled())) return jsonOk({ customers: [] });

    const profile = await getBaProfileForUser(userId);
    if (!profile || (profile.frontendStatus !== "APPROVED" && profile.frontendStatus !== "APPROVED_NO_BANK")) {
      return jsonOk({ customers: [] });
    }

    const referred = await prisma.user.findMany({
      where: { referredByBaId: profile.id, role: "CUSTOMER", isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        addresses: {
          select: { id: true, fullName: true, line1: true, cityTown: true, state: true, pincode: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return jsonOk({
      customers: referred.map((r) => ({
        id: r.id,
        name: getFullName(r) ?? r.phone ?? "Customer",
        phone: r.phone,
        addresses: r.addresses.map((a) => ({
          id: a.id,
          label: `${a.fullName}, ${a.line1}, ${a.cityTown}, ${a.state} ${a.pincode}`,
        })),
      })),
    });
  });
}
