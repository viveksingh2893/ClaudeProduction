"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search, X } from "lucide-react";

// `icon` is a pre-rendered element (e.g. `<LayoutGrid />`), not a
// component reference — the admin/seller layouts that build these lists
// are Server Components passing `links` into this Client Component, and
// only actual React elements survive that boundary; a bare component
// function does not serialize and throws at build time.
export type NavLink = { href: string; label: string; icon: ReactNode; group: string };

/**
 * Reusable admin/seller navigation shell — a single component so the link
 * list, active-page highlighting, and open/close behavior live in exactly
 * one place instead of being copy-pasted onto every protected page. Used
 * by apps/dashboard/src/app/admin/layout.tsx and .../seller/layout.tsx,
 * each supplying their own role-appropriate `links`.
 *
 * `links` is a flat, already-ordered array — grouping into labeled
 * sections happens here by each link's own `group` field (first
 * occurrence decides a section's position), rather than each layout
 * having to build its own nested structure. This keeps the
 * permission-filtering logic in admin/layout.tsx working over a plain
 * flat array exactly as before; a group that ends up with zero visible
 * links after filtering just never appears.
 *
 * Renders the nav content TWICE — a plain always-visible `md:flex` sidebar
 * and a `md:hidden` slide-in overlay drawer — rather than one element
 * whose desktop/mobile behavior is decided by a JS viewport check. Runtime
 * `matchMedia`-based state proved unreliable to keep in sync in this
 * project's automated preview tooling; two small CSS-gated render paths
 * sidestep that entirely; each variant's `inert`/tab-order rules follow
 * directly from its own always-correct state (`isOpen` for the drawer,
 * always-interactive for the static sidebar) with no viewport polling.
 */
export function NavDrawer({
  title,
  links,
  footer,
  children,
  searchable = false,
}: {
  title: string;
  links: NavLink[];
  footer?: ReactNode;
  children: ReactNode;
  /** Shows a filter-as-you-type search box above the nav groups (spec: admin sidebar search). */
  searchable?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pathname = usePathname();
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  const visibleLinks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return links;
    return links.filter((link) => link.label.toLowerCase().includes(q));
  }, [links, query]);

  useEffect(() => {
    if (!isOpen) return;
    firstLinkRef.current?.focus();
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Closes the drawer whenever the route changes — covers both a link
  // click and browser back/forward, without needing an onClick on every
  // <Link>.
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  function isActiveLink(href: string) {
    return (
      pathname === href || (href !== "/admin" && href !== "/seller" && pathname.startsWith(href))
    );
  }

  // Groups links by `group`, preserving each group's position by its
  // first link's position in the incoming (already-ordered) array.
  const groups: { name: string; links: NavLink[] }[] = [];
  for (const link of visibleLinks) {
    let group = groups.find((g) => g.name === link.group);
    if (!group) {
      group = { name: link.group, links: [] };
      groups.push(group);
    }
    group.links.push(link);
  }

  function renderGroups(attachFirstLinkRef: boolean) {
    // Local to each call — renderGroups runs once for the desktop sidebar
    // and once for the mobile drawer, and only the mobile pass's actual
    // first link should ever get the ref.
    let linkIndex = 0;
    return groups.map((group) => (
      <div key={group.name} className="mb-1 mt-5 first:mt-0">
        <div className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-green-500">
          {group.name}
        </div>
        {group.links.map((link) => {
          const isFirst = attachFirstLinkRef && linkIndex === 0;
          linkIndex += 1;
          const active = isActiveLink(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              ref={isFirst ? firstLinkRef : undefined}
              className={`mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${
                active
                  ? "bg-green-600 font-semibold text-white shadow-sm"
                  : "font-medium text-green-100/90 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className="h-[18px] w-[18px] shrink-0 [&>svg]:h-full [&>svg]:w-full">
                {link.icon}
              </span>
              <span className="truncate">{link.label}</span>
            </Link>
          );
        })}
      </div>
    ));
  }

  const searchBox = searchable && (
    <div className="mb-3 px-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-green-300/70" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search menu…"
          aria-label="Search menu"
          className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-8 pr-3 text-sm text-white placeholder-green-200/50 outline-none focus:border-green-400/60 focus:bg-white/10"
        />
      </div>
      {query.trim() && groups.length === 0 && (
        <div className="mt-2 px-1 text-xs text-green-200/60">No matching pages.</div>
      )}
    </div>
  );

  const navHeader = (
    <div className="mb-4 border-b border-white/10 px-4 pb-4">
      <div className="text-lg font-extrabold text-white">Kisan4U</div>
      <div className="text-xs font-bold uppercase tracking-wide text-green-400">{title}</div>
    </div>
  );

  return (
    <div className="md:flex md:min-h-screen">
      {/* Desktop: persistent sidebar, always visible and interactive — no inert/tabIndex juggling needed. */}
      <nav className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col overflow-y-auto bg-green-950 pt-4 pb-4 text-green-50 md:flex">
        {navHeader}
        {searchBox}
        <div className="flex-1 px-3">{renderGroups(false)}</div>
        {footer && <div className="mt-4 border-t border-white/10 px-4 pt-4">{footer}</div>}
      </nav>

      {/* Mobile: hamburger-triggered overlay drawer. */}
      <button
        type="button"
        aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={isOpen}
        aria-controls="nav-drawer-panel"
        onClick={() => setIsOpen((v) => !v)}
        className="fixed left-4 top-4 z-40 flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-surface text-ink shadow-card md:hidden"
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {isOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-20 border-none bg-black/30 p-0 md:hidden"
        />
      )}

      <nav
        id="nav-drawer-panel"
        inert={!isOpen}
        className={`fixed inset-y-0 left-0 z-30 flex w-[260px] flex-col overflow-y-auto bg-green-950 pb-4 pt-[4.5rem] text-green-50 transition-transform duration-200 md:hidden ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {navHeader}
        {searchBox}
        <div className="flex-1 px-3">{renderGroups(true)}</div>
        {footer && <div className="mt-4 border-t border-white/10 px-4 pt-4">{footer}</div>}
      </nav>

      <div className="min-w-0 flex-1 bg-bg-dashboard">{children}</div>
    </div>
  );
}
