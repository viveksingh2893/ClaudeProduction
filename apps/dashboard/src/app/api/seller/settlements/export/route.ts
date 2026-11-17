import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { generateSettlementWorkbook } from "@kisan4u/orders";
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { parseSettlementFilters, searchParamsToRecord } from "@/lib/settlement-filters";

/**
 * Server-authorized seller export — sellerId comes exclusively from the
 * seller's own session (requireApprovedSeller), never from the query
 * string, so a seller can never export another seller's data by editing
 * the URL. Same generateSettlementWorkbook service the admin export route
 * calls, so both surfaces are guaranteed to produce identical output for
 * the same filters.
 */
export async function GET(request: NextRequest) {
  const { sellerProfileId } = await requireApprovedSeller();
  const filters = parseSettlementFilters(searchParamsToRecord(request.nextUrl.searchParams));
  const { stream, filename } = await generateSettlementWorkbook(sellerProfileId, filters);

  return new Response(Readable.toWeb(stream as Readable) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
