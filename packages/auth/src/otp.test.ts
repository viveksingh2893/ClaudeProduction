import { test } from "node:test";
import assert from "node:assert/strict";
import { getTrustedClientIp } from "./otp";

function requestHeaders(values: Record<string, string>): Pick<Headers, "get"> {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

test("uses Cloudflare's connecting IP when present", () => {
  const headers = requestHeaders({
    "cf-connecting-ip": "203.0.113.8",
    "x-forwarded-for": "198.51.100.1, 10.0.0.1",
  });
  assert.equal(getTrustedClientIp(headers), "203.0.113.8");
});

test("falls back to the first forwarded IP and then an anonymous bucket", () => {
  assert.equal(
    getTrustedClientIp(requestHeaders({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" })),
    "198.51.100.1",
  );
  assert.equal(getTrustedClientIp(requestHeaders({})), "unknown");
});
