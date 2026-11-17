"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ShoppingCart, User } from "lucide-react";
import { isProductDetailPath } from "@/lib/is-pdp-route";
import { useT } from "@/i18n/client";

/**
 * Fixed bottom tab bar for the storefront on mobile (Flipkart-mobile build
 * spec) — four destinations, active tab in the brand green. Hidden from
 * md: up, where the top nav already carries these links. The pages add
 * bottom padding so content clears it.
 */
const TABS = [
  { href: "/", labelKey: "nav.home", icon: Home, match: (p: string) => p === "/" },
  {
    href: "/kisan4u-doctor",
    labelKey: "nav.doctor",
    icon: null,
    match: (p: string) => p.startsWith("/kisan4u-doctor"),
  },
  {
    href: "/cart",
    labelKey: "nav.cart",
    icon: ShoppingCart,
    match: (p: string) => p.startsWith("/cart"),
  },
  {
    href: "/account",
    labelKey: "nav.account",
    icon: User,
    match: (p: string) => p.startsWith("/account") || p.startsWith("/orders"),
  },
];

export function BottomNav({ cartCount = 0 }: { cartCount?: number }) {
  const pathname = usePathname();
  const t = useT();

  // The product detail page (customer or dealer) shows its own fixed Add
  // to Cart / Buy Now bar at the bottom — hide the tab bar there so the
  // two don't stack.
  if (isProductDetailPath(pathname)) return null;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 flex h-16 border-t border-black/10 bg-white md:hidden"
    >
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        const Icon = tab.icon;
        const showBadge = tab.href === "/cart" && cartCount > 0;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${
              active ? "text-green-700" : "text-gray-500"
            }`}
          >
            <span className="relative">
              {Icon ? (
                <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
              ) : (
                <span className="text-lg leading-none" role="img" aria-hidden="true">
                  🩺
                </span>
              )}
              {showBadge && (
                <span
                  aria-label={`${cartCount} items in cart`}
                  className="absolute -right-2.5 -top-2 min-w-[16px] rounded-full bg-earth-600 px-1 text-center text-[10px] font-bold leading-4 text-white"
                >
                  {cartCount > 99 ? "99+" : cartCount}
                </span>
              )}
              {!Icon && (
                <span className="absolute -right-3.5 -top-2.5 whitespace-nowrap rounded-full bg-green-600 px-1 py-px text-[7px] font-bold leading-tight text-white shadow-sm">
                  {t("nav.comingSoon")}
                </span>
              )}
            </span>
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
