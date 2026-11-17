import { notFound } from "next/navigation";
import { getProposedOrderForViewer } from "@kisan4u/orders";
import { Breadcrumbs, Card, PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { DecideClient } from "./decide-client";

export default async function ProposedOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession(["CUSTOMER", "DEALER"]);
  const { id } = await params;
  const po = await getProposedOrderForViewer(id, session.user.id);
  if (!po) notFound();

  const isReferee = po.refereeUserId === session.user.id;
  const addr = po.addressSnapshot as Record<string, string>;

  return (
    <PageContainer maxWidth="720px" className="py-8">
      <div className="mb-4">
        <Breadcrumbs
          items={[
            { label: "Account", href: "/account" },
            { label: "Business Associate", href: "/account/ba" },
            { label: "Order approval" },
          ]}
        />
      </div>
      <PageHeader
        title="Order prepared for you"
        description={
          isReferee
            ? "A Business Associate prepared this COD order for you. Review and choose what to do."
            : `Status: ${po.status.replace(/_/g, " ").toLowerCase()}`
        }
      />

      <Card className="p-5">
        <div className="mb-2 text-sm font-semibold text-ink">Items</div>
        <ul className="divide-y divide-gray-100 text-sm">
          {po.items.map((it) => (
            <li key={it.id} className="flex items-center justify-between py-2">
              <span>
                {it.productName}
                {it.variantLabel ? ` — ${it.variantLabel}` : ""} × {it.quantity}
              </span>
              <span>₹{Number(it.lineTotal).toFixed(2)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-3 text-base font-extrabold">
          <span>Total (COD)</span>
          <span>₹{Number(po.grandTotal).toFixed(2)}</span>
        </div>
      </Card>

      <Card className="mt-4 p-5 text-sm">
        <div className="mb-1 font-semibold text-ink">Delivery address</div>
        <div className="text-gray-600">
          {addr.fullName}, {addr.mobile}
          <br />
          {addr.line1}
          {addr.line2 ? `, ${addr.line2}` : ""}
          <br />
          {addr.cityTown}, {addr.state} {addr.pincode}
        </div>
      </Card>

      {isReferee && po.status === "AWAITING_REFEREE" && (
        <div className="mt-4">
          <DecideClient proposedOrderId={po.id} />
        </div>
      )}
      {po.status !== "AWAITING_REFEREE" && (
        <p className="mt-4 text-sm text-gray-500">
          This order is {po.status.replace(/_/g, " ").toLowerCase()}.
        </p>
      )}
    </PageContainer>
  );
}
