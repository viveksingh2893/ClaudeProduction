/**
 * Regression coverage for requirement 5/7: dealer registration requires a
 * real, server-validated state; only an admin can change it afterward.
 * Creates and tears down its own throwaway dealer fixture so it doesn't
 * depend on or pollute seed data.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { registerDealer, setDealerState } from "@kisan4u/auth";
import { dealerRegistrationSchema } from "@kisan4u/validators";

let validStateId: string;
let createdUserId: string | null = null;
let createdDealerProfileId: string | null = null;

before(async () => {
  const state = await prisma.indianState.findFirstOrThrow({ where: { isActive: true } });
  validStateId = state.id;
});

after(async () => {
  if (createdDealerProfileId)
    await prisma.dealerProfile.deleteMany({ where: { id: createdDealerProfileId } });
  if (createdUserId) await prisma.user.deleteMany({ where: { id: createdUserId } });
});

test("dealer registration requires a state", () => {
  const result = dealerRegistrationSchema.safeParse({
    name: "Test Dealer",
    storeName: "Test Store",
    storeAddress: "1 Test Street",
    city: "Test City",
    stateId: "",
    pincode: "123456",
  });
  assert.equal(result.success, false);
});

test("registration rejects an invalid/nonexistent stateId", async () => {
  const phone = `+9190000${Date.now().toString().slice(-5)}`;
  const result = await registerDealer(phone, {
    name: "Test Dealer",
    storeName: "Test Store",
    storeAddress: "1 Test Street",
    city: "Test City",
    stateId: "not-a-real-state-id",
    pincode: "123456",
  });
  assert.equal(result.ok, false);
});

test("registration succeeds with a valid, active stateId and stores it", async () => {
  const phone = `+9190001${Date.now().toString().slice(-5)}`;
  const result = await registerDealer(phone, {
    name: "Test Dealer",
    storeName: "Test Store",
    storeAddress: "1 Test Street",
    city: "Test City",
    stateId: validStateId,
    pincode: "123456",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  createdDealerProfileId = result.dealerProfileId;
  const profile = await prisma.dealerProfile.findUniqueOrThrow({
    where: { id: result.dealerProfileId },
  });
  createdUserId = profile.userId;
  assert.equal(profile.stateId, validStateId);
});

test("admin can change a dealer's state to another valid, active state", async () => {
  const otherState = await prisma.indianState.findFirstOrThrow({
    where: { isActive: true, NOT: { id: validStateId } },
  });
  const result = await setDealerState(createdDealerProfileId!, otherState.id);
  assert.equal(result.ok, true);
  const profile = await prisma.dealerProfile.findUniqueOrThrow({
    where: { id: createdDealerProfileId! },
  });
  assert.equal(profile.stateId, otherState.id);
});

test("admin state-change rejects an invalid stateId", async () => {
  const result = await setDealerState(createdDealerProfileId!, "not-a-real-state-id");
  assert.equal(result.ok, false);
});
