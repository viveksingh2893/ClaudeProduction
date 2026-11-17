"use client";

import { useEffect, useState } from "react";
import { PageContainer, SectionHeader, Badge } from "@kisan4u/ui";
import { MiniProductCard } from "./mini-product-card";
import { ProductGrid } from "@/components/product-grid";
// Type-only import — erased at compile time, so this client component
// never pulls in @kisan4u/catalog's runtime module graph (which reaches
// @kisan4u/db -> pg -> Node's `fs`, unusable in a browser bundle). Cards
// are pre-adapted server-side in app/page.tsx and passed down as plain
// ProductCardData — this component only renders them + runs the
// countdown timer, it never calls an adapter function itself.
import type { CardFeatureFlags, ProductCardData } from "@/lib/product-card-adapter";

// endAt is an ISO string, not a Date — Date instances don't reliably
// survive the Server->Client Component serialization boundary in this
// Next.js version (observed directly: a raw Date arrived client-side
// without a working .getTime()). Explicit string + `new Date(...)` on
// the client sidesteps that entirely.
export type DealCardView = { endAt: string; card: ProductCardData };

function formatRemaining(ms: number): string {
  if (ms <= 0) return "Ended";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}h ${m}m ${s}s`;
}

/**
 * Complete Design/Admin Spec §7.5: countdown is display-only — the timer
 * itself never reserves stock or grants the deal price; the atomic cutoff
 * is enforced server-side at packages/orders/src/pricing-resolution.ts's
 * getActiveDealSellingPrice, the same call site checkout uses. This
 * client countdown re-syncs from the server-provided `endAt` on mount and
 * every second, and never goes negative (clamped to "Ended").
 */
export function DealOfTheDaySection({
  deals,
  siteSettings,
}: {
  deals: DealCardView[];
  siteSettings: CardFeatureFlags;
}) {
  const soonestEndAt = deals.length > 0 ? deals.map((d) => new Date(d.endAt).getTime()).sort((a, b) => a - b)[0]! : null;
  const [remaining, setRemaining] = useState(() => (soonestEndAt ? soonestEndAt - Date.now() : 0));

  useEffect(() => {
    if (!soonestEndAt) return;
    const id = setInterval(() => setRemaining(Math.max(0, soonestEndAt - Date.now())), 1000);
    return () => clearInterval(id);
  }, [soonestEndAt]);

  if (deals.length === 0 || remaining <= 0) return null;

  // An expired/out-of-stock deal item simply drops out, never shown as purchasable.
  const cards: ProductCardData[] = deals.map((d) => d.card).filter((c) => c.purchase.kind !== "NONE");
  if (cards.length === 0) return null;

  return (
    <section className="bg-earth-100/40 py-10">
      <PageContainer maxWidth="1400px">
        <SectionHeader
          title="Deal of the Day"
          action={
            <Badge tone="warning" className="text-sm">
              Ends in {formatRemaining(remaining)}
            </Badge>
          }
        />
        <ProductGrid>
          {cards.map((card) => (
            <MiniProductCard key={card.id} product={card} wishlistEnabled={siteSettings.wishlistEnabled} />
          ))}
        </ProductGrid>
      </PageContainer>
    </section>
  );
}
