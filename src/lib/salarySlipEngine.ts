import {
  normalizeNonSalesDepartmentName,
  resolveCanonicalDepartment,
  type OfficialDepartment,
} from './departmentLeaderboardEngine';
import { resolveCanonicalBranchName } from './incentiveEngine';
import type {
  DepartmentId,
  Employee,
  SalarySlip,
  SalarySlipPaymentMode,
} from '../types/incentive';

export function buildSalarySlipId(monthKey: string, employeeId: string): string {
  return `${monthKey.trim()}__${employeeId.trim()}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

const EXCEL_ERROR_TOKEN_RE = /^(#N\/A|#REF!|#VALUE!|#NAME\?|#DIV\/0!|#NUM!|#NULL!|N\/A|NA|-|--)$/i;

const NON_SALE_ID_KEYWORDS = new Set([
  'BILLING',
  'HELPER',
  'MANAGER',
  'MANGR',
  'SM',
  'HK',
  'HOUSEKEEPING',
  'DRIVER',
  'DRVIER',
  'INVENTOR',
  'INVENTORY',
  'SALE',
  'SALES',
  'NEW',
  'LEFT',
  'NONE',
  'NIL',
  'NA',
  'CASHIER',
  'SECURITY',
  'CLEANER',
  'TAILOR',
  'OFFICE',
  'HO',
  'ADMIN',
  'HR',
  'ACCOUNT',
  'ACCOUNTS',
  'STORE',
  'TRAINEE',
  'ONROLL',
  'SUPERVISOR',
  'WATCHMAN',
  'PEON',
  'GUARD',
  'PACKING',
  'DISPATCH',
  'GODOWN',
  'RECEPTION',
  'MARKETING',
  'TELECALLER',
  'AUDIT',
  'IT',
  'EDP',
  'FLOOR',
  'FLOORMANAGER',
  'ASST',
  'ASSISTANT',
  'STAFF',
  'EMPLOYEE',
  'EMP',
  'WORKER',
  'OTHER',
  'MISC',
  'TEMP',
  'TEMPORARY',
  'INTERN',
  'CEO',
  'MD',
  'DIRECTOR',
  'OWNER',
]);

/**
 * Cleans Excel formula error tokens (`#N/A`, `#REF!`, `#VALUE!`, `N/A`, `-`, `--`)
 * into clean blank strings so they never pollute Employee Master or PDF Salary Slips.
 */
export function cleanExcelTextCell(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s || EXCEL_ERROR_TOKEN_RE.test(s)) return '';
  return s;
}

/**
 * Sanitizes a raw POS `SELL ID` / `Sale ID` cell:
 * - Strips Excel numeric `.00` suffixes (e.g. `2216.00` -> `2216`, `0.00` -> `""`)
 * - Ignores Excel error tokens (`#N/A`) and non-ID role/designation labels (`BILLING`, `HELPER`, `HK`, `MANAGER`, `NEW`, etc.)
 */
export function sanitizeSaleIdCell(raw: unknown): string {
  const text = cleanExcelTextCell(raw);
  if (!text) return '';
  // Strip trailing .0 / .00 from Excel numeric export (e.g., "2216.00" -> "2216")
  const withoutTrailingDecimal = text.replace(/^(\d+)\.0+$/, '$1');
  const compact = withoutTrailingDecimal
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 40);
  if (!compact || /^0+$/.test(compact) || NON_SALE_ID_KEYWORDS.has(compact)) {
    return '';
  }
  return compact;
}

/**
 * Privacy-safe bank account masking: converts full account numbers (e.g. 123456789012 or 44035408025.00)
 * into `XXXX9012` / `XXXX8025`, while keeping already-masked values intact and ignoring `#N/A`.
 */
export function maskBankAccountNumber(raw?: string | null): string {
  const base = cleanExcelTextCell(raw);
  if (!base) return '';
  const cleaned = base.replace(/\s+/g, '').replace(/^(\d+)\.0+$/, '$1');
  if (!cleaned) return '';
  if (/^X+\d{2,6}$/i.test(cleaned)) {
    return cleaned.toUpperCase().slice(0, 32);
  }
  const digits = cleaned.replace(/[^0-9]/g, '');
  if (digits.length >= 4) {
    return `XXXX${digits.slice(-4)}`;
  }
  return cleaned.slice(0, 32);
}

/**
 * Converts integer paise to clean Indian English words for official Salary Slip PDFs.
 * Example: 1850000 paise -> "Rupees Eighteen Thousand Five Hundred Only"
 */
export function paiseToIndianWords(paise: number): string {
  const safePaise = Math.round(Math.abs(paise || 0));
  const rupees = Math.floor(safePaise / 100);
  const remPaise = safePaise % 100;

  const ones = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const twoDigitWords = (n: number): string => {
    if (n === 0) return '';
    if (n < 20) return ones[n];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o ? `${tens[t]} ${ones[o]}` : tens[t];
  };

  const threeDigitWords = (n: number): string => {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    const parts: string[] = [];
    if (h > 0) parts.push(`${ones[h]} Hundred`);
    if (rest > 0) parts.push(twoDigitWords(rest));
    return parts.join(' ');
  };

  const intToIndian = (num: number): string => {
    if (num === 0) return 'Zero';
    const crore = Math.floor(num / 10_000_000);
    const lakh = Math.floor((num % 10_000_000) / 100_000);
    const thousand = Math.floor((num % 100_000) / 1_000);
    const hundredRest = num % 1_000;

    const parts: string[] = [];
    if (crore > 0) parts.push(`${intToIndian(crore)} Crore`);
    if (lakh > 0) parts.push(`${twoDigitWords(lakh)} Lakh`);
    if (thousand > 0) parts.push(`${twoDigitWords(thousand)} Thousand`);
    if (hundredRest > 0) parts.push(threeDigitWords(hundredRest));
    return parts.join(' ');
  };

  const prefix = paise < 0 ? 'Minus ' : '';
  const rupeePart = `Rupees ${intToIndian(rupees)}`;
  if (remPaise > 0) {
    return `${prefix}${rupeePart} And ${twoDigitWords(remPaise)} Paise Only`;
  }
  return `${prefix}${rupeePart} Only`;
}

export function normalizeSalaryPaymentMode(raw?: string | null): SalarySlipPaymentMode {
  const cleaned = cleanExcelTextCell(raw);
  if (!cleaned) return '';
  const compact = cleaned
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (!compact) return '';
  if (compact === 'DCR' || compact.includes('DIRECTCREDIT')) return 'DCR';
  if (compact.includes('NEFT') || compact.includes('RTGS') || compact.includes('IMPS')) return 'NEFT';
  if (compact.includes('BANK') || compact.includes('TRANSFER') || compact.includes('ACCOUNT')) return 'BANK';
  if (compact.includes('UPI') || compact.includes('GPAY') || compact.includes('PHONEPE')) return 'UPI';
  if (compact.includes('CASH')) return 'CASH';
  if (compact.includes('CHEQUE') || compact.includes('CHECK') || compact.includes('CHQ')) return 'CHEQUE';
  return 'BANK';
}

function parseNumericField(raw: unknown): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : NaN;
  }
  const str = String(raw ?? '')
    .trim()
    .replace(/₹|Rs\.?|INR|,|\s/gi, '');
  if (!str || str === '-' || str === '--') return 0;
  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function rupeesToPaise(val: number): number {
  return Math.round(val * 100);
}

export function normalizeMonthKeyFromCell(raw?: string | null, fallbackMonthKey = ''): string {
  const s = String(raw || '').trim();
  if (!s) return fallbackMonthKey;
  if (/^\d{4}-\d{2}$/.test(s)) return s;

  // Match "Oct-2026", "Oct 2026", "October 2026", "10-2026", "10/2026"
  const monthNames: Record<string, string> = {
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

  const wordMatch = s.match(/^([a-zA-Z]+)[\s\-/]+(\d{4})$/);
  if (wordMatch) {
    const mm = monthNames[wordMatch[1].toLowerCase()];
    if (mm) return `${wordMatch[2]}-${mm}`;
  }
  const numMatch = s.match(/^(\d{1,2})[\-/](\d{4})$/);
  if (numMatch) {
    const mmNum = Number(numMatch[1]);
    if (mmNum >= 1 && mmNum <= 12) {
      return `${numMatch[2]}-${String(mmNum).padStart(2, '0')}`;
    }
  }
  return fallbackMonthKey;
}

export type SalaryRowErrorCode =
  | 'EMPLOYEE_NOT_FOUND'
  | 'INVALID_MONTH'
  | 'DUPLICATE_IN_FILE'
  | 'INVALID_ATTENDANCE'
  | 'INVALID_MONEY'
  | 'ZERO_GROSS'
  | 'NEGATIVE_NET'
  | 'INVALID_DEPARTMENT';

export interface ParsedSalaryRow {
  rowNumber: number;
  status: 'VALID' | 'ERROR' | 'DUPLICATE_IN_FILE';
  errorCode?: SalaryRowErrorCode;
  errorMessage: string;
  monthKey: string;
  employeeId: string;
  saleId: string;
  matchedEmployee: Employee | null;
  employeeName: string;
  branchId: string;
  branchName: string;
  rawBranch: string;
  resolvedDepartment: OfficialDepartment | null;
  customDepartmentName: string;
  rawDepartment: string;
  designation: string;
  gender: string;
  category: string;
  dateOfJoining: string;
  panNumber: string;
  uanNumber: string;
  pfNumber: string;
  esicNumber: string;
  bankName: string;
  bankAccountMasked: string;
  bankIfsc: string;
  totalDays: number;
  presentDays: number;
  paidDays: number;
  lopDays: number;
  weeklyOffDays: number;
  paidLeaveDays: number;
  overtimeDays: number;
  overtimeHours: number;
  monthlySalaryRatePaise: number;
  monthlyGrossRatePaise: number;
  basicPaise: number;
  dearnessAllowancePaise: number;
  hraPaise: number;
  attendanceAllowancePaise: number;
  washingAllowancePaise: number;
  conveyancePaise: number;
  medicalAllowancePaise: number;
  leaveTravelAllowancePaise: number;
  communicationExpensesPaise: number;
  healthClubAllowancePaise: number;
  adhocAllowancePaise: number;
  travelingAllowancePaise: number;
  salesCommissionPaise: number;
  specialAllowancePaise: number;
  overtimePaise: number;
  incentivePaise: number;
  arrearsPaise: number;
  otherEarningsPaise: number;
  grossEarningsPaise: number;
  pfPaise: number;
  esicPaise: number;
  ptPaise: number;
  lwfPaise: number;
  advanceRecoveryPaise: number;
  tdsPaise: number;
  penaltyPaise: number;
  insurancePaise: number;
  otherDeductionPaise: number;
  totalDeductionsPaise: number;
  netPayablePaise: number;
  sheetCrossCheckWarning: string;
  paymentMode: SalarySlipPaymentMode;
  paymentReference: string;
  paymentDate: string;
  remarks: string;
  willSyncDepartment: boolean;
  willSyncMasterFields: boolean;
}

export interface SalarySheetParseSummary {
  rows: ParsedSalaryRow[];
  validRows: ParsedSalaryRow[];
  errorRows: ParsedSalaryRow[];
  duplicateRows: ParsedSalaryRow[];
  departmentSyncCount: number;
  masterSyncCount: number;
  totalGrossPaise: number;
  totalDeductionsPaise: number;
  totalNetPaise: number;
}

export type RawSalaryInputRow = {
  rowNumber: number;
  cells: Record<string, unknown>;
};

function normHeader(h: string): string {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Safely picks a cell value by normalized header name:
 * 1. Checks exact normalized header names first (including short codes like `pl`, `ta`, `da`, `wo`, `pf`, `pt`).
 * 2. Only falls back to partial substring matching for descriptive patterns (length >= 4)
 *    that are NOT in `excludePatterns` — eliminating false-positive collisions such as
 *    `pl` matching `employeeid`, `ta` matching `totaldays`, or `tax` matching `professionaltax`.
 */
function pickCellValue(
  normalizedCells: Map<string, unknown>,
  exactKeys: string[],
  partialPatterns: string[] = [],
  excludePatterns: string[] = [],
): unknown {
  // 1. Exact key match first
  for (const key of exactKeys) {
    if (normalizedCells.has(key)) return normalizedCells.get(key);
  }
  // 2. Safe partial contains match (only descriptive >= 4-char patterns)
  const safePartials = partialPatterns.filter((p) => p.length >= 4);
  if (safePartials.length === 0) return '';
  for (const [key, val] of normalizedCells.entries()) {
    if (excludePatterns.some((ex) => key.includes(ex))) continue;
    if (safePartials.some((p) => key.includes(p))) return val;
  }
  return '';
}

/**
 * Normalizes Excel Date objects, DD-MM-YYYY, DD/MM/YYYY, or ISO date cells into clean YYYY-MM-DD (IST).
 */
export function normalizeDateCellToIso(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '';
  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(raw);
  }
  const s = String(raw).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    const yyyy = dmy[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  const ymd = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  }
  return s.slice(0, 20);
}

const SALARY_HEADER_SIGNALS = [
  'employeeid',
  'empid',
  'empcode',
  'staffid',
  'loginid',
  'sellid',
  'saleid',
  'salesmanno',
  'employeename',
  'salespersonname',
  'basicsalary',
  'basicpay',
  'basic',
  'dearnessallowance',
  'hra',
  'attendanceallow',
  'attendanceallowance',
  'washingallow',
  'washingallowance',
  'convenienceallowance',
  'conveyanceallow',
  'conveyanceallowance',
  'medicalallow',
  'medicalallowance',
  'ltaallow',
  'leavetravelallowance',
  'commexpense',
  'communicationexpanses',
  'communicationexpenses',
  'healthcluballow',
  'healthcluballowance',
  'advochallow',
  'adhocallowance',
  'travallingallowance',
  'travelingallowance',
  'travellingallowance',
  'salescommision',
  'salescommotion',
  'salescommission',
  'insentive',
  'arrears',
  'earngross',
  'department',
  'monthsday',
  'presentdays',
  'paiddays',
  'totaldays',
  'otdays',
  'gross',
  'netpay',
  'netsalary',
  'pfdeduction',
  'providentfund',
  'profetionaltax',
  'professionaltax',
  'lwf',
  'penalty',
  'insurance',
  'totaldeduction',
  'paymonth',
];

/**
 * Scans the first up to 10 rows of a CSV or Excel worksheet to find the real header row,
 * safely skipping company title banners (Row 1 / Row 2) before column headers.
 */
export function detectSalaryHeaderRowIndex(rows: unknown[][]): number {
  const maxScan = Math.min(10, rows.length);
  let bestIdx = 0;
  let bestScore = -1;

  for (let r = 0; r < maxScan; r += 1) {
    const cells = (rows[r] || [])
      .map((c) => normHeader(String(c ?? '')))
      .filter(Boolean);
    if (cells.length < 2) continue;

    let score = 0;
    for (const cell of cells) {
      if (SALARY_HEADER_SIGNALS.some((sig) => cell === sig || (sig.length >= 5 && cell.includes(sig)))) {
        score += 3;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = r;
    }
  }

  return bestIdx;
}

function getDaysInMonth(monthKey: string): number {
  const m = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!m) return 30;
  return new Date(Number(m[1]), Number(m[2]), 0).getDate();
}

export function parseSalarySheetRows(
  rawRows: RawSalaryInputRow[],
  employees: Employee[],
  defaultMonthKey: string,
): SalarySheetParseSummary {
  const empById = new Map<string, Employee>();
  const empByLogin = new Map<string, Employee>();
  for (const emp of employees) {
    empById.set(emp.employeeId.trim().toUpperCase(), emp);
    empByLogin.set(emp.loginId.trim().toUpperCase(), emp);
  }

  const seenEmployeeKeys = new Set<string>();
  const rows: ParsedSalaryRow[] = [];

  for (const raw of rawRows) {
    const normMap = new Map<string, unknown>();
    for (const [k, v] of Object.entries(raw.cells)) {
      const nk = normHeader(k);
      if (nk && !normMap.has(nk)) {
        normMap.set(nk, v);
      }
    }

    // Strict Salary matching: Prioritize official EMP ID / Employee ID — NEVER confuse with SELL ID when EMP ID is present
    const rawEmpId = cleanExcelTextCell(
      pickCellValue(
        normMap,
        ['employeeid', 'empid', 'empcode', 'staffid', 'loginid', 'salesmanno', 'id'],
        ['employeeid', 'empid', 'empcode', 'staffid', 'loginid', 'salesmanno'],
        ['sell', 'sale'],
      ),
    );
    const rawSaleId = sanitizeSaleIdCell(
      pickCellValue(
        normMap,
        ['sellid', 'saleid', 'sellcode', 'salecode', 'salesmanno', 'salesmancode'],
        ['sellid', 'saleid', 'salesmanno', 'salesmancode'],
      ),
    );
    const rawName = cleanExcelTextCell(
      pickCellValue(
        normMap,
        ['employeename', 'empname', 'salespersonname', 'fullname', 'staffname', 'name'],
        ['employeename', 'empname', 'salespersonname', 'fullname', 'staffname'],
        ['branch', 'bank', 'dept', 'department'],
      ),
    );

    // Skip blank or subtotal/total rows automatically
    const compactId = rawEmpId.toLowerCase();
    const compactName = rawName.toLowerCase();
    if (
      (!rawEmpId && !rawName) ||
      compactId === 'total' ||
      compactId === 'grand total' ||
      compactName === 'total' ||
      compactName === 'grand total'
    ) {
      continue;
    }

    const rawMonth = cleanExcelTextCell(
      pickCellValue(
        normMap,
        ['paymonth', 'monthkey', 'salarymonth', 'month'],
        ['paymonth', 'monthkey', 'salarymonth'],
        ['day', 'gross'],
      ),
    );
    const monthKey = normalizeMonthKeyFromCell(rawMonth, defaultMonthKey);
    const matched =
      empById.get(rawEmpId.toUpperCase()) || empByLogin.get(rawEmpId.toUpperCase()) || null;

    const rawBranchCell = cleanExcelTextCell(
      pickCellValue(
        normMap,
        ['branch', 'branchname', 'branchcode', 'location', 'showroom', 'store'],
        ['branchname', 'branchcode', 'branch'],
      ),
    );
    const rawBranch = rawBranchCell ? resolveCanonicalBranchName(rawBranchCell) : '';

    const rawDepartmentCandidate = cleanExcelTextCell(
      pickCellValue(
        normMap,
        ['department', 'deptname', 'dept', 'dep', 'section'],
        ['department', 'deptname', 'section'],
      ),
    );
    // Ignore status tags like "LEFT" inside the DEP column so we never overwrite real departments
    const rawDepartment =
      rawDepartmentCandidate.toUpperCase() === 'LEFT' ? '' : rawDepartmentCandidate;
    const resolvedDepartment = resolveCanonicalDepartment(rawDepartment);

    const designation = cleanExcelTextCell(
      pickCellValue(
        normMap,
        ['designation', 'role', 'post', 'position'],
        ['designation', 'position'],
      ),
    ).slice(0, 80);
    const gender = cleanExcelTextCell(
      pickCellValue(normMap, ['gender', 'sex'], ['gender']),
    ).slice(0, 20);
    const category = cleanExcelTextCell(
      pickCellValue(normMap, ['category', 'empcategory', 'staffcategory'], ['category']),
    ).slice(0, 40);
    const dateOfJoining = normalizeDateCellToIso(
      cleanExcelTextCell(
        pickCellValue(
          normMap,
          ['dateofjoining', 'doj', 'joiningdate', 'joindate'],
          ['dateofjoining', 'joiningdate', 'joindate'],
        ),
      ),
    ).slice(0, 20);
    const panNumber = cleanExcelTextCell(
      pickCellValue(normMap, ['pannumber', 'panno', 'pan'], ['pannumber', 'panno']),
    )
      .toUpperCase()
      .slice(0, 20);
    const uanNumber = cleanExcelTextCell(
      pickCellValue(normMap, ['uannumber', 'uanno', 'uan'], ['uannumber', 'uanno']),
    ).slice(0, 24);
    const pfNumber = cleanExcelTextCell(
      pickCellValue(
        normMap,
        ['pfaccountnumber', 'providentfundnumber', 'pfnumber', 'pfno', 'epfno', 'epfnumber'],
        ['pfaccountnumber', 'providentfundnumber', 'pfnumber', 'pfno', 'epfno'],
      ),
    ).slice(0, 32);
    const esicNumber = cleanExcelTextCell(
      pickCellValue(
        normMap,
        ['esicnumber', 'esicno', 'esino', 'esinumber'],
        ['esicnumber', 'esicno', 'esino', 'esinumber'],
      ),
    ).slice(0, 32);
    const bankName = cleanExcelTextCell(
      pickCellValue(
        normMap,
        ['bankname', 'bank'],
        ['bankname'],
        ['account', 'acc', 'ifsc'],
      ),
    ).slice(0, 80);
    const bankAccountMasked = maskBankAccountNumber(
      String(
        pickCellValue(
          normMap,
          ['bankaccountnumber', 'bankaccount', 'bankaccountno', 'bankacno', 'accountno', 'accountnumber', 'acno', 'accno'],
          ['bankaccountnumber', 'bankaccount', 'bankacno', 'accountno', 'accountnumber', 'acno', 'accno'],
        ),
      ),
    );
    const bankIfsc = cleanExcelTextCell(
      pickCellValue(
        normMap,
        ['bankifsccode', 'bankifsc', 'ifsccode', 'ifsc'],
        ['bankifsccode', 'bankifsc', 'ifsccode', 'ifsc'],
      ),
    )
      .toUpperCase()
      .slice(0, 20);

    // Attendance — supports BOTH House of Muktai 45-col payroll sheet (MONTHS DAY / PRESENT DAYS / W/O / TOTAL DAYS / OT DAYS)
    // AND standard template (Total Days / Paid Days / Loss of Pay Days / Weekly Off / Paid Leave / Overtime Hours)
    const defaultDays = getDaysInMonth(monthKey || defaultMonthKey);
    const rawMonthsDayCell = pickCellValue(
      normMap,
      ['monthsday', 'monthsdays', 'monthday', 'monthdays', 'calendardays'],
      ['monthsday', 'monthdays', 'calendardays'],
    );
    const rawTotalDaysColCell = pickCellValue(
      normMap,
      ['totaldays'],
      ['totaldays'],
    );
    const rawPaidDaysColCell = pickCellValue(
      normMap,
      ['paiddays', 'paydays', 'workeddays'],
      ['paiddays', 'paydays', 'workeddays'],
    );
    const rawPresentDaysCell = pickCellValue(
      normMap,
      ['presentdays', 'presentday', 'present'],
      ['presentdays', 'presentday'],
    );
    const rawLopDaysCell = pickCellValue(
      normMap,
      ['lossofpaydays', 'lossofpay', 'lopdays', 'absentdays', 'lop', 'absent'],
      ['lossofpaydays', 'lossofpay', 'lopdays', 'absentdays'],
    );
    const rawWeeklyOffCell = pickCellValue(
      normMap,
      ['weeklyoffdays', 'weeklyoff', 'weekoff', 'wo'],
      ['weeklyoff', 'weekoff'],
    );
    const rawPaidLeaveCell = pickCellValue(
      normMap,
      ['paidleavedays', 'paidleave', 'pl', 'cl'],
      ['paidleave'],
    );
    const rawOtDaysCell = pickCellValue(
      normMap,
      ['otdays', 'overtimedays', 'otday'],
      ['otdays', 'overtimedays'],
    );
    const rawOtHoursCell = pickCellValue(
      normMap,
      ['extradutyhours', 'overtimehours', 'othours', 'othrs'],
      ['extradutyhours', 'overtimehours', 'othours', 'othrs'],
    );

    const hasMonthsDay = String(rawMonthsDayCell ?? '').trim() !== '';
    const hasTotalDaysCol = String(rawTotalDaysColCell ?? '').trim() !== '';
    const hasPaidDaysCol = String(rawPaidDaysColCell ?? '').trim() !== '';
    const hasPresentDaysCol = String(rawPresentDaysCell ?? '').trim() !== '';
    const hasExplicitLopCol = String(rawLopDaysCell ?? '').trim() !== '';

    const monthsDayNum = parseNumericField(rawMonthsDayCell);
    const totalDaysColNum = parseNumericField(rawTotalDaysColCell);
    const paidDaysColNum = parseNumericField(rawPaidDaysColCell);
    const presentDaysNum = parseNumericField(rawPresentDaysCell);
    const lopDaysNum = parseNumericField(rawLopDaysCell);
    const weeklyOffNum = parseNumericField(rawWeeklyOffCell);
    const paidLeaveNum = parseNumericField(rawPaidLeaveCell);
    const overtimeDaysNum = parseNumericField(rawOtDaysCell);
    const overtimeHoursNum = parseNumericField(rawOtHoursCell);

    const attendanceNums = [
      monthsDayNum,
      totalDaysColNum,
      paidDaysColNum,
      presentDaysNum,
      lopDaysNum,
      weeklyOffNum,
      paidLeaveNum,
      overtimeDaysNum,
      overtimeHoursNum,
    ];
    const hasInvalidAttendance = attendanceNums.some((v) => !Number.isFinite(v) || v < 0);

    // When MONTHS DAY is provided (user's 45-col sheet): MONTHS DAY = Calendar Total Days, TOTAL DAYS = Paid Days (PRESENT DAYS + W/O)
    const totalDays = hasMonthsDay
      ? Number.isFinite(monthsDayNum)
        ? monthsDayNum
        : defaultDays
      : hasTotalDaysCol && Number.isFinite(totalDaysColNum)
        ? totalDaysColNum
        : defaultDays;

    const weeklyOffDays = Number.isFinite(weeklyOffNum) && weeklyOffNum >= 0 ? weeklyOffNum : 0;
    const paidLeaveDays = Number.isFinite(paidLeaveNum) && paidLeaveNum >= 0 ? paidLeaveNum : 0;
    const presentDays =
      hasPresentDaysCol && Number.isFinite(presentDaysNum) && presentDaysNum >= 0
        ? presentDaysNum
        : 0;
    let overtimeDays =
      Number.isFinite(overtimeDaysNum) && overtimeDaysNum >= 0 ? overtimeDaysNum : 0;
    const overtimeHours =
      Number.isFinite(overtimeHoursNum) && overtimeHoursNum >= 0 ? overtimeHoursNum : 0;

    let paidDays: number;
    if (hasMonthsDay) {
      if (hasTotalDaysCol && Number.isFinite(totalDaysColNum)) {
        // In House of Muktai 45-column paysheets, TOTAL DAYS = PRESENT DAYS + W/O can reach 31–34
        // when staff work weekly-offs, with extra days paid separately in OT DAYS / OT.
        // Cap Paid Days at MONTHS DAY (30) and preserve extra days in overtimeDays.
        if (
          totalDaysColNum > totalDays &&
          totalDaysColNum <= 35 &&
          (overtimeDays > 0 ||
            (hasPresentDaysCol &&
              presentDaysNum <= totalDays &&
              Math.abs(presentDaysNum + weeklyOffDays - totalDaysColNum) <= 0.5))
        ) {
          paidDays = totalDays;
          if (overtimeDays === 0) {
            overtimeDays = Number((totalDaysColNum - totalDays).toFixed(2));
          }
        } else {
          paidDays = totalDaysColNum;
        }
      } else if (hasPaidDaysCol && Number.isFinite(paidDaysColNum)) {
        paidDays = paidDaysColNum;
      } else if (hasPresentDaysCol && Number.isFinite(presentDaysNum)) {
        paidDays = Math.min(totalDays, Number((presentDaysNum + weeklyOffDays).toFixed(2)));
      } else {
        const rawLop = Number.isFinite(lopDaysNum) && lopDaysNum >= 0 ? lopDaysNum : 0;
        paidDays = Math.max(0, Number((totalDays - rawLop).toFixed(2)));
      }
    } else if (hasPaidDaysCol && Number.isFinite(paidDaysColNum)) {
      paidDays = paidDaysColNum;
    } else if (hasPresentDaysCol && Number.isFinite(presentDaysNum)) {
      paidDays = presentDaysNum;
    } else {
      const rawLop = Number.isFinite(lopDaysNum) && lopDaysNum >= 0 ? lopDaysNum : 0;
      paidDays = Math.max(0, Number((totalDays - rawLop).toFixed(2)));
    }

    const lopDays = hasExplicitLopCol
      ? Number.isFinite(lopDaysNum) && lopDaysNum >= 0
        ? lopDaysNum
        : 0
      : hasMonthsDay
        ? Math.max(0, Number((totalDays - paidDays).toFixed(2)))
        : 0;

    const attendanceOutOfBounds =
      totalDays < 1 ||
      totalDays > 31 ||
      presentDays < 0 ||
      presentDays > 31 ||
      paidDays < 0 ||
      paidDays > 31 ||
      paidDays > totalDays ||
      lopDays < 0 ||
      lopDays > 31 ||
      weeklyOffDays < 0 ||
      weeklyOffDays > 31 ||
      paidLeaveDays < 0 ||
      paidLeaveDays > 31 ||
      overtimeDays < 0 ||
      overtimeDays > 31 ||
      overtimeHours > 500;

    // Reference Rate / CTC Columns (stored for reference ONLY — NEVER summed into grossEarningsPaise!)
    const monthlySalaryRateVal = parseNumericField(
      pickCellValue(normMap, ['salary', 'monthlysalary', 'ctcsalary', 'fixedsalary'], []),
    );
    const monthlyGrossRateVal = parseNumericField(
      pickCellValue(normMap, ['monthlygross', 'fixedgross', 'grossrate'], ['monthlygross']),
    );

    // Earnings (rupees -> paise) — all official House of Muktai payroll heads (including exact Excel spellings + Health Club Allow + Arrears)
    const basicVal = parseNumericField(
      pickCellValue(normMap, ['basicsalary', 'basicpay', 'basic'], ['basicsalary', 'basicpay']),
    );
    const dearnessVal = parseNumericField(
      pickCellValue(
        normMap,
        ['dearnessallowance', 'dearnessallow', 'dearness', 'da'],
        ['dearnessallowance', 'dearness'],
      ),
    );
    const hraVal = parseNumericField(
      pickCellValue(
        normMap,
        ['hra', 'houserentallowance', 'houserentallowancehra', 'houserentallow', 'houserent'],
        ['houserentallowance', 'houserent'],
      ),
    );
    const attendanceVal = parseNumericField(
      pickCellValue(
        normMap,
        ['attendanceallowance', 'attendanceallow', 'attendancebonus', 'attendancepay'],
        ['attendanceallowance', 'attendanceallow', 'attendancebonus'],
      ),
    );
    const washingVal = parseNumericField(
      pickCellValue(
        normMap,
        ['washingallowance', 'washingallow', 'washing'],
        ['washingallowance', 'washingallow', 'washing'],
      ),
    );
    const conveyanceVal = parseNumericField(
      pickCellValue(
        normMap,
        [
          'convenienceallowance',
          'convenienceallow',
          'conveyanceallowance',
          'conveyanceallow',
          'convenience',
          'conveyance',
        ],
        ['convenienceallow', 'conveyanceallow', 'convenience', 'conveyance'],
      ),
    );
    const medicalVal = parseNumericField(
      pickCellValue(
        normMap,
        ['medicalallowance', 'medicalallow', 'medical'],
        ['medicalallowance', 'medicalallow', 'medical'],
      ),
    );
    const ltaVal = parseNumericField(
      pickCellValue(
        normMap,
        ['leavetravelallowance', 'leavetravelallow', 'leavetravel', 'ltaallow', 'lta'],
        ['leavetravelallowance', 'leavetravel', 'ltaallow'],
      ),
    );
    const communicationVal = parseNumericField(
      pickCellValue(
        normMap,
        [
          'communicationexpanses',
          'communicationexpenses',
          'communicationallowance',
          'communicationexpense',
          'commexpense',
          'commexpenses',
          'commallow',
          'communication',
        ],
        ['communicationexpan', 'communicationexpen', 'communicationallow', 'commexpense', 'communication'],
      ),
    );
    const healthClubVal = parseNumericField(
      pickCellValue(
        normMap,
        ['healthcluballowance', 'healthcluballow', 'healthclub'],
        ['healthclub'],
      ),
    );
    const adhocVal = parseNumericField(
      pickCellValue(
        normMap,
        ['adhocallowance', 'adhocallow', 'advochallow', 'advochallowance', 'adhocpay', 'adhoc', 'advoch'],
        ['adhocallow', 'advochallow', 'adhoc', 'advoch'],
      ),
    );
    const travelingVal = parseNumericField(
      pickCellValue(
        normMap,
        [
          'travelingallowance',
          'travellingallowance',
          'travallingallowance',
          'travallingallow',
          'travelingallow',
          'travellingallow',
          'travelallowance',
          'traveling',
          'travelling',
          'ta',
        ],
        ['travelingallow', 'travellingallow', 'travallingallow', 'travelallowance'],
        ['leave'],
      ),
    );
    const salesCommVal = parseNumericField(
      pickCellValue(
        normMap,
        ['salescommotion', 'salescommission', 'salescommision', 'salescomm', 'commission', 'commision'],
        ['salescommotion', 'salescommission', 'salescommision', 'commission', 'commision'],
      ),
    );
    const specialVal = parseNumericField(
      pickCellValue(
        normMap,
        ['specialallowance', 'specialallow', 'special'],
        ['specialallowance', 'specialallow'],
      ),
    );
    const overtimeVal = parseNumericField(
      pickCellValue(
        normMap,
        ['overtime', 'overtimeamount', 'otamount', 'overtimepay', 'ot'],
        ['overtimeamount', 'otamount', 'overtimepay'],
        ['hours', 'hrs', 'days', 'day'],
      ),
    );
    const incentiveVal = parseNumericField(
      pickCellValue(
        normMap,
        ['incentive', 'insentive', 'incentivebonus', 'bonus'],
        ['incentive', 'insentive', 'bonus'],
        ['attendance'],
      ),
    );
    const arrearsVal = parseNumericField(
      pickCellValue(
        normMap,
        ['arrears', 'arrear', 'salaryarrears'],
        ['arrears', 'arrear'],
      ),
    );
    const otherEarnVal = parseNumericField(
      pickCellValue(
        normMap,
        ['otherearnings', 'otherallowance', 'otherallow', 'miscallowance'],
        ['otherearnings', 'otherallowance', 'miscallowance'],
        [
          'conveyance',
          'convenience',
          'special',
          'houserent',
          'dearness',
          'attendance',
          'washing',
          'medical',
          'travel',
          'travall',
          'communication',
          'commexpense',
          'healthclub',
          'adhoc',
          'advoch',
          'commission',
          'commision',
          'commotion',
          'arrear',
        ],
      ),
    );

    // Deductions (rupees -> paise) — strict exclusions prevent double-counting PF/PT/LWF/Penalty/Insurance/Total Deductions
    const pfVal = parseNumericField(
      pickCellValue(
        normMap,
        ['pfdeduction', 'providentfund', 'providentfundpf', 'epfdeduction', 'epf', 'pf'],
        ['pfdeduction', 'providentfund', 'epfdeduction'],
        ['number', 'no', 'uan', 'account'],
      ),
    );
    const esicVal = parseNumericField(
      pickCellValue(
        normMap,
        ['esicdeduction', 'esideduction', 'esic', 'esi'],
        ['esicdeduction', 'esideduction'],
        ['number', 'no'],
      ),
    );
    const ptVal = parseNumericField(
      pickCellValue(
        normMap,
        ['professionaltax', 'professionaltaxpt', 'profetionaltax', 'proftax', 'ptax', 'pt'],
        ['professionaltax', 'profetionaltax', 'proftax', 'ptax'],
      ),
    );
    const lwfVal = parseNumericField(
      pickCellValue(
        normMap,
        ['lwf', 'labourwelfarefund', 'laborwelfarefund', 'welfarefund'],
        ['labourwelfare', 'laborwelfare'],
      ),
    );
    const advanceVal = parseNumericField(
      pickCellValue(
        normMap,
        ['advancerecovery', 'salaryadvance', 'loanrecovery', 'advance', 'loan'],
        ['advancerecovery', 'salaryadvance', 'loanrecovery', 'advance'],
      ),
    );
    const tdsVal = parseNumericField(
      pickCellValue(
        normMap,
        ['tds', 'tdsdeduction', 'incometax', 'incometaxtds'],
        ['tdsdeduction', 'incometax'],
        ['prof', 'ptax'],
      ),
    );
    const penaltyVal = parseNumericField(
      pickCellValue(
        normMap,
        ['penalty', 'penalties', 'latepenalty'],
        ['penalty', 'penalties'],
      ),
    );
    const insuranceVal = parseNumericField(
      pickCellValue(
        normMap,
        ['insurance', 'mediclaim', 'healthinsurance', 'groupinsurance'],
        ['insurance', 'mediclaim'],
      ),
    );
    const otherDedVal = parseNumericField(
      pickCellValue(
        normMap,
        ['otherdeduction', 'otherdeductions', 'miscdeduction', 'latefine', 'uniform', 'fine'],
        ['otherdeduction', 'miscdeduction', 'latefine'],
        ['total', 'pf', 'esic', 'esi', 'prof', 'ptax', 'lwf', 'tds', 'tax', 'advance', 'loan', 'penalty', 'insurance'],
      ),
    );

    // Optional Excel summary columns for Pre-Publish Cross-Check (NEVER override computed paise math!)
    const sheetEarnGrossRaw = pickCellValue(normMap, ['earngross', 'earnedgross', 'grossearnings'], ['earngross', 'earnedgross']);
    const sheetTotalDedRaw = pickCellValue(normMap, ['totaldeduction', 'totaldeductions'], ['totaldeduction']);
    const sheetNetPayRaw = pickCellValue(normMap, ['netpay', 'netpayable', 'netsalary'], ['netpay', 'netsalary']);

    let rawPaymentModeCell = cleanExcelTextCell(
      pickCellValue(
        normMap,
        ['paymentmode', 'paymode', 'mode'],
        ['paymentmode', 'paymode'],
      ),
    );
    // Auto-detect unnamed trailing Payment Mode column (e.g. 45th column in ALL BRANCH PAYSHEET containing DCR / NEFT)
    if (!rawPaymentModeCell) {
      const UNNAMED_MODE_RE = /^(DCR|NEFT|RTGS|IMPS|UPI|CASH|CHEQUE|CHQ|BANK|BANKTRANSFER|DIRECTCREDIT)$/i;
      for (const [origKey, origVal] of Object.entries(raw.cells)) {
        const nk = normHeader(origKey);
        if (!nk || /^col\d+$/.test(nk)) {
          const candidate = cleanExcelTextCell(origVal);
          if (candidate && UNNAMED_MODE_RE.test(candidate.replace(/\s+/g, ''))) {
            rawPaymentModeCell = candidate;
            break;
          }
        }
      }
    }
    const paymentMode = normalizeSalaryPaymentMode(rawPaymentModeCell);
    const paymentReference = cleanExcelTextCell(
      pickCellValue(
        normMap,
        ['paymentreference', 'paymentref', 'utr', 'utrno', 'referenceno', 'refno', 'transactionid'],
        ['paymentreference', 'paymentref', 'utrno', 'referenceno', 'transactionid'],
      ),
    ).slice(0, 120);
    const paymentDate = normalizeDateCellToIso(
      cleanExcelTextCell(
        pickCellValue(
          normMap,
          ['paymentdate', 'paydate', 'paiddate', 'creditedon'],
          ['paymentdate', 'paydate', 'paiddate', 'creditedon'],
        ),
      ),
    ).slice(0, 30);
    const remarks = cleanExcelTextCell(
      pickCellValue(normMap, ['remarks', 'notes', 'comment'], ['remarks', 'comment']),
    ).slice(0, 240);

    const monthlySalaryRatePaise =
      Number.isFinite(monthlySalaryRateVal) && monthlySalaryRateVal > 0
        ? rupeesToPaise(monthlySalaryRateVal)
        : 0;
    const monthlyGrossRatePaise =
      Number.isFinite(monthlyGrossRateVal) && monthlyGrossRateVal > 0
        ? rupeesToPaise(monthlyGrossRateVal)
        : 0;

    let basicPaise = Number.isFinite(basicVal) && basicVal > 0 ? rupeesToPaise(basicVal) : 0;
    let dearnessAllowancePaise =
      Number.isFinite(dearnessVal) && dearnessVal > 0 ? rupeesToPaise(dearnessVal) : 0;
    let hraPaise = Number.isFinite(hraVal) && hraVal > 0 ? rupeesToPaise(hraVal) : 0;
    let attendanceAllowancePaise =
      Number.isFinite(attendanceVal) && attendanceVal > 0 ? rupeesToPaise(attendanceVal) : 0;
    let washingAllowancePaise =
      Number.isFinite(washingVal) && washingVal > 0 ? rupeesToPaise(washingVal) : 0;
    let conveyancePaise =
      Number.isFinite(conveyanceVal) && conveyanceVal > 0 ? rupeesToPaise(conveyanceVal) : 0;
    let medicalAllowancePaise =
      Number.isFinite(medicalVal) && medicalVal > 0 ? rupeesToPaise(medicalVal) : 0;
    let leaveTravelAllowancePaise =
      Number.isFinite(ltaVal) && ltaVal > 0 ? rupeesToPaise(ltaVal) : 0;
    let communicationExpensesPaise =
      Number.isFinite(communicationVal) && communicationVal > 0
        ? rupeesToPaise(communicationVal)
        : 0;
    let healthClubAllowancePaise =
      Number.isFinite(healthClubVal) && healthClubVal > 0 ? rupeesToPaise(healthClubVal) : 0;
    let adhocAllowancePaise =
      Number.isFinite(adhocVal) && adhocVal > 0 ? rupeesToPaise(adhocVal) : 0;
    const travelingAllowancePaise =
      Number.isFinite(travelingVal) && travelingVal > 0 ? rupeesToPaise(travelingVal) : 0;
    let salesCommissionPaise =
      Number.isFinite(salesCommVal) && salesCommVal > 0 ? rupeesToPaise(salesCommVal) : 0;
    const specialAllowancePaise =
      Number.isFinite(specialVal) && specialVal > 0 ? rupeesToPaise(specialVal) : 0;
    let overtimePaise =
      Number.isFinite(overtimeVal) && overtimeVal > 0 ? rupeesToPaise(overtimeVal) : 0;
    let incentivePaise =
      Number.isFinite(incentiveVal) && incentiveVal > 0 ? rupeesToPaise(incentiveVal) : 0;
    let arrearsPaise =
      Number.isFinite(arrearsVal) && arrearsVal > 0 ? rupeesToPaise(arrearsVal) : 0;
    let otherEarningsPaise =
      Number.isFinite(otherEarnVal) && otherEarnVal > 0 ? rupeesToPaise(otherEarnVal) : 0;

    // Auto-balance negative ADVOCH ALLOW (occurs on short-attendance rows where fixed allowances weren't pro-rated)
    // Absorbs the negative plug cleanly from fixed allowances so every slip head stays >= 0 while Monthly Gross stays 100% exact.
    let adhocAutoBalanced = false;
    if (Number.isFinite(adhocVal) && adhocVal < 0) {
      const deficitPaise = Math.round(Math.abs(adhocVal) * 100);
      const totalAbsorbable =
        communicationExpensesPaise +
        washingAllowancePaise +
        attendanceAllowancePaise +
        medicalAllowancePaise +
        conveyancePaise +
        leaveTravelAllowancePaise +
        healthClubAllowancePaise;
      if (totalAbsorbable >= deficitPaise) {
        let rem = deficitPaise;
        const take = (curr: number): number => {
          const cut = Math.min(curr, rem);
          rem -= cut;
          return curr - cut;
        };
        communicationExpensesPaise = take(communicationExpensesPaise);
        washingAllowancePaise = take(washingAllowancePaise);
        attendanceAllowancePaise = take(attendanceAllowancePaise);
        medicalAllowancePaise = take(medicalAllowancePaise);
        conveyancePaise = take(conveyancePaise);
        leaveTravelAllowancePaise = take(leaveTravelAllowancePaise);
        healthClubAllowancePaise = take(healthClubAllowancePaise);
        adhocAllowancePaise = 0;
        adhocAutoBalanced = true;
      }
    }

    const strictNonNegMoneyValues = [
      basicVal,
      dearnessVal,
      hraVal,
      attendanceVal,
      washingVal,
      conveyanceVal,
      medicalVal,
      ltaVal,
      communicationVal,
      healthClubVal,
      ...(adhocAutoBalanced ? [] : [adhocVal]),
      travelingVal,
      salesCommVal,
      specialVal,
      overtimeVal,
      incentiveVal,
      arrearsVal,
      otherEarnVal,
      pfVal,
      esicVal,
      ptVal,
      lwfVal,
      advanceVal,
      tdsVal,
      penaltyVal,
      insuranceVal,
      otherDedVal,
    ];

    const hasNaNMoney = strictNonNegMoneyValues.some((v) => !Number.isFinite(v)) || !Number.isFinite(adhocVal);
    const hasNegMoney = strictNonNegMoneyValues.some((v) => Number.isFinite(v) && v < 0);

    const computeGross = () =>
      basicPaise +
      dearnessAllowancePaise +
      hraPaise +
      attendanceAllowancePaise +
      washingAllowancePaise +
      conveyancePaise +
      medicalAllowancePaise +
      leaveTravelAllowancePaise +
      communicationExpensesPaise +
      healthClubAllowancePaise +
      adhocAllowancePaise +
      travelingAllowancePaise +
      salesCommissionPaise +
      specialAllowancePaise +
      overtimePaise +
      incentivePaise +
      arrearsPaise +
      otherEarningsPaise;

    let grossEarningsPaise = computeGross();

    // Bank-Exact Re 1 Rounding Alignment:
    // When Excel EARN GROSS is rounded to whole rupees (e.g. ROUND(sum, 0)) and differs from
    // fractional Sales Commission / OT paise sum by <= ₹1.00, absorb the exact rounding delta
    // into the fractional earning head so PDF Net Pay matches bank transfer (DCR/NEFT) to the exact rupee
    // while strictly preserving Firestore's `grossEarningsPaise == sum(earningComponents)` invariant.
    if (!hasNaNMoney && !hasNegMoney && String(sheetEarnGrossRaw ?? '').trim() !== '') {
      const sheetGrossNum = parseNumericField(sheetEarnGrossRaw);
      const sheetGrossPaise =
        Number.isFinite(sheetGrossNum) && sheetGrossNum > 0 ? rupeesToPaise(sheetGrossNum) : 0;
      const deltaPaise = sheetGrossPaise - grossEarningsPaise;
      if (sheetGrossPaise > 0 && sheetGrossPaise % 100 === 0 && deltaPaise !== 0 && Math.abs(deltaPaise) <= 100) {
        const tryApplyDelta = (onlyFractional: boolean): boolean => {
          const candidates: Array<{ get: () => number; set: (v: number) => void }> = [
            { get: () => salesCommissionPaise, set: (v) => { salesCommissionPaise = v; } },
            { get: () => overtimePaise, set: (v) => { overtimePaise = v; } },
            { get: () => adhocAllowancePaise, set: (v) => { adhocAllowancePaise = v; } },
            { get: () => otherEarningsPaise, set: (v) => { otherEarningsPaise = v; } },
            { get: () => incentivePaise, set: (v) => { incentivePaise = v; } },
            { get: () => arrearsPaise, set: (v) => { arrearsPaise = v; } },
            { get: () => hraPaise, set: (v) => { hraPaise = v; } },
            { get: () => dearnessAllowancePaise, set: (v) => { dearnessAllowancePaise = v; } },
            { get: () => basicPaise, set: (v) => { basicPaise = v; } },
          ];
          for (const c of candidates) {
            const val = c.get();
            if (val <= 0) continue;
            if (onlyFractional && val % 100 === 0) continue;
            if (val + deltaPaise >= 0) {
              c.set(val + deltaPaise);
              return true;
            }
          }
          return false;
        };
        if (tryApplyDelta(true) || tryApplyDelta(false)) {
          grossEarningsPaise = computeGross();
        }
      }
    }

    const pfPaise = Number.isFinite(pfVal) && pfVal > 0 ? rupeesToPaise(pfVal) : 0;
    const esicPaise = Number.isFinite(esicVal) && esicVal > 0 ? rupeesToPaise(esicVal) : 0;
    const ptPaise = Number.isFinite(ptVal) && ptVal > 0 ? rupeesToPaise(ptVal) : 0;
    const lwfPaise = Number.isFinite(lwfVal) && lwfVal > 0 ? rupeesToPaise(lwfVal) : 0;
    const advanceRecoveryPaise =
      Number.isFinite(advanceVal) && advanceVal > 0 ? rupeesToPaise(advanceVal) : 0;
    const tdsPaise = Number.isFinite(tdsVal) && tdsVal > 0 ? rupeesToPaise(tdsVal) : 0;
    const penaltyPaise =
      Number.isFinite(penaltyVal) && penaltyVal > 0 ? rupeesToPaise(penaltyVal) : 0;
    const insurancePaise =
      Number.isFinite(insuranceVal) && insuranceVal > 0 ? rupeesToPaise(insuranceVal) : 0;
    const otherDeductionPaise =
      Number.isFinite(otherDedVal) && otherDedVal > 0 ? rupeesToPaise(otherDedVal) : 0;

    const totalDeductionsPaise =
      pfPaise +
      esicPaise +
      ptPaise +
      lwfPaise +
      advanceRecoveryPaise +
      tdsPaise +
      penaltyPaise +
      insurancePaise +
      otherDeductionPaise;

    const netPayablePaise = grossEarningsPaise - totalDeductionsPaise;

    // Cross-check computed totals against optional EARN GROSS / Total Deduction / NET PAY columns in Excel (> ₹1 tolerance)
    const crossCheckIssues: string[] = [];
    if (String(sheetEarnGrossRaw ?? '').trim() !== '') {
      const sheetGrossNum = parseNumericField(sheetEarnGrossRaw);
      if (Number.isFinite(sheetGrossNum) && Math.abs(rupeesToPaise(sheetGrossNum) - grossEarningsPaise) > 100) {
        crossCheckIssues.push(
          `Excel EARN GROSS (₹${sheetGrossNum.toFixed(2)}) ≠ Sum of Earnings (₹${(grossEarningsPaise / 100).toFixed(2)})`,
        );
      }
    }
    if (String(sheetTotalDedRaw ?? '').trim() !== '') {
      const sheetDedNum = parseNumericField(sheetTotalDedRaw);
      if (Number.isFinite(sheetDedNum) && Math.abs(rupeesToPaise(sheetDedNum) - totalDeductionsPaise) > 100) {
        crossCheckIssues.push(
          `Excel Total Deduction (₹${sheetDedNum.toFixed(2)}) ≠ Sum of Deductions (₹${(totalDeductionsPaise / 100).toFixed(2)})`,
        );
      }
    }
    if (String(sheetNetPayRaw ?? '').trim() !== '') {
      const sheetNetNum = parseNumericField(sheetNetPayRaw);
      if (Number.isFinite(sheetNetNum) && Math.abs(rupeesToPaise(sheetNetNum) - netPayablePaise) > 100) {
        crossCheckIssues.push(
          `Excel NET PAY (₹${sheetNetNum.toFixed(2)}) ≠ Computed Net (₹${(netPayablePaise / 100).toFixed(2)})`,
        );
      }
    }
    const sheetCrossCheckWarning = crossCheckIssues.join(' · ');

    let status: ParsedSalaryRow['status'] = 'VALID';
    let errorCode: SalaryRowErrorCode | undefined;
    let errorMessage = '';

    const customDepartmentName =
      !resolvedDepartment && rawDepartment
        ? normalizeNonSalesDepartmentName(rawDepartment) || ''
        : '';

    const dedupeKey = `${monthKey}__${(matched?.employeeId || rawEmpId).toUpperCase()}`;
    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      status = 'ERROR';
      errorCode = 'INVALID_MONTH';
      errorMessage = 'Invalid Pay Month. Select a valid YYYY-MM month.';
    } else if (!matched) {
      status = 'ERROR';
      errorCode = 'EMPLOYEE_NOT_FOUND';
      errorMessage = `Employee ID "${rawEmpId || 'blank'}" not found in Employee Master.`;
    } else if (seenEmployeeKeys.has(dedupeKey)) {
      status = 'DUPLICATE_IN_FILE';
      errorCode = 'DUPLICATE_IN_FILE';
      errorMessage = `Duplicate row in file for ${matched.employeeId} (${monthKey}).`;
    } else if (hasInvalidAttendance || attendanceOutOfBounds) {
      status = 'ERROR';
      errorCode = 'INVALID_ATTENDANCE';
      errorMessage =
        paidDays > totalDays
          ? `Paid Days (${paidDays}) cannot exceed Total Days (${totalDays}).`
          : 'Attendance days must be between 0 and 31 (Total Days 1–31; OT Hours <= 500).';
    } else if (hasNaNMoney || hasNegMoney) {
      status = 'ERROR';
      errorCode = 'INVALID_MONEY';
      errorMessage = 'Contains invalid or negative earnings/deduction amount.';
    } else if (grossEarningsPaise <= 0) {
      status = 'ERROR';
      errorCode = 'ZERO_GROSS';
      errorMessage = 'Gross Earnings must be greater than ₹0.';
    } else if (netPayablePaise < 0) {
      status = 'ERROR';
      errorCode = 'NEGATIVE_NET';
      errorMessage = `Total Deductions (₹${(totalDeductionsPaise / 100).toFixed(2)}) exceed Gross Earnings (₹${(grossEarningsPaise / 100).toFixed(2)}). Net Payable cannot be negative.`;
    } else if (rawDepartment && !resolvedDepartment && !customDepartmentName) {
      status = 'ERROR';
      errorCode = 'INVALID_DEPARTMENT';
      errorMessage = `Invalid department "${rawDepartment}". Enter a valid Sales Dept (Saree, Ladies Wear, Kids Wear, Mens Wear, Non Apparels) or Non-Sales Dept (Accounts, HR, Billing, Head Office, etc.).`;
    }

    if (matched && status === 'VALID') {
      seenEmployeeKeys.add(dedupeKey);
    }

    const willSyncDepartment = Boolean(
      matched &&
        ((resolvedDepartment && matched.departmentId !== resolvedDepartment.id) ||
          (!resolvedDepartment &&
            customDepartmentName &&
            (Boolean(matched.departmentId) ||
              (matched.departmentName || '').trim().toLowerCase() !==
                customDepartmentName.toLowerCase()))),
    );
    const willSyncMasterFields = Boolean(
      matched &&
        (willSyncDepartment ||
          (rawSaleId && !matched.saleId) ||
          (gender && gender !== (matched.gender || '')) ||
          (category && category !== (matched.category || '')) ||
          (designation && designation !== matched.designation) ||
          (dateOfJoining && dateOfJoining !== (matched.dateOfJoining || '')) ||
          (panNumber && panNumber !== (matched.panNumber || '')) ||
          (uanNumber && uanNumber !== (matched.uanNumber || '')) ||
          (pfNumber && pfNumber !== (matched.pfNumber || '')) ||
          (esicNumber && esicNumber !== (matched.esicNumber || '')) ||
          (bankName && bankName !== (matched.bankName || '')) ||
          (bankAccountMasked && bankAccountMasked !== (matched.bankAccountMasked || '')) ||
          (bankIfsc && bankIfsc !== (matched.bankIfsc || ''))),
    );

    rows.push({
      rowNumber: raw.rowNumber,
      status,
      errorCode,
      errorMessage,
      monthKey,
      employeeId: matched?.employeeId || rawEmpId,
      saleId: rawSaleId || matched?.saleId || '',
      matchedEmployee: matched,
      employeeName: matched?.fullName || rawName || '—',
      branchId: matched?.branchId || '',
      branchName: matched?.branchName || rawBranch || '—',
      rawBranch,
      resolvedDepartment,
      customDepartmentName,
      rawDepartment,
      designation: designation || matched?.designation || 'Employee',
      gender: gender || matched?.gender || '',
      category: category || matched?.category || '',
      dateOfJoining: dateOfJoining || matched?.dateOfJoining || '',
      panNumber: panNumber || matched?.panNumber || '',
      uanNumber: uanNumber || matched?.uanNumber || '',
      pfNumber: pfNumber || matched?.pfNumber || '',
      esicNumber: esicNumber || matched?.esicNumber || '',
      bankName: bankName || matched?.bankName || '',
      bankAccountMasked: bankAccountMasked || matched?.bankAccountMasked || '',
      bankIfsc: bankIfsc || matched?.bankIfsc || '',
      totalDays,
      presentDays,
      paidDays,
      lopDays,
      weeklyOffDays,
      paidLeaveDays,
      overtimeDays,
      overtimeHours,
      monthlySalaryRatePaise,
      monthlyGrossRatePaise,
      basicPaise,
      dearnessAllowancePaise,
      hraPaise,
      attendanceAllowancePaise,
      washingAllowancePaise,
      conveyancePaise,
      medicalAllowancePaise,
      leaveTravelAllowancePaise,
      communicationExpensesPaise,
      healthClubAllowancePaise,
      adhocAllowancePaise,
      travelingAllowancePaise,
      salesCommissionPaise,
      specialAllowancePaise,
      overtimePaise,
      incentivePaise,
      arrearsPaise,
      otherEarningsPaise,
      grossEarningsPaise,
      pfPaise,
      esicPaise,
      ptPaise,
      lwfPaise,
      advanceRecoveryPaise,
      tdsPaise,
      penaltyPaise,
      insurancePaise,
      otherDeductionPaise,
      totalDeductionsPaise,
      netPayablePaise,
      sheetCrossCheckWarning,
      paymentMode,
      paymentReference,
      paymentDate,
      remarks,
      willSyncDepartment,
      willSyncMasterFields,
    });
  }

  const validRows = rows.filter((r) => r.status === 'VALID');
  const errorRows = rows.filter((r) => r.status === 'ERROR');
  const duplicateRows = rows.filter((r) => r.status === 'DUPLICATE_IN_FILE');

  return {
    rows,
    validRows,
    errorRows,
    duplicateRows,
    departmentSyncCount: validRows.filter((r) => r.willSyncDepartment).length,
    masterSyncCount: validRows.filter((r) => r.willSyncMasterFields).length,
    totalGrossPaise: validRows.reduce((s, r) => s + r.grossEarningsPaise, 0),
    totalDeductionsPaise: validRows.reduce((s, r) => s + r.totalDeductionsPaise, 0),
    totalNetPaise: validRows.reduce((s, r) => s + r.netPayablePaise, 0),
  };
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function extractRawSalaryRowsFromCsv(csvText: string): RawSalaryInputRow[] {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    return [];
  }

  const matrix = lines.map((line) => splitCsvLine(line));
  const headerIdx = detectSalaryHeaderRowIndex(matrix);
  const headers = matrix[headerIdx] || [];
  const rawRows: RawSalaryInputRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i += 1) {
    const cols = matrix[i];
    const cells: Record<string, unknown> = {};
    const maxCols = Math.max(headers.length, cols.length);
    for (let idx = 0; idx < maxCols; idx += 1) {
      const h = (headers[idx] || '').trim();
      const key = h || `col_${idx + 1}`;
      cells[key] = cols[idx] ?? '';
    }
    rawRows.push({ rowNumber: i + 1, cells });
  }
  return rawRows;
}

export function parseSalaryCsvText(
  csvText: string,
  employees: Employee[],
  defaultMonthKey: string,
): SalarySheetParseSummary {
  const rawRows = extractRawSalaryRowsFromCsv(csvText);
  if (rawRows.length === 0) {
    return {
      rows: [],
      validRows: [],
      errorRows: [],
      duplicateRows: [],
      departmentSyncCount: 0,
      masterSyncCount: 0,
      totalGrossPaise: 0,
      totalDeductionsPaise: 0,
      totalNetPaise: 0,
    };
  }
  return parseSalarySheetRows(rawRows, employees, defaultMonthKey);
}

/**
 * Updates the Employee ID cell on a single uploaded raw salary row (by `rowNumber`)
 * without mutating any other rows or columns, so re-parsing immediately links/validates that row.
 */
export function applyEmployeeIdOverrideToRawRows(
  rawRows: RawSalaryInputRow[],
  rowNumber: number,
  newEmployeeId: string,
): RawSalaryInputRow[] {
  const cleanId = newEmployeeId.trim();
  const empIdExactSet = new Set([
    'employeeid',
    'empid',
    'empcode',
    'staffid',
    'loginid',
    'id',
  ]);
  const empIdContainsList = ['employeeid', 'empid', 'empcode', 'staffid', 'loginid'];

  return rawRows.map((row) => {
    if (row.rowNumber !== rowNumber) return row;
    const nextCells: Record<string, unknown> = { ...row.cells };
    const keys = Object.keys(nextCells);

    // Find the exact header key used for Employee ID in this sheet (never touching SELL ID / SALE ID)
    let targetKey =
      keys.find((k) => {
        const nk = normHeader(k);
        return empIdExactSet.has(nk) && !nk.includes('sell') && !nk.includes('sale');
      }) ||
      keys.find((k) => {
        const nk = normHeader(k);
        return (
          empIdContainsList.some((p) => nk.includes(p)) &&
          !nk.includes('sell') &&
          !nk.includes('sale')
        );
      }) ||
      'EMP ID';

    nextCells[targetKey] = cleanId;
    return { ...row, cells: nextCells };
  });
}

export interface SuggestedMasterEmployeeMatch {
  employee: Employee;
  reason: string;
  score: number;
}

function normalizeNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function stripLeadingZerosDigits(id: string): string {
  const trimmed = id.trim().toUpperCase();
  if (/^\d+$/.test(trimmed)) {
    return trimmed.replace(/^0+/, '') || '0';
  }
  return '';
}

/**
 * Smartly ranks existing Employee Master records that likely correspond to an unmatched
 * salary sheet row (via Sale ID, Name, Leading-Zero Employee ID, or Token Overlap).
 */
export function findSuggestedMasterEmployeesForSalaryRow(
  row: Pick<ParsedSalaryRow, 'employeeId' | 'saleId' | 'employeeName' | 'rawBranch'>,
  employees: Employee[],
  limit = 5,
): SuggestedMasterEmployeeMatch[] {
  const sheetSaleId = (row.saleId || '').trim().toUpperCase();
  const sheetEmpDigits = stripLeadingZerosDigits(row.employeeId || '');
  const sheetNameNorm = (row.employeeName || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const sheetTokens = normalizeNameTokens(row.employeeName || '');
  const sheetTokenSet = new Set(sheetTokens);
  const sheetBranchNorm = (row.rawBranch || '').trim().toUpperCase();

  const matches: SuggestedMasterEmployeeMatch[] = [];

  for (const emp of employees) {
    let score = 0;
    let reason = '';

    const empSaleId = (emp.saleId || '').trim().toUpperCase();
    const empDigits = stripLeadingZerosDigits(emp.employeeId);
    const empNameNorm = emp.fullName.trim().toLowerCase().replace(/\s+/g, ' ');
    const empTokens = normalizeNameTokens(emp.fullName);

    if (sheetSaleId && empSaleId && sheetSaleId === empSaleId) {
      score = 100;
      reason = `Exact Sale ID match (${empSaleId})`;
    } else if (sheetNameNorm && sheetNameNorm !== '—' && empNameNorm === sheetNameNorm) {
      score = 95;
      reason = 'Exact Name match';
    } else if (sheetEmpDigits && empDigits && sheetEmpDigits === empDigits) {
      score = 92;
      reason = `Similar Employee ID (${emp.employeeId})`;
    } else if (sheetTokens.length >= 2 && empTokens.length >= 2) {
      const empTokenSet = new Set(empTokens);
      let shared = 0;
      for (const tok of sheetTokenSet) {
        if (empTokenSet.has(tok)) shared += 1;
      }
      if (shared === sheetTokenSet.size && shared === empTokenSet.size) {
        score = 88;
        reason = 'Same name words (reordered)';
      } else if (shared >= 2) {
        score = 72 + Math.min(10, shared * 3);
        reason = `${shared} matching name words`;
      } else if (shared === 1 && (sheetTokens.length === 1 || empTokens.length === 1)) {
        score = 55;
        reason = 'Partial name match';
      }
    }

    if (score > 0) {
      if (sheetBranchNorm && emp.branchName.trim().toUpperCase() === sheetBranchNorm) {
        score += 3;
      }
      matches.push({ employee: emp, reason, score });
    }
  }

  return matches
    .sort((a, b) => b.score - a.score || a.employee.fullName.localeCompare(b.employee.fullName))
    .slice(0, limit);
}

/**
 * Generates a ready-to-fill CSV template pre-populated with all ACTIVE employees
 * across all 12 branches with all 14 official House of Muktai Salary earning columns.
 */
export interface SalarySlipTemplatePrefill {
  incentivePaiseByEmp?: Record<string, number>;
  advanceRecoveryPaiseByEmp?: Record<string, number>;
}

export function buildSalarySlipCsvTemplate(
  employees: Employee[],
  monthKey: string,
  prefill?: SalarySlipTemplatePrefill,
): string {
  const days = getDaysInMonth(monthKey);
  const headers = [
    'Employee ID',
    'Employee Name',
    'Branch Name',
    'Department',
    'Designation',
    'Date of Joining',
    'Pay Month',
    'Total Days',
    'Paid Days',
    'Loss of Pay Days',
    'Weekly Off',
    'Paid Leave',
    'Extra Duty Hours',
    'Basic Salary',
    'Dearness Allowance',
    'House Rent Allowance (HRA)',
    'Attendance Allowance',
    'Washing Allowance',
    'Convenience Allowance',
    'Medical Allowance',
    'Leave Travel Allowance',
    'Communication Expanses',
    'Adhoc Allowance',
    'Traveling Allowance',
    'Sales Commotion',
    'Incentive',
    'Overtime',
    'Provident Fund (PF)',
    'ESIC Deduction',
    'Professional Tax (PT)',
    'Advance Recovery',
    'Income Tax (TDS)',
    'Other Deduction',
    'Payment Mode',
    'Payment Date',
    'Payment Reference',
    'Bank Name',
    'Bank Account Number',
    'Bank IFSC Code',
    'PAN Number',
    'UAN Number',
    'PF Account Number',
    'ESIC Number',
    'Remarks',
  ];

  const esc = (v: string | number | undefined) =>
    `"${String(v ?? '').replace(/"/g, '""')}"`;

  const formatRupeesCell = (paise?: number): string | number => {
    if (!paise || paise <= 0) return 0;
    const rupees = paise / 100;
    return Number.isInteger(rupees) ? rupees : Number(rupees.toFixed(2));
  };

  const activeSorted = [...employees]
    .filter((e) => e.status === 'ACTIVE')
    .sort((a, b) => a.branchName.localeCompare(b.branchName) || a.fullName.localeCompare(b.fullName));

  const lines = activeSorted.map((emp) => {
    const empKey = emp.employeeId.trim().toUpperCase();
    const prefillInc = prefill?.incentivePaiseByEmp?.[empKey] ?? 0;
    const prefillAdv = prefill?.advanceRecoveryPaiseByEmp?.[empKey] ?? 0;
    return [
      esc(emp.employeeId),
      esc(emp.fullName),
      esc(emp.branchName),
      esc(emp.departmentName || ''),
      esc(emp.designation || 'Employee'),
      esc(emp.dateOfJoining || ''),
      esc(monthKey),
      esc(days),
      esc(days),
      esc(0),
      esc(4),
      esc(0),
      esc(0),
      esc(0), // Basic Salary
      esc(0), // Dearness Allowance
      esc(0), // HRA
      esc(0), // Attendance Allowance
      esc(0), // Washing Allowance
      esc(0), // Convenience Allowance
      esc(0), // Medical Allowance
      esc(0), // Leave Travel Allowance
      esc(0), // Communication Expanses
      esc(0), // Adhoc Allowance
      esc(0), // Traveling Allowance
      esc(0), // Sales Commotion
      esc(formatRupeesCell(prefillInc)), // Incentive (auto-filled when prefill provided)
      esc(0), // Overtime
      esc(0), // PF
      esc(0), // ESIC
      esc(0), // PT
      esc(formatRupeesCell(prefillAdv)), // Advance Recovery (auto-filled active Loan EMI)
      esc(0), // TDS
      esc(0), // Other Deduction
      esc('NEFT'),
      esc(''),
      esc(''),
      esc(emp.bankName || ''),
      esc(emp.bankAccountMasked || ''),
      esc(emp.bankIfsc || ''),
      esc(emp.panNumber || ''),
      esc(emp.uanNumber || ''),
      esc(emp.pfNumber || ''),
      esc(emp.esicNumber || ''),
      esc(''),
    ].join(',');
  });

  return [headers.map(esc).join(','), ...lines].join('\n');
}

/**
 * Returns the ordered non-zero earning rows for Official Salary Slip PDFs & Staff App views.
 */
export function getSalarySlipEarningBreakdown(
  slip: SalarySlip,
  lang: 'en' | 'mr' = 'en',
): Array<[string, number]> {
  const isMr = lang === 'mr';
  const rows: Array<[string, number]> = [
    [isMr ? 'मूळ पगार (Basic Salary)' : 'Basic Salary', slip.basicPaise],
    [
      isMr ? 'महागाई भत्ता (Dearness Allowance)' : 'Dearness Allowance',
      slip.dearnessAllowancePaise || 0,
    ],
    [isMr ? 'घरभाडे भत्ता (HRA)' : 'House Rent Allowance (HRA)', slip.hraPaise],
    [
      isMr ? 'हजेरी भत्ता (Attendance Allowance)' : 'Attendance Allowance',
      slip.attendanceAllowancePaise || 0,
    ],
    [
      isMr ? 'धुलाई भत्ता (Washing Allowance)' : 'Washing Allowance',
      slip.washingAllowancePaise || 0,
    ],
    [
      isMr ? 'वाहन भत्ता (Conveyance Allowance)' : 'Conveyance Allowance',
      slip.conveyancePaise,
    ],
    [
      isMr ? 'वैद्यकीय भत्ता (Medical Allowance)' : 'Medical Allowance',
      slip.medicalAllowancePaise || 0,
    ],
    [
      isMr ? 'प्रवास रजा भत्ता (Leave Travel Allowance)' : 'Leave Travel Allowance',
      slip.leaveTravelAllowancePaise || 0,
    ],
    [
      isMr ? 'संपर्क खर्च (Communication Expenses)' : 'Communication Expenses',
      slip.communicationExpensesPaise || 0,
    ],
    [
      isMr ? 'हेल्थ क्लब भत्ता (Health Club Allowance)' : 'Health Club Allowance',
      slip.healthClubAllowancePaise || 0,
    ],
    [
      isMr ? 'तात्पुरता भत्ता (Adhoc Allowance)' : 'Adhoc Allowance',
      slip.adhocAllowancePaise || 0,
    ],
    [
      isMr ? 'प्रवास भत्ता (Traveling Allowance)' : 'Traveling Allowance',
      slip.travelingAllowancePaise || 0,
    ],
    [
      isMr ? 'विक्री कमिशन (Sales Commission)' : 'Sales Commission',
      slip.salesCommissionPaise || 0,
    ],
    [isMr ? 'विशेष भत्ता (Special Allowance)' : 'Special Allowance', slip.specialAllowancePaise],
    [isMr ? 'इन्सेंटिव्ह (Incentive)' : 'Incentive', slip.incentivePaise],
    [isMr ? 'ओव्हरटाईम (Overtime)' : 'Overtime', slip.overtimePaise],
    [isMr ? 'थकबाकी (Arrears)' : 'Arrears', slip.arrearsPaise || 0],
    [isMr ? 'इतर उत्पन्न (Other Earnings)' : 'Other Earnings', slip.otherEarningsPaise],
  ];
  return rows.filter(([, amt], idx) => idx === 0 || amt > 0);
}

/**
 * Returns the ordered non-zero deduction rows for Official Salary Slip PDFs & Staff App views.
 */
export function getSalarySlipDeductionBreakdown(
  slip: SalarySlip,
  lang: 'en' | 'mr' = 'en',
): Array<[string, number]> {
  const isMr = lang === 'mr';
  const rows: Array<[string, number]> = [
    [isMr ? 'भविष्य निर्वाह निधी (PF)' : 'Provident Fund (PF)', slip.pfPaise],
    [isMr ? 'ईएसआयसी (ESIC)' : 'ESIC Contribution', slip.esicPaise],
    [isMr ? 'व्यवसाय कर (PT)' : 'Professional Tax (PT)', slip.ptPaise],
    [isMr ? 'कामगार कल्याण निधी (LWF)' : 'Labour Welfare Fund (LWF)', slip.lwfPaise || 0],
    [isMr ? 'अ‍ॅडव्हान्स / कर्ज वसुली (Advance)' : 'Advance / Loan Recovery', slip.advanceRecoveryPaise],
    [isMr ? 'आयकर (TDS)' : 'Income Tax (TDS)', slip.tdsPaise],
    [isMr ? 'दंड (Penalty)' : 'Penalty', slip.penaltyPaise || 0],
    [isMr ? 'विमा (Insurance)' : 'Insurance', slip.insurancePaise || 0],
    [isMr ? 'इतर कपात (Other Deductions)' : 'Other Deductions', slip.otherDeductionPaise],
  ];
  return rows.filter(([, amt]) => amt > 0);
}

export function getEffectiveDepartmentId(
  parsedDept: OfficialDepartment | null,
  emp: Employee,
): DepartmentId | '' {
  return parsedDept?.id || emp.departmentId || '';
}
