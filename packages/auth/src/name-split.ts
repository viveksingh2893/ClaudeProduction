/**
 * Splits a single free-text "full name" string into firstName/lastName on
 * the first space — the exact same convention the
 * split_user_name_and_legacy_fields migration's SQL backfill uses for
 * existing User.name values, so a name typed today and a name that was
 * migrated from the old data both land the same way. Used wherever a form
 * still collects one "full name" field (OTP signup, the public dealer/
 * seller registration forms) but the DB now stores firstName/lastName
 * separately.
 */
export function splitFullName(fullName: string): { firstName: string; lastName: string | null } {
  const trimmed = fullName.trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return { firstName: trimmed, lastName: null };
  return {
    firstName: trimmed.slice(0, spaceIndex),
    lastName: trimmed.slice(spaceIndex + 1).trim() || null,
  };
}
