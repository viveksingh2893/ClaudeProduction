import { getSellerPickupPoints } from "@kisan4u/orders";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { PickupPointsManager } from "./pickup-points-manager";

export default async function SellerPickupPointsPage() {
  const { sellerProfileId } = await requireApprovedSeller();
  const pickupPoints = await getSellerPickupPoints(sellerProfileId);

  return (
    <PageContainer maxWidth="1100px" className="py-8">
      <PageHeader title="Pickup points" description="You select one of your approved pickup points when accepting each order." />
      <PickupPointsManager pickupPoints={pickupPoints} />
    </PageContainer>
  );
}
