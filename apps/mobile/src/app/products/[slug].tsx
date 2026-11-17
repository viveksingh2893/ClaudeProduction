import { router, useLocalSearchParams } from "expo-router";
import { OpeningLink } from "@/components/OpeningLink";
import { useDeepLinkBridge } from "@/hooks/use-deep-link-bridge";

/** Public customer-product App Link bridge. */
export default function CustomerProductDeepLinkScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  useDeepLinkBridge(async ({ ensureGuest }) => {
    const cleanSlug = (slug ?? "").trim();
    if (!cleanSlug) {
      router.replace("/(app)/(tabs)");
      return;
    }
    if (!(await ensureGuest())) return;
    router.replace({ pathname: "/(app)/product/[slug]", params: { slug: cleanSlug } });
  });

  return <OpeningLink label="Opening product…" />;
}
