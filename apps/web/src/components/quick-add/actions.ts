"use server";

import {
  getCustomerProductById,
  getDealerProductDetail,
  resolveCustomerCatalogueStateId,
} from "@kisan4u/catalog";
import { getDealerProfileForUser } from "@kisan4u/auth";
import type { PlainVariant } from "@kisan4u/ui";
import { auth } from "@/auth";

/**
 * Data for the storefront "Select size" quick-add popup — the same modal
 * shape the dashboard POS uses (VariantPicker + price + Add to Cart), but
 * audience-resolved from the live storefront session and with no stock
 * numbers exposed (the popup only needs the boolean "is this in stock").
 * A signed-in dealer gets dealer pricing + their state's availability; a
 * customer (or guest) gets the customer catalogue.
 */
export type QuickAddVariant = PlainVariant;

export type QuickAddDetail = {
  productId: string;
  name: string;
  sellerName: string | null;
  shortDescription: string;
  images: { id: string; url: string; altText: string | null }[];
  variants: QuickAddVariant[];
  defaultVariantId: string | null;
  baseConfig: { minOrderQty: number; mrp: number; sellingPrice: number; inStock: boolean } | null;
  /** false when the product can't be added from here at all (dealer state-unavailable / request-only) — the popup then points at the full product page. */
  purchasable: boolean;
  unavailableReason: string | null;
};

export type QuickAddResult =
  | { ok: true; data: QuickAddDetail }
  | { ok: false; error: string };

type RawVariant = {
  id: string;
  isActive: boolean;
  stockQty: number;
  sku: string;
  mrp: { toString(): string };
  sellingPrice: { toString(): string };
  minOrderQty: number;
  imageUrl: string | null;
  imageAlt: string | null;
  videoUrl?: string | null;
  loyaltyPoints?: number | null;
  images?: Array<{ id: string; url: string; altText: string | null }>;
  values: Array<{
    attributeValue: { id: string; value: string; attributeId: string; attribute: { name: string } };
  }>;
};

function toPlainVariants(variants: RawVariant[]): PlainVariant[] {
  return variants.map((v) => ({
    id: v.id,
    isActive: v.isActive,
    stockQty: v.stockQty,
    sku: v.sku,
    mrp: v.mrp.toString(),
    sellingPrice: v.sellingPrice.toString(),
    minOrderQty: v.minOrderQty,
    imageUrl: v.imageUrl,
    imageAlt: v.imageAlt,
    images: (v.images ?? []).map((img) => ({ id: img.id, url: img.url, altText: img.altText })),
    videoUrl: v.videoUrl ?? null,
    loyaltyPoints: v.loyaltyPoints ?? null,
    attributeValues: v.values.map((val) => ({
      attributeId: val.attributeValue.attributeId,
      attributeName: val.attributeValue.attribute.name,
      valueId: val.attributeValue.id,
      value: val.attributeValue.value,
    })),
  }));
}

export async function getQuickAddDetailAction(productId: string): Promise<QuickAddResult> {
  if (typeof productId !== "string" || productId.length === 0) {
    return { ok: false, error: "Invalid product." };
  }

  const session = await auth();

  if (session?.user.role === "DEALER") {
    const profile = await getDealerProfileForUser(session.user.id);
    if (!profile || profile.status !== "APPROVED") {
      return { ok: false, error: "Product not available." };
    }
    const product = await getDealerProductDetail(productId, profile.stateId);
    if (!product) return { ok: false, error: "Product not found." };

    return {
      ok: true,
      data: {
        productId: product.id,
        name: product.name,
        sellerName: product.seller?.shopName ?? null,
        shortDescription: product.shortDescription ?? "",
        images:
          product.images.length > 0
            ? product.images.map((img) => ({ id: img.id, url: img.url, altText: img.altText }))
            : [{ id: "primary", url: product.primaryImageUrl, altText: product.name }],
        variants: toPlainVariants(product.variants as RawVariant[]),
        defaultVariantId: product.variants.find((v) => v.isDefault)?.id ?? null,
        baseConfig: product.dealerConfig
          ? {
              minOrderQty: product.dealerConfig.minOrderQty,
              mrp: Number(product.dealerConfig.mrp),
              sellingPrice: Number(product.dealerConfig.sellingPrice),
              inStock: (product.dealerConfig.currentStock ?? 0) > 0,
            }
          : null,
        purchasable: product.availableInState,
        unavailableReason: product.availableInState
          ? null
          : "This product isn't available in your state yet. Open the product page to request it from the seller.",
      },
    };
  }

  const customerStateId =
    session?.user.role === "CUSTOMER"
      ? await resolveCustomerCatalogueStateId(session.user.id)
      : undefined;
  const product = await getCustomerProductById(productId, customerStateId);
  if (!product) return { ok: false, error: "Product not found." };

  return {
    ok: true,
    data: {
      productId: product.id,
      name: product.name,
      sellerName: product.seller?.shopName ?? null,
      shortDescription: product.shortDescription ?? "",
      images:
        product.images.length > 0
          ? product.images.map((img) => ({ id: img.id, url: img.url, altText: img.altText }))
          : [{ id: "primary", url: product.primaryImageUrl, altText: product.name }],
      variants: toPlainVariants(product.variants as RawVariant[]),
      defaultVariantId: product.variants.find((v) => v.isDefault)?.id ?? null,
      baseConfig: product.customerConfig
        ? {
            minOrderQty: product.customerConfig.minOrderQty,
            mrp: Number(product.customerConfig.mrp),
            sellingPrice: Number(product.customerConfig.sellingPrice),
            inStock: (product.customerConfig.currentStock ?? 0) > 0,
          }
        : null,
      purchasable: true,
      unavailableReason: null,
    },
  };
}
