import Link from "next/link";
import type { Metadata } from "next";
import { LegalPage, LegalSection, P } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Delete your Kisan4U account",
  description: "Request deletion of your Kisan4U account and personal information.",
};

export default function PublicDeleteAccountPage() {
  return (
    <LegalPage title="Delete your Kisan4U account">
      <P>
        You can request account deletion from the Kisan4U mobile app under Account → Delete account,
        or complete the same process on this website.
      </P>
      <LegalSection>Before deletion</LegalSection>
      <P>
        Active orders, returns, refunds, withdrawals and unsettled Business Associate earnings must
        be resolved first. Any remaining wallet balance can be used before deletion or explicitly
        forfeited. Seller and Business Associate requests require administrator review.
      </P>
      <LegalSection>What we remove</LegalSection>
      <P>
        After the grace period, we remove readable contact and login information, saved addresses,
        cart, wishlist, notifications and uploaded identity documents.
      </P>
      <LegalSection>What we retain</LegalSection>
      <P>
        Orders, payments, refunds, settlements and invoices are retained for the legally required
        period. Your phone number is not retained in readable form.
      </P>
      <p className="mt-6">
        <Link
          href="/login/mobile?next=%2Faccount%2Fdelete"
          className="font-bold text-green-700 underline"
        >
          Sign in with OTP and continue to account deletion
        </Link>
      </p>
    </LegalPage>
  );
}
