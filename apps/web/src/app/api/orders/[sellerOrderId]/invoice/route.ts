import { getInvoiceDataForCustomer } from "@kisan4u/orders";
import { invoiceResultToResponse } from "@kisan4u/invoice-pdf";
import { requireBuyerContext } from "@/lib/buyer-context";

/** Customer/dealer — scoped to their own orders only, same as the orders/[groupId]/[sellerOrderId] page. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sellerOrderId: string }> },
) {
  const ctx = await requireBuyerContext();
  const { sellerOrderId } = await params;
  return invoiceResultToResponse(await getInvoiceDataForCustomer(ctx.userId, sellerOrderId));
}
