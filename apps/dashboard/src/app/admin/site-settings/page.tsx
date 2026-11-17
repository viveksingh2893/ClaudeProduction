import { getSiteSettings } from "@kisan4u/catalog";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { SiteSettingsManager } from "./site-settings-manager";

export default async function AdminSiteSettingsPage() {
  await requireSession(["ADMIN"]);
  const settings = await getSiteSettings();

  return (
    <PageContainer maxWidth="760px" className="py-8">
      <PageHeader
        title="Site settings"
        description="Global feature toggles and footer configuration consumed by the storefront (Product Card Design Spec §Admin Panel Controls)."
      />
      <SiteSettingsManager settings={settings} />
    </PageContainer>
  );
}
