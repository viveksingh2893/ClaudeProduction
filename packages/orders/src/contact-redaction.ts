/**
 * What a seller sees in place of a buyer's phone number / email. Sellers
 * fulfil an order without ever needing to contact the customer or dealer
 * directly — Kisan4U (and the courier) own that relationship — so every
 * seller-scoped read redacts contact details at the query layer, not just in
 * the page markup: the seller mobile app's JSON endpoints return these rows
 * as-is, so hiding the number only in the dashboard would still leak it.
 */
export const REDACTED_CONTACT = "xxxx";

type SnapshotWithContact = { mobile: string; altMobile: string | null };

/** Redacts the phone numbers on an OrderAddressSnapshot row (or anything shaped like one); everything else (name, address lines, pincode) is untouched — the seller still needs those to pack and ship. */
export function redactAddressContact<T extends SnapshotWithContact>(snapshot: T): T {
  return {
    ...snapshot,
    mobile: REDACTED_CONTACT,
    altMobile: snapshot.altMobile ? REDACTED_CONTACT : null,
  };
}

/** Same, applied to a seller order that includes `checkoutGroup.addressSnapshot`. */
export function redactOrderContact<
  O extends { checkoutGroup: { addressSnapshot: SnapshotWithContact | null } },
>(order: O): O {
  const snapshot = order.checkoutGroup.addressSnapshot;
  if (!snapshot) return order;
  return {
    ...order,
    checkoutGroup: { ...order.checkoutGroup, addressSnapshot: redactAddressContact(snapshot) },
  };
}
