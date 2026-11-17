import { redirect } from "next/navigation";

/** Shortcut straight to the submitted-products queue. */
export default function AdminPendingProductsPage() {
  redirect("/admin/products?status=SUBMITTED");
}
