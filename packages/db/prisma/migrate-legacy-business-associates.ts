/**
 * Legacy Business Associate (BA/"CSP") migration — one-time ETL from the
 * old Laravel/MySQL `kisan4u` DB's `bas` (profile) and `wallet_transactions`
 * (commission ledger, filtered to BA-typed rows) tables into this app's
 * BusinessAssociateProfile / User.referredByBaId / BaEarning models.
 *
 * SCOPE: bas.status='approved' only (3,284 of 3,298 — 14 pending are out of
 * scope, same "only approved" convention as the dealer migration).
 *
 * Owner's rule, confirmed 2026-09-17: every BA must already be a real
 * customer/dealer account (matched via bas.parentid -> legacy users.id ->
 * User.legacyId, either bare (CUSTOMER) or "DEALER:"-prefixed). If not
 * found, register them as a plain CUSTOMER. For each BA's referees
 * (wallet_transactions.referred_to), only link + record earnings for
 * referees who ALREADY exist as a migrated User — never create an account
 * just for being a referee. Same for the "orders placed by the referee":
 * we don't create anything order-side here, we simply link the referee to
 * the BA (User.referredByBaId) — their already-migrated order history
 * (packages/db/prisma/migrate-legacy-orders.ts, run earlier) is then
 * naturally attributable through that relation, same as any real BA
 * referral. A final report lists every BA whose referee(s) could not be
 * resolved, for manual follow-up.
 *
 * SOURCE MECHANICS (reverse-engineered, not documented anywhere on the old
 * site — see the investigation session this script's sibling conversation
 * ran before writing this):
 *   - `bas.parentid` = the BA's own legacy `users.id`.
 *   - The REAL commission ledger is `wallet_transactions`, NOT `bas` or
 *     `ba_settlements` (which only cover 2 of many payout runs) or
 *     `temp_refering` (only 12 rows, a near-unused SMS-invite staging
 *     table). Filtered to transaction_type IN ('earned_by_referral_ba',
 *     'add_fund_by_admin_ba') AND ba_com_amt > 0 (249 rows): `user_id` is
 *     the earning BA's own legacy user id, `referred_to` is the referred
 *     customer's legacy user id, paired by `transaction_reference_id`.
 *     reference='add_fund_by_admin_ba' (paired with
 *     transaction_type='earned_by_referral_ba') is a flat 50 REGISTRATION
 *     bonus; reference='referral_ba_order_commission' is a variable
 *     ORDER_COMMISSION amount. Neither cites a specific order id, so
 *     BaEarning.sourceSellerOrderId is left null for every backfilled row
 *     — genuinely not reconstructable from the source data.
 *   - 190 of 249 rows (76%) have user_id === referred_to ("self-referral")
 *     — far too common to be a data-entry mistake, and amounts don't
 *     differ meaningfully from the non-self rows. Most likely explanation:
 *     referred_to defaults to the BA's own id whenever a commission was
 *     credited without a real referral event behind it. We still record
 *     the earning (real money, real history) but deliberately do NOT set
 *     User.referredByBaId for these — the schema explicitly forbids
 *     self-referral, and we can't confirm there's a genuine third party.
 *
 * SETTLEMENT SAFETY (mirrors the SellerOrder.legacyClosedOut discipline
 * used for the order-history migration): BA payouts are entirely manual
 * in this app (packages/orders/src/ba/settlement.ts — an admin builds a
 * batch and ticks "paid" by hand, no automated trigger), and
 * BaEarningStatus already has a SETTLED state for "already paid" — no new
 * schema field needed here.
 *   - Checked directly, 2026-09-17: BOTH of the old site's 2 payout
 *     batches (ba_settlements) are status='pending' with paid_amount=0.00
 *     — a batch was CREATED but NEVER actually paid out. Being listed in
 *     a batch's wallet_transactions id list is therefore NOT evidence of
 *     payment on its own (an earlier draft of this script assumed it
 *     was — corrected before the real run). Only a batch whose own
 *     status/paid_amount shows genuine payment would count as SETTLED;
 *     as of this migration, that's none of them.
 *   - So all 249 commission rows import as LOCKED — the same status a
 *     live REGISTRATION/ORDER_COMMISSION earning starts at. This lets the
 *     app's own existing lazy eligibility promotion
 *     (packages/orders/src/ba/earnings.ts:promoteEligibleBaEarnings)
 *     decide when they become payable, using the referee's REAL migrated
 *     order history — the same safe, already-correct logic every other
 *     earning goes through. Nothing pays out without going through that
 *     plus a human admin manually building and confirming a payout batch.
 *     (The settledIds mechanism is left in place, driven off the real
 *     status/paid_amount check above, so a future re-run correctly picks
 *     up a batch if it's ever actually marked paid.)
 *
 * Six BAs applied twice (same parentid, two different bas.id rows, both
 * approved) — only the most recent (highest id) application is migrated;
 * the older one is skipped and reported.
 *
 * bas.state/bas.city are numeric codes with no lookup table anywhere in
 * the legacy schema (confirmed — no states/cities table exists). Left
 * null rather than guessed; pincode (always present) is migrated as-is.
 * gender is deliberately not migrated — irrelevant, per owner's decision.
 *
 * Usage:
 *   tsx prisma/migrate-legacy-business-associates.ts --dry-run \
 *     --bas-file ./legacy-export/bas.tsv \
 *     --wallet-file ./legacy-export/ba_wallet_transactions.tsv \
 *     --settlements-file ./legacy-export/ba_settlements.tsv
 *   tsx prisma/migrate-legacy-business-associates.ts \
 *     --bas-file ./legacy-export/bas.tsv \
 *     --wallet-file ./legacy-export/ba_wallet_transactions.tsv \
 *     --settlements-file ./legacy-export/ba_settlements.tsv
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { PrismaClient, UserRole, BaStatus, BaBankStatus, BaEarningStatus } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { normalizeIndianPhone } from "@kisan4u/validators";

/**
 * Identical to packages/orders/src/ba/referral.ts's generateBaReferralCode
 * — duplicated rather than imported since packages/db can't depend on
 * packages/orders (packages/orders depends on packages/db, not the other
 * way — same "duplicated since this runs standalone via tsx" convention
 * migrate-legacy-orders.ts already uses for its own small pure helpers).
 * Owner's explicit instruction, 2026-09-17: every migrated BA gets a real
 * code in the live site's own format, not a "LEGACY-"-prefixed one.
 */
function generateBaReferralCode(): string {
  return `BA-${randomBytes(6).toString("hex").toUpperCase()}`;
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const BATCH_SIZE = 500;
const NOT_FOUND_REPORT_PATH = "./legacy-export/ba-unresolved-referees-report.json";
const DUPLICATE_REPORT_PATH = "./legacy-export/ba-duplicate-contacts-report.json";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

type Args = { basFile: string; walletFile: string; settlementsFile: string; dryRun: boolean };

function parseArgs(argv: string[]): Args {
  let basFile = "./legacy-export/bas.tsv";
  let walletFile = "./legacy-export/ba_wallet_transactions.tsv";
  let settlementsFile = "./legacy-export/ba_settlements.tsv";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--bas-file") basFile = argv[++i]!;
    else if (arg.startsWith("--bas-file=")) basFile = arg.slice("--bas-file=".length);
    else if (arg === "--wallet-file") walletFile = argv[++i]!;
    else if (arg.startsWith("--wallet-file=")) walletFile = arg.slice("--wallet-file=".length);
    else if (arg === "--settlements-file") settlementsFile = argv[++i]!;
    else if (arg.startsWith("--settlements-file=")) settlementsFile = arg.slice("--settlements-file=".length);
  }
  return { basFile, walletFile, settlementsFile, dryRun };
}

// ---------------------------------------------------------------------------
// TSV parsing — identical convention to every other migrate-legacy-*.ts
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

function splitFullName(fullName: string): { firstName: string; lastName: string | null } {
  const trimmed = fullName.trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return { firstName: trimmed, lastName: null };
  return { firstName: trimmed.slice(0, spaceIndex), lastName: trimmed.slice(spaceIndex + 1).trim() || null };
}

async function processBatches<T>(
  items: T[],
  batchSize: number,
  handler: (batch: T[]) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) await handler(items.slice(i, i + batchSize));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type DuplicateContactEntry = {
  field: "panNumber" | "accountNumber" | "referralCode" | "phone";
  legacyBaId: string;
  name: string;
  originalValue: string;
  keptByLegacyBaId: string;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Legacy BA migration${args.dryRun ? " (DRY RUN — no writes)" : ""}`);
  console.log(`  bas file:         ${args.basFile}`);
  console.log(`  wallet file:      ${args.walletFile}`);

  const basRows = parseTsv(args.basFile).filter((r) => cell(r, "status") === "approved");
  const walletRows = parseTsv(args.walletFile);
  console.log(`\nRead ${basRows.length} approved bas row(s), ${walletRows.length} ba wallet-transaction row(s).`);

  // --- resolve "already ACTUALLY paid on the old site" via ba_settlements ---
  // Both real batches turned out to be status='pending' with paid_amount=0.00
  // — a batch was CREATED but never actually paid out. Being included in a
  // batch's wallet_transactions id list is NOT evidence of payment on its
  // own; only a batch whose own status/paid_amount shows it was genuinely
  // paid counts. (Confirmed directly, 2026-09-17 — do not assume "batched"
  // means "paid" without checking this.)
  let settledIds = new Set<string>();
  try {
    const settlementRows = parseTsv(args.settlementsFile);
    for (const row of settlementRows) {
      const status = (cell(row, "status") ?? "").toLowerCase();
      const paidAmount = Number(cell(row, "paid_amount") ?? "0");
      const wasActuallyPaid = status.includes("paid") || paidAmount > 0;
      if (!wasActuallyPaid) continue;
      const list = cell(row, "wallet_transactions");
      if (!list) continue;
      for (const id of list.split(",")) settledIds.add(id.trim());
    }
    console.log(`Loaded ${settledIds.size} genuinely-paid wallet_transaction id(s) from ${args.settlementsFile}.`);
  } catch {
    console.log(`  (no settlements file at ${args.settlementsFile} — every commission row will import as LOCKED)`);
  }

  // --- dedup: keep only the latest (highest id) bas row per parentid ---
  const byParentId = new Map<string, Record<string, string>>();
  const skippedDuplicateApplications: string[] = [];
  for (const row of basRows) {
    const parentid = cell(row, "parentid");
    const id = cell(row, "id");
    if (!parentid || !id) continue;
    const existing = byParentId.get(parentid);
    if (!existing) {
      byParentId.set(parentid, row);
    } else if (Number(id) > Number(cell(existing, "id"))) {
      skippedDuplicateApplications.push(`bas.id=${cell(existing, "id")} (superseded by bas.id=${id}, parentid=${parentid})`);
      byParentId.set(parentid, row);
    } else {
      skippedDuplicateApplications.push(`bas.id=${id} (older duplicate of bas.id=${cell(existing, "id")}, parentid=${parentid})`);
    }
  }
  console.log(`Deduplicated to ${byParentId.size} unique BA(s) by parentid (${skippedDuplicateApplications.length} older duplicate application(s) skipped).`);

  // --- bulk-load lookup maps ---
  const users = await prisma.user.findMany({ where: { legacyId: { not: null } }, select: { id: true, legacyId: true } });
  const userByLegacyId = new Map(users.map((u) => [u.legacyId!, u.id]));
  function resolveLegacyUserId(legacyId: string): string | null {
    return userByLegacyId.get(legacyId) ?? userByLegacyId.get(`DEALER:${legacyId}`) ?? null;
  }

  const existingBas = await prisma.businessAssociateProfile.findMany({
    select: { id: true, userId: true, panNumber: true, accountNumber: true, referralCode: true },
  });
  const baProfileIdByUserId = new Map(existingBas.map((b) => [b.userId, b.id]));
  const seenPanNumbers = new Map(existingBas.filter((b) => b.panNumber).map((b) => [b.panNumber!, b.userId]));
  const seenAccountNumbers = new Map(existingBas.filter((b) => b.accountNumber).map((b) => [b.accountNumber!, b.userId]));
  const seenReferralCodes = new Set(existingBas.map((b) => b.referralCode));

  const existingPhones = new Map(
    (await prisma.user.findMany({ where: { phone: { not: null } }, select: { phone: true, legacyId: true } }))
      .map((u) => [u.phone!, u.legacyId ?? "existing"]),
  );
  const existingEmails = new Map(
    (await prisma.user.findMany({ where: { email: { not: null } }, select: { email: true, legacyId: true } }))
      .map((u) => [u.email!.toLowerCase(), u.legacyId ?? "existing"]),
  );

  console.log(
    `Loaded ${userByLegacyId.size} legacy user(s), ${existingBas.length} existing BA profile(s).`,
  );

  // --- prepare each BA: resolve or create the underlying User, dedup PAN/account/referralCode ---
  type PreparedBa = {
    legacyParentId: string;
    legacyBasId: string;
    firstName: string;
    lastName: string | null;
    phone: string | null;
    email: string | null;
    pincode: string | null;
    panNumber: string | null;
    panDocKey: string | null;
    chequeDocKey: string | null;
    bankName: string | null;
    bankBranch: string | null;
    accountHolderName: string | null;
    accountNumber: string | null;
    ifsc: string | null;
    referralCode: string;
    createdAt: Date | null;
  };

  const duplicateContacts: DuplicateContactEntry[] = [];
  const prepared: PreparedBa[] = [];
  const newCustomersNeeded: PreparedBa[] = [];

  for (const row of byParentId.values()) {
    const legacyParentId = cell(row, "parentid")!;
    const legacyBasId = cell(row, "id")!;
    const { firstName, lastName } = splitFullName(
      [cell(row, "first_name"), cell(row, "last_name")].filter(Boolean).join(" ") || "(no name)",
    );
    const name = [firstName, lastName].filter(Boolean).join(" ") || "(no name)";

    // seenPanNumbers/seenAccountNumbers are seeded keyed by the OWNER's
    // real User.id (see existingBas above) — a BA's underlying user can be
    // a bare-legacyId CUSTOMER or a "DEALER:"-prefixed DEALER account, so
    // legacyParentId alone can't be compared against that seed directly
    // (bug caught on a real re-run, 2026-09-17: it nulled out PAN/account
    // numbers for essentially every already-migrated BA, since every
    // resolved user's real DB row never matched the bare legacy id it was
    // compared against). Falls back to a stable "NEW:<legacyParentId>"
    // placeholder only for the handful of BAs who don't have a User yet.
    const ownerKey = resolveLegacyUserId(legacyParentId) ?? `NEW:${legacyParentId}`;

    let panNumber = cell(row, "pan") ?? null;
    if (panNumber) {
      const keptBy = seenPanNumbers.get(panNumber);
      if (keptBy && keptBy !== ownerKey) {
        duplicateContacts.push({ field: "panNumber", legacyBaId: legacyBasId, name, originalValue: panNumber, keptByLegacyBaId: keptBy });
        panNumber = null;
      } else if (!keptBy) {
        seenPanNumbers.set(panNumber, ownerKey);
      }
    }

    let accountNumber = cell(row, "account_number") ?? null;
    if (accountNumber) {
      const keptBy = seenAccountNumbers.get(accountNumber);
      if (keptBy && keptBy !== ownerKey) {
        duplicateContacts.push({ field: "accountNumber", legacyBaId: legacyBasId, name, originalValue: accountNumber, keptByLegacyBaId: keptBy });
        accountNumber = null;
      } else if (!keptBy) {
        seenAccountNumbers.set(accountNumber, ownerKey);
      }
    }

    // Real BA-XXXXXXXXXXXX code, same generator + collision policy as live
    // registration (issueUniqueCode in packages/orders/src/ba/profile.ts)
    // — only actually used if this is a brand-new profile (see the write
    // step below: an existing profile's referralCode is never touched on
    // a re-run, so this never silently changes a code someone's already
    // shared).
    let referralCode = generateBaReferralCode();
    for (let attempt = 0; attempt < 12 && seenReferralCodes.has(referralCode); attempt++) {
      referralCode = generateBaReferralCode();
    }
    if (seenReferralCodes.has(referralCode)) {
      throw new Error(`Could not allocate a unique BA referral code for bas.id=${legacyBasId} after 12 attempts.`);
    }
    seenReferralCodes.add(referralCode);

    const rawPhone = cell(row, "contact_number") ?? null;
    const phone = rawPhone ? normalizeIndianPhone(rawPhone) : null;

    const createdAtRaw = cell(row, "created_at");
    const p: PreparedBa = {
      legacyParentId,
      legacyBasId,
      firstName,
      lastName,
      phone,
      email: cell(row, "email") ?? null,
      pincode: cell(row, "pincode") ?? null,
      panNumber,
      panDocKey: cell(row, "pan_attachment") ?? null,
      chequeDocKey: cell(row, "cheque_attachment") ?? null,
      bankName: cell(row, "bank_name") ?? null,
      bankBranch: cell(row, "bank_branch") ?? null,
      accountHolderName: cell(row, "account_holder_name") ?? null,
      accountNumber,
      ifsc: cell(row, "ifsc_code") ?? null,
      referralCode,
      createdAt: createdAtRaw ? new Date(createdAtRaw) : null,
    };
    prepared.push(p);
    if (!resolveLegacyUserId(legacyParentId)) newCustomersNeeded.push(p);
  }

  // --- dedup phone + email for the handful of BAs who need a brand-new User ---
  let newCustomerPhoneDupes = 0;
  let newCustomerEmailDupes = 0;
  for (const p of newCustomersNeeded) {
    if (p.phone) {
      const keptBy = existingPhones.get(p.phone);
      if (keptBy && keptBy !== p.legacyParentId) {
        newCustomerPhoneDupes++;
        p.phone = null;
      } else if (!keptBy) {
        existingPhones.set(p.phone, p.legacyParentId);
      }
    }
    if (p.email) {
      const key = p.email.toLowerCase();
      const keptBy = existingEmails.get(key);
      if (keptBy && keptBy !== p.legacyParentId) {
        newCustomerEmailDupes++;
        p.email = null;
      } else if (!keptBy) {
        existingEmails.set(key, p.legacyParentId);
      }
    }
  }

  console.log(
    `\nBAs: ${prepared.length} to process, ${newCustomersNeeded.length} need a brand-new CUSTOMER account (${newCustomerPhoneDupes} phone collision(s), ${newCustomerEmailDupes} email collision(s), both nulled).`,
  );
  console.log(`  Deduplicated ${duplicateContacts.filter((d) => d.field === "panNumber").length} PAN(s), ${duplicateContacts.filter((d) => d.field === "accountNumber").length} account number(s).`);

  // --- prepare wallet transactions: resolve BA + referee, split self vs non-self, settled vs unsettled ---
  type PreparedEarning = {
    legacyBaParentId: string;
    kind: "REGISTRATION" | "ORDER_COMMISSION";
    amount: string;
    isSelf: boolean;
    referredToLegacyId: string;
    isSettled: boolean;
    createdAt: Date | null;
    legacyWalletTxnId: string;
  };
  const preparedEarnings: PreparedEarning[] = [];
  let skippedNoBaMatch = 0;
  for (const row of walletRows) {
    const userId = cell(row, "user_id");
    const referredTo = cell(row, "referred_to");
    const amount = cell(row, "ba_com_amt");
    const reference = cell(row, "reference");
    const legacyWalletTxnId = cell(row, "id")!;
    const createdAtRaw = cell(row, "created_at");
    if (!userId || !referredTo || !amount) continue;
    if (!byParentId.has(userId)) {
      skippedNoBaMatch++;
      continue;
    }
    const kind: "REGISTRATION" | "ORDER_COMMISSION" =
      reference === "referral_ba_order_commission" ? "ORDER_COMMISSION" : "REGISTRATION";
    preparedEarnings.push({
      legacyBaParentId: userId,
      kind,
      amount,
      isSelf: userId === referredTo,
      referredToLegacyId: referredTo,
      isSettled: settledIds.has(legacyWalletTxnId),
      createdAt: createdAtRaw ? new Date(createdAtRaw) : null,
      legacyWalletTxnId,
    });
  }

  const unresolvedReferees: Array<{ baLegacyParentId: string; referredToLegacyId: string; kind: string; amount: string }> = [];
  let resolvedReferralLinks = 0;
  let settledCount = 0;
  let lockedCount = 0;

  console.log(`\nCommission rows: ${preparedEarnings.length} matched to a known BA (${skippedNoBaMatch} skipped, BA not in scope).`);
  console.log(`  ${preparedEarnings.filter((e) => e.isSelf).length} self-referral (no User.referredByBaId link set for these).`);
  console.log(`  ${preparedEarnings.filter((e) => e.isSettled).length} already settled on the old site -> import as SETTLED.`);

  if (args.dryRun) {
    for (const e of preparedEarnings) {
      if (e.isSelf) continue;
      const refereeUserId = resolveLegacyUserId(e.referredToLegacyId);
      if (refereeUserId) resolvedReferralLinks++;
      else unresolvedReferees.push({ baLegacyParentId: e.legacyBaParentId, referredToLegacyId: e.referredToLegacyId, kind: e.kind, amount: e.amount });
      if (e.isSettled) settledCount++;
      else lockedCount++;
    }
    console.log("\n======================================================================");
    console.log("SUMMARY (DRY RUN — nothing was written)");
    console.log("======================================================================");
    console.log(`BusinessAssociateProfile: ${prepared.length} would-upsert (${newCustomersNeeded.length} new User accounts).`);
    console.log(`BaEarning: ${preparedEarnings.length} would-write (${settledCount + preparedEarnings.filter((e) => e.isSelf && e.isSettled).length} SETTLED, ${lockedCount + preparedEarnings.filter((e) => e.isSelf && !e.isSettled).length} LOCKED).`);
    console.log(`Non-self referral links resolvable now: ${resolvedReferralLinks}. Unresolved (referee not migrated): ${unresolvedReferees.length}.`);
    console.log(`Skipped older duplicate applications: ${skippedDuplicateApplications.length}.`);
    return;
  }

  // --- real write: BusinessAssociateProfile (+ User for the 7 who need one) ---
  let baInserted = 0;
  let baUpdated = 0;
  let newCustomersCreated = 0;
  const baProfileIdByLegacyParentId = new Map<string, string>();

  await processBatches(prepared, BATCH_SIZE, async (batch) => {
    for (const p of batch) {
      try {
        await prisma.$transaction(async (tx) => {
          let userId = resolveLegacyUserId(p.legacyParentId);
          if (!userId) {
            const newUser = await tx.user.upsert({
              where: { legacyId: p.legacyParentId },
              update: {},
              create: {
                legacyId: p.legacyParentId,
                firstName: p.firstName,
                lastName: p.lastName,
                phone: p.phone,
                email: p.email,
                role: UserRole.CUSTOMER,
                referralCode: `CUS-LEGACY-BA-${p.legacyParentId}`,
                isActive: true,
                ...(p.createdAt ? { createdAt: p.createdAt } : {}),
              },
            });
            userId = newUser.id;
            userByLegacyId.set(p.legacyParentId, userId);
            newCustomersCreated++;
          }

          const hasBankDetails = !!(p.accountNumber && p.ifsc && p.accountHolderName);
          const existingProfileId = baProfileIdByUserId.get(userId);

          const data = {
            status: hasBankDetails ? BaStatus.BANK_SUBMITTED : BaStatus.APPROVED,
            firstName: p.firstName,
            lastName: p.lastName ?? "",
            contactNumber: p.phone ?? "",
            email: p.email ?? "",
            pincode: p.pincode ?? "",
            state: "",
            city: "",
            panNumber: p.panNumber,
            panDocKey: p.panDocKey,
            bankName: p.bankName,
            bankBranch: p.bankBranch,
            accountHolderName: p.accountHolderName,
            accountNumber: p.accountNumber,
            ifsc: p.ifsc,
            chequeDocKey: p.chequeDocKey,
            bankStatus: hasBankDetails ? BaBankStatus.APPROVED : BaBankStatus.NOT_SUBMITTED,
            bankSubmittedAt: hasBankDetails ? p.createdAt : null,
            approvedAt: p.createdAt,
          };

          const profile = existingProfileId
            ? await tx.businessAssociateProfile.update({ where: { id: existingProfileId }, data })
            : await tx.businessAssociateProfile.create({
                data: { userId, referralCode: p.referralCode, ...data, ...(p.createdAt ? { createdAt: p.createdAt } : {}) },
              });

          baProfileIdByLegacyParentId.set(p.legacyParentId, profile.id);
          if (existingProfileId) baUpdated++;
          else baInserted++;
        });
      } catch (err) {
        console.log(`  WARNING: BA parentid=${p.legacyParentId} (bas.id=${p.legacyBasId}) failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  // --- real write: BaEarning (+ User.referredByBaId for non-self, resolvable rows) ---
  let earningsInserted = 0;
  let earningsSkippedExisting = 0;
  let referralLinksSet = 0;
  let referralLinksAlreadySetToOther = 0;

  await processBatches(preparedEarnings, BATCH_SIZE, async (batch) => {
    for (const e of batch) {
      const baId = baProfileIdByLegacyParentId.get(e.legacyBaParentId);
      if (!baId) continue;

      let sourceUserId: string | null = null;
      if (e.isSelf) {
        sourceUserId = userByLegacyId.get(e.legacyBaParentId) ?? null;
      } else {
        const refereeUserId = resolveLegacyUserId(e.referredToLegacyId);
        if (!refereeUserId) {
          unresolvedReferees.push({ baLegacyParentId: e.legacyBaParentId, referredToLegacyId: e.referredToLegacyId, kind: e.kind, amount: e.amount });
          continue;
        }
        sourceUserId = refereeUserId;

        const referee = await prisma.user.findUnique({ where: { id: refereeUserId }, select: { referredByBaId: true } });
        if (referee && !referee.referredByBaId) {
          await prisma.user.update({ where: { id: refereeUserId }, data: { referredByBaId: baId } });
          referralLinksSet++;
        } else if (referee && referee.referredByBaId && referee.referredByBaId !== baId) {
          referralLinksAlreadySetToOther++;
        }
      }
      if (!sourceUserId) continue;

      const existing = await prisma.baEarning.findFirst({
        where: { baId, sourceUserId, kind: e.kind, amount: e.amount },
        select: { id: true },
      });
      if (existing) {
        earningsSkippedExisting++;
        continue;
      }

      await prisma.baEarning.create({
        data: {
          baId,
          kind: e.kind,
          status: e.isSettled ? BaEarningStatus.SETTLED : BaEarningStatus.LOCKED,
          amount: e.amount,
          sourceUserId,
          ...(e.kind === "REGISTRATION" ? { flatAmountSnapshot: e.amount } : {}),
          ...(e.createdAt ? { createdAt: e.createdAt, updatedAt: e.createdAt } : {}),
        },
      });
      earningsInserted++;
    }
  });

  console.log("\n======================================================================");
  console.log("SUMMARY");
  console.log("======================================================================");
  console.log(`BusinessAssociateProfile: ${baInserted} inserted, ${baUpdated} updated.`);
  console.log(`New CUSTOMER accounts created: ${newCustomersCreated} of ${newCustomersNeeded.length} needed.`);
  console.log(`BaEarning: ${earningsInserted} inserted, ${earningsSkippedExisting} already present (skipped).`);
  console.log(`User.referredByBaId: ${referralLinksSet} newly linked, ${referralLinksAlreadySetToOther} left alone (already linked to a different BA).`);
  console.log(`Unresolved referees (referee not a migrated User): ${unresolvedReferees.length}.`);
  console.log(`Skipped older duplicate BA applications: ${skippedDuplicateApplications.length}.`);

  mkdirSync(dirname(NOT_FOUND_REPORT_PATH), { recursive: true });
  writeFileSync(
    NOT_FOUND_REPORT_PATH,
    JSON.stringify(
      {
        unresolvedReferees,
        skippedDuplicateApplications,
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote unresolved-referee + duplicate-application report to ${NOT_FOUND_REPORT_PATH}.`);

  if (duplicateContacts.length > 0) {
    writeFileSync(DUPLICATE_REPORT_PATH, JSON.stringify(duplicateContacts, null, 2));
    console.log(`Wrote ${duplicateContacts.length} deduplicated-contact record(s) to ${DUPLICATE_REPORT_PATH}.`);
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
