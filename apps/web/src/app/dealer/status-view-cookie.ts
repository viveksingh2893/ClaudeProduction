// Same "k4uweb" app prefix as the Auth.js cookies (packages/auth/src/cookies.ts).
// Not an Auth.js session — a narrow, path-scoped ticket that lets a
// just-registered dealer view /dealer/status without a real login (see
// packages/auth/src/onboarding.ts createDealerStatusViewSession).
export const DEALER_STATUS_VIEW_COOKIE = "k4uweb.dealer-status-view";
export const DEALER_STATUS_VIEW_MAX_AGE_SECONDS = 60 * 60 * 24; // keep in sync with STATUS_VIEW_TTL_HOURS in packages/auth/src/onboarding.ts
