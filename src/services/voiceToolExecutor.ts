import { auth } from '../lib/firebase';
import { maskAadhaarNumber } from '../lib/employeeMasterExport';
import {
  formatINRFromPaise,
  formatMonthLabel,
  getCurrentMonthKeyIST,
  getTodayIST,
} from '../lib/format';
import {
  getLastDayOfMonth,
  normalizeBranchKey,
  resolveCanonicalBranchName,
  validateImportBatch,
} from '../lib/incentiveEngine';
import {
  OFFICIAL_DEPARTMENTS,
  resolveCanonicalDepartment,
} from '../lib/departmentLeaderboardEngine';
import {
  findBestMatchingSpreadsheetFile,
  refreshLinkedDirectoryHandle,
  type LinkedLocalFolderState,
} from '../lib/localFolderSync';
import {
  downloadEmployeeIncentiveSlipPdf,
  downloadEmployeeSalarySlipPdf,
} from '../lib/pdfGenerator';
import {
  buildWhatsAppDeepLink,
  buildWhatsAppSlipMessage,
  computeAttendanceOtAttritionAnalytics,
  computeBranchPnlAnalytics,
  computePerformanceStreaksAndRetention,
  normalizeIndianWhatsAppNumber,
} from '../lib/proAnalyticsEngine';
import type {
  VoiceActionCard,
  VoiceExecutiveBriefingCard,
  VoiceWhatsAppRecipientItem,
} from '../lib/voiceProHelpers';
import {
  detectSalaryHeaderRowIndex,
  extractRawSalaryRowsFromCsv,
  normalizeDateCellToIso,
  parseSalarySheetRows,
  type RawSalaryInputRow,
} from '../lib/salarySlipEngine';
import {
  downloadAttendanceOtAttritionXlsx,
  downloadBankNeftExportCsv,
  downloadBankNeftExportXlsx,
  downloadBranchEmployeeRosterXlsx,
  downloadBranchIncentiveReportXlsx,
  downloadBranchSalaryRegisterXlsx,
  downloadCompleteBranchReportPackXlsx,
  downloadDcrCashExportCsv,
  downloadDcrCashExportXlsx,
  downloadStatutoryComplianceCsv,
  downloadStatutoryComplianceXlsx,
} from './branchReportsExportService';
import { savePortalVisibilitySettings } from './departmentVisibilityService';
import {
  approveEmployeeBranchTransfer,
  approveImportBatch,
  deleteBranch,
  deleteEmployeeByOwner,
  deleteImportBatch,
  listBatchRows,
  publishApprovedBatch,
  purgeMonthRecords,
  rejectImportBatch,
  saveBranch,
  saveEmployee,
  stageValidatedBatch,
  updateEmployeeStatus,
} from './incentiveService';
import {
  createIncentiveAdjustment,
  deleteEmployeeQueryByOwner,
  deleteIncentiveAdjustmentByOwner,
  deletePayoutRecordByOwner,
  deleteSalesTarget,
  downloadManagementExcelReport,
  resolveEmployeeQuery,
  upsertPayoutRecord,
  upsertPayoutRecordsBatch,
  upsertSalesTarget,
  voidIncentiveAdjustment,
} from './operationsService';
import {
  createEmployeeLoan,
  deleteEmployeeLoan,
  downloadBulkSalarySlipsZip,
  isMonthPayrollLockedLocal,
  recordLoanEmiDeduction,
  toggleMonthPayrollLock,
} from './proFeaturesService';
import {
  deleteSalarySlip,
  deleteSalarySlipsBatch,
  moveSalarySlipsToMonthBatch,
  publishSalarySlipsBatch,
  updatePublishedSalarySlipByOwner,
  type OwnerSalarySlipEditInput,
} from './salarySlipService';
import type { AdminNavTab } from '../components/admin/AdminGlobalSearch';
import type {
  AdjustmentType,
  Branch,
  DepartmentId,
  Employee,
  EmployeeLoan,
  EmployeeQuery,
  ExcelColumnMapping,
  ExcelParseResponse,
  ImportBatch,
  IncentiveAdjustment,
  MonthlySummary,
  PaymentMode,
  PayrollLockSettings,
  PayoutRecord,
  PayoutStatus,
  PortalVisibilitySettings,
  PublishedIncentive,
  SalarySlip,
  SalarySlipPaymentMode,
  SalesTarget,
} from '../types/incentive';

export interface VoiceFilterCommand {
  version: number;
  targetTab: 'employees' | 'salary' | 'payouts' | 'history' | 'branch-reports';
  branchId?: string;
  department?: 'ALL' | 'UNASSIGNED' | 'NON_SALES' | DepartmentId;
  status?: string;
  monthKey?: string;
  searchQuery?: string;
  subTab?: string;
  clearFilters?: boolean;
}

export interface VoicePendingConfirmation {
  toolName: string;
  args: Record<string, unknown>;
  summaryMr: string;
}

export type VoiceRefreshScope =
  | 'employees'
  | 'branches'
  | 'adjustments'
  | 'payouts'
  | 'salary'
  | 'incentives'
  | 'targets'
  | 'loans'
  | 'queries'
  | 'visibility'
  | 'locks'
  | 'all';

export interface VoiceToolExecutionEnv {
  isMainOwner: boolean;
  branches: Branch[];
  employees: Employee[];
  batches: ImportBatch[];
  incentives: PublishedIncentive[];
  monthlySummaries: MonthlySummary[];
  payoutRecords: PayoutRecord[];
  adjustments: IncentiveAdjustment[];
  salesTargets: SalesTarget[];
  employeeQueries: EmployeeQuery[];
  salarySlips: SalarySlip[];
  employeeLoans: EmployeeLoan[];
  visibilitySettings: PortalVisibilitySettings;
  payrollLockSettings: PayrollLockSettings;
  linkedFolder: LinkedLocalFolderState;
  setLinkedFolder: (next: LinkedLocalFolderState) => void;
  navigateToTab: (tab: AdminNavTab) => void;
  openModal: (modal: 'search' | 'change_password') => void;
  applyVoiceFilter: (cmd: Omit<VoiceFilterCommand, 'version'>) => void;
  refreshAll: () => Promise<void>;
  refreshScope?: (scope: VoiceRefreshScope) => Promise<void>;
  onLiveStatus: (statusMr: string) => void;
  onPendingConfirmation: (pending: VoicePendingConfirmation | null) => void;
  onActionCard?: (card: VoiceActionCard | null) => void;
}

async function refreshFast(env: VoiceToolExecutionEnv, scope: VoiceRefreshScope): Promise<void> {
  if (env.refreshScope) {
    await env.refreshScope(scope);
  } else {
    await env.refreshAll();
  }
}

function asStr(val: unknown): string {
  return typeof val === 'string' ? val.trim() : typeof val === 'number' ? String(val) : '';
}

function asNum(val: unknown): number | undefined {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const n = Number(val.replace(/,/g, '').trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asBool(val: unknown): boolean | undefined {
  if (typeof val === 'boolean') return val;
  if (val === 'true') return true;
  if (val === 'false') return false;
  return undefined;
}

function normalizeMonthInput(raw?: string | null): string {
  const clean = (raw || '').trim();
  if (!clean) return getCurrentMonthKeyIST();
  if (/^\d{4}-\d{2}$/.test(clean)) return clean;

  const monthMap: Record<string, string> = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', sept: '09', september: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12',
  };
  const m1 = clean.toLowerCase().match(/([a-z]+)[\s\-_/]+(\d{4})/);
  if (m1 && monthMap[m1[1]]) {
    return `${m1[2]}-${monthMap[m1[1]]}`;
  }
  const m2 = clean.toLowerCase().match(/(\d{4})[\s\-_/]+([a-z]+)/);
  if (m2 && monthMap[m2[2]]) {
    return `${m2[1]}-${monthMap[m2[2]]}`;
  }
  return getCurrentMonthKeyIST();
}

const DEVANAGARI_DIGITS: Record<string, string> = {
  '०': '0',
  '१': '1',
  '२': '2',
  '३': '3',
  '४': '4',
  '५': '5',
  '६': '6',
  '७': '7',
  '८': '8',
  '९': '9',
};

const DEVANAGARI_VOWELS: Record<string, string> = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo',
  'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ॲ': 'a', 'ऑ': 'o',
};

const DEVANAGARI_MATRAS: Record<string, string> = {
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॅ': 'a', 'ॉ': 'o',
};

const DEVANAGARI_CONSONANTS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
};

export function transliterateDevanagariToLatin(input: string): string {
  if (!input) return '';
  let out = '';
  const chars = Array.from(input);
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (DEVANAGARI_DIGITS[ch]) {
      out += DEVANAGARI_DIGITS[ch];
      continue;
    }
    if (DEVANAGARI_VOWELS[ch]) {
      out += DEVANAGARI_VOWELS[ch];
      continue;
    }
    if (ch === 'ं' || ch === 'ँ') {
      out += 'n';
      continue;
    }
    if (ch === 'ः') {
      out += 'h';
      continue;
    }
    if (ch === '्' || ch === '़') {
      continue;
    }
    if (DEVANAGARI_MATRAS[ch]) {
      out += DEVANAGARI_MATRAS[ch];
      continue;
    }
    if (DEVANAGARI_CONSONANTS[ch]) {
      out += DEVANAGARI_CONSONANTS[ch];
      const next = chars[i + 1];
      const nextIsMatra = Boolean(next && DEVANAGARI_MATRAS[next]);
      const nextIsHalant = next === '्';
      const nextIsWordBoundary = !next || /[\s,.;:!?()\-_/0-9]/.test(next);
      // Marathi schwa deletion at word end; keep inherent 'a' mid-word before another consonant/anusvara
      if (!nextIsMatra && !nextIsHalant && !nextIsWordBoundary) {
        out += 'a';
      }
      continue;
    }
    out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function toMarathiPhoneticKey(word: string): string {
  const latin = transliterateDevanagariToLatin(word).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!latin) return '';
  return latin
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/aa/g, 'a')
    .replace(/w/g, 'v')
    .replace(/ph/g, 'f')
    .replace(/bh/g, 'b')
    .replace(/dh/g, 'd')
    .replace(/th/g, 't')
    .replace(/kh/g, 'k')
    .replace(/gh/g, 'g')
    .replace(/jh/g, 'j')
    .replace(/chh/g, 'ch')
    .replace(/sh/g, 's')
    .replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1');
}

function resolveBranchMatch(rawBranch: string, branches: Branch[]): Branch | null {
  const clean = transliterateDevanagariToLatin(rawBranch.trim());
  if (!clean || clean.toUpperCase() === 'ALL') return null;

  const upper = clean.toUpperCase();
  const exact = branches.find(
    (b) =>
      b.branchId.toUpperCase() === upper ||
      b.branchCode.toUpperCase() === upper ||
      b.branchName.toUpperCase() === upper,
  );
  if (exact) return exact;

  const canonical = resolveCanonicalBranchName(clean);
  const canonKey = normalizeBranchKey(canonical);
  const byCanon = branches.find(
    (b) =>
      normalizeBranchKey(b.branchName) === canonKey ||
      normalizeBranchKey(b.branchCode) === canonKey ||
      normalizeBranchKey(b.branchId) === canonKey,
  );
  if (byCanon) return byCanon;

  const compact = normalizeBranchKey(clean);
  const directPartial = branches.find(
    (b) =>
      normalizeBranchKey(b.branchName).includes(compact) ||
      compact.includes(normalizeBranchKey(b.branchName)) ||
      normalizeBranchKey(b.city || '').includes(compact),
  );
  if (directPartial) return directPartial;

  const phoneticTarget = toMarathiPhoneticKey(clean);
  if (!phoneticTarget) return null;
  return (
    branches.find((b) => {
      const bKey = toMarathiPhoneticKey(b.branchName);
      const cKey = toMarathiPhoneticKey(b.city || '');
      return (
        bKey === phoneticTarget ||
        bKey.includes(phoneticTarget) ||
        phoneticTarget.includes(bKey) ||
        (cKey.length > 0 && (cKey === phoneticTarget || cKey.includes(phoneticTarget)))
      );
    }) || null
  );
}

function resolveDepartmentSelection(rawDept: string): {
  departmentId: DepartmentId | '';
  departmentName: string;
} {
  const clean = rawDept.trim();
  if (!clean) return { departmentId: '', departmentName: '' };
  const canonical = resolveCanonicalDepartment(clean);
  if (canonical) {
    return { departmentId: canonical.id, departmentName: canonical.name };
  }
  // Common Marathi department names
  const lower = clean.toLowerCase();
  if (lower.includes('साडी') || lower.includes('sadi')) {
    return { departmentId: 'SAREE', departmentName: 'Saree Dept.' };
  }
  if (lower.includes('लेडीज') || lower.includes('महिला')) {
    return { departmentId: 'LADIES_WEAR', departmentName: 'Ladies Wear Dept.' };
  }
  if (lower.includes('किड्स') || lower.includes('लहान मुले')) {
    return { departmentId: 'KIDS_WEAR', departmentName: 'Kids Wear Dept.' };
  }
  if (lower.includes('मेन्स') || lower.includes('जेन्ट्स')) {
    return { departmentId: 'MENS_WEAR', departmentName: 'Mens Wear Dept.' };
  }
  if (lower.includes('नॉन') || lower.includes('होझिअरी')) {
    return { departmentId: 'NON_APPARELS', departmentName: 'Non Apparels Dept.' };
  }
  return { departmentId: '', departmentName: clean.slice(0, 80) };
}

export function findMatchingEmployees(
  identifier: string,
  employees: Employee[],
): { exact: Employee | null; matches: Employee[] } {
  const rawClean = identifier.trim();
  if (!rawClean) return { exact: null, matches: [] };
  const clean = transliterateDevanagariToLatin(rawClean);
  const upper = clean.toUpperCase();
  const strippedLeadingZeros = upper.replace(/^0+/, '') || upper;

  // 1. Exact Employee ID / Login ID / Sale ID
  const exactById = employees.find(
    (e) =>
      e.employeeId.toUpperCase() === upper ||
      e.loginId.toUpperCase() === upper ||
      (e.saleId && e.saleId.toUpperCase() === upper) ||
      e.employeeId.toUpperCase().replace(/^0+/, '') === strippedLeadingZeros,
  );
  if (exactById) return { exact: exactById, matches: [exactById] };

  // 2. Exact Full Name
  const exactByName = employees.filter((e) => e.fullName.trim().toUpperCase() === upper);
  if (exactByName.length === 1) return { exact: exactByName[0], matches: exactByName };
  if (exactByName.length > 1) return { exact: null, matches: exactByName };

  // 3. Partial / Token name search (Latin + transliterated Devanagari)
  const tokens = clean
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  const partial = employees.filter((e) => {
    const hay = `${e.employeeId} ${e.saleId || ''} ${e.loginId} ${e.fullName} ${e.branchName} ${e.phone || ''}`.toLowerCase();
    if (hay.includes(clean.toLowerCase())) return true;
    return tokens.length > 0 && tokens.every((t) => hay.includes(t));
  });

  if (partial.length === 1) return { exact: partial[0], matches: partial };
  if (partial.length > 1) return { exact: null, matches: partial.slice(0, 10) };

  // 4. Marathi phonetic token match (handles Shobha/Sobha, Londhe/Londe, V/W, EE/I, middle names)
  const phoneticTokens = tokens.map(toMarathiPhoneticKey).filter((t) => t.length >= 2);
  if (phoneticTokens.length > 0) {
    const phoneticMatches = employees.filter((e) => {
      const hayWords = `${e.fullName} ${e.branchName} ${e.employeeId}`
        .split(/\s+/)
        .map(toMarathiPhoneticKey)
        .filter(Boolean);
      const hayJoined = hayWords.join(' ');
      return phoneticTokens.every(
        (pt) => hayJoined.includes(pt) || hayWords.some((hw) => hw.startsWith(pt) || pt.startsWith(hw)),
      );
    });
    if (phoneticMatches.length === 1) return { exact: phoneticMatches[0], matches: phoneticMatches };
    if (phoneticMatches.length > 1) return { exact: null, matches: phoneticMatches.slice(0, 10) };
  }

  return { exact: null, matches: [] };
}

function summarizeEmployee(e: Employee) {
  return {
    employeeId: e.employeeId,
    saleId: e.saleId || '',
    loginId: e.loginId,
    fullName: e.fullName,
    branchId: e.branchId,
    branchName: e.branchName,
    departmentId: e.departmentId || '',
    departmentName: e.departmentName || '',
    designation: e.designation,
    phone: e.phone || '',
    status: e.status,
    baseSalary: e.customFields?.['Base Salary'] || '',
  };
}

function formatErrorForAssistant(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err || 'Unknown error');
  if (msg.toLowerCase().includes('permission-denied') || msg.toLowerCase().includes('insufficient permissions')) {
    return 'PERMISSION_DENIED: Firestore blocked this operation. Check if Main Owner login is required or if the month is payroll-locked.';
  }
  return msg.slice(0, 320);
}

async function readSpreadsheetRawRowsForSalary(file: File): Promise<{
  rawRows: RawSalaryInputRow[];
  headers: string[];
}> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv')) {
    const text = await file.text();
    const rawRows = extractRawSalaryRowsFromCsv(text);
    const headers = rawRows[0] ? Object.keys(rawRows[0].cells) : [];
    return { rawRows, headers };
  }

  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const buf = await file.arrayBuffer();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) {
    throw new Error('Excel workbook contains no worksheet.');
  }

  const matrix: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals: unknown[] = [];
    for (let c = 1; c <= row.cellCount; c += 1) {
      const cell = row.getCell(c);
      let v: unknown = cell.value;
      if (v && typeof v === 'object') {
        if ('result' in v) v = (v as { result: unknown }).result;
        else if ('richText' in v && Array.isArray((v as { richText: Array<{ text: string }> }).richText)) {
          v = (v as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join('');
        } else if ('text' in v) {
          v = (v as { text: string }).text;
        }
      }
      if (v instanceof Date) {
        v = normalizeDateCellToIso(v);
      }
      vals.push(v ?? '');
    }
    matrix.push(vals);
  });

  const headerIdx = detectSalaryHeaderRowIndex(matrix);
  const headerRow = (matrix[headerIdx] || []).map((cell, idx) => {
    const label = String(cell ?? '').trim();
    return label || `COL_${idx + 1}`;
  });

  const rawRows: RawSalaryInputRow[] = [];
  for (let r = headerIdx + 1; r < matrix.length; r += 1) {
    const rowVals = matrix[r] || [];
    const obj: Record<string, string | number | null> = {};
    let hasValue = false;
    for (let c = 0; c < headerRow.length; c += 1) {
      const val = rowVals[c];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        hasValue = true;
      }
      obj[headerRow[c]] =
        typeof val === 'number' || typeof val === 'string' ? val : val == null ? null : String(val);
    }
    if (hasValue) {
      rawRows.push({ rowNumber: r + 1, cells: obj });
    }
  }
  return { rawRows, headers: headerRow };
}

function looksLikeSalarySheet(fileName: string, headers: string[]): boolean {
  const lowerName = fileName.toLowerCase();
  if (
    lowerName.includes('salary') ||
    lowerName.includes('paysheet') ||
    lowerName.includes('payslip') ||
    lowerName.includes('payroll') ||
    lowerName.endsWith('.csv')
  ) {
    return true;
  }
  const joined = headers.join(' | ').toLowerCase();
  const salarySignals = ['basic', 'earn gross', 'net pay', 'total deduction', 'pf', 'esic', 'hra'];
  const matches = salarySignals.filter((sig) => joined.includes(sig)).length;
  return matches >= 2;
}

export async function executeVoiceToolCall(
  toolName: string,
  args: Record<string, unknown>,
  env: VoiceToolExecutionEnv,
): Promise<Record<string, unknown>> {
  try {
    // 1. NAVIGATE
    if (toolName === 'navigate_to_section') {
      const rawTab = asStr(args.tab).toLowerCase() as AdminNavTab;
      const modal = asStr(args.modal).toLowerCase();

      if (modal === 'search') {
        env.onLiveStatus('ग्लोबल सर्च उघडत आहे...');
        env.openModal('search');
        return { ok: true, modalOpened: 'search', directReplyMr: 'ग्लोबल सर्च उघडले आहे.' };
      }
      if (modal === 'change_password') {
        env.onLiveStatus('पासवर्ड बदलण्याची विंडो उघडत आहे...');
        env.openModal('change_password');
        return {
          ok: true,
          modalOpened: 'change_password',
          directReplyMr: 'पासवर्ड बदलण्याची विंडो उघडली आहे.',
        };
      }

      const validTabs: AdminNavTab[] = [
        'overview',
        'import',
        'employees',
        'branches',
        'payouts',
        'salary',
        'branch-reports',
        'analytics',
        'pro-suite',
        'history',
        'owner-access',
      ];
      if (!validTabs.includes(rawTab)) {
        return { ok: false, error: `Unknown section "${rawTab}". Valid tabs: ${validTabs.join(', ')}` };
      }
      if (rawTab === 'owner-access' && !env.isMainOwner) {
        return {
          ok: false,
          error: 'Main Owner login is required to open Owner Access & Rights.',
        };
      }
      const tabLabelsMr: Record<AdminNavTab, string> = {
        overview: 'ओव्हरव्ह्यू डॅशबोर्ड',
        import: 'एक्सेल इम्पोर्ट विभाग',
        employees: 'एम्प्लॉई मास्टर',
        branches: 'शाखा मास्टर',
        payouts: 'पेआउट्स आणि क्वेरीज',
        salary: 'सॅलरी स्लिप्स विभाग',
        'branch-reports': 'शाखा रिपोर्ट्स हब',
        analytics: 'अ‍ॅनालिटिक्स आणि टार्गेट्स',
        'pro-suite': 'प्रो एक्झिक्युटिव्ह सूट',
        history: 'इतिहास आणि रिपोर्ट्स',
        'owner-access': 'ओनर अ‍ॅक्सेस आणि अधिकार',
      };
      env.onLiveStatus(`${tabLabelsMr[rawTab]} उघडत आहे...`);
      env.navigateToTab(rawTab);
      return {
        ok: true,
        navigatedTo: rawTab,
        directReplyMr: `${tabLabelsMr[rawTab]} उघडला आहे.`,
      };
    }

    // 2. FILTER WORKSPACE
    if (toolName === 'filter_workspace') {
      const targetTab = (asStr(args.targetTab).toLowerCase() || 'employees') as VoiceFilterCommand['targetTab'];
      const clearFilters = asBool(args.clearFilters) === true;
      const branchRaw = asStr(args.branch);
      const deptRaw = asStr(args.department);
      const statusRaw = asStr(args.status).toUpperCase();
      const monthRaw = asStr(args.monthKey);
      const searchQuery = asStr(args.searchQuery);
      const subTab = asStr(args.subTab).toLowerCase();

      let resolvedBranchId: string | undefined;
      let resolvedBranchName = 'All Branches';
      if (branchRaw && branchRaw.toUpperCase() !== 'ALL') {
        const b = resolveBranchMatch(branchRaw, env.branches);
        if (!b) {
          return {
            ok: false,
            error: `Branch "${branchRaw}" not found.`,
            availableBranches: env.branches.map((br) => br.branchName),
          };
        }
        resolvedBranchId = b.branchId;
        resolvedBranchName = b.branchName;
      } else if (branchRaw.toUpperCase() === 'ALL') {
        resolvedBranchId = 'ALL';
      }

      let resolvedDept: VoiceFilterCommand['department'];
      if (deptRaw) {
        const up = deptRaw.toUpperCase();
        if (up === 'ALL' || up === 'UNASSIGNED' || up === 'NON_SALES') {
          resolvedDept = up;
        } else {
          const d = resolveDepartmentSelection(deptRaw);
          if (d.departmentId) {
            resolvedDept = d.departmentId;
          } else {
            // Non-sales custom department -> search query fallback
            resolvedDept = 'NON_SALES';
          }
        }
      }

      const monthKey = monthRaw
        ? monthRaw.toUpperCase() === 'ALL'
          ? 'ALL'
          : normalizeMonthInput(monthRaw)
        : undefined;

      env.onLiveStatus(clearFilters ? 'सर्व फिल्टर क्लिअर करत आहे...' : 'फिल्टर लागू करत आहे...');
      env.navigateToTab(targetTab);
      env.applyVoiceFilter({
        targetTab,
        branchId: clearFilters ? 'ALL' : resolvedBranchId,
        department: clearFilters ? 'ALL' : resolvedDept,
        status: clearFilters ? 'ALL' : statusRaw || undefined,
        monthKey: clearFilters ? 'ALL' : monthKey,
        searchQuery: clearFilters ? '' : searchQuery,
        subTab: subTab || undefined,
        clearFilters,
      });

      const filterSummaryParts: string[] = [];
      if (resolvedBranchId && resolvedBranchId !== 'ALL') filterSummaryParts.push(`शाखा ${resolvedBranchName}`);
      if (resolvedDept && resolvedDept !== 'ALL') filterSummaryParts.push(`डिपार्टमेंट ${deptRaw}`);
      if (statusRaw && statusRaw !== 'ALL') filterSummaryParts.push(`स्टेटस ${statusRaw}`);
      if (monthKey && monthKey !== 'ALL') filterSummaryParts.push(`महिना ${formatMonthLabel(monthKey)}`);
      if (searchQuery) filterSummaryParts.push(`शोध "${searchQuery}"`);

      return {
        ok: true,
        targetTab,
        clearFilters,
        applied: {
          branch: resolvedBranchName,
          department: resolvedDept || 'UNCHANGED',
          status: statusRaw || 'UNCHANGED',
          monthKey: monthKey || 'UNCHANGED',
          searchQuery,
        },
        directReplyMr: clearFilters
          ? 'सर्व फिल्टर क्लिअर केले आहेत.'
          : filterSummaryParts.length > 0
            ? `${filterSummaryParts.join(', ')} नुसार फिल्टर लागू केला आहे.`
            : 'फिल्टर लागू केला आहे.',
      };
    }

    // 3. SEARCH EMPLOYEES
    if (toolName === 'search_employees') {
      const q = asStr(args.query);
      const branchRaw = asStr(args.branch);
      const deptRaw = asStr(args.department);
      const statusRaw = asStr(args.status).toUpperCase();
      const openInUi = asBool(args.openInUi) === true;

      env.onLiveStatus(`कर्मचारी शोधत आहे${q ? ` (${q})` : ''}...`);

      let list = [...env.employees];
      let resolvedBranch: Branch | null = null;
      if (branchRaw && branchRaw.toUpperCase() !== 'ALL') {
        resolvedBranch = resolveBranchMatch(branchRaw, env.branches);
        if (!resolvedBranch) {
          return {
            ok: false,
            error: `Branch "${branchRaw}" not found.`,
            availableBranches: env.branches.map((b) => b.branchName),
          };
        }
        list = list.filter((e) => e.branchId === resolvedBranch!.branchId);
      }

      let resolvedDeptFilter: VoiceFilterCommand['department'] = 'ALL';
      if (deptRaw && deptRaw.toUpperCase() !== 'ALL') {
        const d = resolveDepartmentSelection(deptRaw);
        if (d.departmentId) {
          resolvedDeptFilter = d.departmentId;
          list = list.filter((e) => e.departmentId === d.departmentId);
        } else {
          list = list.filter((e) =>
            (e.departmentName || '').toLowerCase().includes(deptRaw.toLowerCase()),
          );
        }
      }

      if (statusRaw === 'ACTIVE' || statusRaw === 'INACTIVE') {
        list = list.filter((e) => e.status === statusRaw);
      }

      if (q) {
        const found = findMatchingEmployees(q, list);
        list = found.matches;
      }

      const effectiveUiSearch =
        list.length === 1 ? list[0].employeeId : transliterateDevanagariToLatin(q) || q;

      if (openInUi) {
        env.navigateToTab('employees');
        env.applyVoiceFilter({
          targetTab: 'employees',
          branchId: resolvedBranch?.branchId || 'ALL',
          department: resolvedDeptFilter,
          status: statusRaw || 'ALL',
          searchQuery: effectiveUiSearch,
        });
      }

      const enriched = list.slice(0, 12).map((e) => {
        const base = summarizeEmployee(e);
        const latestInc = env.monthlySummaries
          .filter((s) => s.employeeId === e.employeeId && s.sourceType !== 'NO_DATA')
          .sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0];
        const latestSlip = env.salarySlips
          .filter((s) => s.employeeId === e.employeeId)
          .sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0];
        return {
          ...base,
          dateOfJoining: e.dateOfJoining || '',
          latestIncentive: latestInc
            ? {
                month: formatMonthLabel(latestInc.monthKey),
                grossIncentive: formatINRFromPaise(latestInc.grandTotalPaise),
              }
            : null,
          latestSalarySlip: latestSlip
            ? {
                month: formatMonthLabel(latestSlip.monthKey),
                netSalary: formatINRFromPaise(latestSlip.netPayablePaise),
                paymentMode: latestSlip.paymentMode,
              }
            : null,
        };
      });

      return {
        ok: true,
        totalMatches: list.length,
        employees: enriched,
      };
    }

    // 4. ADD EMPLOYEE
    if (toolName === 'add_employee') {
      const empId = asStr(args.employeeId).toUpperCase();
      const fullName = asStr(args.fullName);
      const branchRaw = asStr(args.branch);

      if (!empId || !fullName || !branchRaw) {
        return {
          ok: false,
          error: 'Missing required details: employeeId, fullName, and branch are required to add a new employee.',
        };
      }

      const existing = env.employees.find(
        (e) => e.employeeId.trim().toUpperCase() === empId,
      );
      if (existing) {
        return {
          ok: false,
          error: `Employee ID ${empId} already exists (${existing.fullName}, ${existing.branchName}). Use update_employee if you want to edit them.`,
        };
      }

      const branch = resolveBranchMatch(branchRaw, env.branches);
      if (!branch) {
        return {
          ok: false,
          error: `Branch "${branchRaw}" not found.`,
          availableBranches: env.branches.map((b) => b.branchName),
        };
      }

      const dept = resolveDepartmentSelection(asStr(args.department));
      const baseSalary = asNum(args.baseSalaryRupees);
      const customFields: Record<string, string> = {};
      if (baseSalary !== undefined && baseSalary > 0) {
        customFields['Base Salary'] = String(Math.round(baseSalary));
      }

      env.onLiveStatus(`नवीन कर्मचारी ${empId} (${fullName}) जोडत आहे...`);
      const status = asStr(args.status).toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';

      const result = await saveEmployee({
        employeeId: empId,
        saleId: asStr(args.saleId),
        loginId: `HOM${empId.replace(/[^A-Z0-9]/g, '')}`,
        fullName,
        branchId: branch.branchId,
        branchName: branch.branchName,
        departmentId: dept.departmentId,
        departmentName: dept.departmentName,
        designation: asStr(args.designation) || 'Sales Executive',
        phone: asStr(args.phone),
        gender: asStr(args.gender),
        dateOfBirth: asStr(args.dateOfBirth),
        dateOfJoining: asStr(args.dateOfJoining),
        customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
        status,
        mustChangePassword: true,
      });

      await refreshFast(env, 'employees');
      env.navigateToTab('employees');
      env.applyVoiceFilter({ targetTab: 'employees', searchQuery: result.employee.employeeId });

      return {
        ok: true,
        employee: summarizeEmployee(result.employee),
        provisioningNote: result.provisioningNote || '',
        directReplyMr: `नवीन कर्मचारी क्रमांक ${result.employee.employeeId} (${result.employee.fullName}) शाखा ${result.employee.branchName} मध्ये यशस्वीरित्या जोडले आहेत.`,
      };
    }

    // 5. UPDATE EMPLOYEE
    if (toolName === 'update_employee') {
      const identifier = asStr(args.employeeIdentifier);
      if (!identifier) {
        return { ok: false, error: 'Please provide an Employee ID or Name to update.' };
      }

      const { exact, matches } = findMatchingEmployees(identifier, env.employees);
      if (!exact) {
        if (matches.length > 1) {
          return {
            ok: false,
            ambiguous: true,
            message: `Multiple employees matched "${identifier}". Ask user which Employee ID to update.`,
            matches: matches.slice(0, 6).map(summarizeEmployee),
          };
        }
        return {
          ok: false,
          error: `No employee found matching "${identifier}". Verify the employee number or name.`,
        };
      }

      const emp = exact;
      env.onLiveStatus(`Employee ${emp.employeeId} (${emp.fullName}) अपडेट करत आहे...`);

      const changesApplied: string[] = [];

      // Resolve target branch
      let targetBranchId = emp.branchId;
      let targetBranchName = emp.branchName;
      const branchRaw = asStr(args.branch);
      let branchChanged = false;
      if (branchRaw) {
        const resolved = resolveBranchMatch(branchRaw, env.branches);
        if (!resolved) {
          return {
            ok: false,
            error: `Branch "${branchRaw}" was not found.`,
            availableBranches: env.branches.map((b) => b.branchName),
          };
        }
        if (resolved.branchId !== emp.branchId) {
          targetBranchId = resolved.branchId;
          targetBranchName = resolved.branchName;
          branchChanged = true;
          changesApplied.push(`Branch -> ${targetBranchName}`);
        }
      }

      // Resolve department
      let nextDeptId: DepartmentId | '' | undefined = emp.departmentId;
      let nextDeptName: string | undefined = emp.departmentName;
      const deptRaw = asStr(args.department);
      if (deptRaw) {
        const resolvedDept = resolveDepartmentSelection(deptRaw);
        nextDeptId = resolvedDept.departmentId;
        nextDeptName = resolvedDept.departmentName;
        changesApplied.push(`Department -> ${resolvedDept.departmentName}`);
      }

      // Resolve status change (uses audited authorize-status-change API)
      const targetStatusRaw = asStr(args.status).toUpperCase();
      const statusChanged =
        (targetStatusRaw === 'ACTIVE' || targetStatusRaw === 'INACTIVE') &&
        targetStatusRaw !== emp.status;

      // Monthly Gross Salary (primary Employee Master field) + optional Date of Exit & masked Aadhaar
      const nextCustomFields: Record<string, string> = { ...(emp.customFields || {}) };
      const salaryRupees = asNum(args.monthlyGrossSalaryRupees) ?? asNum(args.baseSalaryRupees);
      let nextMonthlyGrossSalaryPaise = emp.monthlyGrossSalaryPaise;
      if (salaryRupees !== undefined && salaryRupees >= 0) {
        nextMonthlyGrossSalaryPaise = Math.round(salaryRupees * 100);
        changesApplied.push(`Monthly Gross Salary -> ₹${Math.round(salaryRupees)}`);
      }

      const rawDateOfExit = args.dateOfExit !== undefined ? asStr(args.dateOfExit) : undefined;
      const nextDateOfExit = rawDateOfExit !== undefined ? rawDateOfExit : emp.dateOfExit;
      if (rawDateOfExit !== undefined && rawDateOfExit !== (emp.dateOfExit || '')) {
        changesApplied.push(`Date of Exit -> ${rawDateOfExit || 'Cleared'}`);
      }

      const rawAadhaar = args.aadhaarNumber !== undefined ? asStr(args.aadhaarNumber) : undefined;
      const nextAadhaarMasked =
        rawAadhaar !== undefined ? (rawAadhaar ? maskAadhaarNumber(rawAadhaar) : '') : emp.aadhaarMasked;
      if (rawAadhaar !== undefined && nextAadhaarMasked !== (emp.aadhaarMasked || '')) {
        changesApplied.push(`Aadhaar -> ${nextAadhaarMasked || 'Cleared'}`);
      }

      // Perform branch transfer first if branch changed (consolidates prior branch incentives!)
      if (branchChanged) {
        await approveEmployeeBranchTransfer({
          employee: emp,
          newBranchId: targetBranchId,
          newBranchName: targetBranchName,
          reason: asStr(args.reason) || 'Updated via Marathi Voice Assistant',
          consolidatePreviousBranchIncentives: true,
          allEmployees: env.employees,
        });
      }

      // Save all other profile fields
      const hasProfileFieldUpdates = [
        'fullName',
        'department',
        'designation',
        'phone',
        'saleId',
        'gender',
        'category',
        'dateOfBirth',
        'dateOfJoining',
        'dateOfExit',
        'aadhaarNumber',
        'panNumber',
        'uanNumber',
        'pfNumber',
        'esicNumber',
        'bankName',
        'bankAccount',
        'bankIfsc',
        'address',
        'emergencyContact',
        'monthlyGrossSalaryRupees',
        'baseSalaryRupees',
        'isBranchManager',
      ].some((k) => args[k] !== undefined && args[k] !== '');

      if (hasProfileFieldUpdates || !branchChanged) {
        const updatedExisting: Employee = {
          ...emp,
          branchId: targetBranchId,
          branchName: targetBranchName,
        };
        await saveEmployee({
          existing: updatedExisting,
          employeeId: emp.employeeId,
          loginId: emp.loginId,
          fullName: asStr(args.fullName) || emp.fullName,
          branchId: targetBranchId,
          branchName: targetBranchName,
          departmentId: nextDeptId,
          departmentName: nextDeptName,
          designation: asStr(args.designation) || emp.designation,
          saleId: args.saleId !== undefined ? asStr(args.saleId) : emp.saleId,
          phone: args.phone !== undefined ? asStr(args.phone) : emp.phone,
          gender: args.gender !== undefined ? asStr(args.gender) : emp.gender,
          category: args.category !== undefined ? asStr(args.category) : emp.category,
          dateOfBirth: args.dateOfBirth !== undefined ? asStr(args.dateOfBirth) : emp.dateOfBirth,
          dateOfJoining: args.dateOfJoining !== undefined ? asStr(args.dateOfJoining) : emp.dateOfJoining,
          dateOfExit: nextDateOfExit,
          aadhaarMasked: nextAadhaarMasked,
          monthlyGrossSalaryPaise: nextMonthlyGrossSalaryPaise,
          panNumber: args.panNumber !== undefined ? asStr(args.panNumber) : emp.panNumber,
          uanNumber: args.uanNumber !== undefined ? asStr(args.uanNumber) : emp.uanNumber,
          pfNumber: args.pfNumber !== undefined ? asStr(args.pfNumber) : emp.pfNumber,
          esicNumber: args.esicNumber !== undefined ? asStr(args.esicNumber) : emp.esicNumber,
          bankName: args.bankName !== undefined ? asStr(args.bankName) : emp.bankName,
          bankAccountMasked:
            args.bankAccount !== undefined ? asStr(args.bankAccount) : emp.bankAccountMasked,
          bankIfsc: args.bankIfsc !== undefined ? asStr(args.bankIfsc) : emp.bankIfsc,
          address: args.address !== undefined ? asStr(args.address) : emp.address,
          emergencyContact:
            args.emergencyContact !== undefined
              ? asStr(args.emergencyContact)
              : emp.emergencyContact,
          isBranchManager:
            args.isBranchManager !== undefined ? asBool(args.isBranchManager) : emp.isBranchManager,
          customFields: nextCustomFields,
          status: emp.status,
          mustChangePassword: emp.mustChangePassword,
        });
      }

      if (statusChanged) {
        await updateEmployeeStatus({
          employee: { ...emp, branchId: targetBranchId, branchName: targetBranchName },
          targetStatus: targetStatusRaw as 'ACTIVE' | 'INACTIVE',
          reason: asStr(args.reason) || 'Updated via Marathi Voice Assistant',
        });
        changesApplied.push(`Status -> ${targetStatusRaw}`);
      }

      await refreshFast(env, 'employees');
      env.navigateToTab('employees');
      env.applyVoiceFilter({ targetTab: 'employees', searchQuery: emp.employeeId });

      const detailBits: string[] = [];
      if (deptRaw && nextDeptName) detailBits.push(`डिपार्टमेंट ${nextDeptName}`);
      if (branchChanged) detailBits.push(`शाखा ${targetBranchName}`);
      if (args.designation) detailBits.push(`पद ${asStr(args.designation)}`);
      if (salaryRupees !== undefined) detailBits.push(`मासिक पगार ₹${Math.round(salaryRupees)}`);
      if (rawDateOfExit !== undefined) detailBits.push(`एक्झिट तारीख ${rawDateOfExit || 'काढली'}`);
      if (rawAadhaar !== undefined) detailBits.push('आधार क्रमांक');
      if (statusChanged) detailBits.push(`स्टेटस ${targetStatusRaw}`);
      if (args.phone !== undefined) detailBits.push('मोबाईल नंबर');
      const updatedName = asStr(args.fullName) || emp.fullName;

      return {
        ok: true,
        employeeId: emp.employeeId,
        fullName: updatedName,
        branchName: targetBranchName,
        departmentName: nextDeptName || '',
        changesApplied,
        directReplyMr:
          detailBits.length > 0
            ? `कर्मचारी क्रमांक ${emp.employeeId} (${updatedName}) यांचे ${detailBits.join(' आणि ')} अपडेट करून सेव्ह केले आहे.`
            : `कर्मचारी क्रमांक ${emp.employeeId} (${updatedName}) यांची माहिती अपडेट करून सेव्ह केली आहे.`,
      };
    }

    // 6. DELETE EMPLOYEE (DESTRUCTIVE LOCK + MAIN OWNER ONLY)
    if (toolName === 'delete_employee') {
      if (!env.isMainOwner) {
        return {
          ok: false,
          error: 'Only the Main Owner can permanently delete an employee. Super Admin can deactivate (INACTIVE) instead.',
        };
      }
      const identifier = asStr(args.employeeIdentifier);
      const { exact, matches } = findMatchingEmployees(identifier, env.employees);
      if (!exact) {
        if (matches.length > 1) {
          return {
            ok: false,
            ambiguous: true,
            matches: matches.slice(0, 6).map(summarizeEmployee),
          };
        }
        return { ok: false, error: `No employee found matching "${identifier}".` };
      }

      if (asBool(args.confirmed) !== true) {
        const summaryMr = `कर्मचारी क्रमांक ${exact.employeeId} (${exact.fullName}, शाखा: ${exact.branchName}) कायमस्वरूपी डिलीट करायचा का?`;
        env.onPendingConfirmation({
          toolName: 'delete_employee',
          args: { ...args, employeeIdentifier: exact.employeeId, confirmed: true },
          summaryMr,
        });
        return {
          ok: false,
          requiresConfirmation: true,
          employee: summarizeEmployee(exact),
          directReplyMr: `${summaryMr} कृपया 'हो' किंवा 'नाही' म्हणा.`,
          instruction: 'Ask the user for explicit Marathi confirmation ("हो" किंवा "नाही") before deleting.',
        };
      }

      env.onPendingConfirmation(null);
      env.onLiveStatus(`कर्मचारी ${exact.employeeId} डिलीट करत आहे...`);
      await deleteEmployeeByOwner(
        exact,
        asStr(args.reason) || 'Deleted via Marathi Voice Assistant (Owner Confirmed)',
      );
      await refreshFast(env, 'employees');
      return {
        ok: true,
        deletedEmployee: summarizeEmployee(exact),
        directReplyMr: `कर्मचारी क्रमांक ${exact.employeeId} (${exact.fullName}) कायमचे डिलीट केले आहेत.`,
      };
    }

    // 7. MANAGE INCENTIVE ADJUSTMENTS (BONUS / DEDUCTION / ADVANCE / RETURN_ADJUSTMENT)
    if (toolName === 'manage_incentive_adjustment') {
      const action = asStr(args.action).toUpperCase();
      const monthKey = normalizeMonthInput(asStr(args.monthKey));

      if (action === 'ADD') {
        const { exact, matches } = findMatchingEmployees(asStr(args.employeeIdentifier), env.employees);
        if (!exact) {
          return matches.length > 1
            ? { ok: false, ambiguous: true, matches: matches.slice(0, 6).map(summarizeEmployee) }
            : { ok: false, error: 'Target employee not found.' };
        }
        const amount = asNum(args.amountRupees);
        if (!amount || amount <= 0) {
          return { ok: false, error: 'Please specify a valid amount greater than ₹0.' };
        }
        const rawType = asStr(args.adjustmentType).toUpperCase();
        const type: AdjustmentType =
          rawType === 'DEDUCTION' || rawType === 'ADVANCE' || rawType === 'RETURN_ADJUSTMENT'
            ? rawType
            : 'BONUS';
        const reason = asStr(args.reason) || `${type} updated via Voice Assistant`;

        env.onLiveStatus(`${exact.fullName} साठी ₹${amount} ${type} सेव्ह करत आहे...`);
        const created = await createIncentiveAdjustment({
          monthKey,
          employeeId: exact.employeeId,
          authUid: exact.authUid || '',
          employeeName: exact.fullName,
          branchId: exact.branchId,
          branchName: exact.branchName,
          type,
          amountPaise: Math.round(amount * 100),
          reason,
        });
        await refreshFast(env, 'adjustments');
        env.navigateToTab('payouts');
        env.applyVoiceFilter({
          targetTab: 'payouts',
          subTab: 'adjustments',
          monthKey,
          searchQuery: exact.employeeId,
        });
        return {
          ok: true,
          adjustmentId: created.adjustmentId,
          employeeId: exact.employeeId,
          employeeName: exact.fullName,
          monthKey,
          type,
          amountRupees: amount,
          directReplyMr: `${exact.fullName} यांच्यासाठी ${formatMonthLabel(monthKey)} मध्ये ₹${amount} चे ${type} अ‍ॅडजस्टमेंट सेव्ह केले आहे.`,
        };
      }

      if (action === 'BULK_ADD') {
        const amount = asNum(args.amountRupees);
        if (!amount || amount <= 0) {
          return { ok: false, error: 'Please specify a valid amount greater than ₹0.' };
        }
        const branchRaw = asStr(args.branch);
        const deptRaw = asStr(args.department);
        let targetEmps = env.employees.filter((e) => e.status === 'ACTIVE');
        if (branchRaw && branchRaw.toUpperCase() !== 'ALL') {
          const b = resolveBranchMatch(branchRaw, env.branches);
          if (!b) return { ok: false, error: `Branch "${branchRaw}" not found.` };
          targetEmps = targetEmps.filter((e) => e.branchId === b.branchId);
        }
        if (deptRaw && deptRaw.toUpperCase() !== 'ALL') {
          const d = resolveDepartmentSelection(deptRaw);
          targetEmps = d.departmentId
            ? targetEmps.filter((e) => e.departmentId === d.departmentId)
            : targetEmps.filter((e) =>
                (e.departmentName || '').toLowerCase().includes(deptRaw.toLowerCase()),
              );
        }
        if (targetEmps.length === 0) {
          return { ok: false, error: 'No active employees matched the specified branch/department.' };
        }
        const rawType = asStr(args.adjustmentType).toUpperCase();
        const type: AdjustmentType =
          rawType === 'DEDUCTION' || rawType === 'ADVANCE' || rawType === 'RETURN_ADJUSTMENT'
            ? rawType
            : 'BONUS';
        const reason = asStr(args.reason) || `Bulk ${type} via Voice Assistant`;

        env.onLiveStatus(`${targetEmps.length} कर्मचाऱ्यांसाठी बल्क ${type} सेव्ह करत आहे...`);
        for (const emp of targetEmps) {
          await createIncentiveAdjustment({
            monthKey,
            employeeId: emp.employeeId,
            authUid: emp.authUid || '',
            employeeName: emp.fullName,
            branchId: emp.branchId,
            branchName: emp.branchName,
            type,
            amountPaise: Math.round(amount * 100),
            reason,
          });
        }
        await refreshFast(env, 'adjustments');
        env.navigateToTab('payouts');
        env.applyVoiceFilter({ targetTab: 'payouts', subTab: 'adjustments', monthKey });
        return {
          ok: true,
          updatedCount: targetEmps.length,
          monthKey,
          type,
          amountRupees: amount,
          directReplyMr: `${targetEmps.length} कर्मचाऱ्यांसाठी ₹${amount} चे ${type} यशस्वीरित्या सेव्ह केले आहे.`,
        };
      }

      if (action === 'VOID' || action === 'DELETE') {
        const adjId = asStr(args.adjustmentId);
        const empIdent = asStr(args.employeeIdentifier);
        let targetAdj = adjId
          ? env.adjustments.find((a) => a.adjustmentId === adjId)
          : undefined;
        if (!targetAdj && empIdent) {
          const { exact } = findMatchingEmployees(empIdent, env.employees);
          if (exact) {
            targetAdj = env.adjustments.find(
              (a) =>
                a.employeeId === exact.employeeId &&
                a.monthKey === monthKey &&
                (action === 'DELETE' || a.status === 'ACTIVE'),
            );
          }
        }
        if (!targetAdj) {
          return { ok: false, error: 'Matching incentive adjustment not found for that month.' };
        }

        if (action === 'VOID') {
          env.onLiveStatus('इन्सेंटिव्ह अ‍ॅडजस्टमेंट रद्द (Void) करत आहे...');
          await voidIncentiveAdjustment(targetAdj.adjustmentId);
          await env.refreshAll();
          return { ok: true, voidedAdjustmentId: targetAdj.adjustmentId };
        }

        if (asBool(args.confirmed) !== true) {
          env.onPendingConfirmation({
            toolName: 'manage_incentive_adjustment',
            args: { ...args, adjustmentId: targetAdj.adjustmentId, confirmed: true },
            summaryMr: `${targetAdj.employeeName} यांचे ₹${(targetAdj.amountPaise / 100).toFixed(0)} (${targetAdj.type}) अ‍ॅडजस्टमेंट कायमचे डिलीट करायचे का?`,
          });
          return { ok: false, requiresConfirmation: true, adjustment: targetAdj };
        }
        env.onPendingConfirmation(null);
        env.onLiveStatus('अ‍ॅडजस्टमेंट कायमचे डिलीट करत आहे...');
        await deleteIncentiveAdjustmentByOwner(targetAdj);
        await env.refreshAll();
        return { ok: true, deletedAdjustmentId: targetAdj.adjustmentId };
      }

      return { ok: false, error: `Unsupported adjustment action "${action}".` };
    }

    // 8. MANAGE PAYOUT STATUS
    if (toolName === 'manage_payout_status') {
      const action = asStr(args.action).toUpperCase();
      const monthKey = normalizeMonthInput(asStr(args.monthKey));
      const statusRaw = asStr(args.status).toUpperCase();
      const status: PayoutStatus =
        statusRaw === 'PAID' || statusRaw === 'APPROVED' || statusRaw === 'UNPAID'
          ? statusRaw
          : 'PAID';
      const modeRaw = asStr(args.paymentMode).toUpperCase();
      const paymentMode: PaymentMode =
        modeRaw === 'CASH' || modeRaw === 'UPI' ? modeRaw : 'BANK';

      if (action === 'SET_STATUS') {
        const { exact, matches } = findMatchingEmployees(asStr(args.employeeIdentifier), env.employees);
        if (!exact) {
          return matches.length > 1
            ? { ok: false, ambiguous: true, matches: matches.slice(0, 6).map(summarizeEmployee) }
            : { ok: false, error: 'Employee not found.' };
        }
        const summary = env.monthlySummaries.find(
          (s) => s.employeeId === exact.employeeId && s.monthKey === monthKey,
        );
        const gross = summary?.grandTotalPaise || 0;
        const adjNet = env.adjustments
          .filter((a) => a.employeeId === exact.employeeId && a.monthKey === monthKey && a.status === 'ACTIVE')
          .reduce((acc, a) => acc + (a.type === 'BONUS' ? a.amountPaise : -a.amountPaise), 0);

        env.onLiveStatus(`${exact.fullName} चे पेआउट ${status} करत आहे...`);
        const saved = await upsertPayoutRecord({
          monthKey,
          employeeId: exact.employeeId,
          authUid: exact.authUid || '',
          employeeName: exact.fullName,
          branchId: exact.branchId,
          branchName: exact.branchName,
          grossIncentivePaise: gross,
          adjustmentsNetPaise: adjNet,
          status,
          paymentMode,
          paymentReference: asStr(args.paymentReference),
          remarks: asStr(args.remarks),
        });
        await refreshFast(env, 'payouts');
        env.navigateToTab('payouts');
        env.applyVoiceFilter({ targetTab: 'payouts', subTab: 'payouts', monthKey, searchQuery: exact.employeeId });
        return {
          ok: true,
          payoutId: saved.payoutId,
          employeeName: exact.fullName,
          status: saved.status,
          netPayable: formatINRFromPaise(saved.netPayablePaise),
          directReplyMr: `${exact.fullName} यांचे ${formatMonthLabel(monthKey)} चे पेआउट ${saved.status} करून सेव्ह केले आहे.`,
        };
      }

      if (action === 'BULK_SET_STATUS') {
        const branchRaw = asStr(args.branch);
        const deptRaw = asStr(args.department);
        const branch = branchRaw && branchRaw.toUpperCase() !== 'ALL'
          ? resolveBranchMatch(branchRaw, env.branches)
          : null;
        if (branchRaw && branchRaw.toUpperCase() !== 'ALL' && !branch) {
          return { ok: false, error: `Branch "${branchRaw}" not found.` };
        }
        const resolvedDept =
          deptRaw && deptRaw.toUpperCase() !== 'ALL' ? resolveDepartmentSelection(deptRaw) : null;
        const empMap = new Map(env.employees.map((e) => [e.employeeId.toUpperCase(), e]));

        const targetSummaries = env.monthlySummaries.filter((s) => {
          if (s.monthKey !== monthKey || s.sourceType === 'NO_DATA') return false;
          if (branch && s.branchId !== branch.branchId) return false;
          if (resolvedDept && (resolvedDept.departmentId || resolvedDept.departmentName)) {
            const emp = empMap.get(s.employeeId.toUpperCase());
            if (!emp) return false;
            if (resolvedDept.departmentId) {
              return emp.departmentId === resolvedDept.departmentId;
            }
            return (emp.departmentName || '')
              .toLowerCase()
              .includes(resolvedDept.departmentName.toLowerCase());
          }
          return true;
        });
        if (targetSummaries.length === 0) {
          return {
            ok: false,
            error: `No published incentive summaries found for ${monthKey}${branch ? ` in ${branch.branchName}` : ''}${resolvedDept?.departmentName ? ` (${resolvedDept.departmentName})` : ''}.`,
          };
        }

        const items = targetSummaries.map((s) => {
          const emp = empMap.get(s.employeeId.toUpperCase());
          const adjNet = env.adjustments
            .filter((a) => a.employeeId === s.employeeId && a.monthKey === monthKey && a.status === 'ACTIVE')
            .reduce((acc, a) => acc + (a.type === 'BONUS' ? a.amountPaise : -a.amountPaise), 0);
          return {
            monthKey,
            employeeId: s.employeeId,
            authUid: emp?.authUid || s.authUid || '',
            employeeName: emp?.fullName || s.employeeName,
            branchId: emp?.branchId || s.branchId,
            branchName: emp?.branchName || s.branchName,
            grossIncentivePaise: s.grandTotalPaise,
            adjustmentsNetPaise: adjNet,
            status,
            paymentMode,
            paymentReference: asStr(args.paymentReference),
            remarks: asStr(args.remarks) || 'Bulk updated via Voice Assistant',
          };
        });

        const scopeLabel = [branch?.branchName, resolvedDept?.departmentName]
          .filter(Boolean)
          .join(' · ');
        env.onLiveStatus(
          `${scopeLabel ? `${scopeLabel} मधील ` : ''}${items.length} कर्मचाऱ्यांचे पेआउट ${status} करत आहे...`,
        );
        await upsertPayoutRecordsBatch({
          monthKey,
          items,
          paymentMode,
          paymentReference: asStr(args.paymentReference),
        });
        await refreshFast(env, 'payouts');
        env.navigateToTab('payouts');
        env.applyVoiceFilter({
          targetTab: 'payouts',
          subTab: 'payouts',
          monthKey,
          branchId: branch?.branchId || 'ALL',
        });
        return {
          ok: true,
          updatedCount: items.length,
          monthKey,
          status,
          branch: branch?.branchName || 'All Branches',
          department: resolvedDept?.departmentName || 'All Departments',
          directReplyMr: `${scopeLabel ? `${scopeLabel} मधील ` : 'सर्व शाखांमधील '}${items.length} कर्मचाऱ्यांचे ${formatMonthLabel(monthKey)} चे पेआउट ${status} केले आहे.`,
        };
      }

      if (action === 'DELETE') {
        const { exact } = findMatchingEmployees(asStr(args.employeeIdentifier), env.employees);
        if (!exact) return { ok: false, error: 'Employee not found.' };
        const rec = env.payoutRecords.find(
          (p) => p.employeeId === exact.employeeId && p.monthKey === monthKey,
        );
        if (!rec) return { ok: false, error: `No payout record found for ${exact.fullName} in ${monthKey}.` };
        if (asBool(args.confirmed) !== true) {
          env.onPendingConfirmation({
            toolName: 'manage_payout_status',
            args: { ...args, employeeIdentifier: exact.employeeId, confirmed: true },
            summaryMr: `${exact.fullName} यांचे ${formatMonthLabel(monthKey)} चे पेआउट रेकॉर्ड डिलीट करून UNPAID करायचे का?`,
          });
          return { ok: false, requiresConfirmation: true, payout: rec };
        }
        env.onPendingConfirmation(null);
        env.onLiveStatus('पेआउट रेकॉर्ड डिलीट करत आहे...');
        await deletePayoutRecordByOwner(rec);
        await env.refreshAll();
        return { ok: true, deletedPayoutId: rec.payoutId };
      }

      return { ok: false, error: `Unknown payout action "${action}".` };
    }

    // 9. MANAGE SALARY SLIP (EDIT / MOVE MONTH / DELETE)
    if (toolName === 'manage_salary_slip') {
      const action = asStr(args.action).toUpperCase();
      const monthKey = normalizeMonthInput(asStr(args.monthKey));

      if (action === 'DELETE_MONTH' && !env.isMainOwner) {
        return {
          ok: false,
          error: 'Only Main Owner can bulk-delete all salary slips for an entire month.',
        };
      }
      if (isMonthPayrollLockedLocal(monthKey, env.payrollLockSettings)) {
        return {
          ok: false,
          error: `${formatMonthLabel(monthKey)} is Payroll-Locked. Unlock the month first before editing or deleting salary slips.`,
        };
      }

      if (action === 'EDIT') {
        const { exact, matches } = findMatchingEmployees(asStr(args.employeeIdentifier), env.employees);
        if (!exact) {
          return matches.length > 1
            ? { ok: false, ambiguous: true, matches: matches.slice(0, 6).map(summarizeEmployee) }
            : { ok: false, error: 'Employee not found.' };
        }
        const slip = env.salarySlips.find(
          (s) => s.employeeId === exact.employeeId && s.monthKey === monthKey,
        );
        if (!slip) {
          return {
            ok: false,
            error: `No published salary slip found for ${exact.fullName} (${exact.employeeId}) in ${formatMonthLabel(monthKey)}.`,
          };
        }

        const toPaiseOr = (v: unknown, fallback: number): number => {
          const n = asNum(v);
          return n !== undefined && n >= 0 ? Math.round(n * 100) : fallback;
        };
        const pm = asStr(args.paymentMode).toUpperCase();
        const paymentMode: SalarySlipPaymentMode =
          pm === 'BANK' || pm === 'CASH' || pm === 'UPI' || pm === 'CHEQUE'
            ? (pm as SalarySlipPaymentMode)
            : slip.paymentMode || 'BANK';

        const patch: OwnerSalarySlipEditInput = {
          totalDays: slip.totalDays,
          presentDays: slip.presentDays ?? slip.paidDays,
          paidDays: asNum(args.paidDays) ?? slip.paidDays,
          lopDays: asNum(args.lopDays) ?? slip.lopDays,
          weeklyOffDays: slip.weeklyOffDays ?? 0,
          paidLeaveDays: slip.paidLeaveDays ?? 0,
          overtimeDays: slip.overtimeDays ?? 0,
          overtimeHours: slip.overtimeHours ?? 0,
          basicPaise: toPaiseOr(args.basicRupees, slip.basicPaise),
          dearnessAllowancePaise: slip.dearnessAllowancePaise ?? 0,
          hraPaise: toPaiseOr(args.hraRupees, slip.hraPaise),
          attendanceAllowancePaise: slip.attendanceAllowancePaise ?? 0,
          washingAllowancePaise: slip.washingAllowancePaise ?? 0,
          conveyancePaise: toPaiseOr(args.conveyanceRupees, slip.conveyancePaise),
          medicalAllowancePaise: slip.medicalAllowancePaise ?? 0,
          leaveTravelAllowancePaise: slip.leaveTravelAllowancePaise ?? 0,
          communicationExpensesPaise: slip.communicationExpensesPaise ?? 0,
          healthClubAllowancePaise: slip.healthClubAllowancePaise ?? 0,
          adhocAllowancePaise: slip.adhocAllowancePaise ?? 0,
          travelingAllowancePaise: slip.travelingAllowancePaise ?? 0,
          salesCommissionPaise: toPaiseOr(args.salesCommissionRupees, slip.salesCommissionPaise ?? 0),
          specialAllowancePaise: slip.specialAllowancePaise ?? 0,
          overtimePaise: toPaiseOr(args.overtimeRupees, slip.overtimePaise),
          incentivePaise: toPaiseOr(args.incentiveRupees, slip.incentivePaise),
          arrearsPaise: slip.arrearsPaise ?? 0,
          otherEarningsPaise: toPaiseOr(args.otherEarningsRupees, slip.otherEarningsPaise),
          pfPaise: toPaiseOr(args.pfRupees, slip.pfPaise),
          esicPaise: toPaiseOr(args.esicRupees, slip.esicPaise),
          ptPaise: toPaiseOr(args.ptRupees, slip.ptPaise),
          lwfPaise: slip.lwfPaise ?? 0,
          advanceRecoveryPaise: toPaiseOr(args.advanceRecoveryRupees, slip.advanceRecoveryPaise),
          tdsPaise: slip.tdsPaise,
          penaltyPaise: slip.penaltyPaise ?? 0,
          insurancePaise: slip.insurancePaise ?? 0,
          otherDeductionPaise: toPaiseOr(args.otherDeductionRupees, slip.otherDeductionPaise),
          paymentMode,
          paymentReference:
            args.paymentReference !== undefined ? asStr(args.paymentReference) : slip.paymentReference || '',
          paymentDate: slip.paymentDate || '',
          remarks: args.remarks !== undefined ? asStr(args.remarks) : slip.remarks || '',
        };

        env.onLiveStatus(`${exact.fullName} ची सॅलरी स्लिप अपडेट करत आहे...`);
        const updated = await updatePublishedSalarySlipByOwner(slip, patch);
        await refreshFast(env, 'salary');
        env.navigateToTab('salary');
        env.applyVoiceFilter({ targetTab: 'salary', monthKey, searchQuery: exact.employeeId });
        return {
          ok: true,
          slipId: updated.slipId,
          employeeName: updated.employeeName,
          gross: formatINRFromPaise(updated.grossEarningsPaise),
          deductions: formatINRFromPaise(updated.totalDeductionsPaise),
          netPayable: formatINRFromPaise(updated.netPayablePaise),
          directReplyMr: `${updated.employeeName} यांची ${formatMonthLabel(monthKey)} ची सॅलरी स्लिप अपडेट केली आहे. नवीन निव्वळ पगार ${formatINRFromPaise(updated.netPayablePaise)} आहे.`,
        };
      }

      if (action === 'MOVE_MONTH') {
        const targetMonthKey = normalizeMonthInput(asStr(args.targetMonthKey));
        if (targetMonthKey === monthKey) {
          return { ok: false, error: 'Target month must be different from source month.' };
        }
        const branch = asStr(args.branch) ? resolveBranchMatch(asStr(args.branch), env.branches) : null;
        const slipsToMove = env.salarySlips.filter(
          (s) => s.monthKey === monthKey && (!branch || s.branchId === branch.branchId),
        );
        if (slipsToMove.length === 0) {
          return { ok: false, error: `No salary slips found in ${formatMonthLabel(monthKey)} to move.` };
        }
        env.onLiveStatus(`${slipsToMove.length} सॅलरी स्लिप्स ${formatMonthLabel(targetMonthKey)} मध्ये हलवत आहे...`);
        const res = await moveSalarySlipsToMonthBatch({
          slips: slipsToMove,
          targetMonthKey,
          existingSlips: env.salarySlips,
          visibilitySettings: env.visibilitySettings,
        });
        await env.refreshAll();
        env.navigateToTab('salary');
        env.applyVoiceFilter({ targetTab: 'salary', monthKey: targetMonthKey });
        return { ok: true, movedCount: res.movedCount, targetMonthKey };
      }

      if (action === 'DELETE_SINGLE') {
        const { exact, matches } = findMatchingEmployees(asStr(args.employeeIdentifier), env.employees);
        if (!exact) {
          return matches.length > 1
            ? { ok: false, ambiguous: true, matches: matches.slice(0, 6).map(summarizeEmployee) }
            : { ok: false, error: 'Employee not found.' };
        }
        const slip = env.salarySlips.find(
          (s) => s.employeeId === exact.employeeId && s.monthKey === monthKey,
        );
        if (!slip) {
          return { ok: false, error: `No salary slip found for ${exact.fullName} in ${formatMonthLabel(monthKey)}.` };
        }
        if (asBool(args.confirmed) !== true) {
          env.onPendingConfirmation({
            toolName: 'manage_salary_slip',
            args: { ...args, employeeIdentifier: exact.employeeId, monthKey, confirmed: true },
            summaryMr: `${exact.fullName} (${exact.employeeId}) यांची ${formatMonthLabel(monthKey)} ची सॅलरी स्लिप कायमची डिलीट करायची का?`,
          });
          return { ok: false, requiresConfirmation: true, employeeName: exact.fullName, monthKey };
        }
        env.onPendingConfirmation(null);
        env.onLiveStatus('सॅलरी स्लिप डिलीट करत आहे...');
        await deleteSalarySlip(slip);
        await env.refreshAll();
        return { ok: true, deletedSlipId: slip.slipId };
      }

      if (action === 'DELETE_MONTH') {
        const branch = asStr(args.branch) ? resolveBranchMatch(asStr(args.branch), env.branches) : null;
        const slipsToDelete = env.salarySlips.filter(
          (s) => s.monthKey === monthKey && (!branch || s.branchId === branch.branchId),
        );
        if (slipsToDelete.length === 0) {
          return { ok: false, error: `No salary slips found in ${formatMonthLabel(monthKey)}.` };
        }
        if (asBool(args.confirmed) !== true) {
          env.onPendingConfirmation({
            toolName: 'manage_salary_slip',
            args: { ...args, monthKey, confirmed: true },
            summaryMr: `${formatMonthLabel(monthKey)}${branch ? ` (${branch.branchName})` : ''} मधील एकूण ${slipsToDelete.length} सॅलरी स्लिप्स कायमच्या डिलीट करायच्या का?`,
          });
          return { ok: false, requiresConfirmation: true, count: slipsToDelete.length, monthKey };
        }
        env.onPendingConfirmation(null);
        env.onLiveStatus(`${slipsToDelete.length} सॅलरी स्लिप्स डिलीट करत आहे...`);
        const deletedCount = await deleteSalarySlipsBatch({ slips: slipsToDelete });
        await env.refreshAll();
        return { ok: true, deletedCount, monthKey };
      }

      return { ok: false, error: `Unknown salary slip action "${action}".` };
    }

    // 10. MANAGE INCENTIVE BATCHES & MONTH PURGE
    if (toolName === 'manage_incentive_batches_and_months') {
      const action = asStr(args.action).toUpperCase();

      if (action === 'LIST_PENDING') {
        const pending = env.batches.filter((b) => b.status !== 'PUBLISHED' && b.status !== 'REJECTED');
        return {
          ok: true,
          pendingCount: pending.length,
          batches: pending.slice(0, 8).map((b) => ({
            batchId: b.batchId,
            fileName: b.fileName,
            status: b.status,
            period: `${b.periodStart || b.businessDate} to ${b.periodEnd || b.businessDate}`,
            validRows: b.validRows,
            totalIncentive: formatINRFromPaise(b.totalIncentivePaise),
          })),
        };
      }

      if (action === 'APPROVE_AND_PUBLISH') {
        const batchId = asStr(args.batchId);
        const batch = batchId
          ? env.batches.find((b) => b.batchId === batchId)
          : env.batches.find((b) => b.status === 'VALIDATED' || b.status === 'APPROVED' || b.status === 'FAILED');
        if (!batch) {
          return { ok: false, error: 'No pending validated or approved batch found to publish.' };
        }
        env.onLiveStatus(`बॅच "${batch.fileName}" मंजूर करून पब्लिश करत आहे...`);
        if (batch.status === 'VALIDATED') {
          await approveImportBatch(batch.batchId);
        }
        const rows = await listBatchRows(batch.batchId);
        const employeesById: Record<string, Employee> = {};
        for (const e of env.employees) employeesById[e.employeeId.toUpperCase()] = e;
        const published = await publishApprovedBatch({
          batch: { ...batch, status: 'APPROVED' },
          rows,
          employeesById,
        });
        await env.refreshAll();
        env.navigateToTab('history');
        return { ok: true, batchId: batch.batchId, fileName: batch.fileName, ...published };
      }

      if (action === 'REJECT') {
        const batchId = asStr(args.batchId);
        const batch = batchId
          ? env.batches.find((b) => b.batchId === batchId)
          : env.batches.find((b) => b.status === 'VALIDATED' || b.status === 'APPROVED');
        if (!batch) return { ok: false, error: 'No pending batch found to reject.' };
        env.onLiveStatus(`बॅच "${batch.fileName}" रिजेक्ट करत आहे...`);
        await rejectImportBatch(batch.batchId, asStr(args.reason) || 'Rejected via Voice Assistant');
        await env.refreshAll();
        return { ok: true, rejectedBatchId: batch.batchId };
      }

      if (action === 'DELETE_BATCH') {
        const batchId = asStr(args.batchId);
        const batch = batchId ? env.batches.find((b) => b.batchId === batchId) : env.batches[0];
        if (!batch) return { ok: false, error: 'Import batch not found.' };
        if (batch.status === 'PUBLISHED' && !env.isMainOwner) {
          return { ok: false, error: 'Only Main Owner can delete a PUBLISHED import batch.' };
        }
        if (asBool(args.confirmed) !== true) {
          env.onPendingConfirmation({
            toolName: 'manage_incentive_batches_and_months',
            args: { ...args, batchId: batch.batchId, confirmed: true },
            summaryMr: `बॅच "${batch.fileName}" (${batch.status}) कायमचा डिलीट करायचा का?`,
          });
          return { ok: false, requiresConfirmation: true, batchName: batch.fileName, status: batch.status };
        }
        env.onPendingConfirmation(null);
        env.onLiveStatus(`बॅच "${batch.fileName}" डिलीट करत आहे...`);
        const employeesById: Record<string, Employee> = {};
        for (const e of env.employees) employeesById[e.employeeId.toUpperCase()] = e;
        await deleteImportBatch({
          batch,
          reason: asStr(args.reason) || 'Deleted via Marathi Voice Assistant',
          employeesById,
        });
        await env.refreshAll();
        return { ok: true, deletedBatchId: batch.batchId, fileName: batch.fileName };
      }

      if (action === 'PURGE_MONTH') {
        if (!env.isMainOwner) {
          return { ok: false, error: 'Only Main Owner can purge an entire month of incentives.' };
        }
        const monthKey = normalizeMonthInput(asStr(args.monthKey));
        if (isMonthPayrollLockedLocal(monthKey, env.payrollLockSettings)) {
          return { ok: false, error: `${formatMonthLabel(monthKey)} is Payroll-Locked. Unlock it first.` };
        }
        if (asBool(args.confirmed) !== true) {
          env.onPendingConfirmation({
            toolName: 'manage_incentive_batches_and_months',
            args: { ...args, monthKey, confirmed: true },
            summaryMr: `${formatMonthLabel(monthKey)} मधील सर्व इन्सेंटिव्ह नोंदी, बॅचेस आणि समरीज कायमच्या डिलीट करायच्या का?`,
          });
          return { ok: false, requiresConfirmation: true, monthKey };
        }
        env.onPendingConfirmation(null);
        env.onLiveStatus(`${formatMonthLabel(monthKey)} चा इन्सेंटिव्ह डेटा डिलीट करत आहे...`);
        const purged = await purgeMonthRecords({
          monthKey,
          reason: asStr(args.reason) || 'Purged via Marathi Voice Assistant (Owner Confirmed)',
        });
        await env.refreshAll();
        return { ok: true, monthKey, ...purged };
      }

      return { ok: false, error: `Unknown batch action "${action}".` };
    }

    // 11. PRO-LEVEL LOCAL EXCEL VOICE UPLOAD (upload_excel_from_local_folder)
    if (toolName === 'upload_excel_from_local_folder') {
      const fileQuery = asStr(args.fileQuery);
      const targetMonthKey = normalizeMonthInput(asStr(args.targetMonthKey));
      const requestedKind = (asStr(args.uploadKind).toUpperCase() || 'AUTO') as
        | 'AUTO'
        | 'INCENTIVE'
        | 'SALARY_SLIP';
      const explicitDate = asStr(args.businessDate);

      if (!env.linkedFolder.linked) {
        return {
          ok: false,
          folderNotLinked: true,
          error:
            'Local folder is not linked yet. Guide the user in Marathi to click the "Link Local Folder" button in the top header first, then repeat the upload command.',
        };
      }

      // Refresh live directory handle if using File System Access API so newly saved Desktop files appear instantly!
      let activeFolder = env.linkedFolder;
      if (activeFolder.mode === 'fs-access') {
        try {
          activeFolder = await refreshLinkedDirectoryHandle(activeFolder);
          env.setLinkedFolder(activeFolder);
        } catch {
          // Use existing cached listing if permission refresh failed
        }
      }

      if (activeFolder.files.length === 0) {
        return {
          ok: false,
          error: `No .xlsx or .csv files were found inside "${activeFolder.folderName}". Ask the user to check the folder or link a different folder.`,
        };
      }

      const match = findBestMatchingSpreadsheetFile(fileQuery, activeFolder.files);
      if (match.status === 'NOT_FOUND') {
        return {
          ok: false,
          fileNotFound: true,
          folderName: activeFolder.folderName,
          closestFiles: match.suggestions,
          error: `Could not find an Excel/CSV file matching "${fileQuery}" in "${activeFolder.folderName}". Suggest the closest available filenames in Marathi.`,
        };
      }
      if (match.status === 'AMBIGUOUS') {
        return {
          ok: false,
          ambiguousFile: true,
          candidates: match.candidates.map((c) => c.entry.name),
          error: `Multiple files closely matched "${fileQuery}". Ask the user in Marathi which exact file they want to upload.`,
        };
      }

      if (isMonthPayrollLockedLocal(targetMonthKey, env.payrollLockSettings)) {
        return {
          ok: false,
          error: `${formatMonthLabel(targetMonthKey)} is currently Payroll-Locked. Main Owner must unlock the month before uploading new data.`,
        };
      }

      const entry = match.entry;
      env.onLiveStatus(`"${entry.name}" वाचून ${formatMonthLabel(targetMonthKey)} साठी अपलोड करत आहे...`);
      const file = await entry.getFile();

      // Determine upload kind (Salary Slip vs Incentive)
      let resolvedKind: 'INCENTIVE' | 'SALARY_SLIP' =
        requestedKind === 'SALARY_SLIP' || entry.extension === 'csv'
          ? 'SALARY_SLIP'
          : requestedKind === 'INCENTIVE'
            ? 'INCENTIVE'
            : 'INCENTIVE';

      if (requestedKind === 'AUTO' && entry.extension === 'xlsx') {
        try {
          const probe = await readSpreadsheetRawRowsForSalary(file);
          if (looksLikeSalarySheet(entry.name, probe.headers)) {
            resolvedKind = 'SALARY_SLIP';
          }
        } catch {
          // Keep INCENTIVE default
        }
      }

      // PATH A: SALARY SLIP / MONTHLY PAYSHEET UPLOAD
      if (resolvedKind === 'SALARY_SLIP') {
        env.onLiveStatus(`"${entry.name}" सॅलरी शीट तपासत आहे (${formatMonthLabel(targetMonthKey)})...`);
        const { rawRows } = await readSpreadsheetRawRowsForSalary(file);
        if (rawRows.length === 0) {
          return {
            ok: false,
            error: `File "${entry.name}" appears empty or has no readable salary rows. Check the column headers (EMP ID, EMP NAME, BASIC, NET PAY).`,
          };
        }

        const summary = parseSalarySheetRows(rawRows, env.employees, targetMonthKey);
        if (summary.validRows.length === 0) {
          const sampleErrors = summary.errorRows
            .slice(0, 4)
            .map((r) => `Row ${r.rowNumber}: ${r.errorMessage || 'Invalid data'}`);
          env.navigateToTab('salary');
          return {
            ok: false,
            validationFailed: true,
            fileName: entry.name,
            validCount: 0,
            errorCount: summary.errorRows.length,
            sampleErrors,
            error: `No valid salary rows could be matched in "${entry.name}". Explain the exact row/column issue to the user in Marathi and how to fix it.`,
          };
        }

        env.onLiveStatus(`${summary.validRows.length} सॅलरी स्लिप्स ${formatMonthLabel(targetMonthKey)} मध्ये सेव्ह करत आहे...`);
        const pubResult = await publishSalarySlipsBatch({
          validRows: summary.validRows,
          allEmployees: env.employees,
          existingSlips: env.salarySlips,
          incentives: env.incentives,
          visibilitySettings: env.visibilitySettings,
          syncMasterData: true,
        });

        await refreshFast(env, 'salary');
        env.navigateToTab('salary');
        env.applyVoiceFilter({ targetTab: 'salary', monthKey: targetMonthKey });

        return {
          ok: true,
          uploadKind: 'SALARY_SLIP',
          fileName: entry.name,
          targetMonthKey,
          publishedCount: pubResult.slipsPublished,
          skippedErrorRows: summary.errorRows.length,
          totalNetPayable: formatINRFromPaise(summary.totalNetPaise),
          sampleErrors: summary.errorRows
            .slice(0, 3)
            .map((r) => `Row ${r.rowNumber}: ${r.errorMessage}`),
          directReplyMr: `${entry.name} मधील ${pubResult.slipsPublished} सॅलरी स्लिप्स ${formatMonthLabel(targetMonthKey)} मध्ये यशस्वीरित्या अपलोड झाल्या आहेत.`,
        };
      }

      // PATH B: INCENTIVE EXCEL WORKBOOK UPLOAD (.xlsx -> /api/v1/excel/parse -> validate -> stage -> approve -> publish)
      const user = auth.currentUser;
      if (!user) throw new Error('Super Admin login required.');
      const token = await user.getIdToken();

      const formData = new FormData();
      formData.append('file', file, entry.name);

      env.onLiveStatus(`"${entry.name}" एक्सेल सर्व्हरवर तपासत आहे...`);
      const parseResp = await fetch('/api/v1/excel/parse', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const parsed = (await parseResp.json().catch(() => ({}))) as ExcelParseResponse & {
        error?: string;
      };
      if (!parseResp.ok || !parsed.rows) {
        return {
          ok: false,
          error:
            parsed.error ||
            `Could not parse Excel workbook "${entry.name}". Ensure it is a valid .xlsx file with Branch, Employee/Sale ID, and Incentive columns.`,
        };
      }

      const [yrStr, moStr] = targetMonthKey.split('-');
      const yr = Number(yrStr);
      const mo = Number(moStr);
      const lastDay = getLastDayOfMonth(yr, mo);
      const periodStart = parsed.periodStart || (explicitDate || `${targetMonthKey}-01`);
      const periodEnd =
        parsed.periodEnd ||
        (explicitDate || `${targetMonthKey}-${String(lastDay).padStart(2, '0')}`);

      const autoMap: ExcelColumnMapping = {
        businessDate: parsed.suggestedMapping.businessDate || '',
        employeeId: parsed.suggestedMapping.employeeId || '',
        saleId: parsed.suggestedMapping.saleId || '',
        employeeName: parsed.suggestedMapping.employeeName || '',
        branchCode: parsed.suggestedMapping.branchCode || '',
        component1: parsed.suggestedMapping.component1 || '',
        component2: parsed.suggestedMapping.component2 || '',
        component3: parsed.suggestedMapping.component3 || '',
        saleAmt1: parsed.suggestedMapping.saleAmt1 || '',
        saleQty1: parsed.suggestedMapping.saleQty1 || '',
        saleAmt2: parsed.suggestedMapping.saleAmt2 || '',
        saleQty2: parsed.suggestedMapping.saleQty2 || '',
        saleAmt3: parsed.suggestedMapping.saleAmt3 || '',
        saleQty3: parsed.suggestedMapping.saleQty3 || '',
      };

      const validation = validateImportBatch({
        periodStart,
        periodEnd,
        rawBannerDateText: parsed.reportDateRangeText || `${periodStart} to ${periodEnd}`,
        rawTotalRows: parsed.rawTotalRows,
        skippedBlankRows: parsed.skippedBlankRows,
        skippedSummaryRows: parsed.skippedSummaryRows,
        rows: parsed.rows,
        mapping: autoMap,
        branches: env.branches,
        employees: env.employees,
        publishedIncentives: env.incentives,
        overlapResolutionMode: 'SKIP_OVERLAP',
      });

      const actionableCount = validation.rows.filter(
        (r) =>
          (r.resolution === 'PUBLISH_NEW' && r.validationStatus === 'VALID') ||
          (r.resolution === 'CORRECTION' && r.validationStatus === 'EXISTS_PUBLISHED'),
      ).length;

      if (actionableCount === 0) {
        env.navigateToTab('import');
        const sampleErrors = validation.rows
          .filter((r) => r.validationStatus === 'ERROR' || r.validationStatus === 'PERIOD_OVERLAP')
          .slice(0, 4)
          .map((r) => `Row ${r.rowNumber}: ${r.errorMessage || r.validationStatus}`);
        return {
          ok: false,
          validationFailed: true,
          fileName: entry.name,
          missingEmployeesCount: validation.newEmployeeCandidates.length,
          missingBranches: validation.missingBranches,
          errorRowsCount: validation.metrics.invalidRows,
          overlapCount: validation.metrics.periodOverlapWarnings,
          sampleErrors,
          error: `Excel "${entry.name}" had 0 directly publishable rows (errors: ${validation.metrics.invalidRows}, missing employees: ${validation.newEmployeeCandidates.length}, overlaps: ${validation.metrics.periodOverlapWarnings}). Explain the exact issue in Marathi and guide the user.`,
        };
      }

      const detectedImportType = validation.period.importType || 'MONTHLY';
      const resolvedPeriodStart = validation.period.periodStart || periodStart;
      const resolvedPeriodEnd = validation.period.periodEnd || periodEnd;
      const resolvedBusinessDate = validation.period.businessDate || resolvedPeriodEnd;
      const componentLabels = {
        component1: autoMap.component1 || 'New Items Sale',
        component2: autoMap.component2 || 'Old Items Sale',
        component3: autoMap.component3 || 'Other Items Sale',
      };

      env.onLiveStatus(`${actionableCount} इन्सेंटिव्ह नोंदी ${formatMonthLabel(targetMonthKey)} मध्ये पब्लिश करत आहे...`);
      const staged = await stageValidatedBatch({
        fileName: entry.name,
        fileSha256: parsed.fileSha256,
        importType: detectedImportType,
        periodStart: resolvedPeriodStart,
        periodEnd: resolvedPeriodEnd,
        businessDate: resolvedBusinessDate,
        overlapResolutionMode: 'SKIP_OVERLAP',
        skippedBlankRows: validation.metrics.blankRowsSkipped,
        skippedSummaryRows: validation.metrics.summaryRowsSkipped,
        componentLabels,
        rows: validation.rows,
      });

      await approveImportBatch(staged.batch.batchId);
      const employeesById: Record<string, Employee> = {};
      for (const e of env.employees) employeesById[e.employeeId.toUpperCase()] = e;
      const pubRes = await publishApprovedBatch({
        batch: { ...staged.batch, status: 'APPROVED' },
        rows: staged.rows,
        employeesById,
      });

      await refreshFast(env, 'incentives');
      env.navigateToTab('history');
      return {
        ok: true,
        uploadKind: 'INCENTIVE',
        fileName: entry.name,
        targetMonthKey,
        importType: detectedImportType,
        publishedCount: pubRes.publishedCount,
        correctedCount: pubRes.correctedCount,
        skippedErrors: validation.metrics.invalidRows,
        totalIncentive: formatINRFromPaise(validation.metrics.totalIncentivePaise),
        directReplyMr: `${entry.name} ही एक्सेल फाईल ${formatMonthLabel(targetMonthKey)} मध्ये यशस्वीरित्या अपलोड व पब्लिश झाली आहे. एकूण ${pubRes.publishedCount} नोंदी सेव्ह केल्या आहेत.`,
      };
    }

    // 12. BRANCHES, TARGETS, LOANS, QUERIES, VISIBILITY & PAYROLL LOCK
    if (toolName === 'manage_branches_targets_loans') {
      const domain = asStr(args.domain).toUpperCase();
      const action = asStr(args.action).toUpperCase();
      const monthKey = normalizeMonthInput(asStr(args.monthKey));

      if (domain === 'BRANCH') {
        const branchName = asStr(args.branch);
        if (action === 'ADD' || action === 'UPDATE') {
          const existing = resolveBranchMatch(branchName, env.branches);
          const code = (existing?.branchCode || branchName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')).slice(0, 24);
          env.onLiveStatus(`शाखा "${branchName}" सेव्ह करत आहे...`);
          const saved = await saveBranch({
            branchId: existing?.branchId || code,
            branchCode: code,
            branchName: branchName || existing?.branchName || code,
            city: asStr(args.city) || existing?.city || branchName,
            managerName: asStr(args.managerName) || existing?.managerName || '',
            active: true,
            existingCreatedAt: existing?.createdAt,
          });
          await env.refreshAll();
          env.navigateToTab('branches');
          return { ok: true, branch: saved };
        }
        if (action === 'DELETE') {
          if (!env.isMainOwner) {
            return { ok: false, error: 'Only Main Owner can delete a branch.' };
          }
          const existing = resolveBranchMatch(branchName, env.branches);
          if (!existing) return { ok: false, error: `Branch "${branchName}" not found.` };
          if (asBool(args.confirmed) !== true) {
            env.onPendingConfirmation({
              toolName: 'manage_branches_targets_loans',
              args: { ...args, confirmed: true },
              summaryMr: `"${existing.branchName}" ही शाखा कायमची काढून टाकायची का?`,
            });
            return { ok: false, requiresConfirmation: true, branchName: existing.branchName };
          }
          env.onPendingConfirmation(null);
          env.onLiveStatus(`शाखा "${existing.branchName}" डिलीट करत आहे...`);
          await deleteBranch(existing);
          await env.refreshAll();
          return { ok: true, deletedBranch: existing.branchName };
        }
      }

      if (domain === 'TARGET') {
        const empIdent = asStr(args.employeeIdentifier);
        const branchRaw = asStr(args.branch);
        if (action === 'ADD' || action === 'UPDATE') {
          const amtRupees = asNum(args.amountRupees) ?? 0;
          const qty = asNum(args.targetQty) ?? 0;
          if (empIdent) {
            const { exact, matches } = findMatchingEmployees(empIdent, env.employees);
            if (!exact) {
              return matches.length > 1
                ? { ok: false, ambiguous: true, matches: matches.slice(0, 6).map(summarizeEmployee) }
                : { ok: false, error: 'Employee not found.' };
            }
            env.onLiveStatus(`${exact.fullName} साठी टार्गेट सेव्ह करत आहे...`);
            const saved = await upsertSalesTarget({
              monthKey,
              scope: 'EMPLOYEE',
              branchId: exact.branchId,
              branchName: exact.branchName,
              employeeId: exact.employeeId,
              authUid: exact.authUid || '',
              employeeName: exact.fullName,
              targetSaleAmtPaise: Math.round(amtRupees * 100),
              targetSaleQty: qty,
            });
            await env.refreshAll();
            env.navigateToTab('analytics');
            return { ok: true, targetId: saved.targetId, employeeName: exact.fullName, targetRupees: amtRupees };
          }
          const branch = resolveBranchMatch(branchRaw, env.branches);
          if (!branch) return { ok: false, error: `Branch "${branchRaw}" not found.` };
          env.onLiveStatus(`${branch.branchName} शाखेचे टार्गेट सेव्ह करत आहे...`);
          const saved = await upsertSalesTarget({
            monthKey,
            scope: 'BRANCH',
            branchId: branch.branchId,
            branchName: branch.branchName,
            targetSaleAmtPaise: Math.round(amtRupees * 100),
            targetSaleQty: qty,
          });
          await env.refreshAll();
          env.navigateToTab('analytics');
          return { ok: true, targetId: saved.targetId, branchName: branch.branchName, targetRupees: amtRupees };
        }
        if (action === 'DELETE') {
          const branch = branchRaw ? resolveBranchMatch(branchRaw, env.branches) : null;
          const { exact } = empIdent ? findMatchingEmployees(empIdent, env.employees) : { exact: null };
          const found = env.salesTargets.find(
            (t) =>
              t.monthKey === monthKey &&
              (exact
                ? t.scope === 'EMPLOYEE' && t.employeeId === exact.employeeId
                : branch
                  ? t.scope === 'BRANCH' && t.branchId === branch.branchId
                  : false),
          );
          if (!found) return { ok: false, error: 'Matching sales target not found.' };
          if (asBool(args.confirmed) !== true) {
            env.onPendingConfirmation({
              toolName: 'manage_branches_targets_loans',
              args: { ...args, confirmed: true },
              summaryMr: `${found.employeeName || found.branchName} चे ${formatMonthLabel(monthKey)} चे टार्गेट डिलीट करायचे का?`,
            });
            return { ok: false, requiresConfirmation: true, target: found };
          }
          env.onPendingConfirmation(null);
          await deleteSalesTarget(found.targetId);
          await env.refreshAll();
          return { ok: true, deletedTargetId: found.targetId };
        }
      }

      if (domain === 'LOAN') {
        const { exact, matches } = findMatchingEmployees(asStr(args.employeeIdentifier), env.employees);
        if (!exact) {
          return matches.length > 1
            ? { ok: false, ambiguous: true, matches: matches.slice(0, 6).map(summarizeEmployee) }
            : { ok: false, error: 'Employee not found.' };
        }
        if (action === 'ADD') {
          const principal = asNum(args.amountRupees);
          if (!principal || principal <= 0) return { ok: false, error: 'Specify loan principal amount in rupees.' };
          const emi = asNum(args.monthlyEmiRupees);
          const installments = emi && emi > 0 ? Math.max(1, Math.ceil(principal / emi)) : 6;
          env.onLiveStatus(`${exact.fullName} साठी लोन नोंदवत आहे...`);
          const created = await createEmployeeLoan({
            employee: exact,
            loanType: 'SALARY_ADVANCE',
            principalRupees: principal,
            totalInstallments: installments,
            startMonthKey: monthKey,
            remarks: asStr(args.replyOrReason) || 'Added via Marathi Voice Assistant',
          });
          await env.refreshAll();
          env.navigateToTab('pro-suite');
          return { ok: true, loanId: created.loanId, principalRupees: principal, installments };
        }
        if (action === 'DEDUCT_EMI') {
          const activeLoan = env.employeeLoans.find(
            (l) => l.employeeId === exact.employeeId && l.status === 'ACTIVE',
          );
          if (!activeLoan) return { ok: false, error: `No active loan found for ${exact.fullName}.` };
          env.onLiveStatus(`${exact.fullName} चा EMI नोंदवत आहे...`);
          const updated = await recordLoanEmiDeduction({ loan: activeLoan, monthKey });
          await env.refreshAll();
          return {
            ok: true,
            loanId: updated.loanId,
            remainingBalance: formatINRFromPaise(updated.remainingBalancePaise),
            status: updated.status,
          };
        }
        if (action === 'DELETE') {
          const loan = env.employeeLoans.find((l) => l.employeeId === exact.employeeId);
          if (!loan) return { ok: false, error: `No loan record found for ${exact.fullName}.` };
          if (asBool(args.confirmed) !== true) {
            env.onPendingConfirmation({
              toolName: 'manage_branches_targets_loans',
              args: { ...args, confirmed: true },
              summaryMr: `${exact.fullName} यांचे लोन रेकॉर्ड (${loan.loanId}) कायमचे डिलीट करायचे का?`,
            });
            return { ok: false, requiresConfirmation: true, loanId: loan.loanId };
          }
          env.onPendingConfirmation(null);
          await deleteEmployeeLoan(loan);
          await env.refreshAll();
          return { ok: true, deletedLoanId: loan.loanId };
        }
      }

      if (domain === 'QUERY') {
        const empIdent = asStr(args.employeeIdentifier);
        const { exact } = empIdent ? findMatchingEmployees(empIdent, env.employees) : { exact: null };
        const qRec = exact
          ? env.employeeQueries.find((q) => q.employeeId === exact.employeeId && q.status !== 'RESOLVED') ||
            env.employeeQueries.find((q) => q.employeeId === exact.employeeId)
          : env.employeeQueries.find((q) => q.status !== 'RESOLVED');
        if (!qRec) return { ok: false, error: 'No matching employee query found.' };

        if (action === 'RESOLVE' || action === 'UPDATE') {
          env.onLiveStatus(`${qRec.employeeName} ची तक्रार सोडवत आहे...`);
          await resolveEmployeeQuery({
            queryId: qRec.queryId,
            status: 'RESOLVED',
            adminReply: asStr(args.replyOrReason) || 'आपली तक्रार तपासून सोडवण्यात आली आहे.',
          });
          await env.refreshAll();
          env.navigateToTab('payouts');
          env.applyVoiceFilter({ targetTab: 'payouts', subTab: 'queries' });
          return { ok: true, resolvedQueryId: qRec.queryId, employeeName: qRec.employeeName };
        }
        if (action === 'DELETE') {
          if (asBool(args.confirmed) !== true) {
            env.onPendingConfirmation({
              toolName: 'manage_branches_targets_loans',
              args: { ...args, confirmed: true },
              summaryMr: `${qRec.employeeName} यांची क्वेरी ("${qRec.subject}") कायमची डिलीट करायची का?`,
            });
            return { ok: false, requiresConfirmation: true, queryId: qRec.queryId };
          }
          env.onPendingConfirmation(null);
          await deleteEmployeeQueryByOwner(qRec);
          await env.refreshAll();
          return { ok: true, deletedQueryId: qRec.queryId };
        }
      }

      if (domain === 'VISIBILITY') {
        const show = action === 'SHOW_MONTH';
        const scope = (asStr(args.visibilityScope).toUpperCase() || 'BOTH') as
          | 'INCENTIVES'
          | 'SALARY_SLIPS'
          | 'BOTH';
        const cur = env.visibilitySettings;
        const incSet = new Set(cur.visibleMonths);
        const slipSet = new Set(cur.salarySlipVisibleMonths || cur.visibleMonths);

        if (scope === 'INCENTIVES' || scope === 'BOTH') {
          if (show) incSet.add(monthKey);
          else incSet.delete(monthKey);
        }
        if (scope === 'SALARY_SLIPS' || scope === 'BOTH') {
          if (show) slipSet.add(monthKey);
          else slipSet.delete(monthKey);
        }

        env.onLiveStatus(`${formatMonthLabel(monthKey)} साठी कर्मचारी व्हिजिबिलिटी अपडेट करत आहे...`);
        await savePortalVisibilitySettings({
          mode: 'SELECTED',
          visibleMonths: Array.from(incSet).sort().reverse(),
          salarySlipMode: 'SELECTED',
          salarySlipVisibleMonths: Array.from(slipSet).sort().reverse(),
        });
        await env.refreshAll();
        return { ok: true, monthKey, visible: show, scope };
      }

      if (domain === 'PAYROLL_LOCK') {
        if (!env.isMainOwner) {
          return { ok: false, error: 'Only Main Owner can lock or unlock a payroll month.' };
        }
        const lock = action === 'LOCK';
        env.onLiveStatus(
          `${formatMonthLabel(monthKey)} पेरोल ${lock ? 'लॉक (Freeze)' : 'अनलॉक'} करत आहे...`,
        );
        await toggleMonthPayrollLock({
          monthKey,
          lock,
          note: asStr(args.replyOrReason) || `${lock ? 'Locked' : 'Unlocked'} via Voice Assistant`,
          currentSettings: env.payrollLockSettings,
        });
        await env.refreshAll();
        return { ok: true, monthKey, locked: lock };
      }

      return { ok: false, error: `Unsupported domain/action: ${domain}/${action}` };
    }

    // 13. LIVE ANALYTICS SUMMARY
    if (toolName === 'get_analytics_summary') {
      const metric = asStr(args.metric).toUpperCase();
      const limit = Math.max(1, Math.min(15, Math.round(asNum(args.limit) || 5)));

      const availableMonths = Array.from(
        new Set([
          ...env.monthlySummaries.map((s) => s.monthKey),
          ...env.salarySlips.map((s) => s.monthKey),
        ]),
      ).sort((a, b) => b.localeCompare(a));

      const monthKey = args.monthKey
        ? normalizeMonthInput(asStr(args.monthKey))
        : availableMonths[0] || getCurrentMonthKeyIST();

      const branch = asStr(args.branch) ? resolveBranchMatch(asStr(args.branch), env.branches) : null;
      const dept = asStr(args.department) ? resolveDepartmentSelection(asStr(args.department)) : null;

      env.onLiveStatus(`${formatMonthLabel(monthKey)} ची आकडेवारी तपासत आहे...`);

      const empById = new Map(env.employees.map((e) => [e.employeeId.toUpperCase(), e]));
      const monthSummaries = env.monthlySummaries.filter((s) => {
        if (s.monthKey !== monthKey || s.sourceType === 'NO_DATA') return false;
        if (branch && s.branchId !== branch.branchId) return false;
        if (dept?.departmentId) {
          const emp = empById.get(s.employeeId.toUpperCase());
          if (emp?.departmentId !== dept.departmentId) return false;
        }
        return true;
      });

      if (metric === 'TOP_PERFORMERS') {
        const sorted = [...monthSummaries]
          .sort((a, b) => (b.totalSaleAmtPaise || 0) - (a.totalSaleAmtPaise || 0) || b.grandTotalPaise - a.grandTotalPaise)
          .slice(0, limit);
        return {
          ok: true,
          monthKey,
          branch: branch?.branchName || 'All Branches',
          department: dept?.departmentName || 'All Departments',
          topPerformers: sorted.map((s, idx) => ({
            rank: idx + 1,
            employeeId: s.employeeId,
            employeeName: s.employeeName,
            branchName: s.branchName,
            totalSale: formatINRFromPaise(s.totalSaleAmtPaise || 0),
            totalIncentive: formatINRFromPaise(s.grandTotalPaise),
          })),
        };
      }

      if (metric === 'PENDING_PAYOUTS') {
        const paidIds = new Set(
          env.payoutRecords
            .filter((p) => p.monthKey === monthKey && p.status === 'PAID')
            .map((p) => p.employeeId.toUpperCase()),
        );
        const pending = monthSummaries.filter((s) => !paidIds.has(s.employeeId.toUpperCase()));
        const totalPendingPaise = pending.reduce((acc, s) => acc + s.grandTotalPaise, 0);
        return {
          ok: true,
          monthKey,
          branch: branch?.branchName || 'All Branches',
          pendingCount: pending.length,
          totalPendingAmount: formatINRFromPaise(totalPendingPaise),
          samplePending: pending.slice(0, limit).map((s) => ({
            employeeId: s.employeeId,
            employeeName: s.employeeName,
            branchName: s.branchName,
            amount: formatINRFromPaise(s.grandTotalPaise),
          })),
        };
      }

      if (metric === 'SALARY_SUMMARY') {
        const slips = env.salarySlips.filter(
          (s) => s.monthKey === monthKey && (!branch || s.branchId === branch.branchId),
        );
        const gross = slips.reduce((a, s) => a + s.grossEarningsPaise, 0);
        const ded = slips.reduce((a, s) => a + s.totalDeductionsPaise, 0);
        const net = slips.reduce((a, s) => a + s.netPayablePaise, 0);
        return {
          ok: true,
          monthKey,
          branch: branch?.branchName || 'All Branches',
          slipCount: slips.length,
          totalGross: formatINRFromPaise(gross),
          totalDeductions: formatINRFromPaise(ded),
          totalNetPayable: formatINRFromPaise(net),
          averageNetSalary: slips.length > 0 ? formatINRFromPaise(Math.round(net / slips.length)) : '₹0.00',
        };
      }

      if (metric === 'EMPLOYEE_SUMMARY') {
        const { exact, matches } = findMatchingEmployees(asStr(args.employeeIdentifier), env.employees);
        if (!exact) {
          return matches.length > 1
            ? { ok: false, ambiguous: true, matches: matches.slice(0, 6).map(summarizeEmployee) }
            : { ok: false, error: 'Employee not found.' };
        }
        const sum = env.monthlySummaries.find(
          (s) => s.employeeId === exact.employeeId && s.monthKey === monthKey,
        );
        const slip = env.salarySlips.find(
          (s) => s.employeeId === exact.employeeId && s.monthKey === monthKey,
        );
        const payout = env.payoutRecords.find(
          (p) => p.employeeId === exact.employeeId && p.monthKey === monthKey,
        );
        return {
          ok: true,
          monthKey,
          employee: summarizeEmployee(exact),
          incentive: sum
            ? {
                totalSale: formatINRFromPaise(sum.totalSaleAmtPaise || 0),
                totalQty: sum.totalSaleQty || 0,
                totalIncentive: formatINRFromPaise(sum.grandTotalPaise),
              }
            : null,
          salarySlip: slip
            ? {
                gross: formatINRFromPaise(slip.grossEarningsPaise),
                deductions: formatINRFromPaise(slip.totalDeductionsPaise),
                netPayable: formatINRFromPaise(slip.netPayablePaise),
                paidDays: slip.paidDays,
                lopDays: slip.lopDays,
              }
            : null,
          payoutStatus: payout?.status || 'UNPAID',
        };
      }

      if (metric === 'OPEN_QUERIES') {
        const open = env.employeeQueries.filter((q) => q.status !== 'RESOLVED');
        return {
          ok: true,
          openCount: open.length,
          queries: open.slice(0, limit).map((q) => ({
            queryId: q.queryId,
            employeeName: q.employeeName,
            branchName: q.branchName,
            subject: q.subject,
            status: q.status,
          })),
        };
      }

      if (metric === 'ACTIVE_LOANS') {
        const active = env.employeeLoans.filter((l) => l.status === 'ACTIVE');
        const totalRem = active.reduce((a, l) => a + l.remainingBalancePaise, 0);
        return {
          ok: true,
          activeLoanCount: active.length,
          totalRemainingBalance: formatINRFromPaise(totalRem),
          loans: active.slice(0, limit).map((l) => ({
            employeeName: l.employeeName,
            remaining: formatINRFromPaise(l.remainingBalancePaise),
            emi: formatINRFromPaise(l.monthlyEmiPaise),
          })),
        };
      }

      // OVERVIEW / BRANCH_SUMMARY / DEPARTMENT_SUMMARY
      const totalSalePaise = monthSummaries.reduce((a, s) => a + (s.totalSaleAmtPaise || 0), 0);
      const totalIncPaise = monthSummaries.reduce((a, s) => a + s.grandTotalPaise, 0);
      const slipsCount = env.salarySlips.filter(
        (s) => s.monthKey === monthKey && (!branch || s.branchId === branch.branchId),
      ).length;
      return {
        ok: true,
        monthKey,
        branch: branch?.branchName || 'All Branches',
        totalEmployees: env.employees.length,
        activeEmployees: env.employees.filter((e) => e.status === 'ACTIVE').length,
        incentiveStaffCount: monthSummaries.length,
        totalSales: formatINRFromPaise(totalSalePaise),
        totalIncentive: formatINRFromPaise(totalIncPaise),
        averageIncentive:
          monthSummaries.length > 0
            ? formatINRFromPaise(Math.round(totalIncPaise / monthSummaries.length))
            : '₹0.00',
        salarySlipsPublished: slipsCount,
        openQueries: env.employeeQueries.filter((q) => q.status !== 'RESOLVED').length,
      };
    }

    // 14. DOWNLOAD REPORTS (Excel / CSV / PDF / ZIP)
    if (toolName === 'download_report') {
      const reportType = asStr(args.reportType).toUpperCase();
      const availableMonths = Array.from(
        new Set([
          ...env.salarySlips.map((s) => s.monthKey),
          ...env.monthlySummaries.map((s) => s.monthKey),
        ]),
      ).sort((a, b) => b.localeCompare(a));
      const monthKey = args.monthKey
        ? normalizeMonthInput(asStr(args.monthKey))
        : availableMonths[0] || getCurrentMonthKeyIST();
      const branch = asStr(args.branch) ? resolveBranchMatch(asStr(args.branch), env.branches) : null;
      const selectedBranchId = branch ? branch.branchId : 'ALL';

      const filterInput = {
        branches: env.branches,
        employees: env.employees,
        salarySlips: env.salarySlips,
        monthlySummaries: env.monthlySummaries,
        payoutRecords: env.payoutRecords,
        adjustments: env.adjustments,
        selectedMonth: monthKey,
        selectedBranchId,
      };

      env.onLiveStatus(`रिपोर्ट (${reportType}) तयार करून डाउनलोड करत आहे...`);

      if (reportType === 'COMPLETE_BRANCH_PACK') {
        await downloadCompleteBranchReportPackXlsx(filterInput);
        return {
          ok: true,
          reportType,
          monthKey,
          branch: branch?.branchName || 'All Branches',
          directReplyMr: `${branch?.branchName || 'सर्व शाखांचा'} संपूर्ण एक्सेल रिपोर्ट डाउनलोड झाला आहे.`,
        };
      }
      if (reportType === 'BANK_NEFT_XLSX') {
        await downloadBankNeftExportXlsx(filterInput);
        return { ok: true, reportType, monthKey, branch: branch?.branchName || 'All Branches' };
      }
      if (reportType === 'BANK_NEFT_CSV') {
        downloadBankNeftExportCsv(filterInput);
        return { ok: true, reportType, monthKey, branch: branch?.branchName || 'All Branches' };
      }
      if (reportType === 'DCR_CASH_XLSX') {
        await downloadDcrCashExportXlsx(filterInput);
        return { ok: true, reportType, monthKey, branch: branch?.branchName || 'All Branches' };
      }
      if (reportType === 'DCR_CASH_CSV') {
        downloadDcrCashExportCsv(filterInput);
        return { ok: true, reportType, monthKey, branch: branch?.branchName || 'All Branches' };
      }
      if (reportType === 'STATUTORY_XLSX') {
        await downloadStatutoryComplianceXlsx(filterInput);
        return { ok: true, reportType, monthKey, branch: branch?.branchName || 'All Branches' };
      }
      if (reportType === 'STATUTORY_CSV') {
        downloadStatutoryComplianceCsv(filterInput);
        return { ok: true, reportType, monthKey, branch: branch?.branchName || 'All Branches' };
      }
      if (reportType === 'BRANCH_SALARY_REGISTER') {
        await downloadBranchSalaryRegisterXlsx(filterInput);
        return { ok: true, reportType, monthKey, branch: branch?.branchName || 'All Branches' };
      }
      if (reportType === 'BRANCH_INCENTIVE_REPORT') {
        await downloadBranchIncentiveReportXlsx(filterInput);
        return { ok: true, reportType, monthKey, branch: branch?.branchName || 'All Branches' };
      }
      if (reportType === 'ATTENDANCE_OT_ATTRITION') {
        await downloadAttendanceOtAttritionXlsx(filterInput);
        return { ok: true, reportType, monthKey, branch: branch?.branchName || 'All Branches' };
      }
      if (reportType === 'EMPLOYEE_ROSTER') {
        await downloadBranchEmployeeRosterXlsx(filterInput);
        return { ok: true, reportType, monthKey, branch: branch?.branchName || 'All Branches' };
      }
      if (reportType === 'BULK_SALARY_SLIPS_ZIP') {
        const slips = env.salarySlips.filter(
          (s) => s.monthKey === monthKey && (!branch || s.branchId === branch.branchId),
        );
        if (slips.length === 0) {
          return { ok: false, error: `No salary slips found in ${formatMonthLabel(monthKey)} to zip.` };
        }
        const count = await downloadBulkSalarySlipsZip({
          slips,
          monthLabel: formatMonthLabel(monthKey),
        });
        return { ok: true, reportType, monthKey, exportedCount: count };
      }
      if (reportType === 'EMPLOYEE_SALARY_SLIP_PDF') {
        const { exact, matches } = findMatchingEmployees(asStr(args.employeeIdentifier), env.employees);
        if (!exact) {
          return matches.length > 1
            ? { ok: false, ambiguous: true, matches: matches.slice(0, 6).map(summarizeEmployee) }
            : { ok: false, error: 'Employee not found for salary slip PDF.' };
        }
        const slip = env.salarySlips.find(
          (s) => s.employeeId === exact.employeeId && s.monthKey === monthKey,
        );
        if (!slip) {
          return { ok: false, error: `No salary slip found for ${exact.fullName} in ${formatMonthLabel(monthKey)}.` };
        }
        await downloadEmployeeSalarySlipPdf(slip);
        return { ok: true, reportType, employeeName: exact.fullName, monthKey };
      }
      if (reportType === 'EMPLOYEE_INCENTIVE_SLIP_PDF') {
        const { exact, matches } = findMatchingEmployees(asStr(args.employeeIdentifier), env.employees);
        if (!exact) {
          return matches.length > 1
            ? { ok: false, ambiguous: true, matches: matches.slice(0, 6).map(summarizeEmployee) }
            : { ok: false, error: 'Employee not found for incentive slip PDF.' };
        }
        const empRecords = env.incentives.filter(
          (r) => r.employeeId === exact.employeeId && r.monthKey === monthKey && r.status === 'PUBLISHED',
        );
        const empAdj = env.adjustments.filter(
          (a) => a.employeeId === exact.employeeId && a.monthKey === monthKey && a.status === 'ACTIVE',
        );
        const payout = env.payoutRecords.find(
          (p) => p.employeeId === exact.employeeId && p.monthKey === monthKey,
        );
        const summary = env.monthlySummaries.find(
          (s) => s.employeeId === exact.employeeId && s.monthKey === monthKey,
        );
        const slab1SaleAmtPaise =
          summary?.saleAmt1TotalPaise ??
          empRecords.reduce((acc, r) => acc + (r.saleAmt1Paise || 0), 0);
        const slab1SaleQty =
          summary?.saleQty1Total ?? empRecords.reduce((acc, r) => acc + (r.saleQty1 || 0), 0);
        const slab1IncentivePaise =
          summary?.component1TotalPaise ?? empRecords.reduce((acc, r) => acc + r.component1Paise, 0);
        const slab2SaleAmtPaise =
          summary?.saleAmt2TotalPaise ??
          empRecords.reduce((acc, r) => acc + (r.saleAmt2Paise || 0), 0);
        const slab2SaleQty =
          summary?.saleQty2Total ?? empRecords.reduce((acc, r) => acc + (r.saleQty2 || 0), 0);
        const slab2IncentivePaise =
          summary?.component2TotalPaise ?? empRecords.reduce((acc, r) => acc + r.component2Paise, 0);
        const slab3SaleAmtPaise =
          summary?.saleAmt3TotalPaise ??
          empRecords.reduce((acc, r) => acc + (r.saleAmt3Paise || 0), 0);
        const slab3SaleQty =
          summary?.saleQty3Total ?? empRecords.reduce((acc, r) => acc + (r.saleQty3 || 0), 0);
        const slab3IncentivePaise =
          summary?.component3TotalPaise ?? empRecords.reduce((acc, r) => acc + r.component3Paise, 0);
        const totalSaleAmtPaise =
          summary?.totalSaleAmtPaise ?? slab1SaleAmtPaise + slab2SaleAmtPaise + slab3SaleAmtPaise;
        const totalSaleQty = summary?.totalSaleQty ?? slab1SaleQty + slab2SaleQty + slab3SaleQty;
        const grossIncentivePaise =
          summary?.grandTotalPaise ?? slab1IncentivePaise + slab2IncentivePaise + slab3IncentivePaise;

        await downloadEmployeeIncentiveSlipPdf({
          employeeName: exact.fullName,
          employeeId: exact.employeeId,
          branchName: exact.branchName,
          designation: exact.designation,
          periodTitle: formatMonthLabel(monthKey),
          periodBadge: formatMonthLabel(monthKey).toUpperCase(),
          slab1SaleAmtPaise,
          slab1SaleQty,
          slab1IncentivePaise,
          slab2SaleAmtPaise,
          slab2SaleQty,
          slab2IncentivePaise,
          slab3SaleAmtPaise,
          slab3SaleQty,
          slab3IncentivePaise,
          totalSaleAmtPaise,
          totalSaleQty,
          grossIncentivePaise,
          adjustments: empAdj,
          payout: payout || null,
          fileName: `house-of-muktai-incentive-slip-${exact.employeeId}-${monthKey}.pdf`,
        });
        return { ok: true, reportType, employeeName: exact.fullName, monthKey };
      }

      if (reportType === 'MANAGEMENT_EXCEL') {
        const monthSums = env.monthlySummaries.filter(
          (s) => s.monthKey === monthKey && s.sourceType !== 'NO_DATA',
        );
        const payoutMap = new Map(
          env.payoutRecords
            .filter((p) => p.monthKey === monthKey)
            .map((p) => [p.employeeId.toUpperCase(), p]),
        );
        const employeeRows = monthSums.map((s) => {
          const adjNet = env.adjustments
            .filter((a) => a.employeeId === s.employeeId && a.monthKey === monthKey && a.status === 'ACTIVE')
            .reduce((acc, a) => acc + (a.type === 'BONUS' ? a.amountPaise : -a.amountPaise), 0);
          const payout = payoutMap.get(s.employeeId.toUpperCase());
          return {
            branchName: s.branchName,
            employeeId: s.employeeId,
            employeeName: s.employeeName,
            saleAmt1Rupees: (s.saleAmt1TotalPaise || 0) / 100,
            saleQty1: s.saleQty1Total || 0,
            inc1Rupees: s.component1TotalPaise / 100,
            saleAmt2Rupees: (s.saleAmt2TotalPaise || 0) / 100,
            saleQty2: s.saleQty2Total || 0,
            inc2Rupees: s.component2TotalPaise / 100,
            saleAmt3Rupees: (s.saleAmt3TotalPaise || 0) / 100,
            saleQty3: s.saleQty3Total || 0,
            inc3Rupees: s.component3TotalPaise / 100,
            totalSaleAmtRupees: (s.totalSaleAmtPaise || 0) / 100,
            totalSaleQty: s.totalSaleQty || 0,
            grossIncentiveRupees: s.grandTotalPaise / 100,
            adjustmentsNetRupees: adjNet / 100,
            netPayableRupees: (s.grandTotalPaise + adjNet) / 100,
            payoutStatus: payout?.status || 'UNPAID',
            paymentMode: payout?.paymentMode || '',
            paymentReference: payout?.paymentReference || '',
          };
        });
        const branchGroups = new Map<string, typeof employeeRows>();
        for (const r of employeeRows) {
          const list = branchGroups.get(r.branchName) || [];
          list.push(r);
          branchGroups.set(r.branchName, list);
        }
        const branchRows = Array.from(branchGroups.entries()).map(([bName, rows]) => {
          const totalSale = rows.reduce((a, r) => a + r.totalSaleAmtRupees, 0);
          const gross = rows.reduce((a, r) => a + r.grossIncentiveRupees, 0);
          const adjNet = rows.reduce((a, r) => a + r.adjustmentsNetRupees, 0);
          return {
            branchName: bName,
            staffCount: rows.length,
            totalSaleAmtRupees: totalSale,
            totalSaleQty: rows.reduce((a, r) => a + r.totalSaleQty, 0),
            newItemsIncRupees: rows.reduce((a, r) => a + r.inc1Rupees, 0),
            oldItemsIncRupees: rows.reduce((a, r) => a + r.inc2Rupees, 0),
            otherItemsIncRupees: rows.reduce((a, r) => a + r.inc3Rupees, 0),
            grossIncentiveRupees: gross,
            incentivePctOfSale: totalSale > 0 ? Math.round((gross / totalSale) * 10000) / 100 : 0,
            adjustmentsNetRupees: adjNet,
            netPayableRupees: gross + adjNet,
            paidCount: rows.filter((r) => r.payoutStatus === 'PAID').length,
          };
        });
        await downloadManagementExcelReport({
          monthKey,
          monthLabel: formatMonthLabel(monthKey),
          branchRows,
          employeeRows,
        });
        return { ok: true, reportType, monthKey };
      }

      return { ok: false, error: `Unknown report type "${reportType}".` };
    }

    // 15. PRO TOOL: PREPARE WHATSAPP DISPATCH (SINGLE EMPLOYEE OR BRANCH/DEPARTMENT)
    if (toolName === 'prepare_whatsapp_dispatch') {
      const empIdRaw = asStr(args.employeeIdentifier);
      const branchRaw = asStr(args.branch);
      const deptRaw = asStr(args.department);
      const rawMonthArg = asStr(args.monthKey);
      const docTypeRaw = asStr(args.documentType).toUpperCase();
      const requestedDocType: 'AUTO' | 'SALARY_SLIP' | 'INCENTIVE_SUMMARY' =
        docTypeRaw === 'SALARY_SLIP' || docTypeRaw === 'INCENTIVE_SUMMARY' ? docTypeRaw : 'AUTO';
      const portalUrl = typeof window !== 'undefined' ? window.location.origin : '';

      const normEmpKey = (id?: string): string => (id || '').trim().toUpperCase();
      const stripZeroEmpKey = (id?: string): string => normEmpKey(id).replace(/^0+/, '') || normEmpKey(id);
      const matchesEmpRecord = (recordEmpId: string, emp: Employee): boolean => {
        const recKey = normEmpKey(recordEmpId);
        const recNoZero = stripZeroEmpKey(recordEmpId);
        const empKey = normEmpKey(emp.employeeId);
        const empNoZero = stripZeroEmpKey(emp.employeeId);
        if (recKey === empKey || (recNoZero && recNoZero === empNoZero)) return true;
        if (emp.saleId) {
          const saleKey = normEmpKey(emp.saleId);
          const saleNoZero = stripZeroEmpKey(emp.saleId);
          if (recKey === saleKey || (recNoZero && recNoZero === saleNoZero)) return true;
        }
        return false;
      };

      const collectMonthsForStaff = (
        staff: Employee[],
        kind: 'SALARY_SLIP' | 'INCENTIVE_SUMMARY' | 'BOTH',
      ): string[] => {
        const months = new Set<string>();
        if (kind === 'SALARY_SLIP' || kind === 'BOTH') {
          for (const s of env.salarySlips) {
            if (staff.some((emp) => matchesEmpRecord(s.employeeId, emp))) {
              months.add(s.monthKey);
            }
          }
        }
        if (kind === 'INCENTIVE_SUMMARY' || kind === 'BOTH') {
          for (const s of env.monthlySummaries) {
            if (s.sourceType !== 'NO_DATA' && staff.some((emp) => matchesEmpRecord(s.employeeId, emp))) {
              months.add(s.monthKey);
            }
          }
        }
        return Array.from(months).sort((a, b) => b.localeCompare(a));
      };

      const resolveLatestMonth = (staff: Employee[]): string => {
        if (rawMonthArg) return normalizeMonthInput(rawMonthArg);
        const primaryMonths = collectMonthsForStaff(
          staff,
          requestedDocType === 'SALARY_SLIP'
            ? 'SALARY_SLIP'
            : requestedDocType === 'INCENTIVE_SUMMARY'
              ? 'INCENTIVE_SUMMARY'
              : 'BOTH',
        );
        if (primaryMonths.length > 0) return primaryMonths[0];
        const anyMonths = collectMonthsForStaff(staff, 'BOTH');
        return anyMonths[0] || getCurrentMonthKeyIST();
      };

      const buildItemForEmployee = (
        emp: Employee,
        monthKey: string,
        docMode: 'AUTO' | 'SALARY_SLIP' | 'INCENTIVE_SUMMARY',
      ): VoiceWhatsAppRecipientItem | null => {
        const slip = env.salarySlips.find(
          (s) => s.monthKey === monthKey && matchesEmpRecord(s.employeeId, emp),
        );
        const inc = env.monthlySummaries.find(
          (s) =>
            s.monthKey === monthKey &&
            s.sourceType !== 'NO_DATA' &&
            matchesEmpRecord(s.employeeId, emp),
        );

        let chosenType: 'SALARY_SLIP' | 'INCENTIVE_SUMMARY' | null = null;
        if (docMode === 'SALARY_SLIP' && slip) chosenType = 'SALARY_SLIP';
        else if (docMode === 'INCENTIVE_SUMMARY' && inc) chosenType = 'INCENTIVE_SUMMARY';
        else if (docMode === 'AUTO') {
          if (slip) chosenType = 'SALARY_SLIP';
          else if (inc) chosenType = 'INCENTIVE_SUMMARY';
        }
        if (!chosenType) return null;

        const monthLabel = formatMonthLabel(monthKey);
        const hasPhone = Boolean(normalizeIndianWhatsAppNumber(emp.phone));
        let amountLabel = '';
        let messageText = '';

        if (chosenType === 'SALARY_SLIP' && slip) {
          amountLabel = formatINRFromPaise(slip.netPayablePaise);
          messageText = buildWhatsAppSlipMessage({
            employeeName: emp.fullName,
            monthKey,
            netPayablePaise: slip.netPayablePaise,
            branchName: emp.branchName,
            portalUrl,
          });
        } else if (inc) {
          const adjNet = env.adjustments
            .filter(
              (a) =>
                matchesEmpRecord(a.employeeId, emp) &&
                a.monthKey === monthKey &&
                a.status === 'ACTIVE',
            )
            .reduce((acc, a) => acc + (a.type === 'BONUS' ? a.amountPaise : -a.amountPaise), 0);
          const netIncPaise = inc.grandTotalPaise + adjNet;
          amountLabel = formatINRFromPaise(netIncPaise);
          messageText =
            `नमस्कार ${emp.fullName},\n` +
            `House of Muktai (${emp.branchName}) तर्फे तुमचे ${monthLabel} चे Incentive Statement पोर्टलवर उपलब्ध झाले आहे.\n` +
            `एकूण विक्री: ${formatINRFromPaise(inc.totalSaleAmtPaise || 0)}\n` +
            `निव्वळ देय इन्सेंटिव्ह: ${amountLabel}\n` +
            `कृपया Staff Portal मध्ये लॉगिन करून तपशील पहा.${portalUrl ? `\nPortal: ${portalUrl}` : ''}`;
        }

        return {
          employeeId: emp.employeeId,
          employeeName: emp.fullName,
          branchName: emp.branchName,
          phone: emp.phone || '',
          hasPhone,
          monthLabel,
          docType: chosenType,
          amountLabel,
          waUrl: buildWhatsAppDeepLink(emp.phone, messageText),
          messageText,
        };
      };

      const resolveItemsWithSmartFallback = (staff: Employee[]): {
        items: VoiceWhatsAppRecipientItem[];
        effectiveMonthKey: string;
        requestedMonthKey: string;
        fallbackReasonMr: string;
      } => {
        const requestedMonthKey = resolveLatestMonth(staff);

        const buildAll = (
          mKey: string,
          docMode: 'AUTO' | 'SALARY_SLIP' | 'INCENTIVE_SUMMARY',
        ): VoiceWhatsAppRecipientItem[] => {
          const out: VoiceWhatsAppRecipientItem[] = [];
          for (const emp of staff) {
            const it = buildItemForEmployee(emp, mKey, docMode);
            if (it) out.push(it);
          }
          return out;
        };

        // 1. Exact match for requested month + doc type
        const primary = buildAll(requestedMonthKey, requestedDocType);
        if (primary.length > 0) {
          return {
            items: primary,
            effectiveMonthKey: requestedMonthKey,
            requestedMonthKey,
            fallbackReasonMr: '',
          };
        }

        // 2. If SALARY_SLIP requested (or AUTO) and requested month had none, check latest available Salary Slip month for these staff
        if (requestedDocType === 'SALARY_SLIP' || requestedDocType === 'AUTO') {
          const staffSlipMonths = collectMonthsForStaff(staff, 'SALARY_SLIP');
          for (const altMonth of staffSlipMonths) {
            const altItems = buildAll(altMonth, 'SALARY_SLIP');
            if (altItems.length > 0) {
              return {
                items: altItems,
                effectiveMonthKey: altMonth,
                requestedMonthKey,
                fallbackReasonMr:
                  altMonth !== requestedMonthKey
                    ? `${formatMonthLabel(requestedMonthKey)} च्या सॅलरी स्लिप अद्याप अपलोड नसल्याने उपलब्ध असलेल्या ${formatMonthLabel(altMonth)} च्या सॅलरी स्लिप तयार केल्या आहेत.`
                    : '',
              };
            }
          }
        }

        // 3. Fallback to Incentive Statement (same month first, then latest available incentive month)
        const sameMonthInc = buildAll(requestedMonthKey, 'INCENTIVE_SUMMARY');
        if (sameMonthInc.length > 0) {
          return {
            items: sameMonthInc,
            effectiveMonthKey: requestedMonthKey,
            requestedMonthKey,
            fallbackReasonMr:
              requestedDocType === 'SALARY_SLIP'
                ? `${formatMonthLabel(requestedMonthKey)} च्या सॅलरी स्लिप अद्याप अपलोड नसल्याने, त्याऐवजी ${formatMonthLabel(requestedMonthKey)} चे इन्सेंटिव्ह स्टेटमेंट तयार केले आहे.`
                : '',
          };
        }

        const staffIncMonths = collectMonthsForStaff(staff, 'INCENTIVE_SUMMARY');
        for (const altMonth of staffIncMonths) {
          const altInc = buildAll(altMonth, 'INCENTIVE_SUMMARY');
          if (altInc.length > 0) {
            return {
              items: altInc,
              effectiveMonthKey: altMonth,
              requestedMonthKey,
              fallbackReasonMr: `${formatMonthLabel(requestedMonthKey)} साठी सॅलरी स्लिप अपलोड नसल्याने उपलब्ध असलेल्या ${formatMonthLabel(altMonth)} चे इन्सेंटिव्ह स्टेटमेंट तयार केले आहे.`,
            };
          }
        }

        return {
          items: [],
          effectiveMonthKey: requestedMonthKey,
          requestedMonthKey,
          fallbackReasonMr: '',
        };
      };

      // Mode A: Single employee WhatsApp dispatch
      if (empIdRaw) {
        env.onLiveStatus(`WhatsApp स्लिप तयार करत आहे (${empIdRaw})...`);
        const { exact, matches } = findMatchingEmployees(empIdRaw, env.employees);
        if (!exact) {
          if (matches.length > 1) {
            return {
              ok: false,
              ambiguous: true,
              matches: matches.slice(0, 6).map(summarizeEmployee),
            };
          }
          return { ok: false, error: `No employee found matching "${empIdRaw}".` };
        }

        const resolved = resolveItemsWithSmartFallback([exact]);
        const item = resolved.items[0] || null;
        if (!item) {
          const globalSlipMonths = Array.from(new Set(env.salarySlips.map((s) => s.monthKey)))
            .sort((a, b) => b.localeCompare(a))
            .slice(0, 4)
            .map(formatMonthLabel);
          return {
            ok: false,
            error: `No salary slip or incentive record found for ${exact.fullName} (${exact.employeeId}) in ${formatMonthLabel(resolved.requestedMonthKey)} or any other uploaded month. Uploaded salary slip months in workspace: ${globalSlipMonths.join(', ') || 'None'}.`,
          };
        }

        env.onActionCard?.({
          type: 'whatsapp',
          titleMr: `${exact.fullName} — WhatsApp स्लिप डिस्पॅच`,
          monthLabel: item.monthLabel,
          items: [item],
          totalMatched: 1,
          missingPhoneCount: item.hasPhone ? 0 : 1,
        });

        const docLabelMr = item.docType === 'SALARY_SLIP' ? 'सॅलरी स्लिप' : 'इन्सेंटिव्ह स्टेटमेंट';
        const fallbackPrefix = resolved.fallbackReasonMr ? `${resolved.fallbackReasonMr} ` : '';
        return {
          ok: true,
          employeeId: exact.employeeId,
          employeeName: exact.fullName,
          monthKey: resolved.effectiveMonthKey,
          docType: item.docType,
          amountLabel: item.amountLabel,
          hasPhone: item.hasPhone,
          directReplyMr: item.hasPhone
            ? `${fallbackPrefix}${exact.fullName} यांची ${item.monthLabel} ची ${docLabelMr} (${item.amountLabel}) WhatsApp वर पाठवण्यासाठी तयार आहे. खालील हिरव्या 'WhatsApp वर पाठवा' बटणावर क्लिक करा.`
            : `${fallbackPrefix}${exact.fullName} यांची ${item.monthLabel} ची ${docLabelMr} तयार केली आहे, पण त्यांचा मोबाईल नंबर सेव्ह नाही. तुम्ही खालील बटणावरून नंबर निवडून पाठवू शकता किंवा त्यांचा नंबर सांगा म्हणजे मी सेव्ह करते.`,
        };
      }

      // Mode B: Branch / Department bulk WhatsApp queue
      let targetBranch: Branch | null = null;
      if (branchRaw && branchRaw.toUpperCase() !== 'ALL') {
        targetBranch = resolveBranchMatch(branchRaw, env.branches);
        if (!targetBranch) {
          return {
            ok: false,
            error: `Branch "${branchRaw}" not found.`,
            availableBranches: env.branches.map((b) => b.branchName),
          };
        }
      }
      const resolvedDept =
        deptRaw && deptRaw.toUpperCase() !== 'ALL' ? resolveDepartmentSelection(deptRaw) : null;

      const matchesBranch = (emp: Employee): boolean => {
        if (!targetBranch) return true;
        if (emp.branchId.trim().toUpperCase() === targetBranch.branchId.trim().toUpperCase()) return true;
        return normalizeBranchKey(emp.branchName || '') === normalizeBranchKey(targetBranch.branchName);
      };

      const matchesDepartment = (emp: Employee): boolean => {
        if (!resolvedDept) return true;
        const empDeptId = emp.departmentId || resolveDepartmentSelection(emp.departmentName || '').departmentId;
        if (resolvedDept.departmentId) {
          if (empDeptId === resolvedDept.departmentId) return true;
          // Also check if employee's latest salary slip carries the matching department
          const slipWithDept = env.salarySlips.find(
            (s) =>
              matchesEmpRecord(s.employeeId, emp) &&
              (s.departmentId === resolvedDept.departmentId ||
                resolveDepartmentSelection(s.departmentName || '').departmentId === resolvedDept.departmentId),
          );
          return Boolean(slipWithDept);
        }
        if (resolvedDept.departmentName) {
          return (emp.departmentName || '')
            .toLowerCase()
            .includes(resolvedDept.departmentName.toLowerCase());
        }
        return true;
      };

      const branchActiveStaff = env.employees.filter((e) => e.status === 'ACTIVE' && matchesBranch(e));
      const filteredStaff = branchActiveStaff.filter(matchesDepartment);

      if (filteredStaff.length === 0) {
        const scopeDesc = [targetBranch?.branchName, resolvedDept?.departmentName].filter(Boolean).join(' · ');
        return {
          ok: false,
          error: resolvedDept
            ? `${targetBranch?.branchName || 'All Branches'} has 0 ACTIVE employees assigned to ${resolvedDept.departmentName} in Employee Master (branch has ${branchActiveStaff.length} total ACTIVE employees).`
            : `No ACTIVE employees found in ${scopeDesc || 'selected scope'}.`,
          directReplyMr: resolvedDept
            ? `${targetBranch?.branchName || 'निवडलेल्या शाखेत'} सध्या ${resolvedDept.departmentName} विभागात एकही Active कर्मचारी नेमलेला नाही (शाखेत एकूण ${branchActiveStaff.length} Active कर्मचारी आहेत).`
            : `${scopeDesc || 'निवडलेल्या शाखेत'} एकही Active कर्मचारी सापडला नाही.`,
        };
      }

      const resolved = resolveItemsWithSmartFallback(filteredStaff);
      const monthKey = resolved.effectiveMonthKey;
      env.onLiveStatus(`WhatsApp डिस्पॅच यादी तयार करत आहे (${formatMonthLabel(monthKey)})...`);
      const allItems = resolved.items;

      if (allItems.length === 0) {
        const branchSlipMonths = Array.from(
          new Set(
            env.salarySlips
              .filter((s) => !targetBranch || s.branchId === targetBranch.branchId)
              .map((s) => s.monthKey),
          ),
        )
          .sort((a, b) => b.localeCompare(a))
          .slice(0, 4)
          .map(formatMonthLabel);
        const branchIncMonths = Array.from(
          new Set(
            env.monthlySummaries
              .filter((s) => s.sourceType !== 'NO_DATA' && (!targetBranch || s.branchId === targetBranch.branchId))
              .map((s) => s.monthKey),
          ),
        )
          .sort((a, b) => b.localeCompare(a))
          .slice(0, 4)
          .map(formatMonthLabel);
        const scopeLabelErr =
          [targetBranch?.branchName, resolvedDept?.departmentName].filter(Boolean).join(' · ') || 'निवडलेली शाखा';
        return {
          ok: false,
          matchedStaffCount: filteredStaff.length,
          branchSalarySlipMonths: branchSlipMonths,
          branchIncentiveMonths: branchIncMonths,
          error: `Found ${filteredStaff.length} ACTIVE staff in ${scopeLabelErr}, but none of them have any published Salary Slip or Incentive records in ${formatMonthLabel(resolved.requestedMonthKey)} or any other month. Branch salary slip months: ${branchSlipMonths.join(', ') || 'None'}. Branch incentive months: ${branchIncMonths.join(', ') || 'None'}.`,
          directReplyMr: `${scopeLabelErr} मधील ${filteredStaff.length} कर्मचाऱ्यांसाठी सध्या कोणतीही सॅलरी स्लिप किंवा इन्सेंटिव्ह नोंद अपलोड केलेली नाही.${branchSlipMonths.length > 0 ? ` या शाखेसाठी सॅलरी स्लिप फक्त ${branchSlipMonths.join(', ')} महिन्यांच्या आहेत.` : ' कृपया आधी या शाखेची सॅलरी शीट अपलोड करा.'}`,
        };
      }

      const missingPhoneCount = allItems.filter((i) => !i.hasPhone).length;
      const scopeLabel =
        [targetBranch?.branchName, resolvedDept?.departmentName].filter(Boolean).join(' · ') || 'सर्व शाखा';
      const usedDocLabelMr = allItems.every((i) => i.docType === 'INCENTIVE_SUMMARY')
        ? 'इन्सेंटिव्ह स्टेटमेंट'
        : 'सॅलरी स्लिप';
      const fallbackPrefix = resolved.fallbackReasonMr ? `${resolved.fallbackReasonMr} ` : '';

      env.onActionCard?.({
        type: 'whatsapp',
        titleMr: `${scopeLabel} — WhatsApp स्लिप डिस्पॅच`,
        monthLabel: formatMonthLabel(monthKey),
        items: allItems.slice(0, 12),
        totalMatched: allItems.length,
        missingPhoneCount,
      });

      return {
        ok: true,
        scope: scopeLabel,
        monthKey,
        totalMatched: allItems.length,
        readyWithPhone: allItems.length - missingPhoneCount,
        missingPhoneCount,
        fallbackNote: resolved.fallbackReasonMr || undefined,
        directReplyMr: `${fallbackPrefix}${scopeLabel} मधील ${allItems.length} कर्मचाऱ्यांच्या ${formatMonthLabel(monthKey)} च्या ${usedDocLabelMr} WhatsApp लिंक्स खाली तयार केल्या आहेत. एका क्लिकवर पाठवू शकता.`,
      };
    }

    // 16. PRO TOOL: EXECUTIVE MORNING / MANAGEMENT BUSINESS BRIEFING
    if (toolName === 'get_executive_briefing') {
      const branchRaw = asStr(args.branch);
      let targetBranch: Branch | null = null;
      if (branchRaw && branchRaw.toUpperCase() !== 'ALL') {
        targetBranch = resolveBranchMatch(branchRaw, env.branches);
        if (!targetBranch) {
          return {
            ok: false,
            error: `Branch "${branchRaw}" not found.`,
            availableBranches: env.branches.map((b) => b.branchName),
          };
        }
      }

      const rawMonth = asStr(args.monthKey);
      const latestAvailableMonth = (() => {
        if (rawMonth) return normalizeMonthInput(rawMonth);
        const allMonths = Array.from(
          new Set([
            ...env.monthlySummaries.filter((s) => s.sourceType !== 'NO_DATA').map((s) => s.monthKey),
            ...env.salarySlips.map((s) => s.monthKey),
          ]),
        ).sort((a, b) => b.localeCompare(a));
        return allMonths[0] || getCurrentMonthKeyIST();
      })();

      env.onLiveStatus(`मॅनेजमेंट बिझनेस ब्रीफिंग तयार करत आहे (${formatMonthLabel(latestAvailableMonth)})...`);

      const scopedBranches = targetBranch ? [targetBranch] : env.branches;
      const scopedEmployees = targetBranch
        ? env.employees.filter((e) => e.branchId === targetBranch!.branchId)
        : env.employees;
      const scopedSummaries = targetBranch
        ? env.monthlySummaries.filter((s) => s.branchId === targetBranch!.branchId)
        : env.monthlySummaries;
      const scopedSlips = targetBranch
        ? env.salarySlips.filter((s) => s.branchId === targetBranch!.branchId)
        : env.salarySlips;

      const pnl = computeBranchPnlAnalytics({
        branches: scopedBranches,
        employees: scopedEmployees,
        monthlySummaries: scopedSummaries,
        salarySlips: scopedSlips,
        selectedMonth: latestAvailableMonth,
      });

      const streaks = computePerformanceStreaksAndRetention({
        employees: scopedEmployees,
        monthlySummaries: scopedSummaries,
        salesTargets: env.salesTargets,
      });

      const attendance = computeAttendanceOtAttritionAnalytics({
        branches: scopedBranches,
        employees: scopedEmployees,
        salarySlips: scopedSlips,
        selectedMonth: latestAvailableMonth,
      });

      // Pending payouts for target month
      const monthSummaries = scopedSummaries.filter(
        (s) => s.monthKey === latestAvailableMonth && s.sourceType !== 'NO_DATA',
      );
      const payoutByEmp = new Map(
        env.payoutRecords
          .filter((p) => p.monthKey === latestAvailableMonth)
          .map((p) => [p.employeeId.toUpperCase(), p]),
      );
      let pendingPayoutCount = 0;
      let pendingPayoutPaise = 0;
      for (const s of monthSummaries) {
        const rec = payoutByEmp.get(s.employeeId.toUpperCase());
        if (!rec || rec.status !== 'PAID') {
          pendingPayoutCount += 1;
          pendingPayoutPaise += rec ? rec.netPayablePaise : s.grandTotalPaise;
        }
      }

      const monthSlips = scopedSlips.filter((s) => s.monthKey === latestAvailableMonth);
      const totalSalaryNetPaise = monthSlips.reduce((acc, s) => acc + s.netPayablePaise, 0);

      const openQueriesCount = env.employeeQueries.filter(
        (q) => q.status === 'OPEN' && (!targetBranch || q.branchId === targetBranch.branchId),
      ).length;
      const activeLoans = env.employeeLoans.filter(
        (l) => l.status === 'ACTIVE' && (!targetBranch || l.branchId === targetBranch.branchId),
      );
      const activeLoansBalancePaise = activeLoans.reduce((acc, l) => acc + l.remainingBalancePaise, 0);

      const topBranches = pnl.rows
        .filter((r) => r.totalSalesPaise > 0 || r.totalIncentivePaise > 0)
        .slice()
        .sort((a, b) => b.totalSalesPaise - a.totalSalesPaise || b.totalIncentivePaise - a.totalIncentivePaise)
        .slice(0, 3)
        .map((r) => ({
          branchName: r.branchName,
          salesLabel: formatINRFromPaise(r.totalSalesPaise),
          incentiveLabel: formatINRFromPaise(r.totalIncentivePaise),
        }));

      const starPerformers = streaks.starPerformers.slice(0, 3).map((st) => ({
        employeeName: st.employeeName,
        branchName: st.branchName,
        streakMonths: st.consecutiveTargetMetMonths,
      }));

      const briefingCard: VoiceExecutiveBriefingCard = {
        type: 'briefing',
        monthKey: latestAvailableMonth,
        monthLabel: formatMonthLabel(latestAvailableMonth),
        branchScopeLabel: targetBranch ? targetBranch.branchName : `सर्व ${scopedBranches.length} शाखा`,
        totalSalesLabel: formatINRFromPaise(pnl.companyTotals.totalSalesPaise),
        totalIncentiveLabel: formatINRFromPaise(pnl.companyTotals.totalIncentivePaise),
        totalSalaryNetLabel: formatINRFromPaise(totalSalaryNetPaise),
        costToSalesPct: pnl.companyTotals.costToSalesPct,
        pendingPayoutCount,
        pendingPayoutLabel: formatINRFromPaise(pendingPayoutPaise),
        openQueriesCount,
        activeLoansCount: activeLoans.length,
        activeLoansBalanceLabel: formatINRFromPaise(activeLoansBalancePaise),
        topBranches,
        starPerformers,
        coachingAlertsCount: streaks.coachingAlerts.length,
        highLopCount: attendance.highLopAlerts.length,
      };

      env.onActionCard?.(briefingCard);

      const topBranchesSentence =
        topBranches.length > 0
          ? `टॉप शाखा: ${topBranches.map((b, idx) => `${idx + 1}. ${b.branchName} (${b.salesLabel})`).join(', ')}. `
          : '';
      const alertBits: string[] = [];
      if (pendingPayoutCount > 0) {
        alertBits.push(`${pendingPayoutCount} पेआउट्स (${briefingCard.pendingPayoutLabel}) प्रलंबित`);
      }
      if (openQueriesCount > 0) {
        alertBits.push(`${openQueriesCount} कर्मचाऱ्यांच्या शंका ओपन`);
      }
      if (streaks.coachingAlerts.length > 0) {
        alertBits.push(`${streaks.coachingAlerts.length} कर्मचाऱ्यांचा सेल घसरला आहे`);
      }
      const alertSentence =
        alertBits.length > 0
          ? `लक्ष देण्यासारखे मुद्दे: ${alertBits.join(', ')}.`
          : 'सर्व पेआउट्स आणि शंका पूर्णपणे नियंत्रणात आहेत.';

      return {
        ok: true,
        briefing: briefingCard,
        directReplyMr: `${briefingCard.monthLabel} (${briefingCard.branchScopeLabel}) बिझनेस रिपोर्ट: एकूण विक्री ${briefingCard.totalSalesLabel}, एकूण इन्सेंटिव्ह ${briefingCard.totalIncentiveLabel} आणि निव्वळ पगार ${briefingCard.totalSalaryNetLabel} आहे. ${topBranchesSentence}${alertSentence}`,
      };
    }

    return { ok: false, error: `Unknown tool "${toolName}".` };
  } catch (err) {
    return {
      ok: false,
      error: formatErrorForAssistant(err),
    };
  }
}

export function buildVoiceClientContext(params: {
  activeTab: string;
  isMainOwner: boolean;
  actorLabel: string;
  branches: Branch[];
  employees: Employee[];
  monthlySummaries: MonthlySummary[];
  salarySlips: SalarySlip[];
  payrollLockSettings: PayrollLockSettings;
  linkedFolder: LinkedLocalFolderState;
}) {
  const availableIncentiveMonths = Array.from(
    new Set(params.monthlySummaries.filter((s) => s.sourceType !== 'NO_DATA').map((s) => s.monthKey)),
  )
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 24);
  const availableSalaryMonths = Array.from(new Set(params.salarySlips.map((s) => s.monthKey)))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 24);

  return {
    activeTab: params.activeTab,
    isMainOwner: params.isMainOwner,
    actorLabel: params.actorLabel,
    todayIst: getTodayIST(),
    currentMonthKey: getCurrentMonthKeyIST(),
    branches: params.branches.map((b) => ({
      branchId: b.branchId,
      branchCode: b.branchCode,
      branchName: b.branchName,
    })),
    departments: OFFICIAL_DEPARTMENTS.map((d) => ({ id: d.id, name: d.name })),
    nonSalesDepartments: [
      'Head Office',
      'Accounts',
      'HR & Admin',
      'Billing & Cash',
      'Store Operations',
      'Management',
      'Housekeeping',
      'Security',
    ],
    employeeCount: params.employees.length,
    activeEmployeeCount: params.employees.filter((e) => e.status === 'ACTIVE').length,
    availableIncentiveMonths,
    availableSalaryMonths,
    lockedMonths: params.payrollLockSettings.lockedMonths || [],
    folderLinked: params.linkedFolder.linked,
    folderName: params.linkedFolder.folderName,
    folderFiles: params.linkedFolder.files.slice(0, 80).map((f) => f.name),
  };
}
