import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Award,
  Building2,
  Cake,
  Check,
  Clock,
  FileSpreadsheet,
  FolderDown,
  Gift,
  IndianRupee,
  Landmark,
  Lock,
  MessageSquare,
  Package,
  Percent,
  ReceiptIndianRupee,
  Send,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
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

type DashboardFocusMode = 'combined' | 'incentive' | 'salary';
type BranchComparisonMode = 'combined' | 'incentive' | 'salary';
type ActivityFeedTab = 'all' | 'salary_months' | 'incentive_batches';

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
  const prefersReduced = useReducedMotion();
  const currentMonth = getCurrentMonthKeyIST();
  const [selectedBranchId, setSelectedBranchId] = useState<string>('ALL');
  const [focusMode, setFocusMode] = useState<DashboardFocusMode>('combined');
  const [branchMode, setBranchMode] = useState<BranchComparisonMode>('combined');
  const [activityTab, setActivityTab] = useState<ActivityFeedTab>('all');

  const [previewBirthdayCard, setPreviewBirthdayCard] = useState<BirthdayProfile | null>(null);
  const [wishingEmpId, setWishingEmpId] = useState<string | null>(null);
  const [wishedEmpIds, setWishedEmpIds] = useState<Record<string, boolean>>({});
  const [birthdayNotice, setBirthdayNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null,
  );

  // Sync branch table mode automatically when user changes top focus mode
  const handleFocusModeChange = (mode: DashboardFocusMode) => {
    setFocusMode(mode);
    setBranchMode(mode);
  };

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

  // Unified list of all months that have either Published Incentives or Uploaded Salary Slips
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
      // Prefer a month that has both Incentive and Salary data if available, else newest month
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

    // Paid vs Pending Incentive Payouts for selected month & branch
    const monthPayoutMap = new Map<string, PayoutRecord>();
    for (const p of payoutRecords) {
      if (p.monthKey === selectedMonth) {
        monthPayoutMap.set(p.employeeId, p);
      }
    }
    let incentivePaidCount = 0;
    let incentivePaidPaise = 0;
    for (const s of monthSummaries) {
      const p = monthPayoutMap.get(s.employeeId);
      if (p?.status === 'PAID') {
        incentivePaidCount += 1;
        incentivePaidPaise += s.grandTotalPaise;
      }
    }

    // 2. SALARY & PAYROLL METRICS
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
    let totalBasicPlusAllowancesPaise = 0;
    let totalOvertimePaise = 0;
    let totalOvertimeHours = 0;
    let totalOvertimeDays = 0;
    let totalEmbeddedCommissionInSlipPaise = 0;

    let totalDeductionsPaise = 0;
    let totalPfPaise = 0;
    let totalEsicPaise = 0;
    let totalPtPaise = 0;
    let totalLwfPaise = 0;
    let totalAdvanceRecoveryPaise = 0;
    let totalOtherDeductionsPaise = 0;

    let bankPayablePaise = 0;
    let bankSlipsCount = 0;
    let cashDcrPayablePaise = 0;
    let cashDcrSlipsCount = 0;
    let visibleSlipsCount = 0;

    let totalPaidDays = 0;
    let totalLopDays = 0;

    for (const slip of monthSalarySlips) {
      const gross = slip.grossEarningsPaise || 0;
      const net = slip.netPayablePaise || 0;
      const ot = slip.overtimePaise || 0;
      const embeddedInc = (slip.salesCommissionPaise || 0) + (slip.incentivePaise || 0);

      totalGrossSalaryPaise += gross;
      totalNetSalaryPaise += net;
      totalOvertimePaise += ot;
      totalOvertimeHours =
        Math.round((totalOvertimeHours + (slip.overtimeHours || 0)) * 100) / 100;
      totalOvertimeDays =
        Math.round((totalOvertimeDays + (slip.overtimeDays || 0)) * 100) / 100;
      totalEmbeddedCommissionInSlipPaise += embeddedInc;
      totalBasicPlusAllowancesPaise += Math.max(0, gross - ot - embeddedInc);

      const pf = slip.pfPaise || 0;
      const esic = slip.esicPaise || 0;
      const pt = slip.ptPaise || 0;
      const lwf = slip.lwfPaise || 0;
      const adv = slip.advanceRecoveryPaise || 0;
      const ded = slip.totalDeductionsPaise || 0;

      totalPfPaise += pf;
      totalEsicPaise += esic;
      totalPtPaise += pt;
      totalLwfPaise += lwf;
      totalAdvanceRecoveryPaise += adv;
      totalDeductionsPaise += ded;
      totalOtherDeductionsPaise += Math.max(0, ded - (pf + esic + pt + lwf + adv));

      const mode = (slip.paymentMode || '').toUpperCase();
      const isCashOrDcr = mode === 'DCR' || mode === 'CASH';
      const hasBankAcct = Boolean(slip.bankAccountMasked && slip.bankAccountMasked.trim().length > 0);
      if (!isCashOrDcr && (mode === 'BANK' || mode === 'NEFT' || hasBankAcct)) {
        bankPayablePaise += net;
        bankSlipsCount += 1;
      } else {
        cashDcrPayablePaise += net;
        cashDcrSlipsCount += 1;
      }

      if (slip.employeeVisible) visibleSlipsCount += 1;
      totalPaidDays = Math.round((totalPaidDays + (slip.paidDays || 0)) * 100) / 100;
      totalLopDays = Math.round((totalLopDays + (slip.lopDays || 0)) * 100) / 100;
    }

    const totalStatutoryPaise = totalPfPaise + totalEsicPaise + totalPtPaise + totalLwfPaise;
    const salaryStaffCount = monthSalarySlips.length;

    // Deduplicated Combined Company Outflow (Salary Net + Published Incentive, subtracting embedded slip commission if published incentives exist)
    const deduplicatedCombinedPayoutPaise =
      totalMonthPaise > 0
        ? Math.max(0, totalNetSalaryPaise - totalEmbeddedCommissionInSlipPaise) + totalMonthPaise
        : totalNetSalaryPaise;

    // 3. BRANCH-WISE UNIFIED 12-BRANCH BREAKDOWN (Incentive + Sales + Salary + Deductions)
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
      {
        name: string;
        incentivePaise: number;
        totalSaleAmtPaise: number;
        totalSaleQty: number;
        incentiveStaffCount: number;
        grossSalaryPaise: number;
        deductionsPaise: number;
        netSalaryPaise: number;
        embeddedCommissionPaise: number;
        salaryStaffCount: number;
        bankNetPaise: number;
        cashDcrNetPaise: number;
        lopDays: number;
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
        totalSaleQty: 0,
        incentiveStaffCount: 0,
        grossSalaryPaise: 0,
        deductionsPaise: 0,
        netSalaryPaise: 0,
        embeddedCommissionPaise: 0,
        salaryStaffCount: 0,
        bankNetPaise: 0,
        cashDcrNetPaise: 0,
        lopDays: 0,
      };
    }

    for (const s of monthSummaries) {
      if (!branchTotalsMap[s.branchId]) {
        branchTotalsMap[s.branchId] = {
          name: s.branchName,
          incentivePaise: 0,
          totalSaleAmtPaise: 0,
          totalSaleQty: 0,
          incentiveStaffCount: 0,
          grossSalaryPaise: 0,
          deductionsPaise: 0,
          netSalaryPaise: 0,
          embeddedCommissionPaise: 0,
          salaryStaffCount: 0,
          bankNetPaise: 0,
          cashDcrNetPaise: 0,
          lopDays: 0,
        };
      }
      const b = branchTotalsMap[s.branchId];
      b.incentivePaise += s.grandTotalPaise;
      b.totalSaleAmtPaise +=
        s.totalSaleAmtPaise ??
        (s.saleAmt1TotalPaise || 0) + (s.saleAmt2TotalPaise || 0) + (s.saleAmt3TotalPaise || 0);
      b.totalSaleQty =
        Math.round(
          (b.totalSaleQty +
            (s.totalSaleQty ??
              (s.saleQty1Total || 0) + (s.saleQty2Total || 0) + (s.saleQty3Total || 0))) *
            100,
        ) / 100;
      b.incentiveStaffCount += 1;
    }

    for (const slip of monthSalarySlips) {
      if (!branchTotalsMap[slip.branchId]) {
        branchTotalsMap[slip.branchId] = {
          name: slip.branchName,
          incentivePaise: 0,
          totalSaleAmtPaise: 0,
          totalSaleQty: 0,
          incentiveStaffCount: 0,
          grossSalaryPaise: 0,
          deductionsPaise: 0,
          netSalaryPaise: 0,
          embeddedCommissionPaise: 0,
          salaryStaffCount: 0,
          bankNetPaise: 0,
          cashDcrNetPaise: 0,
          lopDays: 0,
        };
      }
      const b = branchTotalsMap[slip.branchId];
      const net = slip.netPayablePaise || 0;
      b.grossSalaryPaise += slip.grossEarningsPaise || 0;
      b.deductionsPaise += slip.totalDeductionsPaise || 0;
      b.netSalaryPaise += net;
      b.embeddedCommissionPaise += (slip.salesCommissionPaise || 0) + (slip.incentivePaise || 0);
      b.salaryStaffCount += 1;
      b.lopDays = Math.round((b.lopDays + (slip.lopDays || 0)) * 100) / 100;

      const mode = (slip.paymentMode || '').toUpperCase();
      const isCashOrDcr = mode === 'DCR' || mode === 'CASH';
      const hasBankAcct = Boolean(slip.bankAccountMasked && slip.bankAccountMasked.trim().length > 0);
      if (!isCashOrDcr && (mode === 'BANK' || mode === 'NEFT' || hasBankAcct)) {
        b.bankNetPaise += net;
      } else {
        b.cashDcrNetPaise += net;
      }
    }

    const branchBreakdown = Object.entries(branchTotalsMap)
      .map(([id, data]) => {
        const combinedPayoutPaise =
          data.incentivePaise > 0
            ? Math.max(0, data.netSalaryPaise - data.embeddedCommissionPaise) + data.incentivePaise
            : data.netSalaryPaise;
        return {
          branchId: id,
          ...data,
          combinedPayoutPaise,
        };
      })
      .sort((a, b) => {
        if (branchMode === 'salary') {
          return b.netSalaryPaise - a.netSalaryPaise || b.combinedPayoutPaise - a.combinedPayoutPaise;
        }
        if (branchMode === 'incentive') {
          return b.incentivePaise - a.incentivePaise || b.totalSaleAmtPaise - a.totalSaleAmtPaise;
        }
        return b.combinedPayoutPaise - a.combinedPayoutPaise || b.totalSaleAmtPaise - a.totalSaleAmtPaise;
      });

    const maxBranchIncentivePaise = Math.max(1, ...branchBreakdown.map((b) => b.incentivePaise));
    const maxBranchSalaryPaise = Math.max(1, ...branchBreakdown.map((b) => b.netSalaryPaise));
    const maxBranchCombinedPaise = Math.max(1, ...branchBreakdown.map((b) => b.combinedPayoutPaise));

    const incentiveRatioPct =
      totalSaleAmtPaise > 0
        ? Math.round((totalMonthPaise / totalSaleAmtPaise) * 10000) / 100
        : 0;
    const publishedStaffCount = monthSummaries.length;

    return {
      // Incentive
      allTimeIncentivePaise,
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
      incentivePaidCount,
      incentivePaidPaise,
      // Salary & Payroll
      allTimeNetSalaryPaise,
      salaryStaffCount,
      visibleSlipsCount,
      totalGrossSalaryPaise,
      totalBasicPlusAllowancesPaise,
      totalOvertimePaise,
      totalOvertimeHours,
      totalOvertimeDays,
      totalDeductionsPaise,
      totalStatutoryPaise,
      totalPfPaise,
      totalEsicPaise,
      totalPtPaise,
      totalLwfPaise,
      totalAdvanceRecoveryPaise,
      totalOtherDeductionsPaise,
      totalNetSalaryPaise,
      bankPayablePaise,
      bankSlipsCount,
      cashDcrPayablePaise,
      cashDcrSlipsCount,
      totalPaidDays,
      totalLopDays,
      // Combined
      deduplicatedCombinedPayoutPaise,
      // Operational
      activeBranches,
      activeEmployees,
      pendingBatches,
      openQueries,
      branchBreakdown,
      maxBranchIncentivePaise,
      maxBranchSalaryPaise,
      maxBranchCombinedPaise,
    };
  }, [
    branches,
    employees,
    batches,
    employeeQueries,
    activeMonthlySummaries,
    salarySlips,
    payoutRecords,
    selectedMonth,
    selectedBranchId,
    branchMode,
  ]);

  // Uploaded Salary Months Summary for Right Column Feed
  const salaryMonthBatches = useMemo(() => {
    const map = new Map<
      string,
      {
        monthKey: string;
        staffCount: number;
        visibleCount: number;
        grossPaise: number;
        deductionsPaise: number;
        netPaise: number;
        updatedAt: string;
      }
    >();
    const scopedSlips =
      selectedBranchId === 'ALL'
        ? salarySlips
        : salarySlips.filter((s) => s.branchId === selectedBranchId);

    for (const s of scopedSlips) {
      const existing = map.get(s.monthKey);
      if (!existing) {
        map.set(s.monthKey, {
          monthKey: s.monthKey,
          staffCount: 1,
          visibleCount: s.employeeVisible ? 1 : 0,
          grossPaise: s.grossEarningsPaise || 0,
          deductionsPaise: s.totalDeductionsPaise || 0,
          netPaise: s.netPayablePaise || 0,
          updatedAt: s.updatedAt || s.uploadedAt || '',
        });
      } else {
        existing.staffCount += 1;
        if (s.employeeVisible) existing.visibleCount += 1;
        existing.grossPaise += s.grossEarningsPaise || 0;
        existing.deductionsPaise += s.totalDeductionsPaise || 0;
        existing.netPaise += s.netPayablePaise || 0;
        if ((s.updatedAt || '') > existing.updatedAt) {
          existing.updatedAt = s.updatedAt;
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }, [salarySlips, selectedBranchId]);

  const recentBatches = batches.slice(0, 6);
  const latestPublishedDate =
    incentives.find((i) => i.status === 'PUBLISHED')?.businessDate || null;

  const selectedBranchName =
    selectedBranchId === 'ALL'
      ? 'All 12 Retail Branches'
      : branches.find((b) => b.branchId === selectedBranchId)?.branchName || selectedBranchId;

  return (
    <div className="space-y-6">
      {/* 1. Executive Company Identity & Unified Period + Branch + View Mode Header */}
      <CompanyLetterhead
        documentTitle={
          selectedMonth
            ? `Incentive & Salary Dashboard · ${formatMonthLabel(selectedMonth)}`
            : 'Incentive & Salary Dashboard'
        }
        subtitle={
          isSelectedMonthLocked
            ? `Payroll Locked · ${selectedBranchName}`
            : latestPublishedDate
              ? `${selectedBranchName} · Updated ${formatShortDate(latestPublishedDate)}`
              : selectedBranchName
        }
        rightSlot={
          <div className="flex flex-wrap items-center gap-2">
            {/* Focus Mode Segmented Control */}
            <div
              className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200/90"
              role="tablist"
              aria-label="Dashboard view focus"
            >
              <button
                type="button"
                role="tab"
                aria-selected={focusMode === 'combined'}
                onClick={() => handleFocusModeChange('combined')}
                className={`h-8 px-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  focusMode === 'combined'
                    ? 'bg-[#0F1F3D] text-white shadow-2xs'
                    : 'text-slate-600 hover:text-[#0F1F3D]'
                }`}
              >
                Combined (दोन्ही)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={focusMode === 'incentive'}
                onClick={() => handleFocusModeChange('incentive')}
                className={`h-8 px-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  focusMode === 'incentive'
                    ? 'bg-[#0F1F3D] text-white shadow-2xs'
                    : 'text-slate-600 hover:text-[#0F1F3D]'
                }`}
              >
                Incentive Only
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={focusMode === 'salary'}
                onClick={() => handleFocusModeChange('salary')}
                className={`h-8 px-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  focusMode === 'salary'
                    ? 'bg-[#0F1F3D] text-white shadow-2xs'
                    : 'text-slate-600 hover:text-[#0F1F3D]'
                }`}
              >
                Salary Only
              </button>
            </div>

            {/* Branch + Month Filters & Quick Upload Actions */}
            <div className="inline-flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80">
              <select
                aria-label="Filter dashboard by branch"
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800 max-w-[175px]"
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
                  className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800"
                >
                  {availableMonths.map((m) => {
                    const hasInc = incentiveMonthKeys.includes(m);
                    const hasSal = salaryMonthKeys.includes(m);
                    const tag =
                      hasInc && hasSal
                        ? 'Salary + Inc'
                        : hasSal
                          ? 'Salary'
                          : 'Incentive';
                    return (
                      <option key={m} value={m}>
                        {formatMonthLabel(m)} ({tag})
                      </option>
                    );
                  })}
                </select>
              )}
              <button
                type="button"
                onClick={() => onNavigate('import')}
                className="h-8 px-2.5 text-xs font-semibold text-white bg-[#0F1F3D] hover:bg-[#162B50] active:scale-[0.98] rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-all"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-[#DFC27D]" />
                <span>Incentive Excel</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('salary')}
                className="h-8 px-2.5 text-xs font-semibold text-[#0F1F3D] bg-[#FDF8EC] hover:bg-[#FAF0D7] border border-[#B8923A]/55 active:scale-[0.98] rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-all"
              >
                <ReceiptIndianRupee className="w-3.5 h-3.5 text-[#9A7625]" />
                <span>Salary Slips</span>
              </button>
            </div>
          </div>
        }
      />

      {/* Helpful Month Data Hint if Selected Month has only one of Salary or Incentive while another month has the other */}
      {selectedMonth &&
        ((metrics.salaryStaffCount === 0 && salaryMonthKeys.length > 0) ||
          (metrics.publishedStaffCount === 0 && incentiveMonthKeys.length > 0)) && (
          <div className="px-4 py-2.5 rounded-xl bg-[#FDF8EC] border border-[#B8923A]/45 flex flex-wrap items-center justify-between gap-2 text-xs text-[#0F1F3D]">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#9A7625] shrink-0" />
              <span>
                <strong>{formatMonthLabel(selectedMonth)}:</strong>{' '}
                {metrics.salaryStaffCount === 0
                  ? `No Salary Slips uploaded for ${formatMonthLabel(selectedMonth)} yet.`
                  : `No Published Incentives for ${formatMonthLabel(selectedMonth)} yet.`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {metrics.salaryStaffCount === 0 && salaryMonthKeys[0] && (
                <button
                  type="button"
                  onClick={() => setSelectedMonth(salaryMonthKeys[0])}
                  className="h-7 px-2.5 rounded-lg bg-[#0F1F3D] text-white font-semibold cursor-pointer hover:bg-[#162B50]"
                >
                  View {formatMonthLabel(salaryMonthKeys[0])} Salary ({salarySlips.filter((s) => s.monthKey === salaryMonthKeys[0]).length} slips)
                </button>
              )}
              {metrics.publishedStaffCount === 0 && incentiveMonthKeys[0] && (
                <button
                  type="button"
                  onClick={() => setSelectedMonth(incentiveMonthKeys[0])}
                  className="h-7 px-2.5 rounded-lg bg-[#0F1F3D] text-white font-semibold cursor-pointer hover:bg-[#162B50]"
                >
                  View {formatMonthLabel(incentiveMonthKeys[0])} Incentives
                </button>
              )}
            </div>
          </div>
        )}

      {/* 2. Primary KPI Strip — Shows Incentive Row, Salary Row, or Both Based on Focus Mode */}
      <div className="space-y-4">
        {/* ROW A: SALES & INCENTIVE KPI CARDS (4 Cards) */}
        {focusMode !== 'salary' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-xs font-bold text-[#0F1F3D] uppercase tracking-wider">
                <Award className="w-3.5 h-3.5 text-[#B8923A]" />
                <span>Sales &amp; Incentive Summary (सेल्स आणि इन्सेंटिव्ह)</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('payouts')}
                className="text-xs font-semibold text-[#1E3A5F] hover:text-[#0F1F3D] inline-flex items-center gap-1 cursor-pointer"
              >
                <span>
                  Paid: {metrics.incentivePaidCount}/{metrics.publishedStaffCount} staff
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-[#B8923A]" />
              </button>
            </div>

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
                  <p className="text-2xl sm:text-[26px] font-bold tracking-tight text-white leading-tight font-mono tabular-nums">
                    <AnimatedCounter value={metrics.totalMonthPaise} mode="paise" durationMs={900} />
                  </p>
                  <p className="text-[11px] text-slate-300 mt-1.5 font-mono tabular-nums">
                    {metrics.publishedStaffCount > 0
                      ? `${metrics.publishedStaffCount} staff · Paid: ${metrics.incentivePaidCount}`
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
                className="bg-white border border-slate-200/95 hover:border-[#0F1F3D]/30 rounded-2xl p-5 relative overflow-hidden shadow-2xs transition-colors flex flex-col justify-between gap-4"
              >
                <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-[#0F1F3D] via-[#1E3A5F] to-[#B8923A]/60" />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F1F3D]">
                      <TrendingUp className="w-3.5 h-3.5 text-[#B8923A] shrink-0" />
                      <span>Total Sale Amount</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                      {selectedBranchName}
                    </p>
                  </div>
                  <SaleAmountWaveGraphic />
                </div>

                <div>
                  <p className="text-2xl sm:text-[26px] font-bold tracking-tight text-[#0F1F3D] leading-tight font-mono tabular-nums">
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
                className="bg-white border border-slate-200/95 hover:border-[#0F1F3D]/30 rounded-2xl p-5 relative overflow-hidden shadow-2xs transition-colors flex flex-col justify-between gap-4"
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
                  <p className="text-2xl sm:text-[26px] font-bold tracking-tight text-[#0F1F3D] leading-tight font-mono tabular-nums">
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
                className="bg-white border border-slate-200/95 hover:border-[#B8923A]/60 rounded-2xl p-5 relative overflow-hidden shadow-2xs transition-colors flex flex-col justify-between gap-4"
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
                  <p className="text-2xl sm:text-[26px] font-bold tracking-tight text-[#0F1F3D] leading-tight font-mono tabular-nums">
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
          </div>
        )}

        {/* ROW B: SALARY & PAYROLL KPI CARDS (4 Cards) */}
        {focusMode !== 'incentive' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-xs font-bold text-[#0F1F3D] uppercase tracking-wider">
                <ReceiptIndianRupee className="w-3.5 h-3.5 text-[#B8923A]" />
                <span>Monthly Salary &amp; Payroll Summary (पगार व कपात तपशील)</span>
                {isSelectedMonthLocked && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800">
                    · <Lock className="w-3 h-3" /> Locked
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onNavigate('salary')}
                className="text-xs font-semibold text-[#1E3A5F] hover:text-[#0F1F3D] inline-flex items-center gap-1 cursor-pointer"
              >
                <span>
                  {metrics.salaryStaffCount > 0
                    ? `Manage ${metrics.salaryStaffCount} Salary Slips`
                    : 'Upload Monthly Salary Excel'}
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-[#B8923A]" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {/* Salary Card 1: Net Salary Payable */}
              <div className="bg-gradient-to-br from-[#0F1F3D] via-[#13264A] to-[#1A335E] text-white border border-[#1E3A5F] rounded-2xl p-5 relative overflow-hidden shadow-xs flex flex-col justify-between gap-3">
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#DFC27D] via-[#B8923A] to-[#DFC27D]" />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#DFC27D]">
                      <ReceiptIndianRupee className="w-3.5 h-3.5 shrink-0" />
                      <span>Net Salary Payable (निव्वळ पगार)</span>
                    </div>
                    <p className="text-[11px] text-slate-300 mt-0.5 truncate">
                      {selectedMonth ? formatMonthLabel(selectedMonth) : 'Current Month'} · Take-Home Pay
                    </p>
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-white/10 border border-[#DFC27D]/30 flex items-center justify-center text-[#DFC27D] shrink-0">
                    <Wallet className="w-4 h-4" />
                  </div>
                </div>

                <div>
                  <p className="text-2xl sm:text-[26px] font-bold tracking-tight text-white leading-tight font-mono tabular-nums">
                    <AnimatedCounter value={metrics.totalNetSalaryPaise} mode="paise" durationMs={900} />
                  </p>
                  <p className="text-[11px] text-slate-300 mt-1.5 font-mono tabular-nums">
                    {metrics.salaryStaffCount > 0
                      ? `${metrics.salaryStaffCount} staff slips · ${metrics.visibleSlipsCount} visible in app`
                      : 'No salary slips uploaded for this month'}
                  </p>
                </div>
              </div>

              {/* Salary Card 2: Gross Salary + Overtime */}
              <div className="bg-white border border-slate-200/95 hover:border-[#0F1F3D]/30 rounded-2xl p-5 relative overflow-hidden shadow-2xs transition-colors flex flex-col justify-between gap-3">
                <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-[#0F1F3D] via-[#1E3A5F] to-[#B8923A]/60" />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F1F3D]">
                      <IndianRupee className="w-3.5 h-3.5 text-[#B8923A] shrink-0" />
                      <span>Gross Earnings &amp; OT (एकूण पगार)</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                      Basic + Allowances + Overtime
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-2xl sm:text-[26px] font-bold tracking-tight text-[#0F1F3D] leading-tight font-mono tabular-nums">
                    <AnimatedCounter value={metrics.totalGrossSalaryPaise} mode="paise" durationMs={900} />
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1.5 font-mono tabular-nums truncate">
                    {metrics.salaryStaffCount > 0
                      ? `Overtime: ${formatINRFromPaise(metrics.totalOvertimePaise)} (${metrics.totalOvertimeDays > 0 ? `${metrics.totalOvertimeDays}d` : `${metrics.totalOvertimeHours}h`})`
                      : 'Includes Basic, HRA & OT'}
                  </p>
                </div>
              </div>

              {/* Salary Card 3: Statutory & Advance Deductions */}
              <div className="bg-white border border-slate-200/95 hover:border-[#0F1F3D]/30 rounded-2xl p-5 relative overflow-hidden shadow-2xs transition-colors flex flex-col justify-between gap-3">
                <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-[#1E3A5F] via-[#3B5B84] to-[#B8923A]/50" />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F1F3D]">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#1E3A5F] shrink-0" />
                      <span>Total Deductions (PF / ESIC / कपात)</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                      PF · ESIC · PT · Loan/Advance
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-2xl sm:text-[26px] font-bold tracking-tight text-[#0F1F3D] leading-tight font-mono tabular-nums">
                    <AnimatedCounter value={metrics.totalDeductionsPaise} mode="paise" durationMs={900} />
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1.5 font-mono tabular-nums truncate">
                    {metrics.salaryStaffCount > 0
                      ? `PF/ESIC/PT: ${formatINRFromPaise(metrics.totalStatutoryPaise)} · Adv: ${formatINRFromPaise(metrics.totalAdvanceRecoveryPaise)}`
                      : 'Statutory & Advance recovery'}
                  </p>
                </div>
              </div>

              {/* Salary Card 4: Bank NEFT vs Cash/DCR Split */}
              <div className="bg-white border border-slate-200/95 hover:border-[#B8923A]/60 rounded-2xl p-5 relative overflow-hidden shadow-2xs transition-colors flex flex-col justify-between gap-3">
                <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-[#B8923A] via-[#DFC27D] to-[#0F1F3D]" />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F1F3D]">
                      <Landmark className="w-3.5 h-3.5 text-[#B8923A] shrink-0" />
                      <span>Bank NEFT vs Cash/DCR</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                      Paid Days: {metrics.totalPaidDays} · LOP: {metrics.totalLopDays}d
                    </p>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-baseline justify-between text-xs font-mono tabular-nums">
                    <span className="text-slate-600 font-sans font-medium">
                      Bank ({metrics.bankSlipsCount}):
                    </span>
                    <span className="font-bold text-[#0F1F3D] text-sm">
                      {formatINRFromPaise(metrics.bankPayablePaise)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between text-xs font-mono tabular-nums">
                    <span className="text-slate-600 font-sans font-medium">
                      DCR/Cash ({metrics.cashDcrSlipsCount}):
                    </span>
                    <span className="font-bold text-[#9A7625] text-sm">
                      {formatINRFromPaise(metrics.cashDcrPayablePaise)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. Unified Total Monthly Payout Banner + 5 Quick-Access Operational Cards */}
      <div className="space-y-3.5">
        {/* Combined Payout Banner (Net Salary + Published Incentive) */}
        <div className="bg-white border-2 border-[#0F1F3D]/15 rounded-2xl px-4 py-3.5 sm:px-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0F1F3D] text-[#DFC27D] flex items-center justify-center shrink-0">
              <IndianRupee className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#9A7625]">
                एकूण मासिक पेआऊट (Total Monthly Payout · {selectedMonth ? formatMonthLabel(selectedMonth) : 'Current'})
              </p>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-0.5">
                <span className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-[#0F1F3D]">
                  {formatINRFromPaise(metrics.deduplicatedCombinedPayoutPaise)}
                </span>
                <span className="text-xs text-slate-600 font-mono tabular-nums">
                  = Net Salary <strong className="text-[#0F1F3D]">{formatINRFromPaise(metrics.totalNetSalaryPaise)}</strong> ({metrics.salaryStaffCount} staff) + Incentive{' '}
                  <strong className="text-[#0F1F3D]">{formatINRFromPaise(metrics.totalMonthPaise)}</strong> ({metrics.publishedStaffCount} staff)
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('branch-reports')}
              className="h-8 px-3 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <FolderDown className="w-3.5 h-3.5 text-[#DFC27D]" />
              <span>12-Branch Bank &amp; DCR Reports</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('pro-suite')}
              className="h-8 px-3 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-[#0F1F3D] inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <span>Pro P&amp;L &amp; Loans</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#B8923A]" />
            </button>
          </div>
        </div>

        {/* 5 Secondary Quick-Access Operational Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
          <button
            type="button"
            onClick={() => onNavigate('salary')}
            className="text-left bg-white border border-slate-200/95 rounded-xl p-4 hover:border-[#B8923A] hover:shadow-xs transition-all cursor-pointer group flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-600 truncate">All-Time Net Salary</p>
                <ReceiptIndianRupee className="w-4 h-4 text-[#B8923A] shrink-0" />
              </div>
              <p className="text-lg font-bold text-[#0F1F3D] mt-2 truncate font-mono tabular-nums">
                <AnimatedCounter value={metrics.allTimeNetSalaryPaise} mode="paise" durationMs={700} />
              </p>
            </div>
            <span className="mt-3 pt-2.5 border-t border-slate-100 inline-flex items-center justify-between text-[11px] font-semibold text-[#1E3A5F] group-hover:text-[#0F1F3D]">
              <span>{salaryMonthKeys.length} Salary Months</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#B8923A]" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('analytics')}
            className="text-left bg-white border border-slate-200/95 rounded-xl p-4 hover:border-[#B8923A] hover:shadow-xs transition-all cursor-pointer group flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-600 truncate">All-Time Incentive</p>
                <Award className="w-4 h-4 text-[#B8923A] shrink-0" />
              </div>
              <p className="text-lg font-bold text-[#0F1F3D] mt-2 truncate font-mono tabular-nums">
                <AnimatedCounter value={metrics.allTimeIncentivePaise} mode="paise" durationMs={700} />
              </p>
            </div>
            <span className="mt-3 pt-2.5 border-t border-slate-100 inline-flex items-center justify-between text-[11px] font-semibold text-[#1E3A5F] group-hover:text-[#0F1F3D]">
              <span>Analytics &amp; Targets</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#B8923A]" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('employees')}
            className="text-left bg-white border border-slate-200/95 rounded-xl p-4 hover:border-[#B8923A] hover:shadow-xs transition-all cursor-pointer group flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-600 truncate">Active Employees</p>
                <Users className="w-4 h-4 text-[#1E3A5F] shrink-0" />
              </div>
              <p className="text-lg font-bold text-[#0F1F3D] mt-2 font-mono tabular-nums">
                <AnimatedCounter value={metrics.activeEmployees} mode="integer" durationMs={650} />
                <span className="text-xs font-normal text-slate-400">
                  {' '}
                  / {employees.length}
                </span>
              </p>
            </div>
            <span className="mt-3 pt-2.5 border-t border-slate-100 inline-flex items-center justify-between text-[11px] font-semibold text-[#1E3A5F] group-hover:text-[#0F1F3D]">
              <span>Employee Master</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#B8923A]" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('branches')}
            className="text-left bg-white border border-slate-200/95 rounded-xl p-4 hover:border-[#B8923A] hover:shadow-xs transition-all cursor-pointer group flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-600 truncate">Retail Branches</p>
                <Building2 className="w-4 h-4 text-[#B8923A] shrink-0" />
              </div>
              <p className="text-lg font-bold text-[#0F1F3D] mt-2 font-mono tabular-nums">
                <AnimatedCounter value={metrics.activeBranches} mode="integer" durationMs={650} />
                <span className="text-xs font-normal text-slate-400">
                  {' '}
                  / {branches.length || 12}
                </span>
              </p>
            </div>
            <span className="mt-3 pt-2.5 border-t border-slate-100 inline-flex items-center justify-between text-[11px] font-semibold text-[#1E3A5F] group-hover:text-[#0F1F3D]">
              <span>Branch Master</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#B8923A]" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate(metrics.openQueries > 0 ? 'payouts' : 'history')}
            className="text-left bg-white border border-slate-200/95 rounded-xl p-4 hover:border-[#B8923A] hover:shadow-xs transition-all cursor-pointer group col-span-2 sm:col-span-1 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-600 truncate">Queries &amp; Approvals</p>
                <MessageSquare
                  className={`w-4 h-4 shrink-0 ${
                    metrics.openQueries > 0 || metrics.pendingBatches > 0
                      ? 'text-amber-600'
                      : 'text-emerald-600'
                  }`}
                />
              </div>
              <p className="text-lg font-bold text-[#0F1F3D] mt-2 font-mono tabular-nums">
                {metrics.openQueries}
                <span className="text-xs font-normal text-slate-400">
                  {' '}
                  queries · {metrics.pendingBatches} pending
                </span>
              </p>
            </div>
            <span className="mt-3 pt-2.5 border-t border-slate-100 inline-flex items-center justify-between text-[11px] font-semibold text-[#1E3A5F] group-hover:text-[#0F1F3D]">
              <span>{metrics.openQueries > 0 ? 'Resolve Queries' : 'Payouts & Batches'}</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#B8923A]" />
            </span>
          </button>
        </div>
      </div>

      {/* 4. Main Two-Column Operational Section: 12-Branch Salary + Incentive Breakdown & Recent Activity */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (section:nth-of-type(1)): Branch-Wise Salary & Incentive Distribution */}
        <section className="xl:col-span-7 bg-white border border-slate-200/95 rounded-2xl p-5 sm:p-6 shadow-2xs">
          {/* div:nth-of-type(1): Section Header & Mode Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-5 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-[#0F1F3D]">
                12-Branch Salary &amp; Incentive Breakdown
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {selectedMonth ? formatMonthLabel(selectedMonth) : 'Current Period'} ·{' '}
                {branchMode === 'combined'
                  ? 'Net Salary + Published Incentive per Branch'
                  : branchMode === 'salary'
                    ? 'Gross Salary, Deductions & Net Payable per Branch'
                    : '3-Slab Sales & Published Incentives per Branch'}
              </p>
            </div>

            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200/80 text-xs">
              <button
                type="button"
                onClick={() => setBranchMode('combined')}
                className={`h-7 px-2.5 rounded-lg font-semibold cursor-pointer transition-colors ${
                  branchMode === 'combined'
                    ? 'bg-white text-[#0F1F3D] shadow-2xs'
                    : 'text-slate-600 hover:text-[#0F1F3D]'
                }`}
              >
                Salary + Inc
              </button>
              <button
                type="button"
                onClick={() => setBranchMode('salary')}
                className={`h-7 px-2.5 rounded-lg font-semibold cursor-pointer transition-colors ${
                  branchMode === 'salary'
                    ? 'bg-white text-[#0F1F3D] shadow-2xs'
                    : 'text-slate-600 hover:text-[#0F1F3D]'
                }`}
              >
                Salary (पगार)
              </button>
              <button
                type="button"
                onClick={() => setBranchMode('incentive')}
                className={`h-7 px-2.5 rounded-lg font-semibold cursor-pointer transition-colors ${
                  branchMode === 'incentive'
                    ? 'bg-white text-[#0F1F3D] shadow-2xs'
                    : 'text-slate-600 hover:text-[#0F1F3D]'
                }`}
              >
                Incentive (सेल्स)
              </button>
            </div>
          </div>

          {/* div:nth-of-type(2): 3-Column Highlight Box (Adapts to Combined / Salary / Incentive) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-0 sm:divide-x sm:divide-slate-200/90 mb-5 p-4 rounded-xl bg-[#F8FAFC] border-2 border-[#B8923A]/55 shadow-2xs text-xs">
            {branchMode === 'incentive' ? (
              <>
                <div className="sm:pr-4">
                  <p className="text-slate-500 font-semibold">New Items Sale</p>
                  <p className="font-mono tabular-nums font-bold text-[#0F1F3D] text-base mt-1">
                    {formatINRFromPaise(metrics.totalComp1Paise)}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-1">
                    Sale: {formatINRFromPaise(metrics.totalSaleAmt1Paise)} · Qty:{' '}
                    {formatQty(metrics.totalSaleQty1)}
                  </p>
                </div>
                <div className="sm:px-4 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-200/70">
                  <p className="text-slate-500 font-semibold">Old Items Sale</p>
                  <p className="font-mono tabular-nums font-bold text-[#0F1F3D] text-base mt-1">
                    {formatINRFromPaise(metrics.totalComp2Paise)}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-1">
                    Sale: {formatINRFromPaise(metrics.totalSaleAmt2Paise)} · Qty:{' '}
                    {formatQty(metrics.totalSaleQty2)}
                  </p>
                </div>
                <div className="sm:pl-4 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-200/70">
                  <p className="text-slate-500 font-semibold">Other Items Sale</p>
                  <p className="font-mono tabular-nums font-bold text-[#0F1F3D] text-base mt-1">
                    {formatINRFromPaise(metrics.totalComp3Paise)}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-1">
                    Sale: {formatINRFromPaise(metrics.totalSaleAmt3Paise)} · Qty:{' '}
                    {formatQty(metrics.totalSaleQty3)}
                  </p>
                </div>
              </>
            ) : branchMode === 'salary' ? (
              <>
                <div className="sm:pr-4">
                  <p className="text-slate-500 font-semibold">Gross Salary (एकूण पगार)</p>
                  <p className="font-mono tabular-nums font-bold text-[#0F1F3D] text-base mt-1">
                    {formatINRFromPaise(metrics.totalGrossSalaryPaise)}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-1">
                    Basic+Allow: {formatINRFromPaise(metrics.totalBasicPlusAllowancesPaise)} · OT:{' '}
                    {formatINRFromPaise(metrics.totalOvertimePaise)}
                  </p>
                </div>
                <div className="sm:px-4 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-200/70">
                  <p className="text-slate-500 font-semibold">PF / ESIC / PT / Loan कपात</p>
                  <p className="font-mono tabular-nums font-bold text-red-700 text-base mt-1">
                    {formatINRFromPaise(metrics.totalDeductionsPaise)}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-1">
                    PF: {formatINRFromPaise(metrics.totalPfPaise)} · ESIC:{' '}
                    {formatINRFromPaise(metrics.totalEsicPaise)} · PT:{' '}
                    {formatINRFromPaise(metrics.totalPtPaise)}
                  </p>
                </div>
                <div className="sm:pl-4 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-200/70">
                  <p className="text-slate-500 font-semibold">Net Salary Payable (देय पगार)</p>
                  <p className="font-mono tabular-nums font-bold text-emerald-800 text-base mt-1">
                    {formatINRFromPaise(metrics.totalNetSalaryPaise)}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-1">
                    Bank: {formatINRFromPaise(metrics.bankPayablePaise)} · DCR:{' '}
                    {formatINRFromPaise(metrics.cashDcrPayablePaise)}
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="sm:pr-4">
                  <p className="text-slate-500 font-semibold">Net Salary (निव्वळ पगार)</p>
                  <p className="font-mono tabular-nums font-bold text-[#0F1F3D] text-base mt-1">
                    {formatINRFromPaise(metrics.totalNetSalaryPaise)}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-1">
                    {metrics.salaryStaffCount} slips · Ded:{' '}
                    {formatINRFromPaise(metrics.totalDeductionsPaise)}
                  </p>
                </div>
                <div className="sm:px-4 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-200/70">
                  <p className="text-slate-500 font-semibold">Published Incentive (इन्सेंटिव्ह)</p>
                  <p className="font-mono tabular-nums font-bold text-[#9A7625] text-base mt-1">
                    {formatINRFromPaise(metrics.totalMonthPaise)}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-1">
                    Sale: {formatINRFromPaise(metrics.totalSaleAmtPaise)} · Qty:{' '}
                    {formatQty(metrics.totalSaleQty)}
                  </p>
                </div>
                <div className="sm:pl-4 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-200/70">
                  <p className="text-slate-500 font-semibold">Total Payout (पगार + इन्सेंटिव्ह)</p>
                  <p className="font-mono tabular-nums font-bold text-emerald-800 text-base mt-1">
                    {formatINRFromPaise(metrics.deduplicatedCombinedPayoutPaise)}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-1">
                    Bank NEFT: {formatINRFromPaise(metrics.bankPayablePaise)} · DCR:{' '}
                    {formatINRFromPaise(metrics.cashDcrPayablePaise)}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* div:nth-of-type(3): 12-Branch List */}
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
            <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden bg-white">
              {metrics.branchBreakdown.map((item, idx) => {
                const primaryPaise =
                  branchMode === 'salary'
                    ? item.netSalaryPaise
                    : branchMode === 'incentive'
                      ? item.incentivePaise
                      : item.combinedPayoutPaise;
                const maxPaise =
                  branchMode === 'salary'
                    ? metrics.maxBranchSalaryPaise
                    : branchMode === 'incentive'
                      ? metrics.maxBranchIncentivePaise
                      : metrics.maxBranchCombinedPaise;
                const widthPct =
                  primaryPaise > 0 ? Math.max(4, Math.round((primaryPaise / maxPaise) * 100)) : 0;

                return (
                  <div
                    key={item.branchId}
                    className="p-3.5 hover:bg-slate-50/70 transition-colors space-y-2"
                  >
                    <div className="flex items-start justify-between text-sm gap-4">
                      <div className="min-w-0 flex items-baseline gap-2">
                        <span className="text-[11px] font-mono text-slate-400 shrink-0">
                          {String(idx + 1).padStart(2, '0')}.
                        </span>
                        <div className="min-w-0">
                          <span className="text-[#0F1F3D] font-semibold truncate block">
                            {item.name}
                          </span>

                          {branchMode === 'combined' && (
                            <span className="text-[11px] text-slate-500 font-mono tabular-nums block mt-0.5">
                              Salary: <strong className="text-slate-700">{formatINRFromPaise(item.netSalaryPaise)}</strong> ({item.salaryStaffCount}) · Inc:{' '}
                              <strong className="text-[#9A7625]">{formatINRFromPaise(item.incentivePaise)}</strong> ({item.incentiveStaffCount})
                              {item.totalSaleAmtPaise > 0
                                ? ` · Sale: ${formatINRFromPaise(item.totalSaleAmtPaise)}`
                                : ''}
                            </span>
                          )}

                          {branchMode === 'salary' && (
                            <span className="text-[11px] text-slate-500 font-mono tabular-nums block mt-0.5">
                              {item.salaryStaffCount} slips · Gross:{' '}
                              {formatINRFromPaise(item.grossSalaryPaise)} · Ded:{' '}
                              {formatINRFromPaise(item.deductionsPaise)} · Bank:{' '}
                              {formatINRFromPaise(item.bankNetPaise)} · DCR:{' '}
                              {formatINRFromPaise(item.cashDcrNetPaise)}
                            </span>
                          )}

                          {branchMode === 'incentive' && (
                            <span className="text-[11px] text-slate-500 font-mono tabular-nums block mt-0.5">
                              {item.incentiveStaffCount} staff · Sale:{' '}
                              {formatINRFromPaise(item.totalSaleAmtPaise)} · Qty:{' '}
                              {formatQty(item.totalSaleQty)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="font-mono tabular-nums text-[#0F1F3D] font-bold block">
                          {formatINRFromPaise(primaryPaise)}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {branchMode === 'combined'
                            ? 'Total Payout'
                            : branchMode === 'salary'
                              ? 'Net Salary'
                              : 'Incentive'}
                        </span>
                      </div>
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

        {/* RIGHT COLUMN (section:nth-of-type(2)): Salary Slip Months & Recent Incentive Uploads */}
        <section className="xl:col-span-5 bg-white border border-slate-200/95 rounded-2xl p-5 sm:p-6 shadow-2xs space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-[#0F1F3D]">
                Salary &amp; Incentive Uploads
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Quick view of monthly paysheets &amp; incentive batches
              </p>
            </div>

            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200/80 text-xs">
              <button
                type="button"
                onClick={() => setActivityTab('all')}
                className={`h-7 px-2.5 rounded-lg font-semibold cursor-pointer ${
                  activityTab === 'all'
                    ? 'bg-white text-[#0F1F3D] shadow-2xs'
                    : 'text-slate-600 hover:text-[#0F1F3D]'
                }`}
              >
                Both
              </button>
              <button
                type="button"
                onClick={() => setActivityTab('salary_months')}
                className={`h-7 px-2.5 rounded-lg font-semibold cursor-pointer ${
                  activityTab === 'salary_months'
                    ? 'bg-white text-[#0F1F3D] shadow-2xs'
                    : 'text-slate-600 hover:text-[#0F1F3D]'
                }`}
              >
                Salary ({salaryMonthBatches.length})
              </button>
              <button
                type="button"
                onClick={() => setActivityTab('incentive_batches')}
                className={`h-7 px-2.5 rounded-lg font-semibold cursor-pointer ${
                  activityTab === 'incentive_batches'
                    ? 'bg-white text-[#0F1F3D] shadow-2xs'
                    : 'text-slate-600 hover:text-[#0F1F3D]'
                }`}
              >
                Incentive ({recentBatches.length})
              </button>
            </div>
          </div>

          {/* 1. Uploaded Salary Slip Months List */}
          {activityTab !== 'incentive_batches' && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[#9A7625] inline-flex items-center gap-1.5">
                  <ReceiptIndianRupee className="w-3.5 h-3.5" />
                  <span>Uploaded Salary Slip Months</span>
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('salary')}
                  className="text-xs font-semibold text-[#1E3A5F] hover:text-[#0F1F3D] inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>Open Salary Slips</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-[#B8923A]" />
                </button>
              </div>

              {salaryMonthBatches.length === 0 ? (
                <div className="py-6 px-4 text-center border border-dashed border-slate-200 rounded-xl space-y-2">
                  <ReceiptIndianRupee className="w-5 h-5 text-slate-400 mx-auto" />
                  <p className="text-xs text-slate-600">
                    No monthly salary slips uploaded yet.
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate('salary')}
                    className="h-8 px-3 rounded-lg bg-[#0F1F3D] text-white text-xs font-semibold cursor-pointer hover:bg-[#162B50]"
                  >
                    Upload Monthly Paysheet
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden bg-white">
                  {salaryMonthBatches.slice(0, activityTab === 'all' ? 3 : 8).map((m) => {
                    const isCurrentSelected = m.monthKey === selectedMonth;
                    const locked = Boolean(payrollLockSettings?.lockedMonths?.includes(m.monthKey));
                    return (
                      <div
                        key={m.monthKey}
                        onClick={() => setSelectedMonth(m.monthKey)}
                        className={`p-3.5 transition-colors cursor-pointer ${
                          isCurrentSelected ? 'bg-[#FDF8EC]/80' : 'hover:bg-slate-50/70'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="text-sm font-bold text-[#0F1F3D] truncate">
                              {formatMonthLabel(m.monthKey)}
                            </p>
                            {locked && (
                              <span className="text-[11px] font-semibold text-amber-800 inline-flex items-center gap-0.5">
                                · <Lock className="w-3 h-3" /> Locked
                              </span>
                            )}
                          </div>
                          <span className="font-mono tabular-nums text-sm font-bold text-emerald-800 shrink-0">
                            {formatINRFromPaise(m.netPaise)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs text-slate-500 font-mono tabular-nums">
                          <span>
                            {m.staffCount} slips · {m.visibleCount} visible
                          </span>
                          <span>
                            Gross: {formatINRFromPaise(m.grossPaise)} · Ded:{' '}
                            {formatINRFromPaise(m.deductionsPaise)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 2. Recent Incentive Import Batches List */}
          {activityTab !== 'salary_months' && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[#0F1F3D] inline-flex items-center gap-1.5">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-[#B8923A]" />
                  <span>Recent Incentive Batches</span>
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('history')}
                  className="text-xs font-semibold text-[#1E3A5F] hover:text-[#0F1F3D] inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>View All</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-[#B8923A]" />
                </button>
              </div>

              {recentBatches.length === 0 ? (
                <div className="py-6 text-center border border-dashed border-slate-200 rounded-xl">
                  <Users className="w-5 h-5 text-slate-400 mx-auto mb-1.5" />
                  <p className="text-xs text-slate-600">No Incentive Excel imports uploaded yet</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden bg-white">
                  {recentBatches
                    .slice(0, activityTab === 'all' ? 4 : 6)
                    .map((batch) => {
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
                        <div
                          key={batch.batchId}
                          className="p-3.5 hover:bg-slate-50/70 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-[#0F1F3D] truncate">
                              {batch.fileName}
                            </p>
                            <span className={`text-xs font-bold shrink-0 ${statusColor}`}>
                              {batch.status}
                            </span>
                          </div>
                          <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono font-semibold text-[#9A7625]">
                                {batchType}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">{periodLabel}</span>
                              <span aria-hidden="true">·</span>
                              <span>{batch.totalRows} rows</span>
                            </div>
                            <span className="font-mono tabular-nums text-[#0F1F3D] font-bold shrink-0">
                              {formatINRFromPaise(batch.totalIncentivePaise)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* 5. 12-Branch Birthdays & Official Wishing Cards Operational Section */}
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
