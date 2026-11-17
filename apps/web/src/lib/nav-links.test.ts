import { test } from "node:test";
import assert from "node:assert/strict";
import { getNavLinks, isActiveNavLink } from "./nav-links";

test("customer sees Home, Products, Wishlist, Cart, Orders, Account — no Product Requests, no admin/seller links", () => {
  const links = getNavLinks("CUSTOMER").map((l) => l.label);
  assert.deepEqual(links, ["Home", "Products", "Wishlist", "Cart", "Orders", "Account"]);
});

test("dealer sees Home, Products (dealer catalogue), Wishlist, Cart, Orders, Product Requests, Account", () => {
  const links = getNavLinks("DEALER");
  assert.deepEqual(
    links.map((l) => l.label),
    ["Home", "Products", "Wishlist", "Cart", "Orders", "Product Requests", "Account"],
  );
  assert.equal(links.find((l) => l.label === "Products")!.href, "/dealer/products");
});

test("guest sees Home, Products and Cart — no Orders/Account/Product Requests", () => {
  const links = getNavLinks("GUEST").map((l) => l.label);
  assert.deepEqual(links, ["Home", "Products", "Cart"]);
});

test("no role ever includes an admin or seller dashboard link", () => {
  for (const role of ["CUSTOMER", "DEALER", "GUEST"] as const) {
    for (const link of getNavLinks(role)) {
      assert.ok(
        !link.href.startsWith("/admin"),
        `${role} nav must not include admin link ${link.href}`,
      );
      assert.ok(
        !link.href.startsWith("/seller"),
        `${role} nav must not include seller link ${link.href}`,
      );
    }
  }
});

test("isActiveNavLink: Home matches only the exact root path", () => {
  assert.equal(isActiveNavLink("/", "/"), true);
  assert.equal(isActiveNavLink("/products", "/"), false);
});

test("isActiveNavLink: other links match their own sub-paths", () => {
  assert.equal(isActiveNavLink("/orders", "/orders"), true);
  assert.equal(isActiveNavLink("/orders/abc123", "/orders"), true);
  assert.equal(isActiveNavLink("/orders-history", "/orders"), false);
  assert.equal(isActiveNavLink("/cart", "/orders"), false);
});
