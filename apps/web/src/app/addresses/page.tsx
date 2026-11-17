import { prisma } from "@kisan4u/db";
import { listAddresses } from "@kisan4u/orders";
import { AlertBox, PageContainer, PageHeader } from "@kisan4u/ui";
import { requireBuyerContext } from "@/lib/buyer-context";
import { AddressManager } from "./address-manager";

export default async function AddressesPage() {
  const ctx = await requireBuyerContext();
  const [addresses, states] = await Promise.all([
    listAddresses(ctx.userId),
    prisma.indianState.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <PageContainer maxWidth="700px" className="py-8">
      <PageHeader title="Your Addresses" />

      {ctx.role === "DEALER" && (
        <div className="mb-5">
          <AlertBox tone="info">
            As a dealer, all your delivery addresses are locked to your verified state{ctx.dealerState ? ` (${ctx.dealerState.name})` : ""}.
          </AlertBox>
        </div>
      )}

      <AddressManager addresses={addresses} states={states} dealerLockedState={ctx.dealerState} />
    </PageContainer>
  );
}
