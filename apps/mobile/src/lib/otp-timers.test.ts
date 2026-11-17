import assert from "node:assert/strict";
import test from "node:test";
import { formatCountdown, getOtpTiming } from "@/hooks/use-otp-timers";

test("OTP resend unlocks after 60 seconds", () => {
  assert.deepEqual(getOtpTiming(0), { resendIn: 60, expired: false });
  assert.deepEqual(getOtpTiming(59), { resendIn: 1, expired: false });
  assert.deepEqual(getOtpTiming(60), { resendIn: 0, expired: false });
});

test("OTP expires after five minutes", () => {
  assert.equal(getOtpTiming(299).expired, false);
  assert.equal(getOtpTiming(300).expired, true);
  assert.equal(formatCountdown(29), "0:29");
  assert.equal(formatCountdown(300), "5:00");
});
