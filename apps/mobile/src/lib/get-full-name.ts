/**
 * Same logic as getFullName() in packages/db/src/user-display.ts, kept as
 * a small local duplicate rather than importing it from @kisan4u/db.
 *
 * @kisan4u/db's package entry (src/index.ts) unconditionally constructs
 * the Prisma client (`new PrismaPg(...)`, `new PrismaClient(...)`) at
 * module scope — fine in Next.js/Node, but apps/mobile only ever
 * type-imports from @kisan4u/db today (see UserRole in auth-context.tsx),
 * never a runtime value, and there's no metro.config.js here that stubs
 * out `pg`/the Prisma adapter for the Metro bundler. Pulling in a runtime
 * export would be the first value-import from that package into the RN
 * bundle and risks a bundling/runtime break for something this small — so
 * this stays a plain, dependency-free duplicate instead.
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
