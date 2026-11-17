"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { SegmentedToggle } from "@kisan4u/ui";

const OPTIONS: { value: "CUSTOMER" | "DEALER"; label: string }[] = [
  { value: "CUSTOMER", label: "Customer" },
  { value: "DEALER", label: "Dealer" },
];

/**
 * URL-driven (?audience=CUSTOMER|DEALER), same convention as every other
 * filter control in this app (see packages/ui/src/useTableUrlState.ts) —
 * reload/back-forward restores which audience you were managing. Both the
 * Hero and Coupon banner sections below this toggle re-scope together.
 */
export function AudienceToggle({ audience }: { audience: "CUSTOMER" | "DEALER" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setAudience(next: "CUSTOMER" | "DEALER") {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "CUSTOMER") params.delete("audience");
    else params.set("audience", next);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return <SegmentedToggle options={OPTIONS} value={audience} onChange={setAudience} />;
}
