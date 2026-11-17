import { NavDrawer, type NavLink } from "@/components/nav-drawer";
import { SignOutButton } from "../sign-out-button";
import {
  LayoutGrid,
  Package,
  PackagePlus,
  Boxes,
  Tag,
  Factory,
  Handshake,
  IdCard,
  ShoppingBag,
  Undo2,
  Wallet,
  Gift,
  CircleUser,
  Info,
  FileText,
} from "lucide-react";

const SELLER_LINKS: NavLink[] = [
  { href: "/seller", label: "Dashboard", icon: <LayoutGrid />, group: "Dashboard" },

  { href: "/seller/products", label: "My products", icon: <Package />, group: "Catalog" },
  { href: "/seller/products/new", label: "Add product", icon: <PackagePlus />, group: "Catalog" },
  {
    href: "/seller/bulk-products",
    label: "Add Multiple Products",
    icon: <PackagePlus />,
    group: "Catalog",
  },
  { href: "/seller/product-quantity", label: "Inventory Management", icon: <Boxes />, group: "Catalog" },

  {
    href: "/seller/brands",
    label: "Brand requests",
    icon: <Tag />,
    group: "Requests & Licences",
  },
  {
    href: "/seller/manufacturers",
    label: "Manufacturer requests",
    icon: <Factory />,
    group: "Requests & Licences",
  },
  {
    href: "/seller/requests",
    label: "Dealer requests",
    icon: <Handshake />,
    group: "Requests & Licences",
  },
  {
    href: "/seller/licences",
    label: "Selling licences",
    icon: <IdCard />,
    group: "Requests & Licences",
  },

  { href: "/seller/orders", label: "Orders", icon: <ShoppingBag />, group: "Orders & Settlements" },
  {
    href: "/seller/returns",
    label: "Return and Cancel",
    icon: <Undo2 />,
    group: "Orders & Settlements",
  },
  { href: "/seller/settlements", label: "Settlements", icon: <Wallet />, group: "Orders & Settlements" },
  { href: "/seller/pickup-points", label: "Pickup points", icon: <Gift />, group: "Orders & Settlements" },

  { href: "/seller/profile", label: "Profile", icon: <CircleUser />, group: "Account" },
  { href: "/seller/status", label: "Status", icon: <Info />, group: "Account" },
  { href: "/seller/agreement", label: "Agreement", icon: <FileText />, group: "Account" },
];

/** Same pattern as apps/dashboard/src/app/admin/layout.tsx — see its doc comment. */
export default function SellerLayout({ children }: { children: React.ReactNode }) {
  return (
    <NavDrawer title="Seller" links={SELLER_LINKS} footer={<SignOutButton />}>
      {children}
    </NavDrawer>
  );
}
