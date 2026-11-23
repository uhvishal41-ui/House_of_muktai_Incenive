import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Award,
  Building2,
  Cake,
  Check,
  Clock,
  FileSpreadsheet,
  Gift,
  IndianRupee,
  MessageSquare,
  Package,
  Percent,
  Send,
  TrendingUp,
  Users,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import {
  BIRTHDAY_WISH_PRESETS,
  buildBirthdayProfileFromEmployee,
  formatBirthMonthDayLabel,
  getTodayIstParts,
  partitionBirthdays,
} from '../../lib/birthdayEngine';
import {
  formatINRFromPaise,
  formatMonthLabel,
  formatQty,
  formatShortDate,
  getCurrentMonthKeyIST,
} from '../../lib/format';
import { normalizeRecordPeriod } from '../../lib/incentiveEngine';
import { sendManagementBirthdayWish } from '../../services/birthdayService';
import { BirthdayWishingCardModal } from '../common/BirthdayWishingCardModal';
import { CompanyLetterhead } from '../common/BrandLogo';
import { AnimatedCounter } from '../common/MotionPrimitives';
import {
  IncentiveRatioGaugeGraphic,
  PublishedIncentiveGraphic,
  SaleAmountWaveGraphic,
  SaleQtyPillarsGraphic,
} from './DashboardMetricGraphics';
import type {
  BirthdayProfile,
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
  const prefersReduced = useReducedMotion();
  const currentMonth = getCurrentMonthKeyIST();
  const [selectedBranchId, setSelectedBranchId] = useState<string>('ALL');
  const [previewBirthdayCard, setPreviewBirthdayCard] = useState<BirthdayProfile | null>(null);
  const [wishingEmpId, setWishingEmpId] = useState<string | null>(null);
  const [wishedEmpIds, setWishedEmpIds] = useState<Record<string, boolean>>({});
  const [birthdayNotice, setBirthdayNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null,
  );

  const todayIst = useMemo(() => getTodayIstParts(), []);
  const birthdayOverview = useMemo(() => {
    const profiles: BirthdayProfile[] = [];
    for (const emp of employees) {
      const p = buildBirthdayProfileFromEmployee(emp);
      if (p) profiles.push(p);
    }
    const { today, upcoming } = partitionBirthdays(profiles, new Date(), 7);
    return { totalWithDob: profiles.length, today, upcoming };
  }, [employees]);

  const handleSendOfficialWish = async (profile: BirthdayProfile) => {
    setWishingEmpId(profile.employeeId);
    setBirthdayNotice(null);
    try {
      await sendManagementBirthdayWish({
        recipient: profile,
        message: `${BIRTHDAY_WISH_PRESETS[0].text} — Warm wishes from House of Muktai Management.`,
      });
      setWishedEmpIds((prev) => ({ ...prev, [profile.employeeId]: true }));
      setBirthdayNotice({
        type: 'ok',
        text: `Official House of Muktai Management wish delivered to ${profile.fullName} (${profile.branchName}).`,
      });
    } catch (err) {
      setBirthdayNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to send management birthday wish.',
      });
    } finally {
      setWishingEmpId(null);
    }
  };

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
    const incentiveRatioPct =
      totalSaleAmtPaise > 0
        ? Math.round((totalMonthPaise / totalSaleAmtPaise) * 10000) / 100
        : 0;
    const publishedStaffCount = monthSummaries.length;

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
      incentiveRatioPct,
      publishedStaffCount,
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

      {/* 4 Separated Primary Performance Cards with Slow Animated Executive Graphics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Card 1: Published Incentives */}
        <motion.div
          initial={prefersReduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          whileHover={prefersReduced ? undefined : { y: -2 }}
          className="bg-[#0F1F3D] text-white border border-[#1E3A5F] rounded-2xl p-5 relative overflow-hidden shadow-xs flex flex-col justify-between gap-4"
        >
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#B8923A] via-[#DFC27D] to-[#B8923A]" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#DFC27D]">
                <IndianRupee className="w-3.5 h-3.5 shrink-0" />
                <span>Published Incentive</span>
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5 truncate">
                {selectedMonth ? formatMonthLabel(selectedMonth) : 'Current Period'}
              </p>
            </div>
            <PublishedIncentiveGraphic />
          </div>

          <div>
            <p className="text-2xl sm:text-[26px] font-bold tracking-tight text-white leading-tight">
              <AnimatedCounter value={metrics.totalMonthPaise} mode="paise" durationMs={900} />
            </p>
            <p className="text-[11px] text-slate-300 mt-1.5 font-mono tabular-nums">
              {metrics.publishedStaffCount > 0
                ? `${metrics.publishedStaffCount} staff published`
                : latestPublishedDate
                  ? `Latest: ${formatShortDate(latestPublishedDate)}`
                  : 'No published batches yet'}
            </p>
          </div>
        </motion.div>

        {/* Card 2: Total Sale Amount */}
        <motion.div
          initial={prefersReduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
          whileHover={prefersReduced ? undefined : { y: -2 }}
          className="bg-white border border-slate-200/90 hover:border-[#0F1F3D]/30 rounded-2xl p-5 relative overflow-hidden shadow-2xs transition-colors flex flex-col justify-between gap-4"
        >
          <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-[#0F1F3D] via-[#1E3A5F] to-[#B8923A]/60" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F1F3D]">
                <TrendingUp className="w-3.5 h-3.5 text-[#B8923A] shrink-0" />
                <span>Total Sale Amount</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                {selectedBranchId === 'ALL' ? 'All 12 Retail Branches' : 'Selected Branch Revenue'}
              </p>
            </div>
            <SaleAmountWaveGraphic />
          </div>

          <div>
            <p className="text-2xl sm:text-[26px] font-bold tracking-tight text-[#0F1F3D] leading-tight">
              <AnimatedCounter value={metrics.totalSaleAmtPaise} mode="paise" durationMs={950} />
            </p>
            <p className="text-[11px] text-slate-500 mt-1.5 font-mono tabular-nums truncate">
              {metrics.publishedStaffCount > 0
                ? `Avg ${formatINRFromPaise(Math.round(metrics.totalSaleAmtPaise / metrics.publishedStaffCount))} / staff`
                : 'Awaiting monthly sales upload'}
            </p>
          </div>
        </motion.div>

        {/* Card 3: Total Sale Qty */}
        <motion.div
          initial={prefersReduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
          whileHover={prefersReduced ? undefined : { y: -2 }}
          className="bg-white border border-slate-200/90 hover:border-[#0F1F3D]/30 rounded-2xl p-5 relative overflow-hidden shadow-2xs transition-colors flex flex-col justify-between gap-4"
        >
          <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-[#1E3A5F] via-[#3B5B84] to-[#B8923A]/50" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F1F3D]">
                <Package className="w-3.5 h-3.5 text-[#1E3A5F] shrink-0" />
                <span>Total Sale Qty</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                Units Sold Across 3 Slabs
              </p>
            </div>
            <SaleQtyPillarsGraphic />
          </div>

          <div>
            <p className="text-2xl sm:text-[26px] font-bold tracking-tight text-[#0F1F3D] leading-tight">
              <AnimatedCounter value={metrics.totalSaleQty} mode="decimal" durationMs={950} />
            </p>
            <p className="text-[11px] text-slate-500 mt-1.5 font-mono tabular-nums truncate">
              {metrics.publishedStaffCount > 0
                ? `Avg ${formatQty(Math.round((metrics.totalSaleQty / metrics.publishedStaffCount) * 100) / 100)} qty / staff`
                : 'New · Old · Other slabs'}
            </p>
          </div>
        </motion.div>

        {/* Card 4: Incentive Ratio (% of Sale) */}
        <motion.div
          initial={prefersReduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
          whileHover={prefersReduced ? undefined : { y: -2 }}
          className="bg-white border border-slate-200/90 hover:border-[#B8923A]/60 rounded-2xl p-5 relative overflow-hidden shadow-2xs transition-colors flex flex-col justify-between gap-4"
        >
          <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-[#B8923A] via-[#DFC27D] to-[#0F1F3D]" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F1F3D]">
                <Percent className="w-3.5 h-3.5 text-[#B8923A] shrink-0" />
                <span>Incentive Ratio</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                Payout Efficiency vs Sale
              </p>
            </div>
            <IncentiveRatioGaugeGraphic ratioPct={metrics.incentiveRatioPct} />
          </div>

          <div>
            <p className="text-2xl sm:text-[26px] font-bold tracking-tight text-[#0F1F3D] leading-tight">
              <AnimatedCounter value={metrics.incentiveRatioPct} mode="percent" durationMs={1000} />
            </p>
            <p className="text-[11px] text-slate-500 mt-1.5 font-mono tabular-nums truncate">
              {metrics.totalSaleAmtPaise > 0
                ? `₹${metrics.incentiveRatioPct.toFixed(2)} paid per ₹100 sale`
                : 'Computed from published sales'}
            </p>
          </div>
        </motion.div>
      </div>

      {/* Compact Secondary Operational Summary Strip (5 Quick Access Cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <button
          type="button"
          onClick={() => onNavigate('analytics')}
          className="text-left bg-white border border-slate-200/90 rounded-xl p-4 hover:border-[#0F1F3D]/35 hover:bg-slate-50/40 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-slate-500 truncate">All-Time Incentive</p>
            <Award className="w-3.5 h-3.5 text-[#B8923A] shrink-0" />
          </div>
          <p className="text-base sm:text-lg font-bold text-[#0F1F3D] mt-1.5 truncate">
            <AnimatedCounter value={metrics.allTimeTotalPaise} mode="paise" durationMs={700} />
          </p>
          <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#1E3A5F] group-hover:underline">
            Analytics &amp; Targets
            <ArrowUpRight className="w-3 h-3" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('employees')}
          className="text-left bg-white border border-slate-200/90 rounded-xl p-4 hover:border-[#0F1F3D]/35 hover:bg-slate-50/40 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-slate-500 truncate">Active Employees</p>
            <Users className="w-3.5 h-3.5 text-[#1E3A5F] shrink-0" />
          </div>
          <p className="text-base sm:text-lg font-bold text-[#0F1F3D] mt-1.5">
            <AnimatedCounter value={metrics.activeEmployees} mode="integer" durationMs={650} />
            <span className="text-xs font-normal text-slate-400 font-mono">
              {' '}
              / {employees.length}
            </span>
          </p>
          <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#1E3A5F] group-hover:underline">
            Employee Master
            <ArrowUpRight className="w-3 h-3" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('branches')}
          className="text-left bg-white border border-slate-200/90 rounded-xl p-4 hover:border-[#0F1F3D]/35 hover:bg-slate-50/40 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-slate-500 truncate">Retail Branches</p>
            <Building2 className="w-3.5 h-3.5 text-[#B8923A] shrink-0" />
          </div>
          <p className="text-base sm:text-lg font-bold text-[#0F1F3D] mt-1.5">
            <AnimatedCounter value={metrics.activeBranches} mode="integer" durationMs={650} />
            <span className="text-xs font-normal text-slate-400 font-mono">
              {' '}
              / {branches.length || 12}
            </span>
          </p>
          <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#1E3A5F] group-hover:underline">
            Branch Master
            <ArrowUpRight className="w-3 h-3" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate(metrics.pendingBatches > 0 ? 'history' : 'import')}
          className="text-left bg-white border border-slate-200/90 rounded-xl p-4 hover:border-[#0F1F3D]/35 hover:bg-slate-50/40 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-slate-500 truncate">Pending Batches</p>
            <Clock
              className={`w-3.5 h-3.5 shrink-0 ${
                metrics.pendingBatches > 0 ? 'text-amber-600' : 'text-emerald-600'
              }`}
            />
          </div>
          <p className="text-base sm:text-lg font-bold text-[#0F1F3D] mt-1.5">
            <AnimatedCounter value={metrics.pendingBatches} mode="integer" durationMs={650} />
          </p>
          <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#1E3A5F] group-hover:underline">
            {metrics.pendingBatches > 0 ? 'Review Batches' : 'Upload Excel'}
            <ArrowUpRight className="w-3 h-3" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('payouts')}
          className="text-left bg-white border border-slate-200/90 rounded-xl p-4 hover:border-[#0F1F3D]/35 hover:bg-slate-50/40 transition-all cursor-pointer group col-span-2 sm:col-span-1"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-slate-500 truncate">Open Queries</p>
            <MessageSquare
              className={`w-3.5 h-3.5 shrink-0 ${
                metrics.openQueries > 0 ? 'text-amber-600' : 'text-emerald-600'
              }`}
            />
          </div>
          <p className="text-base sm:text-lg font-bold text-[#0F1F3D] mt-1.5">
            <AnimatedCounter value={metrics.openQueries} mode="integer" durationMs={650} />
          </p>
          <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#1E3A5F] group-hover:underline">
            {metrics.openQueries > 0 ? 'Resolve Queries' : 'Payouts Desk'}
            <ArrowUpRight className="w-3 h-3" />
          </span>
        </button>
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

      {/* 12-Branch Birthdays & Official Wishing Cards Operational Section */}
      <section className="bg-white border border-slate-200/90 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#0F1F3D] text-[#DFC27D] flex items-center justify-center shrink-0">
              <Cake className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[#0F1F3D]">
                12-Branch Birthdays &amp; Official Wishing Cards
              </h2>
              <p className="text-xs text-slate-500">
                Today: <strong className="text-[#0F1F3D]">{birthdayOverview.today.length}</strong> ·
                Next 7 Days:{' '}
                <strong className="text-[#0F1F3D]">{birthdayOverview.upcoming.length}</strong> · DOB
                Registered:{' '}
                <span className="font-mono">
                  {birthdayOverview.totalWithDob}/{metrics.activeEmployees}
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('employees')}
            className="h-9 px-3.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-[#0F1F3D] inline-flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <span>Manage DOBs &amp; Bulk Upload</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-[#B8923A]" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {birthdayNotice && (
            <div
              className={`p-3 rounded-lg border text-xs font-medium ${
                birthdayNotice.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              {birthdayNotice.text}
            </div>
          )}

          {birthdayOverview.totalWithDob === 0 ? (
            <div className="py-8 px-4 text-center border border-dashed border-slate-200 rounded-xl space-y-2">
              <p className="text-sm font-medium text-[#0F1F3D]">
                No employee Dates of Birth registered yet
              </p>
              <p className="text-xs text-slate-500 max-w-lg mx-auto">
                Upload employee DOBs in <strong>Employee Master → Bulk Birthdays (DOB)</strong> to
                automatically send Official House of Muktai Wishing Cards and display 12-branch
                celebrations inside every staff app.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Today's Celebrants */}
              <div className="space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#9A7625]">
                  Celebrating Today ({birthdayOverview.today.length})
                </p>
                {birthdayOverview.today.length === 0 ? (
                  <p className="text-xs text-slate-500 p-4 rounded-xl bg-slate-50 border border-slate-200/70">
                    No active employee birthdays today across the 12 branches.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden">
                    {birthdayOverview.today.map((person) => {
                      const alreadyWished = Boolean(wishedEmpIds[person.employeeId]);
                      return (
                        <div
                          key={person.employeeId}
                          className="p-3.5 flex flex-wrap items-center justify-between gap-3 bg-[#FFFDF7]"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#0F1F3D] truncate">
                              {person.fullName}
                            </p>
                            <p className="text-xs text-slate-500 truncate">
                              {person.branchName}
                              {person.departmentName ? ` · ${person.departmentName}` : ''} · #
                              {person.employeeId}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => setPreviewBirthdayCard(person)}
                              className="h-8 px-2.5 rounded-lg border border-[#B8923A]/40 bg-white hover:bg-[#FFFDF7] text-xs font-semibold text-[#0F1F3D] inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Gift className="w-3.5 h-3.5 text-[#B8923A]" />
                              <span>Card</span>
                            </button>
                            <button
                              type="button"
                              disabled={wishingEmpId === person.employeeId || alreadyWished}
                              onClick={() => handleSendOfficialWish(person)}
                              className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-65 ${
                                alreadyWished
                                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                                  : 'bg-[#0F1F3D] hover:bg-[#162B50] text-white'
                              }`}
                            >
                              {alreadyWished ? (
                                <>
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Wished</span>
                                </>
                              ) : (
                                <>
                                  <Send className="w-3.5 h-3.5 text-[#DFC27D]" />
                                  <span>
                                    {wishingEmpId === person.employeeId
                                      ? 'Sending...'
                                      : 'Send Mgmt Wish'}
                                  </span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Upcoming 7 Days */}
              <div className="space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Upcoming — Next 7 Days ({birthdayOverview.upcoming.length})
                </p>
                {birthdayOverview.upcoming.length === 0 ? (
                  <p className="text-xs text-slate-500 p-4 rounded-xl bg-slate-50 border border-slate-200/70">
                    No upcoming birthdays in the next 7 days.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden">
                    {birthdayOverview.upcoming.slice(0, 6).map((person) => (
                      <div
                        key={person.employeeId}
                        className="p-3.5 flex items-center justify-between gap-3 bg-white"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#0F1F3D] truncate">
                            {person.fullName}
                          </p>
                          <p className="text-xs text-slate-500 truncate">
                            {person.branchName} ·{' '}
                            <span className="font-medium text-[#9A7625]">
                              {formatBirthMonthDayLabel(person.birthMonthDay, 'en')}
                            </span>{' '}
                            ({person.daysUntil === 1 ? 'Tomorrow' : `in ${person.daysUntil} days`})
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPreviewBirthdayCard(person)}
                          className="h-8 px-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-[#0F1F3D] inline-flex items-center gap-1 shrink-0 cursor-pointer"
                        >
                          <Gift className="w-3.5 h-3.5 text-[#B8923A]" />
                          <span>Preview Card</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <BirthdayWishingCardModal
        open={Boolean(previewBirthdayCard)}
        onClose={() => setPreviewBirthdayCard(null)}
        card={
          previewBirthdayCard
            ? {
                fullName: previewBirthdayCard.fullName,
                employeeId: previewBirthdayCard.employeeId,
                branchName: previewBirthdayCard.branchName,
                departmentName: previewBirthdayCard.departmentName,
                designation: previewBirthdayCard.designation,
                photoDataUrl: previewBirthdayCard.photoDataUrl,
                birthMonthDay: previewBirthdayCard.birthMonthDay,
                celebrationYear: todayIst.year,
              }
            : null
        }
      />
    </div>
  );
}
