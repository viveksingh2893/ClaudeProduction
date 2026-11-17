import js from "@eslint/js";

/**
 * Minimal shared flat-config base for plain TypeScript packages
 * (packages/db, packages/providers, packages/validators, packages/ui).
 * Next.js apps layer this under next/core-web-vitals + next/typescript
 * via eslint-config-next — see each app's eslint.config.mjs (apps/web,
 * apps/dashboard).
 */
export default [
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: ["dist/**", ".next/**", "node_modules/**", "generated/**"],
  },
];
