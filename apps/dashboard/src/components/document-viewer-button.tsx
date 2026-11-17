"use client";

import { useState } from "react";
import { Modal } from "@kisan4u/ui";

/** Opens an authenticated private document inside the dashboard without a download action. */
export function DocumentViewerButton({ url, label }: { url: string | null; label: string }) {
  const [open, setOpen] = useState(false);

  if (!url) return <span className="text-gray-400">Not uploaded</span>;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-medium text-green-700 hover:underline"
        aria-label={`View ${label}`}
      >
        View document
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        className="max-w-4xl"
      >
        <iframe
          src={`${url}#toolbar=0&navpanes=0`}
          title={label}
          className="h-[75vh] w-full rounded-md border border-border"
        />
      </Modal>
    </>
  );
}
