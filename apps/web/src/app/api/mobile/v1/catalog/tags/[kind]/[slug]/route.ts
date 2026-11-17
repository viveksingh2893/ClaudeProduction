import { NextRequest } from "next/server";
import { getCropBySlug, getPestDiseaseBySlug } from "@kisan4u/catalog";
import { jsonError, jsonOk, withMobileApi } from "@/lib/mobile-api";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ kind: string; slug: string }> },
) {
  return withMobileApi(async () => {
    const { kind, slug } = await params;
    if (kind !== "crop" && kind !== "pest-disease") {
      return jsonError(404, "NOT_FOUND", "Tag not found.");
    }
    const tag = kind === "crop" ? await getCropBySlug(slug) : await getPestDiseaseBySlug(slug);
    if (!tag) return jsonError(404, "NOT_FOUND", "Tag not found.");
    return jsonOk({ tag });
  });
}
