import { prisma } from "@kisan4u/db";
import type { CustomerAddressInput } from "@kisan4u/validators";

export type AddressResult = { ok: true; addressId: string } | { ok: false; error: string };
export type DealerStateLock = { id: string; name: string } | null;

export async function listAddresses(userId: string) {
  return prisma.customerAddress.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
}

/** `dealerLock` is non-null only for a dealer — their state is always forced to their own verified DealerProfile state, never the client-submitted value (Phase 4 spec §C2). */
export async function createAddress(
  userId: string,
  dealerLock: DealerStateLock,
  input: CustomerAddressInput,
): Promise<AddressResult> {
  const state = dealerLock ? dealerLock.name : input.state;
  const stateId = dealerLock ? dealerLock.id : (input.stateId ?? null);

  const created = await prisma.$transaction(async (tx) => {
    if (input.isDefault)
      await tx.customerAddress.updateMany({ where: { userId }, data: { isDefault: false } });
    return tx.customerAddress.create({
      data: {
        userId,
        fullName: input.fullName,
        mobile: input.mobile,
        altMobile: input.altMobile ?? null,
        line1: input.line1,
        line2: input.line2 ?? null,
        landmark: input.landmark ?? null,
        cityTown: input.cityTown,
        district: input.district,
        state,
        stateId,
        pincode: input.pincode,
        addressType: input.addressType,
        isDefault: input.isDefault,
      },
    });
  });
  return { ok: true, addressId: created.id };
}

export async function updateAddress(
  userId: string,
  dealerLock: DealerStateLock,
  input: CustomerAddressInput,
): Promise<AddressResult> {
  if (!input.id) return { ok: false, error: "Missing address id." };
  const existing = await prisma.customerAddress.findFirst({ where: { id: input.id, userId } });
  if (!existing) return { ok: false, error: "Address not found." };

  const state = dealerLock ? dealerLock.name : input.state;
  const stateId = dealerLock ? dealerLock.id : (input.stateId ?? null);

  await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.customerAddress.updateMany({
        where: { userId, id: { not: existing.id } },
        data: { isDefault: false },
      });
    }
    await tx.customerAddress.update({
      where: { id: existing.id },
      data: {
        fullName: input.fullName,
        mobile: input.mobile,
        altMobile: input.altMobile ?? null,
        line1: input.line1,
        line2: input.line2 ?? null,
        landmark: input.landmark ?? null,
        cityTown: input.cityTown,
        district: input.district,
        state,
        stateId,
        pincode: input.pincode,
        addressType: input.addressType,
        isDefault: input.isDefault,
      },
    });
  });
  return { ok: true, addressId: existing.id };
}

export async function deleteAddress(userId: string, addressId: string): Promise<AddressResult> {
  const existing = await prisma.customerAddress.findFirst({ where: { id: addressId, userId } });
  if (!existing) return { ok: false, error: "Address not found." };
  await prisma.customerAddress.delete({ where: { id: existing.id } });
  return { ok: true, addressId: existing.id };
}

export async function setDefaultAddress(userId: string, addressId: string): Promise<AddressResult> {
  const existing = await prisma.customerAddress.findFirst({ where: { id: addressId, userId } });
  if (!existing) return { ok: false, error: "Address not found." };
  await prisma.$transaction([
    prisma.customerAddress.updateMany({ where: { userId }, data: { isDefault: false } }),
    prisma.customerAddress.update({ where: { id: existing.id }, data: { isDefault: true } }),
  ]);
  return { ok: true, addressId: existing.id };
}
