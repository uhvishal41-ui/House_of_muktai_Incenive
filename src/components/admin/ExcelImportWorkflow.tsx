import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Link2,
  Lock,
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
  planBranchTransferConsolidation,
  validateImportBatch,
} from '../../lib/incentiveEngine';
import { detectIncentiveImportAnomalies } from '../../lib/proAnalyticsEngine';
import {
  approveEmployeeBranchTransfer,
  approveImportBatch,
  linkVerifiedSaleIdsToEmployees,
  publishApprovedBatch,
  rejectImportBatch,
  stageValidatedBatch,
  syncMastersFromErpRows,
} from '../../services/incentiveService';
import { isMonthPayrollLockedLocal } from '../../services/proFeaturesService';
import type {
  Branch,
  Employee,
  ExcelColumnMapping,
  ExcelParseResponse,
  ImportBatch,
  ImportBatchRow,
  OverlapResolutionMode,
  PayrollLockSettings,
  PublishedIncentive,
  RowResolution,
} from '../../types/incentive';

interface Props {
  branches: Branch[];
  employees: Employee[];
  publishedIncentives: PublishedIncentive[];
  payrollLockSettings?: PayrollLockSettings;
  onRefresh: () => Promise<void>;
}

type FilterMode = 'ALL' | 'VALID' | 'ERROR' | 'DUPLICATE' | 'OVERLAP' | 'TRANSFER';

export function ExcelImportWorkflow({
  branches,
  employees,
  publishedIncentives,
  payrollLockSettings,
  onRefresh,
}: Props) {
  const [parsed, setParsed] = useState<ExcelParseResponse | null>(null);
  const [mapping, setMapping] = useState<ExcelColumnMapping>({
    businessDate: '',
    employeeId: '',
    saleId: '',
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
  // Fallback single upload date ONLY when a legacy Excel has neither a Date column nor a Row 1 date banner
  const [fallbackDate, setFallbackDate] = useState<string>(() => getTodayIST());
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
  const [linkingSaleIds, setLinkingSaleIds] = useState(false);
  const [selectedSaleIdLinks, setSelectedSaleIdLinks] = useState<Record<string, boolean>>({});
  const [approvingTransferId, setApprovingTransferId] = useState<string | null>(null);
  const [approvingAllTransfers, setApprovingAllTransfers] = useState(false);
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
    setSelectedSaleIdLinks((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const link of validation.pendingSaleIdLinks) {
        if (next[link.employeeId] === undefined) {
          next[link.employeeId] = true;
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

  const hasDateColumn = Boolean(mapping.businessDate);

  // Deduplicated branch transfers across multi-date rows + live preview of previous-branch incentive carry-forward
  const uploadedMonthKeys = useMemo(() => {
    if (!validation) return [];
    const set = new Set<string>();
    for (const r of validation.rows) {
      if (r.businessDate && /^\d{4}-\d{2}/.test(r.businessDate)) {
        set.add(r.businessDate.slice(0, 7));
      }
    }
    return Array.from(set).sort();
  }, [validation]);

  const uniqueBranchTransfers = useMemo(() => {
    if (!validation || validation.branchTransfers.length === 0) return [];
    const seen = new Map<
      string,
      {
        employeeId: string;
        employeeName: string;
        masterBranchId: string;
        masterBranchName: string;
        excelBranchId: string;
        excelBranchName: string;
        rowCount: number;
        carryForwardCount: number;
        carryForwardPaise: number;
        carryForwardMonths: string[];
      }
    >();

    for (const tr of validation.branchTransfers) {
      const key = `${tr.employeeId.toUpperCase()}__${tr.excelBranchId}`;
      const existing = seen.get(key);
      if (existing) {
        existing.rowCount += 1;
        continue;
      }
      const emp = employeesById[tr.employeeId.toUpperCase()];
      const preview = emp
        ? planBranchTransferConsolidation({
            employee: emp,
            newBranchId: tr.excelBranchId,
            newBranchName: tr.excelBranchName,
            publishedIncentives,
            targetMonthKeys: uploadedMonthKeys.length > 0 ? uploadedMonthKeys : undefined,
          })
        : null;

      seen.set(key, {
        employeeId: tr.employeeId,
        employeeName: tr.employeeName,
        masterBranchId: tr.masterBranchId,
        masterBranchName: tr.masterBranchName,
        excelBranchId: tr.excelBranchId,
        excelBranchName: tr.excelBranchName,
        rowCount: 1,
        carryForwardCount: preview?.recordsToMigrate.length || 0,
        carryForwardPaise: preview?.migratedIncentivePaise || 0,
        carryForwardMonths: preview?.affectedMonthKeys || [],
      });
    }

    return Array.from(seen.values());
  }, [validation, employeesById, publishedIncentives, uploadedMonthKeys]);

  const handleDownloadSample = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const headers = await getBearerHeader();
      const activeEmployees = employees.filter((e) => e.status === 'ACTIVE').slice(0, 15);
      const today = getTodayIST();

      const resp = await fetch('/api/v1/excel/sample-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          businessDate: today,
          periodStart: today,
          periodEnd: today,
          rows: activeEmployees.map((e) => ({
            employeeId: e.employeeId,
            saleId: e.saleId || '',
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
      a.download = `house-of-muktai-incentive-template-${today}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setFeedback({
        type: 'ok',
        text: `Downloaded Incentive Upload Template (${today}) with built-in Date column. Enter each row's Date (YYYY-MM-DD or DD-MM-YYYY) and upload directly.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to generate template.',
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
    setSelectedSaleIdLinks({});

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
          text: `${parsedResp.totalRows} employee row(s) parsed cleanly.${salesNote} No Date column was found in this Excel sheet — select the Upload Date below (or map your Date column) to continue.`,
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
        const dateSpanLabel =
          parsedResp.periodStart === parsedResp.periodEnd
            ? parsedResp.periodStart
            : `${parsedResp.periodStart} to ${parsedResp.periodEnd}`;

        setFeedback({
          type: parsedResp.excludedSalesColumns.length > 0 ? 'warn' : 'ok',
          text: `Detected template date(s): ${dateSpanLabel} · ${parsedResp.totalRows} employee rows parsed.${skippedNote}${salesNote}`,
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

  const handleLinkVerifiedSaleIds = async () => {
    if (!validation || validation.pendingSaleIdLinks.length === 0) return;
    const linksToApply = validation.pendingSaleIdLinks
      .filter((c) => selectedSaleIdLinks[c.employeeId] !== false)
      .map((c) => ({ employeeId: c.employeeId, saleId: c.proposedSaleId }));

    if (linksToApply.length === 0) {
      setFeedback({
        type: 'warn',
        text: 'Select at least one verified employee row to link its Sales ID to Employee Master.',
      });
      return;
    }

    setLinkingSaleIds(true);
    setFeedback(null);
    try {
      const res = await linkVerifiedSaleIdsToEmployees({
        links: linksToApply,
        employees,
      });
      await onRefresh();
      setFeedback({
        type: 'ok',
        text: `Verified and permanently linked Sales ID to ${res.linkedCount} Employee Master record(s)${
          res.skippedCount > 0 ? ` (${res.skippedCount} skipped due to existing/duplicate ID)` : ''
        }. Future Sale-ID-only uploads will match directly.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to link verified Sales IDs.',
      });
    } finally {
      setLinkingSaleIds(false);
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
      const result = await approveEmployeeBranchTransfer({
        employee: emp,
        newBranchId,
        newBranchName,
        targetMonthKeys: uploadedMonthKeys.length > 0 ? uploadedMonthKeys : undefined,
        consolidatePreviousBranchIncentives: true,
        allEmployees: employees,
        reason: `Approved during Excel import (${parsed?.fileName || 'ERP export'})`,
      });
      await onRefresh();
      const carryMsg =
        result.migratedRecordsCount > 0
          ? ` Previous branch incentive of ${formatINRFromPaise(result.migratedIncentivePaise)} (${result.migratedRecordsCount} record${result.migratedRecordsCount === 1 ? '' : 's'}) carried forward into ${newBranchName}.`
          : '';
      setFeedback({
        type: 'ok',
        text: `Branch transfer approved for ${emp.employeeId} (${emp.fullName}): ${emp.branchName} → ${newBranchName}.${carryMsg}`,
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

  const handleApproveAllTransfers = async () => {
    if (uniqueBranchTransfers.length === 0) return;
    setApprovingAllTransfers(true);
    setFeedback(null);
    try {
      let totalMigratedRecords = 0;
      let totalMigratedPaise = 0;
      let approvedCount = 0;

      for (const tr of uniqueBranchTransfers) {
        const emp = employeesById[tr.employeeId.toUpperCase()];
        if (!emp) continue;
        const result = await approveEmployeeBranchTransfer({
          employee: emp,
          newBranchId: tr.excelBranchId,
          newBranchName: tr.excelBranchName,
          targetMonthKeys: uploadedMonthKeys.length > 0 ? uploadedMonthKeys : undefined,
          consolidatePreviousBranchIncentives: true,
          allEmployees: employees,
          reason: `Bulk approved during Excel import (${parsed?.fileName || 'ERP export'})`,
        });
        approvedCount += 1;
        totalMigratedRecords += result.migratedRecordsCount;
        totalMigratedPaise += result.migratedIncentivePaise;
      }

      await onRefresh();
      setFeedback({
        type: 'ok',
        text: `Approved ${approvedCount} branch transfer(s) and consolidated ${totalMigratedRecords} previous-branch incentive record(s) (${formatINRFromPaise(totalMigratedPaise)}) into each employee's current branch.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to approve branch transfers.',
      });
    } finally {
      setApprovingAllTransfers(false);
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
      // Auto-link checked verified Sales IDs to Employee Master before backend verification & staging
      let employeesForVerify = employees;
      let autoLinkedCount = 0;
      if (validation.pendingSaleIdLinks.length > 0) {
        const checkedLinks = validation.pendingSaleIdLinks
          .filter((c) => selectedSaleIdLinks[c.employeeId] !== false)
          .map((c) => ({ employeeId: c.employeeId, saleId: c.proposedSaleId }));
        if (checkedLinks.length > 0) {
          const linkRes = await linkVerifiedSaleIdsToEmployees({
            links: checkedLinks,
            employees,
          });
          employeesForVerify = linkRes.updatedEmployees;
          autoLinkedCount = linkRes.linkedCount;
        }
      }

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
          employees: employeesForVerify,
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
        text: `Staged ${importType} batch ${staged.batch.batchId} (${periodStart} to ${periodEnd}) as VALIDATED.${
          autoLinkedCount > 0
            ? ` Also linked verified Sales IDs to ${autoLinkedCount} Employee Master record(s).`
            : ''
        } Draft data stays hidden from employees until approved and published.`,
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
    const batchMonthKey = (stagedBatch.batch.periodEnd || stagedBatch.batch.businessDate || '').slice(0, 7);
    if (isMonthPayrollLockedLocal(batchMonthKey, payrollLockSettings)) {
      setFeedback({
        type: 'err',
        text: `Month ${batchMonthKey} is LOCKED by the Main Owner. Unlock it in Pro Insights & Loans before publishing incentives for this month.`,
      });
      return;
    }
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
              Incentive Excel Upload
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Each row uploads strictly by its <strong className="text-slate-700">Date</strong> column in the Excel template (.xlsx)
            </p>
          </div>
          <div className="inline-flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 self-start lg:self-auto">
            <button
              type="button"
              disabled={busy}
              onClick={handleDownloadSample}
              className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5 text-[#B8923A]" />
              Download Template (.xlsx)
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
              ? 'Drop Incentive Excel Workbook (.xlsx) Here'
              : 'Drag & Drop Incentive Sheet (.xlsx)'}
          </h3>
          <p className="text-xs text-slate-500 mt-1.5 max-w-md mx-auto leading-relaxed">
            Fill the <strong className="text-slate-700">Date</strong> column in the Excel template
            (single date or multiple dates in one sheet). Duplicate, overlap &amp; branch-transfer
            consolidation run automatically before staging.
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
          {/* Simple Upload Date Fallback ONLY when uploaded legacy Excel has neither a Date column nor a Row 1 banner */}
          {!hasDateColumn && !hasBannerDates && !stagedBatch && (
            <div
              className={`p-5 rounded-xl border text-sm space-y-3 ${
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
                      ? `Upload Date Confirmed: ${effectivePeriodStart}`
                      : 'No Date Column Found in Excel — Select Upload Date'}
                  </p>
                  <p className="text-xs leading-relaxed">
                    {validation.period.valid
                      ? 'All rows in this sheet will upload under the date below. For multi-date sheets, add a Date column in the template.'
                      : 'This older Excel file does not include a Date column. Pick the upload date below or map your Date column in Step 2.'}
                  </p>
                </div>
              </div>

              <div className="pl-8 flex flex-wrap items-end gap-3 text-xs">
                <div>
                  <label className="block font-medium mb-1">Upload Date</label>
                  <input
                    type="date"
                    value={fallbackDate}
                    onChange={(e) => setFallbackDate(e.target.value)}
                    className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 font-mono"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(fallbackDate)) {
                      setFeedback({ type: 'err', text: 'Please select a valid date.' });
                      return;
                    }
                    setManualPeriodApplied({
                      start: fallbackDate,
                      end: fallbackDate,
                      label: fallbackDate,
                    });
                    setFeedback({
                      type: 'ok',
                      text: `Applied upload date (${fallbackDate}) for all rows in this sheet.`,
                    });
                  }}
                  className="h-9 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white font-medium cursor-pointer"
                >
                  Apply Upload Date
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
                <p className="text-[11px] text-slate-500">Total Sale Quantity</p>
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

          {/* Verify & Link Sales IDs to Employee Master (when Master has EMP ID only and Name matches Incentive Sheet) */}
          {!stagedBatch && validation.pendingSaleIdLinks.length > 0 && (() => {
            const selectedCount = validation.pendingSaleIdLinks.filter(
              (c) => selectedSaleIdLinks[c.employeeId] !== false,
            ).length;
            const basisLabel: Record<string, string> = {
              EXACT_EMP_ID: 'Exact Employee ID',
              EXACT_NAME_AND_BRANCH: 'Name + Branch Match',
              UNIQUE_NAME_TOKENS_AND_BRANCH: 'Name Words + Branch',
              UNIQUE_EXACT_NAME: 'Unique Exact Name',
            };
            return (
              <section className="bg-white border border-emerald-300 rounded-xl p-6 space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Link2 className="w-4 h-4 text-emerald-700 shrink-0" />
                      <h3 className="text-sm font-semibold text-slate-900">
                        Verify &amp; Link Sales IDs to Employee Master ({validation.pendingSaleIdLinks.length}{' '}
                        Employee{validation.pendingSaleIdLinks.length === 1 ? '' : 's'})
                      </h3>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      These employees exist in Employee Master with only an{' '}
                      <strong className="font-mono text-slate-900">Employee ID</strong> (blank Sales ID) and
                      uniquely matched this Incentive Sheet by Name. Checked rows will automatically save
                      their <strong className="font-mono text-slate-900">Sales ID</strong> in Employee
                      Master when you click <strong>Verify &amp; Link</strong> or{' '}
                      <strong>Stage Batch</strong>.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={linkingSaleIds || busy || selectedCount === 0}
                    onClick={handleLinkVerifiedSaleIds}
                    className="h-10 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                  >
                    {linkingSaleIds ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Link2 className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {linkingSaleIds
                        ? 'Linking Sales IDs...'
                        : `Verify & Link ${selectedCount} Sales ID${selectedCount === 1 ? '' : 's'} to Master`}
                    </span>
                  </button>
                </div>

                <div className="overflow-x-auto max-h-64 border border-slate-200 rounded-lg">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <tr>
                        <th className="py-2 px-3 w-10 text-center">Link</th>
                        <th className="py-2 px-3">Master Employee ID</th>
                        <th className="py-2 px-3">Master Employee Name</th>
                        <th className="py-2 px-3">Excel Employee Name</th>
                        <th className="py-2 px-3">Branch</th>
                        <th className="py-2 px-3">Detected Sales ID</th>
                        <th className="py-2 px-3">Verification Match</th>
                        <th className="py-2 px-3 text-right">Matching Rows</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {validation.pendingSaleIdLinks.map((item) => {
                        const isChecked = selectedSaleIdLinks[item.employeeId] !== false;
                        return (
                          <tr key={item.employeeId} className="hover:bg-emerald-50/40">
                            <td className="py-2 px-3 text-center">
                              <input
                                type="checkbox"
                                aria-label={`Link Sale ID ${item.proposedSaleId} to ${item.employeeId}`}
                                checked={isChecked}
                                onChange={(e) =>
                                  setSelectedSaleIdLinks((prev) => ({
                                    ...prev,
                                    [item.employeeId]: e.target.checked,
                                  }))
                                }
                                className="w-4 h-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600 cursor-pointer"
                              />
                            </td>
                            <td className="py-2 px-3 font-mono font-semibold text-slate-900">
                              {item.employeeId}
                            </td>
                            <td className="py-2 px-3 font-medium text-slate-800">
                              {item.masterFullName}
                            </td>
                            <td className="py-2 px-3 text-slate-600">
                              {item.excelEmployeeName || '—'}
                            </td>
                            <td className="py-2 px-3 text-slate-600">{item.branchName}</td>
                            <td className="py-2 px-3">
                              <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono font-semibold">
                                {item.proposedSaleId}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-600">
                              {basisLabel[item.matchBasis] || item.matchBasis}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-700">
                              {item.rowCount}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })()}

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
                          <th className="py-2 px-3">Employee / Sales ID</th>
                          <th className="py-2 px-3">Employee Name (Excel)</th>
                          <th className="py-2 px-3">Branch</th>
                          <th className="py-2 px-3">Category Flag</th>
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

          {/* Explicit Branch Transfer Review Panel + Automatic Previous-Branch Incentive Carry-Forward */}
          {!stagedBatch && uniqueBranchTransfers.length > 0 && (
            <section className="bg-white border border-amber-300 rounded-xl p-6 space-y-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4 text-amber-700 shrink-0" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    Branch Transfer &amp; Incentive Carry-Forward Review ({uniqueBranchTransfers.length}{' '}
                    Employee{uniqueBranchTransfers.length === 1 ? '' : 's'})
                  </h3>
                </div>
                {uniqueBranchTransfers.length > 1 && (
                  <button
                    type="button"
                    disabled={approvingAllTransfers || approvingTransferId !== null}
                    onClick={handleApproveAllTransfers}
                    className="h-8 px-3.5 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold whitespace-nowrap cursor-pointer disabled:opacity-60"
                  >
                    {approvingAllTransfers
                      ? 'Approving & Consolidating...'
                      : `Approve All (${uniqueBranchTransfers.length}) & Carry Forward Incentives`}
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                These employees appeared under a new current branch in your uploaded template.
                Approving a transfer updates their branch AND automatically{' '}
                <strong className="text-slate-900">
                  carries forward their previous branch&apos;s published incentives into their new
                  current branch
                </strong>{' '}
                so branch &amp; monthly totals reflect Previous + New branch earnings seamlessly.
              </p>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {uniqueBranchTransfers.map((tr) => (
                  <div
                    key={`${tr.employeeId}_${tr.excelBranchId}`}
                    className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div>
                        <span className="font-mono font-semibold text-slate-900">
                          {tr.employeeId}
                        </span>{' '}
                        · <span className="font-medium text-slate-800">{tr.employeeName}</span>
                        {tr.rowCount > 1 && (
                          <span className="ml-2 text-[11px] text-slate-500">
                            ({tr.rowCount} rows in file)
                          </span>
                        )}
                      </div>
                      <div className="text-slate-600">
                        Previous Branch:{' '}
                        <strong className="text-slate-800">{tr.masterBranchName}</strong> → Current
                        Branch (Template):{' '}
                        <strong className="text-[#0F1F3D]">{tr.excelBranchName}</strong>
                      </div>
                      {tr.carryForwardCount > 0 ? (
                        <div className="text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200/80 rounded-md px-2.5 py-1 inline-block">
                          Will carry forward{' '}
                          <strong className="font-mono">
                            {formatINRFromPaise(tr.carryForwardPaise)}
                          </strong>{' '}
                          ({tr.carryForwardCount} record{tr.carryForwardCount === 1 ? '' : 's'} in{' '}
                          {tr.carryForwardMonths.join(', ')}) from {tr.masterBranchName} into{' '}
                          {tr.excelBranchName}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500">
                          No prior published incentives in {tr.masterBranchName} for the uploaded
                          month(s) — will update branch to {tr.excelBranchName}.
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={approvingAllTransfers || approvingTransferId === tr.employeeId}
                      onClick={() =>
                        handleApproveTransfer(tr.employeeId, tr.excelBranchId, tr.excelBranchName)
                      }
                      className="h-8 px-3.5 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white font-medium whitespace-nowrap cursor-pointer disabled:opacity-60 shrink-0"
                    >
                      {approvingTransferId === tr.employeeId
                        ? 'Transferring...'
                        : tr.carryForwardCount > 0
                          ? 'Approve & Carry Forward'
                          : 'Approve Transfer'}
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
                2. Column Mapping Verification (Date + Employee ID / Sales ID + Sale Amount + Sale Quantity + Incentive)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Auto-mapped from your Excel headers. You can fill data in <strong>either Employee ID or Sales ID (or both)</strong> in any row — the system automatically links to the employee&apos;s Master record.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {(
                [
                  ['businessDate', 'Date Column'],
                  ['branchCode', 'Branch Name Column'],
                  ['employeeId', 'Employee ID (or Sales ID)'],
                  ['saleId', 'Sales ID Column (Optional)'],
                  ['employeeName', 'Employee Name'],
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
                        Sale Amount (Optional)
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
                        Sale Quantity (Optional)
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
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Employee ID &amp; Name</th>
                    <th className="py-2.5 px-3">Branch</th>
                    <th className="py-2.5 px-3 text-right">New Items Sale</th>
                    <th className="py-2.5 px-3 text-right">Old Items Sale</th>
                    <th className="py-2.5 px-3 text-right">Other Items Sale</th>
                    <th className="py-2.5 px-3 text-right">Total Sale Amount &amp; Quantity</th>
                    <th className="py-2.5 px-3 text-right">Total Incentive</th>
                    <th className="py-2.5 px-3">Validation / Resolution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredPreview.map((row) => (
                    <tr key={row.rowNumber} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3 font-mono text-slate-500">{row.rowNumber}</td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-slate-800 whitespace-nowrap">
                        {row.importType === 'DAILY' ? (
                          <div className="text-xs font-semibold text-[#0F1F3D]">
                            {row.periodStart ? formatShortDate(row.periodStart) : 'Missing'}
                          </div>
                        ) : (
                          <>
                            <div className="text-[11px] font-semibold text-[#0F1F3D]">
                              {row.importType}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {row.periodStart} → {row.periodEnd}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-mono font-medium text-slate-900 flex flex-wrap items-center gap-1.5">
                          <span>{row.employeeId || '—'}</span>
                          {row.matchedSaleId && (
                            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                              Sale ID: {row.matchedSaleId}
                            </span>
                          )}
                          {row.matchedViaSaleIdLink && (
                            <span className="text-[10px] font-sans font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                              Auto-Link
                            </span>
                          )}
                          {row.isSmplCandidate && (
                            <span className="text-[10px] font-sans font-semibold text-amber-800">
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

            {/* Pre-Publish Smart Audit & Anomaly Guard (Feature #2) */}
            {!stagedBatch &&
              (() => {
                const anomalies = detectIncentiveImportAnomalies({
                  validatedRows: validation.rows,
                  publishedIncentives,
                });
                if (anomalies.length === 0) return null;
                return (
                  <div className="mx-6 my-4 p-4 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-950 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-bold flex items-center gap-1.5 text-amber-900">
                        <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                        Pre-Publish Smart Audit Guard: {anomalies.length} variance / anomaly flag(s)
                        detected
                      </p>
                      <span className="text-[11px] font-medium text-amber-800">
                        Informational check — verify before staging &amp; publishing
                      </span>
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                      {anomalies.slice(0, 15).map((a) => (
                        <div
                          key={a.id}
                          className="flex items-start justify-between gap-2 bg-white/85 border border-amber-200 rounded-lg px-2.5 py-1.5"
                        >
                          <div className="min-w-0">
                            <span
                              className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded mr-1.5 ${
                                a.severity === 'HIGH'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-amber-100 text-amber-900'
                              }`}
                            >
                              {a.severity}
                            </span>
                            <strong className="text-[#0F1F3D]">
                              {a.employeeName} ({a.employeeId})
                            </strong>{' '}
                            — <span className="font-semibold">{a.title}</span>
                            <p className="text-[11px] text-slate-600 mt-0.5">{a.detail}</p>
                          </div>
                          <span className="text-[10px] text-slate-500 shrink-0">
                            {a.branchName}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

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
                      {(() => {
                        const batchMonthKey = (
                          stagedBatch.batch.periodEnd ||
                          stagedBatch.batch.businessDate ||
                          ''
                        ).slice(0, 7);
                        const batchLocked = isMonthPayrollLockedLocal(
                          batchMonthKey,
                          payrollLockSettings,
                        );
                        return (
                          <button
                            type="button"
                            disabled={busy || batchLocked}
                            onClick={handlePublish}
                            className="h-10 px-5 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
                          >
                            {batchLocked && <Lock className="w-4 h-4 text-[#DFC27D]" />}
                            <span>
                              {batchLocked
                                ? `Month ${batchMonthKey} Locked`
                                : stagedBatch.batch.status === 'FAILED'
                                  ? 'Retry Publish'
                                  : 'Publish Approved Incentives'}
                            </span>
                          </button>
                        );
                      })()}
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
