import { NextRequest } from "next/server";
import { getInvoiceDataForCustomer } from "@kisan4u/orders";
import { invoiceResultToResponse } from "@kisan4u/invoice-pdf";
import { jsonError, requireMobileAuth } from "@/lib/mobile-api";

/**
 * The customer/dealer invoice PDF for one seller order — bearer-auth
 * mirror of apps/web/src/app/api/orders/[sellerOrderId]/invoice, scoped
 * to the caller's own orders by getInvoiceDataForCustomer. The app
 * downloads this with the Authorization header and hands it to the OS
 * share sheet ("Save to Files" / print / etc.).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string; sellerOrderId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireMobileAuth(req, ["CUSTOMER", "DEALER"]));
  } catch {
    return jsonError(401, "UNAUTHENTICATED", "Log in to download this invoice.");
  }
  const { sellerOrderId } = await params;
  return invoiceResultToResponse(await getInvoiceDataForCustomer(userId, sellerOrderId));
}
