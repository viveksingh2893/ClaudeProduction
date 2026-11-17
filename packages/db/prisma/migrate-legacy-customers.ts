/**
 * Legacy customer migration — one-time ETL from the old Laravel/MySQL
 * `kisan4u` DB (srv603843) into this app's Postgres.
 *
 * Scope: `users` rows with isDealer=0 (both isBA=0 and isBA=1 — both
 * become plain CUSTOMER here, per the owner's decision) and their
 * non-guest `shipping_addresses`. Orders/order_details are a later
 * phase, not touched here.
 *
 * Standalone `tsx`-run script (same shape as seed.ts/seed-demo.ts): its
 * own `dotenv/config` + PrismaPg adapter, not the app's shared
 * `@kisan4u/db` client singleton — see packages/db/src/index.ts for why
 * that split exists.
 *
 * The old DB is on an unrelated server with no network route here, and
 * this script never touches it directly. Instead it reads two TSV
 * exports the operator produces themselves and transfers onto this box:
 *
 *   --users-file        (default ./legacy-export/users.tsv)
 *     Expected columns (tab-separated, header row required, any order):
 *       id, name, f_name, l_name, phone, email, is_active,
 *       is_phone_verified, is_email_verified, referral_code, referred_by,
 *       isDealer, isBA, created_at, updated_at
 *
 *   --addresses-file    (default ./legacy-export/shipping_addresses.tsv)
 *     Expected columns:
 *       id, customer_id, is_guest, contact_person_name, address_type,
 *       address, city, zip, phone, state, country, latitude, longitude,
 *       is_billing, road_name, nearby_place, created_at, updated_at
 *
 * Run with --dry-run to compute and print every report (state matches,
 * null-contact rows, would-be insert/update/skip counts) without writing
 * anything. Re-running for real is safe/idempotent: every upsert is
 * keyed by `legacyId`.
 *
 * Usage:
 *   tsx prisma/migrate-legacy-customers.ts --dry-run
 *   tsx prisma/migrate-legacy-customers.ts \
 *     --users-file ./legacy-export/users.tsv \
 *     --addresses-file ./legacy-export/shipping_addresses.tsv
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  PrismaClient,
  UserRole,
  type IndianState,
} from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { normalizeIndianPhone } from "@kisan4u/validators";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Chunk size for processBatches — purely for iterating the async work in
// slices; each row gets its own $transaction (see migrateUsers/
// migrateAddresses), so this number no longer implies any shared
// transaction boundary. Re-running is safe regardless since every write
// is an upsert by legacyId.
const BATCH_SIZE = 750;

// Where the first-seen-wins dedup report (see DuplicateContactEntry)
// gets written on a real (non-dry-run) run. Relative to cwd, same as the
// default TSV input paths — contains real customer PII, never commit it.
const DUPLICATE_REPORT_PATH = "./legacy-export/duplicate-contacts-report.json";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

type Args = { usersFile: string; addressesFile: string; dryRun: boolean };

function parseArgs(argv: string[]): Args {
  let usersFile = "./legacy-export/users.tsv";
  let addressesFile = "./legacy-export/shipping_addresses.tsv";
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--users-file") {
      usersFile = argv[++i];
    } else if (arg.startsWith("--users-file=")) {
      usersFile = arg.slice("--users-file=".length);
    } else if (arg === "--addresses-file") {
      addressesFile = argv[++i];
    } else if (arg.startsWith("--addresses-file=")) {
      addressesFile = arg.slice("--addresses-file=".length);
    }
  }
  return { usersFile, addressesFile, dryRun };
}

// ---------------------------------------------------------------------------
// TSV parsing — plain header-row TSV, no quoting/escaping support needed
// (the export is a straight `SELECT ... INTO OUTFILE`-style tab dump, not
// arbitrary user-entered CSV).
// ---------------------------------------------------------------------------

function parseTsv(path: string): Record<string, string>[] {
  const raw = readFileSync(path, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0]!.replace(/\r$/, "").split("\t");
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.replace(/\r$/, "").split("\t");
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      row[header[c]!] = cells[c] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Blank/whitespace-only cell -> undefined, everything else trimmed.
 * Also treats the literal string "NULL" (case-insensitive) as undefined —
 * the MySQL TSV export writes real SQL NULLs that way, and without this
 * every NULL-email row would otherwise collide on User.email's unique
 * constraint (they'd all import as the literal string "NULL").
 */
function cell(row: Record<string, string>, key: string): string | undefined {
  const v = row[key];
  if (v === undefined) return undefined;
  const t = v.trim();
  if (t.length === 0) return undefined;
  if (t.toUpperCase() === "NULL") return undefined;
  return t;
}

function boolCell(row: Record<string, string>, key: string): boolean {
  return cell(row, key) === "1";
}

// ---------------------------------------------------------------------------
// Name splitting — same first-space convention as the
// split_user_name_and_legacy_fields migration's SQL backfill and
// packages/auth/src/name-split.ts, duplicated here since this script runs
// standalone (tsx, not through the Next.js/packages/auth build graph).
// ---------------------------------------------------------------------------

function splitFullName(fullName: string): { firstName: string; lastName: string | null } {
  const trimmed = fullName.trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return { firstName: trimmed, lastName: null };
  return {
    firstName: trimmed.slice(0, spaceIndex),
    lastName: trimmed.slice(spaceIndex + 1).trim() || null,
  };
}

function resolveUserName(row: Record<string, string>): {
  firstName: string | null;
  lastName: string | null;
} {
  const fName = cell(row, "f_name");
  const lName = cell(row, "l_name");
  if (fName || lName) {
    return { firstName: fName ?? null, lastName: lName ?? null };
  }
  const name = cell(row, "name");
  if (name) return splitFullName(name);
  return { firstName: null, lastName: null };
}

// ---------------------------------------------------------------------------
// State normalization — match free-text old `state` values against the
// live IndianState table. Not exhaustive: prints every value it can't
// resolve so the operator can extend STATE_ALIASES or accept the gap.
// ---------------------------------------------------------------------------

/** A handful of known old-site spelling variants -> canonical name (lowercased, normalized). Not exhaustive by design (see module doc comment). */
const STATE_ALIASES: Record<string, string> = {
  orissa: "odisha",
  pondicherry: "puducherry",
  uttaranchal: "uttarakhand",
  "nct of delhi": "delhi",
  "new delhi": "delhi",
  "delhi ncr": "delhi",
};

function normalizeStateText(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildStateIndex(states: IndianState[]): Map<string, IndianState> {
  const index = new Map<string, IndianState>();
  for (const s of states) index.set(normalizeStateText(s.name), s);
  return index;
}

function matchState(rawState: string, index: Map<string, IndianState>): IndianState | null {
  const normalized = normalizeStateText(rawState);
  if (!normalized) return null;
  const aliased = STATE_ALIASES[normalized] ?? normalized;
  return index.get(aliased) ?? index.get(normalized) ?? null;
}

// ---------------------------------------------------------------------------
// Batching helper
// ---------------------------------------------------------------------------

async function processBatches<T>(
  items: T[],
  batchSize: number,
  handler: (batch: T[]) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    await handler(items.slice(i, i + batchSize));
  }
}

// ---------------------------------------------------------------------------
// Phase: users
// ---------------------------------------------------------------------------

type PreparedUser = {
  legacyId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  isPhoneVerified: boolean;
  isEmailVerified: boolean;
  referredByLegacyId: string | null;
};

/** One row per contact field nulled out because an earlier-seen row already claimed it — see DuplicateContactEntry. */
export type DuplicateContactEntry = {
  field: "email" | "phone";
  legacyId: string;
  name: string;
  originalValue: string;
  keptByLegacyId: string;
};

function prepareUsers(
  rows: Record<string, string>[],
  existingEmails: Map<string, string>,
  existingPhones: Map<string, string>,
): {
  prepared: PreparedUser[];
  skippedDealers: number;
  bothContactNull: number;
  duplicateContacts: DuplicateContactEntry[];
} {
  const prepared: PreparedUser[] = [];
  let skippedDealers = 0;
  let bothContactNull = 0;
  const duplicateContacts: DuplicateContactEntry[] = [];

  // Both User.email and User.phone are @unique. The legacy export has real
  // (not just NULL-string) duplicates of both — e.g. two different legacy
  // accounts sharing one email, or one phone. Policy (owner's decision):
  // first-seen (in file order) keeps the value; every later duplicate
  // imports with that one field set to null instead of failing the whole
  // row. Every nulled field is recorded in duplicateContacts so it can be
  // looked up later — see the report written at the end of main().
  //
  // Seeded from the DB (existingEmails/existingPhones — every email/phone
  // already in use by *any* User, legacy or not, keyed by that owner's
  // legacyId or "(pre-existing account)" when it isn't a legacy row) so a
  // re-run after a partially-completed earlier attempt treats those as
  // already claimed too, instead of only deduping within this file pass.
  const seenEmails = new Map(existingEmails); // lowercased email -> legacyId/label that owns it
  const seenPhones = new Map(existingPhones); // phone as-is -> legacyId/label that owns it

  for (const row of rows) {
    const legacyId = cell(row, "id");
    if (!legacyId) continue; // no usable primary key, can't migrate/re-run safely

    // isDealer=0 only — both isBA=0 and isBA=1 become plain CUSTOMER here,
    // per the owner's decision. Dealers/orders are a later migration phase.
    if (boolCell(row, "isDealer")) {
      skippedDealers++;
      continue;
    }

    const { firstName, lastName } = resolveUserName(row);
    const name = [firstName, lastName].filter(Boolean).join(" ") || "(no name)";
    // Normalized to the app's own canonical "+91XXXXXXXXXX" form (same
    // normalizer every real login/OTP path uses) — a bare 10-digit legacy
    // phone that isn't converted here can never be found by a real login
    // lookup, silently stranding that customer's whole account (orders,
    // addresses, everything) on an unreachable row. Confirmed real, not
    // theoretical: caught after the fact on 67,286 of 67,897 already-
    // migrated rows (the original rehearsal run predates this fix) — see
    // [[kisan4u-legacy-order-history-migration]] for the full incident and
    // how the existing rows were repaired directly.
    const rawPhone = cell(row, "phone") ?? null;
    let phone = rawPhone ? normalizeIndianPhone(rawPhone) : null;
    let email = cell(row, "email") ?? null;

    if (email) {
      const key = email.toLowerCase();
      const keptBy = seenEmails.get(key);
      // keptBy === legacyId means the DB seed found THIS row's own email
      // (a prior partial run already upserted it correctly) — not a real
      // collision, so it stays.
      if (keptBy && keptBy !== legacyId) {
        duplicateContacts.push({ field: "email", legacyId, name, originalValue: email, keptByLegacyId: keptBy });
        email = null;
      } else if (!keptBy) {
        seenEmails.set(key, legacyId);
      }
    }
    if (phone) {
      const keptBy = seenPhones.get(phone);
      if (keptBy && keptBy !== legacyId) {
        duplicateContacts.push({ field: "phone", legacyId, name, originalValue: phone, keptByLegacyId: keptBy });
        phone = null;
      } else if (!keptBy) {
        seenPhones.set(phone, legacyId);
      }
    }

    if (!phone && !email) bothContactNull++;

    prepared.push({
      legacyId,
      firstName,
      lastName,
      phone,
      email,
      isActive: cell(row, "is_active") === undefined ? true : boolCell(row, "is_active"),
      isPhoneVerified: boolCell(row, "is_phone_verified"),
      isEmailVerified: boolCell(row, "is_email_verified"),
      referredByLegacyId: cell(row, "referred_by") ?? null,
    });
  }

  return { prepared, skippedDealers, bothContactNull, duplicateContacts };
}

type UserMigrationResult = {
  inserted: number;
  updated: number;
  skipped: number;
  skippedDetails: string[];
  referralResolved: number;
  referralUnresolved: number;
};

async function migrateUsers(prepared: PreparedUser[], dryRun: boolean): Promise<UserMigrationResult> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const skippedDetails: string[] = [];

  if (dryRun) {
    // Classify insert-vs-update in bulk reads only, no writes.
    await processBatches(prepared, BATCH_SIZE, async (batch) => {
      const existing = await prisma.user.findMany({
        where: { legacyId: { in: batch.map((u) => u.legacyId) } },
        select: { legacyId: true },
      });
      const existingSet = new Set(existing.map((e) => e.legacyId));
      for (const u of batch) {
        if (existingSet.has(u.legacyId)) updated++;
        else inserted++;
      }
    });
  } else {
    // One transaction PER ROW, not per batch — a batch-wide transaction
    // means a single unique-constraint collision (or any other failure)
    // aborts every later query in that same transaction (Postgres error
    // 25P02), and the whole batch's writes — including ones that
    // succeeded before the failure — get discarded on commit. Hit this
    // for real on the first two migration attempts (a batch reporting
    // "inserted" rows that never actually persisted). processBatches is
    // still used to chunk the async work; it just no longer implies a
    // shared transaction.
    await processBatches(prepared, BATCH_SIZE, async (batch) => {
      for (const u of batch) {
        try {
          await prisma.$transaction(async (tx) => {
            const before = await tx.user.findUnique({
              where: { legacyId: u.legacyId },
              select: { id: true },
            });
            await tx.user.upsert({
              where: { legacyId: u.legacyId },
              update: {
                firstName: u.firstName,
                lastName: u.lastName,
                phone: u.phone,
                email: u.email,
                isActive: u.isActive,
                isPhoneVerified: u.isPhoneVerified,
                isEmailVerified: u.isEmailVerified,
              },
              create: {
                legacyId: u.legacyId,
                firstName: u.firstName,
                lastName: u.lastName,
                phone: u.phone,
                email: u.email,
                role: UserRole.CUSTOMER,
                referralCode: `CUS-LEGACY-${u.legacyId}`,
                isActive: u.isActive,
                isPhoneVerified: u.isPhoneVerified,
                isEmailVerified: u.isEmailVerified,
              },
            });
            if (before) updated++;
            else inserted++;
          });
        } catch (err) {
          skipped++;
          skippedDetails.push(
            `user legacyId=${u.legacyId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    });
  }

  // Pass 2: resolve referred_by -> legacyId -> new User.id. In dry-run,
  // "resolved" means the referrer's legacyId is present in THIS import
  // batch (i.e. would exist after a real run) or already in the DB — a
  // good-faith preview without requiring any writes.
  const withReferral = prepared.filter((u) => u.referredByLegacyId);
  let referralResolved = 0;
  let referralUnresolved = 0;

  if (withReferral.length > 0) {
    const candidateIds = [...new Set(prepared.map((u) => u.legacyId))];
    const dbMatches = await prisma.user.findMany({
      where: { legacyId: { in: candidateIds } },
      select: { id: true, legacyId: true },
    });
    const legacyIdToNewId = new Map(dbMatches.map((u) => [u.legacyId!, u.id]));
    // Anything in this batch not yet in the DB (dry-run, or a fresh
    // insert that just happened above) still counts as "would resolve".
    const knownLegacyIds = new Set([...legacyIdToNewId.keys(), ...prepared.map((u) => u.legacyId)]);

    await processBatches(withReferral, BATCH_SIZE, async (batch) => {
      if (dryRun) {
        for (const u of batch) {
          if (knownLegacyIds.has(u.referredByLegacyId!)) referralResolved++;
          else referralUnresolved++;
        }
        return;
      }
      for (const u of batch) {
        const referrerNewId = legacyIdToNewId.get(u.referredByLegacyId!);
        if (!referrerNewId) {
          referralUnresolved++;
          continue;
        }
        // One transaction per row — see the note on the user-upsert pass above.
        try {
          await prisma.$transaction(async (tx) => {
            const self = await tx.user.findUnique({
              where: { legacyId: u.legacyId },
              select: { id: true },
            });
            if (!self) return;
            await tx.user.update({
              where: { id: self.id },
              data: { referredById: referrerNewId },
            });
            referralResolved++;
          });
        } catch (err) {
          skippedDetails.push(
            `referral update legacyId=${u.legacyId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    });
  }

  return { inserted, updated, skipped, skippedDetails, referralResolved, referralUnresolved };
}

// ---------------------------------------------------------------------------
// Phase: addresses
// ---------------------------------------------------------------------------

type PreparedAddress = {
  legacyId: string;
  customerLegacyId: string;
  fullName: string;
  mobile: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  cityTown: string;
  rawState: string | null;
  pincode: string;
  isBilling: boolean;
  latitude: number | null;
  longitude: number | null;
  createdAt: Date | null;
};

function prepareAddresses(rows: Record<string, string>[]): {
  prepared: PreparedAddress[];
  skippedGuests: number;
} {
  const prepared: PreparedAddress[] = [];
  let skippedGuests = 0;

  for (const row of rows) {
    const legacyId = cell(row, "id");
    const customerLegacyId = cell(row, "customer_id");
    if (!legacyId || !customerLegacyId) continue;

    if (boolCell(row, "is_guest")) {
      skippedGuests++;
      continue;
    }

    const createdAtRaw = cell(row, "created_at");
    prepared.push({
      legacyId,
      customerLegacyId,
      fullName: cell(row, "contact_person_name") ?? "",
      mobile: cell(row, "phone") ?? "",
      line1: cell(row, "address") ?? "",
      line2: cell(row, "road_name") ?? null,
      landmark: cell(row, "nearby_place") ?? null,
      cityTown: cell(row, "city") ?? "",
      rawState: cell(row, "state") ?? null,
      pincode: cell(row, "zip") ?? "",
      isBilling: boolCell(row, "is_billing"),
      latitude: cell(row, "latitude") ? Number(cell(row, "latitude")) : null,
      longitude: cell(row, "longitude") ? Number(cell(row, "longitude")) : null,
      createdAt: createdAtRaw ? new Date(createdAtRaw) : null,
    });
  }

  return { prepared, skippedGuests };
}

/**
 * isDefault assignment: within each customer's migrated addresses, sort
 * [isBilling ascending (non-billing first), createdAt ascending, legacyId
 * ascending] and mark the first as default. This satisfies the spec's
 * "when a billing/non-billing duplicate pair exists, the non-billing row
 * wins the default slot" for that case, and generalizes sensibly when
 * there's no such pair (earliest non-billing address wins; earliest
 * billing address if that's all the customer has).
 */
function assignDefaults(
  addresses: Array<PreparedAddress & { newUserId: string }>,
): Map<string, boolean> {
  const byUser = new Map<string, Array<PreparedAddress & { newUserId: string }>>();
  for (const a of addresses) {
    const list = byUser.get(a.newUserId) ?? [];
    list.push(a);
    byUser.set(a.newUserId, list);
  }
  const isDefaultByLegacyId = new Map<string, boolean>();
  for (const list of byUser.values()) {
    list.sort((a, b) => {
      if (a.isBilling !== b.isBilling) return a.isBilling ? 1 : -1;
      const at = a.createdAt?.getTime() ?? 0;
      const bt = b.createdAt?.getTime() ?? 0;
      if (at !== bt) return at - bt;
      return a.legacyId.localeCompare(b.legacyId);
    });
    list.forEach((a, i) => isDefaultByLegacyId.set(a.legacyId, i === 0));
  }
  return isDefaultByLegacyId;
}

type AddressMigrationResult = {
  inserted: number;
  updated: number;
  skippedUnresolvedCustomer: number;
  skippedOther: number;
  skippedDetails: string[];
};

async function migrateAddresses(
  prepared: PreparedAddress[],
  legacyUserIdToNewId: Map<string, string>,
  stateIndex: Map<string, IndianState>,
  dryRun: boolean,
): Promise<AddressMigrationResult> {
  let skippedUnresolvedCustomer = 0;
  const resolved: Array<PreparedAddress & { newUserId: string }> = [];
  for (const a of prepared) {
    const newUserId = legacyUserIdToNewId.get(a.customerLegacyId);
    if (!newUserId) {
      skippedUnresolvedCustomer++;
      continue;
    }
    resolved.push({ ...a, newUserId });
  }

  const isDefaultByLegacyId = assignDefaults(resolved);

  let inserted = 0;
  let updated = 0;
  let skippedOther = 0;
  const skippedDetails: string[] = [];

  if (dryRun) {
    await processBatches(resolved, BATCH_SIZE, async (batch) => {
      const existing = await prisma.customerAddress.findMany({
        where: { legacyId: { in: batch.map((a) => a.legacyId) } },
        select: { legacyId: true },
      });
      const existingSet = new Set(existing.map((e) => e.legacyId));
      for (const a of batch) {
        if (existingSet.has(a.legacyId)) updated++;
        else inserted++;
      }
    });
    return { inserted, updated, skippedUnresolvedCustomer, skippedOther, skippedDetails };
  }

  // One transaction per row — see the note in migrateUsers above.
  await processBatches(resolved, BATCH_SIZE, async (batch) => {
    for (const a of batch) {
      const matchedState = a.rawState ? matchState(a.rawState, stateIndex) : null;
      try {
        await prisma.$transaction(async (tx) => {
          const before = await tx.customerAddress.findUnique({
            where: { legacyId: a.legacyId },
            select: { id: true },
          });
          await tx.customerAddress.upsert({
            where: { legacyId: a.legacyId },
            update: {
              fullName: a.fullName,
              mobile: a.mobile,
              line1: a.line1,
              line2: a.line2,
              landmark: a.landmark,
              cityTown: a.cityTown,
              state: matchedState?.name ?? a.rawState ?? "",
              stateId: matchedState?.id ?? null,
              pincode: a.pincode,
              isBilling: a.isBilling,
              isDefault: isDefaultByLegacyId.get(a.legacyId) ?? false,
              latitude: a.latitude,
              longitude: a.longitude,
            },
            create: {
              legacyId: a.legacyId,
              userId: a.newUserId,
              fullName: a.fullName,
              mobile: a.mobile,
              line1: a.line1,
              line2: a.line2,
              landmark: a.landmark,
              cityTown: a.cityTown,
              // district left null — the old `address` blob is imported
              // verbatim into line1, never parsed apart (see schema
              // comment on CustomerAddress.district).
              district: null,
              state: matchedState?.name ?? a.rawState ?? "",
              stateId: matchedState?.id ?? null,
              pincode: a.pincode,
              // Old `address_type` is free text ("home" in practice) with
              // no reliable mapping onto AddressKind beyond the default —
              // always HOME for migrated rows.
              addressType: "HOME",
              isBilling: a.isBilling,
              isDefault: isDefaultByLegacyId.get(a.legacyId) ?? false,
              latitude: a.latitude,
              longitude: a.longitude,
            },
          });
          if (before) updated++;
          else inserted++;
        });
      } catch (err) {
        skippedOther++;
        skippedDetails.push(
          `address legacyId=${a.legacyId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  });

  return { inserted, updated, skippedUnresolvedCustomer, skippedOther, skippedDetails };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Legacy customer migration${args.dryRun ? " (DRY RUN — no writes)" : ""}`);
  console.log(`  users file:     ${args.usersFile}`);
  console.log(`  addresses file: ${args.addressesFile}\n`);

  const userRows = parseTsv(args.usersFile);
  const addressRows = parseTsv(args.addressesFile);
  console.log(`Read ${userRows.length} user row(s), ${addressRows.length} address row(s).\n`);

  // Phase 1: state normalization report.
  const canonicalStates = await prisma.indianState.findMany();
  const stateIndex = buildStateIndex(canonicalStates);
  const distinctRawStates = [
    ...new Set(addressRows.map((r) => cell(r, "state")).filter((s): s is string => !!s)),
  ];
  const unmatchedStates = distinctRawStates.filter((s) => !matchState(s, stateIndex));
  console.log(`State matching: ${distinctRawStates.length - unmatchedStates.length}/${distinctRawStates.length} distinct value(s) matched a canonical IndianState.`);
  if (unmatchedStates.length > 0) {
    console.log("  Unmatched state values (will import with stateId=null):");
    for (const s of unmatchedStates) console.log(`    - "${s}"`);
  }
  console.log();

  // Phase 2: users prep + null/empty contact report. Seed the dedup maps
  // from whatever's already in the DB (any User, legacy or not) so a
  // re-run after a partially-completed earlier attempt — or a genuine
  // pre-existing account — is treated as "already claimed" too, not just
  // duplicates found within this file pass.
  const existingContacts = await prisma.user.findMany({
    where: { OR: [{ email: { not: null } }, { phone: { not: null } }] },
    select: { email: true, phone: true, legacyId: true },
  });
  const existingEmails = new Map<string, string>();
  const existingPhones = new Map<string, string>();
  for (const u of existingContacts) {
    const owner = u.legacyId ?? "(pre-existing account)";
    if (u.email) existingEmails.set(u.email.toLowerCase(), owner);
    if (u.phone) existingPhones.set(u.phone, owner);
  }

  const {
    prepared: preparedUsers,
    skippedDealers,
    bothContactNull,
    duplicateContacts,
  } = prepareUsers(userRows, existingEmails, existingPhones);
  console.log(
    `Users: ${preparedUsers.length} qualify for migration (isDealer=0), ${skippedDealers} skipped (isDealer=1, out of scope).`,
  );
  if (bothContactNull > 0) {
    console.log(
      `  WARNING: ${bothContactNull} qualifying user(s) have both phone and email blank — still imported for order-history continuity, but unreachable by OTP/email login until updated.`,
    );
  }
  const dupEmails = duplicateContacts.filter((d) => d.field === "email").length;
  const dupPhones = duplicateContacts.filter((d) => d.field === "phone").length;
  if (duplicateContacts.length > 0) {
    console.log(
      `  Deduplicated ${dupEmails} email(s) and ${dupPhones} phone(s) — first-seen (in file order) kept the value, each later duplicate imports with that one field set to null. Full list ${args.dryRun ? "would be" : "is"} written to ${DUPLICATE_REPORT_PATH}.`,
    );
  }
  console.log();

  // Phase 3: user upsert (two-pass, batched).
  const userResult = await migrateUsers(preparedUsers, args.dryRun);

  // Phase 4: address prep + upsert.
  const { prepared: preparedAddresses, skippedGuests } = prepareAddresses(addressRows);
  console.log(
    `Addresses: ${preparedAddresses.length} non-guest row(s) to process, ${skippedGuests} guest row(s) skipped (out of scope).`,
  );

  // legacyId -> new User.id map, needed to link addresses to their
  // migrated customer. Built from a fresh DB read so this is correct
  // whether or not this same run just inserted those users.
  const allLegacyUserIds = [...new Set(preparedUsers.map((u) => u.legacyId))];
  const migratedUsers = args.dryRun
    ? [] // dry-run: nothing was actually written; fall back to the prepared batch below
    : await prisma.user.findMany({
        where: { legacyId: { in: allLegacyUserIds } },
        select: { id: true, legacyId: true },
      });
  const legacyUserIdToNewId = new Map<string, string>();
  if (args.dryRun) {
    // Preview mode: treat every qualifying user in this batch as if it
    // would exist, using its legacyId as a stand-in id — good enough to
    // report accurate would-be linkage/skip counts without writing.
    for (const u of preparedUsers) legacyUserIdToNewId.set(u.legacyId, `dry-run:${u.legacyId}`);
  } else {
    for (const u of migratedUsers) if (u.legacyId) legacyUserIdToNewId.set(u.legacyId, u.id);
  }

  const addressResult = await migrateAddresses(
    preparedAddresses,
    legacyUserIdToNewId,
    stateIndex,
    args.dryRun,
  );

  // Final summary.
  console.log("\n" + "=".repeat(70));
  console.log(`SUMMARY${args.dryRun ? " (DRY RUN — nothing was written)" : ""}`);
  console.log("=".repeat(70));
  console.table({
    Users: {
      inserted: userResult.inserted,
      updated: userResult.updated,
      skipped: userResult.skipped,
    },
    Addresses: {
      inserted: addressResult.inserted,
      updated: addressResult.updated,
      skipped: addressResult.skippedUnresolvedCustomer + addressResult.skippedOther,
    },
  });
  console.log(
    `Referrals: ${userResult.referralResolved} resolved, ${userResult.referralUnresolved} unresolved (referrer not found among migrated users).`,
  );
  console.log(`Unmatched states: ${unmatchedStates.length} distinct value(s) — see list above.`);
  console.log(`Users with both phone and email blank: ${bothContactNull}.`);
  console.log(
    `Addresses skipped — customer not migrated/resolved: ${addressResult.skippedUnresolvedCustomer}.`,
  );
  if (userResult.skippedDetails.length > 0) {
    console.log(`\nUser skip reasons (first 20):`);
    for (const d of userResult.skippedDetails.slice(0, 20)) console.log(`  - ${d}`);
  }
  if (addressResult.skippedDetails.length > 0) {
    console.log(`\nAddress skip reasons (first 20):`);
    for (const d of addressResult.skippedDetails.slice(0, 20)) console.log(`  - ${d}`);
  }

  // Persist the dedup report so which accounts lost their email/phone to
  // an earlier duplicate can be looked up later, without re-running the
  // whole migration or re-deriving it from the raw TSVs by hand.
  if (!args.dryRun && duplicateContacts.length > 0) {
    mkdirSync(dirname(DUPLICATE_REPORT_PATH), { recursive: true });
    writeFileSync(DUPLICATE_REPORT_PATH, JSON.stringify(duplicateContacts, null, 2));
    console.log(
      `\nWrote ${duplicateContacts.length} deduplicated-contact record(s) to ${DUPLICATE_REPORT_PATH}.`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
