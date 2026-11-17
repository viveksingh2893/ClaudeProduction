import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Percent, Package, Wallet, Truck, FileText, Headphones } from "lucide-react";
import { PageContainer } from "@kisan4u/ui";
import { auth } from "@/auth";

const BENEFITS = [
  {
    icon: Percent,
    title: "Bulk & Wholesale Pricing",
    description:
      "Access dealer-only pricing tiers across categories, separate from retail customer prices — the more you order, the more you save.",
  },
  {
    icon: Package,
    title: "Dedicated Dealer Catalog",
    description:
      "Browse products, variants and stock specifically opened up for dealer accounts, sized for business quantities.",
  },
  {
    icon: Wallet,
    title: "Flexible Payment Options",
    description:
      "Pay online in full, in advance instalments, or Cash on Delivery — whatever suits your order size and cash flow.",
  },
  {
    icon: Truck,
    title: "Reliable Bulk Logistics",
    description:
      "Ship via Kisan4U Courier or arrange your own transport partner for large, business-scale orders.",
  },
  {
    icon: FileText,
    title: "GST-Compliant Invoicing",
    description:
      "Every dealer order comes with a proper tax invoice, so your purchases are ready for your business records.",
  },
  {
    icon: Headphones,
    title: "Priority Dealer Support",
    description:
      "A dedicated support line to help with orders, pricing, and account questions — before and after you sign up.",
  },
] as const;

const STEPS = [
  {
    step: "1",
    title: "Verify your mobile number",
    description: "Enter your number and confirm it with a one-time OTP — no password to remember.",
  },
  {
    step: "2",
    title: "Submit business & KYC details",
    description: "Add your store details and upload your GST and license documents for review.",
  },
  {
    step: "3",
    title: "Get approved & start ordering",
    description:
      "Once an admin approves your application, dealer pricing unlocks across the catalogue.",
  },
] as const;

export default async function DealerLandingPage() {
  // An already-approved dealer has no use for the "become a dealer" pitch.
  const session = await auth();
  if (session?.user?.role === "DEALER") {
    redirect("/dealer/products");
  }

  return (
    <div className="flex flex-col">
      {/* Green header: this page's hero — two CTAs, matching the gradient
          already used for the "Become a Dealer" homepage promo card
          (join-dealer-seller.tsx) so the two never feel like different
          products. */}
      <section className="bg-gradient-to-br from-green-800 to-green-600 px-4 py-16 text-white sm:px-6 sm:py-20 lg:px-8">
        <PageContainer maxWidth="1000px" className="flex flex-col items-center gap-5 text-center">
          <span className="rounded-full bg-white/15 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-earth-100">
            For Businesses &amp; Bulk Buyers
          </span>
          <h1 className="text-3xl font-extrabold leading-tight sm:text-[42px]">
            Become a Kisan4U Dealer
          </h1>
          <p className="max-w-[560px] text-[15px] leading-relaxed text-white/90 sm:text-base">
            Unlock wholesale pricing, a dedicated business catalogue, and reliable bulk logistics —
            built for dealers who buy at scale, backed by the same Kisan4U network trusted by
            customers nationwide.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register/dealer"
              className="inline-flex items-center gap-2 rounded-md bg-white px-6 py-3.5 text-[15px] font-bold text-green-800 transition-colors hover:bg-green-50"
            >
              Register as a Dealer
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </PageContainer>
      </section>

      {/* Benefits grid */}
      <section className="px-4 py-14 sm:px-6 lg:px-8">
        <PageContainer maxWidth="1400px">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-extrabold text-green-800 sm:text-[28px]">
              Why buy through Kisan4U as a Dealer?
            </h2>
            <p className="mx-auto mt-2 max-w-[560px] text-sm text-gray-600">
              Everything a business buyer needs, on the same platform customers already trust.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map((benefit) => (
              <div
                key={benefit.title}
                className="rounded-2xl border border-border bg-surface p-6 shadow-card"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-earth-500 to-earth-700 text-white">
                  <benefit.icon className="h-6 w-6" aria-hidden="true" />
                </div>
                <h3 className="mb-1.5 text-[15px] font-bold text-ink">{benefit.title}</h3>
                <p className="text-[13.5px] leading-relaxed text-gray-600">{benefit.description}</p>
              </div>
            ))}
          </div>
        </PageContainer>
      </section>

      {/* How it works */}
      <section className="bg-green-50 px-4 py-14 sm:px-6 lg:px-8">
        <PageContainer maxWidth="1400px">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-extrabold text-green-800 sm:text-[28px]">
              How dealer registration works
            </h2>
            <p className="mx-auto mt-2 max-w-[560px] text-sm text-gray-600">
              Three quick steps, entirely online.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {STEPS.map((item) => (
              <div key={item.step} className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-green-700 text-lg font-extrabold text-white">
                  {item.step}
                </div>
                <h3 className="text-sm font-bold text-ink">{item.title}</h3>
                <p className="max-w-[280px] text-[13px] leading-relaxed text-gray-600">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </PageContainer>
      </section>

      {/* Final CTA band */}
      <section className="bg-gradient-to-br from-earth-700 to-earth-500 px-4 py-14 text-white sm:px-6 lg:px-8">
        <PageContainer maxWidth="700px" className="flex flex-col items-center gap-4 text-center">
          <h2 className="text-2xl font-extrabold sm:text-[28px]">
            Ready to grow your business with Kisan4U?
          </h2>
          <p className="text-sm text-white/90 sm:text-[15px]">
            Registration takes a few minutes — your application is typically reviewed within a
            couple of business days.
          </p>
          <Link
            href="/register/dealer"
            className="mt-1 inline-flex items-center gap-2 rounded-md bg-white px-6 py-3.5 text-[15px] font-bold text-earth-700 transition-colors hover:bg-earth-100"
          >
            Register as a Dealer
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <p className="mt-1 text-sm text-white/80">
            Already a dealer?{" "}
            <Link href="/dealer/otp" className="font-bold text-white hover:underline">
              Log in here
            </Link>
            .
          </p>
        </PageContainer>
      </section>
    </div>
  );
}
