import type { Metadata } from "next";
import { LegalDocView } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Cancellation Policy | Kisan4U",
  description: "When and how orders can be cancelled on Kisan4U, and how refunds are processed.",
};

export default function CancellationPolicyPage() {
  return <LegalDocView slug="cancellation-policy" />;
}
