import { test } from "node:test";
import assert from "node:assert/strict";
import { isTrackableHost, metaCustomDataForCart } from "./shared";

test("live domains are tracked, local / dev / tailnet hosts never are", () => {
  assert.equal(isTrackableHost("katra4u.com"), true);
  assert.equal(isTrackableHost("www.kisan4u.com"), true);
  for (const host of ["localhost", "127.0.0.1", "192.168.1.20", "10.0.0.5", "172.20.1.1", "buru.taild5f463.ts.net", "100.101.1.2"]) {
    assert.equal(isTrackableHost(host), false, host);
  }
});

test("a cart becomes Meta custom_data keyed by SKU", () => {
  assert.deepEqual(
    metaCustomDataForCart({
      contents: [
        { id: "SKU-1-cus", quantity: 2, item_price: 150 },
        { id: "SKU-2-cus", quantity: 1, item_price: 99.5 },
      ],
      value: 399.5,
    }),
    {
      content_ids: ["SKU-1-cus", "SKU-2-cus"],
      content_type: "product",
      contents: [
        { id: "SKU-1-cus", quantity: 2, item_price: 150 },
        { id: "SKU-2-cus", quantity: 1, item_price: 99.5 },
      ],
      num_items: 3,
      value: 399.5,
    },
  );
});
