import { useLocalSearchParams } from "expo-router";
import { TagLinkBridge } from "@/components/deep-links/TagLinkBridge";

export default function CropDeepLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <TagLinkBridge kind="crop" slug={slug} />;
}
