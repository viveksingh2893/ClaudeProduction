import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Regression guard for the root-cause finding this session: previous
 * "fix the theme" passes changed constants/theme.ts but individual
 * screens/components kept their own hardcoded hex colors, which silently
 * overrode the tokens. This scans every .ts/.tsx file under src for a hex
 * color literal and fails if anything new shows up outside the
 * documented, intentional exceptions below — so a future stray
 * `"#023c69"` (or similar) gets caught at test time instead of only
 * being noticed by eye in a built APK for the fourth time.
 */

const SRC_DIR = join(__dirname, "..");
const HEX_PATTERN = /#[0-9A-Fa-f]{3,8}\b/g;

// file (relative to src/) -> allowed hex literals in that file, with why.
const ALLOWED: Record<string, { hex: string; reason: string }[]> = {
  "constants/theme.ts": [{ hex: "*", reason: "the token definitions themselves" }],
  "components/ui/AppText.tsx": [
    { hex: "#FFFFFF", reason: "literal white text color — doesn't flip in dark mode by design" },
  ],
  "components/ui/Button.tsx": [
    { hex: "#FFFFFF", reason: "ActivityIndicator spinner color on filled button variants" },
  ],
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".expo") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

test("no hardcoded hex colors outside the theme tokens and documented exceptions", () => {
  const files = walk(SRC_DIR);
  const violations: string[] = [];

  for (const file of files) {
    const relPath = relative(SRC_DIR, file).replace(/\\/g, "/");
    const allowedForFile = ALLOWED[relPath];
    if (allowedForFile?.some((a) => a.hex === "*")) continue;

    const content = readFileSync(file, "utf-8");
    const matches = content.match(HEX_PATTERN);
    if (!matches) continue;

    for (const hex of matches) {
      const isAllowed = allowedForFile?.some((a) => a.hex.toLowerCase() === hex.toLowerCase());
      if (!isAllowed) violations.push(`${relPath}: ${hex}`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Hardcoded hex color(s) found outside theme tokens — use useTheme() instead:\n${violations.join("\n")}`,
  );
});
