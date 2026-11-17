import { FileText } from "lucide-react";
import { Card, formatDate } from "@kisan4u/ui";

/**
 * Inline PDF viewer for a seller agreement — admin seller page's "Seller
 * Agreement" tab and the seller's own Account → Agreement page. The PDF
 * comes from the authenticated /api/seller-agreement/[sellerProfileId]
 * route. It remains inside the authenticated dashboard viewer and does
 * not expose a separate download action.
 */
export function SellerAgreementViewer({
  sellerProfileId,
  fileName,
  uploadedAt,
}: {
  sellerProfileId: string;
  fileName: string | null;
  uploadedAt: Date | null;
}) {
  const src = `/api/seller-agreement/${sellerProfileId}`;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4 text-green-700" aria-hidden="true" />
          <span className="font-semibold text-ink">{fileName ?? "Seller agreement"}</span>
          {uploadedAt && <span className="text-xs text-gray-500">Uploaded {formatDate(uploadedAt)}</span>}
        </div>
      </div>
      <iframe
        src={`${src}#toolbar=0&navpanes=0`}
        title={fileName ?? "Seller agreement"}
        className="h-[75vh] w-full rounded-md border border-border"
      />
    </Card>
  );
}
