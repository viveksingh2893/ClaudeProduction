import type { OrderStatusTimelineEntry } from "@kisan4u/ui";

type ShipmentHistoryRow = {
  id: string;
  status: string | null;
  courierStatusCode: string | null;
  courierStatusDesc: string | null;
  createdAt: Date;
};

/**
 * Courier tracking history (ShipmentStatusHistory, oldest first) as timeline
 * entries: every distinct code the provider reported — not just the ones that
 * also moved our own ShipmentStatus (that column is null for an
 * informational-only code) — falling back to the internal status for rows
 * that predate courierStatusCode/Desc and for manual-provider rows.
 *
 * Consecutive rows that say exactly the same thing are shown once, at the
 * time it was first reported. The courier poller used to append an identical
 * row on every poll while a shipment sat in an RTO state (158 copies of
 * "RETURN Accepted" on one order); the poller no longer does, but those rows
 * are still in the database.
 */
export function buildTrackingTimeline(history: ShipmentHistoryRow[]): OrderStatusTimelineEntry[] {
  const entries: OrderStatusTimelineEntry[] = [];
  let previousKey: string | null = null;
  for (const event of history) {
    const key = `${event.status ?? ""}|${event.courierStatusCode ?? ""}|${event.courierStatusDesc ?? ""}`;
    if (key === previousKey) continue;
    previousKey = key;
    entries.push({
      id: event.id,
      status: event.status ?? "UPDATE",
      label: event.courierStatusDesc ?? event.courierStatusCode ?? event.status ?? "Update",
      createdAt: event.createdAt,
      note: event.courierStatusDesc && event.courierStatusCode ? event.courierStatusCode : undefined,
    });
  }
  return entries;
}
