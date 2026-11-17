import { getInvoiceDataForSeller } from "@kisan4u/orders";
import { invoiceResultToResponse } from "@kisan4u/invoice-pdf";
import { requireApprovedSeller } from "@/lib/require-approved-seller";

/** Server-authorized: sellerProfileId comes exclusively from the seller's own session, never the URL — a seller can never fetch another seller's invoice by editing the id. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sellerProfileId } = await requireApprovedSeller();
  const { id } = await params;
  return invoiceResultToResponse(await getInvoiceDataForSeller(sellerProfileId, id));
}
