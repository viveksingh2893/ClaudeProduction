import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

/**
 * Flat-config-native equivalent of `next/core-web-vitals` + `next/typescript`,
 * built directly from the underlying plugins instead of routing through
 * eslint-config-next's legacy eslintrc bridge.
 *
 * That bridge (via @eslint/eslintrc's FlatCompat) pulls in
 * @rushstack/eslint-patch, which throws "Failed to patch ESLint because
 * the calling module was not recognized" under pnpm's node_modules
 * layout with current ESLint 9.x — a known upstream incompatibility, not
 * a config mistake here. Revisit switching back to eslint-config-next
 * directly once that's fixed.
 */
export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
      "@next/next": nextPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  {
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // next-env.d.ts is auto-generated/managed by Next.js itself (its own
    // header says not to edit it) and uses a triple-slash reference by
    // design — not something we should lint.
    ignores: ["dist/**", ".next/**", "node_modules/**", "generated/**", "next-env.d.ts"],
  },
];
