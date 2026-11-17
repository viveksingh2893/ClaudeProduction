/**
 * RapidShyp has no push/webhook API — checked their full published API
 * surface (docs.rapidshyp.com's own sitemap lists every endpoint they
 * expose: Forward B2C, Tracking, Pickup Location, Return, Wrapper — no
 * webhook/callback category exists anywhere in it). Their Tracking API
 * is pull-only, so staying current on courier location/delivery/RTO
 * without someone clicking "Refresh status" by hand means polling it
 * ourselves on a timer. register() is Next's documented place to start
 * that kind of background work — it runs once when the server process
 * boots, which for this app is a single long-running `next start`
 * process under systemd (not a per-request/serverless invocation), so
 * the poller's setInterval (in instrumentation-node.ts) runs exactly
 * once, not once per request.
 *
 * The dynamic import is gated by this exact `if
 * (process.env.NEXT_RUNTIME === 'nodejs')` shape (not an early return)
 * because Next's build specifically recognizes this pattern to exclude
 * the import from the edge-runtime bundle it also builds this file for
 * — the Node-only pg driver behind @kisan4u/orders doesn't bundle for
 * edge (it needs Node's `stream` module).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCourierTrackingPollers } = await import("./instrumentation-node");
    await startCourierTrackingPollers();
  }
}
