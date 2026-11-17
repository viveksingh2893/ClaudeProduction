/**
 * Moves legacy public KYC documents to private storage and replaces public
 * /api/uploads/... references with opaque storage keys. Dry-run is the
 * default; pass --apply to copy, update the database, then remove sources.
 */
import "dotenv/config";
import { copyFile, mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, prisma } from "../src/index";

const apply = process.argv.includes("--apply");
const allowMissing = process.argv.includes("--allow-missing");
const verbose = process.argv.includes("--verbose");
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageDir, "../..");
const publicRoot = path.resolve(
  process.env.UPLOAD_STORAGE_ROOT ?? path.join(repoRoot, "apps/web/storage/uploads"),
);
const privateRoot = path.resolve(
  process.env.PRIVATE_LICENCE_UPLOAD_ROOT ??
    path.join(repoRoot, "apps/dashboard/storage/private-licences"),
);

function toStorageKey(value: string): string | null {
  let pathname = value;
  try {
    if (/^https?:\/\//i.test(value)) pathname = new URL(value).pathname;
  } catch {
    return null;
  }
  const match = /^\/api\/uploads\/(dealer-documents|ba-documents|seller-documents)\/(.+)$/i.exec(
    pathname,
  );
  if (!match || match[2]!.includes("..") || match[2]!.includes("\\")) return null;
  return `${match[1]!.toLowerCase()}/${match[2]}`;
}

function rewriteJson(
  value: Prisma.JsonValue,
  migrated: Map<string, string>,
): Prisma.InputJsonValue {
  if (typeof value === "string") return migrated.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => rewriteJson(item, migrated));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewriteJson(item, migrated)]),
    );
  }
  return value as Prisma.InputJsonValue;
}

async function main() {
  const [dealers, sellers, associates, deliveryPeople] = await Promise.all([
    prisma.dealerProfile.findMany({
      select: {
        id: true,
        gstDocUrl: true,
        licenseDocUrl: true,
        additionalDocuments: true,
        pendingChanges: true,
      },
    }),
    prisma.sellerProfile.findMany({ select: { id: true, gstDocUrl: true, panDocUrl: true } }),
    prisma.businessAssociateProfile.findMany({
      select: { id: true, panDocKey: true, chequeDocKey: true },
    }),
    prisma.deliveryManProfile.findMany({ select: { id: true, identityDocUrl: true } }),
  ]);

  const references = new Set<string>();
  const collect = (value: unknown) => {
    if (typeof value === "string") {
      if (toStorageKey(value)) references.add(value);
    } else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  [...dealers, ...sellers, ...associates, ...deliveryPeople].forEach(collect);

  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${references.size} public KYC file reference(s)`);
  console.log(`Public root:  ${publicRoot}`);
  console.log(`Private root: ${privateRoot}`);

  const migrated = new Map<string, string>();
  const missing: string[] = [];
  let sourcesFound = 0;
  let alreadyPrivate = 0;
  for (const reference of references) {
    const storageKey = toStorageKey(reference)!;
    const source = path.resolve(publicRoot, storageKey);
    const destination = path.resolve(privateRoot, storageKey);
    if (
      !source.startsWith(`${publicRoot}${path.sep}`) ||
      !destination.startsWith(`${privateRoot}${path.sep}`)
    ) {
      console.warn(`SKIP unsafe path: ${reference}`);
      continue;
    }
    try {
      await stat(source);
    } catch {
      try {
        await stat(destination);
        if (verbose) console.log(`ALREADY PRIVATE ${reference} -> ${storageKey}`);
        alreadyPrivate += 1;
        migrated.set(reference, storageKey);
      } catch {
        missing.push(source);
      }
      continue;
    }
    sourcesFound += 1;
    if (verbose) console.log(`${apply ? "COPY" : "WOULD COPY"} ${source} -> ${destination}`);
    if (apply) {
      await mkdir(path.dirname(destination), { recursive: true });
      try {
        await stat(destination);
      } catch {
        await copyFile(source, destination);
      }
    }
    migrated.set(reference, storageKey);
  }

  console.log(`Found in public storage: ${sourcesFound}`);
  console.log(`Already in private storage: ${alreadyPrivate}`);
  console.log(`Missing from both roots: ${missing.length}`);
  if (missing.length > 0) {
    for (const source of missing.slice(0, 20)) console.warn(`MISSING ${source}`);
    if (missing.length > 20)
      console.warn(
        `...and ${missing.length - 20} more (use --verbose only after fixing the roots).`,
      );
  }

  if (!apply) {
    console.log("Dry run complete. Re-run with --apply after reviewing the paths above.");
    return;
  }
  if (missing.length > 0 && !allowMissing) {
    throw new Error(
      "Refusing to apply with missing files. Correct the storage roots or re-run with --allow-missing for references that were already broken.",
    );
  }

  await prisma.$transaction(async (tx) => {
    for (const row of dealers) {
      await tx.dealerProfile.update({
        where: { id: row.id },
        data: {
          gstDocUrl: row.gstDocUrl ? (migrated.get(row.gstDocUrl) ?? row.gstDocUrl) : null,
          licenseDocUrl: row.licenseDocUrl
            ? (migrated.get(row.licenseDocUrl) ?? row.licenseDocUrl)
            : null,
          additionalDocuments: row.additionalDocuments
            ? rewriteJson(row.additionalDocuments, migrated)
            : undefined,
          pendingChanges: row.pendingChanges
            ? rewriteJson(row.pendingChanges, migrated)
            : undefined,
        },
      });
    }
    for (const row of sellers) {
      await tx.sellerProfile.update({
        where: { id: row.id },
        data: {
          gstDocUrl: row.gstDocUrl ? (migrated.get(row.gstDocUrl) ?? row.gstDocUrl) : null,
          panDocUrl: row.panDocUrl ? (migrated.get(row.panDocUrl) ?? row.panDocUrl) : null,
        },
      });
    }
    for (const row of associates) {
      await tx.businessAssociateProfile.update({
        where: { id: row.id },
        data: {
          panDocKey: row.panDocKey ? (migrated.get(row.panDocKey) ?? row.panDocKey) : null,
          chequeDocKey: row.chequeDocKey
            ? (migrated.get(row.chequeDocKey) ?? row.chequeDocKey)
            : null,
        },
      });
    }
    for (const row of deliveryPeople) {
      await tx.deliveryManProfile.update({
        where: { id: row.id },
        data: {
          identityDocUrl: row.identityDocUrl
            ? (migrated.get(row.identityDocUrl) ?? row.identityDocUrl)
            : null,
        },
      });
    }
  }, { maxWait: 60_000, timeout: 15 * 60_000 }); // thousands of rows; default 5s times out

  for (const [reference, storageKey] of migrated) {
    const source = path.resolve(publicRoot, storageKey);
    await unlink(source).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT")
        console.warn(`Could not remove source for ${reference}: ${error.message}`);
    });
  }
  console.log(`Migration complete: ${migrated.size} reference(s) made private.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
