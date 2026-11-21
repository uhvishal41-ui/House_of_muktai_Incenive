export type TargetProgressStatus = 'ACHIEVED' | 'ON_TRACK' | 'IN_PROGRESS' | 'NOT_STARTED';

export interface TargetProgressMetrics {
  salePct: number;
  remainingSalePaise: number;
  qtyPct: number;
  remainingQty: number;
  status: TargetProgressStatus;
}

/**
 * Computes a growth-adjusted monthly sales target (in paise) from a baseline month's sale.
 * Example: baseline ₹1,00,000 (10,000,000 paise) + 10% growth => ₹1,10,000 (11,000,000 paise).
 * Rounds to the nearest whole rupee for clean management targets.
 * When baseline is 0, applies optional fallbackRupees for new staff.
 */
export function computeGrowthTargetPaise(
  baselinePaise: number,
  growthPct: number,
  fallbackRupees = 0,
): number {
  const safeBaseline = Number.isFinite(baselinePaise) ? Math.max(0, baselinePaise) : 0;
  const safePct = Number.isFinite(growthPct) ? growthPct : 0;

  if (safeBaseline <= 0) {
    const safeFallback = Number.isFinite(fallbackRupees) ? Math.max(0, fallbackRupees) : 0;
    return Math.round(safeFallback) * 100;
  }

  const multiplier = Math.max(0, 1 + safePct / 100);
  const targetRupees = Math.round((safeBaseline / 100) * multiplier);
  return Math.max(0, targetRupees) * 100;
}

/**
 * Computes a growth-adjusted monthly sale quantity target from a baseline month's quantity.
 */
export function computeGrowthTargetQty(
  baselineQty: number,
  growthPct: number,
  applyQtyGrowth: boolean,
): number {
  if (!applyQtyGrowth) return 0;
  const safeBaseline = Number.isFinite(baselineQty) ? Math.max(0, baselineQty) : 0;
  if (safeBaseline <= 0) return 0;
  const safePct = Number.isFinite(growthPct) ? growthPct : 0;
  const multiplier = Math.max(0, 1 + safePct / 100);
  return Math.max(0, Math.round(safeBaseline * multiplier));
}

/**
 * Computes percentage growth of a target relative to a previous month's baseline sale.
 * Returns null if baseline is 0 or target is 0.
 */
export function computeGrowthPctOverBaseline(
  targetPaise: number,
  baselinePaise: number,
): number | null {
  if (!Number.isFinite(baselinePaise) || baselinePaise <= 0) return null;
  if (!Number.isFinite(targetPaise) || targetPaise <= 0) return null;
  return Math.round(((targetPaise - baselinePaise) / baselinePaise) * 1000) / 10;
}

/**
 * Computes target achievement percentage, remaining amount/qty, and executive status label.
 */
export function computeTargetProgress(params: {
  achievedSalePaise: number;
  targetSaleAmtPaise: number;
  achievedQty?: number;
  targetSaleQty?: number;
}): TargetProgressMetrics {
  const achievedSale = Math.max(0, params.achievedSalePaise || 0);
  const targetSale = Math.max(0, params.targetSaleAmtPaise || 0);
  const achievedQty = Math.max(0, params.achievedQty || 0);
  const targetQty = Math.max(0, params.targetSaleQty || 0);

  const salePct = targetSale > 0 ? Math.round((achievedSale / targetSale) * 100) : 0;
  const remainingSalePaise = Math.max(0, targetSale - achievedSale);

  const qtyPct = targetQty > 0 ? Math.round((achievedQty / targetQty) * 100) : 0;
  const remainingQty = Math.max(0, Math.round((targetQty - achievedQty) * 100) / 100);

  const effectivePct = targetSale > 0 ? salePct : qtyPct;
  const status: TargetProgressStatus =
    effectivePct >= 100
      ? 'ACHIEVED'
      : effectivePct >= 70
        ? 'ON_TRACK'
        : effectivePct > 0
          ? 'IN_PROGRESS'
          : 'NOT_STARTED';

  return {
    salePct,
    remainingSalePaise,
    qtyPct,
    remainingQty,
    status,
  };
}
