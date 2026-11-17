/**
 * Full auth barrel — Node-context only (Prisma + bcrypt inside). Import
 * this from each app's `auth.ts` (route handler) and from Server
 * Actions/route handlers that need `requestOtp`. NEVER import this from
 * `middleware.ts` or an app's `auth.config.ts` — those must import only
 * from `@kisan4u/auth/src/shared` (edge-safe) to avoid bundling Prisma's
 * Node-only driver adapter into the Edge middleware runtime.
 */
export { sharedAuthConfig } from "./shared";
export { otpCredentialsProvider } from "./providers/otp-credentials";
export { passwordCredentialsProvider } from "./providers/password-credentials";
export { requestOtp, verifyOtp, getTrustedClientIp, consumeSecurityRateLimit } from "./otp";
export type { RequestOtpResult, VerifyOtpResult, OtpPurpose } from "./otp";
export {
  registerDealer,
  registerPosDealer,
  registerSeller,
  createCustomerForPos,
  BCRYPT_SALT_ROUNDS,
} from "./registration";
export { adminResetPassword, changeOwnPassword, generateTemporaryPassword } from "./password-reset";
export { hasPermission } from "./permissions";
export type { PermissionAction } from "./permissions";
export {
  listRoles,
  getRoleWithPermissions,
  createRole,
  updateRolePermissions,
  deleteRole,
  listEmployees,
  createEmployeeAccount,
  updateEmployeeAccount,
} from "./roles";
export type { CreateEmployeeResult } from "./roles";
export type { AdminResetPasswordResult, ChangeOwnPasswordResult } from "./password-reset";
export type {
  RegistrationResult,
  DealerRegistrationResult,
  CreateCustomerForPosResult,
  ExistingPosCustomer,
} from "./registration";
export {
  createDealerOnboardingSession,
  getVerifiedPhoneForOnboardingSession,
  consumeDealerOnboardingSession,
  recordDealerOnboardingUpload,
  createSellerOnboardingSession,
  getVerifiedPhoneForSellerOnboardingSession,
  reserveSellerOnboardingUpload,
  releaseSellerOnboardingUpload,
  recordSellerOnboardingUpload,
  sellerOnboardingOwnsDocuments,
  consumeSellerOnboardingSession,
  createDealerStatusViewSession,
  getDealerProfileForStatusViewSession,
} from "./onboarding";
export { lookupPhoneAccount } from "./phone-lookup";
export type { PhoneAccountLookup } from "./phone-lookup";
export {
  issuePhoneVerificationToken,
  verifyPhoneVerificationToken,
} from "./phone-verification-token";
export {
  getDealerProfileForUser,
  getSellerProfileForUser,
  getUserBasicInfo,
  listCustomers,
  getCustomerDirectorySummary,
  listDealerApplications,
  getDealerApplicationsSummary,
  listSellerApplications,
  getSellerApplicationsSummary,
  listUsers,
  getUsersDirectorySummary,
  setDealerApplicationStatus,
  setSellerApplicationStatus,
  approveSellerApplication,
  setUserActive,
  setDealerState,
  setSellerCommission,
  validateUserSession,
  hasModulePermission,
  setModulePermission,
  searchCustomersForPos,
  searchApprovedDealersForPos,
} from "./access";
export type {
  PosCustomerResult,
  PosDealerResult,
  SellerApprovalResult,
  DealerApplicationsSummary,
  SellerApplicationsSummary,
  CustomerDirectorySummary,
  UsersDirectorySummary,
} from "./access";
export {
  issueMobileTokenPair,
  signMobileAccessToken,
  signMobileRefreshToken,
  verifyMobileAccessToken,
  verifyMobileRefreshToken,
  legacyMobileTokensAllowed,
} from "./mobile-tokens";
export type { MobileTokenPayload, MobileTokenPair, VerifiedMobileToken } from "./mobile-tokens";
export {
  createMobileSessionTokenPair,
  rotateMobileSessionTokenPair,
  revokeMobileSession,
  mobileDeviceFromHeaders,
} from "./mobile-sessions";
export type { MobileDevice, RotateMobileSessionResult } from "./mobile-sessions";
export { issuePrivateDocumentDownload, redeemPrivateDocumentDownload } from "./document-download";
export { verifyPasswordLogin } from "./password-login";
export type { PasswordLoginResult } from "./password-login";
export { verifyOtpAndResolveUser } from "./otp-login";
export type { OtpLoginRole, OtpLoginResult } from "./otp-login";
export {
  getDealerApplicationForUser,
  submitDealerApplicationForUser,
  proposeDealerProfileChanges,
  approveDealerProfileChanges,
  discardDealerProfileChanges,
} from "./dealer-application";
export type { DealerApplicationView } from "./dealer-application";
