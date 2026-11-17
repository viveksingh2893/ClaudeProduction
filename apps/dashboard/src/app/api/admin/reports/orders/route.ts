import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { generateOrderReportWorkbook, REPORT_DATE_RE } from "@kisan4u/orders";
import { requireOrdersSectionView } from "@/lib/order-scheduling-guard";

/**
 * Order Report export — one row per SellerOrder, legacy KisanBazar column
 * layout. ADMIN or the order-scheduling ("Scheduling Team") role, exactly
 * like the rest of the orders section (requireOrdersSectionView). `from` /
 * `to` are inclusive `YYYY-MM-DD` bounds interpreted at IST day
 * boundaries; both optional (omitting both = all time).
 */
export async function GET(request: NextRequest) {
  await requireOrdersSectionView();

  const from = request.nextUrl.searchParams.get("from") ?? undefined;
  const to = request.nextUrl.searchParams.get("to") ?? undefined;
  if ((from && !REPORT_DATE_RE.test(from)) || (to && !REPORT_DATE_RE.test(to))) {
    return new Response("Invalid date — expected YYYY-MM-DD.", { status: 400 });
  }
  if (from && to && from > to) {
    return new Response("`from` must not be after `to`.", { status: 400 });
  }

  const { stream, filename } = await generateOrderReportWorkbook({ dateFrom: from, dateTo: to });

  return new Response(Readable.toWeb(stream as Readable) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
