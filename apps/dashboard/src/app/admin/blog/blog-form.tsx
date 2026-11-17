"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  PageContainer,
  PageHeader,
  FormInput,
  FormTextarea,
  FormSelect,
  Button,
  AlertBox,
  ImageUploadField,
  Modal,
  type ImageUploadResult,
} from "@kisan4u/ui";
import { RichTextEditor } from "@kisan4u/ui/RichTextEditor";
import type { BlogInput } from "@kisan4u/validators";
import { buildStorefrontAssetUrl } from "@/lib/storefront-url";
import {
  createBlogAction,
  updateBlogAction,
  uploadBlogImageAction,
  createBlogCategoryAction,
} from "./actions";

const ADD_NEW_CATEGORY = "__add_new_category__";
const META_DESCRIPTION_RECOMMENDED_MAX = 160;
const META_DESCRIPTION_MAX = 300;

export type BlogFormInitial = {
  id: string;
  title: string;
  slug: string;
  headerImageUrl: string;
  headerImageAlt: string;
  categoryId: string;
  bodyHtml: string;
  writer: string;
  metaDescription: string;
  featuredPosition: number | null;
};

function newClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `blog-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function BlogForm({
  mode,
  initial,
  categories: initialCategories,
  publicBaseUrl,
}: {
  mode: "create" | "edit";
  initial?: BlogFormInitial;
  categories: { id: string; name: string }[];
  /** The storefront's own origin, read server-side from STOREFRONT_PUBLIC_URL — never hardcoded, and null in an environment where it isn't configured (the preview then just shows the path). */
  publicBaseUrl: string | null;
}) {
  const router = useRouter();
  const [categories, setCategories] = useState(initialCategories);
  const [clientImageId] = useState(() => initial?.id ?? newClientId());

  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [headerImageUrl, setHeaderImageUrl] = useState(initial?.headerImageUrl ?? "");
  const [headerImageAlt, setHeaderImageAlt] = useState(initial?.headerImageAlt ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [bodyHtml, setBodyHtml] = useState(initial?.bodyHtml ?? "");
  const [writer, setWriter] = useState(initial?.writer ?? "");
  const [metaDescription, setMetaDescription] = useState(initial?.metaDescription ?? "");
  const [featuredPositionInput, setFeaturedPositionInput] = useState(
    initial?.featuredPosition != null ? String(initial.featuredPosition) : "",
  );
  const [imageUploading, setImageUploading] = useState(false);

  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addCategoryError, setAddCategoryError] = useState<string | null>(null);
  const [addCategorySuccess, setAddCategorySuccess] = useState(false);
  const [isAddingCategory, startAddingCategory] = useTransition();

  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => {
      setDirty(true);
      setter(v);
    };
  }

  const urlPreview = useMemo(() => {
    const path = `/blog/${slug || "your-url"}`;
    return publicBaseUrl ? `${publicBaseUrl.replace(/\/$/, "")}${path}` : path;
  }, [slug, publicBaseUrl]);

  async function handleHeaderImageUpload(file: File): Promise<ImageUploadResult> {
    return uploadBlogImageAction(clientImageId, slug || "blog", file);
  }

  function handleCategoryChange(value: string) {
    if (value === ADD_NEW_CATEGORY) {
      setAddCategoryOpen(true);
      return;
    }
    markDirty(setCategoryId)(value);
  }

  function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    setAddCategoryError(null);
    setAddCategorySuccess(false);
    startAddingCategory(async () => {
      const result = await createBlogCategoryAction(newCategoryName);
      if (!result.ok) {
        setAddCategoryError(result.error);
        return;
      }
      const created = result.data!;
      setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setCategoryId(created.id);
      setDirty(true);
      setAddCategorySuccess(true);
      setNewCategoryName("");
      setTimeout(() => {
        setAddCategoryOpen(false);
        setAddCategorySuccess(false);
      }, 700);
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input: BlogInput = {
      title,
      slug,
      headerImageUrl,
      headerImageAlt,
      categoryId,
      bodyHtml,
      writer,
      metaDescription,
      featuredPosition: featuredPositionInput.trim() === "" ? null : Number(featuredPositionInput),
    };
    startSaving(async () => {
      setDirty(false);
      const result =
        mode === "create"
          ? await createBlogAction(input)
          : await updateBlogAction(initial!.id, input);
      // A successful save redirects server-side (see actions.ts) — reaching
      // here at all means it didn't, i.e. this is the error path.
      if (result && !result.ok) {
        setDirty(true);
        setError(result.error);
      }
    });
  }

  function handleCancel() {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    router.push("/admin/blog");
  }

  const metaLength = metaDescription.length;

  return (
    <PageContainer maxWidth="900px" className="py-8">
      <PageHeader title={mode === "create" ? "Add New Blog" : "Edit Blog"} />
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <Card className="flex flex-col gap-4 p-5">
          <FormInput
            id="title"
            label="Title"
            value={title}
            onChange={(e) => markDirty(setTitle)(e.target.value)}
            required
            maxLength={200}
          />

          <div>
            <FormInput
              id="slug"
              label="Custom URL"
              value={slug}
              onChange={(e) => markDirty(setSlug)(e.target.value)}
              required
              hint="The part of the address after /blog/ — letters, numbers, and hyphens only. This controls the public page's URL."
            />
            <p className="mt-1 truncate text-xs text-gray-500">
              Preview: <span className="font-mono text-green-700">{urlPreview}</span>
            </p>
          </div>

          <ImageUploadField
            label="Header image"
            value={headerImageUrl}
            onChange={markDirty(setHeaderImageUrl)}
            onUpload={handleHeaderImageUpload}
            onUploadingChange={setImageUploading}
            required
            resolveDisplaySrc={(url) => (url ? buildStorefrontAssetUrl(url, publicBaseUrl) : url)}
          />
          <FormInput
            id="headerImageAlt"
            label="Header image alt text"
            value={headerImageAlt}
            onChange={(e) => markDirty(setHeaderImageAlt)(e.target.value)}
            required
            hint="Describes the image for screen readers and search engines."
          />

          <FormSelect
            id="categoryId"
            label="Category"
            value={categoryId}
            onChange={(e) => handleCategoryChange(e.target.value)}
            required
          >
            <option value="" disabled>
              — Select a category —
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option disabled>──────────</option>
            <option value={ADD_NEW_CATEGORY}>+ Add New Category</option>
          </FormSelect>
        </Card>

        <Card className="flex flex-col gap-2 p-5">
          <label className="text-[13px] font-semibold text-ink">
            Blog body <span className="text-danger">*</span>
          </label>
          <RichTextEditor
            id="bodyHtml"
            value={bodyHtml}
            onChange={markDirty(setBodyHtml)}
            onUploadImage={(file) => uploadBlogImageAction(clientImageId, slug || "blog", file)}
            placeholder="Write your blog…"
          />
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <FormInput
            id="writer"
            label="Writer"
            value={writer}
            onChange={(e) => markDirty(setWriter)(e.target.value)}
            placeholder="Kisan4U Editor"
            hint='Optional — left blank, the blog is credited to "Kisan4U Editor".'
          />

          <div>
            <FormTextarea
              id="metaDescription"
              label="Meta description"
              value={metaDescription}
              onChange={(e) => markDirty(setMetaDescription)(e.target.value)}
              required
              rows={3}
              maxLength={META_DESCRIPTION_MAX}
              hint="Used for search results and social previews."
            />
            <p
              className={`mt-1 text-xs ${metaLength > META_DESCRIPTION_RECOMMENDED_MAX ? "text-warning" : "text-gray-500"}`}
            >
              {metaLength}/{META_DESCRIPTION_RECOMMENDED_MAX} recommended
              {metaLength > META_DESCRIPTION_RECOMMENDED_MAX ? " — a bit long for search results" : ""}
            </p>
          </div>

          <FormInput
            id="featuredPosition"
            label="Featured position"
            type="number"
            min={1}
            step={1}
            value={featuredPositionInput}
            onChange={(e) => markDirty(setFeaturedPositionInput)(e.target.value)}
            hint="Leave blank to keep this blog off the homepage. A number places it in the homepage carousel, ordered lowest first — an already-used position shifts the other featured blogs along."
          />
        </Card>

        {error && <AlertBox tone="danger">{error}</AlertBox>}

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={isSaving} disabled={imageUploading}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>

      <Modal open={addCategoryOpen} onClose={() => setAddCategoryOpen(false)} title="Add New Category">
        <form onSubmit={handleAddCategory} className="flex flex-col gap-3">
          <FormInput
            id="newCategoryName"
            label="Category name"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            required
            autoFocus
          />
          {addCategoryError && <AlertBox tone="danger">{addCategoryError}</AlertBox>}
          {addCategorySuccess && <AlertBox tone="success">Category created.</AlertBox>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setAddCategoryOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={isAddingCategory}>
              Save category
            </Button>
          </div>
        </form>
      </Modal>
    </PageContainer>
  );
}
