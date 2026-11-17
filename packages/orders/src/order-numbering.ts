import { prisma } from "@kisan4u/db";

/** The subset of the Prisma client this module needs — matches both the full client and a `$transaction` callback's `tx` client (same convention as packages/catalog/src/variant-generation.ts's CatalogTxClient). */
type NumberingTxClient = Pick<typeof prisma, "checkoutGroup" | "sellerOrder">;

function datePart(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/** Never sequential/record-count-based (Phase 4 spec §E) — a random 4-digit suffix, re-drawn on the rare collision. */
function randomSuffix(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * `K4U-YYYYMMDD-XXXX`. Uniqueness is guaranteed by the database's unique
 * constraint on CheckoutGroup.groupNumber — this just avoids the obvious
 * collision case by checking first, and retries a handful of times rather
 * than looping forever.
 */
export async function generateCheckoutGroupNumber(tx: NumberingTxClient): Promise<string> {
  const date = datePart();
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = `K4U-${date}-${randomSuffix()}`;
    const existing = await tx.checkoutGroup.findUnique({
      where: { groupNumber: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  throw new Error("Could not generate a unique checkout group number — please try again.");
}

/** `K4U-YYYYMMDD-XXXX-S1`, `-S2`, ... — one per seller within a checkout, in stable insertion order. */
export function generateSellerOrderNumber(groupNumber: string, sellerIndex: number): string {
  return `${groupNumber}-S${sellerIndex + 1}`;
}

/** The invoice number is deliberately the same string as the seller order number — no separate invoice-numbering sequence (kept this way per explicit product decision: "just keep it order number for simplicity"). Kept as its own function/column rather than dropped outright so every reader of `SellerOrder.invoiceNumber` still has one obvious place to look. */
export function generateInvoiceNumber(sellerOrderNumber: string): string {
  return sellerOrderNumber;
}
