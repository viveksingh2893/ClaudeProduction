import { prisma, UserRole, type ApplicationStatus } from "@kisan4u/db";
import { phoneSchema } from "@kisan4u/validators";

export type PhoneAccountLookup =
  | { exists: false }
  | {
      exists: true;
      role: UserRole;
      isActive: boolean;
      /** The account's DealerProfile status, or null when it has none — lets callers block a SUSPENDED dealer before an OTP is sent. */
      dealerStatus: ApplicationStatus | null;
    };

/**
 * The single server-side source of truth for "does this phone number
 * already belong to an account, and as what role" — used by every OTP
 * entry point (customer login, dealer login, dealer registration) to
 * detect a phone number crossing role boundaries before an OTP is ever
 * sent, per the Phase 2 fix requirement: the server decides account
 * type from the database, never the client. Re-parses/normalizes the
 * phone itself so callers never need to trust an already-normalized
 * value from upstream. Also surfaces `isActive` so callers can block a
 * deactivated account with a clear message before sending an OTP at
 * all, instead of letting it fail later at credentials-authorize time
 * with a generic "invalid OTP" error that would be misleading here.
 */
export async function lookupPhoneAccount(rawPhone: string): Promise<PhoneAccountLookup> {
  const phone = phoneSchema.parse(rawPhone);
  const user = await prisma.user.findUnique({
    where: { phone },
    select: { role: true, isActive: true, dealerProfile: { select: { status: true } } },
  });
  if (!user) return { exists: false };
  return {
    exists: true,
    role: user.role,
    isActive: user.isActive,
    dealerStatus: user.dealerProfile?.status ?? null,
  };
}
