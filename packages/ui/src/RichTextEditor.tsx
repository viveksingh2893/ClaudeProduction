"use client";

import { useEffect, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table/row";
import { TableCell } from "@tiptap/extension-table/cell";
import { TableHeader } from "@tiptap/extension-table/header";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  RemoveFormatting,
  List,
  ListOrdered,
  IndentIncrease,
  IndentDecrease,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Quote,
  Link as LinkIcon,
  Unlink,
  Table as TableIcon,
  Image as ImageIcon,
  Undo2,
  Redo2,
  Maximize2,
  Minimize2,
  Code2,
  Smile,
} from "lucide-react";
import type { ImageUploadResult } from "./ImageUploadField";

const SPECIAL_CHARS = [
  "©",
  "®",
  "™",
  "°",
  "§",
  "•",
  "–",
  "—",
  "±",
  "×",
  "÷",
  "½",
  "¼",
  "¾",
  "€",
  "£",
  "¥",
  "₹",
];

function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink transition-colors hover:bg-bg-dashboard disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-green-100 text-green-800" : ""
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar({
  editor,
  fullscreen,
  onToggleFullscreen,
  sourceMode,
  onToggleSourceMode,
  onUploadImage,
}: {
  editor: Editor;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  sourceMode: boolean;
  onToggleSourceMode: () => void;
  onUploadImage?: (file: File) => Promise<ImageUploadResult>;
}) {
  const [showSpecialChars, setShowSpecialChars] = useState(false);
  const [uploading, setUploading] = useState(false);

  function setBlock(value: string) {
    if (value === "p") editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 | 4 }).run();
  }

  function currentBlock(): string {
    for (const level of [1, 2, 3, 4] as const) {
      if (editor.isActive("heading", { level })) return `h${level}`;
    }
    return "p";
  }

  function addLink() {
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previousUrl ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  async function insertImageFromFile(file: File) {
    if (!onUploadImage) return;
    setUploading(true);
    try {
      const result = await onUploadImage(file);
      if (result.ok) editor.chain().focus().setImage({ src: result.url }).run();
    } finally {
      setUploading(false);
    }
  }

  function insertImageFromUrl() {
    const url = window.prompt("Image URL");
    if (!url) return;
    editor.chain().focus().setImage({ src: url }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-bg-dashboard/60 p-1.5">
      <select
        aria-label="Paragraph style"
        value={currentBlock()}
        onChange={(e) => setBlock(e.target.value)}
        className="h-8 rounded-md border-[1.5px] border-border bg-white px-1.5 text-xs text-ink outline-none focus:border-green-600"
      >
        <option value="p">Paragraph</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="h4">Heading 4</option>
      </select>

      <div className="mx-1 h-5 w-px bg-border" />

      <ToolbarButton
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label="Remove formatting"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <RemoveFormatting className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-border" />

      <ToolbarButton
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label="Indent"
        disabled={!editor.can().sinkListItem("listItem")}
        onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
      >
        <IndentIncrease className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label="Outdent"
        disabled={!editor.can().liftListItem("listItem")}
        onClick={() => editor.chain().focus().liftListItem("listItem").run()}
      >
        <IndentDecrease className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-border" />

      <ToolbarButton
        label="Align left"
        active={editor.isActive({ textAlign: "left" })}
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
      >
        <AlignLeft className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label="Align center"
        active={editor.isActive({ textAlign: "center" })}
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
      >
        <AlignCenter className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label="Align right"
        active={editor.isActive({ textAlign: "right" })}
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
      >
        <AlignRight className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label="Justify"
        active={editor.isActive({ textAlign: "justify" })}
        onClick={() => editor.chain().focus().setTextAlign("justify").run()}
      >
        <AlignJustify className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-border" />

      <ToolbarButton
        label="Blockquote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton label="Add / edit link" active={editor.isActive("link")} onClick={addLink}>
        <LinkIcon className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label="Remove link"
        disabled={!editor.isActive("link")}
        onClick={() => editor.chain().focus().unsetLink().run()}
      >
        <Unlink className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label="Insert table"
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
      >
        <TableIcon className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-border" />

      {onUploadImage && (
        <label
          className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink transition-colors hover:bg-bg-dashboard aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
          title="Upload image"
          aria-disabled={uploading}
        >
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void insertImageFromFile(file);
            }}
          />
        </label>
      )}
      <ToolbarButton label="Insert image from URL" onClick={insertImageFromUrl}>
        <ImageIcon className="h-4 w-4 opacity-60" aria-hidden="true" />
      </ToolbarButton>

      <div className="relative">
        <ToolbarButton
          label="Special characters"
          active={showSpecialChars}
          onClick={() => setShowSpecialChars((v) => !v)}
        >
          <Smile className="h-4 w-4" aria-hidden="true" />
        </ToolbarButton>
        {showSpecialChars && (
          <div className="absolute left-0 top-9 z-20 grid w-48 grid-cols-6 gap-0.5 rounded-md border border-border bg-white p-1.5 shadow-lg">
            {SPECIAL_CHARS.map((ch) => (
              <button
                key={ch}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  editor.chain().focus().insertContent(ch).run();
                  setShowSpecialChars(false);
                }}
                className="flex h-7 w-7 items-center justify-center rounded text-sm text-ink hover:bg-bg-dashboard"
              >
                {ch}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mx-1 h-5 w-px bg-border" />

      <ToolbarButton
        label="Undo"
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label="Redo"
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>

      <div className="ml-auto flex items-center gap-1">
        <ToolbarButton label="Toggle HTML source view" active={sourceMode} onClick={onToggleSourceMode}>
          <Code2 className="h-4 w-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label={fullscreen ? "Exit full screen" : "Full screen"}
          active={fullscreen}
          onClick={onToggleFullscreen}
        >
          {fullscreen ? (
            <Minimize2 className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          )}
        </ToolbarButton>
      </div>
    </div>
  );
}

/**
 * Product description rich-text editor (spec item #1) — shared by the
 * single-product form and (via the same component) any future bulk-entry
 * description modal, so behavior can never drift between the two entry
 * paths. Sanitizes on blur/source-apply client-side as a UX nicety only —
 * packages/catalog/src/product-submission.ts's sanitizeProductRichText
 * call at save time is the real security boundary, not this component.
 */
export function RichTextEditor({
  id,
  value,
  onChange,
  onUploadImage,
  placeholder,
  error,
  disabled,
}: {
  /** Set on the outer wrapper so a "jump to this field" error-banner link (`document.getElementById(id)?.scrollIntoView()`) still works, matching every other form field's convention. */
  id?: string;
  value: string;
  onChange: (html: string) => void;
  onUploadImage?: (file: File) => Promise<ImageUploadResult>;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceValue, setSourceValue] = useState(value);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TextAlign.configure({ types: ["paragraph", "heading"] }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Image,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value,
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
    editorProps: {
      attributes: {
        class:
          "k4u-rich-content min-h-[140px] max-w-none px-3 py-2.5 text-sm text-ink outline-none",
      },
      // "Paste as plain text or from Word" — strips MS Office's cruft
      // (mso-* styles, <o:p> tags, class attributes) before ProseMirror
      // even parses the pasted HTML, rather than trying to allowlist that
      // noise away after the fact.
      transformPastedHTML: (html) =>
        html
          .replace(/<o:p\s*\/?>(.*?)<\/o:p>/gi, "$1")
          .replace(/\sclass="[^"]*"/gi, "")
          .replace(/\sstyle="[^"]*mso-[^"]*"/gi, "")
          .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, ""),
    },
  });

  // Keep the editor in sync when `value` changes from outside (e.g. the
  // product-edit form finishing its initial load) without fighting the
  // user's own typing — only resets when the editor doesn't already have
  // this exact content.
  useEffect(() => {
    if (editor && !sourceMode && editor.getHTML() !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (!sourceMode) setSourceValue(value);
  }, [sourceMode, value]);

  async function applySource() {
    // Dynamic import keeps sanitize-html (and its parser deps) out of the
    // editor's initial client bundle — only loaded the moment someone
    // actually opens source view.
    const { sanitizeProductRichText } = await import("@kisan4u/validators");
    const clean = sanitizeProductRichText(sourceValue);
    onChange(clean);
    editor?.commands.setContent(clean, { emitUpdate: false });
    setSourceMode(false);
  }

  if (!editor) return null;

  return (
    <div
      id={id}
      tabIndex={-1}
      className={`flex flex-col rounded-md border-[1.5px] bg-white ${error ? "border-danger" : "border-border"} ${
        fullscreen ? "fixed inset-4 z-50 shadow-2xl" : ""
      }`}
    >
      <Toolbar
        editor={editor}
        fullscreen={fullscreen}
        onToggleFullscreen={() => setFullscreen((v) => !v)}
        sourceMode={sourceMode}
        onToggleSourceMode={() => setSourceMode((v) => !v)}
        onUploadImage={onUploadImage}
      />
      {sourceMode ? (
        <div className="flex flex-col gap-2 p-2">
          <textarea
            value={sourceValue}
            onChange={(e) => setSourceValue(e.target.value)}
            rows={fullscreen ? 20 : 8}
            className="w-full resize-y rounded-md border border-border bg-bg-dashboard/40 p-2 font-mono text-xs text-ink outline-none focus:border-green-600"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => void applySource()}
            className="self-start rounded-md bg-green-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-800"
          >
            Apply (sanitized)
          </button>
        </div>
      ) : (
        <div className={fullscreen ? "flex-1 overflow-y-auto" : ""}>
          <EditorContent editor={editor} />
        </div>
      )}
      {error && (
        <span role="alert" className="border-t border-border px-3 py-1.5 text-xs font-medium text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
