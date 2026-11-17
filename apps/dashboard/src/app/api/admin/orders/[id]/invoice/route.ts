import { getInvoiceDataForAdmin } from "@kisan4u/orders";
import { invoiceResultToResponse } from "@kisan4u/invoice-pdf";
import { requireOrdersSectionView } from "@/lib/order-scheduling-guard";

/**
 * ADMIN or the Scheduling Team (order-scheduling:VIEW) — same gate as the
 * /admin/orders table, the order detail page, and the sibling shipping-
 * label route. No ownership restriction; the caller already has full
 * working access to every order in that section.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireOrdersSectionView();
  const { id } = await params;
  return invoiceResultToResponse(await getInvoiceDataForAdmin(id));
}
