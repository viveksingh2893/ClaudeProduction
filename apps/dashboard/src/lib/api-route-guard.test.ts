import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function routeFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(root, entry.name);
      return entry.isDirectory()
        ? routeFiles(target)
        : Promise.resolve(entry.name === "route.ts" ? [target] : []);
    }),
  );
  return nested.flat();
}

test("every centrally protected dashboard API keeps its route-level authorization guard", async () => {
  const apiRoot = fileURLToPath(new URL("../app/api", import.meta.url));
  const protectedRoots = ["admin", "seller", "pos", "payment-verification", "seller-licences"];
  const unguarded: string[] = [];
  for (const name of protectedRoots) {
    for (const file of await routeFiles(path.join(apiRoot, name))) {
      const source = await readFile(file, "utf8");
      if (
        !/require(Session|ApprovedSeller|OrdersSectionView|PaymentVerificationAccess|PosAccess|SettlementsView)\s*\(/.test(
          source,
        )
      ) {
        unguarded.push(path.relative(apiRoot, file).split(path.sep).join("/"));
      }
    }
  }
  assert.deepEqual(
    unguarded,
    [],
    `Dashboard API routes missing a route-level guard: ${unguarded.join(", ")}`,
  );
});
