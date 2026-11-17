import { useLocalSearchParams } from "expo-router";
import { CategoryLinkBridge } from "@/components/deep-links/CategoryLinkBridge";

export default function SubSubcategoryDeepLink() {
  const params = useLocalSearchParams<{ slug: string; sub: string; subsub: string }>();
  return <CategoryLinkBridge slug={params.slug} sub={params.sub} subsub={params.subsub} />;
}
