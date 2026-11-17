"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@kisan4u/db";
import { requestCancellation, cancelPendingOrderByCustomer, requestReturn } from "@kisan4u/orders";
import { cancellationRequestInputSchema, requestReturnInputSchema } from "@kisan4u/validators";
import {
  validateReturnMediaImage,
  validateReturnMediaVideo,
  uploadReturnMediaImage,
  uploadReturnMediaVideo,
} from "@kisan4u/providers";
import { requireBuyerContext } from "@/lib/buyer-context";

type Result = { ok: true } | { ok: false; error: string };
type UploadResult = { ok: true; url: string } | { ok: false; error: string };

/** Ownership + status-transition gating both happen inside requestCancellation (scoped by customerId, and blocked once the order reaches IN_TRANSIT — Phase 4 spec §M). */
export async function requestCancellationAction(rawInput: unknown): Promise<Result> {
  const ctx = await requireBuyerContext();
  const parsed = cancellationRequestInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = await requestCancellation(ctx.userId, ctx.role, parsed.data);
  if (result.ok) revalidatePath("/orders");
  return result;
}

/**
 * Buyer cancels a still-"Pending" order outright (no admin approval) — the
 * service refuses anything already CONFIRMED, where requestCancellationAction
 * is the right call. Same input shape (reason + optional refund method).
 */
export async function cancelOrderNowAction(rawInput: unknown): Promise<Result> {
  const ctx = await requireBuyerContext();
  const parsed = cancellationRequestInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = await cancelPendingOrderByCustomer(ctx.userId, ctx.role, parsed.data);
  if (result.ok) revalidatePath("/orders");
  return result;
}

/** Ownership + DELIVERED-only gating both happen inside requestReturn (scoped by customerId — see packages/orders/src/refunds.ts). */
export async function requestReturnAction(rawInput: unknown): Promise<Result> {
  const ctx = await requireBuyerContext();
  const parsed = requestReturnInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = await requestReturn(ctx.userId, ctx.role, parsed.data);
  if (result.ok) revalidatePath("/orders");
  return result;
}

/**
 * Uploads one piece of return-request evidence (a photo or the optional
 * video) — called once per file, immediately on selection, before the
 * return request itself is submitted (see request-return-button.tsx's
 * upload-then-collect-URLs flow, same pattern as the POS payment-proof
 * screenshot upload). Ownership is re-checked here independently of
 * requestReturnAction's own check, since there's no RefundRequest row yet
 * to scope against at upload time — a buyer could otherwise squat files
 * under another customer's order/item path.
 */
export async function uploadReturnMediaAction(
  sellerOrderId: string,
  orderItemId: string,
  kind: "image" | "video",
  formData: FormData,
): Promise<UploadResult> {
  const ctx = await requireBuyerContext();
  const order = await prisma.sellerOrder.findFirst({
    where: { id: sellerOrderId, customerId: ctx.userId },
    select: { id: true, items: { where: { id: orderItemId }, select: { id: true } } },
  });
  if (!order || order.items.length === 0) return { ok: false, error: "Order not found." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file provided." };

  if (kind === "image") {
    const validationError = validateReturnMediaImage(file);
    if (validationError) {
      return {
        ok: false,
        error:
          validationError === "FILE_TOO_LARGE"
            ? "Image is too large — the maximum size is 5MB."
            : "Unsupported file type — upload a JPEG, PNG, or WEBP image.",
      };
    }
    const uploaded = await uploadReturnMediaImage(file, sellerOrderId, orderItemId);
    return uploaded.ok
      ? { ok: true, url: uploaded.url }
      : {
          ok: false,
          error:
            uploaded.error === "CONTENT_MISMATCH"
              ? "The image content does not match its file extension."
              : "Unsupported file type — upload a JPEG, PNG, or WEBP image.",
        };
  }

  const validationError = validateReturnMediaVideo(file);
  if (validationError) {
    return {
      ok: false,
      error:
        validationError === "FILE_TOO_LARGE"
          ? "Video is too large — the maximum size is 25MB."
          : "Unsupported file type — upload an MP4, WEBM, or MOV video.",
    };
  }
  const uploaded = await uploadReturnMediaVideo(file, sellerOrderId, orderItemId);
  return uploaded.ok
    ? { ok: true, url: uploaded.url }
    : {
        ok: false,
        error:
          uploaded.error === "CONTENT_MISMATCH"
            ? "The video content does not match its file extension."
            : "Unsupported file type — upload an MP4, WEBM, or MOV video.",
      };
}
