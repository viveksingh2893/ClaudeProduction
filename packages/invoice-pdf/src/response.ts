import type { InvoiceResult, SellerLabelResult } from "@kisan4u/orders";
import { renderInvoicePdf, renderSellerLabelPdf } from "./render";

/**
 * Shared by every invoice route handler (admin/seller/POS/customer) —
 * renders fresh from whatever InvoiceResult its caller's own
 * ownership-scoped query returned, and turns the { ok: false } case into
 * a plain 404 rather than each route re-implementing the same branch.
 * Never caches: a new PDF is built on every request so Paid/Balance
 * always reflect the current payment state.
 */
export async function invoiceResultToResponse(result: InvoiceResult): Promise<Response> {
  if (!result.ok) {
    return new Response(result.error, { status: 404 });
  }
  const buffer = await renderInvoicePdf(result.invoice);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="invoice-${result.invoice.invoiceNumber}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

/** The seller shipping-label counterpart of invoiceResultToResponse — { ok: false } becomes a plain 404. */
export async function sellerLabelResultToResponse(result: SellerLabelResult): Promise<Response> {
  if (!result.ok) {
    return new Response(result.error, { status: 404 });
  }
  const buffer = await renderSellerLabelPdf(result.label);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="shipping-label-${result.label.orderNumber}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
