// Split out from instrumentation.ts so its Node-only imports (through
// @kisan4u/orders -> @kisan4u/db -> pg) never reach the edge runtime
// bundle Next also builds instrumentation.ts for — importing pg there
// fails (it needs Node's `stream` module, unavailable on edge).
type PollSummary = { errors: { sellerOrderId: string; error: string }[] };

/**
 * Neither RapidShyp nor our Delhivery integration receives push updates by
 * default (RapidShyp has no webhook at all; Delhivery's needs a manual
 * onboarding), so courier status is kept current by polling both on a
 * timer. One poller per configured provider.
 */
export async function startCourierTrackingPollers() {
  const { pollActiveRapidShypShipments, pollActiveDelhiveryShipments } = await import(
    "@kisan4u/orders"
  );

  const POLL_INTERVAL_MS = 20 * 60 * 1000;

  function schedule(name: string, poll: () => Promise<PollSummary>) {
    async function run() {
      try {
        const summary = await poll();
        if (summary.errors.length > 0) {
          console.error(`[${name}] errors on`, summary.errors.length, "order(s):", summary.errors);
        }
      } catch (err) {
        console.error(`[${name}] poll failed:`, err);
      }
    }
    setInterval(run, POLL_INTERVAL_MS);
    // First poll shortly after boot rather than waiting a full interval.
    setTimeout(run, 60_000);
  }

  if (process.env.RAPIDSHYP_API_KEY) schedule("rapidshyp-poll", pollActiveRapidShypShipments);
  if (
    process.env.DELHIVERY_TOKEN_MARKETING1 ||
    process.env.DELHIVERY_TOKEN_500G ||
    process.env.DELHIVERY_TOKEN_1 ||
    process.env.DELHIVERY_API_TOKEN
  )
    schedule("delhivery-poll", pollActiveDelhiveryShipments);
}
