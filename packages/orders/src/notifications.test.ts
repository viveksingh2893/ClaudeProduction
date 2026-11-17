import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { notifyUser, deleteNotification, clearAllNotifications } from "./notifications";

let userAId: string;
let userBId: string;
const createdUserIds: string[] = [];

before(async () => {
  const stamp = Date.now();
  const a = await prisma.user.create({
    data: {
      email: `test-notif-a-${stamp}@example.com`,
      firstName: "TEST FIXTURE notif user A",
      role: "CUSTOMER",
      referralCode: `TEST-NOTIF-A-${stamp}`,
    },
  });
  const b = await prisma.user.create({
    data: {
      email: `test-notif-b-${stamp}@example.com`,
      firstName: "TEST FIXTURE notif user B",
      role: "CUSTOMER",
      referralCode: `TEST-NOTIF-B-${stamp}`,
    },
  });
  userAId = a.id;
  userBId = b.id;
  createdUserIds.push(userAId, userBId);
});

after(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

test("deleteNotification removes only the owner's own row", async () => {
  await notifyUser({ userId: userAId, title: "Test alert", body: "Body" });
  const row = await prisma.notification.findFirstOrThrow({ where: { userId: userAId } });

  const wrongOwner = await deleteNotification(userBId, row.id);
  assert.equal(wrongOwner.ok, false, "another user's id must not delete someone else's row");
  const stillThere = await prisma.notification.findUnique({ where: { id: row.id } });
  assert.ok(stillThere);

  const correctOwner = await deleteNotification(userAId, row.id);
  assert.equal(correctOwner.ok, true);
  const gone = await prisma.notification.findUnique({ where: { id: row.id } });
  assert.equal(gone, null);
});

test("deleteNotification on an already-gone id returns a not-found error", async () => {
  const result = await deleteNotification(userAId, "does-not-exist");
  assert.equal(result.ok, false);
});

test("clearAllNotifications removes every row for that user and no one else's", async () => {
  await notifyUser({ userId: userAId, title: "One", body: "Body" });
  await notifyUser({ userId: userAId, title: "Two", body: "Body" });
  await notifyUser({ userId: userBId, title: "Untouched", body: "Body" });

  await clearAllNotifications(userAId);

  const aCount = await prisma.notification.count({ where: { userId: userAId } });
  assert.equal(aCount, 0);
  const bCount = await prisma.notification.count({ where: { userId: userBId } });
  assert.equal(bCount, 1, "another user's notifications are untouched");
});
