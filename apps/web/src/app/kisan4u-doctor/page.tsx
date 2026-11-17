import type { Metadata } from "next";
import { PageContainer } from "@kisan4u/ui";
import { getT } from "@/i18n/server";

export const metadata: Metadata = {
  title: "Kisan4U Doctor | Kisan4U",
  description: "Kisan4U Doctor is coming soon.",
};

export default async function Kisan4uDoctorPage() {
  const { t } = await getT();

  return (
    <PageContainer maxWidth="640px" className="py-16 sm:py-24">
      <div className="flex flex-col items-center rounded-3xl border border-black/5 bg-gradient-to-b from-green-50 to-white px-6 py-14 text-center shadow-sm sm:px-12">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white text-5xl shadow-md">
          <span role="img" aria-hidden="true">
            🩺
          </span>
        </div>

        <span className="mt-6 inline-flex items-center rounded-full bg-green-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
          {t("nav.comingSoon")}
        </span>

        <h1 className="mt-5 text-2xl font-bold text-ink sm:text-3xl">{t("doctorPage.title")}</h1>
        <p className="mt-3 text-sm text-gray-500 sm:text-base">{t("doctorPage.subtitle")}</p>
      </div>
    </PageContainer>
  );
}
