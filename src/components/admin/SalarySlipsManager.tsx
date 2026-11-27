import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
  Landmark,
  Lock,
  MessageCircle,
  ReceiptIndianRupee,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getShareableStaffAppUrl } from '../../lib/companyBrand';
import { OFFICIAL_DEPARTMENTS } from '../../lib/departmentLeaderboardEngine';
import {
  formatINRFromPaise,
  formatMonthLabel,
  getCurrentMonthKeyIST,
  getPreviousMonthKey,
} from '../../lib/format';
import { downloadEmployeeSalarySlipPdf } from '../../lib/pdfGenerator';
import {
  applyIncentiveAndLoanSyncToSalaryRows,
  buildWhatsAppDeepLink,
  buildWhatsAppSlipMessage,
  computeActiveLoanEmiByEmployee,
  computeMonthlyNetIncentiveByEmployee,
  detectSalarySlipAnomalies,
} from '../../lib/proAnalyticsEngine';
import {
  applyEmployeeIdOverrideToRawRows,
  buildSalarySlipCsvTemplate,
  detectSalaryHeaderRowIndex,
  extractRawSalaryRowsFromCsv,
  findSuggestedMasterEmployeesForSalaryRow,
  normalizeDateCellToIso,
  parseSalarySheetRows,
  type ParsedSalaryRow,
  type RawSalaryInputRow,
  type SalarySheetParseSummary,
} from '../../lib/salarySlipEngine';
import {
  downloadBulkSalarySlipsZip,
  isMonthPayrollLockedLocal,
} from '../../services/proFeaturesService';
import {
  downloadBankNeftExportXlsx,
  downloadDcrCashExportXlsx,
  downloadStatutoryComplianceXlsx,
} from '../../services/branchReportsExportService';
import { resolveCanonicalBranchName } from '../../lib/incentiveEngine';
import { saveEmployee } from '../../services/incentiveService';
import {
  deleteSalarySlip,
  deleteSalarySlipsBatch,
  moveSalarySlipsToMonthBatch,
  publishSalarySlipsBatch,
} from '../../services/salarySlipService';
import { DEFAULT_PORTAL_VISIBILITY } from '../../services/departmentVisibilityService';
import {
  MissingSalaryEmployeeModal,
  type MissingEmployeeActionMode,
} from './MissingSalaryEmployeeModal';
import { MonthVisibilityControlCard } from './MonthVisibilityControlCard';
import { OwnerSalarySlipEditModal } from './OwnerSalarySlipEditModal';
import type {
  Branch,
  DepartmentId,
  Employee,
  EmployeeLoan,
  IncentiveAdjustment,
  PayrollLockSettings,
  PortalVisibilitySettings,
  PublishedIncentive,
  SalarySlip,
} from '../../types/incentive';

import type { VoiceFilterCommand } from '../../services/voiceToolExecutor';

interface Props {
  branches: Branch[];
  employees: Employee[];
  incentives: PublishedIncentive[];
  adjustments?: IncentiveAdjustment[];
  employeeLoans?: EmployeeLoan[];
  salarySlips: SalarySlip[];
  visibilitySettings?: PortalVisibilitySettings;
  payrollLockSettings?: PayrollLockSettings;
  voiceFilter?: VoiceFilterCommand | null;
  onRefresh: () => Promise<void>;
}

export function SalarySlipsManager({
  branches,
  employees,
  incentives,
  adjustments = [],
  employeeLoans = [],
  salarySlips,
  visibilitySettings,
  payrollLockSettings,
  voiceFilter,
  onRefresh,
}: Props) {
  const { isMainOwner } = useAuth();
  const [editingSlip, setEditingSlip] = useState<SalarySlip | null>(null);
  const [uploadMonth, setUploadMonth] = useState<string>(getCurrentMonthKeyIST());
  const [syncMasterData, setSyncMasterData] = useState<boolean>(true);
  const [fileName, setFileName] = useState<string>('');
  const [uploadedRawRows, setUploadedRawRows] = useState<RawSalaryInputRow[]>([]);
  const [sessionEmployeesMap, setSessionEmployeesMap] = useState<Record<string, Employee>>({});
  const [parseSummary, setParseSummary] = useState<SalarySheetParseSummary | null>(null);
  const [activeMissingAction, setActiveMissingAction] = useState<{
    row: ParsedSalaryRow;
    mode: MissingEmployeeActionMode;
  } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [bulkAddingMissing, setBulkAddingMissing] = useState(false);
  const [exportingType, setExportingType] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const uploadMonthLocked = isMonthPayrollLockedLocal(uploadMonth, payrollLockSettings);

  const effectiveEmployees = useMemo(() => {
    const byId = new Map<string, Employee>();
    for (const emp of employees) {
      byId.set(emp.employeeId.trim().toUpperCase(), emp);
    }
    for (const emp of Object.values(sessionEmployeesMap)) {
      byId.set(emp.employeeId.trim().toUpperCase(), emp);
    }
    return Array.from(byId.values());
  }, [employees, sessionEmployeesMap]);

  const missingEmployeeRows = useMemo(
    () =>
      parseSummary
        ? parseSummary.errorRows.filter(
            (r) => r.errorCode === 'EMPLOYEE_NOT_FOUND' || !r.matchedEmployee,
          )
        : [],
    [parseSummary],
  );

  const otherSkippedRows = useMemo(
    () =>
      parseSummary
        ? [
            ...parseSummary.errorRows.filter(
              (r) => r.errorCode !== 'EMPLOYEE_NOT_FOUND' && Boolean(r.matchedEmployee),
            ),
            ...parseSummary.duplicateRows,
          ]
        : [],
    [parseSummary],
  );

  // Register filters
  const availableMonths = useMemo(() => {
    const set = new Set<string>(salarySlips.map((s) => s.monthKey));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [salarySlips]);

  const allVisibilityMonths = useMemo(() => {
    const set = new Set<string>(availableMonths);
    for (const inc of incentives) {
      if (inc.status === 'PUBLISHED' && inc.monthKey) set.add(inc.monthKey);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [availableMonths, incentives]);

  const [filterMonth, setFilterMonth] = useState<string>('ALL');
  const [filterBranch, setFilterBranch] = useState<string>('ALL');
  const [filterDept, setFilterDept] = useState<'ALL' | 'UNASSIGNED' | 'NON_SALES' | DepartmentId>('ALL');
  const [search, setSearch] = useState<string>('');

  useEffect(() => {
    if (!voiceFilter || voiceFilter.targetTab !== 'salary') return;
    if (voiceFilter.clearFilters) {
      setFilterMonth('ALL');
      setFilterBranch('ALL');
      setFilterDept('ALL');
      setSearch('');
      return;
    }
    if (voiceFilter.monthKey !== undefined) setFilterMonth(voiceFilter.monthKey);
    if (voiceFilter.branchId !== undefined) setFilterBranch(voiceFilter.branchId);
    if (voiceFilter.department !== undefined) setFilterDept(voiceFilter.department);
    if (voiceFilter.searchQuery !== undefined) setSearch(voiceFilter.searchQuery);
  }, [voiceFilter]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showMoveMonthBar, setShowMoveMonthBar] = useState(false);
  const [moveTargetMonth, setMoveTargetMonth] = useState<string>(() =>
    getPreviousMonthKey(getCurrentMonthKeyIST()),
  );
  const [movingMonthBusy, setMovingMonthBusy] = useState(false);
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false);
  const [bulkDeletingBusy, setBulkDeletingBusy] = useState(false);

  const filteredSlips = useMemo(() => {
    const q = search.trim().toLowerCase();
    return salarySlips.filter((s) => {
      if (filterMonth !== 'ALL' && s.monthKey !== filterMonth) return false;
      if (filterBranch !== 'ALL' && s.branchId !== filterBranch) return false;
      if (filterDept === 'UNASSIGNED' && (s.departmentId || s.departmentName)) return false;
      if (filterDept === 'NON_SALES' && (Boolean(s.departmentId) || !s.departmentName)) return false;
      if (
        filterDept !== 'ALL' &&
        filterDept !== 'UNASSIGNED' &&
        filterDept !== 'NON_SALES' &&
        s.departmentId !== filterDept
      ) {
        return false;
      }
      if (q) {
        return (
          s.employeeName.toLowerCase().includes(q) ||
          s.employeeId.toLowerCase().includes(q) ||
          s.branchName.toLowerCase().includes(q) ||
          (s.departmentName || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [salarySlips, filterMonth, filterBranch, filterDept, search]);

  const registerTotals = useMemo(() => {
    return filteredSlips.reduce(
      (acc, s) => {
        acc.gross += s.grossEarningsPaise;
        acc.ded += s.totalDeductionsPaise;
        acc.net += s.netPayablePaise;
        return acc;
      },
      { gross: 0, ded: 0, net: 0 },
    );
  }, [filteredSlips]);

  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  const [whatsAppModalOpen, setWhatsAppModalOpen] = useState(false);
  const [copiedWhatsAppId, setCopiedWhatsAppId] = useState<string | null>(null);

  const employeePhoneMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const emp of effectiveEmployees) {
      if (emp.phone) map[emp.employeeId.trim().toUpperCase()] = emp.phone;
    }
    return map;
  }, [effectiveEmployees]);

  const uploadIncentiveMap = useMemo(
    () => computeMonthlyNetIncentiveByEmployee(incentives, adjustments, uploadMonth),
    [incentives, adjustments, uploadMonth],
  );

  const uploadLoanEmiMap = useMemo(
    () => computeActiveLoanEmiByEmployee(employeeLoans, uploadMonth),
    [employeeLoans, uploadMonth],
  );

  const salaryAnomalies = useMemo(
    () =>
      parseSummary
        ? detectSalarySlipAnomalies({
            validRows: parseSummary.validRows,
            existingSlips: salarySlips,
          })
        : [],
    [parseSummary, salarySlips],
  );

  const handleUploadMonthChange = (nextMonth: string) => {
    setUploadMonth(nextMonth);
    if (uploadedRawRows.length > 0 && /^\d{4}-\d{2}$/.test(nextMonth)) {
      setParseSummary(parseSalarySheetRows(uploadedRawRows, effectiveEmployees, nextMonth));
    }
  };

  const handleDownloadTemplate = () => {
    const incentivePaiseByEmp: Record<string, number> = {};
    for (const [k, v] of Object.entries(uploadIncentiveMap)) {
      incentivePaiseByEmp[k] = v.netPayablePaise;
    }
    const advanceRecoveryPaiseByEmp: Record<string, number> = {};
    for (const [k, v] of Object.entries(uploadLoanEmiMap)) {
      advanceRecoveryPaiseByEmp[k] = v.totalDueEmiPaise;
    }
    const csv = buildSalarySlipCsvTemplate(effectiveEmployees, uploadMonth, {
      incentivePaiseByEmp,
      advanceRecoveryPaiseByEmp,
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `house-of-muktai-salary-template-${uploadMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOneClickSync = (mode: 'INCENTIVES' | 'LOANS') => {
    if (!parseSummary) return;
    const synced = applyIncentiveAndLoanSyncToSalaryRows(
      parseSummary.rows,
      uploadIncentiveMap,
      uploadLoanEmiMap,
      {
        syncIncentives: mode === 'INCENTIVES',
        syncLoans: mode === 'LOANS',
      },
    );
    const validRows = synced.rows.filter((r) => r.status === 'VALID');
    setParseSummary({
      ...parseSummary,
      rows: synced.rows,
      validRows,
      totalGrossPaise: synced.totalGrossPaise,
      totalDeductionsPaise: synced.totalDeductionsPaise,
      totalNetPaise: synced.totalNetPaise,
    });
    if (mode === 'INCENTIVES') {
      const skippedNote =
        synced.skippedAlreadyHasSalesCommissionCount > 0
          ? ` Auto-protected ${synced.skippedAlreadyHasSalesCommissionCount} employee(s) who already have Sales Commission in this sheet (prevented double-counting).`
          : '';
      setFeedback({
        type: 'ok',
        text:
          synced.syncedIncentiveCount > 0
            ? `1-Click Synced published net incentives for ${synced.syncedIncentiveCount} employee(s) (${formatMonthLabel(uploadMonth)}) and recalculated Net Payroll.${skippedNote}`
            : synced.skippedAlreadyHasSalesCommissionCount > 0
              ? `Double-Incentive Protection: Skipped all ${synced.skippedAlreadyHasSalesCommissionCount} employee(s) because their Sales Commission is already included in this paysheet.`
              : `No published incentives found for ${formatMonthLabel(uploadMonth)} matching these rows.`,
      });
    } else {
      setFeedback({
        type: 'ok',
        text:
          synced.syncedLoanCount > 0
            ? `1-Click Synced active Loan/Advance EMIs into Advance Recovery for ${synced.syncedLoanCount} employee(s) and recalculated Net Payroll.`
            : `No pending active loan EMIs due for ${formatMonthLabel(uploadMonth)} matching these rows.`,
      });
    }
  };

  const handleDownloadBranchZip = async () => {
    if (filteredSlips.length === 0) return;
    setZipProgress({ done: 0, total: filteredSlips.length });
    setFeedback(null);
    try {
      const label = filterMonth === 'ALL' ? 'All_Months' : filterMonth;
      const count = await downloadBulkSalarySlipsZip({
        slips: filteredSlips,
        monthLabel: label,
        onProgress: (done, total) => setZipProgress({ done, total }),
      });
      setFeedback({
        type: 'ok',
        text: `Downloaded branch-organized ZIP archive containing ${count} official PDF salary slip(s).`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to generate ZIP archive.',
      });
    } finally {
      setZipProgress(null);
    }
  };

  const handleCopyWhatsAppMsg = async (slipId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedWhatsAppId(slipId);
      window.setTimeout(() => setCopiedWhatsAppId(null), 2000);
    } catch {
      setCopiedWhatsAppId(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setUploadedRawRows([]);
    setParseSummary(null);
    setActiveMissingAction(null);
    setFeedback(null);

    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
        const text = await file.text();
        const rawRows = extractRawSalaryRowsFromCsv(text);
        setUploadedRawRows(rawRows);
        setParseSummary(parseSalarySheetRows(rawRows, effectiveEmployees, uploadMonth));
      } else if (lower.endsWith('.xls')) {
        throw new Error(
          'Legacy Excel 97–2003 (.xls) files are not supported. Please open the sheet in Excel and Save As .xlsx or .csv, then upload again.',
        );
      } else if (lower.endsWith('.xlsx')) {
        const ExcelJS = await import('exceljs');
        const wb = new ExcelJS.Workbook();
        const buf = await file.arrayBuffer();
        await wb.xlsx.load(buf);
        const ws = wb.worksheets[0];
        if (!ws) throw new Error('The Excel file does not contain any worksheet.');

        const extractExcelCell = (cell: { value: unknown; text?: string }): unknown => {
          const rawVal = cell.value;
          if (rawVal === null || rawVal === undefined) return '';
          if (rawVal instanceof Date) return normalizeDateCellToIso(rawVal);
          if (typeof rawVal === 'number') return rawVal;
          if (typeof rawVal === 'string') return rawVal.trim();
          if (typeof rawVal === 'object') {
            if ('result' in rawVal && (rawVal as { result?: unknown }).result !== undefined) {
              const res = (rawVal as { result?: unknown }).result;
              return res instanceof Date ? normalizeDateCellToIso(res) : (res ?? '');
            }
            if ('richText' in rawVal && Array.isArray((rawVal as { richText?: Array<{ text: string }> }).richText)) {
              return (rawVal as { richText: Array<{ text: string }> }).richText
                .map((part) => part.text)
                .join('')
                .trim();
            }
            if ('text' in rawVal && typeof (rawVal as { text?: string }).text === 'string') {
              return (rawVal as { text: string }).text.trim();
            }
          }
          return cell.text ?? '';
        };

        // Scan top rows to auto-detect real header row (handles Row 1–3 company title banners)
        const previewMatrix: unknown[][] = [];
        const maxScan = Math.min(10, ws.rowCount);
        for (let r = 1; r <= maxScan; r += 1) {
          const row = ws.getRow(r);
          const rowArr: unknown[] = [];
          row.eachCell({ includeEmpty: true }, (cell, colNum) => {
            rowArr[colNum - 1] = extractExcelCell(cell);
          });
          previewMatrix.push(rowArr);
        }
        const headerRowNumber = detectSalaryHeaderRowIndex(previewMatrix) + 1;

        const headers: string[] = [];
        const headerRow = ws.getRow(headerRowNumber);
        headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
          headers[colNum] = String(extractExcelCell(cell) ?? '').trim();
        });

        const rawRows: RawSalaryInputRow[] = [];
        ws.eachRow((row, rowNumber) => {
          if (rowNumber <= headerRowNumber) return;
          const cells: Record<string, unknown> = {};
          let hasAny = false;
          row.eachCell({ includeEmpty: true }, (cell, colNum) => {
            const key = headers[colNum] || `col_${colNum}`;
            const val = extractExcelCell(cell);
            if (String(val ?? '').trim() !== '') hasAny = true;
            cells[key] = val ?? '';
          });
          if (hasAny) {
            rawRows.push({ rowNumber, cells });
          }
        });

        setUploadedRawRows(rawRows);
        setParseSummary(parseSalarySheetRows(rawRows, effectiveEmployees, uploadMonth));
      } else {
        throw new Error('Please upload a .xlsx or .csv salary register file.');
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to parse the selected salary file.',
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleMissingEmployeeResolved = ({
    rowNumber,
    targetEmployeeId,
    savedEmployee,
    message,
  }: {
    mode: MissingEmployeeActionMode;
    rowNumber: number;
    targetEmployeeId: string;
    savedEmployee?: Employee;
    message: string;
  }) => {
    let nextEmployees = effectiveEmployees;
    if (savedEmployee) {
      const key = savedEmployee.employeeId.trim().toUpperCase();
      setSessionEmployeesMap((prev) => ({ ...prev, [key]: savedEmployee }));
      const byId = new Map<string, Employee>();
      for (const emp of effectiveEmployees) {
        byId.set(emp.employeeId.trim().toUpperCase(), emp);
      }
      byId.set(key, savedEmployee);
      nextEmployees = Array.from(byId.values());
    }

    const nextRawRows = applyEmployeeIdOverrideToRawRows(
      uploadedRawRows,
      rowNumber,
      targetEmployeeId,
    );
    setUploadedRawRows(nextRawRows);
    setParseSummary(parseSalarySheetRows(nextRawRows, nextEmployees, uploadMonth));
    setActiveMissingAction(null);
    setFeedback({ type: 'ok', text: message });
    if (savedEmployee) {
      void onRefresh();
    }
  };

  const handleBulkAddAllMissing = async () => {
    if (missingEmployeeRows.length === 0) return;
    setBulkAddingMissing(true);
    setFeedback(null);
    try {
      const existingById = new Map<string, Employee>();
      for (const emp of effectiveEmployees) {
        existingById.set(emp.employeeId.trim().toUpperCase(), emp);
      }
      const nextSessionMap: Record<string, Employee> = { ...sessionEmployeesMap };
      let addedCount = 0;
      let skippedCount = 0;

      const defaultBranch = branches[0];
      if (!defaultBranch) {
        throw new Error('No branch found in Branch Master. Add branches first.');
      }

      const resolveBranchForRow = (rawBranch?: string): Branch => {
        const raw = (rawBranch || '').trim();
        if (!raw) return defaultBranch;
        const canonical = resolveCanonicalBranchName(raw).toLowerCase();
        const found = branches.find(
          (b) =>
            b.branchName.toLowerCase() === canonical ||
            b.branchCode.toLowerCase() === raw.toLowerCase() ||
            b.branchName.toLowerCase().includes(raw.toLowerCase()) ||
            raw.toLowerCase().includes(b.branchName.toLowerCase()),
        );
        return found || defaultBranch;
      };

      const seenInBatch = new Set<string>();
      for (const row of missingEmployeeRows) {
        const cleanId = (row.employeeId || '').trim();
        const cleanName = row.employeeName && row.employeeName !== '—' ? row.employeeName.trim() : '';
        if (!cleanId || !cleanName) {
          skippedCount += 1;
          continue;
        }
        const key = cleanId.toUpperCase();
        if (existingById.has(key) || seenInBatch.has(key)) continue;
        seenInBatch.add(key);

        const branch = resolveBranchForRow(row.rawBranch);
        const cleanLoginSuffix = cleanId.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
        const loginId = cleanLoginSuffix.startsWith('HOM')
          ? cleanLoginSuffix.slice(0, 40)
          : `HOM${cleanLoginSuffix}`.slice(0, 40);

        try {
          const { employee } = await saveEmployee({
            employeeId: cleanId,
            saleId: (row.saleId || '').trim(),
            loginId,
            fullName: cleanName,
            branchId: branch.branchId,
            branchName: branch.branchName,
            departmentId: row.resolvedDepartment?.id || '',
            departmentName: row.resolvedDepartment ? undefined : row.customDepartmentName || undefined,
            designation:
              row.designation && row.designation !== 'Employee'
                ? row.designation.trim()
                : 'Sales Executive',
            gender: (row.gender || '').trim(),
            category: (row.category || '').trim(),
            dateOfJoining: (row.dateOfJoining || '').trim(),
            panNumber: (row.panNumber || '').trim(),
            uanNumber: (row.uanNumber || '').trim(),
            pfNumber: (row.pfNumber || '').trim(),
            esicNumber: (row.esicNumber || '').trim(),
            bankName: (row.bankName || '').trim(),
            bankAccountMasked: (row.bankAccountMasked || '').trim(),
            bankIfsc: (row.bankIfsc || '').trim(),
            status: 'ACTIVE',
            mustChangePassword: true,
            existing: null,
          });
          existingById.set(key, employee);
          nextSessionMap[key] = employee;
          addedCount += 1;
        } catch {
          skippedCount += 1;
        }
      }

      const mergedEmployees = Array.from(existingById.values());
      setSessionEmployeesMap(nextSessionMap);
      setParseSummary(parseSalarySheetRows(uploadedRawRows, mergedEmployees, uploadMonth));
      setFeedback({
        type: addedCount > 0 ? 'ok' : 'err',
        text:
          addedCount > 0
            ? `Bulk-added ${addedCount} missing employee(s) to Employee Master and re-validated this salary sheet.${
                skippedCount > 0 ? ` (${skippedCount} row(s) skipped due to missing ID/Name.)` : ''
              }`
            : 'No missing employees could be bulk-added. Ensure each row has a valid Employee ID and Name.',
      });
      if (addedCount > 0) {
        void onRefresh();
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Bulk add missing employees failed.',
      });
    } finally {
      setBulkAddingMissing(false);
    }
  };

  const handleQuickPayrollExport = async (kind: 'NEFT' | 'DCR' | 'STATUTORY') => {
    const exportMonth =
      filterMonth !== 'ALL' ? filterMonth : availableMonths[0] || uploadMonth;
    setExportingType(kind);
    setFeedback(null);
    try {
      const payload = {
        branches,
        employees: effectiveEmployees,
        salarySlips,
        monthlySummaries: [],
        payoutRecords: [],
        adjustments,
        selectedMonth: exportMonth,
        selectedBranchId: filterBranch,
      };
      if (kind === 'NEFT') {
        await downloadBankNeftExportXlsx(payload);
      } else if (kind === 'DCR') {
        await downloadDcrCashExportXlsx(payload);
      } else {
        await downloadStatutoryComplianceXlsx(payload);
      }
      setFeedback({
        type: 'ok',
        text: `Downloaded ${
          kind === 'NEFT'
            ? 'Bank NEFT Transfer Sheet'
            : kind === 'DCR'
              ? 'DCR / Cash Voucher Sheet'
              : 'Statutory PF / ESIC / PT / LWF Challan'
        } (${formatMonthLabel(exportMonth)}).`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to export report.',
      });
    } finally {
      setExportingType(null);
    }
  };

  const handlePublish = async () => {
    if (!parseSummary || parseSummary.validRows.length === 0) return;
    if (uploadMonthLocked) {
      setFeedback({
        type: 'err',
        text: `${formatMonthLabel(uploadMonth)} payroll is LOCKED by the Main Owner. Unlock it in Pro Insights & Loans before modifying salary slips.`,
      });
      return;
    }
    setPublishing(true);
    setFeedback(null);
    try {
      const res = await publishSalarySlipsBatch({
        validRows: parseSummary.validRows,
        allEmployees: effectiveEmployees,
        existingSlips: salarySlips,
        incentives,
        visibilitySettings,
        syncMasterData,
      });

      const syncParts: string[] = [];
      if (res.departmentsSynced > 0) {
        syncParts.push(`${res.departmentsSynced} department(s) auto-synced`);
      }
      if (res.masterProfilesSynced > 0) {
        syncParts.push(`${res.masterProfilesSynced} HR profile(s) updated`);
      }
      if (res.leaderboardsRefreshedMonths > 0) {
        syncParts.push(`Top-3 leaderboards refreshed for ${res.leaderboardsRefreshedMonths} month(s)`);
      }

      setUploadedRawRows([]);
      setParseSummary(null);
      setActiveMissingAction(null);
      setFileName('');
      const warningSuffix =
        res.syncWarnings.length > 0
          ? ` Note: ${res.syncWarnings.slice(0, 2).join(' ')}`
          : '';
      setFeedback({
        type: 'ok',
        text: `Published ${res.slipsPublished} monthly salary slip(s) cleanly.${syncParts.length ? ` ${syncParts.join(' · ')}.` : ''}${warningSuffix}`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to publish salary slips.',
      });
    } finally {
      setPublishing(false);
    }
  };

  const handleDeleteSlip = async (slip: SalarySlip) => {
    setDeletingId(slip.slipId);
    setFeedback(null);
    try {
      await deleteSalarySlip(slip);
      setConfirmDeleteId(null);
      setFeedback({
        type: 'ok',
        text: `Deleted salary slip for ${slip.employeeName} (${formatMonthLabel(slip.monthKey)}).`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to delete salary slip.',
      });
    } finally {
      setDeletingId(null);
    }
  };

  const filteredSlipsHaveLockedMonth = useMemo(
    () =>
      filteredSlips.some((s) => isMonthPayrollLockedLocal(s.monthKey, payrollLockSettings)),
    [filteredSlips, payrollLockSettings],
  );

  const handleBulkDeleteFilteredSlips = async () => {
    if (filteredSlips.length === 0) return;
    if (filteredSlipsHaveLockedMonth) {
      setFeedback({
        type: 'err',
        text: 'One or more filtered salary slips belong to a Locked Month. Unlock the month in Pro Insights & Loans first.',
      });
      return;
    }
    setBulkDeletingBusy(true);
    setFeedback(null);
    try {
      const monthDesc =
        filterMonth === 'ALL' ? 'all filtered months' : formatMonthLabel(filterMonth);
      const count = await deleteSalarySlipsBatch({
        slips: filteredSlips,
        scopeLabel: `${monthDesc} (${filterBranch === 'ALL' ? 'All Branches' : filterBranch})`,
      });
      setConfirmBulkDeleteOpen(false);
      setFeedback({
        type: 'ok',
        text: `Deleted ${count} salary slip(s) for ${monthDesc}.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to bulk delete salary slips.',
      });
    } finally {
      setBulkDeletingBusy(false);
    }
  };

  const handleMoveFilteredSlipsMonth = async () => {
    if (filteredSlips.length === 0) return;
    if (!/^\d{4}-\d{2}$/.test(moveTargetMonth)) {
      setFeedback({ type: 'err', text: 'Select a valid target month (YYYY-MM).' });
      return;
    }
    if (
      filteredSlipsHaveLockedMonth ||
      isMonthPayrollLockedLocal(moveTargetMonth, payrollLockSettings)
    ) {
      setFeedback({
        type: 'err',
        text: 'Either the current month or target month is Locked by the Main Owner. Unlock it in Pro Insights & Loans first.',
      });
      return;
    }
    setMovingMonthBusy(true);
    setFeedback(null);
    try {
      const res = await moveSalarySlipsToMonthBatch({
        slips: filteredSlips,
        targetMonthKey: moveTargetMonth,
        existingSlips: salarySlips,
        visibilitySettings,
      });
      setShowMoveMonthBar(false);
      setFilterMonth(moveTargetMonth);
      setFeedback({
        type: 'ok',
        text: `Moved ${res.movedCount} salary slip(s) to ${formatMonthLabel(moveTargetMonth)} (PDF Payslip month updated and ${res.deletedOldCount} old wrong-month slip(s) removed).`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to move salary slips to new month.',
      });
    } finally {
      setMovingMonthBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#0F1F3D] tracking-tight">
          Monthly Salary Slips &amp; Payroll Sync
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Upload monthly paysheets (.xlsx / .csv), publish employee PDF slips, and sync HR master records.
        </p>
      </div>

      {feedback && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs font-medium flex items-center gap-2.5 ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {feedback.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      <MonthVisibilityControlCard
        visibilitySettings={visibilitySettings || DEFAULT_PORTAL_VISIBILITY}
        incentives={incentives}
        salarySlips={salarySlips}
        availableMonths={allVisibilityMonths}
        defaultFocus="salary"
        onSaved={async () => {
          await onRefresh();
        }}
      />

      {/* Section 1: Monthly Payroll Upload & Auto-Master Sync */}
      <section className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-2xs">
        <div className="px-5 py-4 bg-[#0F1F3D] text-white relative">
          <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-[#B8923A] via-[#DFC27D] to-[#B8923A]" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-white/10 border border-[#DFC27D]/35 flex items-center justify-center">
                <FileSpreadsheet className="w-4 h-4 text-[#DFC27D]" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">
                  Upload Monthly Salary Sheet (.xlsx / .csv)
                </h2>
                <p className="text-[11px] text-slate-300">
                  Auto-matches Employee ID &amp; Sales ID across all branches · Strictly private per employee
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="h-9 px-3.5 rounded-lg bg-[#B8923A] hover:bg-[#a68230] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Template ({formatMonthLabel(uploadMonth)})</span>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-3">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Default Pay Month
              </label>
              <input
                type="month"
                value={uploadMonth}
                onChange={(e) => handleUploadMonthChange(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20"
              />
            </div>

            <div className="md:col-span-5">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Select Salary Register (.xlsx or .csv)
              </label>
              <label className="h-10 px-4 rounded-lg border border-dashed border-[#0F1F3D]/35 bg-[#0F1F3D]/[0.03] hover:bg-[#0F1F3D]/[0.06] text-xs font-semibold text-[#0F1F3D] flex items-center justify-between gap-2 cursor-pointer transition-colors">
                <span className="inline-flex items-center gap-2 truncate">
                  <Upload className="w-3.5 h-3.5 text-[#B8923A] shrink-0" />
                  <span className="truncate">
                    {fileName || 'Choose Excel (.xlsx) or CSV Salary Sheet...'}
                  </span>
                </span>
                <input
                  type="file"
                  accept=".xlsx,.csv,.txt"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>

            <div className="md:col-span-4">
              <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={syncMasterData}
                  onChange={(e) => setSyncMasterData(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-[#0F1F3D] focus:ring-[#0F1F3D]"
                />
                <span className="text-[11px] leading-snug text-slate-700">
                  <strong className="text-[#0F1F3D]">Auto-Sync Employee Master:</strong> Update
                  Department, Designation, DOJ &amp; Bank/Statutory details automatically.
                </span>
              </label>
            </div>
          </div>

          <p className="text-[11px] text-slate-500">
            Supports all standard &amp; House of Muktai paysheet columns (Earnings, Sales Commission,
            PF/ESIC/PT/LWF, Bank/IFSC/UAN/PAN, NEFT/DCR). Bank accounts auto-mask as{' '}
            <span className="font-mono text-slate-700">XXXX1234</span>.
          </p>

          {/* Validation Preview */}
          {parseSummary && (
            <div className="pt-4 border-t border-slate-200 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-semibold text-emerald-700">
                    Valid Slips: {parseSummary.validRows.length}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span
                    className={`font-semibold ${
                      parseSummary.errorRows.length + parseSummary.duplicateRows.length > 0
                        ? 'text-amber-700'
                        : 'text-slate-500'
                    }`}
                  >
                    Issues / Duplicates:{' '}
                    {parseSummary.errorRows.length + parseSummary.duplicateRows.length}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="font-semibold text-[#0F1F3D]">
                    Dept Auto-Sync: {parseSummary.departmentSyncCount}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="font-mono font-bold text-[#0F1F3D] tabular-nums">
                    Net Payroll: {formatINRFromPaise(parseSummary.totalNetPaise)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={publishing || parseSummary.validRows.length === 0}
                    onClick={() => handleOneClickSync('INCENTIVES')}
                    className="h-9 px-3 rounded-lg border border-[#B8923A]/50 bg-[#FDF8EC] hover:bg-[#FAF0D7] text-xs font-semibold text-[#0F1F3D] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    title="Auto-fill each employee's published monthly net incentive and recalculate Net Payable"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#9A7625]" />
                    <span>1-Click Sync Incentives</span>
                  </button>
                  <button
                    type="button"
                    disabled={publishing || parseSummary.validRows.length === 0}
                    onClick={() => handleOneClickSync('LOANS')}
                    className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-[#0F1F3D] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    title="Auto-fill active employee loan/advance EMIs into Advance Recovery"
                  >
                    <Wallet className="w-3.5 h-3.5 text-[#0F1F3D]" />
                    <span>Sync Loan EMIs</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedRawRows([]);
                      setParseSummary(null);
                      setActiveMissingAction(null);
                      setFileName('');
                    }}
                    className="h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    disabled={publishing || uploadMonthLocked || parseSummary.validRows.length === 0}
                    onClick={handlePublish}
                    className="h-9 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {uploadMonthLocked ? (
                      <Lock className="w-3.5 h-3.5" />
                    ) : (
                      <ReceiptIndianRupee className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {uploadMonthLocked
                        ? `${formatMonthLabel(uploadMonth)} Locked`
                        : publishing
                          ? 'Publishing Salary Slips...'
                          : `Publish ${parseSummary.validRows.length} Salary Slip(s)`}
                    </span>
                  </button>
                </div>
              </div>

              {uploadMonthLocked && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-950 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>
                    <strong>Payroll Frozen:</strong> {formatMonthLabel(uploadMonth)} is locked by the Main Owner.
                    Publishing or deleting slips for this month is blocked until unlocked in <strong>Pro Insights &amp; Loans</strong>.
                  </span>
                </div>
              )}

              {/* Double-Incentive Protection Notice when uploaded paysheet already includes Sales Commission */}
              {parseSummary.validRows.some((r) => r.salesCommissionPaise > 0) && (
                <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-xs text-sky-950 flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-sky-700 shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-semibold">
                      Double-Incentive Auto-Protection Active:
                    </strong>{' '}
                    {parseSummary.validRows.filter((r) => r.salesCommissionPaise > 0).length}{' '}
                    employee(s) already have <strong>Sales Commission</strong> included in this
                    paysheet. Clicking <em>1-Click Sync Incentives</em> will automatically skip
                    those employees so incentives are never double-counted.
                  </div>
                </div>
              )}

              {/* Pre-Publish Smart Audit & Anomaly Guard */}
              {salaryAnomalies.length > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-950 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold flex items-center gap-1.5 text-amber-900">
                      <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                      Pre-Publish Smart Audit Guard: {salaryAnomalies.length} anomaly flag(s) detected
                    </p>
                    <span className="text-[11px] font-medium text-amber-800">
                      Review before publishing
                    </span>
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                    {salaryAnomalies.slice(0, 15).map((a) => (
                      <div
                        key={a.id}
                        className="flex items-start justify-between gap-2 bg-white/80 border border-amber-200 rounded-lg px-2.5 py-1.5"
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
                        <span className="text-[10px] text-slate-500 shrink-0">{a.branchName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Inline Add / Change / Update Resolution Table for Employees Not Found in Master */}
              {missingEmployeeRows.length > 0 && (
                <div className="rounded-xl border border-amber-300 bg-amber-50/60 overflow-hidden">
                  <div className="px-4 py-2.5 bg-amber-100/80 border-b border-amber-200 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                        Employees Not Found in Employee Master ({missingEmployeeRows.length})
                      </p>
                      <span className="text-[11px] font-medium text-amber-900">
                        Use <strong>Add</strong>, <strong>Change</strong>, or <strong>Update</strong>{' '}
                        per row, or bulk-add all missing employees in one click.
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={bulkAddingMissing}
                      onClick={() => void handleBulkAddAllMissing()}
                      className="h-8 px-3 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
                    >
                      <UserPlus className="w-3.5 h-3.5 text-[#DFC27D]" />
                      <span>
                        {bulkAddingMissing
                          ? 'Adding Missing Staff...'
                          : `Bulk Add All Missing (${missingEmployeeRows.length})`}
                      </span>
                    </button>
                  </div>
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-amber-50 border-b border-amber-200 text-amber-950 font-semibold">
                        <tr>
                          <th className="py-2 px-3">Row / Sheet ID</th>
                          <th className="py-2 px-3">Employee &amp; Sheet Details</th>
                          <th className="py-2 px-3 text-right">Net Pay</th>
                          <th className="py-2 px-3 text-right">Action (Add / Change / Update)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-200/70 bg-white">
                        {missingEmployeeRows.map((row) => {
                          const topSuggestion = findSuggestedMasterEmployeesForSalaryRow(
                            row,
                            effectiveEmployees,
                            1,
                          )[0];
                          return (
                            <tr key={`missing-${row.rowNumber}-${row.employeeId}`} className="hover:bg-amber-50/40">
                              <td className="py-2.5 px-3 align-top whitespace-nowrap">
                                <span className="text-[10px] font-semibold text-slate-400 block">
                                  Row {row.rowNumber}
                                </span>
                                <span className="font-mono font-bold text-red-700">
                                  {row.employeeId || 'blank'}
                                </span>
                                {row.saleId && (
                                  <span className="block text-[10px] font-mono text-[#8A671F]">
                                    Sales ID: {row.saleId}
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 align-top">
                                <p className="font-semibold text-slate-900">{row.employeeName}</p>
                                <p className="text-[11px] text-slate-500">
                                  {row.rawBranch || 'Branch not specified'}
                                  {row.resolvedDepartment?.name || row.customDepartmentName
                                    ? ` · ${row.resolvedDepartment?.name || row.customDepartmentName}`
                                    : ''}
                                  {row.designation && row.designation !== 'Employee'
                                    ? ` · ${row.designation}`
                                    : ''}
                                </p>
                                {topSuggestion && (
                                  <p className="text-[10px] font-medium text-emerald-700 mt-0.5">
                                    Possible Master match: {topSuggestion.employee.fullName} (
                                    {topSuggestion.employee.employeeId}) — {topSuggestion.reason}
                                  </p>
                                )}
                              </td>
                              <td className="py-2.5 px-3 align-top text-right font-mono tabular-nums font-semibold text-[#0F1F3D] whitespace-nowrap">
                                {formatINRFromPaise(row.netPayablePaise)}
                              </td>
                              <td className="py-2.5 px-3 align-top text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setActiveMissingAction({ row, mode: 'ADD' })
                                    }
                                    className="h-7 px-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                                    title="Add this employee directly to Employee Master"
                                  >
                                    <UserPlus className="w-3 h-3" />
                                    <span>Add</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setActiveMissingAction({ row, mode: 'CHANGE' })
                                    }
                                    className="h-7 px-2.5 rounded-lg border border-[#0F1F3D]/30 bg-[#0F1F3D]/[0.05] hover:bg-[#0F1F3D]/[0.12] text-[#0F1F3D] text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                                    title="Change Employee ID or map to an existing Master employee"
                                  >
                                    <ArrowRightLeft className="w-3 h-3" />
                                    <span>Change</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setActiveMissingAction({ row, mode: 'UPDATE' })
                                    }
                                    className="h-7 px-2.5 rounded-lg border border-[#B8923A]/50 bg-[#FDF8EC] hover:bg-[#FAF0D7] text-[#7D5E18] text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                                    title="Update an existing Master employee with this paysheet's details and link"
                                  >
                                    <UserCheck className="w-3 h-3" />
                                    <span>Update</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {otherSkippedRows.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1 max-h-40 overflow-y-auto">
                  <p className="font-semibold">
                    Other rows skipped due to validation or duplicate issues ({otherSkippedRows.length}):
                  </p>
                  {otherSkippedRows.slice(0, 20).map((err) => (
                    <div key={`${err.rowNumber}-${err.employeeId}`} className="font-mono text-[11px]">
                      Row {err.rowNumber} [{err.employeeId || 'blank'}]: {err.errorMessage}
                    </div>
                  ))}
                </div>
              )}

              {parseSummary.validRows.some((r) => Boolean(r.sheetCrossCheckWarning)) && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-950 space-y-1 max-h-36 overflow-y-auto">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                    Excel Formula Cross-Check Notice (EARN GROSS / Total Deduction / NET PAY):
                  </p>
                  {parseSummary.validRows
                    .filter((r) => Boolean(r.sheetCrossCheckWarning))
                    .slice(0, 15)
                    .map((r) => (
                      <div key={`xc-${r.rowNumber}-${r.employeeId}`} className="font-mono text-[11px]">
                        Row {r.rowNumber} [{r.employeeId} · {r.employeeName}]: {r.sheetCrossCheckWarning}
                      </div>
                    ))}
                </div>
              )}

              {parseSummary.validRows.length > 0 && (
                <div className="max-h-64 overflow-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <tr>
                        <th className="py-2 px-3">Employee ID</th>
                        <th className="py-2 px-3">Employee &amp; Branch</th>
                        <th className="py-2 px-3">Department</th>
                        <th className="py-2 px-3 text-right">Paid Days / Total Days</th>
                        <th className="py-2 px-3 text-right">Gross Earnings</th>
                        <th className="py-2 px-3 text-right">Total Deductions</th>
                        <th className="py-2 px-3 text-right">Net Payable Salary</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parseSummary.validRows.slice(0, 80).map((row) => (
                        <tr key={`${row.monthKey}-${row.employeeId}`} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono text-slate-900">
                            <div>{row.employeeId}</div>
                            {row.saleId && (
                              <div className="text-[10px] text-[#8A671F] font-semibold">
                                Sales ID: {row.saleId}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <p className="font-semibold text-slate-900">{row.employeeName}</p>
                            <p className="text-[11px] text-slate-500">
                              {row.branchName} · {formatMonthLabel(row.monthKey)}
                              {row.paymentMode ? ` · ${row.paymentMode}` : ''}
                            </p>
                            {row.sheetCrossCheckWarning && (
                              <p className="text-[10px] text-amber-800 font-medium mt-0.5">
                                {row.sheetCrossCheckWarning}
                              </p>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <span className="text-slate-800 font-medium">
                              {row.resolvedDepartment?.name ||
                                row.customDepartmentName ||
                                row.matchedEmployee?.departmentName ||
                                '—'}
                            </span>
                            {!row.resolvedDepartment && row.customDepartmentName && (
                              <span className="block text-[10px] text-slate-500">
                                Non-Sales Department
                              </span>
                            )}
                            {row.willSyncDepartment && (
                              <span className="block text-[10px] font-semibold text-emerald-700">
                                Will auto-sync
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                            <div>
                              {row.paidDays} / {row.totalDays}
                            </div>
                            {row.overtimeDays > 0 && (
                              <div className="text-[10px] text-slate-500">
                                Overtime: {row.overtimeDays} Days
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800">
                            {formatINRFromPaise(row.grossEarningsPaise)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-red-700">
                            {formatINRFromPaise(row.totalDeductionsPaise)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums font-bold text-[#0F1F3D]">
                            {formatINRFromPaise(row.netPayablePaise)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Section 2: Published Salary Slips KPIs & Register */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500">Published Slips</p>
            <Users className="w-4 h-4 text-[#B8923A]" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-[#0F1F3D] mt-1.5">
            {filteredSlips.length}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {availableMonths.length} month(s) on record
          </p>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Total Gross Payroll</p>
          <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-[#0F1F3D] mt-1.5">
            {formatINRFromPaise(registerTotals.gross)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">Before statutory deductions</p>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Total Deductions</p>
          <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-red-700 mt-1.5">
            {formatINRFromPaise(registerTotals.ded)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Provident Fund, ESIC, Professional Tax, Advance &amp; Income Tax
          </p>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Total Net Payable</p>
          <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1.5">
            {formatINRFromPaise(registerTotals.net)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">In-hand employee payout</p>
        </div>
      </div>

      {/* Register Table */}
      <section className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-2xs">
        <div className="p-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-[#0F1F3D]">Published Monthly Salary Register</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or ID..."
                className="h-9 pl-8 pr-3 rounded-lg border border-slate-200 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/15 w-44"
              />
            </div>

            <select
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="h-9 px-2.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 bg-white"
            >
              <option value="ALL">All Months</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {formatMonthLabel(m)}
                </option>
              ))}
            </select>

            <select
              value={filterBranch}
              onChange={(e) => setFilterBranch(e.target.value)}
              className="h-9 px-2.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 bg-white"
            >
              <option value="ALL">All 12 Branches</option>
              {branches.map((b) => (
                <option key={b.branchId} value={b.branchId}>
                  {b.branchName}
                </option>
              ))}
            </select>

            <select
              value={filterDept}
              onChange={(e) =>
                setFilterDept(e.target.value as 'ALL' | 'UNASSIGNED' | 'NON_SALES' | DepartmentId)
              }
              className="h-9 px-2.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 bg-white"
            >
              <option value="ALL">All Departments</option>
              <option value="NON_SALES">Other / Non-Sales Departments</option>
              <option value="UNASSIGNED">Unassigned Department</option>
              {OFFICIAL_DEPARTMENTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={filteredSlips.length === 0 || exportingType !== null}
              onClick={() => void handleQuickPayrollExport('NEFT')}
              className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-[#0F1F3D] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
              title="Download Bank NEFT Bulk Transfer Excel for the selected branch & month"
            >
              <Landmark className="w-3.5 h-3.5 text-emerald-700" />
              <span>{exportingType === 'NEFT' ? 'Exporting...' : 'Bank NEFT (.xlsx)'}</span>
            </button>

            <button
              type="button"
              disabled={filteredSlips.length === 0 || exportingType !== null}
              onClick={() => void handleQuickPayrollExport('DCR')}
              className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-[#0F1F3D] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
              title="Download DCR / Cash Disbursement Sheet for the selected branch & month"
            >
              <Wallet className="w-3.5 h-3.5 text-[#9A7625]" />
              <span>{exportingType === 'DCR' ? 'Exporting...' : 'DCR / Cash'}</span>
            </button>

            <button
              type="button"
              disabled={filteredSlips.length === 0 || exportingType !== null}
              onClick={() => void handleQuickPayrollExport('STATUTORY')}
              className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-[#0F1F3D] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
              title="Download Monthly PF / ESIC / PT / LWF Statutory Challan Excel"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-blue-700" />
              <span>{exportingType === 'STATUTORY' ? 'Exporting...' : 'PF / ESIC / PT'}</span>
            </button>

            <button
              type="button"
              disabled={filteredSlips.length === 0 || zipProgress !== null}
              onClick={() => void handleDownloadBranchZip()}
              className="h-9 px-3 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
              title="Download all filtered PDF salary slips sorted into branch folders inside one ZIP"
            >
              <Archive className="w-3.5 h-3.5 text-[#DFC27D]" />
              <span>
                {zipProgress
                  ? `Zipping ${zipProgress.done}/${zipProgress.total}...`
                  : `Branch ZIP (${filteredSlips.length})`}
              </span>
            </button>

            <button
              type="button"
              disabled={filteredSlips.length === 0}
              onClick={() => setWhatsAppModalOpen(true)}
              className="h-9 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
              title="Send WhatsApp salary slip alerts to employees"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>WhatsApp Dispatch</span>
            </button>

            {isMainOwner && (
              <>
                <button
                  type="button"
                  disabled={filteredSlips.length === 0 || filteredSlipsHaveLockedMonth}
                  onClick={() => {
                    setConfirmBulkDeleteOpen(false);
                    if (!showMoveMonthBar && filterMonth !== 'ALL') {
                      setMoveTargetMonth(getPreviousMonthKey(filterMonth));
                    }
                    setShowMoveMonthBar((v) => !v);
                  }}
                  className="h-9 px-3 rounded-lg border border-[#B8923A]/50 bg-[#FDF8EC] hover:bg-[#FAF0D7] text-[#0F1F3D] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
                  title="Main Owner only: move all currently filtered salary slips to a different month"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 text-[#9A7625]" />
                  <span>Move Month ({filteredSlips.length})</span>
                </button>

                <button
                  type="button"
                  disabled={filteredSlips.length === 0 || filteredSlipsHaveLockedMonth}
                  onClick={() => {
                    setShowMoveMonthBar(false);
                    setConfirmBulkDeleteOpen((v) => !v);
                  }}
                  className="h-9 px-3 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
                  title="Main Owner only: delete all currently filtered salary slips in one click"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete All ({filteredSlips.length})</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Inline 1-Click Move Slips to Correct Month Bar (Main Owner ONLY) */}
        {isMainOwner && showMoveMonthBar && filteredSlips.length > 0 && (
          <div className="px-4 py-3 bg-[#FDF8EC] border-b border-[#B8923A]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-[#0F1F3D]">
              <p className="font-bold flex items-center gap-1.5">
                <ArrowRightLeft className="w-4 h-4 text-[#9A7625]" />
                Move {filteredSlips.length} Filtered Salary Slip(s) to Correct Month
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                This updates the Salary Month on both the Portal and PDF Payslip, and automatically deletes the old wrong-month slip(s).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <label className="text-xs font-semibold text-[#0F1F3D]">New Month:</label>
              <input
                type="month"
                value={moveTargetMonth}
                onChange={(e) => setMoveTargetMonth(e.target.value)}
                className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-[#0F1F3D]"
              />
              <button
                type="button"
                disabled={movingMonthBusy || !moveTargetMonth}
                onClick={() => void handleMoveFilteredSlipsMonth()}
                className="h-8 px-3 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {movingMonthBusy
                  ? 'Moving Slips...'
                  : `Confirm Move to ${formatMonthLabel(moveTargetMonth)}`}
              </button>
              <button
                type="button"
                disabled={movingMonthBusy}
                onClick={() => setShowMoveMonthBar(false)}
                className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-600 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Inline 1-Click Bulk Delete Filtered Slips Confirmation Bar (Main Owner ONLY) */}
        {isMainOwner && confirmBulkDeleteOpen && filteredSlips.length > 0 && (
          <div className="px-4 py-3 bg-red-50 border-b border-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-red-950">
              <p className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-red-700" />
                Confirm Bulk Delete of {filteredSlips.length} Salary Slip(s)
              </p>
              <p className="text-[11px] text-red-800 mt-0.5">
                Filter selected:{' '}
                <strong>
                  {filterMonth === 'ALL' ? 'All Months' : formatMonthLabel(filterMonth)}
                </strong>{' '}
                ·{' '}
                <strong>
                  {filterBranch === 'ALL'
                    ? 'All 12 Branches'
                    : branches.find((b) => b.branchId === filterBranch)?.branchName || filterBranch}
                </strong>
                . These {filteredSlips.length} slip(s) will be permanently removed.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={bulkDeletingBusy}
                onClick={() => void handleBulkDeleteFilteredSlips()}
                className="h-8 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {bulkDeletingBusy
                  ? 'Deleting...'
                  : `Yes, Delete All ${filteredSlips.length} Slip(s)`}
              </button>
              <button
                type="button"
                disabled={bulkDeletingBusy}
                onClick={() => setConfirmBulkDeleteOpen(false)}
                className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-600 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {filteredSlips.length === 0 ? (
          <div className="py-12 px-6 text-center space-y-1.5">
            <p className="text-sm font-semibold text-slate-700">No salary slips published yet</p>
            <p className="text-xs text-slate-500">
              Download the pre-filled template above, fill in monthly salaries, and upload to issue
              employee PDF salary slips.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <tr>
                  <th className="py-2.5 px-4">Salary Month</th>
                  <th className="py-2.5 px-4">Employee Name &amp; ID</th>
                  <th className="py-2.5 px-4">Branch &amp; Department</th>
                  <th className="py-2.5 px-4 text-right">Paid / Total Days</th>
                  <th className="py-2.5 px-4 text-right">Gross Earnings</th>
                  <th className="py-2.5 px-4 text-right">Total Deductions</th>
                  <th className="py-2.5 px-4 text-right">Net Payable Salary</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSlips.map((slip) => (
                  <tr key={slip.slipId} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <p className="font-semibold text-[#0F1F3D]">
                        {formatMonthLabel(slip.monthKey)}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {slip.employeeVisible ? 'Visible to Staff' : 'Hidden by Month Rule'}
                      </p>
                    </td>
                    <td className="py-2.5 px-4">
                      <p className="font-semibold text-slate-900">{slip.employeeName}</p>
                      <p className="text-[11px] font-mono text-slate-500">{slip.employeeId}</p>
                    </td>
                    <td className="py-2.5 px-4">
                      <p className="font-medium text-slate-800">{slip.branchName}</p>
                      <p className="text-[11px] text-slate-500">
                        {slip.departmentName || 'Unassigned'}
                      </p>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                      {slip.paidDays} / {slip.totalDays}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-800">
                      {formatINRFromPaise(slip.grossEarningsPaise)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-red-700">
                      {formatINRFromPaise(slip.totalDeductionsPaise)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-[#0F1F3D]">
                      {formatINRFromPaise(slip.netPayablePaise)}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void downloadEmployeeSalarySlipPdf(slip)}
                          className="h-8 px-2.5 rounded-lg border border-[#0F1F3D]/20 bg-[#0F1F3D]/[0.04] hover:bg-[#0F1F3D]/[0.08] text-[11px] font-semibold text-[#0F1F3D] inline-flex items-center gap-1 cursor-pointer"
                        >
                          <FileDown className="w-3.5 h-3.5 text-[#B8923A]" />
                          <span>PDF</span>
                        </button>

                        <a
                          href={buildWhatsAppDeepLink(
                            employeePhoneMap[slip.employeeId.trim().toUpperCase()],
                            buildWhatsAppSlipMessage({
                              employeeName: slip.employeeName,
                              monthKey: slip.monthKey,
                              netPayablePaise: slip.netPayablePaise,
                              branchName: slip.branchName,
                              portalUrl: getShareableStaffAppUrl(),
                            }),
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Send Salary Slip notification on WhatsApp"
                          className="h-8 w-8 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 inline-flex items-center justify-center"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                        </a>

                        {isMonthPayrollLockedLocal(slip.monthKey, payrollLockSettings) ? (
                          <span
                            title={`${formatMonthLabel(slip.monthKey)} is locked by Main Owner`}
                            className="h-8 w-8 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 inline-flex items-center justify-center"
                          >
                            <Lock className="w-3.5 h-3.5" />
                          </span>
                        ) : isMainOwner ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setEditingSlip(slip)}
                              title="Main Owner: Directly edit & update this published salary slip"
                              className="h-8 px-2 rounded-lg border border-[#B8923A]/50 bg-[#FDF8EC] hover:bg-[#FAF0D7] text-[#0F1F3D] text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-[#9A7625]" />
                              <span>Edit</span>
                            </button>
                            {confirmDeleteId === slip.slipId ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={deletingId === slip.slipId}
                                  onClick={() => void handleDeleteSlip(slip)}
                                  className="h-8 px-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                                >
                                  {deletingId === slip.slipId ? '...' : 'Confirm'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="h-8 px-2 rounded-lg border border-slate-200 text-[11px] text-slate-600 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(slip.slipId)}
                                title="Main Owner only: permanently delete salary slip"
                                className="h-8 w-8 rounded-lg border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 inline-flex items-center justify-center cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Bulk WhatsApp Dispatch Drawer/Modal (Zero window.open — standard external anchor links) */}
      {whatsAppModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-2xl max-h-[82vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 bg-[#0F1F3D] text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-emerald-400" />
                  Bulk WhatsApp Salary Slip Dispatch ({filteredSlips.length})
                </h3>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  Click &ldquo;Send on WhatsApp&rdquo; for each staff member to open a pre-filled Marathi/English alert with Net Pay &amp; Portal Link.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWhatsAppModalOpen(false)}
                className="p-1.5 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-4">
              {filteredSlips.map((slip) => {
                const phone = employeePhoneMap[slip.employeeId.trim().toUpperCase()] || '';
                const msg = buildWhatsAppSlipMessage({
                  employeeName: slip.employeeName,
                  monthKey: slip.monthKey,
                  netPayablePaise: slip.netPayablePaise,
                  branchName: slip.branchName,
                  portalUrl: getShareableStaffAppUrl(),
                });
                const waUrl = buildWhatsAppDeepLink(phone, msg);
                return (
                  <div
                    key={slip.slipId}
                    className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[#0F1F3D] truncate">
                        {slip.employeeName}{' '}
                        <span className="font-mono text-[11px] text-slate-500">
                          ({slip.employeeId})
                        </span>
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {slip.branchName} · {formatMonthLabel(slip.monthKey)} ·{' '}
                        <strong className="font-mono text-emerald-700">
                          {formatINRFromPaise(slip.netPayablePaise)}
                        </strong>
                        {phone ? ` · 📱 ${phone}` : ' · No phone saved (choose contact in WhatsApp)'}
                      </p>
                    </div>
                    <div className="inline-flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleCopyWhatsAppMsg(slip.slipId, msg)}
                        className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer"
                      >
                        {copiedWhatsAppId === slip.slipId ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy
                          </>
                        )}
                      </button>
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Send on WhatsApp
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {/* Inline Missing Employee Resolution Modal (Add / Change / Update) */}
      {activeMissingAction && (
        <MissingSalaryEmployeeModal
          row={activeMissingAction.row}
          initialMode={activeMissingAction.mode}
          branches={branches}
          employees={effectiveEmployees}
          onClose={() => setActiveMissingAction(null)}
          onResolved={handleMissingEmployeeResolved}
        />
      )}

      {/* Main Owner ONLY: Direct Inline Salary Slip Edit & Update Modal */}
      {isMainOwner && editingSlip && (
        <OwnerSalarySlipEditModal
          slip={editingSlip}
          onClose={() => setEditingSlip(null)}
          onSaved={async (updated) => {
            setEditingSlip(null);
            setFeedback({
              type: 'ok',
              text: `Main Owner updated salary slip for ${updated.employeeName} (${formatMonthLabel(updated.monthKey)}) · Net Payable ${formatINRFromPaise(updated.netPayablePaise)}.`,
            });
            await onRefresh();
          }}
        />
      )}
    </div>
  );
}
