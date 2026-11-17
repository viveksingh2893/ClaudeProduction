/**
 * Storefront-side background sweep — the tab-close counterpart to
 * checkout-form.tsx's live "Razorpay widget dismissed" abandon call
 * (apps/web/src/app/checkout/actions.ts's abandonCheckoutAction). A
 * customer who closes the browser instead of dismissing the widget never
 * fires that client-side call, so a periodic sweep is what still catches
 * it — see instrumentation-node.ts. register() is Next's documented place
 * to start this kind of background work; it runs once when the server
 * process boots (this app runs as a single long-running `next start`
 * process under systemd, not per-request/serverless), so the sweep's
 * setInterval runs exactly once, not once per request. Same split-file
 * shape as apps/dashboard's own instrumentation.ts, for the same reason:
 * the Node-only pg driver behind @kisan4u/orders doesn't bundle for the
 * edge runtime Next also builds this file for.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startUnpaidCheckoutSweep, startAbandonedCartReminders, startAccountDeletionSweep } = await import(
      "./instrumentation-node"
    );
    startUnpaidCheckoutSweep();
    startAbandonedCartReminders();
    startAccountDeletionSweep();
  }
}
