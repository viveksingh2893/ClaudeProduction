import { useLocalSearchParams } from "expo-router";
import { CategoryLinkBridge } from "@/components/deep-links/CategoryLinkBridge";

export default function CategoryDeepLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <CategoryLinkBridge slug={slug} />;
}
