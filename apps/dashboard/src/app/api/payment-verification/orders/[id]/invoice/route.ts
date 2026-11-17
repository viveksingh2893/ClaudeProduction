import { getInvoiceDataForAdmin } from "@kisan4u/orders";
import { invoiceResultToResponse } from "@kisan4u/invoice-pdf";
import { requirePaymentVerificationAccess } from "@/lib/payment-verification-guard";

/**
 * Invoice PDF for the "Payment Verifier" role. Same unscoped
 * getInvoiceDataForAdmin the full admin invoice route uses — the Payment
 * Verifier already sees every order in their table (listSellerOrdersForAdmin
 * is unscoped), so there's nothing extra exposed here; access is gated on
 * payment-verification:VIEW, not the ADMIN session the admin route requires.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePaymentVerificationAccess();
  const { id } = await params;
  return invoiceResultToResponse(await getInvoiceDataForAdmin(id));
}
