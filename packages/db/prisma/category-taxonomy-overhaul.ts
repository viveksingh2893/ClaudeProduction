import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * One-time replacement of the entire Category/Subcategory/SubSubCategory
 * tree with the new 6-category taxonomy, and reassignment of every existing
 * Product into it.
 *
 *   pnpm --filter @kisan4u/db exec tsx prisma/category-taxonomy-overhaul.ts            # dry run -> report only
 *   pnpm --filter @kisan4u/db exec tsx prisma/category-taxonomy-overhaul.ts --apply    # write changes (after DB backup)
 *
 * Design:
 *  - The 5 surviving top-level categories (Crop Protection, Crop Nutrition->
 *    Crop Nutrients, Equipments, Bio Stimulant, Animal Husbandry) are UPDATED
 *    in place (same row id) so existing FKs from MerchandisingCollection/
 *    PromotionalAsset keep working. "Seeds" has no counterpart in the new
 *    taxonomy and is deleted (its 2 PromotionalAsset rows are detached, not
 *    deleted). The `draft-placeholder-uncategorized` category is never
 *    touched -- product-decisions.ts uses it as the default categoryId for
 *    brand-new drafts.
 *  - Every product is repointed to its new (category, subCategory,
 *    subSubCategory) BEFORE any old Subcategory/SubSubCategory row is
 *    deleted, so nothing ever relies on FK default-action behavior.
 *  - New Category/Subcategory/SubSubCategory rows get no imageUrl (per
 *    product decision: generating real photography isn't possible in this
 *    environment; left null for the storefront/admin to fill in later,
 *    same convention as any pre-existing null image row).
 */

const APPLY = process.argv.includes("--apply");
const OUT_DIR = new URL("../it2work/", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// New taxonomy
// ---------------------------------------------------------------------------

type Leaf = { name: string; slug: string };
type Sub = { name: string; slug: string; leaves: Leaf[] };
type Cat = {
  key: string; // internal key used by the product mapping below
  name: string;
  slug: string;
  emoji: string;
  keepSlug?: string; // slug of the EXISTING category row to update in place
  subs: Sub[];
};

const TAXONOMY: Cat[] = [
  {
    key: "cropProtection",
    name: "Crop Protection",
    slug: "crop-protection",
    emoji: "🛡️",
    keepSlug: "crop-protection",
    subs: [
      {
        name: "Chemical Pesticide",
        slug: "chemical-pesticide",
        leaves: [
          { name: "Insecticides", slug: "insecticides" },
          { name: "Fungicides", slug: "fungicides" },
          { name: "Herbicides", slug: "herbicides" },
          { name: "Bactericides", slug: "bactericides" },
          { name: "Acaricides", slug: "acaricides" },
        ],
      },
      {
        name: "Bio Pesticides",
        slug: "bio-pesticides",
        leaves: [
          { name: "Bio Insecticides", slug: "bio-insecticides" },
          { name: "Bio Fungicides", slug: "bio-fungicides" },
          { name: "Bio Virucides", slug: "bio-virucides" },
          { name: "Bio Nematicides", slug: "bio-nematicides" },
          { name: "Bio Acaricides", slug: "bio-acaricides" },
        ],
      },
      {
        name: "PGR",
        slug: "pgr",
        leaves: [
          { name: "Sticky Traps", slug: "sticky-traps" },
          { name: "Plant Growth Promotors", slug: "plant-growth-promotors" },
          { name: "Flowering Boosters", slug: "flowering-boosters" },
          { name: "Plant Enhancers", slug: "plant-enhancers" },
          { name: "Fruit Boosters", slug: "fruit-boosters" },
          { name: "Yield Boosters", slug: "yield-boosters" },
        ],
      },
    ],
  },
  {
    key: "cropNutrients",
    name: "Crop Nutrients",
    slug: "crop-nutrients",
    emoji: "🧪",
    keepSlug: "crop-nutrition",
    subs: [
      {
        name: "Chemical Fertilisers",
        slug: "chemical-fertilisers",
        leaves: [
          { name: "Water Soluble Fertiliser", slug: "water-soluble-fertiliser" },
          { name: "Liquids Fertilisers", slug: "liquids-fertilisers" },
          { name: "Suspension Fertilisers", slug: "suspension-fertilisers" },
          { name: "NPK Powder", slug: "npk-powder" },
        ],
      },
      {
        name: "Bio Fertilisers",
        slug: "bio-fertilisers",
        leaves: [
          { name: "Bio Fertilisers Liquid", slug: "bio-fertilisers-liquid" },
          { name: "Bio Fertilisers Powder", slug: "bio-fertilisers-powder" },
          { name: "Bio Fertilisers Granules", slug: "bio-fertilisers-granules" },
        ],
      },
      {
        name: "Micronutrients",
        slug: "micronutrients",
        leaves: [
          { name: "Micronutrients Liquid", slug: "micronutrients-liquid" },
          { name: "Micronutrients Powder", slug: "micronutrients-powder" },
          { name: "EDTA Micronutrients", slug: "edta-micronutrients" },
          { name: "Suspension Micronutrients", slug: "suspension-micronutrients" },
          { name: "Micronutrients Granules", slug: "micronutrients-granules" },
        ],
      },
    ],
  },
  {
    key: "bioStimulant",
    name: "Bio Stimulant",
    slug: "bio-stimulant",
    emoji: "🌿",
    keepSlug: "organic",
    subs: [
      { name: "Humic and Fulvic Acid", slug: "humic-and-fulvic-acid", leaves: [] },
      { name: "Botanical Extract", slug: "botanical-extract", leaves: [] },
      { name: "Amino Acid", slug: "amino-acid", leaves: [] },
      { name: "Cell Free Microbial", slug: "cell-free-microbial", leaves: [] },
      { name: "Antioxidants", slug: "antioxidants", leaves: [] },
      { name: "Anti-Transpirants", slug: "anti-transpirants", leaves: [] },
      { name: "Vitamins", slug: "vitamins", leaves: [] },
    ],
  },
  {
    key: "equipments",
    name: "Equipments",
    slug: "equipments",
    emoji: "⚙️",
    keepSlug: "equipments",
    subs: [
      { name: "Naps Hak Spray Pump", slug: "naps-hak-spray-pump", leaves: [] },
      { name: "Battery Spray Pump", slug: "battery-spray-pump", leaves: [] },
      { name: "Engine Spray Pump", slug: "engine-spray-pump", leaves: [] },
      { name: "Spray Pump Accessories", slug: "spray-pump-accessories", leaves: [] },
      { name: "Solar Pump", slug: "solar-pump", leaves: [] },
      { name: "Solar Accessories", slug: "solar-accessories", leaves: [] },
      { name: "Tarpaulin", slug: "tarpaulin", leaves: [] },
      { name: "Irrigation Pump", slug: "irrigation-pump", leaves: [] },
      { name: "Drip Pipes", slug: "drip-pipes", leaves: [] },
      { name: "Drip Accessories", slug: "drip-accessories", leaves: [] },
    ],
  },
  {
    key: "adjuvant",
    name: "Adjuvant",
    slug: "adjuvant",
    emoji: "🧴",
    subs: [
      { name: "Silicon Spreader", slug: "silicon-spreader", leaves: [] },
      { name: "Chipko", slug: "chipko", leaves: [] },
      { name: "Surfactant", slug: "surfactant", leaves: [] },
    ],
  },
  {
    key: "animalHusbandry",
    name: "Animal Husbandry",
    slug: "animal-husbandry",
    emoji: "🐄",
    keepSlug: "animal-husbandry",
    subs: [
      { name: "Cattle Feed", slug: "cattle-feed", leaves: [] },
      { name: "Cattle Supplements", slug: "cattle-supplements", leaves: [] },
      { name: "Poultry Supplements", slug: "poultry-supplements", leaves: [] },
      { name: "Poultry Equipments", slug: "poultry-equipments", leaves: [] },
    ],
  },
];

// Category slug that no longer exists in the new taxonomy and is deleted.
const DELETED_CATEGORY_SLUGS = ["seeds"];
// Never touched -- product-decisions.ts default categoryId for new drafts.
const PLACEHOLDER_CATEGORY_SLUG = "draft-placeholder-uncategorized";

// ---------------------------------------------------------------------------
// Product reassignment
// ---------------------------------------------------------------------------

// A leaf target, as ["Category name", "Subcategory name", "SubSubCategory name" | null]
type Target = [string, string, string | null];

// Old SubSubCategory.name -> new leaf. Applied to every product whose
// current subSubCategory has this name, UNLESS the product id appears in
// PRODUCT_OVERRIDES (which always wins).
const DIRECT_SUBSUBCATEGORY_MAP: Record<string, Target> = {
  Insecticides: ["Crop Protection", "Chemical Pesticide", "Insecticides"],
  Fungicides: ["Crop Protection", "Chemical Pesticide", "Fungicides"],
  Herbicides: ["Crop Protection", "Chemical Pesticide", "Herbicides"],
  Bactericides: ["Crop Protection", "Chemical Pesticide", "Bactericides"],
  "Miticides/Acaricides": ["Crop Protection", "Chemical Pesticide", "Acaricides"],
  "Bio Insecticides": ["Crop Protection", "Bio Pesticides", "Bio Insecticides"],
  "Bio Fungicides": ["Crop Protection", "Bio Pesticides", "Bio Fungicides"],
  "Bio Viricides": ["Crop Protection", "Bio Pesticides", "Bio Virucides"],
  "Humic Acids": ["Bio Stimulant", "Humic and Fulvic Acid", null],
  "Plant Growth Promoters": ["Crop Protection", "PGR", "Plant Growth Promotors"],
  "Yield Boosters": ["Crop Protection", "PGR", "Yield Boosters"],
  "Fruit Enhancers": ["Crop Protection", "PGR", "Fruit Boosters"],
  "Flower Boosters": ["Crop Protection", "PGR", "Flowering Boosters"],
  "Tirpal/Tarpaulin": ["Equipments", "Tarpaulin", null],
};

// Explicit per-product overrides for everything that needed real judgment
// (old bucket names were unreliable -- e.g. "Chemical Fertilizers" contained
// PGR products, bio-fertilisers and micronutrient chelates). Always wins
// over DIRECT_SUBSUBCATEGORY_MAP. See product_category_mapping notes in the
// job that produced this script for the reasoning behind each bucket.
const LIQ_FERT: Target = ["Crop Nutrients", "Chemical Fertilisers", "Liquids Fertilisers"];
const WSF: Target = ["Crop Nutrients", "Chemical Fertilisers", "Water Soluble Fertiliser"];
const NPK_POWDER: Target = ["Crop Nutrients", "Chemical Fertilisers", "NPK Powder"];
const SUSP_FERT: Target = ["Crop Nutrients", "Chemical Fertilisers", "Suspension Fertilisers"];
const BIOFERT_LIQ: Target = ["Crop Nutrients", "Bio Fertilisers", "Bio Fertilisers Liquid"];
const BIOFERT_POWDER: Target = ["Crop Nutrients", "Bio Fertilisers", "Bio Fertilisers Powder"];
const BIOFERT_GRAN: Target = ["Crop Nutrients", "Bio Fertilisers", "Bio Fertilisers Granules"];
const MICRO_LIQ: Target = ["Crop Nutrients", "Micronutrients", "Micronutrients Liquid"];
const MICRO_POWDER: Target = ["Crop Nutrients", "Micronutrients", "Micronutrients Powder"];
const MICRO_EDTA: Target = ["Crop Nutrients", "Micronutrients", "EDTA Micronutrients"];
const MICRO_SUSP: Target = ["Crop Nutrients", "Micronutrients", "Suspension Micronutrients"];
const MICRO_GRAN: Target = ["Crop Nutrients", "Micronutrients", "Micronutrients Granules"];
const HUMIC: Target = ["Bio Stimulant", "Humic and Fulvic Acid", null];
const BOTANICAL: Target = ["Bio Stimulant", "Botanical Extract", null];
const AMINO: Target = ["Bio Stimulant", "Amino Acid", null];
const CELLFREE: Target = ["Bio Stimulant", "Cell Free Microbial", null];
const VITAMINS: Target = ["Bio Stimulant", "Vitamins", null];
const YIELD_BOOST: Target = ["Crop Protection", "PGR", "Yield Boosters"];
const PGR_PROMOTOR: Target = ["Crop Protection", "PGR", "Plant Growth Promotors"];
const BIO_VIRUCIDE: Target = ["Crop Protection", "Bio Pesticides", "Bio Virucides"];
const SPRAY_ACCESSORIES: Target = ["Equipments", "Spray Pump Accessories", null];
const SILICON_SPREADER: Target = ["Adjuvant", "Silicon Spreader", null];
const SURFACTANT: Target = ["Adjuvant", "Surfactant", null];

const PRODUCT_OVERRIDES: Record<string, Target> = {
  // --- old "Chemical Fertilizers" bucket (54) ---
  cmt38cy3y0009rldieklm70y7: LIQ_FERT, // ARIES TOTAL
  cmt39ah9k0093i5dirir3hiwv: NPK_POWDER, // Geolife Fullmeal Flower
  cmt39afzr008wi5dindx6n8qc: NPK_POWDER, // Geolife Fullmeal Fruit
  cmt39aeq5008pi5difgtqz0nv: NPK_POWDER, // Geolife Fullmeal Soil Health
  cmt399h7c003li5di0lfjubzt: WSF, // Geolife NPK 00:00:50 WSF
  cmt399rvo0049i5dib8w5thui: WSF, // Geolife NPK 19-19-19 WSF
  cmt399juu003ri5di29sj80ab: WSF, // Geolife NPK WSF 00:52:34
  cmt399ukv004fi5di9msjwlpv: NPK_POWDER, // Geolife Nutrimeal Berry
  cmt399vfq004li5di5pkdzrh9: NPK_POWDER, // Geolife Nutrimeal Bloom
  cmt399wa1004ri5di4n1mxemm: NPK_POWDER, // Geolife Nutrimeal Flora
  cmt399x4w004xi5di0r38sun6: NPK_POWDER, // Geolife Nutrimeal Grow
  cmt399xzr0053i5didmmto3lh: NPK_POWDER, // Geolife Nutrimeal Nourish
  cmt399yu00059i5dixfpbnach: NPK_POWDER, // Geolife Nutrimeal Start
  cmt399p6j0043i5diobles7px: WSF, // Geolife Phosporus Nitrate WSF
  cmt399mha003xi5digdcjcelz: WSF, // Geolife Potassium Nitrate WSF
  cmt39aoto00b1i5di56i2w6jd: YIELD_BOOST, // Geolife Vigore Raja - Yield Booster
  cmt38dd9s000xrldi1uzspc8c: WSF, // HYDROPRO GOLD
  cmt360oxu00hcqqdijaz2rq31: LIQ_FERT, // Katra Nano -6:0:18
  cmt310skc00nkrfdicr1lfg7u: LIQ_FERT,
  cmt35wz66001fqqdi66wtbaof: LIQ_FERT, // Katra Nano -NPK 00:00:50
  cmt30xudi00dirfdirs66gb7y: LIQ_FERT,
  cmt35wxjk0012qqdipw0yi8am: LIQ_FERT, // Katra Nano -NPK 00:52:34
  cmt30w8sf007drfdiyx6of7un: LIQ_FERT,
  cmt35wt8c000aqqdij5x2v4lp: LIQ_FERT, // Katra Nano -NPK 12:61:00
  cmt30xrkx00d2rfdip985jbq9: LIQ_FERT,
  cmt30xzgt00edrfdixhrxgz0z: LIQ_FERT, // Katra Nano -NPK 13:00:45
  cmt3608hq00fbqqdi3yd2ad49: LIQ_FERT,
  cmt30y9lm00f6rfdivyvhh9kd: LIQ_FERT, // Katra Nano -NPK 13:40:13
  cmt35zwha00dsqqdiprkj7ul7: LIQ_FERT,
  cmt30ycpo00fqrfdim0fml43k: LIQ_FERT, // Katra Nano -NPK 17:44:00
  cmt35zl0a00cpqqdien9vfswe: LIQ_FERT,
  cmt35wqy70000qqdi532ul5lr: LIQ_FERT, // Katra Nano -NPK 19:19:19
  cmt30xor300cqrfdiv8qx4zfn: LIQ_FERT,
  cmt30yb3900fhrfdi5hohxbjv: LIQ_FERT, // Katra Nano -NPK 20:20:20
  cmt35zr2y00d4qqdix5mav5s0: LIQ_FERT,
  cmt310qu200n3rfdirm4kwtsa: SUSP_FERT, // Katra Nano -Npk 11:11:8 Suspension
  cmt360sie00hpqqdisdxztzw4: SUSP_FERT,
  cmt360bkz00fwqqdi9is4z7t6: LIQ_FERT, // Katra Nano -Npk 8:8:8 Liquid
  cmt311c3m00p8rfdiak389l3n: LIQ_FERT,
  cmt3aukii00146qdiz89fl8q3: PGR_PROMOTOR, // Kay Bee NOVA Drip (PGR)
  cmt3aue0c000l6qdikq6bzpuu: PGR_PROMOTOR, // Kay Bee NOVA GA (PGR)
  cmt3au6cf00006qdi6dye0yde: BOTANICAL, // Kay Bee NOVA Zyme (seaweed extract)
  cmt3auql7001n6qdiccyds2op: LIQ_FERT, // Kay Bee pH Tunner
  cmt38dnic001arldimrnswm4q: MICRO_POWDER, // MNCHEL (chlorosis micronutrient powder)
  cmt36269000laqqdi6vtgft0m: BIOFERT_POWDER, // PHOSPHATE SOLUBILIZING FUNGAL BIOFERTILIZER POWDER
  cmt38eflr002krldipyqvjtox: LIQ_FERT, // PRIMASULF
  cmt360a5500flqqdi3ciap4yo: BIOFERT_GRAN, // PROM organic manure 50kg bag
  cmt3bdxii00eaoediva8abwbi: MICRO_EDTA, // Paidavaar Mix Micro Nutrients (chelated)
  cmt3by8qy001twodil2p5iqe6: BIOFERT_GRAN, // Titan Vermicompost
  cmt3byiar003xwodigevtq3op: BIOFERT_GRAN, // Titan Mycorrhiza Granules
  cmt3c0qg500kcwodixeihp7tk: WSF, // Titan Soluble Silica with potassium
  cmt35x3fs0027qqdi37l1os0z: LIQ_FERT, // Virus-G (silicon fertiliser, not a virucide)
  cmt30usq4000zrfdidafts19y: LIQ_FERT,
  cmt38e2la0022rldiy43zbaem: MICRO_LIQ, // ZINC MAG

  // --- old "Bio/Organic Fertilizers" bucket (51) ---
  cmt311tuq00qorfdixuins2b1: BIOFERT_POWDER, // Carrier Based Consortia NPK
  cmt3635s000n1qqdinlpbrlqx: BIOFERT_POWDER,
  cmt30xmbr00cjrfdikzacdpcy: BIOFERT_GRAN, // Aloe Vera slow-release capsules
  cmt3603pm00epqqdi2u6ftk5f: BIOFERT_GRAN,
  cmt30wyi000a8rfdislyn7fh0: BIOFERT_GRAN, // Complete Plant Food tablets
  cmt35z97800b4qqdiwsaro6ui: BIOFERT_GRAN,
  cmt35zucs00dlqqdiihm6qu08: BIOFERT_GRAN, // Rose Special capsule
  cmt36017r00ehqqdilg0sl7hk: BIOFERT_GRAN, // Tulsi Special capsule
  cmt39awnn00dii5diyjo3iirx: BIOFERT_LIQ, // Geolife Vigore Pulses Special
  cmt30w0fz006krfdixu2w6ags: BIOFERT_POWDER, // Itarich Mycorrhiza (Powder)
  cmt35ywfu009xqqdiir495drx: BIOFERT_POWDER,
  cmt35x124001rqqdi1kwcsu61: BIO_VIRUCIDE, // K-Lysorus+Activator (anti-virus & bacteria enzyme)
  cmt30wiyh008qrfdiglreades: BIO_VIRUCIDE,
  cmt35zi8q00caqqditavvgbpg: BIOFERT_POWDER, // Azospirillum (Powder)
  cmt30x62q00axrfdicg2mqehy: BIOFERT_POWDER,
  cmt30y69x00eprfdi0xmgd0f1: BIOFERT_POWDER, // Azotobacter (Powder)
  cmt35zxx400e2qqdi8qpdtg8y: BIOFERT_POWDER,
  cmt36380q00noqqdiq27c3fws: PGR_PROMOTOR, // Growth Promoter+Flower+Fruit combo
  cmt311rhb00qbrfdiq26kfx4e: PGR_PROMOTOR,
  cmt30xx6m00dwrfdi87oxg0sr: BIOFERT_POWDER, // Rhizobium (Powder)
  cmt36068100ewqqdi7kjw27fl: BIOFERT_POWDER,
  cmt361u5b00kbqqdid9syuv8o: BIOFERT_LIQ, // Acetobacter (Liquid)
  cmt30zs6k00k0rfdikd78bp6f: BIOFERT_LIQ,
  cmt36297c00lfqqdi9h1m0v3z: BIOFERT_POWDER, // Acetobacter (Powder)
  cmt30zfru00itrfdiu2l9xotp: BIOFERT_POWDER,
  cmt30zuuv00kcrfdiz520cm5o: BIOFERT_LIQ, // Azospirillum (Liquid)
  cmt361rq800k2qqdi9e7thfyx: BIOFERT_LIQ,
  cmt30zxhn00korfdildvu1wq1: BIOFERT_LIQ, // Azotobacter (Liquid)
  cmt361p0o00jtqqdiqs0nr0la: BIOFERT_LIQ,
  cmt30z4cn00i5rfdisr8qev9m: BIOFERT_POWDER, // Carrier Based Consorita
  cmt362lhm00lxqqdiusw3wbcc: BIOFERT_POWDER,
  cmt3622q000l2qqdi2o81ft8y: BIOFERT_LIQ, // Liquid Based Consorita
  cmt30zjpg00j1rfdizlbr7sp3: BIOFERT_LIQ,
  cmt30zc5t00ilrfdi4fufs191: BIOFERT_POWDER, // Potassium Mobilizing (Powder)
  cmt30zpfi00jorfdixk1cvt2e: BIOFERT_LIQ, // Potassium Mobilizing (Liquid)
  cmt361wx300kkqqdit0uozzcx: BIOFERT_LIQ,
  cmt362d4e00llqqdinykltqn4: BIOFERT_POWDER,
  cmt361mih00jkqqdi0talv91h: BIOFERT_LIQ, // Rhizobium (Liquid)
  cmt31004600l0rfdi6lp8gcjg: BIOFERT_LIQ,
  cmt361zs700ktqqdi4flf46tf: BIOFERT_LIQ, // Zinc Solubilizing (Liquid)
  cmt30zmo100jcrfdiyez7rkd2: BIOFERT_LIQ,
  cmt30z8f200idrfdin2g6h9ay: BIOFERT_POWDER, // Zinc Solubilizing (Powder)
  cmt362h9l00lrqqdihulwkfu5: BIOFERT_POWDER,
  cmt311qqm00q5rfdir6632qrh: BIOFERT_GRAN, // Kosabi Organic Manure
  cmt35ykyh0098qqdi5qam2ta2: BIOFERT_GRAN,
  cmt35wvkh000pqqdi8p9qngwy: BIOFERT_GRAN, // Mycorrhiza Granule
  cmt311pw900pvrfdicsk6pxa5: BIOFERT_GRAN,
  cmt3byh3p003qwodic4ng3fz4: BIOFERT_LIQ, // Titan BIO NPK Liquid
  cmt3byj330044wodi6rrfnqwt: LIQ_FERT, // Titan UAN (chemical N fertiliser, not bio)
  cmt39axo200dti5dik9xhfqeg: BIOFERT_LIQ, // Vigore Cereals Special
  cmt39avnu00d4i5dixc2mqojm: BIOFERT_LIQ, // Vigore Fruits & Vegetables Special

  // --- old "Micro Nutrients" bucket (51) ---
  cmt38dx9f001trldikj6ejvzm: MICRO_POWDER, // ARIES SARVOTTAM
  cmt35xcea003gqqdixv9ij07h: MICRO_LIQ, // Atal (Boron)
  cmt30uqk2000hrfdi0206hoqz: MICRO_LIQ,
  cmt360uog00i2qqdilfdohhjg: MICRO_SUSP, // Calcium Nitrate+Mg (Suspension)
  cmt310o1t00mmrfdivzyzb7no: MICRO_SUSP,
  cmt35z68v00auqqdixai2mjlf: MICRO_LIQ, // Classic Liquid Calcium
  cmt30yhw000gjrfdiby2en7bc: MICRO_LIQ,
  cmt39ayod00e4i5difev7qfw9: MICRO_POWDER, // Full Meal Grow
  cmt398mhu0000i5dix0xi0n10: MICRO_POWDER, // Balance Nano Flower & Fruit Drop Protector
  cmt398p620008i5dizrk1sqdd: MICRO_POWDER, // Balance Nutri Multi Micro Nutrient
  cmt398rxe000ei5di0exkqpvo: MICRO_POWDER, // Carbon Stones
  cmt398tqv000ii5dimmrxw4xf: MICRO_POWDER, // Flowering Kit 51gm
  cmt3991230018i5dibve5lnh3: MICRO_POWDER, // Growth Kit (Vigore+Tabsil)
  cmt399e2r002ii5dirvyyaewq: MICRO_LIQ, // Natural Cab Anti Cracking (Ca+B nano)
  cmt3993ik001ci5dibyvrm8bt: MICRO_POWDER, // Nutri Combi Zn+Mn+Cu
  cmt399fdp002xi5dioj675e13: MICRO_POWDER, // Single Nutrient Nano FE (powder)
  cmt39965n001oi5di6i6l95bo: MICRO_EDTA, // Single Nutrient Nano Mg (EDTA)
  cmt3998r90020i5dieplxsw5u: MICRO_EDTA, // Single Nutrient Nano Mn (EDTA)
  cmt399gav0039i5di7a0joo6s: MICRO_EDTA, // Single Nutrient Nano Zn (chelate)
  cmt39akzh009ii5dio5u335gf: MICRO_GRAN, // Tabsil effervescent tablets
  cmt39aq0c00byi5diapk7uc59: MICRO_LIQ, // Vigore Fruit Special
  cmt399bdt002ci5ditnp1wxhf: MICRO_POWDER, // nano vigore Flower Booster 1gm
  cmt39b1ay00e9i5die915kdg7: BIOFERT_POWDER, // Golden Harvest (mycorrhiza)
  cmt310v7g00o1rfdil1fkikxo: MICRO_LIQ, // Chelated Boron Glycin Liquid
  cmt360lbo00gzqqdislj0qucc: MICRO_LIQ,
  cmt310xxg00oirfdifw7pig7b: MICRO_LIQ, // Chelated Calcium Glycin Liquid
  cmt360iqv00gmqqdi9jjmls0w: MICRO_LIQ,
  cmt35zet400buqqdidxo8nfg1: MICRO_EDTA, // Chelated Fe EDTA 12%
  cmt30yfwg00g9rfdiqz9a2mbj: MICRO_EDTA,
  cmt360f6z00g9qqdivaull8v2: MICRO_LIQ, // Chelated Zinc Glycin Liquid
  cmt310znz00ozrfdindrbdanm: MICRO_LIQ,
  cmt30x3dw00aorfdiqbxlt3me: MICRO_EDTA, // Chelated zinc EDTA 12%
  cmt35zd9w00bmqqdi4paxzogp: MICRO_EDTA,
  cmt30x1g000agrfdivleczd9r: MICRO_POWDER, // Magnesium sulphate 9.5%
  cmt35zc3p00bfqqdiyu3vp8zx: MICRO_POWDER,
  cmt3axu6d00au6qdi7be43f07: BIOFERT_POWDER, // MYCORIS Premium VAM Mycorrhiza
  cmt3axr0n00ai6qdidwoij0tg: BIOFERT_POWDER, // MYCORIS VAM Mycorrhiza
  cmt38elv6002wrldicfoo7max: MICRO_POWDER, // Mobomin
  cmt35zgqz00c2qqdih1dicsvi: MICRO_POWDER, // NANO Micro Nutrient Combi
  cmt3bcab5008goedieloptbz2: MICRO_POWDER, // Paidavaar CALRON Ca(NO3)+B
  cmt3bdlsf00cooedidy1rfalu: MICRO_POWDER, // Paidavaar Hyzinc ZnSO4
  cmt3bct4200a8oedizmzj24v4: MICRO_POWDER, // Paidavaar Zinc Sulphate 33%
  cmt3bcg3t008soediy3v0cc4r: MICRO_POWDER, // Paidavaar Zinc-High Multi
  cmt3c0dc300h5wodiwl5di94v: MICRO_LIQ, // Titan Chelated Boron Glycine
  cmt3c09yz00g5wodil23ewjje: MICRO_LIQ, // Titan Boron Ethanolamine 10%
  cmt3c0c1i00gqwodixoin015h: MICRO_SUSP, // Titan Calcium Oxide 11% SC
  cmt3c0exf00hcwodiis6ehbco: MICRO_LIQ, // Titan Chelated Calcium Glycine
  cmt3c0giq00hjwodi6x659kdj: MICRO_LIQ, // Titan Chelated Zinc Glycine
  cmt3c0hnx00hqwodib624fgp5: MICRO_SUSP, // Titan Zinc Oxide 39.5% SC
  cmt35y6qc006nqqdixxsbvbww: MICRO_SUSP, // Zincotac Zinc Oxide Suspension SC
  cmt30vkdm004grfdiulwew0e1: MICRO_SUSP,

  // --- old "Bio Stimulants/Activators" bucket (45) ---
  cmt35zmhw00cxqqdih831neov: VITAMINS, // Prosper Anti Fungal (vitamin based)
  cmt38dsv6001jrldimq9f2x5y: BOTANICAL, // ARIES BHUSATVA (seaweed extract)
  cmt35yj84008rqqdi86wz35xj: BOTANICAL, // Bio-Ringa (Moringa)
  cmt39b27m00egi5divh3aupj2: HUMIC, // Bold (humic & fulvic)
  cmt39asux00cai5diccbswrnw: CELLFREE, // Geolife Balance Flower (enzymes)
  cmt39amhq00a7i5dif9mko2gj: BIOFERT_POWDER, // Geolife Vigore Zinc Solubilizing Bacteria
  cmt3agrdg004c4zdi7tvvmxu4: AMINO, // Hifield Amibion Protein Hydrolysate
  cmt3agogr003y4zdi9t0wnz79: AMINO, // Hifield Amipro 30
  cmt3ah6xc006g4zdimji6ga3z: BOTANICAL, // Hifield Asco zyme (seaweed)
  cmt3ah3rh00624zdir91r8by3: AMINO, // Hifield Bacto Boom AminoBoost
  cmt3afyib00254zdi181oe3mh: HUMIC, // Hifield Black Dragon (humic & fulvic)
  cmt3agij7003e4zdi8lj6xwwz: HUMIC, // Hifield Cura Vita (humic+amino+vitamin)
  cmt3agxgs00544zdi1h96ssxe: AMINO, // Hifield Gabbar Gluco-Amino
  cmt3aglgp003q4zdi2w6ry4n5: HUMIC, // Hifield Humi Pro 50
  cmt3afs5p001q4zdi9rkyoy21: HUMIC, // Hifield Humi Pro Flexx 98
  cmt3aezvl00004zdizhp2z0nk: HUMIC, // Hifield Humi Pro-12
  cmt3af8vt000i4zdii9f3he2m: HUMIC, // Hifield Humi pro-15
  cmt3ahcz4007a4zdimtomtjso: BOTANICAL, // Hifield Kappa Rezi (seaweed)
  cmt3agfjl00354zdilovikwpz: HUMIC, // Hifield Karbon Rich (potassium humate)
  cmt3ag7at002n4zdifjn8czo5: HUMIC, // Hifield Leonardo (humic & fulvic 76%)
  cmt3ah0fi005m4zdiuux36bsh: AMINO, // Hifield Nutri Quik Protein Hydrolysate
  cmt3ah9rj006u4zdijsza5tlh: HUMIC, // Hifield Scuba SP (humic acid 80%)
  cmt3afnon001f4zdi47jwt1mh: HUMIC, // Humi Pro 15000 Granules
  cmt3aff2b00104zdi14ik4ig3: HUMIC, // Humi Pro 95 WSG
  cmt35ym1m009eqqdiv488qzeg: HUMIC, // Humus-100 (Royal Traders)
  cmt30wu9a00a2rfdiwctigdpm: HUMIC, // Humus-100 (Katra)
  cmt35zspa00dcqqdi52a5jo5f: HUMIC, // Organic Carbon 40% (Royal)
  cmt30xftp00bxrfdif0q2d6xy: HUMIC, // Organic Carbon 40% (Katra)
  cmt3by7nw001mwodice2coce0: BOTANICAL, // TAL Sonja Gold Seaweed
  cmt39b4b800f6i5di8is7g3nd: BOTANICAL, // Takat (seaweed/amino/humic/vitamin combo)
  cmt3bymmk004pwodihcrxx7w4: AMINO, // Titan Aminofert-MMF
  cmt3byo41004xwodihf4op5t9: MICRO_POWDER, // Titan Boron Amino Acid Chelate
  cmt3bypdv0054wodiba4q8ct1: MICRO_POWDER, // Titan Calcium Amino Acid Chelate
  cmt3byrdc005dwodiav6a1pgp: MICRO_POWDER, // Titan Calcium Boron Amino Acid Chelate
  cmt3byuos005owodi6zsyhp87: MICRO_POWDER, // Titan Copper Amino Acid Chelate
  cmt3bz41f006vwodi7zzocton: BIOFERT_POWDER, // Titan Crop Tiger organic fertilizer
  cmt3bywz8005ywodib12kzkz5: MICRO_POWDER, // Titan Ferrous Amino Acid Chelate
  cmt3byy4d0065wodi46g5k3pf: MICRO_POWDER, // Titan Magnesium Amino Acid Chelate
  cmt3bz0gv006fwodiozcw1gt9: MICRO_POWDER, // Titan Manganese Amino Acid Chelate
  cmt3bz70j0079wodi670u8il1: AMINO, // Titan Nano Aminofert Gold Liquid
  cmt3bz8c6007swodie9tgjh8p: HUMIC, // Titan Potassium Humate 98%
  cmt3bza9q0085wodipbrnw6w0: HUMIC, // Titan Potassium Humate Liquid 20%
  cmt3bzbix008kwodi202502x3: BOTANICAL, // Titan Seaweed Liquid 20%
  cmt3bz1o8006mwodijt050342: MICRO_POWDER, // Titan Zinc Amino Acid Chelate
  cmt3agud5004q4zdi4ssaf5yn: BOTANICAL, // Toofan (seaweed/humic/amino combo)

  // --- old "Adjuvants" bucket (4) ---
  cmt3aux2a00266qdisao0c8y4: SILICON_SPREADER, // Kay Bee Balanstick
  cmt35xehp003xqqdiwd7ubh64: SURFACTANT, // Silicate -Silicon Surfectant
  cmt30uvzz001srfdifmglo58l: SURFACTANT,
  cmt3byfqw0037wodi6vghgsu5: SILICON_SPREADER, // Titan Agritech Silicone Spreader

  // --- old "Safety Kit" (1) -- NOT actually a safety kit (pain relief oil),
  // no matching leaf exists anywhere in the new taxonomy; closest reasonable
  // home is spray-pump accessories. Flagged for manual review in the report.
  cmt311ngo00pprfdio4rl3nz2: SPRAY_ACCESSORIES,

  // --- old "Implements" > sprayer nozzle accessories (2) ---
  cmt35xnr8004vqqdi0kfe558f: SPRAY_ACCESSORIES,
  cmt30ujae0008rfdivodh5219: SPRAY_ACCESSORIES,

  // --- draft-placeholder test product: left untouched on purpose ---
  // cmtgwgeqg0002ardif0gigmgd "Test Admin Orders Product..." is test data,
  // not a real catalogue item -- intentionally NOT in this map.
};

const UNTOUCHED_PRODUCT_IDS = new Set(["cmtgwgeqg0002ardif0gigmgd"]);

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const products = await prisma.product.findMany({
    select: {
      id: true,
      sku: true,
      name: true,
      category: { select: { slug: true } },
      subCategory: { select: { name: true } },
      subSubCategory: { select: { name: true } },
    },
  });

  type Resolved = { productId: string; sku: string; name: string; target: Target | null; reason: string };
  const resolved: Resolved[] = [];
  const unresolved: { id: string; sku: string; name: string; oldSubSub: string | null }[] = [];

  for (const p of products) {
    if (UNTOUCHED_PRODUCT_IDS.has(p.id)) continue;
    if (p.category?.slug === PLACEHOLDER_CATEGORY_SLUG && !PRODUCT_OVERRIDES[p.id]) {
      // any other placeholder-parked product with no override: leave as-is
      continue;
    }
    const override = PRODUCT_OVERRIDES[p.id];
    if (override) {
      resolved.push({ productId: p.id, sku: p.sku, name: p.name, target: override, reason: "override" });
      continue;
    }
    const direct = p.subSubCategory?.name ? DIRECT_SUBSUBCATEGORY_MAP[p.subSubCategory.name] : undefined;
    if (direct) {
      resolved.push({ productId: p.id, sku: p.sku, name: p.name, target: direct, reason: "direct" });
      continue;
    }
    unresolved.push({ id: p.id, sku: p.sku, name: p.name, oldSubSub: p.subSubCategory?.name ?? null });
  }

  const overrideCount = Object.keys(PRODUCT_OVERRIDES).length;
  console.log(`Products total: ${products.length}`);
  console.log(`Resolved: ${resolved.length} (overrides: ${overrideCount}, direct: ${resolved.length - overrideCount})`);
  console.log(`Untouched (placeholder/test): ${products.length - resolved.length - unresolved.length}`);

  let bad = false;
  if (unresolved.length > 0) {
    console.log(`UNRESOLVED (${unresolved.length}) -- fix the mapping first:`);
    for (const u of unresolved) console.log(`  ${u.id} | ${u.oldSubSub} | ${u.name}`);
    bad = true;
  }
  if (overrideCount !== 208) {
    console.log(`Expected exactly 208 override entries, found ${overrideCount} -- a duplicate key silently dropped one.`);
    bad = true;
  }
  if (bad) process.exit(1);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    `${OUT_DIR}category-overhaul-plan.json`,
    JSON.stringify({ resolved, unresolved }, null, 2),
  );

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to write changes.");
    console.log(`Plan written to ${OUT_DIR}category-overhaul-plan.json`);
    await prisma.$disconnect();
    return;
  }

  // Full pre-change snapshot for rollback reference (in addition to the pg_dump
  // taken by the operator before running with --apply).
  const beforeCategories = await prisma.category.findMany({
    include: { subCategories: { include: { subSubCategories: true } } },
  });
  const beforeProducts = await prisma.product.findMany({
    select: { id: true, sku: true, categoryId: true, subCategoryId: true, subSubCategoryId: true },
  });
  writeFileSync(
    `${OUT_DIR}category-overhaul-backup.json`,
    JSON.stringify({ categories: beforeCategories, products: beforeProducts }, null, 2),
  );

  await prisma.$transaction(
    async (tx) => {
      // 0) Free up slugs: several new leaf/subcategory names are identical
      // to the old ones they replace (e.g. "Insecticides"), and slug is
      // globally unique. Rename every OLD Subcategory/SubSubCategory slug
      // out of the way first (ids are unchanged, so nothing that references
      // them by id is affected) -- they're deleted later in this same
      // transaction anyway.
      const oldSubs = await tx.subcategory.findMany({ select: { id: true } });
      for (const s of oldSubs) {
        await tx.subcategory.update({ where: { id: s.id }, data: { slug: `old-${s.id}` } });
      }
      const oldLeaves = await tx.subSubCategory.findMany({ select: { id: true } });
      for (const l of oldLeaves) {
        await tx.subSubCategory.update({ where: { id: l.id }, data: { slug: `old-${l.id}` } });
      }

      // 1) Upsert the 6 top-level categories (update in place where an
      // existing row survives, so PromotionalAsset/MerchandisingCollection
      // FKs referencing them keep working).
      const categoryIdByName: Record<string, string> = {};
      for (let i = 0; i < TAXONOMY.length; i++) {
        const cat = TAXONOMY[i];
        if (cat.keepSlug) {
          const existing = await tx.category.findUnique({ where: { slug: cat.keepSlug } });
          if (!existing) throw new Error(`Expected existing category with slug ${cat.keepSlug}`);
          const updated = await tx.category.update({
            where: { id: existing.id },
            data: { name: cat.name, slug: cat.slug, emoji: cat.emoji, position: i + 1, isActive: true },
          });
          categoryIdByName[cat.name] = updated.id;
        } else {
          const created = await tx.category.create({
            data: { name: cat.name, slug: cat.slug, emoji: cat.emoji, position: i + 1, isActive: true },
          });
          categoryIdByName[cat.name] = created.id;
        }
      }

      // 2) Create the fresh subcategory/sub-subcategory tree.
      const subCategoryIdByName: Record<string, string> = {};
      const subSubCategoryIdByName: Record<string, string> = {};
      for (const cat of TAXONOMY) {
        const categoryId = categoryIdByName[cat.name];
        for (let si = 0; si < cat.subs.length; si++) {
          const sub = cat.subs[si];
          const createdSub = await tx.subcategory.create({
            data: { name: sub.name, slug: sub.slug, categoryId, position: si + 1, isActive: true },
          });
          subCategoryIdByName[sub.name] = createdSub.id;
          for (let li = 0; li < sub.leaves.length; li++) {
            const leaf = sub.leaves[li];
            const createdLeaf = await tx.subSubCategory.create({
              data: {
                name: leaf.name,
                slug: leaf.slug,
                subCategoryId: createdSub.id,
                position: li + 1,
                isActive: true,
              },
            });
            subSubCategoryIdByName[leaf.name] = createdLeaf.id;
          }
        }
      }

      // 3) Repoint every resolved product BEFORE deleting anything old.
      for (const r of resolved) {
        const [catName, subName, leafName] = r.target!;
        await tx.product.update({
          where: { id: r.productId },
          data: {
            categoryId: categoryIdByName[catName],
            subCategoryId: subCategoryIdByName[subName] ?? null,
            subSubCategoryId: leafName ? subSubCategoryIdByName[leafName] : null,
          },
        });
      }

      // 4) Detach (don't delete) PromotionalAssets pointing at the doomed
      // "Seeds" category.
      const seeds = await tx.category.findUnique({ where: { slug: "seeds" } });
      if (seeds) {
        await tx.promotionalAsset.updateMany({
          where: { categoryId: seeds.id },
          data: { categoryId: null },
        });
      }

      // 5) Delete every OLD subcategory/sub-subcategory row (translations
      // cascade). None of them are referenced by any product any more
      // (step 3 already repointed all of them), so this is safe.
      const survivingSubIds = new Set(Object.values(subCategoryIdByName));
      const survivingLeafIds = new Set(Object.values(subSubCategoryIdByName));
      await tx.subSubCategory.deleteMany({ where: { id: { notIn: [...survivingLeafIds] } } });
      await tx.subcategory.deleteMany({ where: { id: { notIn: [...survivingSubIds] } } });

      // 6) Delete the old "Seeds" category itself (placeholder is untouched;
      // the 5 renamed/updated categories are kept via keepSlug above).
      for (const slug of DELETED_CATEGORY_SLUGS) {
        await tx.category.deleteMany({ where: { slug } });
      }
    },
    { timeout: 60_000 },
  );

  console.log("Applied. Hit apps/web's /api/revalidate-homepage (or restart kisan4u-web) to bust the 300s category-ribbon cache.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
