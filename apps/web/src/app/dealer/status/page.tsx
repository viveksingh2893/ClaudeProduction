import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import {
  getDealerProfileForUser,
  getDealerProfileForStatusViewSession,
  getUserBasicInfo,
  validateUserSession,
} from "@kisan4u/auth";
import { LinkButton, PageContainer } from "@kisan4u/ui";
import { SignOutButton } from "@/components/sign-out-button";
import { DEALER_STATUS_VIEW_COOKIE } from "../status-view-cookie";

type StatusView = {
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED" | "INACTIVE";
  rejectionReason: string | null;
  phone: string | null;
};

// INACTIVE is part of the shared ApplicationStatus enum (added for
// Brand/Manufacturer's workflow) — no code path sets a DealerProfile to
// INACTIVE today, but the type is shared so this switch must stay
// exhaustive.
function statusCopy(status: Exclude<StatusView["status"], "APPROVED">, reason: string | null) {
  switch (status) {
    case "PENDING":
      return {
        heading: "Application Pending Review",
        lines: [
          "Your dealer registration has been submitted.",
          "Your account is pending verification by Kisan4U.",
          "You will receive a notification after approval.",
        ],
      };
    case "REJECTED":
      return {
        heading: "Application Rejected",
        lines: [`Your dealer application was rejected.${reason ? ` Reason: ${reason}` : ""}`],
      };
    case "SUSPENDED":
      return {
        heading: "Account Suspended",
        lines: ["Your dealer account has been suspended. Contact support for details."],
      };
    case "INACTIVE":
      return {
        heading: "Account Inactive",
        lines: ["Your dealer account is inactive. Login is blocked. Contact support for details."],
      };
  }
}

function LoginNowButton({ phone }: { phone: string | null }) {
  const localPhone = phone?.startsWith("+91") ? phone.slice(3) : phone;
  const href = localPhone
    ? `/dealer/otp?prefillLocal=${encodeURIComponent(localPhone)}`
    : "/dealer/otp";
  return (
    <Link href={href} className="text-sm font-bold text-green-700 hover:underline">
      Got notification? Log in now →
    </Link>
  );
}

function StatusCard({ children }: { children: React.ReactNode }) {
  return (
    <PageContainer maxWidth="460px" className="flex min-h-[70vh] items-center py-10">
      <div className="flex w-full flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-8 text-center sm:p-10">
        {children}
      </div>
    </PageContainer>
  );
}

/**
 * Reachable two ways: (1) a short-lived DealerStatusViewSession cookie set
 * right after registration (see
 * apps/web/src/app/register/dealer/details/actions.ts), or (2) a real,
 * currently-authenticated DEALER session (a dealer checking their status
 * after logging in normally). Either way, the profile shown is always
 * resolved server-side from the session/cookie itself — there is no
 * dealerId/profileId anywhere in this route, so there is nothing for URL
 * manipulation to exploit to view another dealer's status.
 *
 * The ticket is checked FIRST, ahead of any pre-existing session: it's
 * the fresh, specific signal tied to whatever registration just
 * redirected here, and must win even if the browser happens to already
 * hold a real session for a *different* dealer (e.g. someone registering
 * a second dealer account in a browser where they're still logged in as
 * an earlier one) — otherwise this page would silently show the wrong
 * dealer's status.
 */
export default async function DealerStatusPage() {
  let view: StatusView | null = null;
  let hasRealSession = false;

  const cookieStore = await cookies();
  const ticketId = cookieStore.get(DEALER_STATUS_VIEW_COOKIE)?.value;
  if (ticketId) {
    const profile = await getDealerProfileForStatusViewSession(ticketId);
    if (profile) {
      view = {
        status: profile.status,
        rejectionReason: profile.rejectionReason,
        phone: profile.user.phone,
      };
    }
  }

  if (!view) {
    const session = await auth();
    if (session?.user && session.user.role === "DEALER") {
      const check = await validateUserSession(session.user.id, session.user.sessionVersion);
      if (check.valid) {
        const profile = await getDealerProfileForUser(session.user.id);
        if (profile) {
          const user = await getUserBasicInfo(session.user.id);
          hasRealSession = true;
          view = {
            status: profile.status,
            rejectionReason: profile.rejectionReason,
            phone: user?.phone ?? null,
          };
        }
      }
    }
  }

  if (!view) {
    redirect("/login");
  }

  if (view.status === "APPROVED") {
    if (hasRealSession) {
      redirect("/account");
    }
    // A status-view-ticket-only visitor has no real session to send to
    // /account — that page requires one. Prompt them to log in instead of
    // redirecting somewhere they can't actually reach yet.
    return (
      <StatusCard>
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl text-green-700">
          ✓
        </div>
        <h1 className="text-xl font-extrabold text-green-800">You&apos;re approved!</h1>
        <p className="text-sm leading-relaxed text-gray-600">
          Your Kisan4U dealer account is approved. You can now log in.
        </p>
        <LoginNowButton phone={view.phone} />
      </StatusCard>
    );
  }

  const copy = statusCopy(view.status, view.rejectionReason);
  const isPending = view.status === "PENDING";

  return (
    <StatusCard>
      <div
        className={`flex h-16 w-16 items-center justify-center rounded-full text-3xl ${isPending ? "bg-earth-100 text-earth-600" : "bg-danger-bg text-danger"}`}
      >
        {isPending ? "⏳" : "!"}
      </div>
      <h1 className={`text-xl font-extrabold ${isPending ? "text-earth-700" : "text-danger"}`}>
        {copy.heading}
      </h1>
      <div className="flex flex-col gap-1.5 text-sm leading-relaxed text-gray-600">
        {copy.lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <LoginNowButton phone={view.phone} />
      <LinkButton href="/" variant="outline" size="sm">
        Back to Home
      </LinkButton>
      {hasRealSession && <SignOutButton />}
    </StatusCard>
  );
}
