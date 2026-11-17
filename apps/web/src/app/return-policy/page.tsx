import type { Metadata } from "next";
import { LegalDocView } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Return Policy | Kisan4U",
  description: "Eligibility, process, and timelines for returning products purchased from Kisan4U.",
};

export default function ReturnPolicyPage() {
  return <LegalDocView slug="return-policy" />;
}
