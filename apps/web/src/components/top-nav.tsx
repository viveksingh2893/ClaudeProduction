"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Menu, ShoppingCart, UserCircle, X } from "lucide-react";
import { getNavLinks, isActiveNavLink, type NavLinkItem, type NavRole } from "@/lib/nav-links";
import { useT } from "@/i18n/client";
import { SignOutButton } from "./sign-out-button";
import { HeaderSearch } from "./header-search";

/** Storefront nav hrefs → dictionary keys (see apps/web/src/i18n). */
const NAV_LABEL_KEYS: Record<string, string> = {
  "/": "nav.home",
  "/products": "nav.products",
  "/dealer/products": "nav.products",
  "/wishlist": "nav.wishlist",
  "/cart": "nav.cart",
  "/orders": "nav.orders",
  "/dealer/requests": "nav.productRequests",
  "/account": "nav.account",
};

/**
 * The one reusable top navigation component for the customer-facing site
 * (apps/web) — mounted once in the root layout (see site-header.tsx) so
 * every page (Home, catalogue, product detail, cart, checkout, orders,
 * account, addresses, dealer product requests, ...) gets it automatically
 * instead of each page wiring its own links. Customer and dealer see
 * different link sets (see nav-links.ts); a guest sees a minimal set and
 * a plain "Login" link, never a "Login as Customer" nudge here (that lives
 * on the product page itself, for the specific customer-catalogue context).
 *
 * Single row on desktop (logo, search, links, cart/account) collapses to
 * a hamburger-triggered panel below 768px — no separate mobile component,
 * per the "one nav, role-aware, responsive" requirement.
 */
export function TopNav({
  role,
  cartCount,
  unreadNotificationCount,
  userName,
  isAuthenticated,
}: {
  role: NavRole;
  cartCount: number;
  unreadNotificationCount: number;
  userName: string | null;
  isAuthenticated: boolean;
}) {
  const pathname = usePathname();
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const links = getNavLinks(role);
  const navLabel = (link: NavLinkItem) => {
    const key = NAV_LABEL_KEYS[link.href];
    return key ? t(key) : link.label;
  };
  const accountHref = isAuthenticated ? "/account" : "/login";
  // /products (the customer catalogue) redirects a DEALER session away to
  // /dealer/products server-side — but that redirect deliberately drops
  // the search query (see products/page.tsx's doc comment: "the dealer
  // catalogue's own filters are a different product set entirely"), so a
  // dealer landed there via the customer search action instead of this
  // role-aware one would silently lose their search term. Point the form
  // at the right catalogue from the start instead of relying on the
  // redirect to fix it up.
  const searchAction = role === "DEALER" ? "/dealer/products" : "/products";

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6 lg:px-8">
        <Link href="/" className="shrink-0" aria-label="Kisan4U home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/kisan4u-logo.svg"
            alt="Kisan4U"
            width={94}
            height={32}
            className="h-7 w-auto sm:h-8"
          />
        </Link>

        {/* Search bar — always visible, sits between the logo and the menu. */}
        <div className="min-w-0 flex-1">
          <HeaderSearch searchAction={searchAction} className="md:max-w-md" />
        </div>

        <nav aria-label="Main navigation" className="ml-auto hidden items-center gap-1 md:flex">
          {links
            .filter((link) => link.href !== "/cart" && link.href !== "/account")
            .map((link) => {
              const active = isActiveNavLink(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-3 py-2 text-[13.5px] font-semibold transition-colors ${
                    active ? "bg-green-50 text-green-700" : "text-ink hover:bg-green-50 hover:text-green-700"
                  }`}
                >
                  {navLabel(link)}
                </Link>
              );
            })}
        </nav>

        <div className="hidden items-center gap-5 md:flex">
          {isAuthenticated && (
            <Link
              href="/notifications"
              className={`relative flex flex-col items-center gap-0.5 text-[11px] font-semibold ${
                isActiveNavLink(pathname, "/notifications") ? "text-green-700" : "text-ink hover:text-green-700"
              }`}
            >
              <span className="relative">
                <Bell className="h-6 w-6" strokeWidth={1.75} />
                {unreadNotificationCount > 0 && (
                  <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-earth-600 text-[9.5px] font-extrabold text-white">
                    {unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}
                  </span>
                )}
              </span>
              {t("nav.alerts")}
            </Link>
          )}
          <Link
            href={accountHref}
            className={`flex flex-col items-center gap-0.5 text-[11px] font-semibold ${
              isActiveNavLink(pathname, "/account") ? "text-green-700" : "text-ink hover:text-green-700"
            }`}
          >
            <UserCircle className="h-6 w-6" strokeWidth={1.75} />
            {isAuthenticated ? t("nav.account") : t("nav.login")}
          </Link>
          {links.some((link) => link.href === "/cart") && (
            <Link
              href="/cart"
              className={`relative flex flex-col items-center gap-0.5 text-[11px] font-semibold ${
                isActiveNavLink(pathname, "/cart") ? "text-green-700" : "text-ink hover:text-green-700"
              }`}
            >
              <span className="relative">
                <ShoppingCart className="h-6 w-6" strokeWidth={1.75} />
                {cartCount > 0 && (
                  <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-earth-600 text-[9.5px] font-extrabold text-white">
                    {cartCount > 9 ? "9+" : cartCount}
                  </span>
                )}
              </span>
              {t("nav.cart")}
            </Link>
          )}
          {isAuthenticated ? (
            <div className="flex items-center gap-3 border-l border-border pl-5">
              <span className="max-w-[110px] truncate text-[12.5px] text-gray-600">{userName}</span>
              <SignOutButton />
            </div>
          ) : null}
        </div>

        <button
          type="button"
          aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={isOpen}
          aria-controls="topnav-mobile-panel"
          onClick={() => setIsOpen((v) => !v)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border text-ink md:hidden"
        >
          {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <div
        id="topnav-mobile-panel"
        inert={!isOpen}
        className={`overflow-hidden border-t border-border transition-[max-height] duration-300 ease-in-out md:hidden ${
          isOpen ? "max-h-[70vh] overflow-y-auto" : "max-h-0"
        }`}
      >
        <nav aria-label="Main navigation" className="flex flex-col gap-0.5 px-4 py-3">
          {links.map((link) => {
            const active = isActiveNavLink(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-semibold ${
                  active ? "bg-green-50 text-green-700" : "text-ink"
                }`}
              >
                {navLabel(link)}
                {link.href === "/cart" && cartCount > 0 ? (
                  <span className="rounded-full bg-earth-600 px-2 py-0.5 text-[11px] font-bold text-white">{cartCount}</span>
                ) : null}
              </Link>
            );
          })}
          {!links.some((link) => link.href === "/account") && (
            <Link href={accountHref} className="rounded-md px-3 py-2.5 text-sm font-semibold text-ink">
              {isAuthenticated ? t("nav.account") : t("nav.login")}
            </Link>
          )}
          {isAuthenticated && (
            <Link
              href="/notifications"
              aria-current={isActiveNavLink(pathname, "/notifications") ? "page" : undefined}
              className={`flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-semibold ${
                isActiveNavLink(pathname, "/notifications") ? "bg-green-50 text-green-700" : "text-ink"
              }`}
            >
              {t("nav.notifications")}
              {unreadNotificationCount > 0 && (
                <span className="rounded-full bg-earth-600 px-2 py-0.5 text-[11px] font-bold text-white">{unreadNotificationCount}</span>
              )}
            </Link>
          )}
        </nav>
        {isAuthenticated && (
          <div className="border-t border-border px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">{userName}</span>
              <SignOutButton />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
