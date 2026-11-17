/**
 * Legacy dealer migration — one-time ETL from the old Laravel/MySQL
 * `kisan4u` DB (srv603843) into this app's Postgres.
 *
 * Scope: `users` rows with isDealer=1 AND dealer_kyc_status='approved'
 * ONLY (owner's explicit decision — pending/rejected/upload_document/
 * personal_detail dealers are out of scope), joined against
 * `dealer_kyc_details` for GST/license/store data and real document
 * files, plus their non-guest `shipping_addresses`. All three source
 * TSVs are expected to already be pre-filtered to this scope by the
 * export query itself (see the investigation SQL this script's sibling
 * conversation used) — this script does not re-filter by isDealer/status.
 *
 * "Dealer" was never a distinct account type in the legacy 6valley
 * schema — it's a flag (isDealer=1) on the exact same `users` table the
 * customer migration reads from. Confirmed directly (packages/db/
 * legacy-export/users.tsv, the customer migration's own export) that
 * every one of its 67,897 rows has isDealer=0 — dealers were never
 * migrated as customers, a clean slate. Even so, dealer User rows use an
 * audience-prefixed legacyId ("DEALER:<legacy users.id>", matching the
 * same CUSTOMER:/DEALER: prefix convention already used for
 * ProductVariant.legacyVariantType) rather than the bare numeric id the
 * customer migration uses — belt-and-suspenders against any future
 * re-scoping of either migration, and it keeps a person's customer and
 * dealer identities as two genuinely separate accounts in this system if
 * they ever hold both.
 *
 * Documents: gst_doc_path/license_doc_path/doc3_doc_path/doc4_doc_path
 * are relative paths into whichever of TWO legacy document-storage roots
 * happened to hold that file (the legacy server was duplicated at some
 * point and the two roots diverged — confirmed 6,696 of 6,699 referenced
 * documents recovered by unioning both). The operator stages the actual
 * files into ./legacy-export/dealer-docs/{gst_docs,license_docs,
 * doc3_docs,doc4_docs}/ themselves (SFTP has no route to the legacy
 * webservers' storage/ trees directly) before running this for real —
 * see --docs-dir. Each referenced file is re-uploaded through this app's
 * own real localStorageProvider (the same function the live dealer
 * registration flow uses — packages/providers/src/storage.ts,
 * "dealer-documents" subdir), never just linked to the old server.
 *
 * doc3/doc4 have no defined meaning even in the legacy app itself
 * (confirmed by reading its own Blade templates — both are generically
 * labeled "Doc3"/"Doc4" everywhere, no specific document type). Rather
 * than invent named schema fields for something even the original system
 * never defined, they land in DealerProfile.additionalDocuments (a
 * generic Json? array of {label, number, docUrl}) so nothing is lost
 * without permanently baking an undefined concept into the schema.
 *
 * Usage:
 *   tsx prisma/migrate-legacy-dealers.ts --dry-run
 *   tsx prisma/migrate-legacy-dealers.ts \
 *     --dealers-file ./legacy-export/dealers.tsv \
 *     --kyc-file ./legacy-export/dealer_kyc_details.tsv \
 *     --addresses-file ./legacy-export/dealer_shipping_addresses.tsv \
 *     --docs-dir ./legacy-export/dealer-docs
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path, { dirname } from "node:path";
import {
  PrismaClient,
  UserRole,
  KycStatus,
  ApplicationStatus,
  type IndianState,
} from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { normalizeIndianPhone } from "@kisan4u/validators";
import { uploadPrivateDocument } from "@kisan4u/providers";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const BATCH_SIZE = 500;

const DUPLICATE_REPORT_PATH = "./legacy-export/dealer-duplicate-contacts-report.json";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

type Args = {
  dealersFile: string;
  kycFile: string;
  addressesFile: string;
  docsDir: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  let dealersFile = "./legacy-export/dealers.tsv";
  let kycFile = "./legacy-export/dealer_kyc_details.tsv";
  let addressesFile = "./legacy-export/dealer_shipping_addresses.tsv";
  let docsDir = "./legacy-export/dealer-docs";
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--dealers-file") dealersFile = argv[++i]!;
    else if (arg.startsWith("--dealers-file=")) dealersFile = arg.slice("--dealers-file=".length);
    else if (arg === "--kyc-file") kycFile = argv[++i]!;
    else if (arg.startsWith("--kyc-file=")) kycFile = arg.slice("--kyc-file=".length);
    else if (arg === "--addresses-file") addressesFile = argv[++i]!;
    else if (arg.startsWith("--addresses-file="))
      addressesFile = arg.slice("--addresses-file=".length);
    else if (arg === "--docs-dir") docsDir = argv[++i]!;
    else if (arg.startsWith("--docs-dir=")) docsDir = arg.slice("--docs-dir=".length);
  }
  return { dealersFile, kycFile, addressesFile, docsDir, dryRun };
}

// ---------------------------------------------------------------------------
// TSV parsing (identical to migrate-legacy-customers.ts — duplicated since
// this runs standalone via tsx, not through the app's build graph)
// ---------------------------------------------------------------------------

function parseTsv(filePath: string): Record<string, string>[] {
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0]!.replace(/\r$/, "").split("\t");
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.replace(/\r$/, "").split("\t");
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) row[header[c]!] = cells[c] ?? "";
    rows.push(row);
  }
  return rows;
}

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
  if (fName || lName) return { firstName: fName ?? null, lastName: lName ?? null };
  const name = cell(row, "name");
  if (name) return splitFullName(name);
  return { firstName: null, lastName: null };
}

// ---------------------------------------------------------------------------
// State normalization (identical to migrate-legacy-customers.ts)
// ---------------------------------------------------------------------------

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

async function processBatches<T>(
  items: T[],
  batchSize: number,
  handler: (batch: T[]) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) await handler(items.slice(i, i + batchSize));
}

// ---------------------------------------------------------------------------
// Document re-upload — reads a legacy-staged file and writes it through
// this app's real upload provider (same "dealer-documents" subdir the
// live registration flow uses), returning the new /api/uploads/... path.
// Null (not thrown) if the file isn't staged locally — the 3 documents
// that were unrecoverable from either legacy storage root land here as a
// logged skip, not a fatal error.
// ---------------------------------------------------------------------------

const EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

async function reuploadDoc(
  relPath: string | null | undefined,
  docsDir: string,
): Promise<{ url: string | null; error: string | null }> {
  // 3 legacy rows have the literal string "0" in a doc-path column
  // instead of NULL or a real path — confirmed by direct inspection, a
  // legacy data-entry artifact, not a real file reference. Treat it the
  // same as absent rather than a genuine missing-file error.
  if (!relPath || relPath === "0") return { url: null, error: null };
  const localPath = path.join(docsDir, relPath);
  let bytes: Buffer;
  try {
    bytes = readFileSync(localPath);
  } catch {
    return { url: null, error: `not staged locally: ${relPath}` };
  }
  const ext = path.extname(relPath).toLowerCase();
  const filename = path.basename(relPath);
  const type = EXT_MIME[ext] ?? "application/octet-stream";
  const file = new File([new Uint8Array(bytes)], filename, { type });
  try {
    const uploaded = await uploadPrivateDocument(file, "dealer-documents");
    return { url: uploaded.storageKey, error: null };
  } catch {
    return { url: null, error: `unsupported document: ${relPath}` };
  }
}

// ---------------------------------------------------------------------------
// Phase: dealers (users + dealer_kyc_details, one DealerProfile each)
// ---------------------------------------------------------------------------

type PreparedDealer = {
  legacyId: string; // bare legacy users.id, WITHOUT the "DEALER:" prefix
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  isPhoneVerified: boolean;
  isEmailVerified: boolean;
  createdAt: Date | null;
};

/** One row per contact field nulled out because an earlier-seen row already claimed it — same policy/shape as migrate-legacy-customers.ts's DuplicateContactEntry. */
export type DuplicateContactEntry = {
  field: "email" | "phone";
  legacyId: string;
  name: string;
  originalValue: string;
  keptByLegacyId: string;
};

/**
 * Both User.email and User.phone are @unique. Same first-seen-wins policy
 * as the customer migration (see migrate-legacy-customers.ts) — a later
 * duplicate imports with that one field nulled rather than failing the
 * whole row. Seeded from the DB (existingEmails/existingPhones) so this
 * is safe to re-run and correctly treats anything already claimed by a
 * real account (including this same dealer migration's own earlier
 * partial run, or the customer migration) as already taken.
 */
function prepareDealers(
  rows: Record<string, string>[],
  existingEmails: Map<string, string>,
  existingPhones: Map<string, string>,
): { prepared: PreparedDealer[]; duplicateContacts: DuplicateContactEntry[] } {
  const prepared: PreparedDealer[] = [];
  const duplicateContacts: DuplicateContactEntry[] = [];
  const seenEmails = new Map(existingEmails);
  const seenPhones = new Map(existingPhones);

  for (const row of rows) {
    const legacyId = cell(row, "id");
    if (!legacyId) continue;
    const { firstName, lastName } = resolveUserName(row);
    const name = [firstName, lastName].filter(Boolean).join(" ") || "(no name)";
    const rawPhone = cell(row, "phone") ?? null;
    let phone = rawPhone ? normalizeIndianPhone(rawPhone) : null;
    let email = cell(row, "email") ?? null;

    if (email) {
      const key = email.toLowerCase();
      const keptBy = seenEmails.get(key);
      if (keptBy && keptBy !== legacyId) {
        duplicateContacts.push({
          field: "email",
          legacyId,
          name,
          originalValue: email,
          keptByLegacyId: keptBy,
        });
        email = null;
      } else if (!keptBy) {
        seenEmails.set(key, legacyId);
      }
    }
    if (phone) {
      const keptBy = seenPhones.get(phone);
      if (keptBy && keptBy !== legacyId) {
        duplicateContacts.push({
          field: "phone",
          legacyId,
          name,
          originalValue: phone,
          keptByLegacyId: keptBy,
        });
        phone = null;
      } else if (!keptBy) {
        seenPhones.set(phone, legacyId);
      }
    }

    const createdAtRaw = cell(row, "created_at");
    prepared.push({
      legacyId,
      firstName,
      lastName,
      phone,
      email,
      isActive: cell(row, "is_active") === undefined ? true : boolCell(row, "is_active"),
      isPhoneVerified: boolCell(row, "is_phone_verified"),
      isEmailVerified: boolCell(row, "is_email_verified"),
      createdAt: createdAtRaw ? new Date(createdAtRaw) : null,
    });
  }
  return { prepared, duplicateContacts };
}

type KycDetails = {
  gstNumber: string | null;
  gstDocPath: string | null;
  licenseNumber: string | null;
  licenseDocPath: string | null;
  doc3Number: string | null;
  doc3DocPath: string | null;
  doc4Number: string | null;
  doc4DocPath: string | null;
  storeName: string | null;
  storeAddress: string | null;
  pincode: string | null;
  city: string | null;
  rawState: string | null;
  isUnregistered: boolean;
};

function prepareKycByLegacyDealerId(rows: Record<string, string>[]): Map<string, KycDetails> {
  const map = new Map<string, KycDetails>();
  for (const row of rows) {
    const dealerId = cell(row, "dealer_id");
    if (!dealerId) continue;
    map.set(dealerId, {
      gstNumber: cell(row, "gst_in") ?? null,
      gstDocPath: cell(row, "gst_doc_path") ?? null,
      licenseNumber: cell(row, "license_number") ?? null,
      licenseDocPath: cell(row, "license_doc_path") ?? null,
      doc3Number: cell(row, "doc3_number") ?? null,
      doc3DocPath: cell(row, "doc3_doc_path") ?? null,
      doc4Number: cell(row, "doc4_number") ?? null,
      doc4DocPath: cell(row, "doc4_doc_path") ?? null,
      storeName: cell(row, "store_name") ?? null,
      storeAddress: cell(row, "store_address") ?? null,
      pincode: cell(row, "pincode") ?? null,
      city: cell(row, "city") ?? null,
      rawState: cell(row, "state") ?? null,
      isUnregistered: boolCell(row, "unregistered_dealer"),
    });
  }
  return map;
}

type DealerMigrationResult = {
  inserted: number;
  updated: number;
  skipped: number;
  skippedDetails: string[];
  docsUploaded: number;
  docsSkippedAlreadySet: number;
  docsMissingLocally: string[];
};

async function migrateDealers(
  prepared: PreparedDealer[],
  kycByLegacyId: Map<string, KycDetails>,
  stateIndex: Map<string, IndianState>,
  docsDir: string,
  dryRun: boolean,
): Promise<DealerMigrationResult> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const skippedDetails: string[] = [];
  let docsUploaded = 0;
  let docsSkippedAlreadySet = 0;
  const docsMissingLocally: string[] = [];

  if (dryRun) {
    await processBatches(prepared, BATCH_SIZE, async (batch) => {
      const existing = await prisma.user.findMany({
        where: { legacyId: { in: batch.map((d) => `DEALER:${d.legacyId}`) } },
        select: { legacyId: true },
      });
      const existingSet = new Set(existing.map((e) => e.legacyId));
      for (const d of batch) {
        if (existingSet.has(`DEALER:${d.legacyId}`)) updated++;
        else inserted++;
        const kyc = kycByLegacyId.get(d.legacyId);
        if (kyc) {
          for (const p of [kyc.gstDocPath, kyc.licenseDocPath, kyc.doc3DocPath, kyc.doc4DocPath]) {
            if (!p || p === "0") continue;
            try {
              readFileSync(path.join(docsDir, p));
              docsUploaded++; // "would upload"
            } catch {
              docsMissingLocally.push(p);
            }
          }
        }
      }
    });
    return {
      inserted,
      updated,
      skipped,
      skippedDetails,
      docsUploaded,
      docsSkippedAlreadySet,
      docsMissingLocally,
    };
  }

  await processBatches(prepared, BATCH_SIZE, async (batch) => {
    for (const d of batch) {
      const legacyId = `DEALER:${d.legacyId}`;
      const kyc = kycByLegacyId.get(d.legacyId) ?? null;
      const matchedState = kyc?.rawState ? matchState(kyc.rawState, stateIndex) : null;

      try {
        // Existing profile checked BEFORE the transaction so document
        // re-uploads (real filesystem writes with side effects) only ever
        // happen once per doc field, not on every re-run — see the
        // module doc comment's idempotency note.
        const existingUser = await prisma.user.findUnique({
          where: { legacyId },
          select: { id: true, dealerProfile: { select: { gstDocUrl: true, licenseDocUrl: true } } },
        });

        let gstDocUrl = existingUser?.dealerProfile?.gstDocUrl ?? null;
        let licenseDocUrl = existingUser?.dealerProfile?.licenseDocUrl ?? null;
        const additionalDocuments: Array<{
          label: string;
          number: string | null;
          docUrl: string | null;
        }> = [];

        if (kyc) {
          if (!gstDocUrl && kyc.gstDocPath) {
            const r = await reuploadDoc(kyc.gstDocPath, docsDir);
            if (r.url) {
              gstDocUrl = r.url;
              docsUploaded++;
            } else if (r.error) docsMissingLocally.push(r.error);
          } else if (gstDocUrl) docsSkippedAlreadySet++;

          if (!licenseDocUrl && kyc.licenseDocPath) {
            const r = await reuploadDoc(kyc.licenseDocPath, docsDir);
            if (r.url) {
              licenseDocUrl = r.url;
              docsUploaded++;
            } else if (r.error) docsMissingLocally.push(r.error);
          } else if (licenseDocUrl) docsSkippedAlreadySet++;

          if (kyc.doc3Number || kyc.doc3DocPath) {
            const r = await reuploadDoc(kyc.doc3DocPath, docsDir);
            if (r.error) docsMissingLocally.push(r.error);
            if (r.url) docsUploaded++;
            additionalDocuments.push({ label: "Doc3", number: kyc.doc3Number, docUrl: r.url });
          }
          if (kyc.doc4Number || kyc.doc4DocPath) {
            const r = await reuploadDoc(kyc.doc4DocPath, docsDir);
            if (r.error) docsMissingLocally.push(r.error);
            if (r.url) docsUploaded++;
            additionalDocuments.push({ label: "Doc4", number: kyc.doc4Number, docUrl: r.url });
          }
        }

        await prisma.$transaction(async (tx) => {
          const user = await tx.user.upsert({
            where: { legacyId },
            update: {
              firstName: d.firstName,
              lastName: d.lastName,
              phone: d.phone,
              email: d.email,
              isActive: d.isActive,
              isPhoneVerified: d.isPhoneVerified,
              isEmailVerified: d.isEmailVerified,
            },
            create: {
              legacyId,
              firstName: d.firstName,
              lastName: d.lastName,
              phone: d.phone,
              email: d.email,
              role: UserRole.DEALER,
              referralCode: `DEA-LEGACY-${d.legacyId}`,
              isActive: d.isActive,
              isPhoneVerified: d.isPhoneVerified,
              isEmailVerified: d.isEmailVerified,
              ...(d.createdAt ? { createdAt: d.createdAt } : {}),
            },
          });

          // Approved on the legacy site without our document check ever
          // running — flag rather than block, see
          // DealerProfile.hasMissingDocuments' doc comment.
          const hasMissingDocuments = !gstDocUrl || !licenseDocUrl;

          await tx.dealerProfile.upsert({
            where: { userId: user.id },
            update: {
              kycStatus: KycStatus.APPROVED,
              status: ApplicationStatus.APPROVED,
              gstNumber: kyc?.gstNumber ?? null,
              gstDocUrl,
              licenseNumber: kyc?.licenseNumber ?? null,
              licenseDocUrl,
              storeName: kyc?.storeName ?? null,
              storeAddress: kyc?.storeAddress ?? null,
              city: kyc?.city ?? null,
              state: matchedState?.name ?? kyc?.rawState ?? null,
              stateId: matchedState?.id ?? null,
              pincode: kyc?.pincode ?? null,
              isUnregistered: kyc?.isUnregistered ?? false,
              additionalDocuments: additionalDocuments.length > 0 ? additionalDocuments : undefined,
              hasMissingDocuments,
            },
            create: {
              userId: user.id,
              kycStatus: KycStatus.APPROVED,
              status: ApplicationStatus.APPROVED,
              gstNumber: kyc?.gstNumber ?? null,
              gstDocUrl,
              licenseNumber: kyc?.licenseNumber ?? null,
              licenseDocUrl,
              storeName: kyc?.storeName ?? null,
              storeAddress: kyc?.storeAddress ?? null,
              city: kyc?.city ?? null,
              state: matchedState?.name ?? kyc?.rawState ?? null,
              stateId: matchedState?.id ?? null,
              pincode: kyc?.pincode ?? null,
              isUnregistered: kyc?.isUnregistered ?? false,
              additionalDocuments: additionalDocuments.length > 0 ? additionalDocuments : undefined,
              hasMissingDocuments,
            },
          });

          if (existingUser) updated++;
          else inserted++;
        });
      } catch (err) {
        skipped++;
        skippedDetails.push(
          `dealer legacyId=${d.legacyId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  });

  return {
    inserted,
    updated,
    skipped,
    skippedDetails,
    docsUploaded,
    docsSkippedAlreadySet,
    docsMissingLocally,
  };
}

// ---------------------------------------------------------------------------
// Phase: addresses (same shape/logic as migrate-legacy-customers.ts)
// ---------------------------------------------------------------------------

type PreparedAddress = {
  legacyId: string;
  dealerLegacyId: string;
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
    const dealerLegacyId = cell(row, "customer_id");
    if (!legacyId || !dealerLegacyId) continue;
    if (boolCell(row, "is_guest")) {
      skippedGuests++;
      continue;
    }
    const createdAtRaw = cell(row, "created_at");
    prepared.push({
      legacyId,
      dealerLegacyId,
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
  skippedUnresolvedDealer: number;
  skippedOther: number;
  skippedDetails: string[];
};

async function migrateAddresses(
  prepared: PreparedAddress[],
  legacyDealerIdToNewId: Map<string, string>,
  stateIndex: Map<string, IndianState>,
  dryRun: boolean,
): Promise<AddressMigrationResult> {
  let skippedUnresolvedDealer = 0;
  const resolved: Array<PreparedAddress & { newUserId: string }> = [];
  for (const a of prepared) {
    const newUserId = legacyDealerIdToNewId.get(a.dealerLegacyId);
    if (!newUserId) {
      skippedUnresolvedDealer++;
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
    return { inserted, updated, skippedUnresolvedDealer, skippedOther, skippedDetails };
  }

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
              district: null,
              state: matchedState?.name ?? a.rawState ?? "",
              stateId: matchedState?.id ?? null,
              pincode: a.pincode,
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

  return { inserted, updated, skippedUnresolvedDealer, skippedOther, skippedDetails };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Legacy dealer migration${args.dryRun ? " (DRY RUN — no writes)" : ""}`);
  console.log(`  dealers file:   ${args.dealersFile}`);
  console.log(`  kyc file:       ${args.kycFile}`);
  console.log(`  addresses file: ${args.addressesFile}`);
  console.log(`  docs dir:       ${args.docsDir}\n`);

  const dealerRows = parseTsv(args.dealersFile);
  const kycRows = parseTsv(args.kycFile);
  const addressRows = parseTsv(args.addressesFile);
  console.log(
    `Read ${dealerRows.length} dealer row(s), ${kycRows.length} kyc-detail row(s), ${addressRows.length} address row(s).\n`,
  );

  const canonicalStates = await prisma.indianState.findMany();
  const stateIndex = buildStateIndex(canonicalStates);

  // Seed dedup maps from every existing User (any role, legacy or not) so
  // this is safe to re-run and correctly treats an already-claimed
  // customer/dealer contact as taken, not just duplicates within this file.
  const existingContacts = await prisma.user.findMany({
    where: { OR: [{ email: { not: null } }, { phone: { not: null } }] },
    select: { email: true, phone: true, legacyId: true },
  });
  const existingEmails = new Map<string, string>();
  const existingPhones = new Map<string, string>();
  for (const u of existingContacts) {
    // Strip the "DEALER:" prefix so an already-migrated dealer's own row
    // compares equal to PreparedDealer.legacyId (bare id) below — without
    // this, every already-migrated dealer's own email/phone looked like
    // a collision with someone else on every re-run.
    const owner = u.legacyId?.replace(/^DEALER:/, "") ?? "(pre-existing account)";
    if (u.email) existingEmails.set(u.email.toLowerCase(), owner);
    if (u.phone) existingPhones.set(u.phone, owner);
  }

  const { prepared, duplicateContacts } = prepareDealers(
    dealerRows,
    existingEmails,
    existingPhones,
  );
  const kycByLegacyId = prepareKycByLegacyDealerId(kycRows);
  console.log(
    `Dealers: ${prepared.length} to process, ${kycByLegacyId.size} have a matching KYC-details row (${prepared.length - kycByLegacyId.size} approved without one — account only, no GST/license/store/docs).`,
  );
  const dupEmails = duplicateContacts.filter((d) => d.field === "email").length;
  const dupPhones = duplicateContacts.filter((d) => d.field === "phone").length;
  if (duplicateContacts.length > 0) {
    console.log(
      `  Deduplicated ${dupEmails} email(s) and ${dupPhones} phone(s) — first-seen (in file order) kept the value, each later duplicate imports with that one field set to null.`,
    );
  }
  console.log();

  const dealerResult = await migrateDealers(
    prepared,
    kycByLegacyId,
    stateIndex,
    args.docsDir,
    args.dryRun,
  );

  const { prepared: preparedAddresses, skippedGuests } = prepareAddresses(addressRows);
  console.log(
    `\nAddresses: ${preparedAddresses.length} non-guest row(s) to process, ${skippedGuests} guest row(s) skipped.`,
  );

  const allLegacyDealerIds = [...new Set(prepared.map((d) => d.legacyId))];
  const migratedDealers = args.dryRun
    ? []
    : await prisma.user.findMany({
        where: { legacyId: { in: allLegacyDealerIds.map((id) => `DEALER:${id}`) } },
        select: { id: true, legacyId: true },
      });
  const legacyDealerIdToNewId = new Map<string, string>();
  if (args.dryRun) {
    for (const d of prepared) legacyDealerIdToNewId.set(d.legacyId, `dry-run:${d.legacyId}`);
  } else {
    for (const u of migratedDealers) {
      if (u.legacyId) legacyDealerIdToNewId.set(u.legacyId.replace(/^DEALER:/, ""), u.id);
    }
  }

  const addressResult = await migrateAddresses(
    preparedAddresses,
    legacyDealerIdToNewId,
    stateIndex,
    args.dryRun,
  );

  console.log("\n" + "=".repeat(70));
  console.log(`SUMMARY${args.dryRun ? " (DRY RUN — nothing was written)" : ""}`);
  console.log("=".repeat(70));
  console.table({
    Dealers: {
      inserted: dealerResult.inserted,
      updated: dealerResult.updated,
      skipped: dealerResult.skipped,
    },
    Addresses: {
      inserted: addressResult.inserted,
      updated: addressResult.updated,
      skipped: addressResult.skippedUnresolvedDealer + addressResult.skippedOther,
    },
  });
  console.log(
    `Documents: ${dealerResult.docsUploaded} uploaded, ${dealerResult.docsSkippedAlreadySet} skipped (already set from a prior run), ${dealerResult.docsMissingLocally.length} missing locally.`,
  );
  if (dealerResult.docsMissingLocally.length > 0) {
    console.log("  Missing (first 20):");
    for (const m of dealerResult.docsMissingLocally.slice(0, 20)) console.log(`    - ${m}`);
  }
  console.log(
    `Addresses skipped — dealer not migrated/resolved: ${addressResult.skippedUnresolvedDealer}.`,
  );
  if (dealerResult.skippedDetails.length > 0) {
    console.log(`\nDealer skip reasons (first 20):`);
    for (const d of dealerResult.skippedDetails.slice(0, 20)) console.log(`  - ${d}`);
  }
  if (addressResult.skippedDetails.length > 0) {
    console.log(`\nAddress skip reasons (first 20):`);
    for (const d of addressResult.skippedDetails.slice(0, 20)) console.log(`  - ${d}`);
  }

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
