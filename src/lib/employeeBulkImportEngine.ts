import { parseDobToIso } from './birthdayEngine';
import {
  normalizeNonSalesDepartmentName,
  OFFICIAL_DEPARTMENTS,
  resolveCanonicalDepartment,
} from './departmentLeaderboardEngine';
import { sanitizeId } from './format';
import { resolveCanonicalBranchName } from './incentiveEngine';
import {
  cleanExcelTextCell,
  maskBankAccountNumber,
  normalizeDateCellToIso,
  sanitizeSaleIdCell,
} from './salarySlipEngine';
import type { Branch, DepartmentId, Employee } from '../types/incentive';

export type EmployeeImportRowStatus =
  | 'NEW_READY'
  | 'OVERLAP_CONFLICT'
  | 'UNCHANGED'
  | 'DUPLICATE_IN_FILE'
  | 'ERROR';

export interface EmployeeImportFieldError {
  field: string;
  reason: string;
}

export interface EmployeeFieldDiff {
  field:
    | 'saleId'
    | 'fullName'
    | 'loginId'
    | 'branch'
    | 'department'
    | 'designation'
    | 'gender'
    | 'category'
    | 'status'
    | 'dateOfBirth'
    | 'dateOfJoining'
    | 'phone'
    | 'panNumber'
    | 'uanNumber'
    | 'pfNumber'
    | 'esicNumber'
    | 'bankName'
    | 'bankAccountMasked'
    | 'bankIfsc'
    | 'linkedGoogleEmail'
    | 'address'
    | 'emergencyContact'
    | `custom:${string}`;
  label: string;
  masterValue: string;
  fileValue: string;
  isOrgField: boolean;
}

export interface ParsedEmployeeMasterRow {
  rowNumber: number;
  status: EmployeeImportRowStatus;
  rawEmployeeId: string;
  rawSaleId: string;
  rawLoginId: string;
  rawFullName: string;
  rawBranch: string;
  rawDepartment: string;
  rawDesignation: string;
  rawGender: string;
  rawCategory: string;
  rawStatus: string;
  rawDob: string;
  rawDoj: string;
  // Normalized / resolved values
  employeeId: string;
  saleId: string;
  loginId: string;
  fullName: string;
  branchId: string;
  branchName: string;
  departmentId: DepartmentId | '';
  departmentName: string;
  designation: string;
  gender: string;
  category: string;
  employeeStatus: 'ACTIVE' | 'INACTIVE';
  dateOfBirth: string;
  dateOfJoining: string;
  phone: string;
  panNumber: string;
  uanNumber: string;
  pfNumber: string;
  esicNumber: string;
  bankName: string;
  bankAccountMasked: string;
  bankIfsc: string;
  linkedGoogleEmail: string;
  address: string;
  emergencyContact: string;
  customFields: Record<string, string>;
  // Existing record context (for OVERLAP_CONFLICT / UNCHANGED)
  existingEmployee?: Employee;
  diffs: EmployeeFieldDiff[];
  hasOrgOverlap: boolean;
  overlapSummary: string;
  duplicateFirstRowNumber?: number;
  errorDetails: EmployeeImportFieldError[];
  summaryMessage: string;
}

export interface EmployeeMasterParseSummary {
  totalRows: number;
  newReadyCount: number;
  overlapConflictCount: number;
  orgOverlapCount: number;
  unchangedCount: number;
  duplicateInFileCount: number;
  errorCount: number;
  rows: ParsedEmployeeMasterRow[];
}

export const EMPLOYEE_MASTER_TEMPLATE_HEADERS = [
  'Employee ID',
  'Sale ID',
  'Login ID',
  'Full Name',
  'Branch',
  'Department',
  'Designation',
  'Gender',
  'Category',
  'Status',
  'Date of Birth',
  'Date of Joining',
  'Mobile Number',
  'PAN Number',
  'UAN Number',
  'PF Account Number',
  'ESIC Number',
  'Bank Name',
  'Bank Account Number',
  'Bank IFSC Code',
  'Google Email',
  'Residential Address',
  'Emergency Contact',
] as const;

const OFFICIAL_DEPT_NAMES_LABEL = OFFICIAL_DEPARTMENTS.map((d) => d.name).join(', ');

function normalizeHeaderKey(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeBranchToken(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function escapeCsvCell(value: string | number | undefined): string {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * Resolves a branch name/code/ID against Branch Master.
 * If unmatched, computes the closest valid branch suggestion so HR immediately sees typos.
 */
export function resolveMasterBranch(
  rawBranch: string,
  branches: Branch[],
): { branch: Branch | null; suggestion: string | null } {
  const trimmed = String(rawBranch || '').trim();
  if (!trimmed || branches.length === 0) {
    return { branch: null, suggestion: null };
  }

  const canonical = resolveCanonicalBranchName(trimmed);
  const targetClean = normalizeBranchToken(trimmed);
  const canonicalClean = normalizeBranchToken(canonical);

  for (const b of branches) {
    if (
      normalizeBranchToken(b.branchId) === targetClean ||
      normalizeBranchToken(b.branchCode) === targetClean ||
      normalizeBranchToken(b.branchName) === targetClean ||
      normalizeBranchToken(b.branchName) === canonicalClean ||
      normalizeBranchToken(b.branchCode) === canonicalClean ||
      normalizeBranchToken(b.branchId) === canonicalClean
    ) {
      return { branch: b, suggestion: null };
    }
  }

  // Fuzzy suggestion via Levenshtein distance (strictly for diagnostic error message — never silent auto-assign!)
  let bestBranch: Branch | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const b of branches) {
    const candidate = normalizeBranchToken(b.branchName);
    const dist = levenshteinDistance(targetClean, candidate);
    const maxLen = Math.max(targetClean.length, candidate.length, 1);
    const ratio = dist / maxLen;
    if (ratio < bestScore && ratio <= 0.45) {
      bestScore = ratio;
      bestBranch = b;
    }
  }

  return {
    branch: null,
    suggestion: bestBranch ? bestBranch.branchName : null,
  };
}

/**
 * Parses raw CSV text into a 2D array supporting quoted commas & newlines.
 */
export function parseCsvMatrix(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const clean = csvText.replace(/^\uFEFF/, '');

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    const next = clean[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

const EMPLOYEE_HEADER_SIGNALS = [
  'employeeid',
  'empid',
  'empcode',
  'saleid',
  'sellid',
  'salesmanno',
  'staffid',
  'fullname',
  'employeename',
  'empname',
  'salesmanname',
  'branch',
  'branchname',
  'branchcode',
  'department',
  'dept',
  'designation',
  'gender',
  'category',
  'post',
  'role',
  'loginid',
  'dateofbirth',
  'dob',
];

/**
 * Finds the most likely header row within the first 10 rows (handles company title banner rows).
 */
export function detectEmployeeHeaderRowIndex(matrix: unknown[][]): number {
  let bestIdx = 0;
  let bestScore = -1;
  const maxScan = Math.min(10, matrix.length);
  for (let r = 0; r < maxScan; r += 1) {
    const row = matrix[r] || [];
    let score = 0;
    for (const cell of row) {
      const key = normalizeHeaderKey(String(cell ?? ''));
      if (!key) continue;
      if (EMPLOYEE_HEADER_SIGNALS.some((sig) => key === sig || key.includes(sig))) {
        score += 2;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = r;
    }
  }
  return bestIdx;
}

/**
 * Generates an official House of Muktai Employee Master CSV template (blank guide OR pre-filled export).
 * Appends any custom columns created by Admin or present across Employee Master records.
 */
export function buildEmployeeMasterCsvTemplate(
  branches: Branch[],
  employees: Employee[],
  mode: 'blank' | 'prefilled' = 'blank',
  extraCustomColumns: string[] = [],
): string {
  const stdNormSet = new Set(EMPLOYEE_MASTER_TEMPLATE_HEADERS.map((h) => normalizeHeaderKey(h)));
  const customColumnNames: string[] = [];
  const seenCustomNorm = new Set<string>();

  const registerCustomCol = (rawName: string) => {
    const clean = String(rawName || '').trim().slice(0, 60);
    const norm = normalizeHeaderKey(clean);
    if (!clean || !norm || stdNormSet.has(norm) || seenCustomNorm.has(norm)) return;
    if (customColumnNames.length >= 25) return;
    seenCustomNorm.add(norm);
    customColumnNames.push(clean);
  };

  for (const col of extraCustomColumns) registerCustomCol(col);
  for (const emp of employees) {
    for (const key of Object.keys(emp.customFields || {})) {
      registerCustomCol(key);
    }
  }

  const allHeaders = [...EMPLOYEE_MASTER_TEMPLATE_HEADERS, ...customColumnNames];
  const lines: string[] = [allHeaders.map(escapeCsvCell).join(',')];

  if (mode === 'prefilled' && employees.length > 0) {
    const sorted = [...employees].sort(
      (a, b) =>
        a.branchName.localeCompare(b.branchName) || a.employeeId.localeCompare(b.employeeId),
    );
    for (const emp of sorted) {
      const customFieldValues = customColumnNames.map((col) => {
        const map = emp.customFields || {};
        if (map[col] !== undefined) return map[col];
        const colNorm = normalizeHeaderKey(col);
        for (const [k, v] of Object.entries(map)) {
          if (normalizeHeaderKey(k) === colNorm) return v;
        }
        return '';
      });
      lines.push(
        [
          emp.employeeId,
          emp.saleId || '',
          emp.loginId,
          emp.fullName,
          emp.branchName,
          emp.departmentName || '',
          emp.designation,
          emp.gender || '',
          emp.category || '',
          emp.status,
          emp.dateOfBirth || '',
          emp.dateOfJoining || '',
          emp.phone || '',
          emp.panNumber || '',
          emp.uanNumber || '',
          emp.pfNumber || '',
          emp.esicNumber || '',
          emp.bankName || '',
          emp.bankAccountMasked || '',
          emp.bankIfsc || '',
          emp.linkedGoogleEmail || '',
          emp.address || '',
          emp.emergencyContact || '',
          ...customFieldValues,
        ]
          .map(escapeCsvCell)
          .join(','),
      );
    }
    return lines.join('\n');
  }

  const branch1 = branches[0]?.branchName || 'BARAMATI MIDC';
  const branch2 = branches[1]?.branchName || branches[0]?.branchName || 'BEED';
  const blankCustomCells = customColumnNames.map(() => '');
  const sampleRows = [
    [
      'EMP901',
      '101',
      'HOM901',
      'Snehal Deshmukh',
      branch1,
      'Saree Dept.',
      'Sales Executive',
      'Female',
      'Sales',
      'ACTIVE',
      '1996-05-14',
      '2024-04-01',
      '9876543210',
      'ABCDE1234F',
      '101234567890',
      'MH/PUN/00123/001',
      '3112345678',
      'State Bank of India',
      'XXXX5678',
      'SBIN0001234',
      '',
      'Baramati, Dist. Pune',
      '9876500001',
      ...blankCustomCells,
    ],
    [
      'EMP902',
      '',
      'HOM902',
      'Pratiksha Kulkarni',
      branch2,
      'Accounts',
      'Accountant',
      'Female',
      'Non-Sales',
      'ACTIVE',
      '1994-11-22',
      '2023-08-15',
      '9823012345',
      '',
      '',
      '',
      '',
      'HDFC Bank',
      'XXXX9012',
      'HDFC0000456',
      '',
      'Beed City',
      '9823000002',
      ...blankCustomCells,
    ],
  ];
  for (const row of sampleRows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return lines.join('\n');
}

function pickCell(
  row: Record<string, unknown>,
  normalizedMap: Map<string, string>,
  aliases: string[],
  excludeSubstrings: string[] = [],
  claimedOrigKeys?: Set<string>,
): unknown {
  const isExcluded = (normKey: string) =>
    excludeSubstrings.length > 0 && excludeSubstrings.some((ex) => normKey.includes(ex));

  for (const alias of aliases) {
    const exactKey = normalizedMap.get(alias);
    if (exactKey !== undefined && !isExcluded(alias)) {
      claimedOrigKeys?.add(exactKey);
      const val = row[exactKey];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return val;
      }
    }
  }
  for (const [normKey, origKey] of normalizedMap.entries()) {
    if (isExcluded(normKey)) continue;
    if (aliases.some((alias) => normKey.includes(alias))) {
      claimedOrigKeys?.add(origKey);
      const val = row[origKey];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return val;
      }
    }
  }
  return '';
}

function stringifyCell(val: unknown): string {
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const yyyy = val.getFullYear();
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const dd = String(val.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return String(val ?? '').trim();
}

function deriveDefaultLoginId(employeeId: string): string {
  const clean = sanitizeId(employeeId).toUpperCase();
  if (!clean) return '';
  if (clean.startsWith('HOM') && clean.length >= 3) return clean.slice(0, 40);
  if (clean.startsWith('EMP') && clean.length >= 4) {
    return `HOM${clean.slice(3)}`.slice(0, 40);
  }
  const candidate = `HOM${clean}`.slice(0, 40);
  return candidate.length >= 3 ? candidate : `${candidate}00`.slice(0, 40);
}

/**
 * Parses and validates Employee Master rows against current Branch Master & Employee Master.
 * Guarantees ZERO silent overlaps and gives crystal-clear, actionable reasons for every error or conflict.
 */
export function parseEmployeeMasterRows(
  rawRows: Array<{ rowNumber: number; data: Record<string, unknown> }>,
  branches: Branch[],
  existingEmployees: Employee[],
): EmployeeMasterParseSummary {
  const existingById = new Map<string, Employee>();
  const existingBySaleId = new Map<string, Employee>();
  const existingByLoginId = new Map<string, Employee>();

  for (const emp of existingEmployees) {
    existingById.set(sanitizeId(emp.employeeId).toUpperCase(), emp);
    if (emp.saleId && emp.saleId.trim()) {
      existingBySaleId.set(sanitizeId(emp.saleId).toUpperCase(), emp);
    }
    if (emp.loginId) {
      existingByLoginId.set(emp.loginId.trim().toUpperCase(), emp);
    }
  }

  const seenEmpIdRow = new Map<string, number>();
  const seenSaleIdRow = new Map<string, number>();
  const seenLoginIdRow = new Map<string, number>();

  const validBranchNamesText =
    branches.length > 0
      ? branches.map((b) => b.branchName).join(', ')
      : 'No branches found in Branch Master';

  const parsed: ParsedEmployeeMasterRow[] = [];

  for (const entry of rawRows) {
    const { rowNumber, data } = entry;
    const normalizedMap = new Map<string, string>();
    for (const key of Object.keys(data)) {
      const norm = normalizeHeaderKey(key);
      if (norm && !normalizedMap.has(norm)) {
        normalizedMap.set(norm, key);
      }
    }

    const claimedOrigKeys = new Set<string>();

    const hasExplicitEmpIdCol =
      normalizedMap.has('employeeid') ||
      normalizedMap.has('empid') ||
      normalizedMap.has('empcode') ||
      normalizedMap.has('employeecode') ||
      normalizedMap.has('staffid');

    const rawEmpIdVal = pickCell(
      data,
      normalizedMap,
      hasExplicitEmpIdCol
        ? ['employeeid', 'empid', 'empcode', 'employeecode', 'staffid']
        : ['employeeid', 'empid', 'empcode', 'employeecode', 'salesmanno', 'staffid'],
      ['sell', 'saleid', 'salecode', 'login', 'user', 'branch', 'dept', 'department'],
      claimedOrigKeys,
    );
    const rawSaleIdVal = pickCell(
      data,
      normalizedMap,
      ['saleid', 'sellid', 'salecode', 'sellcode', 'salesmancode', 'posid', 'poscode'],
      ['emp', 'login', 'branch', 'dept'],
      claimedOrigKeys,
    );
    const rawLoginIdVal = pickCell(
      data,
      normalizedMap,
      ['loginid', 'userid', 'username', 'stafflogin'],
      [],
      claimedOrigKeys,
    );
    const rawFullNameVal = pickCell(
      data,
      normalizedMap,
      ['fullname', 'employeename', 'empname', 'salesmanname', 'staffname', 'name'],
      ['branch', 'dept', 'department', 'bank', 'father', 'mother', 'spouse', 'emergency', 'nominee'],
      claimedOrigKeys,
    );
    const rawBranchVal = pickCell(
      data,
      normalizedMap,
      ['branchname', 'branch', 'branchcode', 'store', 'location'],
      [],
      claimedOrigKeys,
    );
    const rawDepartmentVal = pickCell(
      data,
      normalizedMap,
      ['departmentname', 'department', 'dept', 'section'],
      [],
      claimedOrigKeys,
    );
    const rawDesignationVal = pickCell(
      data,
      normalizedMap,
      ['designation', 'desgination', 'jobtitle', 'position', 'post', 'title'],
      [],
      claimedOrigKeys,
    );
    const rawGenderVal = pickCell(data, normalizedMap, ['gender', 'sex'], [], claimedOrigKeys);
    const rawCategoryVal = pickCell(
      data,
      normalizedMap,
      ['category', 'staffcategory', 'empcategory', 'employeecategory'],
      [],
      claimedOrigKeys,
    );
    const rawStatusVal = pickCell(
      data,
      normalizedMap,
      ['status', 'employeestatus', 'active'],
      ['marital'],
      claimedOrigKeys,
    );
    const rawDobVal = pickCell(
      data,
      normalizedMap,
      ['dateofbirth', 'dob', 'birthdate', 'birthday'],
      [],
      claimedOrigKeys,
    );
    const rawDojVal = pickCell(
      data,
      normalizedMap,
      ['dateofjoining', 'doj', 'joiningdate', 'hiredate'],
      [],
      claimedOrigKeys,
    );
    const rawPhoneVal = pickCell(
      data,
      normalizedMap,
      ['mobilenumber', 'phonenumber', 'phone', 'mobile', 'mobileno', 'contactno', 'contact'],
      ['emergency', 'alt', 'alternate'],
      claimedOrigKeys,
    );
    const rawPanVal = pickCell(data, normalizedMap, ['pannumber', 'panno', 'pan'], ['company'], claimedOrigKeys);
    const rawUanVal = pickCell(data, normalizedMap, ['uannumber', 'uanno', 'uan'], [], claimedOrigKeys);
    const rawPfVal = pickCell(
      data,
      normalizedMap,
      ['pfaccountnumber', 'providentfundnumber', 'pfnumber', 'pfno', 'epfno', 'epf'],
      [],
      claimedOrigKeys,
    );
    const rawEsicVal = pickCell(
      data,
      normalizedMap,
      ['esicnumber', 'esicno', 'esic', 'esino'],
      [],
      claimedOrigKeys,
    );
    const rawBankNameVal = pickCell(data, normalizedMap, ['bankname', 'bank'], ['account', 'acc', 'ifsc'], claimedOrigKeys);
    const rawAccountVal = pickCell(
      data,
      normalizedMap,
      ['bankaccountnumber', 'bankaccountmasked', 'accountnumber', 'accountno', 'bankaccount', 'accno'],
      [],
      claimedOrigKeys,
    );
    const rawIfscVal = pickCell(
      data,
      normalizedMap,
      ['bankifsccode', 'bankifsc', 'ifsccode', 'ifsc'],
      [],
      claimedOrigKeys,
    );
    const rawGoogleEmailVal = pickCell(
      data,
      normalizedMap,
      ['linkedgoogleemail', 'googleemail', 'gmail', 'email'],
      [],
      claimedOrigKeys,
    );
    const rawAddressVal = pickCell(
      data,
      normalizedMap,
      ['address', 'residentialaddress', 'currentaddress', 'permanentaddress'],
      ['email', 'ip'],
      claimedOrigKeys,
    );
    const rawEmergencyContactVal = pickCell(
      data,
      normalizedMap,
      ['emergencycontact', 'emergencyphone', 'emergencymobile', 'emergencyno'],
      [],
      claimedOrigKeys,
    );

    const rawEmployeeId = cleanExcelTextCell(stringifyCell(rawEmpIdVal));
    const rawSaleId = sanitizeSaleIdCell(stringifyCell(rawSaleIdVal));
    const rawLoginId = cleanExcelTextCell(stringifyCell(rawLoginIdVal));
    const rawFullName = cleanExcelTextCell(stringifyCell(rawFullNameVal));
    const rawBranch = cleanExcelTextCell(stringifyCell(rawBranchVal));
    const rawDepartmentCandidate = cleanExcelTextCell(stringifyCell(rawDepartmentVal));
    const rawDepartment =
      rawDepartmentCandidate.toUpperCase() === 'LEFT' ? '' : rawDepartmentCandidate;
    const rawDesignation = cleanExcelTextCell(stringifyCell(rawDesignationVal));
    const rawGender = cleanExcelTextCell(stringifyCell(rawGenderVal));
    const rawCategory = cleanExcelTextCell(stringifyCell(rawCategoryVal));
    const rawStatus = cleanExcelTextCell(stringifyCell(rawStatusVal));
    const rawDob = cleanExcelTextCell(stringifyCell(rawDobVal));
    const rawDoj = cleanExcelTextCell(stringifyCell(rawDojVal));
    const phone = cleanExcelTextCell(stringifyCell(rawPhoneVal)).slice(0, 24);
    const panNumber = cleanExcelTextCell(stringifyCell(rawPanVal)).toUpperCase().slice(0, 20);
    const uanNumber = cleanExcelTextCell(stringifyCell(rawUanVal)).slice(0, 24);
    const pfNumber = cleanExcelTextCell(stringifyCell(rawPfVal)).slice(0, 32);
    const esicNumber = cleanExcelTextCell(stringifyCell(rawEsicVal)).slice(0, 32);
    const bankName = cleanExcelTextCell(stringifyCell(rawBankNameVal)).slice(0, 80);
    const rawAccount = cleanExcelTextCell(stringifyCell(rawAccountVal));
    const bankAccountMasked = rawAccount ? maskBankAccountNumber(rawAccount).slice(0, 32) : '';
    const bankIfsc = cleanExcelTextCell(stringifyCell(rawIfscVal)).toUpperCase().slice(0, 20);
    const linkedGoogleEmail = cleanExcelTextCell(stringifyCell(rawGoogleEmailVal)).toLowerCase().slice(0, 180);
    const address = cleanExcelTextCell(stringifyCell(rawAddressVal)).slice(0, 240);
    const emergencyContact = cleanExcelTextCell(stringifyCell(rawEmergencyContactVal)).slice(0, 120);

    // Collect any extra/custom columns not claimed by standard headers (excluding Sr No / S.No)
    const IGNORED_EXTRA_NORMS = new Set(['srno', 'sno', 'serialno', 'serialnumber', 'sr', 'slno', '__rowNum__']);
    const CLEAR_CUSTOM_TOKEN_RE = /^(\[CLEAR\]|CLEAR)$/i;
    const fileCustomFields: Record<string, string> = {};
    const clearedCustomFieldKeys: string[] = [];
    for (const [origKey, val] of Object.entries(data)) {
      if (claimedOrigKeys.has(origKey)) continue;
      const cleanKey = String(origKey || '').trim().slice(0, 60);
      const normKey = normalizeHeaderKey(cleanKey);
      if (!cleanKey || !normKey || IGNORED_EXTRA_NORMS.has(normKey) || cleanKey.startsWith('__')) continue;
      const strVal = stringifyCell(val).slice(0, 200);
      if (!strVal) continue;
      if (CLEAR_CUSTOM_TOKEN_RE.test(strVal)) {
        clearedCustomFieldKeys.push(cleanKey);
      } else if (Object.keys(fileCustomFields).length < 25) {
        fileCustomFields[cleanKey] = strVal;
      }
    }

    // Skip completely blank lines
    if (
      !rawEmployeeId &&
      !rawSaleId &&
      !rawFullName &&
      !rawBranch &&
      !rawDepartment &&
      !rawDesignation &&
      !rawLoginId
    ) {
      continue;
    }

    const errorDetails: EmployeeImportFieldError[] = [];

    // 1. Validate Employee ID
    const cleanEmpId = sanitizeId(rawEmployeeId).slice(0, 64);
    if (!rawEmployeeId) {
      errorDetails.push({
        field: 'Employee ID',
        reason: 'Employee ID is blank. Every row must have a unique Employee ID (e.g., EMP001 or 101).',
      });
    } else if (!cleanEmpId || !/^[a-zA-Z0-9_-]+$/.test(cleanEmpId)) {
      errorDetails.push({
        field: 'Employee ID',
        reason: `Invalid Employee ID "${rawEmployeeId}". Use only letters, numbers, hyphens (-) or underscores (_).`,
      });
    }

    const existing = cleanEmpId ? existingById.get(cleanEmpId.toUpperCase()) : undefined;

    // Merge existing customFields with fileCustomFields (and apply explicit CLEAR / [CLEAR] tokens)
    const mergedCustomFields: Record<string, string> = {
      ...(existing?.customFields || {}),
    };
    for (const clearKey of clearedCustomFieldKeys) {
      const cNorm = normalizeHeaderKey(clearKey);
      const existingMatchKey = Object.keys(mergedCustomFields).find(
        (k) => normalizeHeaderKey(k) === cNorm,
      );
      if (existingMatchKey) {
        delete mergedCustomFields[existingMatchKey];
      }
    }
    for (const [cKey, cVal] of Object.entries(fileCustomFields)) {
      const cNorm = normalizeHeaderKey(cKey);
      const existingMatchKey = Object.keys(mergedCustomFields).find(
        (k) => normalizeHeaderKey(k) === cNorm,
      );
      const targetKey = existingMatchKey || cKey;
      if (mergedCustomFields[targetKey] !== undefined || Object.keys(mergedCustomFields).length < 25) {
        mergedCustomFields[targetKey] = cVal;
      }
    }

    // 1b. Validate optional unique Sale ID (POS Salesman Code for Sales Staff; leave blank for Non-Sales)
    const normalizedSaleIdInput = rawSaleId
      ? rawSaleId.trim().toUpperCase().replace(/\s+/g, '')
      : '';
    const cleanSaleId = normalizedSaleIdInput
      ? sanitizeId(normalizedSaleIdInput).toUpperCase().slice(0, 40)
      : '';
    const resolvedSaleId = rawSaleId ? cleanSaleId : (existing?.saleId || '');
    if (rawSaleId) {
      if (!cleanSaleId || !/^[A-Z0-9_-]{1,40}$/.test(cleanSaleId)) {
        errorDetails.push({
          field: 'Sale ID',
          reason: `Invalid Sale ID "${rawSaleId}". Use only letters, numbers, hyphens (-) or underscores (_), max 40 chars (or leave blank for Non-Sales staff).`,
        });
      } else {
        const saleOwner = existingBySaleId.get(cleanSaleId.toUpperCase());
        if (
          saleOwner &&
          saleOwner.employeeId.toUpperCase() !== (cleanEmpId || '').toUpperCase()
        ) {
          errorDetails.push({
            field: 'Sale ID',
            reason: `Sale ID "${cleanSaleId}" is already assigned to existing employee "${saleOwner.fullName}" (${saleOwner.employeeId}) in branch ${saleOwner.branchName}. Every Sale ID must be unique.`,
          });
        }
      }
    }

    const resolvedGender = (rawGender || existing?.gender || '').trim().slice(0, 20);
    const resolvedCategory = (rawCategory || existing?.category || '').trim().slice(0, 40);

    // 2. Validate / Derive Login ID
    let resolvedLoginId = rawLoginId
      ? rawLoginId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '')
      : existing
        ? existing.loginId
        : deriveDefaultLoginId(cleanEmpId);

    if (rawLoginId) {
      if (!/^[A-Z0-9_-]{3,40}$/.test(resolvedLoginId)) {
        errorDetails.push({
          field: 'Login ID',
          reason: `Invalid Login ID "${rawLoginId}". Must be 3–40 uppercase letters, digits, hyphens, or underscores (e.g., HOM001).`,
        });
      }
    } else if (!existing && resolvedLoginId && !/^[A-Z0-9_-]{3,40}$/.test(resolvedLoginId)) {
      errorDetails.push({
        field: 'Login ID',
        reason: `Auto-generated Login ID "${resolvedLoginId}" is shorter than 3 characters. Please provide a Login ID (e.g., HOM001).`,
      });
    }

    // Protect provisioned Firebase Auth Login IDs from being silently changed
    if (
      existing &&
      rawLoginId &&
      resolvedLoginId !== existing.loginId.toUpperCase() &&
      existing.credentialsProvisioned
    ) {
      errorDetails.push({
        field: 'Login ID',
        reason: `Login ID cannot be changed from "${existing.loginId}" to "${resolvedLoginId}" because staff login credentials are already provisioned.`,
      });
    }

    // Check Login ID collision with ANOTHER existing employee
    if (resolvedLoginId) {
      const loginOwner = existingByLoginId.get(resolvedLoginId.toUpperCase());
      if (
        loginOwner &&
        loginOwner.employeeId.toUpperCase() !== (cleanEmpId || '').toUpperCase()
      ) {
        errorDetails.push({
          field: 'Login ID',
          reason: `Login ID "${resolvedLoginId}" is already assigned to existing employee "${loginOwner.fullName}" (${loginOwner.employeeId}) in branch ${loginOwner.branchName}.`,
        });
      }
    }

    // 3. Check duplicate Employee ID / Sale ID / Login ID inside the same uploaded file
    let duplicateFirstRowNumber: number | undefined;
    let duplicateReason = '';
    if (cleanEmpId) {
      const firstEmpRow = seenEmpIdRow.get(cleanEmpId.toUpperCase());
      if (firstEmpRow !== undefined) {
        duplicateFirstRowNumber = firstEmpRow;
        duplicateReason = `Duplicate Employee ID "${cleanEmpId}" inside this file — already appeared on Row ${firstEmpRow}. Remove the duplicate row so data does not overlap.`;
      } else {
        seenEmpIdRow.set(cleanEmpId.toUpperCase(), rowNumber);
      }
    }
    if (!duplicateFirstRowNumber && cleanSaleId) {
      const firstSaleRow = seenSaleIdRow.get(cleanSaleId.toUpperCase());
      if (firstSaleRow !== undefined) {
        duplicateFirstRowNumber = firstSaleRow;
        duplicateReason = `Duplicate Sale ID "${cleanSaleId}" inside this file — already assigned on Row ${firstSaleRow}. Every Sales employee must have a unique Sale ID.`;
      } else {
        seenSaleIdRow.set(cleanSaleId.toUpperCase(), rowNumber);
      }
    }
    if (!duplicateFirstRowNumber && resolvedLoginId) {
      const firstLoginRow = seenLoginIdRow.get(resolvedLoginId.toUpperCase());
      if (firstLoginRow !== undefined) {
        duplicateFirstRowNumber = firstLoginRow;
        duplicateReason = `Duplicate Login ID "${resolvedLoginId}" inside this file — already used on Row ${firstLoginRow}. Every employee must have a unique Login ID.`;
      } else {
        seenLoginIdRow.set(resolvedLoginId.toUpperCase(), rowNumber);
      }
    }

    // 4. Full Name
    const resolvedFullName = (rawFullName || existing?.fullName || '').trim().slice(0, 120);
    if (!existing && !rawFullName) {
      errorDetails.push({
        field: 'Full Name',
        reason: 'Full Name is blank. Please enter the employee’s full name.',
      });
    }

    // 5. Branch validation (strict against Branch Master — zero silent mismatches)
    let resolvedBranchId = existing?.branchId || '';
    let resolvedBranchName = existing?.branchName || '';
    if (rawBranch) {
      const branchHit = resolveMasterBranch(rawBranch, branches);
      if (branchHit.branch) {
        resolvedBranchId = branchHit.branch.branchId;
        resolvedBranchName = branchHit.branch.branchName;
      } else {
        const suggestionNote = branchHit.suggestion
          ? ` Did you mean "${branchHit.suggestion}"?`
          : '';
        errorDetails.push({
          field: 'Branch',
          reason: `Branch "${rawBranch}" was not found in Branch Master.${suggestionNote} Valid branches: ${validBranchNamesText}.`,
        });
      }
    } else if (!existing) {
      errorDetails.push({
        field: 'Branch',
        reason: `Branch is blank. Every new employee must belong to a valid branch (${validBranchNamesText}).`,
      });
    }

    // 6. Department validation (5 Official Sales Leaderboard Depts + Any valid Non-Sales Dept like Accounts, HR, Billing, Head Office)
    let resolvedDepartmentId: DepartmentId | '' = existing?.departmentId || '';
    let resolvedDepartmentName = existing?.departmentName || '';
    if (rawDepartment) {
      const deptHit = resolveCanonicalDepartment(rawDepartment);
      if (deptHit) {
        resolvedDepartmentId = deptHit.id;
        resolvedDepartmentName = deptHit.name;
      } else {
        const nonSalesName = normalizeNonSalesDepartmentName(rawDepartment);
        if (nonSalesName) {
          resolvedDepartmentId = '';
          resolvedDepartmentName = nonSalesName;
        } else {
          errorDetails.push({
            field: 'Department',
            reason: `Invalid Department "${rawDepartment}". Enter one of the 5 Sales Depts (${OFFICIAL_DEPT_NAMES_LABEL}) or a valid Non-Sales Dept (e.g., Accounts, HR & Admin, Billing & Cash, Head Office).`,
          });
        }
      }
    }

    // 7. Designation validation (required for new employees)
    const resolvedDesignation = (rawDesignation || existing?.designation || '').trim().slice(0, 80);
    if (!existing && !rawDesignation) {
      errorDetails.push({
        field: 'Designation',
        reason: 'Designation is blank. Please specify a designation (e.g., Sales Executive, Accountant, Cashier, HR Executive, Store Manager).',
      });
    }

    // 8. Status validation
    let resolvedStatus: 'ACTIVE' | 'INACTIVE' = existing?.status || 'ACTIVE';
    if (rawStatus) {
      const up = rawStatus.toUpperCase();
      if (up === 'ACTIVE' || up === 'A' || up === 'YES' || up === '1') {
        resolvedStatus = 'ACTIVE';
      } else if (up === 'INACTIVE' || up === 'I' || up === 'NO' || up === '0' || up === 'LEFT') {
        resolvedStatus = 'INACTIVE';
      } else {
        errorDetails.push({
          field: 'Status',
          reason: `Invalid Status "${rawStatus}". Allowed values: ACTIVE or INACTIVE.`,
        });
      }
    }

    // 9. Date of Birth validation
    let resolvedDob = existing?.dateOfBirth || '';
    if (rawDob) {
      const parsedDob = parseDobToIso(rawDobVal);
      if (!parsedDob) {
        errorDetails.push({
          field: 'Date of Birth',
          reason: `Invalid Date of Birth "${rawDob}". Use YYYY-MM-DD (e.g., 1996-05-14) or DD-MM-YYYY format.`,
        });
      } else {
        resolvedDob = parsedDob;
      }
    }

    // 10. Date of Joining validation
    let resolvedDoj = existing?.dateOfJoining || '';
    if (rawDoj) {
      const parsedDoj = normalizeDateCellToIso(rawDojVal);
      if (!parsedDoj) {
        errorDetails.push({
          field: 'Date of Joining',
          reason: `Invalid Date of Joining "${rawDoj}". Use YYYY-MM-DD or DD-MM-YYYY format.`,
        });
      } else {
        resolvedDoj = parsedDoj;
      }
    }

    // 11. Google Email basic validation
    if (linkedGoogleEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(linkedGoogleEmail)) {
      errorDetails.push({
        field: 'Google Email',
        reason: `Invalid Google Email "${linkedGoogleEmail}". Enter a valid email address or leave blank.`,
      });
    }

    // Determine final classification
    if (duplicateFirstRowNumber !== undefined) {
      parsed.push({
        rowNumber,
        status: 'DUPLICATE_IN_FILE',
        rawEmployeeId,
        rawSaleId,
        rawLoginId,
        rawFullName,
        rawBranch,
        rawDepartment,
        rawDesignation,
        rawGender,
        rawCategory,
        rawStatus,
        rawDob,
        rawDoj,
        employeeId: cleanEmpId,
        saleId: resolvedSaleId,
        loginId: resolvedLoginId,
        fullName: resolvedFullName,
        branchId: resolvedBranchId,
        branchName: resolvedBranchName,
        departmentId: resolvedDepartmentId,
        departmentName: resolvedDepartmentName,
        designation: resolvedDesignation,
        gender: resolvedGender,
        category: resolvedCategory,
        employeeStatus: resolvedStatus,
        dateOfBirth: resolvedDob,
        dateOfJoining: resolvedDoj,
        phone,
        panNumber,
        uanNumber,
        pfNumber,
        esicNumber,
        bankName,
        bankAccountMasked,
        bankIfsc,
        linkedGoogleEmail,
        address,
        emergencyContact,
        customFields: mergedCustomFields,
        existingEmployee: existing,
        diffs: [],
        hasOrgOverlap: false,
        overlapSummary: '',
        duplicateFirstRowNumber,
        errorDetails: [
          { field: 'Duplicate Row', reason: duplicateReason },
          ...errorDetails,
        ],
        summaryMessage: duplicateReason,
      });
      continue;
    }

    if (errorDetails.length > 0) {
      parsed.push({
        rowNumber,
        status: 'ERROR',
        rawEmployeeId,
        rawSaleId,
        rawLoginId,
        rawFullName,
        rawBranch,
        rawDepartment,
        rawDesignation,
        rawGender,
        rawCategory,
        rawStatus,
        rawDob,
        rawDoj,
        employeeId: cleanEmpId,
        saleId: resolvedSaleId,
        loginId: resolvedLoginId,
        fullName: resolvedFullName,
        branchId: resolvedBranchId,
        branchName: resolvedBranchName,
        departmentId: resolvedDepartmentId,
        departmentName: resolvedDepartmentName,
        designation: resolvedDesignation,
        gender: resolvedGender,
        category: resolvedCategory,
        employeeStatus: resolvedStatus,
        dateOfBirth: resolvedDob,
        dateOfJoining: resolvedDoj,
        phone,
        panNumber,
        uanNumber,
        pfNumber,
        esicNumber,
        bankName,
        bankAccountMasked,
        bankIfsc,
        linkedGoogleEmail,
        address,
        emergencyContact,
        customFields: mergedCustomFields,
        existingEmployee: existing,
        diffs: [],
        hasOrgOverlap: false,
        overlapSummary: '',
        errorDetails,
        summaryMessage: errorDetails.map((e) => `${e.field}: ${e.reason}`).join(' | '),
      });
      continue;
    }

    if (!existing) {
      const customCount = Object.keys(fileCustomFields).length;
      parsed.push({
        rowNumber,
        status: 'NEW_READY',
        rawEmployeeId,
        rawSaleId,
        rawLoginId,
        rawFullName,
        rawBranch,
        rawDepartment,
        rawDesignation,
        rawGender,
        rawCategory,
        rawStatus,
        rawDob,
        rawDoj,
        employeeId: cleanEmpId,
        saleId: resolvedSaleId,
        loginId: resolvedLoginId,
        fullName: resolvedFullName,
        branchId: resolvedBranchId,
        branchName: resolvedBranchName,
        departmentId: resolvedDepartmentId,
        departmentName: resolvedDepartmentName,
        designation: resolvedDesignation,
        gender: resolvedGender,
        category: resolvedCategory,
        employeeStatus: resolvedStatus,
        dateOfBirth: resolvedDob,
        dateOfJoining: resolvedDoj,
        phone,
        panNumber,
        uanNumber,
        pfNumber,
        esicNumber,
        bankName,
        bankAccountMasked,
        bankIfsc,
        linkedGoogleEmail,
        address,
        emergencyContact,
        customFields: fileCustomFields,
        diffs: [],
        hasOrgOverlap: false,
        overlapSummary: '',
        errorDetails: [],
        summaryMessage: `New employee ready to create in ${resolvedBranchName}${resolvedDepartmentName ? ` · ${resolvedDepartmentName}` : ''}${resolvedSaleId ? ` · Sale ID ${resolvedSaleId}` : ''}${customCount > 0 ? ` · +${customCount} custom column(s)` : ''} (${resolvedDesignation}).`,
      });
      continue;
    }

    // Existing employee found — compute exact field-by-field diff so NOTHING overlaps silently!
    const diffs: EmployeeFieldDiff[] = [];
    const pushDiff = (
      field: EmployeeFieldDiff['field'],
      label: string,
      masterValue: string,
      fileValue: string,
      isOrgField = false,
    ) => {
      if (masterValue.trim() !== fileValue.trim()) {
        diffs.push({
          field,
          label,
          masterValue: masterValue.trim() || '(Blank)',
          fileValue: fileValue.trim() || '(Blank)',
          isOrgField,
        });
      }
    };

    if (rawSaleId && resolvedSaleId !== (existing.saleId || '')) {
      pushDiff('saleId', 'Sale ID', existing.saleId || '', resolvedSaleId, false);
    }
    if (rawBranch && resolvedBranchId !== existing.branchId) {
      pushDiff('branch', 'Branch', existing.branchName, resolvedBranchName, true);
    }
    if (
      rawDepartment &&
      (resolvedDepartmentId !== (existing.departmentId || '') ||
        resolvedDepartmentName.trim().toLowerCase() !== (existing.departmentName || '').trim().toLowerCase())
    ) {
      pushDiff(
        'department',
        'Department',
        existing.departmentName || 'Unassigned',
        resolvedDepartmentName || 'Unassigned',
        true,
      );
    }
    if (rawDesignation && resolvedDesignation !== existing.designation) {
      pushDiff('designation', 'Designation', existing.designation, resolvedDesignation, true);
    }
    if (rawGender && resolvedGender !== (existing.gender || '')) {
      pushDiff('gender', 'Gender', existing.gender || '', resolvedGender, false);
    }
    if (rawCategory && resolvedCategory !== (existing.category || '')) {
      pushDiff('category', 'Category', existing.category || '', resolvedCategory, false);
    }
    if (rawFullName && resolvedFullName !== existing.fullName) {
      pushDiff('fullName', 'Full Name', existing.fullName, resolvedFullName, false);
    }
    if (rawLoginId && resolvedLoginId !== existing.loginId) {
      pushDiff('loginId', 'Login ID', existing.loginId, resolvedLoginId, false);
    }
    if (rawStatus && resolvedStatus !== existing.status) {
      pushDiff('status', 'Status', existing.status, resolvedStatus, false);
    }
    if (rawDob && resolvedDob !== (existing.dateOfBirth || '')) {
      pushDiff('dateOfBirth', 'Date of Birth', existing.dateOfBirth || '', resolvedDob, false);
    }
    if (rawDoj && resolvedDoj !== (existing.dateOfJoining || '')) {
      pushDiff('dateOfJoining', 'Date of Joining', existing.dateOfJoining || '', resolvedDoj, false);
    }
    if (phone && phone !== (existing.phone || '')) {
      pushDiff('phone', 'Phone', existing.phone || '', phone, false);
    }
    if (panNumber && panNumber !== (existing.panNumber || '')) {
      pushDiff('panNumber', 'PAN', existing.panNumber || '', panNumber, false);
    }
    if (uanNumber && uanNumber !== (existing.uanNumber || '')) {
      pushDiff('uanNumber', 'UAN', existing.uanNumber || '', uanNumber, false);
    }
    if (pfNumber && pfNumber !== (existing.pfNumber || '')) {
      pushDiff('pfNumber', 'PF No', existing.pfNumber || '', pfNumber, false);
    }
    if (esicNumber && esicNumber !== (existing.esicNumber || '')) {
      pushDiff('esicNumber', 'ESIC No', existing.esicNumber || '', esicNumber, false);
    }
    if (bankName && bankName !== (existing.bankName || '')) {
      pushDiff('bankName', 'Bank Name', existing.bankName || '', bankName, false);
    }
    if (bankAccountMasked && bankAccountMasked !== (existing.bankAccountMasked || '')) {
      pushDiff(
        'bankAccountMasked',
        'Account No',
        existing.bankAccountMasked || '',
        bankAccountMasked,
        false,
      );
    }
    if (bankIfsc && bankIfsc !== (existing.bankIfsc || '')) {
      pushDiff('bankIfsc', 'IFSC', existing.bankIfsc || '', bankIfsc, false);
    }
    if (linkedGoogleEmail && linkedGoogleEmail !== (existing.linkedGoogleEmail || '')) {
      pushDiff(
        'linkedGoogleEmail',
        'Google Email',
        existing.linkedGoogleEmail || '',
        linkedGoogleEmail,
        false,
      );
    }
    if (address && address !== (existing.address || '')) {
      pushDiff('address', 'Address', existing.address || '', address, false);
    }
    if (emergencyContact && emergencyContact !== (existing.emergencyContact || '')) {
      pushDiff(
        'emergencyContact',
        'Emergency Contact',
        existing.emergencyContact || '',
        emergencyContact,
        false,
      );
    }
    for (const [cKey, cVal] of Object.entries(fileCustomFields)) {
      const existingCustomMap = existing.customFields || {};
      const cNorm = normalizeHeaderKey(cKey);
      const matchKey = Object.keys(existingCustomMap).find((k) => normalizeHeaderKey(k) === cNorm);
      const existingVal = matchKey ? existingCustomMap[matchKey] : '';
      if (cVal && cVal !== existingVal) {
        pushDiff(`custom:${cKey}`, cKey, existingVal || '', cVal, false);
      }
    }
    for (const clearKey of clearedCustomFieldKeys) {
      const existingCustomMap = existing.customFields || {};
      const cNorm = normalizeHeaderKey(clearKey);
      const matchKey = Object.keys(existingCustomMap).find((k) => normalizeHeaderKey(k) === cNorm);
      const existingVal = matchKey ? existingCustomMap[matchKey] : '';
      if (existingVal) {
        pushDiff(`custom:${matchKey || clearKey}`, matchKey || clearKey, existingVal, '(Cleared)', false);
      }
    }

    if (diffs.length === 0) {
      parsed.push({
        rowNumber,
        status: 'UNCHANGED',
        rawEmployeeId,
        rawSaleId,
        rawLoginId,
        rawFullName,
        rawBranch,
        rawDepartment,
        rawDesignation,
        rawGender,
        rawCategory,
        rawStatus,
        rawDob,
        rawDoj,
        employeeId: existing.employeeId,
        saleId: existing.saleId || '',
        loginId: existing.loginId,
        fullName: existing.fullName,
        branchId: existing.branchId,
        branchName: existing.branchName,
        departmentId: existing.departmentId || '',
        departmentName: existing.departmentName || '',
        designation: existing.designation,
        gender: existing.gender || '',
        category: existing.category || '',
        employeeStatus: existing.status,
        dateOfBirth: existing.dateOfBirth || '',
        dateOfJoining: existing.dateOfJoining || '',
        phone: existing.phone || '',
        panNumber: existing.panNumber || '',
        uanNumber: existing.uanNumber || '',
        pfNumber: existing.pfNumber || '',
        esicNumber: existing.esicNumber || '',
        bankName: existing.bankName || '',
        bankAccountMasked: existing.bankAccountMasked || '',
        bankIfsc: existing.bankIfsc || '',
        linkedGoogleEmail: existing.linkedGoogleEmail || '',
        address: existing.address || '',
        emergencyContact: existing.emergencyContact || '',
        customFields: existing.customFields || {},
        existingEmployee: existing,
        diffs: [],
        hasOrgOverlap: false,
        overlapSummary: '',
        errorDetails: [],
        summaryMessage: 'Matches existing Employee Master identically — safely skipped.',
      });
      continue;
    }

    const hasOrgOverlap = diffs.some((d) => d.isOrgField);
    const overlapSummary = diffs
      .map((d) => `${d.label}: ${d.masterValue} -> ${d.fileValue}`)
      .join(' | ');

    parsed.push({
      rowNumber,
      status: 'OVERLAP_CONFLICT',
      rawEmployeeId,
      rawSaleId,
      rawLoginId,
      rawFullName,
      rawBranch,
      rawDepartment,
      rawDesignation,
      rawGender,
      rawCategory,
      rawStatus,
      rawDob,
      rawDoj,
      employeeId: existing.employeeId,
      saleId: resolvedSaleId,
      loginId: resolvedLoginId,
      fullName: resolvedFullName,
      branchId: resolvedBranchId,
      branchName: resolvedBranchName,
      departmentId: resolvedDepartmentId,
      departmentName: resolvedDepartmentName,
      designation: resolvedDesignation,
      gender: resolvedGender,
      category: resolvedCategory,
      employeeStatus: resolvedStatus,
      dateOfBirth: resolvedDob,
      dateOfJoining: resolvedDoj,
      phone: phone || existing.phone || '',
      panNumber: panNumber || existing.panNumber || '',
      uanNumber: uanNumber || existing.uanNumber || '',
      pfNumber: pfNumber || existing.pfNumber || '',
      esicNumber: esicNumber || existing.esicNumber || '',
      bankName: bankName || existing.bankName || '',
      bankAccountMasked: bankAccountMasked || existing.bankAccountMasked || '',
      bankIfsc: bankIfsc || existing.bankIfsc || '',
      linkedGoogleEmail: linkedGoogleEmail || existing.linkedGoogleEmail || '',
      address: address || existing.address || '',
      emergencyContact: emergencyContact || existing.emergencyContact || '',
      customFields: mergedCustomFields,
      existingEmployee: existing,
      diffs,
      hasOrgOverlap,
      overlapSummary,
      errorDetails: [],
      summaryMessage: `Existing employee "${existing.fullName}" (${existing.employeeId}) differs on ${diffs.length} field(s): ${overlapSummary}. Protected from silent overwrite — approve explicitly to update.`,
    });
  }

  return {
    totalRows: parsed.length,
    newReadyCount: parsed.filter((r) => r.status === 'NEW_READY').length,
    overlapConflictCount: parsed.filter((r) => r.status === 'OVERLAP_CONFLICT').length,
    orgOverlapCount: parsed.filter((r) => r.status === 'OVERLAP_CONFLICT' && r.hasOrgOverlap).length,
    unchangedCount: parsed.filter((r) => r.status === 'UNCHANGED').length,
    duplicateInFileCount: parsed.filter((r) => r.status === 'DUPLICATE_IN_FILE').length,
    errorCount: parsed.filter((r) => r.status === 'ERROR').length,
    rows: parsed,
  };
}

/**
 * Convenience parser for CSV text files (auto-detects header row beneath optional company title banners).
 */
export function parseEmployeeMasterCsvText(
  csvText: string,
  branches: Branch[],
  existingEmployees: Employee[],
): EmployeeMasterParseSummary {
  const matrix = parseCsvMatrix(csvText);
  if (matrix.length < 2) {
    return {
      totalRows: 0,
      newReadyCount: 0,
      overlapConflictCount: 0,
      orgOverlapCount: 0,
      unchangedCount: 0,
      duplicateInFileCount: 0,
      errorCount: 0,
      rows: [],
    };
  }

  const headerIdx = detectEmployeeHeaderRowIndex(matrix);
  const headers = matrix[headerIdx] || [];
  const rawRows: Array<{ rowNumber: number; data: Record<string, unknown> }> = [];

  for (let i = headerIdx + 1; i < matrix.length; i += 1) {
    const line = matrix[i] || [];
    if (line.every((c) => !String(c || '').trim())) continue;
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c += 1) {
      const h = String(headers[c] || '').trim();
      if (!h) continue;
      obj[h] = line[c] ?? '';
    }
    rawRows.push({ rowNumber: i + 1, data: obj });
  }

  return parseEmployeeMasterRows(rawRows, branches, existingEmployees);
}

/**
 * Exports a downloadable CSV diagnostic report containing all ERROR, DUPLICATE_IN_FILE,
 * and OVERLAP_CONFLICT rows with exact reasons and Master vs File comparisons for Branch,
 * Department, and Designation.
 */
export function buildEmployeeImportDiagnosticsCsv(rows: ParsedEmployeeMasterRow[]): string {
  const headers = [
    'Row No',
    'Diagnostic Category',
    'Why Error / Overlap Occurred',
    'Employee ID',
    'Sale ID',
    'Login ID',
    'Full Name',
    'Branch (Master)',
    'Branch (File)',
    'Department (Master)',
    'Department (File)',
    'Designation (Master)',
    'Designation (File)',
    'Status (File)',
    'Date of Birth (File)',
  ];

  const lines: string[] = [headers.join(',')];
  const issueRows = rows.filter(
    (r) =>
      r.status === 'ERROR' ||
      r.status === 'DUPLICATE_IN_FILE' ||
      r.status === 'OVERLAP_CONFLICT',
  );

  for (const r of issueRows) {
    const categoryLabel =
      r.status === 'ERROR'
        ? 'VALIDATION ERROR'
        : r.status === 'DUPLICATE_IN_FILE'
          ? 'DUPLICATE IN FILE'
          : 'OVERLAP / CONFLICT (NOT OVERWRITTEN)';

    const reasonText =
      r.status === 'OVERLAP_CONFLICT'
        ? `Existing record differs: ${r.overlapSummary}`
        : r.summaryMessage;

    lines.push(
      [
        r.rowNumber,
        categoryLabel,
        reasonText,
        r.rawEmployeeId || r.employeeId,
        r.rawSaleId || r.saleId || '-',
        r.rawLoginId || r.loginId,
        r.rawFullName || r.fullName,
        r.existingEmployee?.branchName || '-',
        r.rawBranch || '-',
        r.existingEmployee?.departmentName || '-',
        r.rawDepartment || '-',
        r.existingEmployee?.designation || '-',
        r.rawDesignation || '-',
        r.rawStatus || r.employeeStatus,
        r.rawDob || '-',
      ]
        .map(escapeCsvCell)
        .join(','),
    );
  }

  return lines.join('\n');
}
