"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home } from "lucide-react";
import type { CategoryNavTree } from "@kisan4u/catalog";

/**
 * The storefront category ribbon — a row of "tabs" (emoji icon + label)
 * mounted once in the root layout directly under SiteHeader (see
 * category-bar.tsx). The first tab is always Home ("/"); the rest are the
 * top-level categories, each its own page ("/c/[slug]"). Because the
 * ribbon lives in the shared layout it never unmounts, so tapping a tab is
 * an instant in-place route change; tabs are prefetched links, the active
 * tab is derived from the URL and scrolls itself into view.
 *
 * Mobile: horizontally-scrollable, ~5.5 tabs visible. lg+: the tabs share
 * the 1200px container evenly with no scroll.
 *
 * `categoryBasePath` (customer = "/category"): a tab links to that
 * category's page. Omitted (dealer): tabs keep the
 * `${hrefPrefix}?category=${slug}` filtered-catalogue link.
 */
export function CategoryNav({
  tree,
  hrefPrefix,
  categoryBasePath,
}: {
  tree: CategoryNavTree;
  hrefPrefix: string;
  categoryBasePath?: string;
}) {
  const pathname = usePathname();
  const scrollerRef = useRef<HTMLDivElement>(null);

  const activeSlug = pathname.match(/^\/c\/([^/]+)/)?.[1] ?? null;
  const homeActive = pathname === "/";

  useEffect(() => {
    const key = homeActive ? "home" : activeSlug;
    if (!key) return;
    const el = scrollerRef.current?.querySelector<HTMLElement>(`[data-tab="${key}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [activeSlug, homeActive]);

  if (tree.length === 0) return null;

  const tabHref = (slug: string) =>
    categoryBasePath ? `${categoryBasePath}/${slug}` : `${hrefPrefix}?category=${slug}`;

  return (
    <nav
      aria-label="Shop by category"
      className="sticky top-[52px] z-30 border-b border-black/15 bg-white sm:top-[60px]"
    >
      <div
        ref={scrollerRef}
        className="mx-auto flex max-w-[1200px] items-start gap-1.5 overflow-x-auto px-2 [scrollbar-width:none] lg:justify-between lg:gap-2 lg:overflow-visible lg:px-8 [&::-webkit-scrollbar]:hidden"
      >
        <Tab
          href="/"
          label="Home"
          active={homeActive}
          dataTab="home"
          icon={<Home className="h-6 w-6" strokeWidth={homeActive ? 2.25 : 1.75} aria-hidden="true" />}
        />
        {tree.map((category) => (
          <Tab
            key={category.id}
            href={tabHref(category.slug)}
            label={category.name}
            active={category.slug === activeSlug}
            dataTab={category.slug}
            icon={
              category.emoji ? (
                <span aria-hidden="true" className="text-2xl leading-none">
                  {category.emoji}
                </span>
              ) : (
                <span aria-hidden="true" className="text-sm font-extrabold text-green-700">
                  {category.name.charAt(0)}
                </span>
              )
            }
          />
        ))}
      </div>
    </nav>
  );
}

function Tab({
  href,
  label,
  active,
  dataTab,
  icon,
}: {
  href: string;
  label: string;
  active: boolean;
  dataTab: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch
      data-tab={dataTab}
      aria-current={active ? "page" : undefined}
      className="flex w-[78px] shrink-0 flex-col items-center px-1 pb-2 pt-2 lg:w-auto lg:flex-1"
    >
      <span
        className={`flex h-10 w-11 items-center justify-center rounded-[10px] transition-colors ${
          active ? "bg-green-100" : "bg-black/[0.04]"
        }`}
      >
        {icon}
      </span>
      <span
        className={`mt-1 line-clamp-2 max-w-full border-b-[3px] px-0.5 pb-0.5 text-center text-[11px] leading-[1.2] transition-colors lg:text-[12.5px] ${
          active
            ? "border-green-600 font-bold text-black"
            : "border-transparent font-normal text-[#5a5a5a]"
        }`}
      >
        {label}
      </span>
    </Link>
  );
}
