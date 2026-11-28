import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Award,
  Building2,
  Cake,
  Check,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  FolderDown,
  Gift,
  IndianRupee,
  Lock,
  MessageSquare,
  ReceiptIndianRupee,
  Send,
  Users,
} from 'lucide-react';
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
  getCurrentMonthKeyIST,
} from '../../lib/format';
import { normalizeRecordPeriod } from '../../lib/incentiveEngine';
import { sendManagementBirthdayWish } from '../../services/birthdayService';
import { BirthdayWishingCardModal } from '../common/BirthdayWishingCardModal';
import { CompanyLetterhead } from '../common/BrandLogo';
import { AnimatedCounter } from '../common/MotionPrimitives';
import type {
  BirthdayProfile,
  Branch,
  Employee,
  EmployeeQuery,
  ImportBatch,
  MonthlySummary,
  PayrollLockSettings,
  PayoutRecord,
  PublishedIncentive,
  SalarySlip,
} from '../../types/incentive';
import type { AdminNavTab } from './AdminGlobalSearch';

interface Props {
  branches: Branch[];
  employees: Employee[];
  batches: ImportBatch[];
  incentives: PublishedIncentive[];
  monthlySummaries: MonthlySummary[];
  salarySlips?: SalarySlip[];
  payoutRecords?: PayoutRecord[];
  payrollLockSettings?: PayrollLockSettings;
  employeeQueries?: EmployeeQuery[];
  onNavigate: (tab: AdminNavTab) => void;
}

type DetailTab = 'salary' | 'incentive';

export function AdminOverview({
  branches,
  employees,
  batches,
  incentives,
  monthlySummaries,
  salarySlips = [],
  payoutRecords = [],
  payrollLockSettings,
  employeeQueries = [],
  onNavigate,
}: Props) {
  const currentMonth = getCurrentMonthKeyIST();
  const [selectedBranchId, setSelectedBranchId] = useState<string>('ALL');
  const [activeTab, setActiveTab] = useState<DetailTab>('salary');
  const [showMoreSection, setShowMoreSection] = useState<boolean>(false);

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
        text: `Official birthday wish sent to ${profile.fullName} (${profile.branchName}).`,
      });
    } catch (err) {
      setBirthdayNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to send birthday wish.',
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

  const incentiveMonthKeys = useMemo(() => {
    const set = new Set<string>();
    for (const s of activeMonthlySummaries) set.add(s.monthKey);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [activeMonthlySummaries]);

  const salaryMonthKeys = useMemo(() => {
    const set = new Set<string>();
    for (const slip of salarySlips) {
      if (slip.monthKey) set.add(slip.monthKey);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [salarySlips]);

  const availableMonths = useMemo(() => {
    const set = new Set<string>([...incentiveMonthKeys, ...salaryMonthKeys]);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [incentiveMonthKeys, salaryMonthKeys]);

  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  useEffect(() => {
    if (availableMonths.length === 0) {
      if (selectedMonth !== '') setSelectedMonth('');
      return;
    }
    if (!availableMonths.includes(selectedMonth)) {
      const monthWithBoth = availableMonths.find(
        (m) => incentiveMonthKeys.includes(m) && salaryMonthKeys.includes(m),
      );
      setSelectedMonth(monthWithBoth || availableMonths[0]);
    }
  }, [availableMonths, incentiveMonthKeys, salaryMonthKeys, selectedMonth]);

  const isSelectedMonthLocked = useMemo(
    () => Boolean(selectedMonth && payrollLockSettings?.lockedMonths?.includes(selectedMonth)),
    [selectedMonth, payrollLockSettings],
  );

  const metrics = useMemo(() => {
    // 1. INCENTIVE METRICS
    const branchFilteredIncentivesAll =
      selectedBranchId === 'ALL'
        ? activeMonthlySummaries
        : activeMonthlySummaries.filter((s) => s.branchId === selectedBranchId);

    const monthSummaries = selectedMonth
      ? branchFilteredIncentivesAll.filter((s) => s.monthKey === selectedMonth)
      : [];

    const allTimeIncentivePaise = branchFilteredIncentivesAll.reduce(
      (acc, s) => acc + s.grandTotalPaise,
      0,
    );
    const totalMonthPaise = monthSummaries.reduce((acc, s) => acc + s.grandTotalPaise, 0);
    const totalComp1Paise = monthSummaries.reduce((acc, s) => acc + s.component1TotalPaise, 0);
    const totalComp2Paise = monthSummaries.reduce((acc, s) => acc + s.component2TotalPaise, 0);
    const totalComp3Paise = monthSummaries.reduce((acc, s) => acc + s.component3TotalPaise, 0);
    const totalSaleAmt1Paise = monthSummaries.reduce(
      (acc, s) => acc + (s.saleAmt1TotalPaise || 0),
      0,
    );
    const totalSaleAmt2Paise = monthSummaries.reduce(
      (acc, s) => acc + (s.saleAmt2TotalPaise || 0),
      0,
    );
    const totalSaleAmt3Paise = monthSummaries.reduce(
      (acc, s) => acc + (s.saleAmt3TotalPaise || 0),
      0,
    );
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

    const monthPayoutMap = new Map<string, PayoutRecord>();
    for (const p of payoutRecords) {
      if (p.monthKey === selectedMonth) {
        monthPayoutMap.set(p.employeeId, p);
      }
    }
    let incentivePaidCount = 0;
    for (const s of monthSummaries) {
      const p = monthPayoutMap.get(s.employeeId);
      if (p?.status === 'PAID') {
        incentivePaidCount += 1;
      }
    }

    // 2. SALARY METRICS
    const branchFilteredSlipsAll =
      selectedBranchId === 'ALL'
        ? salarySlips
        : salarySlips.filter((slip) => slip.branchId === selectedBranchId);

    const monthSalarySlips = selectedMonth
      ? branchFilteredSlipsAll.filter((slip) => slip.monthKey === selectedMonth)
      : [];

    const allTimeNetSalaryPaise = branchFilteredSlipsAll.reduce(
      (acc, slip) => acc + (slip.netPayablePaise || 0),
      0,
    );

    let totalGrossSalaryPaise = 0;
    let totalNetSalaryPaise = 0;
    let totalOvertimePaise = 0;
    let totalEmbeddedCommissionInSlipPaise = 0;
    let totalDeductionsPaise = 0;
    let totalStatutoryPaise = 0;
    let totalAdvanceRecoveryPaise = 0;
    let bankPayablePaise = 0;
    let bankSlipsCount = 0;
    let cashPayablePaise = 0;
    let cashSlipsCount = 0;

    for (const slip of monthSalarySlips) {
      const gross = slip.grossEarningsPaise || 0;
      const net = slip.netPayablePaise || 0;
      const ot = slip.overtimePaise || 0;
      const embeddedInc = (slip.salesCommissionPaise || 0) + (slip.incentivePaise || 0);

      totalGrossSalaryPaise += gross;
      totalNetSalaryPaise += net;
      totalOvertimePaise += ot;
      totalEmbeddedCommissionInSlipPaise += embeddedInc;

      const statutory =
        (slip.pfPaise || 0) + (slip.esicPaise || 0) + (slip.ptPaise || 0) + (slip.lwfPaise || 0);
      totalStatutoryPaise += statutory;
      totalAdvanceRecoveryPaise += slip.advanceRecoveryPaise || 0;
      totalDeductionsPaise += slip.totalDeductionsPaise || 0;

      const mode = (slip.paymentMode || '').toUpperCase();
      const isCashOrDcr = mode === 'DCR' || mode === 'CASH';
      const hasBankAcct = Boolean(slip.bankAccountMasked && slip.bankAccountMasked.trim().length > 0);
      if (!isCashOrDcr && (mode === 'BANK' || mode === 'NEFT' || hasBankAcct)) {
        bankPayablePaise += net;
        bankSlipsCount += 1;
      } else {
        cashPayablePaise += net;
        cashSlipsCount += 1;
      }
    }

    const salaryStaffCount = monthSalarySlips.length;
    const publishedStaffCount = monthSummaries.length;

    const totalCombinedPayoutPaise =
      totalMonthPaise > 0
        ? Math.max(0, totalNetSalaryPaise - totalEmbeddedCommissionInSlipPaise) + totalMonthPaise
        : totalNetSalaryPaise;

    // 3. OPERATIONAL COUNTS
    const activeBranches = branches.filter((b) => b.active).length;
    const scopedEmployees =
      selectedBranchId === 'ALL'
        ? employees
        : employees.filter((e) => e.branchId === selectedBranchId);
    const activeEmployees = scopedEmployees.filter((e) => e.status === 'ACTIVE').length;
    const openQueries = employeeQueries.filter((q) => q.status !== 'RESOLVED').length;

    // 4. 12-BRANCH TABLE ROWS
    const branchTotalsMap: Record<
      string,
      {
        name: string;
        incentivePaise: number;
        totalSaleAmtPaise: number;
        incentiveStaffCount: number;
        netSalaryPaise: number;
        embeddedCommissionPaise: number;
        salaryStaffCount: number;
      }
    > = {};

    const targetBranches =
      selectedBranchId === 'ALL'
        ? branches
        : branches.filter((b) => b.branchId === selectedBranchId);

    for (const b of targetBranches) {
      branchTotalsMap[b.branchId] = {
        name: b.branchName,
        incentivePaise: 0,
        totalSaleAmtPaise: 0,
        incentiveStaffCount: 0,
        netSalaryPaise: 0,
        embeddedCommissionPaise: 0,
        salaryStaffCount: 0,
      };
    }

    for (const s of monthSummaries) {
      if (!branchTotalsMap[s.branchId]) {
        branchTotalsMap[s.branchId] = {
          name: s.branchName,
          incentivePaise: 0,
          totalSaleAmtPaise: 0,
          incentiveStaffCount: 0,
          netSalaryPaise: 0,
          embeddedCommissionPaise: 0,
          salaryStaffCount: 0,
        };
      }
      const b = branchTotalsMap[s.branchId];
      b.incentivePaise += s.grandTotalPaise;
      b.totalSaleAmtPaise +=
        s.totalSaleAmtPaise ??
        (s.saleAmt1TotalPaise || 0) + (s.saleAmt2TotalPaise || 0) + (s.saleAmt3TotalPaise || 0);
      b.incentiveStaffCount += 1;
    }

    for (const slip of monthSalarySlips) {
      if (!branchTotalsMap[slip.branchId]) {
        branchTotalsMap[slip.branchId] = {
          name: slip.branchName,
          incentivePaise: 0,
          totalSaleAmtPaise: 0,
          incentiveStaffCount: 0,
          netSalaryPaise: 0,
          embeddedCommissionPaise: 0,
          salaryStaffCount: 0,
        };
      }
      const b = branchTotalsMap[slip.branchId];
      b.netSalaryPaise += slip.netPayablePaise || 0;
      b.embeddedCommissionPaise += (slip.salesCommissionPaise || 0) + (slip.incentivePaise || 0);
      b.salaryStaffCount += 1;
    }

    const branchRows = Object.entries(branchTotalsMap)
      .map(([branchId, data]) => {
        const combinedPayoutPaise =
          data.incentivePaise > 0
            ? Math.max(0, data.netSalaryPaise - data.embeddedCommissionPaise) + data.incentivePaise
            : data.netSalaryPaise;
        return {
          branchId,
          ...data,
          combinedPayoutPaise,
        };
      })
      .sort((a, b) => b.combinedPayoutPaise - a.combinedPayoutPaise || a.name.localeCompare(b.name));

    return {
      allTimeIncentivePaise,
      totalMonthPaise,
      totalComp1Paise,
      totalOtherCompPaise: totalComp2Paise + totalComp3Paise,
      totalSaleAmt1Paise,
      totalOtherSaleAmtPaise: totalSaleAmt2Paise + totalSaleAmt3Paise,
      totalSaleAmtPaise,
      totalSaleQty,
      publishedStaffCount,
      incentivePaidCount,
      incentivePendingCount: Math.max(0, publishedStaffCount - incentivePaidCount),
      allTimeNetSalaryPaise,
      salaryStaffCount,
      totalGrossSalaryPaise,
      totalOvertimePaise,
      totalDeductionsPaise,
      totalStatutoryPaise,
      totalAdvanceRecoveryPaise,
      totalNetSalaryPaise,
      bankPayablePaise,
      bankSlipsCount,
      cashPayablePaise,
      cashSlipsCount,
      totalCombinedPayoutPaise,
      activeBranches,
      activeEmployees,
      openQueries,
      branchRows,
    };
  }, [
    branches,
    employees,
    employeeQueries,
    activeMonthlySummaries,
    salarySlips,
    payoutRecords,
    selectedMonth,
    selectedBranchId,
  ]);

  const salaryMonthSummary = useMemo(() => {
    const map = new Map<string, { monthKey: string; staffCount: number; netPaise: number }>();
    const scopedSlips =
      selectedBranchId === 'ALL'
        ? salarySlips
        : salarySlips.filter((s) => s.branchId === selectedBranchId);
    for (const s of scopedSlips) {
      const prev = map.get(s.monthKey);
      if (!prev) {
        map.set(s.monthKey, {
          monthKey: s.monthKey,
          staffCount: 1,
          netPaise: s.netPayablePaise || 0,
        });
      } else {
        prev.staffCount += 1;
        prev.netPaise += s.netPayablePaise || 0;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }, [salarySlips, selectedBranchId]);

  const recentBatches = batches.slice(0, 5);
  const selectedBranchName =
    selectedBranchId === 'ALL'
      ? 'All 12 Branches'
      : branches.find((b) => b.branchId === selectedBranchId)?.branchName || selectedBranchId;

  return (
    <div className="space-y-6">
      {/* 1. Clean Top Header — Only Branch & Month Filters */}
      <CompanyLetterhead
        documentTitle={
          selectedMonth ? `Dashboard · ${formatMonthLabel(selectedMonth)}` : 'Dashboard Overview'
        }
        subtitle={
          isSelectedMonthLocked
            ? `${selectedBranchName} · Payroll Locked`
            : selectedBranchName
        }
        rightSlot={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Select branch"
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-[#0F1F3D] max-w-[200px] focus:outline-none focus:border-[#0F1F3D]"
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
                aria-label="Select month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-[#0F1F3D] focus:outline-none focus:border-[#0F1F3D]"
              >
                {availableMonths.map((m) => {
                  const hasInc = incentiveMonthKeys.includes(m);
                  const hasSal = salaryMonthKeys.includes(m);
                  const label =
                    hasInc && hasSal
                      ? 'Salary + Incentive'
                      : hasSal
                        ? 'Salary Only'
                        : 'Incentive Only';
                  return (
                    <option key={m} value={m}>
                      {formatMonthLabel(m)} ({label})
                    </option>
                  );
                })}
              </select>
            )}
          </div>
        }
      />

      {/* Helpful 1-click notice if selected month is missing Salary or Incentive while another month has it */}
      {selectedMonth &&
        ((metrics.salaryStaffCount === 0 && salaryMonthKeys.length > 0) ||
          (metrics.publishedStaffCount === 0 && incentiveMonthKeys.length > 0)) && (
          <div className="px-4 py-3 rounded-xl bg-[#FDF8EC] border border-[#B8923A]/45 flex flex-wrap items-center justify-between gap-3 text-sm text-[#0F1F3D]">
            <span>
              <strong>{formatMonthLabel(selectedMonth)}:</strong>{' '}
              {metrics.salaryStaffCount === 0
                ? 'No salary slips uploaded for this month yet.'
                : 'No incentive data uploaded for this month yet.'}
            </span>
            <div className="flex items-center gap-2">
              {metrics.salaryStaffCount === 0 && salaryMonthKeys[0] && (
                <button
                  type="button"
                  onClick={() => setSelectedMonth(salaryMonthKeys[0])}
                  className="h-8 px-3 rounded-lg bg-[#0F1F3D] text-white text-xs font-semibold hover:bg-[#162B50] cursor-pointer whitespace-nowrap"
                >
                  View {formatMonthLabel(salaryMonthKeys[0])} Salary
                </button>
              )}
              {metrics.publishedStaffCount === 0 && incentiveMonthKeys[0] && (
                <button
                  type="button"
                  onClick={() => setSelectedMonth(incentiveMonthKeys[0])}
                  className="h-8 px-3 rounded-lg bg-[#0F1F3D] text-white text-xs font-semibold hover:bg-[#162B50] cursor-pointer whitespace-nowrap"
                >
                  View {formatMonthLabel(incentiveMonthKeys[0])} Incentives
                </button>
              )}
            </div>
          </div>
        )}

      {/* 2. TOP 3 CLEAR HERO CARDS — Total Payout, Net Salary, Total Incentive */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Total Monthly Payout (Primary Anchor) */}
        <div className="bg-[#0F1F3D] text-white rounded-xl p-5 sm:p-6 border border-[#1E3A5F] flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[#DFC27D]">Total Payout</p>
              <p className="text-xs text-slate-300 mt-0.5">Combined Salary + Incentive</p>
            </div>
            <IndianRupee className="w-5 h-5 text-[#DFC27D] shrink-0" />
          </div>

          <div>
            <p className="text-3xl font-bold tracking-tight font-mono tabular-nums text-white">
              <AnimatedCounter value={metrics.totalCombinedPayoutPaise} mode="paise" durationMs={750} />
            </p>
            <p className="text-xs text-slate-300 mt-2">
              Active Staff: <span className="font-mono tabular-nums text-white">{metrics.activeEmployees}</span>
              {' · '}
              Branches: <span className="font-mono tabular-nums text-white">{metrics.activeBranches}</span>
              {isSelectedMonthLocked && (
                <>
                  {' · '}
                  <span className="inline-flex items-center gap-1 text-[#DFC27D]">
                    <Lock className="w-3 h-3" /> Locked
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Card 2: Total Net Salary */}
        <div className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[#0F1F3D]">Total Net Salary</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {metrics.salaryStaffCount > 0
                  ? `${metrics.salaryStaffCount} staff salary slips`
                  : 'No salary slips uploaded this month'}
              </p>
            </div>
            <ReceiptIndianRupee className="w-5 h-5 text-[#B8923A] shrink-0" />
          </div>

          <div>
            <p className="text-3xl font-bold tracking-tight font-mono tabular-nums text-[#0F1F3D]">
              <AnimatedCounter value={metrics.totalNetSalaryPaise} mode="paise" durationMs={750} />
            </p>
            <div className="mt-2 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-600 font-mono tabular-nums truncate">
                Bank: {formatINRFromPaise(metrics.bankPayablePaise)} · Cash:{' '}
                {formatINRFromPaise(metrics.cashPayablePaise)}
              </span>
              <button
                type="button"
                onClick={() => onNavigate('salary')}
                className="font-semibold text-[#0F1F3D] hover:text-[#9A7625] inline-flex items-center gap-0.5 shrink-0 cursor-pointer whitespace-nowrap"
              >
                <span>Slips</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Card 3: Total Incentive */}
        <div className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[#0F1F3D]">Total Incentive</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {metrics.publishedStaffCount > 0
                  ? `${metrics.publishedStaffCount} staff · Paid: ${metrics.incentivePaidCount}`
                  : 'No incentives published this month'}
              </p>
            </div>
            <Award className="w-5 h-5 text-[#B8923A] shrink-0" />
          </div>

          <div>
            <p className="text-3xl font-bold tracking-tight font-mono tabular-nums text-[#0F1F3D]">
              <AnimatedCounter value={metrics.totalMonthPaise} mode="paise" durationMs={750} />
            </p>
            <div className="mt-2 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-600 font-mono tabular-nums truncate">
                Total Sale: {formatINRFromPaise(metrics.totalSaleAmtPaise)}
              </span>
              <button
                type="button"
                onClick={() => onNavigate('payouts')}
                className="font-semibold text-[#0F1F3D] hover:text-[#9A7625] inline-flex items-center gap-0.5 shrink-0 cursor-pointer whitespace-nowrap"
              >
                <span>Payouts</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. SINGLE SIMPLE SWITCH: Salary Details vs Incentive Details */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          {/* One clear segmented control */}
          <div
            className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100"
            role="tablist"
            aria-label="Select details view"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'salary'}
              onClick={() => setActiveTab('salary')}
              className={`h-9 px-4 rounded-md text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'salary'
                  ? 'bg-[#0F1F3D] text-white'
                  : 'text-slate-600 hover:text-[#0F1F3D]'
              }`}
            >
              Salary Details
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'incentive'}
              onClick={() => setActiveTab('incentive')}
              className={`h-9 px-4 rounded-md text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'incentive'
                  ? 'bg-[#0F1F3D] text-white'
                  : 'text-slate-600 hover:text-[#0F1F3D]'
              }`}
            >
              Incentive Details
            </button>
          </div>

          {/* Single contextual upload/action button */}
          <div className="flex items-center gap-2">
            {activeTab === 'salary' ? (
              <button
                type="button"
                onClick={() => onNavigate('salary')}
                className="h-9 px-4 rounded-lg bg-[#FDF8EC] hover:bg-[#FAF0D7] border border-[#B8923A]/55 text-xs font-semibold text-[#0F1F3D] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
              >
                <ReceiptIndianRupee className="w-4 h-4 text-[#9A7625]" />
                <span>Upload Salary Excel</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('import')}
                className="h-9 px-4 rounded-lg bg-[#FDF8EC] hover:bg-[#FAF0D7] border border-[#B8923A]/55 text-xs font-semibold text-[#0F1F3D] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4 text-[#9A7625]" />
                <span>Upload Incentive Excel</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onNavigate('branch-reports')}
              className="h-9 px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
            >
              <FolderDown className="w-4 h-4 text-slate-500" />
              <span>Branch Reports</span>
            </button>
          </div>
        </div>

        {/* Clean 4-column flat breakdown strip — no nested card boxes */}
        {activeTab === 'salary' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
            <div className="p-5">
              <p className="text-xs font-medium text-slate-500">Gross Salary</p>
              <p className="text-xl font-bold font-mono tabular-nums text-[#0F1F3D] mt-1.5">
                {formatINRFromPaise(metrics.totalGrossSalaryPaise)}
              </p>
              <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                Overtime: {formatINRFromPaise(metrics.totalOvertimePaise)}
              </p>
            </div>

            <div className="p-5">
              <p className="text-xs font-medium text-slate-500">Total Deductions</p>
              <p className="text-xl font-bold font-mono tabular-nums text-red-700 mt-1.5">
                {formatINRFromPaise(metrics.totalDeductionsPaise)}
              </p>
              <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                PF/ESIC/PT: {formatINRFromPaise(metrics.totalStatutoryPaise)} · Advance:{' '}
                {formatINRFromPaise(metrics.totalAdvanceRecoveryPaise)}
              </p>
            </div>

            <div className="p-5">
              <p className="text-xs font-medium text-slate-500">Bank Transfer</p>
              <p className="text-xl font-bold font-mono tabular-nums text-[#0F1F3D] mt-1.5">
                {formatINRFromPaise(metrics.bankPayablePaise)}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {metrics.bankSlipsCount} staff via bank
              </p>
            </div>

            <div className="p-5">
              <p className="text-xs font-medium text-slate-500">Cash Payment</p>
              <p className="text-xl font-bold font-mono tabular-nums text-[#9A7625] mt-1.5">
                {formatINRFromPaise(metrics.cashPayablePaise)}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {metrics.cashSlipsCount} staff via cash
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
            <div className="p-5">
              <p className="text-xs font-medium text-slate-500">Total Sales</p>
              <p className="text-xl font-bold font-mono tabular-nums text-[#0F1F3D] mt-1.5">
                {formatINRFromPaise(metrics.totalSaleAmtPaise)}
              </p>
              <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                Total Qty: {formatQty(metrics.totalSaleQty)}
              </p>
            </div>

            <div className="p-5">
              <p className="text-xs font-medium text-slate-500">New Items Incentive</p>
              <p className="text-xl font-bold font-mono tabular-nums text-[#0F1F3D] mt-1.5">
                {formatINRFromPaise(metrics.totalComp1Paise)}
              </p>
              <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                Sales: {formatINRFromPaise(metrics.totalSaleAmt1Paise)}
              </p>
            </div>

            <div className="p-5">
              <p className="text-xs font-medium text-slate-500">Old &amp; Other Incentive</p>
              <p className="text-xl font-bold font-mono tabular-nums text-[#0F1F3D] mt-1.5">
                {formatINRFromPaise(metrics.totalOtherCompPaise)}
              </p>
              <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                Sales: {formatINRFromPaise(metrics.totalOtherSaleAmtPaise)}
              </p>
            </div>

            <div className="p-5">
              <p className="text-xs font-medium text-slate-500">Payout Status</p>
              <p className="text-xl font-bold font-mono tabular-nums text-emerald-700 mt-1.5">
                {metrics.incentivePaidCount} / {metrics.publishedStaffCount} Paid
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Pending Staff: {metrics.incentivePendingCount}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* 4. CLEAN 12-BRANCH TABLE — One Row per Branch: Name | Salary | Incentive | Total */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#0F1F3D]">Branch-Wise Summary</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Click any branch row to filter the dashboard for that branch
            </p>
          </div>
          {selectedBranchId !== 'ALL' && (
            <button
              type="button"
              onClick={() => setSelectedBranchId('ALL')}
              className="h-8 px-3 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-[#0F1F3D] cursor-pointer"
            >
              Show All 12 Branches
            </button>
          )}
        </div>

        {metrics.branchRows.length === 0 ? (
          <div className="py-10 px-4 text-center">
            <p className="text-sm text-slate-600 mb-3">No branches configured yet.</p>
            <button
              type="button"
              onClick={() => onNavigate('branches')}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#0F1F3D] rounded-lg hover:bg-[#162B50] cursor-pointer"
            >
              Open Branch Master
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 pl-5 pr-2 w-10">#</th>
                  <th className="py-3 px-3">Branch</th>
                  <th className="py-3 px-3 text-right">Net Salary</th>
                  <th className="py-3 px-3 text-right">Incentive</th>
                  <th className="py-3 pl-3 pr-5 text-right">Total Payout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {metrics.branchRows.map((row, idx) => (
                  <tr
                    key={row.branchId}
                    onClick={() =>
                      setSelectedBranchId((prev) => (prev === row.branchId ? 'ALL' : row.branchId))
                    }
                    className={`transition-colors cursor-pointer ${
                      selectedBranchId === row.branchId
                        ? 'bg-[#FDF8EC]/80'
                        : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <td className="py-3 pl-5 pr-2 text-xs font-mono text-slate-400">
                      {String(idx + 1).padStart(2, '0')}
                    </td>
                    <td className="py-3 px-3">
                      <p className="font-semibold text-[#0F1F3D]">{row.name}</p>
                      <p className="text-xs text-slate-500">
                        Salary: {row.salaryStaffCount} staff · Incentive: {row.incentiveStaffCount}{' '}
                        staff
                      </p>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-medium text-slate-800">
                      {formatINRFromPaise(row.netSalaryPaise)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-medium text-[#9A7625]">
                      {formatINRFromPaise(row.incentivePaise)}
                    </td>
                    <td className="py-3 pl-3 pr-5 text-right font-mono tabular-nums font-bold text-[#0F1F3D]">
                      {formatINRFromPaise(row.combinedPayoutPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50/90 border-t-2 border-slate-200 text-sm font-bold text-[#0F1F3D]">
                  <td className="py-3.5 pl-5 pr-2" />
                  <td className="py-3.5 px-3">Grand Total</td>
                  <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                    {formatINRFromPaise(metrics.totalNetSalaryPaise)}
                  </td>
                  <td className="py-3.5 px-3 text-right font-mono tabular-nums text-[#9A7625]">
                    {formatINRFromPaise(metrics.totalMonthPaise)}
                  </td>
                  <td className="py-3.5 pl-3 pr-5 text-right font-mono tabular-nums">
                    {formatINRFromPaise(metrics.totalCombinedPayoutPaise)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* 5. QUICK OPERATIONAL STRIP — Clean 1-row links without clutter */}
      <div className="bg-white border border-slate-200 rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
        <button
          type="button"
          onClick={() => onNavigate('salary')}
          className="p-4 text-left hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between gap-2"
        >
          <div className="min-w-0">
            <p className="text-xs text-slate-500">All-Time Net Salary</p>
            <p className="text-base font-bold font-mono tabular-nums text-[#0F1F3D] mt-0.5 truncate">
              {formatINRFromPaise(metrics.allTimeNetSalaryPaise)}
            </p>
          </div>
          <ArrowUpRight className="w-4 h-4 text-slate-400 shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => onNavigate('analytics')}
          className="p-4 text-left hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between gap-2"
        >
          <div className="min-w-0">
            <p className="text-xs text-slate-500">All-Time Incentive</p>
            <p className="text-base font-bold font-mono tabular-nums text-[#0F1F3D] mt-0.5 truncate">
              {formatINRFromPaise(metrics.allTimeIncentivePaise)}
            </p>
          </div>
          <ArrowUpRight className="w-4 h-4 text-slate-400 shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => onNavigate('employees')}
          className="p-4 text-left hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between gap-2"
        >
          <div className="min-w-0">
            <p className="text-xs text-slate-500">Staff &amp; Branches</p>
            <p className="text-base font-bold font-mono tabular-nums text-[#0F1F3D] mt-0.5 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-slate-400 shrink-0" />
              <span>{metrics.activeEmployees} Staff</span>
              <span className="text-slate-300">·</span>
              <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
              <span>{metrics.activeBranches}</span>
            </p>
          </div>
          <ArrowUpRight className="w-4 h-4 text-slate-400 shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => onNavigate(metrics.openQueries > 0 ? 'payouts' : 'history')}
          className="p-4 text-left hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between gap-2"
        >
          <div className="min-w-0">
            <p className="text-xs text-slate-500">Employee Queries</p>
            <p className="text-base font-bold font-mono tabular-nums text-[#0F1F3D] mt-0.5 flex items-center gap-1.5">
              <MessageSquare
                className={`w-4 h-4 shrink-0 ${
                  metrics.openQueries > 0 ? 'text-amber-600' : 'text-emerald-600'
                }`}
              />
              <span>
                {metrics.openQueries > 0 ? `${metrics.openQueries} Open` : 'All Resolved'}
              </span>
            </p>
          </div>
          <ArrowUpRight className="w-4 h-4 text-slate-400 shrink-0" />
        </button>
      </div>

      {/* 6. TODAY'S BIRTHDAYS BANNER (Only shown prominently if there is a birthday today!) */}
      {birthdayOverview.today.length > 0 && (
        <section className="bg-[#FFFDF7] border border-[#B8923A]/45 rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-[#0F1F3D]">
              <Cake className="w-4 h-4 text-[#B8923A]" />
              <span>Today&apos;s Birthdays ({birthdayOverview.today.length})</span>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('employees')}
              className="text-xs font-semibold text-[#1E3A5F] hover:text-[#0F1F3D] cursor-pointer"
            >
              Manage DOBs
            </button>
          </div>

          {birthdayNotice && (
            <div
              className={`p-2.5 rounded-lg border text-xs font-medium ${
                birthdayNotice.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              {birthdayNotice.text}
            </div>
          )}

          <div className="divide-y divide-[#B8923A]/20">
            {birthdayOverview.today.map((person) => {
              const alreadyWished = Boolean(wishedEmpIds[person.employeeId]);
              return (
                <div
                  key={person.employeeId}
                  className="py-2.5 first:pt-0 last:pb-0 flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#0F1F3D]">{person.fullName}</p>
                    <p className="text-xs text-slate-600">
                      {person.branchName} · #{person.employeeId}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPreviewBirthdayCard(person)}
                      className="h-8 px-3 rounded-lg border border-[#B8923A]/45 bg-white text-xs font-semibold text-[#0F1F3D] inline-flex items-center gap-1 cursor-pointer"
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
                          <span>Send Wish</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 7. COLLAPSIBLE SECONDARY DETAILS — Recent Uploads & Upcoming Birthdays */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowMoreSection((prev) => !prev)}
          className="w-full px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <div>
            <p className="text-sm font-semibold text-[#0F1F3D]">
              Recent Uploads &amp; Upcoming Birthdays
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Salary Months: {salaryMonthSummary.length} · Incentive Files: {batches.length} ·
              Upcoming Birthdays (7 Days): {birthdayOverview.upcoming.length}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F1F3D] shrink-0">
            <span>{showMoreSection ? 'Hide' : 'View'}</span>
            {showMoreSection ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </span>
        </button>

        {showMoreSection && (
          <div className="border-t border-slate-100 p-5 grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Uploaded Salary Months */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-[#0F1F3D]">Uploaded Salary Months</p>
                <button
                  type="button"
                  onClick={() => onNavigate('salary')}
                  className="text-xs font-semibold text-[#9A7625] hover:underline cursor-pointer"
                >
                  View All
                </button>
              </div>
              {salaryMonthSummary.length === 0 ? (
                <p className="text-xs text-slate-500 py-3">No salary slips uploaded yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                  {salaryMonthSummary.slice(0, 5).map((m) => (
                    <button
                      key={m.monthKey}
                      type="button"
                      onClick={() => setSelectedMonth(m.monthKey)}
                      className={`w-full px-3 py-2.5 flex items-center justify-between text-xs text-left cursor-pointer transition-colors ${
                        m.monthKey === selectedMonth ? 'bg-[#FDF8EC]' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className="font-semibold text-[#0F1F3D]">
                        {formatMonthLabel(m.monthKey)} ({m.staffCount})
                      </span>
                      <span className="font-mono tabular-nums font-bold text-emerald-700">
                        {formatINRFromPaise(m.netPaise)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Incentive Files */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-[#0F1F3D]">Recent Incentive Files</p>
                <button
                  type="button"
                  onClick={() => onNavigate('history')}
                  className="text-xs font-semibold text-[#9A7625] hover:underline cursor-pointer"
                >
                  View All
                </button>
              </div>
              {recentBatches.length === 0 ? (
                <p className="text-xs text-slate-500 py-3">No incentive files uploaded yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                  {recentBatches.map((batch) => (
                    <div
                      key={batch.batchId}
                      className="px-3 py-2.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="font-medium text-[#0F1F3D] truncate">{batch.fileName}</span>
                      <span className="font-mono tabular-nums font-semibold text-slate-700 shrink-0">
                        {formatINRFromPaise(batch.totalIncentivePaise)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Upcoming Birthdays */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-[#0F1F3D]">Upcoming Birthdays (7 Days)</p>
                <button
                  type="button"
                  onClick={() => onNavigate('employees')}
                  className="text-xs font-semibold text-[#9A7625] hover:underline cursor-pointer"
                >
                  DOB List
                </button>
              </div>
              {birthdayOverview.upcoming.length === 0 ? (
                <p className="text-xs text-slate-500 py-3">
                  No upcoming birthdays in the next 7 days.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                  {birthdayOverview.upcoming.slice(0, 5).map((person) => (
                    <div
                      key={person.employeeId}
                      className="px-3 py-2.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-[#0F1F3D] truncate">{person.fullName}</p>
                        <p className="text-slate-500 truncate">
                          {person.branchName} ·{' '}
                          {formatBirthMonthDayLabel(person.birthMonthDay, 'en')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPreviewBirthdayCard(person)}
                        className="text-xs font-semibold text-[#9A7625] hover:underline shrink-0 cursor-pointer"
                      >
                        Card
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
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
