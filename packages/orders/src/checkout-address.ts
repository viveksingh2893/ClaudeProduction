import { prisma } from "@kisan4u/db";
import type { CheckoutInput } from "@kisan4u/validators";

export type DealerVerifiedState = { id: string; name: string } | null;

export type AddressSnapshotData = {
  sourceAddressId: string | null;
  fullName: string;
  mobile: string;
  altMobile: string | null;
  line1: string;
  line2: string | null;
  landmark: string | null;
  cityTown: string;
  district: string;
  state: string;
  stateId: string | null;
  pincode: string;
  addressType: "HOME" | "FARM" | "SHOP" | "OFFICE" | "OTHER";
};

export type AddressResolutionResult =
  { ok: true; snapshot: AddressSnapshotData } | { ok: false; error: string };

function toSnapshot(address: {
  id: string;
  fullName: string;
  mobile: string;
  altMobile: string | null;
  line1: string;
  line2: string | null;
  landmark: string | null;
  cityTown: string;
  district: string;
  state: string;
  stateId: string | null;
  pincode: string;
  addressType: "HOME" | "FARM" | "SHOP" | "OFFICE" | "OTHER";
}): AddressSnapshotData {
  return {
    sourceAddressId: address.id,
    fullName: address.fullName,
    mobile: address.mobile,
    altMobile: address.altMobile,
    line1: address.line1,
    line2: address.line2,
    landmark: address.landmark,
    cityTown: address.cityTown,
    district: address.district,
    state: address.state,
    stateId: address.stateId,
    pincode: address.pincode,
    addressType: address.addressType,
  };
}

/** True only if the address's state can be confirmed to match the dealer's own verified state — anything ambiguous fails closed (§C2/§H3: a dealer must never bypass state restrictions). Exported for POS's address list (spec §9), which flags/filters an existing dealer address outside their approved state as not selectable — actual checkout enforcement (this same check) already happens unconditionally inside resolveCheckoutAddress below regardless of what POS's UI does. */
export function addressMatchesDealerState(
  address: { stateId: string | null; state: string },
  dealerState: DealerVerifiedState,
): boolean {
  if (!dealerState) return false;
  if (address.stateId) return address.stateId === dealerState.id;
  return address.state.trim().toLowerCase() === dealerState.name.trim().toLowerCase();
}

/**
 * Resolves the delivery address for checkout — either an existing
 * CustomerAddress (ownership-checked) or a newly-created one. For a
 * dealer, the state is never taken from client input at all: it is always
 * forced to the dealer's own verified state (Phase 4 spec §C2 — "dealer
 * state cannot be changed through address management," "a dealer must not
 * bypass state restrictions by entering an address in another state").
 */
export async function resolveCheckoutAddress(
  userId: string,
  ctx: { role: "CUSTOMER" | "DEALER"; dealerState: DealerVerifiedState },
  input: Pick<CheckoutInput, "addressId" | "newAddress">,
): Promise<AddressResolutionResult> {
  if (ctx.role === "DEALER" && !ctx.dealerState) {
    return {
      ok: false,
      error:
        "Your dealer account has no verified state on file. Please contact support before checking out.",
    };
  }

  if (input.addressId) {
    const address = await prisma.customerAddress.findFirst({
      where: { id: input.addressId, userId },
    });
    if (!address) return { ok: false, error: "Selected address not found." };
    // A legacy-migrated address (see migrate-legacy-customers.ts) can have
    // a null district — the old site's free-text `address` blob was never
    // parsed into a district, and it's left for the customer to fill in
    // via the address-edit form. An order snapshot always needs a real
    // district value, so an incomplete address can't be used at checkout
    // until the customer completes it.
    if (!address.district) {
      return {
        ok: false,
        error: "This address is missing a district. Please edit it before checking out.",
      };
    }
    // Captured into its own const so the non-null narrowing above survives
    // being spread back into `address` below (a narrowed property access
    // like `address.district` doesn't stay narrowed once `address` itself
    // is passed around as a whole object).
    const district = address.district;
    if (ctx.role === "DEALER" && !addressMatchesDealerState(address, ctx.dealerState)) {
      return {
        ok: false,
        error: "This address's state does not match your verified dealer state.",
      };
    }
    return { ok: true, snapshot: toSnapshot({ ...address, district }) };
  }

  if (input.newAddress) {
    const created = await prisma.customerAddress.create({
      data: {
        userId,
        fullName: input.newAddress.fullName,
        mobile: input.newAddress.mobile,
        altMobile: input.newAddress.altMobile ?? null,
        line1: input.newAddress.line1,
        line2: input.newAddress.line2 ?? null,
        landmark: input.newAddress.landmark ?? null,
        cityTown: input.newAddress.cityTown,
        district: input.newAddress.district,
        // Dealer: state is always forced to their own verified state,
        // never the client-submitted value — see function doc comment.
        state: ctx.role === "DEALER" ? ctx.dealerState!.name : input.newAddress.state,
        stateId: ctx.role === "DEALER" ? ctx.dealerState!.id : (input.newAddress.stateId ?? null),
        pincode: input.newAddress.pincode,
        addressType: input.newAddress.addressType,
        isDefault: input.newAddress.isDefault,
      },
    });
    // `created.district` is typed `string | null` because the column
    // itself is nullable (to accommodate legacy-migrated addresses with
    // no parsed district), but this row was just written from
    // `input.newAddress`, whose `district` is a required, validated
    // string — so it's always the freshly-written non-null value here.
    return { ok: true, snapshot: toSnapshot({ ...created, district: input.newAddress.district }) };
  }

  return { ok: false, error: "Select an address or add a new one." };
}
