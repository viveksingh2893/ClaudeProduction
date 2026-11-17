import type { Metadata } from "next";
import { LegalDocView } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Shipping Policy | Kisan4U",
  description:
    "Processing times, shipping rates, delivery estimates, and tracking for orders placed on Kisan4U.",
};

export default function ShippingPolicyPage() {
  return <LegalDocView slug="shipping-policy" />;
}
