import type { Metadata } from "next";
import { LegalDocView } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "About Us | Kisan4U",
  description:
    "Kisan4U is a multi-seller marketplace for agricultural inputs, connecting dealers, sellers, and farmers across India.",
};

export default function AboutPage() {
  return <LegalDocView slug="about" />;
}
