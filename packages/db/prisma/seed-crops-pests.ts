import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * One-off, idempotent seed for the Homepage redesign phase B "Shop by
 * Crop" / "Shop by Pest & Disease" strips — a genuine starter set of the
 * crops and pest/disease problems an Indian agri-input catalogue actually
 * sells for. Each carries an emoji placeholder (the storefront shows it
 * until an admin uploads a real image under /admin/crops or /admin/pests).
 * Upserts by slug, so re-running only fills gaps and never disturbs an
 * admin's later edits to name/emoji/image/position/isActive.
 */
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

const CROPS: Array<{ name: string; emoji: string }> = [
  { name: "Paddy (Rice)", emoji: "🌾" },
  { name: "Wheat", emoji: "🌿" },
  { name: "Maize", emoji: "🌽" },
  { name: "Cotton", emoji: "🧵" },
  { name: "Sugarcane", emoji: "🎋" },
  { name: "Soybean", emoji: "🫘" },
  { name: "Groundnut", emoji: "🥜" },
  { name: "Mustard", emoji: "🌼" },
  { name: "Chilli", emoji: "🌶️" },
  { name: "Tomato", emoji: "🍅" },
  { name: "Onion", emoji: "🧅" },
  { name: "Potato", emoji: "🥔" },
  { name: "Brinjal", emoji: "🍆" },
  { name: "Okra (Bhindi)", emoji: "🌱" },
  { name: "Cabbage", emoji: "🥬" },
  { name: "Cauliflower", emoji: "🥦" },
  { name: "Banana", emoji: "🍌" },
  { name: "Mango", emoji: "🥭" },
  { name: "Grapes", emoji: "🍇" },
  { name: "Pomegranate", emoji: "🔴" },
  { name: "Turmeric", emoji: "🟡" },
  { name: "Gram (Chana)", emoji: "🫛" },
];

const PESTS: Array<{ name: string; emoji: string }> = [
  { name: "Aphids", emoji: "🦟" },
  { name: "Whitefly", emoji: "🪰" },
  { name: "Thrips", emoji: "🐜" },
  { name: "Jassids (Leafhopper)", emoji: "🦗" },
  { name: "Bollworm", emoji: "🐛" },
  { name: "Stem Borer", emoji: "🪱" },
  { name: "Fruit Borer", emoji: "🐛" },
  { name: "Fall Armyworm", emoji: "🐛" },
  { name: "Mealybug", emoji: "🐞" },
  { name: "Red Spider Mite", emoji: "🕷️" },
  { name: "Brown Plant Hopper", emoji: "🦗" },
  { name: "Pink Bollworm", emoji: "🐛" },
  { name: "Leaf Curl Virus", emoji: "🍂" },
  { name: "Powdery Mildew", emoji: "⚪" },
  { name: "Downy Mildew", emoji: "🌫️" },
  { name: "Blast", emoji: "💥" },
  { name: "Blight", emoji: "🍁" },
  { name: "Rust", emoji: "🟤" },
  { name: "Wilt", emoji: "🥀" },
  { name: "Root Rot", emoji: "🪵" },
  { name: "Anthracnose", emoji: "🟠" },
  { name: "Sheath Blight", emoji: "🌾" },
];

async function main() {
  let cropCreated = 0;
  for (const [i, c] of CROPS.entries()) {
    const slug = slugify(c.name);
    const existing = await prisma.crop.findUnique({ where: { slug } });
    if (existing) continue;
    await prisma.crop.create({
      data: { name: c.name, slug, emoji: c.emoji, position: i + 1 },
    });
    cropCreated++;
  }

  let pestCreated = 0;
  for (const [i, p] of PESTS.entries()) {
    const slug = slugify(p.name);
    const existing = await prisma.pestDisease.findUnique({ where: { slug } });
    if (existing) continue;
    await prisma.pestDisease.create({
      data: { name: p.name, slug, emoji: p.emoji, position: i + 1 },
    });
    pestCreated++;
  }

  const cropTotal = await prisma.crop.count();
  const pestTotal = await prisma.pestDisease.count();
  console.log(`Crops: created ${cropCreated} this run, ${cropTotal} total.`);
  console.log(`Pests & diseases: created ${pestCreated} this run, ${pestTotal} total.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
