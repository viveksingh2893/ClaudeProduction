import type { Metadata } from "next";
import { LegalDocView } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Contact Us | Kisan4U",
  description: "Get in touch with the Kisan4U team — registered address, phone, and email.",
};

export default function ContactPage() {
  return <LegalDocView slug="contact" />;
}
