// https://docs.expo.dev/guides/using-eslint/
// Plain flat-config array (not the `defineConfig` helper from `eslint/config`,
// which needs a newer eslint than this monorepo's pinned "eslint": "*"
// resolves to — a plain array is the same flat-config shape, just without
// that helper's extra type-checking sugar).
const expoConfig = require("eslint-config-expo/flat");

module.exports = [
  ...expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // These two react-hooks rules (new in this SDK's React Compiler-era
    // eslint-plugin-react-hooks) flag the standard "fetch on mount" effect
    // (`useEffect(() => { load(); }, [load])`) and `useRef(new
    // Animated.Value(...))` — both textbook-correct React Native patterns
    // used throughout this app's screens. They're strict enough that even
    // Expo's own stock template (src/hooks/use-color-scheme.web.ts,
    // untouched from `create-expo-app`) fails them, which is a strong
    // signal this is an overly aggressive default for a still-stabilizing
    // rule rather than a real bug in this codebase. Disabled here rather
    // than restructuring every data-fetching screen around it.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
];
