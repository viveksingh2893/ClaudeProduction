/** Business Associate (BA) program — public surface of @kisan4u/orders/ba. */

export {
  getBaSettings,
  saveBaSettings,
  resolveBaCommissionRate,
  listBaRateConfigs,
  saveBaRateConfig,
  setBaRateConfigActive,
  isBaProgramEnabled,
  setBaProgramEnabled,
  type BaSettingsView,
  type ResolvedBaRate,
  type BaRateConfigInput,
} from "./settings";

export {
  BA_COMMISSION_GST_PERCENT,
  calculateBaCommissionForSellerOrder,
  type BaCommissionLineInput,
  type BaCommissionLineResult,
  type BaCommissionResult,
} from "./commission";

export {
  generateBaReferralCode,
  resolveReferralCode,
  applyReferralAtRegistration,
  type ResolvedReferralBa,
} from "./referral";

export {
  accrueRegistrationEarning,
  accrueDealerSignupEarning,
  accrueDealerApprovalEarning,
  accrueOrderCommissionEarning,
  reverseOrderCommissionEarning,
  promoteEligibleBaEarnings,
  getBaWalletSummary,
  listBaEarnings,
  getBaEarningsSummaryByIds,
  type BaWalletSummary,
  type BaEarningListFilters,
  type BaEarningsRowSummary,
} from "./earnings";

export {
  payoutMonthKey,
  baPayoutCycleFromKey,
  baPayoutCycleForDate,
  recentBaPayoutCycles,
  type BaPayoutCycle,
} from "./settlement-cycle-ba";

export {
  getBaSettlementOverview,
  buildBaSettlementBatch,
  markBaSettlementPaid,
  discardBaSettlementBatch,
  listBaSettlements,
  getBaSettlement,
  type BaSettlementOverview,
  type BaSettlementOverviewRow,
} from "./settlement";

export {
  getBaProfileForUser,
  getBaProfileById,
  submitBaForm1,
  submitBaForm2,
  adminDecideBa,
  adminDecideBaBank,
  adminEditBa,
  listBusinessAssociates,
  onReferredUserBecameDealer,
  getBaProgramSummary,
  type BaProfileView,
  type BaListFilters,
  type BaProgramSummary,
} from "./profile";

export {
  listBaReferees,
  listBaRefereeOrders,
  getProductImageUrls,
  type BaRefereeRow,
  type BaRefereeOrderRow,
} from "./referrals";

export {
  createProposedOrder,
  listProposedOrdersForReferee,
  listProposedOrdersForBa,
  getProposedOrderForViewer,
  decideProposedOrder,
  cancelProposedOrder,
} from "./proposed-order";
