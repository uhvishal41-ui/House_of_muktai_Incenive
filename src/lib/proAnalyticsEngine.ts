import { formatINRFromPaise, formatMonthLabel, getPreviousMonthKey } from './format';
import { getOverlappingMonthKeys, type ValidatedImportRow } from './incentiveEngine';
import type { ParsedSalaryRow } from './salarySlipEngine';
import type {
  Branch,
  Employee,
  EmployeeLoan,
  IncentiveAdjustment,
  MonthlySummary,
  PublishedIncentive,
  SalarySlip,
  SalesTarget,
} from '../types/incentive';

// =========================================================================
// 1. MONTHLY NET INCENTIVE & ACTIVE LOAN EMI MAPS (FOR 1-CLICK SALARY SYNC)
// =========================================================================

export interface EmployeeMonthlyIncentiveTotal {
  employeeId: string;
  grossPaise: number;
  adjustmentsNetPaise: number;
  netPayablePaise: number;
}

export function computeMonthlyNetIncentiveByEmployee(
  incentives: PublishedIncentive[],
  adjustments: IncentiveAdjustment[],
  monthKey: string,
): Record<string, EmployeeMonthlyIncentiveTotal> {
  const map: Record<string, EmployeeMonthlyIncentiveTotal> = {};

  const ensure = (empId: string) => {
    const key = empId.trim().toUpperCase();
    if (!map[key]) {
      map[key] = {
        employeeId: empId.trim(),
        grossPaise: 0,
        adjustmentsNetPaise: 0,
        netPayablePaise: 0,
      };
    }
    return map[key];
  };

  for (const rec of incentives) {
    if (rec.status !== 'PUBLISHED') continue;
    const months = getOverlappingMonthKeys(rec);
    if (!months.includes(monthKey)) continue;
    const entry = ensure(rec.employeeId);
    entry.grossPaise += rec.totalPaise || 0;
  }

  for (const adj of adjustments) {
    if (adj.status !== 'ACTIVE' || adj.monthKey !== monthKey) continue;
    const entry = ensure(adj.employeeId);
    const signed = adj.type === 'BONUS' ? adj.amountPaise : -adj.amountPaise;
    entry.adjustmentsNetPaise += signed;
  }

  for (const entry of Object.values(map)) {
    entry.netPayablePaise = Math.max(0, entry.grossPaise + entry.adjustmentsNetPaise);
  }

  return map;
}

export interface EmployeeActiveLoanEmi {
  employeeId: string;
  totalDueEmiPaise: number;
  remainingBalancePaise: number;
  activeLoanIds: string[];
}

export function computeActiveLoanEmiByEmployee(
  loans: EmployeeLoan[],
  monthKey: string,
): Record<string, EmployeeActiveLoanEmi> {
  const map: Record<string, EmployeeActiveLoanEmi> = {};

  for (const loan of loans) {
    if (loan.status !== 'ACTIVE') continue;
    if (loan.remainingBalancePaise <= 0) continue;
    // Only deduct starting from startMonthKey onwards, and skip if already deducted for this month
    if (monthKey && loan.startMonthKey && monthKey < loan.startMonthKey) continue;
    if (monthKey && loan.lastDeductedMonthKey === monthKey) continue;

    const duePaise = Math.min(loan.monthlyEmiPaise, loan.remainingBalancePaise);
    if (duePaise <= 0) continue;

    const key = loan.employeeId.trim().toUpperCase();
    if (!map[key]) {
      map[key] = {
        employeeId: loan.employeeId.trim(),
        totalDueEmiPaise: 0,
        remainingBalancePaise: 0,
        activeLoanIds: [],
      };
    }
    map[key].totalDueEmiPaise += duePaise;
    map[key].remainingBalancePaise += loan.remainingBalancePaise;
    map[key].activeLoanIds.push(loan.loanId);
  }

  return map;
}

export interface SyncSalaryRowsResult {
  rows: ParsedSalaryRow[];
  syncedIncentiveCount: number;
  skippedAlreadyHasSalesCommissionCount: number;
  syncedLoanCount: number;
  totalGrossPaise: number;
  totalDeductionsPaise: number;
  totalNetPaise: number;
}

export function applyIncentiveAndLoanSyncToSalaryRows(
  rows: ParsedSalaryRow[],
  incentiveMap: Record<string, EmployeeMonthlyIncentiveTotal>,
  loanMap: Record<string, EmployeeActiveLoanEmi>,
  options: {
    syncIncentives?: boolean;
    syncLoans?: boolean;
    forceOverwriteSalesCommission?: boolean;
  },
): SyncSalaryRowsResult {
  let syncedIncentiveCount = 0;
  let skippedAlreadyHasSalesCommissionCount = 0;
  let syncedLoanCount = 0;

  const updatedRows = rows.map((row) => {
    if (row.status !== 'VALID') return row;
    const empKey = row.employeeId.trim().toUpperCase();

    let nextIncentivePaise = row.incentivePaise;
    let nextAdvanceRecoveryPaise = row.advanceRecoveryPaise;

    if (options.syncIncentives) {
      const inc = incentiveMap[empKey];
      if (inc && inc.netPayablePaise > 0) {
        if (row.salesCommissionPaise > 0 && !options.forceOverwriteSalesCommission) {
          // Double-Incentive Auto-Protection: Paysheet already contains Sales Commission for this employee
          skippedAlreadyHasSalesCommissionCount += 1;
        } else {
          nextIncentivePaise = inc.netPayablePaise;
          syncedIncentiveCount += 1;
        }
      }
    }

    const nextGross =
      row.basicPaise +
      row.dearnessAllowancePaise +
      row.hraPaise +
      row.attendanceAllowancePaise +
      row.washingAllowancePaise +
      row.conveyancePaise +
      row.medicalAllowancePaise +
      row.leaveTravelAllowancePaise +
      row.communicationExpensesPaise +
      row.healthClubAllowancePaise +
      row.adhocAllowancePaise +
      row.travelingAllowancePaise +
      row.salesCommissionPaise +
      row.specialAllowancePaise +
      row.overtimePaise +
      nextIncentivePaise +
      row.arrearsPaise +
      row.otherEarningsPaise;

    if (options.syncLoans) {
      const loan = loanMap[empKey];
      if (loan && loan.totalDueEmiPaise > 0) {
        const otherDeductionsWithoutAdvance =
          row.pfPaise +
          row.esicPaise +
          row.ptPaise +
          row.lwfPaise +
          row.tdsPaise +
          row.penaltyPaise +
          row.insurancePaise +
          row.otherDeductionPaise;
        const maxSafeAdvance = Math.max(0, nextGross - otherDeductionsWithoutAdvance);
        const clampedAdvance = Math.min(loan.totalDueEmiPaise, maxSafeAdvance);
        if (clampedAdvance > 0) {
          nextAdvanceRecoveryPaise = clampedAdvance;
          syncedLoanCount += 1;
        }
      }
    }

    const nextTotalDeductions =
      row.pfPaise +
      row.esicPaise +
      row.ptPaise +
      row.lwfPaise +
      nextAdvanceRecoveryPaise +
      row.tdsPaise +
      row.penaltyPaise +
      row.insurancePaise +
      row.otherDeductionPaise;

    const nextNet = Math.max(0, nextGross - nextTotalDeductions);

    return {
      ...row,
      incentivePaise: nextIncentivePaise,
      advanceRecoveryPaise: nextAdvanceRecoveryPaise,
      grossEarningsPaise: nextGross,
      totalDeductionsPaise: nextTotalDeductions,
      netPayablePaise: nextNet,
    };
  });

  const valid = updatedRows.filter((r) => r.status === 'VALID');
  return {
    rows: updatedRows,
    syncedIncentiveCount,
    skippedAlreadyHasSalesCommissionCount,
    syncedLoanCount,
    totalGrossPaise: valid.reduce((s, r) => s + r.grossEarningsPaise, 0),
    totalDeductionsPaise: valid.reduce((s, r) => s + r.totalDeductionsPaise, 0),
    totalNetPaise: valid.reduce((s, r) => s + r.netPayablePaise, 0),
  };
}

// =========================================================================
// 2. PRE-PUBLISH SMART AUDIT & ANOMALY GUARD (INCENTIVES & SALARY SLIPS)
// =========================================================================

export type AuditAnomalySeverity = 'HIGH' | 'MEDIUM';

export interface AuditAnomaly {
  id: string;
  severity: AuditAnomalySeverity;
  code:
    | 'VARIANCE_SPIKE'
    | 'VARIANCE_DROP'
    | 'ZERO_SALES_HIGH_INCENTIVE'
    | 'HIGH_INCENTIVE_RATIO'
    | 'HIGH_DEDUCTIONS'
    | 'HIGH_LOP_DAYS'
    | 'ZERO_PAID_DAYS_POSITIVE_NET';
  employeeId: string;
  employeeName: string;
  branchName: string;
  title: string;
  detail: string;
}

export function detectIncentiveImportAnomalies(params: {
  validatedRows: ValidatedImportRow[];
  publishedIncentives: PublishedIncentive[];
}): AuditAnomaly[] {
  const anomalies: AuditAnomaly[] = [];
  const activeRows = params.validatedRows.filter(
    (r) =>
      r.validationStatus === 'VALID' ||
      r.resolution === 'CORRECTION' ||
      r.resolution === 'SUPERSEDE_CONFLICTS',
  );
  if (activeRows.length === 0) return anomalies;

  // Group current upload totals per employee + monthKey
  const currentByEmpMonth = new Map<
    string,
    {
      employeeId: string;
      employeeName: string;
      branchName: string;
      monthKey: string;
      totalIncentivePaise: number;
      totalSaleAmtPaise: number;
    }
  >();

  for (const r of activeRows) {
    const monthKey = (r.businessDate || r.periodStart || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) continue;
    const key = `${r.employeeId.toUpperCase()}__${monthKey}`;
    const existing = currentByEmpMonth.get(key) || {
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      branchName: r.branchName,
      monthKey,
      totalIncentivePaise: 0,
      totalSaleAmtPaise: 0,
    };
    existing.totalIncentivePaise += r.totalPaise;
    existing.totalSaleAmtPaise += r.totalSaleAmtPaise;
    currentByEmpMonth.set(key, existing);
  }

  // Group prior published incentives by employee + monthKey
  const priorByEmpMonth = new Map<string, number>();
  for (const p of params.publishedIncentives) {
    if (p.status !== 'PUBLISHED') continue;
    const months = getOverlappingMonthKeys(p);
    for (const mk of months) {
      const key = `${p.employeeId.toUpperCase()}__${mk}`;
      priorByEmpMonth.set(key, (priorByEmpMonth.get(key) || 0) + p.totalPaise);
    }
  }

  for (const cur of currentByEmpMonth.values()) {
    // Rule A: Zero sales with high incentive (>= ₹500)
    if (cur.totalSaleAmtPaise === 0 && cur.totalIncentivePaise >= 50000) {
      anomalies.push({
        id: `ZERO_SALE__${cur.employeeId}__${cur.monthKey}`,
        severity: 'HIGH',
        code: 'ZERO_SALES_HIGH_INCENTIVE',
        employeeId: cur.employeeId,
        employeeName: cur.employeeName,
        branchName: cur.branchName,
        title: 'High incentive with ₹0 sales',
        detail: `${formatINRFromPaise(cur.totalIncentivePaise)} incentive recorded with ₹0 sales in ${formatMonthLabel(cur.monthKey)}. Verify Sale Amt columns.`,
      });
    }

    // Rule B: Incentive > 10% of sales (when sales > ₹1,000)
    if (cur.totalSaleAmtPaise >= 100000) {
      const ratioPct = (cur.totalIncentivePaise / cur.totalSaleAmtPaise) * 100;
      if (ratioPct > 10) {
        anomalies.push({
          id: `RATIO__${cur.employeeId}__${cur.monthKey}`,
          severity: 'MEDIUM',
          code: 'HIGH_INCENTIVE_RATIO',
          employeeId: cur.employeeId,
          employeeName: cur.employeeName,
          branchName: cur.branchName,
          title: `High incentive-to-sales ratio (${ratioPct.toFixed(1)}%)`,
          detail: `Incentive ${formatINRFromPaise(cur.totalIncentivePaise)} on sales ${formatINRFromPaise(cur.totalSaleAmtPaise)} exceeds the 10% benchmark.`,
        });
      }
    }

    // Rule C: ±40% variance vs. previous month (when previous month >= ₹500)
    const prevMonthKey = getPreviousMonthKey(cur.monthKey);
    const prevPaise = priorByEmpMonth.get(`${cur.employeeId.toUpperCase()}__${prevMonthKey}`) || 0;
    if (prevPaise >= 50000) {
      const deltaPct = ((cur.totalIncentivePaise - prevPaise) / prevPaise) * 100;
      if (deltaPct >= 40) {
        anomalies.push({
          id: `SPIKE__${cur.employeeId}__${cur.monthKey}`,
          severity: deltaPct >= 80 ? 'HIGH' : 'MEDIUM',
          code: 'VARIANCE_SPIKE',
          employeeId: cur.employeeId,
          employeeName: cur.employeeName,
          branchName: cur.branchName,
          title: `+${Math.round(deltaPct)}% jump vs. ${formatMonthLabel(prevMonthKey)}`,
          detail: `Current ${formatINRFromPaise(cur.totalIncentivePaise)} vs. prior ${formatINRFromPaise(prevPaise)}. Double-check decimal/zero typos.`,
        });
      } else if (deltaPct <= -40) {
        anomalies.push({
          id: `DROP__${cur.employeeId}__${cur.monthKey}`,
          severity: 'MEDIUM',
          code: 'VARIANCE_DROP',
          employeeId: cur.employeeId,
          employeeName: cur.employeeName,
          branchName: cur.branchName,
          title: `${Math.round(deltaPct)}% drop vs. ${formatMonthLabel(prevMonthKey)}`,
          detail: `Current ${formatINRFromPaise(cur.totalIncentivePaise)} vs. prior ${formatINRFromPaise(prevPaise)}. Confirm no missing rows.`,
        });
      }
    }
  }

  return anomalies.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'HIGH' ? -1 : 1));
}

export function detectSalarySlipAnomalies(params: {
  validRows: ParsedSalaryRow[];
  existingSlips: SalarySlip[];
}): AuditAnomaly[] {
  const anomalies: AuditAnomaly[] = [];
  if (params.validRows.length === 0) return anomalies;

  const slipByEmpMonth = new Map<string, SalarySlip>();
  for (const s of params.existingSlips) {
    slipByEmpMonth.set(`${s.employeeId.toUpperCase()}__${s.monthKey}`, s);
  }

  for (const row of params.validRows) {
    // Rule 1: Zero paid days with positive net pay
    if (row.paidDays === 0 && row.netPayablePaise > 0) {
      anomalies.push({
        id: `ZERO_DAYS__${row.employeeId}__${row.monthKey}`,
        severity: 'HIGH',
        code: 'ZERO_PAID_DAYS_POSITIVE_NET',
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        branchName: row.branchName,
        title: '0 Paid Days with positive Net Pay',
        detail: `Paid Days is 0, yet Net Payable is ${formatINRFromPaise(row.netPayablePaise)}. Verify attendance columns.`,
      });
    }

    // Rule 2: High deductions (> 45% of Gross Earnings)
    if (row.grossEarningsPaise > 0) {
      const dedPct = (row.totalDeductionsPaise / row.grossEarningsPaise) * 100;
      if (dedPct > 45) {
        anomalies.push({
          id: `HIGH_DED__${row.employeeId}__${row.monthKey}`,
          severity: 'HIGH',
          code: 'HIGH_DEDUCTIONS',
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          branchName: row.branchName,
          title: `Deductions are ${dedPct.toFixed(1)}% of Gross`,
          detail: `Deductions ${formatINRFromPaise(row.totalDeductionsPaise)} out of Gross ${formatINRFromPaise(row.grossEarningsPaise)}.`,
        });
      }
    }

    // Rule 3: High LOP Days (>= 10 days)
    if (row.lopDays >= 10) {
      anomalies.push({
        id: `HIGH_LOP__${row.employeeId}__${row.monthKey}`,
        severity: 'MEDIUM',
        code: 'HIGH_LOP_DAYS',
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        branchName: row.branchName,
        title: `High LOP (${row.lopDays} days)`,
        detail: `${row.lopDays} LOP days out of ${row.totalDays} total days (${row.paidDays} paid days).`,
      });
    }

    // Rule 4: ±40% Net Pay variance vs. previous month salary slip
    const prevMonth = getPreviousMonthKey(row.monthKey);
    const prevSlip = slipByEmpMonth.get(`${row.employeeId.toUpperCase()}__${prevMonth}`);
    if (prevSlip && prevSlip.netPayablePaise >= 100000) {
      const deltaPct =
        ((row.netPayablePaise - prevSlip.netPayablePaise) / prevSlip.netPayablePaise) * 100;
      if (deltaPct >= 40) {
        anomalies.push({
          id: `SAL_SPIKE__${row.employeeId}__${row.monthKey}`,
          severity: 'HIGH',
          code: 'VARIANCE_SPIKE',
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          branchName: row.branchName,
          title: `Net salary +${Math.round(deltaPct)}% vs. ${formatMonthLabel(prevMonth)}`,
          detail: `Current ${formatINRFromPaise(row.netPayablePaise)} vs. prior ${formatINRFromPaise(prevSlip.netPayablePaise)}.`,
        });
      } else if (deltaPct <= -40) {
        anomalies.push({
          id: `SAL_DROP__${row.employeeId}__${row.monthKey}`,
          severity: 'MEDIUM',
          code: 'VARIANCE_DROP',
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          branchName: row.branchName,
          title: `Net salary ${Math.round(deltaPct)}% vs. ${formatMonthLabel(prevMonth)}`,
          detail: `Current ${formatINRFromPaise(row.netPayablePaise)} vs. prior ${formatINRFromPaise(prevSlip.netPayablePaise)}.`,
        });
      }
    }
  }

  return anomalies.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'HIGH' ? -1 : 1));
}

// =========================================================================
// 3. EXECUTIVE BRANCH P&L ANALYTICS (PAYROLL COST VS. SALES RATIO)
// =========================================================================

export interface BranchPnlRow {
  branchId: string;
  branchName: string;
  activeStaffCount: number;
  totalSalesPaise: number;
  totalSalaryGrossPaise: number;
  totalSalaryNetPaise: number;
  totalIncentivePaise: number;
  totalPayrollCostPaise: number; // Base salary (excluding duplicated incentive line) + published incentive
  costToSalesPct: number;
  incentiveToSalesPct: number;
  salesPerStaffPaise: number;
}

export interface MonthlyPnlTrendPoint {
  monthKey: string;
  monthLabel: string;
  totalSalesPaise: number;
  totalPayrollCostPaise: number;
  totalIncentivePaise: number;
  costToSalesPct: number;
}

export interface BranchPnlSummary {
  monthKey: string;
  rows: BranchPnlRow[];
  companyTotals: {
    activeStaffCount: number;
    totalSalesPaise: number;
    totalSalaryGrossPaise: number;
    totalIncentivePaise: number;
    totalPayrollCostPaise: number;
    costToSalesPct: number;
    incentiveToSalesPct: number;
    salesPerStaffPaise: number;
  };
  monthlyTrend: MonthlyPnlTrendPoint[];
}

export function computeBranchPnlAnalytics(params: {
  branches: Branch[];
  employees: Employee[];
  monthlySummaries: MonthlySummary[];
  salarySlips: SalarySlip[];
  selectedMonth: string;
}): BranchPnlSummary {
  const { branches, employees, monthlySummaries, salarySlips, selectedMonth } = params;

  const activeStaffByBranch = new Map<string, number>();
  for (const emp of employees) {
    if (emp.status !== 'ACTIVE') continue;
    activeStaffByBranch.set(emp.branchId, (activeStaffByBranch.get(emp.branchId) || 0) + 1);
  }

  const branchMap = new Map<string, BranchPnlRow>();
  for (const b of branches) {
    branchMap.set(b.branchId, {
      branchId: b.branchId,
      branchName: b.branchName,
      activeStaffCount: activeStaffByBranch.get(b.branchId) || 0,
      totalSalesPaise: 0,
      totalSalaryGrossPaise: 0,
      totalSalaryNetPaise: 0,
      totalIncentivePaise: 0,
      totalPayrollCostPaise: 0,
      costToSalesPct: 0,
      incentiveToSalesPct: 0,
      salesPerStaffPaise: 0,
    });
  }

  const ensureBranch = (branchId: string, branchName: string): BranchPnlRow => {
    let row = branchMap.get(branchId);
    if (!row) {
      row = {
        branchId,
        branchName: branchName || branchId,
        activeStaffCount: activeStaffByBranch.get(branchId) || 0,
        totalSalesPaise: 0,
        totalSalaryGrossPaise: 0,
        totalSalaryNetPaise: 0,
        totalIncentivePaise: 0,
        totalPayrollCostPaise: 0,
        costToSalesPct: 0,
        incentiveToSalesPct: 0,
        salesPerStaffPaise: 0,
      };
      branchMap.set(branchId, row);
    }
    return row;
  };

  // Track salary-slip incentive & sales-commission lines so we never double-count
  // published incentives in totalPayrollCostPaise (real paysheets store incentives in SALES COMMISION).
  const salaryExclIncentiveByBranch = new Map<string, number>();

  for (const s of monthlySummaries) {
    if (s.monthKey !== selectedMonth) continue;
    const row = ensureBranch(s.branchId, s.branchName);
    row.totalSalesPaise += s.totalSaleAmtPaise || 0;
    row.totalIncentivePaise += s.grandTotalPaise || 0;
  }

  for (const slip of salarySlips) {
    if (slip.monthKey !== selectedMonth) continue;
    const row = ensureBranch(slip.branchId, slip.branchName);
    row.totalSalaryGrossPaise += slip.grossEarningsPaise || 0;
    row.totalSalaryNetPaise += slip.netPayablePaise || 0;
    const slipIncAndComm = (slip.incentivePaise || 0) + (slip.salesCommissionPaise || 0);
    const baseGross = Math.max(0, (slip.grossEarningsPaise || 0) - slipIncAndComm);
    salaryExclIncentiveByBranch.set(
      slip.branchId,
      (salaryExclIncentiveByBranch.get(slip.branchId) || 0) + baseGross,
    );
  }

  const rows: BranchPnlRow[] = Array.from(branchMap.values())
    .map((row) => {
      const baseGross = salaryExclIncentiveByBranch.get(row.branchId) || 0;
      // When published incentives exist for this branch/month, use baseGross + published incentives
      // (avoiding double-counting slip incentivePaise / salesCommissionPaise). When no published
      // incentive sheet exists yet, keep totalSalaryGrossPaise so commission isn't dropped.
      const totalPayrollCostPaise =
        row.totalIncentivePaise > 0
          ? baseGross + row.totalIncentivePaise
          : row.totalSalaryGrossPaise;
      const costToSalesPct =
        row.totalSalesPaise > 0
          ? Number(((totalPayrollCostPaise / row.totalSalesPaise) * 100).toFixed(2))
          : 0;
      const incentiveToSalesPct =
        row.totalSalesPaise > 0
          ? Number(((row.totalIncentivePaise / row.totalSalesPaise) * 100).toFixed(2))
          : 0;
      const salesPerStaffPaise =
        row.activeStaffCount > 0 ? Math.round(row.totalSalesPaise / row.activeStaffCount) : 0;

      return {
        ...row,
        totalPayrollCostPaise,
        costToSalesPct,
        incentiveToSalesPct,
        salesPerStaffPaise,
      };
    })
    .sort((a, b) => b.totalSalesPaise - a.totalSalesPaise || a.branchName.localeCompare(b.branchName));

  const totalStaff = rows.reduce((s, r) => s + r.activeStaffCount, 0);
  const totalSales = rows.reduce((s, r) => s + r.totalSalesPaise, 0);
  const totalSalaryGross = rows.reduce((s, r) => s + r.totalSalaryGrossPaise, 0);
  const totalIncentive = rows.reduce((s, r) => s + r.totalIncentivePaise, 0);
  const totalPayrollCost = rows.reduce((s, r) => s + r.totalPayrollCostPaise, 0);

  // Build 6-month trend across all available months up to selectedMonth
  const allMonthSet = new Set<string>([selectedMonth]);
  for (const s of monthlySummaries) allMonthSet.add(s.monthKey);
  for (const sl of salarySlips) allMonthSet.add(sl.monthKey);
  const sortedMonths = Array.from(allMonthSet)
    .filter((mk) => /^\d{4}-\d{2}$/.test(mk))
    .sort()
    .slice(-6);

  const monthlyTrend: MonthlyPnlTrendPoint[] = sortedMonths.map((mk) => {
    const mSales = monthlySummaries
      .filter((s) => s.monthKey === mk)
      .reduce((acc, s) => acc + (s.totalSaleAmtPaise || 0), 0);
    const mInc = monthlySummaries
      .filter((s) => s.monthKey === mk)
      .reduce((acc, s) => acc + (s.grandTotalPaise || 0), 0);
    const mSlips = salarySlips.filter((sl) => sl.monthKey === mk);
    const mCost =
      mInc > 0
        ? mSlips.reduce(
            (acc, sl) =>
              acc +
              Math.max(
                0,
                (sl.grossEarningsPaise || 0) -
                  ((sl.incentivePaise || 0) + (sl.salesCommissionPaise || 0)),
              ),
            0,
          ) + mInc
        : mSlips.reduce((acc, sl) => acc + (sl.grossEarningsPaise || 0), 0);
    return {
      monthKey: mk,
      monthLabel: formatMonthLabel(mk),
      totalSalesPaise: mSales,
      totalPayrollCostPaise: mCost,
      totalIncentivePaise: mInc,
      costToSalesPct: mSales > 0 ? Number(((mCost / mSales) * 100).toFixed(2)) : 0,
    };
  });

  return {
    monthKey: selectedMonth,
    rows,
    companyTotals: {
      activeStaffCount: totalStaff,
      totalSalesPaise: totalSales,
      totalSalaryGrossPaise: totalSalaryGross,
      totalIncentivePaise: totalIncentive,
      totalPayrollCostPaise: totalPayrollCost,
      costToSalesPct:
        totalSales > 0 ? Number(((totalPayrollCost / totalSales) * 100).toFixed(2)) : 0,
      incentiveToSalesPct:
        totalSales > 0 ? Number(((totalIncentive / totalSales) * 100).toFixed(2)) : 0,
      salesPerStaffPaise: totalStaff > 0 ? Math.round(totalSales / totalStaff) : 0,
    },
    monthlyTrend,
  };
}

// =========================================================================
// 4. MULTI-MONTH PERFORMANCE STREAK & RETENTION / EARLY COACHING SCORECARD
// =========================================================================

export interface EmployeeStreakInfo {
  employeeId: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  departmentName?: string;
  consecutiveTargetMetMonths: number;
  consecutiveDeclineMonths: number;
  latestMonthKey: string;
  latestSalesPaise: number;
  previousSalesPaise: number;
  latestDropPct: number; // negative when declining
  badge: 'STAR_PERFORMER' | 'RISING_STREAK' | 'COACHING_ALERT' | 'STEADY';
}

export interface PerformanceRetentionSummary {
  starPerformers: EmployeeStreakInfo[]; // >= 3 consecutive months target met
  risingStreaks: EmployeeStreakInfo[]; // 2 consecutive months target met
  coachingAlerts: EmployeeStreakInfo[]; // >= 2 consecutive months sales decline (>= 10% each step)
  streakByEmployeeId: Record<string, EmployeeStreakInfo>;
}

export function computePerformanceStreaksAndRetention(params: {
  employees: Employee[];
  monthlySummaries: MonthlySummary[];
  salesTargets: SalesTarget[];
}): PerformanceRetentionSummary {
  const { employees, monthlySummaries, salesTargets } = params;

  const summariesByEmp = new Map<string, MonthlySummary[]>();
  for (const s of monthlySummaries) {
    const key = s.employeeId.toUpperCase();
    const list = summariesByEmp.get(key) || [];
    list.push(s);
    summariesByEmp.set(key, list);
  }

  const empTargetByKey = new Map<string, SalesTarget>();
  for (const t of salesTargets) {
    if (t.scope === 'EMPLOYEE' && t.employeeId) {
      empTargetByKey.set(`${t.employeeId.toUpperCase()}__${t.monthKey}`, t);
    }
  }

  const starPerformers: EmployeeStreakInfo[] = [];
  const risingStreaks: EmployeeStreakInfo[] = [];
  const coachingAlerts: EmployeeStreakInfo[] = [];
  const streakByEmployeeId: Record<string, EmployeeStreakInfo> = {};

  for (const emp of employees) {
    if (emp.status !== 'ACTIVE') continue;
    const empKey = emp.employeeId.toUpperCase();
    const history = (summariesByEmp.get(empKey) || [])
      .slice()
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    if (history.length === 0) continue;

    // 1. Consecutive target-met streak counting backwards from latest month
    let targetStreak = 0;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const m = history[i];
      const tgt = empTargetByKey.get(`${empKey}__${m.monthKey}`);
      const metByTarget =
        tgt && tgt.targetSaleAmtPaise > 0
          ? (m.totalSaleAmtPaise || 0) >= tgt.targetSaleAmtPaise
          : false;
      // Fallback consistency when explicit employee targets aren't set: >= prior month sales (growth) & positive sales
      const prevM = i > 0 ? history[i - 1] : null;
      const metByGrowth =
        !tgt &&
        (m.totalSaleAmtPaise || 0) > 0 &&
        prevM !== null &&
        (m.totalSaleAmtPaise || 0) >= (prevM.totalSaleAmtPaise || 0);

      if (metByTarget || metByGrowth) {
        targetStreak += 1;
      } else {
        break;
      }
    }

    // 2. Consecutive sales decline months (>= 10% drop month-over-month)
    let declineStreak = 0;
    for (let i = history.length - 1; i >= 1; i -= 1) {
      const currSale = history[i].totalSaleAmtPaise || 0;
      const prevSale = history[i - 1].totalSaleAmtPaise || 0;
      if (prevSale > 0) {
        const pctChange = ((currSale - prevSale) / prevSale) * 100;
        if (pctChange <= -10) {
          declineStreak += 1;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    const latest = history[history.length - 1];
    const previous = history.length >= 2 ? history[history.length - 2] : null;
    const latestDropPct =
      previous && (previous.totalSaleAmtPaise || 0) > 0
        ? Number(
            (
              (((latest.totalSaleAmtPaise || 0) - (previous.totalSaleAmtPaise || 0)) /
                (previous.totalSaleAmtPaise || 1)) *
              100
            ).toFixed(1),
          )
        : 0;

    let badge: EmployeeStreakInfo['badge'] = 'STEADY';
    if (targetStreak >= 3) {
      badge = 'STAR_PERFORMER';
    } else if (declineStreak >= 2) {
      badge = 'COACHING_ALERT';
    } else if (targetStreak === 2) {
      badge = 'RISING_STREAK';
    }

    const info: EmployeeStreakInfo = {
      employeeId: emp.employeeId,
      employeeName: emp.fullName,
      branchId: emp.branchId,
      branchName: emp.branchName,
      departmentName: emp.departmentName,
      consecutiveTargetMetMonths: targetStreak,
      consecutiveDeclineMonths: declineStreak,
      latestMonthKey: latest.monthKey,
      latestSalesPaise: latest.totalSaleAmtPaise || 0,
      previousSalesPaise: previous?.totalSaleAmtPaise || 0,
      latestDropPct,
      badge,
    };

    streakByEmployeeId[empKey] = info;
    if (badge === 'STAR_PERFORMER') starPerformers.push(info);
    else if (badge === 'RISING_STREAK') risingStreaks.push(info);
    else if (badge === 'COACHING_ALERT') coachingAlerts.push(info);
  }

  starPerformers.sort(
    (a, b) =>
      b.consecutiveTargetMetMonths - a.consecutiveTargetMetMonths ||
      b.latestSalesPaise - a.latestSalesPaise,
  );
  risingStreaks.sort((a, b) => b.latestSalesPaise - a.latestSalesPaise);
  coachingAlerts.sort(
    (a, b) =>
      b.consecutiveDeclineMonths - a.consecutiveDeclineMonths ||
      a.latestDropPct - b.latestDropPct,
  );

  return {
    starPerformers,
    risingStreaks,
    coachingAlerts,
    streakByEmployeeId,
  };
}

// =========================================================================
// 5. WHATSAPP PAYSLIP DISPATCH HELPERS (ZERO window.open — PURE https://wa.me)
// =========================================================================

export function normalizeIndianWhatsAppNumber(phone?: string | null): string {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return '';
}

export function buildWhatsAppSlipMessage(params: {
  employeeName: string;
  monthKey: string;
  netPayablePaise: number;
  branchName: string;
  portalUrl?: string;
}): string {
  const monthLabel = formatMonthLabel(params.monthKey);
  const netStr = formatINRFromPaise(params.netPayablePaise);
  const urlLine = params.portalUrl ? `\nPortal: ${params.portalUrl}` : '';
  return (
    `नमस्कार ${params.employeeName},\n` +
    `House of Muktai (${params.branchName}) तर्फे तुमची ${monthLabel} ची Salary Slip पोर्टलवर उपलब्ध झाली आहे.\n` +
    `Net Payable: ${netStr}\n` +
    `कृपया Staff Portal मध्ये लॉगिन करून तुमची अधिकृत PDF Payment Slip डाउनलोड करा.${urlLine}`
  );
}

export function buildWhatsAppDeepLink(phone: string | undefined | null, message: string): string {
  const normalized = normalizeIndianWhatsAppNumber(phone);
  const encoded = encodeURIComponent(message);
  return normalized
    ? `https://wa.me/${normalized}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;
}

// =========================================================================
// 6. OVERTIME, ATTENDANCE (LOP) & ATTRITION INSIGHTS ENGINE (PRO #5)
// =========================================================================

export interface AttendanceOtAttritionBranchRow {
  branchId: string;
  branchName: string;
  activeStaffCount: number;
  inactiveStaffCount: number;
  attritionPct: number;
  newJoinersCount: number;
  totalOvertimeDays: number;
  totalOvertimeHours: number;
  totalOvertimePaise: number;
  totalLopDays: number;
  highLopStaffCount: number;
  highOtStaffCount: number;
}

export interface HighLopAlert {
  employeeId: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  lopDays: number;
  paidDays: number;
  totalDays: number;
}

export interface HighOtAlert {
  employeeId: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  overtimeDays: number;
  overtimeHours: number;
  overtimePaise: number;
  basicPaise: number;
  otToBasicPct: number;
}

export interface AttendanceOtAttritionSummary {
  monthKey: string;
  branchRows: AttendanceOtAttritionBranchRow[];
  companyTotals: {
    activeStaffCount: number;
    inactiveStaffCount: number;
    attritionPct: number;
    newJoinersCount: number;
    totalOvertimeDays: number;
    totalOvertimeHours: number;
    totalOvertimePaise: number;
    totalLopDays: number;
    highLopStaffCount: number;
    highOtStaffCount: number;
  };
  highLopAlerts: HighLopAlert[];
  highOtAlerts: HighOtAlert[];
}

function normalizeDojMonthKey(doj?: string): string {
  const raw = String(doj || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}/.test(raw)) return raw.slice(0, 7);
  const dmy = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) {
    const mm = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${mm}`;
  }
  return '';
}

export function computeAttendanceOtAttritionAnalytics(params: {
  branches: Branch[];
  employees: Employee[];
  salarySlips: SalarySlip[];
  selectedMonth: string;
}): AttendanceOtAttritionSummary {
  const { branches, employees, salarySlips, selectedMonth } = params;
  const branchMap = new Map<string, AttendanceOtAttritionBranchRow>();

  const ensureBranch = (branchId: string, branchName: string): AttendanceOtAttritionBranchRow => {
    let row = branchMap.get(branchId);
    if (!row) {
      row = {
        branchId,
        branchName,
        activeStaffCount: 0,
        inactiveStaffCount: 0,
        attritionPct: 0,
        newJoinersCount: 0,
        totalOvertimeDays: 0,
        totalOvertimeHours: 0,
        totalOvertimePaise: 0,
        totalLopDays: 0,
        highLopStaffCount: 0,
        highOtStaffCount: 0,
      };
      branchMap.set(branchId, row);
    }
    return row;
  };

  for (const b of branches) {
    ensureBranch(b.branchId, b.branchName);
  }

  for (const emp of employees) {
    const row = ensureBranch(emp.branchId, emp.branchName);
    if (emp.status === 'ACTIVE') row.activeStaffCount += 1;
    else row.inactiveStaffCount += 1;
    if (selectedMonth && normalizeDojMonthKey(emp.dateOfJoining) === selectedMonth) {
      row.newJoinersCount += 1;
    }
  }

  const highLopAlerts: HighLopAlert[] = [];
  const highOtAlerts: HighOtAlert[] = [];

  for (const slip of salarySlips) {
    if (selectedMonth && slip.monthKey !== selectedMonth) continue;
    const row = ensureBranch(slip.branchId, slip.branchName);
    const otDays = Number(slip.overtimeDays || 0);
    const otHours = Number(slip.overtimeHours || 0);
    const otPaise = Number(slip.overtimePaise || 0);
    const lopDays = Number(slip.lopDays || 0);
    const basicPaise = Number(slip.basicPaise || 0);

    row.totalOvertimeDays = Math.round((row.totalOvertimeDays + otDays) * 100) / 100;
    row.totalOvertimeHours = Math.round((row.totalOvertimeHours + otHours) * 100) / 100;
    row.totalOvertimePaise += otPaise;
    row.totalLopDays = Math.round((row.totalLopDays + lopDays) * 100) / 100;

    if (lopDays >= 4) {
      row.highLopStaffCount += 1;
      highLopAlerts.push({
        employeeId: slip.employeeId,
        employeeName: slip.employeeName,
        branchId: slip.branchId,
        branchName: slip.branchName,
        lopDays,
        paidDays: slip.paidDays,
        totalDays: slip.totalDays,
      });
    }

    const otToBasicPct = basicPaise > 0 ? Math.round((otPaise / basicPaise) * 1000) / 10 : 0;
    if (otDays >= 5 || (basicPaise > 0 && otPaise > basicPaise * 0.25)) {
      row.highOtStaffCount += 1;
      highOtAlerts.push({
        employeeId: slip.employeeId,
        employeeName: slip.employeeName,
        branchId: slip.branchId,
        branchName: slip.branchName,
        overtimeDays: otDays,
        overtimeHours: otHours,
        overtimePaise: otPaise,
        basicPaise,
        otToBasicPct,
      });
    }
  }

  const branchRows = Array.from(branchMap.values()).map((r) => {
    const totalStaff = r.activeStaffCount + r.inactiveStaffCount;
    return {
      ...r,
      attritionPct: totalStaff > 0 ? Math.round((r.inactiveStaffCount / totalStaff) * 1000) / 10 : 0,
    };
  });

  branchRows.sort(
    (a, b) =>
      b.totalOvertimePaise - a.totalOvertimePaise ||
      b.totalLopDays - a.totalLopDays ||
      a.branchName.localeCompare(b.branchName),
  );

  highLopAlerts.sort((a, b) => b.lopDays - a.lopDays || a.employeeName.localeCompare(b.employeeName));
  highOtAlerts.sort(
    (a, b) => b.overtimePaise - a.overtimePaise || b.overtimeDays - a.overtimeDays,
  );

  const totalActive = branchRows.reduce((acc, r) => acc + r.activeStaffCount, 0);
  const totalInactive = branchRows.reduce((acc, r) => acc + r.inactiveStaffCount, 0);
  const totalAll = totalActive + totalInactive;

  return {
    monthKey: selectedMonth,
    branchRows,
    companyTotals: {
      activeStaffCount: totalActive,
      inactiveStaffCount: totalInactive,
      attritionPct: totalAll > 0 ? Math.round((totalInactive / totalAll) * 1000) / 10 : 0,
      newJoinersCount: branchRows.reduce((acc, r) => acc + r.newJoinersCount, 0),
      totalOvertimeDays:
        Math.round(branchRows.reduce((acc, r) => acc + r.totalOvertimeDays, 0) * 100) / 100,
      totalOvertimeHours:
        Math.round(branchRows.reduce((acc, r) => acc + r.totalOvertimeHours, 0) * 100) / 100,
      totalOvertimePaise: branchRows.reduce((acc, r) => acc + r.totalOvertimePaise, 0),
      totalLopDays: Math.round(branchRows.reduce((acc, r) => acc + r.totalLopDays, 0) * 100) / 100,
      highLopStaffCount: branchRows.reduce((acc, r) => acc + r.highLopStaffCount, 0),
      highOtStaffCount: branchRows.reduce((acc, r) => acc + r.highOtStaffCount, 0),
    },
    highLopAlerts,
    highOtAlerts,
  };
}

