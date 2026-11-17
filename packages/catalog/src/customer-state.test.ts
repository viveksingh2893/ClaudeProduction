/**
 * Integration test against the real dev Postgres — spec §1's customer
 * account state feature: one-time self-service selection (server-enforced
 * regardless of what a manually-modified request claims), the repeatable
 * admin-only change (reason required, full before/after audit entry), and
 * the catalogue-gating state resolver.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import {
  setCustomerStateOnce,
  adminChangeCustomerState,
  resolveCustomerCatalogueStateId,
} from "./customer-state";

const RUN = Date.now();

let stateAId: string;
let stateBId: string;
let customerId: string;
let adminId: string;
const cleanupUserIds: string[] = [];

before(async () => {
  const states = await prisma.indianState.findMany({ where: { isActive: true }, take: 2 });
  stateAId = states[0]!.id;
  stateBId = states[1]!.id;

  const customer = await prisma.user.create({
    data: {
      phone: `+91908${RUN.toString().slice(-7)}`,
      firstName: "TEST FIXTURE Customer State",
      role: "CUSTOMER",
      referralCode: `TESTCUSTSTATE${RUN}`,
    },
  });
  customerId = customer.id;
  cleanupUserIds.push(customerId);

  const admin = await prisma.user.create({
    data: {
      email: `test-customer-state-admin-${RUN}@example.com`,
      firstName: "TEST FIXTURE Admin",
      role: "ADMIN",
      referralCode: `TESTCUSTSTATEADMIN${RUN}`,
    },
  });
  adminId = admin.id;
  cleanupUserIds.push(adminId);
});

after(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: customerId, entityType: "User" } });
  await prisma.notification.deleteMany({ where: { userId: { in: cleanupUserIds } } });
  for (const id of cleanupUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
});

test("resolveCustomerCatalogueStateId returns null before any state is selected", async () => {
  const stateId = await resolveCustomerCatalogueStateId(customerId);
  assert.equal(stateId, null);
});

test("a customer can select their state once", async () => {
  const result = await setCustomerStateOnce(customerId, stateAId);
  assert.equal(result.ok, true);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: customerId } });
  assert.equal(user.stateId, stateAId);
});

test("resolveCustomerCatalogueStateId now returns the selected state", async () => {
  const stateId = await resolveCustomerCatalogueStateId(customerId);
  assert.equal(stateId, stateAId);
});

test("the customer cannot change their state again — server-side lock, not just a disabled button", async () => {
  const result = await setCustomerStateOnce(customerId, stateBId);
  assert.equal(result.ok, false);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: customerId } });
  assert.equal(user.stateId, stateAId, "the original selection must be unchanged");
});

test("setCustomerStateOnce rejects an invalid/nonexistent stateId even for a customer with no state yet", async () => {
  const freshCustomer = await prisma.user.create({
    data: {
      phone: `+91909${RUN.toString().slice(-7)}`,
      firstName: "TEST FIXTURE Customer State Fresh",
      role: "CUSTOMER",
      referralCode: `TESTCUSTSTATEFRESH${RUN}`,
    },
  });
  cleanupUserIds.push(freshCustomer.id);
  const result = await setCustomerStateOnce(freshCustomer.id, "not-a-real-state-id");
  assert.equal(result.ok, false);
});

test("adminChangeCustomerState requires a reason", async () => {
  const result = await adminChangeCustomerState(customerId, stateBId, "", { id: adminId });
  assert.equal(result.ok, false);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: customerId } });
  assert.equal(user.stateId, stateAId, "state must be unchanged when the reason is missing");
});

test("an authorized admin can change an already-set customer state, and the audit log records old state, new state, admin, and reason", async () => {
  const result = await adminChangeCustomerState(customerId, stateBId, "Customer moved states", {
    id: adminId,
  });
  assert.equal(result.ok, true);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: customerId } });
  assert.equal(user.stateId, stateBId);

  const log = await prisma.auditLog.findFirst({
    where: { entityId: customerId, entityType: "User", action: "CUSTOMER_STATE_CHANGED" },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(log);
  assert.equal(log!.actorId, adminId);
  assert.equal(log!.reason, "Customer moved states");
  const metadata = log!.metadata as Record<string, unknown>;
  assert.equal(metadata.oldStateId, stateAId);
  assert.equal(metadata.newStateId, stateBId);
});

test("admin change is repeatable, unlike the customer's own one-time selection", async () => {
  const result = await adminChangeCustomerState(customerId, stateAId, "Changed back", { id: adminId });
  assert.equal(result.ok, true);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: customerId } });
  assert.equal(user.stateId, stateAId);
});
