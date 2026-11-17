import { router } from "expo-router";
import { OpeningLink } from "@/components/OpeningLink";
import { useDeepLinkBridge } from "@/hooks/use-deep-link-bridge";
import { savePendingRedirect } from "@/lib/pending-redirect";

const DESTINATION = "/(app)/more/business-associate";

export default function BusinessAssociateDeepLink() {
  useDeepLinkBridge(async ({ status, user, isGuest }) => {
    if (status === "unauthenticated" || isGuest) {
      await savePendingRedirect(DESTINATION);
      router.replace({ pathname: "/(auth)/customer-login", params: { next: DESTINATION } });
      return;
    }
    if (user?.role === "CUSTOMER" || user?.role === "DEALER") {
      router.replace(DESTINATION);
      return;
    }
    router.replace("/(app)/(tabs)");
  });
  return <OpeningLink label="Opening Business Associate…" />;
}
