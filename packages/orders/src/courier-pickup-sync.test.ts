import { test } from "node:test";
import assert from "node:assert/strict";
import {
  courierAddressChanged,
  courierLocationNameFor,
  rapidshypLocationNameFor,
  sanitizeRapidShypContactName,
  splitAddressForRapidShyp,
  tenDigitMobile,
} from "./courier-pickup-sync";

test("revision 0 keeps the original Delhivery K4U-<id> name; later revisions get a suffix", () => {
  assert.equal(courierLocationNameFor("abc"), "K4U-abc");
  assert.equal(courierLocationNameFor("abc", 0), "K4U-abc");
  assert.equal(courierLocationNameFor("abc", 2), "K4U-abc-r2");
});

test("RapidShyp names stay within its 20-char limit", () => {
  const id = "cmtlfu5g8000nqudi99g47u48";
  assert.equal(rapidshypLocationNameFor(id), "K4U-di99g47u48");
  assert.ok(rapidshypLocationNameFor(id, 99).length <= 20);
});

test("short address stays on one line", () => {
  assert.deepEqual(splitAddressForRapidShyp("GAT No. 648, Kolvihire"), {
    line1: "GAT No. 648, Kolvihire",
    truncated: false,
  });
});

test("long address splits at a word boundary into two <=100-char lines", () => {
  const text =
    "GAT No. 648, Lavahalvadi, Village- Kolvihire, Near Putta company, Beside Adinath Agro, Jejuri Morgoan road, Tal- Purandar, Pune";
  const out = splitAddressForRapidShyp(text);
  assert.ok(out.line1.length <= 100);
  assert.ok(out.line2 && out.line2.length <= 100);
  const words = (s: string) => s.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  assert.deepEqual(words(`${out.line1} ${out.line2}`), words(text));
  assert.equal(out.truncated, false);
});

test("address over 200 chars reports truncation", () => {
  const out = splitAddressForRapidShyp("word ".repeat(60).trim());
  assert.equal(out.truncated, true);
  assert.ok(out.line1.length <= 100 && (out.line2?.length ?? 0) <= 100);
});

test("contact name keeps letters only, with a fallback", () => {
  assert.equal(sanitizeRapidShypContactName("Dheeraj K. (Manager) 2"), "Dheeraj K Manager");
  assert.equal(sanitizeRapidShypContactName("123"), "Kisan4U");
});

test("mobile normalises to the last 10 digits", () => {
  assert.equal(tenDigitMobile("+91 98765-43210"), "9876543210");
});

test("address change detection ignores null vs undefined landmark", () => {
  const before = {
    contactPerson: "A",
    mobile: "9876543210",
    line1: "x",
    landmark: null,
    city: "c",
    district: "d",
    state: "s",
    pincode: "412303",
  };
  assert.equal(courierAddressChanged(before, { ...before, landmark: undefined }), false);
  assert.equal(courierAddressChanged(before, { ...before, pincode: "412308" }), true);
});
