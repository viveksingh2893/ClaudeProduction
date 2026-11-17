/**
 * The 28 states + 8 union territories of India, by display name — the
 * single source of truth for every "pick a state" dropdown in the apps
 * (kept in sync with prisma/seed.ts's seedIndianStates list and the
 * IndianState table). Forms that store a state as a plain string import
 * this directly instead of threading a DB query down to a client
 * component; forms that store a stateId FK keep querying IndianState.
 */
export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
] as const;

export type IndianStateName = (typeof INDIAN_STATES)[number];

/** True for any casing/trim of a known state name — for lenient server-side validation of legacy free-text values. */
export function isKnownIndianState(value: string): boolean {
  const v = value.trim().toLowerCase();
  return INDIAN_STATES.some((s) => s.toLowerCase() === v);
}
