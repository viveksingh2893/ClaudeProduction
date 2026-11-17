import type { Metadata } from "next";
import { LegalDocView } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy | Kisan4U",
  description:
    "How Kisan4U collects, uses, discloses, and safeguards your information when you use our website and services.",
};

export default function PrivacyPage() {
  return <LegalDocView slug="privacy" />;
}
