import { useLocalSearchParams } from "expo-router";
import { TagLinkBridge } from "@/components/deep-links/TagLinkBridge";

export default function PestDiseaseDeepLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <TagLinkBridge kind="pest-disease" slug={slug} />;
}
