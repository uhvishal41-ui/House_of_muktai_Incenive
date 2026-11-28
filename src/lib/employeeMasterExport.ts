import { formatINRFromPaise, getTodayIST } from './format';
import type { Branch, Employee } from '../types/incentive';

/**
 * Safely masks an Indian Aadhaar number so raw 12-digit PII is never stored in plaintext.
 * Examples:
 *  - "1234 5678 9012" -> "XXXX-XXXX-9012"
 *  - "XXXX-XXXX-9012" -> "XXXX-XXXX-9012"
 *  - "9012"           -> "XXXX-XXXX-9012"
 */
export function maskAadhaarNumber(raw: string | undefined | null): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 4) {
    return `XXXX-XXXX-${digits.slice(-4)}`.slice(0, 20);
  }
  return trimmed.slice(0, 20);
}

/**
 * Parses a rupee string/number (e.g., "18,500", "₹22000.50", 15000) into integer paise.
 * Returns undefined if blank or non-numeric.
 */
export function parseMonthlySalaryToPaise(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return undefined;
    return Math.round(raw * 100);
  }
  const cleaned = String(raw)
    .trim()
    .replace(/[₹,\s]/g, '')
    .replace(/^rs\.?/i, '');
  if (!cleaned) return undefined;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return undefined;
  return Math.round(num * 100);
}

/**
 * Formats integer paise into a plain rupee string suitable for inputs / CSV / Excel.
 */
export function formatSalaryRupeesPlain(paise?: number): string {
  if (paise === undefined || paise === null || !Number.isFinite(paise) || paise <= 0) return '';
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}

export interface EmployeeCompletenessReport {
  scorePct: number;
  completedCount: number;
  totalChecks: number;
  missingLabels: string[];
  kycReady: boolean;
  bankReady: boolean;
  contactReady: boolean;
  floorOpsReady: boolean;
}

/**
 * Computes HR & Payroll readiness for an Employee Master record across 10 core compliance checks.
 */
export function computeEmployeeCompleteness(emp: Employee): EmployeeCompletenessReport {
  const checks: Array<{ label: string; ok: boolean }> = [
    { label: 'Mobile Number', ok: Boolean(emp.phone?.trim()) },
    { label: 'Date of Birth', ok: Boolean(emp.dateOfBirth?.trim()) },
    { label: 'Date of Joining', ok: Boolean(emp.dateOfJoining?.trim()) },
    { label: 'Department', ok: Boolean(emp.departmentId || emp.departmentName?.trim()) },
    { label: 'PAN Number', ok: Boolean(emp.panNumber?.trim()) },
    { label: 'Aadhaar (Masked)', ok: Boolean(emp.aadhaarMasked?.trim()) },
    { label: 'Bank Name & IFSC', ok: Boolean(emp.bankName?.trim() && emp.bankIfsc?.trim()) },
    { label: 'Bank Account', ok: Boolean(emp.bankAccountMasked?.trim()) },
    { label: 'Emergency Contact', ok: Boolean(emp.emergencyContact?.trim()) },
    { label: 'Address', ok: Boolean(emp.address?.trim() || emp.permanentAddress?.trim()) },
  ];

  const completedCount = checks.filter((c) => c.ok).length;
  const totalChecks = checks.length;
  const scorePct = Math.round((completedCount / totalChecks) * 100);
  const missingLabels = checks.filter((c) => !c.ok).map((c) => c.label);

  const kycReady = Boolean(emp.panNumber?.trim() && emp.aadhaarMasked?.trim());
  const bankReady = Boolean(
    emp.bankName?.trim() && emp.bankAccountMasked?.trim() && emp.bankIfsc?.trim(),
  );
  const contactReady = Boolean(
    emp.phone?.trim() && emp.emergencyContact?.trim() && (emp.address?.trim() || emp.permanentAddress?.trim()),
  );
  const floorOpsReady = Boolean(
    emp.dateOfJoining?.trim() && (emp.departmentId || emp.departmentName?.trim()),
  );

  return {
    scorePct,
    completedCount,
    totalChecks,
    missingLabels,
    kycReady,
    bankReady,
    contactReady,
    floorOpsReady,
  };
}

export const FULL_EMPLOYEE_EXPORT_HEADERS = [
  'Employee ID',
  'Sale ID',
  'Login ID',
  'Full Name',
  'Branch',
  'Department',
  'Designation',
  'Status',
  'Mobile Number',
  'Gender',
  'Date of Birth',
  'Date of Joining',
  'Date of Exit',
  'Residential Address',
  'Emergency Contact',
  'Aadhaar Number (Masked)',
  'PAN Number',
  'UAN Number',
  'PF Account Number',
  'ESIC Number',
  'Monthly Gross Salary (INR)',
  'Bank Name',
  'Bank Account Number',
  'Bank IFSC Code',
  'Google Email',
] as const;

function escapeCsvCell(value: string | number | undefined): string {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function normalizeColKey(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function resolveUniqueCustomColumns(
  employees: Employee[],
  extraCustomColumns: string[] = [],
): string[] {
  const stdNormSet = new Set(FULL_EMPLOYEE_EXPORT_HEADERS.map((h) => normalizeColKey(h)));
  const customNames: string[] = [];
  const seen = new Set<string>();

  const register = (raw: string) => {
    const clean = String(raw || '').trim().slice(0, 60);
    const norm = normalizeColKey(clean);
    if (!clean || !norm || stdNormSet.has(norm) || seen.has(norm)) return;
    if (customNames.length >= 25) return;
    seen.add(norm);
    customNames.push(clean);
  };

  for (const col of extraCustomColumns) register(col);
  for (const emp of employees) {
    for (const k of Object.keys(emp.customFields || {})) register(k);
  }
  return customNames;
}

function getCustomFieldValue(emp: Employee, colName: string): string {
  const map = emp.customFields || {};
  if (map[colName] !== undefined) return map[colName];
  const targetNorm = normalizeColKey(colName);
  for (const [k, v] of Object.entries(map)) {
    if (normalizeColKey(k) === targetNorm) return v;
  }
  return '';
}

function buildEmployeeExportRowValues(emp: Employee, customColumns: string[]): Array<string | number> {
  const salaryPlain = emp.monthlyGrossSalaryPaise
    ? Number((emp.monthlyGrossSalaryPaise / 100).toFixed(2))
    : '';

  return [
    emp.employeeId,
    emp.saleId || '',
    emp.loginId,
    emp.fullName,
    emp.branchName,
    emp.departmentName || '',
    emp.designation,
    emp.status,
    emp.phone || '',
    emp.gender || '',
    emp.dateOfBirth || '',
    emp.dateOfJoining || '',
    emp.dateOfExit || '',
    emp.address || '',
    emp.emergencyContact || '',
    emp.aadhaarMasked || '',
    emp.panNumber || '',
    emp.uanNumber || '',
    emp.pfNumber || '',
    emp.esicNumber || '',
    salaryPlain,
    emp.bankName || '',
    emp.bankAccountMasked || '',
    emp.bankIfsc || '',
    emp.linkedGoogleEmail || '',
    ...customColumns.map((c) => getCustomFieldValue(emp, c)),
  ];
}

/**
 * Generates a full UTF-8 CSV (with BOM for clean Excel opening) of all Employee Master records.
 */
export function buildFullEmployeeMasterCsv(
  employees: Employee[],
  extraCustomColumns: string[] = [],
): string {
  const customCols = resolveUniqueCustomColumns(employees, extraCustomColumns);
  const headers = [...FULL_EMPLOYEE_EXPORT_HEADERS, ...customCols];
  const sorted = [...employees].sort(
    (a, b) => a.branchName.localeCompare(b.branchName) || a.employeeId.localeCompare(b.employeeId),
  );

  const lines: string[] = [headers.map(escapeCsvCell).join(',')];
  for (const emp of sorted) {
    lines.push(buildEmployeeExportRowValues(emp, customCols).map(escapeCsvCell).join(','));
  }
  return `\uFEFF${lines.join('\n')}`;
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadEmployeeMasterCsvFile(
  employees: Employee[],
  extraCustomColumns: string[] = [],
  scopeLabel = 'All',
) {
  const csv = buildFullEmployeeMasterCsv(employees, extraCustomColumns);
  const dateStamp = getTodayIST();
  const safeScope = scopeLabel.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 32) || 'Master';
  triggerBlobDownload(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    `House_of_Muktai_Employee_Master_${safeScope}_${dateStamp}.csv`,
  );
}

/**
 * Downloads a styled multi-sheet Excel (.xlsx) Employee Master export with:
 * - Sheet 1: Complete Employee Master Directory (all 49 fields + custom columns)
 * - Sheet 2: Branch-wise HR & KYC/Bank Readiness Summary
 */
export async function downloadEmployeeMasterExcelFile(params: {
  employees: Employee[];
  branches: Branch[];
  extraCustomColumns?: string[];
  scopeLabel?: string;
}): Promise<void> {
  const { employees, branches, extraCustomColumns = [], scopeLabel = 'Master' } = params;
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'House of Muktai — Employee Master';
  wb.created = new Date();

  const customCols = resolveUniqueCustomColumns(employees, extraCustomColumns);
  const allHeaders = [...FULL_EMPLOYEE_EXPORT_HEADERS, ...customCols];
  const sorted = [...employees].sort(
    (a, b) => a.branchName.localeCompare(b.branchName) || a.employeeId.localeCompare(b.employeeId),
  );

  // Sheet 1: Complete Employee Master
  const ws = wb.addWorksheet('Employee Master', {
    views: [{ state: 'frozen', ySplit: 1, xSplit: 4 }],
  });

  const headerRow = ws.addRow(allHeaders);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F1F3D' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFB8923A' } },
    };
  });

  const salaryColIdx = FULL_EMPLOYEE_EXPORT_HEADERS.indexOf('Monthly Gross Salary (INR)') + 1;

  for (const emp of sorted) {
    const vals = buildEmployeeExportRowValues(emp, customCols);
    const row = ws.addRow(vals);
    row.font = { size: 10 };
    if (salaryColIdx > 0 && typeof vals[salaryColIdx - 1] === 'number') {
      row.getCell(salaryColIdx).numFmt = '#,##0.00';
    }
  }

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sorted.length + 1), column: allHeaders.length },
  };

  // Auto-size columns sensibly
  allHeaders.forEach((h, i) => {
    const col = ws.getColumn(i + 1);
    let maxLen = h.length + 3;
    if (h.includes('Address')) {
      maxLen = Math.max(maxLen, 28);
    } else if (h.includes('Name') || h.includes('Email') || h.includes('Branch')) {
      maxLen = Math.max(maxLen, 22);
    }
    col.width = Math.min(34, Math.max(14, maxLen));
  });

  // Sheet 2: Branch-wise Summary
  const summaryWs = wb.addWorksheet('Branch Summary', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const sumHeaders = [
    'Branch Name',
    'Total Staff',
    'Active',
    'Inactive',
    'Login Active',
    'Monthly Gross Payroll Est. (INR)',
  ];
  const sumHeaderRow = summaryWs.addRow(sumHeaders);
  sumHeaderRow.height = 24;
  sumHeaderRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F1F3D' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });

  const byBranch = new Map<string, Employee[]>();
  for (const b of branches) byBranch.set(b.branchName, []);
  for (const emp of sorted) {
    const list = byBranch.get(emp.branchName) || [];
    list.push(emp);
    byBranch.set(emp.branchName, list);
  }

  for (const [bName, list] of byBranch.entries()) {
    if (list.length === 0) continue;
    const active = list.filter((e) => e.status === 'ACTIVE').length;
    const inactive = list.length - active;
    let loginCount = 0;
    let salaryPaiseSum = 0;
    for (const e of list) {
      if (e.credentialsProvisioned) loginCount += 1;
      if (e.status === 'ACTIVE' && e.monthlyGrossSalaryPaise) {
        salaryPaiseSum += e.monthlyGrossSalaryPaise;
      }
    }
    const r = summaryWs.addRow([
      bName,
      list.length,
      active,
      inactive,
      loginCount,
      Number((salaryPaiseSum / 100).toFixed(2)),
    ]);
    r.getCell(6).numFmt = '#,##0.00';
  }

  sumHeaders.forEach((h, i) => {
    summaryWs.getColumn(i + 1).width = Math.max(16, h.length + 4);
  });

  const buf = await wb.xlsx.writeBuffer();
  const dateStamp = getTodayIST();
  const safeScope = scopeLabel.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 32) || 'Master';
  triggerBlobDownload(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `House_of_Muktai_Employee_Master_${safeScope}_${dateStamp}.xlsx`,
  );
}

/**
 * Downloads an official Excel (.xlsx) Import Template with Sheet 1 = Employee Master Import
 * and Sheet 2 = Valid Branches & Field Reference so HR can fill and re-upload cleanly.
 */
export async function downloadEmployeeMasterTemplateExcel(params: {
  branches: Branch[];
  employees: Employee[];
  mode: 'blank' | 'prefilled';
  extraCustomColumns?: string[];
  templateHeaders: readonly string[];
  sampleCsvLines: string;
}): Promise<void> {
  const { branches, employees, mode, extraCustomColumns = [], templateHeaders } = params;
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'House of Muktai — Employee Master';
  wb.created = new Date();

  const ws = wb.addWorksheet('Employee Import', {
    views: [{ state: 'frozen', ySplit: 1, xSplit: 4 }],
  });

  // Parse the exact CSV template produced by employeeBulkImportEngine so headers & order stay 100% single-source-of-truth
  const { parseCsvMatrix } = await import('./employeeBulkImportEngine');
  const matrix = parseCsvMatrix(params.sampleCsvLines);
  const headers = matrix[0] || [...templateHeaders, ...extraCustomColumns];

  const headerRow = ws.addRow(headers);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F1F3D' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });

  for (let i = 1; i < matrix.length; i += 1) {
    ws.addRow(matrix[i]);
  }
  headers.forEach((h, i) => {
    ws.getColumn(i + 1).width = Math.min(32, Math.max(15, h.length + 4));
  });

  // Sheet 2: Reference Guide
  const refWs = wb.addWorksheet('Valid Branches & Guide');
  const refHeader = refWs.addRow(['Branch Code', 'Official Branch Name', 'City']);
  refHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1F3D' } };
  });
  for (const b of branches) {
    refWs.addRow([b.branchCode, b.branchName, b.city || '']);
  }
  refWs.addRow([]);
  refWs.addRow(['Field Guidelines', 'Allowed / Recommended Format']);
  refWs.addRow(['Date of Birth / Joining / Exit', 'YYYY-MM-DD (e.g. 1996-05-14) or DD-MM-YYYY']);
  refWs.addRow(['Aadhaar Number', 'Auto-masked to XXXX-XXXX-1234 for privacy']);
  refWs.addRow(['Bank Account Number', 'Auto-masked to XXXX1234 for privacy']);
  refWs.addRow(['Monthly Gross Salary', 'Plain rupees number e.g. 18500']);
  refWs.getColumn(1).width = 28;
  refWs.getColumn(2).width = 48;
  refWs.getColumn(3).width = 20;

  const buf = await wb.xlsx.writeBuffer();
  triggerBlobDownload(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    mode === 'prefilled'
      ? `House_of_Muktai_Employee_Master_Current_${employees.length}.xlsx`
      : 'House_of_Muktai_Employee_Master_Import_Template.xlsx',
  );
}

/**
 * Exports a single employee's essential profile as a clean CSV dossier.
 */
export function downloadSingleEmployeeDossierCsv(emp: Employee) {
  const rows: Array<[string, string]> = [
    ['Field', 'Value'],
    ['Employee ID', emp.employeeId],
    ['Sale ID (POS Code)', emp.saleId || '—'],
    ['Login ID', emp.loginId],
    ['Full Name', emp.fullName],
    ['Status', emp.status],
    ['Branch', `${emp.branchName} (${emp.branchId})`],
    ['Department', emp.departmentName || 'Unassigned'],
    ['Designation', emp.designation],
    ['Mobile Number', emp.phone || '—'],
    ['Gender', emp.gender || '—'],
    ['Date of Birth', emp.dateOfBirth || '—'],
    ['Date of Joining', emp.dateOfJoining || '—'],
    ['Date of Exit', emp.dateOfExit || '—'],
    ['Residential Address', emp.address || '—'],
    ['Emergency Contact', emp.emergencyContact || '—'],
    ['Aadhaar (Masked)', emp.aadhaarMasked || '—'],
    ['PAN Number', emp.panNumber || '—'],
    ['UAN Number', emp.uanNumber || '—'],
    ['PF Account Number', emp.pfNumber || '—'],
    ['ESIC Number', emp.esicNumber || '—'],
    [
      'Monthly Gross Salary',
      emp.monthlyGrossSalaryPaise ? formatINRFromPaise(emp.monthlyGrossSalaryPaise) : '—',
    ],
    ['Bank Name', emp.bankName || '—'],
    ['Bank Account (Masked)', emp.bankAccountMasked || '—'],
    ['Bank IFSC', emp.bankIfsc || '—'],
    ['Linked Google Email', emp.linkedGoogleEmail || '—'],
    ['Branch Manager Access', emp.isBranchManager ? 'Yes (Read-Only Own Branch)' : 'No'],
  ];

  for (const [k, v] of Object.entries(emp.customFields || {})) {
    rows.push([`Custom: ${k}`, v]);
  }

  const csv = `\uFEFF${rows.map((r) => r.map(escapeCsvCell).join(',')).join('\n')}`;
  triggerBlobDownload(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    `Employee_Profile_${emp.employeeId}_${emp.fullName.replace(/[^a-zA-Z0-9]+/g, '_')}.csv`,
  );
}
