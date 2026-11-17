import { NextRequest } from "next/server";
import { prisma } from "@kisan4u/db";
import {
  validateReturnMediaImage,
  validateReturnMediaVideo,
  uploadReturnMediaImage,
  uploadReturnMediaVideo,
} from "@kisan4u/providers";
import { jsonError, jsonOk, requireMobileBuyerContext, withMobileApi } from "@/lib/mobile-api";

/**
 * Uploads one piece of return evidence — a mandatory photo (?kind=image)
 * or the single optional video (?kind=video) — before the return request
 * itself is submitted, same "choose = upload, collect URLs, submit later"
 * flow as apps/web's uploadReturnMediaAction. Ownership is re-checked here
 * independently (there is no RefundRequest row to scope against yet), so a
 * buyer can't stash files under another customer's order/item path.
 * multipart/form-data, one `file` field.
 */
export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ groupId: string; sellerOrderId: string; orderItemId: string }>;
  },
) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const { sellerOrderId, orderItemId } = await params;

    const order = await prisma.sellerOrder.findFirst({
      where: { id: sellerOrderId, customerId: buyer.userId },
      select: { id: true, items: { where: { id: orderItemId }, select: { id: true } } },
    });
    if (!order || order.items.length === 0) {
      return jsonError(404, "NOT_FOUND", "Order not found.");
    }

    const kind = req.nextUrl.searchParams.get("kind") === "video" ? "video" : "image";
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return jsonError(400, "NO_FILE", "No file provided.");
    }

    if (kind === "image") {
      const validationError = validateReturnMediaImage(file);
      if (validationError) {
        return jsonError(
          400,
          validationError,
          validationError === "FILE_TOO_LARGE"
            ? "Image is too large — the maximum size is 5MB."
            : "Unsupported file type — upload a JPEG, PNG, or WEBP image.",
        );
      }
      const uploaded = await uploadReturnMediaImage(file, sellerOrderId, orderItemId);
      return uploaded.ok
        ? jsonOk({ url: uploaded.url })
        : jsonError(
            400,
            uploaded.error,
            uploaded.error === "CONTENT_MISMATCH"
              ? "The image content does not match its file extension."
              : "Unsupported file type — upload a JPEG, PNG, or WEBP image.",
          );
    }

    const validationError = validateReturnMediaVideo(file);
    if (validationError) {
      return jsonError(
        400,
        validationError,
        validationError === "FILE_TOO_LARGE"
          ? "Video is too large — the maximum size is 25MB."
          : "Unsupported file type — upload an MP4, WEBM, or MOV video.",
      );
    }
    const uploaded = await uploadReturnMediaVideo(file, sellerOrderId, orderItemId);
    return uploaded.ok
      ? jsonOk({ url: uploaded.url })
      : jsonError(
          400,
          uploaded.error,
          uploaded.error === "CONTENT_MISMATCH"
            ? "The video content does not match its file extension."
            : "Unsupported file type — upload an MP4, WEBM, or MOV video.",
        );
  });
}
