import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { generateSettlementWorkbook } from "@kisan4u/orders";
import { requireSettlementsView } from "@/lib/settlements-guard";
import { parseSettlementFilters, searchParamsToRecord } from "@/lib/settlement-filters";

/**
 * Server-authorized admin export, scoped to exactly one seller via the
 * route's [id] param — never a global "all sellers" export (matches the
 * task's "no new global settlement-management workflow" requirement). Same
 * generateSettlementWorkbook service the seller export route calls.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSettlementsView();
  const { id } = await params;
  const filters = parseSettlementFilters(searchParamsToRecord(request.nextUrl.searchParams));
  const { stream, filename } = await generateSettlementWorkbook(id, filters);

  return new Response(Readable.toWeb(stream as Readable) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
