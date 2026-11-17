import { auth } from "@/auth";
import { getDealerApplicationForUser } from "@kisan4u/auth";

/**
 * Resolves the storefront "Become a Dealer" call-to-action for the current
 * visitor, from the live session only. One source of truth for the promo
 * ribbon, the footer link and the homepage join card so they never
 * disagree:
 *
 *  - an approved dealer / seller / admin / staff account: `show: false`
 *    — the button is hidden entirely ("if someone is already logged in as
 *    a dealer do not show them the button").
 *  - a signed-out visitor: the plain CTA, pointing at the /dealer landing.
 *  - a signed-in customer who has never applied: the plain CTA, pointing
 *    straight at /register/dealer (which, being logged in, skips phone
 *    entry and opens the form).
 *  - a customer with a PENDING / REJECTED application: the CTA relabels to
 *    the status and still opens /register/dealer, where the form is
 *    prefilled for edit + resubmit.
 */
export type BecomeDealerCtaStatus = "none" | "pending" | "rejected";

export type BecomeDealerCta = {
  show: boolean;
  status: BecomeDealerCtaStatus;
  href: string;
};

export async function getBecomeDealerCta(): Promise<BecomeDealerCta> {
  const session = await auth();
  const role = session?.user.role;

  if (role === "DEALER" || role === "SELLER" || role === "ADMIN" || role === "STAFF") {
    return { show: false, status: "none", href: "/dealer" };
  }

  if (!session) {
    return { show: true, status: "none", href: "/dealer" };
  }

  const application = await getDealerApplicationForUser(session.user.id);
  if (application?.status === "PENDING") {
    return { show: true, status: "pending", href: "/register/dealer" };
  }
  if (application?.status === "REJECTED") {
    return { show: true, status: "rejected", href: "/register/dealer" };
  }
  return { show: true, status: "none", href: "/register/dealer" };
}

/** English fallback label for the non-default states (the default keeps the i18n string at the call site). */
export function becomeDealerCtaLabel(status: BecomeDealerCtaStatus): string {
  switch (status) {
    case "pending":
      return "Dealer application: Pending";
    case "rejected":
      return "Dealer application: Rejected";
    default:
      return "Become a Dealer";
  }
}
