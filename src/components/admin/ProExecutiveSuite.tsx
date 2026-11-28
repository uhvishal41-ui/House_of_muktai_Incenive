import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock,
  Download,
  Flame,
  IndianRupee,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
  TrendingDown,
  TrendingUp,
  Unlock,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formatINRFromPaise,
  formatMonthLabel,
  getCurrentMonthKeyIST,
} from '../../lib/format';
import {
  computeAttendanceOtAttritionAnalytics,
  computeBranchPnlAnalytics,
  computePerformanceStreaksAndRetention,
} from '../../lib/proAnalyticsEngine';
import { downloadAttendanceOtAttritionXlsx } from '../../services/branchReportsExportService';
import {
  createEmployeeLoan,
  deleteEmployeeLoan,
  isMonthPayrollLockedLocal,
  recordLoanEmiDeduction,
  toggleMonthPayrollLock,
  updateEmployeeLoanStatus,
} from '../../services/proFeaturesService';
import type {
  Branch,
  Employee,
  EmployeeLoan,
  LoanType,
  MonthlySummary,
  PayrollLockSettings,
  SalarySlip,
  SalesTarget,
} from '../../types/incentive';

interface Props {
  branches: Branch[];
  employees: Employee[];
  monthlySummaries: MonthlySummary[];
  salarySlips: SalarySlip[];
  salesTargets: SalesTarget[];
  employeeLoans: EmployeeLoan[];
  payrollLockSettings?: PayrollLockSettings;
  isMainOwner?: boolean;
  onRefresh: () => Promise<void>;
}

type ProSubTab = 'pnl' | 'loans' | 'streaks' | 'attendance';

const LOAN_TYPE_LABELS: Record<LoanType, string> = {
  SALARY_ADVANCE: 'Salary Advance',
  PERSONAL_LOAN: 'Staff Loan',
  FESTIVAL_ADVANCE: 'Festival Advance',
};

export function ProExecutiveSuite({
  branches,
  employees,
  monthlySummaries,
  salarySlips,
  salesTargets,
  employeeLoans,
  payrollLockSettings,
  isMainOwner = false,
  onRefresh,
}: Props) {
  const [subTab, setSubTab] = useState<ProSubTab>('pnl');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getCurrentMonthKeyIST());
  const [branchFilter, setBranchFilter] = useState<string>('ALL');
  const [loanStatusFilter, setLoanStatusFilter] = useState<'ALL' | 'ACTIVE' | 'CLOSED'>('ACTIVE');
  const [lockNoteInput, setLockNoteInput] = useState('');
  const [togglingLock, setTogglingLock] = useState(false);
  const [exportingOt, setExportingOt] = useState(false);

  // Create Loan modal state
  const [showCreateLoan, setShowCreateLoan] = useState(false);
  const [loanEmployeeId, setLoanEmployeeId] = useState('');
  const [loanType, setLoanType] = useState<LoanType>('SALARY_ADVANCE');
  const [principalRupees, setPrincipalRupees] = useState('');
  const [totalInstallments, setTotalInstallments] = useState('3');
  const [startMonthKey, setStartMonthKey] = useState<string>(() => getCurrentMonthKeyIST());
  const [loanRemarks, setLoanRemarks] = useState('');
  const [busyLoanId, setBusyLoanId] = useState<string | null>(null);
  const [savingLoan, setSavingLoan] = useState(false);
  const [emiMonthKey, setEmiMonthKey] = useState<string>(() => getCurrentMonthKeyIST());
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const availableMonths = useMemo(() => {
    const set = new Set<string>([getCurrentMonthKeyIST()]);
    for (const s of monthlySummaries) set.add(s.monthKey);
    for (const sl of salarySlips) set.add(sl.monthKey);
    return Array.from(set)
      .filter((m) => /^\d{4}-\d{2}$/.test(m))
      .sort()
      .reverse();
  }, [monthlySummaries, salarySlips]);

  const effectiveMonth = availableMonths.includes(selectedMonth)
    ? selectedMonth
    : availableMonths[0] || getCurrentMonthKeyIST();

  // Feature #5: Branch P&L Analytics
  const pnl = useMemo(
    () =>
      computeBranchPnlAnalytics({
        branches,
        employees,
        monthlySummaries,
        salarySlips,
        selectedMonth: effectiveMonth,
      }),
    [branches, employees, monthlySummaries, salarySlips, effectiveMonth],
  );

  // Pro #5: Overtime, Attendance (LOP) & Attrition Analytics
  const attendanceAnalytics = useMemo(() => {
    const filteredBranches =
      branchFilter === 'ALL'
        ? branches
        : branches.filter((b) => b.branchId === branchFilter);
    const filteredEmployees =
      branchFilter === 'ALL'
        ? employees
        : employees.filter((e) => e.branchId === branchFilter);
    const filteredSlips =
      branchFilter === 'ALL'
        ? salarySlips
        : salarySlips.filter((s) => s.branchId === branchFilter);
    return computeAttendanceOtAttritionAnalytics({
      branches: filteredBranches,
      employees: filteredEmployees,
      salarySlips: filteredSlips,
      selectedMonth: effectiveMonth,
    });
  }, [branches, employees, salarySlips, effectiveMonth, branchFilter]);

  const effectiveMonthLocked = isMonthPayrollLockedLocal(effectiveMonth, payrollLockSettings);

  const handleToggleMonthLock = async (lock: boolean) => {
    setTogglingLock(true);
    setFeedback(null);
    try {
      await toggleMonthPayrollLock({
        monthKey: effectiveMonth,
        lock,
        note: lockNoteInput.trim() || undefined,
        currentSettings: payrollLockSettings,
      });
      setLockNoteInput('');
      setFeedback({
        type: 'ok',
        text: lock
          ? `Locked (frozen) payroll & incentives for ${formatMonthLabel(effectiveMonth)}. Edits & deletes are now protected by Firestore rules.`
          : `Unlocked payroll & incentives for ${formatMonthLabel(effectiveMonth)}.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to update payroll lock status.',
      });
    } finally {
      setTogglingLock(false);
    }
  };

  const handleExportAttendanceExcel = async () => {
    setExportingOt(true);
    setFeedback(null);
    try {
      await downloadAttendanceOtAttritionXlsx({
        branches,
        employees,
        salarySlips,
        monthlySummaries,
        payoutRecords: [],
        adjustments: [],
        selectedMonth: effectiveMonth,
        selectedBranchId: branchFilter,
      });
      setFeedback({
        type: 'ok',
        text: `Downloaded Overtime, LOP & Attrition report for ${formatMonthLabel(effectiveMonth)}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to export OT/LOP/Attrition Excel.',
      });
    } finally {
      setExportingOt(false);
    }
  };

  const branchChartData = useMemo(
    () =>
      pnl.rows
        .filter((r) => r.totalSalesPaise > 0 || r.totalPayrollCostPaise > 0)
        .map((r) => ({
          branch: r.branchName.length > 14 ? `${r.branchName.slice(0, 12)}…` : r.branchName,
          fullBranch: r.branchName,
          salesLakhs: Number((r.totalSalesPaise / 10_000_000).toFixed(2)),
          payrollCostLakhs: Number((r.totalPayrollCostPaise / 10_000_000).toFixed(2)),
          costToSalesPct: r.costToSalesPct,
        })),
    [pnl.rows],
  );

  // Feature #7: Streaks & Early Coaching Alerts
  const streaks = useMemo(
    () =>
      computePerformanceStreaksAndRetention({
        employees,
        monthlySummaries,
        salesTargets,
      }),
    [employees, monthlySummaries, salesTargets],
  );

  const filteredStars = useMemo(
    () =>
      branchFilter === 'ALL'
        ? streaks.starPerformers
        : streaks.starPerformers.filter((s) => s.branchId === branchFilter),
    [streaks.starPerformers, branchFilter],
  );

  const filteredRising = useMemo(
    () =>
      branchFilter === 'ALL'
        ? streaks.risingStreaks
        : streaks.risingStreaks.filter((s) => s.branchId === branchFilter),
    [streaks.risingStreaks, branchFilter],
  );

  const filteredCoaching = useMemo(
    () =>
      branchFilter === 'ALL'
        ? streaks.coachingAlerts
        : streaks.coachingAlerts.filter((s) => s.branchId === branchFilter),
    [streaks.coachingAlerts, branchFilter],
  );

  // Feature #6: Loans
  const activeEmployees = useMemo(
    () =>
      employees
        .filter((e) => e.status === 'ACTIVE')
        .sort((a, b) => a.branchName.localeCompare(b.branchName) || a.fullName.localeCompare(b.fullName)),
    [employees],
  );

  const filteredLoans = useMemo(() => {
    return employeeLoans.filter((l) => {
      if (branchFilter !== 'ALL' && l.branchId !== branchFilter) return false;
      if (loanStatusFilter === 'ACTIVE' && l.status !== 'ACTIVE') return false;
      if (loanStatusFilter === 'CLOSED' && l.status === 'ACTIVE') return false;
      return true;
    });
  }, [employeeLoans, branchFilter, loanStatusFilter]);

  const loanStats = useMemo(() => {
    const active = employeeLoans.filter((l) => l.status === 'ACTIVE');
    return {
      activeCount: active.length,
      outstandingPaise: active.reduce((s, l) => s + l.remainingBalancePaise, 0),
      monthlyEmiTotalPaise: active.reduce(
        (s, l) => s + Math.min(l.monthlyEmiPaise, l.remainingBalancePaise),
        0,
      ),
      closedCount: employeeLoans.filter((l) => l.status === 'CLOSED').length,
    };
  }, [employeeLoans]);

  const previewEmiRupees = useMemo(() => {
    const p = Number(principalRupees);
    const n = Math.max(1, Number(totalInstallments) || 1);
    if (!Number.isFinite(p) || p <= 0) return 0;
    return Math.ceil((p * 100) / n) / 100;
  }, [principalRupees, totalInstallments]);

  const handleCreateLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    const emp = activeEmployees.find((em) => em.employeeId === loanEmployeeId);
    if (!emp) {
      setFeedback({ type: 'err', text: 'Select an active employee first.' });
      return;
    }
    const principal = Number(principalRupees);
    const installments = Number(totalInstallments);
    if (!Number.isFinite(principal) || principal <= 0) {
      setFeedback({ type: 'err', text: 'Enter a valid loan/advance amount greater than ₹0.' });
      return;
    }
    setSavingLoan(true);
    setFeedback(null);
    try {
      await createEmployeeLoan({
        employee: emp,
        loanType,
        principalRupees: principal,
        totalInstallments: installments,
        startMonthKey,
        remarks: loanRemarks,
      });
      setShowCreateLoan(false);
      setLoanEmployeeId('');
      setPrincipalRupees('');
      setTotalInstallments('3');
      setLoanRemarks('');
      setFeedback({
        type: 'ok',
        text: `Recorded ${LOAN_TYPE_LABELS[loanType]} of ₹${principal.toLocaleString('en-IN')} for ${emp.fullName}. It will auto-fill in Salary Slip EMI sync from ${formatMonthLabel(startMonthKey)}.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save employee loan.',
      });
    } finally {
      setSavingLoan(false);
    }
  };

  const handleRecordEmi = async (loan: EmployeeLoan) => {
    setBusyLoanId(loan.loanId);
    setFeedback(null);
    try {
      const updated = await recordLoanEmiDeduction({
        loan,
        monthKey: emiMonthKey,
      });
      setFeedback({
        type: 'ok',
        text:
          updated.status === 'CLOSED'
            ? `Final EMI recorded for ${loan.employeeName} (${formatMonthLabel(emiMonthKey)}). Loan is now CLOSED!`
            : `EMI deducted for ${loan.employeeName} (${formatMonthLabel(emiMonthKey)}). Remaining balance: ${formatINRFromPaise(updated.remainingBalancePaise)}.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to record EMI deduction.',
      });
    } finally {
      setBusyLoanId(null);
    }
  };

  const handleCloseLoan = async (loan: EmployeeLoan) => {
    setBusyLoanId(loan.loanId);
    setFeedback(null);
    try {
      await updateEmployeeLoanStatus(loan, 'CLOSED', 'Settled / Closed by Admin');
      setFeedback({ type: 'ok', text: `Marked ${loan.employeeName}'s advance/loan as CLOSED.` });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to close loan.',
      });
    } finally {
      setBusyLoanId(null);
    }
  };

  const handleDeleteLoan = async (loan: EmployeeLoan) => {
    setBusyLoanId(loan.loanId);
    setFeedback(null);
    try {
      await deleteEmployeeLoan(loan);
      setFeedback({ type: 'ok', text: `Deleted loan record ${loan.loanId}.` });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to delete loan.',
      });
    } finally {
      setBusyLoanId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Sub-Navigation */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-[#0F1F3D]">
              Executive Pro Suite — P&amp;L, Advances &amp; Retention
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Branch Payroll Cost-to-Sales ratio, Employee Loan EMI auto-recovery &amp; multi-month performance streaks.
            </p>
          </div>
          <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200/80 self-start">
            <button
              type="button"
              onClick={() => setSubTab('pnl')}
              className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                subTab === 'pnl'
                  ? 'bg-[#0F1F3D] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Branch P&amp;L Ratio
            </button>
            <button
              type="button"
              onClick={() => setSubTab('loans')}
              className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                subTab === 'loans'
                  ? 'bg-[#0F1F3D] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              Advances &amp; Loans ({loanStats.activeCount})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('streaks')}
              className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                subTab === 'streaks'
                  ? 'bg-[#0F1F3D] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              Streaks &amp; Alerts ({streaks.coachingAlerts.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('attendance')}
              className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                subTab === 'attendance'
                  ? 'bg-[#0F1F3D] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              OT, LOP &amp; Attrition
            </button>
          </div>
        </div>
      </div>

      {/* Pro #4: Month Payroll Lock / Freeze Control Card (Main Owner Governance) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              effectiveMonthLocked
                ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-100 text-[#0F1F3D]'
            }`}
          >
            {effectiveMonthLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs font-bold text-[#0F1F3D]">
                Month Payroll Lock / Freeze (Maker–Checker)
              </h3>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                  effectiveMonthLocked
                    ? 'bg-amber-100 text-amber-900'
                    : 'bg-emerald-50 text-emerald-800'
                }`}
              >
                {formatMonthLabel(effectiveMonth)}: {effectiveMonthLocked ? 'LOCKED' : 'OPEN'}
              </span>
              {(payrollLockSettings?.lockedMonths.length || 0) > 0 && (
                <span className="text-[11px] text-slate-500">
                  Locked months: {payrollLockSettings!.lockedMonths.join(', ')}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {isMainOwner
                ? 'Locking a finalized month freezes Salary Slips and Incentives in Firestore so nobody can accidentally overwrite or delete audited payroll.'
                : 'Only the Main Owner can lock or unlock finalized payroll months.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={effectiveMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            aria-label="Select Month for Payroll Lock"
            className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-[#0F1F3D]"
          >
            {availableMonths.map((mk) => (
              <option key={mk} value={mk}>
                {formatMonthLabel(mk)} ({mk})
              </option>
            ))}
          </select>
          {isMainOwner && (
            <>
              <input
                type="text"
                value={lockNoteInput}
                onChange={(e) => setLockNoteInput(e.target.value)}
                placeholder="Optional audit note..."
                className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 w-44"
              />
              <button
                type="button"
                disabled={togglingLock}
                onClick={() => void handleToggleMonthLock(!effectiveMonthLocked)}
                className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50 ${
                  effectiveMonthLocked
                    ? 'border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-950'
                    : 'bg-[#0F1F3D] hover:bg-[#162B50] text-white'
                }`}
              >
                {effectiveMonthLocked ? (
                  <>
                    <Unlock className="w-3.5 h-3.5" />
                    <span>{togglingLock ? 'Updating...' : 'Unlock Month'}</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-3.5 h-3.5 text-[#DFC27D]" />
                    <span>{togglingLock ? 'Locking...' : 'Lock Month'}</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs sm:text-sm flex items-start justify-between gap-3 ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-current opacity-60 hover:opacity-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 1: EXECUTIVE BRANCH P&L (PAYROLL COST VS SALES RATIO)     */}
      {/* ================================================================= */}
      {subTab === 'pnl' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Building2 className="w-4 h-4 text-[#B8923A]" />
              <span className="font-semibold text-[#0F1F3D]">Accounting Month:</span>
              <select
                value={effectiveMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800"
              >
                {availableMonths.map((mk) => (
                  <option key={mk} value={mk}>
                    {formatMonthLabel(mk)} ({mk})
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-slate-500">
              Payroll Cost = Base Salary (excl. duplicate Incentive / Sales Commission) + Published Incentive
            </p>
          </div>

          {/* KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Total Branch Sales
              </p>
              <p className="text-xl font-bold font-mono tabular-nums text-[#0F1F3D] mt-1">
                {formatINRFromPaise(pnl.companyTotals.totalSalesPaise)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {pnl.companyTotals.activeStaffCount} active staff ·{' '}
                {formatINRFromPaise(pnl.companyTotals.salesPerStaffPaise)}/staff
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Total Payroll Cost
              </p>
              <p className="text-xl font-bold font-mono tabular-nums text-[#0F1F3D] mt-1">
                {formatINRFromPaise(pnl.companyTotals.totalPayrollCostPaise)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Incentives: {formatINRFromPaise(pnl.companyTotals.totalIncentivePaise)}
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Payroll Cost-to-Sales %
              </p>
              <p
                className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                  pnl.companyTotals.costToSalesPct > 12
                    ? 'text-amber-700'
                    : 'text-emerald-700'
                }`}
              >
                {pnl.companyTotals.costToSalesPct.toFixed(2)}%
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Target benchmark: &lt; 10–12% retail payroll ratio
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Incentive-to-Sales %
              </p>
              <p className="text-xl font-bold font-mono tabular-nums text-[#9A7625] mt-1">
                {pnl.companyTotals.incentiveToSalesPct.toFixed(2)}%
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Variable incentive spend ratio
              </p>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-[#0F1F3D] mb-1">
                Branch Sales vs. Total Payroll Cost (₹ Lakhs)
              </h3>
              <p className="text-[11px] text-slate-500 mb-3">
                Compare store revenue output against total salary + incentive investment for {formatMonthLabel(effectiveMonth)}.
              </p>
              {branchChartData.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-xs text-slate-400">
                  No sales or salary slip data available for {formatMonthLabel(effectiveMonth)}.
                </div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={branchChartData} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="branch" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(val: unknown, name: unknown) => [
                          `₹${Number(val || 0).toFixed(2)} L`,
                          String(name || ''),
                        ]}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="salesLakhs" name="Sales (₹L)" fill="#0F1F3D" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="payrollCostLakhs" name="Payroll Cost (₹L)" fill="#B8923A" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-[#0F1F3D] mb-1">
                6-Month Company Cost-to-Sales Trend (%)
              </h3>
              <p className="text-[11px] text-slate-500 mb-3">
                Tracks monthly payroll cost efficiency across all 12 branches.
              </p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pnl.monthlyTrend} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="monthLabel" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip
                      formatter={(val: unknown) => [`${Number(val || 0).toFixed(2)}%`, 'Cost-to-Sales']}
                    />
                    <Bar dataKey="costToSalesPct" name="Cost-to-Sales %" fill="#1E3A5F" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* 12-Branch P&L Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#0F1F3D]">
                12-Branch Payroll Efficiency Register ({formatMonthLabel(effectiveMonth)})
              </h3>
              <span className="text-[11px] text-slate-500">{pnl.rows.length} branches</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3 text-left font-semibold">Branch</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Active Staff</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Total Sales</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Salary Gross</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Incentive</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Total Cost</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Cost / Sales %</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Sales / Staff</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pnl.rows.map((r) => (
                    <tr key={r.branchId} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3 font-semibold text-[#0F1F3D]">{r.branchName}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                        {r.activeStaffCount}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium text-slate-900">
                        {formatINRFromPaise(r.totalSalesPaise)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                        {formatINRFromPaise(r.totalSalaryGrossPaise)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#9A7625] font-medium">
                        {formatINRFromPaise(r.totalIncentivePaise)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {formatINRFromPaise(r.totalPayrollCostPaise)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        <span
                          className={`inline-block px-2 py-0.5 rounded font-semibold ${
                            r.costToSalesPct === 0
                              ? 'bg-slate-100 text-slate-500'
                              : r.costToSalesPct <= 10
                                ? 'bg-emerald-50 text-emerald-700'
                                : r.costToSalesPct <= 15
                                  ? 'bg-amber-50 text-amber-800'
                                  : 'bg-red-50 text-red-700'
                          }`}
                        >
                          {r.costToSalesPct.toFixed(2)}%
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                        {formatINRFromPaise(r.salesPerStaffPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 2: EMPLOYEE ADVANCES / LOANS & EMI AUTO-DEDUCTION TRACKER */}
      {/* ================================================================= */}
      {subTab === 'loans' && (
        <div className="space-y-5">
          {/* Loan KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Active Advances / Loans
              </p>
              <p className="text-xl font-bold font-mono tabular-nums text-[#0F1F3D] mt-1">
                {loanStats.activeCount}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Total Outstanding Balance
              </p>
              <p className="text-xl font-bold font-mono tabular-nums text-amber-700 mt-1">
                {formatINRFromPaise(loanStats.outstandingPaise)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Monthly EMI Recovery Pool
              </p>
              <p className="text-xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                {formatINRFromPaise(loanStats.monthlyEmiTotalPaise)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Closed / Settled Loans
              </p>
              <p className="text-xl font-bold font-mono tabular-nums text-slate-700 mt-1">
                {loanStats.closedCount}
              </p>
            </div>
          </div>

          {/* Toolbar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800"
              >
                <option value="ALL">All 12 Branches</option>
                {branches.map((b) => (
                  <option key={b.branchId} value={b.branchId}>
                    {b.branchName}
                  </option>
                ))}
              </select>

              <select
                value={loanStatusFilter}
                onChange={(e) => setLoanStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'CLOSED')}
                className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800"
              >
                <option value="ACTIVE">Active Loans Only</option>
                <option value="CLOSED">Closed / Cancelled</option>
                <option value="ALL">All Statuses</option>
              </select>

              <div className="flex items-center gap-1.5 text-xs text-slate-600 pl-1">
                <span>EMI Month:</span>
                <input
                  type="month"
                  value={emiMonthKey}
                  onChange={(e) => setEmiMonthKey(e.target.value)}
                  className="h-8 px-2 rounded-lg border border-slate-300 bg-white text-xs"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowCreateLoan(true)}
              className="h-8 px-3.5 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-[#DFC27D]" />
              New Advance / Loan
            </button>
          </div>

          {/* Loans Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3 text-left font-semibold">Employee &amp; Branch</th>
                    <th className="py-2.5 px-3 text-left font-semibold">Type &amp; Start</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Principal</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Monthly EMI</th>
                    <th className="py-2.5 px-3 text-left font-semibold">EMI Progress</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Remaining</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLoans.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-400">
                        No employee advances or loans match the current filter. Click &ldquo;New Advance / Loan&rdquo; to track one.
                      </td>
                    </tr>
                  ) : (
                    filteredLoans.map((loan) => {
                      const pct =
                        loan.principalPaise > 0
                          ? Math.min(
                              100,
                              Math.round(
                                ((loan.principalPaise - loan.remainingBalancePaise) /
                                  loan.principalPaise) *
                                  100,
                              ),
                            )
                          : 100;
                      const alreadyDeductedThisMonth = loan.lastDeductedMonthKey === emiMonthKey;
                      return (
                        <tr key={loan.loanId} className="hover:bg-slate-50/70">
                          <td className="py-3 px-3">
                            <p className="font-semibold text-[#0F1F3D]">{loan.employeeName}</p>
                            <p className="text-[11px] text-slate-500">
                              {loan.employeeId} · {loan.branchName}
                            </p>
                          </td>
                          <td className="py-3 px-3">
                            <span className="font-medium text-slate-800">
                              {LOAN_TYPE_LABELS[loan.loanType]}
                            </span>
                            <p className="text-[11px] text-slate-500">
                              From {formatMonthLabel(loan.startMonthKey)}
                              {loan.lastDeductedMonthKey
                                ? ` · Last EMI: ${loan.lastDeductedMonthKey}`
                                : ''}
                            </p>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">
                            {formatINRFromPaise(loan.principalPaise)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-[#0F1F3D]">
                            {formatINRFromPaise(loan.monthlyEmiPaise)}
                          </td>
                          <td className="py-3 px-3 min-w-[140px]">
                            <div className="flex items-center justify-between text-[11px] mb-1">
                              <span className="font-medium text-slate-700">
                                {loan.paidInstallments} / {loan.totalInstallments} EMIs
                              </span>
                              <span className="font-mono text-slate-500">{pct}%</span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  loan.status === 'CLOSED' ? 'bg-emerald-500' : 'bg-[#B8923A]'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-amber-800">
                            {formatINRFromPaise(loan.remainingBalancePaise)}
                          </td>
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            {loan.status === 'ACTIVE' ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={busyLoanId === loan.loanId || alreadyDeductedThisMonth}
                                  onClick={() => handleRecordEmi(loan)}
                                  className="h-7 px-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-semibold disabled:opacity-50 cursor-pointer"
                                  title={
                                    alreadyDeductedThisMonth
                                      ? `EMI already recorded for ${emiMonthKey}`
                                      : `Record EMI deduction for ${emiMonthKey}`
                                  }
                                >
                                  {busyLoanId === loan.loanId
                                    ? 'Saving...'
                                    : alreadyDeductedThisMonth
                                      ? `Paid (${emiMonthKey})`
                                      : `Deduct EMI`}
                                </button>
                                <button
                                  type="button"
                                  disabled={busyLoanId === loan.loanId}
                                  onClick={() => handleCloseLoan(loan)}
                                  className="h-7 px-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium cursor-pointer"
                                >
                                  Settle
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-2">
                                <span className="text-[11px] font-semibold text-emerald-700">
                                  {loan.status}
                                </span>
                                <button
                                  type="button"
                                  disabled={busyLoanId === loan.loanId}
                                  onClick={() => handleDeleteLoan(loan)}
                                  className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                                  title="Delete closed loan record"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Create Loan Modal */}
          {showCreateLoan && (
            <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#0F1F3D] flex items-center gap-2">
                    <IndianRupee className="w-4 h-4 text-[#B8923A]" />
                    New Employee Advance / Loan
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowCreateLoan(false)}
                    className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <form onSubmit={handleCreateLoan} className="p-5 space-y-4 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Employee *</label>
                    <select
                      required
                      value={loanEmployeeId}
                      onChange={(e) => setLoanEmployeeId(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white"
                    >
                      <option value="">-- Select Active Employee --</option>
                      {activeEmployees.map((emp) => (
                        <option key={emp.employeeId} value={emp.employeeId}>
                          {emp.employeeId} · {emp.fullName} ({emp.branchName})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Loan Type *</label>
                      <select
                        value={loanType}
                        onChange={(e) => setLoanType(e.target.value as LoanType)}
                        className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white"
                      >
                        <option value="SALARY_ADVANCE">Salary Advance</option>
                        <option value="PERSONAL_LOAN">Staff Loan</option>
                        <option value="FESTIVAL_ADVANCE">Festival Advance</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        EMI Recovery Start Month *
                      </label>
                      <input
                        type="month"
                        required
                        value={startMonthKey}
                        onChange={(e) => setStartMonthKey(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Total Amount (₹) *
                      </label>
                      <input
                        type="number"
                        required
                        min={1}
                        step="1"
                        placeholder="e.g. 15000"
                        value={principalRupees}
                        onChange={(e) => setPrincipalRupees(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        No. of Monthly EMIs *
                      </label>
                      <input
                        type="number"
                        required
                        min={1}
                        max={60}
                        value={totalInstallments}
                        onChange={(e) => setTotalInstallments(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white font-mono"
                      />
                    </div>
                  </div>

                  {previewEmiRupees > 0 && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 flex items-center justify-between">
                      <span>Calculated Monthly EMI Auto-Deduction:</span>
                      <strong className="font-mono text-sm">
                        ₹{previewEmiRupees.toLocaleString('en-IN', { minimumFractionDigits: 2 })} / month
                      </strong>
                    </div>
                  )}

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Remarks (Optional)
                    </label>
                    <input
                      type="text"
                      maxLength={240}
                      placeholder="e.g. Medical advance approved by Owner"
                      value={loanRemarks}
                      onChange={(e) => setLoanRemarks(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setShowCreateLoan(false)}
                      className="h-9 px-4 rounded-lg border border-slate-300 bg-white text-slate-700 font-medium cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingLoan}
                      className="h-9 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white font-semibold disabled:opacity-60 cursor-pointer"
                    >
                      {savingLoan ? 'Saving...' : 'Create Loan Tracker'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 3: PERFORMANCE STREAKS & EARLY COACHING ALERTS            */}
      {/* ================================================================= */}
      {subTab === 'streaks' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-[#0F1F3D]">Filter Branch:</span>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800"
              >
                <option value="ALL">All 12 Branches</option>
                {branches.map((b) => (
                  <option key={b.branchId} value={b.branchId}>
                    {b.branchName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                <Award className="w-3.5 h-3.5" />
                {filteredStars.length} Star Performers (3M+ Streak)
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5" />
                {filteredCoaching.length} Early Coaching Alerts
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Star Performers */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 bg-emerald-50/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-emerald-700" />
                  <h3 className="text-sm font-bold text-emerald-950">
                    Star Performers &amp; Rising Streaks
                  </h3>
                </div>
                <span className="text-[11px] font-semibold text-emerald-800">
                  {filteredStars.length + filteredRising.length} staff
                </span>
              </div>
              <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
                {filteredStars.length === 0 && filteredRising.length === 0 ? (
                  <p className="p-8 text-center text-xs text-slate-400">
                    Upload at least 2–3 months of sales/incentives to highlight multi-month consistency streaks.
                  </p>
                ) : (
                  [...filteredStars, ...filteredRising].map((s) => (
                    <div key={s.employeeId} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-[#0F1F3D] truncate">{s.employeeName}</p>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              s.badge === 'STAR_PERFORMER'
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {s.consecutiveTargetMetMonths}M Streak
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {s.employeeId} · {s.branchName}
                          {s.departmentName ? ` · ${s.departmentName}` : ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-mono font-bold text-emerald-700 flex items-center justify-end gap-1">
                          <TrendingUp className="w-3.5 h-3.5" />
                          {formatINRFromPaise(s.latestSalesPaise)}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {formatMonthLabel(s.latestMonthKey)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Early Coaching Alerts */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 bg-amber-50/60 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700" />
                  <h3 className="text-sm font-bold text-amber-950">
                    Early Coaching Alerts (2+ Months Sales Drop ≥10%)
                  </h3>
                </div>
                <span className="text-[11px] font-semibold text-amber-800">
                  {filteredCoaching.length} alerts
                </span>
              </div>
              <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
                {filteredCoaching.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                    <span>Zero consecutive 2-month sales decline alerts in this selection.</span>
                  </div>
                ) : (
                  filteredCoaching.map((s) => (
                    <div key={s.employeeId} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-[#0F1F3D] truncate">{s.employeeName}</p>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-800">
                            {s.consecutiveDeclineMonths}M Drop
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {s.employeeId} · {s.branchName}
                          {s.departmentName ? ` · ${s.departmentName}` : ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-mono font-bold text-red-700 flex items-center justify-end gap-1">
                          <TrendingDown className="w-3.5 h-3.5" />
                          {s.latestDropPct}%
                        </p>
                        <p className="text-[10px] text-slate-500 font-mono">
                          {formatINRFromPaise(s.latestSalesPaise)} (prev {formatINRFromPaise(s.previousSalesPaise)})
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void onRefresh()}
              className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh Analytics
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 4: OVERTIME, ATTENDANCE (LOP) & ATTRITION INSIGHTS (PRO 5) */}
      {/* ================================================================= */}
      {subTab === 'attendance' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <Clock className="w-4 h-4 text-[#B8923A]" />
              <span className="font-semibold text-[#0F1F3D]">Month:</span>
              <select
                value={effectiveMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800"
              >
                {availableMonths.map((mk) => (
                  <option key={mk} value={mk}>
                    {formatMonthLabel(mk)} ({mk})
                  </option>
                ))}
              </select>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800"
              >
                <option value="ALL">All 12 Branches</option>
                {branches.map((b) => (
                  <option key={b.branchId} value={b.branchId}>
                    {b.branchName}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              disabled={exportingOt}
              onClick={() => void handleExportAttendanceExcel()}
              className="h-8 px-3 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-[#DFC27D]" />
              <span>{exportingOt ? 'Exporting...' : 'Export Excel (.xlsx)'}</span>
            </button>
          </div>

          {/* 4 KPI Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Total Overtime Cost
              </p>
              <p className="mt-1.5 text-xl font-bold font-mono text-[#0F1F3D]">
                {formatINRFromPaise(attendanceAnalytics.companyTotals.totalOvertimePaise)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {attendanceAnalytics.companyTotals.totalOvertimeDays} OT days ·{' '}
                {attendanceAnalytics.companyTotals.totalOvertimeHours} hrs
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Total LOP / Absent Days
              </p>
              <p className="mt-1.5 text-xl font-bold font-mono text-rose-700">
                {attendanceAnalytics.companyTotals.totalLopDays} Days
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {attendanceAnalytics.companyTotals.highLopStaffCount} staff with ≥4 LOP days
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Staff Attrition Rate
              </p>
              <p className="mt-1.5 text-xl font-bold font-mono text-[#0F1F3D]">
                {attendanceAnalytics.companyTotals.attritionPct}%
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Active: {attendanceAnalytics.companyTotals.activeStaffCount} · Inactive:{' '}
                {attendanceAnalytics.companyTotals.inactiveStaffCount}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                New Joiners ({formatMonthLabel(effectiveMonth)})
              </p>
              <p className="mt-1.5 text-xl font-bold font-mono text-emerald-700">
                {attendanceAnalytics.companyTotals.newJoinersCount}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                High-OT alerts: {attendanceAnalytics.companyTotals.highOtStaffCount} staff
              </p>
            </div>
          </div>

          {/* Branch-Wise Breakdown Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#0F1F3D] flex items-center gap-2">
                <Users className="w-4 h-4 text-[#B8923A]" />
                Branch-Wise Overtime, LOP &amp; Headcount Summary
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <tr>
                    <th className="py-2.5 px-4">Branch</th>
                    <th className="py-2.5 px-3 text-right">Active</th>
                    <th className="py-2.5 px-3 text-right">Inactive</th>
                    <th className="py-2.5 px-3 text-right">Attrition %</th>
                    <th className="py-2.5 px-3 text-right">New Joiners</th>
                    <th className="py-2.5 px-3 text-right">OT Days</th>
                    <th className="py-2.5 px-3 text-right">Overtime Pay</th>
                    <th className="py-2.5 px-3 text-right">LOP Days</th>
                    <th className="py-2.5 px-3 text-right">High LOP</th>
                    <th className="py-2.5 px-4 text-right">High OT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attendanceAnalytics.branchRows.map((row) => (
                    <tr key={row.branchId} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-semibold text-[#0F1F3D]">{row.branchName}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{row.activeStaffCount}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                        {row.inactiveStaffCount}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">{row.attritionPct}%</td>
                      <td className="py-2.5 px-3 text-right font-mono text-emerald-700">
                        {row.newJoinersCount}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">{row.totalOvertimeDays}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-[#0F1F3D]">
                        {formatINRFromPaise(row.totalOvertimePaise)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-rose-700">
                        {row.totalLopDays}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">{row.highLopStaffCount}</td>
                      <td className="py-2.5 px-4 text-right font-mono">{row.highOtStaffCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* High-LOP & High-OT Alert Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 bg-rose-50/70 flex items-center justify-between">
                <h3 className="text-sm font-bold text-rose-950 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-700" />
                  High Absenteeism Alerts (LOP ≥ 4 Days)
                </h3>
                <span className="text-[11px] font-semibold text-rose-800">
                  {attendanceAnalytics.highLopAlerts.length} staff
                </span>
              </div>
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {attendanceAnalytics.highLopAlerts.length === 0 ? (
                  <p className="p-6 text-center text-xs text-slate-500">
                    No staff crossed 4+ LOP days in {formatMonthLabel(effectiveMonth)}.
                  </p>
                ) : (
                  attendanceAnalytics.highLopAlerts.map((a) => (
                    <div
                      key={`${a.employeeId}-lop`}
                      className="px-4 py-2.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-[#0F1F3D] truncate">{a.employeeName}</p>
                        <p className="text-[11px] text-slate-500">
                          {a.employeeId} · {a.branchName} · Paid {a.paidDays}/{a.totalDays}d
                        </p>
                      </div>
                      <span className="font-mono font-bold text-rose-700 shrink-0">
                        {a.lopDays} LOP d
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 bg-amber-50/70 flex items-center justify-between">
                <h3 className="text-sm font-bold text-amber-950 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-700" />
                  High Overtime Alerts (≥ 5 Days or &gt; 25% Basic)
                </h3>
                <span className="text-[11px] font-semibold text-amber-800">
                  {attendanceAnalytics.highOtAlerts.length} staff
                </span>
              </div>
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {attendanceAnalytics.highOtAlerts.length === 0 ? (
                  <p className="p-6 text-center text-xs text-slate-500">
                    No high-overtime outliers in {formatMonthLabel(effectiveMonth)}.
                  </p>
                ) : (
                  attendanceAnalytics.highOtAlerts.map((a) => (
                    <div
                      key={`${a.employeeId}-ot`}
                      className="px-4 py-2.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-[#0F1F3D] truncate">{a.employeeName}</p>
                        <p className="text-[11px] text-slate-500">
                          {a.employeeId} · {a.branchName} · {a.overtimeDays}d ({a.otToBasicPct}% of Basic)
                        </p>
                      </div>
                      <span className="font-mono font-bold text-[#0F1F3D] shrink-0">
                        {formatINRFromPaise(a.overtimePaise)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
