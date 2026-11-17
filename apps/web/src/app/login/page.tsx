import Link from "next/link";
import { AlertBox, LinkButton } from "@kisan4u/ui";

const NOTICES: Record<string, string> = {
  "otp-attempts": "Too many incorrect OTP attempts. Please log in again with your mobile number.",
};

/**
 * One entry point for everyone — same as the mobile app's "Log in / Sign
 * up" button. The mobile-number step (/login/mobile) works out from the
 * database whether the number is a customer (or brand new → account
 * created) or a dealer, and routes to the right OTP screen itself, so
 * there is no separate customer / dealer button here.
 */
export default async function LoginLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; ref?: string }>;
}) {
  const { notice, ref } = await searchParams;
  const noticeText = notice ? NOTICES[notice] : undefined;
  const mobileHref = ref ? `/login/mobile?ref=${encodeURIComponent(ref)}` : "/login/mobile";

  return (
    <div className="grid min-h-[calc(100vh-64px)] grid-cols-1 lg:grid-cols-2">
      <div className="flex flex-col justify-center gap-7 px-6 py-12 sm:px-10 lg:px-16">
        <div>
          <div className="text-2xl font-extrabold text-green-800">Welcome to Kisan4U</div>
          <p className="mt-1.5 text-sm text-gray-600">
            Log in or create your account with your mobile number.
          </p>
        </div>

        {noticeText && (
          <div className="max-w-md">
            <AlertBox tone="warning">{noticeText}</AlertBox>
          </div>
        )}

        <div className="flex max-w-md flex-col gap-3">
          <LinkButton href={mobileHref} variant="secondary" size="lg" fullWidth>
            Log in / Sign up
          </LinkButton>
          <p className="text-[13px] text-gray-600">
            Shop seeds, fertilizers, equipment &amp; more. Dealers use the same button — we&apos;ll
            recognise your number and take you to dealer login.
          </p>
        </div>

        <p className="text-sm text-gray-600">
          Want to sell on Kisan4U?{" "}
          <Link href="/seller/apply" className="font-bold text-green-700 hover:underline">
            Apply here
          </Link>
          . Want dealer pricing?{" "}
          <Link href="/register/dealer" className="font-bold text-green-700 hover:underline">
            Register as a dealer
          </Link>
          .
        </p>
      </div>

      <div className="hidden items-center justify-center bg-gradient-to-br from-green-900 to-green-700 p-10 lg:flex">
        <div className="max-w-sm text-center text-white">
          <div className="mb-5 inline-block rounded-2xl bg-white px-7 py-5">
            <span className="text-2xl font-extrabold text-green-800">Kisan4U</span>
          </div>
          <p className="text-base font-semibold text-white/90">India&apos;s trusted marketplace for customers and dealers</p>
        </div>
      </div>
    </div>
  );
}
