import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isPublicMobileRoute } from "./mobile-route-policy";

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

test("every mobile route is public by policy or keeps a live route-level auth guard", async () => {
  const root = path.join(process.cwd(), "src", "app", "api", "mobile", "v1");
  const unguarded: string[] = [];
  for (const file of await routeFiles(root)) {
    const relative = path.relative(root, path.dirname(file)).split(path.sep).join("/");
    const pathname = `/api/mobile/v1/${relative}`.replace(/\/$/, "");
    if (isPublicMobileRoute(pathname)) continue;
    const source = await readFile(file, "utf8");
    if (!/requireMobile(Auth|BuyerContext|ApprovedDealer|ApprovedSeller)\s*\(/.test(source)) {
      unguarded.push(pathname);
    }
  }
  assert.deepEqual(
    unguarded,
    [],
    `Protected mobile routes missing a route-level guard: ${unguarded.join(", ")}`,
  );
});
