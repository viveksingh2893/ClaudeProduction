/**
 * The logistics partners the Create Shipment wizard
 * (components/orders/logistics-wizard-modal) renders as cards. A plain
 * client-safe list — "dynamic" in the sense that the wizard renders
 * whatever this array holds, so adding a real third courier later is a
 * one-entry change here (plus its server-side provider wiring in
 * @kisan4u/orders). `key` matches Shipment.provider and the
 * dispatchViaWizardInputSchema enum in @kisan4u/validators.
 *
 * Lives in the app (not @kisan4u/providers) on purpose: that package's
 * entry point pulls in server-only modules (node:crypto, node:dns) and
 * can't be imported from a client component.
 */
export type LogisticsPartnerKey = "RAPIDSHYP" | "DELHIVERY" | "MOCK";

export interface LogisticsPartner {
  key: LogisticsPartnerKey;
  name: string;
  /** Whether the partner can carry a Cash-on-Delivery shipment. */
  codAvailable: boolean;
  /** Whether the partner only accepts prepaid shipments. */
  prepaidOnly: boolean;
  /** Short delivery-time blurb shown on the card. */
  etaText: string;
  /** One-line description under the name. */
  description: string;
}

export type DelhiveryAccountKey = "MARKETING1" | "SURFACE_500G" | "SURFACE_1";

/**
 * The three Delhivery accounts, picked at dispatch time (each has its own
 * API token server-side). Keys match @kisan4u/validators' delhiveryAccountEnum.
 */
export const DELHIVERY_ACCOUNTS: { key: DelhiveryAccountKey; label: string }[] = [
  { key: "MARKETING1", label: "Kisan4uMarketing1 Surface" },
  { key: "SURFACE_500G", label: "Kisan4u500g Surface" },
  { key: "SURFACE_1", label: "Kisan4u1 Surface" },
];

export const LOGISTICS_PARTNERS: LogisticsPartner[] = [
  {
    key: "RAPIDSHYP",
    name: "RapidShyp",
    codAvailable: true,
    prepaidOnly: false,
    etaText: "1–5 days delivery",
    description: "Live multi-courier aggregator",
  },
  {
    key: "DELHIVERY",
    name: "Delhivery",
    codAvailable: true,
    prepaidOnly: false,
    etaText: "2–6 days delivery",
    description: "Direct Delhivery courier integration",
  },
  {
    key: "MOCK",
    name: "Third Party Transport",
    codAvailable: true,
    prepaidOnly: false,
    etaText: "Manual / internal",
    description: "Manual dispatch — no external courier API",
  },
];
