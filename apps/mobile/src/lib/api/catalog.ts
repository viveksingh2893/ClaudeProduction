import { api } from "@/lib/api-client";
import type {
  CategoryNode,
  CustomerProductDTO,
  HeroBannerDTO,
  HomepageBrandDTO,
  HomepageCategoryDTO,
  HomepageCategoryRowDTO,
  HomepageSubcategoryRowDTO,
  HomepageCropPestDTO,
  ReviewRow,
} from "./types";

export type ProductListResponse = {
  items: CustomerProductDTO[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
};

/**
 * The active content language (Prisma enum form: EN/HI/MR/TE/TA) only ever
 * needs to travel on the wire when it isn't English — the server defaults
 * to EN and keeps those responses cacheable. `withLang` appends `?lang=`
 * exactly like apps/web adds the `k4u_lang` cookie, so banners and
 * translatable product text come back localized (the previous mobile
 * client resolved `dbLang` but never sent it — banners never switched).
 */
function withLang(path: string, lang?: string | null): string {
  if (!lang || lang === "EN") return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}lang=${encodeURIComponent(lang)}`;
}

export function getCategories(lang?: string | null) {
  return api.get<{ categories: CategoryNode[] }>(
    withLang("/api/mobile/v1/catalog/categories", lang),
    { auth: false },
  );
}

export function getHomepage(lang?: string | null) {
  return api.get<{
    audience: "CUSTOMER" | "DEALER";
    model: { sections: unknown[] };
    heroBanners: HeroBannerDTO[];
    couponBanners: HeroBannerDTO[];
    secondaryBanners: HeroBannerDTO[];
    categories: HomepageCategoryDTO[];
    brands: HomepageBrandDTO[];
    trending: CustomerProductDTO[];
    bestSellers: CustomerProductDTO[];
    newArrivals: CustomerProductDTO[];
    crops: HomepageCropPestDTO[];
    pestsDiseases: HomepageCropPestDTO[];
    categoryRows: HomepageCategoryRowDTO[];
    subcategoryRows: HomepageSubcategoryRowDTO[];
  }>(withLang("/api/mobile/v1/catalog/homepage", lang));
}

export function getProducts(params: {
  category?: string;
  subCategory?: string;
  subSubCategory?: string;
  brand?: string;
  crop?: string;
  pest?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  lang?: string | null;
}) {
  const { lang, ...rest } = params;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined && value !== "") qs.set(key, String(value));
  }
  if (lang && lang !== "EN") qs.set("lang", lang);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return api.get<ProductListResponse>(`/api/mobile/v1/catalog/products${suffix}`, { auth: false });
}

export function getProductBySlug(slug: string, lang?: string | null) {
  return api.get<{
    product: CustomerProductDTO;
    isWishlisted: boolean;
    similar: CustomerProductDTO[];
    reviews: {
      rows: ReviewRow[];
      canReview: boolean;
      ineligibleReason: string | null;
      myReview: { id: string; rating: number; comment: string | null } | null;
    };
  }>(withLang(`/api/mobile/v1/catalog/products/${encodeURIComponent(slug)}`, lang));
}

/** Resolve a dealer deep-link id without exposing dealer-only product data. */
export function resolveCustomerProductById(id: string) {
  return api.get<{ slug: string }>(
    `/api/mobile/v1/catalog/products/by-id/${encodeURIComponent(id)}`,
  );
}

export type CategoryDetailResponse = {
  category: {
    id: string;
    name: string;
    slug: string;
    emoji: string | null;
    imageUrl: string | null;
    description: string;
  };
  heroBanners: HeroBannerDTO[];
  subcategories: { id: string; name: string; slug: string; imageUrl: string | null }[];
};

/** One category's page data — hero banner carousel + subcategory tiles (the product feed is paged separately via getProducts). Mirrors apps/web/src/app/c/[slug]/page.tsx. */
export function getCategoryDetail(slug: string, lang?: string | null) {
  return api.get<CategoryDetailResponse>(
    withLang(`/api/mobile/v1/catalog/categories/${encodeURIComponent(slug)}`, lang),
    { auth: false },
  );
}

export type SubcategoryDetailResponse = {
  subCategory: {
    id: string;
    name: string;
    slug: string;
    imageUrl: string | null;
    description: string;
  };
  category: { id: string; name: string; slug: string };
  subSubCategories: { id: string; name: string; slug: string; imageUrl: string | null }[];
};

/** One sub-category's page data — description + sub-sub-category tiles (the product feed is paged separately via getProducts). Mirrors apps/web/src/app/c/[slug]/[sub]/page.tsx. */
export function getSubcategoryDetail(slug: string, lang?: string | null) {
  return api.get<SubcategoryDetailResponse>(
    withLang(`/api/mobile/v1/catalog/subcategories/${encodeURIComponent(slug)}`, lang),
    { auth: false },
  );
}

export type SubSubCategoryDetailResponse = {
  subSubCategory: {
    id: string;
    name: string;
    slug: string;
    imageUrl: string | null;
    description: string;
  };
  subCategory: { id: string; name: string; slug: string };
  category: { id: string; name: string; slug: string };
};

/** One sub-sub-category's (leaf) page data — description only, product feed is paged separately via getProducts. Mirrors apps/web/src/app/c/[slug]/[sub]/[subsub]/page.tsx. */
export function getSubSubCategoryDetail(slug: string, lang?: string | null) {
  return api.get<SubSubCategoryDetailResponse>(
    withLang(`/api/mobile/v1/catalog/sub-subcategories/${encodeURIComponent(slug)}`, lang),
    { auth: false },
  );
}

export function getCatalogueTag(kind: "crop" | "pest-disease", slug: string) {
  return api.get<{ tag: { id: string; name: string; slug: string } }>(
    `/api/mobile/v1/catalog/tags/${kind}/${encodeURIComponent(slug)}`,
    { auth: false },
  );
}
