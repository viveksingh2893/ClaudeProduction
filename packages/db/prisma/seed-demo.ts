import "dotenv/config";
import {
  PrismaClient,
  ApplicationStatus,
  KycStatus,
  type UserRole,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type BaseUnit,
  type ProductAudience,
  type ReviewModerationStatus,
} from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { getFullName } from "../src/user-display";

/**
 * Comprehensive demo/test dataset for exercising the website, admin panel,
 * seller flows and the Android APK end to end — sellers (approved +
 * pending/rejected/suspended), brands/manufacturers, products across every
 * active leaf category with varied variant shapes, reviews (verified +
 * manual), customers/dealers, and orders across the real OrderStatus
 * lifecycle.
 *
 * Design rules (see the task this fulfils):
 *  - Fully separate demo namespace: every record this script owns uses a
 *    `demo.` email prefix, a `+91980000####`/`+91970000####` phone block,
 *    `demo-` slugs, `DEMO-` SKUs, or a `DEMO ` name prefix — never touching
 *    the pre-existing foundational fixtures from seed.ts (admin@kisan4u.local,
 *    seller@kisan4u.local, Katra Fert/AgriPure, etc.) or any ad-hoc row
 *    created through manual testing (Apple/Samsung brands, the "Kisan"/
 *    "kisan4u" sellers, TEST FIXTURE categories) — those are left untouched.
 *  - Idempotent: every write is an upsert-by-stable-key or a
 *    findFirst-then-create/skip, so re-running this script updates/reuses
 *    its own records instead of duplicating them.
 *  - Reuses the EXISTING, live category tree (Technology > Computer >
 *    samsung / Mobile; Plant Nutrients > Bio Fertilisers > Carrier Based
 *    Consortia / Liquid Consortia, > Fertilisers; Plant Protection >
 *    Insecticide / Fungicide; Gardening Product) read from the database,
 *    not a hardcoded copy — see seedGetExistingCategoryTree. Two new leaf
 *    categories (Clothing > Men's Wear, Footwear) are added because the
 *    live tree had no clothing/footwear category and the task explicitly
 *    requires a colour+size clothing example and a colour+shoe-size
 *    footwear example — this is a data addition, not a modification of any
 *    existing Category row.
 *  - No schema changes/migrations. No new dependencies.
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Production guard — refuses to run unless the target is unambiguously a
// local/dev database. Two independent checks must both pass.
// ---------------------------------------------------------------------------
function assertSafeToSeedDemoData() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const nodeEnv = process.env.NODE_ENV ?? "";

  if (nodeEnv === "production") {
    throw new Error(
      "Refusing to run seed-demo.ts: NODE_ENV=production. This script inserts development/test data and must never run against a production environment.",
    );
  }
  const looksLocal = /localhost|127\.0\.0\.1/i.test(dbUrl);
  const looksLikeDevDb = /(_dev\b|dev_password|kisan4u_dev)/i.test(dbUrl);
  if (!looksLocal || !looksLikeDevDb) {
    throw new Error(
      "Refusing to run seed-demo.ts: DATABASE_URL does not look like the local dev database (expected a localhost/127.0.0.1 host and a *_dev database name). " +
        "If this really is a safe local/test database, adjust the guard in assertSafeToSeedDemoData() deliberately — never bypass it against a shared or production database.",
    );
  }
}

// ---------------------------------------------------------------------------
// Small pure helpers — duplicated from seed.ts rather than imported, matching
// this file's existing documented convention (packages/db has no dependency
// on @kisan4u/validators or @kisan4u/catalog).
// ---------------------------------------------------------------------------
function calculateSellingPrice(
  mrp: number,
  discountType: "NONE" | "FLAT" | "PERCENTAGE",
  discountValue: number,
): number {
  let raw: number;
  switch (discountType) {
    case "NONE":
      raw = mrp;
      break;
    case "FLAT":
      raw = mrp - discountValue;
      break;
    case "PERCENTAGE":
      raw = mrp - (mrp * discountValue) / 100;
      break;
  }
  return Math.round((Math.max(0, raw) + Number.EPSILON) * 100) / 100;
}

function combinationKey(attributeValueIds: string[]): string {
  return [...attributeValueIds].sort().join(",");
}

function calcCollectionChargeDemo(sellerOrderValue: number) {
  const percentageUsed = 1.5;
  const minimumCharge = 30;
  const percentageResult = Math.round(((sellerOrderValue * percentageUsed) / 100) * 100) / 100;
  const finalCharge = Math.max(percentageResult, minimumCharge);
  return {
    finalCharge,
    percentageUsed,
    minimumCharge,
    percentageResult,
    formula: `Higher of ₹${minimumCharge.toFixed(2)} flat or ${percentageUsed}% of seller-order merchandise value`,
  };
}

const DEMO_SELLER_PASSWORD = "DemoSeller#Kisan4U2026";

// ---------------------------------------------------------------------------
// Image library — every URL below was resolved via the Wikimedia Commons
// API (stable upload.wikimedia.org paths, not the redirect-heavy
// Special:FilePath endpoint) and verified to return HTTP 200 with an
// image/* content-type before being used here. All are openly licensed
// (Wikimedia Commons). Brand "logos" for the fictional demo brands use
// generic, openly-licensed icon graphics (a leaf/tag/shoe/circuit-board
// icon) since there is no real logo for an invented company name — see
// the final report for this explicit limitation.
//
// Mobile-safety rule: NO field below may point at a .svg file. React
// Native's <Image> component cannot rasterize SVG, so every entry that
// previously pointed at a Commons .svg source now points at Wikimedia's
// own thumbnail-rendering endpoint for that same source file
// (.../commons/thumb/<a>/<ab>/<File>.svg/500px-<File>.svg.png), which
// performs genuine server-side SVG->PNG rasterization (librsvg) and
// returns a real `image/png` response — not a renamed .svg. Each was
// re-verified with `curl -I` to return HTTP 200 and `content-type:
// image/png` before being pasted in here. See assertNoSvgImageUrls()
// below, which fails the seed run if any .svg URL is ever reintroduced.
// ---------------------------------------------------------------------------
const IMG = {
  fertilizerGranules: "https://upload.wikimedia.org/wikipedia/commons/7/75/NPK_Fertilizer.png",
  fertilizerGranulesAlt:
    "https://upload.wikimedia.org/wikipedia/commons/4/41/DAP_%28Diammonium_Phosphate%29_Granules_%283%29.jpg",
  fertilizerLiquid: "https://upload.wikimedia.org/wikipedia/commons/9/9f/Liquid_fertilizers.jpg",
  insecticideBottle:
    "https://upload.wikimedia.org/wikipedia/commons/7/7c/1_liter_trigger_spray_bottle.jpg",
  fungicideBottle:
    "https://upload.wikimedia.org/wikipedia/commons/6/63/1_liter_amber_trigger_spray_bottle.jpg",
  pruningShears:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/58/Pruning_shears.svg/500px-Pruning_shears.svg.png",
  gardenHose: "https://upload.wikimedia.org/wikipedia/commons/c/cd/Garden_hose.jpg",
  wateringCan: "https://upload.wikimedia.org/wikipedia/commons/b/ba/Metal_Watering_Can.jpg",
  smartphone: "https://upload.wikimedia.org/wikipedia/commons/d/dc/Samsung_Galaxy_S_White.png",
  monitor:
    "https://upload.wikimedia.org/wikipedia/commons/6/66/Samsung_LC27F591FDEXZW_front_20191229.jpg",
  earbuds: "https://upload.wikimedia.org/wikipedia/commons/2/25/NEW_HighKey_Wireless_Earbuds.png",
  shirtBlue: "https://upload.wikimedia.org/wikipedia/commons/c/c5/Blue_Business_Shirt.jpg",
  shirtWhite: "https://upload.wikimedia.org/wikipedia/commons/0/03/Camicia_Cottonstir.jpg",
  shoesRunning: "https://upload.wikimedia.org/wikipedia/commons/8/89/On_Clouds_running_shoes.jpg",
  shoesSneaker: "https://upload.wikimedia.org/wikipedia/commons/a/a5/Sneakers.jpg",
  shoesConverse: "https://upload.wikimedia.org/wikipedia/commons/a/a5/Black_Converse_sneakers.JPG",
  logoLeaf1:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/Leaf_icon_05.svg/500px-Leaf_icon_05.svg.png",
  logoLeaf2:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/Leaf_icon_14.svg/500px-Leaf_icon_14.svg.png",
  logoLeaf3:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/58/Leaf_icon_03.svg/500px-Leaf_icon_03.svg.png",
  logoTag:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Tag_icon.svg/500px-Tag_icon.svg.png",
  logoTagAlt:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/OOjs_UI_icon_tag-ltr.svg/500px-OOjs_UI_icon_tag-ltr.svg.png",
  logoShoe:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Shoes.svg/500px-Shoes.svg.png",
  logoPcb:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Printed_circuit_board_PCB_icon_3.svg/500px-Printed_circuit_board_PCB_icon_3.svg.png",
} as const;

// Guard against ever reintroducing an SVG URL into mobile-visible seed
// data — React Native's <Image> cannot render SVG, so this must stay
// empty. Runs at seed startup (see bottom of this file's main()).
function assertNoSvgImageUrls() {
  const offending = Object.entries(IMG).filter(([, url]) => url.toLowerCase().endsWith(".svg"));
  if (offending.length > 0) {
    throw new Error(
      `seed-demo: ${offending.length} IMG entr${offending.length === 1 ? "y" : "ies"} point at a raw .svg file, which React Native's <Image> cannot render: ${offending
        .map(([key]) => key)
        .join(
          ", ",
        )}. Use a PNG/JPG source, or Wikimedia's SVG thumbnail-rendering endpoint (.../thumb/<a>/<ab>/<File>.svg/<width>px-<File>.svg.png), which returns a genuine rasterized image/png.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 1. Categories — read the real live tree, add only the two new leaves
// ---------------------------------------------------------------------------

async function getExistingCategoryTree() {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    include: {
      subCategories: {
        where: { isActive: true },
        include: { subSubCategories: { where: { isActive: true } } },
      },
    },
    orderBy: { position: "asc" },
  });

  const technology = categories.find((c) => c.slug === "tech");
  const plantNutrients = categories.find((c) => c.slug === "plant-nutrients");
  const plantProtection = categories.find((c) => c.slug === "plant-protection");
  const gardening = categories.find((c) => c.slug === "gardening-products");

  const computer = technology?.subCategories.find((s) => s.slug === "computer");
  const mobile = technology?.subCategories.find((s) => s.slug === "mobile");
  const samsungLeaf = computer?.subSubCategories.find((s) => s.slug === "samsung");
  const bioFertilisers = plantNutrients?.subCategories.find((s) => s.slug === "bio-fertilisers");
  const fertilisers = plantNutrients?.subCategories.find((s) => s.slug === "fertilisers");
  const carrierBasedConsortia = bioFertilisers?.subSubCategories.find(
    (s) => s.slug === "carrier-based-consortia",
  );
  const liquidConsortia = bioFertilisers?.subSubCategories.find(
    (s) => s.slug === "liquid-consortia",
  );
  const insecticide = plantProtection?.subCategories.find((s) => s.slug === "insecticide");
  const fungicide = plantProtection?.subCategories.find((s) => s.slug === "fungicide");

  if (
    !technology ||
    !plantNutrients ||
    !plantProtection ||
    !gardening ||
    !computer ||
    !mobile ||
    !samsungLeaf ||
    !fertilisers ||
    !carrierBasedConsortia ||
    !liquidConsortia ||
    !insecticide ||
    !fungicide
  ) {
    throw new Error(
      "seed-demo.ts expected the live category tree to already contain Technology>Computer>samsung, Technology>Mobile, " +
        "Plant Nutrients>Bio Fertilisers>{Carrier Based Consortia, Liquid Consortia}, Plant Nutrients>Fertilisers, " +
        "Plant Protection>{Insecticide, Fungicide}, and Gardening Product — one of these was missing or inactive. " +
        "Run `pnpm db:seed` first (the foundational catalog seed), or check /admin/categories.",
    );
  }

  return {
    technology,
    plantNutrients,
    plantProtection,
    gardening,
    computer,
    mobile,
    samsungLeaf,
    fertilisers,
    carrierBasedConsortia,
    liquidConsortia,
    insecticide,
    fungicide,
  };
}

/** Two new leaf categories the live tree had no equivalent of — see file doc comment. Positioned after every existing category. */
async function seedNewLeafCategories() {
  const maxPosition = await prisma.category.aggregate({ _max: { position: true } });
  const basePosition = (maxPosition._max.position ?? 0) + 1;

  const clothing = await prisma.category.upsert({
    where: { slug: "clothing" },
    update: {},
    create: { name: "Clothing", slug: "clothing", position: basePosition, imageUrl: IMG.shirtBlue },
  });
  const mensWear = await prisma.subcategory.upsert({
    where: { slug: "mens-wear" },
    update: {},
    create: { name: "Men's Wear", slug: "mens-wear", categoryId: clothing.id },
  });
  const footwear = await prisma.category.upsert({
    where: { slug: "footwear" },
    update: {},
    create: {
      name: "Footwear",
      slug: "footwear",
      position: basePosition + 1,
      imageUrl: IMG.shoesRunning,
    },
  });

  return { clothing, mensWear, footwear };
}

/** Fills in the 3 existing active categories' missing imageUrl — only ever writes when currently null, never overwrites a value an admin already set. */
async function backfillMissingCategoryImages(
  tree: Awaited<ReturnType<typeof getExistingCategoryTree>>,
) {
  const targets: Array<{ id: string; imageUrl: string }> = [
    { id: tree.plantNutrients.id, imageUrl: IMG.fertilizerGranules },
    { id: tree.plantProtection.id, imageUrl: IMG.insecticideBottle },
    { id: tree.gardening.id, imageUrl: IMG.wateringCan },
  ];
  for (const t of targets) {
    await prisma.category.updateMany({
      where: { id: t.id, imageUrl: null },
      data: { imageUrl: t.imageUrl },
    });
  }
}

// ---------------------------------------------------------------------------
// 2. Sellers — 6 approved + pending + rejected + suspended, all new demo
//    accounts in their own namespace.
// ---------------------------------------------------------------------------

type SellerSpec = {
  n: number;
  shopName: string;
  slug: string;
  status: ApplicationStatus;
  rejectionReason?: string;
  gstNumber: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
};

const SELLER_SPECS: SellerSpec[] = [
  {
    n: 1,
    shopName: "DEMO Kisan Krishi Kendra",
    slug: "demo-kisan-krishi-kendra",
    status: ApplicationStatus.APPROVED,
    gstNumber: "27DEMOA0001A1Z1",
    bankName: "State Bank of Demo",
    accountHolder: "Kisan Krishi Kendra",
    accountNumber: "000100000001",
  },
  {
    n: 2,
    shopName: "DEMO Green Earth Organics",
    slug: "demo-green-earth-organics",
    status: ApplicationStatus.APPROVED,
    gstNumber: "24DEMOB0002A1Z2",
    bankName: "State Bank of Demo",
    accountHolder: "Green Earth Organics",
    accountNumber: "000100000002",
  },
  {
    n: 3,
    shopName: "DEMO Digital Bazaar Electronics",
    slug: "demo-digital-bazaar-electronics",
    status: ApplicationStatus.APPROVED,
    gstNumber: "29DEMOC0003A1Z3",
    bankName: "State Bank of Demo",
    accountHolder: "Digital Bazaar Electronics",
    accountNumber: "000100000003",
  },
  {
    n: 4,
    shopName: "DEMO Fashion Hub India",
    slug: "demo-fashion-hub-india",
    status: ApplicationStatus.APPROVED,
    gstNumber: "07DEMOD0004A1Z4",
    bankName: "State Bank of Demo",
    accountHolder: "Fashion Hub India",
    accountNumber: "000100000004",
  },
  {
    n: 5,
    shopName: "DEMO Home & Garden Co",
    slug: "demo-home-garden-co",
    status: ApplicationStatus.APPROVED,
    gstNumber: "03DEMOE0005A1Z5",
    bankName: "State Bank of Demo",
    accountHolder: "Home and Garden Co",
    accountNumber: "000100000005",
  },
  {
    n: 6,
    shopName: "DEMO AgroMax Traders",
    slug: "demo-agromax-traders",
    status: ApplicationStatus.APPROVED,
    gstNumber: "08DEMOF0006A1Z6",
    bankName: "State Bank of Demo",
    accountHolder: "AgroMax Traders",
    accountNumber: "000100000006",
  },
  {
    n: 7,
    shopName: "DEMO New Harvest Supplies",
    slug: "demo-new-harvest-supplies",
    status: ApplicationStatus.PENDING,
    gstNumber: "10DEMOG0007A1Z7",
    bankName: "State Bank of Demo",
    accountHolder: "New Harvest Supplies",
    accountNumber: "000100000007",
  },
  {
    n: 8,
    shopName: "DEMO QuickCart Traders",
    slug: "demo-quickcart-traders",
    status: ApplicationStatus.REJECTED,
    rejectionReason: "GST certificate illegible — please re-upload a clearer scan.",
    gstNumber: "19DEMOH0008A1Z8",
    bankName: "State Bank of Demo",
    accountHolder: "QuickCart Traders",
    accountNumber: "000100000008",
  },
  {
    n: 9,
    shopName: "DEMO OldTime Agro",
    slug: "demo-oldtime-agro",
    status: ApplicationStatus.SUSPENDED,
    rejectionReason: undefined,
    gstNumber: "23DEMOI0009A1Z9",
    bankName: "State Bank of Demo",
    accountHolder: "OldTime Agro",
    accountNumber: "000100000009",
  },
];

async function seedSellers() {
  const passwordHash = await bcrypt.hash(DEMO_SELLER_PASSWORD, 12);
  const sellers: Record<number, { userId: string; sellerId: string; email: string }> = {};

  for (const spec of SELLER_SPECS) {
    const email = `demo.seller${spec.n}@kisan4u.local`;
    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash },
      create: {
        email,
        // Whole shop-name string as firstName (lastName left null) — this
        // is a business name repurposed as the seller's account display
        // name, not a real person's name to split.
        firstName: spec.shopName.replace(/^DEMO /, "Demo "),
        role: "SELLER" as UserRole,
        passwordHash,
        referralCode: `DEMO-SELLER-${spec.n}`,
        isEmailVerified: true,
      },
    });
    const sellerData = {
      shopName: spec.shopName,
      status: spec.status,
      rejectionReason: spec.rejectionReason ?? null,
      gstNumber: spec.gstNumber,
      gstDocUrl: `/demo/docs/seller${spec.n}-gst.pdf`,
      bankName: spec.bankName,
      accountHolder: spec.accountHolder,
      accountNumber: spec.accountNumber,
      panDocUrl: `/demo/docs/seller${spec.n}-pan.pdf`,
    };
    const profile = await prisma.sellerProfile.upsert({
      where: { userId: user.id },
      update: sellerData,
      create: { userId: user.id, slug: spec.slug, ...sellerData },
    });
    sellers[spec.n] = { userId: user.id, sellerId: profile.id, email };
  }
  return sellers;
}

// ---------------------------------------------------------------------------
// 3. Brands & manufacturers — new fictional names only (never touching the
//    existing Katra Fert/AgriPure/Isar Agro/Kisan4U Manufacturing rows, or
//    the ad-hoc Apple/Samsung brands from manual testing).
// ---------------------------------------------------------------------------

async function seedBrandsAndManufacturers(
  ownerSellerId: number extends never ? never : Record<number, { sellerId: string }>,
) {
  const brandSpecs: Array<{
    name: string;
    slug: string;
    imageUrl: string;
    homepagePosition: number | null;
  }> = [
    {
      name: "DEMO GreenGrow",
      slug: "demo-greengrow",
      imageUrl: IMG.logoLeaf1,
      homepagePosition: 0,
    },
    { name: "DEMO FarmMax", slug: "demo-farmmax", imageUrl: IMG.logoLeaf2, homepagePosition: null },
    {
      name: "DEMO BioCrop Solutions",
      slug: "demo-biocrop-solutions",
      imageUrl: IMG.logoLeaf3,
      homepagePosition: 1,
    },
    { name: "DEMO TechNova", slug: "demo-technova", imageUrl: IMG.logoPcb, homepagePosition: 2 },
    {
      name: "DEMO UrbanThread",
      slug: "demo-urbanthread",
      imageUrl: IMG.logoTag,
      homepagePosition: 3,
    },
    { name: "DEMO StepRight", slug: "demo-stepright", imageUrl: IMG.logoShoe, homepagePosition: 4 },
    {
      name: "DEMO GreenThumb Tools",
      slug: "demo-greenthumb-tools",
      imageUrl: IMG.pruningShears,
      homepagePosition: 5,
    },
    {
      name: "DEMO NoName Agro Supplies",
      slug: "demo-noname-agro-supplies",
      imageUrl: IMG.logoTagAlt,
      homepagePosition: null,
    },
  ];
  const brands: Record<string, { id: string; slug: string }> = {};
  for (const spec of brandSpecs) {
    const b = await prisma.brand.upsert({
      where: { slug: spec.slug },
      update: {
        imageUrl: spec.imageUrl,
        homepagePosition: spec.homepagePosition,
        status: ApplicationStatus.APPROVED,
      },
      create: {
        name: spec.name,
        slug: spec.slug,
        imageUrl: spec.imageUrl,
        homepagePosition: spec.homepagePosition,
        status: ApplicationStatus.APPROVED,
        ownerSellerId: null,
      },
    });
    brands[spec.slug] = b;
  }

  const mfrSpecs: Array<{ name: string; slug: string; imageUrl: string }> = [
    {
      name: "DEMO Samsung Electronics Mfg",
      slug: "demo-samsung-electronics-mfg",
      imageUrl: IMG.logoPcb,
    },
    { name: "DEMO ThreadWorks Textiles", slug: "demo-threadworks-textiles", imageUrl: IMG.logoTag },
    {
      name: "DEMO SoleCraft Industries",
      slug: "demo-solecraft-industries",
      imageUrl: IMG.logoShoe,
    },
  ];
  const manufacturers: Record<string, { id: string; slug: string }> = {};
  for (const spec of mfrSpecs) {
    const m = await prisma.manufacturer.upsert({
      where: { slug: spec.slug },
      update: { imageUrl: spec.imageUrl, status: ApplicationStatus.APPROVED },
      create: {
        name: spec.name,
        slug: spec.slug,
        imageUrl: spec.imageUrl,
        status: ApplicationStatus.APPROVED,
        ownerSellerId: null,
      },
    });
    manufacturers[spec.slug] = m;
  }

  return { brands, manufacturers };
}

// ---------------------------------------------------------------------------
// 4. Attributes — reused/created by name (global master data, name-only
//    per schema; product-specific VALUES are created per-product below).
// ---------------------------------------------------------------------------

async function seedAttributes() {
  const color = await prisma.productAttribute.upsert({
    where: { slug: "color" },
    update: {},
    create: { name: "Color", slug: "color" },
  });
  const size = await prisma.productAttribute.upsert({
    where: { slug: "size" },
    update: {},
    create: { name: "Size", slug: "size" },
  });
  const shoeSize = await prisma.productAttribute.upsert({
    where: { slug: "shoe-size" },
    update: {},
    create: { name: "Shoe Size", slug: "shoe-size" },
  });
  const storage = await prisma.productAttribute.upsert({
    where: { slug: "storage" },
    update: {},
    create: { name: "Storage", slug: "storage" },
  });
  const packSize = await prisma.productAttribute.upsert({
    where: { slug: "pack-size" },
    update: {},
    create: { name: "Pack Size", slug: "pack-size" },
  });
  const type = await prisma.productAttribute.upsert({
    where: { slug: "type" },
    update: {},
    create: { name: "Type", slug: "type" },
  });
  return { color, size, shoeSize, storage, packSize, type };
}

// ---------------------------------------------------------------------------
// 5. Products — the core of the dataset. Each product is only created if
//    its slug doesn't already exist (matches seed.ts's seedDemoProducts
//    convention — see that function's doc comment for why: a demo product
//    has no "intended state" to self-correct back to once approved/edited
//    through manual admin testing).
// ---------------------------------------------------------------------------

type Attrs = Awaited<ReturnType<typeof seedAttributes>>;
type CategoryTree = Awaited<ReturnType<typeof getExistingCategoryTree>>;
type NewLeaves = Awaited<ReturnType<typeof seedNewLeafCategories>>;
type Brands = Awaited<ReturnType<typeof seedBrandsAndManufacturers>>["brands"];
type Mfrs = Awaited<ReturnType<typeof seedBrandsAndManufacturers>>["manufacturers"];

type SimpleProductSpec = {
  slug: string;
  sku: string;
  name: string;
  subtitle?: string;
  shortDescription: string;
  description: string;
  hsnCode: string;
  categoryId: string;
  subCategoryId?: string;
  subSubCategoryId?: string;
  brandId?: string;
  manufacturerId?: string;
  audience: ProductAudience;
  baseUnit: BaseUnit;
  packageSize: string;
  searchTags: string[];
  primaryImageUrl: string;
  images: string[];
  customerVisible: boolean;
  dealerVisible: boolean;
  availableStateCodes?: string[];
  badge?: "BEST_SELLER" | "NEW" | "DEAL";
  customer?: {
    mrp: number;
    discountType: "NONE" | "FLAT" | "PERCENTAGE";
    discountValue: number;
    stock: number;
    weight: number;
    minOrderQty?: number;
  };
  dealer?: {
    mrp: number;
    discountType: "NONE" | "FLAT" | "PERCENTAGE";
    discountValue: number;
    stock: number;
    weight: number;
    minOrderQty?: number;
  };
};

async function createSimpleProductIfMissing(
  sellerId: string,
  spec: SimpleProductSpec,
  states: Array<{ id: string; code: string }>,
) {
  const existing = await prisma.product.findUnique({ where: { slug: spec.slug } });
  if (existing) return existing;

  const customerSellingPrice = spec.customer
    ? calculateSellingPrice(spec.customer.mrp, spec.customer.discountType, spec.customer.discountValue)
    : undefined;
  const dealerSellingPrice = spec.dealer
    ? calculateSellingPrice(spec.dealer.mrp, spec.dealer.discountType, spec.dealer.discountValue)
    : undefined;

  const product = await prisma.product.create({
    data: {
      sellerId,
      name: spec.name,
      slug: spec.slug,
      sku: spec.sku,
      hsnCode: spec.hsnCode,
      subtitle: spec.subtitle,
      shortDescription: spec.shortDescription,
      description: spec.description,
      categoryId: spec.categoryId,
      subCategoryId: spec.subCategoryId,
      subSubCategoryId: spec.subSubCategoryId,
      brandId: spec.brandId,
      manufacturerId: spec.manufacturerId,
      audience: spec.audience,
      baseUnit: spec.baseUnit,
      packageSize: spec.packageSize,
      searchTags: spec.searchTags,
      customerVisible: spec.customerVisible,
      dealerVisible: spec.dealerVisible,
      badge: spec.badge,
      lifecycleStatus: "APPROVED",
      primaryImageUrl: spec.primaryImageUrl,
      // Historically this restricted availability for BOTH audiences via a
      // single unified field, but only the dealer catalogue ever actually
      // filtered by it (customer/customer catalogue never has) — mapped to
      // dealerAvailableStates only, to keep this demo data's real observed
      // behavior unchanged after the customer/dealer state split.
      dealerAvailableStates: spec.availableStateCodes
        ? {
            connect: states
              .filter((s) => spec.availableStateCodes!.includes(s.code))
              .map((s) => ({ id: s.id })),
          }
        : undefined,
      images: { create: spec.images.map((url, i) => ({ url, position: i, altText: spec.name })) },
      customerConfig: spec.customer
        ? {
            create: {
              mrp: spec.customer.mrp,
              discountType: spec.customer.discountType,
              discountValue: spec.customer.discountValue,
              sellingPrice: customerSellingPrice!,
              minOrderQty: spec.customer.minOrderQty ?? 1,
              currentStock: spec.customer.stock,
              weight: spec.customer.weight,
              stockStatus: spec.customer.stock > 0 ? undefined : undefined,
            },
          }
        : undefined,
      dealerConfig: spec.dealer
        ? {
            create: {
              mrp: spec.dealer.mrp,
              discountType: spec.dealer.discountType,
              discountValue: spec.dealer.discountValue,
              sellingPrice: dealerSellingPrice!,
              minOrderQty: spec.dealer.minOrderQty ?? 1,
              currentStock: spec.dealer.stock,
              weight: spec.dealer.weight,
            },
          }
        : undefined,
      stockStatus:
        (spec.customer?.stock ?? spec.dealer?.stock ?? 0) > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
    },
  });
  return product;
}

/** One variant attribute (e.g. Pack Size) with N values, one ProductVariant per value — single-attribute products (fungicide, liquid fertilizer, casual sneakers). */
async function addSingleAttributeVariants(
  productId: string,
  audience: "CUSTOMER" | "DEALER",
  attributeId: string,
  values: Array<{
    value: string;
    slug: string;
    sku: string;
    mrp: number;
    discountType: "NONE" | "FLAT" | "PERCENTAGE";
    discountValue: number;
    stock: number;
    weight: number;
    minOrderQty?: number;
    isDefault?: boolean;
  }>,
) {
  const av = await Promise.all(
    values.map((v, i) =>
      prisma.productVariantAttributeValue.upsert({
        where: { productId_attributeId_slug: { productId, attributeId, slug: v.slug } },
        update: {},
        create: { productId, attributeId, value: v.value, slug: v.slug, position: i },
      }),
    ),
  );
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    const existing = await prisma.productVariant.findUnique({ where: { sku: v.sku } });
    if (existing) continue;
    const variant = await prisma.productVariant.create({
      data: {
        productId,
        audience,
        sku: v.sku,
        combinationKey: combinationKey([av[i]!.id]),
        mrp: v.mrp,
        discountType: v.discountType,
        discountValue: v.discountValue,
        sellingPrice: calculateSellingPrice(v.mrp, v.discountType, v.discountValue),
        minOrderQty: v.minOrderQty ?? 1,
        stockQty: v.stock,
        weight: v.weight,
        isDefault: v.isDefault ?? i === 0,
        isActive: true,
      },
    });
    await prisma.productVariantValue.create({
      data: { variantId: variant.id, attributeValueId: av[i]!.id },
    });
  }
}

type TwoAttrCombo = {
  attr1Value: string;
  attr2Value: string;
  sku: string;
  mrp: number;
  discountType: "NONE" | "FLAT" | "PERCENTAGE";
  discountValue: number;
  stock: number;
  weight: number;
  minOrderQty?: number;
  isDefault?: boolean;
  imageUrl?: string;
};

/** Two variant attributes (e.g. Color x Size) — combos list controls exactly which (attr1,attr2) pairs exist, so "one colour supports fewer sizes than another" is expressed simply by omitting combos, not by any special-case logic. */
async function addTwoAttributeVariants(
  productId: string,
  audience: "CUSTOMER" | "DEALER",
  attr1: { id: string; label: string; values: string[] },
  attr2: { id: string; label: string; values: string[] },
  combos: TwoAttrCombo[],
) {
  const attr1Values: Record<string, { id: string }> = {};
  for (let i = 0; i < attr1.values.length; i++) {
    const value = attr1.values[i]!;
    const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    attr1Values[value] = await prisma.productVariantAttributeValue.upsert({
      where: { productId_attributeId_slug: { productId, attributeId: attr1.id, slug } },
      update: {},
      create: { productId, attributeId: attr1.id, value, slug, position: i },
    });
  }
  const attr2Values: Record<string, { id: string }> = {};
  for (let i = 0; i < attr2.values.length; i++) {
    const value = attr2.values[i]!;
    const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    attr2Values[value] = await prisma.productVariantAttributeValue.upsert({
      where: { productId_attributeId_slug: { productId, attributeId: attr2.id, slug } },
      update: {},
      create: { productId, attributeId: attr2.id, value, slug, position: i },
    });
  }

  for (const combo of combos) {
    const existing = await prisma.productVariant.findUnique({ where: { sku: combo.sku } });
    if (existing) continue;
    const v1 = attr1Values[combo.attr1Value]!;
    const v2 = attr2Values[combo.attr2Value]!;
    const variant = await prisma.productVariant.create({
      data: {
        productId,
        audience,
        sku: combo.sku,
        combinationKey: combinationKey([v1.id, v2.id]),
        mrp: combo.mrp,
        discountType: combo.discountType,
        discountValue: combo.discountValue,
        sellingPrice: calculateSellingPrice(combo.mrp, combo.discountType, combo.discountValue),
        minOrderQty: combo.minOrderQty ?? 1,
        stockQty: combo.stock,
        weight: combo.weight,
        imageUrl: combo.imageUrl,
        isDefault: combo.isDefault ?? false,
        isActive: true,
      },
    });
    await prisma.productVariantValue.createMany({
      data: [
        { variantId: variant.id, attributeValueId: v1.id },
        { variantId: variant.id, attributeValueId: v2.id },
      ],
    });
  }
}

async function seedDemoProducts(
  sellers: Record<number, { sellerId: string }>,
  tree: CategoryTree,
  leaves: NewLeaves,
  brands: Brands,
  mfrs: Mfrs,
  attrs: Attrs,
  states: Array<{ id: string; code: string }>,
) {
  const created: string[] = [];
  const track = async (slug: string, label: string) => {
    const before = await prisma.product.findUnique({ where: { slug } });
    if (!before) created.push(label);
  };

  // --- Seller 1: DEMO Kisan Krishi Kendra — Plant Nutrients (fertiliser variety) ---
  await track(
    "demo-organic-compost-fertilizer",
    "demo-organic-compost-fertilizer (no variant, both audiences)",
  );
  await createSimpleProductIfMissing(
    sellers[1]!.sellerId,
    {
      slug: "demo-organic-compost-fertilizer",
      sku: "DEMO-COMPOST-FERT",
      name: "DEMO Organic Compost Fertilizer",
      subtitle: "Balanced NPK compost for all crops",
      shortDescription: "Granular organic compost fertilizer suitable for most field crops.",
      description:
        "A balanced granular organic compost fertilizer, suitable for most field crops and home gardens. Improves soil structure and nutrient availability over a full growing season.",
      hsnCode: "310100",
      categoryId: tree.plantNutrients.id,
      subCategoryId: tree.fertilisers.id,
      brandId: brands["demo-greengrow"]!.id,
      audience: "BOTH_CUSTOMER_AND_DEALER",
      baseUnit: "KG",
      packageSize: "5 kg bag",
      searchTags: ["compost", "organic", "npk", "fertilizer"],
      primaryImageUrl: IMG.fertilizerGranules,
      images: [IMG.fertilizerGranules, IMG.fertilizerGranulesAlt],
      customerVisible: true,
      dealerVisible: true,
      badge: "NEW",
      customer: { mrp: 450, discountType: "FLAT", discountValue: 50, stock: 300, weight: 5000 },
      dealer: {
        mrp: 4200,
        discountType: "FLAT",
        discountValue: 500,
        stock: 80,
        weight: 50000,
        minOrderQty: 5,
      },
    },
    states,
  );

  await track("demo-npk-liquid-fertilizer", "demo-npk-liquid-fertilizer (Pack Size variant)");
  {
    const p = await createSimpleProductIfMissing(
      sellers[1]!.sellerId,
      {
        slug: "demo-npk-liquid-fertilizer",
        sku: "DEMO-NPK-LIQUID",
        name: "DEMO NPK Liquid Fertilizer",
        subtitle: "Fast-absorbing liquid feed",
        shortDescription: "Water-soluble liquid NPK fertilizer for foliar and drip application.",
        description:
          "A fast-absorbing, water-soluble liquid NPK fertilizer for foliar spray or drip irrigation. Available in 500 ml, 1 L and 2 L packs.",
        hsnCode: "310520",
        categoryId: tree.plantNutrients.id,
        subCategoryId: tree.bioFertilisers?.id ?? tree.fertilisers.id,
        subSubCategoryId: tree.liquidConsortia.id,
        brandId: brands["demo-farmmax"]!.id,
        audience: "CUSTOMER_ONLY",
        baseUnit: "ML",
        packageSize: "500 ml / 1 L / 2 L",
        searchTags: ["liquid fertilizer", "npk", "foliar"],
        primaryImageUrl: IMG.fertilizerLiquid,
        images: [IMG.fertilizerLiquid],
        customerVisible: true,
        dealerVisible: false,
      },
      states,
    );
    await addSingleAttributeVariants(p.id, "CUSTOMER", attrs.packSize.id, [
      {
        value: "500 ml",
        slug: "500-ml",
        sku: "DEMO-NPK-LIQUID-500ML",
        mrp: 250,
        discountType: "FLAT",
        discountValue: 25,
        stock: 150,
        weight: 550,
        isDefault: true,
      },
      {
        value: "1 L",
        slug: "1-l",
        sku: "DEMO-NPK-LIQUID-1L",
        mrp: 450,
        discountType: "FLAT",
        discountValue: 45,
        stock: 120,
        weight: 1100,
      },
      {
        value: "2 L",
        slug: "2-l",
        sku: "DEMO-NPK-LIQUID-2L",
        mrp: 850,
        discountType: "FLAT",
        discountValue: 85,
        stock: 60,
        weight: 2100,
      },
    ]);
  }

  await track(
    "demo-bio-fungicide-spray",
    "demo-bio-fungicide-spray (dealer-only, Pack Size variant)",
  );
  {
    const p = await createSimpleProductIfMissing(
      sellers[1]!.sellerId,
      {
        slug: "demo-bio-fungicide-spray",
        sku: "DEMO-BIO-FUNGICIDE",
        name: "DEMO Bio Fungicide Spray",
        shortDescription: "Broad-spectrum bio fungicide for dealer bulk resale.",
        description:
          "A broad-spectrum biological fungicide spray, packed for dealer bulk resale only.",
        hsnCode: "380893",
        categoryId: tree.plantProtection.id,
        subCategoryId: tree.fungicide.id,
        brandId: brands["demo-biocrop-solutions"]!.id,
        audience: "DEALER_ONLY",
        baseUnit: "ML",
        packageSize: "250 ml / 500 ml",
        searchTags: ["fungicide", "bio", "dealer"],
        primaryImageUrl: IMG.fungicideBottle,
        images: [IMG.fungicideBottle],
        customerVisible: false,
        dealerVisible: true,
      },
      states,
    );
    await addSingleAttributeVariants(p.id, "DEALER", attrs.packSize.id, [
      {
        value: "250 ml",
        slug: "250-ml",
        sku: "DEMO-BIO-FUNGICIDE-250ML",
        mrp: 1200,
        discountType: "FLAT",
        discountValue: 100,
        stock: 40,
        weight: 300,
        minOrderQty: 5,
        isDefault: true,
      },
      {
        value: "500 ml",
        slug: "500-ml",
        sku: "DEMO-BIO-FUNGICIDE-500ML",
        mrp: 2200,
        discountType: "FLAT",
        discountValue: 200,
        stock: 25,
        weight: 580,
        minOrderQty: 5,
      },
    ]);
  }

  // --- Seller 2: DEMO Green Earth Organics — Plant Nutrients/Protection ---
  await track(
    "demo-carrier-consortia-bio-pack",
    "demo-carrier-consortia-bio-pack (customer-only, no variant)",
  );
  await createSimpleProductIfMissing(
    sellers[2]!.sellerId,
    {
      slug: "demo-carrier-consortia-bio-pack",
      sku: "DEMO-CARRIER-CONSORTIA",
      name: "DEMO Carrier Based Consortia Bio Pack",
      shortDescription: "Retail carrier-based bio consortia pack for home/small-farm use.",
      description:
        "A retail-sized carrier-based microbial consortia pack, sold to individual customers only.",
      hsnCode: "310100",
      categoryId: tree.plantNutrients.id,
      subCategoryId: tree.bioFertilisers?.id,
      subSubCategoryId: tree.carrierBasedConsortia.id,
      brandId: brands["demo-greengrow"]!.id,
      manufacturerId: mfrs["demo-samsung-electronics-mfg"] ? undefined : undefined,
      audience: "CUSTOMER_ONLY",
      baseUnit: "G",
      packageSize: "500 g",
      searchTags: ["consortia", "biofertilizer", "organic"],
      primaryImageUrl: IMG.fertilizerGranulesAlt,
      images: [IMG.fertilizerGranulesAlt],
      customerVisible: true,
      dealerVisible: false,
      customer: { mrp: 380, discountType: "FLAT", discountValue: 30, stock: 200, weight: 550 },
    },
    states,
  );

  await track(
    "demo-neem-oil-insecticide",
    "demo-neem-oil-insecticide (state-limited MH+GJ, Pack Size variant)",
  );
  {
    const p = await createSimpleProductIfMissing(
      sellers[2]!.sellerId,
      {
        slug: "demo-neem-oil-insecticide",
        sku: "DEMO-NEEM-INSECTICIDE",
        name: "DEMO Neem Oil Insecticide",
        shortDescription: "Cold-pressed neem oil insecticide — Maharashtra & Gujarat only.",
        description:
          "Cold-pressed neem oil insecticide, currently serviceable only in Maharashtra and Gujarat.",
        hsnCode: "380810",
        categoryId: tree.plantProtection.id,
        subCategoryId: tree.insecticide.id,
        brandId: brands["demo-farmmax"]!.id,
        audience: "BOTH_CUSTOMER_AND_DEALER",
        baseUnit: "ML",
        packageSize: "250 ml / 1 L",
        searchTags: ["neem", "insecticide", "organic"],
        primaryImageUrl: IMG.insecticideBottle,
        images: [IMG.insecticideBottle],
        customerVisible: true,
        dealerVisible: true,
        availableStateCodes: ["MH", "GJ"],
      },
      states,
    );
    await addSingleAttributeVariants(p.id, "CUSTOMER", attrs.packSize.id, [
      {
        value: "250 ml",
        slug: "250-ml",
        sku: "DEMO-NEEM-INSECTICIDE-F-250ML",
        mrp: 220,
        discountType: "FLAT",
        discountValue: 20,
        stock: 180,
        weight: 300,
        isDefault: true,
      },
      {
        value: "1 L",
        slug: "1-l",
        sku: "DEMO-NEEM-INSECTICIDE-F-1L",
        mrp: 780,
        discountType: "FLAT",
        discountValue: 80,
        stock: 90,
        weight: 1150,
      },
    ]);
    await addSingleAttributeVariants(p.id, "DEALER", attrs.packSize.id, [
      {
        value: "1 L (Dealer Case)",
        slug: "1-l-case",
        sku: "DEMO-NEEM-INSECTICIDE-D-1L",
        mrp: 700,
        discountType: "FLAT",
        discountValue: 120,
        stock: 40,
        weight: 1150,
        minOrderQty: 10,
        isDefault: true,
      },
    ]);
  }

  await track(
    "demo-potash-fertilizer-bag",
    "demo-potash-fertilizer-bag (Pack Size variant, both audiences)",
  );
  {
    const p = await createSimpleProductIfMissing(
      sellers[2]!.sellerId,
      {
        slug: "demo-potash-fertilizer-bag",
        sku: "DEMO-POTASH-FERT",
        name: "DEMO Potash Fertilizer Bag",
        shortDescription: "Muriate of potash for flowering and fruiting stages.",
        description:
          "Muriate of potash fertilizer bags in three standard sizes, for flowering and fruiting stages.",
        hsnCode: "310420",
        categoryId: tree.plantNutrients.id,
        subCategoryId: tree.fertilisers.id,
        brandId: brands["demo-greengrow"]!.id,
        audience: "BOTH_CUSTOMER_AND_DEALER",
        baseUnit: "KG",
        packageSize: "5 kg / 10 kg / 25 kg",
        searchTags: ["potash", "fertilizer", "muriate"],
        primaryImageUrl: IMG.fertilizerGranules,
        images: [IMG.fertilizerGranules],
        customerVisible: true,
        dealerVisible: true,
      },
      states,
    );
    await addSingleAttributeVariants(p.id, "CUSTOMER", attrs.packSize.id, [
      {
        value: "5 kg",
        slug: "5-kg",
        sku: "DEMO-POTASH-FERT-F-5KG",
        mrp: 400,
        discountType: "FLAT",
        discountValue: 40,
        stock: 150,
        weight: 5000,
        isDefault: true,
      },
      {
        value: "10 kg",
        slug: "10-kg",
        sku: "DEMO-POTASH-FERT-F-10KG",
        mrp: 750,
        discountType: "FLAT",
        discountValue: 70,
        stock: 100,
        weight: 10000,
      },
    ]);
    await addSingleAttributeVariants(p.id, "DEALER", attrs.packSize.id, [
      {
        value: "25 kg",
        slug: "25-kg",
        sku: "DEMO-POTASH-FERT-D-25KG",
        mrp: 1800,
        discountType: "FLAT",
        discountValue: 250,
        stock: 50,
        weight: 25000,
        minOrderQty: 4,
        isDefault: true,
      },
    ]);
  }

  // --- Seller 3: DEMO Digital Bazaar Electronics — Technology ---
  await track(
    "demo-smartphone-x12",
    "demo-smartphone-x12 (Color x Storage, uneven combos, one OOS)",
  );
  {
    const p = await createSimpleProductIfMissing(
      sellers[3]!.sellerId,
      {
        slug: "demo-smartphone-x12",
        sku: "DEMO-SMARTPHONE-X12",
        name: "DEMO Smartphone X12",
        subtitle: "6.5-inch display, dual camera",
        shortDescription: "Mid-range smartphone with dual camera and long battery life.",
        description:
          "A mid-range 6.5-inch smartphone with dual rear camera, fast charging, and a full-day battery. Available in three colours and multiple storage options — not every colour comes in every storage size.",
        hsnCode: "85171300",
        categoryId: tree.technology.id,
        subCategoryId: tree.mobile.id,
        brandId: brands["demo-technova"]!.id,
        manufacturerId: mfrs["demo-samsung-electronics-mfg"]!.id,
        audience: "BOTH_CUSTOMER_AND_DEALER",
        baseUnit: "PIECE",
        packageSize: "1 unit",
        searchTags: ["smartphone", "mobile", "electronics"],
        primaryImageUrl: IMG.smartphone,
        images: [IMG.smartphone],
        customerVisible: true,
        dealerVisible: true,
        badge: "BEST_SELLER",
      },
      states,
    );
    // Black: 64/128/256 GB. Blue: 128/256 GB only. Silver: 256 GB only —
    // "one colour supports fewer sizes than another" (requirement 4).
    await addTwoAttributeVariants(
      p.id,
      "CUSTOMER",
      { id: attrs.color.id, label: "Color", values: ["Black", "Blue", "Silver"] },
      { id: attrs.storage.id, label: "Storage", values: ["64 GB", "128 GB", "256 GB"] },
      [
        {
          attr1Value: "Black",
          attr2Value: "64 GB",
          sku: "DEMO-SMARTPHONE-X12-BLK-64",
          mrp: 12999,
          discountType: "FLAT",
          discountValue: 1000,
          stock: 25,
          weight: 190,
          isDefault: true,
        },
        {
          attr1Value: "Black",
          attr2Value: "128 GB",
          sku: "DEMO-SMARTPHONE-X12-BLK-128",
          mrp: 14999,
          discountType: "FLAT",
          discountValue: 1000,
          stock: 20,
          weight: 190,
        },
        {
          attr1Value: "Black",
          attr2Value: "256 GB",
          sku: "DEMO-SMARTPHONE-X12-BLK-256",
          mrp: 17999,
          discountType: "FLAT",
          discountValue: 1000,
          stock: 0,
          weight: 190,
        }, // out-of-stock variant example
        {
          attr1Value: "Blue",
          attr2Value: "128 GB",
          sku: "DEMO-SMARTPHONE-X12-BLU-128",
          mrp: 14999,
          discountType: "FLAT",
          discountValue: 1000,
          stock: 15,
          weight: 190,
        },
        {
          attr1Value: "Blue",
          attr2Value: "256 GB",
          sku: "DEMO-SMARTPHONE-X12-BLU-256",
          mrp: 17999,
          discountType: "FLAT",
          discountValue: 1000,
          stock: 10,
          weight: 190,
        },
        {
          attr1Value: "Silver",
          attr2Value: "256 GB",
          sku: "DEMO-SMARTPHONE-X12-SLV-256",
          mrp: 17999,
          discountType: "FLAT",
          discountValue: 500,
          stock: 8,
          weight: 190,
        },
      ],
    );
  }

  await track(
    "demo-24-inch-led-monitor",
    "demo-24-inch-led-monitor (no variant, Computer>samsung leaf)",
  );
  await createSimpleProductIfMissing(
    sellers[3]!.sellerId,
    {
      slug: "demo-24-inch-led-monitor",
      sku: "DEMO-MONITOR-24IN",
      name: "DEMO 24-inch LED Monitor",
      shortDescription: "Full HD 24-inch LED monitor for office and home use.",
      description:
        "A 24-inch Full HD LED monitor with HDMI and VGA input, suited for office and home use.",
      hsnCode: "85285900",
      categoryId: tree.technology.id,
      subCategoryId: tree.computer.id,
      subSubCategoryId: tree.samsungLeaf.id,
      brandId: brands["demo-technova"]!.id,
      manufacturerId: mfrs["demo-samsung-electronics-mfg"]!.id,
      audience: "BOTH_CUSTOMER_AND_DEALER",
      baseUnit: "PIECE",
      packageSize: "1 unit",
      searchTags: ["monitor", "led", "computer"],
      primaryImageUrl: IMG.monitor,
      images: [IMG.monitor],
      customerVisible: true,
      dealerVisible: true,
      customer: { mrp: 8999, discountType: "FLAT", discountValue: 500, stock: 30, weight: 3600 },
      dealer: {
        mrp: 8200,
        discountType: "FLAT",
        discountValue: 700,
        stock: 15,
        weight: 3600,
        minOrderQty: 3,
      },
    },
    states,
  );

  await track(
    "demo-wireless-bluetooth-earbuds",
    "demo-wireless-bluetooth-earbuds (Color variant, entirely out of stock)",
  );
  {
    const p = await createSimpleProductIfMissing(
      sellers[3]!.sellerId,
      {
        slug: "demo-wireless-bluetooth-earbuds",
        sku: "DEMO-EARBUDS",
        name: "DEMO Wireless Bluetooth Earbuds",
        shortDescription: "True wireless earbuds with charging case.",
        description:
          "True wireless Bluetooth earbuds with a compact charging case — currently out of stock in every colour.",
        hsnCode: "85183000",
        categoryId: tree.technology.id,
        subCategoryId: tree.mobile.id,
        brandId: brands["demo-technova"]!.id,
        audience: "CUSTOMER_ONLY",
        baseUnit: "PIECE",
        packageSize: "1 pair",
        searchTags: ["earbuds", "bluetooth", "audio"],
        primaryImageUrl: IMG.earbuds,
        images: [IMG.earbuds],
        customerVisible: true,
        dealerVisible: false,
        // Entirely out-of-stock example (requirement 4): base config and
        // every variant below are stock 0.
        customer: { mrp: 1999, discountType: "FLAT", discountValue: 300, stock: 0, weight: 60 },
      },
      states,
    );
    await addSingleAttributeVariants(p.id, "CUSTOMER", attrs.color.id, [
      {
        value: "Black",
        slug: "black",
        sku: "DEMO-EARBUDS-BLACK",
        mrp: 1999,
        discountType: "FLAT",
        discountValue: 300,
        stock: 0,
        weight: 60,
        isDefault: true,
      },
      {
        value: "White",
        slug: "white",
        sku: "DEMO-EARBUDS-WHITE",
        mrp: 1999,
        discountType: "FLAT",
        discountValue: 300,
        stock: 0,
        weight: 60,
      },
    ]);
  }

  // --- Seller 4: DEMO Fashion Hub India — Clothing/Footwear ---
  await track("demo-mens-cotton-shirt", "demo-mens-cotton-shirt (Color x Size, uneven combos)");
  {
    const p = await createSimpleProductIfMissing(
      sellers[4]!.sellerId,
      {
        slug: "demo-mens-cotton-shirt",
        sku: "DEMO-MENS-SHIRT",
        name: "DEMO Men's Cotton Shirt",
        shortDescription: "Breathable 100% cotton casual shirt.",
        description:
          "A breathable 100% cotton casual shirt. White comes in four sizes; Navy is currently available in two.",
        hsnCode: "62052000",
        categoryId: leaves.clothing.id,
        subCategoryId: leaves.mensWear.id,
        brandId: brands["demo-urbanthread"]!.id,
        manufacturerId: mfrs["demo-threadworks-textiles"]!.id,
        audience: "BOTH_CUSTOMER_AND_DEALER",
        baseUnit: "PIECE",
        packageSize: "1 unit",
        searchTags: ["shirt", "cotton", "clothing", "men"],
        primaryImageUrl: IMG.shirtWhite,
        images: [IMG.shirtWhite, IMG.shirtBlue],
        customerVisible: true,
        dealerVisible: true,
      },
      states,
    );
    await addTwoAttributeVariants(
      p.id,
      "CUSTOMER",
      { id: attrs.color.id, label: "Color", values: ["White", "Navy"] },
      { id: attrs.size.id, label: "Size", values: ["S", "M", "L", "XL"] },
      [
        {
          attr1Value: "White",
          attr2Value: "S",
          sku: "DEMO-MENS-SHIRT-WHT-S",
          mrp: 799,
          discountType: "FLAT",
          discountValue: 100,
          stock: 40,
          weight: 220,
          imageUrl: IMG.shirtWhite,
          isDefault: true,
        },
        {
          attr1Value: "White",
          attr2Value: "M",
          sku: "DEMO-MENS-SHIRT-WHT-M",
          mrp: 799,
          discountType: "FLAT",
          discountValue: 100,
          stock: 50,
          weight: 230,
          imageUrl: IMG.shirtWhite,
        },
        {
          attr1Value: "White",
          attr2Value: "L",
          sku: "DEMO-MENS-SHIRT-WHT-L",
          mrp: 799,
          discountType: "FLAT",
          discountValue: 100,
          stock: 35,
          weight: 240,
          imageUrl: IMG.shirtWhite,
        },
        {
          attr1Value: "White",
          attr2Value: "XL",
          sku: "DEMO-MENS-SHIRT-WHT-XL",
          mrp: 849,
          discountType: "FLAT",
          discountValue: 100,
          stock: 20,
          weight: 250,
          imageUrl: IMG.shirtWhite,
        },
        // Navy: fewer sizes than White (requirement 4).
        {
          attr1Value: "Navy",
          attr2Value: "S",
          sku: "DEMO-MENS-SHIRT-NVY-S",
          mrp: 849,
          discountType: "FLAT",
          discountValue: 100,
          stock: 18,
          weight: 220,
          imageUrl: IMG.shirtBlue,
        },
        {
          attr1Value: "Navy",
          attr2Value: "M",
          sku: "DEMO-MENS-SHIRT-NVY-M",
          mrp: 849,
          discountType: "FLAT",
          discountValue: 100,
          stock: 22,
          weight: 230,
          imageUrl: IMG.shirtBlue,
        },
      ],
    );
  }

  await track(
    "demo-running-sports-shoes",
    "demo-running-sports-shoes (Color x Shoe Size, one OOS variant)",
  );
  {
    const p = await createSimpleProductIfMissing(
      sellers[4]!.sellerId,
      {
        slug: "demo-running-sports-shoes",
        sku: "DEMO-RUNNING-SHOES",
        name: "DEMO Running Sports Shoes",
        shortDescription: "Lightweight cushioned running shoes.",
        description:
          "Lightweight, cushioned running shoes suited for daily training. Two colours, four sizes each — one size/colour combo is temporarily out of stock.",
        hsnCode: "64041900",
        categoryId: leaves.footwear.id,
        brandId: brands["demo-stepright"]!.id,
        manufacturerId: mfrs["demo-solecraft-industries"]!.id,
        audience: "CUSTOMER_ONLY",
        baseUnit: "PIECE",
        packageSize: "1 pair",
        searchTags: ["shoes", "running", "sports", "footwear"],
        primaryImageUrl: IMG.shoesRunning,
        images: [IMG.shoesRunning],
        customerVisible: true,
        dealerVisible: false,
      },
      states,
    );
    await addTwoAttributeVariants(
      p.id,
      "CUSTOMER",
      { id: attrs.color.id, label: "Color", values: ["Black", "Grey"] },
      { id: attrs.shoeSize.id, label: "Shoe Size", values: ["UK 7", "UK 8", "UK 9", "UK 10"] },
      [
        {
          attr1Value: "Black",
          attr2Value: "UK 7",
          sku: "DEMO-RUNNING-SHOES-BLK-7",
          mrp: 2499,
          discountType: "FLAT",
          discountValue: 300,
          stock: 12,
          weight: 700,
          isDefault: true,
        },
        {
          attr1Value: "Black",
          attr2Value: "UK 8",
          sku: "DEMO-RUNNING-SHOES-BLK-8",
          mrp: 2499,
          discountType: "FLAT",
          discountValue: 300,
          stock: 15,
          weight: 720,
        },
        {
          attr1Value: "Black",
          attr2Value: "UK 9",
          sku: "DEMO-RUNNING-SHOES-BLK-9",
          mrp: 2499,
          discountType: "FLAT",
          discountValue: 300,
          stock: 0,
          weight: 740,
        }, // out-of-stock variant example
        {
          attr1Value: "Black",
          attr2Value: "UK 10",
          sku: "DEMO-RUNNING-SHOES-BLK-10",
          mrp: 2599,
          discountType: "FLAT",
          discountValue: 300,
          stock: 8,
          weight: 760,
        },
        {
          attr1Value: "Grey",
          attr2Value: "UK 8",
          sku: "DEMO-RUNNING-SHOES-GRY-8",
          mrp: 2499,
          discountType: "FLAT",
          discountValue: 300,
          stock: 10,
          weight: 720,
        },
        {
          attr1Value: "Grey",
          attr2Value: "UK 9",
          sku: "DEMO-RUNNING-SHOES-GRY-9",
          mrp: 2499,
          discountType: "FLAT",
          discountValue: 300,
          stock: 9,
          weight: 740,
        },
      ],
    );
  }

  await track("demo-casual-sneakers", "demo-casual-sneakers (Shoe Size only, single attribute)");
  {
    const p = await createSimpleProductIfMissing(
      sellers[4]!.sellerId,
      {
        slug: "demo-casual-sneakers",
        sku: "DEMO-CASUAL-SNEAKERS",
        name: "DEMO Casual Sneakers",
        shortDescription: "Everyday canvas sneakers, one colourway.",
        description:
          "Everyday canvas sneakers in a single colourway, sized only — a simple one-attribute variant example.",
        hsnCode: "64041900",
        categoryId: leaves.footwear.id,
        brandId: brands["demo-stepright"]!.id,
        audience: "BOTH_CUSTOMER_AND_DEALER",
        baseUnit: "PIECE",
        packageSize: "1 pair",
        searchTags: ["sneakers", "casual", "footwear"],
        primaryImageUrl: IMG.shoesSneaker,
        images: [IMG.shoesSneaker, IMG.shoesConverse],
        customerVisible: true,
        dealerVisible: true,
      },
      states,
    );
    await addSingleAttributeVariants(p.id, "CUSTOMER", attrs.shoeSize.id, [
      {
        value: "UK 7",
        slug: "uk-7",
        sku: "DEMO-CASUAL-SNEAKERS-7",
        mrp: 1499,
        discountType: "FLAT",
        discountValue: 150,
        stock: 20,
        weight: 600,
        isDefault: true,
      },
      {
        value: "UK 8",
        slug: "uk-8",
        sku: "DEMO-CASUAL-SNEAKERS-8",
        mrp: 1499,
        discountType: "FLAT",
        discountValue: 150,
        stock: 25,
        weight: 610,
      },
      {
        value: "UK 9",
        slug: "uk-9",
        sku: "DEMO-CASUAL-SNEAKERS-9",
        mrp: 1499,
        discountType: "FLAT",
        discountValue: 150,
        stock: 18,
        weight: 620,
      },
    ]);
  }

  // --- Seller 5: DEMO Home & Garden Co — Gardening Product ---
  await track("demo-garden-watering-can", "demo-garden-watering-can (no variant)");
  await createSimpleProductIfMissing(
    sellers[5]!.sellerId,
    {
      slug: "demo-garden-watering-can",
      sku: "DEMO-WATERING-CAN",
      name: "DEMO Garden Watering Can",
      shortDescription: "5-litre metal watering can with detachable rose head.",
      description:
        "A durable 5-litre metal watering can with a detachable rose head, for home and terrace gardens.",
      hsnCode: "82019000",
      categoryId: tree.gardening.id,
      brandId: brands["demo-greenthumb-tools"]!.id,
      audience: "CUSTOMER_ONLY",
      baseUnit: "PIECE",
      packageSize: "1 unit",
      searchTags: ["watering can", "gardening", "tools"],
      primaryImageUrl: IMG.wateringCan,
      images: [IMG.wateringCan],
      customerVisible: true,
      dealerVisible: false,
      customer: { mrp: 599, discountType: "FLAT", discountValue: 100, stock: 60, weight: 900 },
    },
    states,
  );

  await track("demo-pruning-shears-set", "demo-pruning-shears-set (Type variant)");
  {
    const p = await createSimpleProductIfMissing(
      sellers[5]!.sellerId,
      {
        slug: "demo-pruning-shears-set",
        sku: "DEMO-PRUNING-SHEARS",
        name: "DEMO Pruning Shears Set",
        shortDescription: "Carbon-steel pruning shears, standard and heavy-duty.",
        description: "Carbon-steel pruning shears available in standard and heavy-duty builds.",
        hsnCode: "82015000",
        categoryId: tree.gardening.id,
        brandId: brands["demo-greenthumb-tools"]!.id,
        audience: "BOTH_CUSTOMER_AND_DEALER",
        baseUnit: "PIECE",
        packageSize: "1 unit",
        searchTags: ["pruning shears", "gardening tools"],
        primaryImageUrl: IMG.pruningShears,
        images: [IMG.pruningShears],
        customerVisible: true,
        dealerVisible: true,
      },
      states,
    );
    await addSingleAttributeVariants(p.id, "CUSTOMER", attrs.type.id, [
      {
        value: "Standard",
        slug: "standard",
        sku: "DEMO-PRUNING-SHEARS-STD",
        mrp: 349,
        discountType: "FLAT",
        discountValue: 50,
        stock: 70,
        weight: 180,
        isDefault: true,
      },
      {
        value: "Heavy-Duty",
        slug: "heavy-duty",
        sku: "DEMO-PRUNING-SHEARS-HD",
        mrp: 599,
        discountType: "FLAT",
        discountValue: 80,
        stock: 40,
        weight: 260,
      },
    ]);
  }

  await track("demo-garden-hose-20m", "demo-garden-hose-20m (no variant, unfeatured brand)");
  await createSimpleProductIfMissing(
    sellers[5]!.sellerId,
    {
      slug: "demo-garden-hose-20m",
      sku: "DEMO-GARDEN-HOSE-20M",
      name: "DEMO Garden Hose 20m",
      shortDescription: "Flexible 20-metre garden hose with connector.",
      description:
        "A flexible 20-metre garden hose with a standard tap connector, for medium to large gardens.",
      hsnCode: "39173900",
      categoryId: tree.gardening.id,
      brandId: brands["demo-noname-agro-supplies"]!.id,
      audience: "CUSTOMER_ONLY",
      baseUnit: "PIECE",
      packageSize: "20 m",
      searchTags: ["garden hose", "irrigation", "gardening"],
      primaryImageUrl: IMG.gardenHose,
      images: [IMG.gardenHose],
      customerVisible: true,
      dealerVisible: false,
      customer: { mrp: 899, discountType: "FLAT", discountValue: 150, stock: 45, weight: 2400 },
    },
    states,
  );

  // --- Seller 6: DEMO AgroMax Traders — multi-category, reuses brands from sellers 1/2 ---
  await track(
    "demo-micronutrient-mix",
    "demo-micronutrient-mix (no variant, FarmMax brand reused)",
  );
  await createSimpleProductIfMissing(
    sellers[6]!.sellerId,
    {
      slug: "demo-micronutrient-mix",
      sku: "DEMO-MICRONUTRIENT-MIX",
      name: "DEMO Micronutrient Mix",
      shortDescription: "Chelated micronutrient mix for deficiency correction.",
      description:
        "A chelated micronutrient mix (Zn, Fe, Mn, B) for correcting common soil deficiencies.",
      hsnCode: "310510",
      categoryId: tree.plantNutrients.id,
      subCategoryId: tree.fertilisers.id,
      brandId: brands["demo-farmmax"]!.id,
      audience: "BOTH_CUSTOMER_AND_DEALER",
      baseUnit: "KG",
      packageSize: "1 kg",
      searchTags: ["micronutrient", "chelated", "fertilizer"],
      primaryImageUrl: IMG.fertilizerGranulesAlt,
      images: [IMG.fertilizerGranulesAlt],
      customerVisible: true,
      dealerVisible: true,
      customer: { mrp: 320, discountType: "FLAT", discountValue: 20, stock: 130, weight: 1000 },
      dealer: {
        mrp: 2900,
        discountType: "FLAT",
        discountValue: 200,
        stock: 50,
        weight: 10000,
        minOrderQty: 10,
      },
    },
    states,
  );

  await track(
    "demo-liquid-bio-consortia-1l",
    "demo-liquid-bio-consortia-1l (no variant, GreenGrow brand reused)",
  );
  await createSimpleProductIfMissing(
    sellers[6]!.sellerId,
    {
      slug: "demo-liquid-bio-consortia-1l",
      sku: "DEMO-LIQUID-CONSORTIA-1L",
      name: "DEMO Liquid Bio Consortia 1L",
      shortDescription: "Ready-to-use liquid microbial consortia.",
      description: "A ready-to-use 1-litre liquid microbial consortia for soil application.",
      hsnCode: "310100",
      categoryId: tree.plantNutrients.id,
      subCategoryId: tree.bioFertilisers?.id,
      subSubCategoryId: tree.liquidConsortia.id,
      brandId: brands["demo-greengrow"]!.id,
      audience: "CUSTOMER_ONLY",
      baseUnit: "L",
      packageSize: "1 L",
      searchTags: ["liquid consortia", "biofertilizer"],
      primaryImageUrl: IMG.fertilizerLiquid,
      images: [IMG.fertilizerLiquid],
      customerVisible: true,
      dealerVisible: false,
      customer: { mrp: 420, discountType: "FLAT", discountValue: 40, stock: 90, weight: 1100 },
    },
    states,
  );

  await track(
    "demo-fungicide-concentrate",
    "demo-fungicide-concentrate (no variant, BioCrop brand reused)",
  );
  await createSimpleProductIfMissing(
    sellers[6]!.sellerId,
    {
      slug: "demo-fungicide-concentrate",
      sku: "DEMO-FUNGICIDE-CONCENTRATE",
      name: "DEMO Fungicide Concentrate",
      shortDescription: "Concentrated fungicide, dilute before spraying.",
      description:
        "A concentrated broad-spectrum fungicide — dilute per label instructions before spraying.",
      hsnCode: "380893",
      categoryId: tree.plantProtection.id,
      subCategoryId: tree.fungicide.id,
      brandId: brands["demo-biocrop-solutions"]!.id,
      audience: "BOTH_CUSTOMER_AND_DEALER",
      baseUnit: "ML",
      packageSize: "250 ml",
      searchTags: ["fungicide", "concentrate"],
      primaryImageUrl: IMG.fungicideBottle,
      images: [IMG.fungicideBottle],
      customerVisible: true,
      dealerVisible: true,
      customer: { mrp: 340, discountType: "FLAT", discountValue: 30, stock: 110, weight: 300 },
      dealer: {
        mrp: 3100,
        discountType: "FLAT",
        discountValue: 300,
        stock: 35,
        weight: 3000,
        minOrderQty: 10,
      },
    },
    states,
  );

  await track(
    "demo-insect-repellent-spray",
    "demo-insect-repellent-spray (no variant, AgriPure-style, uses FarmMax)",
  );
  await createSimpleProductIfMissing(
    sellers[6]!.sellerId,
    {
      slug: "demo-insect-repellent-spray",
      sku: "DEMO-INSECT-REPELLENT",
      name: "DEMO Insect Repellent Spray",
      shortDescription: "General-purpose crop insect repellent spray.",
      description: "A general-purpose insect repellent spray for standing crops.",
      hsnCode: "380891",
      categoryId: tree.plantProtection.id,
      subCategoryId: tree.insecticide.id,
      brandId: brands["demo-farmmax"]!.id,
      audience: "CUSTOMER_ONLY",
      baseUnit: "ML",
      packageSize: "500 ml",
      searchTags: ["insecticide", "repellent"],
      primaryImageUrl: IMG.insecticideBottle,
      images: [IMG.insecticideBottle],
      customerVisible: true,
      dealerVisible: false,
      customer: { mrp: 260, discountType: "FLAT", discountValue: 20, stock: 140, weight: 560 },
    },
    states,
  );

  return created;
}

// ---------------------------------------------------------------------------
// 6. Customers & dealers
// ---------------------------------------------------------------------------

async function seedDemoCustomers(states: Array<{ id: string; code: string }>) {
  const maharashtra = states.find((s) => s.code === "MH")!;
  const karnataka = states.find((s) => s.code === "KA")!;
  const kerala = states.find((s) => s.code === "KL")!;

  const priya = await prisma.user.upsert({
    where: { phone: "+919700000001" },
    update: {},
    create: {
      phone: "+919700000001",
      firstName: "Demo",
      lastName: "Customer Priya",
      role: "CUSTOMER" as UserRole,
      referralCode: "DEMO-CUST-1",
      isPhoneVerified: true,
    },
  });
  const arjun = await prisma.user.upsert({
    where: { phone: "+919700000002" },
    update: {},
    create: {
      phone: "+919700000002",
      firstName: "Demo",
      lastName: "Customer Arjun",
      role: "CUSTOMER" as UserRole,
      referralCode: "DEMO-CUST-2",
      isPhoneVerified: true,
    },
  });
  const fatima = await prisma.user.upsert({
    where: { phone: "+919700000003" },
    update: {},
    create: {
      phone: "+919700000003",
      firstName: "Demo",
      lastName: "Customer Fatima",
      role: "CUSTOMER" as UserRole,
      referralCode: "DEMO-CUST-3",
      isPhoneVerified: true,
    },
  });

  for (const [user, state, addr] of [
    [
      priya,
      maharashtra,
      { line1: "14 Station Road", cityTown: "Pune", district: "Pune", pincode: "411001" },
    ],
    [
      arjun,
      karnataka,
      {
        line1: "22 MG Road",
        cityTown: "Bengaluru",
        district: "Bengaluru Urban",
        pincode: "560001",
      },
    ],
    [
      fatima,
      kerala,
      { line1: "8 Marine Drive", cityTown: "Kochi", district: "Ernakulam", pincode: "682001" },
    ],
  ] as const) {
    const existing = await prisma.customerAddress.findFirst({ where: { userId: user.id } });
    if (!existing) {
      await prisma.customerAddress.create({
        data: {
          userId: user.id,
          fullName: getFullName(user) ?? user.phone!,
          mobile: user.phone!,
          line1: addr.line1,
          cityTown: addr.cityTown,
          district: addr.district,
          state: state.code === "MH" ? "Maharashtra" : state.code === "KA" ? "Karnataka" : "Kerala",
          stateId: state.id,
          pincode: addr.pincode,
          addressType: "HOME",
          isDefault: true,
        },
      });
    }
  }

  return { priya, arjun, fatima };
}

async function seedDemoDealers(states: Array<{ id: string; code: string }>) {
  const rajasthan = states.find((s) => s.code === "RJ")!;
  const delhi = states.find((s) => s.code === "DL")!;
  const up = states.find((s) => s.code === "UP")!;

  const vikram = await prisma.user.upsert({
    where: { phone: "+919800000001" },
    update: {},
    create: {
      phone: "+919800000001",
      firstName: "Demo",
      lastName: "Dealer Vikram",
      role: "DEALER" as UserRole,
      referralCode: "DEMO-DEALER-1",
      isPhoneVerified: true,
    },
  });
  await prisma.dealerProfile.upsert({
    where: { userId: vikram.id },
    update: {
      status: ApplicationStatus.APPROVED,
      kycStatus: KycStatus.APPROVED,
      stateId: rajasthan.id,
      state: rajasthan.name,
    },
    create: {
      userId: vikram.id,
      storeName: "Demo Vikram Agri Store",
      storeAddress: "17 Agri Market Yard",
      city: "Jaipur",
      state: rajasthan.name,
      stateId: rajasthan.id,
      pincode: "302001",
      status: ApplicationStatus.APPROVED,
      kycStatus: KycStatus.APPROVED,
      gstNumber: "08DEMODLR001Z1",
      gstDocUrl: "/demo/docs/dealer1-gst.pdf",
      licenseNumber: "DEMO-LIC-001",
      licenseDocUrl: "/demo/docs/dealer1-license.pdf",
    },
  });

  const rao = await prisma.user.upsert({
    where: { phone: "+919800000002" },
    update: {},
    create: {
      phone: "+919800000002",
      firstName: "Demo",
      lastName: "Dealer Rao (Pending)",
      role: "DEALER" as UserRole,
      referralCode: "DEMO-DEALER-2",
      isPhoneVerified: true,
    },
  });
  await prisma.dealerProfile.upsert({
    where: { userId: rao.id },
    update: {
      status: ApplicationStatus.PENDING,
      kycStatus: KycStatus.PENDING_REVIEW,
      stateId: delhi.id,
      state: delhi.name,
    },
    create: {
      userId: rao.id,
      storeName: "Demo Rao New Traders",
      storeAddress: "9 Wholesale Market",
      city: "Delhi",
      state: delhi.name,
      stateId: delhi.id,
      pincode: "110001",
      status: ApplicationStatus.PENDING,
      kycStatus: KycStatus.PENDING_REVIEW,
    },
  });

  const singh = await prisma.user.upsert({
    where: { phone: "+919800000003" },
    update: {},
    create: {
      phone: "+919800000003",
      firstName: "Demo",
      lastName: "Dealer Singh (Rejected)",
      role: "DEALER" as UserRole,
      referralCode: "DEMO-DEALER-3",
      isPhoneVerified: true,
    },
  });
  await prisma.dealerProfile.upsert({
    where: { userId: singh.id },
    update: {
      status: ApplicationStatus.REJECTED,
      kycStatus: KycStatus.REJECTED,
      rejectionReason: "License document expired — please resubmit.",
      stateId: up.id,
      state: up.name,
    },
    create: {
      userId: singh.id,
      storeName: "Demo Singh Farm Supplies",
      storeAddress: "3 Mandi Road",
      city: "Lucknow",
      state: up.name,
      stateId: up.id,
      pincode: "226001",
      status: ApplicationStatus.REJECTED,
      kycStatus: KycStatus.REJECTED,
      rejectionReason: "License document expired — please resubmit.",
    },
  });

  return { vikram, rao, singh };
}

// ---------------------------------------------------------------------------
// 7. Orders — real OrderStatus lifecycle, built directly via Prisma (same
//    reasoning as seed.ts's seedSampleSellerOrder: no cross-package
//    dependency on @kisan4u/orders' checkout() transaction).
// ---------------------------------------------------------------------------

type DemoItemInput = {
  productId: string;
  productName: string;
  productImageUrl: string;
  sku: string;
  quantity: number;
  unit: BaseUnit;
  unitWeightGrams: number;
  mrp: number;
  unitPrice: number;
};

async function createDemoCheckoutGroup(
  groupNumber: string,
  customerId: string,
  customerType: "CUSTOMER" | "DEALER",
  address: {
    fullName: string;
    mobile: string;
    line1: string;
    cityTown: string;
    district: string;
    state: string;
    pincode: string;
  },
) {
  const existing = await prisma.checkoutGroup.findUnique({ where: { groupNumber } });
  if (existing) return existing;
  return prisma.checkoutGroup.create({
    data: {
      groupNumber,
      customerId,
      customerType,
      addressSnapshot: { create: { ...address, addressType: "HOME" } },
    },
  });
}

const STATUS_CHAIN: OrderStatus[] = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "SELLER_ACCEPTED",
  "PACKED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
];
function chainUpTo(status: OrderStatus): OrderStatus[] {
  if (status === "CANCELLED") return ["PENDING_PAYMENT", "CONFIRMED", "CANCELLED"];
  if (status === "RETURN_REQUESTED") return [...STATUS_CHAIN, "RETURN_REQUESTED"];
  const idx = STATUS_CHAIN.indexOf(status);
  return idx >= 0 ? STATUS_CHAIN.slice(0, idx + 1) : [status];
}

async function createDemoSellerOrder(params: {
  groupId: string;
  orderNumber: string;
  customerId: string;
  customerType: "CUSTOMER" | "DEALER";
  sellerId: string;
  targetStatus: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentOutcome: "PAID" | "FAILED" | "PARTIAL";
  items: DemoItemInput[];
}) {
  const existing = await prisma.sellerOrder.findUnique({
    where: { orderNumber: params.orderNumber },
  });
  if (existing) return existing;

  const subtotal = params.items.reduce((t, i) => t + i.unitPrice * i.quantity, 0);
  const totalWeightGrams = params.items.reduce((t, i) => t + i.unitWeightGrams * i.quantity, 0);
  const transportationCost = 60;
  const transportationPayer = "SELLER" as const;
  const customerPayableDelivery = 0;
  const totalAmount = subtotal + customerPayableDelivery;
  const collectionChargeCalc = calcCollectionChargeDemo(subtotal);

  const sellerOrder = await prisma.sellerOrder.create({
    data: {
      orderNumber: params.orderNumber,
      checkoutGroupId: params.groupId,
      customerId: params.customerId,
      sellerId: params.sellerId,
      customerType: params.customerType,
      status: params.targetStatus,
      paymentMethod: params.paymentMethod,
      deliveryMethod: "KISAN4U_COURIER",
      subtotal,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount,
      invoiceNumber: `${params.orderNumber}-INV`,
      items: {
        create: params.items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          productImageUrl: item.productImageUrl,
          sku: item.sku,
          quantity: item.quantity,
          unit: item.unit,
          unitWeightGrams: item.unitWeightGrams,
          totalWeightGrams: item.unitWeightGrams * item.quantity,
          mrp: item.mrp,
          unitPrice: item.unitPrice,
          discountAmount: 0,
          taxRatePercent: 0,
          taxAmount: 0,
          subtotal: item.unitPrice * item.quantity,
        })),
      },
      charge: {
        create: {
          shipmentWeightGrams: totalWeightGrams,
          transportationCost,
          transportationPayer,
          collectionCharge: collectionChargeCalc.finalCharge,
          collectionChargePayer: "SELLER",
          collectionChargeSnapshot: { sellerOrderValue: subtotal, ...collectionChargeCalc },
          customerPayableDelivery,
          kisan4uCollectedAmount: transportationCost + collectionChargeCalc.finalCharge,
          sellerBorneAmount: transportationCost + collectionChargeCalc.finalCharge,
          customerPayableTotal: totalAmount,
          slabSnapshot: {
            mode: "KISAN4U_COURIER",
            demo: true,
            note: "seed-demo.ts — not a real slab match",
          },
        },
      },
    },
    include: { items: true },
  });

  for (const status of chainUpTo(params.targetStatus)) {
    await prisma.orderStatusHistory.create({
      data: {
        sellerOrderId: sellerOrder.id,
        status,
        actorId: params.customerId,
        actorRole: params.customerType,
        source: status === "PENDING_PAYMENT" ? "CUSTOMER" : "SYSTEM",
        note: `seed-demo.ts reaching ${status}`,
      },
    });
  }

  if (params.targetStatus === "IN_TRANSIT" || params.targetStatus === "DELIVERED") {
    await prisma.shipment.create({
      data: {
        sellerOrderId: sellerOrder.id,
        pickupPointSnapshot: { demo: true },
        awbNumber: `MOCKAWB-DEMO-${params.orderNumber}`,
        status: params.targetStatus === "DELIVERED" ? "DELIVERED" : "IN_TRANSIT",
      },
    });
  }

  const paymentStatus: PaymentStatus =
    params.paymentOutcome === "PAID"
      ? "PAID"
      : params.paymentOutcome === "PARTIAL"
        ? "PARTIALLY_PAID"
        : "FAILED";
  const paymentTotal =
    params.paymentOutcome === "PARTIAL" ? Math.round(totalAmount * 0.2 * 100) / 100 : totalAmount;
  const amountPaid = params.paymentOutcome === "FAILED" ? 0 : paymentTotal;

  const payment = await prisma.payment.create({
    data: {
      checkoutGroupId: params.groupId,
      customerId: params.customerId,
      method: params.paymentMethod,
      status: paymentStatus,
      totalAmount: paymentTotal,
      amountPaid,
      internalReference: `PAY-${params.orderNumber}`,
    },
  });
  await prisma.paymentAllocation.create({
    data: { paymentId: payment.id, sellerOrderId: sellerOrder.id, amount: paymentTotal },
  });
  await prisma.paymentStatusHistory.create({
    data: { paymentId: payment.id, status: paymentStatus, source: "PAYMENT_PROVIDER" },
  });

  return sellerOrder;
}

async function seedDemoOrders(
  customers: Awaited<ReturnType<typeof seedDemoCustomers>>,
  dealers: Awaited<ReturnType<typeof seedDemoDealers>>,
  sellers: Record<number, { sellerId: string }>,
) {
  const priyaAddr = {
    fullName: "Demo Customer Priya",
    mobile: "+919700000001",
    line1: "14 Station Road",
    cityTown: "Pune",
    district: "Pune",
    state: "Maharashtra",
    pincode: "411001",
  };
  const arjunAddr = {
    fullName: "Demo Customer Arjun",
    mobile: "+919700000002",
    line1: "22 MG Road",
    cityTown: "Bengaluru",
    district: "Bengaluru Urban",
    pincode: "560001",
    state: "Karnataka",
  };
  const vikramAddr = {
    fullName: "Demo Dealer Vikram",
    mobile: "+919800000001",
    line1: "17 Agri Market Yard",
    cityTown: "Jaipur",
    district: "Jaipur",
    state: "Rajasthan",
    pincode: "302001",
  };

  const compost = await prisma.product.findUnique({
    where: { slug: "demo-organic-compost-fertilizer" },
    include: { customerConfig: true },
  });
  const consortiaPack = await prisma.product.findUnique({
    where: { slug: "demo-carrier-consortia-bio-pack" },
    include: { customerConfig: true },
  });
  const shirt = await prisma.product.findUnique({ where: { slug: "demo-mens-cotton-shirt" } });
  const shirtVariant = await prisma.productVariant.findUnique({
    where: { sku: "DEMO-MENS-SHIRT-WHT-M" },
  });
  const monitor = await prisma.product.findUnique({
    where: { slug: "demo-24-inch-led-monitor" },
    include: { customerConfig: true, dealerConfig: true },
  });
  const potash = await prisma.product.findUnique({
    where: { slug: "demo-potash-fertilizer-bag" },
    include: { customerConfig: true },
  });
  const wateringCan = await prisma.product.findUnique({
    where: { slug: "demo-garden-watering-can" },
    include: { customerConfig: true },
  });

  const deliveredOrderItemIds: {
    priyaProductId?: string;
    priyaOrderItemId?: string;
    arjunProductId?: string;
    arjunOrderItemId?: string;
  } = {};

  if (compost?.customerConfig) {
    const group1 = await createDemoCheckoutGroup(
      "DEMO-K4U-20260801-0001",
      customers.priya.id,
      "CUSTOMER",
      priyaAddr,
    );
    await createDemoSellerOrder({
      groupId: group1.id,
      orderNumber: "DEMO-K4U-20260801-0001-S1",
      customerId: customers.priya.id,
      customerType: "CUSTOMER",
      sellerId: sellers[1]!.sellerId,
      targetStatus: "PENDING_PAYMENT",
      paymentMethod: "ONLINE_FULL",
      paymentOutcome: "FAILED",
      items: [
        {
          productId: compost.id,
          productName: compost.name,
          productImageUrl: compost.primaryImageUrl,
          sku: compost.sku,
          quantity: 2,
          unit: "KG",
          unitWeightGrams: 5000,
          mrp: Number(compost.customerConfig.mrp),
          unitPrice: Number(compost.customerConfig.sellingPrice),
        },
      ],
    });

    const group2 = await createDemoCheckoutGroup(
      "DEMO-K4U-20260802-0002",
      customers.priya.id,
      "CUSTOMER",
      priyaAddr,
    );
    await createDemoSellerOrder({
      groupId: group2.id,
      orderNumber: "DEMO-K4U-20260802-0002-S1",
      customerId: customers.priya.id,
      customerType: "CUSTOMER",
      sellerId: sellers[1]!.sellerId,
      targetStatus: "CONFIRMED",
      paymentMethod: "COD",
      paymentOutcome: "PAID",
      items: [
        {
          productId: compost.id,
          productName: compost.name,
          productImageUrl: compost.primaryImageUrl,
          sku: compost.sku,
          quantity: 1,
          unit: "KG",
          unitWeightGrams: 5000,
          mrp: Number(compost.customerConfig.mrp),
          unitPrice: Number(compost.customerConfig.sellingPrice),
        },
      ],
    });
  }

  // Multi-seller checkout: one CheckoutGroup, two SellerOrders (seller 3 + seller 4), different statuses.
  if (monitor?.customerConfig && shirt && shirtVariant) {
    const group3 = await createDemoCheckoutGroup(
      "DEMO-K4U-20260803-0003",
      customers.arjun.id,
      "CUSTOMER",
      arjunAddr,
    );
    await createDemoSellerOrder({
      groupId: group3.id,
      orderNumber: "DEMO-K4U-20260803-0003-S1",
      customerId: customers.arjun.id,
      customerType: "CUSTOMER",
      sellerId: sellers[3]!.sellerId,
      targetStatus: "SELLER_ACCEPTED",
      paymentMethod: "ONLINE_FULL",
      paymentOutcome: "PAID",
      items: [
        {
          productId: monitor.id,
          productName: monitor.name,
          productImageUrl: monitor.primaryImageUrl,
          sku: monitor.sku,
          quantity: 1,
          unit: "PIECE",
          unitWeightGrams: 3600,
          mrp: Number(monitor.customerConfig.mrp),
          unitPrice: Number(monitor.customerConfig.sellingPrice),
        },
      ],
    });
    await createDemoSellerOrder({
      groupId: group3.id,
      orderNumber: "DEMO-K4U-20260803-0003-S2",
      customerId: customers.arjun.id,
      customerType: "CUSTOMER",
      sellerId: sellers[4]!.sellerId,
      targetStatus: "PACKED",
      paymentMethod: "ONLINE_FULL",
      paymentOutcome: "PAID",
      items: [
        {
          productId: shirt.id,
          productName: shirt.name,
          productImageUrl: shirt.primaryImageUrl,
          sku: shirtVariant.sku,
          quantity: 1,
          unit: "PIECE",
          unitWeightGrams: 230,
          mrp: Number(shirtVariant.mrp),
          unitPrice: Number(shirtVariant.sellingPrice),
        },
      ],
    });
  }

  if (potash?.customerConfig) {
    const group4 = await createDemoCheckoutGroup(
      "DEMO-K4U-20260804-0004",
      customers.priya.id,
      "CUSTOMER",
      priyaAddr,
    );
    await createDemoSellerOrder({
      groupId: group4.id,
      orderNumber: "DEMO-K4U-20260804-0004-S1",
      customerId: customers.priya.id,
      customerType: "CUSTOMER",
      sellerId: sellers[2]!.sellerId,
      targetStatus: "IN_TRANSIT",
      paymentMethod: "ONLINE_PARTIAL",
      paymentOutcome: "PARTIAL",
      items: [
        {
          productId: potash.id,
          productName: potash.name,
          productImageUrl: potash.primaryImageUrl,
          sku: potash.sku,
          quantity: 1,
          unit: "KG",
          unitWeightGrams: 5000,
          mrp: Number(potash.customerConfig.mrp),
          unitPrice: Number(potash.customerConfig.sellingPrice),
        },
      ],
    });
  }

  // Delivered order for Priya on the consortia pack — enables a real verified-purchase review.
  if (consortiaPack?.customerConfig) {
    const group5 = await createDemoCheckoutGroup(
      "DEMO-K4U-20260805-0005",
      customers.priya.id,
      "CUSTOMER",
      priyaAddr,
    );
    const order5 = await createDemoSellerOrder({
      groupId: group5.id,
      orderNumber: "DEMO-K4U-20260805-0005-S1",
      customerId: customers.priya.id,
      customerType: "CUSTOMER",
      sellerId: sellers[2]!.sellerId,
      targetStatus: "DELIVERED",
      paymentMethod: "COD",
      paymentOutcome: "PAID",
      items: [
        {
          productId: consortiaPack.id,
          productName: consortiaPack.name,
          productImageUrl: consortiaPack.primaryImageUrl,
          sku: consortiaPack.sku,
          quantity: 1,
          unit: "G",
          unitWeightGrams: 550,
          mrp: Number(consortiaPack.customerConfig.mrp),
          unitPrice: Number(consortiaPack.customerConfig.sellingPrice),
        },
      ],
    });
    const item5 = await prisma.orderItem.findFirst({ where: { sellerOrderId: order5.id } });
    deliveredOrderItemIds.priyaProductId = consortiaPack.id;
    deliveredOrderItemIds.priyaOrderItemId = item5?.id;
  }

  // Delivered order for Arjun on the smartphone — enables a second verified-purchase review.
  const smartphone = await prisma.product.findUnique({ where: { slug: "demo-smartphone-x12" } });
  const smartphoneVariant = await prisma.productVariant.findUnique({
    where: { sku: "DEMO-SMARTPHONE-X12-BLK-128" },
  });
  if (smartphone && smartphoneVariant) {
    const group6 = await createDemoCheckoutGroup(
      "DEMO-K4U-20260806-0006",
      customers.arjun.id,
      "CUSTOMER",
      arjunAddr,
    );
    const order6 = await createDemoSellerOrder({
      groupId: group6.id,
      orderNumber: "DEMO-K4U-20260806-0006-S1",
      customerId: customers.arjun.id,
      customerType: "CUSTOMER",
      sellerId: sellers[3]!.sellerId,
      targetStatus: "DELIVERED",
      paymentMethod: "ONLINE_FULL",
      paymentOutcome: "PAID",
      items: [
        {
          productId: smartphone.id,
          productName: smartphone.name,
          productImageUrl: smartphone.primaryImageUrl,
          sku: smartphoneVariant.sku,
          quantity: 1,
          unit: "PIECE",
          unitWeightGrams: 190,
          mrp: Number(smartphoneVariant.mrp),
          unitPrice: Number(smartphoneVariant.sellingPrice),
        },
      ],
    });
    const item6 = await prisma.orderItem.findFirst({ where: { sellerOrderId: order6.id } });
    deliveredOrderItemIds.arjunProductId = smartphone.id;
    deliveredOrderItemIds.arjunOrderItemId = item6?.id;
  }

  if (wateringCan?.customerConfig) {
    const group7 = await createDemoCheckoutGroup(
      "DEMO-K4U-20260807-0007",
      customers.priya.id,
      "CUSTOMER",
      priyaAddr,
    );
    await createDemoSellerOrder({
      groupId: group7.id,
      orderNumber: "DEMO-K4U-20260807-0007-S1",
      customerId: customers.priya.id,
      customerType: "CUSTOMER",
      sellerId: sellers[5]!.sellerId,
      targetStatus: "CANCELLED",
      paymentMethod: "ONLINE_FULL",
      paymentOutcome: "PAID",
      items: [
        {
          productId: wateringCan.id,
          productName: wateringCan.name,
          productImageUrl: wateringCan.primaryImageUrl,
          sku: wateringCan.sku,
          quantity: 1,
          unit: "PIECE",
          unitWeightGrams: 900,
          mrp: Number(wateringCan.customerConfig.mrp),
          unitPrice: Number(wateringCan.customerConfig.sellingPrice),
        },
      ],
    });
  }

  if (compost?.customerConfig) {
    const group8 = await createDemoCheckoutGroup(
      "DEMO-K4U-20260808-0008",
      customers.priya.id,
      "CUSTOMER",
      priyaAddr,
    );
    await createDemoSellerOrder({
      groupId: group8.id,
      orderNumber: "DEMO-K4U-20260808-0008-S1",
      customerId: customers.priya.id,
      customerType: "CUSTOMER",
      sellerId: sellers[1]!.sellerId,
      targetStatus: "RETURN_REQUESTED",
      paymentMethod: "COD",
      paymentOutcome: "PAID",
      items: [
        {
          productId: compost.id,
          productName: compost.name,
          productImageUrl: compost.primaryImageUrl,
          sku: compost.sku,
          quantity: 1,
          unit: "KG",
          unitWeightGrams: 5000,
          mrp: Number(compost.customerConfig.mrp),
          unitPrice: Number(compost.customerConfig.sellingPrice),
        },
      ],
    });
  }

  // Dealer order — dealer pricing/quantities, KISAN4U_COURIER.
  const potashDealerVariant = await prisma.productVariant.findUnique({
    where: { sku: "DEMO-POTASH-FERT-D-25KG" },
  });
  if (potashDealerVariant && potash) {
    const group9 = await createDemoCheckoutGroup(
      "DEMO-K4U-20260809-0009",
      dealers.vikram.id,
      "DEALER",
      vikramAddr,
    );
    await createDemoSellerOrder({
      groupId: group9.id,
      orderNumber: "DEMO-K4U-20260809-0009-S1",
      customerId: dealers.vikram.id,
      customerType: "DEALER",
      sellerId: sellers[2]!.sellerId,
      targetStatus: "CONFIRMED",
      paymentMethod: "ONLINE_FULL",
      paymentOutcome: "PAID",
      items: [
        {
          productId: potash.id,
          productName: potash.name,
          productImageUrl: potash.primaryImageUrl,
          sku: potashDealerVariant.sku,
          quantity: 4,
          unit: "KG",
          unitWeightGrams: 25000,
          mrp: Number(potashDealerVariant.mrp),
          unitPrice: Number(potashDealerVariant.sellingPrice),
        },
      ],
    });
  }

  return deliveredOrderItemIds;
}

// ---------------------------------------------------------------------------
// 8. Reviews — verified (backed by a real DELIVERED order) + manual/offline
// ---------------------------------------------------------------------------

async function recomputeRatingDemo(productId: string) {
  const result = await prisma.productReview.aggregate({
    where: { productId, moderationStatus: "APPROVED", verifiedPurchase: true },
    _avg: { rating: true },
    _count: true,
  });
  await prisma.product.update({
    where: { id: productId },
    data: {
      ratingAverage: result._count > 0 ? result._avg.rating : null,
      ratingCount: result._count,
    },
  });
}

async function upsertReview(
  key: { productId: string; customerId: string | null; manualCustomerName: string | null },
  data: {
    rating: number;
    comment: string;
    moderationStatus: ReviewModerationStatus;
    source: "WEBSITE" | "MANUAL_OFFLINE";
    verifiedPurchase: boolean;
    orderItemId?: string;
    sourceReference?: string;
    consentConfirmed?: boolean;
  },
) {
  const existing = key.customerId
    ? await prisma.productReview.findUnique({
        where: { customerId_productId: { customerId: key.customerId, productId: key.productId } },
      })
    : await prisma.productReview.findFirst({
        where: {
          productId: key.productId,
          manualCustomerName: key.manualCustomerName,
          customerId: null,
        },
      });
  if (existing) return existing;
  return prisma.productReview.create({
    data: {
      productId: key.productId,
      customerId: key.customerId,
      manualCustomerName: key.manualCustomerName,
      rating: data.rating,
      comment: data.comment,
      moderationStatus: data.moderationStatus,
      source: data.source,
      verifiedPurchase: data.verifiedPurchase,
      orderItemId: data.orderItemId,
      sourceReference: data.sourceReference,
      consentConfirmed: data.consentConfirmed ?? false,
    },
  });
}

async function seedDemoReviews(
  deliveredOrderItemIds: Awaited<ReturnType<typeof seedDemoOrders>>,
  customers: Awaited<ReturnType<typeof seedDemoCustomers>>,
) {
  const touchedProductIds = new Set<string>();

  if (deliveredOrderItemIds.priyaProductId && deliveredOrderItemIds.priyaOrderItemId) {
    await upsertReview(
      {
        productId: deliveredOrderItemIds.priyaProductId,
        customerId: customers.priya.id,
        manualCustomerName: null,
      },
      {
        rating: 5,
        comment: "Worked really well on my field — will order again.",
        moderationStatus: "APPROVED",
        source: "WEBSITE",
        verifiedPurchase: true,
        orderItemId: deliveredOrderItemIds.priyaOrderItemId,
      },
    );
    touchedProductIds.add(deliveredOrderItemIds.priyaProductId);
  }
  if (deliveredOrderItemIds.arjunProductId && deliveredOrderItemIds.arjunOrderItemId) {
    await upsertReview(
      {
        productId: deliveredOrderItemIds.arjunProductId,
        customerId: customers.arjun.id,
        manualCustomerName: null,
      },
      {
        rating: 4,
        comment: "Good value, battery life is solid. Camera is decent in daylight.",
        moderationStatus: "APPROVED",
        source: "WEBSITE",
        verifiedPurchase: true,
        orderItemId: deliveredOrderItemIds.arjunOrderItemId,
      },
    );
    touchedProductIds.add(deliveredOrderItemIds.arjunProductId);
  }

  // Manual/offline reviews (admin-entered, from call-centre/WhatsApp feedback) — never verifiedPurchase, per business rule.
  const manualReviews: Array<{
    slug: string;
    rating: number;
    name: string;
    comment: string;
    sourceReference: string;
    moderationStatus: ReviewModerationStatus;
  }> = [
    {
      slug: "demo-organic-compost-fertilizer",
      rating: 5,
      name: "Ramesh (via call centre)",
      comment: "Called to say the compost improved his soil in one season.",
      sourceReference: "Call centre ticket #DEMO-1001",
      moderationStatus: "APPROVED",
    },
    {
      slug: "demo-organic-compost-fertilizer",
      rating: 2,
      name: "Sunita (via WhatsApp)",
      comment: "Packaging was torn on arrival, product was fine.",
      sourceReference: "WhatsApp thread +91XXXXXXXXX1",
      moderationStatus: "APPROVED",
    },
    {
      slug: "demo-mens-cotton-shirt",
      rating: 4,
      name: "Deepak (via call centre)",
      comment: "Good fit, colour slightly different from photo.",
      sourceReference: "Call centre ticket #DEMO-1002",
      moderationStatus: "APPROVED",
    },
    {
      slug: "demo-running-sports-shoes",
      rating: 3,
      name: "Anil (via WhatsApp)",
      comment: "Comfortable but runs a half-size small.",
      sourceReference: "WhatsApp thread +91XXXXXXXXX2",
      moderationStatus: "PENDING",
    },
    {
      slug: "demo-24-inch-led-monitor",
      rating: 1,
      name: "Manoj (via call centre)",
      comment: "Dead pixel on arrival, requested replacement.",
      sourceReference: "Call centre ticket #DEMO-1003",
      moderationStatus: "REJECTED",
    },
    {
      slug: "demo-npk-liquid-fertilizer",
      rating: 5,
      name: "Geeta (via WhatsApp)",
      comment: "Fast results on tomato crop.",
      sourceReference: "WhatsApp thread +91XXXXXXXXX3",
      moderationStatus: "APPROVED",
    },
  ];
  for (const r of manualReviews) {
    const product = await prisma.product.findUnique({ where: { slug: r.slug } });
    if (!product) continue;
    await upsertReview(
      { productId: product.id, customerId: null, manualCustomerName: r.name },
      {
        rating: r.rating,
        comment: r.comment,
        moderationStatus: r.moderationStatus,
        source: "MANUAL_OFFLINE",
        verifiedPurchase: false,
        sourceReference: r.sourceReference,
        consentConfirmed: true,
      },
    );
    // MANUAL_OFFLINE reviews never affect ratingAverage/ratingCount (see
    // recomputeRatingDemo — matches packages/catalog/src/ratings.ts exactly:
    // both moderationStatus=APPROVED AND verifiedPurchase=true are required),
    // so there is nothing to recompute here — left un-added to touchedProductIds
    // deliberately.
  }

  for (const productId of touchedProductIds) {
    await recomputeRatingDemo(productId);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  assertSafeToSeedDemoData();
  assertNoSvgImageUrls();

  const states = await prisma.indianState.findMany();
  if (states.length === 0) {
    throw new Error(
      "No IndianState rows found — run `pnpm db:seed` first (seeds the full state list this script depends on).",
    );
  }

  const tree = await getExistingCategoryTree();
  const leaves = await seedNewLeafCategories();
  await backfillMissingCategoryImages(tree);

  const sellers = await seedSellers();
  const { brands, manufacturers } = await seedBrandsAndManufacturers(sellers as never);
  const attrs = await seedAttributes();

  const createdProducts = await seedDemoProducts(
    sellers,
    tree,
    leaves,
    brands,
    manufacturers,
    attrs,
    states,
  );

  const customers = await seedDemoCustomers(states);
  const dealers = await seedDemoDealers(states);
  const deliveredOrderItemIds = await seedDemoOrders(customers, dealers, sellers);
  await seedDemoReviews(deliveredOrderItemIds, customers);

  // --- Summary ---
  const productCount = await prisma.product.count({ where: { sku: { startsWith: "DEMO-" } } });
  const variantCount = await prisma.productVariant.count({
    where: { sku: { startsWith: "DEMO-" } },
  });
  const reviewCount = await prisma.productReview.count({
    where: {
      OR: [
        { manualCustomerName: { contains: "via call centre" } },
        { manualCustomerName: { contains: "via WhatsApp" } },
        { customer: { referralCode: { startsWith: "DEMO-CUST" } } },
      ],
    },
  });
  const orderCount = await prisma.sellerOrder.count({
    where: { orderNumber: { startsWith: "DEMO-" } },
  });
  const sellerCount = Object.keys(sellers).length;
  const brandCount = Object.keys(brands).length;
  const mfrCount = Object.keys(manufacturers).length;

  console.log("\n=== Kisan4U demo seed complete ===\n");
  console.table({
    sellers: `${sellerCount} (6 approved, 1 pending, 1 rejected, 1 suspended)`,
    brands: `${brandCount} (8 featured/positioned, some unfeatured)`,
    manufacturers: mfrCount,
    newCategories: "Clothing > Men's Wear, Footwear",
    products: productCount,
    variants: variantCount,
    customers: 3,
    dealers: "3 (1 approved, 1 pending, 1 rejected)",
    orders: orderCount,
    reviews: reviewCount,
  });
  console.log(
    createdProducts.length > 0
      ? `Products created this run:\n- ${createdProducts.join("\n- ")}`
      : "All demo products already existed (skipped creation — see seedDemoProducts doc comment); other demo data (sellers/brands/customers/orders/reviews) still upserted/converged.",
  );

  console.log("\nDemo seller logins (password same for all): " + DEMO_SELLER_PASSWORD);
  console.table(
    SELLER_SPECS.map((s) => ({
      shopName: s.shopName,
      email: `demo.seller${s.n}@kisan4u.local`,
      status: s.status,
    })),
  );

  console.log(
    "\nDemo customer/dealer logins (OTP-based — same as every real customer/dealer login):",
  );
  console.table([
    { role: "CUSTOMER", name: "Demo Customer Priya", phone: "+919700000001" },
    { role: "CUSTOMER", name: "Demo Customer Arjun", phone: "+919700000002" },
    { role: "CUSTOMER", name: "Demo Customer Fatima (no orders)", phone: "+919700000003" },
    { role: "DEALER (approved, Rajasthan)", name: "Demo Dealer Vikram", phone: "+919800000001" },
    { role: "DEALER (pending)", name: "Demo Dealer Rao", phone: "+919800000002" },
    { role: "DEALER (rejected)", name: "Demo Dealer Singh", phone: "+919800000003" },
  ]);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
