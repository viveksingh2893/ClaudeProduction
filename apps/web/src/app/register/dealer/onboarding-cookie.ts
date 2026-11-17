// Same "k4uweb" app prefix as the Auth.js cookies (packages/auth/src/cookies.ts)
// for naming consistency. This one isn't an Auth.js cookie — it's a
// separate, narrowly-scoped ticket for the dealer-registration flow only.
export const DEALER_ONBOARDING_COOKIE = "k4uweb.dealer-onboarding";
export const DEALER_ONBOARDING_MAX_AGE_SECONDS = 60 * 10; // keep in sync with ONBOARDING_TTL_MINUTES in packages/auth/src/onboarding.ts
