import Link from "next/link";
import { notFound } from "next/navigation";
import { getFullName, prisma } from "@kisan4u/db";
import {
  getBaProfileForUser,
  getBaWalletSummary,
  getProductImageUrls,
  isBaProgramEnabled,
  listBaRefereeOrders,
  listBaReferees,
  listProposedOrdersForBa,
} from "@kisan4u/orders";
import { Breadcrumbs, Card, PageContainer, PageHeader, ProductImage } from "@kisan4u/ui";
import { ORDER_STATUS_LABEL } from "@/lib/order-status-labels";
import { requireSession } from "@/lib/session-guard";
import { Form1Client } from "./form1-client";
import { Form2Client } from "./form2-client";
import { ShareReferral } from "./share-referral";
import { getSiteOrigin } from "@/lib/site-origin";

const STATUS_COPY: Record<string, { label: string; tone: string; hint: string }> = {
  NOT_REGISTERED: {
    label: "Not registered as BA",
    tone: "text-gray-600",
    hint: "Fill the form below to apply to become a Business Associate.",
  },
  PENDING: {
    label: "Pending for approval",
    tone: "text-amber-700",
    hint: "Your application is with our team. You'll be notified once it's reviewed.",
  },
  APPROVED_NO_BANK: {
    label: "Approved BA — bank details pending",
    tone: "text-green-700",
    hint: "You can share your referral code and start earning now. Add your bank details below to withdraw.",
  },
  APPROVED: {
    label: "Approved BA",
    tone: "text-green-800",
    hint: "You're all set. Earnings are paid out at the end of each month.",
  },
  REJECTED: {
    label: "Application rejected",
    tone: "text-red-700",
    hint: "You can review the reason and re-submit the form below.",
  },
  SUSPENDED: {
    label: "Suspended",
    tone: "text-red-700",
    hint: "Your Business Associate account is suspended. Contact support for details.",
  },
};

export default async function BaAccountPage() {
  const session = await requireSession(["CUSTOMER", "DEALER"], { next: "/account/ba" });
  const userId = session.user.id;

  if (!(await isBaProgramEnabled())) notFound();

  const [profile, user, states] = await Promise.all([
    getBaProfileForUser(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, phone: true, email: true },
    }),
    prisma.indianState.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  const fs = profile?.frontendStatus ?? "NOT_REGISTERED";
  // Bank-detail rejection is tracked separately from the whole-application
  // BaStatus (see BaBankStatus's schema doc comment) — a BA can be
  // permanently APPROVED/BANK_SUBMITTED while a *later* bank-detail
  // resubmission gets rejected. Without this override the status card and
  // Form2Client below stayed keyed only on `fs`, so a rejection never
  // surfaced here: fs stays "APPROVED" (from the earlier BANK_SUBMITTED)
  // forever, even after admin rejects the resubmitted bank details.
  const bankRejected = profile?.bankStatus === "REJECTED";
  const copy = bankRejected
    ? {
        label: "Bank details rejected",
        tone: "text-red-700",
        hint: "Your bank details were rejected. Review the reason and re-submit below.",
      }
    : STATUS_COPY[fs]!;

  const wallet = profile ? await getBaWalletSummary(profile.id) : null;
  const proposed = profile ? await listProposedOrdersForBa(profile.id) : [];
  const isApprovedBa = fs === "APPROVED" || fs === "APPROVED_NO_BANK";
  const [referees, refereeOrders] =
    profile && isApprovedBa
      ? await Promise.all([listBaReferees(profile.id), listBaRefereeOrders(profile.id)])
      : [[], []];
  const proposedThumbs = await getProductImageUrls(
    proposed.flatMap((po) => po.items.map((item) => item.productId)),
  );

  const siteOrigin = await getSiteOrigin();
  const shareUrl = profile ? `${siteOrigin}/r/${profile.referralCode}` : "";

  return (
    <PageContainer maxWidth="760px" className="py-8">
      <div className="mb-4">
        <Breadcrumbs
          items={[{ label: "Account", href: "/account" }, { label: "Business Associate" }]}
        />
      </div>
      <PageHeader title="Business Associate" />

      <Card className="p-5">
        <div className="text-sm text-gray-600">Status</div>
        <div className={`text-lg font-extrabold ${copy.tone}`}>{copy.label}</div>
        <p className="mt-1 text-sm text-gray-600">{copy.hint}</p>
        {fs === "REJECTED" && profile?.rejectedReason && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Reason: {profile.rejectedReason}
          </p>
        )}
        {bankRejected && profile?.bankRejectionReason && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Reason: {profile.bankRejectionReason}
          </p>
        )}
      </Card>

      {profile && (fs === "APPROVED" || fs === "APPROVED_NO_BANK") && (
        <Card className="mt-4 p-5">
          <ShareReferral code={profile.referralCode} url={shareUrl} />
        </Card>
      )}

      {wallet && (
        <Card className="mt-4 p-5">
          <div className="mb-3 text-sm font-semibold text-ink">Earnings</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Bucket label="Total earned" value={wallet.totalEarned} strong />
            <Bucket label="Redeemable now" value={wallet.eligible} accent />
            <Bucket label="Locked (pending order)" value={wallet.lockedPending} />
            <Bucket label="Already paid out" value={wallet.settled} />
          </div>
          {wallet.reversed > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              Reversed (returns / rejections): ₹{wallet.reversed.toFixed(2)}
            </p>
          )}
          <div className="mt-4 text-xs text-gray-500">
            <div>Registration bonuses: ₹{wallet.byKind.total.registration.toFixed(2)}</div>
            <div>Dealer approval bonuses: ₹{wallet.byKind.total.dealerApproval.toFixed(2)}</div>
            <div>Order commission: ₹{wallet.byKind.total.orderCommission.toFixed(2)}</div>
          </div>

          <table className="mt-4 w-full text-xs">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-1">Type</th>
                <th className="py-1">Status</th>
                <th className="py-1 text-right">Amount</th>
                <th className="py-1 text-right">Date</th>
              </tr>
            </thead>
            <tbody>
              {wallet.recent.map((e) => (
                <tr key={e.id} className="border-t border-gray-100">
                  <td className="py-1.5">{e.kind.replace(/_/g, " ").toLowerCase()}</td>
                  <td className="py-1.5">{e.status.toLowerCase()}</td>
                  <td className="py-1.5 text-right">₹{e.amount.toFixed(2)}</td>
                  <td className="py-1.5 text-right text-gray-400">
                    {e.createdAt.toLocaleDateString("en-IN")}
                  </td>
                </tr>
              ))}
              {wallet.recent.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-gray-400">
                    No earnings yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      {profile && isApprovedBa && (
        <Card className="mt-4 p-5">
          <div className="mb-3 text-sm font-semibold text-ink">
            Your referrals <span className="font-normal text-gray-500">({referees.length})</span>
          </div>
          {referees.length === 0 ? (
            <p className="text-sm text-gray-500">
              No one has signed up with your referral code yet. Share your code or link above.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-gray-500">
                  <tr>
                    <th className="py-1">Name</th>
                    <th className="py-1">Mobile</th>
                    <th className="py-1">Joined</th>
                    <th className="py-1 text-right">Orders</th>
                    <th className="py-1 text-right">Order value</th>
                  </tr>
                </thead>
                <tbody>
                  {referees.map((r) => (
                    <tr key={r.id} className="border-t border-gray-100">
                      <td className="py-1.5 font-medium text-ink">
                        {getFullName(r) ?? "—"}
                        {r.role === "DEALER" && (
                          <span className="ml-1.5 rounded bg-earth-100 px-1.5 py-0.5 text-[10px] font-bold text-earth-700">
                            Dealer
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-1.5">{r.phone ?? "—"}</td>
                      <td className="whitespace-nowrap py-1.5 text-gray-500">
                        {r.joinedAt.toLocaleDateString("en-IN")}
                      </td>
                      <td className="py-1.5 text-right">{r.orderCount}</td>
                      <td className="whitespace-nowrap py-1.5 text-right">
                        ₹{r.orderValue.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {profile && isApprovedBa && refereeOrders.length > 0 && (
        <Card className="mt-4 p-5">
          <div className="mb-1 text-sm font-semibold text-ink">Orders from your referrals</div>
          <p className="mb-2 text-xs text-gray-500">
            Orders your referrals placed, and orders you placed for them that they approved. Showing
            the latest {refereeOrders.length}.
          </p>
          <ul className="divide-y divide-gray-100">
            {refereeOrders.map((o) => (
              <li key={o.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink">
                      {o.orderNumber}
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        {o.createdAt.toLocaleDateString("en-IN")}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600">
                      {getFullName({
                        firstName: o.refereeFirstName,
                        lastName: o.refereeLastName,
                      }) ?? "Customer"}
                      {o.refereePhone ? ` · ${o.refereePhone}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-ink">₹{o.total.toFixed(2)}</div>
                    <div className="text-xs text-gray-500">
                      {ORDER_STATUS_LABEL[o.status] ?? o.status.replace(/_/g, " ").toLowerCase()}
                    </div>
                    {o.placedByBa && (
                      <span className="mt-0.5 inline-block rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-bold text-green-700">
                        Placed by you
                      </span>
                    )}
                  </div>
                </div>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {o.items.map((item) => (
                    <li key={item.id} className="flex items-center gap-2.5">
                      <Thumb src={item.imageUrl} name={item.productName} />
                      <div className="min-w-0 text-xs">
                        <div className="truncate font-medium text-ink">{item.productName}</div>
                        <div className="text-gray-500">
                          {item.variantLabel ? `${item.variantLabel} · ` : ""}Qty {item.quantity}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {proposed.length > 0 && (
        <Card className="mt-4 p-5">
          <div className="mb-2 text-sm font-semibold text-ink">Orders you placed for customers</div>
          <ul className="divide-y divide-gray-100 text-sm">
            {proposed.map((po) => (
              <li key={po.id} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/account/ba/orders/${po.id}`} className="min-w-0 hover:underline">
                    {getFullName(po.refereeUser) ?? "Customer"}
                    {po.refereeUser.phone ? ` · ${po.refereeUser.phone}` : ""} — ₹
                    {Number(po.grandTotal).toFixed(2)}
                  </Link>
                  <span className="shrink-0 text-xs text-gray-500">
                    {po.status.replace(/_/g, " ").toLowerCase()}
                  </span>
                </div>
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {po.items.map((item) => (
                    <li key={item.id} className="flex items-center gap-2.5">
                      <Thumb src={proposedThumbs.get(item.productId)} name={item.productName} />
                      <div className="min-w-0 text-xs">
                        <div className="truncate font-medium text-ink">{item.productName}</div>
                        <div className="text-gray-500">
                          {item.variantLabel ? `${item.variantLabel} · ` : ""}Qty {item.quantity}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(fs === "NOT_REGISTERED" || fs === "REJECTED") && (
        <Card className="mt-4 p-5">
          <div className="mb-3 text-sm font-semibold text-ink">Basic details</div>
          <Form1Client
            defaults={{
              firstName: profile?.firstName ?? user?.firstName ?? "",
              lastName: profile?.lastName ?? user?.lastName ?? "",
              contactNumber: profile?.contactNumber ?? user?.phone ?? "",
              email: profile?.email ?? user?.email ?? "",
              pincode: profile?.pincode ?? "",
              state: profile?.state ?? "",
              city: profile?.city ?? "",
            }}
            states={states}
          />
        </Card>
      )}

      {profile && (fs === "APPROVED_NO_BANK" || bankRejected) && (
        <Card className="mt-4 p-5">
          <div className="mb-3 text-sm font-semibold text-ink">Bank &amp; KYC details</div>
          <p className="mb-3 text-xs text-gray-500">
            All fields are required. This unlocks withdrawal of your earnings.
          </p>
          <Form2Client />
        </Card>
      )}
    </PageContainer>
  );
}

function Thumb({ src, name }: { src: string | null | undefined; name: string }) {
  return (
    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md border border-border bg-neutral-100">
      <ProductImage src={src} alt={name} loading="lazy" />
    </div>
  );
}

function Bucket({
  label,
  value,
  strong,
  accent,
}: {
  label: string;
  value: number;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div
        className={`mt-0.5 font-extrabold ${
          accent ? "text-green-700" : strong ? "text-ink" : "text-gray-700"
        }`}
      >
        ₹{value.toFixed(2)}
      </div>
    </div>
  );
}
