import { router } from "expo-router";
import { OpeningLink } from "@/components/OpeningLink";
import { useDeepLinkBridge } from "@/hooks/use-deep-link-bridge";

export default function DealerRegistrationDeepLink() {
  useDeepLinkBridge(({ status, user, isGuest }) => {
    if (status === "unauthenticated" || isGuest) {
      router.replace("/(auth)/dealer-register");
    } else if (user?.role === "CUSTOMER") {
      router.replace("/(app)/become-dealer");
    } else {
      router.replace("/(app)/(tabs)");
    }
  });
  return <OpeningLink label="Opening dealer registration…" />;
}
