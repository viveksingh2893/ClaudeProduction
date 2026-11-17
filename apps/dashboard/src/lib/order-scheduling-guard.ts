import { requireAdminOrModule } from "./session-guard";

/**
 * The module key for the "Scheduling Team" role — see
 * packages/auth/src/permissions.ts. This role gets full working access to
 * the orders section: it uses the same /admin/orders table and
 * /admin/orders/[id] detail page an admin does (the -scheduling section is
 * just its own entry point into that table). A plain ADMIN session always
 * passes these guards unconditionally; a STAFF account needs
 * order-scheduling VIEW / EDIT.
 *
 *   VIEW  — the order table + individual order pages
 *   EDIT  — every write action on an order (confirm, dispatch, status
 *           changes, cancel, returns, delivery marking, …)
 */
export const ORDER_SCHEDULING_MODULE_KEY = "order-scheduling";

/** Gate for viewing any orders-section page. ADMIN or order-scheduling:VIEW. */
export async function requireOrdersSectionView() {
  return requireAdminOrModule(ORDER_SCHEDULING_MODULE_KEY, "VIEW");
}

/** Gate for any orders-section write action. ADMIN or order-scheduling:EDIT. */
export async function requireOrdersSectionEdit() {
  return requireAdminOrModule(ORDER_SCHEDULING_MODULE_KEY, "EDIT");
}
