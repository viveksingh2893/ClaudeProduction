import { prisma } from "@kisan4u/db";
import type { PartialPaymentConfigInput, CollectionChargeConfigInput } from "@kisan4u/validators";

export type ConfigResult = { ok: true; id: string } | { ok: false; error: string };

// --- Partial-payment configuration (Phase 4 spec §I3) -----------------------

export async function listPartialPaymentConfigs() {
  return prisma.partialPaymentConfig.findMany({ orderBy: { createdAt: "desc" } });
}

export async function savePartialPaymentConfig(
  input: PartialPaymentConfigInput,
): Promise<ConfigResult> {
  const data = {
    label: input.label,
    appliesTo: input.appliesTo ?? null,
    ruleType: input.ruleType,
    value: input.value,
    isActive: input.isActive,
    isDemo: input.isDemo,
  };
  const row = input.id
    ? await prisma.partialPaymentConfig.update({ where: { id: input.id }, data })
    : await prisma.partialPaymentConfig.create({ data });
  return { ok: true, id: row.id };
}

export async function setPartialPaymentConfigActive(
  id: string,
  isActive: boolean,
): Promise<ConfigResult> {
  const row = await prisma.partialPaymentConfig.update({ where: { id }, data: { isActive } });
  return { ok: true, id: row.id };
}

// --- Collection-charge configuration (Phase 4 spec §G1/§H2) ----------------

export async function listCollectionChargeConfigs() {
  return prisma.collectionChargeConfig.findMany({ orderBy: { createdAt: "desc" } });
}

export async function saveCollectionChargeConfig(
  input: CollectionChargeConfigInput,
): Promise<ConfigResult> {
  const data = {
    label: input.label,
    chargeType: input.chargeType,
    value: input.value,
    minCharge: input.minCharge ?? null,
    maxCharge: input.maxCharge ?? null,
    isActive: input.isActive,
  };
  const row = input.id
    ? await prisma.collectionChargeConfig.update({ where: { id: input.id }, data })
    : await prisma.collectionChargeConfig.create({ data });
  return { ok: true, id: row.id };
}

export async function setCollectionChargeConfigActive(
  id: string,
  isActive: boolean,
): Promise<ConfigResult> {
  const row = await prisma.collectionChargeConfig.update({ where: { id }, data: { isActive } });
  return { ok: true, id: row.id };
}
