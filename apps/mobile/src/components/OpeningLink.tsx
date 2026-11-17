import { View } from "react-native";
import { AppText, Screen } from "@/components/ui";

export function OpeningLink({ label = "Opening…" }: { label?: string }) {
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <AppText color="secondary">{label}</AppText>
      </View>
    </Screen>
  );
}
