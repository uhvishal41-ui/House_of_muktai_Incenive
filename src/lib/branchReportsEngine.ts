import { computeAttendanceOtAttritionAnalytics } from './proAnalyticsEngine';
import type {
  Branch,
  Employee,
  IncentiveAdjustment,
  MonthlySummary,
  PayoutRecord,
  SalarySlip,
} from '../types/incentive';

/**
 * Pure Branch-Wise Report Dataset Engine for House of Muktai (12 Branches).
 * Produces exact, branch-filtered, audit-safe datasets for:
 *  1. Branch Salary Register
 *  2. Bank NEFT Bulk Transfer Sheet
 *  3. Cash / DCR Disbursement Voucher Sheet
 *  4. Monthly Statutory Compliance Challan (PF, ESIC, PT, LWF)
 *  5. Branch Sales & Incentive Report
 *  6. Branch Overtime, LOP & Attrition Report
 *  7. Branch Employee Master Roster
 *  8. 12-Branch Side-by-Side Executive Summary
 */

export interface BranchFilterInput {
  branches: Branch[];
  employees: Employee[];
  salarySlips: SalarySlip[];
  monthlySummaries: MonthlySummary[];
  payoutRecords: PayoutRecord[];
  adjustments: IncentiveAdjustment[];
  selectedMonth: string; // 'YYYY-MM'
  selectedBranchId: string; // 'ALL' or specific branchId
}

export interface BankNeftTransferRow {
  srNo: number;
  employeeId: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  departmentName: string;
  bankName: string;
  bankAccount: string;
  bankIfsc: string;
  netPayablePaise: number;
  paymentMode: string;
  narration: string;
  bankDetailsComplete: boolean;
}

export interface BankNeftDataset {
  rows: BankNeftTransferRow[];
  totalAmountPaise: number;
  readyCount: number;
  missingBankDetailsCount: number;
}

export interface DcrCashVoucherRow {
  srNo: number;
  employeeId: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  departmentName: string;
  designation: string;
  paidDays: number;
  totalDays: number;
  netPayablePaise: number;
  paymentMode: string;
  remarks: string;
}

export interface DcrCashDataset {
  rows: DcrCashVoucherRow[];
  totalAmountPaise: number;
  dcrCount: number;
  cashCount: number;
  otherCount: number;
}

export interface StatutoryComplianceRow {
  srNo: number;
  employeeId: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  uanNumber: string;
  pfNumber: string;
  esicNumber: string;
  panNumber: string;
  grossEarningsPaise: number;
  basicPaise: number;
  pfPaise: number;
  esicPaise: number;
  ptPaise: number;
  lwfPaise: number;
  tdsPaise: number;
  totalStatutoryPaise: number;
}

export interface StatutoryComplianceDataset {
  rows: StatutoryComplianceRow[];
  totals: {
    grossEarningsPaise: number;
    basicPaise: number;
    pfPaise: number;
    esicPaise: number;
    ptPaise: number;
    lwfPaise: number;
    tdsPaise: number;
    totalStatutoryPaise: number;
    pfCoveredCount: number;
    esicCoveredCount: number;
    ptCoveredCount: number;
  };
}

export interface BranchIncentiveRow {
  srNo: number;
  employeeId: string;
  saleId: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  departmentName: string;
  saleAmt1Paise: number;
  saleQty1: number;
  inc1Paise: number;
  saleAmt2Paise: number;
  saleQty2: number;
  inc2Paise: number;
  saleAmt3Paise: number;
  saleQty3: number;
  inc3Paise: number;
  totalSaleAmtPaise: number;
  totalSaleQty: number;
  grossIncentivePaise: number;
  adjustmentsNetPaise: number;
  netPayablePaise: number;
  payoutStatus: string;
  paymentMode: string;
  paymentReference: string;
}

export interface BranchIncentiveDataset {
  rows: BranchIncentiveRow[];
  totals: {
    totalSaleAmtPaise: number;
    totalSaleQty: number;
    grossIncentivePaise: number;
    adjustmentsNetPaise: number;
    netPayablePaise: number;
    paidCount: number;
  };
}

export interface BranchExecutiveSummaryRow {
  branchId: string;
  branchName: string;
  activeStaffCount: number;
  inactiveStaffCount: number;
  salarySlipCount: number;
  salaryGrossPaise: number;
  salaryDeductionsPaise: number;
  salaryNetPaise: number;
  neftAmountPaise: number;
  neftStaffCount: number;
  dcrCashAmountPaise: number;
  dcrCashStaffCount: number;
  statutoryTotalPaise: number;
  pfPaise: number;
  esicPaise: number;
  ptPaise: number;
  lwfPaise: number;
  overtimePaise: number;
  lopDays: number;
  totalSalesPaise: number;
  totalIncentivePaise: number;
}

export function paiseToRupeesNumber(paise: number): number {
  return Math.round(paise) / 100;
}

export function escapeCsvCell(val: unknown): string {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCsvDocument(headers: string[], rows: Array<Array<string | number>>): string {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ];
  return '\uFEFF' + lines.join('\r\n');
}

function matchesBranch(branchId: string, selectedBranchId: string): boolean {
  return selectedBranchId === 'ALL' || branchId === selectedBranchId;
}

function buildEmployeeLookup(employees: Employee[]): Map<string, Employee> {
  const map = new Map<string, Employee>();
  for (const e of employees) {
    map.set(e.employeeId.trim().toUpperCase(), e);
  }
  return map;
}

export function getFilteredBranchSalarySlips(
  salarySlips: SalarySlip[],
  selectedMonth: string,
  selectedBranchId: string,
): SalarySlip[] {
  return salarySlips
    .filter(
      (s) =>
        (!selectedMonth || s.monthKey === selectedMonth) &&
        matchesBranch(s.branchId, selectedBranchId),
    )
    .sort(
      (a, b) =>
        a.branchName.localeCompare(b.branchName) ||
        a.employeeName.localeCompare(b.employeeName),
    );
}

/**
 * 1. Bank NEFT Transfer Dataset (NEFT / BANK / blank with bank details)
 */
export function buildBankNeftTransferDataset(params: {
  salarySlips: SalarySlip[];
  employees: Employee[];
  selectedMonth: string;
  selectedBranchId: string;
}): BankNeftDataset {
  const empById = buildEmployeeLookup(params.employees);
  const slips = getFilteredBranchSalarySlips(
    params.salarySlips,
    params.selectedMonth,
    params.selectedBranchId,
  );

  const neftSlips = slips.filter((s) => {
    const mode = (s.paymentMode || '').trim().toUpperCase();
    return s.netPayablePaise > 0 && (mode === 'NEFT' || mode === 'BANK' || mode === 'UPI');
  });

  let totalAmountPaise = 0;
  let readyCount = 0;
  let missingBankDetailsCount = 0;

  const rows: BankNeftTransferRow[] = neftSlips.map((s, idx) => {
    const emp = empById.get(s.employeeId.trim().toUpperCase());
    const bankName = (s.bankName || emp?.bankName || '').trim();
    const bankAccount = (s.bankAccountMasked || emp?.bankAccountMasked || '').trim();
    const bankIfsc = (s.bankIfsc || emp?.bankIfsc || '').trim().toUpperCase();
    const bankDetailsComplete = Boolean(bankAccount && bankIfsc);
    if (bankDetailsComplete) readyCount += 1;
    else missingBankDetailsCount += 1;
    totalAmountPaise += s.netPayablePaise;

    return {
      srNo: idx + 1,
      employeeId: s.employeeId,
      employeeName: s.employeeName,
      branchId: s.branchId,
      branchName: s.branchName,
      departmentName: s.departmentName || emp?.departmentName || '',
      bankName,
      bankAccount,
      bankIfsc,
      netPayablePaise: s.netPayablePaise,
      paymentMode: s.paymentMode || 'NEFT',
      narration: `SAL ${s.monthKey} ${s.employeeId}`,
      bankDetailsComplete,
    };
  });

  return {
    rows,
    totalAmountPaise,
    readyCount,
    missingBankDetailsCount,
  };
}

/**
 * 2. Cash / DCR / Cheque Disbursement Voucher Dataset
 */
export function buildDcrCashDisbursementDataset(params: {
  salarySlips: SalarySlip[];
  selectedMonth: string;
  selectedBranchId: string;
}): DcrCashDataset {
  const slips = getFilteredBranchSalarySlips(
    params.salarySlips,
    params.selectedMonth,
    params.selectedBranchId,
  );

  const cashSlips = slips.filter((s) => {
    const mode = (s.paymentMode || '').trim().toUpperCase();
    return (
      s.netPayablePaise > 0 &&
      (mode === 'DCR' || mode === 'CASH' || mode === 'CHEQUE' || mode === '')
    );
  });

  let totalAmountPaise = 0;
  let dcrCount = 0;
  let cashCount = 0;
  let otherCount = 0;

  const rows: DcrCashVoucherRow[] = cashSlips.map((s, idx) => {
    const mode = (s.paymentMode || '').trim().toUpperCase();
    if (mode === 'DCR') dcrCount += 1;
    else if (mode === 'CASH') cashCount += 1;
    else otherCount += 1;
    totalAmountPaise += s.netPayablePaise;

    return {
      srNo: idx + 1,
      employeeId: s.employeeId,
      employeeName: s.employeeName,
      branchId: s.branchId,
      branchName: s.branchName,
      departmentName: s.departmentName || '',
      designation: s.designation || 'Employee',
      paidDays: s.paidDays,
      totalDays: s.totalDays,
      netPayablePaise: s.netPayablePaise,
      paymentMode: mode || 'UNSPECIFIED',
      remarks: s.remarks || '',
    };
  });

  return {
    rows,
    totalAmountPaise,
    dcrCount,
    cashCount,
    otherCount,
  };
}

/**
 * 3. Monthly Statutory Compliance Dataset (PF, ESIC, PT, LWF, TDS)
 */
export function buildStatutoryComplianceDataset(params: {
  salarySlips: SalarySlip[];
  employees: Employee[];
  selectedMonth: string;
  selectedBranchId: string;
}): StatutoryComplianceDataset {
  const empById = buildEmployeeLookup(params.employees);
  const slips = getFilteredBranchSalarySlips(
    params.salarySlips,
    params.selectedMonth,
    params.selectedBranchId,
  );

  const totals = {
    grossEarningsPaise: 0,
    basicPaise: 0,
    pfPaise: 0,
    esicPaise: 0,
    ptPaise: 0,
    lwfPaise: 0,
    tdsPaise: 0,
    totalStatutoryPaise: 0,
    pfCoveredCount: 0,
    esicCoveredCount: 0,
    ptCoveredCount: 0,
  };

  const rows: StatutoryComplianceRow[] = slips.map((s, idx) => {
    const emp = empById.get(s.employeeId.trim().toUpperCase());
    const pfPaise = s.pfPaise || 0;
    const esicPaise = s.esicPaise || 0;
    const ptPaise = s.ptPaise || 0;
    const lwfPaise = s.lwfPaise || 0;
    const tdsPaise = s.tdsPaise || 0;
    const totalStatutoryPaise = pfPaise + esicPaise + ptPaise + lwfPaise + tdsPaise;

    totals.grossEarningsPaise += s.grossEarningsPaise || 0;
    totals.basicPaise += s.basicPaise || 0;
    totals.pfPaise += pfPaise;
    totals.esicPaise += esicPaise;
    totals.ptPaise += ptPaise;
    totals.lwfPaise += lwfPaise;
    totals.tdsPaise += tdsPaise;
    totals.totalStatutoryPaise += totalStatutoryPaise;
    if (pfPaise > 0) totals.pfCoveredCount += 1;
    if (esicPaise > 0) totals.esicCoveredCount += 1;
    if (ptPaise > 0) totals.ptCoveredCount += 1;

    return {
      srNo: idx + 1,
      employeeId: s.employeeId,
      employeeName: s.employeeName,
      branchId: s.branchId,
      branchName: s.branchName,
      uanNumber: (s.uanNumber || emp?.uanNumber || '').trim(),
      pfNumber: (s.pfNumber || emp?.pfNumber || '').trim(),
      esicNumber: (s.esicNumber || emp?.esicNumber || '').trim(),
      panNumber: (s.panNumber || emp?.panNumber || '').trim(),
      grossEarningsPaise: s.grossEarningsPaise || 0,
      basicPaise: s.basicPaise || 0,
      pfPaise,
      esicPaise,
      ptPaise,
      lwfPaise,
      tdsPaise,
      totalStatutoryPaise,
    };
  });

  return { rows, totals };
}

/**
 * 4. Branch Sales & Incentive Dataset
 */
export function buildBranchIncentiveDataset(params: {
  monthlySummaries: MonthlySummary[];
  employees: Employee[];
  payoutRecords: PayoutRecord[];
  adjustments: IncentiveAdjustment[];
  selectedMonth: string;
  selectedBranchId: string;
}): BranchIncentiveDataset {
  const empById = buildEmployeeLookup(params.employees);
  const payoutByEmp = new Map<string, PayoutRecord>();
  for (const p of params.payoutRecords) {
    if (p.monthKey === params.selectedMonth) {
      payoutByEmp.set(p.employeeId.trim().toUpperCase(), p);
    }
  }
  const adjByEmp = new Map<string, number>();
  for (const a of params.adjustments) {
    if (a.monthKey !== params.selectedMonth || a.status !== 'ACTIVE') continue;
    const key = a.employeeId.trim().toUpperCase();
    const signed = a.type === 'BONUS' ? a.amountPaise : -a.amountPaise;
    adjByEmp.set(key, (adjByEmp.get(key) || 0) + signed);
  }

  const filtered = params.monthlySummaries
    .filter(
      (s) =>
        s.sourceType !== 'NO_DATA' &&
        s.monthKey === params.selectedMonth &&
        matchesBranch(s.branchId, params.selectedBranchId),
    )
    .sort(
      (a, b) =>
        a.branchName.localeCompare(b.branchName) ||
        b.grandTotalPaise - a.grandTotalPaise,
    );

  const totals = {
    totalSaleAmtPaise: 0,
    totalSaleQty: 0,
    grossIncentivePaise: 0,
    adjustmentsNetPaise: 0,
    netPayablePaise: 0,
    paidCount: 0,
  };

  const rows: BranchIncentiveRow[] = filtered.map((s, idx) => {
    const key = s.employeeId.trim().toUpperCase();
    const emp = empById.get(key);
    const payout = payoutByEmp.get(key);
    const adjNet = adjByEmp.get(key) || 0;
    const totalSaleAmtPaise =
      s.totalSaleAmtPaise ??
      (s.saleAmt1TotalPaise || 0) + (s.saleAmt2TotalPaise || 0) + (s.saleAmt3TotalPaise || 0);
    const totalSaleQty =
      s.totalSaleQty ??
      Math.round(((s.saleQty1Total || 0) + (s.saleQty2Total || 0) + (s.saleQty3Total || 0)) * 100) /
        100;
    const netPayablePaise = s.grandTotalPaise + adjNet;

    totals.totalSaleAmtPaise += totalSaleAmtPaise;
    totals.totalSaleQty = Math.round((totals.totalSaleQty + totalSaleQty) * 100) / 100;
    totals.grossIncentivePaise += s.grandTotalPaise;
    totals.adjustmentsNetPaise += adjNet;
    totals.netPayablePaise += netPayablePaise;
    if (payout?.status === 'PAID') totals.paidCount += 1;

    return {
      srNo: idx + 1,
      employeeId: s.employeeId,
      saleId: emp?.saleId || '',
      employeeName: s.employeeName,
      branchId: s.branchId,
      branchName: s.branchName,
      departmentName: emp?.departmentName || '',
      saleAmt1Paise: s.saleAmt1TotalPaise || 0,
      saleQty1: s.saleQty1Total || 0,
      inc1Paise: s.component1TotalPaise,
      saleAmt2Paise: s.saleAmt2TotalPaise || 0,
      saleQty2: s.saleQty2Total || 0,
      inc2Paise: s.component2TotalPaise,
      saleAmt3Paise: s.saleAmt3TotalPaise || 0,
      saleQty3: s.saleQty3Total || 0,
      inc3Paise: s.component3TotalPaise,
      totalSaleAmtPaise,
      totalSaleQty,
      grossIncentivePaise: s.grandTotalPaise,
      adjustmentsNetPaise: adjNet,
      netPayablePaise,
      payoutStatus: payout?.status || 'UNPAID',
      paymentMode: payout?.paymentMode || '',
      paymentReference: payout?.paymentReference || '',
    };
  });

  return { rows, totals };
}

/**
 * 5. 12-Branch Side-by-Side Executive Summary (all branches or filtered branch)
 */
export function buildBranchExecutiveSummaryRows(
  input: BranchFilterInput,
): BranchExecutiveSummaryRow[] {
  const map = new Map<string, BranchExecutiveSummaryRow>();

  const ensure = (branchId: string, branchName: string): BranchExecutiveSummaryRow => {
    let row = map.get(branchId);
    if (!row) {
      row = {
        branchId,
        branchName,
        activeStaffCount: 0,
        inactiveStaffCount: 0,
        salarySlipCount: 0,
        salaryGrossPaise: 0,
        salaryDeductionsPaise: 0,
        salaryNetPaise: 0,
        neftAmountPaise: 0,
        neftStaffCount: 0,
        dcrCashAmountPaise: 0,
        dcrCashStaffCount: 0,
        statutoryTotalPaise: 0,
        pfPaise: 0,
        esicPaise: 0,
        ptPaise: 0,
        lwfPaise: 0,
        overtimePaise: 0,
        lopDays: 0,
        totalSalesPaise: 0,
        totalIncentivePaise: 0,
      };
      map.set(branchId, row);
    }
    return row;
  };

  for (const b of input.branches) {
    if (!matchesBranch(b.branchId, input.selectedBranchId)) continue;
    ensure(b.branchId, b.branchName);
  }

  for (const e of input.employees) {
    if (!matchesBranch(e.branchId, input.selectedBranchId)) continue;
    const row = ensure(e.branchId, e.branchName);
    if (e.status === 'ACTIVE') row.activeStaffCount += 1;
    else row.inactiveStaffCount += 1;
  }

  for (const s of input.salarySlips) {
    if (input.selectedMonth && s.monthKey !== input.selectedMonth) continue;
    if (!matchesBranch(s.branchId, input.selectedBranchId)) continue;
    const row = ensure(s.branchId, s.branchName);
    row.salarySlipCount += 1;
    row.salaryGrossPaise += s.grossEarningsPaise || 0;
    row.salaryDeductionsPaise += s.totalDeductionsPaise || 0;
    row.salaryNetPaise += s.netPayablePaise || 0;
    const mode = (s.paymentMode || '').trim().toUpperCase();
    if (s.netPayablePaise > 0) {
      if (mode === 'NEFT' || mode === 'BANK' || mode === 'UPI') {
        row.neftAmountPaise += s.netPayablePaise;
        row.neftStaffCount += 1;
      } else {
        row.dcrCashAmountPaise += s.netPayablePaise;
        row.dcrCashStaffCount += 1;
      }
    }
    const pf = s.pfPaise || 0;
    const esic = s.esicPaise || 0;
    const pt = s.ptPaise || 0;
    const lwf = s.lwfPaise || 0;
    row.pfPaise += pf;
    row.esicPaise += esic;
    row.ptPaise += pt;
    row.lwfPaise += lwf;
    row.statutoryTotalPaise += pf + esic + pt + lwf + (s.tdsPaise || 0);
    row.overtimePaise += s.overtimePaise || 0;
    row.lopDays = Math.round((row.lopDays + (s.lopDays || 0)) * 100) / 100;
  }

  for (const m of input.monthlySummaries) {
    if (m.sourceType === 'NO_DATA') continue;
    if (input.selectedMonth && m.monthKey !== input.selectedMonth) continue;
    if (!matchesBranch(m.branchId, input.selectedBranchId)) continue;
    const row = ensure(m.branchId, m.branchName);
    row.totalSalesPaise +=
      m.totalSaleAmtPaise ??
      (m.saleAmt1TotalPaise || 0) + (m.saleAmt2TotalPaise || 0) + (m.saleAmt3TotalPaise || 0);
    row.totalIncentivePaise += m.grandTotalPaise || 0;
  }

  return Array.from(map.values()).sort(
    (a, b) =>
      b.salaryNetPaise - a.salaryNetPaise ||
      b.totalSalesPaise - a.totalSalesPaise ||
      a.branchName.localeCompare(b.branchName),
  );
}

/**
 * 6. Branch-Filtered Attendance, Overtime & Attrition wrapper
 */
export function buildBranchAttendanceOtAttrition(params: {
  branches: Branch[];
  employees: Employee[];
  salarySlips: SalarySlip[];
  selectedMonth: string;
  selectedBranchId: string;
}) {
  const filteredBranches =
    params.selectedBranchId === 'ALL'
      ? params.branches
      : params.branches.filter((b) => b.branchId === params.selectedBranchId);
  const filteredEmployees =
    params.selectedBranchId === 'ALL'
      ? params.employees
      : params.employees.filter((e) => e.branchId === params.selectedBranchId);
  const filteredSlips = getFilteredBranchSalarySlips(
    params.salarySlips,
    params.selectedMonth,
    params.selectedBranchId,
  );
  return computeAttendanceOtAttritionAnalytics({
    branches: filteredBranches,
    employees: filteredEmployees,
    salarySlips: filteredSlips,
    selectedMonth: params.selectedMonth,
  });
}
