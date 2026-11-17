/**
 * Kisan4U brand tokens for the mobile app — the sRGB equivalents of the
 * OKLCH values in packages/ui/src/styles/tokens.css (the website/admin's
 * single source of truth). React Native can't do oklch(), so each token is
 * converted (oklch → OKLab → linear sRGB → sRGB) once here. The light
 * palette below is a 1:1 match of the web tokens — keep it that way when
 * tokens.css changes.
 */
import { Platform } from "react-native";

export const Colors = {
  light: {
    ink: "#151D15",
    textSecondary: "#525752", // --color-gray-600
    surface: "#FCFCFA",
    background: "#F9F9F4", // --color-bg
    backgroundElement: "#EFF8EF", // --color-green-50, web's subtle element fill
    border: "#D9E0D9",

    green900: "#082C0C",
    green800: "#0E4114",
    green700: "#15561D",
    green600: "#286F2F",
    green500: "#3B8841",
    green100: "#DFF1DF",
    green50: "#EFF8EF",

    earth700: "#7B461E",
    earth600: "#94582A",
    earth500: "#B26D3A",
    earth100: "#F8E4D4",

    gold: "#CA9D33",

    success: "#286F2F",
    successBg: "#DFF1DF",
    warning: "#AE6800",
    warningBg: "#FEE3C5",
    danger: "#A8372A",
    dangerBg: "#FFE0D8",
    info: "#00678B",
    infoBg: "#D8F0FC",

    /** Content colour on a solid green surface (the utility ribbon, green CTAs) — white in both schemes. */
    onGreen: "#FFFFFF",

    tint: "#15561D", // = green700
  },
  dark: {
    ink: "#EAF0E9",
    textSecondary: "#AAB6AA",
    surface: "#182019",
    background: "#10140F",
    backgroundElement: "#1E271C",
    border: "#2C382A",

    green900: "#B7E0C0",
    green800: "#9ED2AA",
    green700: "#7FC392",
    green600: "#5FAE76",
    green500: "#4E9963",
    green100: "#213A28",
    green50: "#1A2E20",

    earth700: "#E0B47C",
    earth600: "#D3A268",
    earth500: "#C08F52",
    earth100: "#3A2C18",

    gold: "#E8C177",

    success: "#5FAE76",
    successBg: "#213A28",
    warning: "#E0A45C",
    warningBg: "#3A2C15",
    danger: "#E17A65",
    dangerBg: "#3A211C",
    info: "#7AAEDD",
    infoBg: "#1C2C3A",

    onGreen: "#FFFFFF",

    tint: "#5FAE76",
  },
} as const;

export type ThemeColors = typeof Colors.light;
export type ThemeColorName = keyof ThemeColors;

/**
 * App-wide colour scheme switch. The Kisan4U web storefront is light-only,
 * so the app matches it: `"light"` forces the light palette regardless of
 * the device setting. Set to `null` to follow the device again (and enable
 * the dark palette above), or `"dark"` to force dark. This is the single
 * place that decides — every screen reads it through `useColorScheme()`.
 */
export const APP_COLOR_SCHEME: "light" | "dark" | null = "light";

export const Radius = { xs: 5, sm: 7, md: 8, lg: 12, xl: 16, pill: 999 } as const;

export const Spacing = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32 } as const;

/**
 * Bottom padding a tab screen's scroll content needs so its last row can
 * be scrolled clear of the floating bottom-nav pill (height 64 + 14 gap +
 * a little breathing room). Add `useSafeAreaInsets().bottom` on top of it.
 * The tab bar itself is absolutely positioned and the scene is
 * transparent, so content still renders/scrolls *behind* the pill —
 * this only keeps the final row reachable.
 */
export const TAB_BAR_SCENE_INSET = 90;

export const FontFamily = Platform.select({
  ios: { sans: "System", semibold: "System" },
  android: { sans: "sans-serif", semibold: "sans-serif-medium" },
  default: { sans: "System", semibold: "System" },
})!;

/** Minimum touch target per the mobile design requirements (44-48dp). */
export const MinTouchTarget = 48;
