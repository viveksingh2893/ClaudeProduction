import { api } from "@/lib/api-client";

export function submitReview(slug: string, input: { rating: number; comment?: string }) {
  return api.post<{ reviewId: string }>(
    `/api/mobile/v1/catalog/products/${encodeURIComponent(slug)}/reviews`,
    input,
  );
}
