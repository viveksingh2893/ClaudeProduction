import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * One-shot: tag every real product with the crops it's for and (for Crop
 * Protection products) the pests/diseases it targets.
 *
 * Defaults, per the owner's steer ("most products are usable in all crops,
 * most crop-protection products are for all pests"):
 *   - Crops   : ALL crops, unless the name/description explicitly names >=2
 *               specific crops, in which case just those.
 *   - Pests   : only for Crop Protection products. A base set by
 *               sub-subcategory (insecticide -> insect pests, fungicide ->
 *               diseases, viricide -> virus, herbicide/adjuvant -> none),
 *               narrowed to the specific pests/diseases named when the text
 *               names >=2 of them. Non-crop-protection products get only
 *               pests/diseases explicitly named in their text (usually none).
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// pattern (lowercased substring / word) -> canonical Crop name. Longer / more
// specific patterns first so "corn" doesn't shadow nothing, etc.
const CROP_SYNONYMS: [RegExp, string][] = [
  [/\bpaddy\b|\brice\b/, "Paddy (Rice)"],
  [/\bwheat\b/, "Wheat"],
  [/\bmaize\b|\bcorn\b/, "Maize"],
  [/\bcotton\b/, "Cotton"],
  [/\bsugar\s?cane\b/, "Sugarcane"],
  [/\bsoy\s?bean\b|\bsoya\b/, "Soybean"],
  [/\bground\s?nut\b|\bpeanut\b/, "Groundnut"],
  [/\bmustard\b|\brapeseed\b/, "Mustard"],
  [/\bchill?i(es)?\b|\bcapsicum\b/, "Chilli"],
  [/\btomato(es)?\b/, "Tomato"],
  [/\bonion\b/, "Onion"],
  [/\bpotato(es)?\b/, "Potato"],
  [/\bbrinjal\b|\beggplant\b|\baubergine\b/, "Brinjal"],
  [/\bokra\b|\bbhindi\b|\blady\s?finger\b/, "Okra (Bhindi)"],
  [/\bcabbage\b/, "Cabbage"],
  [/\bcauliflower\b/, "Cauliflower"],
  [/\bbanana\b/, "Banana"],
  [/\bmango(es)?\b/, "Mango"],
  [/\bgrapes?\b/, "Grapes"],
  [/\bpomegranate\b/, "Pomegranate"],
  [/\bturmeric\b/, "Turmeric"],
  [/\bgram\b|\bchana\b|\bchick\s?pea\b|\bbengal gram\b/, "Gram (Chana)"],
];

const PEST_SYNONYMS: [RegExp, string][] = [
  [/\bpink boll\s?worm\b/, "Pink Bollworm"],
  [/\bboll\s?worm\b/, "Bollworm"],
  [/\bsheath blight\b/, "Sheath Blight"],
  [/\bstem borer\b/, "Stem Borer"],
  [/\bfruit borer\b|\bshoot borer\b|\bpod borer\b/, "Fruit Borer"],
  [/\barmy\s?worm\b/, "Fall Armyworm"],
  [/\bbrown plant\s?hopper\b|\bplant\s?hopper\b|\bbph\b/, "Brown Plant Hopper"],
  [/\bjassid(s)?\b|\bleaf\s?hopper\b/, "Jassids (Leafhopper)"],
  [/\baphid(s)?\b/, "Aphids"],
  [/\bwhite\s?fly\b/, "Whitefly"],
  [/\bthrips?\b/, "Thrips"],
  [/\bmealy\s?bug\b/, "Mealybug"],
  [/\bspider mite\b|\bred mite\b|\bmites?\b/, "Red Spider Mite"],
  [/\bleaf curl\b|\bcurl virus\b|\btolcv\b|\bgemini\s?virus\b/, "Leaf Curl Virus"],
  [/\bpowdery mildew\b/, "Powdery Mildew"],
  [/\bdowny mildew\b/, "Downy Mildew"],
  [/\bblast\b/, "Blast"],
  [/\bblight\b/, "Blight"],
  [/\brust\b/, "Rust"],
  [/\bwilt\b/, "Wilt"],
  [/\broot rot\b|\bdamping[- ]?off\b|\bcollar rot\b/, "Root Rot"],
  [/\banthracnose\b/, "Anthracnose"],
];

const INSECT_SET = [
  "Aphids",
  "Whitefly",
  "Thrips",
  "Jassids (Leafhopper)",
  "Bollworm",
  "Stem Borer",
  "Fruit Borer",
  "Fall Armyworm",
  "Mealybug",
  "Red Spider Mite",
  "Brown Plant Hopper",
  "Pink Bollworm",
];
const DISEASE_SET = [
  "Powdery Mildew",
  "Downy Mildew",
  "Blast",
  "Blight",
  "Rust",
  "Wilt",
  "Root Rot",
  "Anthracnose",
  "Sheath Blight",
];

function basePestSet(subSubName: string | null): string[] {
  switch (subSubName) {
    case "Insecticides":
    case "Bio Insecticides":
      return INSECT_SET;
    case "Miticides/Acaricides":
    case "Bio Miticides/Acaricides":
      return ["Red Spider Mite"];
    case "Fungicides":
    case "Bio Fungicides":
      return DISEASE_SET;
    case "Bactericides":
      return ["Blight", "Wilt", "Root Rot"];
    case "Bio Viricides":
      return ["Leaf Curl Virus"];
    default:
      return []; // Herbicides, Bio Nematicides, Adjuvants/Others, …
  }
}

function matchAll(text: string, syns: [RegExp, string][]): Set<string> {
  const out = new Set<string>();
  for (const [re, name] of syns) if (re.test(text)) out.add(name);
  return out;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const crops = await prisma.crop.findMany({ select: { id: true, name: true } });
  const pests = await prisma.pestDisease.findMany({ select: { id: true, name: true } });
  const cropId = new Map(crops.map((c) => [c.name, c.id]));
  const pestId = new Map(pests.map((p) => [p.name, p.id]));
  const ALL_CROP_IDS = crops.map((c) => c.id);

  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      shortDescription: true,
      description: true,
      category: { select: { slug: true } },
      subSubCategory: { select: { name: true } },
    },
  });

  let taggedCrops = 0;
  let taggedPests = 0;
  let allCrops = 0;
  const samples: string[] = [];

  for (const p of products) {
    if (p.name.startsWith("Test ")) continue;
    const text = `${p.name} ${p.shortDescription ?? ""} ${p.description ?? ""}`
      .toLowerCase()
      .replace(/<[^>]+>/g, " ");

    // --- crops ---
    const cropHits = matchAll(text, CROP_SYNONYMS);
    const cropIds =
      cropHits.size >= 2
        ? [...cropHits].map((n) => cropId.get(n)!).filter(Boolean)
        : ALL_CROP_IDS;
    if (cropHits.size < 2) allCrops++;

    // --- pests ---
    // A handful of growth-regulator / nutrition products are mis-filed under
    // Crop Protection in the legacy data — don't hand them a pest list just
    // because of that. Only their explicitly-named pests (usually none).
    const notReallyAPesticide =
      /gibberell|paclobutrazol|\bnaa\b|growth regulator|growth promoter|plant growth|bio[- ]?stimulant|\bhumic\b|sea\s?weed|fertiliz|fertilis|\bnpk\b|micro\s?nutrient|yield enhancer|fruit size/.test(
        text,
      );
    const isProtection = p.category?.slug === "crop-protection" && !notReallyAPesticide;
    const pestHits = matchAll(text, PEST_SYNONYMS);
    let pestNames: string[];
    if (isProtection) {
      const base = basePestSet(p.subSubCategory?.name ?? null);
      pestNames = pestHits.size >= 2 ? [...pestHits] : base;
    } else {
      pestNames = [...pestHits];
    }
    const pestIds = pestNames.map((n) => pestId.get(n)!).filter(Boolean);

    if (cropIds.length) taggedCrops++;
    if (pestIds.length) taggedPests++;

    if (samples.length < 25) {
      samples.push(
        `${p.name.slice(0, 60)}  ·  crops: ${
          cropHits.size >= 2 ? [...cropHits].join(", ") : "ALL"
        }  ·  pests: ${pestNames.length ? pestNames.join(", ") : "—"}`,
      );
    }

    if (!dryRun) {
      await prisma.product.update({
        where: { id: p.id },
        data: {
          crops: { set: cropIds.map((id) => ({ id })) },
          pestsDiseases: { set: pestIds.map((id) => ({ id })) },
        },
      });
    }
  }

  console.log(`Products processed: ${products.filter((p) => !p.name.startsWith("Test ")).length}`);
  console.log(`Tagged with crops: ${taggedCrops} (of which "all crops": ${allCrops})`);
  console.log(`Tagged with pests/diseases: ${taggedPests}`);
  console.log("--- sample (first 25) ---\n" + samples.join("\n"));
  if (dryRun) console.log("\n(dry-run — nothing written)");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
