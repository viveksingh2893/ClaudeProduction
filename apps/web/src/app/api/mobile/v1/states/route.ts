import { prisma } from "@kisan4u/db";
import { jsonOk, withMobileApi } from "@/lib/mobile-api";

/** Public — used by dealer registration and address forms. */
export async function GET() {
  return withMobileApi(async () => {
    const states = await prisma.indianState.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    return jsonOk({ states });
  });
}
