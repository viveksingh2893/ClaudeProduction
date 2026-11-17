import { router, useLocalSearchParams } from "expo-router";
import { OpeningLink } from "@/components/OpeningLink";
import { useDeepLinkBridge } from "@/hooks/use-deep-link-bridge";
import { resolveCustomerProductById } from "@/lib/api/catalog";

/** Public dealer-product App Link bridge. */
export default function DealerProductDeepLinkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useDeepLinkBridge(async ({ status, user, isGuest, ensureGuest }) => {
    const cleanId = (id ?? "").trim();
    if (!cleanId) {
      router.replace("/(app)/(tabs)");
      return;
    }

    const openedUnauthenticated = status === "unauthenticated";
    if (openedUnauthenticated && !(await ensureGuest())) return;
    if (!openedUnauthenticated && user?.role === "DEALER") {
      router.replace({ pathname: "/(app)/dealer-product/[id]", params: { id: cleanId } });
      return;
    }

    const resolved = await resolveCustomerProductById(cleanId);
    if (resolved.ok) {
      router.replace({
        pathname: "/(app)/product/[slug]",
        params: { slug: resolved.data.slug },
      });
      return;
    }

    if (resolved.error.code === "NOT_FOUND") {
      if (openedUnauthenticated || isGuest) {
        router.replace("/(auth)/dealer-register");
      } else {
        router.replace("/(app)/become-dealer");
      }
      return;
    }

    router.replace("/(app)/(tabs)");
  });

  return <OpeningLink label="Opening product…" />;
}
