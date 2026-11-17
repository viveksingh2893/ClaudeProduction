/**
 * Integration tests against the real dev Postgres — same throwaway-
 * fixture convention as access.test.ts. Covers the new POS-specific
 * data-layer pieces added to this package: the module-permission gate
 * (hasModulePermission/setModulePermission), the customer/dealer async
 * search sources (searchCustomersForPos/searchApprovedDealersForPos),
 * and customer creation (createCustomerForPos).
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import {
  hasModulePermission,
  setModulePermission,
  searchCustomersForPos,
  searchApprovedDealersForPos,
} from "./access";
import { createCustomerForPos } from "./registration";

const RUN = Date.now();
const cleanupUserIds: string[] = [];

after(async () => {
  // AdminProfile/DealerProfile both hold a required FK to User with no
  // cascade delete — deleting the User first fails silently under the
  // .catch() below and leaves the fixture (and its profile row) behind
  // forever, so profile rows must go first every time.
  await prisma.adminProfile.deleteMany({ where: { userId: { in: cleanupUserIds } } });
  await prisma.dealerProfile.deleteMany({ where: { userId: { in: cleanupUserIds } } });
  for (const id of cleanupUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
});

test("hasModulePermission: an admin with no AdminProfile row at all defaults to allowed (never silently locks out a pre-existing admin)", async () => {
  const admin = await prisma.user.create({
    data: {
      firstName: `TEST FIXTURE Admin No Profile ${RUN}`,
      email: `test-pos-admin-noprofile-${RUN}@example.com`,
      role: "ADMIN",
      referralCode: `TESTPANP${RUN}`,
    },
  });
  cleanupUserIds.push(admin.id);
  const allowed = await hasModulePermission(admin.id, "pos");
  assert.equal(allowed, true);
});

test("hasModulePermission: a module key absent from modulePermissions defaults to allowed; explicit false denies", async () => {
  const admin = await prisma.user.create({
    data: {
      firstName: `TEST FIXTURE Admin Profile ${RUN}`,
      email: `test-pos-admin-profile-${RUN}@example.com`,
      role: "ADMIN",
      referralCode: `TESTPAP${RUN}`,
      adminProfile: { create: { roleName: "Support", modulePermissions: { orders: true } } },
    },
  });
  cleanupUserIds.push(admin.id);

  assert.equal(await hasModulePermission(admin.id, "pos"), true, "absent key defaults to allowed");

  await setModulePermission(admin.id, "pos", false);
  assert.equal(await hasModulePermission(admin.id, "pos"), false, "explicit false denies");

  await setModulePermission(admin.id, "pos", true);
  assert.equal(await hasModulePermission(admin.id, "pos"), true, "explicit true re-allows");

  // Setting one key must never clobber a sibling key already set.
  const profile = await prisma.adminProfile.findUnique({ where: { userId: admin.id } });
  assert.deepEqual(profile?.modulePermissions, { orders: true, pos: true });
});

test("searchApprovedDealersForPos: only an APPROVED dealer is returned, never PENDING/REJECTED/SUSPENDED", async () => {
  const state = await prisma.indianState.findFirstOrThrow({ where: { isActive: true } });
  const names = {
    approved: `TEST FIXTURE PosSearch Approved ${RUN}`,
    pending: `TEST FIXTURE PosSearch Pending ${RUN}`,
    suspended: `TEST FIXTURE PosSearch Suspended ${RUN}`,
  };

  async function makeDealer(
    name: string,
    status: "APPROVED" | "PENDING" | "SUSPENDED",
    idx: number,
  ) {
    const user = await prisma.user.create({
      data: {
        firstName: name,
        phone: `+9180${idx}${RUN.toString().slice(-6)}`,
        role: "DEALER",
        referralCode: `TESTPSD${idx}${RUN}`,
      },
    });
    cleanupUserIds.push(user.id);
    await prisma.dealerProfile.create({
      data: { userId: user.id, status, storeName: name, stateId: state.id },
    });
    return user.id;
  }

  const approvedUserId = await makeDealer(names.approved, "APPROVED", 1);
  await makeDealer(names.pending, "PENDING", 2);
  await makeDealer(names.suspended, "SUSPENDED", 3);

  const results = await searchApprovedDealersForPos(`TEST FIXTURE PosSearch`);
  const userIds = results.map((d) => d.userId);
  assert.ok(userIds.includes(approvedUserId), "the APPROVED dealer must be found");
  assert.equal(
    results.length,
    1,
    "PENDING/SUSPENDED dealers must never appear in POS dealer search results",
  );
});

test("searchCustomersForPos: masks the phone number and never returns a non-CUSTOMER account", async () => {
  const customer = await prisma.user.create({
    data: {
      firstName: `TEST FIXTURE PosSearch Customer ${RUN}`,
      phone: `+9198765${RUN.toString().slice(-5)}`,
      role: "CUSTOMER",
      referralCode: `TESTPSC${RUN}`,
    },
  });
  cleanupUserIds.push(customer.id);
  const dealer = await prisma.user.create({
    data: {
      firstName: `TEST FIXTURE PosSearch Customer ${RUN} Dealer`,
      role: "DEALER",
      referralCode: `TESTPSCD${RUN}`,
    },
  });
  cleanupUserIds.push(dealer.id);

  const results = await searchCustomersForPos(`TEST FIXTURE PosSearch Customer ${RUN}`);
  const ids = results.map((r) => r.id);
  assert.ok(ids.includes(customer.id));
  assert.ok(
    !ids.includes(dealer.id),
    "a DEALER account must never appear in customer search results",
  );

  const row = results.find((r) => r.id === customer.id)!;
  assert.notEqual(row.maskedPhone, customer.phone, "the phone must be masked, never returned raw");
  assert.match(row.maskedPhone!, /^\+91X{8}\d{2}$/);
});

test("createCustomerForPos: rejects a duplicate phone and surfaces the existing customer instead of creating a second account", async () => {
  const phone = `+91777${RUN.toString().slice(-7)}`;
  const first = await createCustomerForPos({ firstName: "Dup", lastName: "Test", phone });
  assert.equal(first.ok, true);
  if (first.ok) cleanupUserIds.push(first.userId);

  const second = await createCustomerForPos({ firstName: "Dup", lastName: "Again", phone });
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.ok(second.existingCustomer, "must surface the existing customer for select-instead");
    assert.equal(second.existingCustomer!.id, first.ok ? first.userId : undefined);
  }

  const count = await prisma.user.count({ where: { phone } });
  assert.equal(count, 1, "no duplicate account was created");
});

test("createCustomerForPos: a phone already registered to a DEALER is rejected with a role-specific error, not silently reused", async () => {
  const phone = `+91766${RUN.toString().slice(-7)}`;
  const dealerUser = await prisma.user.create({
    data: {
      firstName: `TEST FIXTURE CrossRole Dealer ${RUN}`,
      phone,
      role: "DEALER",
      referralCode: `TESTCRD${RUN}`,
    },
  });
  cleanupUserIds.push(dealerUser.id);

  const result = await createCustomerForPos({ firstName: "Cross", lastName: "Role", phone });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /dealer/i);
    assert.equal(
      result.existingCustomer,
      undefined,
      "a cross-role conflict is not offered as a select-instead candidate",
    );
  }
});
