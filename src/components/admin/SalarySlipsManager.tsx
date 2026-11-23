import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileDown,
  FileSpreadsheet,
  ReceiptIndianRupee,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { OFFICIAL_DEPARTMENTS } from '../../lib/departmentLeaderboardEngine';
import {
  formatINRFromPaise,
  formatMonthLabel,
  getCurrentMonthKeyIST,
} from '../../lib/format';
import { downloadEmployeeSalarySlipPdf } from '../../lib/pdfGenerator';
import {
  buildSalarySlipCsvTemplate,
  detectSalaryHeaderRowIndex,
  normalizeDateCellToIso,
  parseSalaryCsvText,
  parseSalarySheetRows,
  type RawSalaryInputRow,
  type SalarySheetParseSummary,
} from '../../lib/salarySlipEngine';
import {
  deleteSalarySlip,
  publishSalarySlipsBatch,
} from '../../services/salarySlipService';
import type {
  Branch,
  DepartmentId,
  Employee,
  PortalVisibilitySettings,
  PublishedIncentive,
  SalarySlip,
} from '../../types/incentive';

interface Props {
  branches: Branch[];
  employees: Employee[];
  incentives: PublishedIncentive[];
  salarySlips: SalarySlip[];
  visibilitySettings?: PortalVisibilitySettings;
  onRefresh: () => Promise<void>;
}

export function SalarySlipsManager({
  branches,
  employees,
  incentives,
  salarySlips,
  visibilitySettings,
  onRefresh,
}: Props) {
  const [uploadMonth, setUploadMonth] = useState<string>(getCurrentMonthKeyIST());
  const [syncMasterData, setSyncMasterData] = useState<boolean>(true);
  const [fileName, setFileName] = useState<string>('');
  const [parseSummary, setParseSummary] = useState<SalarySheetParseSummary | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Register filters
  const availableMonths = useMemo(() => {
    const set = new Set<string>(salarySlips.map((s) => s.monthKey));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [salarySlips]);

  const [filterMonth, setFilterMonth] = useState<string>('ALL');
  const [filterBranch, setFilterBranch] = useState<string>('ALL');
  const [filterDept, setFilterDept] = useState<'ALL' | 'UNASSIGNED' | DepartmentId>('ALL');
  const [search, setSearch] = useState<string>('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredSlips = useMemo(() => {
    const q = search.trim().toLowerCase();
    return salarySlips.filter((s) => {
      if (filterMonth !== 'ALL' && s.monthKey !== filterMonth) return false;
      if (filterBranch !== 'ALL' && s.branchId !== filterBranch) return false;
      if (filterDept === 'UNASSIGNED' && s.departmentId) return false;
      if (filterDept !== 'ALL' && filterDept !== 'UNASSIGNED' && s.departmentId !== filterDept) {
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

  const handleDownloadTemplate = () => {
    const csv = buildSalarySlipCsvTemplate(employees, uploadMonth);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `house-of-muktai-salary-template-${uploadMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseSummary(null);
    setFeedback(null);

    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
        const text = await file.text();
        setParseSummary(parseSalaryCsvText(text, employees, uploadMonth));
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

        setParseSummary(parseSalarySheetRows(rawRows, employees, uploadMonth));
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

  const handlePublish = async () => {
    if (!parseSummary || parseSummary.validRows.length === 0) return;
    setPublishing(true);
    setFeedback(null);
    try {
      const res = await publishSalarySlipsBatch({
        validRows: parseSummary.validRows,
        allEmployees: employees,
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

      setParseSummary(null);
      setFileName('');
      setFeedback({
        type: 'ok',
        text: `Published ${res.slipsPublished} monthly salary slip(s) cleanly.${syncParts.length ? ` ${syncParts.join(' · ')}.` : ''}`,
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0F1F3D] tracking-tight">
            Monthly Salary Slips & HR Master Sync
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Upload monthly payroll Excel/CSV to issue employee PDF salary slips and auto-sync
            Department, Designation, DOJ & Bank details across all 12 branches.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="h-9 px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-[#0F1F3D] inline-flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5 text-[#B8923A]" />
          <span>Refresh</span>
        </button>
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
                  Matches employees by Salesman No / Employee ID · Strictly private per employee
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="h-9 px-3.5 rounded-lg bg-[#B8923A] hover:bg-[#a68230] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Pre-Filled Template ({formatMonthLabel(uploadMonth)})</span>
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
                onChange={(e) => setUploadMonth(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20"
              />
            </div>

            <div className="md:col-span-5">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Select Salary Register File (.xlsx or .csv)
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
                  Department, Designation, DOJ &amp; Bank/Statutory details and refresh 5-Dept
                  Top-3 Leaderboards automatically.
                </span>
              </label>
            </div>
          </div>

          {/* Supported columns quick guide */}
          <p className="text-[11px] text-slate-500">
            Supported columns: <span className="font-medium text-slate-700">Salesman No</span>,{' '}
            <span className="font-medium text-slate-700">Department</span> (Saree / Ladies Wear /
            Kids Wear / Mens Wear / Non Apparels),{' '}
            <span className="font-medium text-slate-700">Total / Paid / LOP Days</span>,{' '}
            <span className="font-medium text-slate-700">Basic, HRA, Conveyance, Special, OT, Incentive</span>,{' '}
            <span className="font-medium text-slate-700">PF, ESIC, PT, Advance, TDS</span>, and{' '}
            <span className="font-medium text-slate-700">Bank / IFSC / UAN / PAN</span>. Bank
            account numbers are automatically masked as <span className="font-mono">XXXX1234</span>.
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

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setParseSummary(null);
                      setFileName('');
                    }}
                    className="h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    disabled={publishing || parseSummary.validRows.length === 0}
                    onClick={handlePublish}
                    className="h-9 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <ReceiptIndianRupee className="w-3.5 h-3.5" />
                    <span>
                      {publishing
                        ? 'Publishing Salary Slips...'
                        : `Publish ${parseSummary.validRows.length} Salary Slip(s)`}
                    </span>
                  </button>
                </div>
              </div>

              {(parseSummary.errorRows.length > 0 || parseSummary.duplicateRows.length > 0) && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1 max-h-40 overflow-y-auto">
                  <p className="font-semibold">
                    Rows skipped due to validation or duplicate issues:
                  </p>
                  {[...parseSummary.errorRows, ...parseSummary.duplicateRows]
                    .slice(0, 20)
                    .map((err) => (
                      <div key={`${err.rowNumber}-${err.employeeId}`} className="font-mono text-[11px]">
                        Row {err.rowNumber} [{err.employeeId || 'blank'}]: {err.errorMessage}
                      </div>
                    ))}
                </div>
              )}

              {parseSummary.validRows.length > 0 && (
                <div className="max-h-64 overflow-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <tr>
                        <th className="py-2 px-3">Emp ID</th>
                        <th className="py-2 px-3">Employee &amp; Branch</th>
                        <th className="py-2 px-3">Department</th>
                        <th className="py-2 px-3 text-right">Paid / Total</th>
                        <th className="py-2 px-3 text-right">Gross</th>
                        <th className="py-2 px-3 text-right">Deductions</th>
                        <th className="py-2 px-3 text-right">Net Payable</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parseSummary.validRows.slice(0, 80).map((row) => (
                        <tr key={`${row.monthKey}-${row.employeeId}`} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono text-slate-900">{row.employeeId}</td>
                          <td className="py-2 px-3">
                            <p className="font-semibold text-slate-900">{row.employeeName}</p>
                            <p className="text-[11px] text-slate-500">
                              {row.branchName} · {formatMonthLabel(row.monthKey)}
                            </p>
                          </td>
                          <td className="py-2 px-3">
                            <span className="text-slate-800 font-medium">
                              {row.resolvedDepartment?.name ||
                                row.matchedEmployee?.departmentName ||
                                '—'}
                            </span>
                            {row.willSyncDepartment && (
                              <span className="block text-[10px] font-semibold text-emerald-700">
                                Will auto-sync
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                            {row.paidDays} / {row.totalDays}
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
          <p className="text-[11px] text-slate-400 mt-0.5">PF, ESIC, PT, Advance &amp; TDS</p>
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
              onChange={(e) => setFilterDept(e.target.value as 'ALL' | 'UNASSIGNED' | DepartmentId)}
              className="h-9 px-2.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 bg-white"
            >
              <option value="ALL">All Departments</option>
              <option value="UNASSIGNED">Unassigned Dept</option>
              {OFFICIAL_DEPARTMENTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>

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
                  <th className="py-2.5 px-4">Month</th>
                  <th className="py-2.5 px-4">Employee</th>
                  <th className="py-2.5 px-4">Branch &amp; Dept</th>
                  <th className="py-2.5 px-4 text-right">Paid Days</th>
                  <th className="py-2.5 px-4 text-right">Gross</th>
                  <th className="py-2.5 px-4 text-right">Deductions</th>
                  <th className="py-2.5 px-4 text-right">Net Payable</th>
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
                            title="Delete Salary Slip"
                            className="h-8 w-8 rounded-lg border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 inline-flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
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
