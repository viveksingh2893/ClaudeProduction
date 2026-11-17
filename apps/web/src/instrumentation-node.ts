// Split out from instrumentation.ts so its Node-only imports (through
// @kisan4u/orders -> @kisan4u/db -> pg) never reach the edge runtime
// bundle Next also builds instrumentation.ts for — importing pg there
// fails (it needs Node's `stream` module, unavailable on edge).

const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes
const MAX_UNPAID_AGE_MINUTES = 20; // Razorpay's own Checkout session window is well under this

/**
 * Cancels any checkout whose Razorpay order was created more than
 * MAX_UNPAID_AGE_MINUTES ago and never actually captured a payment (the
 * customer closed the tab instead of dismissing the widget, so
 * abandonCheckoutAction's live call never fired). See
 * @kisan4u/orders' sweepStaleUnpaidCheckouts for the exact, race-safe
 * query and cancellation.
 */
export function startUnpaidCheckoutSweep() {
  async function run() {
    try {
      const { sweepStaleUnpaidCheckouts } = await import("@kisan4u/orders");
      const summary = await sweepStaleUnpaidCheckouts(MAX_UNPAID_AGE_MINUTES);
      if (summary.cancelled > 0) {
        console.log(
          `[unpaid-checkout-sweep] cancelled ${summary.cancelled} order(s) from ${summary.checked} stale unpaid payment(s)`,
        );
      }
    } catch (err) {
      console.error("[unpaid-checkout-sweep] failed:", err);
    }
  }
  setInterval(run, SWEEP_INTERVAL_MS);
  // First sweep shortly after boot rather than waiting a full interval.
  setTimeout(run, 60_000);
}

/**
 * Periodic abandoned-cart reminder — buyers who added to cart and never
 * reached checkout get one nudge (in-app notification + push) per
 * cooldown window. Schedule + eligibility live in @kisan4u/orders'
 * sweepAbandonedCarts; startAbandonedCartSweep is idempotent.
 */
export function startAbandonedCartReminders() {
  import("@kisan4u/orders")
    .then(({ startAbandonedCartSweep }) => startAbandonedCartSweep())
    .catch((err) => console.error("[abandoned-cart] failed to start:", err));
}

export function startAccountDeletionSweep() {
  async function run() {
    try {
      const { sweepScheduledAccountDeletions } = await import("@kisan4u/orders");
      const summary = await sweepScheduledAccountDeletions();
      if (summary.completed > 0 || summary.blocked > 0) {
        console.log(
          `[account-deletion-sweep] completed=${summary.completed} blocked=${summary.blocked} checked=${summary.checked}`,
        );
      }
    } catch (err) {
      console.error("[account-deletion-sweep] failed:", err);
    }
  }
  setInterval(run, 60 * 60 * 1000);
  setTimeout(run, 60_000);
}
