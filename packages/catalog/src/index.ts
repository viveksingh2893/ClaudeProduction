export { buildCombinationKey } from "./combination-key";
export {
  resolveProductContent,
  resolveProductName,
  type ProductDescriptionFields,
} from "./product-content";
export { resolveCategoryName, resolveCategoryDescription } from "./category-content";
export {
  getVariantAttributes,
  getAvailableValuesForAttribute,
  isSelectionComplete,
  resolveVariant,
  applySelection,
  getInitialSelection,
} from "./variant-compatibility";
export type {
  VariantAttributeValueRef,
  CompatibilityVariant,
  AttributeOption,
  AttributeGroup,
  VariantSelection,
  ValueAvailability,
  ApplySelectionResult,
} from "./variant-compatibility";
export { isProductAvailableForState, redactDealerPricingIfUnavailable } from "./availability";
export {
  buildSellerLicenceEligibilityIndex,
  evaluateEligibilityForPath,
  evaluateSellingLicenceEligibility,
  explainBlockedState,
  legStatusLabel,
} from "./licence-eligibility";
export type {
  SellerLicenceEligibilityIndex,
  SellingLicenceEligibilityResult,
  RequirementEligibility,
  RequirementLegEligibility,
  RequirementLegStatus,
  AudienceEligibility,
} from "./licence-eligibility";
export {
  getTaxonomyNodeLicenceRequirements,
  taxonomyNodeHasActiveLicenceRequirements,
  previewTaxonomyNodeLicenceImpact,
  createLicenceRequirement,
  renameLicenceRequirement,
  reviseLicenceRequirement,
  deleteLicenceRequirement,
} from "./licence-requirements";
export type { LicenceRequirementResult, LicenceRequirementRevision } from "./licence-requirements";
export {
  createSellerLicenceSubmission,
  resubmitSellerLicenceSubmission,
  decideSellerLicenceSubmission,
  adminEditSellerLicenceSubmission,
  deleteSellerLicenceSubmission,
} from "./licence-submissions";
export type {
  SubmissionActor,
  SubmissionResult,
  CreateSubmissionInput,
  LicenceDecisionAction,
} from "./licence-submissions";
export {
  reconcileTaxonomyNodeCompliance,
  reconcileSellerLicenceSubmissionCompliance,
  reconcileSingleProductCompliance,
  sweepExpiredLicenceSubmissions,
  sendLicenceExpiryReminders,
  getComplianceReviews,
  resolveComplianceReview,
} from "./licence-compliance";
export type { ComplianceReviewFilters } from "./licence-compliance";
export { diagnoseProductVisibility } from "./product-visibility-diagnosis";
export type { VisibilityDiagnosis } from "./product-visibility-diagnosis";
export {
  setCustomerStateOnce,
  adminChangeCustomerState,
  resolveCustomerCatalogueStateId,
} from "./customer-state";
export type { CustomerStateResult } from "./customer-state";
export {
  adminUpdateUserDetails,
  adminUpdateDealerProfile,
  adminUpdateSellerProfile,
} from "./admin-user-details";
export type { AdminUserDetailsResult } from "./admin-user-details";
export { writeAuditLog } from "./audit";
export {
  notifyUser as notifyLicenceUser,
  notifyAllAdmins as notifyLicenceAdmins,
} from "./licence-notifications";
export {
  getSellerLicenceSubmissions,
  getSellerCurrentLicenceSubmissions,
  getLicenceSubmissionById,
  getTaxonomyPathLabelsForSubmissions,
  getActiveRequirementsForTaxonomyNode,
  getAdminLicenceSubmissions,
  getAdminLicenceKpis,
  getAdminLicenceSellerSummaries,
} from "./licence-queries";
export type {
  SellerLicenceSubmissionRow,
  AdminLicenceSubmissionFilters,
  AdminLicenceKpis,
  AdminLicenceSellerSummary,
  AdminLicenceSellerSummaryFilters,
} from "./licence-queries";
export { canTransition } from "./lifecycle";
export type { ProductActor } from "./lifecycle";
export { assertOwnsProduct } from "./ownership";
export type { OwnedProductResult } from "./ownership";
export {
  validateCategoryChain,
  assertNoActiveChildrenForCategory,
  assertNoActiveChildrenForSubcategory,
  getNextTopLevelCategoryPosition,
  setTopLevelCategoryPosition,
  normalizeTopLevelCategoryPositions,
} from "./category-hierarchy";
export type { HierarchyCheckResult } from "./category-hierarchy";
export {
  submitProductForApproval,
  revertProductToDraft,
  deactivateOwnProduct,
  reactivateOwnProduct,
  approveProduct,
  rejectProduct,
  suspendProduct,
  reactivateProduct,
  adminDeactivateProduct,
  deleteProduct,
  assertProductComplete,
} from "./product-decisions";
export type { ProductCompletenessResult } from "./product-decisions";
export {
  getCustomerCatalogue,
  getCustomerCataloguePage,
  getDealerCataloguePage,
  getPublicProductBySlug,
  getCustomerProductById,
  getProductAudienceInfoBySlug,
  getCategoryBySlug,
  getSubcategoryBySlug,
  getSubSubCategoryBySlug,
  getCategoryNavTree,
  getActiveTopLevelCategoriesForHomepage,
  getDealerCatalogue,
  getDealerProductDetail,
  getSellerProducts,
  getSellerProductsPaginated,
  getProductForSellerEdit,
  getProductForAdmin,
  getAdminProductQueue,
  getProductIdsWithStockAttention,
  getProductCatalogueSummary,
  searchCustomerCatalogueForPos,
  searchDealerCatalogueForPos,
  customerStateAvailabilityWhere,
} from "./queries";
export type {
  CustomerCatalogueFilters,
  CategoryNavTree,
  SellerProductFilters,
  SellerProductSortKey,
  PosCatalogueFilters,
  PosCatalogueResult,
  AdminProductFilters,
  ProductCatalogueSummary,
} from "./queries";
export {
  syncVariants,
  canDeleteVariant,
  removeVariant,
  toggleVariantActive,
  setDefaultVariant,
  assertAttributeValueRemovable,
  removeAttributeValue,
} from "./variant-generation";
export type { VariantRowInput, VariantRemovalResult } from "./variant-generation";
export { applyProductSubmission, assertProductLicenceCompliant } from "./product-submission";
export type {
  ApplyProductSubmissionResult,
  SubmissionContext,
  ProductLicenceComplianceResult,
} from "./product-submission";
export { saveProductDraft, fillDraftDefaults, getDraftPlaceholderCategoryId } from "./product-draft";
export {
  validateSlabSet,
  getLogisticsConfig,
  getActiveLogisticsConfig,
  saveLogisticsConfig,
  calculateShippingCostForWeight,
  toShippingConfigInput,
} from "./logistics-pricing";
export type {
  SlabInput,
  SlabValidationResult,
  SaveLogisticsConfigResult,
} from "./logistics-pricing";
export {
  createBrandRequest,
  createManufacturerRequest,
  updateBrandRequest,
  updateManufacturerRequest,
  decideBrand,
  decideManufacturer,
  assertSellerOwnsEditableBrand,
  assertSellerOwnsEditableManufacturer,
} from "./brand-manufacturer";
export type { BrandManufacturerResult } from "./brand-manufacturer";
export {
  listCropsForAdmin,
  getActiveCrops,
  getCropBySlug,
  createCrop,
  updateCrop,
  toggleCropActive,
  listPestsDiseasesForAdmin,
  getActivePestsDiseases,
  getPestDiseaseBySlug,
  createPestDisease,
  updatePestDisease,
  togglePestDiseaseActive,
  getCropPestReferenceData,
} from "./crop-pest";
export type { CropPestResult, CropPestListItem, CropPestChip } from "./crop-pest";
export {
  createProductRequest,
  getDealerRequests,
  getSellerRequests,
  getSellerRequestsPaginated,
  getDealerRequestById,
  getSellerRequestById,
  updateRequestStatusAsSeller,
  cancelProductRequestAsDealer,
  getAllProductRequestsForAdmin,
  getAdminRequestById,
  approveProductRequest,
  rejectProductRequest,
} from "./product-requests";
export type {
  CreateRequestResult,
  RequestActionResult,
  SellerRequestFilters,
  SellerRequestSortKey,
  AdminRequestActionResult,
  ListProductRequestsFilters,
} from "./product-requests";

export { resolveCardBadge } from "./badge-resolution";
export type { BadgeTone, BadgeCandidate } from "./badge-resolution";

export { recomputeProductRating } from "./ratings";

export {
  sanitizeReviewText,
  checkReviewEligibility,
  submitProductReview,
  getCustomerReviewForProduct,
  getPublicReviewsForProduct,
  listReviewsForAdmin,
  moderateReview,
  createManualReview,
} from "./reviews";
export type {
  ReviewEligibility,
  SubmitReviewInput,
  SubmitReviewResult,
  AdminReviewFilters,
  AdminReviewSortKey,
  ModerationDecision,
  CreateManualReviewInput,
  CreateManualReviewResult,
} from "./reviews";

export { toggleWishlistItem, getWishlistedProductIds, getWishlistedProducts } from "./wishlist";

export { getSiteSettings, saveSiteSettings, saveLoginVideoUrl } from "./site-settings";

export {
  getProductPlacementsMap,
  getProductCategoryRankMap,
  setProductSectionPlacement,
  setProductCategoryPlacement,
  maxItemsForSection,
} from "./product-placement";
export type { ProductPlacementMap, ProductPlacementResult } from "./product-placement";

export {
  listHomepageSections,
  saveHomepageSection,
  listPromotionalAssets,
  savePromotionalAsset,
  deletePromotionalAsset,
  listCategoryHomepageAssets,
  saveCategoryHomepageAsset,
  deleteCategoryHomepageAsset,
  listDealsOfTheDay,
  saveDealOfTheDay,
  deleteDealOfTheDay,
  getDiscoveryCollection,
  setDiscoveryMode,
  setCollectionItems,
  listFeaturedByCategoryCollections,
  addFeaturedCategory,
  removeFeaturedCategory,
  listFeaturedBySubcategoryCollections,
  addFeaturedSubcategory,
  removeFeaturedSubcategory,
  listApprovedBrandsForHomepage,
  setBrandHomepagePosition,
  searchProductsForPicker,
} from "./homepage-admin";
export type { DiscoveryType } from "./homepage-admin";

export {
  getHomepageModel,
  getActiveHeroBanners,
  getCategoryHeroBanners,
  getActiveCouponBanners,
  getActiveSecondaryBanners,
  getHomepageCategoryRows,
  getHomepageSubcategoryRows,
  getActiveShopByBrand,
  getManualHomepageProducts,
} from "./homepage";
export type {
  HomepageViewer,
  HomepageViewerAudience,
  HomepageModel,
  HomepageSectionModel,
  HomepageProduct,
  PromotionalAssetDTO,
  BrandAssetDTO,
  DealDTO,
} from "./homepage";

export {
  adaptCustomerProduct,
  adaptDealerProduct,
  adaptHomepageProduct,
  applyDealOverride,
} from "./product-card-adapter";
export type {
  ProductCardData,
  ProductCardPricing,
  ProductCardPurchase,
  ProductCardRating,
  CardFeatureFlags,
} from "./product-card-adapter";

export {
  computeStockStatus,
  resolveInventoryImageUrl,
  listInventory,
  getInventoryStatusSummary,
  countStockAdjustmentsToday,
  findInventoryTargetBySku,
  recordStockChange,
  listStockAdjustments,
  getVariantAvailableQty,
  updateStockThresholds,
  inventoryTargetKey,
} from "./inventory";
export type {
  StockStatus,
  StockStatusInfo,
  StockTarget,
  InventoryRow,
  InventoryFilters,
  InventorySortKey,
  InventoryListParams,
  InventoryListResult,
  InventoryStatusSummary,
  SkuLookupResult,
  StockChangeSpec,
  RecordStockChangeParams,
  RecordStockChangeResult,
  StockAdjustmentRow,
  UpdateThresholdsResult,
} from "./inventory";

export {
  subscribeToRestock,
  cancelRestockSubscription,
  getRestockSubscriptionStatus,
  getRestockSubscriptionStatusesForProduct,
  triggerRestockNotifications,
} from "./restock-subscriptions";
export type { SubscribeResult, CancelResult } from "./restock-subscriptions";

export {
  listBulkDrafts,
  createBulkDraft,
  renameBulkDraft,
  deleteBulkDraft,
  duplicateBulkDraft,
  getBulkDraft,
  upsertBulkGroup,
  deleteBulkGroup,
  upsertBulkRow,
  deleteBulkRow,
  loadExistingProductForBulkRecall,
} from "./bulk-product-draft";
export type {
  BulkActor,
  BulkDraftSummary,
  BulkDraftDetail,
  ExistingProductForRecall,
} from "./bulk-product-draft";
export {
  translateGroupToSubmissionInput,
  submitBulkDraft,
  validateBulkDraft,
} from "./bulk-product-submission";
export type {
  BulkGroupSubmissionResult,
  BulkGroupValidationResult,
} from "./bulk-product-submission";

export {
  listBlogCategories,
  listBlogCategoriesWithBlogs,
  createBlogCategory,
  listBlogsForAdmin,
  getBlogForAdmin,
  createBlog,
  updateBlog,
  getFeaturedBlogsForHomepage,
  listPublicBlogs,
  resolvePublicBlogBySlug,
} from "./blog";
export type { MutationResult as BlogMutationResult, AdminBlogFilters, PublicBlogLookup } from "./blog";
