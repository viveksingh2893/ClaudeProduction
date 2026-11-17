import { router } from "expo-router";
import { OpeningLink } from "@/components/OpeningLink";
import { useDeepLinkBridge } from "@/hooks/use-deep-link-bridge";
import { getCatalogueTag } from "@/lib/api/catalog";

export function TagLinkBridge({ kind, slug }: { kind: "crop" | "pest-disease"; slug?: string }) {
  useDeepLinkBridge(async ({ ensureGuest }) => {
    if (!(await ensureGuest())) return;
    const cleanSlug = slug?.trim();
    if (!cleanSlug) return router.replace("/(app)/(tabs)");
    const result = await getCatalogueTag(kind, cleanSlug);
    if (!result.ok) return router.replace("/(app)/(tabs)");
    router.replace({
      pathname: kind === "crop" ? "/(app)/crop/[slug]" : "/(app)/pest-disease/[slug]",
      params: { slug: cleanSlug, name: result.data.tag.name },
    } as never);
  });
  return <OpeningLink label="Opening products…" />;
}
