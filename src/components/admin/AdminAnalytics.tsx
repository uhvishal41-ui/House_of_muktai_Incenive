import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  Building2,
  Calculator,
  Crown,
  Download,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  Target,
  Trophy,
  Users,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  computeDepartmentLeaderboardsAndRanks,
  isMonthVisibleToEmployees,
  OFFICIAL_DEPARTMENTS,
} from '../../lib/departmentLeaderboardEngine';
import {
  formatINRFromPaise,
  formatMonthLabel,
  formatQty,
  getCurrentMonthKeyIST,
} from '../../lib/format';
import { normalizeRecordPeriod } from '../../lib/incentiveEngine';
import { downloadManagementBranchSummaryPdf } from '../../lib/pdfGenerator';
import { recomputeAndSaveDepartmentRankings } from '../../services/departmentVisibilityService';
import { downloadManagementExcelReport } from '../../services/operationsService';
import { BranchTargetManager } from './BranchTargetManager';
import type {
  Branch,
  Employee,
  IncentiveAdjustment,
  MonthlySummary,
  PayoutRecord,
  PortalVisibilitySettings,
  PublishedIncentive,
  SalesTarget,
} from '../../types/incentive';

interface Props {
  branches: Branch[];
  employees: Employee[];
  incentives: PublishedIncentive[];
  monthlySummaries: MonthlySummary[];
  payoutRecords: PayoutRecord[];
  adjustments: IncentiveAdjustment[];
  salesTargets: SalesTarget[];
  visibilitySettings?: PortalVisibilitySettings;
  onRefresh: () => Promise<void>;
}

type LeaderboardSort = 'saleAmt' | 'saleQty' | 'incentive';
type ChartMetric = 'saleAmt' | 'incentive';
type AnalyticsSectionKey =
  | 'overview'
  | 'leaderboard'
  | 'dept_leaders'
  | 'efficiency'
  | 'target_planner'
  | 'branch_progress'
  | 'employee_progress';

export function AdminAnalytics({
  branches,
  employees,
  incentives,
  monthlySummaries,
  payoutRecords,
  adjustments,
  salesTargets,
  visibilitySettings,
  onRefresh,
}: Props) {
  const prefersReduced = useReducedMotion();
  const [activeSection, setActiveSection] = useState<AnalyticsSectionKey>('overview');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [targetMonth, setTargetMonth] = useState<string>(() => getCurrentMonthKeyIST());
  const [selectedBranch, setSelectedBranch] = useState('ALL');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('saleAmt');
  const [leaderSort, setLeaderSort] = useState<LeaderboardSort>('saleAmt');
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [refreshingDeptBoards, setRefreshingDeptBoards] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

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
    const set = new Set<string>([getCurrentMonthKeyIST()]);
    for (const s of activeMonthlySummaries) set.add(s.monthKey);
    for (const t of salesTargets) set.add(t.monthKey);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [activeMonthlySummaries, salesTargets]);

  useEffect(() => {
    if (availableMonths.length === 0) {
      if (selectedMonth !== '') setSelectedMonth('');
      return;
    }
    if (!availableMonths.includes(selectedMonth)) {
      const latestPublished = activeMonthlySummaries
        .map((s) => s.monthKey)
        .sort((a, b) => b.localeCompare(a))[0];
      setSelectedMonth(latestPublished || availableMonths[0]);
    }
  }, [availableMonths, selectedMonth, activeMonthlySummaries]);

  const monthSummaries = useMemo(
    () => activeMonthlySummaries.filter((s) => s.monthKey === selectedMonth),
    [activeMonthlySummaries, selectedMonth],
  );

  const filteredSummaries = useMemo(
    () =>
      selectedBranch === 'ALL'
        ? monthSummaries
        : monthSummaries.filter((s) => s.branchId === selectedBranch),
    [monthSummaries, selectedBranch],
  );

  // Active adjustments map by employeeId for selectedMonth
  const adjByEmployee = useMemo(() => {
    const map = new Map<string, number>();
    for (const adj of adjustments) {
      if (adj.monthKey !== selectedMonth || adj.status !== 'ACTIVE') continue;
      const signed = adj.type === 'BONUS' ? adj.amountPaise : -adj.amountPaise;
      map.set(adj.employeeId.toUpperCase(), (map.get(adj.employeeId.toUpperCase()) || 0) + signed);
    }
    return map;
  }, [adjustments, selectedMonth]);

  // Payout map by employeeId for selectedMonth
  const payoutByEmployee = useMemo(() => {
    const map = new Map<string, PayoutRecord>();
    for (const p of payoutRecords) {
      if (p.monthKey === selectedMonth) {
        map.set(p.employeeId.toUpperCase(), p);
      }
    }
    return map;
  }, [payoutRecords, selectedMonth]);

  // Compute 12-branch analytics table
  const branchAnalytics = useMemo(() => {
    const map = new Map<
      string,
      {
        branchId: string;
        branchName: string;
        staffCount: number;
        saleAmtPaise: number;
        saleQty: number;
        c1Paise: number;
        c2Paise: number;
        c3Paise: number;
        grossIncentivePaise: number;
        adjustmentsNetPaise: number;
        netPayablePaise: number;
        paidCount: number;
      }
    >();

    for (const b of branches) {
      map.set(b.branchId, {
        branchId: b.branchId,
        branchName: b.branchName,
        staffCount: 0,
        saleAmtPaise: 0,
        saleQty: 0,
        c1Paise: 0,
        c2Paise: 0,
        c3Paise: 0,
        grossIncentivePaise: 0,
        adjustmentsNetPaise: 0,
        netPayablePaise: 0,
        paidCount: 0,
      });
    }

    for (const s of monthSummaries) {
      const existing = map.get(s.branchId) || {
        branchId: s.branchId,
        branchName: s.branchName,
        staffCount: 0,
        saleAmtPaise: 0,
        saleQty: 0,
        c1Paise: 0,
        c2Paise: 0,
        c3Paise: 0,
        grossIncentivePaise: 0,
        adjustmentsNetPaise: 0,
        netPayablePaise: 0,
        paidCount: 0,
      };
      const rowSaleAmt =
        s.totalSaleAmtPaise ??
        (s.saleAmt1TotalPaise || 0) + (s.saleAmt2TotalPaise || 0) + (s.saleAmt3TotalPaise || 0);
      const rowSaleQty =
        s.totalSaleQty ??
        Math.round(
          ((s.saleQty1Total || 0) + (s.saleQty2Total || 0) + (s.saleQty3Total || 0)) * 100,
        ) / 100;
      const adjNet = adjByEmployee.get(s.employeeId.toUpperCase()) || 0;
      const payout = payoutByEmployee.get(s.employeeId.toUpperCase());

      existing.staffCount += 1;
      existing.saleAmtPaise += rowSaleAmt;
      existing.saleQty = Math.round((existing.saleQty + rowSaleQty) * 100) / 100;
      existing.c1Paise += s.component1TotalPaise;
      existing.c2Paise += s.component2TotalPaise;
      existing.c3Paise += s.component3TotalPaise;
      existing.grossIncentivePaise += s.grandTotalPaise;
      existing.adjustmentsNetPaise += adjNet;
      existing.netPayablePaise += s.grandTotalPaise + adjNet;
      if (payout?.status === 'PAID') {
        existing.paidCount += 1;
      }
      map.set(s.branchId, existing);
    }

    return Array.from(map.values())
      .map((row) => ({
        ...row,
        incentivePct:
          row.saleAmtPaise > 0
            ? Math.round((row.grossIncentivePaise / row.saleAmtPaise) * 10000) / 100
            : 0,
        saleAmtRupees: Math.round(row.saleAmtPaise) / 100,
        grossIncentiveRupees: Math.round(row.grossIncentivePaise) / 100,
      }))
      .sort((a, b) => b.saleAmtPaise - a.saleAmtPaise || b.grossIncentivePaise - a.grossIncentivePaise);
  }, [branches, monthSummaries, adjByEmployee, payoutByEmployee]);

  // Executive KPIs for selected scope
  const kpis = useMemo(() => {
    let saleAmtPaise = 0;
    let saleQty = 0;
    let grossPaise = 0;
    let adjPaise = 0;
    let paidCount = 0;

    for (const s of filteredSummaries) {
      saleAmtPaise +=
        s.totalSaleAmtPaise ??
        (s.saleAmt1TotalPaise || 0) + (s.saleAmt2TotalPaise || 0) + (s.saleAmt3TotalPaise || 0);
      saleQty +=
        s.totalSaleQty ??
        (s.saleQty1Total || 0) + (s.saleQty2Total || 0) + (s.saleQty3Total || 0);
      grossPaise += s.grandTotalPaise;
      adjPaise += adjByEmployee.get(s.employeeId.toUpperCase()) || 0;
      if (payoutByEmployee.get(s.employeeId.toUpperCase())?.status === 'PAID') {
        paidCount += 1;
      }
    }

    const incentivePct = saleAmtPaise > 0 ? (grossPaise / saleAmtPaise) * 100 : 0;
    return {
      saleAmtPaise,
      saleQty: Math.round(saleQty * 100) / 100,
      grossPaise,
      adjPaise,
      netPayablePaise: grossPaise + adjPaise,
      incentivePct,
      staffCount: filteredSummaries.length,
      paidCount,
    };
  }, [filteredSummaries, adjByEmployee, payoutByEmployee]);

  // 6-Month Company Trend data
  const sixMonthTrend = useMemo(() => {
    const map = new Map<string, { monthKey: string; saleAmtPaise: number; incentivePaise: number }>();
    for (const s of monthlySummaries) {
      if (selectedBranch !== 'ALL' && s.branchId !== selectedBranch) continue;
      const cur = map.get(s.monthKey) || { monthKey: s.monthKey, saleAmtPaise: 0, incentivePaise: 0 };
      cur.saleAmtPaise +=
        s.totalSaleAmtPaise ??
        (s.saleAmt1TotalPaise || 0) + (s.saleAmt2TotalPaise || 0) + (s.saleAmt3TotalPaise || 0);
      cur.incentivePaise += s.grandTotalPaise;
      map.set(s.monthKey, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .slice(-6)
      .map((item) => ({
        monthLabel: formatMonthLabel(item.monthKey).replace(/\s+\d{4}$/, ''),
        monthKey: item.monthKey,
        saleAmtLakhs: Math.round((item.saleAmtPaise / 100 / 100000) * 100) / 100,
        saleAmtRupees: Math.round(item.saleAmtPaise) / 100,
        incentiveRupees: Math.round(item.incentivePaise) / 100,
      }));
  }, [monthlySummaries, selectedBranch]);

  // Top Performers Leaderboard
  const leaderboard = useMemo(() => {
    const enriched = filteredSummaries.map((s) => {
      const saleAmtPaise =
        s.totalSaleAmtPaise ??
        (s.saleAmt1TotalPaise || 0) + (s.saleAmt2TotalPaise || 0) + (s.saleAmt3TotalPaise || 0);
      const saleQty =
        s.totalSaleQty ??
        Math.round(
          ((s.saleQty1Total || 0) + (s.saleQty2Total || 0) + (s.saleQty3Total || 0)) * 100,
        ) / 100;
      const incPct = saleAmtPaise > 0 ? (s.grandTotalPaise / saleAmtPaise) * 100 : 0;
      return {
        ...s,
        saleAmtPaise,
        saleQty,
        incPct,
      };
    });
    enriched.sort((a, b) => {
      if (leaderSort === 'saleAmt') return b.saleAmtPaise - a.saleAmtPaise || b.grandTotalPaise - a.grandTotalPaise;
      if (leaderSort === 'saleQty') return b.saleQty - a.saleQty || b.grandTotalPaise - a.grandTotalPaise;
      return b.grandTotalPaise - a.grandTotalPaise;
    });
    return enriched.slice(0, selectedBranch === 'ALL' ? 10 : 5);
  }, [filteredSummaries, leaderSort, selectedBranch]);

  // Zero-Sale & Low-Performer Alerts
  const lowPerformerAlerts = useMemo(() => {
    const activeEmployees = employees.filter(
      (e) => e.status === 'ACTIVE' && (selectedBranch === 'ALL' || e.branchId === selectedBranch),
    );
    const summaryByEmp = new Map<string, MonthlySummary>();
    for (const s of monthSummaries) {
      summaryByEmp.set(s.employeeId.toUpperCase(), s);
    }

    // Branch average sale & incentive among staff with positive sales
    const branchAvgMap = new Map<string, { avgSalePaise: number; avgIncPaise: number }>();
    for (const b of branchAnalytics) {
      const activeWithData = b.staffCount || 0;
      branchAvgMap.set(b.branchId, {
        avgSalePaise: activeWithData > 0 ? Math.round(b.saleAmtPaise / activeWithData) : 0,
        avgIncPaise: activeWithData > 0 ? Math.round(b.grossIncentivePaise / activeWithData) : 0,
      });
    }

    const alerts: Array<{
      employee: Employee;
      saleAmtPaise: number;
      saleQty: number;
      incentivePaise: number;
      branchAvgSalePaise: number;
      flag: 'ZERO_SALE' | 'BELOW_50_PCT';
    }> = [];

    for (const emp of activeEmployees) {
      const sum = summaryByEmp.get(emp.employeeId.toUpperCase());
      const saleAmtPaise = sum
        ? sum.totalSaleAmtPaise ??
          (sum.saleAmt1TotalPaise || 0) +
            (sum.saleAmt2TotalPaise || 0) +
            (sum.saleAmt3TotalPaise || 0)
        : 0;
      const saleQty = sum
        ? sum.totalSaleQty ??
          (sum.saleQty1Total || 0) + (sum.saleQty2Total || 0) + (sum.saleQty3Total || 0)
        : 0;
      const incentivePaise = sum?.grandTotalPaise || 0;
      const avg = branchAvgMap.get(emp.branchId) || { avgSalePaise: 0, avgIncPaise: 0 };

      if (saleAmtPaise === 0 && incentivePaise === 0) {
        alerts.push({
          employee: emp,
          saleAmtPaise,
          saleQty,
          incentivePaise,
          branchAvgSalePaise: avg.avgSalePaise,
          flag: 'ZERO_SALE',
        });
      } else if (
        (avg.avgSalePaise > 0 && saleAmtPaise < avg.avgSalePaise * 0.5) ||
        (avg.avgSalePaise === 0 && avg.avgIncPaise > 0 && incentivePaise < avg.avgIncPaise * 0.5)
      ) {
        alerts.push({
          employee: emp,
          saleAmtPaise,
          saleQty,
          incentivePaise,
          branchAvgSalePaise: avg.avgSalePaise,
          flag: 'BELOW_50_PCT',
        });
      }
    }

    return alerts.sort((a, b) => {
      if (a.flag !== b.flag) return a.flag === 'ZERO_SALE' ? -1 : 1;
      return a.saleAmtPaise - b.saleAmtPaise;
    });
  }, [employees, monthSummaries, branchAnalytics, selectedBranch]);

  const handleDownloadXlsx = async () => {
    setExportingXlsx(true);
    setFeedback(null);
    try {
      await downloadManagementExcelReport({
        monthKey: selectedMonth,
        monthLabel: formatMonthLabel(selectedMonth),
        branchRows: branchAnalytics.map((b) => ({
          branchName: b.branchName,
          staffCount: b.staffCount,
          totalSaleAmtRupees: Math.round(b.saleAmtPaise) / 100,
          totalSaleQty: b.saleQty,
          newItemsIncRupees: Math.round(b.c1Paise) / 100,
          oldItemsIncRupees: Math.round(b.c2Paise) / 100,
          otherItemsIncRupees: Math.round(b.c3Paise) / 100,
          grossIncentiveRupees: Math.round(b.grossIncentivePaise) / 100,
          incentivePctOfSale: b.incentivePct,
          adjustmentsNetRupees: Math.round(b.adjustmentsNetPaise) / 100,
          netPayableRupees: Math.round(b.netPayablePaise) / 100,
          paidCount: b.paidCount,
        })),
        employeeRows: filteredSummaries.map((s) => {
          const adjNet = adjByEmployee.get(s.employeeId.toUpperCase()) || 0;
          const payout = payoutByEmployee.get(s.employeeId.toUpperCase());
          const totalSaleAmt =
            s.totalSaleAmtPaise ??
            (s.saleAmt1TotalPaise || 0) +
              (s.saleAmt2TotalPaise || 0) +
              (s.saleAmt3TotalPaise || 0);
          const totalSaleQty =
            s.totalSaleQty ??
            Math.round(
              ((s.saleQty1Total || 0) + (s.saleQty2Total || 0) + (s.saleQty3Total || 0)) * 100,
            ) / 100;
          return {
            branchName: s.branchName,
            employeeId: s.employeeId,
            employeeName: s.employeeName,
            saleAmt1Rupees: Math.round(s.saleAmt1TotalPaise || 0) / 100,
            saleQty1: s.saleQty1Total || 0,
            inc1Rupees: Math.round(s.component1TotalPaise) / 100,
            saleAmt2Rupees: Math.round(s.saleAmt2TotalPaise || 0) / 100,
            saleQty2: s.saleQty2Total || 0,
            inc2Rupees: Math.round(s.component2TotalPaise) / 100,
            saleAmt3Rupees: Math.round(s.saleAmt3TotalPaise || 0) / 100,
            saleQty3: s.saleQty3Total || 0,
            inc3Rupees: Math.round(s.component3TotalPaise) / 100,
            totalSaleAmtRupees: Math.round(totalSaleAmt) / 100,
            totalSaleQty,
            grossIncentiveRupees: Math.round(s.grandTotalPaise) / 100,
            adjustmentsNetRupees: Math.round(adjNet) / 100,
            netPayableRupees: Math.round(s.grandTotalPaise + adjNet) / 100,
            payoutStatus: payout?.status || 'UNPAID',
            paymentMode: payout?.paymentMode || '',
            paymentReference: payout?.paymentReference || '',
          };
        }),
      });
      setFeedback({
        type: 'ok',
        text: `Downloaded formatted 2-sheet Excel report for ${formatMonthLabel(selectedMonth)}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to export Excel report.',
      });
    } finally {
      setExportingXlsx(false);
    }
  };

  const handleDownloadPdfSummary = () => {
    downloadManagementBranchSummaryPdf({
      monthKey: selectedMonth,
      rows: branchAnalytics.map((b) => ({
        branchName: b.branchName,
        staffCount: b.staffCount,
        saleAmtPaise: b.saleAmtPaise,
        saleQty: b.saleQty,
        grossIncentivePaise: b.grossIncentivePaise,
        adjustmentsNetPaise: b.adjustmentsNetPaise,
        netPayablePaise: b.netPayablePaise,
        paidCount: b.paidCount,
        incentivePct: b.incentivePct,
      })),
    });
  };

  const handleExportAlertsCsv = () => {
    const header = 'Month,Branch,Employee ID,Employee Name,Sale Amt (Rs),Sale Qty,Incentive (Rs),Alert Flag';
    const lines = lowPerformerAlerts.map((a) =>
      [
        selectedMonth,
        `"${a.employee.branchName.replace(/"/g, '""')}"`,
        a.employee.employeeId,
        `"${a.employee.fullName.replace(/"/g, '""')}"`,
        (a.saleAmtPaise / 100).toFixed(2),
        a.saleQty,
        (a.incentivePaise / 100).toFixed(2),
        a.flag === 'ZERO_SALE' ? 'Zero Sale / Zero Incentive' : 'Below 50% Branch Avg',
      ].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `house-of-muktai-low-performers-${selectedMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Live counts for the 3 Target Hub buttons (synced with targetMonth)
  const targetStats = useMemo(() => {
    const forMonth = salesTargets.filter((t) => t.monthKey === targetMonth);
    const branchIds = new Set<string>();
    let staffCount = 0;
    for (const t of forMonth) {
      branchIds.add(t.branchId);
      if (t.scope === 'EMPLOYEE') staffCount += 1;
    }
    return {
      branchCount: branchIds.size,
      staffCount,
    };
  }, [salesTargets, targetMonth]);

  const shortTargetMonth = formatMonthLabel(targetMonth);

  // Live 5-Department Cross-Branch Top-3 Sales Leaderboards preview for selectedMonth
  const deptLeaderboardPreview = useMemo(() => {
    if (!selectedMonth) return { leaderboards: [], employeeRanks: [] };
    return computeDepartmentLeaderboardsAndRanks({
      monthKey: selectedMonth,
      employees,
      incentives,
      employeeVisible: isMonthVisibleToEmployees(selectedMonth, visibilitySettings),
      updatedByEmail: 'admin',
      now: '',
    });
  }, [selectedMonth, employees, incentives, visibilitySettings]);

  const deptAssignedActiveCount = useMemo(
    () => employees.filter((e) => e.status === 'ACTIVE' && Boolean(e.departmentId)).length,
    [employees],
  );

  const handlePublishDepartmentRankings = async () => {
    if (!selectedMonth) return;
    setRefreshingDeptBoards(true);
    setFeedback(null);
    try {
      const res = await recomputeAndSaveDepartmentRankings({
        monthKeys: [selectedMonth],
        employees,
        incentives,
        visibilitySettings,
      });
      setFeedback({
        type: 'ok',
        text: `Published 5-Department Top-3 Sales Leaderboards for ${formatMonthLabel(selectedMonth)} (${res.leaderboardsWritten} dept boards, ${res.employeeRanksWritten} personal employee ranks synced to staff mobile app).`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to publish department sales leaderboards.',
      });
    } finally {
      setRefreshingDeptBoards(false);
    }
  };

  const sectionNavButtons: Array<{
    key: AnalyticsSectionKey;
    label: string;
    sublabel: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      key: 'overview',
      label: 'Charts & Alerts',
      sublabel: `${branches.length} branches · ${lowPerformerAlerts.length} alerts`,
      icon: BarChart3,
    },
    {
      key: 'leaderboard',
      label: 'Top Performers',
      sublabel: `Top ${leaderboard.length} leaderboard`,
      icon: Award,
    },
    {
      key: 'dept_leaders',
      label: 'Department Leaders',
      sublabel: `${OFFICIAL_DEPARTMENTS.length} departments · Top 3 Sales`,
      icon: Trophy,
    },
    {
      key: 'efficiency',
      label: 'Branch Efficiency',
      sublabel: `${kpis.incentivePct.toFixed(2)}% incentive-to-sale`,
      icon: Building2,
    },
    {
      key: 'target_planner',
      label: 'Growth Targets',
      sublabel: `Set ${shortTargetMonth} (+%)`,
      icon: Calculator,
    },
    {
      key: 'branch_progress',
      label: 'Branch Progress',
      sublabel: `${targetStats.branchCount} branch${targetStats.branchCount === 1 ? '' : 'es'} tracked`,
      icon: Target,
    },
    {
      key: 'employee_progress',
      label: 'Employee Progress',
      sublabel: `${targetStats.staffCount} staff live`,
      icon: Users,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Filter & Export Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Select analytics month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            disabled={availableMonths.length === 0}
            className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-800 disabled:opacity-60"
          >
            {availableMonths.length === 0 ? (
              <option value="">No Published Months</option>
            ) : (
              availableMonths.map((m) => (
                <option key={m} value={m}>
                  {formatMonthLabel(m)}
                </option>
              ))
            )}
          </select>
          <select
            aria-label="Filter analytics by branch"
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-800"
          >
            <option value="ALL">All Branches ({branches.length})</option>
            {branches.map((b) => (
              <option key={b.branchId} value={b.branchId}>
                {b.branchName}
              </option>
            ))}
          </select>
        </div>

        <div className="inline-flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 self-start lg:self-auto">
          <button
            type="button"
            disabled={exportingXlsx || monthSummaries.length === 0}
            onClick={handleDownloadXlsx}
            className="h-8 px-3 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            {exportingXlsx ? 'Building...' : 'Excel (.xlsx)'}
          </button>
          <button
            type="button"
            disabled={monthSummaries.length === 0}
            onClick={handleDownloadPdfSummary}
            className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Branch PDF
          </button>
        </div>
      </div>

      {/* Professional Animated Hub Switcher — Instant 1-Click Access Without Long Scrolling */}
      <nav
        aria-label="Analytics and Targets sections"
        className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2.5"
      >
        {sectionNavButtons.map((btn) => {
          const Icon = btn.icon;
          const isActive = activeSection === btn.key;
          return (
            <motion.button
              key={btn.key}
              type="button"
              onClick={() => setActiveSection(btn.key)}
              whileHover={prefersReduced ? undefined : { y: -2 }}
              whileTap={prefersReduced ? undefined : { scale: 0.985 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              aria-pressed={isActive}
              className={`relative text-left rounded-xl px-3.5 py-3 min-h-[68px] border transition-colors cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F1F3D]/40 ${
                isActive
                  ? 'border-[#0F1F3D] text-white shadow-sm'
                  : 'border-slate-200/90 bg-white text-slate-800 hover:border-[#0F1F3D]/35 hover:bg-slate-50/70'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="analyticsHubActiveBg"
                  transition={{ type: 'spring', stiffness: 360, damping: 32 }}
                  className="absolute inset-0 bg-[#0F1F3D]"
                >
                  <div className="absolute bottom-0 inset-x-0 h-[3px] bg-gradient-to-r from-[#B8923A] via-[#DFC27D] to-[#B8923A]" />
                </motion.div>
              )}

              <div className="relative z-10 flex items-start gap-2.5">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                    isActive
                      ? 'bg-white/12 text-[#DFC27D] border border-[#DFC27D]/30'
                      : 'bg-slate-100 text-[#0F1F3D]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-xs font-semibold leading-snug truncate ${
                      isActive ? 'text-white' : 'text-[#0F1F3D]'
                    }`}
                  >
                    {btn.label}
                  </p>
                  <p
                    className={`text-[11px] font-mono tabular-nums mt-0.5 truncate ${
                      isActive ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    {btn.sublabel}
                  </p>
                </div>
              </div>
            </motion.button>
          );
        })}
      </nav>

      {feedback && (
        <div
          className={`p-3.5 rounded-lg border text-sm ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Animated Active Module Viewport */}
      <AnimatePresence mode="wait">
        {activeSection === 'overview' && (
          <motion.div
            key="analytics-overview"
            initial={prefersReduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-6"
          >

      {/* Executive KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500 font-medium">Total Sale Amount</p>
          <p className="text-xl font-semibold font-mono tabular-nums text-slate-900 mt-1.5">
            {formatINRFromPaise(kpis.saleAmtPaise)}
          </p>
          <p className="text-xs text-slate-500 font-mono tabular-nums mt-1">
            Qty: {formatQty(kpis.saleQty)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500 font-medium">Gross Incentive</p>
          <p className="text-xl font-semibold font-mono tabular-nums text-[#0F1F3D] mt-1.5">
            {formatINRFromPaise(kpis.grossPaise)}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {kpis.staffCount} staff published
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500 font-medium">Incentive % of Sale</p>
          <p className="text-xl font-semibold font-mono tabular-nums text-slate-900 mt-1.5">
            {kpis.incentivePct.toFixed(2)}%
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Payout efficiency ratio
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500 font-medium">Net Payable</p>
          <p className="text-xl font-semibold font-mono tabular-nums text-slate-900 mt-1.5">
            {formatINRFromPaise(kpis.netPayablePaise)}
          </p>
          <p className="text-xs font-mono tabular-nums text-slate-500 mt-1">
            Adj: {kpis.adjPaise >= 0 ? '+' : ''}
            {formatINRFromPaise(kpis.adjPaise)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500 font-medium">Payout Settled</p>
          <p className="text-xl font-semibold font-mono tabular-nums text-emerald-700 mt-1.5">
            {kpis.paidCount} / {kpis.staffCount}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {kpis.staffCount > 0 ? Math.round((kpis.paidCount / kpis.staffCount) * 100) : 0}% marked Paid
          </p>
        </div>
      </div>

      {/* Charts Row: 12-Branch Comparison + 6-Month Trend */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                12-Branch Performance Comparison
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {formatMonthLabel(selectedMonth)} · Sorted highest to lowest
              </p>
            </div>
            <div className="inline-flex p-0.5 bg-slate-100 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setChartMetric('saleAmt')}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                  chartMetric === 'saleAmt'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                Sale Amount
              </button>
              <button
                type="button"
                onClick={() => setChartMetric('incentive')}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                  chartMetric === 'incentive'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                Incentive
              </button>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={branchAnalytics}
                margin={{ top: 8, right: 12, left: 4, bottom: 42 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis
                  dataKey="branchName"
                  tick={{ fontSize: 10, fill: '#475569' }}
                  angle={-30}
                  textAnchor="end"
                  interval={0}
                  height={56}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  tickFormatter={(v) =>
                    v >= 100000
                      ? `₹${(v / 100000).toFixed(1)}L`
                      : v >= 1000
                        ? `₹${(v / 1000).toFixed(0)}k`
                        : `₹${v}`
                  }
                />
                <Tooltip
                  formatter={(value) => [
                    `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
                    chartMetric === 'saleAmt' ? 'Total Sale Amt' : 'Gross Incentive',
                  ]}
                  contentStyle={{
                    borderRadius: '8px',
                    border: '1px solid #E2E8F0',
                    fontSize: '12px',
                  }}
                />
                <Bar
                  dataKey={chartMetric === 'saleAmt' ? 'saleAmtRupees' : 'grossIncentiveRupees'}
                  fill={chartMetric === 'saleAmt' ? '#0F1F3D' : '#B8923A'}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">6-Month Incentive Trend</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Month-over-month published incentive progression
            </p>
          </div>
          {sixMonthTrend.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-xs text-slate-500">
              Publish monthly data to see trend charts.
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={sixMonthTrend}
                  margin={{ top: 8, right: 12, left: 4, bottom: 10 }}
                >
                  <defs>
                    <linearGradient id="muktaiIncGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0F1F3D" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="#0F1F3D" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="monthLabel" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickFormatter={(v) => (v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`)}
                  />
                  <Tooltip
                    formatter={(value) => [
                      `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
                      'Gross Incentive',
                    ]}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #E2E8F0',
                      fontSize: '12px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="incentiveRupees"
                    stroke="#0F1F3D"
                    strokeWidth={2}
                    fill="url(#muktaiIncGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      {/* Zero-Sale & Low-Performer Alerts */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Zero-Sale &amp; Low-Performer Alerts ({lowPerformerAlerts.length})
              </h2>
              <p className="text-xs text-slate-500">
                Active staff with ₹0 published sale or below 50% of branch average in{' '}
                {formatMonthLabel(selectedMonth)}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={lowPerformerAlerts.length === 0}
            onClick={handleExportAlertsCsv}
            className="h-8 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer self-start sm:self-auto"
          >
            <Download className="w-3.5 h-3.5" />
            Export Alert CSV
          </button>
        </div>

        {lowPerformerAlerts.length === 0 ? (
          <div className="p-10 text-center text-sm text-emerald-700">
            All active employees in this scope are performing above threshold for{' '}
            {formatMonthLabel(selectedMonth)}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Branch</th>
                  <th className="py-2.5 px-4">Employee Name &amp; ID</th>
                  <th className="py-2.5 px-4 text-right">Sale Amount</th>
                  <th className="py-2.5 px-4 text-right">Branch Average</th>
                  <th className="py-2.5 px-4 text-right">Incentive</th>
                  <th className="py-2.5 px-4">Alert Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lowPerformerAlerts.slice(0, 50).map((item) => (
                  <tr key={item.employee.employeeId} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">
                      {item.employee.branchName}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{item.employee.fullName}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        Employee ID: {item.employee.employeeId}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-900">
                      {formatINRFromPaise(item.saleAmtPaise)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500">
                      {formatINRFromPaise(item.branchAvgSalePaise)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-800">
                      {formatINRFromPaise(item.incentivePaise)}
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`font-semibold ${
                          item.flag === 'ZERO_SALE' ? 'text-red-700' : 'text-amber-700'
                        }`}
                      >
                        {item.flag === 'ZERO_SALE' ? 'Zero Sale / No Entry' : 'Below 50% Branch Avg'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
          </motion.div>
        )}

        {/* Top Performers Leaderboard */}
        {activeSection === 'leaderboard' && (
          <motion.section
            key="analytics-leaderboard"
            initial={prefersReduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="bg-white border border-slate-200 rounded-xl overflow-hidden"
          >
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-[#B8923A]" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Top Performers Leaderboard ({selectedBranch === 'ALL' ? 'Top 10 Overall' : 'Top 5 in Branch'})
              </h2>
              <p className="text-xs text-slate-500">
                {formatMonthLabel(selectedMonth)} · Super Admin confidential ranking
              </p>
            </div>
          </div>
          <div className="inline-flex p-0.5 bg-slate-100 rounded-lg text-xs self-start sm:self-auto">
            {(
              [
                ['saleAmt', 'By Sale Amount'],
                ['saleQty', 'By Sale Quantity'],
                ['incentive', 'By Incentive'],
              ] as Array<[LeaderboardSort, string]>
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setLeaderSort(k)}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                  leaderSort === k ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {leaderboard.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No published employee records for {formatMonthLabel(selectedMonth)}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <th className="py-2.5 px-4 w-14">Rank</th>
                  <th className="py-2.5 px-4">Employee Name &amp; ID</th>
                  <th className="py-2.5 px-4">Branch</th>
                  <th className="py-2.5 px-4 text-right">Total Sale Amount</th>
                  <th className="py-2.5 px-4 text-right">Total Sale Quantity</th>
                  <th className="py-2.5 px-4 text-right">Total Incentive</th>
                  <th className="py-2.5 px-4 text-right">Incentive % of Sale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leaderboard.map((row, idx) => (
                  <tr key={row.summaryId} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4 font-mono font-bold text-slate-900">#{idx + 1}</td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{row.employeeName}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        Employee ID: {row.employeeId}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-700">{row.branchName}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-slate-900">
                      {formatINRFromPaise(row.saleAmtPaise)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                      {formatQty(row.saleQty)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-[#0F1F3D]">
                      {formatINRFromPaise(row.grandTotalPaise)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                      {row.incPct.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
          </motion.section>
        )}

        {/* Branch Efficiency & Incentive-to-Sale % Ratio Table */}
        {activeSection === 'efficiency' && (
          <motion.section
            key="analytics-efficiency"
            initial={prefersReduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="bg-white border border-slate-200 rounded-xl overflow-hidden"
          >
        <div className="p-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">
            12-Branch Efficiency &amp; Incentive-to-Sale % Breakdown
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Includes slab totals, adjustments, net payable, and payout settlement counts
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                <th className="py-2.5 px-3">Branch</th>
                <th className="py-2.5 px-3 text-right">Active Staff</th>
                <th className="py-2.5 px-3 text-right">Sale Amount</th>
                <th className="py-2.5 px-3 text-right">Sale Quantity</th>
                <th className="py-2.5 px-3 text-right">Gross Incentive</th>
                <th className="py-2.5 px-3 text-right">Incentive %</th>
                <th className="py-2.5 px-3 text-right">Adjustments</th>
                <th className="py-2.5 px-3 text-right">Net Payable</th>
                <th className="py-2.5 px-3 text-right">Paid Staff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {branchAnalytics.map((b) => (
                <tr key={b.branchId} className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-3 font-medium text-slate-900 whitespace-nowrap">
                    {b.branchName}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                    {b.staffCount}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900">
                    {formatINRFromPaise(b.saleAmtPaise)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                    {formatQty(b.saleQty)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium text-[#0F1F3D]">
                    {formatINRFromPaise(b.grossIncentivePaise)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                    {b.incentivePct.toFixed(2)}%
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                    {b.adjustmentsNetPaise >= 0 ? '+' : ''}
                    {formatINRFromPaise(b.adjustmentsNetPaise)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {formatINRFromPaise(b.netPayablePaise)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                    {b.paidCount}/{b.staffCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          </motion.section>
        )}

        {/* Cross-Branch 5-Department Top-3 Sales Leaderboards (Privacy-Safe Staff View Preview) */}
        {activeSection === 'dept_leaders' && (
          <motion.div
            key="analytics-dept-leaders"
            initial={prefersReduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-4"
          >
            <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[#0F1F3D] flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-[#B8923A]" />
                  <span>
                    5-Department Cross-Branch Top-3 Sales Leaders ·{' '}
                    {selectedMonth ? formatMonthLabel(selectedMonth) : 'No Month'}
                  </span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Across all {branches.length} branches · {deptAssignedActiveCount} active staff
                  mapped to departments · Mobile app displays ONLY Photo, Name, Branch & Sale Amount
                  (zero incentive figures).
                </p>
              </div>
              <button
                type="button"
                disabled={refreshingDeptBoards || !selectedMonth}
                onClick={handlePublishDepartmentRankings}
                className="h-9 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#DFC27D] ${refreshingDeptBoards ? 'animate-spin' : ''}`} />
                {refreshingDeptBoards ? 'Syncing Staff App...' : 'Sync Rankings to Staff App'}
              </button>
            </div>

            {deptAssignedActiveCount === 0 ? (
              <div className="bg-white border border-amber-200 rounded-xl p-8 text-center space-y-2">
                <p className="text-sm font-semibold text-[#0F1F3D]">
                  No employees assigned to the 5 departments yet
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Go to <strong>Employees → Bulk Dept. Upload</strong> (or Edit an employee) to
                  assign staff to Saree, Ladies Wear, Kids Wear, Mens Wear, or Non Apparels.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {deptLeaderboardPreview.leaderboards.map((board) => (
                  <div
                    key={board.leaderboardId}
                    className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col"
                  >
                    <div className="px-4 py-3 bg-[#0F1F3D] text-white flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-xs font-bold tracking-tight truncate">
                          {board.departmentName}
                        </h3>
                        <p className="text-[10px] text-[#DFC27D] font-mono">
                          {board.totalParticipants} active staff across 12 branches
                        </p>
                      </div>
                      <Crown className="w-4 h-4 text-[#DFC27D] shrink-0" />
                    </div>

                    <div className="p-3.5 flex-1 space-y-2.5">
                      {board.top3.length === 0 ? (
                        <div className="py-6 text-center text-xs text-slate-400">
                          No sales recorded in {board.departmentName} for this month
                        </div>
                      ) : (
                        board.top3.map((entry) => {
                          const initials = entry.employeeName
                            .split(/\s+/)
                            .filter(Boolean)
                            .map((s: string) => s[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase();
                          return (
                            <div
                              key={`${board.departmentId}-rank-${entry.rank}-${entry.employeeName}`}
                              className={`p-2.5 rounded-lg border flex items-center justify-between gap-3 ${
                                entry.rank === 1
                                  ? 'border-[#B8923A]/55 bg-[#B8923A]/[0.06]'
                                  : 'border-slate-100 bg-slate-50/70'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span
                                  className={`w-6 h-6 rounded-md text-xs font-mono font-bold flex items-center justify-center shrink-0 ${
                                    entry.rank === 1
                                      ? 'bg-[#B8923A] text-white'
                                      : entry.rank === 2
                                        ? 'bg-[#0F1F3D] text-white'
                                        : 'bg-slate-200 text-slate-700'
                                  }`}
                                >
                                  #{entry.rank}
                                </span>
                                <div className="w-9 h-9 rounded-full bg-[#0F1F3D] text-[#DFC27D] text-xs font-bold flex items-center justify-center overflow-hidden border border-[#B8923A]/40 shrink-0">
                                  {entry.photoDataUrl ? (
                                    <img
                                      src={entry.photoDataUrl}
                                      alt={entry.employeeName}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <span>{initials}</span>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-slate-900 truncate">
                                    {entry.employeeName}
                                  </p>
                                  <p className="text-[11px] font-medium text-slate-500 truncate">
                                    {entry.branchName}
                                  </p>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-xs font-mono font-bold text-[#0F1F3D] tabular-nums">
                                  {formatINRFromPaise(entry.saleAmtPaise)}
                                </p>
                                <p className="text-[10px] text-slate-400">Sale Amt</p>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* Branch-Wise & Employee Growth Targets / Branch Progress / Employee Progress */}
        {(activeSection === 'target_planner' ||
          activeSection === 'branch_progress' ||
          activeSection === 'employee_progress') && (
          <motion.div
            key={`analytics-${activeSection}`}
            initial={prefersReduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <BranchTargetManager
              branches={branches}
              employees={employees}
              activeMonthlySummaries={activeMonthlySummaries}
              salesTargets={salesTargets}
              selectedAnalyticsMonth={selectedMonth}
              selectedAnalyticsBranch={selectedBranch}
              activeSection={
                activeSection === 'target_planner'
                  ? 'planner'
                  : activeSection === 'branch_progress'
                    ? 'branch_progress'
                    : 'employee_progress'
              }
              controlledTargetMonth={targetMonth}
              onTargetMonthChange={setTargetMonth}
              onRequestSection={(sec) => {
                if (sec === 'planner') setActiveSection('target_planner');
                else if (sec === 'branch_progress') setActiveSection('branch_progress');
                else setActiveSection('employee_progress');
              }}
              onRefresh={onRefresh}
              onFeedback={setFeedback}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
