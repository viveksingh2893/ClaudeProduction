import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";
import { uploadCatalogImage } from "@kisan4u/providers";

// Standalone script (same convention as seed.ts/seed-demo.ts) — loads .env
// and builds its own client/adapter rather than importing the shared
// singleton from src/index.ts, which assumes a running Next.js process.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * A generated, locally-controlled header image for each sample blog —
 * never an external hotlink (spec: "Images must actually load... Do not
 * use unreliable external hotlinks"). Built with `sharp`, the same image
 * library packages/providers already uses for the real upload pipeline,
 * then written through that exact same `localStorageProvider.upload()`
 * call every real admin-uploaded image goes through — so the resulting
 * URL is a genuine `/api/uploads/...` path served by the app's own route
 * handler, not a special-cased seed-only asset.
 */
async function generateHeaderImage(title: string, accent: string): Promise<Buffer> {
  const width = 1200;
  const height = 675;
  const words = title.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 28) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);

  const lineHeight = 74;
  const startY = height / 2 - (lines.length * lineHeight) / 2 + 50;
  const textSvg = lines
    .map(
      (line, i) =>
        `<text x="80" y="${startY + i * lineHeight}" font-family="Arial, sans-serif" font-size="56" font-weight="800" fill="#ffffff">${line
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")}</text>`,
    )
    .join("");

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${accent}" />
          <stop offset="100%" stop-color="#14532d" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)" />
      <circle cx="1080" cy="120" r="180" fill="#ffffff" fill-opacity="0.07" />
      <circle cx="120" cy="600" r="140" fill="#ffffff" fill-opacity="0.06" />
      <text x="80" y="90" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#d1fae5" letter-spacing="2">KISAN4U</text>
      ${textSvg}
    </svg>
  `;

  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

async function uploadHeaderImage(slug: string, title: string, accent: string): Promise<string> {
  const buffer = await generateHeaderImage(title, accent);
  const file = new File([new Uint8Array(buffer)], `${slug}.jpg`, { type: "image/jpeg" });
  // Same validated call site (size/MIME/signature) every real admin image
  // upload goes through — see packages/providers/src/storage.ts's doc
  // comment on this function.
  const result = await uploadCatalogImage(file, `catalog-images/blogs/${slug}`);
  if (!result.ok) throw new Error(`Failed to seed header image for ${slug}: ${result.error}`);
  return result.url;
}

async function upsertCategory(name: string, slug: string) {
  return prisma.blogCategory.upsert({
    where: { slug },
    update: { name },
    create: { name, slug },
  });
}

type SeedBlog = {
  title: string;
  slug: string;
  categorySlug: string;
  categoryName: string;
  accent: string;
  headerImageAlt: string;
  metaDescription: string;
  featuredPosition: number;
  bodyHtml: string;
};

const BLOGS: SeedBlog[] = [
  {
    title: "Why Buying Through an Approved Dealer Network Benefits Your Business",
    slug: "Dealer-Network-Benefits",
    categorySlug: "dealer-guides",
    categoryName: "Dealer Guides",
    accent: "#15803d",
    headerImageAlt: "Warehouse shelves stocked with packaged goods ready for dealer fulfilment",
    metaDescription:
      "How sourcing through Kisan4U's approved dealer network improves pricing, stock reliability, and fulfilment for growing B2B businesses.",
    featuredPosition: 1,
    bodyHtml: `
<p>Running a store or distribution business means your margins live and die on two things: what you pay for stock, and whether that stock actually arrives when you need it. An approved dealer network exists to solve both problems at once — and it's worth understanding why that structure works better than sourcing on your own.</p>

<h2>Verified sellers, fewer surprises</h2>
<p>Every seller on <a href="/products">Kisan4U's marketplace</a> goes through an approval process before dealers can place bulk orders with them. That means the products you're buying come from sellers whose catalogues, pricing, and fulfilment history are already on record — not a cold sourcing relationship you're building from scratch with every order.</p>
<ul>
  <li>Consistent product listings, so what you ordered last month matches what arrives this month</li>
  <li>Dealer-specific pricing that reflects real bulk volumes, not a marked-up retail rate</li>
  <li>A single platform to track every seller relationship instead of a dozen separate phone numbers and invoices</li>
</ul>

<h2>Pricing built for how dealers actually buy</h2>
<p>Dealer pricing on Kisan4U is set at the product level by each seller, which means it reflects real wholesale economics rather than a flat discount bolted onto a retail price. Combined with <strong>minimum order quantities</strong> that make sense for bulk fulfilment, this keeps your landed cost predictable order over order.</p>

<h2>Stock planning you can actually rely on</h2>
<p>A dealer network is only useful if the stock behind it is real. Kisan4U's sellers manage live inventory through the same catalogue dealers order from, so a product showing as available is a product that's actually in the seller's warehouse — not a listing waiting to be confirmed after the fact.</p>
<ol>
  <li>Check live stock before committing to an order size</li>
  <li>Place the order with dealer-tier pricing already applied</li>
  <li>Track fulfilment and delivery from the same order record</li>
</ol>

<h2>Fulfilment that scales with your order volume</h2>
<p>Whether you're placing a single pallet order or restocking across multiple product lines, the same delivery and tracking process applies. That consistency is what lets a growing business plan around Kisan4U as a dependable supply channel, rather than treating each order as its own negotiation.</p>

<p>If your business hasn't set up a <a href="/register">dealer account</a> yet, it's worth doing before your next bulk order — the pricing and stock-visibility benefits apply from the very first purchase.</p>
`,
  },
  {
    title: "How to Choose the Right Products for Your Store",
    slug: "Choosing-The-Right-Products",
    categorySlug: "buying-guides",
    categoryName: "Buying Guides",
    accent: "#0f766e",
    headerImageAlt: "Store owner reviewing product options on a tablet in a stockroom",
    metaDescription:
      "A practical framework for choosing which products to stock — demand, quality, margins, minimum order quantities, and supplier reliability.",
    featuredPosition: 2,
    bodyHtml: `
<p>Every store owner has a limited amount of shelf space, working capital, and attention — which means every product you decide to stock is a decision <em>not</em> to stock something else. Here's a practical way to think through that decision.</p>

<h2>Start with real demand, not assumptions</h2>
<p>The easiest mistake to make is stocking what you personally think will sell rather than what your actual customers are asking for. Before committing to a new product line, look at:</p>
<ul>
  <li>What customers are already asking for that you currently turn away</li>
  <li>Which of your existing products consistently sell out fastest</li>
  <li>Seasonal or regional demand patterns specific to your customer base</li>
</ul>

<h2>Quality and consistency matter more than the lowest price</h2>
<p>A cheaper product that arrives inconsistent, or that disappoints customers, costs you more in the long run than a slightly higher-priced product you can stand behind. On Kisan4U, product listings include seller and category details so you can evaluate quality signals before committing to a bulk order — not just the headline price.</p>

<h2>Understand your real margin, not just the sticker price</h2>
<p>A product's margin isn't just <strong>selling price minus cost price</strong>. Factor in:</p>
<ol>
  <li>Minimum order quantity, and whether it matches what you can realistically sell before it ties up capital</li>
  <li>Delivery and any collection charges that apply to the order</li>
  <li>How quickly the product turns over on your shelf</li>
</ol>
<p>A product with a slightly lower headline margin but faster turnover is often more profitable than a high-margin item that sits unsold.</p>

<h2>Match minimum order quantities to your actual sell-through</h2>
<p>It's tempting to chase a lower per-unit price by ordering the largest quantity a seller offers. Before doing that, be honest about how long it will realistically take to sell through that stock — tied-up capital and storage space are real costs, even when the per-unit price looks attractive.</p>

<h2>Choose suppliers you can rely on for the next order too</h2>
<p>A single good order doesn't tell you much. What matters is whether a seller can reliably repeat it — consistent stock availability, consistent product quality, and dependable fulfilment timing. That reliability is exactly what an <a href="/dealer/products">approved dealer catalogue</a> is designed to make visible before you commit to a bulk order.</p>
`,
  },
  {
    title: "Understanding Bulk Orders, Pricing and Delivery on Kisan4U",
    slug: "Bulk-Orders-Pricing-Delivery",
    categorySlug: "platform-guides",
    categoryName: "Platform Guides",
    accent: "#166534",
    headerImageAlt: "Boxes being loaded onto a delivery van outside a distribution warehouse",
    metaDescription:
      "How bulk ordering, dealer pricing, delivery, and order tracking actually work on the Kisan4U marketplace, explained in plain terms.",
    featuredPosition: 3,
    bodyHtml: `
<p>If you're new to buying in bulk through Kisan4U, the process is more straightforward than it might look at first. Here's how ordering, pricing, and delivery actually fit together on the platform.</p>

<h2>How bulk pricing is applied</h2>
<p>Each seller sets their own dealer pricing per product, so the rate you see as an approved dealer already reflects bulk-appropriate pricing — you don't need to negotiate a separate discount. Pricing is shown per unit, with the minimum order quantity clearly listed on the product page, so you can calculate your total order cost before checking out.</p>
<ul>
  <li>Product pricing is set by the seller and shown up front — no hidden negotiation step</li>
  <li>Minimum order quantities are listed per product, not per order</li>
  <li>Tax is calculated and shown before you complete checkout</li>
</ul>

<h2>Placing a multi-seller order</h2>
<p>A single checkout can include products from more than one seller. Behind the scenes, Kisan4U splits this into a separate order per seller — each with its own status, its own delivery, and its own tracking — while you still check out and pay in one pass.</p>
<ol>
  <li>Add products from one or more sellers to your cart</li>
  <li>Review pricing, quantities, and delivery details at checkout</li>
  <li>Choose a payment method — including partial payment where a seller offers it, with the remaining balance collected on delivery</li>
  <li>Track each seller's order independently from your account</li>
</ol>

<h2>Delivery expectations</h2>
<p>Delivery is handled either through Kisan4U's courier network or, for larger dealer shipments, a transport arrangement — whichever the order qualifies for. Delivery charges, when they apply, are shown clearly at checkout rather than added afterward. Once an order is packed and handed to the courier, you can follow its status through to delivery from your order history.</p>

<h2>Tracking your order after checkout</h2>
<p>Every order moves through a clear set of stages — confirmed, packed, picked up, in transit, and delivered — visible from your <a href="/orders">order history</a> at any time. If anything about an order needs attention, that status is exactly where you'll see it first.</p>

<p>Bulk ordering doesn't need to be complicated. The goal of this workflow is the same whether you're ordering ten units or ten thousand: clear pricing, a predictable process, and visibility into where your order actually is.</p>
`,
  },
];

async function main() {
  console.log("Seeding sample blogs…");

  for (const b of BLOGS) {
    const category = await upsertCategory(b.categoryName, b.categorySlug);

    // Only generate+write a new image file the first time this blog is
    // seeded — re-running (idempotent update) reuses whatever's already on
    // disk instead of accumulating a fresh file under the same slug's
    // folder on every run.
    const existing = await prisma.blog.findUnique({ where: { slug: b.slug } });
    const headerImageUrl = existing?.headerImageUrl ?? (await uploadHeaderImage(b.slug, b.title, b.accent));

    await prisma.blog.upsert({
      where: { slug: b.slug },
      update: {
        title: b.title,
        headerImageUrl,
        headerImageAlt: b.headerImageAlt,
        categoryId: category.id,
        bodyHtml: b.bodyHtml.trim(),
        writer: "Kisan4U Editor",
        metaDescription: b.metaDescription,
        featuredPosition: b.featuredPosition,
      },
      create: {
        title: b.title,
        slug: b.slug,
        headerImageUrl,
        headerImageAlt: b.headerImageAlt,
        categoryId: category.id,
        bodyHtml: b.bodyHtml.trim(),
        writer: "Kisan4U Editor",
        metaDescription: b.metaDescription,
        featuredPosition: b.featuredPosition,
      },
    });
    console.log(`  ✓ ${b.title} (/blog/${b.slug})`);
  }

  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
