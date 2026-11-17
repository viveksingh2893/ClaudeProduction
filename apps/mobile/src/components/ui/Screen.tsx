import { StyleSheet, View, type ViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/use-theme";

/**
 * Standard screen wrapper — safe-area aware (notches, gesture bars, the
 * Android 3-button navigation bar) so no screen has to remember this
 * individually. Android is always edge-to-edge (Expo SDK 57), so the
 * default now includes "bottom" — the tab screens, which float their own
 * pill nav bar over an edge-to-edge scene, pass `edges` explicitly to opt
 * out of the bottom inset.
 */
export function Screen({ style, edges, ...rest }: ViewProps & { edges?: ("top" | "bottom" | "left" | "right")[] }) {
  const theme = useTheme();
  return (
    <SafeAreaView
      edges={edges ?? ["top", "left", "right", "bottom"]}
      style={[styles.flex, { backgroundColor: theme.background }]}
    >
      <View style={[styles.flex, style]} {...rest} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
