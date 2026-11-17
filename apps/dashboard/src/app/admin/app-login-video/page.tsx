import { getSiteSettings } from "@kisan4u/catalog";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { AppLoginVideoManager } from "./app-login-video-manager";

/**
 * Sets SiteSettings.loginVideoUrl — the silent, looping clip the Kisan4U
 * mobile app plays behind its login screen. Read by the app through
 * /api/mobile/v1/site-settings.
 */
export default async function AdminAppLoginVideoPage() {
  await requireSession(["ADMIN"]);
  const settings = await getSiteSettings();

  return (
    <PageContainer className="py-8" maxWidth="800px">
      <PageHeader title="App login video" />
      <AppLoginVideoManager
        currentUrl={settings.loginVideoUrl ?? null}
        storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
      />
    </PageContainer>
  );
}
