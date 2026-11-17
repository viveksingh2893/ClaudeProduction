/**
 * Integration tests against the real dev Postgres — same throwaway-
 * fixture convention as packages/orders' test suite (unique RUN suffix,
 * before/after hooks, real Prisma). Covers the admin Customers page's
 * data layer: listCustomers only ever returns role=CUSTOMER accounts
 * (never a dealer/seller/admin fixture created alongside), its search/
 * filter/pagination behavior, and that sensitive User fields
 * (passwordHash, sessionVersion) are never present on a returned row —
 * a runtime regression guard on top of the TypeScript `select` clause
 * already being a strict allow-list.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { listCustomers } from "./access";

const RUN = Date.now();
const cleanupUserIds: string[] = [];

let customerAId: string;
let customerBId: string;
let inactiveCustomerId: string;
let dealerUserId: string;
let stateAId: string;
let stateAName: string;

before(async () => {
  const states = await prisma.indianState.findMany({ where: { isActive: true }, take: 2 });
  stateAId = states[0]!.id;
  stateAName = states[0]!.name;

  const customerA = await prisma.user.create({
    data: {
      firstName: `TEST FIXTURE Alpha Customer ${RUN}`,
      email: `test-access-alpha-${RUN}@example.com`,
      phone: `+91800${RUN.toString().slice(-7)}`,
      role: "CUSTOMER",
      referralCode: `TESTACA${RUN}`,
      isActive: true,
      stateId: stateAId,
    },
  });
  customerAId = customerA.id;
  cleanupUserIds.push(customerA.id);

  const customerB = await prisma.user.create({
    data: {
      firstName: `TEST FIXTURE Beta Customer ${RUN}`,
      email: `test-access-beta-${RUN}@example.com`,
      phone: `+91801${RUN.toString().slice(-7)}`,
      role: "CUSTOMER",
      referralCode: `TESTACB${RUN}`,
      isActive: true,
    },
  });
  customerBId = customerB.id;
  cleanupUserIds.push(customerB.id);

  const inactiveCustomer = await prisma.user.create({
    data: {
      firstName: `TEST FIXTURE Inactive Customer ${RUN}`,
      email: `test-access-inactive-${RUN}@example.com`,
      role: "CUSTOMER",
      referralCode: `TESTACI${RUN}`,
      isActive: false,
    },
  });
  inactiveCustomerId = inactiveCustomer.id;
  cleanupUserIds.push(inactiveCustomer.id);

  // Same RUN-tagged name prefix as the customer fixtures, on purpose — a
  // search for "TEST FIXTURE" + RUN must not pull this dealer in.
  const dealerUser = await prisma.user.create({
    data: {
      firstName: `TEST FIXTURE Dealer ${RUN}`,
      email: `test-access-dealer-${RUN}@example.com`,
      role: "DEALER",
      referralCode: `TESTACD${RUN}`,
      isActive: true,
    },
  });
  dealerUserId = dealerUser.id;
  cleanupUserIds.push(dealerUser.id);
});

after(async () => {
  for (const id of cleanupUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
});

test("listCustomers only ever returns role=CUSTOMER accounts, never a dealer with a similar name", async () => {
  const result = await listCustomers({ q: `TEST FIXTURE`, pageSize: 100 });
  const ids = result.rows.map((r) => r.id);
  assert.ok(ids.includes(customerAId));
  assert.ok(ids.includes(customerBId));
  assert.ok(
    !ids.includes(dealerUserId),
    "a DEALER-role user must never appear in the customers list",
  );
});

test("search matches by name, email, and phone", async () => {
  const byName = await listCustomers({ q: `Alpha Customer ${RUN}` });
  assert.ok(byName.rows.some((r) => r.id === customerAId));

  const byEmail = await listCustomers({ q: `test-access-beta-${RUN}@example.com` });
  assert.ok(byEmail.rows.some((r) => r.id === customerBId));

  const customerA = await prisma.user.findUniqueOrThrow({ where: { id: customerAId } });
  const byPhone = await listCustomers({ q: customerA.phone! });
  assert.ok(byPhone.rows.some((r) => r.id === customerAId));
});

test("isActive filter separates active and inactive customer accounts", async () => {
  const activeOnly = await listCustomers({ q: `TEST FIXTURE`, isActive: true, pageSize: 100 });
  assert.ok(activeOnly.rows.some((r) => r.id === customerAId));
  assert.ok(!activeOnly.rows.some((r) => r.id === inactiveCustomerId));

  const inactiveOnly = await listCustomers({ q: `TEST FIXTURE`, isActive: false, pageSize: 100 });
  assert.ok(inactiveOnly.rows.some((r) => r.id === inactiveCustomerId));
  assert.ok(!inactiveOnly.rows.some((r) => r.id === customerAId));
});

test("pagination: total reflects the full match count, and page/pageSize slice it correctly", async () => {
  const full = await listCustomers({
    q: `TEST FIXTURE Alpha Customer ${RUN}`,
    page: 1,
    pageSize: 20,
  });
  assert.equal(full.total, 1);
  assert.equal(full.rows.length, 1);

  const pageTooFar = await listCustomers({
    q: `TEST FIXTURE Alpha Customer ${RUN}`,
    page: 2,
    pageSize: 20,
  });
  assert.equal(pageTooFar.total, 1);
  assert.equal(pageTooFar.rows.length, 0);
});

test("a returned customer row never carries passwordHash or sessionVersion", async () => {
  const result = await listCustomers({ q: `Alpha Customer ${RUN}` });
  const row = result.rows.find((r) => r.id === customerAId);
  assert.ok(row);
  assert.equal("passwordHash" in row, false);
  assert.equal("sessionVersion" in row, false);
});

test("a returned row carries the resolved state name (or null when unset) for the admin table's 'Active • State' format", async () => {
  const result = await listCustomers({ q: `TEST FIXTURE`, pageSize: 100 });
  const rowA = result.rows.find((r) => r.id === customerAId);
  const rowB = result.rows.find((r) => r.id === customerBId);
  assert.ok(rowA);
  assert.ok(rowB);
  assert.equal(rowA!.indianState?.name, stateAName);
  assert.equal(rowA!.stateId, stateAId);
  assert.equal(rowB!.stateId, null, "a customer who never selected a state must resolve to null, not an invented value");
});

test("stateId filter scopes the list to exactly that state", async () => {
  const result = await listCustomers({ q: `TEST FIXTURE`, stateId: stateAId, pageSize: 100 });
  assert.ok(result.rows.some((r) => r.id === customerAId));
  assert.ok(!result.rows.some((r) => r.id === customerBId));
});

test('stateId filter "NONE" matches only customers with no state selected', async () => {
  const result = await listCustomers({ q: `TEST FIXTURE`, stateId: "NONE", pageSize: 100 });
  assert.ok(result.rows.some((r) => r.id === customerBId));
  assert.ok(!result.rows.some((r) => r.id === customerAId));
});

test("search matches by the customer's state name", async () => {
  const result = await listCustomers({ q: stateAName, pageSize: 200 });
  assert.ok(
    result.rows.some((r) => r.id === customerAId),
    "a customer whose selected state matches the search term must appear",
  );
});
