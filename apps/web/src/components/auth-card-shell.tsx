import Link from "next/link";

/** Shared chrome for every auth/registration step (phone entry, OTP, dealer/seller application forms) — a slim logo bar over a centered card, matching the Customer/Dealer/Seller sign-in references. */
export function AuthCardShell({
  children,
  maxWidth = "420px",
}: {
  children: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    <div className="flex min-h-[calc(100vh-64px)] flex-col items-center bg-bg">
      <div className="w-full px-4 py-4 sm:px-6">
        <Link href="/" className="text-lg font-extrabold text-green-800">
          Kisan4U
        </Link>
      </div>
      <div className="flex w-full flex-1 items-start justify-center px-4 py-6 sm:px-6">
        <div
          className="w-full rounded-2xl border border-border bg-surface p-6 sm:p-9"
          style={{ maxWidth }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
