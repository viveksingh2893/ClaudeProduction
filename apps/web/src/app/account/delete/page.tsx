import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertBox, Button, Card, PageContainer, PageHeader } from "@kisan4u/ui";
import { getAccountDeletionEligibility } from "@kisan4u/orders";
import { prisma } from "@kisan4u/db";
import {
  deleteAccountNowAction,
  requestDeletionAction,
  restoreAccountAction,
  sendDeletionOtpAction,
} from "./actions";

export default async function DeleteAccountPage({
  searchParams,
}: {
  searchParams: Promise<{
    otp?: string;
    error?: string;
    requested?: string;
    retryAfter?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login/mobile?next=%2Faccount%2Fdelete");
  const params = await searchParams;
  const parsedRetryAfter = Number(params.retryAfter);
  const retryAfter =
    Number.isInteger(parsedRetryAfter) && parsedRetryAfter > 0 ? parsedRetryAfter : null;
  const [eligibility, request] = await Promise.all([
    getAccountDeletionEligibility(session.user.id),
    prisma.accountDeletionRequest.findFirst({
      where: {
        userId: session.user.id,
        status: { in: ["SCHEDULED", "BLOCKED", "PENDING_REVIEW"] },
      },
      orderBy: { requestedAt: "desc" },
    }),
  ]);

  return (
    <PageContainer maxWidth="700px" className="py-8">
      <PageHeader
        title="Delete account"
        description="Permanently anonymize your Kisan4U account."
      />
      <div className="space-y-4">
        <Card className="p-5">
          <h2 className="font-bold">What is deleted</h2>
          <p className="mt-2 text-sm text-gray-600">
            Your phone, email, password, saved addresses, cart, wishlist, notifications and uploaded
            identity documents.
          </p>
          <h2 className="mt-5 font-bold">What is retained</h2>
          <p className="mt-2 text-sm text-gray-600">
            Orders, payments, refunds, settlements and invoices are retained for the legally
            required period. Readable contact details are removed.
          </p>
        </Card>

        {params.error && (
          <AlertBox tone="danger">
            {params.error === "otp"
              ? "Invalid or expired OTP."
              : params.error === "rate"
                ? `Please wait ${retryAfter ?? 60} seconds before requesting another OTP.`
              : params.error === "blocked"
                ? "Resolve the blockers below before deleting your account."
                : "The request could not be completed."}
          </AlertBox>
        )}

        {request ? (
          <Card className="p-5">
            <h2 className="font-bold">
              Deletion {request.status === "PENDING_REVIEW" ? "awaiting review" : "pending"}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {request.scheduledFor
                ? `Scheduled for ${request.scheduledFor.toLocaleDateString("en-IN")}.`
                : "An administrator will review this request."}
            </p>
            <form action={restoreAccountAction} className="mt-4">
              <Button type="submit">Restore account</Button>
            </form>
          </Card>
        ) : eligibility ? (
          <Card className="p-5">
            {eligibility.blockers.length > 0 && (
              <AlertBox tone="warning">
                {eligibility.blockers.map((item) => item.message).join(" ")}
              </AlertBox>
            )}
            {eligibility.eligible && params.otp !== "sent" && (
              <form action={sendDeletionOtpAction}>
                <Button type="submit" variant="danger">
                  Send confirmation OTP
                </Button>
              </form>
            )}
            {eligibility.eligible && params.otp === "sent" && (
              <form action={requestDeletionAction} className="space-y-3">
                <label className="block text-sm font-semibold">
                  Confirmation OTP
                  <input
                    name="code"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    className="mt-1 block w-full rounded-lg border border-border px-3 py-2"
                  />
                </label>
                {eligibility.walletBalance > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                    <p className="font-bold">
                      Wallet balance: ₹{eligibility.walletBalance.toFixed(2)}
                    </p>
                    <p className="mt-1">
                      You can{" "}
                      <Link href="/products" className="font-bold underline">
                        use this balance before deletion
                      </Link>
                      . If you continue, the remaining balance will be permanently forfeited
                      immediately when the deletion request is submitted. Restoring the account
                      later will not return it.
                    </p>
                    <label className="mt-3 flex items-start gap-2 font-semibold">
                      <input
                        type="checkbox"
                        name="forfeitWalletBalance"
                        value="true"
                        required
                        className="mt-1"
                      />
                      I understand that my remaining wallet balance will be forfeited immediately
                      and will not be returned if I restore my account.
                    </label>
                  </div>
                )}
                <Button type="submit" variant="danger">
                  Schedule deletion in 14 days
                </Button>
                <button
                  type="submit"
                  formAction={deleteAccountNowAction}
                  className="ml-3 text-sm font-semibold text-red-700 underline"
                >
                  Delete now
                </button>
              </form>
            )}
          </Card>
        ) : null}
      </div>
    </PageContainer>
  );
}
