/**
 * Legacy product-catalog migration — one-time ETL from the old Laravel/
 * MySQL `kisan4u` DB (srv603843) into this app's Postgres, ALWAYS scoped
 * to a single legacy seller per run (`--seller-name`/`--brand-name`/
 * `--manufacturer-name`, resolved by exact name against the NEW system at
 * runtime, never hardcoded — see resolveTargets()). Whole-catalog
 * migration across sellers in one run is explicitly out of scope.
 *
 * First run: "KATRA FERTILIZERS & CHEMICALS PRIVATE LIMITED" (legacy
 * sellers.id=27, 73 products) → NEW seller/brand/manufacturer "Katra"/
 * "Katra"/"Ezzy". Every seller-specific fact called out below (image host
 * paths, TSV NULL convention, the size×case value patterns, etc.) was
 * learned from that run and has since been confirmed to generalize to a
 * second seller (Royal Traders) unchanged — only LEGACY_CATEGORY_ID_TO_NAME/
 * LEGACY_SUBCATEGORY_ID_TO_NAME may need new entries per seller, since
 * that mapping is keyed by the legacy site's shared category tree, not
 * anything seller-specific, and grows additively across runs.
 *
 * WHY legacyProductId + legacyVariantType (not just one legacyId): the
 * old order_details table only carries `product_id` (-> products.id) and
 * a `variant` snapshot string (e.g. "10Gmx1Nos") — never a stable
 * variant-row id, because the old schema has no real per-variant table
 * (product_stocks is empty; variant data lives as JSON inside
 * products.choice_options/variation, per audience). A later
 * orders-migration phase resolves an old order line by looking up
 * (legacyProductId, legacyVariantType) on ProductVariant/
 * ProductCustomerConfig/ProductDealerConfig — see those models' doc
 * comments in schema.prisma. This phase's whole point is making that
 * lookup possible; it does not itself touch orders. Per the owner's
 * explicit scope: only CUSTOMER-side order linking matters for now, but
 * dealer-side variants are still imported (the data's already there,
 * costs nothing extra, and dealer order-linking will want it eventually).
 *
 * Known simplifications/assumptions — flagged in the dry-run report, ask
 * before trusting a real run if any of these look wrong:
 *   - Legacy variant JSON has no MRP field, only `price`/`dealer_price`
 *     (selling price) and `purchasePrice` (cost, not customer-facing).
 *     mrp is set equal to sellingPrice (no variant-level discount) —
 *     there is no legacy source for a "real" MRP at the variant level.
 *   - height/breadth/length in the legacy JSON are assumed centimetres
 *     (schema wants metres) — divided by 100. Not verified against the
 *     old site's actual unit convention, just inferred from plausible
 *     magnitudes (e.g. "19" as 19cm makes sense for a bottle; 19m does not).
 *   - No legacy field maps to Product.dosageInstructions/technicalInfo —
 *     left null. No legacy field maps to Product.shortDescription either
 *     (only one combined `details` blob) — derived by stripping HTML
 *     tags from `details` and truncating to ~200 chars.
 *   - Imported products default to lifecycleStatus DRAFT (the schema
 *     default), not auto-APPROVED — legacy `published`/`status` flags
 *     were inconsistent/unclear in the sample data, so the conservative,
 *     reversible choice (admin reviews and approves) was made instead of
 *     guessing these should go live immediately.
 *   - Legacy `states` is a single shared list (no separate customer/
 *     dealer distinction) — applied identically to both
 *     customerAvailableStates and dealerAvailableStates.
 *   - Images: legacy `thumbnail`/`images[]`/`meta_image` are bare
 *     filenames on three DIFFERENT confirmed-working paths under
 *     admin.kisan4u.com (see LEGACY_*_BASE_URL below — verified by real
 *     HEAD+GET requests, not assumed). No per-variant images exist in the
 *     legacy data at all (checked: `variation[]`/`dealer_variation[]`
 *     have no image field), so every imported image lands in
 *     catalogImagePaths.productBase's `base/` folder, never `variants/`.
 *     Each is actually fetched, validated, resized, and re-hosted locally
 *     via @kisan4u/providers' `processAndUploadCatalogImageFromUrl` (the
 *     same SSRF-hardened, magic-byte-verified pipeline the real seller/
 *     admin product-image upload actions use) — never a raw hotlinked
 *     URL. This only runs on a real (non-dry-run) pass, after the
 *     product's own row exists (its id is part of the storage path), as
 *     a follow-up update — see ingestProductImages().
 *   - Negative discount/dealer_discount values (seen in the wider
 *     catalog, e.g. legacy product 19) are clamped to 0 rather than
 *     imported as-is — flagged in the report when it happens.
 *
 * Variant attribute-value strings: the legacy dealer (and occasionally
 * customer) side combines two dimensions into one string, e.g.
 * "10Gmx50Nos" = Size x Case-count, inconsistently separated
 * (x/X/×/*, stray whitespace, optional trailing "." on the unit,
 * sometimes reversed order). See classifyVariantValue() — confirmed
 * against all 359 real option values in Katra's 73 products, with two
 * product-specific rules confirmed by the owner: the "K-Lysorus..."
 * product's "Lysorus06Nos"-style values strip that literal prefix and
 * become a bare Case count (no Size dimension for that product), and the
 * Kosabi-style container descriptors ("10KgBucket"/"20kgbag") are left
 * as a single plain value on purpose (no real case-count to extract).
 *
 * Category/subcategory resolution: legacy category_id/sub_category_id
 * map directly (no tree-walking needed) via LEGACY_CATEGORY_ID_TO_NAME/
 * LEGACY_SUBCATEGORY_ID_TO_NAME below — built from a one-time manual
 * cross-reference against categories.tsv and the live NEW-system
 * Category/Subcategory tables (see the memory doc / conversation this
 * script came out of). Resolved by NAME at runtime (never hardcoded
 * ids), so this stays correct even if ids change; errors loudly if any
 * mapped name is missing from the live DB rather than silently skipping.
 *
 * Run with --dry-run to compute and print every report without writing
 * anything. Re-running for real is safe/idempotent: Product is upserted
 * by legacyId; ProductVariant/ProductCustomerConfig/ProductDealerConfig
 * are upserted by (legacyProductId, legacyVariantType).
 *
 * Usage (all of --products-file/--tags-file/--seller-name/--brand-name/
 * --manufacturer-name are required — no per-seller default, since
 * guessing wrong here means silently importing into/as the wrong seller):
 *   tsx prisma/migrate-legacy-products.ts --dry-run \
 *     --products-file ./legacy-export/products_royal.tsv \
 *     --tags-file ./legacy-export/product_tags_royal.tsv \
 *     --seller-name "Royal Traders" --brand-name "Royal" --manufacturer-name "royal"
 *   UPLOAD_STORAGE_ROOT=../../apps/web/storage/uploads \
 *     tsx prisma/migrate-legacy-products.ts \
 *     --products-file ./legacy-export/products_royal.tsv \
 *     --tags-file ./legacy-export/product_tags_royal.tsv \
 *     --seller-name "Royal Traders" --brand-name "Royal" --manufacturer-name "royal"
 *
 * UPLOAD_STORAGE_ROOT is required for a real run — this script runs from
 * packages/db, not apps/web, so without it @kisan4u/providers'
 * localStorageProvider (see packages/providers/src/storage.ts) writes
 * images under packages/db's own cwd instead of the directory apps/web's
 * `/api/uploads/[...path]` route actually serves from. Same convention
 * already documented in storage.ts for any other write-only caller.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import {
  PrismaClient,
  ProductType,
  ProductAudience,
  BaseUnit,
  VariantAudience,
  ShippingCalcMode,
} from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { processAndUploadCatalogImageFromUrl, catalogImagePaths } from "@kisan4u/providers";

// Confirmed by real HEAD+GET requests (not assumed) — three different
// paths depending on which legacy field the filename came from.
const LEGACY_THUMBNAIL_BASE_URL = "https://admin.kisan4u.com/storage/app/public/product/thumbnail";
const LEGACY_GALLERY_BASE_URL = "https://admin.kisan4u.com/storage/app/public/product";
const LEGACY_META_IMAGE_BASE_URL = "https://admin.kisan4u.com/storage/app/public/product/meta";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const BATCH_SIZE = 25; // small on purpose — each product does several nested writes (attributes, values, variants)


// legacy products.category_id -> NEW Category.name
const LEGACY_CATEGORY_ID_TO_NAME: Record<string, string> = {
  "26": "Plant Nutrients",
  "25": "Plant Protection",
  "30": "Gardening Product",
  "28": "Spray Pump",
  "63": "Sticker And Spreader",
  "32": "Tarpaulin",
  "65": "Personal Care",
};

// legacy products.sub_category_id -> NEW Subcategory.name
const LEGACY_SUBCATEGORY_ID_TO_NAME: Record<string, string> = {
  "40": "Bio Fertilisers",
  "41": "Bio Stimulant",
  "38": "Fertilisers",
  "39": "Micronutrients",
  "36": "Bio Pesticide",
  "34": "Fungicide",
  "33": "Insecticide",
  "55": "Home Garden Pest Management",
  "54": "Nutrients",
  "50": "Spray Pump Spare Parts",
  "64": "Silicon Spreader",
  "42": "PGR", // Plant Growth Regulator — under Plant Nutrients, first needed by Geolife
  "35": "Herbicide", // under Plant Protection, first needed by Sarvin Agro Chemicals
};

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

type Args = {
  productsFile: string;
  tagsFile: string;
  dryRun: boolean;
  sellerName: string;
  brandName: string;
  manufacturerName: string;
};

function parseArgs(argv: string[]): Args {
  let productsFile = "";
  let tagsFile = "";
  let dryRun = false;
  let sellerName = "";
  let brandName = "";
  let manufacturerName = "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--products-file") productsFile = argv[++i]!;
    else if (arg.startsWith("--products-file=")) productsFile = arg.slice("--products-file=".length);
    else if (arg === "--tags-file") tagsFile = argv[++i]!;
    else if (arg.startsWith("--tags-file=")) tagsFile = arg.slice("--tags-file=".length);
    else if (arg === "--seller-name") sellerName = argv[++i]!;
    else if (arg.startsWith("--seller-name=")) sellerName = arg.slice("--seller-name=".length);
    else if (arg === "--brand-name") brandName = argv[++i]!;
    else if (arg.startsWith("--brand-name=")) brandName = arg.slice("--brand-name=".length);
    else if (arg === "--manufacturer-name") manufacturerName = argv[++i]!;
    else if (arg.startsWith("--manufacturer-name=")) manufacturerName = arg.slice("--manufacturer-name=".length);
  }

  // No sensible per-seller default for any of these — every migration run
  // is scoped to exactly one legacy seller (see module doc comment), so
  // guessing wrong here means silently importing into/as the wrong
  // seller. Fail loudly instead.
  const missing = [
    !productsFile && "--products-file",
    !tagsFile && "--tags-file",
    !sellerName && "--seller-name",
    !brandName && "--brand-name",
    !manufacturerName && "--manufacturer-name",
  ].filter((v): v is string => !!v);
  if (missing.length > 0) {
    throw new Error(`Missing required argument(s): ${missing.join(", ")}`);
  }

  return { productsFile, tagsFile, dryRun, sellerName, brandName, manufacturerName };
}

// ---------------------------------------------------------------------------
// TSV parsing — same convention as migrate-legacy-customers.ts.
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

function safeJsonArray(raw: string | undefined): any[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Number/unit helpers
// ---------------------------------------------------------------------------

function toInt(raw: unknown, fallback = 0): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toDecimalString(raw: unknown, fallback = "0"): string {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  return Number.isFinite(n) ? String(n) : fallback;
}

/** Legacy height/breadth/length look like small centimetre values; schema wants metres. */
function cmToMetres(raw: unknown): string | null {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(n / 100);
}

/**
 * MRP of one individual piece inside this variant's case — the variant's
 * own mrp (here, sellingPrice; see the "no legacy MRP source" note at the
 * variantData construction site) divided by whatever number the "Case"
 * attribute value carries (e.g. "50Nos" -> 50). Null when there's no Case
 * attribute at all — see ProductVariant.perUnitMrp's schema doc comment
 * for why that's left null rather than defaulted to the variant's own mrp.
 */
function computePerUnitMrp(mrp: string, attributeValues: Array<{ attributeName: string; value: string }>): string | null {
  const caseAttr = attributeValues.find((a) => a.attributeName === "Case");
  if (!caseAttr) return null;
  const caseCount = parseInt(caseAttr.value, 10);
  if (!Number.isFinite(caseCount) || caseCount <= 0) return null;
  const mrpNum = parseFloat(mrp);
  if (!Number.isFinite(mrpNum)) return null;
  return String(mrpNum / caseCount);
}

/** Negative discounts are bad legacy data (seen in the wider catalog) — clamp to 0, never import as-is. */
function clampDiscount(raw: unknown): { value: number; wasNegative: boolean } {
  const n = toInt(raw, 0);
  return n < 0 ? { value: 0, wasNegative: true } : { value: n, wasNegative: false };
}

/** Plain-text short description from the legacy HTML `details` blob — strip tags, collapse whitespace, truncate. */
function htmlToShortText(html: string | undefined, maxLen = 200): string {
  if (!html) return "";
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen - 1).trimEnd() + "…" : text;
}

// ---------------------------------------------------------------------------
// Variant attribute-value string classifier — see module doc comment.
// ---------------------------------------------------------------------------

// Tolerates a stray space after the decimal point ("7. 5 g." — confirmed
// real, Geolife) as well as the normal "7.5g" form.
const SIZE = /\d+(?:\.\s*\d+)?\s*[a-zA-Z]+\.?/;
// Trailing "." tolerated after "nos" itself too, not just after the unit —
// confirmed real (Royal Traders' "100mlx50nos."), same class of stray
// punctuation as the unit-trailing-period case already handled. "pcs" is
// an equivalent case-count word, confirmed real (Sarvin Agro Chemicals'
// "50mlx20pcs") — normalizeCaseCount() always outputs "Nos" regardless of
// which word matched, so this is purely a wider input match, not a
// behavior change for existing sellers' data.
const FORWARD = new RegExp(`^\\s*(${SIZE.source})\\s*[x×X*]\\s*(\\d+)\\s*(?:nos|pcs)\\.?\\s*$`, "i");
const REVERSED = new RegExp(`^\\s*(\\d+)\\s*(?:nos|pcs)\\.?\\s*[x×X*]\\s*(${SIZE.source})\\s*$`, "i");
const REDUNDANT_CASE = /^\s*(\d+)\s*nos\.?\s*[x×X*]\s*1\s*case\s*$/i;
const PLAIN_SIZE = new RegExp(`^\\s*(${SIZE.source})\\s*$`, "i");
// Product-specific: "K-Lysorus + Activator 1gm+50ml" prefixes its own name onto a bare case count.
const KNOWN_PREFIXES = ["Lysorus"];

// Kay Bee-specific: some of their variant "type" values are their own
// internal SKU code (e.g. "K4-BS-250ML", "K4-O3K-0001LT") instead of a
// plain size string, inconsistently mixed into the SAME product's own
// variation array alongside a plain "100mlx1Nos"-style sibling entry for
// the smallest pack size — confirmed real by reading the raw JSON directly
// (Balanstick's 5-entry array is exactly this: one normal entry + four
// K4-code entries, all single-unit retail packs, never a case/bulk pack).
// Every Kay Bee product is CUSTOMER_ONLY (audience "farmer"), so there is
// no dealer bulk-case concept to preserve here — Case is always 1Nos,
// matching the sibling entry's own explicit "x1Nos".
const K4_PREFIX_SIZE = new RegExp(`^K4-[A-Za-z0-9]+-0*(\\d+(?:\\.\\s*\\d+)?)\\s*([a-zA-Z]+)\\.?$`, "i");

// Geolife-specific packaging convention, confirmed real across ~100 real
// values: a size, then one or two bare-number multipliers (no "nos" word
// at all — e.g. "50 g. X 100" = 50g pack, 100 per case; "(50 g. X 50) X 2"
// = 50g pack, 50-per-inner-pack x 2-inner-packs-per-case = 100 total).
// Optional parenthesis grouping is cosmetic and ignored; the case count is
// always the PRODUCT of every multiplier found, not just the first one.
const CASE_CHAIN = new RegExp(`^\\(?\\s*(${SIZE.source})\\s*\\)?\\s*[x×X*]\\s*(\\d+)\\s*(?:\\)?\\s*[x×X*]\\s*(\\d+))?\\s*$`, "i");
// Reversed order of the same convention: "50 X 100 g." = 100g pack, 50 per case.
const CASE_CHAIN_REVERSED = new RegExp(`^\\s*(\\d+)\\s*[x×X*]\\s*(${SIZE.source})\\s*$`, "i");
// "4 (100 X 15 g.)" = 15g pack, 100-per-inner-pack x 4-inner-packs-per-case.
const CASE_CHAIN_PREFIX_NUM = new RegExp(`^\\s*(\\d+)\\s*\\(\\s*(\\d+)\\s*[x×X*]\\s*(${SIZE.source})\\s*\\)\\s*$`, "i");

type ClassifiedValue =
  | { kind: "split"; size: string; caseCount: string }
  | { kind: "size-only"; size: string }
  | { kind: "case-only"; caseCount: string }
  | { kind: "manual-review"; raw: string };

/**
 * Canonicalizes a matched size token (e.g. "10Gm", "10gm", "10GM") to one
 * consistent form ("10Gm") — digits unchanged, unit Title-cased. Without
 * this, the SAME real value entered with different casing on different
 * legacy rows of the same product (confirmed happening, e.g. "10Gm" vs
 * "10gm") produces two different `value` strings that still collide on
 * ProductVariantAttributeValue's separate (productId, attributeId, slug)
 * unique constraint, since slugify() lowercases — caught for real on the
 * first full run, not just theorized.
 */
function normalizeSizeToken(raw: string): string {
  // Collapse a stray space after the decimal point ("7. 5" -> "7.5",
  // confirmed real, Geolife) before matching digits.
  const m = /^(\d+(?:\.\s*\d+)?)\s*([a-zA-Z]+)\.?$/.exec(raw.trim());
  if (!m) return raw.trim();
  const digits = m[1]!.replace(/\s+/g, "");
  // Drop any trailing "." on the unit ("1Ltr." vs "1Ltr") — kept out of
  // the capture group entirely now, not just lowercased, since two
  // values differing only by that period still slugify identically
  // (slugify() strips punctuation) and re-collide on the slug unique
  // constraint even though normalizeSizeToken alone made them distinct
  // strings — caught for real on a second full run, not just theorized.
  const unit = m[2]!.toLowerCase();
  return `${digits}${unit.charAt(0).toUpperCase()}${unit.slice(1)}`;
}

/** Strips leading zeros ("01" -> "1") so the same real count from different rows always produces the same value/slug. */
function normalizeCaseCount(raw: string): string {
  return `${parseInt(raw, 10)}Nos`;
}

/** Same normalization as normalizeCaseCount, but for an already-computed number (Geolife's multi-level case chains — see CASE_CHAIN's doc comment). */
function formatCaseCount(n: number): string {
  return `${n}Nos`;
}

// One-off legacy data-entry typos of the word "Nos" itself, confirmed real
// (Torrent Crop Science) — not a structural pattern worth a fuzzy regex
// (which risks false-matching unrelated text), just 3 exact known-bad
// strings corrected to what they were clearly supposed to say before
// classification runs.
const KNOWN_TYPO_FIXES: Record<string, string> = {
  "250ML*40N0s": "250ML*40Nos",
  "100mlX1Noa": "100mlX1Nos",
  "500mlX1NNos": "500mlX1Nos",
};

function classifyVariantValue(rawValue: string): ClassifiedValue {
  // strip stray control characters AND their literal two-character escape
  // form (backslash+t/n/r) — the legacy TSV export renders an actual
  // embedded tab/newline typo'd into an admin form field as literal `\t`
  // text, not a real control byte, so both forms need stripping.
  let v = rawValue.replace(/\\[tnr]/g, "").replace(/[\t\n\r]/g, "").trim();
  if (KNOWN_TYPO_FIXES[v]) v = KNOWN_TYPO_FIXES[v];
  let m: RegExpExecArray | null;
  if ((m = FORWARD.exec(v)))
    return { kind: "split", size: normalizeSizeToken(m[1]!), caseCount: normalizeCaseCount(m[2]!) };
  if ((m = REVERSED.exec(v)))
    return { kind: "split", size: normalizeSizeToken(m[2]!), caseCount: normalizeCaseCount(m[1]!) };
  if ((m = REDUNDANT_CASE.exec(v))) return { kind: "case-only", caseCount: normalizeCaseCount(m[1]!) };
  if ((m = CASE_CHAIN_PREFIX_NUM.exec(v))) {
    const total = parseInt(m[1]!, 10) * parseInt(m[2]!, 10);
    return { kind: "split", size: normalizeSizeToken(m[3]!), caseCount: formatCaseCount(total) };
  }
  if ((m = CASE_CHAIN.exec(v))) {
    const total = m[3] ? parseInt(m[2]!, 10) * parseInt(m[3]!, 10) : parseInt(m[2]!, 10);
    return { kind: "split", size: normalizeSizeToken(m[1]!), caseCount: formatCaseCount(total) };
  }
  if ((m = CASE_CHAIN_REVERSED.exec(v)))
    return { kind: "split", size: normalizeSizeToken(m[2]!), caseCount: normalizeCaseCount(m[1]!) };
  if (PLAIN_SIZE.test(v)) return { kind: "size-only", size: normalizeSizeToken(v) };
  if ((m = K4_PREFIX_SIZE.exec(v)))
    return { kind: "split", size: normalizeSizeToken(`${m[1]}${m[2]}`), caseCount: "1Nos" };
  for (const prefix of KNOWN_PREFIXES) {
    if (v.startsWith(prefix)) {
      const mm = /^(\d+)\s*nos$/i.exec(v.slice(prefix.length).trim());
      if (mm) return { kind: "case-only", caseCount: normalizeCaseCount(mm[1]!) };
    }
  }
  return { kind: "manual-review", raw: v };
}

/** Sorted attribute-value-id join — must match packages/catalog/src/combination-key.ts exactly. */
function buildCombinationKey(attributeValueIds: string[]): string {
  return [...attributeValueIds].sort().join(",");
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Resolve fixed targets (seller/brand/manufacturer/categories/states) once.
// ---------------------------------------------------------------------------

type Targets = {
  sellerId: string;
  brandId: string;
  manufacturerId: string;
  categoryIdByName: Map<string, string>;
  subcategoryIdByName: Map<string, string>;
  /** Derived from --seller-name (e.g. "Royal Traders" -> "ROYAL-TRADERS") — prefixes every generated SKU so it can never collide with unrelated pre-existing data, same reasoning per seller as the original Katra run's "KATRA-LEGACY-" prefix. */
  skuPrefix: string;
};

async function resolveTargets(args: Args): Promise<Targets> {
  const seller = await prisma.sellerProfile.findFirst({ where: { shopName: args.sellerName } });
  if (!seller) throw new Error(`Target seller "${args.sellerName}" not found — aborting rather than guessing.`);

  const brand = await prisma.brand.findUnique({ where: { name: args.brandName } });
  if (!brand) throw new Error(`Target brand "${args.brandName}" not found — aborting rather than guessing.`);

  const manufacturer = await prisma.manufacturer.findUnique({ where: { name: args.manufacturerName } });
  if (!manufacturer) throw new Error(`Target manufacturer "${args.manufacturerName}" not found — aborting.`);

  const neededCategoryNames = [...new Set(Object.values(LEGACY_CATEGORY_ID_TO_NAME))];
  const categories = await prisma.category.findMany({ where: { name: { in: neededCategoryNames } } });
  const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));
  for (const name of neededCategoryNames) {
    if (!categoryIdByName.has(name)) throw new Error(`Expected Category "${name}" not found — aborting.`);
  }

  const neededSubNames = [...new Set(Object.values(LEGACY_SUBCATEGORY_ID_TO_NAME))];
  const subcategories = await prisma.subcategory.findMany({ where: { name: { in: neededSubNames } } });
  const subcategoryIdByName = new Map(subcategories.map((s) => [s.name, s.id]));
  for (const name of neededSubNames) {
    if (!subcategoryIdByName.has(name)) throw new Error(`Expected Subcategory "${name}" not found — aborting.`);
  }

  return {
    sellerId: seller.id,
    brandId: brand.id,
    manufacturerId: manufacturer.id,
    categoryIdByName,
    subcategoryIdByName,
    skuPrefix: slugify(args.sellerName).toUpperCase(),
  };
}

// ---------------------------------------------------------------------------
// Prepare products
// ---------------------------------------------------------------------------

type PreparedVariant = {
  audience: "CUSTOMER" | "DEALER";
  legacyVariantType: string; // "CUSTOMER:10Gmx1Nos" / "DEALER:10Gmx1Nos" — audience-prefixed, see the push site's comment for why
  attributeValues: Array<{ attributeName: string; value: string }>; // 1 or 2 entries
  sku: string;
  sellingPrice: string;
  // MRP of one individual piece inside this variant's case, i.e. mrp / case
  // count — null when there's no "Case" attribute to divide by (see
  // ProductVariant.perUnitMrp's schema doc comment for the full rationale).
  perUnitMrp: string | null;
  stockQty: number;
  weight: number | null;
  heightM: string | null;
  breadthM: string | null;
  lengthM: string | null;
  shippingCost: string | null;
  shippingCalcMode: ShippingCalcMode;
  isActive: boolean;
};

type PreparedProduct = {
  legacyId: string;
  name: string;
  slug: string;
  sku: string;
  hsnCode: string;
  shortDescription: string;
  description: string;
  ingredients: string | null;
  howToUse: string | null;
  audience: ProductAudience;
  baseUnit: BaseUnit;
  packageSize: string;
  // Raw legacy filenames — resolved into real, locally-hosted URLs by
  // ingestProductImages() on a real run, after the Product row exists.
  thumbnailFilename: string | null;
  galleryFilenames: string[];
  metaImageFilename: string | null;
  videoUrl: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  categoryId: string;
  subCategoryId: string | null;
  customerStateIds: string[];
  dealerStateIds: string[];
  searchTags: string[];
  variants: PreparedVariant[]; // empty when the product has no real variant data
  minOrderQtyCustomer: number;
  minOrderQtyDealer: number;
  currentStockCustomer: number;
  currentStockDealer: number;
  customerSellingPrice: string;
  dealerSellingPrice: string;
};

type PrepareDiagnostics = {
  unresolvedCategoryIds: Set<string>;
  unresolvedSubcategoryIds: Set<string>;
  manualReviewValues: Array<{ legacyId: string; name: string; side: string; value: string }>;
  negativeDiscountCount: number;
  productsWithNoThumbnail: number;
};

const BASE_UNIT_MAP: Record<string, BaseUnit> = {
  ltrs: BaseUnit.L,
  kg: BaseUnit.KG,
  gms: BaseUnit.G,
  pc: BaseUnit.PIECE,
};

const AUDIENCE_MAP: Record<string, ProductAudience> = {
  farmer: ProductAudience.CUSTOMER_ONLY,
  dealer: ProductAudience.DEALER_ONLY,
  both_farmer_dealer: ProductAudience.BOTH_CUSTOMER_AND_DEALER,
};

/** "def.png" is the legacy system's own generic placeholder, never real content — treated as absent. */
function realFilename(filename: string | undefined): string | null {
  return filename && filename !== "def.png" ? filename : null;
}

function prepareProducts(
  rows: Record<string, string>[],
  tagsByProductId: Map<string, string[]>,
  targets: Targets,
): { prepared: PreparedProduct[]; diagnostics: PrepareDiagnostics } {
  const diagnostics: PrepareDiagnostics = {
    unresolvedCategoryIds: new Set(),
    unresolvedSubcategoryIds: new Set(),
    manualReviewValues: [],
    negativeDiscountCount: 0,
    productsWithNoThumbnail: 0,
  };
  const prepared: PreparedProduct[] = [];

  for (const row of rows) {
    const legacyId = cell(row, "id");
    if (!legacyId) continue;
    const name = cell(row, "name") ?? `(untitled ${legacyId})`;

    // --- category/subcategory ---
    const legacyCategoryId = cell(row, "category_id");
    const legacySubCategoryId = cell(row, "sub_category_id");
    const categoryName = legacyCategoryId ? LEGACY_CATEGORY_ID_TO_NAME[legacyCategoryId] : undefined;
    const subCategoryName = legacySubCategoryId ? LEGACY_SUBCATEGORY_ID_TO_NAME[legacySubCategoryId] : undefined;
    if (legacyCategoryId && !categoryName) diagnostics.unresolvedCategoryIds.add(legacyCategoryId);
    if (legacySubCategoryId && !subCategoryName) diagnostics.unresolvedSubcategoryIds.add(legacySubCategoryId);
    const categoryId = categoryName ? targets.categoryIdByName.get(categoryName) : undefined;
    const subCategoryId = subCategoryName ? targets.subcategoryIdByName.get(subCategoryName) ?? null : null;
    if (!categoryId) continue; // can't place this product at all — skip, don't guess

    // --- states: "select wherever applicable" for every product (owner's
    // decision) — nationwide (empty list, this schema's own "Pan India"
    // convention), not the legacy per-product `states` list. All
    // LicenceRequirement rows that would have gated this were deleted as
    // part of the same decision, so nationwide is correct either way: no
    // licence anywhere currently restricts any state for any product.
    const stateIds: string[] = [];

    // --- tags ---
    const searchTags = tagsByProductId.get(legacyId) ?? [];

    // --- images (raw filenames only — actually fetched in ingestProductImages) ---
    const thumbnailFilename = realFilename(cell(row, "thumbnail"));
    if (!thumbnailFilename) diagnostics.productsWithNoThumbnail++;
    const galleryFilenames: string[] = safeJsonArray(cell(row, "images")).map(String).filter(Boolean);
    const metaImageFilename = realFilename(cell(row, "meta_image"));

    // --- discounts (clamp negative) ---
    const custDiscount = clampDiscount(cell(row, "discount"));
    const dealDiscount = clampDiscount(cell(row, "dealer_discount"));
    if (custDiscount.wasNegative || dealDiscount.wasNegative) diagnostics.negativeDiscountCount++;

    // --- variants (customer + dealer sides independently) ---
    const variants: PreparedVariant[] = [];
    const sides: Array<["CUSTOMER" | "DEALER", string, string, number, ShippingCalcMode]> = [];
    // populated below per side after parsing variation arrays

    function parseSide(
      audience: "CUSTOMER" | "DEALER",
      choiceKey: string,
      variationKey: string,
      typeKey: string,
      priceKey: string,
      skuKey: string,
      qtyKey: string,
      heightKey: string,
      breadthKey: string,
      lengthKey: string,
      weightKey: string,
      shippingCostKey: string,
      shippingModelKey: string,
      isActiveKey: string,
    ) {
      const choiceOptions = safeJsonArray(cell(row, choiceKey));
      const variationEntries = safeJsonArray(cell(row, variationKey));
      if (choiceOptions.length === 0 || variationEntries.length === 0) return;

      // attribute name lookup: option value -> which attribute it came from (for classification context/logging only)
      const attrTitleByValue = new Map<string, string>();
      for (const attr of choiceOptions) {
        for (const opt of attr.options ?? []) attrTitleByValue.set(String(opt).trim(), attr.title ?? attr.name ?? "Attribute");
      }

      for (const entry of variationEntries) {
        const rawType = String(entry[typeKey] ?? "").trim();
        if (!rawType) continue;
        const classified = classifyVariantValue(rawType);
        let attributeValues: Array<{ attributeName: string; value: string }>;
        if (classified.kind === "split") {
          attributeValues = [
            { attributeName: "Size", value: classified.size },
            { attributeName: "Case", value: classified.caseCount },
          ];
        } else if (classified.kind === "case-only") {
          attributeValues = [{ attributeName: "Case", value: classified.caseCount }];
        } else if (classified.kind === "size-only") {
          attributeValues = [{ attributeName: "Size", value: classified.size }];
        } else {
          diagnostics.manualReviewValues.push({ legacyId, name, side: audience, value: classified.raw });
          continue; // don't guess — skip this one variant entry, product still imports with its other variants
        }

        variants.push({
          audience,
          // Audience-prefixed, NOT the bare raw type string — confirmed a
          // real (not hypothetical) collision: 2 of Katra's 73 products
          // have the exact same raw type ("1Nos") on BOTH their customer
          // and dealer side. Without this prefix, the second one to
          // process silently overwrote the first via upsert (same
          // (legacyProductId, legacyVariantType) key), corrupting the row
          // — its audience stayed whatever the first insert set, while its
          // price/stock silently became the second side's data. Caught by
          // a direct DB count not matching the script's own "written"
          // count, not by any thrown error. A later orders-migration must
          // build this exact same prefix from the order's own customer-
          // vs-dealer context (order_details.variant alone was never
          // enough to know which) before looking a row up by this key.
          legacyVariantType: `${audience}:${rawType}`,
          attributeValues,
          // Per-seller prefix (targets.skuPrefix — also on Product.sku
          // below) guarantees this can never collide with unrelated
          // pre-existing/future SKU data sharing this same staging DB —
          // confirmed a real, not hypothetical, risk on the first ever
          // run (Katra): legacy `code` alone ("Virus-G1") collided with
          // an unrelated pre-existing seeded product.
          sku: `${targets.skuPrefix}-LEGACY-${(cell(row, "code") ?? legacyId).replace(/[^a-zA-Z0-9]+/g, "-")}-${audience === "CUSTOMER" ? "CUS" : "DEA"}-${slugify(rawType)}`,
          sellingPrice: toDecimalString(entry[priceKey], "0"),
          perUnitMrp: computePerUnitMrp(toDecimalString(entry[priceKey], "0"), attributeValues),
          stockQty: toInt(entry[qtyKey], 0),
          weight: entry[weightKey] != null ? toInt(entry[weightKey], 0) || null : null,
          heightM: cmToMetres(entry[heightKey]),
          breadthM: cmToMetres(entry[breadthKey]),
          lengthM: cmToMetres(entry[lengthKey]),
          shippingCost: entry[shippingCostKey] != null ? toDecimalString(entry[shippingCostKey], "0") : null,
          shippingCalcMode:
            String(entry[shippingModelKey] ?? "").toLowerCase() === "exclude"
              ? ShippingCalcMode.EXCLUDE_WITH_PRODUCT
              : ShippingCalcMode.INCLUDE_WITH_PRODUCT,
          isActive: entry[isActiveKey] !== false,
        });
      }
    }

    parseSide(
      "CUSTOMER", "choice_options", "variation", "type", "price", "sku", "qty",
      "height", "breadth", "length", "weight", "shipping_cost", "shipping_model", "isActive",
    );
    parseSide(
      "DEALER", "dealer_choice_options", "dealer_variation", "dealer_type", "dealer_price", "dealer_sku", "dealer_qty",
      "dealer_height", "dealer_breadth", "dealer_length", "dealer_weight", "dealer_shipping_cost", "dealer_shipping_model", "dealer_isActive",
    );

    const audienceRaw = cell(row, "product_for") ?? "both_farmer_dealer";
    const unitRaw = (cell(row, "unit") ?? "").toLowerCase();

    prepared.push({
      legacyId,
      name,
      slug: cell(row, "slug") ?? `product-${legacyId}`,
      sku: `${targets.skuPrefix}-LEGACY-${cell(row, "code") ?? legacyId}`,
      hsnCode: cell(row, "hsnCode") ?? "",
      shortDescription: htmlToShortText(cell(row, "details")),
      description: cell(row, "details") ?? "",
      ingredients: cell(row, "ingredients") ?? null,
      howToUse: cell(row, "how_to_use") ?? null,
      audience: AUDIENCE_MAP[audienceRaw] ?? ProductAudience.BOTH_CUSTOMER_AND_DEALER,
      baseUnit: BASE_UNIT_MAP[unitRaw] ?? BaseUnit.PIECE,
      packageSize: unitRaw ? unitRaw.toUpperCase() : "",
      thumbnailFilename,
      galleryFilenames,
      metaImageFilename,
      videoUrl: cell(row, "video_url") ?? null,
      metaTitle: cell(row, "meta_title") ?? null,
      metaDescription: cell(row, "meta_description") ?? null,
      categoryId,
      subCategoryId,
      customerStateIds: stateIds,
      dealerStateIds: stateIds,
      searchTags,
      variants,
      minOrderQtyCustomer: toInt(cell(row, "minimum_order_qty"), 1) || 1,
      minOrderQtyDealer: toInt(cell(row, "dealer_minimum_order_qty"), 1) || 1,
      currentStockCustomer: toInt(cell(row, "current_stock"), 0),
      currentStockDealer: toInt(cell(row, "dealer_current_stock"), 0),
      customerSellingPrice: toDecimalString(cell(row, "unit_price"), "0"),
      dealerSellingPrice: toDecimalString(cell(row, "dealer_price"), "0"),
    });
  }

  return { prepared, diagnostics };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

type MigrationResult = {
  productsInserted: number;
  productsUpdated: number;
  productsSkipped: number;
  variantsWritten: number;
  configsWritten: number;
  imagesFetched: number;
  imageFailures: string[];
  skippedDetails: string[];
};

type ImageIngestResult = {
  primaryImageUrl: string;
  metaImageUrl: string | null;
  galleryUrls: string[];
  successCount: number;
  failures: string[];
};

/**
 * Fetches the product's thumbnail/gallery/meta-image from their confirmed
 * legacy URLs, validates + resizes + re-hosts each one locally via the
 * app's real image pipeline (never a raw hotlink), and returns the new
 * local URLs. One image failing doesn't fail the whole product — it's
 * just logged and skipped, same "don't let one bad row take down the rest"
 * discipline as everything else in this script.
 */
async function ingestProductImages(
  productId: string,
  sellerId: string,
  slug: string,
  p: PreparedProduct,
): Promise<ImageIngestResult> {
  const subdir = catalogImagePaths.productBase(sellerId, productId, slug);
  const failures: string[] = [];
  let successCount = 0;

  async function fetchOne(baseUrl: string, filename: string): Promise<string | null> {
    const result = await processAndUploadCatalogImageFromUrl(`${baseUrl}/${filename}`, subdir);
    if (result.ok) {
      successCount++;
      return result.urls.url;
    }
    failures.push(`${filename}: ${"detail" in result ? result.detail : result.error}`);
    return null;
  }

  const primaryImageUrl = p.thumbnailFilename ? await fetchOne(LEGACY_THUMBNAIL_BASE_URL, p.thumbnailFilename) : null;
  const galleryUrls: string[] = [];
  for (const filename of p.galleryFilenames) {
    const url = await fetchOne(LEGACY_GALLERY_BASE_URL, filename);
    if (url) galleryUrls.push(url);
  }
  const metaImageUrl = p.metaImageFilename ? await fetchOne(LEGACY_META_IMAGE_BASE_URL, p.metaImageFilename) : null;

  return {
    // Product.primaryImageUrl is required (non-null) — an empty string is
    // the least-bad fallback when even the thumbnail fetch failed; still
    // flagged via `failures` so it's never silently missing from the report.
    primaryImageUrl: primaryImageUrl ?? "",
    metaImageUrl,
    galleryUrls,
    successCount,
    failures,
  };
}

async function migrateProducts(
  prepared: PreparedProduct[],
  targets: Targets,
  dryRun: boolean,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    productsInserted: 0,
    productsUpdated: 0,
    productsSkipped: 0,
    variantsWritten: 0,
    configsWritten: 0,
    imagesFetched: 0,
    imageFailures: [],
    skippedDetails: [],
  };

  if (dryRun) {
    const existing = await prisma.product.findMany({
      where: { legacyId: { in: prepared.map((p) => p.legacyId) } },
      select: { legacyId: true },
    });
    const existingSet = new Set(existing.map((e) => e.legacyId));
    for (const p of prepared) {
      if (existingSet.has(p.legacyId)) result.productsUpdated++;
      else result.productsInserted++;
      result.variantsWritten += p.variants.length;
      if (p.variants.length === 0) result.configsWritten++;
    }
    return result;
  }

  for (const p of prepared) {
    try {
      const written = await prisma.$transaction(async (tx) => {
        const before = await tx.product.findUnique({ where: { legacyId: p.legacyId }, select: { id: true } });

        const scalarFields = {
          name: p.name,
          slug: p.slug,
          sku: p.sku,
          hsnCode: p.hsnCode,
          shortDescription: p.shortDescription,
          description: p.description,
          ingredients: p.ingredients,
          howToUse: p.howToUse,
          productType: ProductType.PHYSICAL,
          audience: p.audience,
          baseUnit: p.baseUnit,
          packageSize: p.packageSize,
          searchTags: p.searchTags,
          // Placeholders — ingestProductImages() overwrites these right
          // after this transaction commits, once the product's real id
          // (needed for its storage path) exists.
          primaryImageUrl: "",
          videoUrl: p.videoUrl,
          metaTitle: p.metaTitle,
          metaDescription: p.metaDescription,
        };
        const singleRelationConnects = {
          seller: { connect: { id: targets.sellerId } },
          manufacturer: { connect: { id: targets.manufacturerId } },
          brand: { connect: { id: targets.brandId } },
          category: { connect: { id: p.categoryId } },
        };

        const product = await tx.product.upsert({
          where: { legacyId: p.legacyId },
          update: {
            ...scalarFields,
            ...singleRelationConnects,
            subCategory: p.subCategoryId ? { connect: { id: p.subCategoryId } } : { disconnect: true },
            customerAvailableStates: { set: p.customerStateIds.map((id) => ({ id })) },
            dealerAvailableStates: { set: p.dealerStateIds.map((id) => ({ id })) },
          },
          create: {
            legacyId: p.legacyId,
            ...scalarFields,
            ...singleRelationConnects,
            ...(p.subCategoryId ? { subCategory: { connect: { id: p.subCategoryId } } } : {}),
            customerAvailableStates: { connect: p.customerStateIds.map((id) => ({ id })) },
            dealerAvailableStates: { connect: p.dealerStateIds.map((id) => ({ id })) },
          },
        });

        // ProductCustomerConfig/ProductDealerConfig are REQUIRED for every
        // product regardless of variants, not just non-variant ones —
        // packages/orders/src/line-validation.ts's resolveAudienceConfig
        // (via validateCartLine) unconditionally needs one to exist (it's
        // also where the tax rate comes from even for a variant line) and
        // returns CONFIG_MISSING otherwise. Confirmed the hard way: the
        // first version of this script only created these for the
        // non-variant path, which made every variant product's Add To
        // Cart/Buy Now fail with "This product is not configured for your
        // account type" despite the product itself looking correctly
        // imported. For a variant product this config is a placeholder
        // (mrp/sellingPrice 0) — packages/catalog's product-card-adapter
        // already treats configMrp === 0 as "no card-price override, fall
        // back to the default variant's price", so this never shows a
        // wrong price; it exists purely to satisfy the "must exist" gate
        // and supply a tax rate.
        const isNonVariant = p.variants.length === 0;
        if (p.audience !== ProductAudience.DEALER_ONLY) {
          const mrp = isNonVariant ? p.customerSellingPrice : "0";
          await tx.productCustomerConfig.upsert({
            where: { legacyProductId_legacyVariantType: { legacyProductId: p.legacyId, legacyVariantType: "" } },
            update: { mrp, sellingPrice: mrp, minOrderQty: p.minOrderQtyCustomer, currentStock: p.currentStockCustomer, loyaltyPoints: 0 },
            create: {
              productId: product.id,
              legacyProductId: p.legacyId,
              legacyVariantType: "",
              mrp,
              sellingPrice: mrp,
              minOrderQty: p.minOrderQtyCustomer,
              currentStock: p.currentStockCustomer,
              // No loyalty-points logic exists yet (see module doc comment)
              // — explicit 0, not left to the schema default, so intent
              // reads clearly here rather than being implicit.
              loyaltyPoints: 0,
            },
          });
          result.configsWritten++;
        }
        if (p.audience !== ProductAudience.CUSTOMER_ONLY) {
          const mrp = isNonVariant ? p.dealerSellingPrice : "0";
          await tx.productDealerConfig.upsert({
            where: { legacyProductId_legacyVariantType: { legacyProductId: p.legacyId, legacyVariantType: "" } },
            update: { mrp, sellingPrice: mrp, minOrderQty: p.minOrderQtyDealer, currentStock: p.currentStockDealer, loyaltyPoints: 0 },
            create: {
              productId: product.id,
              legacyProductId: p.legacyId,
              legacyVariantType: "",
              mrp,
              sellingPrice: mrp,
              minOrderQty: p.minOrderQtyDealer,
              currentStock: p.currentStockDealer,
              loyaltyPoints: 0,
            },
          });
          result.configsWritten++;
        }
        if (!isNonVariant) {
          let isFirstCustomer = true;
          let isFirstDealer = true;
          for (const v of p.variants) {
            // ProductAttribute is global (upsert by name); ProductVariantAttributeValue is scoped per product.
            const attributeValueIds: string[] = [];
            for (const av of v.attributeValues) {
              const attribute = await tx.productAttribute.upsert({
                where: { name: av.attributeName },
                update: {},
                create: { name: av.attributeName, slug: slugify(av.attributeName) },
              });
              const attrValue = await tx.productVariantAttributeValue.upsert({
                where: { productId_attributeId_value: { productId: product.id, attributeId: attribute.id, value: av.value } },
                update: {},
                create: {
                  productId: product.id,
                  attributeId: attribute.id,
                  value: av.value,
                  slug: slugify(av.value),
                },
              });
              attributeValueIds.push(attrValue.id);
            }

            const combinationKey = buildCombinationKey(attributeValueIds);
            const isDefault = v.audience === "CUSTOMER" ? isFirstCustomer : isFirstDealer;
            if (v.audience === "CUSTOMER") isFirstCustomer = false;
            else isFirstDealer = false;

            const variantData = {
              hsnCode: p.hsnCode,
              combinationKey,
              mrp: v.sellingPrice, // no legacy MRP source at variant level — see module doc comment
              perUnitMrp: v.perUnitMrp,
              sellingPrice: v.sellingPrice,
              minOrderQty: v.audience === "CUSTOMER" ? p.minOrderQtyCustomer : p.minOrderQtyDealer,
              stockQty: v.stockQty,
              weight: v.weight,
              height: v.heightM,
              breadth: v.breadthM,
              length: v.lengthM,
              shippingCost: v.shippingCost,
              shippingCalcMode: v.shippingCalcMode,
              isActive: v.isActive,
              isDefault,
              // No loyalty-points logic exists yet (see module doc comment)
              // — explicit 0, not left null, so intent reads clearly.
              loyaltyPoints: 0,
            };

            const variant = await tx.productVariant.upsert({
              where: { legacyProductId_legacyVariantType: { legacyProductId: p.legacyId, legacyVariantType: v.legacyVariantType } },
              update: variantData,
              create: {
                productId: product.id,
                audience: v.audience === "CUSTOMER" ? VariantAudience.CUSTOMER : VariantAudience.DEALER,
                sku: v.sku,
                legacyProductId: p.legacyId,
                legacyVariantType: v.legacyVariantType,
                ...variantData,
              },
            });

            // sync ProductVariantValue links (delete+recreate — simplest way to stay idempotent)
            await tx.productVariantValue.deleteMany({ where: { variantId: variant.id } });
            for (const attributeValueId of attributeValueIds) {
              await tx.productVariantValue.create({ data: { variantId: variant.id, attributeValueId } });
            }
            result.variantsWritten++;
          }
        }

        // `before` reflects existence at the START of this transaction —
        // correct either way since Product.legacyId is never reassigned
        // to a DIFFERENT product once set, so this can't go stale between
        // the check and commit. Counted here (return value used AFTER the
        // transaction resolves), not inline above, specifically so a
        // LATER statement in this same transaction throwing (e.g. the
        // variant/attribute-value writes below) can never leave the
        // in-memory counter incremented for a product whose write was
        // actually rolled back — caught for real on the first full run,
        // where the reported "inserted" count didn't match a direct DB
        // count for exactly this reason.
        return { id: product.id, slug: product.slug, wasUpdate: before !== null };
      });

      if (written.wasUpdate) result.productsUpdated++;
      else result.productsInserted++;

      // Real network/image-processing work — deliberately OUTSIDE the DB
      // transaction above (a slow upstream fetch/sharp resize has no
      // business holding a Postgres transaction open), and only possible
      // now that `written.id` (part of the storage path) exists.
      const imageResult = await ingestProductImages(written.id, targets.sellerId, written.slug, p);
      await prisma.product.update({
        where: { id: written.id },
        data: { primaryImageUrl: imageResult.primaryImageUrl, metaImageUrl: imageResult.metaImageUrl },
      });
      await prisma.productImage.deleteMany({ where: { productId: written.id } });
      if (imageResult.galleryUrls.length > 0) {
        await prisma.productImage.createMany({
          data: imageResult.galleryUrls.map((url, position) => ({ productId: written.id, url, position })),
        });
      }
      result.imagesFetched += imageResult.successCount;
      result.imageFailures.push(...imageResult.failures.map((f) => `product legacyId=${p.legacyId} (${p.name}): ${f}`));
    } catch (err) {
      result.productsSkipped++;
      result.skippedDetails.push(`product legacyId=${p.legacyId} (${p.name}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Legacy product migration — seller "${args.sellerName}"${args.dryRun ? " (DRY RUN — no writes)" : ""}`);
  console.log(`  products file: ${args.productsFile}`);
  console.log(`  tags file:     ${args.tagsFile}\n`);

  const productRows = parseTsv(args.productsFile);
  const tagRows = parseTsv(args.tagsFile);
  const tagsByProductId = new Map<string, string[]>();
  for (const row of tagRows) {
    const pid = cell(row, "product_id");
    const tag = cell(row, "tag");
    if (!pid || !tag) continue;
    const list = tagsByProductId.get(pid) ?? [];
    list.push(tag);
    tagsByProductId.set(pid, list);
  }
  console.log(`Read ${productRows.length} product row(s), ${tagRows.length} tag row(s).\n`);

  const targets = await resolveTargets(args);
  console.log(`Resolved targets: seller="${args.sellerName}" brand="${args.brandName}" manufacturer="${args.manufacturerName}"\n`);

  const { prepared, diagnostics } = prepareProducts(productRows, tagsByProductId, targets);
  console.log(`Prepared ${prepared.length}/${productRows.length} product(s) (skipped: unresolved category).`);
  console.log(`Total variant entries parsed: ${prepared.reduce((n, p) => n + p.variants.length, 0)}`);
  console.log(`Non-variant products (config-only): ${prepared.filter((p) => p.variants.length === 0).length}\n`);

  if (diagnostics.unresolvedCategoryIds.size > 0) {
    console.log(`Unresolved legacy category ids (product skipped): ${[...diagnostics.unresolvedCategoryIds].join(", ")}`);
  }
  if (diagnostics.unresolvedSubcategoryIds.size > 0) {
    console.log(`Unresolved legacy subcategory ids (subCategoryId left null): ${[...diagnostics.unresolvedSubcategoryIds].join(", ")}`);
  }
  if (diagnostics.manualReviewValues.length > 0) {
    console.log(`\nVariant values that didn't classify (skipped, product still imports otherwise):`);
    for (const v of diagnostics.manualReviewValues) console.log(`  [${v.legacyId}] ${v.name} | ${v.side}: "${v.value}"`);
  }
  console.log(`Negative discount values clamped to 0: ${diagnostics.negativeDiscountCount} product(s).`);
  console.log(`Products with no thumbnail filename at all: ${diagnostics.productsWithNoThumbnail}.`);
  console.log();

  const result = await migrateProducts(prepared, targets, args.dryRun);

  console.log("\n" + "=".repeat(70));
  console.log(`SUMMARY${args.dryRun ? " (DRY RUN — nothing was written)" : ""}`);
  console.log("=".repeat(70));
  console.table({
    Products: { inserted: result.productsInserted, updated: result.productsUpdated, skipped: result.productsSkipped },
    Variants: { written: result.variantsWritten },
    "Non-variant configs": { written: result.configsWritten },
    Images: { fetched: result.imagesFetched, failed: result.imageFailures.length },
  });
  if (result.imageFailures.length > 0) {
    console.log(`\nImage fetch failures (first 20):`);
    for (const d of result.imageFailures.slice(0, 20)) console.log(`  - ${d}`);
  }
  if (result.skippedDetails.length > 0) {
    console.log(`\nProduct skip reasons (first 20):`);
    for (const d of result.skippedDetails.slice(0, 20)) console.log(`  - ${d}`);
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
