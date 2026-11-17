import "dotenv/config";
import { PrismaClient, type Language } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * One-off / repeatable bulk translator for existing product descriptions
 * (storefront i18n).
 *
 * For every APPROVED product it fills in the four non-English
 * ProductTranslation rows (Hindi, Marathi, Telugu, Tamil) by asking an LLM
 * to translate the six rich-text fields — `shortDescription`,
 * `description`, `ingredients`, `howToUse`, `dosageInstructions`,
 * `technicalInfo` — while preserving the HTML tags and leaving chemical
 * names, active-ingredient percentages, brand names and numbers untouched.
 *
 * Idempotent: a (product, language) pair that already has a translation
 * row is skipped unless --force is passed, so it is safe to re-run after a
 * failure or to top up newly added products.
 *
 *   ANTHROPIC_API_KEY=sk-...  pnpm --filter @kisan4u/db exec \
 *     tsx prisma/translate-product-descriptions.ts [flags]
 *
 * Flags:
 *   --lang=hi,mr        only these languages (default: hi,mr,te,ta)
 *   --limit=50          stop after N products
 *   --product=<id>      only this product id (repeatable)
 *   --force             retranslate even if a row already exists
 *   --dry-run           call the model but do not write to the DB
 *
 * Env:
 *   ANTHROPIC_API_KEY   required
 *   ANTHROPIC_MODEL     default "claude-sonnet-4-5" — set to whatever
 *                       current model your account has access to
 *   ANTHROPIC_BASE_URL  default "https://api.anthropic.com"
 */

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
const BASE_URL = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";

const LANGUAGE_NAMES: Record<Exclude<Language, "EN">, string> = {
  HI: "Hindi",
  MR: "Marathi",
  TE: "Telugu",
  TA: "Tamil",
};

const FIELDS = [
  "shortDescription",
  "description",
  "ingredients",
  "howToUse",
  "dosageInstructions",
  "technicalInfo",
] as const;
type Field = (typeof FIELDS)[number];

type Args = {
  langs: Exclude<Language, "EN">[];
  limit: number | null;
  productIds: string[];
  force: boolean;
  dryRun: boolean;
};

function parseArgs(): Args {
  const langs: Exclude<Language, "EN">[] = [];
  const productIds: string[] = [];
  let limit: number | null = null;
  let force = false;
  let dryRun = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--force") force = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--limit=")) limit = Number(arg.slice(8)) || null;
    else if (arg.startsWith("--product=")) productIds.push(arg.slice(10));
    else if (arg.startsWith("--lang=")) {
      for (const l of arg.slice(7).split(",")) {
        const key = l.trim().toUpperCase() as Exclude<Language, "EN">;
        if (key in LANGUAGE_NAMES) langs.push(key);
      }
    }
  }
  return {
    langs: langs.length ? langs : (Object.keys(LANGUAGE_NAMES) as Exclude<Language, "EN">[]),
    limit,
    productIds,
    force,
    dryRun,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function translateFields(
  language: Exclude<Language, "EN">,
  source: Record<Field, string>,
): Promise<Record<Field, string>> {
  const languageName = LANGUAGE_NAMES[language];
  const system =
    `You are a professional agriculture-domain translator. Translate the given ` +
    `product-description fields from English into ${languageName}. Rules:\n` +
    `- Keep every HTML tag exactly as-is; only translate the human-readable text between tags.\n` +
    `- Do NOT translate: chemical / active-ingredient names, their percentages and units ` +
    `(e.g. "Validamycin 3% L", "Metribuzin 70% WP"), brand names, product names, numbers, dosages.\n` +
    `- Keep the translation natural for an Indian farmer / dealer audience.\n` +
    `- If an input field is an empty string, return an empty string for it.\n` +
    `- Return ONLY a JSON object with exactly these keys: ${FIELDS.join(", ")}.`;

  const user = JSON.stringify(source);

  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(`${BASE_URL}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY as string,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });

    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(2 ** attempt * 1000, 30_000);
      console.warn(`  ${language}: HTTP ${res.status}, retrying in ${wait}ms (attempt ${attempt})`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    }

    const body = (await res.json()) as { content: { type: string; text?: string }[] };
    const text = body.content.find((c) => c.type === "text")?.text ?? "";
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error(`No JSON object in model reply: ${text.slice(0, 200)}`);
    }
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as Partial<Record<Field, string>>;
    const out = {} as Record<Field, string>;
    for (const f of FIELDS) out[f] = typeof parsed[f] === "string" ? (parsed[f] as string) : "";
    return out;
  }
  throw new Error(`${language}: exhausted retries`);
}

async function main() {
  if (!API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set — export it and re-run.");
    process.exit(1);
  }
  const args = parseArgs();
  console.log(
    `Model: ${MODEL} · languages: ${args.langs.join(", ")}` +
      (args.limit ? ` · limit: ${args.limit}` : "") +
      (args.force ? " · force" : "") +
      (args.dryRun ? " · DRY RUN" : ""),
  );

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const products = await prisma.product.findMany({
    where: {
      lifecycleStatus: "APPROVED",
      ...(args.productIds.length ? { id: { in: args.productIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      shortDescription: true,
      description: true,
      ingredients: true,
      howToUse: true,
      dosageInstructions: true,
      technicalInfo: true,
      translations: { select: { language: true } },
    },
    orderBy: { createdAt: "asc" },
    ...(args.limit ? { take: args.limit } : {}),
  });

  console.log(`${products.length} approved products to consider.\n`);
  let written = 0;
  let skipped = 0;

  for (const [i, product] of products.entries()) {
    const have = new Set(product.translations.map((t) => t.language));
    const source: Record<Field, string> = {
      shortDescription: product.shortDescription ?? "",
      description: product.description ?? "",
      ingredients: product.ingredients ?? "",
      howToUse: product.howToUse ?? "",
      dosageInstructions: product.dosageInstructions ?? "",
      technicalInfo: product.technicalInfo ?? "",
    };

    for (const lang of args.langs) {
      if (have.has(lang) && !args.force) {
        skipped++;
        continue;
      }
      process.stdout.write(`[${i + 1}/${products.length}] ${product.name.slice(0, 60)} → ${lang} … `);
      try {
        const fields = await translateFields(lang, source);
        if (!args.dryRun) {
          await prisma.productTranslation.upsert({
            where: { productId_language: { productId: product.id, language: lang } },
            create: { productId: product.id, language: lang, ...fields },
            update: fields,
          });
        }
        written++;
        console.log("ok");
      } catch (err) {
        console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleep(400); // be gentle on the rate limit
    }
  }

  console.log(`\nDone. ${written} translation rows written, ${skipped} skipped (already present).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
