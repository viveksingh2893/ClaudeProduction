import { StyleSheet, View, type ViewProps } from "react-native";
import { BlurView } from "expo-blur";
import { useTheme } from "@/hooks/use-theme";

/**
 * Frosted "liquid glass" panel matched to the Kisan4U green theme — a blur
 * layer under a soft white scrim and a faint mint tint, finished with a
 * bright hairline highlight on one edge so it reads as a pane of glass.
 * Degrades to a translucent tinted surface where the platform blur is
 * unavailable (older Android), so it never looks broken.
 *
 * Used by the bottom tab bar, the top chrome (header + category ribbon)
 * and the search pill so they all feel like one material.
 */
export function GlassSurface({
  intensity = 34,
  edge = "top",
  scrimOpacity = 0.6,
  style,
  children,
  ...rest
}: ViewProps & {
  intensity?: number;
  /** Which edge gets the bright glass highlight line. */
  edge?: "top" | "bottom" | "none";
  /** 0–1 opacity of the white frosting scrim. Lower = more see-through. */
  scrimOpacity?: number;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.root, style]} {...rest}>
      <BlurView
        intensity={intensity}
        tint="light"
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(255,255,255,${scrimOpacity})` }]}
        pointerEvents="none"
      />
      <View
        style={[StyleSheet.absoluteFill, styles.tint, { backgroundColor: theme.green100 }]}
        pointerEvents="none"
      />
      {edge !== "none" ? (
        <View
          style={[styles.edge, edge === "top" ? styles.edgeTop : styles.edgeBottom]}
          pointerEvents="none"
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: "hidden" },
  scrim: { backgroundColor: "rgba(255,255,255,0.60)" },
  tint: { opacity: 0.22 },
  edge: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.85)",
  },
  edgeTop: { top: 0 },
  edgeBottom: { bottom: 0 },
});
