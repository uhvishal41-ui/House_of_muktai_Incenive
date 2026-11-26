import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Calculator,
  CheckCircle2,
  Edit3,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  formatINRFromPaise,
  formatMonthLabel,
  formatQty,
  getCurrentMonthKeyIST,
  getPreviousMonthKey,
} from '../../lib/format';
import {
  computeGrowthPctOverBaseline,
  computeGrowthTargetPaise,
  computeGrowthTargetQty,
  computeTargetProgress,
  type TargetProgressStatus,
} from '../../lib/targetCalculations';
import {
  deleteSalesTarget,
  upsertSalesTarget,
  upsertSalesTargetsBatch,
  type UpsertSalesTargetInput,
} from '../../services/operationsService';
import type {
  Branch,
  Employee,
  MonthlySummary,
  SalesTarget,
} from '../../types/incentive';

export type TargetManagerSection = 'all' | 'planner' | 'branch_progress' | 'employee_progress';

interface Props {
  branches: Branch[];
  employees: Employee[];
  activeMonthlySummaries: MonthlySummary[];
  salesTargets: SalesTarget[];
  selectedAnalyticsMonth: string;
  selectedAnalyticsBranch: string;
  activeSection?: TargetManagerSection;
  controlledTargetMonth?: string;
  onTargetMonthChange?: (monthKey: string) => void;
  onRequestSection?: (section: 'planner' | 'branch_progress' | 'employee_progress') => void;
  onRefresh: () => Promise<void>;
  onFeedback: (fb: { type: 'ok' | 'err'; text: string } | null) => void;
}

type PlannerMode = 'BULK_BRANCH' | 'SINGLE';
type ProgressFilter = 'ALL' | TargetProgressStatus;

interface DraftEmployeeTargetRow {
  selected: boolean;
  targetSaleRupees: string;
  targetSaleQty: string;
  customGrowthPct: string;
}

function getSummarySaleAmtPaise(s?: MonthlySummary): number {
  if (!s) return 0;
  return (
    s.totalSaleAmtPaise ??
    (s.saleAmt1TotalPaise || 0) + (s.saleAmt2TotalPaise || 0) + (s.saleAmt3TotalPaise || 0)
  );
}

function getSummarySaleQty(s?: MonthlySummary): number {
  if (!s) return 0;
  return (
    s.totalSaleQty ??
    Math.round(((s.saleQty1Total || 0) + (s.saleQty2Total || 0) + (s.saleQty3Total || 0)) * 100) /
      100
  );
}

const GROWTH_PRESETS = [5, 10, 15, 20, 25];

export function BranchTargetManager({
  branches,
  employees,
  activeMonthlySummaries,
  salesTargets,
  selectedAnalyticsMonth,
  selectedAnalyticsBranch,
  activeSection = 'all',
  controlledTargetMonth,
  onTargetMonthChange,
  onRequestSection,
  onRefresh,
  onFeedback,
}: Props) {
  const [internalTargetMonth, setInternalTargetMonth] = useState<string>(
    () => controlledTargetMonth || selectedAnalyticsMonth || getCurrentMonthKeyIST(),
  );
  const targetMonth = controlledTargetMonth || internalTargetMonth;
  const setTargetMonth = (nextMonth: string) => {
    setInternalTargetMonth(nextMonth);
    onTargetMonthChange?.(nextMonth);
  };
  const [baselineMonth, setBaselineMonth] = useState<string>(() =>
    getPreviousMonthKey(controlledTargetMonth || selectedAnalyticsMonth || getCurrentMonthKeyIST()),
  );
  const [plannerMode, setPlannerMode] = useState<PlannerMode>('BULK_BRANCH');

  useEffect(() => {
    if (controlledTargetMonth) {
      setBaselineMonth(getPreviousMonthKey(controlledTargetMonth));
    }
  }, [controlledTargetMonth]);

  // Bulk Branch-wise planner state
  const [bulkBranchId, setBulkBranchId] = useState<string>('');
  const [branchGrowthPct, setBranchGrowthPct] = useState<string>('10');
  const [fallbackRupees, setFallbackRupees] = useState<string>('');
  const [applyQtyGrowth, setApplyQtyGrowth] = useState<boolean>(false);
  const [alsoSaveBranchTarget, setAlsoSaveBranchTarget] = useState<boolean>(true);
  const [draftRows, setDraftRows] = useState<Record<string, DraftEmployeeTargetRow>>({});
  const [savingBulk, setSavingBulk] = useState(false);

  // Single Target form state
  const [singleScope, setSingleScope] = useState<'BRANCH' | 'EMPLOYEE'>('EMPLOYEE');
  const [singleBranchId, setSingleBranchId] = useState<string>('');
  const [singleEmployeeId, setSingleEmployeeId] = useState<string>('');
  const [singleSaleRupees, setSingleSaleRupees] = useState<string>('');
  const [singleSaleQty, setSingleSaleQty] = useState<string>('');
  const [savingSingle, setSavingSingle] = useState(false);

  // Progress tracker filter state
  const [progressBranchFilter, setProgressBranchFilter] = useState<string>('ALL');
  const [progressStatusFilter, setProgressStatusFilter] = useState<ProgressFilter>('ALL');
  const [progressSearch, setProgressSearch] = useState<string>('');

  // Sync targetMonth when analytics month changes initially if empty
  useEffect(() => {
    if (!targetMonth) {
      const m = selectedAnalyticsMonth || getCurrentMonthKeyIST();
      setTargetMonth(m);
      setBaselineMonth(getPreviousMonthKey(m));
    }
  }, [selectedAnalyticsMonth, targetMonth]);

  // Sync default branch selections
  useEffect(() => {
    if (branches.length === 0) return;
    if (!bulkBranchId) {
      setBulkBranchId(
        selectedAnalyticsBranch !== 'ALL' ? selectedAnalyticsBranch : branches[0].branchId,
      );
    }
    if (!singleBranchId) {
      setSingleBranchId(
        selectedAnalyticsBranch !== 'ALL' ? selectedAnalyticsBranch : branches[0].branchId,
      );
    }
  }, [branches, bulkBranchId, singleBranchId, selectedAnalyticsBranch]);

  // Sync progress branch filter with top analytics filter when user changes it
  useEffect(() => {
    setProgressBranchFilter(selectedAnalyticsBranch);
  }, [selectedAnalyticsBranch]);

  // Available baseline months (previous month of targetMonth + all published months)
  const baselineMonthOptions = useMemo(() => {
    const set = new Set<string>();
    if (targetMonth) set.add(getPreviousMonthKey(targetMonth));
    for (const s of activeMonthlySummaries) set.add(s.monthKey);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [activeMonthlySummaries, targetMonth]);

  // Summary lookups for Target Month (Achieved) and Baseline Month (Last Month)
  const targetMonthSummaryByEmp = useMemo(() => {
    const map = new Map<string, MonthlySummary>();
    for (const s of activeMonthlySummaries) {
      if (s.monthKey === targetMonth) {
        map.set(s.employeeId.toUpperCase(), s);
      }
    }
    return map;
  }, [activeMonthlySummaries, targetMonth]);

  const baselineSummaryByEmp = useMemo(() => {
    const map = new Map<string, MonthlySummary>();
    for (const s of activeMonthlySummaries) {
      if (s.monthKey === baselineMonth) {
        map.set(s.employeeId.toUpperCase(), s);
      }
    }
    return map;
  }, [activeMonthlySummaries, baselineMonth]);

  const targetMonthBranchAchieved = useMemo(() => {
    const map = new Map<string, { saleAmtPaise: number; saleQty: number }>();
    for (const s of activeMonthlySummaries) {
      if (s.monthKey !== targetMonth) continue;
      const cur = map.get(s.branchId) || { saleAmtPaise: 0, saleQty: 0 };
      cur.saleAmtPaise += getSummarySaleAmtPaise(s);
      cur.saleQty = Math.round((cur.saleQty + getSummarySaleQty(s)) * 100) / 100;
      map.set(s.branchId, cur);
    }
    return map;
  }, [activeMonthlySummaries, targetMonth]);

  const baselineBranchTotals = useMemo(() => {
    const map = new Map<string, { saleAmtPaise: number; saleQty: number }>();
    for (const s of activeMonthlySummaries) {
      if (s.monthKey !== baselineMonth) continue;
      const cur = map.get(s.branchId) || { saleAmtPaise: 0, saleQty: 0 };
      cur.saleAmtPaise += getSummarySaleAmtPaise(s);
      cur.saleQty = Math.round((cur.saleQty + getSummarySaleQty(s)) * 100) / 100;
      map.set(s.branchId, cur);
    }
    return map;
  }, [activeMonthlySummaries, baselineMonth]);

  // Existing saved targets for targetMonth
  const savedTargetsForMonth = useMemo(
    () => salesTargets.filter((t) => t.monthKey === targetMonth),
    [salesTargets, targetMonth],
  );

  const savedEmpTargetMap = useMemo(() => {
    const map = new Map<string, SalesTarget>();
    for (const t of savedTargetsForMonth) {
      if (t.scope === 'EMPLOYEE' && t.employeeId) {
        map.set(t.employeeId.toUpperCase(), t);
      }
    }
    return map;
  }, [savedTargetsForMonth]);

  const savedBranchTargetMap = useMemo(() => {
    const map = new Map<string, SalesTarget>();
    for (const t of savedTargetsForMonth) {
      if (t.scope === 'BRANCH') {
        map.set(t.branchId, t);
      }
    }
    return map;
  }, [savedTargetsForMonth]);

  // Active employees in bulk-selected branch
  const bulkBranchEmployees = useMemo(
    () =>
      employees
        .filter((e) => e.status === 'ACTIVE' && e.branchId === bulkBranchId)
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [employees, bulkBranchId],
  );

  // Active employees in single-selected branch
  const singleBranchEmployees = useMemo(
    () =>
      employees
        .filter((e) => e.status === 'ACTIVE' && (!singleBranchId || e.branchId === singleBranchId))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [employees, singleBranchId],
  );

  // Build / refresh draft rows for bulk branch planner
  const buildDraftRowsForBranch = (
    empList: Employee[],
    growthNum: number,
    fallbackNum: number,
    qtyGrowth: boolean,
    preferSaved: boolean,
  ): Record<string, DraftEmployeeTargetRow> => {
    const next: Record<string, DraftEmployeeTargetRow> = {};
    for (const emp of empList) {
      const key = emp.employeeId.toUpperCase();
      const baseSum = baselineSummaryByEmp.get(key);
      const baseSalePaise = getSummarySaleAmtPaise(baseSum);
      const baseQty = getSummarySaleQty(baseSum);
      const existing = savedEmpTargetMap.get(key);

      if (preferSaved && existing) {
        const impliedPct = computeGrowthPctOverBaseline(existing.targetSaleAmtPaise, baseSalePaise);
        next[emp.employeeId] = {
          selected: true,
          targetSaleRupees: String(Math.round(existing.targetSaleAmtPaise / 100)),
          targetSaleQty: existing.targetSaleQty > 0 ? String(existing.targetSaleQty) : '',
          customGrowthPct: impliedPct !== null ? String(impliedPct) : String(growthNum),
        };
      } else {
        const calcPaise = computeGrowthTargetPaise(baseSalePaise, growthNum, fallbackNum);
        const calcQty = computeGrowthTargetQty(baseQty, growthNum, qtyGrowth);
        next[emp.employeeId] = {
          selected: calcPaise > 0 || calcQty > 0,
          targetSaleRupees: calcPaise > 0 ? String(Math.round(calcPaise / 100)) : '',
          targetSaleQty: calcQty > 0 ? String(calcQty) : '',
          customGrowthPct: String(growthNum),
        };
      }
    }
    return next;
  };

  // Re-initialize draft rows whenever branch, targetMonth, or baselineMonth changes
  useEffect(() => {
    if (!bulkBranchId) return;
    const growthNum = Number(branchGrowthPct || '0');
    const fallbackNum = Number(fallbackRupees || '0');
    setDraftRows(
      buildDraftRowsForBranch(
        bulkBranchEmployees,
        Number.isFinite(growthNum) ? growthNum : 10,
        Number.isFinite(fallbackNum) ? fallbackNum : 0,
        applyQtyGrowth,
        true,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkBranchId, targetMonth, baselineMonth, bulkBranchEmployees.length, savedTargetsForMonth.length]);

  const handleRecalculateAll = (overrideGrowthPct?: number) => {
    const growthNum =
      overrideGrowthPct !== undefined ? overrideGrowthPct : Number(branchGrowthPct || '0');
    const safeGrowth = Number.isFinite(growthNum) ? growthNum : 0;
    if (overrideGrowthPct !== undefined) {
      setBranchGrowthPct(String(overrideGrowthPct));
    }
    const fallbackNum = Number(fallbackRupees || '0');
    const safeFallback = Number.isFinite(fallbackNum) ? fallbackNum : 0;
    setDraftRows(
      buildDraftRowsForBranch(
        bulkBranchEmployees,
        safeGrowth,
        safeFallback,
        applyQtyGrowth,
        false,
      ),
    );
  };

  const handleRowGrowthChange = (emp: Employee, pctStr: string) => {
    const pctNum = Number(pctStr);
    const baseSum = baselineSummaryByEmp.get(emp.employeeId.toUpperCase());
    const baseSalePaise = getSummarySaleAmtPaise(baseSum);
    const baseQty = getSummarySaleQty(baseSum);
    const fallbackNum = Number(fallbackRupees || '0');

    setDraftRows((prev) => {
      const cur = prev[emp.employeeId] || {
        selected: true,
        targetSaleRupees: '',
        targetSaleQty: '',
        customGrowthPct: pctStr,
      };
      if (!Number.isFinite(pctNum)) {
        return { ...prev, [emp.employeeId]: { ...cur, customGrowthPct: pctStr } };
      }
      const nextPaise = computeGrowthTargetPaise(
        baseSalePaise,
        pctNum,
        Number.isFinite(fallbackNum) ? fallbackNum : 0,
      );
      const nextQty = computeGrowthTargetQty(baseQty, pctNum, applyQtyGrowth);
      return {
        ...prev,
        [emp.employeeId]: {
          ...cur,
          selected: nextPaise > 0 || nextQty > 0 ? true : cur.selected,
          customGrowthPct: pctStr,
          targetSaleRupees: nextPaise > 0 ? String(Math.round(nextPaise / 100)) : '',
          targetSaleQty: applyQtyGrowth ? (nextQty > 0 ? String(nextQty) : '') : cur.targetSaleQty,
        },
      };
    });
  };

  // Summary totals for the bulk preview table
  const bulkPreviewSummary = useMemo(() => {
    let selectedCount = 0;
    let totalBaselinePaise = 0;
    let totalTargetPaise = 0;
    let totalTargetQty = 0;
    let totalAchievedPaise = 0;

    for (const emp of bulkBranchEmployees) {
      const draft = draftRows[emp.employeeId];
      const baseSum = baselineSummaryByEmp.get(emp.employeeId.toUpperCase());
      const achievedSum = targetMonthSummaryByEmp.get(emp.employeeId.toUpperCase());
      totalBaselinePaise += getSummarySaleAmtPaise(baseSum);
      totalAchievedPaise += getSummarySaleAmtPaise(achievedSum);
      if (draft?.selected) {
        const amtRupees = Number(draft.targetSaleRupees || '0');
        const qtyNum = Number(draft.targetSaleQty || '0');
        if ((Number.isFinite(amtRupees) && amtRupees > 0) || (Number.isFinite(qtyNum) && qtyNum > 0)) {
          selectedCount += 1;
          totalTargetPaise += Number.isFinite(amtRupees) && amtRupees > 0 ? Math.round(amtRupees * 100) : 0;
          totalTargetQty =
            Math.round((totalTargetQty + (Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 0)) * 100) /
            100;
        }
      }
    }
    return {
      selectedCount,
      totalBaselinePaise,
      totalTargetPaise,
      totalTargetQty,
      totalAchievedPaise,
    };
  }, [bulkBranchEmployees, draftRows, baselineSummaryByEmp, targetMonthSummaryByEmp]);

  const handleSaveBulkBranchTargets = async () => {
    onFeedback(null);
    const branch = branches.find((b) => b.branchId === bulkBranchId);
    if (!branch) {
      onFeedback({ type: 'err', text: 'Please select a branch first.' });
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
      onFeedback({ type: 'err', text: 'Please select a valid target month.' });
      return;
    }

    const items: UpsertSalesTargetInput[] = [];
    for (const emp of bulkBranchEmployees) {
      const draft = draftRows[emp.employeeId];
      if (!draft?.selected) continue;
      const saleRupees = Number(draft.targetSaleRupees || '0');
      const qtyNum = Number(draft.targetSaleQty || '0');
      if (!Number.isFinite(saleRupees) || saleRupees < 0 || !Number.isFinite(qtyNum) || qtyNum < 0) {
        onFeedback({
          type: 'err',
          text: `Invalid target value for ${emp.fullName} (${emp.employeeId}).`,
        });
        return;
      }
      if (saleRupees === 0 && qtyNum === 0) continue;
      items.push({
        monthKey: targetMonth,
        scope: 'EMPLOYEE',
        branchId: emp.branchId,
        branchName: emp.branchName,
        employeeId: emp.employeeId,
        authUid: emp.authUid,
        employeeName: emp.fullName,
        targetSaleAmtPaise: Math.round(saleRupees * 100),
        targetSaleQty: qtyNum,
      });
    }

    if (items.length === 0) {
      onFeedback({
        type: 'err',
        text: 'Select at least one employee with a positive Sale Amount or Sale Qty target.',
      });
      return;
    }

    if (alsoSaveBranchTarget) {
      const combinedSalePaise = items.reduce((acc, it) => acc + it.targetSaleAmtPaise, 0);
      const combinedQty =
        Math.round(items.reduce((acc, it) => acc + it.targetSaleQty, 0) * 100) / 100;
      items.push({
        monthKey: targetMonth,
        scope: 'BRANCH',
        branchId: branch.branchId,
        branchName: branch.branchName,
        targetSaleAmtPaise: combinedSalePaise,
        targetSaleQty: combinedQty,
      });
    }

    setSavingBulk(true);
    try {
      await upsertSalesTargetsBatch({
        monthKey: targetMonth,
        branchName: branch.branchName,
        items,
        auditSummary: `Set ${targetMonth} targets for ${branch.branchName} (${items.filter((i) => i.scope === 'EMPLOYEE').length} employees${alsoSaveBranchTarget ? ' + branch total' : ''}, baseline ${baselineMonth}, +${branchGrowthPct || '0'}%)`,
      });
      const empCount = items.filter((i) => i.scope === 'EMPLOYEE').length;
      onFeedback({
        type: 'ok',
        text: `Saved ${formatMonthLabel(targetMonth)} targets for ${empCount} employee(s)${alsoSaveBranchTarget ? ' + Branch Target' : ''} in ${branch.branchName}. Staff can view live progress immediately on their mobile app!`,
      });
      await onRefresh();
    } catch (err) {
      onFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save branch targets.',
      });
    } finally {
      setSavingBulk(false);
    }
  };

  // Baseline helper for Single Target mode
  const singleBaseline = useMemo(() => {
    if (singleScope === 'BRANCH') {
      const b = baselineBranchTotals.get(singleBranchId);
      return {
        saleAmtPaise: b?.saleAmtPaise || 0,
        saleQty: b?.saleQty || 0,
      };
    }
    if (!singleEmployeeId) return { saleAmtPaise: 0, saleQty: 0 };
    const s = baselineSummaryByEmp.get(singleEmployeeId.toUpperCase());
    return {
      saleAmtPaise: getSummarySaleAmtPaise(s),
      saleQty: getSummarySaleQty(s),
    };
  }, [singleScope, singleBranchId, singleEmployeeId, baselineBranchTotals, baselineSummaryByEmp]);

  const applySingleGrowthPreset = (pct: number) => {
    const targetPaise = computeGrowthTargetPaise(singleBaseline.saleAmtPaise, pct);
    if (targetPaise > 0) {
      setSingleSaleRupees(String(Math.round(targetPaise / 100)));
    }
    if (singleBaseline.saleQty > 0) {
      const targetQty = computeGrowthTargetQty(singleBaseline.saleQty, pct, true);
      if (targetQty > 0) setSingleSaleQty(String(targetQty));
    }
  };

  const handleSaveSingleTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    onFeedback(null);
    const saleRupees = Number(singleSaleRupees || '0');
    const qtyNum = Number(singleSaleQty || '0');
    if (!Number.isFinite(saleRupees) || saleRupees < 0 || !Number.isFinite(qtyNum) || qtyNum < 0) {
      onFeedback({ type: 'err', text: 'Please enter valid non-negative target numbers.' });
      return;
    }
    if (saleRupees === 0 && qtyNum === 0) {
      onFeedback({ type: 'err', text: 'Enter at least a Sale Amount or Sale Qty target.' });
      return;
    }
    const branch = branches.find((b) => b.branchId === singleBranchId);
    if (!branch) {
      onFeedback({ type: 'err', text: 'Please select a branch.' });
      return;
    }
    let emp: Employee | undefined;
    if (singleScope === 'EMPLOYEE') {
      emp = employees.find((x) => x.employeeId === singleEmployeeId);
      if (!emp) {
        onFeedback({ type: 'err', text: 'Please select an employee for personal target.' });
        return;
      }
    }

    setSavingSingle(true);
    try {
      await upsertSalesTarget({
        monthKey: targetMonth,
        scope: singleScope,
        branchId: emp ? emp.branchId : branch.branchId,
        branchName: emp ? emp.branchName : branch.branchName,
        employeeId: emp?.employeeId,
        authUid: emp?.authUid,
        employeeName: emp?.fullName,
        targetSaleAmtPaise: Math.round(saleRupees * 100),
        targetSaleQty: qtyNum,
      });
      setSingleSaleRupees('');
      setSingleSaleQty('');
      onFeedback({
        type: 'ok',
        text: `Saved ${singleScope === 'BRANCH' ? branch.branchName : `${emp?.fullName} (${emp?.employeeId})`} target for ${formatMonthLabel(targetMonth)}.`,
      });
      await onRefresh();
    } catch (err) {
      onFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save target.',
      });
    } finally {
      setSavingSingle(false);
    }
  };

  const handleDeleteTarget = async (targetId: string) => {
    onFeedback(null);
    try {
      await deleteSalesTarget(targetId);
      onFeedback({ type: 'ok', text: 'Removed monthly sales target.' });
      await onRefresh();
    } catch (err) {
      onFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to delete target.',
      });
    }
  };

  // Branch-wise Target Progress Summary (across all branches that have targets in targetMonth)
  const branchProgressCards = useMemo(() => {
    const empTargetsByBranch = new Map<string, SalesTarget[]>();
    for (const t of savedTargetsForMonth) {
      if (t.scope === 'EMPLOYEE') {
        const list = empTargetsByBranch.get(t.branchId) || [];
        list.push(t);
        empTargetsByBranch.set(t.branchId, list);
      }
    }

    const branchIdsWithTargets = new Set<string>([
      ...savedBranchTargetMap.keys(),
      ...empTargetsByBranch.keys(),
    ]);

    return Array.from(branchIdsWithTargets)
      .map((branchId) => {
        const branchObj = branches.find((b) => b.branchId === branchId);
        const branchTarget = savedBranchTargetMap.get(branchId) || null;
        const empTargets = empTargetsByBranch.get(branchId) || [];
        const sumEmpTargetPaise = empTargets.reduce((acc, t) => acc + t.targetSaleAmtPaise, 0);
        const effectiveTargetPaise = branchTarget
          ? branchTarget.targetSaleAmtPaise
          : sumEmpTargetPaise;
        const achieved = targetMonthBranchAchieved.get(branchId) || {
          saleAmtPaise: 0,
          saleQty: 0,
        };
        const baseline = baselineBranchTotals.get(branchId) || { saleAmtPaise: 0, saleQty: 0 };
        const progress = computeTargetProgress({
          achievedSalePaise: achieved.saleAmtPaise,
          targetSaleAmtPaise: effectiveTargetPaise,
          achievedQty: achieved.saleQty,
          targetSaleQty: branchTarget?.targetSaleQty || 0,
        });
        const growthPct = computeGrowthPctOverBaseline(
          effectiveTargetPaise,
          baseline.saleAmtPaise,
        );

        return {
          branchId,
          branchName:
            branchObj?.branchName ||
            branchTarget?.branchName ||
            empTargets[0]?.branchName ||
            branchId,
          branchTarget,
          staffTargetsCount: empTargets.length,
          effectiveTargetPaise,
          achievedSalePaise: achieved.saleAmtPaise,
          baselineSalePaise: baseline.saleAmtPaise,
          growthPct,
          progress,
        };
      })
      .sort((a, b) => b.progress.salePct - a.progress.salePct || a.branchName.localeCompare(b.branchName));
  }, [
    savedTargetsForMonth,
    savedBranchTargetMap,
    branches,
    targetMonthBranchAchieved,
    baselineBranchTotals,
  ]);

  // Employee-wise Target Progress Rows (for Admin tracking)
  const employeeProgressRows = useMemo(() => {
    const empMap = new Map(employees.map((e) => [e.employeeId.toUpperCase(), e]));
    const needle = progressSearch.trim().toLowerCase();

    return savedTargetsForMonth
      .filter((t) => t.scope === 'EMPLOYEE' && t.employeeId)
      .filter((t) => progressBranchFilter === 'ALL' || t.branchId === progressBranchFilter)
      .map((t) => {
        const empKey = (t.employeeId || '').toUpperCase();
        const empObj = empMap.get(empKey);
        const currSum = targetMonthSummaryByEmp.get(empKey);
        const baseSum = baselineSummaryByEmp.get(empKey);

        const achievedSalePaise = getSummarySaleAmtPaise(currSum);
        const achievedQty = getSummarySaleQty(currSum);
        const baselineSalePaise = getSummarySaleAmtPaise(baseSum);
        const progress = computeTargetProgress({
          achievedSalePaise,
          targetSaleAmtPaise: t.targetSaleAmtPaise,
          achievedQty,
          targetSaleQty: t.targetSaleQty,
        });
        const growthPct = computeGrowthPctOverBaseline(t.targetSaleAmtPaise, baselineSalePaise);

        return {
          target: t,
          hasMobileLogin: Boolean(empObj?.authUid && t.authUid),
          achievedSalePaise,
          achievedQty,
          baselineSalePaise,
          growthPct,
          progress,
        };
      })
      .filter((row) => {
        if (progressStatusFilter !== 'ALL' && row.progress.status !== progressStatusFilter) {
          return false;
        }
        if (!needle) return true;
        return (
          (row.target.employeeName || '').toLowerCase().includes(needle) ||
          (row.target.employeeId || '').toLowerCase().includes(needle) ||
          row.target.branchName.toLowerCase().includes(needle)
        );
      })
      .sort(
        (a, b) =>
          b.progress.salePct - a.progress.salePct ||
          b.achievedSalePaise - a.achievedSalePaise,
      );
  }, [
    savedTargetsForMonth,
    employees,
    progressBranchFilter,
    progressStatusFilter,
    progressSearch,
    targetMonthSummaryByEmp,
    baselineSummaryByEmp,
  ]);

  const handleQuickEditTarget = (t: SalesTarget) => {
    setPlannerMode('SINGLE');
    setSingleScope(t.scope);
    setSingleBranchId(t.branchId);
    setSingleEmployeeId(t.employeeId || '');
    setSingleSaleRupees(t.targetSaleAmtPaise > 0 ? String(Math.round(t.targetSaleAmtPaise / 100)) : '');
    setSingleSaleQty(t.targetSaleQty > 0 ? String(t.targetSaleQty) : '');
    if (onRequestSection && activeSection !== 'planner') {
      onRequestSection('planner');
    } else {
      document.getElementById('branch-target-planner-top')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const allBulkSelected =
    bulkBranchEmployees.length > 0 &&
    bulkBranchEmployees.every((e) => draftRows[e.employeeId]?.selected);

  const showPlanner = activeSection === 'all' || activeSection === 'planner';
  const showBranchProgress = activeSection === 'all' || activeSection === 'branch_progress';
  const showEmployeeProgress = activeSection === 'all' || activeSection === 'employee_progress';

  const headerTitle =
    activeSection === 'branch_progress'
      ? `Branch-Wise Target Progress (${formatMonthLabel(targetMonth)})`
      : activeSection === 'employee_progress'
        ? `Employee-Wise Target Progress (${formatMonthLabel(targetMonth)})`
        : `Branch-Wise & Employee Growth Targets (${formatMonthLabel(targetMonth)})`;

  const headerSubtitle =
    activeSection === 'branch_progress'
      ? 'Track branch-level target achievement vs last month baseline. Click any branch card to inspect its staff progress.'
      : activeSection === 'employee_progress'
        ? 'Real-time progress synced identically to each employee’s mobile app (staff.houseofmuktai.co.in).'
        : 'Set monthly targets branch-wise using last month’s sale + growth % (e.g. +10%). Progress syncs live to Admin & Staff Mobile App.';

  return (
    <section
      id="branch-target-planner-top"
      className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs"
    >
      {/* Header + Target Month & Baseline Month Pickers */}
      <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/70 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#0F1F3D] text-[#DFC27D] flex items-center justify-center shrink-0">
            {activeSection === 'branch_progress' ? (
              <Building2 className="w-4 h-4" />
            ) : activeSection === 'employee_progress' ? (
              <Users className="w-4 h-4" />
            ) : (
              <Target className="w-4 h-4" />
            )}
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-[#0F1F3D]">{headerTitle}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{headerSubtitle}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">
              Target Month
            </label>
            <input
              type="month"
              value={targetMonth}
              onChange={(e) => {
                const nextMonth = e.target.value;
                if (!nextMonth) return;
                setTargetMonth(nextMonth);
                setBaselineMonth(getPreviousMonthKey(nextMonth));
              }}
              className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono font-semibold text-[#0F1F3D]"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">
              Baseline (Last Month)
            </label>
            <select
              value={baselineMonth}
              onChange={(e) => setBaselineMonth(e.target.value)}
              className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800"
            >
              {baselineMonthOptions.map((mk) => (
                <option key={mk} value={mk}>
                  {formatMonthLabel(mk)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-6">
        {showPlanner && (
          <>
            {/* Planner Mode Switcher */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200/80 text-xs">
                <button
                  type="button"
                  onClick={() => setPlannerMode('BULK_BRANCH')}
                  className={`px-3 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                    plannerMode === 'BULK_BRANCH'
                      ? 'bg-[#0F1F3D] text-white shadow-xs'
                      : 'text-slate-600 hover:text-[#0F1F3D]'
                  }`}
                >
                  <Calculator className="w-3.5 h-3.5" />
                  Branch-Wise Auto Target (Last Month + %)
                </button>
                <button
                  type="button"
                  onClick={() => setPlannerMode('SINGLE')}
                  className={`px-3 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                    plannerMode === 'SINGLE'
                      ? 'bg-[#0F1F3D] text-white shadow-xs'
                      : 'text-slate-600 hover:text-[#0F1F3D]'
                  }`}
                >
                  <Target className="w-3.5 h-3.5" />
                  Single Branch / Employee Target
                </button>
              </div>

              <span className="text-xs text-slate-500 font-mono">
                {savedTargetsForMonth.filter((t) => t.scope === 'EMPLOYEE').length} staff targets ·{' '}
                {savedTargetsForMonth.filter((t) => t.scope === 'BRANCH').length} branch targets in{' '}
                {formatMonthLabel(targetMonth)}
              </span>
            </div>

            {/* =============================================================== */}
            {/* MODE 1: BRANCH-WISE BULK AUTO-TARGET GENERATOR (LAST MONTH + %) */}
            {/* =============================================================== */}
            {plannerMode === 'BULK_BRANCH' && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 overflow-hidden">
            {/* Controls Strip */}
            <div className="p-4 border-b border-slate-200 bg-white space-y-3.5">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="md:col-span-4">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Select Branch
                  </label>
                  <select
                    value={bulkBranchId}
                    onChange={(e) => setBulkBranchId(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-900"
                  >
                    {branches.map((b) => (
                      <option key={b.branchId} value={b.branchId}>
                        {b.branchName} ({employees.filter((e) => e.status === 'ACTIVE' && e.branchId === b.branchId).length} active staff)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-4">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Growth Over {formatMonthLabel(baselineMonth)} (%)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <div className="relative w-24 shrink-0">
                      <input
                        type="number"
                        step="0.5"
                        value={branchGrowthPct}
                        onChange={(e) => setBranchGrowthPct(e.target.value)}
                        className="w-full h-9 pl-2.5 pr-6 rounded-lg border border-slate-300 bg-white text-xs font-mono font-semibold text-[#0F1F3D]"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-mono">
                        %
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {GROWTH_PRESETS.map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => handleRecalculateAll(pct)}
                          className={`h-8 px-2 rounded-md text-[11px] font-mono font-semibold cursor-pointer transition-colors ${
                            Number(branchGrowthPct) === pct
                              ? 'bg-[#B8923A] text-[#0F1F3D]'
                              : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                          }`}
                        >
                          +{pct}%
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    New Staff Min (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={fallbackRupees}
                    onChange={(e) => setFallbackRupees(e.target.value)}
                    placeholder="Optional e.g. 50000"
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono"
                  />
                </div>

                <div className="md:col-span-2">
                  <button
                    type="button"
                    onClick={() => handleRecalculateAll()}
                    className="w-full h-9 px-3 rounded-lg border border-[#0F1F3D]/25 bg-[#0F1F3D]/[0.05] hover:bg-[#0F1F3D]/[0.1] text-[#0F1F3D] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Apply +{branchGrowthPct || 0}%
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-slate-600">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alsoSaveBranchTarget}
                    onChange={(e) => setAlsoSaveBranchTarget(e.target.checked)}
                    className="rounded border-slate-300 text-[#0F1F3D] focus:ring-[#0F1F3D]"
                  />
                  <span>Also save combined total as Branch Target</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyQtyGrowth}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setApplyQtyGrowth(next);
                      const growthNum = Number(branchGrowthPct || '0');
                      const fallbackNum = Number(fallbackRupees || '0');
                      setDraftRows(
                        buildDraftRowsForBranch(
                          bulkBranchEmployees,
                          Number.isFinite(growthNum) ? growthNum : 10,
                          Number.isFinite(fallbackNum) ? fallbackNum : 0,
                          next,
                          false,
                        ),
                      );
                    }}
                    className="rounded border-slate-300 text-[#0F1F3D] focus:ring-[#0F1F3D]"
                  />
                  <span>Also auto-grow Sale Qty by +{branchGrowthPct || 0}%</span>
                </label>
              </div>
            </div>

            {/* Editable Branch Employees Table */}
            {bulkBranchEmployees.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No active employees found in this branch.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto max-h-[380px]">
                  <table className="w-full text-left border-collapse text-xs bg-white">
                    <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                      <tr>
                        <th className="py-2.5 px-3 w-9">
                          <input
                            type="checkbox"
                            checked={allBulkSelected}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setDraftRows((prev) => {
                                const next = { ...prev };
                                for (const emp of bulkBranchEmployees) {
                                  if (next[emp.employeeId]) {
                                    next[emp.employeeId] = {
                                      ...next[emp.employeeId],
                                      selected: checked,
                                    };
                                  }
                                }
                                return next;
                              });
                            }}
                            aria-label="Select all branch employees"
                            className="rounded border-slate-300 text-[#0F1F3D]"
                          />
                        </th>
                        <th className="py-2.5 px-3 min-w-[175px]">Employee Name &amp; ID</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">
                          {formatMonthLabel(baselineMonth)} Sale
                        </th>
                        <th className="py-2.5 px-3 text-right w-24">Growth %</th>
                        <th className="py-2.5 px-3 text-right min-w-[135px]">
                          {formatMonthLabel(targetMonth)} Target (₹)
                        </th>
                        <th className="py-2.5 px-3 text-right w-24">Target Quantity</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">
                          Live Achieved ({formatMonthLabel(targetMonth)})
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {bulkBranchEmployees.map((emp) => {
                        const key = emp.employeeId.toUpperCase();
                        const draft = draftRows[emp.employeeId] || {
                          selected: false,
                          targetSaleRupees: '',
                          targetSaleQty: '',
                          customGrowthPct: branchGrowthPct,
                        };
                        const baseSum = baselineSummaryByEmp.get(key);
                        const baseSalePaise = getSummarySaleAmtPaise(baseSum);
                        const baseQty = getSummarySaleQty(baseSum);
                        const currSum = targetMonthSummaryByEmp.get(key);
                        const achievedPaise = getSummarySaleAmtPaise(currSum);
                        const targetPaiseDraft = Math.round(
                          Math.max(0, Number(draft.targetSaleRupees || '0')) * 100,
                        );
                        const liveProg = computeTargetProgress({
                          achievedSalePaise: achievedPaise,
                          targetSaleAmtPaise: targetPaiseDraft,
                        });
                        const alreadySaved = savedEmpTargetMap.has(key);

                        return (
                          <tr
                            key={emp.employeeId}
                            className={draft.selected ? 'hover:bg-slate-50/70' : 'opacity-55 bg-slate-50/30'}
                          >
                            <td className="py-2.5 px-3">
                              <input
                                type="checkbox"
                                checked={draft.selected}
                                onChange={(e) =>
                                  setDraftRows((prev) => ({
                                    ...prev,
                                    [emp.employeeId]: {
                                      ...draft,
                                      selected: e.target.checked,
                                    },
                                  }))
                                }
                                aria-label={`Select ${emp.fullName}`}
                                className="rounded border-slate-300 text-[#0F1F3D]"
                              />
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-slate-900">{emp.fullName}</span>
                                {alreadySaved && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                                    Saved
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                                <span className="font-mono">#{emp.employeeId}</span>
                                {emp.authUid ? (
                                  <span className="inline-flex items-center gap-0.5 text-emerald-700 font-medium">
                                    <UserCheck className="w-3 h-3" />
                                    App Active
                                  </span>
                                ) : (
                                  <span className="text-amber-700 font-medium">
                                    Login Pending
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                              <div className="font-medium text-slate-800">
                                {formatINRFromPaise(baseSalePaise)}
                              </div>
                              {baseQty > 0 && (
                                <div className="text-[10px] text-slate-500">
                                  Qty {formatQty(baseQty)}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <input
                                type="number"
                                step="0.5"
                                value={draft.customGrowthPct}
                                onChange={(e) => handleRowGrowthChange(emp, e.target.value)}
                                aria-label={`Growth percent for ${emp.fullName}`}
                                className="w-20 h-8 px-2 rounded-lg border border-slate-200 bg-slate-50 text-right font-mono text-xs text-slate-800 focus:bg-white focus:border-[#0F1F3D] focus:outline-none"
                              />
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <input
                                type="number"
                                min="0"
                                step="500"
                                value={draft.targetSaleRupees}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const rupeesNum = Number(val || '0');
                                  const implied =
                                    baseSalePaise > 0 && Number.isFinite(rupeesNum) && rupeesNum > 0
                                      ? computeGrowthPctOverBaseline(
                                          Math.round(rupeesNum * 100),
                                          baseSalePaise,
                                        )
                                      : null;
                                  setDraftRows((prev) => ({
                                    ...prev,
                                    [emp.employeeId]: {
                                      ...draft,
                                      selected: rupeesNum > 0 ? true : draft.selected,
                                      targetSaleRupees: val,
                                      customGrowthPct:
                                        implied !== null ? String(implied) : draft.customGrowthPct,
                                    },
                                  }));
                                }}
                                placeholder="e.g. 110000"
                                aria-label={`Target Sale Rupees for ${emp.fullName}`}
                                className="w-32 h-8 px-2.5 rounded-lg border border-[#B8923A]/55 bg-[#B8923A]/[0.05] text-right font-mono font-semibold text-xs text-[#0F1F3D] focus:bg-white focus:border-[#0F1F3D] focus:outline-none"
                              />
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={draft.targetSaleQty}
                                onChange={(e) =>
                                  setDraftRows((prev) => ({
                                    ...prev,
                                    [emp.employeeId]: {
                                      ...draft,
                                      targetSaleQty: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="0"
                                aria-label={`Target Sale Qty for ${emp.fullName}`}
                                className="w-20 h-8 px-2 rounded-lg border border-slate-200 bg-white text-right font-mono text-xs text-slate-800 focus:border-[#0F1F3D] focus:outline-none"
                              />
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                              <div className="font-medium text-slate-900">
                                {formatINRFromPaise(achievedPaise)}
                              </div>
                              {targetPaiseDraft > 0 && (
                                <div
                                  className={`text-[10px] font-semibold ${
                                    liveProg.salePct >= 100
                                      ? 'text-emerald-700'
                                      : liveProg.salePct >= 70
                                        ? 'text-[#0F1F3D]'
                                        : 'text-amber-700'
                                  }`}
                                >
                                  {liveProg.salePct}% achieved
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Bulk Footer Summary & Save Button */}
                <div className="p-4 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
                    <div>
                      <span className="text-slate-500">Selected:</span>{' '}
                      <strong className="text-[#0F1F3D]">{bulkPreviewSummary.selectedCount} staff</strong>
                    </div>
                    <div>
                      <span className="text-slate-500">{formatMonthLabel(baselineMonth)}:</span>{' '}
                      <strong className="text-slate-800">
                        {formatINRFromPaise(bulkPreviewSummary.totalBaselinePaise)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Total Target:</span>{' '}
                      <strong className="text-[#0F1F3D]">
                        {formatINRFromPaise(bulkPreviewSummary.totalTargetPaise)}
                      </strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={savingBulk || bulkPreviewSummary.selectedCount === 0}
                    onClick={handleSaveBulkBranchTargets}
                    className="h-9 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#DFC27D]" />
                    {savingBulk
                      ? 'Saving Targets...'
                      : `Save Branch Targets (${bulkPreviewSummary.selectedCount} Staff${alsoSaveBranchTarget ? ' + Branch' : ''})`}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* =============================================================== */}
        {/* MODE 2: SINGLE BRANCH OR SINGLE EMPLOYEE TARGET + % HELPER      */}
        {/* =============================================================== */}
        {plannerMode === 'SINGLE' && (
          <form
            onSubmit={handleSaveSingleTarget}
            className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Scope</label>
                <select
                  value={singleScope}
                  onChange={(e) => setSingleScope(e.target.value as 'BRANCH' | 'EMPLOYEE')}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
                >
                  <option value="EMPLOYEE">Employee Target</option>
                  <option value="BRANCH">Branch Target</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Branch</label>
                <select
                  value={singleBranchId}
                  onChange={(e) => {
                    setSingleBranchId(e.target.value);
                    setSingleEmployeeId('');
                  }}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
                >
                  {branches.map((b) => (
                    <option key={b.branchId} value={b.branchId}>
                      {b.branchName}
                    </option>
                  ))}
                </select>
              </div>

              {singleScope === 'EMPLOYEE' && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Employee
                  </label>
                  <select
                    value={singleEmployeeId}
                    onChange={(e) => setSingleEmployeeId(e.target.value)}
                    required
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
                  >
                    <option value="">Select Employee...</option>
                    {singleBranchEmployees.map((emp) => (
                      <option key={emp.employeeId} value={emp.employeeId}>
                        {emp.fullName} ({emp.employeeId})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Target Sale Amt (₹)
                </label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={singleSaleRupees}
                  onChange={(e) => setSingleSaleRupees(e.target.value)}
                  placeholder="e.g. 110000"
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Target Sale Qty
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={singleSaleQty}
                  onChange={(e) => setSingleSaleQty(e.target.value)}
                  placeholder="Optional"
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={savingSingle}
                  className="w-full h-9 px-3 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {savingSingle ? 'Saving...' : 'Save Target'}
                </button>
              </div>
            </div>

            {/* Live Last Month Auto-Calculator Strip */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200/80 text-xs">
              <div className="flex items-center gap-2 text-slate-700">
                <TrendingUp className="w-4 h-4 text-[#B8923A] shrink-0" />
                <span>
                  {formatMonthLabel(baselineMonth)} Baseline Sale:{' '}
                  <strong className="font-mono text-[#0F1F3D]">
                    {formatINRFromPaise(singleBaseline.saleAmtPaise)}
                  </strong>
                  {singleBaseline.saleQty > 0 && (
                    <span className="text-slate-500 font-mono">
                      {' '}
                      · Qty {formatQty(singleBaseline.saleQty)}
                    </span>
                  )}
                </span>
              </div>

              {singleBaseline.saleAmtPaise > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-500">Quick Auto-Fill:</span>
                  {GROWTH_PRESETS.map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => applySingleGrowthPreset(pct)}
                      className="h-7 px-2.5 rounded-md border border-[#B8923A]/40 bg-white hover:bg-[#B8923A]/10 text-[#0F1F3D] text-[11px] font-mono font-semibold cursor-pointer transition-colors"
                    >
                      +{pct}% (
                      {formatINRFromPaise(
                        computeGrowthTargetPaise(singleBaseline.saleAmtPaise, pct),
                      )}
                      )
                    </button>
                  ))}
                </div>
              )}
            </div>
          </form>
        )}
          </>
        )}

        {/* =============================================================== */}
        {/* LIVE BRANCH-WISE TARGET PROGRESS SUMMARY CARDS                  */}
        {/* =============================================================== */}
        {showBranchProgress && (
          branchProgressCards.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center space-y-3">
              <p className="text-sm font-medium text-slate-700">
                No branch targets configured for {formatMonthLabel(targetMonth)} yet.
              </p>
              <p className="text-xs text-slate-500">
                Use the Growth Targets planner to generate branch-wise targets using last month&apos;s
                sale + growth %.
              </p>
              {onRequestSection && (
                <button
                  type="button"
                  onClick={() => onRequestSection('planner')}
                  className="h-9 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Calculator className="w-3.5 h-3.5 text-[#DFC27D]" />
                  Open Growth Targets Planner
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-[#0F1F3D]" />
                  <h3 className="text-xs sm:text-sm font-semibold text-[#0F1F3D]">
                    Branch-Wise Target Progress ({formatMonthLabel(targetMonth)})
                  </h3>
                </div>
                {progressBranchFilter !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => setProgressBranchFilter('ALL')}
                    className="text-xs font-semibold text-[#1E3A5F] hover:underline cursor-pointer"
                  >
                    Show All Branches
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
                {branchProgressCards.map((card) => {
                  const isSelected = progressBranchFilter === card.branchId;
                  return (
                    <div
                      key={card.branchId}
                      onClick={() => {
                        setProgressBranchFilter(card.branchId);
                        if (onRequestSection && activeSection === 'branch_progress') {
                          onRequestSection('employee_progress');
                        }
                      }}
                      className={`rounded-xl border p-4 space-y-2.5 cursor-pointer transition-all ${
                        isSelected
                          ? 'border-[#0F1F3D] bg-[#0F1F3D]/[0.03] shadow-xs'
                          : 'border-slate-200 bg-white hover:border-[#0F1F3D]/40 hover:shadow-xs'
                      }`}
                    >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#0F1F3D] truncate">
                          {card.branchName}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {card.staffTargetsCount} staff target{card.staffTargetsCount === 1 ? '' : 's'}
                          {card.growthPct !== null
                            ? ` · ${card.growthPct >= 0 ? '+' : ''}${card.growthPct}% vs ${formatMonthLabel(baselineMonth)}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`text-xs font-mono font-bold ${
                            card.progress.salePct >= 100
                              ? 'text-emerald-700'
                              : card.progress.salePct >= 70
                                ? 'text-[#0F1F3D]'
                                : 'text-amber-700'
                          }`}
                        >
                          {card.progress.salePct}%
                        </span>
                        {card.branchTarget && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteTarget(card.branchTarget!.targetId);
                            }}
                            className="p-1 text-slate-400 hover:text-red-700 cursor-pointer"
                            aria-label={`Delete ${card.branchName} branch target`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          card.progress.salePct >= 100
                            ? 'bg-emerald-600'
                            : 'bg-gradient-to-r from-[#0F1F3D] to-[#B8923A]'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(card.progress.salePct > 0 ? 3 : 0, card.progress.salePct))}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-600">
                      <span>
                        {formatINRFromPaise(card.achievedSalePaise)} /{' '}
                        <strong className="text-[#0F1F3D]">
                          {formatINRFromPaise(card.effectiveTargetPaise)}
                        </strong>
                      </span>
                      <span className="text-slate-500">
                        {card.progress.remainingSalePaise === 0
                          ? 'Done'
                          : `Rem ${formatINRFromPaise(card.progress.remainingSalePaise)}`}
                      </span>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          )
        )}

        {/* =============================================================== */}
        {/* LIVE EMPLOYEE-WISE TARGET PROGRESS TABLE (ADMIN VIEW)           */}
        {/* =============================================================== */}
        {showEmployeeProgress && (
          <div className="space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#0F1F3D]" />
              <div>
                <h3 className="text-xs sm:text-sm font-semibold text-[#0F1F3D]">
                  Employee-Wise Target Progress ({employeeProgressRows.length})
                </h3>
                <p className="text-[11px] text-slate-500">
                  Same live progress shown to each employee on their mobile app (staff.houseofmuktai.co.in)
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={progressSearch}
                  onChange={(e) => setProgressSearch(e.target.value)}
                  placeholder="Search employee or ID..."
                  className="h-8 pl-8 pr-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 w-44"
                />
              </div>
              <select
                value={progressBranchFilter}
                onChange={(e) => setProgressBranchFilter(e.target.value)}
                className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800"
              >
                <option value="ALL">All Branches</option>
                {branches.map((b) => (
                  <option key={b.branchId} value={b.branchId}>
                    {b.branchName}
                  </option>
                ))}
              </select>
              <select
                value={progressStatusFilter}
                onChange={(e) => setProgressStatusFilter(e.target.value as ProgressFilter)}
                className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACHIEVED">Achieved (100%+)</option>
                <option value="ON_TRACK">On Track (70–99%)</option>
                <option value="IN_PROGRESS">In Progress (&lt;70%)</option>
                <option value="NOT_STARTED">Not Started (0%)</option>
              </select>
            </div>
          </div>

          {employeeProgressRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-500">
              No employee targets set for {formatMonthLabel(targetMonth)} matching your filter.
              Select a branch above, enter growth % (e.g. +10%), and click{' '}
              <strong>Save Branch Targets</strong>.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                      <th className="py-2.5 px-3">Employee / Branch</th>
                      <th className="py-2.5 px-3 text-right">
                        {formatMonthLabel(baselineMonth)} Sale
                      </th>
                      <th className="py-2.5 px-3 text-right">Target Sale</th>
                      <th className="py-2.5 px-3 text-right">Achieved</th>
                      <th className="py-2.5 px-3 text-right">Remaining</th>
                      <th className="py-2.5 px-3 min-w-[170px]">Progress</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {employeeProgressRows.map((row) => (
                      <tr key={row.target.targetId} className="hover:bg-slate-50/70">
                        <td className="py-3 px-3">
                          <div className="font-semibold text-slate-900">
                            {row.target.employeeName}
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono">#{row.target.employeeId}</span>
                            <span>·</span>
                            <span>{row.target.branchName}</span>
                            {!row.hasMobileLogin && (
                              <span className="text-amber-700 font-medium">(Login Pending)</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          <div>{formatINRFromPaise(row.baselineSalePaise)}</div>
                          {row.growthPct !== null && (
                            <div className="text-[10px] font-semibold text-[#9A7625]">
                              {row.growthPct >= 0 ? '+' : ''}
                              {row.growthPct}% target
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="font-semibold text-[#0F1F3D]">
                            {formatINRFromPaise(row.target.targetSaleAmtPaise)}
                          </div>
                          {row.target.targetSaleQty > 0 && (
                            <div className="text-[10px] text-slate-500">
                              Qty: {formatQty(row.target.targetSaleQty)}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="font-semibold text-slate-900">
                            {formatINRFromPaise(row.achievedSalePaise)}
                          </div>
                          {row.target.targetSaleQty > 0 && (
                            <div className="text-[10px] text-slate-500">
                              Qty: {formatQty(row.achievedQty)} ({row.progress.qtyPct}%)
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {row.progress.remainingSalePaise === 0 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Done
                            </span>
                          ) : (
                            <span className="text-slate-700">
                              {formatINRFromPaise(row.progress.remainingSalePaise)}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span
                              className={`text-[11px] font-mono font-bold ${
                                row.progress.salePct >= 100
                                  ? 'text-emerald-700'
                                  : row.progress.salePct >= 70
                                    ? 'text-[#0F1F3D]'
                                    : 'text-amber-700'
                              }`}
                            >
                              {row.progress.salePct}%
                            </span>
                            <span
                              className={`text-[10px] font-semibold ${
                                row.progress.status === 'ACHIEVED'
                                  ? 'text-emerald-700'
                                  : row.progress.status === 'ON_TRACK'
                                    ? 'text-[#1E3A5F]'
                                    : 'text-slate-500'
                              }`}
                            >
                              {row.progress.status === 'ACHIEVED'
                                ? 'Achieved'
                                : row.progress.status === 'ON_TRACK'
                                  ? 'On Track'
                                  : row.progress.status === 'IN_PROGRESS'
                                    ? 'In Progress'
                                    : '0% Yet'}
                            </span>
                          </div>
                          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                row.progress.salePct >= 100
                                  ? 'bg-emerald-600'
                                  : 'bg-gradient-to-r from-[#0F1F3D] to-[#B8923A]'
                              }`}
                              style={{
                                width: `${Math.min(100, Math.max(row.progress.salePct > 0 ? 3 : 0, row.progress.salePct))}%`,
                              }}
                            />
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleQuickEditTarget(row.target)}
                              className="p-1.5 rounded-md text-slate-500 hover:text-[#0F1F3D] hover:bg-slate-100 cursor-pointer"
                              aria-label={`Edit target for ${row.target.employeeName}`}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteTarget(row.target.targetId)}
                              className="p-1.5 rounded-md text-slate-400 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                              aria-label={`Delete target for ${row.target.employeeName}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          </div>
        )}
      </div>
    </section>
  );
}
