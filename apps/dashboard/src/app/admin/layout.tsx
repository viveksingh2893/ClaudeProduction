import { NavDrawer, type NavLink } from "@/components/nav-drawer";
import { SignOutButton } from "../sign-out-button";
import { auth } from "@/auth";
import { hasPermission } from "@kisan4u/auth";
import { POS_MODULE_KEY } from "@/lib/pos-guard";
import { PAYMENT_VERIFICATION_MODULE_KEY } from "@/lib/payment-verification-guard";
import { ORDER_SCHEDULING_MODULE_KEY } from "@/lib/order-scheduling-guard";
import { SETTLEMENTS_MODULE_KEY } from "@/lib/settlements-guard";
import { COUPONS_MODULE_KEY } from "@/lib/coupons-guard";
import { ACCOUNT_DELETION_MODULE_KEY } from "@/lib/account-deletion-guard";
import {
  LayoutGrid,
  CreditCard,
  ShoppingBag,
  IndianRupee,
  ShieldCheck,
  UserCog,
  Users,
  CircleUserRound,
  UserRound,
  Handshake,
  Store,
  Folder,
  Tag,
  Factory,
  Sprout,
  Bug,
  List,
  Package,
  PackagePlus,
  PlusCircle,
  Clock,
  Boxes,
  FileText,
  Truck,
  IdCard,
  Ticket,
  ClipboardCheck,
  ShoppingCart,
  Undo2,
  Gift,
  Settings,
  Award,
  Star,
  Image,
  Newspaper,
  CircleUser,
  Clapperboard,
  BellRing,
  Trash2,
} from "lucide-react";

// Grouped in the order the sidebar shows them — each group's own header
// appears once, at its first link's position (see NavDrawer's grouping).
const ADMIN_LINKS: NavLink[] = [
  { href: "/admin", label: "Dashboard", icon: <LayoutGrid />, group: "Dashboard & POS" },
  { href: "/admin/pos", label: "POS", icon: <CreditCard />, group: "Dashboard & POS" },
  { href: "/admin/pos/orders", label: "POS Orders", icon: <ShoppingBag />, group: "Dashboard & POS" },
  { href: "/admin/pos/pricing", label: "POS pricing", icon: <IndianRupee />, group: "Dashboard & POS" },
  {
    href: "/admin/payment-verification",
    label: "Payment verification",
    icon: <ShieldCheck />,
    group: "Dashboard & POS",
  },

  { href: "/admin/roles", label: "Roles", icon: <UserCog />, group: "User Management" },
  { href: "/admin/employees", label: "Employees", icon: <Users />, group: "User Management" },
  { href: "/admin/users", label: "Users", icon: <CircleUserRound />, group: "User Management" },
  { href: "/admin/customers", label: "Customers", icon: <UserRound />, group: "User Management" },
  { href: "/admin/dealers", label: "Dealers", icon: <Handshake />, group: "User Management" },
  { href: "/admin/sellers", label: "Sellers", icon: <Store />, group: "User Management" },
  {
    href: "/admin/business-associates",
    label: "Business Associates",
    icon: <Award />,
    group: "User Management",
  },
  {
    href: "/admin/account-deletions",
    label: "Account deletions",
    icon: <Trash2 />,
    group: "User Management",
  },

  { href: "/admin/categories", label: "Categories", icon: <Folder />, group: "Catalog Management" },
  { href: "/admin/subcategories", label: "Subcategories", icon: <Folder />, group: "Catalog Management" },
  {
    href: "/admin/sub-subcategories",
    label: "Sub-subcategories",
    icon: <Folder />,
    group: "Catalog Management",
  },
  { href: "/admin/brands", label: "Brands", icon: <Tag />, group: "Catalog Management" },
  { href: "/admin/manufacturers", label: "Manufacturers", icon: <Factory />, group: "Catalog Management" },
  { href: "/admin/crops", label: "Crops", icon: <Sprout />, group: "Catalog Management" },
  { href: "/admin/pests", label: "Pests & Diseases", icon: <Bug />, group: "Catalog Management" },
  {
    href: "/admin/attributes",
    label: "Product attributes",
    icon: <List />,
    group: "Catalog Management",
  },
  { href: "/admin/products", label: "Products", icon: <Package />, group: "Catalog Management" },
  {
    href: "/admin/products/new",
    label: "Add Product",
    icon: <PlusCircle />,
    group: "Catalog Management",
  },
  {
    href: "/admin/bulk-products",
    label: "Add Multiple Products",
    icon: <PackagePlus />,
    group: "Catalog Management",
  },
  {
    href: "/admin/products/pending",
    label: "Pending products approval",
    icon: <Clock />,
    group: "Catalog Management",
  },
  {
    href: "/admin/product-quantity",
    label: "Inventory Management",
    icon: <Boxes />,
    group: "Catalog Management",
  },
  {
    href: "/admin/product-requests",
    label: "Product requests",
    icon: <FileText />,
    group: "Catalog Management",
  },

  {
    href: "/admin/logistics-pricing",
    label: "Logistics price logic",
    icon: <Truck />,
    group: "Operations",
  },
  { href: "/admin/seller-licences", label: "Seller licences", icon: <IdCard />, group: "Operations" },
  {
    href: "/admin/compliance-reviews",
    label: "Compliance reviews",
    icon: <ClipboardCheck />,
    group: "Operations",
  },
  { href: "/admin/coupons", label: "Coupons", icon: <Ticket />, group: "Operations" },

  {
    href: "/admin/checkout-groups",
    label: "Checkout groups",
    icon: <ShoppingCart />,
    group: "Orders & Returns",
  },
  { href: "/admin/orders", label: "Orders", icon: <ShoppingBag />, group: "Orders & Returns" },
  {
    href: "/admin/order-scheduling",
    label: "Order Scheduling",
    icon: <ClipboardCheck />,
    group: "Orders & Returns",
  },
  {
    href: "/admin/order-scheduling/history",
    label: "Order History",
    icon: <FileText />,
    group: "Orders & Returns",
  },
  { href: "/admin/returns", label: "Return and Cancel", icon: <Undo2 />, group: "Orders & Returns" },
  {
    href: "/admin/settlements",
    label: "Settlement cycles",
    icon: <IndianRupee />,
    group: "Orders & Returns",
  },
  { href: "/admin/pickup-points", label: "Pickup points", icon: <Gift />, group: "Orders & Returns" },
  {
    href: "/admin/ba-settlements",
    label: "BA settlements",
    icon: <IndianRupee />,
    group: "Orders & Returns",
  },
  { href: "/admin/order-settings", label: "Order settings", icon: <Settings />, group: "Orders & Returns" },
  { href: "/admin/reports", label: "Reports", icon: <FileText />, group: "Orders & Returns" },

  {
    href: "/admin/site-settings/editorial-badges",
    label: "Editorial badges",
    icon: <Award />,
    group: "Content & Marketing",
  },
  { href: "/admin/reviews", label: "Reviews", icon: <Star />, group: "Content & Marketing" },
  { href: "/admin/banners", label: "Banners", icon: <Image />, group: "Content & Marketing" },
  {
    href: "/admin/app-login-video",
    label: "App login video",
    icon: <Clapperboard />,
    group: "Content & Marketing",
  },
  { href: "/admin/blog", label: "Blog", icon: <Newspaper />, group: "Content & Marketing" },
  {
    href: "/admin/notifications",
    label: "Push notifications",
    icon: <BellRing />,
    group: "Content & Marketing",
  },

  { href: "/admin/site-settings", label: "Site settings", icon: <Settings />, group: "Settings & Profile" },
  { href: "/admin/ba-settings", label: "BA settings", icon: <Award />, group: "Settings & Profile" },
  { href: "/admin/profile", label: "Profile", icon: <CircleUser />, group: "Settings & Profile" },
];

// Links gated by a real RolePermission module key — both ADMIN (via the
// seeded Super Admin role) and STAFF go through the same hasPermission()
// check. Every other link below has no entry here, which means it keeps
// its pre-RBAC behavior: visible only to ADMIN, with no permission-based
// restriction (its underlying route is still a plain
// requireSession(["ADMIN"]) — see the plan's "~129 sections stay
// untouched" scoping). Add an entry here only once a section's route has
// actually been switched to requireAdminPermission().
const MODULE_BY_HREF: Record<string, string> = {
  "/admin/pos": POS_MODULE_KEY,
  "/admin/pos/orders": POS_MODULE_KEY,
  "/admin/payment-verification": PAYMENT_VERIFICATION_MODULE_KEY,
  "/admin/order-scheduling": ORDER_SCHEDULING_MODULE_KEY,
  "/admin/order-scheduling/history": ORDER_SCHEDULING_MODULE_KEY,
  "/admin/reports": ORDER_SCHEDULING_MODULE_KEY,
  "/admin/settlements": SETTLEMENTS_MODULE_KEY,
  "/admin/roles": "roles",
  "/admin/employees": "roles",
  "/admin/coupons": COUPONS_MODULE_KEY,
  "/admin/account-deletions": ACCOUNT_DELETION_MODULE_KEY,
};

// Always visible to anyone who reaches /admin at all — the safe landing
// shell every role (including a brand-new STAFF role with nothing else
// granted yet) can always fall back to.
const ALWAYS_VISIBLE_HREFS = new Set(["/admin", "/admin/profile"]);

/**
 * Wraps every /admin/* page with the collapsible nav drawer (see
 * apps/dashboard/src/components/nav-drawer.tsx) — a Next.js layout is
 * what makes this "don't duplicate nav code on every page": it's declared
 * once here and Next renders it around every nested admin page
 * automatically. Auth itself stays on each individual page's own
 * `requireSession(...)` call, same as before — this layout only adds the
 * navigation chrome plus visibility filtering, it doesn't re-implement the
 * access gate (a hidden link's underlying route is still independently
 * protected).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const role = session?.user?.role;
  const userId = session?.user?.id;

  const links: NavLink[] = [];
  if (userId) {
    for (const link of ADMIN_LINKS) {
      if (ALWAYS_VISIBLE_HREFS.has(link.href)) {
        links.push(link);
        continue;
      }
      const moduleKey = MODULE_BY_HREF[link.href];
      if (moduleKey) {
        if (await hasPermission(userId, moduleKey, "VIEW")) links.push(link);
        continue;
      }
      if (role === "ADMIN") links.push(link);
    }
  }

  return (
    <NavDrawer title="Admin" links={links} footer={<SignOutButton />} searchable>
      {children}
    </NavDrawer>
  );
}
