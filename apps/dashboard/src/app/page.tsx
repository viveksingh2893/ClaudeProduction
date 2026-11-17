import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session-guard";

export default async function DashboardRootPage() {
  const session = await requireSession(["ADMIN", "SELLER", "STAFF"]);

  if (session.user.role === "ADMIN" || session.user.role === "STAFF") {
    redirect("/admin");
  }
  if (session.user.role === "SELLER") {
    redirect("/seller");
  }

  // Defensive fallback — the password provider only ever grants ADMIN,
  // SELLER, or STAFF sessions, so this shouldn't be reachable in practice.
  redirect("/login");
}
