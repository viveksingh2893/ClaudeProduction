import "dotenv/config";
import {
  PrismaClient,
  UserRole,
  ApplicationStatus,
  KycStatus,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type ShipmentStatus,
  type BaseUnit,
  type HomepageSectionType,
  type SectionAudience,
} from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

// This script runs standalone via `tsx` (not through the Prisma CLI), so
// it loads .env itself and constructs the required driver adapter — see
// packages/db/src/index.ts for the shared-client version of this pattern.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Phase 2 fix: admin and seller must not share a demo password. These
// values (and the ones printed in the summary table below) are seed-only
// — they must never be hardcoded into runtime application code, only
// here and in testing docs. Both satisfy the password policy in
// packages/validators/src/phone.ts (length, upper/lower/digit/special).
const ADMIN_DEMO_PASSWORD = "Admin@Kisan4U#2026";
const SELLER_DEMO_PASSWORD = "Seller@Kisan4U#2026";

/**
 * Mirrors packages/validators/src/pricing.ts's formulas exactly (NONE ->
 * mrp, FLAT -> mrp-discountValue, PERCENTAGE -> mrp-(mrp*pct/100), rounded
 * to 2dp) so seeded demo prices are consistent with what the real product
 * form would calculate. Duplicated here (not imported) since @kisan4u/db
 * has no dependency on @kisan4u/validators and this seed script otherwise
 * imports only the generated Prisma client directly — not worth adding a
 * cross-package dependency just for one small pure function.
 */
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

/**
 * Phase 1: one demo user per role needed for the auth foundation
 * (admin, seller, dealer, customer/customer). Phase 2 adds a PENDING
 * dealer, a REJECTED seller, and a SUSPENDED dealer so the new admin
 * approval UI and the dealer status gate have real data to demonstrate
 * against. Business Associate and Delivery Man accounts are still
 * intentionally not seeded — those roles don't have login pages yet.
 *
 * All demo phone numbers use the +91 country code with a valid Indian
 * mobile leading digit (6-9) — see packages/validators/src/phone.ts —
 * so they pass the same normalization/validation every real login path
 * runs through.
 *
 * Everything here uses upsert so re-running is safe and idempotent —
 * and the `update` blocks are non-empty (not `update: {}`) so re-running
 * this script also *corrects* these demo fixtures back to their intended
 * state (e.g. if a previous manual test run approved/suspended one of
 * them from the admin UI). That's safe here specifically because these
 * are clearly-marked local demo accounts (fixed seed email/phone), not
 * real user data — a real user's password or application status must
 * never be silently overwritten by re-running a seed script.
 */
// Every gated module key this RBAC slice knows about. A new module never
// needs a schema migration (RolePermission.module is a plain string) — add
// its key here so Super Admin picks up full access to it automatically.
const KNOWN_MODULES = [
  "pos",
  "roles",
  "payment-verification",
  "order-scheduling",
  "settlements",
  "coupons",
  "account-deletions",
] as const;
const PERMISSION_ACTIONS = ["VIEW", "CREATE", "EDIT", "DELETE"] as const;

/**
 * Seeds the "Super Admin" (isSystem, every permission on every known
 * module) and "Sales Agent" (pos: VIEW+CREATE only) roles, then backfills
 * every existing AdminProfile with no roleId onto Super Admin.
 * hasPermission() (packages/auth/src/permissions.ts) fails CLOSED, so any
 * admin account left without a role would lose all access the instant a
 * route starts calling it — this backfill is what makes that safe,
 * covering real admins created outside this seed script too, not just the
 * demo account below.
 */
async function seedRolesAndPermissions() {
  const superAdmin = await prisma.role.upsert({
    where: { name: "Super Admin" },
    update: { isSystem: true },
    create: { name: "Super Admin", description: "Full access to every module.", isSystem: true },
  });
  for (const moduleKey of KNOWN_MODULES) {
    for (const action of PERMISSION_ACTIONS) {
      await prisma.rolePermission.upsert({
        where: { roleId_module_action: { roleId: superAdmin.id, module: moduleKey, action } },
        update: { granted: true },
        create: { roleId: superAdmin.id, module: moduleKey, action, granted: true },
      });
    }
  }

  const salesAgent = await prisma.role.upsert({
    where: { name: "Sales Agent" },
    update: {},
    create: { name: "Sales Agent", description: "Can place orders through POS." },
  });
  for (const action of ["VIEW", "CREATE"] as const) {
    await prisma.rolePermission.upsert({
      where: { roleId_module_action: { roleId: salesAgent.id, module: "pos", action } },
      update: { granted: true },
      create: { roleId: salesAgent.id, module: "pos", action, granted: true },
    });
  }

  const paymentVerifier = await prisma.role.upsert({
    where: { name: "Payment Verifier" },
    update: {
      description:
        "Views the order table, approves/rejects uploaded payment screenshots for partial/full prepaid orders, and runs the settlement-cycle payout batches (view the cycles tab, open a seller's per-cycle breakdown, mark a cycle paid, download the Excel).",
    },
    create: {
      name: "Payment Verifier",
      description:
        "Views the order table, approves/rejects uploaded payment screenshots for partial/full prepaid orders, and runs the settlement-cycle payout batches (view the cycles tab, open a seller's per-cycle breakdown, mark a cycle paid, download the Excel).",
    },
  });
  for (const [moduleKey, actions] of [
    ["payment-verification", ["VIEW", "EDIT"]],
    ["settlements", ["VIEW", "EDIT"]],
  ] as const) {
    for (const action of actions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_module_action: { roleId: paymentVerifier.id, module: moduleKey, action },
        },
        update: { granted: true },
        create: { roleId: paymentVerifier.id, module: moduleKey, action, granted: true },
      });
    }
  }

  const schedulingTeam = await prisma.role.upsert({
    where: { name: "Scheduling Team" },
    update: {},
    create: {
      name: "Scheduling Team",
      description:
        "Full working access to the orders section — the same order table and per-order detail page an admin uses (confirm, schedule dispatch, status changes, cancellations, returns, delivery marking). No access to any other admin module.",
    },
  });
  for (const action of ["VIEW", "EDIT"] as const) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_module_action: { roleId: schedulingTeam.id, module: "order-scheduling", action },
      },
      update: { granted: true },
      create: { roleId: schedulingTeam.id, module: "order-scheduling", action, granted: true },
    });
  }

  await prisma.adminProfile.updateMany({
    where: { roleId: null },
    data: { roleId: superAdmin.id },
  });

  return {
    superAdminRoleId: superAdmin.id,
    salesAgentRoleId: salesAgent.id,
    paymentVerifierRoleId: paymentVerifier.id,
    schedulingTeamRoleId: schedulingTeam.id,
  };
}

async function seedAdmin(superAdminRoleId: string) {
  const passwordHash = await bcrypt.hash(ADMIN_DEMO_PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email: "admin@kisan4u.local" },
    update: { passwordHash },
    create: {
      email: "admin@kisan4u.local",
      firstName: "Kisan4U",
      lastName: "Admin",
      role: UserRole.ADMIN,
      passwordHash,
      referralCode: "ADMIN-DEMO",
      isEmailVerified: true,
    },
  });
  await prisma.adminProfile.upsert({
    where: { userId: user.id },
    update: { roleId: superAdminRoleId },
    create: {
      userId: user.id,
      roleName: "Super Admin",
      modulePermissions: {},
      roleId: superAdminRoleId,
    },
  });
  return user;
}

async function seedSeller() {
  const passwordHash = await bcrypt.hash(SELLER_DEMO_PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email: "seller@kisan4u.local" },
    update: { passwordHash },
    create: {
      email: "seller@kisan4u.local",
      firstName: "Demo",
      lastName: "Seller",
      role: UserRole.SELLER,
      passwordHash,
      referralCode: "SELLER-DEMO",
      isEmailVerified: true,
    },
  });
  await prisma.sellerProfile.upsert({
    where: { userId: user.id },
    update: { status: ApplicationStatus.APPROVED },
    create: {
      userId: user.id,
      shopName: "Demo Agri Shop",
      slug: "demo-agri-shop",
      status: ApplicationStatus.APPROVED,
    },
  });
  return user;
}

/** Phase 2: a second seller stuck in REJECTED, to exercise the admin review UI. */
async function seedRejectedSeller() {
  const passwordHash = await bcrypt.hash(SELLER_DEMO_PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email: "seller.rejected@kisan4u.local" },
    update: { passwordHash },
    create: {
      email: "seller.rejected@kisan4u.local",
      firstName: "Rejected",
      lastName: "Seller",
      role: UserRole.SELLER,
      passwordHash,
      referralCode: "SELLER-REJ-DEMO",
      isEmailVerified: true,
    },
  });
  await prisma.sellerProfile.upsert({
    where: { userId: user.id },
    update: { status: ApplicationStatus.REJECTED, rejectionReason: "Incomplete GST documentation" },
    create: {
      userId: user.id,
      shopName: "Rejected Test Shop",
      slug: "rejected-test-shop",
      status: ApplicationStatus.REJECTED,
      rejectionReason: "Incomplete GST documentation",
    },
  });
  return user;
}

/** Fixed state: Maharashtra — see the doc comment on the stateId assignment below for why. */
async function seedDealer(states: Array<{ id: string; code: string; name: string }>) {
  const user = await prisma.user.upsert({
    where: { phone: "+919111111111" },
    update: {},
    create: {
      phone: "+919111111111",
      firstName: "Demo",
      lastName: "Dealer",
      role: UserRole.DEALER,
      referralCode: "DEALER-DEMO",
      isPhoneVerified: true,
    },
  });
  // Deterministic, fixed placeholder address/state for demo/development
  // data only (never randomized — see requirement 5) — this dealer gets
  // Maharashtra, matching the state-restricted "Dealer Bulk Fertiliser"
  // demo product's dealerAvailableStates so the dealer catalogue has something
  // real to demonstrate against.
  const maharashtra = states.find((s) => s.code === "MH")!;
  await prisma.dealerProfile.upsert({
    where: { userId: user.id },
    update: {
      status: ApplicationStatus.APPROVED,
      kycStatus: KycStatus.APPROVED,
      stateId: maharashtra.id,
      state: maharashtra.name,
      storeAddress: "12 MG Road",
      city: "Pune",
      pincode: "411001",
    },
    create: {
      userId: user.id,
      kycStatus: KycStatus.APPROVED,
      status: ApplicationStatus.APPROVED,
      storeName: "Demo Dealer Store",
      storeAddress: "12 MG Road",
      city: "Pune",
      state: maharashtra.name,
      stateId: maharashtra.id,
      pincode: "411001",
    },
  });
  return user;
}

/** Phase 2: a second dealer stuck PENDING, to exercise the admin review UI and the status gate. Fixed state: Gujarat. */
async function seedPendingDealer(states: Array<{ id: string; code: string; name: string }>) {
  const user = await prisma.user.upsert({
    where: { phone: "+919333333333" },
    update: {},
    create: {
      phone: "+919333333333",
      firstName: "Pending",
      lastName: "Dealer",
      role: UserRole.DEALER,
      referralCode: "DEALER-PEND-DEMO",
      isPhoneVerified: true,
    },
  });
  const gujarat = states.find((s) => s.code === "GJ")!;
  await prisma.dealerProfile.upsert({
    where: { userId: user.id },
    update: {
      status: ApplicationStatus.PENDING,
      kycStatus: KycStatus.PENDING_REVIEW,
      stateId: gujarat.id,
      state: gujarat.name,
      storeAddress: "45 Ring Road",
      city: "Surat",
      pincode: "395001",
    },
    create: {
      userId: user.id,
      kycStatus: KycStatus.PENDING_REVIEW,
      status: ApplicationStatus.PENDING,
      storeName: "Pending Test Store",
      storeAddress: "45 Ring Road",
      city: "Surat",
      state: gujarat.name,
      stateId: gujarat.id,
      pincode: "395001",
    },
  });
  return user;
}

/** Phase 2: a dealer stuck SUSPENDED, to exercise the suspended-account gate. Fixed state: Punjab. */
async function seedSuspendedDealer(states: Array<{ id: string; code: string; name: string }>) {
  const user = await prisma.user.upsert({
    where: { phone: "+919444444444" },
    update: {},
    create: {
      phone: "+919444444444",
      firstName: "Suspended",
      lastName: "Dealer",
      role: UserRole.DEALER,
      referralCode: "DEALER-SUSP-DEMO",
      isPhoneVerified: true,
    },
  });
  const punjab = states.find((s) => s.code === "PB")!;
  await prisma.dealerProfile.upsert({
    where: { userId: user.id },
    update: {
      status: ApplicationStatus.SUSPENDED,
      kycStatus: KycStatus.APPROVED,
      stateId: punjab.id,
      state: punjab.name,
      storeAddress: "9 Mall Road",
      city: "Amritsar",
      pincode: "143001",
    },
    create: {
      userId: user.id,
      kycStatus: KycStatus.APPROVED,
      status: ApplicationStatus.SUSPENDED,
      storeName: "Suspended Test Store",
      storeAddress: "9 Mall Road",
      city: "Amritsar",
      state: punjab.name,
      stateId: punjab.id,
      pincode: "143001",
    },
  });
  return user;
}

async function seedCustomer() {
  const user = await prisma.user.upsert({
    where: { phone: "+919222222222" },
    update: {},
    create: {
      phone: "+919222222222",
      firstName: "Demo",
      lastName: "Customer",
      role: UserRole.CUSTOMER,
      referralCode: "CUSTOMER-DEMO",
      isPhoneVerified: true,
    },
  });
  return user;
}

// ---------------------------------------------------------------------------
// Phase 3: product catalog demo data. All upserts by unique slug/code, and
// products are skipped (not re-created) if their slug already exists —
// see the note on seedDemoProducts below for why products specifically
// don't self-correct like the Phase 2 fixtures above do.
// ---------------------------------------------------------------------------

async function seedCategoryHierarchy() {
  const plantNutrients = await prisma.category.upsert({
    where: { slug: "plant-nutrients" },
    update: {},
    create: { name: "Plant Nutrients", slug: "plant-nutrients", position: 1 },
  });
  const plantProtection = await prisma.category.upsert({
    where: { slug: "plant-protection" },
    update: {},
    create: { name: "Plant Protection", slug: "plant-protection", position: 2 },
  });
  const gardeningProducts = await prisma.category.upsert({
    where: { slug: "gardening-products" },
    update: {},
    create: { name: "Gardening Products", slug: "gardening-products", position: 3 },
  });

  const fertilisers = await prisma.subcategory.upsert({
    where: { slug: "fertilisers" },
    update: {},
    create: { name: "Fertilisers", slug: "fertilisers", categoryId: plantNutrients.id },
  });
  const bioFertilisers = await prisma.subcategory.upsert({
    where: { slug: "bio-fertilisers" },
    update: {},
    create: { name: "Bio Fertilisers", slug: "bio-fertilisers", categoryId: plantNutrients.id },
  });
  const insecticide = await prisma.subcategory.upsert({
    where: { slug: "insecticide" },
    update: {},
    create: { name: "Insecticide", slug: "insecticide", categoryId: plantProtection.id },
  });
  const fungicide = await prisma.subcategory.upsert({
    where: { slug: "fungicide" },
    update: {},
    create: { name: "Fungicide", slug: "fungicide", categoryId: plantProtection.id },
  });

  const carrierBasedConsortia = await prisma.subSubCategory.upsert({
    where: { slug: "carrier-based-consortia" },
    update: {},
    create: {
      name: "Carrier Based Consortia",
      slug: "carrier-based-consortia",
      subCategoryId: bioFertilisers.id,
    },
  });
  const liquidConsortia = await prisma.subSubCategory.upsert({
    where: { slug: "liquid-consortia" },
    update: {},
    create: {
      name: "Liquid Consortia",
      slug: "liquid-consortia",
      subCategoryId: bioFertilisers.id,
    },
  });

  return {
    categories: [plantNutrients, plantProtection, gardeningProducts],
    subcategories: { fertilisers, bioFertilisers, insecticide, fungicide },
    subSubCategories: { carrierBasedConsortia, liquidConsortia },
  };
}

/** Brands/manufacturers created here are global (ownerSellerId null) and immediately APPROVED — the same shape an admin-created entry gets from /admin/brands. */
async function seedBrandsAndManufacturers() {
  const katraFert = await prisma.brand.upsert({
    where: { slug: "katra-fert" },
    update: {},
    create: {
      name: "Katra Fert",
      slug: "katra-fert",
      status: ApplicationStatus.APPROVED,
      ownerSellerId: null,
    },
  });
  const agriPure = await prisma.brand.upsert({
    where: { slug: "agripure" },
    update: {},
    create: {
      name: "AgriPure",
      slug: "agripure",
      status: ApplicationStatus.APPROVED,
      ownerSellerId: null,
    },
  });
  const isarAgro = await prisma.manufacturer.upsert({
    where: { slug: "isar-agro" },
    update: {},
    create: {
      name: "Isar Agro",
      slug: "isar-agro",
      status: ApplicationStatus.APPROVED,
      ownerSellerId: null,
    },
  });
  const kisan4uMfg = await prisma.manufacturer.upsert({
    where: { slug: "kisan4u-manufacturing" },
    update: {},
    create: {
      name: "Kisan4U Manufacturing",
      slug: "kisan4u-manufacturing",
      status: ApplicationStatus.APPROVED,
      ownerSellerId: null,
    },
  });
  return { brands: [katraFert, agriPure], manufacturers: [isarAgro, kisan4uMfg] };
}

/**
 * Phase 3 fix: attributes are name-only master data now — no reusable
 * global values. Product-specific values are created per-product inside
 * seedDemoProducts below, scoped to that exact product (see
 * ProductVariantAttributeValue in schema.prisma).
 */
async function seedAttributes() {
  const size = await prisma.productAttribute.upsert({
    where: { slug: "size" },
    update: {},
    create: { name: "Size", slug: "size" },
  });
  const caseAttr = await prisma.productAttribute.upsert({
    where: { slug: "case" },
    update: {},
    create: { name: "Case", slug: "case" },
  });
  const type = await prisma.productAttribute.upsert({
    where: { slug: "type" },
    update: {},
    create: { name: "Type", slug: "type" },
  });
  return { size, caseAttr, type };
}

/** Full official list of Indian states and union territories (28 states + 8 UTs) — upserted by code so re-running never duplicates. */
async function seedIndianStates() {
  const list: Array<{ code: string; name: string }> = [
    { code: "AP", name: "Andhra Pradesh" },
    { code: "AR", name: "Arunachal Pradesh" },
    { code: "AS", name: "Assam" },
    { code: "BR", name: "Bihar" },
    { code: "CG", name: "Chhattisgarh" },
    { code: "GA", name: "Goa" },
    { code: "GJ", name: "Gujarat" },
    { code: "HR", name: "Haryana" },
    { code: "HP", name: "Himachal Pradesh" },
    { code: "JH", name: "Jharkhand" },
    { code: "KA", name: "Karnataka" },
    { code: "KL", name: "Kerala" },
    { code: "MP", name: "Madhya Pradesh" },
    { code: "MH", name: "Maharashtra" },
    { code: "MN", name: "Manipur" },
    { code: "ML", name: "Meghalaya" },
    { code: "MZ", name: "Mizoram" },
    { code: "NL", name: "Nagaland" },
    { code: "OD", name: "Odisha" },
    { code: "PB", name: "Punjab" },
    { code: "RJ", name: "Rajasthan" },
    { code: "SK", name: "Sikkim" },
    { code: "TN", name: "Tamil Nadu" },
    { code: "TS", name: "Telangana" },
    { code: "TR", name: "Tripura" },
    { code: "UP", name: "Uttar Pradesh" },
    { code: "UK", name: "Uttarakhand" },
    { code: "WB", name: "West Bengal" },
    { code: "AN", name: "Andaman and Nicobar Islands" },
    { code: "CH", name: "Chandigarh" },
    { code: "DN", name: "Dadra and Nagar Haveli and Daman and Diu" },
    { code: "DL", name: "Delhi" },
    { code: "JK", name: "Jammu and Kashmir" },
    { code: "LA", name: "Ladakh" },
    { code: "LD", name: "Lakshadweep" },
    { code: "PY", name: "Puducherry" },
  ];
  const states = await Promise.all(
    list.map((s) =>
      prisma.indianState.upsert({ where: { code: s.code }, update: { name: s.name }, create: s }),
    ),
  );
  return states;
}

/** Phase 3 addition: one demo logistics pricing config, master data only (not yet wired to checkout/orders). */
async function seedLogisticsPricing() {
  const existing = await prisma.logisticsPricingConfig.findFirst({ include: { slabs: true } });
  if (existing) return existing;

  return prisma.logisticsPricingConfig.create({
    data: {
      maxWeightGrams: 3000,
      aboveMaxPrice: 150,
      isActive: true,
      slabs: {
        create: [
          { lowerWeightGrams: 0, upperWeightGrams: 500, price: 30, sortOrder: 0 },
          { lowerWeightGrams: 501, upperWeightGrams: 2000, price: 60, sortOrder: 1 },
          { lowerWeightGrams: 2001, upperWeightGrams: 3000, price: 100, sortOrder: 2 },
        ],
      },
    },
    include: { slabs: true },
  });
}

/**
 * Products are only created if their slug doesn't already exist — unlike
 * the User/DealerProfile/SellerProfile fixtures above, a demo product has
 * no meaningful "intended state" to self-correct back to once an admin
 * has approved/rejected/suspended it during manual testing; leaving an
 * already-seeded product alone (rather than resetting its lifecycle
 * status every run) is what lets the manual test flows in this phase
 * actually persist across repeated `pnpm db:seed` runs during development.
 *
 * Product-specific attribute values are created as part of each product
 * (ProductVariantAttributeValue, scoped to that exact product — see the
 * schema doc comment) rather than reused from a global list, since Phase
 * 3's redesign removed the global ProductAttributeValue model entirely.
 */
async function seedDemoProducts(
  sellerId: string,
  masterData: {
    categories: Array<{ id: string }>;
    subcategories: { fertilisers: { id: string }; bioFertilisers: { id: string } };
    subSubCategories: { carrierBasedConsortia: { id: string } };
    brands: Array<{ id: string }>;
    manufacturers: Array<{ id: string }>;
    attributes: { size: { id: string }; caseAttr: { id: string } };
    states: Array<{ id: string; code: string }>;
  },
) {
  // Non-null assertions below are safe: these arrays always come from the
  // fixed literal lists in seedCategoryHierarchy above, so the indices
  // used throughout this function always exist.
  const plantNutrients = masterData.categories[0]!;
  const created: string[] = [];

  if (!(await prisma.product.findUnique({ where: { slug: "customer-bio-fertiliser" } }))) {
    const customerMrp = 700;
    const customerDiscount = 105;
    const customerSellingPrice = calculateSellingPrice(customerMrp, "FLAT", customerDiscount);

    const product = await prisma.product.create({
      data: {
        sellerId,
        name: "Customer Bio Fertiliser",
        slug: "customer-bio-fertiliser",
        sku: "DEMO-CUSTOMER-BIOFERT",
        hsnCode: "310100",
        shortDescription: "Carrier-based consortia bio fertiliser for customer packs.",
        description:
          "A carrier-based consortia bio fertiliser formulated for smallholder customer use.",
        categoryId: plantNutrients.id,
        subCategoryId: masterData.subcategories.bioFertilisers.id,
        subSubCategoryId: masterData.subSubCategories.carrierBasedConsortia.id,
        brandId: masterData.brands[0]!.id,
        manufacturerId: masterData.manufacturers[0]!.id,
        audience: "CUSTOMER_ONLY",
        baseUnit: "ML",
        packageSize: "500 ml",
        searchTags: ["biofertilizer", "npk"],
        customerVisible: true,
        dealerVisible: false,
        lifecycleStatus: "APPROVED",
        primaryImageUrl: "/demo/products/customer-bio-fertiliser.jpg",
        customerConfig: {
          create: {
            mrp: customerMrp,
            discountType: "FLAT",
            discountValue: customerDiscount,
            sellingPrice: customerSellingPrice,
            minOrderQty: 1,
            currentStock: 500,
          },
        },
        variantAttributeValues: {
          create: [
            {
              attributeId: masterData.attributes.size.id,
              value: "500 ml",
              slug: "500-ml",
              position: 0,
            },
            { attributeId: masterData.attributes.size.id, value: "1 L", slug: "1-l", position: 1 },
          ],
        },
      },
      include: { variantAttributeValues: true },
    });
    const size500ml = product.variantAttributeValues.find((v) => v.slug === "500-ml")!;
    const size1L = product.variantAttributeValues.find((v) => v.slug === "1-l")!;

    await prisma.productVariant.createMany({
      data: [
        {
          productId: product.id,
          audience: "CUSTOMER",
          sku: "DEMO-CUSTOMER-BIOFERT-500ML",
          combinationKey: combinationKey([size500ml.id]),
          mrp: customerMrp,
          discountType: "FLAT",
          discountValue: customerDiscount,
          sellingPrice: customerSellingPrice,
          stockQty: 300,
        },
        {
          productId: product.id,
          audience: "CUSTOMER",
          sku: "DEMO-CUSTOMER-BIOFERT-1L",
          combinationKey: combinationKey([size1L.id]),
          mrp: 1200,
          discountType: "FLAT",
          discountValue: 201,
          sellingPrice: calculateSellingPrice(1200, "FLAT", 201),
          stockQty: 200,
        },
      ],
    });
    const createdVariants = await prisma.productVariant.findMany({
      where: { productId: product.id },
    });
    const variant500 = createdVariants.find((v) => v.sku === "DEMO-CUSTOMER-BIOFERT-500ML")!;
    const variant1L = createdVariants.find((v) => v.sku === "DEMO-CUSTOMER-BIOFERT-1L")!;
    await prisma.productVariantValue.createMany({
      data: [
        { variantId: variant500.id, attributeValueId: size500ml.id },
        { variantId: variant1L.id, attributeValueId: size1L.id },
      ],
    });
    created.push("customer-bio-fertiliser (APPROVED, customer-only)");
  }

  if (!(await prisma.product.findUnique({ where: { slug: "dealer-bulk-fertiliser" } }))) {
    const dealerMrp = 7000;
    const dealerDiscount = 4200;
    const dealerSellingPrice = calculateSellingPrice(dealerMrp, "FLAT", dealerDiscount);

    const product = await prisma.product.create({
      data: {
        sellerId,
        name: "Dealer Bulk Fertiliser",
        slug: "dealer-bulk-fertiliser",
        sku: "DEMO-DEALER-BULKFERT",
        hsnCode: "310100",
        shortDescription: "Case-packed bulk fertiliser for dealer resale.",
        description:
          "Bulk case packaging of the same consortia bio fertiliser, priced for dealer resale volumes.",
        categoryId: plantNutrients.id,
        subCategoryId: masterData.subcategories.bioFertilisers.id,
        brandId: masterData.brands[0]!.id,
        audience: "DEALER_ONLY",
        baseUnit: "KG",
        packageSize: "10 kg case",
        searchTags: ["bulk", "dealer"],
        customerVisible: false,
        dealerVisible: true,
        lifecycleStatus: "APPROVED",
        primaryImageUrl: "/demo/products/dealer-bulk-fertiliser.jpg",
        dealerAvailableStates: {
          connect: masterData.states
            .filter((s) => s.code === "MH" || s.code === "GJ")
            .map((s) => ({ id: s.id })),
        },
        dealerConfig: {
          create: {
            mrp: dealerMrp,
            discountType: "FLAT",
            discountValue: dealerDiscount,
            sellingPrice: dealerSellingPrice,
            minOrderQty: 1,
            currentStock: 100,
          },
        },
        variantAttributeValues: {
          create: [
            {
              attributeId: masterData.attributes.caseAttr.id,
              value: "10Gmx10Nos",
              slug: "10gmx10nos",
              position: 0,
            },
            {
              attributeId: masterData.attributes.caseAttr.id,
              value: "50Gmx20Nos",
              slug: "50gmx20nos",
              position: 1,
            },
          ],
        },
      },
      include: { variantAttributeValues: true },
    });
    const case10 = product.variantAttributeValues.find((v) => v.slug === "10gmx10nos")!;
    const case50 = product.variantAttributeValues.find((v) => v.slug === "50gmx20nos")!;

    await prisma.productVariant.createMany({
      data: [
        {
          productId: product.id,
          audience: "DEALER",
          sku: "DEMO-DEALER-BULKFERT-CASE10",
          combinationKey: combinationKey([case10.id]),
          mrp: 7000,
          discountType: "FLAT",
          discountValue: 4200,
          sellingPrice: calculateSellingPrice(7000, "FLAT", 4200),
          stockQty: 50,
        },
        {
          productId: product.id,
          audience: "DEALER",
          sku: "DEMO-DEALER-BULKFERT-CASE50",
          combinationKey: combinationKey([case50.id]),
          mrp: 32500,
          discountType: "FLAT",
          discountValue: 18800,
          sellingPrice: calculateSellingPrice(32500, "FLAT", 18800),
          stockQty: 20,
        },
      ],
    });
    const createdVariants = await prisma.productVariant.findMany({
      where: { productId: product.id },
    });
    const variantCase10 = createdVariants.find((v) => v.sku === "DEMO-DEALER-BULKFERT-CASE10")!;
    const variantCase50 = createdVariants.find((v) => v.sku === "DEMO-DEALER-BULKFERT-CASE50")!;
    await prisma.productVariantValue.createMany({
      data: [
        { variantId: variantCase10.id, attributeValueId: case10.id },
        { variantId: variantCase50.id, attributeValueId: case50.id },
      ],
    });
    created.push("dealer-bulk-fertiliser (APPROVED, dealer-only, MH+GJ)");
  }

  if (
    !(await prisma.product.findUnique({ where: { slug: "carrier-based-consortia-biofertilizer" } }))
  ) {
    const customerMrp = 700;
    const customerDiscount = 105;
    const dealerMrp = 700;
    const dealerDiscount = 420;

    const product = await prisma.product.create({
      data: {
        sellerId,
        name: "Carrier Based Consortia Biofertilizer",
        slug: "carrier-based-consortia-biofertilizer",
        sku: "DEMO-BOTH-CONSORTIA",
        hsnCode: "310100",
        shortDescription:
          "Carrier based consortia biofertilizer for both customer and dealer channels.",
        description:
          "The flagship consortia biofertilizer, sold to customers in retail packs and to dealers in bulk cases — separate customer and dealer configurations and variants.",
        categoryId: plantNutrients.id,
        subCategoryId: masterData.subcategories.bioFertilisers.id,
        subSubCategoryId: masterData.subSubCategories.carrierBasedConsortia.id,
        brandId: masterData.brands[0]!.id,
        manufacturerId: masterData.manufacturers[0]!.id,
        audience: "BOTH_CUSTOMER_AND_DEALER",
        baseUnit: "ML",
        packageSize: "500 ml / case",
        searchTags: ["biofertilizer", "npk", "carrier based consortia"],
        featuredPosition: 1,
        customerVisible: true,
        dealerVisible: true,
        lifecycleStatus: "APPROVED",
        primaryImageUrl: "/demo/products/carrier-based-consortia.jpg",
        customerConfig: {
          create: {
            mrp: customerMrp,
            discountType: "FLAT",
            discountValue: customerDiscount,
            sellingPrice: calculateSellingPrice(customerMrp, "FLAT", customerDiscount),
            minOrderQty: 1,
            currentStock: 1719,
          },
        },
        dealerConfig: {
          create: {
            mrp: dealerMrp,
            discountType: "FLAT",
            discountValue: dealerDiscount,
            sellingPrice: calculateSellingPrice(dealerMrp, "FLAT", dealerDiscount),
            minOrderQty: 1,
            currentStock: 1844,
          },
        },
        variantAttributeValues: {
          create: [
            {
              attributeId: masterData.attributes.size.id,
              value: "500 ml",
              slug: "500-ml",
              position: 0,
            },
            {
              attributeId: masterData.attributes.caseAttr.id,
              value: "10Gmx10Nos",
              slug: "10gmx10nos",
              position: 0,
            },
          ],
        },
      },
      include: { variantAttributeValues: true },
    });
    const size500ml = product.variantAttributeValues.find((v) => v.slug === "500-ml")!;
    const case10 = product.variantAttributeValues.find((v) => v.slug === "10gmx10nos")!;

    await prisma.productVariant.createMany({
      data: [
        {
          productId: product.id,
          audience: "CUSTOMER",
          sku: "DEMO-BOTH-CONSORTIA-F-500ML",
          combinationKey: combinationKey([size500ml.id]),
          mrp: 700,
          discountType: "FLAT",
          discountValue: 105,
          sellingPrice: calculateSellingPrice(700, "FLAT", 105),
          stockQty: 717,
        },
        {
          productId: product.id,
          audience: "DEALER",
          sku: "DEMO-BOTH-CONSORTIA-D-CASE10",
          combinationKey: combinationKey([case10.id]),
          mrp: 7000,
          discountType: "FLAT",
          discountValue: 4200,
          sellingPrice: calculateSellingPrice(7000, "FLAT", 4200),
          stockQty: 994,
        },
      ],
    });
    const createdVariants = await prisma.productVariant.findMany({
      where: { productId: product.id },
    });
    const variantCustomer = createdVariants.find((v) => v.sku === "DEMO-BOTH-CONSORTIA-F-500ML")!;
    const variantDealer = createdVariants.find((v) => v.sku === "DEMO-BOTH-CONSORTIA-D-CASE10")!;
    await prisma.productVariantValue.createMany({
      data: [
        { variantId: variantCustomer.id, attributeValueId: size500ml.id },
        { variantId: variantDealer.id, attributeValueId: case10.id },
      ],
    });
    created.push(
      "carrier-based-consortia-biofertilizer (APPROVED, both, separate customer+dealer variants)",
    );
  }

  if (!(await prisma.product.findUnique({ where: { slug: "submitted-demo-product" } }))) {
    await prisma.product.create({
      data: {
        sellerId,
        name: "Submitted Demo Product",
        slug: "submitted-demo-product",
        sku: "DEMO-SUBMITTED",
        hsnCode: "310100",
        shortDescription: "Awaiting admin review.",
        description:
          "A product the demo seller has submitted, sitting in the admin approval queue.",
        categoryId: plantNutrients.id,
        audience: "CUSTOMER_ONLY",
        baseUnit: "KG",
        packageSize: "1 kg",
        lifecycleStatus: "SUBMITTED",
        primaryImageUrl: "/demo/products/submitted-demo-product.jpg",
        customerConfig: {
          create: {
            mrp: 500,
            discountType: "FLAT",
            discountValue: 50,
            sellingPrice: calculateSellingPrice(500, "FLAT", 50),
            minOrderQty: 1,
            currentStock: 100,
          },
        },
      },
    });
    created.push("submitted-demo-product (SUBMITTED)");
  }

  if (!(await prisma.product.findUnique({ where: { slug: "rejected-demo-product" } }))) {
    await prisma.product.create({
      data: {
        sellerId,
        name: "Rejected Demo Product",
        slug: "rejected-demo-product",
        sku: "DEMO-REJECTED",
        hsnCode: "310100",
        shortDescription: "Rejected by admin — needs seller edits.",
        description:
          "A product an admin rejected during review, to exercise the rejection-reason UI.",
        categoryId: plantNutrients.id,
        audience: "CUSTOMER_ONLY",
        baseUnit: "KG",
        packageSize: "1 kg",
        lifecycleStatus: "REJECTED",
        rejectionReason: "Missing HSN documentation — please verify and resubmit.",
        primaryImageUrl: "/demo/products/rejected-demo-product.jpg",
        customerConfig: {
          create: {
            mrp: 500,
            discountType: "NONE",
            discountValue: 0,
            sellingPrice: 500,
            minOrderQty: 1,
            currentStock: 0,
          },
        },
      },
    });
    created.push("rejected-demo-product (REJECTED)");
  }

  return created;
}

// ---------------------------------------------------------------------------
// Phase 4: cart, checkout, multi-seller orders, payments, logistics/
// collection charges, pickup points, mock shipment demo data. A second
// approved seller is added here (Phase 4 spec §X requires "at least two
// approved sellers" so a multi-seller cart/checkout can actually be
// demonstrated) — the original seller is untouched.
// ---------------------------------------------------------------------------

async function seedSecondSeller() {
  const passwordHash = await bcrypt.hash(SELLER_DEMO_PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email: "seller2@kisan4u.local" },
    update: { passwordHash },
    create: {
      email: "seller2@kisan4u.local",
      firstName: "Green",
      lastName: "Valley Agro",
      role: UserRole.SELLER,
      passwordHash,
      referralCode: "SELLER2-DEMO",
      isEmailVerified: true,
    },
  });
  await prisma.sellerProfile.upsert({
    where: { userId: user.id },
    update: { status: ApplicationStatus.APPROVED },
    create: {
      userId: user.id,
      shopName: "Green Valley Agro Store",
      slug: "green-valley-agro-store",
      status: ApplicationStatus.APPROVED,
    },
  });
  return user;
}

/** One BOTH_CUSTOMER_AND_DEALER, nationwide, no-variant product for the second seller — deliberately simple (no variants) so it's easy to reason about in multi-seller cart demo data. Skipped on rerun once it exists, same reasoning as seedDemoProducts. */
async function seedSecondSellerProduct(
  sellerId: string,
  masterData: {
    categories: Array<{ id: string }>;
    subcategories: { fertilisers: { id: string } };
    brands: Array<{ id: string }>;
  },
) {
  const existing = await prisma.product.findUnique({ where: { slug: "organic-neem-pesticide" } });
  if (existing) return existing;

  const mrp = 450;
  const discountValue = 50;
  const sellingPrice = calculateSellingPrice(mrp, "FLAT", discountValue);

  return prisma.product.create({
    data: {
      sellerId,
      name: "Organic Neem Pesticide",
      slug: "organic-neem-pesticide",
      sku: "DEMO-NEEM-PESTICIDE",
      hsnCode: "380810",
      shortDescription: "Cold-pressed neem oil pesticide, safe for organic farming.",
      description: "A cold-pressed neem oil pesticide sold to both customers and dealers nationwide.",
      categoryId: masterData.categories[1]!.id,
      subCategoryId: masterData.subcategories.fertilisers.id,
      brandId: masterData.brands[1]!.id,
      audience: "BOTH_CUSTOMER_AND_DEALER",
      baseUnit: "ML",
      packageSize: "1 L",
      searchTags: ["neem", "organic", "pesticide"],
      customerVisible: true,
      dealerVisible: true,
      lifecycleStatus: "APPROVED",
      primaryImageUrl: "/demo/products/organic-neem-pesticide.jpg",
      customerConfig: {
        create: {
          mrp,
          discountType: "FLAT",
          discountValue,
          sellingPrice,
          minOrderQty: 1,
          currentStock: 400,
          weight: 1100,
        },
      },
      dealerConfig: {
        create: {
          mrp: mrp * 10,
          discountType: "FLAT",
          discountValue: discountValue * 10,
          sellingPrice: sellingPrice * 10,
          minOrderQty: 1,
          currentStock: 150,
          weight: 11000,
        },
      },
    },
  });
}

/** One approved, active pickup point per seller, plus one PENDING pickup point for the first seller so the admin approval queue has something to demonstrate (Phase 4 spec §K/§X). */
async function seedPickupPoints(sellerId1: string, sellerId2: string) {
  const approvedPoint1 = await upsertPickupPointByName(sellerId1, {
    name: "Demo Agri Shop — Main Warehouse",
    contactPerson: "Ramesh Kumar",
    mobile: "+919555500001",
    line1: "Plot 14, Industrial Area",
    city: "Pune",
    district: "Pune",
    state: "Maharashtra",
    pincode: "411019",
    isDefault: true,
    isActive: true,
    approvalStatus: "APPROVED",
  });
  const pendingPoint1 = await upsertPickupPointByName(sellerId1, {
    name: "Demo Agri Shop — New Depot (pending review)",
    contactPerson: "Suresh Patil",
    mobile: "+919555500002",
    line1: "Shop 3, Market Yard",
    city: "Nashik",
    district: "Nashik",
    state: "Maharashtra",
    pincode: "422001",
    isDefault: false,
    isActive: true,
    approvalStatus: "PENDING",
  });
  const approvedPoint2 = await upsertPickupPointByName(sellerId2, {
    name: "Green Valley Agro — Dispatch Center",
    contactPerson: "Anita Deshmukh",
    mobile: "+919555500003",
    line1: "Survey No. 22, Agro Park",
    city: "Ahmedabad",
    district: "Ahmedabad",
    state: "Gujarat",
    pincode: "380015",
    isDefault: true,
    isActive: true,
    approvalStatus: "APPROVED",
  });
  return { approvedPoint1, pendingPoint1, approvedPoint2 };
}

async function upsertPickupPointByName(
  sellerId: string,
  data: {
    name: string;
    contactPerson: string;
    mobile: string;
    line1: string;
    city: string;
    district: string;
    state: string;
    pincode: string;
    isDefault: boolean;
    isActive: boolean;
    approvalStatus: "PENDING" | "APPROVED";
  },
) {
  const existing = await prisma.sellerPickupPoint.findFirst({
    where: { sellerId, name: data.name },
  });
  if (existing) return existing;
  return prisma.sellerPickupPoint.create({ data: { sellerId, ...data } });
}

/** Phase 4 spec §I3: a clearly-labeled demo partial-payment rule — 20% advance, applies to both customer types. Findable/updatable by label so re-running seed corrects it rather than creating duplicates. */
async function seedPartialPaymentConfig() {
  const existing = await prisma.partialPaymentConfig.findFirst({
    where: { label: "Standard advance (demo)" },
  });
  if (existing) return existing;
  return prisma.partialPaymentConfig.create({
    data: {
      label: "Standard advance (demo)",
      appliesTo: null,
      ruleType: "PERCENTAGE",
      value: 20,
      isActive: true,
      isDemo: true,
    },
  });
}

/**
 * Corrective business-rule fix: collection charge = higher of ₹30 flat or
 * 1.5% of the seller-order merchandise value. The existing
 * CollectionChargeConfig model already expresses "higher of a flat
 * minimum or a percentage" generically (chargeType=PERCENTAGE, value=1.5,
 * minCharge=30 — see packages/orders/src/charges.ts:calculateCollectionCharge),
 * so this is a seed *value* correction, not a schema change. Upserts by
 * label (not just "create if missing") so re-running seed against a
 * database that still has the old demo FLAT-20 row converges it to the
 * corrected formula instead of leaving stale demo data behind.
 */
async function seedCollectionChargeConfig() {
  const label = "Standard collection charge — higher of ₹30 or 1.5%";
  const data = {
    label,
    chargeType: "PERCENTAGE" as const,
    value: 1.5,
    minCharge: 30,
    maxCharge: null,
    isActive: true,
  };
  const existing = await prisma.collectionChargeConfig.findFirst({ where: { label } });
  if (existing) return prisma.collectionChargeConfig.update({ where: { id: existing.id }, data });

  // Deactivate any older demo config (e.g. the original FLAT-20 placeholder)
  // rather than deleting it — preserves the audit trail on any order
  // created while it was active, and calculateCollectionCharge only ever
  // reads the active one.
  await prisma.collectionChargeConfig.updateMany({
    where: { isActive: true, label: { not: label } },
    data: { isActive: false },
  });
  return prisma.collectionChargeConfig.create({ data });
}

/**
 * Seller-settlement ledger: platform-wide default commission/logistics/
 * collection-charge GST rates (matching the rates demonstrated in the
 * attached settlement workbook — 18% each). TCS (0.5%) and TDS (0.1%) are
 * fixed statutory rates, not part of this config — see
 * packages/orders/src/settlement-rates.ts:FIXED_TCS_PERCENT/FIXED_TDS_PERCENT.
 * Seeded so the settlement calculator has a real config to resolve rather than
 * falling back to all-zero rates out of the box. Upserts by label, same
 * "findable/updatable, never a duplicate on re-run" convention as
 * seedCollectionChargeConfig. Per-seller/per-customer-type overrides are
 * an admin action, not seeded here.
 */
async function seedSettlementRateConfig() {
  const label = "Platform default settlement rates (demo)";
  const data = {
    label,
    sellerId: null,
    customerType: null,
    commissionGstPercent: 18,
    logisticsGstPercent: 18,
    collectionChargeGstPercent: 18,
    isActive: true,
    isDemo: true,
  };
  const existing = await prisma.settlementRateConfig.findFirst({ where: { label } });
  if (existing) return prisma.settlementRateConfig.update({ where: { id: existing.id }, data });
  return prisma.settlementRateConfig.create({ data });
}

/** True singleton — the post-delivery hold period before a settlement may move PENDING -> ELIGIBLE (see SettlementSettings' schema doc comment). 7 days is a placeholder business rule, not an approved policy. */
async function seedSettlementSettings() {
  return prisma.settlementSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", holdDays: 7 },
    update: { holdDays: 7 },
  });
}

/**
 * Corrective addition: dealer Transport pricing source (§H2 — "do not
 * invent a transportation price"). Reuses the existing (previously
 * unwired) ShippingMethod model — a platform-wide default plus one
 * seller-specific override, so both the fallback and the
 * seller-specific-wins-over-platform-wide path are demonstrable and
 * manually testable. Upserted by title so re-seeding converges rather
 * than duplicating.
 */
async function seedShippingMethods(sellerAId: string) {
  const platformWide = await prisma.shippingMethod.findFirst({
    where: { sellerId: null, title: "Standard Transport (platform default)" },
  });
  const platformWideData = {
    sellerId: null,
    title: "Standard Transport (platform default)",
    cost: 250,
    durationDays: 5,
    isActive: true,
  };
  const platformWideMethod = platformWide
    ? await prisma.shippingMethod.update({ where: { id: platformWide.id }, data: platformWideData })
    : await prisma.shippingMethod.create({ data: platformWideData });

  const sellerSpecific = await prisma.shippingMethod.findFirst({
    where: { sellerId: sellerAId, title: "Demo Agri Shop Transport" },
  });
  const sellerSpecificData = {
    sellerId: sellerAId,
    title: "Demo Agri Shop Transport",
    cost: 180,
    durationDays: 4,
    isActive: true,
  };
  const sellerSpecificMethod = sellerSpecific
    ? await prisma.shippingMethod.update({
        where: { id: sellerSpecific.id },
        data: sellerSpecificData,
      })
    : await prisma.shippingMethod.create({ data: sellerSpecificData });

  return { platformWideMethod, sellerSpecificMethod };
}

/** Singleton — upsert always converges to these demo defaults (all features on). */
async function seedSiteSettings() {
  return prisma.siteSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      wishlistEnabled: true,
      buyNowEnabled: true,
      addToCartEnabled: true,
      requestSellerEnabled: true,
      ratingDisplayThreshold: 5,
      defaultDeliveryBadgeText: "Fast delivery",
      footerCustomerCareNumber: "+91 98265 75663",
      footerPolicyLinks: [
        { label: "Terms & Conditions", href: "/policies/terms" },
        { label: "Privacy Policy", href: "/policies/privacy" },
        { label: "Shipping Policy", href: "/policies/shipping" },
        { label: "Cancellation & Return", href: "/policies/returns" },
      ],
      footerSocialLinks: [
        { platform: "Facebook", href: "https://www.facebook.com/Kisan4uapp/" },
        { platform: "Instagram", href: "https://www.instagram.com/kisan4u_agri/?hl=en" },
      ],
    },
  });
}

/**
 * Homepage CMS demo content. Every HomepageSection row is upserted by
 * (type, audience) so re-running seed always converges positions/enabled
 * state back to these demo defaults, matching the Phase 2 fixtures'
 * self-correcting convention (not the Phase 3 products' skip-if-exists
 * one) — these are structural demo config, not user-editable records an
 * admin manual test run should be allowed to permanently alter.
 */
async function seedHomepageSections() {
  const sections: Array<{
    type: HomepageSectionType;
    position: number;
    audience: SectionAudience;
  }> = [
    { type: "HERO_BANNER", position: 10, audience: "COMMON" },
    { type: "TRUST_STRIP", position: 20, audience: "COMMON" },
    { type: "COUPON_STRIP", position: 30, audience: "COMMON" },
    { type: "TOP_CATEGORIES", position: 40, audience: "COMMON" },
    { type: "DEAL_OF_THE_DAY", position: 50, audience: "COMMON" },
    { type: "PRODUCT_DISCOVERY_TRENDING", position: 60, audience: "COMMON" },
    { type: "PRODUCT_DISCOVERY_BEST_SELLERS", position: 61, audience: "COMMON" },
    { type: "PRODUCT_DISCOVERY_NEW_ARRIVALS", position: 62, audience: "COMMON" },
    { type: "JOIN_DEALER_SELLER", position: 70, audience: "COMMON" },
    { type: "FEATURED_BY_CATEGORY", position: 80, audience: "COMMON" },
    { type: "SHOP_BY_BRAND", position: 90, audience: "COMMON" },
  ];
  for (const s of sections) {
    await prisma.homepageSection.upsert({
      where: { type_audience: { type: s.type, audience: s.audience } },
      update: { position: s.position, enabled: true },
      create: { ...s, enabled: true },
    });
  }
  return sections.length;
}

/** One demo hero slide and one demo coupon banner, each seeded as a Customer+Dealer pair (see upsertPromotionalAsset). */
/**
 * Findable/updatable by (altText, audience) so re-running seed converges
 * rather than duplicating — same "idempotent by label" convention as
 * seedPartialPaymentConfig/seedCollectionChargeConfig above.
 */
async function upsertPromotionalAsset(data: {
  placement: "HERO" | "COUPON";
  audience: "CUSTOMER" | "DEALER";
  desktopImageUrl: string;
  mobileImageUrl?: string;
  altText: string;
  linkUrl: string;
  ctaLabel?: string;
  priority: number;
  isActive: boolean;
}) {
  const existing = await prisma.promotionalAsset.findFirst({
    where: { placement: data.placement, altText: data.altText, audience: data.audience },
  });
  return existing
    ? prisma.promotionalAsset.update({ where: { id: existing.id }, data })
    : prisma.promotionalAsset.create({ data });
}

/**
 * Per product decision, "common" (shown to both audiences via one shared
 * row) is no longer how HERO/COUPON banners work — a banner meant for both
 * Customer and Dealer is now two individual rows (see admin/banners'
 * AudienceToggle, and getEligiblePromotionalAssets' includeCommon=false for
 * these two placements in packages/catalog/src/homepage.ts). The demo hero
 * and coupon banners are therefore seeded as an explicit CUSTOMER+DEALER
 * pair each, not one COMMON row.
 */
async function seedPromotionalAssets() {
  const heroCustomer = await upsertPromotionalAsset({
    placement: "HERO",
    audience: "CUSTOMER",
    desktopImageUrl: "/demo/homepage/hero-desktop.jpg",
    mobileImageUrl: "/demo/homepage/hero-mobile.jpg",
    altText: "Kisan4U — quality agri inputs, delivered",
    linkUrl: "/products",
    ctaLabel: "Shop Now",
    priority: 0,
    isActive: true,
  });
  const heroDealer = await upsertPromotionalAsset({
    placement: "HERO",
    audience: "DEALER",
    desktopImageUrl: "/demo/homepage/hero-desktop.jpg",
    mobileImageUrl: "/demo/homepage/hero-mobile.jpg",
    altText: "Kisan4U — quality agri inputs, delivered",
    linkUrl: "/dealer/products",
    ctaLabel: "Shop Now",
    priority: 0,
    isActive: true,
  });

  const couponCustomer = await upsertPromotionalAsset({
    placement: "COUPON",
    audience: "CUSTOMER",
    desktopImageUrl: "/demo/homepage/coupon-desktop.jpg",
    altText: "Save more on bulk dealer orders",
    linkUrl: "/products",
    priority: 0,
    isActive: true,
  });
  const couponDealer = await upsertPromotionalAsset({
    placement: "COUPON",
    audience: "DEALER",
    desktopImageUrl: "/demo/homepage/coupon-desktop.jpg",
    altText: "Save more on bulk dealer orders",
    linkUrl: "/dealer/products",
    priority: 0,
    isActive: true,
  });

  // Clean up any leftover COMMON row from before the "no common banners"
  // decision (a fresh DB never has one; an existing dev DB carried over
  // from before this change does) — the CUSTOMER+DEALER pair above already
  // covers what it used to serve, and deleting it is itself idempotent
  // (a no-op once it's gone), so this is safe to run on every seed.
  await prisma.promotionalAsset.deleteMany({
    where: {
      audience: "COMMON",
      OR: [
        { placement: "HERO", altText: "Kisan4U — quality agri inputs, delivered" },
        { placement: "COUPON", altText: "Save more on bulk dealer orders" },
      ],
    },
  });

  return { heroAsset: heroCustomer, heroDealer, couponAsset: couponCustomer, couponDealer };
}

/** One featured square image for the first seeded category — safe/idempotent via categoryId's unique constraint. */
async function seedCategoryHomepageAsset(categoryId: string) {
  return prisma.categoryHomepageAsset.upsert({
    where: { categoryId },
    update: { isActive: true, position: 0 },
    create: {
      categoryId,
      imageUrl: "/demo/homepage/category-plant-nutrients.jpg",
      position: 0,
      isActive: true,
    },
  });
}

/** One demo Deal of the Day on the flagship "both audiences" demo product, running for 24h from seed time. */
async function seedDealOfTheDay(productId: string) {
  const existing = await prisma.dealOfTheDay.findFirst({ where: { productId, isActive: true } });
  if (existing) return existing;
  const now = new Date();
  return prisma.dealOfTheDay.create({
    data: {
      productId,
      dealPrice: 249,
      startAt: now,
      endAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      isActive: true,
    },
  });
}

/**
 * One MANUAL Trending collection seeded with the flagship demo product, so
 * the admin discovery screen and storefront tab have real data to
 * demonstrate against. Uses findFirst rather than a compound-unique upsert
 * — Postgres treats each NULL categoryId as distinct, so a
 * (type, categoryId) unique index can't be relied on for "find the one
 * TRENDING collection with no category" lookups.
 */
async function seedMerchandisingCollection(productId: string) {
  const existing = await prisma.merchandisingCollection.findFirst({
    where: { type: "TRENDING", categoryId: null },
  });
  const collection = existing
    ? await prisma.merchandisingCollection.update({
        where: { id: existing.id },
        data: { mode: "MANUAL", isActive: true },
      })
    : await prisma.merchandisingCollection.create({
        data: { type: "TRENDING", mode: "MANUAL", isActive: true },
      });
  await prisma.merchandisingItem.upsert({
    where: { collectionId_productId: { collectionId: collection.id, productId } },
    update: { position: 0 },
    create: { collectionId: collection.id, productId, position: 0 },
  });
  return collection;
}

/** Idempotent: increases quantity only if this exact user+product+variant line doesn't already exist. */
async function upsertCartItem(
  userId: string,
  sellerId: string,
  productId: string,
  variantId: string | null,
  quantity: number,
  priceAtAdd: number,
) {
  const existing = await prisma.cartItem.findFirst({ where: { userId, productId, variantId } });
  if (existing) return existing;
  return prisma.cartItem.create({
    data: { userId, sellerId, productId, variantId, quantity, priceAtAdd },
  });
}

/** A customer cart spanning both demo sellers — Phase 4 spec §X "Customer multi-seller cart." */
async function seedCustomerMultiSellerCart(
  customerId: string,
  seller1Id: string,
  seller1ProductId: string,
  seller1Price: number,
  seller2Id: string,
  seller2ProductId: string,
  seller2Price: number,
) {
  await upsertCartItem(customerId, seller1Id, seller1ProductId, null, 2, seller1Price);
  await upsertCartItem(customerId, seller2Id, seller2ProductId, null, 1, seller2Price);
}

/** A dealer cart spanning both demo sellers — Phase 4 spec §X "Dealer multi-seller cart." Both demo products used here are dealer-visible nationwide, so the approved (Maharashtra) demo dealer can see and cart both. */
async function seedDealerMultiSellerCart(
  dealerId: string,
  seller1Id: string,
  seller1ProductId: string,
  seller1Price: number,
  seller2Id: string,
  seller2ProductId: string,
  seller2Price: number,
) {
  await upsertCartItem(dealerId, seller1Id, seller1ProductId, null, 3, seller1Price);
  await upsertCartItem(dealerId, seller2Id, seller2ProductId, null, 2, seller2Price);
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
  if (status === "DELIVERY_FAILED")
    return [...STATUS_CHAIN.slice(0, STATUS_CHAIN.indexOf("IN_TRANSIT") + 1), "DELIVERY_FAILED"];
  const idx = STATUS_CHAIN.indexOf(status);
  return idx >= 0 ? STATUS_CHAIN.slice(0, idx + 1) : [status];
}

type SampleItemInput = {
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

/**
 * Builds one full example seller order (checkout group, seller order,
 * items, charge, status history up to the requested status, payment, and
 * — where relevant — a shipment) directly via Prisma, without going
 * through @kisan4u/orders' checkout() transaction (this script
 * deliberately has no cross-package workspace dependency, matching the
 * existing convention of duplicating calculateSellingPrice above rather
 * than importing it). Skips entirely if `groupNumber` already exists, so
 * re-seeding never duplicates these — Phase 4 spec §X.
 */
/**
 * Local re-implementation of packages/orders' collection-charge formula
 * (higher of ₹30 flat or 1.5% of seller-order merchandise value) —
 * packages/db cannot import @kisan4u/orders (orders depends on db, so
 * that would be a circular workspace dependency), matching this file's
 * existing documented convention of duplicating calculateSellingPrice
 * locally rather than reaching across that boundary.
 */
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

/** Same "can't import @kisan4u/orders" reasoning as calcCollectionChargeDemo above. */
function calcCustomerPromoDiscountDemo(
  customerType: "CUSTOMER" | "DEALER",
  paymentMethod: PaymentMethod,
  subtotal: number,
) {
  const percent =
    customerType === "CUSTOMER"
      ? paymentMethod === "ONLINE_FULL"
        ? 5
        : paymentMethod === "ONLINE_PARTIAL"
          ? 2
          : 0
      : 0;
  const amount = Math.round(((subtotal * percent) / 100) * 100) / 100;
  return { percent, amount };
}

async function seedSampleSellerOrder(params: {
  groupNumber: string;
  customerId: string;
  customerType: "CUSTOMER" | "DEALER";
  sellerId: string;
  targetStatus: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentOutcome: "PAID" | "FAILED" | "PARTIAL";
  items: SampleItemInput[];
  address: {
    fullName: string;
    mobile: string;
    line1: string;
    cityTown: string;
    district: string;
    state: string;
    pincode: string;
  };
  deliveryMethod?: "KISAN4U_COURIER" | "TRANSPORT";
  transportationCost: number;
  transportationPayer: "CUSTOMER" | "SELLER";
  shipment?: { awbNumber: string; status: ShipmentStatus };
}) {
  const existing = await prisma.checkoutGroup.findUnique({
    where: { groupNumber: params.groupNumber },
  });
  if (existing) return;

  const deliveryMethod = params.deliveryMethod ?? "KISAN4U_COURIER";
  const subtotal = params.items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);
  const totalWeightGrams = params.items.reduce(
    (total, item) => total + item.unitWeightGrams * item.quantity,
    0,
  );
  const customerPayableDelivery =
    params.transportationPayer === "CUSTOMER" ? params.transportationCost : 0;
  const totalAmount = subtotal + customerPayableDelivery;
  const collectionChargeCalc = calcCollectionChargeDemo(subtotal);
  const promo = calcCustomerPromoDiscountDemo(params.customerType, params.paymentMethod, subtotal);
  const customerPayableTotal = Math.round((totalAmount - promo.amount) * 100) / 100;
  const orderNumber = `${params.groupNumber}-S1`;

  const group = await prisma.checkoutGroup.create({
    data: {
      groupNumber: params.groupNumber,
      customerId: params.customerId,
      customerType: params.customerType,
      addressSnapshot: {
        create: {
          fullName: params.address.fullName,
          mobile: params.address.mobile,
          line1: params.address.line1,
          cityTown: params.address.cityTown,
          district: params.address.district,
          state: params.address.state,
          pincode: params.address.pincode,
          addressType: "HOME",
        },
      },
    },
  });

  const sellerOrder = await prisma.sellerOrder.create({
    data: {
      orderNumber,
      checkoutGroupId: group.id,
      customerId: params.customerId,
      sellerId: params.sellerId,
      customerType: params.customerType,
      status: params.targetStatus,
      paymentMethod: params.paymentMethod,
      deliveryMethod,
      subtotal,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount,
      invoiceNumber: `${orderNumber}-INV`,
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
          transportationCost: params.transportationCost,
          transportationPayer: params.transportationPayer,
          collectionCharge: collectionChargeCalc.finalCharge,
          collectionChargePayer: "SELLER",
          collectionChargeSnapshot: { sellerOrderValue: subtotal, ...collectionChargeCalc },
          customerPayableDelivery,
          kisan4uCollectedAmount: params.transportationCost + collectionChargeCalc.finalCharge,
          sellerBorneAmount:
            (params.transportationPayer === "SELLER" ? params.transportationCost : 0) +
            collectionChargeCalc.finalCharge,
          promotionalDiscountPercent: promo.percent,
          promotionalDiscountAmount: promo.amount,
          promotionalDiscountPayer: "KISAN4U",
          customerPayableTotal,
          kisan4uBorneAmount: promo.amount,
          slabSnapshot:
            deliveryMethod === "TRANSPORT"
              ? { mode: "TRANSPORT_ADMIN_CONFIG", demo: true, cost: params.transportationCost }
              : {
                  mode: "KISAN4U_COURIER",
                  demo: true,
                  note: "Seed demo data — not a real slab match",
                },
        },
      },
    },
  });

  for (const status of chainUpTo(params.targetStatus)) {
    await prisma.orderStatusHistory.create({
      data: {
        sellerOrderId: sellerOrder.id,
        status,
        actorId: params.customerId,
        actorRole: params.customerType,
        source: status === "PENDING_PAYMENT" ? "CUSTOMER" : "SYSTEM",
        note: `Seed demo data reaching ${status}`,
      },
    });
  }

  if (params.shipment) {
    await prisma.shipment.create({
      data: {
        sellerOrderId: sellerOrder.id,
        pickupPointSnapshot: { demo: true },
        awbNumber: params.shipment.awbNumber,
        status: params.shipment.status,
      },
    });
  }

  const paymentStatus: PaymentStatus =
    params.paymentOutcome === "PAID"
      ? "PAID"
      : params.paymentOutcome === "PARTIAL"
        ? "PARTIALLY_PAID"
        : "FAILED";
  // Net of the customer promo discount — matches the real checkout()
  // transaction, which always charges customerPayableTotal, never the
  // pre-discount gross totalAmount.
  const paymentTotal =
    params.paymentOutcome === "PARTIAL"
      ? Math.round(customerPayableTotal * 0.2 * 100) / 100
      : customerPayableTotal;
  const amountPaid = params.paymentOutcome === "FAILED" ? 0 : paymentTotal;

  const payment = await prisma.payment.create({
    data: {
      checkoutGroupId: group.id,
      customerId: params.customerId,
      method: params.paymentMethod,
      status: paymentStatus,
      totalAmount: paymentTotal,
      amountPaid,
      internalReference: `PAY-${orderNumber}`,
    },
  });
  await prisma.paymentAllocation.create({
    data: { paymentId: payment.id, sellerOrderId: sellerOrder.id, amount: paymentTotal },
  });
  await prisma.paymentStatusHistory.create({
    data: { paymentId: payment.id, status: paymentStatus, source: "PAYMENT_PROVIDER" },
  });
}

/**
 * Eight examples spanning the Phase 4 statuses/payment outcomes plus the
 * corrective business-rule cases (customer 5%/2% promo discount, dealer
 * Kisan4U Courier, dealer Transport, and a seller-order value above the
 * ₹2,000 collection-charge threshold — see requirement 12's seed-data
 * list). The six customer orders stay from the first demo seller for
 * simplicity; the two dealer orders use the dealer-bulk-fertiliser
 * product from the same seller so the seller-specific Transport
 * ShippingMethod (seedShippingMethods) applies.
 */
async function seedSampleOrders(customerId: string, sellerId: string, dealerId: string) {
  const demoProduct = await prisma.product.findUnique({ where: { slug: "customer-bio-fertiliser" } });
  if (!demoProduct) return;

  const baseItem: SampleItemInput = {
    productId: demoProduct.id,
    productName: "Customer Bio Fertiliser",
    productImageUrl: "/demo/products/customer-bio-fertiliser.jpg",
    sku: "DEMO-CUSTOMER-BIOFERT",
    quantity: 2,
    unit: "ML",
    unitWeightGrams: 550,
    mrp: 700,
    unitPrice: 595,
  };
  const address = {
    fullName: "Demo Customer",
    mobile: "+919222222222",
    line1: "Village Road, Near Panchayat Office",
    cityTown: "Baramati",
    district: "Pune",
    state: "Maharashtra",
    pincode: "413102",
  };

  await seedSampleSellerOrder({
    groupNumber: "K4U-20260701-1001",
    customerId: customerId,
    customerType: "CUSTOMER",
    sellerId,
    targetStatus: "CONFIRMED",
    paymentMethod: "COD",
    paymentOutcome: "PAID",
    items: [baseItem],
    address,
    transportationCost: 60,
    transportationPayer: "SELLER",
  });

  await seedSampleSellerOrder({
    groupNumber: "K4U-20260702-1002",
    customerId: customerId,
    customerType: "CUSTOMER",
    sellerId,
    targetStatus: "SELLER_ACCEPTED",
    paymentMethod: "ONLINE_FULL",
    paymentOutcome: "PAID",
    items: [baseItem],
    address,
    transportationCost: 60,
    transportationPayer: "SELLER",
  });

  await seedSampleSellerOrder({
    groupNumber: "K4U-20260703-1003",
    customerId: customerId,
    customerType: "CUSTOMER",
    sellerId,
    targetStatus: "PACKED",
    paymentMethod: "ONLINE_FULL",
    paymentOutcome: "PAID",
    items: [baseItem],
    address,
    transportationCost: 60,
    transportationPayer: "SELLER",
  });

  await seedSampleSellerOrder({
    groupNumber: "K4U-20260704-1004",
    customerId: customerId,
    customerType: "CUSTOMER",
    sellerId,
    targetStatus: "IN_TRANSIT",
    paymentMethod: "ONLINE_PARTIAL",
    paymentOutcome: "PARTIAL",
    items: [baseItem],
    address,
    transportationCost: 60,
    transportationPayer: "SELLER",
    shipment: { awbNumber: "MOCKAWB-DEMO-1004", status: "IN_TRANSIT" },
  });

  await seedSampleSellerOrder({
    groupNumber: "K4U-20260705-1005",
    customerId: customerId,
    customerType: "CUSTOMER",
    sellerId,
    targetStatus: "DELIVERED",
    paymentMethod: "COD",
    paymentOutcome: "PAID",
    items: [baseItem],
    address,
    transportationCost: 60,
    transportationPayer: "SELLER",
    shipment: { awbNumber: "MOCKAWB-DEMO-1005", status: "DELIVERED" },
  });

  // Failed payment example: stays PENDING_PAYMENT, Payment.status FAILED.
  await seedSampleSellerOrder({
    groupNumber: "K4U-20260706-1006",
    customerId: customerId,
    customerType: "CUSTOMER",
    sellerId,
    targetStatus: "PENDING_PAYMENT",
    paymentMethod: "ONLINE_FULL",
    paymentOutcome: "FAILED",
    items: [baseItem],
    address,
    transportationCost: 60,
    transportationPayer: "SELLER",
  });

  // --- Dealer orders (corrective business-rule additions) ------------------
  const dealerProduct = await prisma.product.findUnique({
    where: { slug: "dealer-bulk-fertiliser" },
  });
  if (!dealerProduct) return;

  const dealerItem: SampleItemInput = {
    productId: dealerProduct.id,
    productName: "Dealer Bulk Fertiliser",
    productImageUrl: "/demo/products/dealer-bulk-fertiliser.jpg",
    sku: "DEMO-DEALER-BULKFERT",
    quantity: 1,
    unit: "KG",
    unitWeightGrams: 10500,
    mrp: 7000,
    unitPrice: 2800, // above the ₹2,000 collection-charge threshold on its own
  };
  const dealerAddress = {
    fullName: "Demo Dealer Store",
    mobile: "+919111111111",
    line1: "12 MG Road",
    cityTown: "Pune",
    district: "Pune",
    state: "Maharashtra",
    pincode: "411001",
  };

  // Dealer Kisan4U Courier — dealer bears the courier transportation cost,
  // seller bears the collection charge.
  await seedSampleSellerOrder({
    groupNumber: "K4U-20260707-1007",
    customerId: dealerId,
    customerType: "DEALER",
    sellerId,
    targetStatus: "CONFIRMED",
    paymentMethod: "ONLINE_FULL",
    paymentOutcome: "PAID",
    items: [dealerItem],
    address: dealerAddress,
    deliveryMethod: "KISAN4U_COURIER",
    transportationCost: 150,
    transportationPayer: "CUSTOMER",
  });

  // Dealer Transport — transportation cost comes from the seller-specific
  // ShippingMethod seeded in seedShippingMethods (₹180), dealer-borne;
  // seller still bears the collection charge; full online payment only.
  await seedSampleSellerOrder({
    groupNumber: "K4U-20260708-1008",
    customerId: dealerId,
    customerType: "DEALER",
    sellerId,
    targetStatus: "CONFIRMED",
    paymentMethod: "TRANSPORT_FULL_ONLINE",
    paymentOutcome: "PAID",
    items: [dealerItem],
    address: dealerAddress,
    deliveryMethod: "TRANSPORT",
    transportationCost: 180,
    transportationPayer: "CUSTOMER",
  });
}

/**
 * Phase 4 fix, discovered via manual browser testing: the Phase 3 demo
 * products (seedDemoProducts above) never set `weight` on their
 * customer/dealer configs or variants — nothing needed it before Phase 4's
 * cart validation started requiring a shipping weight to add an item to
 * cart at all. seedDemoProducts only creates products if their slug is
 * missing (so their lifecycle status can survive repeated manual admin
 * approve/reject testing — see that function's doc comment), which means
 * simply adding `weight` to its create() calls would never backfill an
 * already-existing row. This runs unconditionally, every seed run, and
 * only ever fills in a currently-null weight — never overwrites one a
 * seller/admin may have since set through the real product-edit form.
 */
async function backfillMissingDemoShippingWeights() {
  const targets: Array<{
    slug: string;
    customerWeight?: number;
    dealerWeight?: number;
    variantWeights?: Record<string, number>;
  }> = [
    {
      slug: "customer-bio-fertiliser",
      customerWeight: 550,
      variantWeights: { "DEMO-CUSTOMER-BIOFERT-500ML": 550, "DEMO-CUSTOMER-BIOFERT-1L": 1100 },
    },
    {
      slug: "dealer-bulk-fertiliser",
      dealerWeight: 10500,
      variantWeights: { "DEMO-DEALER-BULKFERT-CASE10": 500, "DEMO-DEALER-BULKFERT-CASE50": 2600 },
    },
    {
      slug: "carrier-based-consortia-biofertilizer",
      customerWeight: 550,
      dealerWeight: 10500,
      variantWeights: { "DEMO-BOTH-CONSORTIA-F-500ML": 550, "DEMO-BOTH-CONSORTIA-D-CASE10": 500 },
    },
    { slug: "submitted-demo-product", customerWeight: 1000 },
    { slug: "rejected-demo-product", customerWeight: 1000 },
  ];

  for (const target of targets) {
    const product = await prisma.product.findUnique({ where: { slug: target.slug } });
    if (!product) continue;
    if (target.customerWeight != null) {
      await prisma.productCustomerConfig.updateMany({
        where: { productId: product.id, weight: null },
        data: { weight: target.customerWeight },
      });
    }
    if (target.dealerWeight != null) {
      await prisma.productDealerConfig.updateMany({
        where: { productId: product.id, weight: null },
        data: { weight: target.dealerWeight },
      });
    }
    for (const [sku, weight] of Object.entries(target.variantWeights ?? {})) {
      await prisma.productVariant.updateMany({ where: { sku, weight: null }, data: { weight } });
    }
  }
}

/**
 * Corrective addition: every demo dealer minOrderQty defaulted to 1, so
 * there was no seeded example of the "quantity input starts at the
 * configured minimum" behaviour actually doing anything visible (starting
 * at 1 looks identical to no minimum at all). Sets two demo dealer
 * variants to non-trivial minimums (10 and 5) so manual testing has a
 * real example — see requirement 12's "products with different minimum
 * quantities." Safe to re-run: always sets the same target value, so a
 * second/third seed run is a no-op, not a drifting overwrite of
 * unrelated data.
 */
async function seedDealerMinimumQuantityVariety() {
  await prisma.productVariant.updateMany({
    where: { sku: "DEMO-DEALER-BULKFERT-CASE10" },
    data: { minOrderQty: 10 },
  });
  await prisma.productVariant.updateMany({
    where: { sku: "DEMO-DEALER-BULKFERT-CASE50" },
    data: { minOrderQty: 5 },
  });
}

async function main() {
  const { superAdminRoleId } = await seedRolesAndPermissions();
  const admin = await seedAdmin(superAdminRoleId);
  const seller = await seedSeller();
  const rejectedSeller = await seedRejectedSeller();
  const states = await seedIndianStates();
  const dealer = await seedDealer(states);
  const pendingDealer = await seedPendingDealer(states);
  const suspendedDealer = await seedSuspendedDealer(states);
  const customer = await seedCustomer();

  const categoryHierarchy = await seedCategoryHierarchy();
  const brandsAndManufacturers = await seedBrandsAndManufacturers();
  const attributes = await seedAttributes();
  const logisticsConfig = await seedLogisticsPricing();

  const sellerProfile = await prisma.sellerProfile.findUniqueOrThrow({
    where: { userId: seller.id },
  });
  const createdProducts = await seedDemoProducts(sellerProfile.id, {
    categories: categoryHierarchy.categories,
    subcategories: categoryHierarchy.subcategories,
    subSubCategories: categoryHierarchy.subSubCategories,
    brands: brandsAndManufacturers.brands,
    manufacturers: brandsAndManufacturers.manufacturers,
    attributes,
    states,
  });

  // --- Phase 4: second seller, pickup points, order/payment config, carts, sample orders ---
  await backfillMissingDemoShippingWeights();
  await seedDealerMinimumQuantityVariety();
  const seller2 = await seedSecondSeller();
  const seller2Profile = await prisma.sellerProfile.findUniqueOrThrow({
    where: { userId: seller2.id },
  });
  const seller2Product = await seedSecondSellerProduct(seller2Profile.id, {
    categories: categoryHierarchy.categories,
    subcategories: categoryHierarchy.subcategories,
    brands: brandsAndManufacturers.brands,
  });

  const pickupPoints = await seedPickupPoints(sellerProfile.id, seller2Profile.id);
  const partialPaymentConfig = await seedPartialPaymentConfig();
  const collectionChargeConfig = await seedCollectionChargeConfig();
  const settlementRateConfig = await seedSettlementRateConfig();
  await seedSettlementSettings();
  const shippingMethods = await seedShippingMethods(sellerProfile.id);

  // Prices below are hardcoded to match the exact sellingPrice each
  // referenced product/config was seeded with above (customer-bio-fertiliser:
  // mrp 700 - flat 105 = 595; carrier-based-consortia dealer config: mrp
  // 700 - flat 420 = 280 for the base config, but the dealer's own bulk
  // product is used below for a more realistic dealer cart value; organic
  // neem pesticide: customer 450-50=400, dealer 4500-500=4000) — CartItem
  // .priceAtAdd is display-only (see schema doc comment), so a values
  // mismatch here would never corrupt an order, only briefly mis-show a
  // "price changed" notice until the cart is next read.
  const seller1CustomerProduct = await prisma.product.findUnique({
    where: { slug: "customer-bio-fertiliser" },
  });
  const seller1DealerProduct = await prisma.product.findUnique({
    where: { slug: "dealer-bulk-fertiliser" },
  });
  if (seller1CustomerProduct) {
    await seedCustomerMultiSellerCart(
      customer.id,
      sellerProfile.id,
      seller1CustomerProduct.id,
      595,
      seller2Profile.id,
      seller2Product.id,
      400,
    );
  }
  if (seller1DealerProduct) {
    await seedDealerMultiSellerCart(
      dealer.id,
      sellerProfile.id,
      seller1DealerProduct.id,
      2800,
      seller2Profile.id,
      seller2Product.id,
      4000,
    );
  }

  await seedSampleOrders(customer.id, sellerProfile.id, dealer.id);

  // --- Product Card + Homepage CMS demo data ---
  const siteSettings = await seedSiteSettings();
  const homepageSectionCount = await seedHomepageSections();
  const promotionalAssets = await seedPromotionalAssets();
  const categoryHomepageAsset = await seedCategoryHomepageAsset(
    categoryHierarchy.categories[0]!.id,
  );
  const flagshipProduct = await prisma.product.findUnique({
    where: { slug: "carrier-based-consortia-biofertilizer" },
  });
  if (flagshipProduct) {
    await seedDealOfTheDay(flagshipProduct.id);
    await seedMerchandisingCollection(flagshipProduct.id);
    await prisma.product.update({
      where: { id: flagshipProduct.id },
      data: {
        subtitle: "Customer-safe, dealer-bulk consortia biofertilizer",
        editorialBadgeId: "edbadge_best_seller",
      },
    });
  }

  console.log("\nSeeded homepage CMS demo data:\n");
  console.table({
    siteSettings: `wishlist/buyNow/addToCart/requestSeller all enabled, rating threshold ${siteSettings.ratingDisplayThreshold}`,
    homepageSections: `${homepageSectionCount} sections enabled (COMMON audience)`,
    promotionalAssets: `2 hero slides, 2 coupon banners — 1 Customer + 1 Dealer each (${promotionalAssets.heroAsset.altText})`,
    categoryHomepageAsset: `1 (${categoryHierarchy.categories[0]!.name})`,
    dealOfTheDay: flagshipProduct
      ? "1 (24h, flagship demo product, ₹249)"
      : "skipped — flagship product not found",
    merchandising: flagshipProduct
      ? "1 MANUAL Trending collection (flagship demo product)"
      : "skipped",
  });

  console.log("Seeded demo users (Phase 1 + 2):\n");
  console.table([
    { role: "ADMIN", login: admin.email, password: ADMIN_DEMO_PASSWORD, status: "n/a" },
    {
      role: "SELLER (approved)",
      login: seller.email,
      password: SELLER_DEMO_PASSWORD,
      status: "APPROVED",
    },
    {
      role: "SELLER (rejected)",
      login: rejectedSeller.email,
      password: SELLER_DEMO_PASSWORD,
      status: "REJECTED",
    },
    {
      role: "DEALER (approved)",
      login: dealer.phone,
      password: "(OTP login)",
      status: "APPROVED (MH)",
    },
    {
      role: "DEALER (pending)",
      login: pendingDealer.phone,
      password: "(OTP login)",
      status: "PENDING",
    },
    {
      role: "DEALER (suspended)",
      login: suspendedDealer.phone,
      password: "(OTP login)",
      status: "SUSPENDED",
    },
    { role: "CUSTOMER (customer)", login: customer.phone, password: "(OTP login)", status: "n/a" },
  ]);

  console.log("\nSeeded catalog (Phase 3):\n");
  console.table({
    categories: categoryHierarchy.categories.length,
    subcategories: Object.keys(categoryHierarchy.subcategories).length,
    subSubCategories: Object.keys(categoryHierarchy.subSubCategories).length,
    brands: brandsAndManufacturers.brands.length,
    manufacturers: brandsAndManufacturers.manufacturers.length,
    attributes: Object.keys(attributes).length,
    states: states.length,
    logisticsSlabConfig: `${logisticsConfig.maxWeightGrams}g max, ${logisticsConfig.slabs.length} slabs`,
  });
  console.log(
    createdProducts.length > 0
      ? `Created products this run:\n- ${createdProducts.join("\n- ")}`
      : "Demo products already existed (skipped — see seedDemoProducts doc comment).",
  );

  console.log("\nSeeded Phase 4 order/checkout demo data:\n");
  console.table({
    sellers: "2 approved (Demo Agri Shop, Green Valley Agro Store)",
    pickupPoints: `${[pickupPoints.approvedPoint1, pickupPoints.pendingPoint1, pickupPoints.approvedPoint2].length} (2 approved, 1 pending review)`,
    partialPaymentConfig: `${partialPaymentConfig.label} — ${partialPaymentConfig.ruleType} ${partialPaymentConfig.value.toString()}`,
    collectionChargeConfig: `${collectionChargeConfig.label} — ${collectionChargeConfig.chargeType} ${collectionChargeConfig.value.toString()} / min ₹${collectionChargeConfig.minCharge?.toString() ?? "0"}`,
    settlementRateConfig: `${settlementRateConfig.label} — commission/logistics/collection GST ${settlementRateConfig.commissionGstPercent.toString()}% (TCS 0.5%, TDS 0.1% fixed)`,
    transportShippingMethods: `platform-wide ₹${shippingMethods.platformWideMethod.cost.toString()}, ${sellerProfile.shopName}-specific ₹${shippingMethods.sellerSpecificMethod.cost.toString()}`,
    customerCart: "2 items across 2 sellers (if not already present)",
    dealerCart: "2 items across 2 sellers (if not already present)",
    sampleOrders:
      "8 — customer: COD, ONLINE_FULL x2 (5% discount), ONLINE_PARTIAL (2% discount), COD delivered, ONLINE_FULL failed; dealer: Kisan4U Courier, Transport (both above the ₹2,000 collection-charge threshold)",
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
