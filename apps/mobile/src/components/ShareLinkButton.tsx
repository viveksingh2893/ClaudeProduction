import { Share } from "react-native";
import { Button } from "@/components/ui";

export function ShareLinkButton({ title, url }: { title: string; url: string }) {
  return (
    <Button
      label="Share"
      variant="outline"
      onPress={() => Share.share({ title, message: `${title}\n${url}`, url }).catch(() => {})}
    />
  );
}
