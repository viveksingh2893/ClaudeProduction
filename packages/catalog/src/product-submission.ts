import { prisma } from "@kisan4u/db";
import {
  type ProductSubmissionInput,
  type AudienceSkuAudience,
  calculateSellingPrice,
  matchShippingSlab,
  normalizeAudienceSku,
  sanitizeProductRichText,
  isRichTextEmpty,
} from "@kisan4u/validators";
import { validateCategoryChain } from "./category-hierarchy";
import { syncVariants, type VariantRowInput } from "./variant-generation";
import { getActiveLogisticsConfig, toShippingConfigInput } from "./logistics-pricing";
import {
  buildSellerLicenceEligibilityIndex,
  evaluateEligibilityForPath,
} from "./licence-eligibility";
import { reconcileSingleProductCompliance } from "./licence-compliance";

/** Server-computed shipping cost for one weight value against the config fetched once per submission — null (not zero) when there's no active config or no weight, so "unavailable" is never confused with "free." */
function computeShippingCost(
  weightGrams: number | null | undefined,
  activeConfig: Awaited<ReturnType<typeof getActiveLogisticsConfig>>,
): number | null {
  if (weightGrams == null) return null;
  const result = matchShippingSlab(weightGrams, toShippingConfigInput(activeConfig));
  return result.ok ? result.price : null;
}

/**
 * `productSubmissionSchema`'s superRefine already rejected any sku that
 * `normalizeAudienceSku` can't accept, so `!ok` here would mean the zod
 * validation was bypassed somehow — fail loudly (aborts the transaction)
 * rather than silently persisting an un-suffixed/wrong-suffixed sku.
 */
function finalizeSku(rawSku: string, audience: AudienceSkuAudience): string {
  const result = normalizeAudienceSku(rawSku, audience);
  if (!result.ok) throw new Error(result.error);
  return result.sku;
}

/** Sanitizes an optional rich-text field, collapsing to null when nothing visible remains (an untouched/emptied field is never stored as fake "content" — spec item #1). */
function sanitizeRichTextOrNull(html: string | null | undefined): string | null {
  const sanitized = sanitizeProductRichText(html);
  return isRichTextEmpty(sanitized) ? null : sanitized;
}

export type ApplyProductSubmissionResult =
  { ok: true; productId: string } | { ok: false; error: string };

export type SubmissionContext =
  | { mode: "CREATE"; sellerId: string; asAdmin: false; id?: string }
  | { mode: "UPDATE"; productId: string; asAdmin: boolean };

/**
 * Every non-empty stateIds selection that happens to cover every currently
 * active IndianState is normalized to empty ("nationwide"/"Pan India") —
 * this is what makes Pan India a real, server-verified fact instead of a
 * trusted client boolean (see requirement: never depend only on a
 * browser-side panIndia flag). Anything else is filtered down to just the
 * ids that are actually valid, active states — a bogus or stale id from
 * the client is silently dropped rather than trusted.
 */
function normalizeStateSelection(stateIds: string[], activeIds: Set<string>): string[] {
  const validSubmitted = stateIds.filter((id) => activeIds.has(id));
  const isPanIndia =
    validSubmitted.length === 0 || (activeIds.size > 0 && validSubmitted.length === activeIds.size);
  return isPanIndia ? [] : validSubmitted;
}

/**
 * Never trusts a client-submitted state list past what the seller's own
 * licence eligibility actually allows for this exact taxonomy path and
 * audience (selling-licence module spec §6: "The seller must not be able
 * to create, submit, publish, or update a product with an invalid
 * audience/state configuration... Do not allow API requests, stale
 * browser data, or manually modified form payloads to bypass this
 * restriction."). A seller with zero applicable licence requirements gets
 * back exactly what they submitted (normalized); one with requirements
 * gets clamped down to the intersection with what they're actually
 * eligible for.
 */
async function clampStateSelectionToEligibility(
  sellerId: string,
  taxonomyPath: {
    categoryId: string;
    subCategoryId: string | null;
    subSubCategoryId: string | null;
  },
  customerStateIds: string[],
  dealerStateIds: string[],
): Promise<{ customerStateIds: string[]; dealerStateIds: string[]; activeIds: Set<string> }> {
  const index = await buildSellerLicenceEligibilityIndex(sellerId);
  const activeIds = new Set(index.activeStateIds);
  const normalizedCustomer = normalizeStateSelection(customerStateIds, activeIds);
  const normalizedDealer = normalizeStateSelection(dealerStateIds, activeIds);

  const eligibility = evaluateEligibilityForPath(index, taxonomyPath);
  const eligibleCustomer = new Set(eligibility.customer.eligibleStateIds);
  const eligibleDealer = new Set(eligibility.dealer.eligibleStateIds);

  const clampedCustomer =
    normalizedCustomer.length === 0
      ? [...eligibleCustomer]
      : normalizedCustomer.filter((id) => eligibleCustomer.has(id));
  const clampedDealer =
    normalizedDealer.length === 0
      ? [...eligibleDealer]
      : normalizedDealer.filter((id) => eligibleDealer.has(id));

  // Re-collapse to [] ("Pan India") ONLY when the audience is genuinely
  // Pan-India-eligible right now — never merely because the clamped list
  // happens to be empty. An empty list reads as "Pan India" everywhere
  // else in the app (isProductAvailableForState, catalogue queries), so
  // collapsing to [] for an audience that's actually fully BLOCKED (zero
  // eligible states, e.g. no licence at all) would silently make a
  // non-compliant product look nationwide-available — this was a real bug:
  // a brand-new product saved under a taxonomy path the seller has no
  // licence coverage for got clamped to [] and therefore looked fully
  // open, since nothing else at save time set customerVisible/dealerVisible
  // false (that only happened later, if a compliance reconcile happened to
  // run against it).
  return {
    customerStateIds: finalizeStateSelection(
      clampedCustomer,
      eligibility.customer.isPanIndia,
      activeIds,
    ),
    dealerStateIds: finalizeStateSelection(clampedDealer, eligibility.dealer.isPanIndia, activeIds),
    activeIds,
  };
}

function finalizeStateSelection(
  clampedIds: string[],
  isPanIndiaEligible: boolean,
  activeIds: Set<string>,
): string[] {
  const validIds = clampedIds.filter((id) => activeIds.has(id));
  if (!isPanIndiaEligible) return validIds;
  const isFullCoverage = validIds.length === 0 || validIds.length === activeIds.size;
  return isFullCoverage ? [] : validIds;
}

/**
 * A brand/manufacturer is usable in a product save only if it's APPROVED,
 * and — unless the caller is an admin — either global (ownerSellerId
 * null) or owned by the exact seller saving this product. Re-checked here
 * regardless of what the form showed, since the dropdown options alone
 * are not a security boundary.
 */
async function assertBrandUsable(
  brandId: string | undefined,
  sellerId: string,
  asAdmin: boolean,
): Promise<string | null> {
  if (!brandId) return null;
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand || brand.status !== "APPROVED") return "Selected brand is not approved.";
  if (!asAdmin && brand.ownerSellerId && brand.ownerSellerId !== sellerId) {
    return "You cannot use another seller's private brand.";
  }
  return null;
}

async function assertManufacturerUsable(
  manufacturerId: string | undefined,
  sellerId: string,
  asAdmin: boolean,
): Promise<string | null> {
  if (!manufacturerId) return null;
  const manufacturer = await prisma.manufacturer.findUnique({ where: { id: manufacturerId } });
  if (!manufacturer || manufacturer.status !== "APPROVED")
    return "Selected manufacturer is not approved.";
  if (!asAdmin && manufacturer.ownerSellerId && manufacturer.ownerSellerId !== sellerId) {
    return "You cannot use another seller's private manufacturer.";
  }
  return null;
}

/**
 * `currentStock` is deliberately NOT part of this shared shape — see the
 * two call sites below. Stock quantity, once a product/variant exists, is
 * only ever changed through packages/catalog/src/inventory.ts's
 * recordStockChange (the Product Quantity page's Add/Set actions and
 * order sale/cancellation) so that every change after creation produces
 * an immutable ledger row — spec §6 "do not overwrite inventory without
 * creating a history record." The general product-edit form still
 * collects an initial quantity (used once, at creation, as the opening
 * value — not itself logged as a "change", the same convention most
 * inventory systems use for an opening balance), but silently ignores
 * that field on every subsequent edit rather than letting an unrelated
 * "update the description" save quietly overwrite stock behind the new
 * ledger's back.
 */
function toConfigData(
  config: {
    sku: string;
    hsnCode: string;
    mrp: number;
    discountType: "NONE" | "FLAT" | "PERCENTAGE";
    discountValue: number;
    netPayableAmount?: number;
    minOrderQty: number;
    minStockQty: number;
    reorderLevel: number;
    loyaltyPoints?: number;
    height?: number;
    breadth?: number;
    length?: number;
    weight?: number;
    shippingCalcMode: "INCLUDE_WITH_PRODUCT" | "EXCLUDE_WITH_PRODUCT";
    taxCalcMode: "INCLUDE_WITH_PRICE" | "EXCLUDE_WITH_PRICE";
  },
  audience: AudienceSkuAudience,
  activeLogisticsConfig: Awaited<ReturnType<typeof getActiveLogisticsConfig>>,
) {
  // Money columns are written as fixed 2-decimal STRINGS, never raw JS
  // numbers: a value like 923.32 whose nearest float64 is
  // 923.31999999999998 otherwise reaches Postgres via the pg driver at
  // ~16 significant digits and persists as "923.3200000000001". `.toFixed(2)`
  // hands Prisma the exact decimal text. (Same fix as
  // packages/orders/src/bulk-price-update.ts.)
  const sellingPrice = calculateSellingPrice(config.mrp, config.discountType, config.discountValue);
  return {
    sku: finalizeSku(config.sku, audience),
    hsnCode: config.hsnCode,
    mrp: config.mrp.toFixed(2),
    discountType: config.discountType,
    discountValue: config.discountValue.toFixed(2),
    netPayableAmount: config.netPayableAmount != null ? config.netPayableAmount.toFixed(2) : null,
    sellingPrice: sellingPrice.toFixed(2),
    minOrderQty: config.minOrderQty,
    minStockQty: config.minStockQty,
    reorderLevel: config.reorderLevel,
    loyaltyPoints: config.loyaltyPoints ?? 0,
    height: config.height ?? null,
    breadth: config.breadth ?? null,
    length: config.length ?? null,
    weight: config.weight ?? null,
    shippingCost: computeShippingCost(config.weight, activeLogisticsConfig),
    taxCalcMode: config.taxCalcMode,
    // Spec item #2: dealer pricing can never be marked shipping-inclusive
    // — enforced here server-side (not just hidden in the form UI) so a
    // hand-crafted request can't set it either. Customer behaviour is
    // untouched.
    shippingCalcMode: audience === "DEALER" ? "EXCLUDE_WITH_PRODUCT" : config.shippingCalcMode,
  };
}

export async function applyProductSubmission(
  input: ProductSubmissionInput,
  context: SubmissionContext,
): Promise<ApplyProductSubmissionResult> {
  const sellerId =
    context.mode === "CREATE"
      ? context.sellerId
      : ((
          await prisma.product.findUnique({
            where: { id: context.productId },
            select: { sellerId: true },
          })
        )?.sellerId ?? null);
  if (!sellerId) return { ok: false, error: "Product not found or has no owning seller." };
  const asAdmin = context.mode === "UPDATE" && context.asAdmin;

  const chainCheck = await validateCategoryChain(
    input.categoryId,
    input.subCategoryId || null,
    input.subSubCategoryId || null,
  );
  if (!chainCheck.ok) return { ok: false, error: chainCheck.error };

  const brandError = await assertBrandUsable(input.brandId, sellerId, asAdmin);
  if (brandError) return { ok: false, error: brandError };
  const manufacturerError = await assertManufacturerUsable(input.manufacturerId, sellerId, asAdmin);
  if (manufacturerError) return { ok: false, error: manufacturerError };

  const excludeId = context.mode === "UPDATE" ? context.productId : undefined;
  const [slugClash, skuClash] = await Promise.all([
    prisma.product.findFirst({
      where: { slug: input.slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
    }),
    prisma.product.findFirst({
      where: { sku: input.sku, ...(excludeId ? { id: { not: excludeId } } : {}) },
    }),
  ]);
  if (slugClash) return { ok: false, error: "This slug is already in use by another product." };
  if (skuClash) return { ok: false, error: "This SKU is already in use by another product." };

  // Every sellable-unit SKU this submission would write — variant rows AND
  // (spec item #4, extended to simple products) the customer/dealer base
  // config rows — normalized up front so both the in-submission duplicate
  // check and the DB clash check compare the exact final values, not the
  // raw pre-suffix strings the form sent. finalizeSku only throws when the
  // zod validation that already ran on this input was somehow bypassed;
  // caught here (outside the transaction) so that can never surface as a
  // raw 500 instead of a normal validation error.
  let unitSkuEntries: { sku: string; label: string }[];
  try {
    unitSkuEntries = [
      ...(input.customerConfig
        ? [
            {
              sku: finalizeSku(input.customerConfig.sku, "CUSTOMER"),
              label: "Customer configuration",
            },
          ]
        : []),
      ...(input.dealerConfig
        ? [{ sku: finalizeSku(input.dealerConfig.sku, "DEALER"), label: "Dealer configuration" }]
        : []),
      ...input.customerVariants.map((v) => ({
        sku: finalizeSku(v.sku, "CUSTOMER"),
        label: "Customer variant",
      })),
      ...input.dealerVariants.map((v) => ({
        sku: finalizeSku(v.sku, "DEALER"),
        label: "Dealer variant",
      })),
    ];
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid SKU." };
  }

  const seenUnitSkus = new Map<string, string>();
  for (const entry of unitSkuEntries) {
    const priorLabel = seenUnitSkus.get(entry.sku);
    if (priorLabel) {
      return {
        ok: false,
        error: `SKU "${entry.sku}" is used by both ${priorLabel} and ${entry.label} in this submission — every sellable unit needs its own SKU.`,
      };
    }
    seenUnitSkus.set(entry.sku, entry.label);
  }

  if (unitSkuEntries.length > 0) {
    const unitSkus = unitSkuEntries.map((e) => e.sku);
    const productIdFilter = excludeId ? { id: { not: excludeId } } : {};
    const productIdColumnFilter = excludeId ? { productId: { not: excludeId } } : {};
    const [productClash, variantClash, customerConfigClash, dealerConfigClash] = await Promise.all([
      prisma.product.findFirst({ where: { sku: { in: unitSkus }, ...productIdFilter } }),
      prisma.productVariant.findFirst({ where: { sku: { in: unitSkus }, ...productIdColumnFilter } }),
      prisma.productCustomerConfig.findFirst({
        where: { sku: { in: unitSkus }, ...productIdColumnFilter },
      }),
      prisma.productDealerConfig.findFirst({
        where: { sku: { in: unitSkus }, ...productIdColumnFilter },
      }),
    ]);
    const clash = productClash ?? variantClash ?? customerConfigClash ?? dealerConfigClash;
    if (clash) {
      return {
        ok: false,
        error: `SKU "${clash.sku}" is already in use by another product.`,
      };
    }
  }

  const { customerStateIds, dealerStateIds } = await clampStateSelectionToEligibility(
    sellerId,
    {
      categoryId: input.categoryId,
      subCategoryId: input.subCategoryId || null,
      subSubCategoryId: input.subSubCategoryId || null,
    },
    input.customerStateIds,
    input.dealerStateIds,
  );

  // Homepage redesign, phase B — merchandising-only crop/pest tags. Unknown
  // or inactive ids are dropped here rather than rejected, so a stale
  // selection never blocks a save (mirrors normalizeStateSelection).
  const [validCropIds, validPestDiseaseIds] = await Promise.all([
    input.cropIds.length > 0
      ? prisma.crop
          .findMany({ where: { id: { in: input.cropIds } }, select: { id: true } })
          .then((rows) => rows.map((r) => r.id))
      : Promise.resolve<string[]>([]),
    input.pestDiseaseIds.length > 0
      ? prisma.pestDisease
          .findMany({ where: { id: { in: input.pestDiseaseIds } }, select: { id: true } })
          .then((rows) => rows.map((r) => r.id))
      : Promise.resolve<string[]>([]),
  ]);
  // Fetched once per submission (not once per config/variant) — every
  // shippingCost computed below uses this exact same snapshot, so a
  // product with several variants gets internally consistent results
  // even if an admin edits logistics pricing in the middle of an
  // unrelated request.
  const activeLogisticsConfig = await getActiveLogisticsConfig();

  const needsCustomer =
    input.audience === "CUSTOMER_ONLY" || input.audience === "BOTH_CUSTOMER_AND_DEALER";
  const needsDealer =
    input.audience === "DEALER_ONLY" || input.audience === "BOTH_CUSTOMER_AND_DEALER";

  // Admin-only merchandising fields (spec: "sellers must not be able to
  // manipulate these fields through the UI or direct API requests").
  // Never trust `input` for these when the caller isn't an admin — but
  // also never blindly reset them to empty on every routine seller edit,
  // which would silently erase whatever an admin previously set. Instead,
  // a non-admin submission always carries forward whatever the product
  // already has (nothing, for a brand-new seller-created product).
  let merchandising: {
    editorialBadgeId: string | null;
    availabilityBadgeMode: "AUTOMATIC" | "MANUAL" | "OFF";
    availabilityBadgeText: string | null;
    deliveryBadgeEnabled: boolean;
    deliveryBadgeText: string | null;
    featuredPosition: number | null;
  };
  if (asAdmin) {
    merchandising = {
      editorialBadgeId: input.editorialBadgeId || null,
      availabilityBadgeMode: input.availabilityBadgeMode,
      availabilityBadgeText: input.availabilityBadgeText || null,
      deliveryBadgeEnabled: input.deliveryBadgeEnabled,
      deliveryBadgeText: input.deliveryBadgeText || null,
      featuredPosition: input.featuredPosition ?? null,
    };
  } else if (context.mode === "UPDATE") {
    const current = await prisma.product.findUnique({
      where: { id: context.productId },
      select: {
        editorialBadgeId: true,
        availabilityBadgeMode: true,
        availabilityBadgeText: true,
        deliveryBadgeEnabled: true,
        deliveryBadgeText: true,
        featuredPosition: true,
      },
    });
    merchandising = current ?? {
      editorialBadgeId: null,
      availabilityBadgeMode: "AUTOMATIC",
      availabilityBadgeText: null,
      deliveryBadgeEnabled: false,
      deliveryBadgeText: null,
      featuredPosition: null,
    };
  } else {
    merchandising = {
      editorialBadgeId: null,
      availabilityBadgeMode: "AUTOMATIC",
      availabilityBadgeText: null,
      deliveryBadgeEnabled: false,
      deliveryBadgeText: null,
      featuredPosition: null,
    };
  }

  const productData = {
    name: input.name,
    slug: input.slug,
    sku: input.sku,
    hsnCode: input.hsnCode,
    taxPercent: input.taxPercent,
    // Data-capture only for this feature: the actual mrp/discount/
    // sellingPrice written below are the same regardless of mode (a
    // NET_PAYABLE submission arrives here with its discount already
    // back-solved by the server action). Stored so the edit form reopens
    // in the mode the seller used — see the PriceEntryMode enum.
    priceEntryMode: input.priceEntryMode,
    // Every rich-text field is sanitized here — the one place HTML from
    // the product form is allowed to reach the database (spec item #1;
    // see sanitizeProductRichText's doc comment). zod already validated
    // shortDescription/description have enough VISIBLE text, but that ran
    // against the raw (unsanitized) input — sanitizing can only remove
    // markup, never add visible text, so re-checking emptiness isn't
    // needed for these two required fields. The four optional fields
    // collapse to null when sanitization leaves nothing visible (e.g. the
    // editor produced "<p><br></p>"), so an untouched field never gets
    // stored as fake "content".
    shortDescription: sanitizeProductRichText(input.shortDescription),
    description: sanitizeProductRichText(input.description),
    ingredients: sanitizeRichTextOrNull(input.ingredients),
    howToUse: sanitizeRichTextOrNull(input.howToUse),
    dosageInstructions: sanitizeRichTextOrNull(input.dosageInstructions),
    technicalInfo: sanitizeRichTextOrNull(input.technicalInfo),
    manufacturerId: input.manufacturerId || null,
    brandId: input.brandId || null,
    categoryId: input.categoryId,
    subCategoryId: input.subCategoryId || null,
    subSubCategoryId: input.subSubCategoryId || null,
    productType: input.productType,
    audience: input.audience,
    baseUnit: input.baseUnit,
    packageSize: input.packageSize || "",
    searchTags: input.searchTags,
    featuredPosition: merchandising.featuredPosition,
    customerVisible: input.customerVisible,
    dealerVisible: input.dealerVisible,
    primaryImageUrl: input.primaryImageUrl,
    videoUrl: input.videoUrl || null,
    metaTitle: input.metaTitle || null,
    metaDescription: input.metaDescription || null,
    metaImageUrl: input.metaImageUrl || null,
    canonicalUrl: input.canonicalUrl || null,
    // Product Card Design Spec §Admin Panel Controls — admin-only, see
    // the `merchandising` block above.
    subtitle: input.subtitle || null,
    editorialBadgeId: merchandising.editorialBadgeId,
    deliveryBadgeEnabled: merchandising.deliveryBadgeEnabled,
    deliveryBadgeText: merchandising.deliveryBadgeText,
    availabilityBadgeMode: merchandising.availabilityBadgeMode,
    availabilityBadgeText: merchandising.availabilityBadgeText,
  };

  let productId: string;
  try {
    productId = await prisma.$transaction(async (tx) => {
      let id: string;
      if (context.mode === "CREATE") {
        const created = await tx.product.create({
          data: {
            ...(context.id ? { id: context.id } : {}),
            ...productData,
            sellerId,
            lifecycleStatus: "DRAFT",
            customerAvailableStates: { connect: customerStateIds.map((sid) => ({ id: sid })) },
            dealerAvailableStates: { connect: dealerStateIds.map((sid) => ({ id: sid })) },
            crops: { connect: validCropIds.map((cid) => ({ id: cid })) },
            pestsDiseases: { connect: validPestDiseaseIds.map((pid) => ({ id: pid })) },
          },
        });
        id = created.id;
      } else {
        id = context.productId;
        await tx.product.update({
          where: { id },
          data: {
            ...productData,
            customerAvailableStates: { set: customerStateIds.map((sid) => ({ id: sid })) },
            dealerAvailableStates: { set: dealerStateIds.map((sid) => ({ id: sid })) },
            crops: { set: validCropIds.map((cid) => ({ id: cid })) },
            pestsDiseases: { set: validPestDiseaseIds.map((pid) => ({ id: pid })) },
          },
        });
        await tx.productImage.deleteMany({ where: { productId: id } });
      }

      if (input.images.length > 0) {
        await tx.productImage.createMany({
          data: input.images.map((img) => ({
            productId: id,
            url: img.url,
            altText: img.altText || null,
            position: img.position,
            isActive: img.isActive,
          })),
        });
      }

      // Per-language description overrides (storefront i18n). English lives
      // on the Product row written above and is the source + per-field
      // fallback; each entry here is one non-English language, its six
      // rich-text fields run through the exact same sanitizer. A language
      // whose fields are all empty after sanitizing is removed rather than
      // stored blank. `translations` is always present (schema default []),
      // so an omitted/cleared language is deleted here, not left stale.
      for (const tr of input.translations ?? []) {
        // `language` is validated to be non-English by the schema.
        const fields = {
          // name is plain text — trimmed, not run through the HTML sanitizer.
          name: (tr.name ?? "").trim() || null,
          shortDescription: sanitizeRichTextOrNull(tr.shortDescription),
          description: sanitizeRichTextOrNull(tr.description),
          ingredients: sanitizeRichTextOrNull(tr.ingredients),
          howToUse: sanitizeRichTextOrNull(tr.howToUse),
          dosageInstructions: sanitizeRichTextOrNull(tr.dosageInstructions),
          technicalInfo: sanitizeRichTextOrNull(tr.technicalInfo),
        };
        if (Object.values(fields).every((v) => v === null)) {
          await tx.productTranslation.deleteMany({
            where: { productId: id, language: tr.language },
          });
        } else {
          await tx.productTranslation.upsert({
            where: { productId_language: { productId: id, language: tr.language } },
            create: { productId: id, language: tr.language, ...fields },
            update: fields,
          });
        }
      }

      // Customer/dealer base configuration — create/update/remove to match the
      // current audience (never leave a stale config row from a prior
      // audience change lying around).
      if (needsCustomer && input.customerConfig) {
        const data = toConfigData(input.customerConfig, "CUSTOMER", activeLogisticsConfig);
        await tx.productCustomerConfig.upsert({
          where: { productId: id },
          create: { productId: id, ...data, currentStock: input.customerConfig.currentStock },
          update: data,
        });
      } else {
        await tx.productCustomerConfig.deleteMany({ where: { productId: id } });
      }
      if (needsDealer && input.dealerConfig) {
        const data = toConfigData(input.dealerConfig, "DEALER", activeLogisticsConfig);
        await tx.productDealerConfig.upsert({
          where: { productId: id },
          create: { productId: id, ...data, currentStock: input.dealerConfig.currentStock },
          update: data,
        });
      } else {
        await tx.productDealerConfig.deleteMany({ where: { productId: id } });
      }

      // Product-specific attribute values: update-by-id (ownership-checked)
      // or create new. Never trusts an id belonging to a different product.
      const valueIdByAttributeAndSlug = new Map<string, string>();
      for (const value of input.attributeValues) {
        let valueId: string;
        if (value.id) {
          const existing = await tx.productVariantAttributeValue.findUnique({
            where: { id: value.id },
          });
          if (!existing || existing.productId !== id) {
            throw new Error("A submitted attribute value does not belong to this product.");
          }
          await tx.productVariantAttributeValue.update({
            where: { id: value.id },
            data: {
              value: value.value,
              slug: value.slug,
              position: value.position,
              isActive: value.isActive,
            },
          });
          valueId = value.id;
        } else {
          const createdValue = await tx.productVariantAttributeValue.upsert({
            where: {
              productId_attributeId_slug: {
                productId: id,
                attributeId: value.attributeId,
                slug: value.slug,
              },
            },
            create: {
              productId: id,
              attributeId: value.attributeId,
              value: value.value,
              slug: value.slug,
              position: value.position,
              isActive: value.isActive,
            },
            update: { value: value.value, position: value.position, isActive: value.isActive },
          });
          valueId = createdValue.id;
        }
        valueIdByAttributeAndSlug.set(`${value.attributeId}:${value.slug}`, valueId);
      }

      function resolveVariantRows(
        variants: ProductSubmissionInput["customerVariants"],
        audience: AudienceSkuAudience,
      ): VariantRowInput[] {
        return variants.map((variant) => {
          const attributeValueIds = variant.attributeValueRefs.map((ref) => {
            const resolved = valueIdByAttributeAndSlug.get(`${ref.attributeId}:${ref.slug}`);
            if (!resolved)
              throw new Error("A variant referenced an attribute value that wasn't submitted.");
            return resolved;
          });
          return {
            id: variant.id,
            attributeValueIds,
            sku: finalizeSku(variant.sku, audience),
            hsnCode: variant.hsnCode,
            mrp: variant.mrp,
            discountType: variant.discountType,
            discountValue: variant.discountValue,
            netPayableAmount: variant.netPayableAmount ?? null,
            sellingPrice: calculateSellingPrice(
              variant.mrp,
              variant.discountType,
              variant.discountValue,
            ),
            minOrderQty: variant.minOrderQty,
            stockQty: variant.stockQty,
            minStockQty: variant.minStockQty,
            reorderLevel: variant.reorderLevel,
            loyaltyPoints: variant.loyaltyPoints ?? null,
            height: variant.height ?? null,
            breadth: variant.breadth ?? null,
            length: variant.length ?? null,
            weight: variant.weight ?? null,
            shippingCost: computeShippingCost(variant.weight, activeLogisticsConfig),
            // See toConfigData's identical comment — same server-side enforcement, variant level.
            shippingCalcMode: audience === "DEALER" ? "EXCLUDE_WITH_PRODUCT" : variant.shippingCalcMode,
            // No dealer-only restriction here (unlike shippingCalcMode above) — either audience can independently choose.
            taxCalcMode: variant.taxCalcMode,
            imageUrl: variant.imageUrl || null,
            imageAlt: variant.imageAlt || null,
            images: variant.images.map((img) => ({
              url: img.url,
              altText: img.altText || null,
              position: img.position,
              isActive: img.isActive,
            })),
            videoUrl: variant.videoUrl || null,
            isActive: variant.isActive,
          };
        });
      }

      if (needsCustomer && input.customerVariants.length > 0) {
        await syncVariants(tx, id, "CUSTOMER", resolveVariantRows(input.customerVariants, "CUSTOMER"));
      }
      if (needsDealer && input.dealerVariants.length > 0) {
        await syncVariants(tx, id, "DEALER", resolveVariantRows(input.dealerVariants, "DEALER"));
      }

      return id;
    });
  } catch (err) {
    // resolveVariantRows above (and the attribute-value ownership check
    // just before it) throw a plain Error on a genuine data-consistency
    // problem — e.g. a variant referencing an attribute value that wasn't
    // part of this same submission (spec: the client is expected to keep
    // these in sync, but a stale ref must never reach here as an
    // unhandled 500 the seller can't act on). Anything thrown inside this
    // transaction is caught here and turned into the same graceful
    // {ok:false, error} shape every other failure in this function
    // already returns, instead of propagating as a raw server error.
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save product." };
  }

  // Every save (create or update) revalidates licensing against the
  // product's own current taxonomy/audience/states — spec §14 "Revalidate
  // licensing: When the seller saves/submits the product." Without this,
  // a brand-new product saved under a taxonomy path the seller has zero
  // licence coverage for would have its state list clamped to [] (the
  // correct, non-Pan-India-reading empty-because-blocked value — see
  // finalizeStateSelection above) but keep customerVisible/dealerVisible at
  // their default `true`, making it look fully open everywhere until some
  // unrelated compliance event happened to touch it later.
  await reconcileSingleProductCompliance(productId);

  return { ok: true, productId };
}

export type ProductLicenceComplianceResult = { ok: true } | { ok: false; error: string };

/**
 * The hard gate — spec §6/§14: a product may be freely saved as a DRAFT in
 * a non-compliant state (an "explicitly blocked draft"), but must never be
 * submitted for approval, approved, or published while non-compliant.
 * applyProductSubmission above only ever CLAMPS a product's state
 * selection down to what's eligible (silent, always succeeds, so a draft
 * can always be saved) — this is the separate check that
 * submitProductForApproval/approveProduct call to actually block the
 * transition when an audience the product targets has ended up with zero
 * eligible states.
 */
export async function assertProductLicenceCompliant(
  productId: string,
): Promise<ProductLicenceComplianceResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      sellerId: true,
      audience: true,
      customerVisible: true,
      dealerVisible: true,
      categoryId: true,
      subCategoryId: true,
      subSubCategoryId: true,
      customerAvailableStates: { select: { id: true } },
      dealerAvailableStates: { select: { id: true } },
    },
  });
  if (!product || !product.sellerId) return { ok: true }; // in-house products carry no licensing obligation

  const needsCustomer =
    (product.audience === "CUSTOMER_ONLY" || product.audience === "BOTH_CUSTOMER_AND_DEALER") &&
    product.customerVisible;
  const needsDealer =
    (product.audience === "DEALER_ONLY" || product.audience === "BOTH_CUSTOMER_AND_DEALER") &&
    product.dealerVisible;
  if (!needsCustomer && !needsDealer) return { ok: true };

  const index = await buildSellerLicenceEligibilityIndex(product.sellerId);
  const eligibility = evaluateEligibilityForPath(index, {
    categoryId: product.categoryId,
    subCategoryId: product.subCategoryId,
    subSubCategoryId: product.subSubCategoryId,
  });

  if (needsCustomer) {
    const configured = product.customerAvailableStates.map((s) => s.id);
    const eligible = new Set(eligibility.customer.eligibleStateIds);
    const compliantCount =
      configured.length === 0
        ? eligibility.customer.eligibleStateIds.length
        : configured.filter((id) => eligible.has(id)).length;
    if (compliantCount === 0) {
      const blocking = eligibility.customer.blockingRequirements.map((b) => b.name).join(", ");
      return {
        ok: false,
        error: blocking
          ? `Customer selling is blocked — missing licence(s): ${blocking}.`
          : "No state is currently licensed for Customer sales.",
      };
    }
  }
  if (needsDealer) {
    const configured = product.dealerAvailableStates.map((s) => s.id);
    const eligible = new Set(eligibility.dealer.eligibleStateIds);
    const compliantCount =
      configured.length === 0
        ? eligibility.dealer.eligibleStateIds.length
        : configured.filter((id) => eligible.has(id)).length;
    if (compliantCount === 0) {
      const blocking = eligibility.dealer.blockingRequirements.map((b) => b.name).join(", ");
      return {
        ok: false,
        error: blocking
          ? `Dealer selling is blocked — missing licence(s): ${blocking}.`
          : "No state is currently licensed for Dealer sales.",
      };
    }
  }

  return { ok: true };
}
