"use client";

import { useEffect, useState } from "react";
import { AlertBox, Modal, StatusBadge, formatDateDDMMYYYY } from "@kisan4u/ui";
import {
  getLicenceSubmissionDetailAction,
  type LicenceSubmissionDetail,
} from "@/lib/licence-detail-action";

function geoSummary(detail: LicenceSubmissionDetail): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (detail.audience === "CUSTOMER" || detail.audience === "BOTH") {
    rows.push({
      label: "Customer coverage",
      value:
        detail.customerGeoType === "PAN_INDIA"
          ? "Pan India licence"
          : detail.customerStates.join(", ") || "—",
    });
  }
  if (detail.audience === "DEALER" || detail.audience === "BOTH") {
    rows.push({
      label: "Dealer coverage",
      value:
        detail.dealerGeoType === "PAN_INDIA"
          ? "Pan India licence"
          : detail.dealerStates.join(", ") || "—",
    });
  }
  return rows;
}

/**
 * The single in-app document viewer used everywhere a licence document
 * needs to be viewed (seller's own table, admin's table) — spec §5: never
 * a plain "open in new tab" link. Fetches the document through the
 * existing authenticated/private route (never exposes the raw storage
 * path — the URL only ever contains this submission's id), and always
 * revokes its object URL on close/unmount so it never leaks past the
 * modal's lifetime.
 */
export function LicenceDetailModal({
  submissionId,
  onClose,
}: {
  submissionId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<LicenceSubmissionDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getLicenceSubmissionDetailAction(submissionId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setDetailError(result.error);
        return;
      }
      setDetail(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  useEffect(() => {
    let cancelled = false;
    let currentUrl: string | null = null;
    setDocLoading(true);
    setDocError(null);
    fetch(`/api/seller-licences/documents/${submissionId}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok)
          throw new Error(
            res.status === 404 ? "Document not found." : "Could not load the document.",
          );
        const blob = await res.blob();
        if (cancelled) return;
        currentUrl = URL.createObjectURL(blob);
        setObjectUrl(currentUrl);
      })
      .catch((err: Error) => {
        if (!cancelled) setDocError(err.message);
      })
      .finally(() => {
        if (!cancelled) setDocLoading(false);
      });
    return () => {
      cancelled = true;
      // Clean up the object URL the moment this effect re-runs or the
      // modal unmounts — never leaves a blob: URL alive past the viewer.
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [submissionId]);

  const isPdf = detail?.documentMimeType === "application/pdf";
  const isImage = detail?.documentMimeType?.startsWith("image/");

  return (
    <Modal
      open
      onClose={onClose}
      title={detail ? `${detail.requirementName} — ${detail.sellerShopName}` : "Licence document"}
      className="max-w-3xl"
    >
      <div className="flex flex-col gap-4">
        {detailError && <AlertBox tone="danger">{detailError}</AlertBox>}
        {!detail && !detailError && <p className="text-sm text-gray-500">Loading…</p>}

        {detail && (
          <>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-border bg-bg-dashboard p-3 text-[13px] sm:grid-cols-3">
              <div>
                <div className="text-gray-500">Status</div>
                <StatusBadge status={detail.status} />
              </div>
              <div>
                <div className="text-gray-500">Licence number</div>
                <div className="font-semibold text-ink">{detail.licenceNumber}</div>
              </div>
              <div>
                <div className="text-gray-500">Expiry date</div>
                <div className="font-semibold text-ink">
                  {formatDateDDMMYYYY(detail.expiryDate)}
                </div>
              </div>
              <div>
                <div className="text-gray-500">Audience</div>
                <div className="font-semibold text-ink">
                  {detail.audience === "BOTH"
                    ? "Customer & Dealer"
                    : detail.audience === "CUSTOMER"
                      ? "Customer"
                      : "Dealer"}
                </div>
              </div>
              <div>
                <div className="text-gray-500">Submitted</div>
                <div className="font-semibold text-ink">
                  {formatDateDDMMYYYY(detail.submittedAt)}
                </div>
              </div>
              {detail.reviewedAt && (
                <div>
                  <div className="text-gray-500">Reviewed</div>
                  <div className="font-semibold text-ink">
                    {formatDateDDMMYYYY(detail.reviewedAt)}
                  </div>
                </div>
              )}
              {geoSummary(detail).map((row) => (
                <div key={row.label} className="col-span-2 sm:col-span-3">
                  <div className="text-gray-500">{row.label}</div>
                  <div className="font-semibold text-ink">{row.value}</div>
                </div>
              ))}
              {(detail.rejectionReason || detail.revocationReason) && (
                <div className="col-span-2 sm:col-span-3">
                  <div className="text-gray-500">Reason</div>
                  <div className="font-semibold text-danger">
                    {detail.rejectionReason ?? detail.revocationReason}
                  </div>
                </div>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-[13px] font-bold text-ink">Document</h3>
              <div
                className="flex min-h-[300px] flex-col items-center justify-center overflow-auto rounded-lg border border-border bg-bg-dashboard p-2"
                style={{ maxHeight: "60vh" }}
              >
                {docLoading && <p className="text-sm text-gray-500">Loading document…</p>}
                {docError && (
                  <div className="p-4 text-center">
                    <AlertBox tone="danger">{docError}</AlertBox>
                  </div>
                )}
                {!docLoading && !docError && objectUrl && isPdf && (
                  <iframe
                    src={`${objectUrl}#toolbar=0&navpanes=0`}
                    title="Licence document"
                    className="h-[55vh] w-full rounded"
                  />
                )}
                {!docLoading && !docError && objectUrl && isImage && (
                  // eslint-disable-next-line @next/next/no-img-element -- blob: object URL, next/image cannot optimize it
                  <img
                    src={objectUrl}
                    alt="Licence document"
                    className="max-h-[55vh] max-w-full object-contain"
                  />
                )}
                {!docLoading && !docError && objectUrl && !isPdf && !isImage && (
                  <div className="p-4 text-center text-sm text-gray-600">
                    This file type can&apos;t be previewed in the browser.
                  </div>
                )}
              </div>
            </div>

            {detail.revisionChain.length > 1 && (
              <div>
                <button
                  type="button"
                  className="text-[13px] font-semibold text-green-700 hover:underline"
                  onClick={() => setShowHistory((s) => !s)}
                >
                  {showHistory
                    ? "Hide revision history"
                    : `View revision history (${detail.revisionChain.length})`}
                </button>
                {showHistory && (
                  <ul className="mt-2 flex flex-col gap-1 rounded-lg border border-border p-3 text-[13px]">
                    {detail.revisionChain.map((rev) => (
                      <li key={rev.id} className="flex items-center justify-between gap-2">
                        <span className="text-gray-600">
                          {formatDateDDMMYYYY(rev.submittedAt)}{" "}
                          {rev.isCurrent && (
                            <span className="font-semibold text-green-700">(current)</span>
                          )}
                        </span>
                        <StatusBadge status={rev.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
