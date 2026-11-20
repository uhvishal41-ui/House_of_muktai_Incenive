import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  Download,
  FileSpreadsheet,
  FileText,
  Target,
  Trash2,
} from 'lucide-react';
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
  formatINRFromPaise,
  formatMonthLabel,
  formatQty,
} from '../../lib/format';
import { normalizeRecordPeriod } from '../../lib/incentiveEngine';
import { downloadManagementBranchSummaryPdf } from '../../lib/pdfGenerator';
import {
  deleteSalesTarget,
  downloadManagementExcelReport,
  upsertSalesTarget,
} from '../../services/operationsService';
import type {
  Branch,
  Employee,
  IncentiveAdjustment,
  MonthlySummary,
  PayoutRecord,
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
  onRefresh: () => Promise<void>;
}

type LeaderboardSort = 'saleAmt' | 'saleQty' | 'incentive';
type ChartMetric = 'saleAmt' | 'incentive';

export function AdminAnalytics({
  branches,
  employees,
  incentives,
  monthlySummaries,
  payoutRecords,
  adjustments,
  salesTargets,
  onRefresh,
}: Props) {
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('ALL');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('saleAmt');
  const [leaderSort, setLeaderSort] = useState<LeaderboardSort>('saleAmt');
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Target form state
  const [targetScope, setTargetScope] = useState<'BRANCH' | 'EMPLOYEE'>('BRANCH');
  const [targetBranchId, setTargetBranchId] = useState('');
  const [targetEmployeeId, setTargetEmployeeId] = useState('');
  const [targetSaleAmtRupees, setTargetSaleAmtRupees] = useState('');
  const [targetSaleQty, setTargetSaleQty] = useState('');
  const [savingTarget, setSavingTarget] = useState(false);

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
    for (const t of salesTargets) set.add(t.monthKey);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [activeMonthlySummaries, salesTargets]);

  useEffect(() => {
    if (availableMonths.length === 0) {
      if (selectedMonth !== '') setSelectedMonth('');
      return;
    }
    if (!availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  useEffect(() => {
    if (!targetBranchId && branches.length > 0) {
      setTargetBranchId(branches[0].branchId);
    }
  }, [branches, targetBranchId]);

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

  // Month Sales Targets with Live Achievement %
  const monthTargets = useMemo(() => {
    const summaryByEmp = new Map<string, MonthlySummary>();
    for (const s of monthSummaries) summaryByEmp.set(s.employeeId.toUpperCase(), s);
    const branchById = new Map(branchAnalytics.map((b) => [b.branchId, b]));

    return salesTargets
      .filter((t) => t.monthKey === selectedMonth)
      .filter((t) => selectedBranch === 'ALL' || t.branchId === selectedBranch)
      .map((t) => {
        let achievedSalePaise = 0;
        let achievedQty = 0;
        if (t.scope === 'BRANCH') {
          const b = branchById.get(t.branchId);
          achievedSalePaise = b?.saleAmtPaise || 0;
          achievedQty = b?.saleQty || 0;
        } else if (t.employeeId) {
          const s = summaryByEmp.get(t.employeeId.toUpperCase());
          achievedSalePaise = s
            ? s.totalSaleAmtPaise ??
              (s.saleAmt1TotalPaise || 0) +
                (s.saleAmt2TotalPaise || 0) +
                (s.saleAmt3TotalPaise || 0)
            : 0;
          achievedQty = s
            ? s.totalSaleQty ??
              (s.saleQty1Total || 0) + (s.saleQty2Total || 0) + (s.saleQty3Total || 0)
            : 0;
        }
        const salePct =
          t.targetSaleAmtPaise > 0
            ? Math.round((achievedSalePaise / t.targetSaleAmtPaise) * 100)
            : 0;
        const qtyPct =
          t.targetSaleQty > 0 ? Math.round((achievedQty / t.targetSaleQty) * 100) : 0;
        return {
          ...t,
          achievedSalePaise,
          achievedQty,
          salePct,
          qtyPct,
        };
      });
  }, [salesTargets, selectedMonth, selectedBranch, monthSummaries, branchAnalytics]);

  const handleSaveTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const saleRupees = Number(targetSaleAmtRupees || '0');
    const qtyNum = Number(targetSaleQty || '0');
    if (!Number.isFinite(saleRupees) || saleRupees < 0 || !Number.isFinite(qtyNum) || qtyNum < 0) {
      setFeedback({ type: 'err', text: 'Please enter valid non-negative target numbers.' });
      return;
    }
    if (saleRupees === 0 && qtyNum === 0) {
      setFeedback({ type: 'err', text: 'Enter at least a Sale Amount or Sale Qty target.' });
      return;
    }

    const branch = branches.find((b) => b.branchId === targetBranchId);
    if (!branch) {
      setFeedback({ type: 'err', text: 'Please select a branch.' });
      return;
    }

    let emp: Employee | undefined;
    if (targetScope === 'EMPLOYEE') {
      emp = employees.find((x) => x.employeeId === targetEmployeeId);
      if (!emp) {
        setFeedback({ type: 'err', text: 'Please select an employee for personal target.' });
        return;
      }
    }

    setSavingTarget(true);
    try {
      await upsertSalesTarget({
        monthKey: selectedMonth,
        scope: targetScope,
        branchId: emp ? emp.branchId : branch.branchId,
        branchName: emp ? emp.branchName : branch.branchName,
        employeeId: emp?.employeeId,
        authUid: emp?.authUid,
        employeeName: emp?.fullName,
        targetSaleAmtPaise: Math.round(saleRupees * 100),
        targetSaleQty: qtyNum,
      });
      setTargetSaleAmtRupees('');
      setTargetSaleQty('');
      setFeedback({
        type: 'ok',
        text: `Saved ${targetScope === 'BRANCH' ? 'branch' : 'employee'} sales target for ${formatMonthLabel(selectedMonth)}.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save target.',
      });
    } finally {
      setSavingTarget(false);
    }
  };

  const handleDeleteTarget = async (targetId: string) => {
    setFeedback(null);
    try {
      await deleteSalesTarget(targetId);
      setFeedback({ type: 'ok', text: 'Removed monthly sales target.' });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to delete target.',
      });
    }
  };

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
    const header = 'Month,Branch,Salesman No,Employee Name,Sale Amt (Rs),Sale Qty,Incentive (Rs),Alert Flag';
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

  const activeBranchEmployees = useMemo(
    () =>
      employees
        .filter((e) => e.status === 'ACTIVE' && (!targetBranchId || e.branchId === targetBranchId))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [employees, targetBranchId],
  );

  return (
    <div className="space-y-6">
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
            className="h-8 px-3 rounded-lg bg-[#9F1239] hover:bg-[#881337] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer transition-colors"
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
          <p className="text-xl font-semibold font-mono tabular-nums text-rose-900 mt-1.5">
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
                  fill={chartMetric === 'saleAmt' ? '#0F172A' : '#881337'}
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
                      <stop offset="5%" stopColor="#881337" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="#881337" stopOpacity={0.02} />
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
                    stroke="#881337"
                    strokeWidth={2}
                    fill="url(#muktaiIncGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      {/* Top Performers Leaderboard */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-rose-900" />
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
                ['saleAmt', 'By Sale Amt'],
                ['saleQty', 'By Sale Qty'],
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
                  <th className="py-2.5 px-4">Sales Person / No</th>
                  <th className="py-2.5 px-4">Branch</th>
                  <th className="py-2.5 px-4 text-right">Total Sale Amt</th>
                  <th className="py-2.5 px-4 text-right">Total Sale Qty</th>
                  <th className="py-2.5 px-4 text-right">Total Incentive</th>
                  <th className="py-2.5 px-4 text-right">Inc % of Sale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leaderboard.map((row, idx) => (
                  <tr key={row.summaryId} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4 font-mono font-bold text-slate-900">#{idx + 1}</td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{row.employeeName}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        Salesman No: {row.employeeId}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-700">{row.branchName}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-slate-900">
                      {formatINRFromPaise(row.saleAmtPaise)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                      {formatQty(row.saleQty)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-rose-900">
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
      </section>

      {/* Branch Efficiency & Incentive-to-Sale % Ratio Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
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
                <th className="py-2.5 px-3 text-right">Staff</th>
                <th className="py-2.5 px-3 text-right">Sale Amt</th>
                <th className="py-2.5 px-3 text-right">Sale Qty</th>
                <th className="py-2.5 px-3 text-right">Gross Inc</th>
                <th className="py-2.5 px-3 text-right">Inc %</th>
                <th className="py-2.5 px-3 text-right">Adjustments</th>
                <th className="py-2.5 px-3 text-right">Net Payable</th>
                <th className="py-2.5 px-3 text-right">Paid</th>
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
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium text-rose-900">
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
      </section>

      {/* Monthly Sales Targets Manager + Achievement Progress */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-rose-900" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Monthly Sales Targets vs Achievement ({formatMonthLabel(selectedMonth)})
            </h2>
            <p className="text-xs text-slate-500">
              Set monthly Sale Amount &amp; Sale Qty targets for branches or individual employees
              (visible live on Employee Mobile App)
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSaveTarget}
          className="grid grid-cols-1 md:grid-cols-6 gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200"
        >
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Scope</label>
            <select
              value={targetScope}
              onChange={(e) => setTargetScope(e.target.value as 'BRANCH' | 'EMPLOYEE')}
              className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
            >
              <option value="BRANCH">Branch Target</option>
              <option value="EMPLOYEE">Employee Target</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Branch</label>
            <select
              value={targetBranchId}
              onChange={(e) => {
                setTargetBranchId(e.target.value);
                setTargetEmployeeId('');
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

          {targetScope === 'EMPLOYEE' && (
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Employee</label>
              <select
                value={targetEmployeeId}
                onChange={(e) => setTargetEmployeeId(e.target.value)}
                required
                className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
              >
                <option value="">Select Employee...</option>
                {activeBranchEmployees.map((emp) => (
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
              value={targetSaleAmtRupees}
              onChange={(e) => setTargetSaleAmtRupees(e.target.value)}
              placeholder="e.g. 500000"
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
              value={targetSaleQty}
              onChange={(e) => setTargetSaleQty(e.target.value)}
              placeholder="e.g. 250"
              className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={savingTarget}
              className="w-full h-9 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium disabled:opacity-60 cursor-pointer"
            >
              {savingTarget ? 'Saving...' : 'Save Target'}
            </button>
          </div>
        </form>

        {monthTargets.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-6">
            No targets configured for {formatMonthLabel(selectedMonth)} yet. Use the form above to
            assign targets.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {monthTargets.map((t) => (
              <div
                key={t.targetId}
                className="p-4 rounded-xl border border-slate-200 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-900">
                      {t.scope === 'BRANCH'
                        ? `${t.branchName} · Branch Target`
                        : `${t.employeeName} (${t.employeeId}) · ${t.branchName}`}
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                      Achieved: {formatINRFromPaise(t.achievedSalePaise)} /{' '}
                      {formatINRFromPaise(t.targetSaleAmtPaise)}
                      {t.targetSaleQty > 0
                        ? ` · Qty ${formatQty(t.achievedQty)} / ${formatQty(t.targetSaleQty)}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-xs font-mono font-semibold ${
                        t.salePct >= 100
                          ? 'text-emerald-700'
                          : t.salePct >= 70
                            ? 'text-slate-900'
                            : 'text-amber-700'
                      }`}
                    >
                      {t.salePct}%
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteTarget(t.targetId)}
                      className="p-1 text-slate-400 hover:text-red-700 cursor-pointer"
                      aria-label="Delete target"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-sm overflow-hidden">
                  <div
                    className={`h-full rounded-sm ${
                      t.salePct >= 100 ? 'bg-emerald-600' : 'bg-rose-900'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(2, t.salePct))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

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
                  <th className="py-2.5 px-4">Sales Person / No</th>
                  <th className="py-2.5 px-4 text-right">Sale Amt</th>
                  <th className="py-2.5 px-4 text-right">Branch Avg</th>
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
                        Salesman No: {item.employee.employeeId}
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
    </div>
  );
}
