import assert from "node:assert/strict";
import test from "node:test";
import { isMobileVersionAtLeast } from "./mobile-app-version";

test("missing and malformed versions stay on the compatible old flow", () => {
  assert.equal(isMobileVersionAtLeast(null, "3.1.0"), false);
  assert.equal(isMobileVersionAtLeast("unknown", "3.1.0"), false);
});

test("semantic versions select the generic flow at the configured minimum", () => {
  assert.equal(isMobileVersionAtLeast("3.0.1", "3.1.0"), false);
  assert.equal(isMobileVersionAtLeast("3.1.0", "3.1.0"), true);
  assert.equal(isMobileVersionAtLeast("4.0.0", "3.1.0"), true);
});
