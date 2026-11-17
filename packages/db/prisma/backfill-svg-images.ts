/**
 * One-off backfill for dev/demo databases seeded before the SVG -> PNG
 * image fix. Updates any row that still stores one of the old raw .svg
 * Wikimedia URLs to the new PNG thumbnail-rendering URL for the same
 * source file (see the IMG table / assertNoSvgImageUrls() comment in
 * seed-demo.ts for why these are genuine rasterized PNGs, not renames).
 *
 * Safe to run multiple times (each update is a no-op once applied).
 * Does not touch any other data.
 */
import "dotenv/config";
import { prisma } from "../src/index";

const URL_MAP: Record<string, string> = {
  "https://upload.wikimedia.org/wikipedia/commons/5/58/Pruning_shears.svg":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/58/Pruning_shears.svg/500px-Pruning_shears.svg.png",
  "https://upload.wikimedia.org/wikipedia/commons/9/97/Leaf_icon_05.svg":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/Leaf_icon_05.svg/500px-Leaf_icon_05.svg.png",
  "https://upload.wikimedia.org/wikipedia/commons/0/07/Leaf_icon_14.svg":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/Leaf_icon_14.svg/500px-Leaf_icon_14.svg.png",
  "https://upload.wikimedia.org/wikipedia/commons/5/58/Leaf_icon_03.svg":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/58/Leaf_icon_03.svg/500px-Leaf_icon_03.svg.png",
  "https://upload.wikimedia.org/wikipedia/commons/3/38/Tag_icon.svg":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Tag_icon.svg/500px-Tag_icon.svg.png",
  "https://upload.wikimedia.org/wikipedia/commons/d/dd/OOjs_UI_icon_tag-ltr.svg":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/OOjs_UI_icon_tag-ltr.svg/500px-OOjs_UI_icon_tag-ltr.svg.png",
  "https://upload.wikimedia.org/wikipedia/commons/8/82/Shoes.svg":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Shoes.svg/500px-Shoes.svg.png",
  "https://upload.wikimedia.org/wikipedia/commons/7/78/Printed_circuit_board_PCB_icon_3.svg":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Printed_circuit_board_PCB_icon_3.svg/500px-Printed_circuit_board_PCB_icon_3.svg.png",
};

async function main() {
  let totalUpdated = 0;

  for (const [oldUrl, newUrl] of Object.entries(URL_MAP)) {
    const [brands, manufacturers, products, productImages, variants] = await Promise.all([
      prisma.brand.updateMany({ where: { imageUrl: oldUrl }, data: { imageUrl: newUrl } }),
      prisma.manufacturer.updateMany({ where: { imageUrl: oldUrl }, data: { imageUrl: newUrl } }),
      prisma.product.updateMany({
        where: { primaryImageUrl: oldUrl },
        data: { primaryImageUrl: newUrl },
      }),
      prisma.productImage.updateMany({ where: { url: oldUrl }, data: { url: newUrl } }),
      prisma.productVariant.updateMany({ where: { imageUrl: oldUrl }, data: { imageUrl: newUrl } }),
    ]);
    const count =
      brands.count + manufacturers.count + products.count + productImages.count + variants.count;
    if (count > 0) {
      console.log(`Updated ${count} row(s) referencing ${oldUrl}`);
      totalUpdated += count;
    }
  }

  console.log(`Backfill complete. ${totalUpdated} row(s) touched.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
