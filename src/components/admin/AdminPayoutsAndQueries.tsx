import React, { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  FileDown,
  Lock,
  MessageSquare,
  PlusCircle,
  RefreshCw,
  Search,
  Trash2,
  Wallet,
} from 'lucide-react';
import {
  formatINRFromPaise,
  formatMonthLabel,
  formatShortDate,
} from '../../lib/format';
import { normalizeRecordPeriod } from '../../lib/incentiveEngine';
import { downloadEmployeeIncentiveSlipPdf } from '../../lib/pdfGenerator';
import {
  createIncentiveAdjustment,
  deleteEmployeeQueryByOwner,
  deleteIncentiveAdjustmentByOwner,
  deletePayoutRecordByOwner,
  resolveEmployeeQuery,
  syncOperationalAuthUids,
  upsertPayoutRecord,
  upsertPayoutRecordsBatch,
  voidIncentiveAdjustment,
} from '../../services/operationsService';
import type {
  AdjustmentType,
  Branch,
  Employee,
  EmployeeQuery,
  IncentiveAdjustment,
  MonthlySummary,
  PaymentMode,
  PayoutRecord,
  PayoutStatus,
  PayrollLockSettings,
  PublishedIncentive,
  QueryStatus,
} from '../../types/incentive';

import type { VoiceFilterCommand } from '../../services/voiceToolExecutor';

interface Props {
  branches: Branch[];
  employees: Employee[];
  incentives: PublishedIncentive[];
  monthlySummaries: MonthlySummary[];
  payoutRecords: PayoutRecord[];
  adjustments: IncentiveAdjustment[];
  employeeQueries: EmployeeQuery[];
  payrollLockSettings?: PayrollLockSettings;
  voiceFilter?: VoiceFilterCommand | null;
  onRefresh: () => Promise<void>;
}

type SubTab = 'payouts' | 'adjustments' | 'queries';

export function AdminPayoutsAndQueries({
  branches,
  employees,
  incentives,
  monthlySummaries,
  payoutRecords,
  adjustments,
  employeeQueries,
  payrollLockSettings,
  voiceFilter,
  onRefresh,
}: Props) {
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>('payouts');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | PayoutStatus>('ALL');
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!voiceFilter || voiceFilter.targetTab !== 'payouts') return;
    if (voiceFilter.subTab === 'payouts' || voiceFilter.subTab === 'adjustments' || voiceFilter.subTab === 'queries') {
      setSubTab(voiceFilter.subTab);
    }
    if (voiceFilter.clearFilters) {
      setSelectedBranch('ALL');
      setStatusFilter('ALL');
      setSearch('');
      return;
    }
    if (voiceFilter.monthKey && voiceFilter.monthKey !== 'ALL') {
      setSelectedMonth(voiceFilter.monthKey);
    }
    if (voiceFilter.branchId !== undefined) setSelectedBranch(voiceFilter.branchId);
    if (
      voiceFilter.status === 'ALL' ||
      voiceFilter.status === 'UNPAID' ||
      voiceFilter.status === 'APPROVED' ||
      voiceFilter.status === 'PAID'
    ) {
      setStatusFilter(voiceFilter.status);
    }
    if (voiceFilter.searchQuery !== undefined) setSearch(voiceFilter.searchQuery);
  }, [voiceFilter]);

  // Payout edit modal/drawer state
  const [editingPayoutRow, setEditingPayoutRow] = useState<{
    summary: MonthlySummary;
    authUid: string;
    adjustmentsNetPaise: number;
    existing: PayoutRecord | null;
  } | null>(null);
  const [editStatus, setEditStatus] = useState<PayoutStatus>('PAID');
  const [editMode, setEditMode] = useState<PaymentMode>('BANK');
  const [editRef, setEditRef] = useState('');
  const [editRemarks, setEditRemarks] = useState('');
  const [savingPayout, setSavingPayout] = useState(false);

  // Bulk select state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkMode, setBulkMode] = useState<PaymentMode>('BANK');
  const [bulkRef, setBulkRef] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [syncingAuthUids, setSyncingAuthUids] = useState(false);

  // Adjustment form state
  const [adjBranchFilter, setAdjBranchFilter] = useState('ALL');
  const [adjEmployeeId, setAdjEmployeeId] = useState('');
  const [adjType, setAdjType] = useState<AdjustmentType>('BONUS');
  const [adjAmountRupees, setAdjAmountRupees] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [savingAdj, setSavingAdj] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  // Queries state
  const [queryStatusFilter, setQueryStatusFilter] = useState<'ALL' | QueryStatus>('ALL');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyStatusDrafts, setReplyStatusDrafts] = useState<Record<string, QueryStatus>>({});
  const [busyQueryId, setBusyQueryId] = useState<string | null>(null);

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

  useEffect(() => {
    if (availableMonths.length === 0) {
      if (selectedMonth !== '') setSelectedMonth('');
      return;
    }
    if (!availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  const isSelectedMonthLocked = Boolean(
    selectedMonth && payrollLockSettings?.lockedMonths?.includes(selectedMonth),
  );

  const employeesById = useMemo(() => {
    const map = new Map<string, Employee>();
    for (const e of employees) map.set(e.employeeId.toUpperCase(), e);
    return map;
  }, [employees]);

  const adjByEmployee = useMemo(() => {
    const map = new Map<string, IncentiveAdjustment[]>();
    for (const a of adjustments) {
      if (a.monthKey !== selectedMonth || a.status !== 'ACTIVE') continue;
      const key = a.employeeId.toUpperCase();
      const arr = map.get(key) || [];
      arr.push(a);
      map.set(key, arr);
    }
    return map;
  }, [adjustments, selectedMonth]);

  const payoutByEmployee = useMemo(() => {
    const map = new Map<string, PayoutRecord>();
    for (const p of payoutRecords) {
      if (p.monthKey === selectedMonth) {
        map.set(p.employeeId.toUpperCase(), p);
      }
    }
    return map;
  }, [payoutRecords, selectedMonth]);

  const payoutRows = useMemo(() => {
    if (!selectedMonth) return [];
    const q = search.trim().toLowerCase();
    return activeMonthlySummaries
      .filter((s) => s.monthKey === selectedMonth)
      .filter((s) => selectedBranch === 'ALL' || s.branchId === selectedBranch)
      .map((s) => {
        const key = s.employeeId.toUpperCase();
        const emp = employeesById.get(key);
        const empAdjs = adjByEmployee.get(key) || [];
        const adjustmentsNetPaise = empAdjs.reduce(
          (sum, a) => sum + (a.type === 'BONUS' ? a.amountPaise : -a.amountPaise),
          0,
        );
        const existingPayout = payoutByEmployee.get(key) || null;
        const status: PayoutStatus = existingPayout?.status || 'UNPAID';
        const netPayablePaise = s.grandTotalPaise + adjustmentsNetPaise;
        return {
          summary: s,
          emp,
          empAdjs,
          adjustmentsNetPaise,
          netPayablePaise,
          existingPayout,
          status,
        };
      })
      .filter((row) => statusFilter === 'ALL' || row.status === statusFilter)
      .filter(
        (row) =>
          !q ||
          row.summary.employeeName.toLowerCase().includes(q) ||
          row.summary.employeeId.toLowerCase().includes(q) ||
          row.summary.branchName.toLowerCase().includes(q),
      )
      .sort((a, b) => b.netPayablePaise - a.netPayablePaise);
  }, [
    activeMonthlySummaries,
    selectedMonth,
    selectedBranch,
    statusFilter,
    search,
    employeesById,
    adjByEmployee,
    payoutByEmployee,
  ]);

  const outOfSyncPayoutCount = useMemo(() => {
    let count = 0;
    for (const p of payoutRecords) {
      const emp = employeesById.get(p.employeeId.toUpperCase());
      if (emp?.authUid && p.authUid !== emp.authUid) {
        count += 1;
      }
    }
    return count;
  }, [payoutRecords, employeesById]);

  const handleSyncPayoutAuthUids = async () => {
    setSyncingAuthUids(true);
    setFeedback(null);
    try {
      const res = await syncOperationalAuthUids(employees);
      setFeedback({
        type: 'ok',
        text: `Synced staff login IDs to ${res.payoutsSynced} payout record(s), ${res.adjustmentsSynced} adjustment(s), and ${res.targetsSynced} personal target(s). Employees will now see updated Paid status immediately on mobile.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to sync payout records to staff app.',
      });
    } finally {
      setSyncingAuthUids(false);
    }
  };

  const openQueryCount = useMemo(
    () => employeeQueries.filter((q) => q.status !== 'RESOLVED').length,
    [employeeQueries],
  );

  const openPayoutDrawer = (row: (typeof payoutRows)[number]) => {
    setEditingPayoutRow({
      summary: row.summary,
      authUid: row.emp?.authUid || row.summary.authUid || '',
      adjustmentsNetPaise: row.adjustmentsNetPaise,
      existing: row.existingPayout,
    });
    setEditStatus(row.existingPayout?.status || 'PAID');
    setEditMode(row.existingPayout?.paymentMode || 'BANK');
    setEditRef(row.existingPayout?.paymentReference || '');
    setEditRemarks(row.existingPayout?.remarks || '');
    setFeedback(null);
  };

  const handleSavePayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPayoutRow) return;
    if (isSelectedMonthLocked) {
      setFeedback({
        type: 'err',
        text: `${formatMonthLabel(selectedMonth)} is Payroll Locked by Main Owner. Unlock this month in Pro Executive Suite first.`,
      });
      return;
    }
    setSavingPayout(true);
    setFeedback(null);
    try {
      await upsertPayoutRecord({
        monthKey: selectedMonth,
        employeeId: editingPayoutRow.summary.employeeId,
        authUid: editingPayoutRow.authUid,
        employeeName: editingPayoutRow.summary.employeeName,
        branchId: editingPayoutRow.summary.branchId,
        branchName: editingPayoutRow.summary.branchName,
        grossIncentivePaise: editingPayoutRow.summary.grandTotalPaise,
        adjustmentsNetPaise: editingPayoutRow.adjustmentsNetPaise,
        status: editStatus,
        paymentMode: editStatus === 'UNPAID' ? '' : editMode,
        paymentReference: editRef,
        remarks: editRemarks,
      });
      setEditingPayoutRow(null);
      setFeedback({
        type: 'ok',
        text: `Updated payout status for ${editingPayoutRow.summary.employeeName} (${editingPayoutRow.summary.employeeId}) to ${editStatus}.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to update payout status.',
      });
    } finally {
      setSavingPayout(false);
    }
  };

  const handleBulkMarkPaid = async () => {
    if (selectedIds.length === 0) return;
    if (isSelectedMonthLocked) {
      setFeedback({
        type: 'err',
        text: `${formatMonthLabel(selectedMonth)} is Payroll Locked by Main Owner. Unlock this month in Pro Executive Suite first.`,
      });
      return;
    }
    setBulkBusy(true);
    setFeedback(null);
    try {
      const targets = payoutRows.filter((r) => selectedIds.includes(r.summary.employeeId));
      await upsertPayoutRecordsBatch({
        monthKey: selectedMonth,
        paymentMode: bulkMode,
        paymentReference: bulkRef.trim() || undefined,
        items: targets.map((row) => ({
          monthKey: selectedMonth,
          employeeId: row.summary.employeeId,
          authUid: row.emp?.authUid || row.summary.authUid || '',
          employeeName: row.summary.employeeName,
          branchId: row.summary.branchId,
          branchName: row.summary.branchName,
          grossIncentivePaise: row.summary.grandTotalPaise,
          adjustmentsNetPaise: row.adjustmentsNetPaise,
          status: 'PAID',
          paymentMode: bulkMode,
          paymentReference: bulkRef.trim() || undefined,
        })),
      });
      setSelectedIds([]);
      setBulkRef('');
      setFeedback({
        type: 'ok',
        text: `Marked ${targets.length} employee(s) as PAID via ${bulkMode} for ${formatMonthLabel(selectedMonth)}.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Bulk payout update failed.',
      });
    } finally {
      setBulkBusy(false);
    }
  };

  const handleDownloadSlip = (row: (typeof payoutRows)[number]) => {
    const s = row.summary;
    const totalSaleAmt =
      s.totalSaleAmtPaise ??
      (s.saleAmt1TotalPaise || 0) + (s.saleAmt2TotalPaise || 0) + (s.saleAmt3TotalPaise || 0);
    const totalSaleQty =
      s.totalSaleQty ??
      Math.round(
        ((s.saleQty1Total || 0) + (s.saleQty2Total || 0) + (s.saleQty3Total || 0)) * 100,
      ) / 100;
    downloadEmployeeIncentiveSlipPdf({
      employeeName: s.employeeName,
      employeeId: s.employeeId,
      branchName: s.branchName,
      designation: row.emp?.designation || 'Sales Executive',
      periodTitle: `${formatMonthLabel(s.monthKey)} Statement`,
      periodBadge: s.sourceType === 'MONTHLY_RECORD' ? 'MONTHLY' : `DAILY (${s.publishedDaysCount}D)`,
      slab1SaleAmtPaise: s.saleAmt1TotalPaise || 0,
      slab1SaleQty: s.saleQty1Total || 0,
      slab1IncentivePaise: s.component1TotalPaise,
      slab2SaleAmtPaise: s.saleAmt2TotalPaise || 0,
      slab2SaleQty: s.saleQty2Total || 0,
      slab2IncentivePaise: s.component2TotalPaise,
      slab3SaleAmtPaise: s.saleAmt3TotalPaise || 0,
      slab3SaleQty: s.saleQty3Total || 0,
      slab3IncentivePaise: s.component3TotalPaise,
      totalSaleAmtPaise: totalSaleAmt,
      totalSaleQty,
      grossIncentivePaise: s.grandTotalPaise,
      adjustments: row.empAdjs,
      payout: row.existingPayout,
      fileName: `incentive-slip-${s.employeeId}-${s.monthKey}.pdf`,
    });
  };

  const handleCreateAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (isSelectedMonthLocked) {
      setFeedback({
        type: 'err',
        text: `${formatMonthLabel(selectedMonth)} is Payroll Locked by Main Owner. Unlock this month in Pro Executive Suite before adding adjustments.`,
      });
      return;
    }
    const emp = employees.find((x) => x.employeeId === adjEmployeeId);
    if (!emp) {
      setFeedback({ type: 'err', text: 'Please select an employee.' });
      return;
    }
    const amtRupees = Number(adjAmountRupees);
    if (!Number.isFinite(amtRupees) || amtRupees <= 0) {
      setFeedback({ type: 'err', text: 'Enter a positive adjustment amount in rupees.' });
      return;
    }

    setSavingAdj(true);
    try {
      await createIncentiveAdjustment({
        monthKey: selectedMonth,
        employeeId: emp.employeeId,
        authUid: emp.authUid || '',
        employeeName: emp.fullName,
        branchId: emp.branchId,
        branchName: emp.branchName,
        type: adjType,
        amountPaise: Math.round(amtRupees * 100),
        reason: adjReason,
      });
      setAdjAmountRupees('');
      setAdjReason('');
      setFeedback({
        type: 'ok',
        text: `Recorded ${adjType.replace('_', ' ')} of ${formatINRFromPaise(Math.round(amtRupees * 100))} for ${emp.fullName} (${emp.employeeId}).`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save adjustment.',
      });
    } finally {
      setSavingAdj(false);
    }
  };

  const handleVoidAdjustment = async (adjustmentId: string) => {
    if (isSelectedMonthLocked) {
      setFeedback({
        type: 'err',
        text: `${formatMonthLabel(selectedMonth)} is Payroll Locked by Main Owner. Unlock this month before voiding adjustments.`,
      });
      return;
    }
    setVoidingId(adjustmentId);
    setFeedback(null);
    try {
      await voidIncentiveAdjustment(adjustmentId);
      setFeedback({
        type: 'ok',
        text: `Voided adjustment ${adjustmentId} (preserved in audit history).`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to void adjustment.',
      });
    } finally {
      setVoidingId(null);
    }
  };

  const handleResolveQuery = async (qItem: EmployeeQuery) => {
    const reply = (replyDrafts[qItem.queryId] ?? qItem.adminReply ?? '').trim();
    const targetStatus = replyStatusDrafts[qItem.queryId] ?? 'RESOLVED';
    if (!reply) {
      setFeedback({ type: 'err', text: 'Please write a short reply before updating this query.' });
      return;
    }
    setBusyQueryId(qItem.queryId);
    setFeedback(null);
    try {
      await resolveEmployeeQuery({
        queryId: qItem.queryId,
        status: targetStatus,
        adminReply: reply,
      });
      setFeedback({
        type: 'ok',
        text: `Updated query from ${qItem.employeeName} (${qItem.employeeId}) to ${targetStatus}.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to update query.',
      });
    } finally {
      setBusyQueryId(null);
    }
  };

  const filteredAdjustments = useMemo(
    () =>
      adjustments
        .filter((a) => a.monthKey === selectedMonth)
        .filter((a) => selectedBranch === 'ALL' || a.branchId === selectedBranch),
    [adjustments, selectedMonth, selectedBranch],
  );

  const filteredQueries = useMemo(
    () =>
      employeeQueries
        .filter((q) => queryStatusFilter === 'ALL' || q.status === queryStatusFilter)
        .filter((q) => selectedBranch === 'ALL' || q.branchId === selectedBranch),
    [employeeQueries, queryStatusFilter, selectedBranch],
  );

  const adjEligibleEmployees = useMemo(
    () =>
      employees
        .filter((e) => adjBranchFilter === 'ALL' || e.branchId === adjBranchFilter)
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [employees, adjBranchFilter],
  );

  const allSelected =
    payoutRows.length > 0 && selectedIds.length === payoutRows.length;

  return (
    <div className="space-y-6">
      {/* Sub-navigation & Month Selector */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="inline-flex p-1 bg-slate-200/70 rounded-lg text-sm overflow-x-auto">
          {(
            [
              ['payouts', 'Payout Settlement'],
              ['adjustments', `Bonus & Deductions (${filteredAdjustments.filter((a) => a.status === 'ACTIVE').length})`],
              ['queries', `Employee Queries${openQueryCount > 0 ? ` (${openQueryCount} Open)` : ''}`],
            ] as Array<[SubTab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSubTab(key)}
              className={`px-3.5 py-2 rounded-md text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                subTab === key
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="inline-flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 self-start lg:self-auto">
          <select
            aria-label="Select month"
            value={selectedMonth}
            disabled={availableMonths.length === 0}
            onChange={(e) => {
              setSelectedMonth(e.target.value);
              setSelectedIds([]);
            }}
            className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-800 disabled:opacity-60"
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
            aria-label="Filter by branch"
            value={selectedBranch}
            onChange={(e) => {
              setSelectedBranch(e.target.value);
              setSelectedIds([]);
            }}
            className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-800"
          >
            <option value="ALL">All Branches ({branches.length})</option>
            {branches.map((b) => (
              <option key={b.branchId} value={b.branchId}>
                {b.branchName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isSelectedMonthLocked && subTab !== 'queries' && (
        <div className="p-3.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-950 text-xs flex items-center gap-2.5">
          <Lock className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            <strong>{formatMonthLabel(selectedMonth)} is Payroll Locked</strong> by Main Owner.
            Payout settlements and bonus/deduction adjustments are read-only until unlocked in{' '}
            <strong>Pro Executive Suite</strong>.
          </span>
        </div>
      )}

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

      {/* ================================================================= */}
      {/* TAB 1: PAYOUT SETTLEMENT                                          */}
      {/* ================================================================= */}
      {subTab === 'payouts' && (
        <div className="space-y-4">
          {outOfSyncPayoutCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-900">
              <div>
                <p className="font-semibold">
                  {outOfSyncPayoutCount} payout record(s) need Staff App Login Sync
                </p>
                <p className="text-amber-800/90 mt-0.5">
                  These payouts were saved before the employee&apos;s login was activated. Click
                  sync so every employee sees their Paid status cleanly.
                </p>
              </div>
              <button
                type="button"
                disabled={syncingAuthUids}
                onClick={handleSyncPayoutAuthUids}
                className="h-9 px-3.5 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncingAuthUids ? 'animate-spin' : ''}`} />
                <span>{syncingAuthUids ? 'Syncing...' : 'Sync Paid Status to Staff App'}</span>
              </button>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search Employee ID or name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'ALL' | PayoutStatus)}
                className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-800"
              >
                <option value="ALL">All Payout Statuses</option>
                <option value="UNPAID">Unpaid</option>
                <option value="APPROVED">Approved</option>
                <option value="PAID">Paid</option>
              </select>
            </div>

            {selectedIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                <span className="text-xs font-semibold text-slate-900">
                  {selectedIds.length} selected
                </span>
                <select
                  value={bulkMode}
                  onChange={(e) => setBulkMode(e.target.value as PaymentMode)}
                  className="h-7 px-2 rounded border border-slate-300 bg-white text-xs"
                >
                  <option value="BANK">BANK</option>
                  <option value="UPI">UPI</option>
                  <option value="CASH">CASH</option>
                </select>
                <input
                  type="text"
                  value={bulkRef}
                  onChange={(e) => setBulkRef(e.target.value)}
                  placeholder="Batch UTR / Ref"
                  className="h-7 px-2 rounded border border-slate-300 bg-white text-xs w-32"
                />
                <button
                  type="button"
                  disabled={bulkBusy || isSelectedMonthLocked}
                  onClick={handleBulkMarkPaid}
                  className="h-7 px-3 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium cursor-pointer disabled:opacity-60"
                >
                  {bulkBusy ? 'Saving...' : 'Mark Paid'}
                </button>
              </div>
            )}
          </div>

          {/* Inline Payout Update Drawer */}
          {editingPayoutRow && (
            <form
              onSubmit={handleSavePayout}
              className="bg-white border border-[#0F1F3D]/30 rounded-xl p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Update Payout · {editingPayoutRow.summary.employeeName} (
                    {editingPayoutRow.summary.employeeId})
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5 font-mono tabular-nums">
                    {formatMonthLabel(selectedMonth)} · Gross{' '}
                    {formatINRFromPaise(editingPayoutRow.summary.grandTotalPaise)} · Adj{' '}
                    {editingPayoutRow.adjustmentsNetPaise >= 0 ? '+' : ''}
                    {formatINRFromPaise(editingPayoutRow.adjustmentsNetPaise)} · Net Payable{' '}
                    <strong className="text-[#0F1F3D]">
                      {formatINRFromPaise(
                        editingPayoutRow.summary.grandTotalPaise +
                          editingPayoutRow.adjustmentsNetPaise,
                      )}
                    </strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingPayoutRow(null)}
                  className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as PayoutStatus)}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 text-xs bg-white"
                  >
                    <option value="UNPAID">UNPAID</option>
                    <option value="APPROVED">APPROVED</option>
                    <option value="PAID">PAID</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Payment Mode
                  </label>
                  <select
                    value={editMode}
                    disabled={editStatus === 'UNPAID'}
                    onChange={(e) => setEditMode(e.target.value as PaymentMode)}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 text-xs bg-white disabled:bg-slate-50"
                  >
                    <option value="BANK">BANK</option>
                    <option value="UPI">UPI</option>
                    <option value="CASH">CASH</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Reference / UTR / Voucher No
                  </label>
                  <input
                    type="text"
                    value={editRef}
                    onChange={(e) => setEditRef(e.target.value)}
                    placeholder="e.g. UTR8923410"
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Remarks</label>
                  <input
                    type="text"
                    value={editRemarks}
                    onChange={(e) => setEditRemarks(e.target.value)}
                    placeholder="Optional accounts note"
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingPayout}
                  className="h-9 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-medium disabled:opacity-60 cursor-pointer"
                >
                  {savingPayout ? 'Saving Payout...' : 'Save Payout Status'}
                </button>
              </div>
            </form>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {payoutRows.length === 0 ? (
              <div className="p-12 text-center text-sm text-slate-500">
                No published employee incentives match your filter for{' '}
                {formatMonthLabel(selectedMonth)}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                      <th className="py-3 px-3 w-8">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={(e) =>
                            setSelectedIds(
                              e.target.checked ? payoutRows.map((r) => r.summary.employeeId) : [],
                            )
                          }
                          aria-label="Select all employees"
                        />
                      </th>
                      <th className="py-3 px-3">Employee / Branch</th>
                      <th className="py-3 px-3 text-right">Gross Incentive</th>
                      <th className="py-3 px-3 text-right">Adjustments</th>
                      <th className="py-3 px-3 text-right">Net Payable</th>
                      <th className="py-3 px-3">Payout Status</th>
                      <th className="py-3 px-3">Mode / Reference</th>
                      <th className="py-3 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payoutRows.map((row) => {
                      const checked = selectedIds.includes(row.summary.employeeId);
                      return (
                        <tr key={row.summary.summaryId} className="hover:bg-slate-50/60">
                          <td className="py-3 px-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setSelectedIds((prev) =>
                                  e.target.checked
                                    ? [...prev, row.summary.employeeId]
                                    : prev.filter((id) => id !== row.summary.employeeId),
                                )
                              }
                              aria-label={`Select ${row.summary.employeeName}`}
                            />
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-medium text-slate-900">
                              {row.summary.employeeName}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              <span className="font-mono">{row.summary.employeeId}</span> ·{' '}
                              {row.summary.branchName}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                            {formatINRFromPaise(row.summary.grandTotalPaise)}
                          </td>
                          <td
                            className={`py-3 px-3 text-right font-mono tabular-nums ${
                              row.adjustmentsNetPaise > 0
                                ? 'text-emerald-700'
                                : row.adjustmentsNetPaise < 0
                                  ? 'text-red-700'
                                  : 'text-slate-400'
                            }`}
                          >
                            {row.adjustmentsNetPaise === 0
                              ? '—'
                              : `${row.adjustmentsNetPaise > 0 ? '+' : ''}${formatINRFromPaise(row.adjustmentsNetPaise)}`}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                            {formatINRFromPaise(row.netPayablePaise)}
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`font-semibold ${
                                row.status === 'PAID'
                                  ? 'text-emerald-700'
                                  : row.status === 'APPROVED'
                                    ? 'text-blue-700'
                                    : 'text-amber-700'
                              }`}
                            >
                              {row.status}
                            </span>
                            {row.existingPayout?.paidAt && (
                              <div className="text-[10px] text-slate-400 font-mono">
                                {formatShortDate(row.existingPayout.paidAt.slice(0, 10))}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-slate-600 font-mono text-[11px]">
                            {row.existingPayout?.paymentMode || '—'}
                            {row.existingPayout?.paymentReference
                              ? ` · ${row.existingPayout.paymentReference}`
                              : ''}
                          </td>
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-3">
                              <button
                                type="button"
                                disabled={isSelectedMonthLocked}
                                onClick={() => openPayoutDrawer(row)}
                                title={
                                  isSelectedMonthLocked
                                    ? 'Month is Payroll Locked by Main Owner'
                                    : 'Update payout status'
                                }
                                className="inline-flex items-center gap-1 text-xs font-medium text-[#0F1F3D] hover:underline cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
                              >
                                <Wallet className="w-3.5 h-3.5" />
                                Update
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDownloadSlip(row)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                              >
                                <FileDown className="w-3.5 h-3.5" />
                                PDF Slip
                              </button>
                              {row.existingPayout && (
                                confirmDeleteKey === `payout:${row.existingPayout.payoutId}` ? (
                                  <span className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={deletingKey === `payout:${row.existingPayout.payoutId}`}
                                      onClick={async () => {
                                        const rec = row.existingPayout!;
                                        setDeletingKey(`payout:${rec.payoutId}`);
                                        setFeedback(null);
                                        try {
                                          await deletePayoutRecordByOwner(rec);
                                          setConfirmDeleteKey(null);
                                          setFeedback({
                                            type: 'ok',
                                            text: `Deleted payout entry for ${rec.employeeName} (reset to UNPAID).`,
                                          });
                                          await onRefresh();
                                        } catch (err) {
                                          setFeedback({
                                            type: 'err',
                                            text: err instanceof Error ? err.message : 'Unable to delete payout record.',
                                          });
                                        } finally {
                                          setDeletingKey(null);
                                        }
                                      }}
                                      className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                                    >
                                      {deletingKey === `payout:${row.existingPayout.payoutId}` ? '...' : 'Confirm'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteKey(null)}
                                      className="px-1.5 py-0.5 rounded border border-slate-200 text-[11px] text-slate-600 cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteKey(`payout:${row.existingPayout!.payoutId}`)}
                                    title="Delete payout record (reset to UNPAID on unlocked month)"
                                    className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 hover:underline cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Delete
                                  </button>
                                )
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 2: AUDITED BONUS / DEDUCTIONS / ADVANCE ADJUSTMENTS           */}
      {/* ================================================================= */}
      {subTab === 'adjustments' && (
        <div className="space-y-5">
          <form
            onSubmit={handleCreateAdjustment}
            className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center gap-2">
              <PlusCircle className="w-4 h-4 text-[#0F1F3D]" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Add Bonus, Deduction, Advance, or Return Adjustment ({formatMonthLabel(selectedMonth)})
                </h2>
                <p className="text-xs text-slate-500">
                  Original ERP published records remain untouched. Adjustments compute Net Payable
                  and appear on the employee&apos;s PDF slip.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Branch Filter
                </label>
                <select
                  value={adjBranchFilter}
                  onChange={(e) => {
                    setAdjBranchFilter(e.target.value);
                    setAdjEmployeeId('');
                  }}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
                >
                  <option value="ALL">All Branches</option>
                  {branches.map((b) => (
                    <option key={b.branchId} value={b.branchId}>
                      {b.branchName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Employee
                </label>
                <select
                  required
                  value={adjEmployeeId}
                  onChange={(e) => setAdjEmployeeId(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
                >
                  <option value="">Select Employee...</option>
                  {adjEligibleEmployees.map((emp) => (
                    <option key={emp.employeeId} value={emp.employeeId}>
                      {emp.fullName} ({emp.employeeId}) — {emp.branchName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Type</label>
                <select
                  value={adjType}
                  onChange={(e) => setAdjType(e.target.value as AdjustmentType)}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
                >
                  <option value="BONUS">Bonus (+)</option>
                  <option value="DEDUCTION">Deduction (-)</option>
                  <option value="ADVANCE">Advance Recovery (-)</option>
                  <option value="RETURN_ADJUSTMENT">Return Adjustment (-)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Amount (₹)
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  step="0.01"
                  value={adjAmountRupees}
                  onChange={(e) => setAdjAmountRupees(e.target.value)}
                  placeholder="e.g. 500"
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={savingAdj || isSelectedMonthLocked}
                  className="w-full h-9 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isSelectedMonthLocked ? 'Month Locked' : savingAdj ? 'Saving...' : 'Add Entry'}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Mandatory Audit Reason
              </label>
              <input
                type="text"
                required
                minLength={3}
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                placeholder="e.g. Festival target bonus / Cash advance taken on 15th / Customer bill return adjustment"
                className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs"
              />
            </div>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {filteredAdjustments.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">
                No bonus or deduction adjustments recorded for {formatMonthLabel(selectedMonth)}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                      <th className="py-3 px-4">Employee / Branch</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4 text-right">Amount</th>
                      <th className="py-3 px-4">Reason</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAdjustments.map((adj) => {
                      const isBonus = adj.type === 'BONUS';
                      return (
                        <tr
                          key={adj.adjustmentId}
                          className={adj.status === 'VOIDED' ? 'opacity-55 bg-slate-50/40' : ''}
                        >
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-900">{adj.employeeName}</div>
                            <div className="text-[11px] text-slate-500">
                              <span className="font-mono">{adj.employeeId}</span> ·{' '}
                              {adj.branchName}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-700">
                            {adj.type.replace('_', ' ')}
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-mono tabular-nums font-semibold ${
                              isBonus ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {isBonus ? '+' : '-'}
                            {formatINRFromPaise(adj.amountPaise)}
                          </td>
                          <td className="py-3 px-4 text-slate-700 max-w-xs">{adj.reason}</td>
                          <td className="py-3 px-4 font-semibold">
                            <span
                              className={
                                adj.status === 'ACTIVE' ? 'text-emerald-700' : 'text-slate-400'
                              }
                            >
                              {adj.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-3">
                              {adj.status === 'ACTIVE' ? (
                                <button
                                  type="button"
                                  disabled={voidingId === adj.adjustmentId}
                                  onClick={() => handleVoidAdjustment(adj.adjustmentId)}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 hover:underline cursor-pointer disabled:opacity-50"
                                >
                                  <Ban className="w-3.5 h-3.5" />
                                  {voidingId === adj.adjustmentId ? 'Voiding...' : 'Void'}
                                </button>
                              ) : (
                                <span className="text-slate-400 text-[11px]">Voided</span>
                              )}
                              {confirmDeleteKey === `adj:${adj.adjustmentId}` ? (
                                <span className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={deletingKey === `adj:${adj.adjustmentId}`}
                                    onClick={async () => {
                                      setDeletingKey(`adj:${adj.adjustmentId}`);
                                      setFeedback(null);
                                      try {
                                        await deleteIncentiveAdjustmentByOwner(adj);
                                        setConfirmDeleteKey(null);
                                        setFeedback({
                                          type: 'ok',
                                          text: `Deleted adjustment for ${adj.employeeName}.`,
                                        });
                                        await onRefresh();
                                      } catch (err) {
                                        setFeedback({
                                          type: 'err',
                                          text: err instanceof Error ? err.message : 'Unable to delete adjustment.',
                                        });
                                      } finally {
                                        setDeletingKey(null);
                                      }
                                    }}
                                    className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                                  >
                                    {deletingKey === `adj:${adj.adjustmentId}` ? '...' : 'Confirm'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteKey(null)}
                                    className="px-1.5 py-0.5 rounded border border-slate-200 text-[11px] text-slate-600 cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteKey(`adj:${adj.adjustmentId}`)}
                                  title="Delete adjustment (unlocked months only)"
                                  className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 hover:underline cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 3: EMPLOYEE QUERIES / DISPUTE TICKET DESK                     */}
      {/* ================================================================= */}
      {subTab === 'queries' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[#0F1F3D]" />
              <span className="text-sm font-semibold text-slate-900">
                Employee Incentive &amp; Sale Queries ({filteredQueries.length})
              </span>
            </div>
            <select
              value={queryStatusFilter}
              onChange={(e) => setQueryStatusFilter(e.target.value as 'ALL' | QueryStatus)}
              className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-800"
            >
              <option value="ALL">All Tickets</option>
              <option value="OPEN">Open Only</option>
              <option value="IN_REVIEW">In Review</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>

          {filteredQueries.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-500">
              No employee queries match this filter.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredQueries.map((qItem) => {
                const draftReply = replyDrafts[qItem.queryId] ?? qItem.adminReply ?? '';
                const draftStatus =
                  replyStatusDrafts[qItem.queryId] ??
                  (qItem.status === 'OPEN' ? 'RESOLVED' : qItem.status);
                return (
                  <div
                    key={qItem.queryId}
                    className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{qItem.subject}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          <span className="font-medium text-slate-700">{qItem.employeeName}</span>{' '}
                          (<span className="font-mono">{qItem.employeeId}</span>) ·{' '}
                          {qItem.branchName} · {formatMonthLabel(qItem.monthKey)} ·{' '}
                          {qItem.category.replace('_', ' ')}
                        </p>
                      </div>
                      <span
                        className={`text-xs font-semibold ${
                          qItem.status === 'RESOLVED'
                            ? 'text-emerald-700'
                            : qItem.status === 'IN_REVIEW'
                              ? 'text-blue-700'
                              : 'text-amber-700'
                        }`}
                      >
                        {qItem.status}
                      </span>
                    </div>

                    <p className="text-xs text-slate-700 bg-slate-50 rounded-lg p-3 border border-slate-100 leading-relaxed">
                      {qItem.message}
                    </p>

                    <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                      <input
                        type="text"
                        value={draftReply}
                        onChange={(e) =>
                          setReplyDrafts((prev) => ({
                            ...prev,
                            [qItem.queryId]: e.target.value,
                          }))
                        }
                        placeholder="Write Super Admin reply to employee..."
                        className="flex-1 h-9 px-3 rounded-lg border border-slate-300 text-xs text-slate-900"
                      />
                      <select
                        value={draftStatus}
                        onChange={(e) =>
                          setReplyStatusDrafts((prev) => ({
                            ...prev,
                            [qItem.queryId]: e.target.value as QueryStatus,
                          }))
                        }
                        className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
                      >
                        <option value="IN_REVIEW">In Review</option>
                        <option value="RESOLVED">Resolved</option>
                      </select>
                      <button
                        type="button"
                        disabled={busyQueryId === qItem.queryId}
                        onClick={() => handleResolveQuery(qItem)}
                        className="h-9 px-3.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-60"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {busyQueryId === qItem.queryId ? 'Updating...' : 'Save Reply'}
                      </button>
                      {confirmDeleteKey === `qry:${qItem.queryId}` ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            disabled={deletingKey === `qry:${qItem.queryId}`}
                            onClick={async () => {
                              setDeletingKey(`qry:${qItem.queryId}`);
                              setFeedback(null);
                              try {
                                await deleteEmployeeQueryByOwner(qItem);
                                setConfirmDeleteKey(null);
                                setFeedback({
                                  type: 'ok',
                                  text: `Permanently deleted query from ${qItem.employeeName}.`,
                                });
                                await onRefresh();
                              } catch (err) {
                                setFeedback({
                                  type: 'err',
                                  text: err instanceof Error ? err.message : 'Unable to delete query.',
                                });
                              } finally {
                                setDeletingKey(null);
                              }
                            }}
                            className="h-9 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                          >
                            {deletingKey === `qry:${qItem.queryId}` ? '...' : 'Confirm Delete'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteKey(null)}
                            className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-600 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteKey(`qry:${qItem.queryId}`)}
                          title="Delete query ticket"
                          className="h-9 px-3 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
