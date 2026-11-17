import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * One-shot: replace the entire storefront category taxonomy with the
 * owner-supplied 6-category tree, re-file every real product into it, then
 * delete every old category / subcategory / sub-subcategory. The draft
 * placeholder category (isActive:false, used by product-draft.ts) is kept.
 *
 *  - Category emojis: monochrome / text-style glyphs.
 *  - Sub / sub-sub images: left null here (sourced separately for the
 *    concrete nodes; abstract nodes get an admin upload later).
 *  - Products: rule-mapped by their current subcategory, with per-id
 *    overrides for the handful that don't fit a rule; the 9 "Test …"
 *    junk drafts stay on the placeholder.
 *  - Dependents: the 2 category HERO banners (both on old "Plant
 *    Nutrients") are repointed to new "Crop Nutrition"; the single
 *    CategoryHomepageAsset row is deleted (FK). The 26 LicenceRequirement
 *    CATEGORY rows are already orphaned (their taxonomyNodeIds match no
 *    live category) — left untouched, nothing to remap onto.
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const DRAFT_PLACEHOLDER_SLUG = "draft-placeholder-uncategorized";

type SubSpec = { name: string; subsubs: string[] };
type CatSpec = { name: string; emoji: string; subs: SubSpec[] };

const TAXONOMY: CatSpec[] = [
  {
    name: "Seeds",
    emoji: "🌸", // 🌸 cherry blossom (emoji form of the old ⚘ flower)
    subs: [
      { name: "Horticulture Crops", subsubs: ["Vegetable Seeds", "Fruit Seeds", "Flower Seeds"] },
      {
        name: "Field Crops",
        subsubs: ["Forages", "Maize/Corn", "Paddy", "Mustard", "Jowar", "Cotton"],
      },
      {
        name: "Special Category",
        subsubs: ["Polyhouse", "Exotics", "Forestry", "Urban Garden", "Saplings"],
      },
      {
        name: "Popular Products",
        subsubs: ["Tomato", "Chilli", "Brinjal", "Cucumber", "Cauliflower"],
      },
    ],
  },
  {
    name: "Crop Protection",
    emoji: "🛡️", // 🛡️ shield (emoji form of the old ⛨)
    subs: [
      {
        name: "Chemical Pesticides",
        subsubs: [
          "Insecticides",
          "Fungicides",
          "Herbicides",
          "Bactericides",
          "Miticides/Acaricides",
        ],
      },
      {
        name: "Bio/Organic Pesticides",
        subsubs: [
          "Bio Insecticides",
          "Bio Fungicides",
          "Bio Viricides",
          "Bio Nematicides",
          "Bio Miticides/Acaricides",
        ],
      },
      {
        name: "Traps and Lures",
        subsubs: ["Sticky Traps", "Pheromone Lures", "Pheromone Traps", "Solar Light Traps"],
      },
      {
        name: "Others",
        subsubs: [
          "Adjuvants",
          "Surface Disinfectants",
          "Decomposers",
          "Animal Repellant",
          "Safety Kit",
          "Safety Shoes",
        ],
      },
    ],
  },
  {
    name: "Crop Nutrition",
    emoji: "⚗️", // ⚗️ alembic — same glyph, emoji presentation
    subs: [
      {
        name: "Fertilizers",
        subsubs: [
          "Chemical Fertilizers",
          "Bio/Organic Fertilizers",
          "Micro Nutrients",
          "Humic Acids",
          "pH Balancers",
        ],
      },
      {
        name: "Growth Promoters",
        subsubs: ["Plant Growth Promoters", "Plant Enhancers", "Bio Stimulants/Activators"],
      },
      {
        name: "Plant Growth Regulators",
        subsubs: ["Yield Boosters", "Fruit Enhancers", "Flower Boosters"],
      },
      {
        name: "Popular",
        subsubs: [
          "NPK Fertilizers",
          "Liquid Fertilizers",
          "Seaweed Extracts",
          "Fertilizer Enhancers",
        ],
      },
    ],
  },
  {
    name: "Equipments",
    emoji: "⚙️", // ⚙️ gear — same glyph, emoji presentation
    subs: [
      {
        name: "Implements",
        subsubs: [
          "Sprayers",
          "Brush Cutter",
          "Weeder/Tiller",
          "Chaff Cutter and Parts",
          "Solar Dryer",
          "Rice Mill",
          "Earth Augers",
          "Power Reaper",
          "Chain Saw",
          "Sugarcane Machine",
        ],
      },
      {
        name: "Agriculture Tools",
        subsubs: [
          "Nursery Inputs",
          "Fruit Harvester/Plucker",
          "Garden Tools",
          "Seeder/Transplanter",
        ],
      },
      {
        name: "Accessories",
        subsubs: [
          "Tirpal/Tarpaulin",
          "Mulch",
          "Shade Net",
          "Traps and Lure",
          "Safety Kit",
          "Torch/Lantern",
          "Crop Cover",
        ],
      },
      { name: "Irrigation", subsubs: ["Pipe", "Water Pump", "Sprinkler", "Drip Kit"] },
    ],
  },
  {
    name: "Animal Husbandry",
    emoji: "🐴", // 🐴 horse (emoji form of the old ♞ knight)
    subs: [
      {
        name: "Cattle",
        subsubs: [
          "Cattle Feed",
          "Cattle Supplements",
          "Milking Machine",
          "Milking Machine Accessories",
          "Calf Feeding Bottle",
        ],
      },
      { name: "Poultry", subsubs: ["Poultry Supplements", "Poultry Equipment"] },
      { name: "Others", subsubs: ["Forage Seeds", "Silage Culture"] },
      {
        name: "Popular Brands",
        subsubs: [
          "Meenakshi Agro",
          "Ecowealth",
          "Godhan",
          "Prompt Equipments Private Limited",
          "Agrigators Enterprises Private Limited",
          "Shivam Pharma",
        ],
      },
    ],
  },
  {
    name: "Organic",
    emoji: "♻️", // ♻️ recycling — emoji form of the old ♲
    subs: [
      {
        name: "Bio/Organic Pesticides",
        subsubs: [
          "Bio Insecticides",
          "Bio Fungicides",
          "Bio Viricides",
          "Bio Nematicides",
          "Bio Miticides/Acaricides",
        ],
      },
      {
        name: "Crop Nutrition",
        subsubs: ["Bio/Organic Fertilizers", "Bio Stimulants/Activators"],
      },
    ],
  },
];

function slugify(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\//g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

/** old "Category|Subcategory" -> [newCat, newSub, newSubSub] */
const RULES: Record<string, [string, string, string]> = {
  "Plant Protection|Insecticide": ["Crop Protection", "Chemical Pesticides", "Insecticides"],
  "Plant Protection|Fungicide": ["Crop Protection", "Chemical Pesticides", "Fungicides"],
  "Plant Protection|Herbicide": ["Crop Protection", "Chemical Pesticides", "Herbicides"],
  "Plant Protection|Bio Pesticide": [
    "Crop Protection",
    "Bio/Organic Pesticides",
    "Bio Insecticides",
  ],
  "Plant Nutrients|Fertilisers": ["Crop Nutrition", "Fertilizers", "Chemical Fertilizers"],
  "Plant Nutrients|Micronutrients": ["Crop Nutrition", "Fertilizers", "Micro Nutrients"],
  "Plant Nutrients|Bio Fertilisers": [
    "Crop Nutrition",
    "Fertilizers",
    "Bio/Organic Fertilizers",
  ],
  "Plant Nutrients|Bio Stimulant": [
    "Crop Nutrition",
    "Growth Promoters",
    "Bio Stimulants/Activators",
  ],
  "Plant Nutrients|PGR": ["Crop Nutrition", "Plant Growth Regulators", "Yield Boosters"],
  "Gardening Product|Home Garden Pest Management": [
    "Crop Nutrition",
    "Fertilizers",
    "Bio/Organic Fertilizers",
  ],
  "Gardening Product|Nutrients": ["Crop Nutrition", "Fertilizers", "Micro Nutrients"],
  "Spray Pump|Spray Pump Spare Parts": ["Equipments", "Implements", "Sprayers"],
  "Sticker And Spreader|Silicon Spreader": ["Crop Protection", "Others", "Adjuvants"],
};

/** product name substring (lowercased) -> target, checked before RULES (fixes obvious mis-files in the old data + places the "(none)" subcategory products) */
const NAME_OVERRIDES: [string, [string, string, string]][] = [
  // obvious product-name signals that beat the (sometimes wrong) old subcategory
  ["bio fungicide", ["Crop Protection", "Bio/Organic Pesticides", "Bio Fungicides"]],
  ["bio insecticide", ["Crop Protection", "Bio/Organic Pesticides", "Bio Insecticides"]],
  ["bio nematicide", ["Crop Protection", "Bio/Organic Pesticides", "Bio Nematicides"]],
  ["bio viricide", ["Crop Protection", "Bio/Organic Pesticides", "Bio Viricides"]],
  ["nematicide", ["Crop Protection", "Chemical Pesticides", "Miticides/Acaricides"]],
  ["acaricide", ["Crop Protection", "Chemical Pesticides", "Miticides/Acaricides"]],
  ["miticide", ["Crop Protection", "Chemical Pesticides", "Miticides/Acaricides"]],
  // Plant Protection / (none)
  ["no-virus", ["Crop Protection", "Bio/Organic Pesticides", "Bio Viricides"]],
  ["bactogang", ["Crop Protection", "Bio/Organic Pesticides", "Bio Fungicides"]],
  ["geocin", ["Crop Protection", "Chemical Pesticides", "Bactericides"]],
  ["imigro", ["Crop Protection", "Chemical Pesticides", "Insecticides"]],
  ["tabsil", ["Crop Nutrition", "Fertilizers", "Micro Nutrients"]],
  ["geolife change", ["Crop Nutrition", "Growth Promoters", "Plant Growth Promoters"]],
  // Plant Nutrients / (none)
  ["vigore fruit size", ["Crop Nutrition", "Plant Growth Regulators", "Fruit Enhancers"]],
  ["vigore -", ["Crop Nutrition", "Growth Promoters", "Bio Stimulants/Activators"]],
  ["growth kit", ["Crop Nutrition", "Growth Promoters", "Plant Growth Promoters"]],
  ["plus gold", ["Crop Nutrition", "Growth Promoters", "Plant Growth Promoters"]],
  // Gardening Product / (none) + neem in Home Garden
  ["bhusatva", ["Crop Nutrition", "Growth Promoters", "Bio Stimulants/Activators"]],
  ["kawavchh", ["Crop Protection", "Bio/Organic Pesticides", "Bio Insecticides"]],
  ["azadirachtin", ["Crop Protection", "Bio/Organic Pesticides", "Bio Insecticides"]],
  ["niimpa", ["Crop Protection", "Bio/Organic Pesticides", "Bio Insecticides"]],
  ["neem oil", ["Crop Protection", "Bio/Organic Pesticides", "Bio Insecticides"]],
  ["sarvottam", ["Crop Nutrition", "Fertilizers", "Micro Nutrients"]],
  ["garden care kit", ["Crop Nutrition", "Fertilizers", "Humic Acids"]],
  ["ezzy garden day-60 flowering", ["Crop Nutrition", "Plant Growth Regulators", "Flower Boosters"]],
  // Tarpaulin
  ["tarpaulin", ["Equipments", "Accessories", "Tirpal/Tarpaulin"]],
  ["tirpal", ["Equipments", "Accessories", "Tirpal/Tarpaulin"]],
  // off-taxonomy human product — least-wrong bucket, flagged in the report
  ["pain relief oil", ["Crop Protection", "Others", "Safety Kit"]],
];

const FALLBACK: [string, string, string] = ["Crop Protection", "Chemical Pesticides", "Insecticides"];

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // ---- resolve old rows ------------------------------------------------------
  const oldCats = await prisma.category.findMany({ select: { id: true, slug: true } });
  const placeholder = oldCats.find((c) => c.slug === DRAFT_PLACEHOLDER_SLUG);
  const oldCatIdsToDelete = oldCats.filter((c) => c.slug !== DRAFT_PLACEHOLDER_SLUG).map((c) => c.id);
  const oldSubs = await prisma.subcategory.findMany({ select: { id: true } });
  const oldSubSubs = await prisma.subSubCategory.findMany({ select: { id: true } });

  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      categoryId: true,
      category: { select: { name: true } },
      subCategory: { select: { name: true } },
    },
  });

  console.log(
    `Old: ${oldCatIdsToDelete.length} categories, ${oldSubs.length} subcategories, ${oldSubSubs.length} sub-subcategories, ${products.length} products.`,
  );

  await prisma.$transaction(
    async (tx) => {
      // ---- 1. build the new taxonomy ---------------------------------------
      const usedCatSlug = new Set<string>([DRAFT_PLACEHOLDER_SLUG]);
      const usedSubSlug = new Set<string>();
      const usedSubSubSlug = new Set<string>();
      const uniq = (base: string, prefix: string, used: Set<string>) => {
        let s = base;
        if (used.has(s)) s = `${prefix}-${base}`;
        let i = 2;
        while (used.has(s)) s = `${prefix}-${base}-${i++}`;
        used.add(s);
        return s;
      };

      const catId = new Map<string, string>();
      const subId = new Map<string, string>(); // "Cat>Sub" -> id
      const subSubId = new Map<string, string>(); // "Cat>Sub>SubSub" -> id

      for (let ci = 0; ci < TAXONOMY.length; ci++) {
        const cat = TAXONOMY[ci]!;
        const cslug = uniq(slugify(cat.name), "cat", usedCatSlug);
        const c = await tx.category.create({
          data: {
            name: cat.name,
            slug: cslug,
            emoji: cat.emoji,
            position: ci + 1,
            isActive: true,
          },
          select: { id: true },
        });
        catId.set(cat.name, c.id);

        for (let si = 0; si < cat.subs.length; si++) {
          const sub = cat.subs[si]!;
          const sslug = uniq(slugify(sub.name), cslug, usedSubSlug);
          const s = await tx.subcategory.create({
            data: {
              name: sub.name,
              slug: sslug,
              categoryId: c.id,
              position: si + 1,
              isActive: true,
            },
            select: { id: true },
          });
          subId.set(`${cat.name}>${sub.name}`, s.id);

          for (let ssi = 0; ssi < sub.subsubs.length; ssi++) {
            const ss = sub.subsubs[ssi]!;
            const ssslug = uniq(slugify(ss), sslug, usedSubSubSlug);
            const created = await tx.subSubCategory.create({
              data: {
                name: ss,
                slug: ssslug,
                subCategoryId: s.id,
                position: ssi + 1,
                isActive: true,
              },
              select: { id: true },
            });
            subSubId.set(`${cat.name}>${sub.name}>${ss}`, created.id);
          }
        }
      }

      // ---- 2. re-file products ------------------------------------------------
      const report: string[] = [];
      let refiled = 0;
      let skippedJunk = 0;
      for (const p of products) {
        if (p.category?.name === "Uncategorized (draft placeholder — not a real category)") {
          skippedJunk++;
          continue; // leave test-junk drafts on the placeholder
        }
        const lname = p.name.toLowerCase();
        let target =
          NAME_OVERRIDES.find(([needle]) => lname.includes(needle))?.[1] ??
          RULES[`${p.category?.name ?? ""}|${p.subCategory?.name ?? ""}`] ??
          undefined;

        if (!target && p.category?.name === "Plant Protection") {
          target = ["Crop Protection", "Chemical Pesticides", "Insecticides"];
        } else if (!target && p.category?.name === "Plant Nutrients") {
          target = ["Crop Nutrition", "Fertilizers", "Chemical Fertilizers"];
        }
        if (!target) target = FALLBACK;

        const [cn, sn, ssn] = target;
        const cid = catId.get(cn)!;
        const sid = subId.get(`${cn}>${sn}`) ?? null;
        const ssid = subSubId.get(`${cn}>${sn}>${ssn}`) ?? null;
        await tx.product.update({
          where: { id: p.id },
          data: { categoryId: cid, subCategoryId: sid, subSubCategoryId: ssid },
        });
        refiled++;
        report.push(`${p.name}\t=> ${cn} / ${sn} / ${ssn}`);
      }
      console.log(`Re-filed ${refiled} products; left ${skippedJunk} junk drafts on the placeholder.`);
      console.log("--- sample re-file report (first 20) ---");
      console.log(report.slice(0, 20).join("\n"));

      // ---- 3. dependents ---------------------------------------------------
      const cropNutritionId = catId.get("Crop Nutrition")!;
      await tx.promotionalAsset.updateMany({
        where: { categoryId: { in: oldCatIdsToDelete } },
        data: { categoryId: cropNutritionId },
      });
      await tx.categoryHomepageAsset.deleteMany({});

      // ---- 4. delete the old taxonomy ------------------------------------
      await tx.subSubCategory.deleteMany({ where: { id: { in: oldSubSubs.map((s) => s.id) } } });
      await tx.subcategory.deleteMany({ where: { id: { in: oldSubs.map((s) => s.id) } } });
      await tx.category.deleteMany({ where: { id: { in: oldCatIdsToDelete } } });

      if (dryRun) throw new Error("dry-run: rolling back");
    },
    { timeout: 120_000 },
  );

  // ---- verify ---------------------------------------------------------------
  const [cats, subs, subsubs, orphanProducts, ph] = await Promise.all([
    prisma.category.count({ where: { slug: { not: DRAFT_PLACEHOLDER_SLUG } } }),
    prisma.subcategory.count(),
    prisma.subSubCategory.count(),
    prisma.product.count({
      where: {
        category: { slug: DRAFT_PLACEHOLDER_SLUG },
        NOT: { name: { startsWith: "Test " } },
      },
    }),
    prisma.category.findUnique({ where: { slug: DRAFT_PLACEHOLDER_SLUG }, select: { id: true } }),
  ]);
  console.log(
    `\nNow: ${cats} categories, ${subs} subcategories, ${subsubs} sub-subcategories. Placeholder kept: ${!!ph}. Non-junk products still on placeholder: ${orphanProducts}.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
