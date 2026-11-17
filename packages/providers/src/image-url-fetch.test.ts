/** Pure function tests, no network — SSRF address-blocking logic (bulk-product image URL ingestion). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedAddress } from "./image-url-fetch";

test("blocks loopback addresses", () => {
  assert.equal(isBlockedAddress("127.0.0.1"), true);
  assert.equal(isBlockedAddress("127.0.0.55"), true);
  assert.equal(isBlockedAddress("::1"), true);
});

test("blocks private IPv4 ranges (10/8, 172.16/12, 192.168/16)", () => {
  assert.equal(isBlockedAddress("10.0.0.5"), true);
  assert.equal(isBlockedAddress("172.16.0.1"), true);
  assert.equal(isBlockedAddress("172.31.255.255"), true);
  assert.equal(isBlockedAddress("192.168.1.1"), true);
  // 172.32.x is OUTSIDE the 172.16-172.31 private range — must not be blocked.
  assert.equal(isBlockedAddress("172.32.0.1"), false);
});

test("blocks link-local (169.254/16) and CGNAT (100.64/10)", () => {
  assert.equal(isBlockedAddress("169.254.169.254"), true); // cloud metadata endpoint
  assert.equal(isBlockedAddress("100.64.0.1"), true);
  assert.equal(isBlockedAddress("100.100.0.1"), true);
});

test("blocks IPv6 link-local and unique-local ranges", () => {
  assert.equal(isBlockedAddress("fe80::1"), true);
  assert.equal(isBlockedAddress("fc00::1"), true);
  assert.equal(isBlockedAddress("fd12:3456::1"), true);
});

test("blocks an IPv4-mapped IPv6 address that maps to a private range", () => {
  assert.equal(isBlockedAddress("::ffff:127.0.0.1"), true);
  assert.equal(isBlockedAddress("::ffff:10.0.0.1"), true);
});

test("allows a genuine public IPv4 address", () => {
  assert.equal(isBlockedAddress("8.8.8.8"), false);
  assert.equal(isBlockedAddress("93.184.216.34"), false);
});

test("fails closed for a malformed/non-IP string", () => {
  assert.equal(isBlockedAddress("not-an-ip"), true);
  assert.equal(isBlockedAddress(""), true);
});
