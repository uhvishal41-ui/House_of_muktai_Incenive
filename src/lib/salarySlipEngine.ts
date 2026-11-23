import {
  resolveCanonicalDepartment,
  type OfficialDepartment,
} from './departmentLeaderboardEngine';
import type {
  DepartmentId,
  Employee,
  SalarySlipPaymentMode,
} from '../types/incentive';

export function buildSalarySlipId(monthKey: string, employeeId: string): string {
  return `${monthKey.trim()}__${employeeId.trim()}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Privacy-safe bank account masking: converts full account numbers (e.g. 123456789012)
 * into `XXXX9012`, while keeping already-masked values intact.
 */
export function maskBankAccountNumber(raw?: string | null): string {
  const cleaned = String(raw || '').trim().replace(/\s+/g, '');
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
  const compact = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (!compact) return '';
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

export interface ParsedSalaryRow {
  rowNumber: number;
  status: 'VALID' | 'ERROR' | 'DUPLICATE_IN_FILE';
  errorMessage: string;
  monthKey: string;
  employeeId: string;
  matchedEmployee: Employee | null;
  employeeName: string;
  branchId: string;
  branchName: string;
  resolvedDepartment: OfficialDepartment | null;
  rawDepartment: string;
  designation: string;
  dateOfJoining: string;
  panNumber: string;
  uanNumber: string;
  pfNumber: string;
  esicNumber: string;
  bankName: string;
  bankAccountMasked: string;
  bankIfsc: string;
  totalDays: number;
  paidDays: number;
  lopDays: number;
  weeklyOffDays: number;
  paidLeaveDays: number;
  overtimeHours: number;
  basicPaise: number;
  hraPaise: number;
  conveyancePaise: number;
  specialAllowancePaise: number;
  overtimePaise: number;
  incentivePaise: number;
  otherEarningsPaise: number;
  grossEarningsPaise: number;
  pfPaise: number;
  esicPaise: number;
  ptPaise: number;
  advanceRecoveryPaise: number;
  tdsPaise: number;
  otherDeductionPaise: number;
  totalDeductionsPaise: number;
  netPayablePaise: number;
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
  'salesmanno',
  'employeeid',
  'empid',
  'empcode',
  'staffid',
  'loginid',
  'employeename',
  'salespersonname',
  'basicsalary',
  'basicpay',
  'basic',
  'hra',
  'department',
  'paiddays',
  'totaldays',
  'gross',
  'netpay',
  'netsalary',
  'pfdeduction',
  'professionaltax',
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

    const rawEmpId = String(
      pickCellValue(
        normMap,
        ['salesmanno', 'employeeid', 'empid', 'empcode', 'staffid', 'loginid', 'id'],
        ['salesmanno', 'employeeid', 'empid', 'empcode', 'staffid', 'loginid'],
      ),
    ).trim();
    const rawName = String(
      pickCellValue(
        normMap,
        ['employeename', 'salespersonname', 'fullname', 'staffname', 'name'],
        ['employeename', 'salespersonname', 'fullname', 'staffname'],
        ['branch', 'bank', 'dept', 'department'],
      ),
    ).trim();

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

    const rawMonth = String(
      pickCellValue(
        normMap,
        ['paymonth', 'monthkey', 'salarymonth', 'month'],
        ['paymonth', 'monthkey', 'salarymonth'],
      ),
    ).trim();
    const monthKey = normalizeMonthKeyFromCell(rawMonth, defaultMonthKey);
    const matched =
      empById.get(rawEmpId.toUpperCase()) || empByLogin.get(rawEmpId.toUpperCase()) || null;

    const rawDepartment = String(
      pickCellValue(
        normMap,
        ['department', 'deptname', 'dept', 'section'],
        ['department', 'deptname', 'section'],
      ),
    ).trim();
    const resolvedDepartment = resolveCanonicalDepartment(rawDepartment);

    const designation = String(
      pickCellValue(
        normMap,
        ['designation', 'role', 'post', 'position'],
        ['designation', 'position'],
      ),
    )
      .trim()
      .slice(0, 80);
    const dateOfJoining = normalizeDateCellToIso(
      pickCellValue(
        normMap,
        ['dateofjoining', 'doj', 'joiningdate', 'joindate'],
        ['dateofjoining', 'joiningdate', 'joindate'],
      ),
    ).slice(0, 20);
    const panNumber = String(
      pickCellValue(normMap, ['pannumber', 'panno', 'pan'], ['pannumber', 'panno']),
    )
      .trim()
      .toUpperCase()
      .slice(0, 20);
    const uanNumber = String(
      pickCellValue(normMap, ['uannumber', 'uanno', 'uan'], ['uannumber', 'uanno']),
    )
      .trim()
      .slice(0, 24);
    const pfNumber = String(
      pickCellValue(normMap, ['pfnumber', 'pfno', 'epfno', 'epfnumber'], ['pfnumber', 'pfno', 'epfno']),
    )
      .trim()
      .slice(0, 32);
    const esicNumber = String(
      pickCellValue(
        normMap,
        ['esicnumber', 'esicno', 'esino', 'esinumber'],
        ['esicnumber', 'esicno', 'esino', 'esinumber'],
      ),
    )
      .trim()
      .slice(0, 32);
    const bankName = String(
      pickCellValue(
        normMap,
        ['bankname', 'bank'],
        ['bankname'],
        ['account', 'acc', 'ifsc'],
      ),
    )
      .trim()
      .slice(0, 80);
    const bankAccountMasked = maskBankAccountNumber(
      String(
        pickCellValue(
          normMap,
          ['bankaccount', 'bankaccountno', 'bankacno', 'accountno', 'accountnumber', 'acno', 'accno'],
          ['bankaccount', 'bankacno', 'accountno', 'accountnumber', 'acno', 'accno'],
        ),
      ),
    );
    const bankIfsc = String(
      pickCellValue(normMap, ['bankifsc', 'ifsccode', 'ifsc'], ['bankifsc', 'ifsccode', 'ifsc']),
    )
      .trim()
      .toUpperCase()
      .slice(0, 20);

    // Attendance
    const defaultDays = getDaysInMonth(monthKey || defaultMonthKey);
    const rawTotalDaysCell = pickCellValue(
      normMap,
      ['totaldays', 'monthdays', 'calendardays'],
      ['totaldays', 'monthdays', 'calendardays'],
    );
    const rawPaidDaysCell = pickCellValue(
      normMap,
      ['paiddays', 'presentdays', 'workeddays', 'paydays'],
      ['paiddays', 'presentdays', 'workeddays', 'paydays'],
    );
    const rawLopDaysCell = pickCellValue(
      normMap,
      ['lopdays', 'absentdays', 'lop', 'absent'],
      ['lopdays', 'absentdays'],
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
    const rawOtHoursCell = pickCellValue(
      normMap,
      ['overtimehours', 'othours', 'othrs'],
      ['overtimehours', 'othours', 'othrs'],
    );

    const hasExplicitTotalDays = String(rawTotalDaysCell ?? '').trim() !== '';
    const hasExplicitPaidDays = String(rawPaidDaysCell ?? '').trim() !== '';

    const totalDaysNum = parseNumericField(rawTotalDaysCell);
    const paidDaysNum = parseNumericField(rawPaidDaysCell);
    const lopDaysNum = parseNumericField(rawLopDaysCell);
    const weeklyOffNum = parseNumericField(rawWeeklyOffCell);
    const paidLeaveNum = parseNumericField(rawPaidLeaveCell);
    const overtimeHoursNum = parseNumericField(rawOtHoursCell);

    const attendanceNums = [
      totalDaysNum,
      paidDaysNum,
      lopDaysNum,
      weeklyOffNum,
      paidLeaveNum,
      overtimeHoursNum,
    ];
    const hasInvalidAttendance =
      attendanceNums.some((v) => !Number.isFinite(v) || v < 0);

    const totalDays = hasExplicitTotalDays && Number.isFinite(totalDaysNum) ? totalDaysNum : defaultDays;
    const lopDays = Number.isFinite(lopDaysNum) && lopDaysNum >= 0 ? lopDaysNum : 0;
    const paidDays =
      hasExplicitPaidDays && Number.isFinite(paidDaysNum)
        ? paidDaysNum
        : Math.max(0, Number((totalDays - lopDays).toFixed(2)));
    const weeklyOffDays = Number.isFinite(weeklyOffNum) && weeklyOffNum >= 0 ? weeklyOffNum : 0;
    const paidLeaveDays = Number.isFinite(paidLeaveNum) && paidLeaveNum >= 0 ? paidLeaveNum : 0;
    const overtimeHours = Number.isFinite(overtimeHoursNum) && overtimeHoursNum >= 0 ? overtimeHoursNum : 0;

    const attendanceOutOfBounds =
      totalDays < 1 ||
      totalDays > 31 ||
      paidDays < 0 ||
      paidDays > 31 ||
      paidDays > totalDays ||
      lopDays < 0 ||
      lopDays > 31 ||
      weeklyOffDays < 0 ||
      weeklyOffDays > 31 ||
      paidLeaveDays < 0 ||
      paidLeaveDays > 31 ||
      overtimeHours > 500;

    // Earnings (rupees -> paise)
    const basicVal = parseNumericField(
      pickCellValue(normMap, ['basicsalary', 'basicpay', 'basic'], ['basicsalary', 'basicpay']),
    );
    const hraVal = parseNumericField(
      pickCellValue(
        normMap,
        ['hra', 'houserentallowance', 'houserent'],
        ['houserentallowance', 'houserent'],
      ),
    );
    const conveyanceVal = parseNumericField(
      pickCellValue(
        normMap,
        ['conveyanceallowance', 'conveyance', 'travelallowance', 'ta'],
        ['conveyance', 'travelallowance'],
      ),
    );
    const specialVal = parseNumericField(
      pickCellValue(
        normMap,
        ['specialallowance', 'special', 'da', 'dearnessallowance'],
        ['specialallowance', 'dearnessallowance'],
      ),
    );
    const overtimeVal = parseNumericField(
      pickCellValue(
        normMap,
        ['overtimeamount', 'otamount', 'overtimepay', 'overtime'],
        ['overtimeamount', 'otamount', 'overtimepay'],
        ['hours', 'hrs'],
      ),
    );
    const incentiveVal = parseNumericField(
      pickCellValue(
        normMap,
        ['incentivebonus', 'incentive', 'bonus', 'commission'],
        ['incentive', 'bonus', 'commission'],
      ),
    );
    const otherEarnVal = parseNumericField(
      pickCellValue(
        normMap,
        ['otherearnings', 'otherallowance', 'allowances', 'miscallowance'],
        ['otherearnings', 'otherallowance', 'miscallowance'],
        ['conveyance', 'special', 'houserent', 'dearness'],
      ),
    );

    // Deductions (rupees -> paise) — strict exclusions prevent double-counting PF/PT/Total Deductions
    const pfVal = parseNumericField(
      pickCellValue(
        normMap,
        ['pfdeduction', 'providentfund', 'epfdeduction', 'epf', 'pf'],
        ['pfdeduction', 'providentfund', 'epfdeduction'],
        ['number', 'no', 'uan'],
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
        ['professionaltax', 'proftax', 'ptax', 'pt'],
        ['professionaltax', 'proftax', 'ptax'],
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
        ['tds', 'tdsdeduction', 'incometax'],
        ['tdsdeduction', 'incometax'],
        ['prof', 'ptax'],
      ),
    );
    const otherDedVal = parseNumericField(
      pickCellValue(
        normMap,
        ['otherdeduction', 'otherdeductions', 'miscdeduction', 'latefine', 'uniform', 'fine'],
        ['otherdeduction', 'miscdeduction', 'latefine'],
        ['total', 'pf', 'esic', 'esi', 'prof', 'ptax', 'tds', 'tax', 'advance', 'loan'],
      ),
    );

    const paymentMode = normalizeSalaryPaymentMode(
      String(
        pickCellValue(
          normMap,
          ['paymentmode', 'paymode', 'mode'],
          ['paymentmode', 'paymode'],
        ),
      ),
    );
    const paymentReference = String(
      pickCellValue(
        normMap,
        ['paymentreference', 'paymentref', 'utr', 'utrno', 'referenceno', 'refno', 'transactionid'],
        ['paymentreference', 'paymentref', 'utrno', 'referenceno', 'transactionid'],
      ),
    )
      .trim()
      .slice(0, 120);
    const paymentDate = normalizeDateCellToIso(
      pickCellValue(
        normMap,
        ['paymentdate', 'paydate', 'paiddate', 'creditedon'],
        ['paymentdate', 'paydate', 'paiddate', 'creditedon'],
      ),
    ).slice(0, 30);
    const remarks = String(
      pickCellValue(normMap, ['remarks', 'notes', 'comment'], ['remarks', 'comment']),
    )
      .trim()
      .slice(0, 240);

    const moneyValues = [
      basicVal,
      hraVal,
      conveyanceVal,
      specialVal,
      overtimeVal,
      incentiveVal,
      otherEarnVal,
      pfVal,
      esicVal,
      ptVal,
      advanceVal,
      tdsVal,
      otherDedVal,
    ];

    const hasNaNMoney = moneyValues.some((v) => !Number.isFinite(v));
    const hasNegMoney = moneyValues.some((v) => Number.isFinite(v) && v < 0);

    const basicPaise = Number.isFinite(basicVal) && basicVal > 0 ? rupeesToPaise(basicVal) : 0;
    const hraPaise = Number.isFinite(hraVal) && hraVal > 0 ? rupeesToPaise(hraVal) : 0;
    const conveyancePaise =
      Number.isFinite(conveyanceVal) && conveyanceVal > 0 ? rupeesToPaise(conveyanceVal) : 0;
    const specialAllowancePaise =
      Number.isFinite(specialVal) && specialVal > 0 ? rupeesToPaise(specialVal) : 0;
    const overtimePaise =
      Number.isFinite(overtimeVal) && overtimeVal > 0 ? rupeesToPaise(overtimeVal) : 0;
    const incentivePaise =
      Number.isFinite(incentiveVal) && incentiveVal > 0 ? rupeesToPaise(incentiveVal) : 0;
    const otherEarningsPaise =
      Number.isFinite(otherEarnVal) && otherEarnVal > 0 ? rupeesToPaise(otherEarnVal) : 0;

    const grossEarningsPaise =
      basicPaise +
      hraPaise +
      conveyancePaise +
      specialAllowancePaise +
      overtimePaise +
      incentivePaise +
      otherEarningsPaise;

    const pfPaise = Number.isFinite(pfVal) && pfVal > 0 ? rupeesToPaise(pfVal) : 0;
    const esicPaise = Number.isFinite(esicVal) && esicVal > 0 ? rupeesToPaise(esicVal) : 0;
    const ptPaise = Number.isFinite(ptVal) && ptVal > 0 ? rupeesToPaise(ptVal) : 0;
    const advanceRecoveryPaise =
      Number.isFinite(advanceVal) && advanceVal > 0 ? rupeesToPaise(advanceVal) : 0;
    const tdsPaise = Number.isFinite(tdsVal) && tdsVal > 0 ? rupeesToPaise(tdsVal) : 0;
    const otherDeductionPaise =
      Number.isFinite(otherDedVal) && otherDedVal > 0 ? rupeesToPaise(otherDedVal) : 0;

    const totalDeductionsPaise =
      pfPaise +
      esicPaise +
      ptPaise +
      advanceRecoveryPaise +
      tdsPaise +
      otherDeductionPaise;

    const netPayablePaise = grossEarningsPaise - totalDeductionsPaise;

    let status: ParsedSalaryRow['status'] = 'VALID';
    let errorMessage = '';

    const dedupeKey = `${monthKey}__${(matched?.employeeId || rawEmpId).toUpperCase()}`;
    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      status = 'ERROR';
      errorMessage = 'Invalid Pay Month. Select a valid YYYY-MM month.';
    } else if (!matched) {
      status = 'ERROR';
      errorMessage = `Salesman No / Employee ID "${rawEmpId || 'blank'}" not found in Employee Master.`;
    } else if (seenEmployeeKeys.has(dedupeKey)) {
      status = 'DUPLICATE_IN_FILE';
      errorMessage = `Duplicate row in file for ${matched.employeeId} (${monthKey}).`;
    } else if (hasInvalidAttendance || attendanceOutOfBounds) {
      status = 'ERROR';
      errorMessage =
        paidDays > totalDays
          ? `Paid Days (${paidDays}) cannot exceed Total Days (${totalDays}).`
          : 'Attendance days must be between 0 and 31 (Total Days 1–31; OT Hours <= 500).';
    } else if (hasNaNMoney || hasNegMoney) {
      status = 'ERROR';
      errorMessage = 'Contains invalid or negative earnings/deduction amount.';
    } else if (grossEarningsPaise <= 0) {
      status = 'ERROR';
      errorMessage = 'Gross Earnings must be greater than ₹0.';
    } else if (netPayablePaise < 0) {
      status = 'ERROR';
      errorMessage = `Total Deductions (₹${(totalDeductionsPaise / 100).toFixed(2)}) exceed Gross Earnings (₹${(grossEarningsPaise / 100).toFixed(2)}). Net Payable cannot be negative.`;
    } else if (rawDepartment && !resolvedDepartment) {
      status = 'ERROR';
      errorMessage = `Unrecognized department "${rawDepartment}". Use Saree, Ladies Wear, Kids Wear, Mens Wear, or Non Apparels.`;
    }

    if (matched && status === 'VALID') {
      seenEmployeeKeys.add(dedupeKey);
    }

    const willSyncDepartment = Boolean(
      matched && resolvedDepartment && matched.departmentId !== resolvedDepartment.id,
    );
    const willSyncMasterFields = Boolean(
      matched &&
        (willSyncDepartment ||
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
      errorMessage,
      monthKey,
      employeeId: matched?.employeeId || rawEmpId,
      matchedEmployee: matched,
      employeeName: matched?.fullName || rawName || '—',
      branchId: matched?.branchId || '',
      branchName: matched?.branchName || '—',
      resolvedDepartment,
      rawDepartment,
      designation: designation || matched?.designation || 'Sales Executive',
      dateOfJoining: dateOfJoining || matched?.dateOfJoining || '',
      panNumber: panNumber || matched?.panNumber || '',
      uanNumber: uanNumber || matched?.uanNumber || '',
      pfNumber: pfNumber || matched?.pfNumber || '',
      esicNumber: esicNumber || matched?.esicNumber || '',
      bankName: bankName || matched?.bankName || '',
      bankAccountMasked: bankAccountMasked || matched?.bankAccountMasked || '',
      bankIfsc: bankIfsc || matched?.bankIfsc || '',
      totalDays,
      paidDays,
      lopDays,
      weeklyOffDays,
      paidLeaveDays,
      overtimeHours,
      basicPaise,
      hraPaise,
      conveyancePaise,
      specialAllowancePaise,
      overtimePaise,
      incentivePaise,
      otherEarningsPaise,
      grossEarningsPaise,
      pfPaise,
      esicPaise,
      ptPaise,
      advanceRecoveryPaise,
      tdsPaise,
      otherDeductionPaise,
      totalDeductionsPaise,
      netPayablePaise,
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

export function parseSalaryCsvText(
  csvText: string,
  employees: Employee[],
  defaultMonthKey: string,
): SalarySheetParseSummary {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
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

  const matrix = lines.map((line) => splitCsvLine(line));
  const headerIdx = detectSalaryHeaderRowIndex(matrix);
  const headers = matrix[headerIdx] || [];
  const rawRows: RawSalaryInputRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i += 1) {
    const cols = matrix[i];
    const cells: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      cells[h] = cols[idx] ?? '';
    });
    rawRows.push({ rowNumber: i + 1, cells });
  }

  return parseSalarySheetRows(rawRows, employees, defaultMonthKey);
}

/**
 * Generates a ready-to-fill CSV template pre-populated with all ACTIVE employees
 * across all 12 branches so HR/Accounts only needs to enter Salary figures & Departments.
 */
export function buildSalarySlipCsvTemplate(employees: Employee[], monthKey: string): string {
  const days = getDaysInMonth(monthKey);
  const headers = [
    'Salesman No',
    'Employee Name',
    'Branch Name',
    'Department',
    'Designation',
    'DOJ',
    'Pay Month',
    'Total Days',
    'Paid Days',
    'LOP Days',
    'Weekly Off',
    'Paid Leave',
    'OT Hours',
    'Basic Salary',
    'HRA',
    'Conveyance',
    'Special Allowance',
    'OT Amount',
    'Incentive',
    'Other Earnings',
    'PF',
    'ESIC',
    'PT',
    'Advance Recovery',
    'TDS',
    'Other Deduction',
    'Payment Mode',
    'Payment Date',
    'Payment Reference',
    'Bank Name',
    'Account No',
    'IFSC',
    'PAN',
    'UAN',
    'PF No',
    'ESIC No',
    'Remarks',
  ];

  const esc = (v: string | number | undefined) =>
    `"${String(v ?? '').replace(/"/g, '""')}"`;

  const activeSorted = [...employees]
    .filter((e) => e.status === 'ACTIVE')
    .sort((a, b) => a.branchName.localeCompare(b.branchName) || a.fullName.localeCompare(b.fullName));

  const lines = activeSorted.map((emp) =>
    [
      esc(emp.employeeId),
      esc(emp.fullName),
      esc(emp.branchName),
      esc(emp.departmentName || ''),
      esc(emp.designation || 'Sales Executive'),
      esc(emp.dateOfJoining || ''),
      esc(monthKey),
      esc(days),
      esc(days),
      esc(0),
      esc(4),
      esc(0),
      esc(0),
      esc(0),
      esc(0),
      esc(0),
      esc(0),
      esc(0),
      esc(0),
      esc(0),
      esc(0),
      esc(0),
      esc(0),
      esc(0),
      esc(0),
      esc(0),
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
    ].join(','),
  );

  return [headers.map(esc).join(','), ...lines].join('\n');
}

export function getEffectiveDepartmentId(
  parsedDept: OfficialDepartment | null,
  emp: Employee,
): DepartmentId | '' {
  return parsedDept?.id || emp.departmentId || '';
}
