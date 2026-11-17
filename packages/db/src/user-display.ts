// Small display helper for the split User.firstName/lastName fields
// (see the split_user_name_and_legacy_fields migration). Lives in
// @kisan4u/db rather than @kisan4u/auth because apps/mobile depends on
// @kisan4u/db/@kisan4u/validators but not @kisan4u/auth (server-only,
// Next.js-specific), and mobile is one of the call sites that needs this.

/**
 * Joins firstName/lastName into a single display string.
 *
 * Returns null (not an empty string) when both are absent, so call sites
 * decide their own fallback, e.g. `getFullName(user) ?? user.phone ?? "—"`.
 */
export function getFullName(u: {
  firstName?: string | null;
  lastName?: string | null;
}): string | null {
  const first = u.firstName?.trim();
  const last = u.lastName?.trim();

  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (last) return last;
  return null;
}
