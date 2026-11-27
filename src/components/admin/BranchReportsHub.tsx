import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Building2,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  FolderDown,
  Landmark,
  Lock,
  ReceiptIndianRupee,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { getShareableStaffAppUrl } from '../../lib/companyBrand';
import {
  buildBankNeftTransferDataset,
  buildBranchAttendanceOtAttrition,
  buildBranchExecutiveSummaryRows,
  buildBranchIncentiveDataset,
  buildDcrCashDisbursementDataset,
  buildStatutoryComplianceDataset,
  getFilteredBranchSalarySlips,
  type BranchFilterInput,
} from '../../lib/branchReportsEngine';
import { formatINRFromPaise, formatMonthLabel, getCurrentMonthKeyIST } from '../../lib/format';
import {
  downloadCredentialSheetPdf,
  downloadManagementBranchSummaryPdf,
  type BranchSummaryPdfRow,
} from '../../lib/pdfGenerator';
import {
  downloadAttendanceOtAttritionXlsx,
  downloadBankNeftExportCsv,
  downloadBankNeftExportXlsx,
  downloadBranchEmployeeRosterXlsx,
  downloadBranchIncentiveReportXlsx,
  downloadBranchSalaryRegisterXlsx,
  downloadCompleteBranchReportPackXlsx,
  downloadDcrCashExportCsv,
  downloadDcrCashExportXlsx,
  downloadStatutoryComplianceCsv,
  downloadStatutoryComplianceXlsx,
} from '../../services/branchReportsExportService';
import {
  downloadBulkSalarySlipsZip,
  isMonthPayrollLockedLocal,
} from '../../services/proFeaturesService';
import type {
  Branch,
  Employee,
  IncentiveAdjustment,
  MonthlySummary,
  PayrollLockSettings,
  PayoutRecord,
  SalarySlip,
} from '../../types/incentive';

import type { VoiceFilterCommand } from '../../services/voiceToolExecutor';

interface Props {
  branches: Branch[];
  employees: Employee[];
  salarySlips: SalarySlip[];
  monthlySummaries: MonthlySummary[];
  payoutRecords: PayoutRecord[];
  adjustments: IncentiveAdjustment[];
  payrollLockSettings?: PayrollLockSettings;
  voiceFilter?: VoiceFilterCommand | null;
}

export function BranchReportsHub({
  branches,
  employees,
  salarySlips,
  monthlySummaries,
  payoutRecords,
  adjustments,
  payrollLockSettings,
  voiceFilter,
}: Props) {
  const availableMonths = useMemo(() => {
    const set = new Set<string>([getCurrentMonthKeyIST()]);
    for (const s of salarySlips) {
      if (/^\d{4}-\d{2}$/.test(s.monthKey)) set.add(s.monthKey);
    }
    for (const m of monthlySummaries) {
      if (m.sourceType !== 'NO_DATA' && /^\d{4}-\d{2}$/.test(m.monthKey)) set.add(m.monthKey);
    }
    return Array.from(set).sort().reverse();
  }, [salarySlips, monthlySummaries]);

  const [selectedMonth, setSelectedMonth] = useState<string>(() => availableMonths[0] || getCurrentMonthKeyIST());
  const [selectedBranchId, setSelectedBranchId] = useState<string>('ALL');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!voiceFilter || voiceFilter.targetTab !== 'branch-reports') return;
    if (voiceFilter.clearFilters) {
      setSelectedBranchId('ALL');
      return;
    }
    if (voiceFilter.branchId !== undefined) setSelectedBranchId(voiceFilter.branchId);
    if (voiceFilter.monthKey && voiceFilter.monthKey !== 'ALL') {
      setSelectedMonth(voiceFilter.monthKey);
    }
  }, [voiceFilter]);

  const effectiveMonth = availableMonths.includes(selectedMonth)
    ? selectedMonth
    : availableMonths[0] || getCurrentMonthKeyIST();

  const sortedBranches = useMemo(
    () => [...branches].sort((a, b) => a.branchName.localeCompare(b.branchName)),
    [branches],
  );

  const selectedBranchLabel = useMemo(() => {
    if (selectedBranchId === 'ALL') return 'All 12 Branches';
    return branches.find((b) => b.branchId === selectedBranchId)?.branchName || selectedBranchId;
  }, [branches, selectedBranchId]);

  const filterInput: BranchFilterInput = useMemo(
    () => ({
      branches,
      employees,
      salarySlips,
      monthlySummaries,
      payoutRecords,
      adjustments,
      selectedMonth: effectiveMonth,
      selectedBranchId,
    }),
    [
      branches,
      employees,
      salarySlips,
      monthlySummaries,
      payoutRecords,
      adjustments,
      effectiveMonth,
      selectedBranchId,
    ],
  );

  const filteredSlips = useMemo(
    () => getFilteredBranchSalarySlips(salarySlips, effectiveMonth, selectedBranchId),
    [salarySlips, effectiveMonth, selectedBranchId],
  );

  const neftData = useMemo(
    () =>
      buildBankNeftTransferDataset({
        salarySlips,
        employees,
        selectedMonth: effectiveMonth,
        selectedBranchId,
      }),
    [salarySlips, employees, effectiveMonth, selectedBranchId],
  );

  const dcrCashData = useMemo(
    () =>
      buildDcrCashDisbursementDataset({
        salarySlips,
        selectedMonth: effectiveMonth,
        selectedBranchId,
      }),
    [salarySlips, effectiveMonth, selectedBranchId],
  );

  const statutoryData = useMemo(
    () =>
      buildStatutoryComplianceDataset({
        salarySlips,
        employees,
        selectedMonth: effectiveMonth,
        selectedBranchId,
      }),
    [salarySlips, employees, effectiveMonth, selectedBranchId],
  );

  const incentiveData = useMemo(
    () =>
      buildBranchIncentiveDataset({
        monthlySummaries,
        employees,
        payoutRecords,
        adjustments,
        selectedMonth: effectiveMonth,
        selectedBranchId,
      }),
    [monthlySummaries, employees, payoutRecords, adjustments, effectiveMonth, selectedBranchId],
  );

  const attendanceOtData = useMemo(
    () =>
      buildBranchAttendanceOtAttrition({
        branches,
        employees,
        salarySlips,
        selectedMonth: effectiveMonth,
        selectedBranchId,
      }),
    [branches, employees, salarySlips, effectiveMonth, selectedBranchId],
  );

  const allBranchesSummary = useMemo(
    () =>
      buildBranchExecutiveSummaryRows({
        branches,
        employees,
        salarySlips,
        monthlySummaries,
        payoutRecords,
        adjustments,
        selectedMonth: effectiveMonth,
        selectedBranchId: 'ALL',
      }),
    [branches, employees, salarySlips, monthlySummaries, payoutRecords, adjustments, effectiveMonth],
  );

  const filteredEmployees = useMemo(
    () =>
      employees.filter(
        (e) => selectedBranchId === 'ALL' || e.branchId === selectedBranchId,
      ),
    [employees, selectedBranchId],
  );

  const totalNetSalaryPaise = useMemo(
    () => filteredSlips.reduce((acc, s) => acc + (s.netPayablePaise || 0), 0),
    [filteredSlips],
  );

  const monthLocked = isMonthPayrollLockedLocal(effectiveMonth, payrollLockSettings);

  const runDownload = async (key: string, label: string, fn: () => Promise<void> | void) => {
    setBusyKey(key);
    setFeedback(null);
    try {
      await fn();
      setFeedback({
        type: 'ok',
        text: `Downloaded ${label} for ${selectedBranchLabel} (${formatMonthLabel(effectiveMonth)}).`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : `Failed to generate ${label}.`,
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleDownloadIncentivePdf = async () => {
    const byBranch = new Map<string, BranchSummaryPdfRow>();
    for (const r of incentiveData.rows) {
      let row = byBranch.get(r.branchId);
      if (!row) {
        row = {
          branchName: r.branchName,
          staffCount: 0,
          saleAmtPaise: 0,
          saleQty: 0,
          grossIncentivePaise: 0,
          adjustmentsNetPaise: 0,
          netPayablePaise: 0,
          paidCount: 0,
          incentivePct: 0,
        };
        byBranch.set(r.branchId, row);
      }
      row.staffCount += 1;
      row.saleAmtPaise += r.totalSaleAmtPaise;
      row.saleQty = Math.round((row.saleQty + r.totalSaleQty) * 100) / 100;
      row.grossIncentivePaise += r.grossIncentivePaise;
      row.adjustmentsNetPaise += r.adjustmentsNetPaise;
      row.netPayablePaise += r.netPayablePaise;
      if (r.payoutStatus === 'PAID') row.paidCount += 1;
    }
    const rows = Array.from(byBranch.values()).map((r) => ({
      ...r,
      incentivePct:
        r.saleAmtPaise > 0
          ? Math.round((r.grossIncentivePaise / r.saleAmtPaise) * 10000) / 100
          : 0,
    }));
    await downloadManagementBranchSummaryPdf({
      monthKey: effectiveMonth,
      rows,
    });
  };

  const handleDownloadSalaryZip = async () => {
    if (filteredSlips.length === 0) {
      throw new Error('No published salary slips found for the selected branch and month.');
    }
    setZipProgress({ done: 0, total: filteredSlips.length });
    try {
      await downloadBulkSalarySlipsZip({
        slips: filteredSlips,
        monthLabel: `${selectedBranchLabel}_${effectiveMonth}`,
        onProgress: (done, total) => setZipProgress({ done, total }),
      });
    } finally {
      setZipProgress(null);
    }
  };

  const handleDownloadSingleBranchPack = async (branch: { branchId: string; branchName: string }) => {
    const key = `branch-pack-${branch.branchId}`;
    setBusyKey(key);
    setFeedback(null);
    try {
      await downloadCompleteBranchReportPackXlsx({
        ...filterInput,
        selectedBranchId: branch.branchId,
      });
      setFeedback({
        type: 'ok',
        text: `Downloaded Complete 8-Sheet Report Pack for ${branch.branchName} (${formatMonthLabel(effectiveMonth)}).`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : `Failed to export pack for ${branch.branchName}.`,
      });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Executive Header & Filter Control Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="w-9 h-9 rounded-xl bg-[#0F1F3D] text-[#DFC27D] flex items-center justify-center shrink-0">
                <FolderDown className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#0F1F3D] tracking-tight">
                  Branch-Wise Reports Center
                </h2>
                <p className="text-xs text-slate-500">
                  Download Salary, Bank NEFT, Cash/DCR, PF/ESIC/PT, Incentives, OT/LOP & Staff reports for any single branch or all 12 branches.
                </p>
              </div>
              {monthLocked && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold">
                  <Lock className="w-3.5 h-3.5" />
                  Payroll Locked
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={effectiveMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              aria-label="Select Report Month"
              className="h-10 px-3 rounded-xl border border-slate-300 bg-white text-sm font-medium text-[#0F1F3D] focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20"
            >
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {formatMonthLabel(m)} ({m})
                </option>
              ))}
            </select>

            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              aria-label="Select Branch"
              className="h-10 px-3 rounded-xl border border-slate-300 bg-white text-sm font-medium text-[#0F1F3D] focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 min-w-[200px]"
            >
              <option value="ALL">All 12 Branches (Consolidated)</option>
              {sortedBranches.map((b) => (
                <option key={b.branchId} value={b.branchId}>
                  {b.branchName} ({b.branchCode})
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={busyKey !== null}
              onClick={() =>
                runDownload('complete-pack', 'Complete 8-Sheet Branch Pack (.xlsx)', () =>
                  downloadCompleteBranchReportPackXlsx(filterInput),
                )
              }
              className="h-10 px-4 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap cursor-pointer disabled:opacity-60 transition-colors"
            >
              <Download className="w-4 h-4 text-[#DFC27D] shrink-0" />
              <span>
                {busyKey === 'complete-pack' ? 'Generating Pack...' : 'Download Complete Pack (.xlsx)'}
              </span>
            </button>
          </div>
        </div>

        {feedback && (
          <div
            className={`mt-4 px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2 ${
              feedback.type === 'ok'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                : 'bg-red-50 border border-red-200 text-red-900'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{feedback.text}</span>
          </div>
        )}
      </div>

      {/* Live 4-KPI Summary Strip for Active Selection */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Net Salary · {selectedBranchLabel}
          </p>
          <p className="mt-1.5 text-2xl font-bold text-[#0F1F3D] font-mono">
            {formatINRFromPaise(totalNetSalaryPaise)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {filteredSlips.length} salary slip(s) published
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Bank NEFT vs DCR / Cash
          </p>
          <p className="mt-1.5 text-2xl font-bold text-[#0F1F3D] font-mono">
            {formatINRFromPaise(neftData.totalAmountPaise)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            NEFT: {neftData.rows.length} · DCR/Cash: {formatINRFromPaise(dcrCashData.totalAmountPaise)} ({dcrCashData.rows.length})
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Statutory Challan (PF/ESIC/PT/LWF)
          </p>
          <p className="mt-1.5 text-2xl font-bold text-[#0F1F3D] font-mono">
            {formatINRFromPaise(statutoryData.totals.totalStatutoryPaise)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            PF {formatINRFromPaise(statutoryData.totals.pfPaise)} · ESIC {formatINRFromPaise(statutoryData.totals.esicPaise)}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Sales & Net Incentives
          </p>
          <p className="mt-1.5 text-2xl font-bold text-[#0F1F3D] font-mono">
            {formatINRFromPaise(incentiveData.totals.netPayablePaise)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Sales: {formatINRFromPaise(incentiveData.totals.totalSaleAmtPaise)} ({incentiveData.rows.length} staff)
          </p>
        </div>
      </div>

      {/* 8-Card Branch-Wise Report Download Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* 1. Branch Salary Register */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-slate-100 text-[#0F1F3D] flex items-center justify-center">
                <ReceiptIndianRupee className="w-4 h-4" />
              </div>
              <span className="text-xs font-mono font-semibold text-slate-600">
                {filteredSlips.length} slips
              </span>
            </div>
            <h3 className="mt-3 text-sm font-bold text-[#0F1F3D]">Branch Salary Register</h3>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Full earning & deduction breakup, Basic, HRA, Allowances, OT, PF, ESIC, PT, LWF & Net Payable.
            </p>
          </div>
          <button
            type="button"
            disabled={busyKey !== null || filteredSlips.length === 0}
            onClick={() =>
              runDownload('salary-reg', 'Branch Salary Register (.xlsx)', () =>
                downloadBranchSalaryRegisterXlsx(filterInput),
              )
            }
            className="h-9 px-3 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-[#DFC27D]" />
            <span>{busyKey === 'salary-reg' ? 'Exporting...' : 'Download Excel (.xlsx)'}</span>
          </button>
        </div>

        {/* 2. Bank NEFT Transfer Sheet */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center">
                <Landmark className="w-4 h-4" />
              </div>
              <span className="text-xs font-mono font-semibold text-emerald-800">
                {neftData.rows.length} NEFT
              </span>
            </div>
            <h3 className="mt-3 text-sm font-bold text-[#0F1F3D]">Bank NEFT Transfer Sheet</h3>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Bank-upload ready payout file with Beneficiary, Account No, IFSC & Narration.
              {neftData.missingBankDetailsCount > 0 && (
                <span className="block mt-1 text-amber-700 font-medium">
                  {neftData.missingBankDetailsCount} staff missing Account/IFSC.
                </span>
              )}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busyKey !== null || neftData.rows.length === 0}
              onClick={() =>
                runDownload('neft-xlsx', 'Bank NEFT Sheet (.xlsx)', () =>
                  downloadBankNeftExportXlsx(filterInput),
                )
              }
              className="h-9 px-2.5 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#DFC27D]" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              disabled={busyKey !== null || neftData.rows.length === 0}
              onClick={() =>
                runDownload('neft-csv', 'Bank NEFT Sheet (.csv)', () =>
                  downloadBankNeftExportCsv(filterInput),
                )
              }
              className="h-9 px-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-[#0F1F3D] text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
          </div>
        </div>

        {/* 3. DCR / Cash Disbursement Voucher */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-[#FDF8EC] text-[#9A7625] flex items-center justify-center">
                <Wallet className="w-4 h-4" />
              </div>
              <span className="text-xs font-mono font-semibold text-[#9A7625]">
                {dcrCashData.rows.length} staff
              </span>
            </div>
            <h3 className="mt-3 text-sm font-bold text-[#0F1F3D]">DCR / Cash Voucher Sheet</h3>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Branch-wise DCR & Cash disbursement list with Receiver Signature column for store cashier sign-off.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busyKey !== null || dcrCashData.rows.length === 0}
              onClick={() =>
                runDownload('dcr-xlsx', 'DCR / Cash Voucher (.xlsx)', () =>
                  downloadDcrCashExportXlsx(filterInput),
                )
              }
              className="h-9 px-2.5 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#DFC27D]" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              disabled={busyKey !== null || dcrCashData.rows.length === 0}
              onClick={() =>
                runDownload('dcr-csv', 'DCR / Cash Voucher (.csv)', () =>
                  downloadDcrCashExportCsv(filterInput),
                )
              }
              className="h-9 px-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-[#0F1F3D] text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
          </div>
        </div>

        {/* 4. Monthly Statutory Compliance Challan */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-800 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <span className="text-xs font-mono font-semibold text-blue-800">
                PF {statutoryData.totals.pfCoveredCount} · ESIC {statutoryData.totals.esicCoveredCount}
              </span>
            </div>
            <h3 className="mt-3 text-sm font-bold text-[#0F1F3D]">Statutory PF / ESIC / PT / LWF</h3>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              CA-ready monthly compliance challan with UAN, PF No, ESIC No, PAN, Gross, Basic & statutory totals.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busyKey !== null || statutoryData.rows.length === 0}
              onClick={() =>
                runDownload('stat-xlsx', 'Statutory Compliance Challan (.xlsx)', () =>
                  downloadStatutoryComplianceXlsx(filterInput),
                )
              }
              className="h-9 px-2.5 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#DFC27D]" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              disabled={busyKey !== null || statutoryData.rows.length === 0}
              onClick={() =>
                runDownload('stat-csv', 'Statutory Compliance Challan (.csv)', () =>
                  downloadStatutoryComplianceCsv(filterInput),
                )
              }
              className="h-9 px-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-[#0F1F3D] text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
          </div>
        </div>

        {/* 5. Branch Sales & Incentive Report */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-800 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
              <span className="text-xs font-mono font-semibold text-indigo-800">
                {incentiveData.rows.length} staff
              </span>
            </div>
            <h3 className="mt-3 text-sm font-bold text-[#0F1F3D]">Sales & Incentive Report</h3>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Branch-filtered Sarees, Readymade & Others sales, gross incentive, bonus/deduction adjustments & paid status.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busyKey !== null || incentiveData.rows.length === 0}
              onClick={() =>
                runDownload('inc-xlsx', 'Sales & Incentive Report (.xlsx)', () =>
                  downloadBranchIncentiveReportXlsx(filterInput),
                )
              }
              className="h-9 px-2.5 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#DFC27D]" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              disabled={busyKey !== null || incentiveData.rows.length === 0}
              onClick={() =>
                runDownload('inc-pdf', 'Branch Summary PDF', handleDownloadIncentivePdf)
              }
              className="h-9 px-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-[#0F1F3D] text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>PDF</span>
            </button>
          </div>
        </div>

        {/* 6. Official Salary Slips PDF ZIP */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-800 flex items-center justify-center">
                <Archive className="w-4 h-4" />
              </div>
              <span className="text-xs font-mono font-semibold text-amber-900">
                {filteredSlips.length} PDFs
              </span>
            </div>
            <h3 className="mt-3 text-sm font-bold text-[#0F1F3D]">Salary Slips PDF ZIP</h3>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Branch-organized ZIP archive containing official branded PDF payment slips for every staff member.
            </p>
          </div>
          <button
            type="button"
            disabled={busyKey !== null || filteredSlips.length === 0}
            onClick={() =>
              runDownload('slips-zip', 'Salary Slips PDF ZIP', handleDownloadSalaryZip)
            }
            className="h-9 px-3 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
          >
            <Archive className="w-3.5 h-3.5 text-[#DFC27D]" />
            <span>
              {zipProgress
                ? `Packing ${zipProgress.done}/${zipProgress.total}...`
                : 'Download PDF ZIP'}
            </span>
          </button>
        </div>

        {/* 7. Overtime, LOP & Attrition Report */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center">
                <Clock className="w-4 h-4" />
              </div>
              <span className="text-xs font-mono font-semibold text-rose-700">
                {attendanceOtData.companyTotals.totalLopDays} LOP d
              </span>
            </div>
            <h3 className="mt-3 text-sm font-bold text-[#0F1F3D]">OT, LOP & Attrition Report</h3>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Branch-wise overtime pay ({formatINRFromPaise(attendanceOtData.companyTotals.totalOvertimePaise)}), LOP days, high-absenteeism & attrition %.
            </p>
          </div>
          <button
            type="button"
            disabled={busyKey !== null}
            onClick={() =>
              runDownload('ot-lop', 'OT, LOP & Attrition Report (.xlsx)', () =>
                downloadAttendanceOtAttritionXlsx(filterInput),
              )
            }
            className="h-9 px-3 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-[#DFC27D]" />
            <span>{busyKey === 'ot-lop' ? 'Exporting...' : 'Download Excel (.xlsx)'}</span>
          </button>
        </div>

        {/* 8. Branch Employee Master & Credentials */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-slate-100 text-[#0F1F3D] flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
              <span className="text-xs font-mono font-semibold text-slate-600">
                {filteredEmployees.length} staff
              </span>
            </div>
            <h3 className="mt-3 text-sm font-bold text-[#0F1F3D]">Employee Roster & Logins</h3>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Complete staff roster with EMP ID, Sales ID, Login ID, Bank/IFSC, UAN & printable Credential PDF.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busyKey !== null || filteredEmployees.length === 0}
              onClick={() =>
                runDownload('roster-xlsx', 'Employee Roster (.xlsx)', () =>
                  downloadBranchEmployeeRosterXlsx(filterInput),
                )
              }
              className="h-9 px-2.5 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#DFC27D]" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              disabled={busyKey !== null || filteredEmployees.length === 0}
              onClick={() =>
                runDownload('cred-pdf', 'Staff Credentials PDF', () =>
                  downloadCredentialSheetPdf({
                    employees: filteredEmployees,
                    branchFilterLabel: selectedBranchLabel,
                    portalUrl: getShareableStaffAppUrl(),
                  }),
                )
              }
              className="h-9 px-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-[#0F1F3D] text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Cred PDF</span>
            </button>
          </div>
        </div>
      </div>

      {/* 12-Branch Side-by-Side Comparison Table with 1-Click Per-Branch Pack Export */}
      <div className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden shadow-2xs">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-4 h-4 text-[#B8923A]" />
            <div>
              <h3 className="text-sm font-bold text-[#0F1F3D]">
                All 12 Branches Summary — {formatMonthLabel(effectiveMonth)}
              </h3>
              <p className="text-xs text-slate-500">
                Click any branch row to filter above, or download its complete 8-sheet Branch Pack in one click.
              </p>
            </div>
          </div>
          {selectedBranchId !== 'ALL' && (
            <button
              type="button"
              onClick={() => setSelectedBranchId('ALL')}
              className="text-xs font-semibold text-[#0F1F3D] hover:underline cursor-pointer self-start sm:self-auto"
            >
              Reset to All 12 Branches
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-2.5 px-4">Branch</th>
                <th className="py-2.5 px-3 text-right">Active Staff</th>
                <th className="py-2.5 px-3 text-right">Slips</th>
                <th className="py-2.5 px-3 text-right">Net Salary</th>
                <th className="py-2.5 px-3 text-right">Bank NEFT</th>
                <th className="py-2.5 px-3 text-right">DCR / Cash</th>
                <th className="py-2.5 px-3 text-right">Statutory</th>
                <th className="py-2.5 px-3 text-right">Sales</th>
                <th className="py-2.5 px-3 text-right">Incentive</th>
                <th className="py-2.5 px-4 text-right">Branch Pack</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {allBranchesSummary.map((row) => {
                const isSelected = selectedBranchId === row.branchId;
                const rowBusy = busyKey === `branch-pack-${row.branchId}`;
                return (
                  <tr
                    key={row.branchId}
                    onClick={() => setSelectedBranchId(row.branchId)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-[#FDF8EC]' : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <td className="py-2.5 px-4 font-semibold text-[#0F1F3D] whitespace-nowrap">
                      {row.branchName}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                      {row.activeStaffCount}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                      {row.salarySlipCount}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-[#0F1F3D]">
                      {formatINRFromPaise(row.salaryNetPaise)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-emerald-800">
                      {formatINRFromPaise(row.neftAmountPaise)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-amber-800">
                      {formatINRFromPaise(row.dcrCashAmountPaise)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                      {formatINRFromPaise(row.statutoryTotalPaise)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                      {formatINRFromPaise(row.totalSalesPaise)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-indigo-800">
                      {formatINRFromPaise(row.totalIncentivePaise)}
                    </td>
                    <td
                      className="py-2.5 px-4 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() =>
                          handleDownloadSingleBranchPack({
                            branchId: row.branchId,
                            branchName: row.branchName,
                          })
                        }
                        className="h-7 px-2.5 rounded-lg border border-slate-300 bg-white hover:bg-[#0F1F3D] hover:text-white hover:border-[#0F1F3D] text-[#0F1F3D] text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 transition-colors"
                      >
                        <Download className="w-3 h-3" />
                        <span>{rowBusy ? 'Saving...' : 'Pack (.xlsx)'}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
