import type { Metadata } from "next";
import { LegalDocView } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms & Conditions | Kisan4U",
  description:
    "The terms and conditions that govern your use of the Kisan4U e-commerce website and mobile application.",
};

export default function TermsPage() {
  return <LegalDocView slug="terms" />;
}
