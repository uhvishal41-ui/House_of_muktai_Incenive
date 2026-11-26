import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileDown,
  FileSpreadsheet,
  FileText,
  History,
  Pencil,
  Printer,
  RotateCcw,
  Save,
  Search,
  Shield,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { COMPANY_BRAND } from '../../lib/companyBrand';
import { CompanyLetterhead } from '../common/BrandLogo';
import {
  formatINRFromPaise,
  formatMonthLabel,
  formatQty,
  formatRupeesPlain,
  formatShortDate,
  getCurrentMonthKeyIST,
  getTodayIST,
} from '../../lib/format';
import {
  doesRecordOverlapMonth,
  getOverlappingMonthKeys,
  normalizeRecordPeriod,
} from '../../lib/incentiveEngine';
import {
  downloadEmployeeIncentiveSlipPdf,
  downloadManagementBranchSummaryPdf,
} from '../../lib/pdfGenerator';
import { auth, MAIN_OWNER_EMAIL } from '../../lib/firebase';
import {
  approveImportBatch,
  BACKUP_COLLECTION_NAMES,
  cleanResetUploadedRecords,
  deleteImportBatch,
  exportFullFirestoreBackup,
  listBatchRows,
  publishApprovedBatch,
  purgeMonthRecords,
  recordAuditLog,
  rejectImportBatch,
  updateImportBatch,
  type FullFirestoreBackupSnapshot,
} from '../../services/incentiveService';
import { downloadManagementExcelReport } from '../../services/operationsService';
import { DEFAULT_PORTAL_VISIBILITY } from '../../services/departmentVisibilityService';
import { MonthVisibilityControlCard } from './MonthVisibilityControlCard';
import type {
  AuditLog,
  Branch,
  Employee,
  ImportBatch,
  ImportBatchRow,
  ImportType,
  IncentiveAdjustment,
  IncentiveVersion,
  MonthlySummary,
  PayoutRecord,
  PortalVisibilitySettings,
  PublishedIncentive,
  SalarySlip,
} from '../../types/incentive';

interface Props {
  branches: Branch[];
  employees: Employee[];
  batches: ImportBatch[];
  incentives: PublishedIncentive[];
  monthlySummaries: MonthlySummary[];
  versions: IncentiveVersion[];
  auditLogs: AuditLog[];
  payoutRecords?: PayoutRecord[];
  adjustments?: IncentiveAdjustment[];
  salarySlips?: SalarySlip[];
  visibilitySettings?: PortalVisibilitySettings;
  onRefresh: () => Promise<void>;
}

type SubTab = 'batches' | 'corrections' | 'reports' | 'audit';

export function HistoryAndReports({
  branches,
  employees,
  batches,
  incentives,
  monthlySummaries,
  versions,
  auditLogs,
  payoutRecords = [],
  adjustments = [],
  salarySlips = [],
  visibilitySettings = DEFAULT_PORTAL_VISIBILITY,
  onRefresh,
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>('batches');
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthKeyIST());
  const [selectedBranch, setSelectedBranch] = useState('ALL');
  const [busyBatchId, setBusyBatchId] = useState<string | null>(null);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [backupReceipt, setBackupReceipt] = useState<{
    fileName: string;
    fileSizeBytes: number;
    fileSha256: string;
    manifest: FullFirestoreBackupSnapshot['manifest'];
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Batch Edit / Update drawer state
  const [editingBatch, setEditingBatch] = useState<ImportBatch | null>(null);
  const [editRows, setEditRows] = useState<ImportBatchRow[]>([]);
  const [editDeletedIds, setEditDeletedIds] = useState<string[]>([]);
  const [editLoadingRows, setEditLoadingRows] = useState(false);
  const [editFileName, setEditFileName] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editImportType, setEditImportType] = useState<ImportType>('DAILY');
  const [editPeriodStart, setEditPeriodStart] = useState('');
  const [editPeriodEnd, setEditPeriodEnd] = useState('');
  const [editSearch, setEditSearch] = useState('');
  const [savingBatchEdit, setSavingBatchEdit] = useState(false);

  // Batch Delete confirmation drawer state
  const [deletingBatch, setDeletingBatch] = useState<ImportBatch | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deletingInFlight, setDeletingInFlight] = useState(false);

  // Month Purge confirmation drawer state
  const [purgingMonth, setPurgingMonth] = useState<string | null>(null);
  const [purgeReason, setPurgeReason] = useState('');
  const [purgingInFlight, setPurgingInFlight] = useState(false);

  // Main Owner ONLY: Safe Fresh Start / Clean Reset drawer state
  const isMainOwner = Boolean(
    auth.currentUser?.emailVerified &&
      (auth.currentUser?.email || '').trim().toLowerCase() === MAIN_OWNER_EMAIL.toLowerCase(),
  );
  const [showCleanResetPanel, setShowCleanResetPanel] = useState(false);
  const [resetIncludeEmployees, setResetIncludeEmployees] = useState(true);
  const [resetConfirmWord, setResetConfirmWord] = useState('');
  const [resetReason, setResetReason] = useState(
    'Fresh payroll setup after verified full JSON backup',
  );
  const [resettingInFlight, setResettingInFlight] = useState(false);

  const employeesById = useMemo(() => {
    const map: Record<string, Employee> = {};
    for (const e of employees) map[e.employeeId.toUpperCase()] = e;
    return map;
  }, [employees]);

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
    for (const rec of incentives) {
      if (rec.status !== 'PUBLISHED') continue;
      for (const mk of getOverlappingMonthKeys(rec)) set.add(mk);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [activeMonthlySummaries, incentives]);

  const allStoredMonthKeys = useMemo(() => {
    const set = new Set<string>(availableMonths);
    for (const b of batches) {
      const s = (b.periodStart || b.businessDate || '').slice(0, 7);
      const e = (b.periodEnd || b.businessDate || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(s)) set.add(s);
      if (/^\d{4}-\d{2}$/.test(e)) set.add(e);
    }
    for (const s of monthlySummaries) {
      if (/^\d{4}-\d{2}$/.test(s.monthKey)) set.add(s.monthKey);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [availableMonths, batches, monthlySummaries]);

  const handleConfirmPurgeMonth = async () => {
    if (!purgingMonth) return;
    setPurgingInFlight(true);
    setMessage(null);
    try {
      const res = await purgeMonthRecords({
        monthKey: purgingMonth,
        reason: purgeReason,
      });
      setMessage(
        `Removed ${formatMonthLabel(purgingMonth)} records: ${res.deletedBatches} batch(es), ${res.deletedIncentives} incentive(s), ${res.deletedSummaries} summary(s), ${res.deletedNotifications} alert(s), ${res.deletedTargets} target(s).`,
      );
      setPurgingMonth(null);
      setPurgeReason('');
      await onRefresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to delete month records.');
    } finally {
      setPurgingInFlight(false);
    }
  };

  useEffect(() => {
    if (availableMonths.length === 0) {
      if (selectedMonth !== '') setSelectedMonth('');
      return;
    }
    if (!availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  const filteredSummaries = useMemo(() => {
    if (!selectedMonth) return [];
    return activeMonthlySummaries
      .filter((s) => s.monthKey === selectedMonth)
      .filter((s) => selectedBranch === 'ALL' || s.branchId === selectedBranch)
      .sort((a, b) => b.grandTotalPaise - a.grandTotalPaise);
  }, [activeMonthlySummaries, selectedMonth, selectedBranch]);

  const yearlySummaries = useMemo(() => {
    const byYear: Record<
      string,
      {
        year: string;
        months: Set<string>;
        employees: Set<string>;
        totalSaleAmtPaise: number;
        totalSaleQty: number;
        totalIncentivePaise: number;
        bestMonthKey: string;
        bestMonthPaise: number;
        monthTotals: Record<string, number>;
      }
    > = {};

    for (const s of activeMonthlySummaries) {
      if (selectedBranch !== 'ALL' && s.branchId !== selectedBranch) continue;
      const year = s.monthKey.slice(0, 4);
      if (!/^\d{4}$/.test(year)) continue;
      if (!byYear[year]) {
        byYear[year] = {
          year,
          months: new Set(),
          employees: new Set(),
          totalSaleAmtPaise: 0,
          totalSaleQty: 0,
          totalIncentivePaise: 0,
          bestMonthKey: '',
          bestMonthPaise: -1,
          monthTotals: {},
        };
      }
      const bucket = byYear[year];
      bucket.months.add(s.monthKey);
      bucket.employees.add(s.employeeId);
      const rowSaleAmt =
        s.totalSaleAmtPaise ??
        (s.saleAmt1TotalPaise || 0) + (s.saleAmt2TotalPaise || 0) + (s.saleAmt3TotalPaise || 0);
      const rowSaleQty =
        s.totalSaleQty ??
        (s.saleQty1Total || 0) + (s.saleQty2Total || 0) + (s.saleQty3Total || 0);
      bucket.totalSaleAmtPaise += rowSaleAmt;
      bucket.totalSaleQty = Math.round((bucket.totalSaleQty + rowSaleQty) * 100) / 100;
      bucket.totalIncentivePaise += s.grandTotalPaise;
      bucket.monthTotals[s.monthKey] = (bucket.monthTotals[s.monthKey] || 0) + s.grandTotalPaise;
    }

    return Object.values(byYear)
      .map((y) => {
        let bestKey = '';
        let bestVal = -1;
        for (const [mk, val] of Object.entries(y.monthTotals)) {
          if (val > bestVal) {
            bestVal = val;
            bestKey = mk;
          }
        }
        return {
          year: y.year,
          monthsCount: y.months.size,
          staffCount: y.employees.size,
          totalSaleAmtPaise: y.totalSaleAmtPaise,
          totalSaleQty: y.totalSaleQty,
          totalIncentivePaise: y.totalIncentivePaise,
          bestMonthKey: bestKey,
          bestMonthPaise: bestVal > 0 ? bestVal : 0,
        };
      })
      .sort((a, b) => b.year.localeCompare(a.year));
  }, [activeMonthlySummaries, selectedBranch]);

  const reportTotals = useMemo(() => {
    return filteredSummaries.reduce(
      (acc, s) => ({
        c1: acc.c1 + s.component1TotalPaise,
        c2: acc.c2 + s.component2TotalPaise,
        c3: acc.c3 + s.component3TotalPaise,
        total: acc.total + s.grandTotalPaise,
        sa1: acc.sa1 + (s.saleAmt1TotalPaise || 0),
        sq1: Math.round((acc.sq1 + (s.saleQty1Total || 0)) * 100) / 100,
        sa2: acc.sa2 + (s.saleAmt2TotalPaise || 0),
        sq2: Math.round((acc.sq2 + (s.saleQty2Total || 0)) * 100) / 100,
        sa3: acc.sa3 + (s.saleAmt3TotalPaise || 0),
        sq3: Math.round((acc.sq3 + (s.saleQty3Total || 0)) * 100) / 100,
        saleAmt:
          acc.saleAmt +
          (s.totalSaleAmtPaise ??
            (s.saleAmt1TotalPaise || 0) + (s.saleAmt2TotalPaise || 0) + (s.saleAmt3TotalPaise || 0)),
        saleQty:
          Math.round(
            (acc.saleQty +
              (s.totalSaleQty ??
                (s.saleQty1Total || 0) + (s.saleQty2Total || 0) + (s.saleQty3Total || 0))) *
              100,
          ) / 100,
      }),
      {
        c1: 0,
        c2: 0,
        c3: 0,
        total: 0,
        sa1: 0,
        sq1: 0,
        sa2: 0,
        sq2: 0,
        sa3: 0,
        sq3: 0,
        saleAmt: 0,
        saleQty: 0,
      },
    );
  }, [filteredSummaries]);

  const customPeriodRecords = useMemo(() => {
    if (!selectedMonth) return [];
    return incentives
      .filter((r) => r.status === 'PUBLISHED')
      .filter((r) => normalizeRecordPeriod(r).importType === 'CUSTOM_PERIOD')
      .filter((r) => doesRecordOverlapMonth(r, selectedMonth))
      .filter((r) => selectedBranch === 'ALL' || r.branchId === selectedBranch)
      .sort((a, b) =>
        normalizeRecordPeriod(b).periodStart.localeCompare(normalizeRecordPeriod(a).periodStart),
      );
  }, [incentives, selectedMonth, selectedBranch]);

  const handleBatchApprove = async (batch: ImportBatch) => {
    setBusyBatchId(batch.batchId);
    setMessage(null);
    try {
      await approveImportBatch(batch.batchId);
      setMessage(`Approved batch ${batch.batchId}.`);
      await onRefresh();
    } finally {
      setBusyBatchId(null);
    }
  };

  const handleBatchPublish = async (batch: ImportBatch) => {
    setBusyBatchId(batch.batchId);
    setMessage(null);
    try {
      const rows = await listBatchRows(batch.batchId);
      const res = await publishApprovedBatch({ batch, rows, employeesById });
      setMessage(
        `Published batch ${batch.batchId}: ${res.publishedCount} new record(s), ${res.correctedCount} versioned correction(s)${
          res.supersededCount > 0 ? `, ${res.supersededCount} prior overlapping record(s) soft-superseded` : ''
        }.`,
      );
      await onRefresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to publish batch.');
      await onRefresh();
    } finally {
      setBusyBatchId(null);
    }
  };

  const handleBatchReject = async (batch: ImportBatch) => {
    setBusyBatchId(batch.batchId);
    setMessage(null);
    try {
      await rejectImportBatch(batch.batchId, 'Rejected from Upload History queue by Super Admin.');
      setMessage(`Rejected batch ${batch.batchId}.`);
      await onRefresh();
    } finally {
      setBusyBatchId(null);
    }
  };

  const handleOpenBatchEditor = async (batch: ImportBatch) => {
    setDeletingBatch(null);
    setEditingBatch(batch);
    setEditFileName(batch.fileName);
    setEditNote(batch.correctionNote || '');
    setEditImportType(batch.importType || 'DAILY');
    setEditPeriodStart(batch.periodStart || batch.businessDate);
    setEditPeriodEnd(batch.periodEnd || batch.businessDate);
    setEditDeletedIds([]);
    setEditSearch('');
    setEditRows([]);
    setEditLoadingRows(true);
    setMessage(null);
    try {
      const rows = await listBatchRows(batch.batchId);
      setEditRows(rows);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to load batch rows.');
      setEditingBatch(null);
    } finally {
      setEditLoadingRows(false);
    }
  };

  const handleEditRowNumberField = (
    rowId: string,
    field:
      | 'component1Paise'
      | 'component2Paise'
      | 'component3Paise'
      | 'saleAmt1Paise'
      | 'saleAmt2Paise'
      | 'saleAmt3Paise'
      | 'saleQty1'
      | 'saleQty2'
      | 'saleQty3',
    rawValue: string,
  ) => {
    const parsed = Number.parseFloat(rawValue);
    const safeVal = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    const isPaiseField = field.endsWith('Paise');
    const storedVal = isPaiseField ? Math.round(safeVal * 100) : Math.round(safeVal * 100) / 100;

    setEditRows((prev) =>
      prev.map((row) => {
        if (row.rowId !== rowId) return row;
        const next: ImportBatchRow = {
          ...row,
          [field]: storedVal,
        };
        const c1 = next.component1Paise || 0;
        const c2 = next.component2Paise || 0;
        const c3 = next.component3Paise || 0;
        const sa1 = next.saleAmt1Paise || 0;
        const sa2 = next.saleAmt2Paise || 0;
        const sa3 = next.saleAmt3Paise || 0;
        const sq1 = next.saleQty1 || 0;
        const sq2 = next.saleQty2 || 0;
        const sq3 = next.saleQty3 || 0;
        next.totalPaise = c1 + c2 + c3;
        next.totalSaleAmtPaise = sa1 + sa2 + sa3;
        next.totalSaleQty = Math.round((sq1 + sq2 + sq3) * 100) / 100;
        return next;
      }),
    );
  };

  const handleToggleDeleteEditRow = (rowId: string) => {
    setEditDeletedIds((prev) =>
      prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId],
    );
  };

  const filteredEditRows = useMemo(() => {
    const q = editSearch.trim().toLowerCase();
    if (!q) return editRows;
    return editRows.filter(
      (r) =>
        r.employeeId.toLowerCase().includes(q) ||
        (r.employeeName || '').toLowerCase().includes(q) ||
        (r.branchName || '').toLowerCase().includes(q),
    );
  }, [editRows, editSearch]);

  const editLiveTotals = useMemo(() => {
    const deletedSet = new Set(editDeletedIds);
    const active = editRows.filter((r) => !deletedSet.has(r.rowId) && r.resolution !== 'SKIP');
    return {
      keptRows: editRows.length - editDeletedIds.length,
      removedRows: editDeletedIds.length,
      totalIncentivePaise: active.reduce((s, r) => s + (r.totalPaise || 0), 0),
      totalSaleAmtPaise: active.reduce((s, r) => s + (r.totalSaleAmtPaise || 0), 0),
      totalSaleQty:
        Math.round(active.reduce((s, r) => s + (r.totalSaleQty || 0), 0) * 100) / 100,
    };
  }, [editRows, editDeletedIds]);

  const handleSaveBatchUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBatch) return;
    setSavingBatchEdit(true);
    setMessage(null);
    try {
      const res = await updateImportBatch({
        batch: editingBatch,
        fileName: editFileName,
        correctionNote: editNote,
        importType: editImportType,
        periodStart: editPeriodStart,
        periodEnd: editImportType === 'DAILY' ? editPeriodStart : editPeriodEnd,
        updatedRows: editRows,
        deletedRowIds: editDeletedIds,
        employeesById,
      });
      setMessage(
        editingBatch.status === 'PUBLISHED'
          ? `Updated PUBLISHED batch ${editingBatch.batchId}: ${res.publishedRecordsUpdated} statement(s) revised (version history saved), ${res.publishedRecordsDeleted} row(s) removed, and Monthly Summaries recalculated.`
          : `Updated batch ${editingBatch.batchId}: ${res.updatedRowCount} row(s) saved${
              res.deletedRowCount > 0 ? `, ${res.deletedRowCount} row(s) removed` : ''
            }.`,
      );
      setEditingBatch(null);
      setEditRows([]);
      setEditDeletedIds([]);
      await onRefresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to update batch.');
    } finally {
      setSavingBatchEdit(false);
    }
  };

  const handleConfirmDeleteBatch = async () => {
    if (!deletingBatch) return;
    setDeletingInFlight(true);
    setMessage(null);
    try {
      const res = await deleteImportBatch({
        batch: deletingBatch,
        reason: deleteReason,
        employeesById,
      });
      setMessage(
        `Deleted batch ${deletingBatch.batchId} (${deletingBatch.fileName}): ${res.deletedRowsCount} batch row(s)${
          res.deletedPublishedCount > 0
            ? `, ${res.deletedPublishedCount} published statement(s) rolled back & Monthly Summaries updated`
            : ''
        }. Audit log recorded.`,
      );
      if (editingBatch?.batchId === deletingBatch.batchId) {
        setEditingBatch(null);
        setEditRows([]);
      }
      setDeletingBatch(null);
      setDeleteReason('');
      await onRefresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to delete batch.');
    } finally {
      setDeletingInFlight(false);
    }
  };

  const handleExportJsonBackup = async () => {
    setExportingBackup(true);
    setMessage(null);
    try {
      const { snapshot, serializedJson, fileSha256, fileSizeBytes } =
        await exportFullFirestoreBackup();
      const count = snapshot.manifest.collectionCount;
      const fileName = `house-of-muktai-firestore-backup-${count}-collections-${getTodayIST()}.json`;
      const blob = new Blob([serializedJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);

      setBackupReceipt({
        fileName,
        fileSizeBytes,
        fileSha256,
        manifest: snapshot.manifest,
      });
      setMessage(
        `Verified read-only backup downloaded: ${fileName} (${count}/${count} collections, ${snapshot.manifest.totalDocuments} total documents, zero Firestore writes).`,
      );
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : 'Unable to export full Firestore backup.',
      );
    } finally {
      setExportingBackup(false);
    }
  };

  const handleExecuteCleanReset = async () => {
    if (!isMainOwner) return;
    if (resetConfirmWord.trim().toUpperCase() !== 'RESET') {
      setMessage('Type RESET in uppercase to confirm the Fresh Start Clean Reset.');
      return;
    }
    if (resetReason.trim().length < 4) {
      setMessage('Enter a short audit reason (at least 4 characters) before resetting.');
      return;
    }

    setResettingInFlight(true);
    setMessage(null);
    try {
      // Step 1: ALWAYS download a verified Full JSON Backup BEFORE deleting anything
      const { snapshot, serializedJson, fileSha256, fileSizeBytes } =
        await exportFullFirestoreBackup();
      const count = snapshot.manifest.collectionCount;
      const fileName = `house-of-muktai-PRE-RESET-backup-${count}-collections-${getTodayIST()}.json`;
      const blob = new Blob([serializedJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);

      setBackupReceipt({
        fileName,
        fileSizeBytes,
        fileSha256,
        manifest: snapshot.manifest,
      });

      // Step 2: Safely wipe transactional records (and optionally old Employee Master)
      const res = await cleanResetUploadedRecords({
        includeEmployees: resetIncludeEmployees,
        reason: resetReason.trim(),
      });

      setShowCleanResetPanel(false);
      setResetConfirmWord('');
      setMessage(
        `Fresh Start Clean Reset complete: Pre-reset backup (${fileName}) downloaded, ${res.totalDeleted} old document(s) cleared (${resetIncludeEmployees ? 'including old Employee Master for Dual-ID upload' : 'Employee Master preserved'}). 12 Branches, Admin/Owner Accounts, Portal Settings & Audit Logs are 100% intact.`,
      );
      await onRefresh();
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : 'Unable to complete Clean Reset.',
      );
    } finally {
      setResettingInFlight(false);
    }
  };

  const handleExportCsvLedger = async () => {
    const header = [
      'Month',
      'NAME',
      'Employee Name',
      'Employee ID',
      'Sale Amt (New Items Sale)',
      'Sale Qty (New Items Sale)',
      'New Items Sale Incentive',
      'Sale Amt (Old Items Sale)',
      'Sale Qty (Old Items Sale)',
      'Old Items Sale Incentive',
      'Sale Amt (Other Items Sale)',
      'Sale Qty (Other Items Sale)',
      'Other Items Sale Incentive',
      'Total Sale Amt',
      'Total Sale Qty',
      'Total Incentive',
      'Published Days',
    ].join(',');

    const lines = filteredSummaries.map((s) =>
      [
        s.monthKey,
        `"${s.branchName.replace(/"/g, '""')}"`,
        `"${s.employeeName.replace(/"/g, '""')}"`,
        s.employeeId,
        formatRupeesPlain(s.saleAmt1TotalPaise || 0),
        s.saleQty1Total || 0,
        formatRupeesPlain(s.component1TotalPaise),
        formatRupeesPlain(s.saleAmt2TotalPaise || 0),
        s.saleQty2Total || 0,
        formatRupeesPlain(s.component2TotalPaise),
        formatRupeesPlain(s.saleAmt3TotalPaise || 0),
        s.saleQty3Total || 0,
        formatRupeesPlain(s.component3TotalPaise),
        formatRupeesPlain(
          s.totalSaleAmtPaise ??
            (s.saleAmt1TotalPaise || 0) + (s.saleAmt2TotalPaise || 0) + (s.saleAmt3TotalPaise || 0),
        ),
        s.totalSaleQty ??
          Math.round(
            ((s.saleQty1Total || 0) + (s.saleQty2Total || 0) + (s.saleQty3Total || 0)) * 100,
          ) / 100,
        formatRupeesPlain(s.grandTotalPaise),
        s.publishedDaysCount,
      ].join(','),
    );

    const companyRows = [
      `"${COMPANY_BRAND.brandNameUpper} — ${COMPANY_BRAND.legalName}"`,
      `"Registered Office: ${COMPANY_BRAND.fullAddress}"`,
      `"Monthly Sales & Incentive Report — ${formatMonthLabel(selectedMonth)} (${selectedMonth})"`,
      '',
    ];

    const blob = new Blob([[...companyRows, header, ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `house-of-muktai-monthly-report-${selectedMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    await recordAuditLog({
      action: 'REPORT_CSV_EXPORTED',
      targetType: 'monthly_report',
      targetId: selectedMonth,
      summary: `Exported monthly incentive CSV report for ${selectedMonth} (${filteredSummaries.length} employees)`,
    });
    await onRefresh();
  };

  const buildBranchSummaryRows = () => {
    const map = new Map<
      string,
      {
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
    const monthAdjs = adjustments.filter(
      (a) => a.monthKey === selectedMonth && a.status === 'ACTIVE',
    );
    const monthPayouts = new Map(
      payoutRecords
        .filter((p) => p.monthKey === selectedMonth)
        .map((p) => [p.employeeId.toUpperCase(), p]),
    );

    for (const s of filteredSummaries) {
      const cur = map.get(s.branchId) || {
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
      const empAdjNet = monthAdjs
        .filter((a) => a.employeeId.toUpperCase() === s.employeeId.toUpperCase())
        .reduce((acc, a) => acc + (a.type === 'BONUS' ? a.amountPaise : -a.amountPaise), 0);
      const payout = monthPayouts.get(s.employeeId.toUpperCase());

      cur.staffCount += 1;
      cur.saleAmtPaise += rowSaleAmt;
      cur.saleQty = Math.round((cur.saleQty + rowSaleQty) * 100) / 100;
      cur.c1Paise += s.component1TotalPaise;
      cur.c2Paise += s.component2TotalPaise;
      cur.c3Paise += s.component3TotalPaise;
      cur.grossIncentivePaise += s.grandTotalPaise;
      cur.adjustmentsNetPaise += empAdjNet;
      cur.netPayablePaise += s.grandTotalPaise + empAdjNet;
      if (payout?.status === 'PAID') cur.paidCount += 1;
      map.set(s.branchId, cur);
    }

    return Array.from(map.values()).map((b) => ({
      ...b,
      incentivePct:
        b.saleAmtPaise > 0
          ? Math.round((b.grossIncentivePaise / b.saleAmtPaise) * 10000) / 100
          : 0,
    }));
  };

  const handleExportManagementXlsx = async () => {
    setExportingXlsx(true);
    setMessage(null);
    try {
      const branchSummaryRows = buildBranchSummaryRows();
      const monthAdjs = adjustments.filter(
        (a) => a.monthKey === selectedMonth && a.status === 'ACTIVE',
      );
      const monthPayouts = new Map(
        payoutRecords
          .filter((p) => p.monthKey === selectedMonth)
          .map((p) => [p.employeeId.toUpperCase(), p]),
      );

      await downloadManagementExcelReport({
        monthKey: selectedMonth,
        monthLabel: formatMonthLabel(selectedMonth),
        branchRows: branchSummaryRows.map((b) => ({
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
          const empAdjNet = monthAdjs
            .filter((a) => a.employeeId.toUpperCase() === s.employeeId.toUpperCase())
            .reduce((acc, a) => acc + (a.type === 'BONUS' ? a.amountPaise : -a.amountPaise), 0);
          const payout = monthPayouts.get(s.employeeId.toUpperCase());
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
            adjustmentsNetRupees: Math.round(empAdjNet) / 100,
            netPayableRupees: Math.round(s.grandTotalPaise + empAdjNet) / 100,
            payoutStatus: payout?.status || 'UNPAID',
            paymentMode: payout?.paymentMode || '',
            paymentReference: payout?.paymentReference || '',
          };
        }),
      });
      setMessage(`Exported formatted Management Excel (.xlsx) for ${formatMonthLabel(selectedMonth)}.`);
      await onRefresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to export Management Excel.');
    } finally {
      setExportingXlsx(false);
    }
  };

  const handleExportBranchPdf = () => {
    void downloadManagementBranchSummaryPdf({
      monthKey: selectedMonth,
      rows: buildBranchSummaryRows(),
    });
  };

  const handleDownloadRowSlip = (s: MonthlySummary) => {
    const emp = employeesById[s.employeeId.toUpperCase()];
    const empAdjs = adjustments.filter(
      (a) =>
        a.monthKey === s.monthKey &&
        a.status === 'ACTIVE' &&
        a.employeeId.toUpperCase() === s.employeeId.toUpperCase(),
    );
    const payout =
      payoutRecords.find(
        (p) =>
          p.monthKey === s.monthKey &&
          p.employeeId.toUpperCase() === s.employeeId.toUpperCase(),
      ) || null;
    const rowSaleAmt =
      s.totalSaleAmtPaise ??
      (s.saleAmt1TotalPaise || 0) + (s.saleAmt2TotalPaise || 0) + (s.saleAmt3TotalPaise || 0);
    const rowSaleQty =
      s.totalSaleQty ??
      Math.round(
        ((s.saleQty1Total || 0) + (s.saleQty2Total || 0) + (s.saleQty3Total || 0)) * 100,
      ) / 100;
    void downloadEmployeeIncentiveSlipPdf({
      employeeName: s.employeeName,
      employeeId: s.employeeId,
      branchName: s.branchName,
      designation: emp?.designation || 'Sales Executive',
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
      totalSaleAmtPaise: rowSaleAmt,
      totalSaleQty: rowSaleQty,
      grossIncentivePaise: s.grandTotalPaise,
      adjustments: empAdjs,
      payout,
      fileName: `incentive-slip-${s.employeeId}-${s.monthKey}.pdf`,
    });
  };

  return (
    <div className="space-y-6">
      <div className="no-print">
        <MonthVisibilityControlCard
          visibilitySettings={visibilitySettings}
          incentives={incentives}
          salarySlips={salarySlips}
          availableMonths={availableMonths}
          defaultFocus="incentives"
          onSaved={async () => {
            await onRefresh();
          }}
        />
      </div>

      <div className="no-print flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="inline-flex p-1 bg-slate-200/70 rounded-xl text-sm overflow-x-auto">
          {(
            [
              ['batches', `Batches (${batches.length})`],
              ['corrections', `Corrections (${versions.length})`],
              ['reports', 'Monthly Reports'],
              ['audit', `Audit Logs (${auditLogs.length})`],
            ] as Array<[SubTab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSubTab(key)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
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
          <button
            type="button"
            disabled={exportingBackup}
            onClick={handleExportJsonBackup}
            className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 cursor-pointer transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            {exportingBackup ? 'Exporting...' : 'Backup JSON'}
          </button>
          {isMainOwner && (
            <button
              type="button"
              onClick={() => {
                setShowCleanResetPanel((v) => !v);
                setResetConfirmWord('');
              }}
              className="h-8 px-3 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 text-xs font-semibold text-rose-800 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Fresh Start Reset
            </button>
          )}
        </div>
      </div>

      {isMainOwner && showCleanResetPanel && (
        <div className="bg-white border-2 border-rose-300 rounded-xl p-5 space-y-4 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-rose-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                Main Owner · Fresh Start Clean Reset
              </h3>
              <p className="text-xs text-slate-600 mt-1">
                Downloads a <strong>verified Full JSON Backup</strong> first, then clears transactional records.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCleanResetPanel(false)}
              className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              aria-label="Close clean reset panel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-950">
              <p className="font-semibold">Preserved:</p>
              <p className="text-[11px] mt-1">
                12 Branches · Owner &amp; Admin Accounts · Portal Settings · Audit Logs
              </p>
            </div>
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-950">
              <p className="font-semibold">Cleared After Auto-Backup:</p>
              <p className="text-[11px] mt-1">
                Incentives, Monthly Summaries, Batches, Salary Slips, Targets, Payouts, Loans, Queries &amp; Alerts
              </p>
            </div>
          </div>

          <label className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={resetIncludeEmployees}
              onChange={(e) => setResetIncludeEmployees(e.target.checked)}
              className="mt-0.5 rounded border-amber-400 text-rose-700 focus:ring-rose-600"
            />
            <span>
              <strong>Also clear Employee Master &amp; Auth Registry</strong> (Use when re-importing a fresh Employee Master sheet).
            </span>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Audit Reason (Logged Permanently)
              </label>
              <input
                type="text"
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                placeholder="e.g. Fresh payroll setup"
                className="w-full h-9 px-3 rounded-lg border border-slate-300 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Type <span className="font-mono font-bold text-rose-700">RESET</span> to unlock
              </label>
              <input
                type="text"
                value={resetConfirmWord}
                onChange={(e) => setResetConfirmWord(e.target.value)}
                placeholder="Type RESET"
                className="w-full h-9 px-3 rounded-lg border border-rose-300 text-xs font-mono uppercase"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowCleanResetPanel(false)}
              disabled={resettingInFlight}
              className="h-9 px-3.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                resettingInFlight ||
                resetConfirmWord.trim().toUpperCase() !== 'RESET' ||
                resetReason.trim().length < 4
              }
              onClick={() => void handleExecuteCleanReset()}
              className="h-9 px-4 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {resettingInFlight
                ? 'Backing up & Resetting...'
                : 'Auto-Backup JSON & Execute Clean Reset'}
            </button>
          </div>
        </div>
      )}

      {message && (
        <div className="p-3.5 rounded-lg bg-slate-900 text-white text-sm">{message}</div>
      )}

      {backupReceipt && (
        <div className="bg-white border border-emerald-200 rounded-xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-emerald-900">
                {backupReceipt.manifest.collectionCount}-Collection Read-Only Backup Manifest
                Verified
              </h3>
              <p className="text-xs text-slate-600 font-mono mt-0.5">
                {backupReceipt.fileName} · {(backupReceipt.fileSizeBytes / 1024).toFixed(1)} KB ·{' '}
                {backupReceipt.manifest.totalDocuments} total docs · {backupReceipt.manifest.exportedAtUtc}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setBackupReceipt(null)}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 self-start sm:self-auto cursor-pointer"
            >
              Dismiss
            </button>
          </div>
          <div className="text-xs font-mono text-slate-700 break-all space-y-1">
            <div>
              <span className="font-semibold text-slate-900">File SHA-256:</span>{' '}
              {backupReceipt.fileSha256}
            </div>
            <div>
              <span className="font-semibold text-slate-900">Payload SHA-256:</span>{' '}
              {backupReceipt.manifest.payloadSha256}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {backupReceipt.manifest.collections.map((c) => (
              <div
                key={c.collection}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <div className="text-xs font-mono font-semibold text-slate-900 truncate">
                  {c.collection}
                </div>
                <div className="text-sm font-mono tabular-nums font-bold text-emerald-800 mt-0.5">
                  {c.documentCount} docs
                </div>
                <div className="text-[10px] font-mono text-slate-500 truncate" title={c.sha256}>
                  {c.sha256.slice(0, 16)}…
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === 'batches' && (
        <div className="space-y-4">
          {/* Inline Delete Batch Confirmation Panel */}
          {deletingBatch && (
            <div className="bg-white border-2 border-red-200 rounded-xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-red-50 text-red-700 shrink-0 mt-0.5">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-red-900">
                      Confirm Delete Batch — {deletingBatch.fileName}
                    </h3>
                    <p className="text-xs text-slate-600 font-mono mt-0.5">
                      {deletingBatch.batchId} · Status: {deletingBatch.status} ·{' '}
                      {deletingBatch.totalRows} rows ·{' '}
                      {formatINRFromPaise(deletingBatch.totalIncentivePaise)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDeletingBatch(null);
                    setDeleteReason('');
                  }}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                  aria-label="Close delete confirmation"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {deletingBatch.status === 'PUBLISHED' ? (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900 leading-relaxed">
                  <strong>Published Batch Rollback:</strong> Deleting this batch will remove all
                  published employee statements &amp; notifications created by this batch and
                  automatically recalculate Monthly Summaries, Analytics, and the Employee Mobile
                  App. An immutable deletion record will remain in Audit Logs.
                </div>
              ) : (
                <p className="text-xs text-slate-600">
                  This will permanently remove this {deletingBatch.status} batch and all its staged
                  rows. An immutable deletion record will be saved in Audit Logs.
                </p>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Deletion Reason (Optional — Saved in Audit Logs)
                </label>
                <input
                  type="text"
                  maxLength={240}
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="e.g. Wrong Excel uploaded / duplicate file / revised sheet available"
                  className="w-full h-9 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={deletingInFlight}
                  onClick={() => {
                    setDeletingBatch(null);
                    setDeleteReason('');
                  }}
                  className="h-9 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deletingInFlight}
                  onClick={handleConfirmDeleteBatch}
                  className="h-9 px-4 rounded-lg bg-red-700 hover:bg-red-800 text-white text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {deletingInFlight ? 'Deleting Batch...' : 'Confirm Delete Batch'}
                </button>
              </div>
            </div>
          )}

          {/* Inline Batch Edit & Update Panel */}
          {editingBatch && (
            <form
              onSubmit={handleSaveBatchUpdate}
              className="bg-white border-2 border-[#0F1F3D]/25 rounded-xl overflow-hidden"
            >
              <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/80 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Edit &amp; Update Batch — {editingBatch.batchId}
                    </h3>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                        editingBatch.status === 'PUBLISHED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {editingBatch.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Edit batch details or update individual employee Sale Amt, Sale Qty, and
                    Incentive figures across all 3 slabs.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingBatch(null);
                    setEditRows([]);
                    setEditDeletedIds([]);
                  }}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200/70 cursor-pointer"
                  aria-label="Close batch editor"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 sm:p-5 space-y-4">
                {editingBatch.status === 'PUBLISHED' && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 leading-relaxed">
                    <strong>Live Published Batch Edit:</strong> Saving updates will archive prior
                    numbers into <strong>Correction History</strong>, update live employee
                    statements &amp; mobile app immediately, and recalculate affected{' '}
                    <strong>Monthly Summaries</strong>. (To change period dates of a published
                    batch, delete it and upload the corrected file.)
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="lg:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Batch / File Name
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={180}
                      value={editFileName}
                      onChange={(e) => setEditFileName(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>

                  <div className="lg:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Update / Audit Reason{' '}
                      {editingBatch.status === 'PUBLISHED' ? (
                        <span className="text-red-700">* (Required, min 4 chars)</span>
                      ) : (
                        <span className="text-slate-400">(Optional)</span>
                      )}
                    </label>
                    <input
                      type="text"
                      required={editingBatch.status === 'PUBLISHED'}
                      minLength={editingBatch.status === 'PUBLISHED' ? 4 : undefined}
                      maxLength={300}
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value)}
                      placeholder="e.g. Corrected Employee ID 459 Old Items Sale incentive"
                      className="w-full h-9 px-3 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>

                  {editingBatch.status !== 'PUBLISHED' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Import Type
                        </label>
                        <select
                          value={editImportType}
                          onChange={(e) => {
                            const nextType = e.target.value as ImportType;
                            setEditImportType(nextType);
                            if (nextType === 'DAILY') {
                              setEditPeriodEnd(editPeriodStart);
                            }
                          }}
                          className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-sm"
                        >
                          <option value="DAILY">DAILY</option>
                          <option value="MONTHLY">MONTHLY</option>
                          <option value="CUSTOM_PERIOD">CUSTOM_PERIOD</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Period Start
                        </label>
                        <input
                          type="date"
                          required
                          value={editPeriodStart}
                          onChange={(e) => {
                            setEditPeriodStart(e.target.value);
                            if (editImportType === 'DAILY') {
                              setEditPeriodEnd(e.target.value);
                            }
                          }}
                          className="w-full h-9 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                        />
                      </div>
                      {editImportType !== 'DAILY' && (
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Period End
                          </label>
                          <input
                            type="date"
                            required
                            value={editPeriodEnd}
                            onChange={(e) => setEditPeriodEnd(e.target.value)}
                            className="w-full h-9 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Search & Row Count Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="relative w-full sm:w-72">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={editSearch}
                      onChange={(e) => setEditSearch(e.target.value)}
                      placeholder="Filter by Employee ID, Name, Branch..."
                      className="w-full h-9 pl-8 pr-3 rounded-lg border border-slate-300 text-xs"
                    />
                  </div>
                  <div className="text-xs font-mono text-slate-600">
                    Showing {filteredEditRows.length} of {editRows.length} rows
                    {editDeletedIds.length > 0 && (
                      <span className="text-red-700 font-semibold">
                        {' '}
                        · {editDeletedIds.length} marked for removal
                      </span>
                    )}
                  </div>
                </div>

                {/* Editable Rows Table */}
                {editLoadingRows ? (
                  <div className="py-10 text-center text-xs text-slate-500">
                    Loading batch rows...
                  </div>
                ) : editRows.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                    No staged rows found in this batch. You can still update the batch name or
                    delete this batch.
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[420px] border border-slate-200 rounded-lg">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                        <tr>
                          <th className="py-2.5 px-3 min-w-[165px]">Employee / Branch</th>
                          <th className="py-2.5 px-2 min-w-[185px]">
                            New Items Sale (Amount / Quantity / Incentive ₹)
                          </th>
                          <th className="py-2.5 px-2 min-w-[185px]">
                            Old Items Sale (Amount / Quantity / Incentive ₹)
                          </th>
                          <th className="py-2.5 px-2 min-w-[185px]">
                            Other Items Sale (Amount / Quantity / Incentive ₹)
                          </th>
                          <th className="py-2.5 px-3 text-right min-w-[115px]">Row Total</th>
                          <th className="py-2.5 px-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredEditRows.map((row) => {
                          const isMarkedDelete = editDeletedIds.includes(row.rowId);
                          return (
                            <tr
                              key={row.rowId}
                              className={
                                isMarkedDelete
                                  ? 'bg-red-50/70 opacity-60'
                                  : 'hover:bg-slate-50/60'
                              }
                            >
                              <td className="py-2.5 px-3 align-top">
                                <div className="font-medium text-slate-900">
                                  {row.employeeName || `Employee ${row.employeeId}`}
                                </div>
                                <div className="text-[11px] font-mono text-slate-500">
                                  ID: {row.employeeId} · {row.branchName || row.branchId || '—'}
                                </div>
                                {row.resolution === 'SKIP' && (
                                  <span className="text-[10px] font-semibold text-amber-700">
                                    SKIPPED
                                  </span>
                                )}
                              </td>

                              {/* Slab 1: New Items Sale */}
                              <td className="py-2 px-2 align-top">
                                <div className="grid grid-cols-3 gap-1">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    disabled={isMarkedDelete}
                                    aria-label={`New Items Sale Amt for ${row.employeeId}`}
                                    value={Math.round(row.saleAmt1Paise || 0) / 100}
                                    onChange={(e) =>
                                      handleEditRowNumberField(
                                        row.rowId,
                                        'saleAmt1Paise',
                                        e.target.value,
                                      )
                                    }
                                    title="New Items Sale Amt (₹)"
                                    className="h-8 px-1.5 rounded border border-slate-300 font-mono text-[11px] text-right w-full disabled:bg-slate-100"
                                  />
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    disabled={isMarkedDelete}
                                    aria-label={`New Items Sale Qty for ${row.employeeId}`}
                                    value={row.saleQty1 || 0}
                                    onChange={(e) =>
                                      handleEditRowNumberField(
                                        row.rowId,
                                        'saleQty1',
                                        e.target.value,
                                      )
                                    }
                                    title="New Items Sale Qty"
                                    className="h-8 px-1.5 rounded border border-slate-300 font-mono text-[11px] text-right w-full disabled:bg-slate-100"
                                  />
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    disabled={isMarkedDelete}
                                    aria-label={`New Items Incentive for ${row.employeeId}`}
                                    value={Math.round(row.component1Paise || 0) / 100}
                                    onChange={(e) =>
                                      handleEditRowNumberField(
                                        row.rowId,
                                        'component1Paise',
                                        e.target.value,
                                      )
                                    }
                                    title="New Items Sale Incentive (₹)"
                                    className="h-8 px-1.5 rounded border border-[#B8923A]/50 bg-[#B8923A]/[0.06] font-mono font-semibold text-[11px] text-right w-full disabled:bg-slate-100"
                                  />
                                </div>
                              </td>

                              {/* Slab 2: Old Items Sale */}
                              <td className="py-2 px-2 align-top">
                                <div className="grid grid-cols-3 gap-1">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    disabled={isMarkedDelete}
                                    aria-label={`Old Items Sale Amt for ${row.employeeId}`}
                                    value={Math.round(row.saleAmt2Paise || 0) / 100}
                                    onChange={(e) =>
                                      handleEditRowNumberField(
                                        row.rowId,
                                        'saleAmt2Paise',
                                        e.target.value,
                                      )
                                    }
                                    title="Old Items Sale Amt (₹)"
                                    className="h-8 px-1.5 rounded border border-slate-300 font-mono text-[11px] text-right w-full disabled:bg-slate-100"
                                  />
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    disabled={isMarkedDelete}
                                    aria-label={`Old Items Sale Qty for ${row.employeeId}`}
                                    value={row.saleQty2 || 0}
                                    onChange={(e) =>
                                      handleEditRowNumberField(
                                        row.rowId,
                                        'saleQty2',
                                        e.target.value,
                                      )
                                    }
                                    title="Old Items Sale Qty"
                                    className="h-8 px-1.5 rounded border border-slate-300 font-mono text-[11px] text-right w-full disabled:bg-slate-100"
                                  />
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    disabled={isMarkedDelete}
                                    aria-label={`Old Items Incentive for ${row.employeeId}`}
                                    value={Math.round(row.component2Paise || 0) / 100}
                                    onChange={(e) =>
                                      handleEditRowNumberField(
                                        row.rowId,
                                        'component2Paise',
                                        e.target.value,
                                      )
                                    }
                                    title="Old Items Sale Incentive (₹)"
                                    className="h-8 px-1.5 rounded border border-[#B8923A]/50 bg-[#B8923A]/[0.06] font-mono font-semibold text-[11px] text-right w-full disabled:bg-slate-100"
                                  />
                                </div>
                              </td>

                              {/* Slab 3: Other Items Sale */}
                              <td className="py-2 px-2 align-top">
                                <div className="grid grid-cols-3 gap-1">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    disabled={isMarkedDelete}
                                    aria-label={`Other Items Sale Amt for ${row.employeeId}`}
                                    value={Math.round(row.saleAmt3Paise || 0) / 100}
                                    onChange={(e) =>
                                      handleEditRowNumberField(
                                        row.rowId,
                                        'saleAmt3Paise',
                                        e.target.value,
                                      )
                                    }
                                    title="Other Items Sale Amt (₹)"
                                    className="h-8 px-1.5 rounded border border-slate-300 font-mono text-[11px] text-right w-full disabled:bg-slate-100"
                                  />
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    disabled={isMarkedDelete}
                                    aria-label={`Other Items Sale Qty for ${row.employeeId}`}
                                    value={row.saleQty3 || 0}
                                    onChange={(e) =>
                                      handleEditRowNumberField(
                                        row.rowId,
                                        'saleQty3',
                                        e.target.value,
                                      )
                                    }
                                    title="Other Items Sale Qty"
                                    className="h-8 px-1.5 rounded border border-slate-300 font-mono text-[11px] text-right w-full disabled:bg-slate-100"
                                  />
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    disabled={isMarkedDelete}
                                    aria-label={`Other Items Incentive for ${row.employeeId}`}
                                    value={Math.round(row.component3Paise || 0) / 100}
                                    onChange={(e) =>
                                      handleEditRowNumberField(
                                        row.rowId,
                                        'component3Paise',
                                        e.target.value,
                                      )
                                    }
                                    title="Other Items Sale Incentive (₹)"
                                    className="h-8 px-1.5 rounded border border-[#B8923A]/50 bg-[#B8923A]/[0.06] font-mono font-semibold text-[11px] text-right w-full disabled:bg-slate-100"
                                  />
                                </div>
                              </td>

                              <td className="py-2.5 px-3 text-right font-mono tabular-nums align-top whitespace-nowrap">
                                <div className="font-semibold text-[#0F1F3D]">
                                  {formatINRFromPaise(row.totalPaise || 0)}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {formatINRFromPaise(row.totalSaleAmtPaise || 0)} ·{' '}
                                  {formatQty(row.totalSaleQty || 0)}
                                </div>
                              </td>

                              <td className="py-2.5 px-2 text-right align-top">
                                <button
                                  type="button"
                                  onClick={() => handleToggleDeleteEditRow(row.rowId)}
                                  className={`p-1.5 rounded text-xs font-medium inline-flex items-center gap-1 cursor-pointer ${
                                    isMarkedDelete
                                      ? 'text-slate-700 hover:bg-slate-200'
                                      : 'text-red-700 hover:bg-red-50'
                                  }`}
                                  title={isMarkedDelete ? 'Restore Row' : 'Remove Row from Batch'}
                                >
                                  {isMarkedDelete ? (
                                    <RotateCcw className="w-3.5 h-3.5" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Footer Live Totals & Save */}
                <div className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
                    <div>
                      <span className="text-slate-500">Rows:</span>{' '}
                      <strong className="text-slate-900">{editLiveTotals.keptRows}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Total Sale:</span>{' '}
                      <strong className="text-slate-900">
                        {formatINRFromPaise(editLiveTotals.totalSaleAmtPaise)}
                      </strong>{' '}
                      <span className="text-slate-500">
                        (Qty {formatQty(editLiveTotals.totalSaleQty)})
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Total Incentive:</span>{' '}
                      <strong className="text-[#0F1F3D]">
                        {formatINRFromPaise(editLiveTotals.totalIncentivePaise)}
                      </strong>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <button
                      type="button"
                      disabled={savingBatchEdit}
                      onClick={() => {
                        setEditingBatch(null);
                        setEditRows([]);
                        setEditDeletedIds([]);
                      }}
                      className="h-9 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingBatchEdit || editLoadingRows}
                      className="h-9 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {savingBatchEdit ? 'Saving Updates...' : 'Save & Update Batch'}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* Upload Batches Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {batches.length === 0 ? (
              <div className="p-12 text-center text-sm text-slate-500">
                No Excel import batches recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Batch / File</th>
                      <th className="py-3 px-4">Type &amp; Period</th>
                      <th className="py-3 px-4 text-right">Rows (Valid / Corrected / Errors)</th>
                      <th className="py-3 px-4 text-right">Incentive &amp; Sales</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {batches.map((b) => {
                      const bType = b.importType || 'DAILY';
                      const bStart = b.periodStart || b.businessDate;
                      const bEnd = b.periodEnd || b.businessDate;
                      const canEdit = b.status !== 'PROCESSING' && b.status !== 'REJECTED';
                      const canDelete = b.status !== 'PROCESSING';
                      return (
                        <tr key={b.batchId} className="hover:bg-slate-50/60">
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-900">{b.fileName}</div>
                            <div className="text-xs text-slate-500 font-mono">
                              {b.batchId} · {b.uploadedByEmail}
                            </div>
                            {b.correctionNote && (
                              <div
                                className="text-[11px] text-slate-500 truncate max-w-[260px] mt-0.5"
                                title={b.correctionNote}
                              >
                                Note: {b.correctionNote}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                            <div className="font-semibold text-[#0F1F3D]">{bType}</div>
                            <div>{bType === 'DAILY' ? bStart : `${bStart} → ${bEnd}`}</div>
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                            {b.validRows} / {b.correctionRows} / {b.errorRows}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="font-medium text-slate-900">
                              {formatINRFromPaise(b.totalIncentivePaise)}
                            </div>
                            {(b.totalSaleAmtPaise || 0) > 0 || (b.totalSaleQty || 0) > 0 ? (
                              <div className="text-[11px] text-slate-500">
                                {formatINRFromPaise(b.totalSaleAmtPaise || 0)} · Qty{' '}
                                {formatQty(b.totalSaleQty || 0)}
                              </div>
                            ) : null}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`text-xs font-semibold ${
                                b.status === 'PUBLISHED'
                                  ? 'text-emerald-700'
                                  : b.status === 'REJECTED' || b.status === 'FAILED'
                                    ? 'text-red-700'
                                    : b.status === 'PROCESSING'
                                      ? 'text-blue-700'
                                      : 'text-amber-700'
                              }`}
                            >
                              {b.status}
                            </span>
                            {b.status === 'FAILED' && b.lastPublishError && (
                              <div
                                className="text-[11px] text-red-600 max-w-[220px] truncate mt-0.5"
                                title={b.lastPublishError}
                              >
                                {b.lastPublishError}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-2">
                              {b.status === 'VALIDATED' && (
                                <>
                                  <button
                                    type="button"
                                    disabled={busyBatchId === b.batchId}
                                    onClick={() => handleBatchApprove(b)}
                                    className="text-xs font-medium text-[#0F1F3D] hover:text-[#9A7625] cursor-pointer"
                                  >
                                    Approve
                                  </button>
                                  <span className="text-slate-300">|</span>
                                  <button
                                    type="button"
                                    disabled={busyBatchId === b.batchId}
                                    onClick={() => handleBatchReject(b)}
                                    className="text-xs font-medium text-amber-800 hover:underline cursor-pointer"
                                  >
                                    Reject
                                  </button>
                                </>
                              )}
                              {(b.status === 'APPROVED' || b.status === 'FAILED') && (
                                <>
                                  <button
                                    type="button"
                                    disabled={busyBatchId === b.batchId}
                                    onClick={() => handleBatchPublish(b)}
                                    className="px-2.5 py-1 rounded bg-[#0F1F3D] text-white text-xs font-medium hover:bg-[#162B50] disabled:opacity-60 cursor-pointer"
                                  >
                                    {busyBatchId === b.batchId
                                      ? 'Publishing...'
                                      : b.status === 'FAILED'
                                        ? 'Retry Publish'
                                        : 'Publish'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busyBatchId === b.batchId}
                                    onClick={() => handleBatchReject(b)}
                                    className="text-xs font-medium text-amber-800 hover:underline cursor-pointer"
                                  >
                                    Reject
                                  </button>
                                </>
                              )}
                              {b.status === 'PROCESSING' && (
                                <span className="text-xs text-blue-700 font-medium">Locked…</span>
                              )}

                              {canEdit && (
                                <button
                                  type="button"
                                  disabled={busyBatchId === b.batchId}
                                  onClick={() => handleOpenBatchEditor(b)}
                                  className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 inline-flex items-center gap-1 cursor-pointer"
                                  title="Edit & Update Batch Rows"
                                >
                                  <Pencil className="w-3 h-3" />
                                  Edit
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  type="button"
                                  disabled={busyBatchId === b.batchId}
                                  onClick={() => {
                                    setEditingBatch(null);
                                    setDeletingBatch(b);
                                    setDeleteReason('');
                                  }}
                                  className="px-2 py-1 rounded border border-red-200 bg-red-50/70 hover:bg-red-100 text-xs font-medium text-red-700 inline-flex items-center gap-1 cursor-pointer"
                                  title="Delete Batch"
                                >
                                  <Trash2 className="w-3 h-3" />
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

      {subTab === 'corrections' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {versions.length === 0 ? (
            <div className="p-10 text-center">
              <History className="w-6 h-6 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-600">No corrections recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Date &amp; Employee</th>
                    <th className="py-3 px-4">Version Change</th>
                    <th className="py-3 px-4 text-right">Previous Total</th>
                    <th className="py-3 px-4 text-right">Revised Total</th>
                    <th className="py-3 px-4">Correction Reason</th>
                    <th className="py-3 px-4">Corrected By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {versions.map((v) => (
                    <tr key={v.versionId} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-mono text-xs text-slate-900">
                        {v.businessDate} · {v.employeeId}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-700">
                        v{v.previousVersion} → v{v.newVersion}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500">
                        {formatINRFromPaise(v.previousTotalPaise)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {formatINRFromPaise(v.newTotalPaise)}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700">{v.correctionReason}</td>
                      <td className="py-3 px-4 text-xs text-slate-500">{v.correctedByEmail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subTab === 'reports' && (
        <div className="space-y-4">
          <div className="no-print bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={selectedMonth}
                disabled={availableMonths.length === 0}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-800 disabled:bg-slate-50 disabled:text-slate-400"
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
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-800"
              >
                <option value="ALL">All Branches ({branches.length})</option>
                {branches.map((b) => (
                  <option key={b.branchId} value={b.branchId}>
                    {b.branchCode} — {b.branchName}
                  </option>
                ))}
              </select>
            </div>

            <div className="inline-flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80">
              <button
                type="button"
                onClick={handleExportManagementXlsx}
                disabled={filteredSummaries.length === 0 || exportingXlsx}
                className="h-8 px-3 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer transition-colors"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                {exportingXlsx ? 'Building...' : 'Excel (.xlsx)'}
              </button>
              <button
                type="button"
                onClick={handleExportBranchPdf}
                disabled={filteredSummaries.length === 0}
                className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer transition-colors"
              >
                <FileText className="w-3.5 h-3.5" />
                Branch PDF
              </button>
              <button
                type="button"
                onClick={handleExportCsvLedger}
                disabled={filteredSummaries.length === 0}
                className="h-8 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                CSV
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={filteredSummaries.length === 0}
                className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />
                Print
              </button>
              {selectedMonth && (
                <button
                  type="button"
                  onClick={() => {
                    setPurgingMonth(selectedMonth);
                    setPurgeReason('');
                  }}
                  className="h-8 px-3 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Month
                </button>
              )}
            </div>
          </div>

          {purgingMonth && (
            <div className="no-print bg-white border-2 border-red-200 rounded-xl p-4 sm:p-5 space-y-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold text-red-900">
                      Permanently Delete All {formatMonthLabel(purgingMonth)} Records?
                    </h3>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Deletes all batches, rows, published incentives, monthly summaries, alerts,
                      and targets for <strong>{formatMonthLabel(purgingMonth)}</strong> across Admin
                      Panel &amp; Employee App.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPurgingMonth(null)}
                  className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  aria-label="Close delete month confirmation"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                <input
                  type="text"
                  value={purgeReason}
                  onChange={(e) => setPurgeReason(e.target.value)}
                  placeholder="Optional audit reason (e.g. Remove test November data)"
                  className="flex-1 h-9 px-3 rounded-lg border border-slate-300 text-xs text-slate-900"
                />
                <div className="inline-flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 border border-slate-200 self-end sm:self-auto">
                  <button
                    type="button"
                    disabled={purgingInFlight}
                    onClick={() => setPurgingMonth(null)}
                    className="h-8 px-3 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={purgingInFlight}
                    onClick={handleConfirmPurgeMonth}
                    className="h-8 px-3.5 rounded-lg bg-red-700 hover:bg-red-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {purgingInFlight
                      ? 'Deleting...'
                      : `Delete ${formatMonthLabel(purgingMonth)}`}
                  </button>
                </div>
              </div>
            </div>
          )}

          <CompanyLetterhead
            documentTitle={
              selectedMonth
                ? `Monthly Sales & Incentive Report — ${formatMonthLabel(selectedMonth)}`
                : 'Monthly Sales & Incentive Report'
            }
            subtitle={
              !selectedMonth
                ? 'No published monthly data available'
                : selectedBranch === 'ALL'
                  ? `All ${branches.length} Branches · ${filteredSummaries.length} Employee Records`
                  : `Branch: ${branches.find((b) => b.branchId === selectedBranch)?.branchName || selectedBranch} · ${filteredSummaries.length} Employee Records`
            }
          />

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {filteredSummaries.length === 0 ? (
              <div className="p-12 text-center text-sm text-slate-500">
                {selectedMonth
                  ? `No published monthly summaries for ${formatMonthLabel(selectedMonth)}.`
                  : 'No published monthly reports available. Import and publish an Excel batch to generate reports.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                      <th className="py-3 px-3">Branch Name</th>
                      <th className="py-3 px-3">Employee Name &amp; ID</th>
                      <th className="py-3 px-3">Source</th>
                      <th className="py-3 px-3 text-right">New Items Sale (Amount / Quantity / Incentive)</th>
                      <th className="py-3 px-3 text-right">Old Items Sale (Amount / Quantity / Incentive)</th>
                      <th className="py-3 px-3 text-right">Other Items Sale (Amount / Quantity / Incentive)</th>
                      <th className="py-3 px-3 text-right">Total Sale Amount &amp; Quantity</th>
                      <th className="py-3 px-3 text-right">Total Incentive</th>
                      <th className="py-3 px-3 text-right">Incentive Slip</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSummaries.map((s) => {
                      const rowSaleAmt =
                        s.totalSaleAmtPaise ??
                        (s.saleAmt1TotalPaise || 0) +
                          (s.saleAmt2TotalPaise || 0) +
                          (s.saleAmt3TotalPaise || 0);
                      const rowSaleQty =
                        s.totalSaleQty ??
                        Math.round(
                          ((s.saleQty1Total || 0) +
                            (s.saleQty2Total || 0) +
                            (s.saleQty3Total || 0)) *
                            100,
                        ) / 100;
                      return (
                        <tr key={s.summaryId} className="hover:bg-slate-50/60">
                          <td className="py-3 px-3 font-medium text-slate-800 whitespace-nowrap">
                            {s.branchName}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-medium text-slate-900">{s.employeeName}</div>
                            <div className="text-[11px] font-mono text-slate-500">
                              Employee ID: {s.employeeId}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-slate-600 whitespace-nowrap">
                            {s.sourceType === 'MONTHLY_RECORD'
                              ? 'Monthly'
                              : `Daily (${s.publishedDaysCount}d)`}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="font-semibold text-slate-900">
                              {formatINRFromPaise(s.component1TotalPaise)}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {formatINRFromPaise(s.saleAmt1TotalPaise || 0)} · Qty{' '}
                              {formatQty(s.saleQty1Total || 0)}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="font-semibold text-slate-900">
                              {formatINRFromPaise(s.component2TotalPaise)}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {formatINRFromPaise(s.saleAmt2TotalPaise || 0)} · Qty{' '}
                              {formatQty(s.saleQty2Total || 0)}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="font-semibold text-slate-900">
                              {formatINRFromPaise(s.component3TotalPaise)}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {formatINRFromPaise(s.saleAmt3TotalPaise || 0)} · Qty{' '}
                              {formatQty(s.saleQty3Total || 0)}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="font-medium text-slate-800">
                              {formatINRFromPaise(rowSaleAmt)}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              Qty: {formatQty(rowSaleQty)}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-[#0F1F3D] whitespace-nowrap">
                            {formatINRFromPaise(s.grandTotalPaise)}
                          </td>
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handleDownloadRowSlip(s)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-[#0F1F3D] cursor-pointer"
                              title="Download Employee PDF Incentive Slip"
                            >
                              <FileDown className="w-3.5 h-3.5" />
                              PDF
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
                      <td className="py-3 px-3" colSpan={3}>
                        Grand Total ({filteredSummaries.length} Employees)
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <div>{formatINRFromPaise(reportTotals.c1)}</div>
                        <div className="text-[11px] font-normal text-slate-600">
                          {formatINRFromPaise(reportTotals.sa1)} · Qty {formatQty(reportTotals.sq1)}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <div>{formatINRFromPaise(reportTotals.c2)}</div>
                        <div className="text-[11px] font-normal text-slate-600">
                          {formatINRFromPaise(reportTotals.sa2)} · Qty {formatQty(reportTotals.sq2)}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <div>{formatINRFromPaise(reportTotals.c3)}</div>
                        <div className="text-[11px] font-normal text-slate-600">
                          {formatINRFromPaise(reportTotals.sa3)} · Qty {formatQty(reportTotals.sq3)}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <div>{formatINRFromPaise(reportTotals.saleAmt)}</div>
                        <div className="text-[11px] font-normal text-slate-600">
                          Qty: {formatQty(reportTotals.saleQty)}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-[#0F1F3D] whitespace-nowrap">
                        {formatINRFromPaise(reportTotals.total)}
                      </td>
                      <td className="py-3 px-3" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Yearly Incentive Summary Table (All Published Years) */}
          {yearlySummaries.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[#0F1F3D]">
                    Yearly Incentive Summary
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Annual published totals across{' '}
                    {selectedBranch === 'ALL'
                      ? 'all branches'
                      : branches.find((b) => b.branchId === selectedBranch)?.branchName ||
                        selectedBranch}{' '}
                    (double-counting-safe monthly summaries).
                  </p>
                </div>
                <span className="text-[11px] font-mono font-semibold text-[#9A7625] bg-[#B8923A]/10 px-2.5 py-1 rounded-md">
                  {yearlySummaries.length} Year{yearlySummaries.length > 1 ? 's' : ''}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                      <th className="py-3 px-4">Calendar Year</th>
                      <th className="py-3 px-4 text-right">Published Months</th>
                      <th className="py-3 px-4 text-right">Active Staff</th>
                      <th className="py-3 px-4 text-right">Total Sale Amount</th>
                      <th className="py-3 px-4 text-right">Total Sale Quantity</th>
                      <th className="py-3 px-4">Peak Month</th>
                      <th className="py-3 px-4 text-right">Yearly Published Incentive</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {yearlySummaries.map((yr) => (
                      <tr key={yr.year} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-semibold text-[#0F1F3D] font-mono">
                          {yr.year}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                          {yr.monthsCount}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                          {yr.staffCount}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                          {formatINRFromPaise(yr.totalSaleAmtPaise)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {formatQty(yr.totalSaleQty)}
                        </td>
                        <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                          {yr.bestMonthKey ? (
                            <span>
                              {formatMonthLabel(yr.bestMonthKey)}{' '}
                              <span className="font-mono text-slate-500">
                                ({formatINRFromPaise(yr.bestMonthPaise)})
                              </span>
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-[#0F1F3D] whitespace-nowrap">
                          {formatINRFromPaise(yr.totalIncentivePaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Separate Custom Period Statements Table (Never Mixed Into Monthly Sums) */}
          {customPeriodRecords.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900">
                  Custom Period Statements ({customPeriodRecords.length})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Stored separately with exact start and end dates. Never added into Monthly Totals
                  to prevent double counting.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Period Range</th>
                      <th className="py-3 px-4">Employee</th>
                      <th className="py-3 px-4">Branch</th>
                      <th className="py-3 px-4 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {customPeriodRecords.map((rec) => {
                      const norm = normalizeRecordPeriod(rec);
                      return (
                        <tr key={rec.recordId} className="hover:bg-slate-50/60">
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-800 whitespace-nowrap">
                            {formatShortDate(norm.periodStart)} – {formatShortDate(norm.periodEnd)}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-medium text-slate-900">{rec.employeeName}</span>{' '}
                            <span className="font-mono text-slate-500">({rec.employeeId})</span>
                          </td>
                          <td className="py-3 px-4 text-slate-700">{rec.branchName}</td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                            {formatINRFromPaise(rec.totalPaise)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {subTab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {auditLogs.length === 0 ? (
            <div className="p-12 text-center">
              <Shield className="w-6 h-6 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-600">No audit events recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Timestamp (IST)</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Actor</th>
                    <th className="py-3 px-4">Target</th>
                    <th className="py-3 px-4">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {auditLogs.map((log) => (
                    <tr key={log.logId} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString('en-IN', {
                          timeZone: 'Asia/Kolkata',
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-slate-900 whitespace-nowrap">
                        {log.action.includes('REJECT') ? (
                          <span className="inline-flex items-center gap-1 text-red-700">
                            <XCircle className="w-3.5 h-3.5" />
                            {log.action}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {log.action}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-700">{log.actorEmail}</td>
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {log.targetType} / {log.targetId}
                      </td>
                      <td className="py-3 px-4 text-slate-700">{log.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
