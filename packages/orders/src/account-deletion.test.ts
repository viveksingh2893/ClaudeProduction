import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { finalizeAccountDeletion } from "./account-deletion/finalize";
import { getAccountDeletionEligibility } from "./account-deletion/eligibility";
import { requestAccountDeletion, restoreAccount } from "./account-deletion/request";

process.env.ACCOUNT_DELETION_PEPPER ??= "test-only-account-deletion-pepper";

const RUN = Date.now();
const userIds: string[] = [];

async function createCustomer(suffix: string) {
  const user = await prisma.user.create({
    data: {
      phone: `+9198${String(RUN).slice(-7)}${suffix}`.slice(0, 13),
      email: `account-deletion-${RUN}-${suffix}@example.com`,
      firstName: "Deletion",
      lastName: "Fixture",
      role: "CUSTOMER",
      isPhoneVerified: true,
      referralCode: `DEL${RUN}${suffix}`,
    },
  });
  userIds.push(user.id);
  return user;
}

after(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.accountDeletionRequest.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.walletTransaction.deleteMany({ where: { wallet: { ownerId: { in: userIds } } } });
  await prisma.wallet.deleteMany({ where: { ownerId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

test("a customer can schedule and restore account deletion", async () => {
  const user = await createCustomer("1");
  const requested = await requestAccountDeletion({ userId: user.id });
  assert.equal(requested.ok, true);
  const pending = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.ok(pending.deletionRequestedAt);
  assert.ok(pending.deletionScheduledFor);

  const restored = await restoreAccount(user.id);
  assert.deepEqual(restored, { ok: true });
  const active = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(active.deletionRequestedAt, null);
  assert.equal(active.deletionScheduledFor, null);
});

test("a positive wallet balance requires consent and is forfeited with a ledger entry", async () => {
  const user = await createCustomer("2");
  await prisma.wallet.create({ data: { ownerId: user.id, ownerType: "CUSTOMER", balance: 25 } });
  const eligibility = await getAccountDeletionEligibility(user.id);
  assert.equal(eligibility?.eligible, true);
  assert.equal(eligibility?.walletBalance, 25);

  const withoutConsent = await requestAccountDeletion({ userId: user.id, immediate: true });
  assert.equal(withoutConsent.ok, false);

  const requested = await requestAccountDeletion({
    userId: user.id,
    immediate: true,
    forfeitWalletBalance: true,
  });
  assert.equal(requested.ok, true);
  const finalized = await finalizeAccountDeletion(user.id);
  assert.equal(finalized.ok, true);

  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { ownerId: user.id },
    include: { transactions: true },
  });
  assert.equal(Number(wallet.balance), 0);
  assert.ok(
    wallet.transactions.some(
      (transaction) =>
        transaction.reason === "ACCOUNT_DELETION_FORFEITURE" && Number(transaction.amount) === 25,
    ),
  );
});

test("a deletion request immediately forfeits the wallet and restore does not refund it", async () => {
  const user = await createCustomer("4");
  await prisma.wallet.create({ data: { ownerId: user.id, ownerType: "CUSTOMER", balance: 40 } });
  const requested = await requestAccountDeletion({
    userId: user.id,
    forfeitWalletBalance: true,
  });
  assert.equal(requested.ok, true);

  const forfeited = await prisma.wallet.findUniqueOrThrow({
    where: { ownerId: user.id },
    include: { transactions: true },
  });
  assert.equal(Number(forfeited.balance), 0);
  assert.ok(
    forfeited.transactions.some(
      (transaction) =>
        transaction.reason === "ACCOUNT_DELETION_FORFEITURE" &&
        transaction.referenceType === "account_deletion_request" &&
        Number(transaction.amount) === 40,
    ),
  );

  const restored = await restoreAccount(user.id);
  assert.deepEqual(restored, { ok: true });

  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { ownerId: user.id },
    include: { transactions: true },
  });
  assert.equal(Number(wallet.balance), 0);
  assert.equal(wallet.transactions.length, forfeited.transactions.length);
});

test("immediate finalization anonymizes the User row but keeps it", async () => {
  const user = await createCustomer("3");
  const requested = await requestAccountDeletion({ userId: user.id, immediate: true });
  assert.equal(requested.ok, true);
  const finalized = await finalizeAccountDeletion(user.id);
  assert.equal(finalized.ok, true);

  const deleted = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(deleted.phone, null);
  assert.equal(deleted.email, null);
  assert.equal(deleted.firstName, "Deleted");
  assert.equal(deleted.lastName, "User");
  assert.equal(deleted.isActive, false);
  assert.ok(deleted.deletedAt);
});
