import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Award,
  Building2,
  Clock,
  FileSpreadsheet,
  IndianRupee,
  MessageSquare,
  Users,
} from 'lucide-react';
import {
  formatINRFromPaise,
  formatMonthLabel,
  formatQty,
  formatShortDate,
  getCurrentMonthKeyIST,
} from '../../lib/format';
import { normalizeRecordPeriod } from '../../lib/incentiveEngine';
import { CompanyLetterhead } from '../common/BrandLogo';
import { AnimatedCounter } from '../common/MotionPrimitives';
import type {
  Branch,
  Employee,
  EmployeeQuery,
  ImportBatch,
  MonthlySummary,
  PublishedIncentive,
} from '../../types/incentive';
import type { AdminNavTab } from './AdminGlobalSearch';

interface Props {
  branches: Branch[];
  employees: Employee[];
  batches: ImportBatch[];
  incentives: PublishedIncentive[];
  monthlySummaries: MonthlySummary[];
  employeeQueries?: EmployeeQuery[];
  onNavigate: (tab: AdminNavTab) => void;
}

export function AdminOverview({
  branches,
  employees,
  batches,
  incentives,
  monthlySummaries,
  employeeQueries = [],
  onNavigate,
}: Props) {
  const currentMonth = getCurrentMonthKeyIST();
  const [selectedBranchId, setSelectedBranchId] = useState<string>('ALL');

  const publishedDailyMonthlyMonthKeys = useMemo(() => {
    const set = new Set<string>();
    for (const rec of incentives) {
      if (rec.status !== 'PUBLISHED') continue;
      const norm = normalizeRecordPeriod(rec);
      if (norm.importType === 'DAILY' || norm.importType === 'MONTHLY') {
        set.add(rec.monthKey);
      }
    }
    return set;
  }, [incentives]);

  const activeMonthlySummaries = useMemo(
    () =>
      monthlySummaries.filter(
        (s) => s.sourceType !== 'NO_DATA' && publishedDailyMonthlyMonthKeys.has(s.monthKey),
      ),
    [monthlySummaries, publishedDailyMonthlyMonthKeys],
  );

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const s of activeMonthlySummaries) set.add(s.monthKey);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [activeMonthlySummaries]);

  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  useEffect(() => {
    if (availableMonths.length === 0) {
      if (selectedMonth !== '') setSelectedMonth('');
      return;
    }
    if (!availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  const metrics = useMemo(() => {
    const branchFilteredAll =
      selectedBranchId === 'ALL'
        ? activeMonthlySummaries
        : activeMonthlySummaries.filter((s) => s.branchId === selectedBranchId);

    const monthSummaries = selectedMonth
      ? branchFilteredAll.filter((s) => s.monthKey === selectedMonth)
      : [];

    const allTimeTotalPaise = branchFilteredAll.reduce((acc, s) => acc + s.grandTotalPaise, 0);
    const totalMonthPaise = monthSummaries.reduce((acc, s) => acc + s.grandTotalPaise, 0);
    const totalComp1Paise = monthSummaries.reduce((acc, s) => acc + s.component1TotalPaise, 0);
    const totalComp2Paise = monthSummaries.reduce((acc, s) => acc + s.component2TotalPaise, 0);
    const totalComp3Paise = monthSummaries.reduce((acc, s) => acc + s.component3TotalPaise, 0);
    const totalSaleAmt1Paise = monthSummaries.reduce(
      (acc, s) => acc + (s.saleAmt1TotalPaise || 0),
      0,
    );
    const totalSaleQty1 =
      Math.round(monthSummaries.reduce((acc, s) => acc + (s.saleQty1Total || 0), 0) * 100) / 100;
    const totalSaleAmt2Paise = monthSummaries.reduce(
      (acc, s) => acc + (s.saleAmt2TotalPaise || 0),
      0,
    );
    const totalSaleQty2 =
      Math.round(monthSummaries.reduce((acc, s) => acc + (s.saleQty2Total || 0), 0) * 100) / 100;
    const totalSaleAmt3Paise = monthSummaries.reduce(
      (acc, s) => acc + (s.saleAmt3TotalPaise || 0),
      0,
    );
    const totalSaleQty3 =
      Math.round(monthSummaries.reduce((acc, s) => acc + (s.saleQty3Total || 0), 0) * 100) / 100;
    const totalSaleAmtPaise = monthSummaries.reduce(
      (acc, s) =>
        acc +
        (s.totalSaleAmtPaise ??
          (s.saleAmt1TotalPaise || 0) + (s.saleAmt2TotalPaise || 0) + (s.saleAmt3TotalPaise || 0)),
      0,
    );
    const totalSaleQty =
      Math.round(
        monthSummaries.reduce(
          (acc, s) =>
            acc +
            (s.totalSaleQty ??
              (s.saleQty1Total || 0) + (s.saleQty2Total || 0) + (s.saleQty3Total || 0)),
          0,
        ) * 100,
      ) / 100;

    const activeBranches = branches.filter((b) => b.active).length;
    const scopedEmployees =
      selectedBranchId === 'ALL'
        ? employees
        : employees.filter((e) => e.branchId === selectedBranchId);
    const activeEmployees = scopedEmployees.filter((e) => e.status === 'ACTIVE').length;
    const pendingBatches = batches.filter(
      (b) =>
        b.status === 'VALIDATED' ||
        b.status === 'APPROVED' ||
        b.status === 'FAILED' ||
        b.status === 'PROCESSING',
    ).length;
    const openQueries = employeeQueries.filter((q) => q.status !== 'RESOLVED').length;

    const branchTotalsMap: Record<
      string,
      { name: string; totalPaise: number; totalSaleAmtPaise: number; totalSaleQty: number; count: number }
    > = {};
    const targetBranches =
      selectedBranchId === 'ALL'
        ? branches
        : branches.filter((b) => b.branchId === selectedBranchId);

    for (const b of targetBranches) {
      branchTotalsMap[b.branchId] = {
        name: b.branchName,
        totalPaise: 0,
        totalSaleAmtPaise: 0,
        totalSaleQty: 0,
        count: 0,
      };
    }
    for (const s of monthSummaries) {
      if (!branchTotalsMap[s.branchId]) {
        branchTotalsMap[s.branchId] = {
          name: s.branchName,
          totalPaise: 0,
          totalSaleAmtPaise: 0,
          totalSaleQty: 0,
          count: 0,
        };
      }
      branchTotalsMap[s.branchId].totalPaise += s.grandTotalPaise;
      branchTotalsMap[s.branchId].totalSaleAmtPaise +=
        s.totalSaleAmtPaise ??
        (s.saleAmt1TotalPaise || 0) + (s.saleAmt2TotalPaise || 0) + (s.saleAmt3TotalPaise || 0);
      branchTotalsMap[s.branchId].totalSaleQty =
        Math.round(
          (branchTotalsMap[s.branchId].totalSaleQty +
            (s.totalSaleQty ??
              (s.saleQty1Total || 0) + (s.saleQty2Total || 0) + (s.saleQty3Total || 0))) *
            100,
        ) / 100;
      branchTotalsMap[s.branchId].count += 1;
    }

    const branchBreakdown = Object.entries(branchTotalsMap)
      .map(([id, data]) => ({ branchId: id, ...data }))
      .sort((a, b) => b.totalPaise - a.totalPaise);

    const maxBranchPaise = Math.max(1, ...branchBreakdown.map((b) => b.totalPaise));

    return {
      allTimeTotalPaise,
      totalMonthPaise,
      totalComp1Paise,
      totalComp2Paise,
      totalComp3Paise,
      totalSaleAmt1Paise,
      totalSaleQty1,
      totalSaleAmt2Paise,
      totalSaleQty2,
      totalSaleAmt3Paise,
      totalSaleQty3,
      totalSaleAmtPaise,
      totalSaleQty,
      activeBranches,
      activeEmployees,
      pendingBatches,
      openQueries,
      branchBreakdown,
      maxBranchPaise,
    };
  }, [
    branches,
    employees,
    batches,
    employeeQueries,
    activeMonthlySummaries,
    selectedMonth,
    selectedBranchId,
  ]);

  const recentBatches = batches.slice(0, 6);
  const latestPublishedDate =
    incentives.find((i) => i.status === 'PUBLISHED')?.businessDate || null;

  return (
    <div className="space-y-6">
      {/* Executive Company Identity & Period + Branch Filter Header */}
      <CompanyLetterhead
        documentTitle={
          selectedMonth
            ? `Incentive Dashboard · ${formatMonthLabel(selectedMonth)}`
            : 'Incentive Dashboard'
        }
        subtitle={
          latestPublishedDate ? `Updated ${formatShortDate(latestPublishedDate)}` : undefined
        }
        rightSlot={
          <div className="inline-flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80">
            <select
              aria-label="Filter dashboard by branch"
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-800 max-w-[175px]"
            >
              <option value="ALL">All 12 Branches</option>
              {branches.map((b) => (
                <option key={b.branchId} value={b.branchId}>
                  {b.branchName}
                </option>
              ))}
            </select>
            {availableMonths.length > 0 && (
              <select
                aria-label="Select overview month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-800"
              >
                {availableMonths.map((m) => (
                  <option key={m} value={m}>
                    {formatMonthLabel(m)}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => onNavigate('import')}
              className="h-8 px-3 text-xs font-semibold text-white bg-[#0F1F3D] hover:bg-[#162B50] active:scale-[0.98] rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-all"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#DFC27D]" />
              Upload Excel
            </button>
          </div>
        }
      />

      {/* Executive 6-KPI Strip (4 primary on top row / clean responsive grid) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="bg-[#0F1F3D] text-white border border-[#1E3A5F] rounded-xl p-5 relative overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-[#B8923A] via-[#DFC27D] to-[#B8923A]" />
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-medium text-[#DFC27D]">
              {selectedMonth
                ? `Published Incentives · ${formatMonthLabel(selectedMonth)}`
                : 'Published Incentives'}
            </p>
            <IndianRupee className="w-4 h-4 text-[#DFC27D] shrink-0" />
          </div>
          <p className="text-2xl font-bold text-white">
            <AnimatedCounter value={metrics.totalMonthPaise} mode="paise" />
          </p>
          <p className="text-xs text-slate-300 mt-1.5 font-mono tabular-nums">
            Sale: {formatINRFromPaise(metrics.totalSaleAmtPaise)} · Qty: {formatQty(metrics.totalSaleQty)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {metrics.totalSaleAmtPaise > 0
              ? `Incentive Ratio: ${((metrics.totalMonthPaise / metrics.totalSaleAmtPaise) * 100).toFixed(2)}% of Sale`
              : latestPublishedDate
                ? `Latest date: ${formatShortDate(latestPublishedDate)}`
                : 'No published batches yet'}
          </p>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-xl p-5 hover:border-slate-300 transition-colors">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-medium text-slate-500">All-Time Published Incentive</p>
            <Award className="w-4 h-4 text-[#B8923A] shrink-0" />
          </div>
          <p className="text-2xl font-semibold text-[#0F1F3D]">
            <AnimatedCounter value={metrics.allTimeTotalPaise} mode="paise" />
          </p>
          <button
            type="button"
            onClick={() => onNavigate('analytics')}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1E3A5F] hover:underline cursor-pointer"
          >
            Open Analytics &amp; Trends
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-xl p-5 hover:border-slate-300 transition-colors">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-medium text-slate-500">Active Employees</p>
            <Users className="w-4 h-4 text-[#1E3A5F] shrink-0" />
          </div>
          <p className="text-2xl font-semibold text-[#0F1F3D]">
            <AnimatedCounter value={metrics.activeEmployees} mode="integer" />
            <span className="text-sm font-normal text-slate-400 font-mono">
              {' '}
              / {employees.length}
            </span>
          </p>
          <button
            type="button"
            onClick={() => onNavigate('employees')}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1E3A5F] hover:underline cursor-pointer"
          >
            Manage Employee Accounts
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-xl p-5 hover:border-slate-300 transition-colors">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-medium text-slate-500">Active Retail Branches</p>
            <Building2 className="w-4 h-4 text-[#B8923A] shrink-0" />
          </div>
          <p className="text-2xl font-semibold text-[#0F1F3D]">
            <AnimatedCounter value={metrics.activeBranches} mode="integer" />
            <span className="text-sm font-normal text-slate-400 font-mono">
              {' '}
              / {branches.length || 12}
            </span>
          </p>
          <button
            type="button"
            onClick={() => onNavigate('branches')}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1E3A5F] hover:underline cursor-pointer"
          >
            Manage Branch Master
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-xl p-5 hover:border-slate-300 transition-colors">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-medium text-slate-500">Pending Approvals / Batches</p>
            <Clock
              className={`w-4 h-4 shrink-0 ${
                metrics.pendingBatches > 0 ? 'text-amber-600' : 'text-emerald-600'
              }`}
            />
          </div>
          <p className="text-2xl font-semibold text-[#0F1F3D]">
            <AnimatedCounter value={metrics.pendingBatches} mode="integer" />
          </p>
          <button
            type="button"
            onClick={() => onNavigate(metrics.pendingBatches > 0 ? 'history' : 'import')}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1E3A5F] hover:underline cursor-pointer"
          >
            {metrics.pendingBatches > 0 ? 'Review Pending Batches' : 'Upload Daily Excel'}
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-xl p-5 hover:border-slate-300 transition-colors">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-medium text-slate-500">Open Employee Queries</p>
            <MessageSquare
              className={`w-4 h-4 shrink-0 ${
                metrics.openQueries > 0 ? 'text-amber-600' : 'text-emerald-600'
              }`}
            />
          </div>
          <p className="text-2xl font-semibold text-[#0F1F3D]">
            <AnimatedCounter value={metrics.openQueries} mode="integer" />
          </p>
          <button
            type="button"
            onClick={() => onNavigate('payouts')}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1E3A5F] hover:underline cursor-pointer"
          >
            {metrics.openQueries > 0 ? 'Resolve Staff Queries' : 'View Payouts & Queries'}
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main two-column operational section */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Branch-wise incentive distribution */}
        <section className="xl:col-span-7 bg-white border border-slate-200/90 rounded-xl p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h2 className="text-base font-semibold text-[#0F1F3D]">
                Branch-Wise Incentives
              </h2>
              {selectedMonth && (
                <p className="text-xs text-slate-500 mt-0.5">{formatMonthLabel(selectedMonth)}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5 p-3.5 rounded-xl bg-[#F8FAFC] border border-slate-200/80 text-xs">
            <div>
              <p className="text-slate-500 font-medium">New Items Sale</p>
              <p className="font-mono tabular-nums font-semibold text-[#0F1F3D] text-sm mt-0.5">
                {formatINRFromPaise(metrics.totalComp1Paise)}
              </p>
              <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                Sale: {formatINRFromPaise(metrics.totalSaleAmt1Paise)} · Qty:{' '}
                {formatQty(metrics.totalSaleQty1)}
              </p>
            </div>
            <div>
              <p className="text-slate-500 font-medium">Old Items Sale</p>
              <p className="font-mono tabular-nums font-semibold text-[#0F1F3D] text-sm mt-0.5">
                {formatINRFromPaise(metrics.totalComp2Paise)}
              </p>
              <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                Sale: {formatINRFromPaise(metrics.totalSaleAmt2Paise)} · Qty:{' '}
                {formatQty(metrics.totalSaleQty2)}
              </p>
            </div>
            <div>
              <p className="text-slate-500 font-medium">Other Items Sale</p>
              <p className="font-mono tabular-nums font-semibold text-[#0F1F3D] text-sm mt-0.5">
                {formatINRFromPaise(metrics.totalComp3Paise)}
              </p>
              <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                Sale: {formatINRFromPaise(metrics.totalSaleAmt3Paise)} · Qty:{' '}
                {formatQty(metrics.totalSaleQty3)}
              </p>
            </div>
          </div>

          {metrics.branchBreakdown.length === 0 ? (
            <div className="py-10 text-center border border-dashed border-slate-200 rounded-xl">
              <p className="text-sm text-slate-600 mb-3">
                No branches configured yet. Initialize the 12 House of Muktai branches to begin.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('branches')}
                className="px-4 py-2 text-xs font-medium text-white bg-[#0F1F3D] rounded-lg hover:bg-[#162B50] cursor-pointer"
              >
                Open Branch Master
              </button>
            </div>
          ) : (
            <div className="space-y-3.5">
              {metrics.branchBreakdown.map((item) => {
                const widthPct =
                  item.totalPaise > 0
                    ? Math.max(4, Math.round((item.totalPaise / metrics.maxBranchPaise) * 100))
                    : 0;
                return (
                  <div key={item.branchId} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm gap-4">
                      <div className="min-w-0">
                        <span className="text-[#0F1F3D] font-medium truncate block">
                          {item.name}
                        </span>
                        {(item.totalSaleAmtPaise > 0 || item.totalSaleQty > 0) && (
                          <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                            Sale: {formatINRFromPaise(item.totalSaleAmtPaise)} · Qty:{' '}
                            {formatQty(item.totalSaleQty)}
                          </span>
                        )}
                      </div>
                      <span className="font-mono tabular-nums text-[#0F1F3D] font-semibold shrink-0">
                        {formatINRFromPaise(item.totalPaise)}
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#0F1F3D] via-[#1E3A5F] to-[#B8923A] rounded-full transition-all duration-300"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Recent Import Batches */}
        <section className="xl:col-span-5 bg-white border border-slate-200/90 rounded-xl p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <h2 className="text-base font-semibold text-[#0F1F3D]">Recent Import Batches</h2>
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="text-xs font-semibold text-[#1E3A5F] hover:underline cursor-pointer whitespace-nowrap"
            >
              View All
            </button>
          </div>

          {recentBatches.length === 0 ? (
            <div className="py-10 text-center border border-dashed border-slate-200 rounded-xl">
              <Users className="w-6 h-6 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-600">No Excel imports uploaded yet</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentBatches.map((batch) => {
                const statusColor =
                  batch.status === 'PUBLISHED'
                    ? 'text-emerald-700'
                    : batch.status === 'REJECTED' || batch.status === 'FAILED'
                      ? 'text-red-700'
                      : batch.status === 'PROCESSING'
                        ? 'text-[#1E3A5F]'
                        : 'text-amber-700';
                const batchType = batch.importType || 'DAILY';
                const periodLabel =
                  batchType === 'DAILY'
                    ? batch.periodStart || batch.businessDate
                    : `${batch.periodStart || batch.businessDate} → ${batch.periodEnd || batch.businessDate}`;
                return (
                  <div key={batch.batchId} className="py-3.5 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-[#0F1F3D] truncate">{batch.fileName}</p>
                      <span className={`text-xs font-semibold shrink-0 ${statusColor}`}>
                        {batch.status}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-semibold text-[#9A7625]">{batchType}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{periodLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span>{batch.totalRows} rows</span>
                      </div>
                      <span className="font-mono tabular-nums text-[#0F1F3D] font-medium shrink-0">
                        {formatINRFromPaise(batch.totalIncentivePaise)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
