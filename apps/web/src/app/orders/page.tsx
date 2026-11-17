import Link from "next/link";
import { listCheckoutGroupsForCustomer, resolveOrderItemImageUrls } from "@kisan4u/orders";
import {
  Card,
  EmptyState,
  LinkButton,
  OrderItemSummary,
  PageContainer,
  PageHeader,
  StatusBadge,
} from "@kisan4u/ui";
import { requireBuyerContext } from "@/lib/buyer-context";
import { ORDER_STATUS_LABEL } from "@/lib/order-status-labels";

const MAX_ITEMS_SHOWN = 2;

export default async function OrdersPage() {
  const ctx = await requireBuyerContext();
  const groups = await listCheckoutGroupsForCustomer(ctx.userId);

  const allItems = groups.flatMap((g) =>
    g.sellerOrders.flatMap((so) => so.items.map((item) => ({ ...item, key: item.id }))),
  );
  const imageByItemId = await resolveOrderItemImageUrls(allItems);

  return (
    <PageContainer maxWidth="900px" className="py-8">
      <PageHeader title="Your Orders" />

      {groups.length === 0 ? (
        <EmptyState
          icon="📦"
          title="No orders yet"
          description="Once you place an order, it will show up here so you can track its progress."
          action={
            <LinkButton href="/products" variant="primary">
              Start Shopping
            </LinkButton>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <Link key={group.id} href={`/orders/${group.id}`}>
              <Card className="p-5 transition-shadow hover:shadow-card">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-ink">{group.groupNumber}</span>
                  <span className="text-xs text-gray-600">{new Date(group.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="mt-3 flex flex-col gap-3">
                  {group.sellerOrders.map((sellerOrder) => (
                    <div key={sellerOrder.id} className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-semibold text-ink">{sellerOrder.orderNumber}</span>
                        <span className="text-gray-600">· {sellerOrder.seller.shopName}</span>
                        <StatusBadge status={sellerOrder.status} label={ORDER_STATUS_LABEL[sellerOrder.status]} />
                        <span className="ml-auto font-bold text-ink">₹{sellerOrder.totalAmount.toString()}</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {sellerOrder.items.slice(0, MAX_ITEMS_SHOWN).map((item) => (
                          <OrderItemSummary
                            key={item.id}
                            size="sm"
                            imageUrl={imageByItemId.get(item.id)}
                            name={item.productName}
                            variantLabel={item.variantLabel}
                            quantity={item.quantity}
                          />
                        ))}
                        {sellerOrder.items.length > MAX_ITEMS_SHOWN && (
                          <span className="pl-[52px] text-xs text-gray-500">
                            +{sellerOrder.items.length - MAX_ITEMS_SHOWN} more item
                            {sellerOrder.items.length - MAX_ITEMS_SHOWN > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
