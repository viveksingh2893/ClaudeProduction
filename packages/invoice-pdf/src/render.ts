import type { InvoiceData, SellerLabelData } from "@kisan4u/orders";
import { buildInvoiceDocument } from "./InvoiceDocument";
import { buildSellerLabelDocument } from "./SellerLabelDocument";

/**
 * Renders a fresh PDF from live invoice data every call — never cached,
 * per the requirement that Paid/Balance always reflect the current
 * payment state.
 *
 * `@react-pdf/renderer` ships pure ESM whose PDF engine (pdfkit/fontkit)
 * does real binary/font-metrics work at import time. When Next.js's
 * webpack bundles that into the server chunk (it does, even with
 * `serverExternalPackages` set — that option turned out not to take
 * effect for this Route Handler in practice), something in that bundled
 * copy breaks deep inside the layout engine on every real render
 * (`TypeError: Cannot read properties of undefined (reading 'S')`,
 * traced to react-pdf's own internals, not our code — confirmed by the
 * fact the exact same document + data renders correctly in a plain,
 * unbundled Node script). The `webpackIgnore` magic comment makes webpack
 * leave this specific import alone entirely, so it resolves via Node's
 * own module loader at request time — identical to how it behaves
 * outside any bundler, which is the configuration actually proven to
 * work. See InvoiceDocument.tsx's buildInvoiceDocument for why the
 * react-pdf module is threaded through as a parameter instead of a
 * regular top-level import (a static import anywhere in this module's
 * graph would let webpack bundle it right back in).
 *
 * Because this now resolves via Node's own module loader instead of
 * webpack, it's also subject to Node's own resolution rules: a bare
 * specifier resolves by walking up from the *importing file's own
 * location* (this compiled chunk lives under each app's own
 * `.next/server/`) looking for `node_modules/@react-pdf/renderer` — not
 * from wherever `@kisan4u/invoice-pdf` itself sits in the workspace. In
 * this pnpm workspace's strict (non-hoisting) node_modules layout,
 * that only resolves if the consuming app *itself* also declares
 * `@react-pdf/renderer` as a direct dependency (apps/dashboard,
 * apps/web) — depending on it only transitively through
 * `@kisan4u/invoice-pdf` isn't enough, since pnpm won't have symlinked
 * it into the app's own node_modules.
 */
export async function renderInvoicePdf(invoice: InvoiceData): Promise<Buffer> {
  const reactPdf = await import(/* webpackIgnore: true */ "@react-pdf/renderer");
  const element = buildInvoiceDocument(reactPdf, invoice);
  return reactPdf.renderToBuffer(element);
}

/** Seller shipping label — same react-pdf loading constraints as renderInvoicePdf above (webpackIgnore'd dynamic import, direct dependency in the consuming app). */
export async function renderSellerLabelPdf(label: SellerLabelData): Promise<Buffer> {
  const reactPdf = await import(/* webpackIgnore: true */ "@react-pdf/renderer");
  const element = buildSellerLabelDocument(reactPdf, label);
  return reactPdf.renderToBuffer(element);
}
