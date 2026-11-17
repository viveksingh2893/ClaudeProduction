import { getRapidShypLabelForAdmin } from "@kisan4u/orders";
import { rapidShypLabelToResponse } from "@/lib/rapidshyp-label-response";
import { requireOrdersSectionView } from "@/lib/order-scheduling-guard";

/** Orders-section guard (ADMIN or order-scheduling:VIEW) — same gate as the admin order detail page. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireOrdersSectionView();
  const { id } = await params;
  return rapidShypLabelToResponse(await getRapidShypLabelForAdmin(id));
}
