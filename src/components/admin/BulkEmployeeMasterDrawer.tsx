import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  ShieldAlert,
  ShieldCheck,
  Upload,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import {
  buildEmployeeImportDiagnosticsCsv,
  buildEmployeeMasterCsvTemplate,
  detectEmployeeHeaderRowIndex,
  parseEmployeeMasterCsvText,
  parseEmployeeMasterRows,
  type EmployeeMasterParseSummary,
  type ParsedEmployeeMasterRow,
} from '../../lib/employeeBulkImportEngine';
import { OFFICIAL_DEPARTMENTS } from '../../lib/departmentLeaderboardEngine';
import { commitEmployeeMasterBulkImport } from '../../services/employeeBulkImportService';
import type {
  Branch,
  Employee,
  PortalVisibilitySettings,
  PublishedIncentive,
} from '../../types/incentive';

type FilterTab = 'ALL' | 'ERROR' | 'OVERLAP_CONFLICT' | 'DUPLICATE_IN_FILE' | 'NEW_READY' | 'UNCHANGED';

interface Props {
  branches: Branch[];
  employees: Employee[];
  incentives: PublishedIncentive[];
  visibilitySettings?: PortalVisibilitySettings;
  customColumns?: string[];
  onClose: () => void;
  onSuccess: (message: string) => Promise<void>;
}

function extractExcelCellValue(rawVal: unknown, textFallback: string): unknown {
  if (rawVal === null || rawVal === undefined) return '';
  if (rawVal instanceof Date) return rawVal;
  if (typeof rawVal === 'object') {
    const obj = rawVal as {
      result?: unknown;
      richText?: Array<{ text?: string }>;
      text?: string;
    };
    if (obj.result !== undefined && obj.result !== null) {
      return obj.result instanceof Date ? obj.result : String(obj.result);
    }
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((part) => part.text || '').join('');
    }
    if (typeof obj.text === 'string') return obj.text;
  }
  return textFallback || String(rawVal);
}

function triggerCsvDownload(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function BulkEmployeeMasterDrawer({
  branches,
  employees,
  incentives,
  visibilitySettings,
  customColumns = [],
  onClose,
  onSuccess,
}: Props) {
  const [fileName, setFileName] = useState('');
  const [summary, setSummary] = useState<EmployeeMasterParseSummary | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>('ALL');
  const [approvedOverlapRows, setApprovedOverlapRows] = useState<Record<number, boolean>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);

  const handleDownloadTemplate = (mode: 'blank' | 'prefilled') => {
    const csv = buildEmployeeMasterCsvTemplate(branches, employees, mode, customColumns);
    triggerCsvDownload(
      csv,
      mode === 'prefilled'
        ? 'House_of_Muktai_Employee_Master_Current.csv'
        : 'House_of_Muktai_Employee_Master_Template.csv',
    );
  };

  const handleDownloadDiagnostics = () => {
    if (!summary) return;
    const csv = buildEmployeeImportDiagnosticsCsv(summary.rows);
    triggerCsvDownload(csv, 'House_of_Muktai_Employee_Import_Errors_And_Overlaps.csv');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    setSummary(null);
    setApprovedOverlapRows({});
    setActiveTab('ALL');

    try {
      const lower = file.name.toLowerCase();
      let result: EmployeeMasterParseSummary;

      if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
        const text = await file.text();
        result = parseEmployeeMasterCsvText(text, branches, employees);
      } else if (lower.endsWith('.xls')) {
        throw new Error(
          'Legacy Excel 97–2003 (.xls) files are not supported. Open the file in Excel, Save As .xlsx or .csv, and upload again.',
        );
      } else if (lower.endsWith('.xlsx')) {
        const ExcelJS = await import('exceljs');
        const wb = new ExcelJS.Workbook();
        const buf = await file.arrayBuffer();
        await wb.xlsx.load(buf);
        const ws = wb.worksheets[0];
        if (!ws) throw new Error('The Excel workbook does not contain any worksheet.');

        const matrix: unknown[][] = [];
        const rowNumbers: number[] = [];
        let maxCol = 1;

        ws.eachRow((row, rowNumber) => {
          const vals: unknown[] = [];
          row.eachCell({ includeEmpty: true }, (cell, colNum) => {
            maxCol = Math.max(maxCol, colNum);
            vals[colNum - 1] = extractExcelCellValue(cell.value, cell.text || '');
          });
          matrix.push(vals);
          rowNumbers.push(rowNumber);
        });

        if (matrix.length < 2) {
          throw new Error('The Excel sheet has fewer than 2 rows. Include a header row and employee rows.');
        }

        const headerIdx = detectEmployeeHeaderRowIndex(matrix);
        const headerCells = matrix[headerIdx] || [];
        const headers: string[] = [];
        for (let c = 0; c < maxCol; c += 1) {
          headers[c] = String(headerCells[c] ?? '').trim();
        }

        const rawRows: Array<{ rowNumber: number; data: Record<string, unknown> }> = [];
        for (let i = headerIdx + 1; i < matrix.length; i += 1) {
          const rowVals = matrix[i] || [];
          const obj: Record<string, unknown> = {};
          let hasData = false;
          for (let c = 0; c < headers.length; c += 1) {
            const h = headers[c];
            if (!h) continue;
            const v = rowVals[c] ?? '';
            if (v !== '' && v !== null && v !== undefined) hasData = true;
            obj[h] = v;
          }
          if (hasData) {
            rawRows.push({ rowNumber: rowNumbers[i] || i + 1, data: obj });
          }
        }
        result = parseEmployeeMasterRows(rawRows, branches, employees);
      } else {
        throw new Error('Unsupported file format. Please upload an .xlsx or .csv file.');
      }

      if (result.totalRows === 0) {
        throw new Error('No employee data rows were found below the header row.');
      }

      setSummary(result);
      // Auto-focus the most urgent diagnostic tab if there are errors or overlaps
      if (result.errorCount > 0) {
        setActiveTab('ERROR');
      } else if (result.overlapConflictCount > 0) {
        setActiveTab('OVERLAP_CONFLICT');
      } else if (result.duplicateInFileCount > 0) {
        setActiveTab('DUPLICATE_IN_FILE');
      } else {
        setActiveTab('ALL');
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Unable to read uploaded file.');
    } finally {
      e.target.value = '';
    }
  };

  const approvedUpdateRows = useMemo(() => {
    if (!summary) return [] as ParsedEmployeeMasterRow[];
    return summary.rows.filter(
      (r) => r.status === 'OVERLAP_CONFLICT' && approvedOverlapRows[r.rowNumber] === true,
    );
  }, [summary, approvedOverlapRows]);

  const newReadyRows = useMemo(() => {
    if (!summary) return [] as ParsedEmployeeMasterRow[];
    return summary.rows.filter((r) => r.status === 'NEW_READY');
  }, [summary]);

  const filteredRows = useMemo(() => {
    if (!summary) return [] as ParsedEmployeeMasterRow[];
    if (activeTab === 'ALL') return summary.rows;
    return summary.rows.filter((r) => r.status === activeTab);
  }, [summary, activeTab]);

  const toggleApproveOverlap = (rowNumber: number) => {
    setApprovedOverlapRows((prev) => ({
      ...prev,
      [rowNumber]: !prev[rowNumber],
    }));
  };

  const handleApproveAllOverlaps = () => {
    if (!summary) return;
    const next: Record<number, boolean> = {};
    for (const r of summary.rows) {
      if (r.status === 'OVERLAP_CONFLICT') next[r.rowNumber] = true;
    }
    setApprovedOverlapRows(next);
  };

  const handleSkipAllOverlaps = () => {
    setApprovedOverlapRows({});
  };

  const handleCommit = async () => {
    if (!summary) return;
    if (newReadyRows.length === 0 && approvedUpdateRows.length === 0) return;

    setCommitting(true);
    setParseError(null);
    try {
      const res = await commitEmployeeMasterBulkImport({
        rowsToCreate: newReadyRows,
        rowsToUpdate: approvedUpdateRows,
        allEmployees: employees,
        incentives,
        visibilitySettings,
      });

      const skippedOverlapCount = summary.overlapConflictCount - approvedUpdateRows.length;
      const parts: string[] = [];
      if (res.createdCount > 0) parts.push(`${res.createdCount} new employee(s) created`);
      if (res.updatedCount > 0) parts.push(`${res.updatedCount} approved overlap update(s) applied`);
      if (skippedOverlapCount > 0) parts.push(`${skippedOverlapCount} overlap(s) safely kept unchanged`);
      if (summary.errorCount + summary.duplicateInFileCount > 0) {
        parts.push(`${summary.errorCount + summary.duplicateInFileCount} error/duplicate row(s) blocked`);
      }
      if (res.birthdayProfilesSynced > 0) {
        parts.push(`${res.birthdayProfilesSynced} birthday profile(s) synced`);
      }
      if (res.leaderboardMonthsRefreshed > 0) {
        parts.push(`Top-3 leaderboards refreshed for ${res.leaderboardMonthsRefreshed} month(s)`);
      }

      await onSuccess(`Bulk Employee Master Import Complete: ${parts.join(' · ')}.`);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Unable to commit Employee Master import.');
    } finally {
      setCommitting(false);
    }
  };

  const issueCount =
    (summary?.errorCount || 0) +
    (summary?.duplicateInFileCount || 0) +
    (summary?.overlapConflictCount || 0);

  return (
    <div className="bg-white border border-[#0F1F3D]/25 rounded-xl overflow-hidden shadow-xs">
      {/* Navy Executive Header */}
      <div className="px-4 sm:px-5 py-3.5 bg-[#0F1F3D] text-white flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-[#DFC27D] shrink-0" />
            <span>Bulk Employee Master Upload · Zero Silent Overlap Guard</span>
          </h3>
          <p className="text-[11px] text-slate-300 mt-0.5">
            Validates Branch ({branches.length} Master Branches), Department (5 Official Departments) &amp;
            Designation. Existing records NEVER silently overlap — every error &amp; conflict explains exact cause.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-slate-300 hover:text-white cursor-pointer shrink-0"
          aria-label="Close bulk employee master upload"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        {/* Step 1 & Step 2 Action Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-[#0F1F3D]">
                Step 1 · Download Official Employee Master Template
              </p>
              <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                Includes <strong>Employee ID (Official Master ID), Sale ID (Optional POS Code for Sales Staff), Login ID, Full Name, Branch, Department, Designation</strong>,
                Gender, Category, Status, DOB, DOJ, Phone, PAN, UAN, PF, ESIC, Bank, IFSC, Address &amp; Emergency Contact.
                <strong> Plus:</strong> Any custom columns you add to the Excel/CSV sheet are automatically imported into Employee Master!
              </p>
              <p className="text-[10px] text-slate-500 mt-1">
                Sales Counter Depts: {OFFICIAL_DEPARTMENTS.map((d) => d.name).join(' · ')} ·
                Non-Sales Depts also supported (Accounts, HR &amp; Admin, Billing &amp; Cash, Head Office, Store Operations, Security, etc.)
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleDownloadTemplate('blank')}
                className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-[#0F1F3D] inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#B8923A]" />
                Blank Template (.csv)
              </button>
              <button
                type="button"
                disabled={employees.length === 0}
                onClick={() => handleDownloadTemplate('prefilled')}
                className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                Export Current Master ({employees.length})
              </button>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-[#0F1F3D]">
                Step 2 · Upload Filled Excel (.xlsx) or CSV (.csv)
              </p>
              <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                Runs pre-import audit before writing anything to Firestore: catches misspelled Branches
                (with closest suggestion), invalid Departments, blank Designations, duplicate IDs, and
                flags any Branch / Department / Designation overlap with existing employees.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="h-9 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer">
                <Upload className="w-3.5 h-3.5 text-[#DFC27D]" />
                <span>{fileName ? `Replace: ${fileName}` : 'Choose Excel (.xlsx) / CSV File'}</span>
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Parse / Commit Error Alert */}
        {parseError && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
            <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{parseError}</span>
          </div>
        )}

        {/* Diagnostic Summary & Interactive Review */}
        {summary && (
          <div className="space-y-3.5 pt-2 border-t border-slate-200">
            {/* Diagnostic Filter Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    {
                      id: 'ALL' as const,
                      label: `All Rows (${summary.totalRows})`,
                      activeCls: 'bg-[#0F1F3D] text-white border-[#0F1F3D]',
                    },
                    {
                      id: 'NEW_READY' as const,
                      label: `New Ready (${summary.newReadyCount})`,
                      activeCls: 'bg-emerald-700 text-white border-emerald-700',
                    },
                    {
                      id: 'OVERLAP_CONFLICT' as const,
                      label: `Overlaps Protected (${summary.overlapConflictCount})`,
                      activeCls: 'bg-amber-700 text-white border-amber-700',
                    },
                    {
                      id: 'ERROR' as const,
                      label: `Errors (${summary.errorCount})`,
                      activeCls: 'bg-rose-700 text-white border-rose-700',
                    },
                    {
                      id: 'DUPLICATE_IN_FILE' as const,
                      label: `Duplicates (${summary.duplicateInFileCount})`,
                      activeCls: 'bg-orange-700 text-white border-orange-700',
                    },
                    {
                      id: 'UNCHANGED' as const,
                      label: `Unchanged (${summary.unchangedCount})`,
                      activeCls: 'bg-slate-700 text-white border-slate-700',
                    },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`h-8 px-2.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                      activeTab === tab.id
                        ? tab.activeCls
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {issueCount > 0 && (
                <button
                  type="button"
                  onClick={handleDownloadDiagnostics}
                  className="h-8 px-3 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-900 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Error &amp; Overlap Report (.csv)
                </button>
              )}
            </div>

            {/* Overlap Protection Guard Banner */}
            {summary.overlapConflictCount > 0 && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 text-xs text-amber-950">
                  <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">
                      Zero Silent Overlap Protection: {summary.overlapConflictCount} existing employee(s)
                      differ from your uploaded file
                      {summary.orgOverlapCount > 0
                        ? ` (${summary.orgOverlapCount} involve Branch, Department, or Designation changes)`
                        : ''}
                      .
                    </p>
                    <p className="text-[11px] text-amber-900/90 mt-0.5">
                      By default, all overlapping rows are <strong>SKIPPED</strong> so Master data is
                      never overwritten accidentally. Inspect each Master → File change below and tick{' '}
                      <strong>Approve Update</strong> only for rows you intend to update.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleSkipAllOverlaps}
                    className="h-8 px-2.5 rounded-lg border border-amber-300 bg-white hover:bg-amber-100 text-amber-950 text-xs font-semibold cursor-pointer"
                  >
                    Skip All ({summary.overlapConflictCount})
                  </button>
                  <button
                    type="button"
                    onClick={handleApproveAllOverlaps}
                    className="h-8 px-2.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold cursor-pointer"
                  >
                    Approve All ({summary.overlapConflictCount})
                  </button>
                </div>
              </div>
            )}

            {/* Diagnostic Table */}
            <div className="max-h-96 overflow-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold z-10">
                  <tr>
                    <th className="py-2.5 px-3 w-14">Row</th>
                    <th className="py-2.5 px-3 w-44">Status &amp; Action</th>
                    <th className="py-2.5 px-3 w-48">Employee</th>
                    <th className="py-2.5 px-3 w-56">Branch · Department · Designation</th>
                    <th className="py-2.5 px-3">Exact Diagnostic / Master → File Comparison</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        No rows in this diagnostic category.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.slice(0, 150).map((row) => {
                      const isApproved = approvedOverlapRows[row.rowNumber] === true;
                      return (
                        <tr
                          key={`${row.rowNumber}-${row.rawEmployeeId}-${row.status}`}
                          className={
                            row.status === 'ERROR'
                              ? 'bg-rose-50/40'
                              : row.status === 'DUPLICATE_IN_FILE'
                                ? 'bg-orange-50/40'
                                : row.status === 'OVERLAP_CONFLICT'
                                  ? isApproved
                                    ? 'bg-amber-50/70'
                                    : 'bg-amber-50/30'
                                  : 'hover:bg-slate-50/60'
                          }
                        >
                          <td className="py-2.5 px-3 font-mono text-slate-600 align-top">
                            #{row.rowNumber}
                          </td>

                          <td className="py-2.5 px-3 align-top">
                            {row.status === 'NEW_READY' && (
                              <div className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                <span>New · Ready</span>
                              </div>
                            )}
                            {row.status === 'UNCHANGED' && (
                              <div className="inline-flex items-center gap-1.5 text-slate-500 font-medium">
                                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                                <span>Unchanged · Skip</span>
                              </div>
                            )}
                            {row.status === 'ERROR' && (
                              <div className="inline-flex items-center gap-1.5 text-rose-700 font-semibold">
                                <XCircle className="w-3.5 h-3.5 shrink-0" />
                                <span>Error · Blocked</span>
                              </div>
                            )}
                            {row.status === 'DUPLICATE_IN_FILE' && (
                              <div className="inline-flex items-center gap-1.5 text-orange-700 font-semibold">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                <span>Duplicate · Blocked</span>
                              </div>
                            )}
                            {row.status === 'OVERLAP_CONFLICT' && (
                              <div className="space-y-1.5">
                                <div className="inline-flex items-center gap-1.5 text-amber-800 font-semibold">
                                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                                  <span>{isApproved ? 'Update Approved' : 'Overlap · Skipped'}</span>
                                </div>
                                <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-800 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={isApproved}
                                    onChange={() => toggleApproveOverlap(row.rowNumber)}
                                    className="rounded border-amber-400 text-[#0F1F3D] focus:ring-[#0F1F3D]"
                                  />
                                  <span>Approve Update</span>
                                </label>
                              </div>
                            )}
                          </td>

                          <td className="py-2.5 px-3 align-top">
                            <p className="font-semibold text-slate-900">
                              {row.fullName || row.rawFullName || '(Blank Name)'}
                            </p>
                            <p className="font-mono text-[11px] text-slate-600 mt-0.5">
                              EMP: {row.employeeId || row.rawEmployeeId || '—'} · Login:{' '}
                              {row.loginId || row.rawLoginId || '—'}
                            </p>
                            {(row.saleId || row.rawSaleId) && (
                              <p className="font-mono text-[10px] text-[#8A671F] font-semibold mt-0.5">
                                Sale ID: {row.saleId || row.rawSaleId}
                              </p>
                            )}
                          </td>

                          <td className="py-2.5 px-3 align-top text-[11px] text-slate-700 space-y-0.5">
                            <div>
                              <span className="text-slate-500">Branch:</span>{' '}
                              <span className="font-semibold text-slate-900">
                                {row.branchName || row.rawBranch || '(Blank)'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500">Dept:</span>{' '}
                              <span className="font-medium text-slate-800">
                                {row.departmentName || row.rawDepartment || 'Unassigned'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500">Desig:</span>{' '}
                              <span className="font-medium text-slate-800">
                                {row.designation || row.rawDesignation || '(Blank)'}
                              </span>
                            </div>
                          </td>

                          <td className="py-2.5 px-3 align-top">
                            {row.status === 'OVERLAP_CONFLICT' ? (
                              <div className="space-y-1">
                                {row.diffs.map((diff) => (
                                  <div
                                    key={diff.field}
                                    className={`text-[11px] px-2 py-1 rounded border ${
                                      diff.isOrgField
                                        ? 'bg-amber-100/80 border-amber-300 text-amber-950'
                                        : 'bg-slate-50 border-slate-200 text-slate-800'
                                    }`}
                                  >
                                    <span className="font-semibold">{diff.label}:</span>{' '}
                                    <span className="line-through text-slate-500">
                                      {diff.masterValue}
                                    </span>{' '}
                                    <ArrowRight className="w-3 h-3 inline text-amber-700 mx-0.5" />{' '}
                                    <span className="font-semibold text-[#0F1F3D]">
                                      {diff.fileValue}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : row.errorDetails.length > 0 ? (
                              <ul className="space-y-1 text-[11px] text-rose-900">
                                {row.errorDetails.map((err, idx) => (
                                  <li
                                    key={`${err.field}-${idx}`}
                                    className="px-2 py-1 rounded bg-rose-100/70 border border-rose-200"
                                  >
                                    <span className="font-semibold">{err.field}:</span> {err.reason}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-[11px] text-slate-600">{row.summaryMessage}</p>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              {filteredRows.length > 150 && (
                <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-600">
                  Showing first 150 of {filteredRows.length} rows. All valid rows will be processed on
                  import, and the downloadable CSV report includes every error &amp; overlap row.
                </div>
              )}
            </div>

            {/* Commit Action Footer */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <div className="text-xs text-slate-600 space-y-0.5">
                <p>
                  <strong className="text-emerald-700">{newReadyRows.length}</strong> new employee(s)
                  {' · '}
                  <strong className="text-amber-700">{approvedUpdateRows.length}</strong> approved
                  overlap update(s)
                  {' · '}
                  <strong className="text-slate-700">
                    {summary.overlapConflictCount - approvedUpdateRows.length + summary.unchangedCount}
                  </strong>{' '}
                  safely skipped
                  {' · '}
                  <strong className="text-rose-700">
                    {summary.errorCount + summary.duplicateInFileCount}
                  </strong>{' '}
                  blocked
                </p>
                <p className="text-[11px] text-slate-500">
                  After creating new employees, click <strong>Activate Pending</strong> in the toolbar to
                  provision their staff Login IDs with the default password.
                </p>
              </div>
              <button
                type="button"
                disabled={
                  committing || (newReadyRows.length === 0 && approvedUpdateRows.length === 0)
                }
                onClick={handleCommit}
                className="h-10 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shrink-0"
              >
                <UserPlus className="w-4 h-4 text-[#DFC27D]" />
                {committing
                  ? 'Importing Employee Master...'
                  : approvedUpdateRows.length > 0
                    ? `Import ${newReadyRows.length} New & Update ${approvedUpdateRows.length} Approved`
                    : `Import ${newReadyRows.length} New Employee(s)`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
