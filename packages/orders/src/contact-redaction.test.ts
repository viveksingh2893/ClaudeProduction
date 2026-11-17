import { test } from "node:test";
import assert from "node:assert/strict";
import { REDACTED_CONTACT, redactAddressContact, redactOrderContact } from "./contact-redaction";

const snapshot = {
  fullName: "Test Buyer",
  mobile: "9876543210",
  altMobile: "9123456780" as string | null,
  line1: "12 Farm Road",
  cityTown: "Indore",
  state: "Madhya Pradesh",
  pincode: "452001",
};

test("phone numbers are masked, everything the seller needs to ship stays", () => {
  const redacted = redactAddressContact(snapshot);
  assert.equal(redacted.mobile, REDACTED_CONTACT);
  assert.equal(redacted.altMobile, REDACTED_CONTACT);
  assert.equal(redacted.fullName, "Test Buyer");
  assert.equal(redacted.line1, "12 Farm Road");
  assert.equal(redacted.pincode, "452001");
  // The source row is never mutated.
  assert.equal(snapshot.mobile, "9876543210");
});

test("a missing alternate number stays null rather than becoming a mask", () => {
  assert.equal(redactAddressContact({ ...snapshot, altMobile: null }).altMobile, null);
});

test("an order's address snapshot is redacted; an order without one is returned as is", () => {
  const order = { id: "o1", checkoutGroup: { groupNumber: "G1", addressSnapshot: snapshot } };
  const redacted = redactOrderContact(order);
  assert.equal(redacted.checkoutGroup.addressSnapshot.mobile, REDACTED_CONTACT);
  assert.equal(redacted.checkoutGroup.groupNumber, "G1");
  assert.equal(order.checkoutGroup.addressSnapshot.mobile, "9876543210");

  const noAddress = { id: "o2", checkoutGroup: { addressSnapshot: null } };
  assert.equal(redactOrderContact(noAddress), noAddress);
});
