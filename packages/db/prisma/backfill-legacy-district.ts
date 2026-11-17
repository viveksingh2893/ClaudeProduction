/**
 * One-time backfill for `CustomerAddress.district` on legacy-migrated
 * addresses.
 *
 * migrate-legacy-customers.ts imported the old site's free-text `address`
 * blob verbatim into `line1` without parsing it apart (see the schema
 * comment on CustomerAddress.district) — district was deliberately left
 * null for every migrated row, to be filled in later. As of 2026-08-30,
 * 29,730 of 30,462 CustomerAddress rows (97%) still have a null district,
 * and checkout refuses to snapshot an address without one (see
 * packages/orders/src/checkout-address.ts) — this blocks checkout for
 * almost every legacy customer, not just the odd one.
 *
 * Most of those blobs actually do contain a labeled district — e.g.
 * "Village:- ANNAPURVA, ... District: UNNAO, State : Uttar Pradesh,
 * Pin Code : 209862" — just never pulled out into its own column. This
 * script extracts that label where present.
 *
 * It is deliberately conservative: only rows where a "dist/distt/district"
 * label is found AND the text after it survives sanity checks (plausible
 * length, mostly alphabetic, not equal to the row's own `state`, not a
 * known junk token) get a value. Everything else — no label at all, or a
 * label with unparseable/implausible text after it — is left null and
 * reported separately for manual follow-up (customer self-edit, or an
 * admin fixing it by hand like the AKSHAY KUMAR case that prompted this).
 * This is a parser for messy, customer-typed free text, not a validated
 * gazetteer lookup — it does not attempt to correct spelling.
 *
 * Defaults to a dry run: computes and reports everything, writes nothing.
 * Pass --apply to actually write. Re-running is safe/idempotent either
 * way — the query is always `WHERE district IS NULL`, so already-filled
 * rows (from a prior --apply, or a manual edit) are never touched again.
 *
 * Usage:
 *   tsx prisma/backfill-legacy-district.ts                # dry run, full report
 *   tsx prisma/backfill-legacy-district.ts --limit 200     # dry run, first 200 rows
 *   tsx prisma/backfill-legacy-district.ts --apply         # write for real
 *
 * Report (every run, dry or real) is written to
 * ./legacy-export/district-backfill-report.json — contains raw address
 * text (PII), same as the existing dealer-duplicate-contacts-report.json
 * in that same gitignored directory.
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const REPORT_PATH = "./legacy-export/district-backfill-report.json";
const WRITE_BATCH_SIZE = 500;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

type Args = { apply: boolean; limit: number | null };

function parseArgs(argv: string[]): Args {
  let apply = false;
  let limit: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") apply = true;
    else if (arg === "--limit") limit = Number(argv[++i]);
    else if (arg.startsWith("--limit=")) limit = Number(arg.slice("--limit=".length));
  }
  return { apply, limit };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

// Matches a "dist"/"distt"/"district" label (any case, with or without
// punctuation after it) followed by the text up to the next comma/
// semicolon, a trailing pincode (4-6 digit run — most blobs give the
// district and then run straight into "Pin Code" digits with no further
// label), the next recognized address-field label, or end of string. The
// next label may be separated by whitespace OR a bare period ("District-
// Kurnool.State-Andhra Pradesh" — no space before "State"), hence
// `[\s.]+` rather than `\s+` there. The `.` is intentionally included in
// the capture charset too (some blobs use "District: Bareilly. State:
// UP" — a sentence-style full stop before the next label) and stripped
// back off in cleanDistrict() below, rather than trying to make the
// lookahead perfect.
const DISTRICT_LABEL_RE =
  /\bdist(?:t|rict)?\b\s*[:.\-]*\s*([A-Za-z][A-Za-z0-9 .&'/-]*?)(?=\s*[,;]|\s+\d{4,6}\b|[\s.]+(?:state|pin\s*code|pincode|pin|tehsil|taluka|taluk|block|mandal(?:am)?|village|villege|vill|post\s*office|post|po|ps|landmark|near(?:by)?|gram|panchayat|dist)\b|$)/i;

const JUNK_TOKENS = new Set([
  "n/a",
  "na",
  "nil",
  "none",
  "test",
  "xxx",
  "asdf",
  "-",
  "same",
  "same as above",
  "unknown",
]);

function cleanDistrict(raw: string): string | null {
  const s = raw.replace(/^[\s.,\-&']+|[\s.,\-&']+$/g, "").replace(/\s+/g, " ");
  if (!s) return null;
  return s
    .split(" ")
    .map((word) => {
      // Capitalize the first *letter*, not just index 0 — some tokens
      // carry a leading separator that survived the outer trim because
      // it wasn't at the very edge of the whole string (e.g. "-madhya"
      // inside "Barwanistate -madhya Pradesh").
      const m = word.match(/^([^A-Za-z]*)([A-Za-z].*)$/);
      if (!m) return word;
      const [, prefix, rest] = m;
      return prefix + rest[0].toUpperCase() + rest.slice(1).toLowerCase();
    })
    .join(" ");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Some blobs give district and state back-to-back with nothing usable to
// stop on — no comma, and either no "State" label at all ("...dist
// gulbaraga karnataka pin code 585310") or one glued straight onto the
// preceding word with no space ("District-AjmerState-Rajasthan" — `\b`
// can't fire between "Ajmer" and "State" because both sides are word
// characters, so DISTRICT_LABEL_RE's lookahead never even sees a label
// there). Either way the capture swallows the state name too. The row's
// own `state` column (populated separately during migration, from the
// old `shipping_addresses.state` column — always present, unlike
// district) is a known value we can strip back off the end: an optional
// glued-on "state" word, optional punctuation/whitespace, then the state
// name itself, anchored to the end of the string.
function stripTrailingState(cleaned: string, state: string): string {
  const stateNorm = state.trim();
  if (!stateNorm) return cleaned;
  // The row's own `state` column isn't consistently spaced either (seen
  // both "Uttar Pradesh" and "Uttarpradesh" for the same real state) — so
  // match its words with flexible whitespace between them rather than
  // requiring an exact literal match.
  const statePattern = stateNorm.split(/\s+/).map(escapeRegExp).join("\\s*");
  const re = new RegExp(`(?:state)?[\\s.\\-]*${statePattern}$`, "i");
  const stripped = cleaned.replace(re, "").trim();
  return stripped || cleaned;
}

type ExtractResult =
  | { status: "extracted"; district: string }
  | { status: "no_label" }
  | { status: "unparseable"; rawMatch: string };

function extractDistrict(line1: string, state: string): ExtractResult {
  const match = line1.match(DISTRICT_LABEL_RE);
  if (!match) return { status: "no_label" };

  const rawMatch = match[1];
  const cleanedRaw = cleanDistrict(rawMatch);
  if (!cleanedRaw) return { status: "unparseable", rawMatch };
  const destated = stripTrailingState(cleanedRaw, state) || cleanedRaw;
  // Rare reversed phrasing ("...Palamu district in Jharkhand") makes the
  // capture start mid-sentence on a filler word rather than the district
  // name itself — strip it rather than keep an obviously-wrong result.
  const cleaned = destated.replace(/^(?:in|at|the)\s+/i, "").trim() || destated;

  const letters = cleaned.replace(/[^A-Za-z]/g, "").length;
  const alphaRatio = letters / cleaned.length;

  const isJunk =
    JUNK_TOKENS.has(cleaned.toLowerCase()) ||
    cleaned.length < 3 ||
    cleaned.length > 40 ||
    alphaRatio < 0.7 ||
    /^\d+$/.test(cleaned) ||
    cleaned.toLowerCase() === state.trim().toLowerCase();

  if (isJunk) return { status: "unparseable", rawMatch };
  return { status: "extracted", district: cleaned };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { apply, limit } = parseArgs(process.argv.slice(2));

  console.log(`Mode: ${apply ? "APPLY (will write)" : "DRY RUN (no writes)"}`);
  if (limit) console.log(`Limit: first ${limit} row(s)`);
  console.log();

  const rows = await prisma.customerAddress.findMany({
    where: { district: null },
    select: { id: true, line1: true, state: true },
    orderBy: { createdAt: "asc" },
    ...(limit ? { take: limit } : {}),
  });
  console.log(`Rows with null district: ${rows.length}`);

  const extracted: { id: string; line1: string; district: string }[] = [];
  const noLabel: { id: string; line1: string }[] = [];
  const unparseable: { id: string; line1: string; rawMatch: string }[] = [];

  for (const row of rows) {
    const result = extractDistrict(row.line1, row.state);
    if (result.status === "extracted") {
      extracted.push({ id: row.id, line1: row.line1, district: result.district });
    } else if (result.status === "no_label") {
      noLabel.push({ id: row.id, line1: row.line1 });
    } else {
      unparseable.push({ id: row.id, line1: row.line1, rawMatch: result.rawMatch });
    }
  }

  console.log();
  console.log(`Extracted (will fill):        ${extracted.length}`);
  console.log(`No district label found:      ${noLabel.length}  (needs manual/customer follow-up)`);
  console.log(`Label found, unparseable:     ${unparseable.length}  (needs manual/customer follow-up)`);

  mkdirSync("./legacy-export", { recursive: true });
  writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode: apply ? "apply" : "dry-run",
        totals: {
          nullDistrict: rows.length,
          extracted: extracted.length,
          noLabel: noLabel.length,
          unparseable: unparseable.length,
        },
        extracted,
        noLabel,
        unparseable,
      },
      null,
      2,
    ),
  );
  console.log(`\nFull report written to ${REPORT_PATH}`);

  if (!apply) {
    console.log("\nDry run only — no rows written. Re-run with --apply to write.");
    return;
  }

  console.log(`\nWriting ${extracted.length} row(s)...`);
  let written = 0;
  for (let i = 0; i < extracted.length; i += WRITE_BATCH_SIZE) {
    const batch = extracted.slice(i, i + WRITE_BATCH_SIZE);
    await prisma.$transaction(
      batch.map((row) =>
        prisma.customerAddress.update({
          where: { id: row.id },
          data: { district: row.district },
        }),
      ),
    );
    written += batch.length;
    console.log(`  ${written}/${extracted.length}`);
  }
  console.log(`\nDone. ${written} address(es) updated.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
