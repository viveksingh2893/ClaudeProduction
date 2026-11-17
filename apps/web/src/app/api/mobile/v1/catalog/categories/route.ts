import { NextRequest } from "next/server";
import { getCategoryNavTree, resolveCategoryName } from "@kisan4u/catalog";
import { toDbLanguage } from "@kisan4u/validators";
import { jsonOk, withMobileApi } from "@/lib/mobile-api";

/** Full active category → subcategory → sub-subcategory tree — same data as the website's nav bar/mobile drawer, admin-ordered. Public, no auth required. `?lang=` localizes every name (falls back to English per node). */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const language = toDbLanguage(req.nextUrl.searchParams.get("lang"));
    const tree = await getCategoryNavTree();
    const localized = tree.map((cat) => ({
      ...cat,
      name: resolveCategoryName(cat, language),
      subCategories: cat.subCategories.map((sub) => ({
        ...sub,
        name: resolveCategoryName(sub, language),
        subSubCategories: sub.subSubCategories.map((ss) => ({
          ...ss,
          name: resolveCategoryName(ss, language),
        })),
      })),
    }));
    return jsonOk({ categories: localized });
  });
}
