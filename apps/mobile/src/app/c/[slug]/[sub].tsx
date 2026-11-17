import { useLocalSearchParams } from "expo-router";
import { CategoryLinkBridge } from "@/components/deep-links/CategoryLinkBridge";

export default function SubcategoryDeepLink() {
  const params = useLocalSearchParams<{ slug: string; sub: string }>();
  return <CategoryLinkBridge slug={params.slug} sub={params.sub} />;
}
