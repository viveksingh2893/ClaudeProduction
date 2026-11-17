import { NextRequest } from "next/server";
import { submitProductReview, getPublicProductBySlug } from "@kisan4u/catalog";
import { submitReviewInputSchema } from "@kisan4u/validators";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileAuth,
  withMobileApi,
} from "@/lib/mobile-api";

/** Verified-purchase review submission — eligibility (owns a delivered order containing this product, hasn't already reviewed it) is re-checked server-side inside submitProductReview on every call. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req, ["CUSTOMER", "DEALER"]);
    const { slug } = await params;
    const product = await getPublicProductBySlug(slug);
    if (!product) return jsonError(404, "NOT_FOUND", "Product not found.");

    const body = await parseJsonBody(req);
    const parsed = submitReviewInputSchema.safeParse({
      ...(body as object),
      productId: product.id,
    });
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid review.",
      );
    }

    const result = await submitProductReview(userId, parsed.data);
    if (!result.ok) return jsonError(400, "REVIEW_ERROR", result.error);
    return jsonOk(result, 201);
  });
}
