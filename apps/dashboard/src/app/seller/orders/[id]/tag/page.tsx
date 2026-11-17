import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOrderTagData } from "@kisan4u/orders";
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { DELIVERY_METHOD_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/order-status-labels";

export const metadata: Metadata = { title: "Kisan4U order tag" };

/**
 * Print-friendly Kisan4U order tag (Phase 4 spec §P). No sensitive
 * internal data appears here — the "QR code" is rendered as a plain
 * safe-reference text block (the order number only), not an actual
 * rendered QR/barcode image; no QR-generation library was added for this
 * phase, see the final report. Print CSS hides this app's shared nav
 * drawer chrome so only the tag itself prints.
 */
export default async function OrderTagPage({ params }: { params: Promise<{ id: string }> }) {
  const { sellerProfileId } = await requireApprovedSeller();
  const { id } = await params;
  const result = await getOrderTagData(sellerProfileId, id);
  if (!result.ok) notFound();
  const tag = result.tag;

  return (
    <div style={{ padding: "1.5rem" }}>
      <style>{`
        @media print {
          #nav-drawer-panel, button[aria-label$="navigation menu"] { display: none !important; }
          body { padding: 0 !important; }
        }
        .k4u-tag { max-width: 420px; margin: 0 auto; border: 2px solid #111; border-radius: 8px; padding: 1.25rem; font-family: sans-serif; color: #111; }
        .k4u-tag h1 { font-size: 1.1rem; margin: 0 0 0.75rem; text-align: center; }
        .k4u-tag .ref { text-align: center; font-family: monospace; font-size: 1.1rem; letter-spacing: 0.15em; border: 1px dashed #333; padding: 0.5rem; margin: 0.75rem 0; }
        .k4u-tag dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem; font-size: 0.9rem; margin: 0.75rem 0; }
        .k4u-tag dt { color: #555; }
        .k4u-tag dd { margin: 0; }
        .k4u-tag .footer { text-align: center; font-size: 0.85rem; margin-top: 1rem; font-weight: 600; }
      `}</style>

      <p className="no-print" style={{ textAlign: "center", marginBottom: "1rem", fontSize: "0.85rem", color: "#666" }}>
        Use your browser&apos;s Print (Ctrl/Cmd+P) to print this tag.
      </p>

      <div className="k4u-tag">
        <h1>KISAN4U</h1>
        <div className="ref">{tag.qrPayload}</div>
        <dl>
          <dt>Seller order</dt>
          <dd>{tag.sellerOrderNumber}</dd>
          <dt>Checkout group</dt>
          <dd>{tag.checkoutGroupNumber}</dd>
          <dt>Seller</dt>
          <dd>{tag.sellerName}</dd>
          {tag.pickupPointName && (
            <>
              <dt>Pickup point</dt>
              <dd>{tag.pickupPointName}</dd>
            </>
          )}
          <dt>Deliver to</dt>
          <dd>{tag.customerName}</dd>
          <dt>Address</dt>
          <dd>{tag.deliveryAddressLines.join(", ")}</dd>
          <dt>Mobile</dt>
          <dd>{tag.customerMobile}</dd>
          <dt>Delivery method</dt>
          <dd>{DELIVERY_METHOD_LABEL[tag.deliveryMethod] ?? tag.deliveryMethod}</dd>
          <dt>Payment mode</dt>
          <dd>{PAYMENT_METHOD_LABEL[tag.paymentMethod] ?? tag.paymentMethod}</dd>
          {tag.codAmount != null && (
            <>
              <dt>COD amount</dt>
              <dd>₹{tag.codAmount.toFixed(2)}</dd>
            </>
          )}
          {tag.packageCount != null && (
            <>
              <dt>Packages</dt>
              <dd>{tag.packageCount}</dd>
            </>
          )}
          <dt>Contents</dt>
          <dd>{tag.productSummary}</dd>
          <dt>Total weight</dt>
          <dd>{tag.totalWeightGrams} g</dd>
        </dl>
        <div className="footer">Attach this tag securely to the package.</div>
      </div>
    </div>
  );
}
