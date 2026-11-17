import { getInvoiceDataForPlacedBy } from "@kisan4u/orders";
import { invoiceResultToResponse } from "@kisan4u/invoice-pdf";
import { requirePosAccess } from "@/lib/pos-guard";

/** "My POS Orders" — scoped to only orders this exact staff member placed, same discipline as the POS order list/detail pages. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePosAccess();
  const { id } = await params;
  return invoiceResultToResponse(await getInvoiceDataForPlacedBy(session.user.id, id));
}
