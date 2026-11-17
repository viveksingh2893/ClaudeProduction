import { NextRequest } from "next/server";
import { prisma } from "@kisan4u/db";
import { getBaProfileForUser, isBaProgramEnabled } from "@kisan4u/orders";
import { searchCustomerCatalogueForPos } from "@kisan4u/catalog";
import { jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

/**
 * Product search for the mobile "Place an order for a customer" screen —
 * mirrors apps/web/src/app/account/ba/place/search-action.ts exactly. Only
 * an active BA can use it; a variant product surfaces each in-audience
 * variant as its own row (same customer catalogue a self-service shopper
 * sees).
 */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    if (!(await isBaProgramEnabled())) return jsonOk({ results: [] });

    const profile = await getBaProfileForUser(userId);
    if (!profile || (profile.frontendStatus !== "APPROVED" && profile.frontendStatus !== "APPROVED_NO_BANK")) {
      return jsonOk({ results: [] });
    }

    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return jsonOk({ results: [] });

    const { rows } = await searchCustomerCatalogueForPos({ search: q, page: 1, pageSize: 8 });
    const productIds = rows.map((r) => r.id);
    if (productIds.length === 0) return jsonOk({ results: [] });

    const variants = await prisma.productVariant.findMany({
      where: { productId: { in: productIds }, audience: "CUSTOMER" },
      select: {
        id: true,
        productId: true,
        sku: true,
        values: { select: { attributeValue: { select: { value: true } } } },
      },
    });
    const variantsByProduct = new Map<string, { id: string; label: string }[]>();
    for (const v of variants) {
      const list = variantsByProduct.get(v.productId) ?? [];
      const attrLabel = v.values.map((x) => x.attributeValue?.value).filter(Boolean).join(" / ");
      list.push({ id: v.id, label: attrLabel || v.sku });
      variantsByProduct.set(v.productId, list);
    }

    const results: { productId: string; variantId: string | null; label: string }[] = [];
    for (const p of rows) {
      const vs = variantsByProduct.get(p.id) ?? [];
      if (vs.length === 0) {
        results.push({ productId: p.id, variantId: null, label: p.name });
      } else {
        for (const v of vs) {
          results.push({ productId: p.id, variantId: v.id, label: `${p.name} — ${v.label}` });
        }
      }
    }
    return jsonOk({ results: results.slice(0, 12) });
  });
}
