import { PageContainer } from "@kisan4u/ui";

/**
 * Complete Design/Admin Spec §7.2: "wording is hardcoded so trust claims
 * cannot be changed casually" — admin may only enable/disable this whole
 * block (via HomepageSection.enabled), never edit the 4 items themselves.
 */
const BENEFITS = [
  { title: "Verified Sellers", desc: "Products from approved marketplace sellers." },
  { title: "Dealer & Bulk Pricing", desc: "Special pricing and quantities for approved dealers." },
  {
    title: "Reliable Delivery & Tracking",
    desc: "Transparent delivery options with order updates.",
  },
  {
    title: "Dedicated Customer Support",
    desc: "Help with products, orders, returns and reorders.",
  },
];

export function TrustStrip() {
  return (
    <section className="px-4 py-8 sm:px-6 lg:px-8">
      <PageContainer maxWidth="1400px">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {BENEFITS.map((item) => (
            <div key={item.title} className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-green-700 text-lg font-extrabold text-white">
                {item.title.charAt(0)}
              </div>
              <div className="text-sm font-bold text-ink">{item.title}</div>
              <p className="text-[13px] leading-relaxed text-gray-600">{item.desc}</p>
            </div>
          ))}
        </div>
      </PageContainer>
    </section>
  );
}
