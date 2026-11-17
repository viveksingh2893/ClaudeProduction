"use client";

import { useState } from "react";
import { Button, type ImageUploadResult } from "@kisan4u/ui";
import { RichTextEditor } from "@kisan4u/ui/RichTextEditor";
import { isRichTextEmpty } from "@kisan4u/validators";
import { ModalShell } from "./cell-primitives";

const FIELD_LABEL: Record<string, string> = {
  shortDescription: "Short description",
  description: "Full description",
  ingredients: "Ingredients / composition",
  howToUse: "How to use",
  dosageInstructions: "Dosage / instructions",
  technicalInfo: "Technical information",
};

/** The spreadsheet cell for every rich-text field opens this instead of embedding a full editor inline (spec: "Do not display a full editor inside a tiny cell"). Reuses the exact same RichTextEditor the single-product form uses. */
export function DescriptionModal({
  field,
  value,
  onUploadImage,
  onSave,
  onClose,
}: {
  field: string;
  value: string;
  onUploadImage: (file: File) => Promise<ImageUploadResult>;
  onSave: (html: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const required = field === "shortDescription" || field === "description";
  const empty = isRichTextEmpty(draft);

  return (
    <ModalShell title={FIELD_LABEL[field] ?? field} onClose={onClose} wide>
      <RichTextEditor value={draft} onChange={setDraft} onUploadImage={onUploadImage} />
      {required && empty && (
        <p className="mt-2 text-sm font-medium text-danger">This field is required.</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={() => onSave(draft)} disabled={required && empty}>
          Save
        </Button>
      </div>
    </ModalShell>
  );
}
