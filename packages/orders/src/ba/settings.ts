/**
 * BA program configuration:
 *   - BaSettings  — a true singleton of the configurable flat amounts
 *                   (registration ₹, dealer signup ₹, dealer approval ₹,
 *                   default commission %, return-window hours).
 *   - BaRateConfig — per-seller / per-customer-type commission %, versioned,
 *                    most-specific-wins (mirrors settlement-rates.ts exactly).
 *
 * All config changes are FORWARD-ONLY: every BaEarning snapshots the figure
 * it was computed from, so editing settings never rewrites a past earning.
 */

import { prisma, type UserRole } from "@kisan4u/db";

const SINGLETON_ID = "singleton";

export type BaSettingsView = {
  registrationAmount: number;
  dealerSignupAmount: number;
  dealerApprovalAmount: number;
  defaultCommissionPercent: number;
  returnWindowHours: number;
};

const DEFAULTS: BaSettingsView = {
  registrationAmount: 50,
  dealerSignupAmount: 50,
  dealerApprovalAmount: 50,
  defaultCommissionPercent: 2,
  returnWindowHours: 48,
};

/** Reads (and lazily creates) the singleton. Never throws on a missing row. */
export async function getBaSettings(): Promise<BaSettingsView> {
  const row = await prisma.baSettings.findUnique({ where: { id: SINGLETON_ID } });
  if (!row) return { ...DEFAULTS };
  return {
    registrationAmount: Number(row.registrationAmount),
    dealerSignupAmount: Number(row.dealerSignupAmount),
    dealerApprovalAmount: Number(row.dealerApprovalAmount),
    defaultCommissionPercent: Number(row.defaultCommissionPercent),
    returnWindowHours: row.returnWindowHours,
  };
}

export async function saveBaSettings(input: BaSettingsView): Promise<{ ok: true }> {
  await prisma.baSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...input },
    update: { ...input },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// BaRateConfig — per-seller / per-customer-type commission %
// ---------------------------------------------------------------------------

export type ResolvedBaRate = {
  commissionPercent: number;
  /** null => no matching row; the caller falls back to BaSettings.defaultCommissionPercent. */
  sourceConfigId: string | null;
};

/**
 * Most-specific-wins:
 *   (sellerId, customerType) > (sellerId, null) > (null, customerType) > (null, null)
 * Ties broken by most-recently-created — an admin editing a rate creates a
 * new row, never mutates the old one, so historical earnings are untouched.
 */
export async function resolveBaCommissionRate(
  sellerId: string,
  customerType: UserRole,
): Promise<ResolvedBaRate> {
  const candidates = await prisma.baRateConfig.findMany({
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

  if (!resolved) {
    const settings = await getBaSettings();
    return { commissionPercent: settings.defaultCommissionPercent, sourceConfigId: null };
  }
  return { commissionPercent: Number(resolved.commissionPercent), sourceConfigId: resolved.id };
}

export type BaRateConfigInput = {
  id?: string;
  label: string;
  sellerId?: string | null;
  customerType?: UserRole | null;
  commissionPercent: number;
  isActive: boolean;
  isDemo?: boolean;
};

export async function listBaRateConfigs(sellerId?: string) {
  return prisma.baRateConfig.findMany({
    where: sellerId ? { OR: [{ sellerId }, { sellerId: null }] } : undefined,
    orderBy: { createdAt: "desc" },
    include: { seller: { select: { id: true, shopName: true } } },
  });
}

export async function saveBaRateConfig(input: BaRateConfigInput): Promise<{ ok: true; id: string }> {
  const data = {
    label: input.label,
    sellerId: input.sellerId ?? null,
    customerType: input.customerType ?? null,
    commissionPercent: input.commissionPercent,
    isActive: input.isActive,
    isDemo: input.isDemo ?? false,
  };
  const row = input.id
    ? await prisma.baRateConfig.update({ where: { id: input.id }, data })
    : await prisma.baRateConfig.create({ data });
  return { ok: true, id: row.id };
}

export async function setBaRateConfigActive(
  id: string,
  isActive: boolean,
): Promise<{ ok: true; id: string }> {
  const row = await prisma.baRateConfig.update({ where: { id }, data: { isActive } });
  return { ok: true, id: row.id };
}

/** True when the program kill switch (SiteSettings.baProgramEnabled) is on. */
export async function isBaProgramEnabled(): Promise<boolean> {
  const s = await prisma.siteSettings.findUnique({
    where: { id: SINGLETON_ID },
    select: { baProgramEnabled: true },
  });
  return s?.baProgramEnabled ?? false;
}

/** Flip the program kill switch. */
export async function setBaProgramEnabled(enabled: boolean): Promise<{ ok: true }> {
  await prisma.siteSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, baProgramEnabled: enabled },
    update: { baProgramEnabled: enabled },
  });
  return { ok: true };
}
