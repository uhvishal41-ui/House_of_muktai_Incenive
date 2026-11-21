import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  RefreshCw,
  ShieldAlert,
  Upload,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { auth } from '../../lib/firebase';
import {
  formatINRFromPaise,
  formatQty,
  formatRupeesPlain,
  formatShortDate,
  getTodayIST,
} from '../../lib/format';
import {
  formatImportTypeLabel,
  getLastDayOfMonth,
  validateImportBatch,
} from '../../lib/incentiveEngine';
import {
  approveEmployeeBranchTransfer,
  approveImportBatch,
  publishApprovedBatch,
  rejectImportBatch,
  stageValidatedBatch,
  syncMastersFromErpRows,
} from '../../services/incentiveService';
import type {
  Branch,
  Employee,
  ExcelColumnMapping,
  ExcelParseResponse,
  ImportBatch,
  ImportBatchRow,
  ImportType,
  OverlapResolutionMode,
  PublishedIncentive,
  RowResolution,
} from '../../types/incentive';

interface Props {
  branches: Branch[];
  employees: Employee[];
  publishedIncentives: PublishedIncentive[];
  onRefresh: () => Promise<void>;
}

type FilterMode = 'ALL' | 'VALID' | 'ERROR' | 'DUPLICATE' | 'OVERLAP' | 'TRANSFER';

export function ExcelImportWorkflow({
  branches,
  employees,
  publishedIncentives,
  onRefresh,
}: Props) {
  const [parsed, setParsed] = useState<ExcelParseResponse | null>(null);
  const [mapping, setMapping] = useState<ExcelColumnMapping>({
    businessDate: '',
    employeeId: '',
    employeeName: '',
    branchCode: '',
    component1: '',
    component2: '',
    component3: '',
    saleAmt1: '',
    saleQty1: '',
    saleAmt2: '',
    saleQty2: '',
    saleAmt3: '',
    saleQty3: '',
  });
  const [overrides, setOverrides] = useState<
    Record<number, { resolution: RowResolution; correctionReason: string }>
  >({});
  const [overlapResolutionMode, setOverlapResolutionMode] =
    useState<OverlapResolutionMode>('BLOCK');
  const [overlapReconcileReason, setOverlapReconcileReason] = useState('');
  // Explicit Super Admin period selection when uploaded Excel has no Row 1 date banner
  const [manualPeriodMode, setManualPeriodMode] = useState<ImportType>('MONTHLY');
  const [manualMonthKey, setManualMonthKey] = useState<string>(() => {
    const today = getTodayIST();
    const [yStr, mStr] = today.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    const prevY = m === 1 ? y - 1 : y;
    const prevM = m === 1 ? 12 : m - 1;
    return `${prevY}-${String(prevM).padStart(2, '0')}`;
  });
  const [manualSingleDate, setManualSingleDate] = useState<string>(() => getTodayIST());
  const [manualCustomStart, setManualCustomStart] = useState<string>('');
  const [manualCustomEnd, setManualCustomEnd] = useState<string>('');
  const [manualPeriodApplied, setManualPeriodApplied] = useState<{
    start: string;
    end: string;
    label: string;
  } | null>(null);
  // Super Admin explicit per-candidate Active/Inactive choice (NO automatic SMPL deactivation)
  const [candidateStatuses, setCandidateStatuses] = useState<Record<string, 'ACTIVE' | 'INACTIVE'>>(
    {},
  );
  const [rowFilter, setRowFilter] = useState<FilterMode>('ALL');
  const [stagedBatch, setStagedBatch] = useState<{
    batch: ImportBatch;
    rows: ImportBatchRow[];
  } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);

  const [busy, setBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [syncingMasters, setSyncingMasters] = useState(false);
  const [approvingTransferId, setApprovingTransferId] = useState<string | null>(null);
  const [sampleType, setSampleType] = useState<ImportType>('DAILY');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err' | 'warn'; text: string } | null>(
    null,
  );

  const employeesById = useMemo(() => {
    const map: Record<string, Employee> = {};
    for (const e of employees) map[e.employeeId.toUpperCase()] = e;
    return map;
  }, [employees]);

  const hasBannerDates = Boolean(parsed?.periodStart && parsed?.periodEnd);
  const effectivePeriodStart = hasBannerDates
    ? parsed!.periodStart
    : manualPeriodApplied?.start || null;
  const effectivePeriodEnd = hasBannerDates
    ? parsed!.periodEnd
    : manualPeriodApplied?.end || null;
  const effectiveBannerText = hasBannerDates
    ? parsed!.reportDateRangeText
    : manualPeriodApplied?.label || parsed?.reportDateRangeText || '';

  const validation = useMemo(() => {
    if (!parsed) return null;
    return validateImportBatch({
      periodStart: effectivePeriodStart,
      periodEnd: effectivePeriodEnd,
      rawBannerDateText: effectiveBannerText,
      rawTotalRows: parsed.rawTotalRows,
      skippedBlankRows: parsed.skippedBlankRows,
      skippedSummaryRows: parsed.skippedSummaryRows,
      rows: parsed.rows,
      mapping,
      branches,
      employees,
      publishedIncentives,
      overrides,
      overlapResolutionMode,
      overlapReconcileReason,
    });
  }, [
    parsed,
    effectivePeriodStart,
    effectivePeriodEnd,
    effectiveBannerText,
    mapping,
    branches,
    employees,
    publishedIncentives,
    overrides,
    overlapResolutionMode,
    overlapReconcileReason,
  ]);

  // Initialize explicit Super Admin status selections (defaults to ACTIVE unless Super Admin chooses INACTIVE)
  useEffect(() => {
    if (!validation) return;
    setCandidateStatuses((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const c of validation.newEmployeeCandidates) {
        if (!next[c.salesmanNo]) {
          next[c.salesmanNo] = 'ACTIVE';
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [validation]);

  const filteredPreview = useMemo(() => {
    if (!validation) return [];
    return validation.rows.filter((r) => {
      if (rowFilter === 'VALID') return r.validationStatus === 'VALID';
      if (rowFilter === 'ERROR') return r.validationStatus === 'ERROR';
      if (rowFilter === 'DUPLICATE') {
        return r.validationStatus === 'DUPLICATE_IN_FILE' || r.validationStatus === 'EXISTS_PUBLISHED';
      }
      if (rowFilter === 'OVERLAP') return r.validationStatus === 'PERIOD_OVERLAP';
      if (rowFilter === 'TRANSFER') return r.validationStatus === 'BRANCH_TRANSFER';
      return true;
    });
  }, [validation, rowFilter]);

  const getBearerHeader = async () => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Super Admin authentication token unavailable.');
    return { Authorization: `Bearer ${token}` };
  };

  const handleDownloadSample = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const headers = await getBearerHeader();
      const activeEmployees = employees.filter((e) => e.status === 'ACTIVE').slice(0, 15);
      const today = getTodayIST();
      const [yStr, mStr] = today.split('-');
      const year = Number(yStr);
      const month = Number(mStr);
      const lastDay = String(getLastDayOfMonth(year, month)).padStart(2, '0');

      let periodStart = today;
      let periodEnd = today;
      if (sampleType === 'MONTHLY') {
        periodStart = `${yStr}-${mStr}-01`;
        periodEnd = `${yStr}-${mStr}-${lastDay}`;
      } else if (sampleType === 'CUSTOM_PERIOD') {
        periodStart = `${yStr}-${mStr}-01`;
        periodEnd = `${yStr}-${mStr}-15`;
      }

      const resp = await fetch('/api/v1/excel/sample-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          periodStart,
          periodEnd,
          rows: activeEmployees.map((e) => ({
            employeeId: e.employeeId,
            employeeName: e.fullName,
            branchName: e.branchName,
          })),
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Template generation failed.' }));
        throw new Error(err.error || 'Template generation failed.');
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `house-of-muktai-${sampleType.toLowerCase()}-${periodStart}-to-${periodEnd}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setFeedback({
        type: 'ok',
        text: `Downloaded ${sampleType} ERP sample workbook (${periodStart} to ${periodEnd}) with Row 1 merged banner and Row 2 ERP headers.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to generate sample template.',
      });
    } finally {
      setBusy(false);
    }
  };

  const processUploadedFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setFeedback({
        type: 'err',
        text: 'Only .xlsx Excel workbooks are supported. Please upload a valid ERP .xlsx file.',
      });
      return;
    }

    setBusy(true);
    setFeedback(null);
    setStagedBatch(null);
    setOverrides({});
    setOverlapResolutionMode('BLOCK');
    setOverlapReconcileReason('');
    setManualPeriodApplied(null);
    setCandidateStatuses({});

    try {
      const headers = await getBearerHeader();
      const formData = new FormData();
      formData.append('file', file);

      const resp = await fetch('/api/v1/excel/parse', {
        method: 'POST',
        headers,
        body: formData,
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Excel parsing failed.');
      }

      const parsedResp = data as ExcelParseResponse;
      setParsed(parsedResp);
      setMapping(parsedResp.suggestedMapping);

      if (parsedResp.dateValidationError) {
        const salesNote =
          parsedResp.excludedSalesColumns.length > 0
            ? ` Ignored non-incentive columns (${parsedResp.excludedSalesColumns.join(', ')}).`
            : '';
        setFeedback({
          type: 'warn',
          text: `${parsedResp.totalRows} employee row(s) parsed cleanly.${salesNote} No Row 1 date banner was found in this Excel sheet — select the Report Period below (e.g. Full Month October) to continue.`,
        });
      } else {
        const skippedParts: string[] = [];
        if (parsedResp.skippedBlankRows > 0) {
          skippedParts.push(`${parsedResp.skippedBlankRows} blank row(s)`);
        }
        if (parsedResp.skippedSummaryRows > 0) {
          skippedParts.push(`${parsedResp.skippedSummaryRows} Grand Total/Subtotal row(s)`);
        }
        const skippedNote =
          skippedParts.length > 0 ? ` Skipped ${skippedParts.join(' and ')}.` : '';
        const salesNote =
          parsedResp.excludedSalesColumns.length > 0
            ? ` Excluded sales columns (${parsedResp.excludedSalesColumns.join(', ')}).`
            : '';

        setFeedback({
          type: parsedResp.excludedSalesColumns.length > 0 ? 'warn' : 'ok',
          text: `Detected ${parsedResp.importType} report (${parsedResp.periodStart} to ${parsedResp.periodEnd}) · ${parsedResp.totalRows} employee rows parsed.${skippedNote}${salesNote}`,
        });
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to parse Excel file.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processUploadedFile(file);
    e.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!busy) setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!busy && !isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processUploadedFile(file);
    }
  };

  const handleRegisterNewMasters = async () => {
    if (!validation) return;
    if (
      validation.missingBranches.length === 0 &&
      validation.newEmployeeCandidates.length === 0
    ) {
      return;
    }

    setSyncingMasters(true);
    setFeedback(null);
    try {
      const result = await syncMastersFromErpRows({
        missingBranches: validation.missingBranches,
        missingEmployees: validation.newEmployeeCandidates.map((c) => ({
          salesmanNo: c.salesmanNo,
          salesPersonName: c.salesPersonName,
          erpBranchName: c.erpBranchName,
          isSmplCandidate: c.isSmplCandidate,
          initialStatus: candidateStatuses[c.salesmanNo] || 'ACTIVE',
        })),
        existingBranches: branches,
        existingEmployees: employees,
      });
      await onRefresh();
      setFeedback({
        type: 'ok',
        text: `Super Admin registered ${result.branchesCreated} branch(es) and ${result.employeesCreated} new employee(s) with your explicitly selected Active/Inactive status. Existing employee statuses were untouched.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to register new master records.',
      });
    } finally {
      setSyncingMasters(false);
    }
  };

  const handleApproveTransfer = async (
    employeeId: string,
    newBranchId: string,
    newBranchName: string,
  ) => {
    const emp = employeesById[employeeId.toUpperCase()];
    if (!emp) return;
    setApprovingTransferId(employeeId);
    setFeedback(null);
    try {
      await approveEmployeeBranchTransfer({
        employee: emp,
        newBranchId,
        newBranchName,
        reason: `Approved during Excel import (${parsed?.fileName || 'ERP export'})`,
      });
      await onRefresh();
      setFeedback({
        type: 'ok',
        text: `Branch transfer approved for Salesman No ${emp.employeeId} (${emp.fullName}): ${emp.branchName} -> ${newBranchName}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to approve branch transfer.',
      });
    } finally {
      setApprovingTransferId(null);
    }
  };

  const handleDownloadErrorReport = async () => {
    if (!validation) return;
    const issueRows = validation.rows.filter((r) => r.validationStatus !== 'VALID');
    if (issueRows.length === 0) return;

    setBusy(true);
    try {
      const headers = await getBearerHeader();
      const resp = await fetch('/api/v1/excel/error-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          rows: issueRows.map((r) => ({
            rowNumber: r.rowNumber,
            businessDate:
              r.importType === 'DAILY'
                ? r.periodStart || 'MISSING'
                : `${r.periodStart} to ${r.periodEnd}`,
            employeeId: r.employeeId || 'MISSING',
            branchCode: r.branchCodeRaw || r.branchName,
            component1Rupees: formatRupeesPlain(r.component1Paise),
            component2Rupees: formatRupeesPlain(r.component2Paise),
            component3Rupees: formatRupeesPlain(r.component3Paise),
            validationStatus: r.validationStatus,
            errorMessage: r.errorMessage,
          })),
        }),
      });
      if (!resp.ok) throw new Error('Error report download failed.');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `validation-error-report-${getTodayIST()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to export error report.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleStageBatch = async () => {
    if (!parsed || !validation) return;
    if (!validation.canStage) {
      setFeedback({
        type: 'err',
        text: validation.blockingReasons.join(' '),
      });
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      // Backend verification call before staging to Firestore
      const headers = await getBearerHeader();
      const verifyResp = await fetch('/api/v1/excel/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          periodStart: effectivePeriodStart,
          periodEnd: effectivePeriodEnd,
          rawBannerDateText: effectiveBannerText,
          rawTotalRows: parsed.rawTotalRows,
          skippedBlankRows: parsed.skippedBlankRows,
          skippedSummaryRows: parsed.skippedSummaryRows,
          mapping,
          rows: parsed.rows,
          branches,
          employees,
          publishedIncentives,
          overrides: Object.fromEntries(
            Object.entries(overrides).map(([k, v]) => [String(k), v]),
          ),
          overlapResolutionMode,
          overlapReconcileReason,
        }),
      });
      const backendValidation = await verifyResp.json();
      if (!verifyResp.ok) {
        throw new Error(backendValidation.error || 'Backend validation rejected this import.');
      }
      if (!backendValidation.canStage) {
        throw new Error(
          (backendValidation.blockingReasons || ['Import blocked by server validation.']).join(' '),
        );
      }

      const importType = validation.period.importType!;
      const periodStart = validation.period.periodStart!;
      const periodEnd = validation.period.periodEnd!;
      const businessDate = importType === 'DAILY' ? periodStart : periodEnd;

      const staged = await stageValidatedBatch({
        fileName: parsed.fileName,
        fileSha256: parsed.fileSha256,
        importType,
        periodStart,
        periodEnd,
        businessDate,
        overlapResolutionMode,
        skippedBlankRows: parsed.skippedBlankRows,
        skippedSummaryRows: parsed.skippedSummaryRows,
        componentLabels: {
          component1: 'New Items Sale',
          component2: 'Old Items Sale',
          component3: 'Other Items Sale',
        },
        rows: validation.rows.map((r) => ({
          rowNumber: r.rowNumber,
          importType: r.importType,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          businessDate: r.businessDate,
          employeeId: r.employeeId,
          employeeName: r.employeeName,
          branchId: r.branchId,
          branchName: r.branchName,
          component1Paise: r.component1Paise,
          component2Paise: r.component2Paise,
          component3Paise: r.component3Paise,
          totalPaise: r.totalPaise,
          saleAmt1Paise: r.saleAmt1Paise,
          saleQty1: r.saleQty1,
          saleAmt2Paise: r.saleAmt2Paise,
          saleQty2: r.saleQty2,
          saleAmt3Paise: r.saleAmt3Paise,
          saleQty3: r.saleQty3,
          totalSaleAmtPaise: r.totalSaleAmtPaise,
          totalSaleQty: r.totalSaleQty,
          validationStatus: r.validationStatus,
          resolution: r.resolution,
          ...(r.conflictingRecordIds.length > 0
            ? { conflictingRecordIds: r.conflictingRecordIds }
            : {}),
          ...(r.correctionReason.trim() ? { correctionReason: r.correctionReason.trim() } : {}),
          ...(r.errorMessage ? { errorMessage: r.errorMessage.slice(0, 300) } : {}),
        })),
      });

      setStagedBatch(staged);
      setFeedback({
        type: 'ok',
        text: `Staged ${importType} batch ${staged.batch.batchId} (${periodStart} to ${periodEnd}) as VALIDATED. Draft data stays hidden from employees until approved and published.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to stage batch.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    if (!stagedBatch) return;
    setBusy(true);
    try {
      await approveImportBatch(stagedBatch.batch.batchId);
      setStagedBatch({
        ...stagedBatch,
        batch: { ...stagedBatch.batch, status: 'APPROVED' },
      });
      setFeedback({
        type: 'ok',
        text: `Batch ${stagedBatch.batch.batchId} approved. Click "Publish Approved Incentives" to release ${formatImportTypeLabel(stagedBatch.batch.importType)} statements to employees.`,
      });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async () => {
    if (!stagedBatch) return;
    setBusy(true);
    setStagedBatch((prev) =>
      prev ? { ...prev, batch: { ...prev.batch, status: 'PROCESSING' } } : prev,
    );
    try {
      const res = await publishApprovedBatch({
        batch: stagedBatch.batch,
        rows: stagedBatch.rows,
        employeesById,
      });
      setStagedBatch({
        ...stagedBatch,
        batch: { ...stagedBatch.batch, status: 'PUBLISHED', lastPublishError: undefined },
      });
      setFeedback({
        type: 'ok',
        text: `Published ${res.publishedCount} new ${stagedBatch.batch.importType} record(s), ${res.correctedCount} versioned correction(s)${
          res.supersededCount > 0
            ? `, and soft-superseded ${res.supersededCount} overlapping prior record(s) (audit history preserved)`
            : ''
        }. Double-counting-safe summaries and notifications updated.`,
      });
      await onRefresh();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Publishing failed.';
      setStagedBatch((prev) =>
        prev
          ? { ...prev, batch: { ...prev.batch, status: 'FAILED', lastPublishError: errMsg } }
          : prev,
      );
      setFeedback({
        type: 'err',
        text: `${errMsg} You can safely click "Retry Publish" — deterministic IDs prevent duplicate records or notifications.`,
      });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!stagedBatch || !rejectReason.trim()) return;
    setBusy(true);
    try {
      await rejectImportBatch(stagedBatch.batch.batchId, rejectReason);
      setStagedBatch({
        ...stagedBatch,
        batch: { ...stagedBatch.batch, status: 'REJECTED', rejectionReason: rejectReason },
      });
      setShowRejectBox(false);
      setRejectReason('');
      setFeedback({
        type: 'warn',
        text: `Batch ${stagedBatch.batch.batchId} marked as REJECTED. Zero records were published to employees.`,
      });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top action bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              ERP Excel Import
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Daily, Monthly &amp; Custom Period (.xlsx)
            </p>
          </div>
          <div className="inline-flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 self-start lg:self-auto">
            <select
              aria-label="Sample template period type"
              value={sampleType}
              onChange={(e) => setSampleType(e.target.value as ImportType)}
              className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700"
            >
              <option value="DAILY">Daily Sample</option>
              <option value="MONTHLY">Monthly Sample</option>
              <option value="CUSTOM_PERIOD">Custom Sample</option>
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={handleDownloadSample}
              className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5" />
              Sample .xlsx
            </button>

            <label className="h-8 px-3.5 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors">
              <Upload className="w-3.5 h-3.5 text-[#DFC27D]" />
              <span>{busy ? 'Processing...' : 'Upload .xlsx'}</span>
              <input
                type="file"
                accept=".xlsx"
                disabled={busy}
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-sm leading-relaxed ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : feedback.type === 'warn'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {!parsed && (
        <div
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`rounded-2xl border-2 border-dashed p-10 sm:p-12 text-center transition-all ${
            isDragging
              ? 'bg-[#0F1F3D]/[0.04] border-[#B8923A] shadow-sm'
              : 'bg-white border-slate-300 hover:border-[#0F1F3D]/40'
          }`}
        >
          <div
            className={`w-12 h-12 rounded-2xl mx-auto mb-3.5 flex items-center justify-center transition-colors ${
              isDragging
                ? 'bg-[#0F1F3D] text-[#DFC27D]'
                : 'bg-[#0F1F3D]/[0.06] text-[#0F1F3D]'
            }`}
          >
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <h3 className="text-sm sm:text-base font-semibold text-[#0F1F3D]">
            {isDragging
              ? 'Drop ERP Excel Workbook (.xlsx) Here'
              : 'Drag & Drop ERP Incentive Sheet (.xlsx)'}
          </h3>
          <p className="text-xs text-slate-500 mt-1.5 max-w-md mx-auto leading-relaxed">
            Supports Daily, Monthly, and Custom Date Range ERP exports matched by Salesman No.
            Duplicate &amp; overlap protection runs automatically before staging.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            <label className="h-9 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors shadow-xs">
              <Upload className="w-3.5 h-3.5 text-[#DFC27D]" />
              <span>{busy ? 'Parsing Workbook...' : 'Browse .xlsx File'}</span>
              <input
                type="file"
                accept=".xlsx"
                disabled={busy}
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>
      )}

      {parsed && validation && (
        <>
          {/* Report Period Selector when uploaded Excel has no Row 1 Date Banner (e.g. direct header Row 1 format) */}
          {!hasBannerDates && !stagedBatch && (
            <div
              className={`p-5 rounded-xl border text-sm space-y-4 ${
                validation.period.valid
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                  : 'bg-amber-50 border-amber-300 text-amber-950'
              }`}
            >
              <div className="flex items-start gap-3">
                {validation.period.valid ? (
                  <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-700" />
                ) : (
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-700" />
                )}
                <div className="space-y-1">
                  <p className="font-semibold">
                    {validation.period.valid
                      ? `Report Period Confirmed: ${validation.period.importType} (${effectivePeriodStart} to ${effectivePeriodEnd})`
                      : 'Select Report Period (No Date Banner Row Found in Excel)'}
                  </p>
                  <p className="text-xs leading-relaxed">
                    {validation.period.valid
                      ? 'Super Admin manually confirmed the report dates for this header-first Excel sheet. You can change the period below before staging.'
                      : 'This Excel file starts directly with column headers (NAME, Sales Person Name, Salesman No...) without a Row 1 date banner. Select the exact Month, Day, or Custom Date Range below to unlock staging and publishing.'}
                  </p>
                </div>
              </div>

              <div className="pl-8 flex flex-wrap items-end gap-3 text-xs">
                <div>
                  <label className="block font-medium mb-1">Import Period Type</label>
                  <select
                    value={manualPeriodMode}
                    onChange={(e) => setManualPeriodMode(e.target.value as ImportType)}
                    className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-900"
                  >
                    <option value="MONTHLY">Full Month (Monthly Sheet)</option>
                    <option value="DAILY">Single Day (Daily Sheet)</option>
                    <option value="CUSTOM_PERIOD">Custom Date Range</option>
                  </select>
                </div>

                {manualPeriodMode === 'MONTHLY' && (
                  <div>
                    <label className="block font-medium mb-1">Select Month</label>
                    <input
                      type="month"
                      value={manualMonthKey}
                      onChange={(e) => setManualMonthKey(e.target.value)}
                      className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 font-mono"
                    />
                  </div>
                )}

                {manualPeriodMode === 'DAILY' && (
                  <div>
                    <label className="block font-medium mb-1">Business Date</label>
                    <input
                      type="date"
                      value={manualSingleDate}
                      onChange={(e) => setManualSingleDate(e.target.value)}
                      className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 font-mono"
                    />
                  </div>
                )}

                {manualPeriodMode === 'CUSTOM_PERIOD' && (
                  <>
                    <div>
                      <label className="block font-medium mb-1">Start Date</label>
                      <input
                        type="date"
                        value={manualCustomStart}
                        onChange={(e) => setManualCustomStart(e.target.value)}
                        className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-medium mb-1">End Date</label>
                      <input
                        type="date"
                        value={manualCustomEnd}
                        onChange={(e) => setManualCustomEnd(e.target.value)}
                        className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 font-mono"
                      />
                    </div>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (manualPeriodMode === 'MONTHLY') {
                      const match = manualMonthKey.match(/^(\d{4})-(\d{2})$/);
                      if (!match) {
                        setFeedback({ type: 'err', text: 'Please select a valid month (YYYY-MM).' });
                        return;
                      }
                      const y = Number(match[1]);
                      const m = Number(match[2]);
                      const lastDay = String(getLastDayOfMonth(y, m)).padStart(2, '0');
                      const start = `${match[1]}-${match[2]}-01`;
                      const end = `${match[1]}-${match[2]}-${lastDay}`;
                      setManualPeriodApplied({
                        start,
                        end,
                        label: `Manual Monthly Selection: ${start} To ${end}`,
                      });
                      setFeedback({
                        type: 'ok',
                        text: `Applied MONTHLY period (${start} to ${end}). Review employees & totals below, then stage and publish.`,
                      });
                    } else if (manualPeriodMode === 'DAILY') {
                      if (!/^\d{4}-\d{2}-\d{2}$/.test(manualSingleDate)) {
                        setFeedback({ type: 'err', text: 'Please select a valid date.' });
                        return;
                      }
                      setManualPeriodApplied({
                        start: manualSingleDate,
                        end: manualSingleDate,
                        label: `Manual Daily Selection: ${manualSingleDate}`,
                      });
                      setFeedback({
                        type: 'ok',
                        text: `Applied DAILY period (${manualSingleDate}).`,
                      });
                    } else {
                      if (
                        !/^\d{4}-\d{2}-\d{2}$/.test(manualCustomStart) ||
                        !/^\d{4}-\d{2}-\d{2}$/.test(manualCustomEnd) ||
                        manualCustomStart > manualCustomEnd
                      ) {
                        setFeedback({
                          type: 'err',
                          text: 'Please select valid Start Date and End Date (Start Date must be on or before End Date).',
                        });
                        return;
                      }
                      setManualPeriodApplied({
                        start: manualCustomStart,
                        end: manualCustomEnd,
                        label: `Manual Custom Selection: ${manualCustomStart} To ${manualCustomEnd}`,
                      });
                      setFeedback({
                        type: 'ok',
                        text: `Applied period (${manualCustomStart} to ${manualCustomEnd}).`,
                      });
                    }
                  }}
                  className="h-9 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium cursor-pointer"
                >
                  Apply Report Period
                </button>
              </div>
            </div>
          )}

          {/* Hard Error Banner if Banner Dates Invalid */}
          {hasBannerDates && !validation.period.valid && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-900 flex items-start gap-3">
              <XCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-700" />
              <div>
                <p className="font-semibold">Import Blocked: Invalid Banner Date Range</p>
                <p className="text-xs mt-1">{validation.period.errorMessage}</p>
              </div>
            </div>
          )}

          {/* Period Overlap Conflict Governance Panel (Block / Skip / Reconcile & Supersede) */}
          {validation.metrics.periodOverlapWarnings > 0 && (
            <div className="p-5 rounded-xl bg-amber-50 border border-amber-300 text-sm text-amber-950 space-y-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-700" />
                <div className="space-y-1">
                  <p className="font-semibold">
                    Period Overlap Conflict Detected ({validation.metrics.periodOverlapWarnings} row
                    {validation.metrics.periodOverlapWarnings > 1 ? 's' : ''})
                  </p>
                  <p className="text-xs leading-relaxed">
                    One or more employees already have published incentives covering overlapping
                    dates (for example, Daily records inside a Monthly period, or a Custom Period
                    overlapping Daily/Monthly data). Choose an explicit Super Admin reconciliation
                    policy below — prior records are never deleted.
                  </p>
                </div>
              </div>

              {!stagedBatch && (
                <div className="pl-8 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
                    <label
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        overlapResolutionMode === 'BLOCK'
                          ? 'bg-white border-amber-700 text-slate-900'
                          : 'bg-amber-50/50 border-amber-200 text-amber-950 hover:bg-white/70'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-semibold">
                        <input
                          type="radio"
                          name="overlapMode"
                          checked={overlapResolutionMode === 'BLOCK'}
                          onChange={() => setOverlapResolutionMode('BLOCK')}
                        />
                        <span>Block Publish (Default)</span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1">
                        Safest mode. Prevents staging until overlaps are inspected.
                      </p>
                    </label>

                    <label
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        overlapResolutionMode === 'SKIP_OVERLAP'
                          ? 'bg-white border-amber-700 text-slate-900'
                          : 'bg-amber-50/50 border-amber-200 text-amber-950 hover:bg-white/70'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-semibold">
                        <input
                          type="radio"
                          name="overlapMode"
                          checked={overlapResolutionMode === 'SKIP_OVERLAP'}
                          onChange={() => setOverlapResolutionMode('SKIP_OVERLAP')}
                        />
                        <span>Option A: Skip Overlapping Rows</span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1">
                        Skips conflicting employees and publishes only clean, non-overlapping rows.
                      </p>
                    </label>

                    <label
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        overlapResolutionMode === 'RECONCILE_SUPERSEDE'
                          ? 'bg-white border-[#0F1F3D] text-slate-900'
                          : 'bg-amber-50/50 border-amber-200 text-amber-950 hover:bg-white/70'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-semibold">
                        <input
                          type="radio"
                          name="overlapMode"
                          checked={overlapResolutionMode === 'RECONCILE_SUPERSEDE'}
                          onChange={() => setOverlapResolutionMode('RECONCILE_SUPERSEDE')}
                        />
                        <span>Option B: Reconcile &amp; Supersede</span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1">
                        Soft-marks conflicting prior records as SUPERSEDED (preserves history) and
                        publishes the new period cleanly.
                      </p>
                    </label>
                  </div>

                  {overlapResolutionMode === 'RECONCILE_SUPERSEDE' && (
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-amber-950">
                        Mandatory Reconciliation Audit Reason (min 4 characters)
                      </label>
                      <input
                        type="text"
                        value={overlapReconcileReason}
                        onChange={(e) => setOverlapReconcileReason(e.target.value)}
                        placeholder="e.g., Month-end audited ERP monthly sheet supersedes provisional daily entries"
                        className="w-full h-9 px-3 rounded-lg border border-amber-400 bg-white text-xs text-slate-900"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 15-Point Mandatory Admin Import Preview Grid */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  1. Admin Import Preview Summary · {parsed.fileName}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {parsed.reportTitle || 'ERP Incentive Export'} · Banner:{' '}
                  <span className="font-mono">{parsed.reportDateRangeText || 'Missing'}</span> ·
                  Header Row {parsed.headerRowNumber}
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500">
                SHA-256: {parsed.fileSha256.slice(0, 12)}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-[11px] text-slate-500">Detected Import Type</p>
                <p className="text-sm font-semibold font-mono text-[#0F1F3D] mt-0.5">
                  {validation.metrics.detectedImportType || 'INVALID'}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-[11px] text-slate-500">Report Start Date</p>
                <p className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                  {validation.metrics.reportStartDate
                    ? formatShortDate(validation.metrics.reportStartDate)
                    : '—'}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-[11px] text-slate-500">Report End Date</p>
                <p className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                  {validation.metrics.reportEndDate
                    ? formatShortDate(validation.metrics.reportEndDate)
                    : '—'}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-[11px] text-slate-500">Total Excel Rows</p>
                <p className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                  {validation.metrics.totalExcelRows}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-[11px] text-slate-500">Total Incentive Amount</p>
                <p className="text-sm font-semibold font-mono tabular-nums text-[#0F1F3D] mt-0.5">
                  {formatINRFromPaise(validation.metrics.totalIncentivePaise)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-[11px] text-slate-500">Total Sale Amount</p>
                <p className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                  {formatINRFromPaise(validation.metrics.totalSaleAmtPaise)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-[11px] text-slate-500">Total Sale Qty</p>
                <p className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                  {formatQty(validation.metrics.totalSaleQty)}
                </p>
              </div>

              <div className="p-3 rounded-lg border border-slate-200">
                <p className="text-[11px] text-slate-500">Valid Employee Rows</p>
                <p className="text-sm font-semibold font-mono tabular-nums text-emerald-700 mt-0.5">
                  {validation.metrics.validEmployeeRows}
                </p>
              </div>
              <div className="p-3 rounded-lg border border-slate-200">
                <p className="text-[11px] text-slate-500">Existing Employees</p>
                <p className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                  {validation.metrics.existingEmployees}
                </p>
              </div>
              <div className="p-3 rounded-lg border border-slate-200">
                <p className="text-[11px] text-slate-500">New Employee Candidates</p>
                <p className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                  {validation.metrics.newEmployeeCandidates}
                </p>
              </div>
              <div className="p-3 rounded-lg border border-slate-200">
                <p className="text-[11px] text-slate-500">SMPL Candidates</p>
                <p className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                  {validation.metrics.smplCandidates}
                </p>
              </div>
              <div className="p-3 rounded-lg border border-slate-200">
                <p className="text-[11px] text-slate-500">Blank Rows Skipped</p>
                <p className="text-sm font-semibold font-mono tabular-nums text-slate-700 mt-0.5">
                  {validation.metrics.blankRowsSkipped}
                </p>
              </div>

              <div className="p-3 rounded-lg border border-slate-200">
                <p className="text-[11px] text-slate-500">Grand Total / Subtotal Skipped</p>
                <p className="text-sm font-semibold font-mono tabular-nums text-slate-700 mt-0.5">
                  {validation.metrics.summaryRowsSkipped}
                </p>
              </div>
              <div className="p-3 rounded-lg border border-slate-200">
                <p className="text-[11px] text-slate-500">Invalid Rows</p>
                <p
                  className={`text-sm font-semibold font-mono tabular-nums mt-0.5 ${
                    validation.metrics.invalidRows > 0 ? 'text-red-700' : 'text-slate-700'
                  }`}
                >
                  {validation.metrics.invalidRows}
                </p>
              </div>
              <div className="p-3 rounded-lg border border-slate-200">
                <p className="text-[11px] text-slate-500">Duplicate Records</p>
                <p
                  className={`text-sm font-semibold font-mono tabular-nums mt-0.5 ${
                    validation.metrics.duplicateRecords > 0 ? 'text-amber-700' : 'text-slate-700'
                  }`}
                >
                  {validation.metrics.duplicateRecords}
                </p>
              </div>
              <div className="p-3 rounded-lg border border-slate-200">
                <p className="text-[11px] text-slate-500">Branch Transfer Warnings</p>
                <p
                  className={`text-sm font-semibold font-mono tabular-nums mt-0.5 ${
                    validation.metrics.branchTransferWarnings > 0
                      ? 'text-amber-700'
                      : 'text-slate-700'
                  }`}
                >
                  {validation.metrics.branchTransferWarnings}
                </p>
              </div>
              <div className="p-3 rounded-lg border border-slate-200">
                <p className="text-[11px] text-slate-500">Period Overlap Warnings</p>
                <p
                  className={`text-sm font-semibold font-mono tabular-nums mt-0.5 ${
                    validation.metrics.periodOverlapWarnings > 0
                      ? 'text-red-700'
                      : 'text-slate-700'
                  }`}
                >
                  {validation.metrics.periodOverlapWarnings}
                </p>
              </div>
            </div>
          </section>

          {/* Super Admin Controlled New Employee Candidates & Missing Branches Onboarding */}
          {!stagedBatch &&
            (validation.missingBranches.length > 0 ||
              validation.newEmployeeCandidates.length > 0) && (
              <section className="bg-white border border-[#B8923A]/40 rounded-xl p-6 space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Super Admin Onboarding Review — Unregistered Branches &amp; New Employee
                      Candidates
                    </h3>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      Found{' '}
                      <strong className="font-mono">{validation.missingBranches.length}</strong>{' '}
                      unregistered branch(es) and{' '}
                      <strong className="font-mono">
                        {validation.newEmployeeCandidates.length}
                      </strong>{' '}
                      new <span className="font-mono">Salesman No</span> candidate(s). Excel import
                      never automatically assigns Inactive status (including for SMPL rows). Select
                      the desired initial status for each candidate below.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={syncingMasters}
                    onClick={handleRegisterNewMasters}
                    className="h-10 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                  >
                    {syncingMasters ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <UserPlus className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {syncingMasters
                        ? 'Registering...'
                        : `Register ${validation.missingBranches.length} Branches & ${validation.newEmployeeCandidates.length} Candidates`}
                    </span>
                  </button>
                </div>

                {validation.newEmployeeCandidates.length > 0 && (
                  <div className="overflow-x-auto max-h-60 border border-slate-200 rounded-lg">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                        <tr>
                          <th className="py-2 px-3">Salesman No</th>
                          <th className="py-2 px-3">Sales Person Name (ERP)</th>
                          <th className="py-2 px-3">Branch</th>
                          <th className="py-2 px-3">Flag</th>
                          <th className="py-2 px-3 text-right">
                            Super Admin Initial Status Selection
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {validation.newEmployeeCandidates.map((cand) => (
                          <tr key={cand.salesmanNo}>
                            <td className="py-2 px-3 font-mono font-medium text-slate-900">
                              {cand.salesmanNo}
                            </td>
                            <td className="py-2 px-3 text-slate-800">{cand.salesPersonName}</td>
                            <td className="py-2 px-3 text-slate-600">{cand.erpBranchName || '—'}</td>
                            <td className="py-2 px-3">
                              {cand.isSmplCandidate ? (
                                <span className="text-amber-800 font-medium">SMPL Candidate</span>
                              ) : (
                                <span className="text-slate-500">Staff</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <select
                                aria-label={`Initial status for ${cand.salesmanNo}`}
                                value={candidateStatuses[cand.salesmanNo] || 'ACTIVE'}
                                onChange={(e) =>
                                  setCandidateStatuses((prev) => ({
                                    ...prev,
                                    [cand.salesmanNo]: e.target.value as 'ACTIVE' | 'INACTIVE',
                                  }))
                                }
                                className="h-7 px-2 rounded border border-slate-300 bg-white text-xs font-medium text-slate-800"
                              >
                                <option value="ACTIVE">ACTIVE</option>
                                <option value="INACTIVE">INACTIVE</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

          {/* Explicit Branch Transfer Review Panel (NEVER Silent Overwrite) */}
          {!stagedBatch && validation.branchTransfers.length > 0 && (
            <section className="bg-white border border-amber-300 rounded-xl p-6 space-y-3">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-amber-700" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Branch Transfer Review ({validation.branchTransfers.length})
                </h3>
              </div>
              <p className="text-xs text-slate-600">
                Existing employees matched by <span className="font-mono">Salesman No</span>{' '}
                appeared under a different branch in this Excel export. Branches are never
                overwritten silently — Super Admin must explicitly approve each transfer.
              </p>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {validation.branchTransfers.map((tr) => (
                  <div
                    key={`${tr.employeeId}_${tr.rowNumber}`}
                    className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <span className="font-mono font-semibold text-slate-900">
                        {tr.employeeId}
                      </span>{' '}
                      · <span className="text-slate-800">{tr.employeeName}</span>
                      <div className="text-slate-500 mt-0.5">
                        Master: <strong className="text-slate-700">{tr.masterBranchName}</strong> →
                        Excel: <strong className="text-amber-800">{tr.excelBranchName}</strong>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={approvingTransferId === tr.employeeId}
                      onClick={() =>
                        handleApproveTransfer(tr.employeeId, tr.excelBranchId, tr.excelBranchName)
                      }
                      className="h-8 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium whitespace-nowrap cursor-pointer disabled:opacity-60"
                    >
                      {approvingTransferId === tr.employeeId
                        ? 'Approving...'
                        : 'Approve Branch Transfer'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Column Mapping Verification */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                2. ERP Column Mapping Verification (12 Columns: Identity + Sale Amt + Sale Qty + Incentive)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Auto-mapped positionally from your Excel headers. Leave Sale Amt / Sale Qty blank if not present in an older sheet.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(
                [
                  ['branchCode', 'Branch Column (NAME)'],
                  ['employeeId', 'Employee ID (Salesman No)'],
                  ['employeeName', 'Employee Name (Sales Person Name)'],
                ] as Array<[keyof ExcelColumnMapping, string]>
              ).map(([field, label]) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
                  <select
                    disabled={Boolean(stagedBatch)}
                    value={mapping[field] || ''}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [field]: e.target.value }))}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 disabled:bg-slate-50"
                  >
                    <option value="">-- Select column --</option>
                    {parsed.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
              {(
                [
                  {
                    title: '1. New Items Sale',
                    saleAmtKey: 'saleAmt1' as keyof ExcelColumnMapping,
                    saleQtyKey: 'saleQty1' as keyof ExcelColumnMapping,
                    incKey: 'component1' as keyof ExcelColumnMapping,
                  },
                  {
                    title: '2. Old Items Sale',
                    saleAmtKey: 'saleAmt2' as keyof ExcelColumnMapping,
                    saleQtyKey: 'saleQty2' as keyof ExcelColumnMapping,
                    incKey: 'component2' as keyof ExcelColumnMapping,
                  },
                  {
                    title: '3. Other Items Sale',
                    saleAmtKey: 'saleAmt3' as keyof ExcelColumnMapping,
                    saleQtyKey: 'saleQty3' as keyof ExcelColumnMapping,
                    incKey: 'component3' as keyof ExcelColumnMapping,
                  },
                ]
              ).map((sec) => (
                <div
                  key={sec.incKey}
                  className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5"
                >
                  <p className="text-xs font-semibold text-slate-800">{sec.title}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Sale Amt (Optional)
                      </label>
                      <select
                        disabled={Boolean(stagedBatch)}
                        value={mapping[sec.saleAmtKey] || ''}
                        onChange={(e) =>
                          setMapping((prev) => ({ ...prev, [sec.saleAmtKey]: e.target.value }))
                        }
                        className="w-full h-8 px-2 rounded-md border border-slate-300 bg-white text-xs text-slate-900 disabled:bg-slate-100"
                      >
                        <option value="">-- None --</option>
                        {parsed.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Sale Qty (Optional)
                      </label>
                      <select
                        disabled={Boolean(stagedBatch)}
                        value={mapping[sec.saleQtyKey] || ''}
                        onChange={(e) =>
                          setMapping((prev) => ({ ...prev, [sec.saleQtyKey]: e.target.value }))
                        }
                        className="w-full h-8 px-2 rounded-md border border-slate-300 bg-white text-xs text-slate-900 disabled:bg-slate-100"
                      >
                        <option value="">-- None --</option>
                        {parsed.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Incentive Column (Required)
                    </label>
                    <select
                      disabled={Boolean(stagedBatch)}
                      value={mapping[sec.incKey] || ''}
                      onChange={(e) =>
                        setMapping((prev) => ({ ...prev, [sec.incKey]: e.target.value }))
                      }
                      className="w-full h-8 px-2 rounded-md border border-slate-300 bg-white text-xs text-slate-900 disabled:bg-slate-100"
                    >
                      <option value="">-- Select column --</option>
                      {parsed.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Validation Row Table */}
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-6 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  3. Row-Level Validation, Duplicate &amp; Overlap Inspection
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Publishable rows: <strong className="font-mono">{validation.metrics.publishableRows}</strong>{' '}
                  · Total Sale: <strong className="font-mono">{formatINRFromPaise(validation.metrics.totalSaleAmtPaise)}</strong>{' '}
                  (Qty <strong className="font-mono">{formatQty(validation.metrics.totalSaleQty)}</strong>){' '}
                  · Total Incentive: <strong className="font-mono text-[#0F1F3D]">{formatINRFromPaise(validation.metrics.totalIncentivePaise)}</strong>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex p-1 bg-slate-100 rounded-lg text-xs overflow-x-auto">
                  {(
                    [
                      ['ALL', 'All'],
                      ['VALID', `Valid (${validation.metrics.validEmployeeRows})`],
                      ['ERROR', `Errors (${validation.metrics.invalidRows})`],
                      ['DUPLICATE', `Duplicates (${validation.metrics.duplicateRecords})`],
                      ['OVERLAP', `Overlaps (${validation.metrics.periodOverlapWarnings})`],
                      ['TRANSFER', `Transfers (${validation.metrics.branchTransferWarnings})`],
                    ] as Array<[FilterMode, string]>
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setRowFilter(key)}
                      className={`px-2.5 py-1.5 rounded-md font-medium whitespace-nowrap transition-colors cursor-pointer ${
                        rowFilter === key
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {validation.metrics.invalidRows +
                  validation.metrics.duplicateRecords +
                  validation.metrics.periodOverlapWarnings +
                  validation.metrics.branchTransferWarnings >
                  0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleDownloadErrorReport}
                    className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Error Report (.xlsx)
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3">Row</th>
                    <th className="py-2.5 px-3">Type / Period</th>
                    <th className="py-2.5 px-3">Salesman No / Name</th>
                    <th className="py-2.5 px-3">Branch</th>
                    <th className="py-2.5 px-3 text-right">New Items Sale</th>
                    <th className="py-2.5 px-3 text-right">Old Items Sale</th>
                    <th className="py-2.5 px-3 text-right">Other Items Sale</th>
                    <th className="py-2.5 px-3 text-right">Total Sale / Qty</th>
                    <th className="py-2.5 px-3 text-right">Total Inc</th>
                    <th className="py-2.5 px-3">Validation / Resolution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredPreview.map((row) => (
                    <tr key={row.rowNumber} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3 font-mono text-slate-500">{row.rowNumber}</td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-slate-800 whitespace-nowrap">
                        <div className="text-[11px] font-semibold text-[#0F1F3D]">{row.importType}</div>
                        <div className="text-[11px] text-slate-500">
                          {row.importType === 'DAILY'
                            ? row.periodStart || '—'
                            : `${row.periodStart} → ${row.periodEnd}`}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-mono font-medium text-slate-900">
                          {row.employeeId || '—'}
                          {row.isSmplCandidate && (
                            <span className="ml-1.5 text-[10px] font-sans font-semibold text-amber-800">
                              SMPL
                            </span>
                          )}
                        </div>
                        <div className="text-slate-500">{row.employeeName}</div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">{row.branchName}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="text-slate-900">{formatINRFromPaise(row.component1Paise)}</div>
                        <div className="text-[10px] text-slate-500">
                          Sale {formatINRFromPaise(row.saleAmt1Paise)} · Q {formatQty(row.saleQty1)}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="text-slate-900">{formatINRFromPaise(row.component2Paise)}</div>
                        <div className="text-[10px] text-slate-500">
                          Sale {formatINRFromPaise(row.saleAmt2Paise)} · Q {formatQty(row.saleQty2)}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="text-slate-900">{formatINRFromPaise(row.component3Paise)}</div>
                        <div className="text-[10px] text-slate-500">
                          Sale {formatINRFromPaise(row.saleAmt3Paise)} · Q {formatQty(row.saleQty3)}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="font-medium text-slate-800">
                          {formatINRFromPaise(row.totalSaleAmtPaise)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Qty {formatQty(row.totalSaleQty)}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-[#0F1F3D] whitespace-nowrap">
                        {formatINRFromPaise(row.totalPaise)}
                      </td>
                      <td className="py-2.5 px-3 min-w-[260px]">
                        {row.validationStatus === 'VALID' && (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            Valid · Ready to publish
                          </span>
                        )}
                        {row.validationStatus === 'ERROR' && (
                          <span className="inline-flex items-start gap-1 text-red-700">
                            <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{row.errorMessage}</span>
                          </span>
                        )}
                        {row.validationStatus === 'BRANCH_TRANSFER' && (
                          <span className="inline-flex items-start gap-1 text-amber-800">
                            <ArrowRightLeft className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{row.errorMessage}</span>
                          </span>
                        )}
                        {row.validationStatus === 'PERIOD_OVERLAP' && (
                          <div className="space-y-1">
                            <span
                              className={`inline-flex items-start gap-1 font-medium ${
                                row.resolution === 'SUPERSEDE_CONFLICTS'
                                  ? 'text-[#0F1F3D]'
                                  : row.resolution === 'SKIP' && overlapResolutionMode === 'SKIP_OVERLAP'
                                    ? 'text-amber-800'
                                    : 'text-red-700'
                              }`}
                            >
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span>{row.errorMessage}</span>
                            </span>
                            {row.resolution === 'SUPERSEDE_CONFLICTS' && (
                              <div className="text-[11px] font-semibold text-[#0F1F3D]">
                                Policy: Will soft-supersede {row.conflictingRecordIds.length} prior
                                record(s) and publish this row.
                              </div>
                            )}
                            {row.resolution === 'SKIP' && overlapResolutionMode === 'SKIP_OVERLAP' && (
                              <div className="text-[11px] font-semibold text-amber-800">
                                Policy: Skipped (non-conflicting employees will still publish).
                              </div>
                            )}
                          </div>
                        )}
                        {row.validationStatus === 'DUPLICATE_IN_FILE' && (
                          <span className="inline-flex items-start gap-1 text-amber-800">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{row.errorMessage}</span>
                          </span>
                        )}
                        {row.validationStatus === 'EXISTS_PUBLISHED' && (
                          <div className="space-y-1.5">
                            <div className="flex items-start gap-1 text-amber-800">
                              <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span>{row.errorMessage}</span>
                            </div>
                            {!stagedBatch && (
                              <div className="flex flex-col gap-1.5 pt-1">
                                <select
                                  value={row.resolution}
                                  onChange={(e) =>
                                    setOverrides((prev) => ({
                                      ...prev,
                                      [row.rowNumber]: {
                                        resolution: e.target.value as RowResolution,
                                        correctionReason: prev[row.rowNumber]?.correctionReason || '',
                                      },
                                    }))
                                  }
                                  className="h-7 px-2 rounded border border-slate-300 bg-white text-xs text-slate-800"
                                >
                                  <option value="SKIP">Skip Duplicate (Do Not Overwrite)</option>
                                  <option value="CORRECTION">
                                    Archive Previous &amp; Publish Correction
                                  </option>
                                </select>
                                {row.resolution === 'CORRECTION' && (
                                  <input
                                    type="text"
                                    placeholder="Mandatory correction reason (min 4 chars)..."
                                    value={row.correctionReason}
                                    onChange={(e) =>
                                      setOverrides((prev) => ({
                                        ...prev,
                                        [row.rowNumber]: {
                                          resolution: 'CORRECTION',
                                          correctionReason: e.target.value,
                                        },
                                      }))
                                    }
                                    className="h-7 px-2 rounded border border-amber-400 bg-white text-xs text-slate-900"
                                  />
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Stage -> Approve -> Publish / Reject Bar */}
            <div className="p-6 bg-slate-50 border-t border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="text-xs text-slate-600">
                {!stagedBatch ? (
                  validation.canStage ? (
                    <span>
                      Ready to stage as <strong>{validation.metrics.detectedImportType}</strong>{' '}
                      draft batch (hidden from employees until explicitly approved &amp; published).
                    </span>
                  ) : (
                    <span className="text-red-700 font-medium">
                      Blocked: {validation.blockingReasons[0]}
                    </span>
                  )
                ) : (
                  <span className="font-medium text-slate-900">
                    Active Batch: <span className="font-mono">{stagedBatch.batch.batchId}</span> (
                    {stagedBatch.batch.importType}) · State:{' '}
                    <span className="font-semibold">{stagedBatch.batch.status}</span>
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {!stagedBatch && (
                  <button
                    type="button"
                    disabled={busy || !validation.canStage}
                    onClick={handleStageBatch}
                    className="h-10 px-5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium disabled:opacity-50 cursor-pointer"
                  >
                    Stage Validated Batch ({validation.metrics.publishableRows} Rows)
                  </button>
                )}

                {stagedBatch && stagedBatch.batch.status === 'VALIDATED' && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setShowRejectBox((v) => !v)}
                      className="h-10 px-4 rounded-lg border border-red-300 bg-white hover:bg-red-50 text-red-700 text-sm font-medium cursor-pointer"
                    >
                      Reject Batch
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleApprove}
                      className="h-10 px-5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium cursor-pointer"
                    >
                      Approve Batch
                    </button>
                  </>
                )}

                {stagedBatch &&
                  (stagedBatch.batch.status === 'APPROVED' ||
                    stagedBatch.batch.status === 'FAILED') && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setShowRejectBox((v) => !v)}
                        className="h-10 px-4 rounded-lg border border-red-300 bg-white hover:bg-red-50 text-red-700 text-sm font-medium cursor-pointer"
                      >
                        Reject Batch
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handlePublish}
                        className="h-10 px-5 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-sm font-medium disabled:opacity-60 cursor-pointer"
                      >
                        {stagedBatch.batch.status === 'FAILED'
                          ? 'Retry Publish'
                          : 'Publish Approved Incentives'}
                      </button>
                    </>
                  )}

                {stagedBatch && stagedBatch.batch.status === 'PROCESSING' && (
                  <span className="text-xs font-medium text-blue-700 inline-flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Publishing under transaction lock...
                  </span>
                )}
              </div>
            </div>

            {showRejectBox && stagedBatch && (
              <div className="px-6 pb-6 bg-slate-50 flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  placeholder="Enter rejection reason for audit log..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="flex-1 h-10 px-3 rounded-lg border border-red-300 bg-white text-sm"
                />
                <button
                  type="button"
                  disabled={busy || !rejectReason.trim()}
                  onClick={handleReject}
                  className="h-10 px-4 rounded-lg bg-red-700 hover:bg-red-800 text-white text-sm font-medium disabled:opacity-50 cursor-pointer"
                >
                  Confirm Rejection
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
