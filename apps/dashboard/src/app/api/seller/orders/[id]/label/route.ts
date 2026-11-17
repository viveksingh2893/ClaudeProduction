import { getSellerLabelData } from "@kisan4u/orders";
import { sellerLabelResultToResponse } from "@kisan4u/invoice-pdf";
import { requireApprovedSeller } from "@/lib/require-approved-seller";

/**
 * Server-authorized: sellerProfileId comes exclusively from the seller's own
 * session, never the URL — a seller can never fetch another seller's label by
 * editing the id.
 *
 * Sellers get a Kisan4U-generated label (courier AWB barcode, no buyer phone
 * number) rather than the courier's own PDF, which always prints the
 * consignee's number and can't be redacted. Admin still downloads the
 * courier's original from /api/admin/orders/[id]/label.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sellerProfileId } = await requireApprovedSeller();
  const { id } = await params;
  return sellerLabelResultToResponse(await getSellerLabelData(sellerProfileId, id));
}
