import { z } from "zod";

/**
 * Official GST jurisdiction state codes (the first 2 digits of any
 * 15-char GSTIN) mapped to the exact `IndianState.name` strings seeded in
 * packages/db/prisma/seed.ts, so a derived code can be resolved with a
 * plain `findFirst({ where: { name } })` — no separate `gstCode` column
 * needed on IndianState. Codes 28 and 37 both pre-/post-date the 2014
 * Andhra Pradesh/Telangana split and both resolve to "Andhra Pradesh"
 * since the seed data has no "(New)" variant; 25 and 26 both resolve to
 * the merged "Dadra and Nagar Haveli and Daman and Diu" UT for the same
 * reason.
 */
export const GST_STATE_CODE_TO_NAME: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Dadra and Nagar Haveli and Daman and Diu",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

/** Standard 15-char GSTIN shape: 2-digit state code, 10-char PAN, 1 entity code, 'Z', 1 checksum char. */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/** Optional GST number field, format-validated only when non-empty — matches the existing "GST number (optional)" UX on registration forms. */
export const gstNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .or(z.literal(""))
  .refine((v) => !v || GSTIN_REGEX.test(v), "Enter a valid 15-character GST number");

/**
 * Returns the `IndianState.name` a GSTIN's first two digits resolve to,
 * or null if the GSTIN is malformed or its state code isn't recognized.
 * Pure lookup — callers still resolve the name against the live
 * IndianState table before trusting it (a name here is not proof the
 * state row exists/is active).
 */
export function stateNameFromGstNumber(gstNumber: string): string | null {
  const trimmed = gstNumber.trim().toUpperCase();
  if (!GSTIN_REGEX.test(trimmed)) return null;
  return GST_STATE_CODE_TO_NAME[trimmed.slice(0, 2)] ?? null;
}
