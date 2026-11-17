export function clampQuantity(value: number, min: number, max?: number) {
  const safeMin = Math.max(1, Math.floor(min));
  const safeMax = max == null ? Number.MAX_SAFE_INTEGER : Math.max(safeMin, Math.floor(max));
  const integer = Number.isFinite(value) ? Math.floor(value) : safeMin;
  return Math.min(safeMax, Math.max(safeMin, integer));
}
