import { prisma, type UserRole } from "@kisan4u/db";

/**
 * TCS and TDS are fixed statutory rates, not an admin-configurable business
 * rule — the task spec is explicit that these must never be edited by a
 * user. Kept as exported constants (not columns on SettlementRateConfig)
 * specifically so there is no admin UI path that could ever change them;
 * each SellerSettlement row still snapshots the rate actually applied
 * (tcsRatePercent/tdsRatePercent), which lets a future statutory-rate change
 * update these constants without altering historical settlements.
 */
export const FIXED_TCS_PERCENT = 0.5;
export const FIXED_TDS_PERCENT = 0.1;

export type ResolvedSettlementRates = {
  commissionGstPercent: number;
  logisticsGstPercent: number;
  collectionChargeGstPercent: number;
  /** null when no SettlementRateConfig exists at all yet — falls back to all-zero rates rather than blocking settlement creation, same "missing config -> 0, not a block" convention as CollectionChargeConfig (see charges.ts). */
  sourceConfigId: string | null;
};

const ZERO_RATES: Omit<ResolvedSettlementRates, "sourceConfigId"> = {
  commissionGstPercent: 0,
  logisticsGstPercent: 0,
  collectionChargeGstPercent: 0,
};

/**
 * Most-specific-wins resolution — a "seller override wins, else platform
 * default" precedent, extended with an optional customerType axis so
 * Dealer vs Customer rates can differ per seller:
 *   (sellerId, customerType) > (sellerId, null) > (null, customerType) > (null, null)
 * Ties within a tier are broken by most-recently-created (an admin editing
 * rates creates a new row rather than mutating the old one, so old
 * settlements' snapshots are never affected by a later rate change).
 */
export async function resolveSettlementRates(
  sellerId: string,
  customerType: UserRole,
): Promise<ResolvedSettlementRates> {
  const candidates = await prisma.settlementRateConfig.findMany({
    where: {
      isActive: true,
      OR: [
        { sellerId, customerType },
        { sellerId, customerType: null },
        { sellerId: null, customerType },
        { sellerId: null, customerType: null },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  const resolved =
    candidates.find((c) => c.sellerId === sellerId && c.customerType === customerType) ??
    candidates.find((c) => c.sellerId === sellerId && c.customerType === null) ??
    candidates.find((c) => c.sellerId === null && c.customerType === customerType) ??
    candidates.find((c) => c.sellerId === null && c.customerType === null);

  if (!resolved) return { ...ZERO_RATES, sourceConfigId: null };

  return {
    commissionGstPercent: Number(resolved.commissionGstPercent),
    logisticsGstPercent: Number(resolved.logisticsGstPercent),
    collectionChargeGstPercent: Number(resolved.collectionChargeGstPercent),
    sourceConfigId: resolved.id,
  };
}

// 2 days = 48 hours — the post-delivery hold before a settlement is
// ELIGIBLE, and the window inside which a return may be requested (they are
// the same rule on purpose: see SettlementSettings' schema doc comment).
const DEFAULT_HOLD_DAYS = 2;

/** True singleton, like SiteSettings — see SettlementSettings' schema doc comment. */
export async function resolveSettlementHoldDays(): Promise<number> {
  const settings = await prisma.settlementSettings.findUnique({ where: { id: "singleton" } });
  return settings?.holdDays ?? DEFAULT_HOLD_DAYS;
}

/**
 * The return window, in milliseconds after the delivery instant — the same
 * knob as the settlement hold (holdDays), exposed as a duration so
 * refunds.ts:requestReturn and settlement eligibility can never drift
 * apart. A return requested after this has elapsed is rejected; a return
 * approved within it is against a still-PENDING settlement that can be
 * cleanly voided.
 */
export async function resolveReturnWindowMs(): Promise<number> {
  const holdDays = await resolveSettlementHoldDays();
  return holdDays * 24 * 60 * 60 * 1000;
}

export async function saveSettlementHoldDays(holdDays: number): Promise<void> {
  await prisma.settlementSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", holdDays },
    update: { holdDays },
  });
}

export type SettlementRateConfigInput = {
  id?: string;
  label: string;
  sellerId?: string | null;
  customerType?: UserRole | null;
  commissionGstPercent: number;
  logisticsGstPercent: number;
  collectionChargeGstPercent: number;
  isActive: boolean;
  isDemo?: boolean;
};

export async function listSettlementRateConfigs(sellerId?: string) {
  return prisma.settlementRateConfig.findMany({
    where: sellerId ? { OR: [{ sellerId }, { sellerId: null }] } : undefined,
    orderBy: { createdAt: "desc" },
  });
}

export async function saveSettlementRateConfig(
  input: SettlementRateConfigInput,
): Promise<{ ok: true; id: string }> {
  const data = {
    label: input.label,
    sellerId: input.sellerId ?? null,
    customerType: input.customerType ?? null,
    commissionGstPercent: input.commissionGstPercent,
    logisticsGstPercent: input.logisticsGstPercent,
    collectionChargeGstPercent: input.collectionChargeGstPercent,
    isActive: input.isActive,
    isDemo: input.isDemo ?? false,
  };
  const row = input.id
    ? await prisma.settlementRateConfig.update({ where: { id: input.id }, data })
    : await prisma.settlementRateConfig.create({ data });
  return { ok: true, id: row.id };
}

export async function setSettlementRateConfigActive(
  id: string,
  isActive: boolean,
): Promise<{ ok: true; id: string }> {
  const row = await prisma.settlementRateConfig.update({ where: { id }, data: { isActive } });
  return { ok: true, id: row.id };
}
