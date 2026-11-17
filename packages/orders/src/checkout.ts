import { prisma, Prisma, type UserRole, type PaymentMethod, type PaymentStatus } from "@kisan4u/db";
import { checkoutInputSchema, computeWalletSplit, type CheckoutInput } from "@kisan4u/validators";
import {
  mockPaymentProvider,
  type MockPaymentOutcome,
  razorpayCreateOrder,
  razorpayFetchPayment,
  verifyPaymentSignature,
} from "@kisan4u/providers";
import { buildCheckoutDrafts } from "./checkout-draft";
import { computeAdvanceAmount } from "./partial-payment";
import { validatePaymentMethodRules } from "./payment-rules";
import { resolveCheckoutAddress, type DealerVerifiedState } from "./checkout-address";
import {
  generateCheckoutGroupNumber,
  generateSellerOrderNumber,
  generateInvoiceNumber,
} from "./order-numbering";
import { claimIdempotencyKey, completeIdempotencyKey, failIdempotencyKey } from "./idempotency";
import { recordStatusChange } from "./status-transitions";
import { InsufficientStockError } from "./stock";
import { writeAuditLog } from "./audit";
import { notifyBuyer } from "./notifications";
import { round2, sum, allocateProportionally, resolveTaxBreakdown } from "./money";
import { applyWalletAmount, peekWalletBalance, reverseWalletAmount } from "./wallet";

export type CheckoutContext = {
  role: "CUSTOMER" | "DEALER";
  /** The dealer's own verified state — never taken from client input. Null for a customer, or a dealer with no normalized state yet. */
  dealerState: DealerVerifiedState;
  /** POS-only — set when a staff member is checking out on a buyer's behalf. Absent/undefined for every self-service checkout. */
  placedBy?: { id: string; name: string };
  /**
   * POS-only, non-COD orders — when true, applyInitialPayment skips its
   * mock-charge simulation and the resulting status advance entirely,
   * leaving Payment at PENDING and every SellerOrder at PENDING_PAYMENT
   * until an admin approves an uploaded PosPaymentProofSubmission (see
   * packages/orders/src/pos-payment-proof.ts). Wallet is still applied
   * normally — this only skips the *online* portion. A no-op (falls
   * through to today's behavior) if the wallet alone already covers the
   * full charge amount, since there's then nothing external left to prove.
   */
  requiresManualPaymentApproval?: boolean;
  /**
   * POS ONLINE_PARTIAL only — the operator-typed rupee amount to collect
   * now, replacing computeAdvanceAmount's percentage rule for this one
   * checkout. Re-validated inside runCheckout (> 0 and < grandTotal)
   * before use. Ignored for every other paymentMethod and for every
   * self-service checkout (computeAdvanceAmount runs unchanged whenever
   * this is undefined).
   */
  posAdvanceAmount?: number;
};

export type CheckoutSuccess = {
  ok: true;
  checkoutGroupId: string;
  groupNumber: string;
  /**
   * Set only when a real Razorpay Order was created for this checkout's
   * remaining (post-wallet) charge — the client opens the Razorpay
   * Checkout widget against it. Absent for COD, a fully wallet-covered
   * payment, a POS payment-proof-gated one (requiresManualPaymentApproval),
   * or a devSimulate-driven test/dev checkout (still the mock provider —
   * see applyInitialPayment).
   */
  razorpayOrder?: { orderId: string; amountPaise: number; keyId: string; paymentId: string };
};
export type CheckoutFailure = { ok: false; error: string };
export type CheckoutResult = CheckoutSuccess | CheckoutFailure;

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Applies the outcome of the initial payment attempt to the Payment row
 * and every SellerOrder it covers, all within the caller's transaction.
 * COD never attempts an online charge — it confirms immediately and the
 * amount is collected at delivery. It may still be part-funded (or fully
 * funded) from the buyer's wallet: that share is debited now and only the
 * remainder is collected in cash. Every other method optionally has a
 * wallet amount applied first (additive funding source, not a payment
 * method — see wallet.ts), then whatever remains is charged through the
 * mock payment provider. If that remaining charge
 * fails outright, the wallet debit is reversed in the same transaction —
 * nothing was actually collected, so nothing should be treated as spent.
 * A single mock outcome applies uniformly to every seller order in this
 * checkout, matching how one real gateway charge would behave; only the
 * seller-wise PaymentAllocation split differs.
 */
async function applyInitialPayment(
  tx: TxClient,
  params: {
    paymentId: string;
    sellerOrderIds: string[];
    paymentMethod: PaymentMethod;
    actor: { id: string; role: UserRole };
    chargeAmount: number;
    walletRequestedAmount: number;
    /** Overrides chargeAmount as the wallet's cap — set for a partial order, whose chargeAmount is wallet share + online advance. */
    walletEligibleCap?: number;
    isPartial: boolean;
    devSimulate?: MockPaymentOutcome;
    requiresManualPaymentApproval?: boolean;
  },
): Promise<{ razorpayOrder?: CheckoutSuccess["razorpayOrder"] }> {
  const {
    paymentId,
    sellerOrderIds,
    paymentMethod,
    actor,
    chargeAmount,
    walletRequestedAmount,
    walletEligibleCap,
    isPartial,
    devSimulate,
    requiresManualPaymentApproval,
  } = params;

  if (paymentMethod === "COD") {
    // Wallet may fund part (or all) of a COD order. Capped at the full
    // amount (chargeAmount === grandTotal for COD); nothing external is
    // charged, so there is no failure path that would need the debit
    // reversed here.
    const codWallet = await applyWalletAmount(tx, {
      userId: actor.id,
      role: actor.role === "DEALER" ? "DEALER" : "CUSTOMER",
      requestedAmount: walletRequestedAmount,
      eligibleCap: chargeAmount,
      referenceId: paymentId,
    });

    if (codWallet.applied <= 0) {
      await tx.payment.update({ where: { id: paymentId }, data: { status: "PENDING" } });
      await tx.paymentStatusHistory.create({
        data: {
          paymentId,
          status: "PENDING",
          source: "CUSTOMER",
          note: "Cash on Delivery — collected at delivery",
        },
      });
      // Every order — COD included — stays PENDING_PAYMENT ("Pending") until
      // Kisan4U's scheduling team confirms it with the customer and an admin
      // confirms it (order-workflow.ts's confirmOrder), which is also where
      // stock is deducted. Nothing further to do here at checkout time.
      return {};
    }

    // Record the wallet share per seller order (same proportional split the
    // online path uses) so cancellation can credit exactly this slice back
    // and the courier/admin views know how much is already paid.
    const codAllocations = await tx.paymentAllocation.findMany({ where: { paymentId } });
    const codShares = allocateProportionally(
      codWallet.applied,
      codAllocations.map((a) => Number(a.amount)),
    );
    for (let i = 0; i < codAllocations.length; i++) {
      await tx.paymentAllocation.update({
        where: { id: codAllocations[i]!.id },
        data: { walletAmountApplied: codShares[i]! },
      });
    }

    const codRemaining = round2(chargeAmount - codWallet.applied);
    const codFullyCovered = codRemaining <= 0;
    const codStatus: PaymentStatus = codFullyCovered ? "PAID" : "PARTIALLY_PAID";
    // Payment.totalAmount stays the full order total (that is what every
    // "paid so far" proration divides by) — amountPaid is just the wallet
    // share, so the outstanding balance is exactly what's left for COD.
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: codStatus,
        amountPaid: codWallet.applied,
        walletAmountApplied: codWallet.applied,
        providerReference: codFullyCovered ? "WALLET-FULLY-COVERED" : "WALLET-PARTIAL-COD",
        remainingDueNote: codFullyCovered
          ? null
          : `Remaining ₹${codRemaining.toFixed(2)} due on delivery (COD) after ₹${codWallet.applied.toFixed(2)} paid from wallet`,
      },
    });
    await tx.paymentStatusHistory.create({
      data: {
        paymentId,
        status: codStatus,
        source: "CUSTOMER",
        note: codFullyCovered
          ? `Cash on Delivery order fully paid from wallet (₹${codWallet.applied.toFixed(2)})`
          : `₹${codWallet.applied.toFixed(2)} paid from wallet; ₹${codRemaining.toFixed(2)} to be collected on delivery`,
      },
    });
    // A partly wallet-paid COD order reads "Advance received" (still
    // Pending, still awaits scheduling-team confirmation) exactly like a
    // partial online advance; a fully wallet-covered one stays plain
    // "Pending" like any other fully-paid order.
    await finalizeOrderPaymentSuccess(tx, { sellerOrderIds, isPartial: !codFullyCovered, actor });
    return {};
  }

  // Wallet contributes at most `chargeAmount` — the amount payable now for
  // whichever plan was chosen (the full total for ONLINE_FULL/
  // TRANSPORT_FULL_ONLINE) — never the deferred remaining-at-delivery
  // portion. For ONLINE_PARTIAL, chargeAmount is the wallet share PLUS the
  // advance, and the wallet share is capped separately by
  // `walletEligibleCap` (see runCheckout: the wallet comes off the whole
  // order first, the advance rule then applies to what is left).
  const walletResult = await applyWalletAmount(tx, {
    userId: actor.id,
    role: actor.role === "DEALER" ? "DEALER" : "CUSTOMER",
    requestedAmount: walletRequestedAmount,
    eligibleCap: walletEligibleCap ?? chargeAmount,
    referenceId: paymentId,
  });
  const remainingChargeAmount = round2(chargeAmount - walletResult.applied);

  let outcome: MockPaymentOutcome;
  let amountCaptured: number;
  let providerReference: string;
  let walletApplied = walletResult.applied;

  if (remainingChargeAmount <= 0) {
    // Fully covered by the wallet — nothing left to charge the provider for.
    outcome = "SUCCESS";
    amountCaptured = 0;
    providerReference = "WALLET-FULLY-COVERED";
  } else if (requiresManualPaymentApproval) {
    // POS-only: skip the mock provider — a human (admin) approves a
    // payment-proof screenshot instead of a simulated gateway charge (see
    // packages/orders/src/pos-payment-proof.ts). Reuses the existing
    // "PENDING" outcome value so every downstream consumer below (the
    // wallet-allocation split, PaymentStatus derivation, and critically
    // the outcome==="SUCCESS" gate that governs recordStatusChange/
    // deductStockForSellerOrder) behaves exactly as it already does for a
    // real pending payment — no new branching needed anywhere else in
    // this function.
    outcome = "PENDING";
    amountCaptured = 0;
    providerReference = "POS_MANUAL_APPROVAL_PENDING";
  } else if (devSimulate) {
    // Dev/test escape hatch — a real end-user checkout never sets this
    // (checkoutInputSchema exposes it, but no UI ever passes it; only
    // scripts/automated tests do). Keeps the mock provider available for
    // deterministic FAILURE/PARTIAL_SUCCESS/PENDING testing without
    // needing a live Razorpay round-trip.
    const charge = await mockPaymentProvider.charge(
      {
        internalReference: paymentId,
        customerId: actor.id,
        method: paymentMethod,
        amount: remainingChargeAmount,
      },
      devSimulate,
    );
    outcome = charge.outcome;
    amountCaptured = charge.amountCaptured;
    providerReference = charge.providerReference;

    // Nothing was actually collected for this attempt — reverse the
    // wallet portion too rather than leaving the shopper's wallet debited
    // for a payment that didn't go through.
    if (outcome === "FAILURE" && walletApplied > 0 && walletResult.walletId) {
      await reverseWalletAmount(tx, {
        walletId: walletResult.walletId,
        amount: walletApplied,
        referenceId: paymentId,
      });
      walletApplied = 0;
    }
  } else {
    // Real checkout, self-service (not POS, not devSimulate) — create the
    // Razorpay Order the client's Checkout widget opens against. Nothing
    // is captured yet; this order stays PENDING (Payment) /
    // PENDING_PAYMENT (every SellerOrder) exactly like the
    // requiresManualPaymentApproval branch above, until
    // completeRazorpayPayment (client callback, HMAC-verified) or the
    // payment.captured webhook confirms it — whichever arrives first.
    const razorpayResult = await razorpayCreateOrder({
      amountRupees: remainingChargeAmount,
      receipt: paymentId,
    });
    if (!razorpayResult.ok) {
      throw new Error(`Razorpay: ${razorpayResult.error}`);
    }
    outcome = "PENDING";
    amountCaptured = 0;
    providerReference = razorpayResult.data.id;
  }

  if (walletApplied > 0) {
    const allocations = await tx.paymentAllocation.findMany({ where: { paymentId } });
    const shares = allocateProportionally(
      walletApplied,
      allocations.map((a) => Number(a.amount)),
    );
    for (let i = 0; i < allocations.length; i++) {
      await tx.paymentAllocation.update({
        where: { id: allocations[i]!.id },
        data: { walletAmountApplied: shares[i]! },
      });
    }
  }

  const paymentStatus: PaymentStatus =
    outcome === "SUCCESS"
      ? isPartial
        ? "PARTIALLY_PAID"
        : "PAID"
      : outcome === "PARTIAL_SUCCESS"
        ? "PARTIALLY_PAID"
        : outcome === "PENDING"
          ? "PENDING"
          : "FAILED";

  const razorpayOrderId = outcome === "PENDING" && !requiresManualPaymentApproval && !devSimulate
    ? providerReference
    : undefined;

  await tx.payment.update({
    where: { id: paymentId },
    data: {
      status: paymentStatus,
      amountPaid: round2(amountCaptured + walletApplied),
      walletAmountApplied: walletApplied,
      providerReference,
      ...(razorpayOrderId ? { razorpayOrderId } : {}),
    },
  });
  await tx.paymentStatusHistory.create({
    data: { paymentId, status: paymentStatus, source: "PAYMENT_PROVIDER" },
  });

  if (outcome === "SUCCESS") {
    await finalizeOrderPaymentSuccess(tx, { sellerOrderIds, isPartial, actor });
  } else if (outcome === "PARTIAL_SUCCESS") {
    for (const sellerOrderId of sellerOrderIds) {
      await recordStatusChange(
        tx,
        sellerOrderId,
        "PENDING_PAYMENT",
        "PAYMENT_PARTIALLY_RECEIVED",
        actor,
        "PAYMENT_PROVIDER",
        "Partial payment captured",
      );
    }
  }
  // FAILURE/PENDING: every seller order stays PENDING_PAYMENT — nothing further to record here.

  return razorpayOrderId
    ? {
        razorpayOrder: {
          orderId: razorpayOrderId,
          amountPaise: Math.round(remainingChargeAmount * 100),
          keyId: process.env.RAZORPAY_KEY_ID ?? "",
          paymentId,
        },
      }
    : {};
}

/**
 * Shared by applyInitialPayment's own SUCCESS branch (COD, wallet-fully-
 * covered, or a devSimulate-forced SUCCESS) and completeRazorpayPayment
 * below — records that the money side of the order is settled.
 *
 * It deliberately does NOT confirm the order or deduct stock any more:
 * every order now waits at PENDING_PAYMENT ("Pending") for Kisan4U's
 * scheduling team to confirm it with the customer, at which point an admin
 * runs order-workflow.ts's confirmOrder (that is where CONFIRMED and the
 * stock deduction happen). A partial advance is still recorded as
 * PAYMENT_PARTIALLY_RECEIVED so the order list can show "advance received"
 * — that state also displays as "Pending" and still awaits confirmation.
 */
async function finalizeOrderPaymentSuccess(
  tx: TxClient,
  params: { sellerOrderIds: string[]; isPartial: boolean; actor: { id: string; role: UserRole } },
): Promise<void> {
  const { sellerOrderIds, isPartial, actor } = params;
  if (!isPartial) return;
  for (const sellerOrderId of sellerOrderIds) {
    await recordStatusChange(
      tx,
      sellerOrderId,
      "PENDING_PAYMENT",
      "PAYMENT_PARTIALLY_RECEIVED",
      actor,
      "PAYMENT_PROVIDER",
      "Advance payment received",
    );
  }
}

export type CompleteRazorpayPaymentResult = { ok: true } | { ok: false; error: string };

/**
 * Client-side completion — called from the Checkout widget's own success
 * handler, right after it hands back {razorpay_payment_id, razorpay_order_id,
 * razorpay_signature}. The signature check alone is enough to trust that
 * this really came from Razorpay (see verifyPaymentSignature's own doc
 * comment); completePaymentFromRazorpay below still fetches the payment
 * live before treating anything as paid, so a forged/stale call can't get
 * through even if this were somehow bypassed.
 */
export async function completeRazorpayPayment(input: {
  paymentId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): Promise<CompleteRazorpayPaymentResult> {
  const validSignature = verifyPaymentSignature({
    orderId: input.razorpayOrderId,
    paymentId: input.razorpayPaymentId,
    signature: input.razorpaySignature,
  });
  if (!validSignature) return { ok: false, error: "Payment verification failed." };

  return completePaymentFromRazorpay(input.paymentId, input.razorpayOrderId, input.razorpayPaymentId);
}

/**
 * The actual completion logic, shared by completeRazorpayPayment above
 * (client callback — signature verified there) and the payment.captured
 * webhook (apps/web's /api/webhooks/razorpay route — signature verified
 * there, separately, using the webhook secret rather than key_secret).
 * Whichever of the two arrives first does the real work; idempotent
 * against the other arriving after — a Payment already PAID/
 * PARTIALLY_PAID is a safe no-op, not an error, since both paths racing
 * is the expected normal case, not a bug.
 */
export async function completePaymentFromRazorpay(
  paymentId: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
): Promise<CompleteRazorpayPaymentResult> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      allocations: true,
      checkoutGroup: { select: { customerType: true } },
    },
  });
  if (!payment) return { ok: false, error: "Payment not found." };
  if (payment.razorpayOrderId !== razorpayOrderId) {
    return { ok: false, error: "This payment doesn't match that Razorpay order." };
  }
  if (payment.status === "PAID" || payment.status === "PARTIALLY_PAID") return { ok: true };

  const fetched = await razorpayFetchPayment(razorpayPaymentId);
  if (!fetched.ok) return { ok: false, error: `Razorpay: ${fetched.error}` };
  if (fetched.data.status !== "captured") {
    return { ok: false, error: `Payment isn't captured yet (status: ${fetched.data.status}).` };
  }
  if (fetched.data.orderId && fetched.data.orderId !== razorpayOrderId) {
    return { ok: false, error: "Payment/order mismatch." };
  }

  // remainingDueNote is only set while a COD balance is left — a partial
  // order whose remainder the wallet covered in full is simply PAID.
  const isPartial = payment.method === "ONLINE_PARTIAL" && payment.remainingDueNote != null;
  const sellerOrderIds = payment.allocations.map((a) => a.sellerOrderId);
  const actor = { id: payment.customerId, role: payment.checkoutGroup.customerType };
  const amountCaptured = fetched.data.amount / 100;

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: isPartial ? "PARTIALLY_PAID" : "PAID",
        amountPaid: round2(amountCaptured + Number(payment.walletAmountApplied)),
        razorpayPaymentId,
        providerReference: razorpayPaymentId,
      },
    });
    await tx.paymentStatusHistory.create({
      data: {
        paymentId,
        status: isPartial ? "PARTIALLY_PAID" : "PAID",
        source: "PAYMENT_PROVIDER",
      },
    });
    await finalizeOrderPaymentSuccess(tx, { sellerOrderIds, isPartial, actor });
  });

  return { ok: true };
}

/**
 * Webhook-facing entry point (apps/web's /api/webhooks/razorpay route,
 * after it independently verifies the webhook signature) — resolves our
 * internal Payment id from the Razorpay order id in the event payload,
 * since a webhook only ever carries Razorpay's own ids. A payment.captured
 * event for an order id we don't recognize (e.g. a stray/replayed event,
 * or one from before this integration existed) is a silent no-op, not an
 * error — never surfaced back to Razorpay as a failure.
 */
export async function completeRazorpayPaymentByOrderId(
  razorpayOrderId: string,
  razorpayPaymentId: string,
): Promise<CompleteRazorpayPaymentResult> {
  const payment = await prisma.payment.findFirst({
    where: { razorpayOrderId },
    select: { id: true },
  });
  if (!payment) return { ok: true };
  return completePaymentFromRazorpay(payment.id, razorpayOrderId, razorpayPaymentId);
}

/**
 * The Phase 4 checkout entry point. Prevents duplicate submissions via
 * `claimIdempotencyKey` before anything else runs (§D/§Z), re-validates
 * every cart line fresh (never trusts anything read earlier), computes
 * every seller order's charges before writing anything so a missing
 * logistics slab for ANY seller order aborts the WHOLE checkout with no
 * partial writes (§D/§J2), then commits everything — checkout group,
 * seller orders, items, charges, initial payment attempt — in one
 * transaction.
 */
export async function checkout(
  userId: string,
  ctx: CheckoutContext,
  rawInput: CheckoutInput,
): Promise<CheckoutResult> {
  const parsed = checkoutInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid checkout input." };
  const input = parsed.data;

  const claim = await claimIdempotencyKey(input.idempotencyKey, userId);
  if (!claim.ok) return claim;
  if (claim.alreadyCompleted) {
    const existing = await prisma.checkoutGroup.findUnique({
      where: { id: claim.checkoutGroupId },
      select: { groupNumber: true },
    });
    return {
      ok: true,
      checkoutGroupId: claim.checkoutGroupId,
      groupNumber: existing?.groupNumber ?? "",
    };
  }

  try {
    const result = await runCheckout(userId, ctx, input);
    if (result.ok) {
      await completeIdempotencyKey(input.idempotencyKey, result.checkoutGroupId);
      // Attribute to the real actor when a staff member placed this via
      // POS — the buyer never took this action themselves, so the audit
      // trail should say who actually did.
      await writeAuditLog({
        actorId: ctx.placedBy?.id ?? userId,
        actorRole: ctx.placedBy ? "STAFF" : ctx.role,
        action: "CHECKOUT_CREATED",
        entityType: "CheckoutGroup",
        entityId: result.checkoutGroupId,
        metadata: { groupNumber: result.groupNumber },
      });
      // "Order placed" — the first entry in the buyer's notification feed
      // for this order, before any seller has accepted it. Later lifecycle
      // events (accepted / confirmed / packed / in transit / delivered)
      // are notified from order-workflow.ts. Fire-and-forget: a failed
      // notification must never fail a committed checkout.
      await notifyBuyer({
        customerId: userId,
        title: "Order placed",
        body: `We've received your order ${result.groupNumber}. You'll get an update as soon as the seller confirms it.`,
        linkUrl: `/account/orders`,
      }).catch(() => {});
    } else {
      await failIdempotencyKey(input.idempotencyKey);
    }
    return result;
  } catch (error) {
    await failIdempotencyKey(input.idempotencyKey);
    throw error;
  }
}

async function runCheckout(
  userId: string,
  ctx: CheckoutContext,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const addressResult = await resolveCheckoutAddress(userId, ctx, input);
  if (!addressResult.ok) return addressResult;

  const deliveryMethod = ctx.role === "DEALER" ? input.deliveryMethod : "KISAN4U_COURIER";
  const paymentRule = validatePaymentMethodRules(ctx.role, deliveryMethod, input.paymentMethod);
  if (!paymentRule.ok) return paymentRule;

  // Transport note is mandatory once the ROLE-resolved delivery method is
  // TRANSPORT (never for KISAN4U_COURIER) — checked here, after the
  // override above, not in checkoutInputSchema, since a customer's raw
  // input.deliveryMethod is irrelevant/ignored and must never be able to
  // block their (always-KISAN4U_COURIER) checkout.
  if (deliveryMethod === "TRANSPORT" && !input.transportNote?.trim()) {
    return { ok: false, error: "Transport note is required for Transport orders." };
  }

  // POS + CUSTOMER only (never DEALER, never self-service web/dealer
  // checkout) — gates the admin-configurable PosPricingConfig discount and
  // prepaid-split in place of today's hardcoded promo table / operator-typed
  // advance amount. See checkout-draft.ts's isPosCustomerOrder doc.
  const isPosCustomerOrder = Boolean(ctx.placedBy) && ctx.role === "CUSTOMER";

  const draftResult = await buildCheckoutDrafts(userId, {
    role: ctx.role,
    dealerStateId: ctx.dealerState?.id ?? null,
    // The customer's actual resolved delivery address (never client
    // input directly — see resolveCheckoutAddress) is what selling-licence
    // eligibility is checked against for a CUSTOMER order (spec §13:
    // "Final availability must be based on the selected delivery
    // address... Never allow checkout until a valid delivery state has
    // been evaluated").
    customerStateId: ctx.role === "CUSTOMER" ? addressResult.snapshot.stateId : null,
    deliveryMethod,
    paymentMethod: input.paymentMethod,
    isPosCustomerOrder,
    couponCode: input.couponCode,
  });
  if (!draftResult.ok) {
    console.error(`[checkout] blocked for user=${userId}: ${draftResult.error}`);
    return draftResult;
  }
  // grandTotal is already net of the customer promo discount AND any
  // applied coupon discount — the actual amount charged. grossTotal
  // (pre-discount) is only used for display and as each seller order's
  // own settlement-basis totalAmount.
  const { drafts, grandTotal, appliedCoupon } = draftResult;
  if (grandTotal <= 0) return { ok: false, error: "Order total must be greater than zero." };

  // The wallet is applied LAST — after every discount that is already baked
  // into grandTotal (customer promo, prepaid/partial discount, coupon). What
  // it comes off depends on the method:
  //  - COD / full prepaid: the whole grandTotal; the rest is collected in
  //    cash on delivery / paid online.
  //  - Partial prepaid: the advance rule runs on the FULL grandTotal first
  //    and is never reduced by the wallet (e.g. 1000 total, 200 advance paid
  //    online, 800 left for COD); the wallet then only comes off that COD
  //    remainder. It can never cover the advance itself.
  // Planned from a pre-transaction read of the balance; what is actually
  // debited is still decided inside the transaction (applyWalletAmount) — if
  // the balance moved in between, the difference simply falls on the online
  // charge.
  let advancePlan: { advanceAmount: number; remainingAmount: number; ruleLabel: string } | null =
    null;
  if (input.paymentMethod === "ONLINE_PARTIAL") {
    // POS (customer or dealer) always lets the operator enter the exact
    // amount being collected now — against grandTotal, which for a POS
    // customer order is already net of the configured discount (see
    // isPosCustomerOrder above), so "remainingAmount" here is exactly
    // "post-discount total minus what the operator entered", the COD
    // balance. Only a true self-service (non-POS) checkout falls through
    // to computeAdvanceAmount's percentage rule.
    if (ctx.posAdvanceAmount != null) {
      if (!(ctx.posAdvanceAmount > 0) || ctx.posAdvanceAmount >= grandTotal) {
        return {
          ok: false,
          error: "Amount to collect now must be greater than zero and less than the order total.",
        };
      }
      advancePlan = {
        advanceAmount: round2(ctx.posAdvanceAmount),
        remainingAmount: round2(grandTotal - ctx.posAdvanceAmount),
        ruleLabel: "Amount entered by POS operator",
      };
    } else {
      const planResult = await computeAdvanceAmount(grandTotal, ctx.role);
      if (!planResult.ok) return planResult;
      advancePlan = planResult.plan;
    }
  }

  const walletRequested = round2(Math.max(0, input.walletAmountApplied ?? 0));
  const walletSplit = computeWalletSplit({
    kind: advancePlan ? "PARTIAL" : input.paymentMethod === "COD" ? "COD" : "PREPAID",
    grandTotal,
    advanceAmount: advancePlan?.advanceAmount,
    walletBalance: walletRequested > 0 ? await peekWalletBalance(userId) : 0,
    walletRequested,
  });
  const walletPlanned = walletSplit.walletApplied;
  // What is still due in cash on delivery for a partial order once the
  // wallet has taken its share of the remainder (0 = fully paid up front).
  const codDueAfterWallet = advancePlan ? walletSplit.codDue : 0;

  const actor = { id: userId, role: ctx.role as UserRole };
  // Only a partial order that still has a COD balance counts as partially
  // paid — a wallet that covers the whole remainder makes it fully paid once
  // the advance is captured.
  const isPartial = advancePlan != null && codDueAfterWallet > 0;
  // What is payable now: for a partial order, the wallet share plus the
  // advance (the wallet share is debited first, see applyInitialPayment);
  // everything else is the full total, with the wallet capped by it.
  const chargeAmount = advancePlan
    ? round2(walletPlanned + advancePlan.advanceAmount)
    : grandTotal;

  let transactionOutcome: {
    checkoutGroupId: string;
    groupNumber: string;
    razorpayOrder?: CheckoutSuccess["razorpayOrder"];
  };
  try {
    transactionOutcome = await prisma.$transaction(async (tx) => {
      const checkoutUser = await tx.user.findUnique({
        where: { id: userId },
        select: {
          deletionRequestedAt: true,
          dealerProfile: { select: { gstNumber: true } },
        },
      });
      if (!checkoutUser || checkoutUser.deletionRequestedAt) throw new AccountDeletionPendingError();

      const groupNumber = await generateCheckoutGroupNumber(tx);
      const group = await tx.checkoutGroup.create({
        data: {
          groupNumber,
          customerId: userId,
          customerType: ctx.role,
          placedByUserId: ctx.placedBy?.id ?? null,
          placedByName: ctx.placedBy?.name ?? null,
        },
      });
      await tx.orderAddressSnapshot.create({
        data: { checkoutGroupId: group.id, ...addressResult.snapshot },
      });

      const sellerOrderIds: string[] = [];
      let sellerIndex = 0;
      for (const draft of drafts) {
        const orderNumber = generateSellerOrderNumber(groupNumber, sellerIndex++);
        const invoiceNumber = generateInvoiceNumber(orderNumber);
        // Gross, pre-promo-discount total — this seller order's own
        // settlement basis (Phase 5 scope), deliberately never reduced by
        // the Kisan4u-borne promo discount. What the customer is actually
        // billed (net of that discount) is draft.customerPayableTotal,
        // stored on OrderCharge below.
        const totalAmount = draft.grossTotal;

        const sellerOrder = await tx.sellerOrder.create({
          data: {
            orderNumber,
            checkoutGroupId: group.id,
            customerId: userId,
            sellerId: draft.sellerId,
            customerType: ctx.role,
            buyerGstNumberSnapshot: checkoutUser.dealerProfile?.gstNumber ?? null,
            status: "PENDING_PAYMENT",
            paymentMethod: input.paymentMethod,
            deliveryMethod,
            transportNote: deliveryMethod === "TRANSPORT" ? (input.transportNote ?? null) : null,
            subtotal: draft.subtotal,
            discountAmount: 0,
            taxAmount: draft.taxAmount,
            totalAmount,
            invoiceNumber,
            placedByUserId: ctx.placedBy?.id ?? null,
            placedByName: ctx.placedBy?.name ?? null,
          },
        });

        await tx.orderItem.createMany({
          data: draft.lines.map((l) => {
            // See money.ts's resolveTaxBreakdown doc comment — subtotal is
            // the TAXABLE value, not sellingPrice*quantity verbatim; for a
            // tax-inclusive line this is what keeps subtotal+taxAmount
            // equal to sellingPrice*quantity instead of overcharging by
            // the tax amount a second time.
            const breakdown = resolveTaxBreakdown(
              round2(l.line.sellingPrice * l.quantity),
              l.line.taxPercent,
              l.line.taxCalcMode,
            );
            return {
              sellerOrderId: sellerOrder.id,
              productId: l.line.productId,
              productName: l.line.productName,
              productImageUrl: l.line.productImageUrl,
              variantId: l.line.variantId,
              variantLabel: l.line.variantLabel,
              sku: l.line.sku,
              quantity: l.quantity,
              unit: l.line.unit,
              unitWeightGrams: l.line.weightGrams,
              totalWeightGrams: l.line.weightGrams * l.quantity,
              mrp: l.line.mrp,
              unitPrice: l.line.sellingPrice,
              discountAmount: 0,
              taxRatePercent: l.line.taxPercent,
              taxCalcMode: l.line.taxCalcMode,
              taxAmount: breakdown.taxAmount,
              subtotal: breakdown.taxableValue,
              licenseRequiredSnapshot: l.line.licenseRequired,
              loyaltyPoints: l.line.loyaltyPoints,
            };
          }),
        });

        await tx.orderCharge.create({
          data: {
            sellerOrderId: sellerOrder.id,
            shipmentWeightGrams: draft.charges.shipmentWeightGrams,
            transportationCost: draft.charges.transportationCost,
            transportationPayer: draft.charges.transportationPayer,
            collectionCharge: draft.charges.collectionCharge,
            collectionChargePayer: draft.charges.collectionChargePayer,
            collectionChargeSnapshot: draft.charges
              .collectionChargeCalc as unknown as Prisma.InputJsonValue,
            customerPayableDelivery: draft.charges.customerPayableDelivery,
            kisan4uCollectedAmount: draft.charges.kisan4uCollectedAmount,
            sellerBorneAmount: draft.charges.sellerBorneAmount,
            slabSnapshot: draft.charges.slabSnapshot as Prisma.InputJsonValue,
            promotionalDiscountPercent: draftResult.promoDiscountPercent,
            promotionalDiscountAmount: draft.promoDiscountAmount,
            promotionalDiscountPayer: "KISAN4U",
            customerPayableTotal: draft.customerPayableTotal,
            kisan4uBorneAmount: draft.promoDiscountAmount,
          },
        });

        await tx.orderStatusHistory.create({
          data: {
            sellerOrderId: sellerOrder.id,
            status: "PENDING_PAYMENT",
            actorId: userId,
            actorRole: ctx.role,
            source: "CUSTOMER",
            note: "Order placed",
          },
        });

        sellerOrderIds.push(sellerOrder.id);

        if (appliedCoupon && draft.couponDiscountAmount > 0) {
          await tx.couponRedemption.create({
            data: {
              couponId: appliedCoupon.couponId,
              userId,
              sellerOrderId: sellerOrder.id,
              discountAmount: draft.couponDiscountAmount,
            },
          });
        }
      }

      // Once per CHECKOUT (not once per seller order) — a multi-vendor
      // cart that splits into several SellerOrders still only counts as
      // one coupon use, matching usageLimit/perUserLimit's intent. Mirrors
      // the { increment } pattern already used in wallet.ts.
      if (appliedCoupon) {
        await tx.coupon.update({
          where: { id: appliedCoupon.couponId },
          data: { usageCount: { increment: 1 } },
        });
      }

      const internalReference = `PAY-${groupNumber}`;
      const remainingDueNote =
        input.paymentMethod === "COD"
          ? "Full amount due on delivery (COD)"
          : codDueAfterWallet > 0
            ? `Remaining ₹${codDueAfterWallet} due on delivery`
            : null;

      const payment = await tx.payment.create({
        data: {
          checkoutGroupId: group.id,
          customerId: userId,
          method: input.paymentMethod,
          status: "PENDING",
          totalAmount: chargeAmount,
          internalReference,
          remainingDueNote,
        },
      });

      // Allocated by each seller order's NET (post-promo-discount) share of
      // the actual amount charged — using the gross total here would
      // over-allocate once a customer discount applies, since
      // grandTotal/chargeAmount are already net. Split via
      // allocateProportionally (largest-remainder, paise-exact) rather than
      // rounding each share independently — independent round2() per share
      // can undershoot/overshoot chargeAmount by a paisa or more (e.g. a
      // multi-seller POS partial-prepaid order showing "₹99.98 + COD" in
      // the admin table for a ₹100 entry), which this guarantees can't
      // happen since the shares always sum back to exactly chargeAmount.
      const allocationShares = allocateProportionally(
        chargeAmount,
        drafts.map((draft) => draft.customerPayableTotal),
      );
      await tx.paymentAllocation.createMany({
        data: drafts.map((draft, i) => ({
          paymentId: payment.id,
          sellerOrderId: sellerOrderIds[i]!,
          amount: allocationShares[i]!,
        })),
      });
      await tx.paymentStatusHistory.create({
        data: { paymentId: payment.id, status: "PENDING", source: "CUSTOMER" },
      });

      const paymentOutcome = await applyInitialPayment(tx, {
        paymentId: payment.id,
        sellerOrderIds,
        paymentMethod: input.paymentMethod,
        actor,
        chargeAmount,
        walletRequestedAmount: input.walletAmountApplied ?? 0,
        // A partial order's wallet share is capped by what was planned, not
        // by the whole "pay now" figure — that also contains the advance.
        walletEligibleCap: advancePlan ? walletPlanned : undefined,
        isPartial,
        devSimulate: input.devSimulatePaymentOutcome,
        requiresManualPaymentApproval: ctx.requiresManualPaymentApproval ?? false,
      });

      const checkedOutCartItemIds = drafts.flatMap((draft) => draft.lines.map((l) => l.cartItemId));
      await tx.cartItem.deleteMany({ where: { id: { in: checkedOutCartItemIds } } });

      return { checkoutGroupId: group.id, groupNumber, razorpayOrder: paymentOutcome.razorpayOrder };
    });
  } catch (error) {
    if (error instanceof AccountDeletionPendingError) {
      return { ok: false, error: "Restore your account before placing a new order." };
    }
    if (error instanceof InsufficientStockError) {
      return {
        ok: false,
        error:
          "One of the items in your cart just went out of stock. Please review your cart and try again.",
      };
    }
    throw error;
  }

  return {
    ok: true,
    checkoutGroupId: transactionOutcome.checkoutGroupId,
    groupNumber: transactionOutcome.groupNumber,
    razorpayOrder: transactionOutcome.razorpayOrder,
  };
}

class AccountDeletionPendingError extends Error {}

export type CancelUnpaidCheckoutResult = { ok: true; cancelled: number } | { ok: false; error: string };

/**
 * Cancels every still-unpaid SellerOrder from one checkout attempt — the
 * customer/dealer opened the Razorpay Checkout widget and then dismissed
 * it without paying (or the browser tab was closed; see
 * apps/web/src/instrumentation-node.ts's sweep for that case, which calls
 * this same function by payment age instead of a live dismiss event).
 *
 * checkout()'s own transaction creates the SellerOrder/OrderItem rows and
 * clears the cart BEFORE payment is known to have succeeded (Razorpay
 * requires a real order to open its widget against) — that's what made an
 * abandoned widget leave behind a real, visible "Pending" order with zero
 * money collected. This is the other half: a leftover Payment row still
 * PENDING with nothing captured (amountPaid 0, no razorpayPaymentId) means
 * the widget was never completed, so every SellerOrder it would have
 * covered is cancelled outright — no settlement/refund step, since
 * nothing was ever collected (paidSoFarFor is 0 for a payment matching
 * this filter).
 *
 * Race-safe against the payment.captured webhook landing at the same
 * moment: only a Payment still exactly {status: PENDING, amountPaid: 0,
 * razorpayPaymentId: null} matches the query, and each SellerOrder is
 * re-checked for PENDING_PAYMENT immediately before cancelling it inside
 * the same transaction — a payment that actually succeeded in between is
 * silently left alone rather than wrongly cancelled.
 */
export async function cancelUnpaidCheckoutGroup(
  customerId: string,
  actorRole: UserRole,
  checkoutGroupId: string,
): Promise<CancelUnpaidCheckoutResult> {
  const payments = await prisma.payment.findMany({
    where: {
      checkoutGroupId,
      customerId,
      status: "PENDING",
      amountPaid: 0,
      razorpayPaymentId: null,
    },
    include: { allocations: { select: { sellerOrderId: true } } },
  });
  // Nothing matches when there's genuinely nothing to abandon (a COD/
  // wallet-only checkout never created a Payment row here) or the payment
  // already moved on (captured, or already cancelled) — either way, ok.
  if (payments.length === 0) return { ok: true, cancelled: 0 };

  const actor = { id: customerId, role: actorRole };
  let cancelled = 0;

  await prisma.$transaction(async (tx) => {
    // Lines from every order we actually cancel here, so the buyer's cart
    // can be put back exactly as it was before this abandoned checkout —
    // checkout() clears the cart up front (Razorpay needs a real order to
    // open its widget against), so without this an exited / failed payment
    // silently empties the cart.
    const restore: {
      userId: string;
      productId: string;
      variantId: string | null;
      sellerId: string;
      quantity: number;
      priceAtAdd: Prisma.Decimal;
    }[] = [];

    for (const payment of payments) {
      await tx.payment.update({ where: { id: payment.id }, data: { status: "CANCELLED" } });
      await tx.paymentStatusHistory.create({
        data: {
          paymentId: payment.id,
          status: "CANCELLED",
          source: "CUSTOMER",
          note: "Payment window closed before completing payment",
        },
      });

      for (const allocation of payment.allocations) {
        const order = await tx.sellerOrder.findUnique({
          where: { id: allocation.sellerOrderId },
          select: {
            status: true,
            sellerId: true,
            items: {
              select: { productId: true, variantId: true, quantity: true, unitPrice: true },
            },
          },
        });
        if (!order || order.status !== "PENDING_PAYMENT") continue;
        const transition = await recordStatusChange(
          tx,
          allocation.sellerOrderId,
          "PENDING_PAYMENT",
          "CANCELLED",
          actor,
          "CUSTOMER",
          "Payment window closed before completing payment",
        );
        if (transition.ok) {
          cancelled += 1;
          for (const line of order.items) {
            restore.push({
              userId: customerId,
              productId: line.productId,
              variantId: line.variantId,
              sellerId: order.sellerId,
              quantity: line.quantity,
              priceAtAdd: line.unitPrice,
            });
          }
        }
      }
    }

    if (restore.length > 0) {
      // Don't duplicate a line the buyer has already re-added to their
      // cart since the abandoned checkout (there's no unique constraint on
      // userId+productId+variantId to upsert against).
      const existing = await tx.cartItem.findMany({
        where: { userId: customerId },
        select: { productId: true, variantId: true },
      });
      const have = new Set(existing.map((e) => `${e.productId}::${e.variantId ?? ""}`));
      const merged = new Map<string, (typeof restore)[number]>();
      for (const row of restore) {
        const key = `${row.productId}::${row.variantId ?? ""}`;
        if (have.has(key) || merged.has(key)) continue;
        merged.set(key, row);
      }
      if (merged.size > 0) {
        await tx.cartItem.createMany({ data: [...merged.values()] });
      }
    }
  });

  if (cancelled > 0) {
    await writeAuditLog({
      actorId: customerId,
      actorRole,
      action: "UNPAID_CHECKOUT_CANCELLED",
      entityType: "CheckoutGroup",
      entityId: checkoutGroupId,
      metadata: { cancelled },
    });
  }

  return { ok: true, cancelled };
}

/**
 * The tab-close counterpart to cancelUnpaidCheckoutGroup's live dismiss
 * event — a customer who closes the browser instead of dismissing the
 * Razorpay widget never fires the client-side abandon call, so this sweep
 * (apps/web/src/instrumentation-node.ts, on a timer) catches it: any
 * Payment still PENDING/uncaptured with a real Razorpay order attached
 * (never a COD/wallet-only checkout, which has no razorpayOrderId) and
 * older than `maxAgeMinutes` gets cancelled the same way. Grouped by
 * checkoutGroupId first so a multi-seller checkout's several SellerOrders
 * (one shared Payment) are cancelled together in one call, same as the
 * live path.
 */
export async function sweepStaleUnpaidCheckouts(
  maxAgeMinutes = 20,
): Promise<{ checked: number; cancelled: number }> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
  const stalePayments = await prisma.payment.findMany({
    where: {
      status: "PENDING",
      amountPaid: 0,
      razorpayPaymentId: null,
      razorpayOrderId: { not: null },
      createdAt: { lt: cutoff },
    },
    select: { customerId: true, checkoutGroupId: true },
  });

  const groups = new Map<string, string>();
  for (const p of stalePayments) groups.set(p.checkoutGroupId, p.customerId);

  let cancelled = 0;
  for (const [checkoutGroupId, customerId] of groups) {
    const user = await prisma.user.findUnique({ where: { id: customerId }, select: { role: true } });
    const role = user?.role === "DEALER" ? "DEALER" : "CUSTOMER";
    const result = await cancelUnpaidCheckoutGroup(customerId, role, checkoutGroupId);
    if (result.ok) cancelled += result.cancelled;
  }

  return { checked: stalePayments.length, cancelled };
}
