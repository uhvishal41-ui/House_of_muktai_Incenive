import { aggregateEmployeeMonth } from './incentiveEngine';
import type {
  DepartmentId,
  DepartmentLeaderboard,
  DepartmentLeaderboardEntry,
  Employee,
  EmployeeDepartmentRank,
  PortalVisibilitySettings,
  PublishedIncentive,
} from '../types/incentive';

export interface OfficialDepartment {
  id: DepartmentId;
  name: string;
  shortName: string;
}

export const OFFICIAL_DEPARTMENTS: readonly OfficialDepartment[] = [
  { id: 'SAREE', name: 'Saree Dept.', shortName: 'Saree' },
  { id: 'LADIES_WEAR', name: 'Ladies Wear Dept.', shortName: 'Ladies Wear' },
  { id: 'KIDS_WEAR', name: 'Kids Wear Dept.', shortName: 'Kids Wear' },
  { id: 'MENS_WEAR', name: 'Mens Wear Dept.', shortName: 'Mens Wear' },
  { id: 'NON_APPARELS', name: 'Non Apparels Dept.', shortName: 'Non Apparels' },
] as const;

export const MAX_EMPLOYEE_PHOTO_DATA_URL_LEN = 45000;

export function getDepartmentById(id?: string | null): OfficialDepartment | null {
  if (!id) return null;
  const clean = id.trim().toUpperCase();
  return OFFICIAL_DEPARTMENTS.find((d) => d.id === clean) || null;
}

/**
 * Normalizes messy Excel/CSV/human department inputs (e.g. "Lediesware Dept.",
 * "Kids ware", "Mens ware", "Non-Apparels", "Saree") to one of the 5 official departments.
 */
export function resolveCanonicalDepartment(raw?: string | null): OfficialDepartment | null {
  if (!raw) return null;
  const compact = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!compact) return null;

  if (compact.includes('saree') || compact.includes('sari')) {
    return OFFICIAL_DEPARTMENTS[0];
  }
  if (
    compact.includes('ladies') ||
    compact.includes('ledies') ||
    compact.includes('lady') ||
    compact.includes('women') ||
    compact.includes('kurti')
  ) {
    return OFFICIAL_DEPARTMENTS[1];
  }
  if (compact.includes('kid') || compact.includes('child') || compact.includes('baby')) {
    return OFFICIAL_DEPARTMENTS[2];
  }
  if (
    compact.includes('mens') ||
    compact.includes('gents') ||
    compact === 'man' ||
    compact === 'manwear' ||
    compact === 'manswear' ||
    compact === 'manware' ||
    compact === 'mansware'
  ) {
    return OFFICIAL_DEPARTMENTS[3];
  }
  if (
    compact.includes('nonapparel') ||
    compact.includes('nonaparel') ||
    compact.includes('nonapp') ||
    compact.includes('homefurnish') ||
    compact.includes('accessor') ||
    compact.includes('handloom')
  ) {
    return OFFICIAL_DEPARTMENTS[4];
  }
  return null;
}

/**
 * Common Non-Sales / Support / Head Office departments across House of Muktai branches.
 * These staff receive full Salary Slips, Employee Master profiles, and 12-Branch Birthday Wishes,
 * while staying cleanly separated from the 5 Textile Sales Counter Top-3 Leaderboards.
 */
export const COMMON_NON_SALES_DEPARTMENTS: readonly string[] = [
  'Head Office',
  'Accounts',
  'HR & Admin',
  'Billing & Cash',
  'Store Operations',
  'Management',
  'Purchase',
  'Inventory & Stock',
  'Warehouse & Dispatch',
  'IT & Systems',
  'Marketing',
  'Tailoring & Alteration',
  'Security',
  'Housekeeping',
  'Audit & Compliance',
  'Maintenance',
] as const;

const NON_SALES_ALIASES: Record<string, string> = {
  hr: 'HR & Admin',
  humanresource: 'HR & Admin',
  humanresources: 'HR & Admin',
  hradmin: 'HR & Admin',
  admin: 'Admin',
  administration: 'Admin',
  ho: 'Head Office',
  headoffice: 'Head Office',
  account: 'Accounts',
  accounts: 'Accounts',
  finance: 'Accounts',
  accounting: 'Accounts',
  billing: 'Billing & Cash',
  cash: 'Billing & Cash',
  cashier: 'Billing & Cash',
  billingcash: 'Billing & Cash',
  cashcounter: 'Billing & Cash',
  it: 'IT & Systems',
  itsystems: 'IT & Systems',
  edp: 'IT & Systems',
  ops: 'Store Operations',
  operations: 'Store Operations',
  storeops: 'Store Operations',
  storeoperations: 'Store Operations',
  mgmt: 'Management',
  management: 'Management',
  purchase: 'Purchase',
  procurement: 'Purchase',
  inventory: 'Inventory & Stock',
  stock: 'Inventory & Stock',
  godown: 'Warehouse & Dispatch',
  warehouse: 'Warehouse & Dispatch',
  dispatch: 'Warehouse & Dispatch',
  logistics: 'Warehouse & Dispatch',
  security: 'Security',
  housekeeping: 'Housekeeping',
  tailoring: 'Tailoring & Alteration',
  alteration: 'Tailoring & Alteration',
  marketing: 'Marketing',
  audit: 'Audit & Compliance',
  maintenance: 'Maintenance',
};

/**
 * Validates and normalizes a Non-Sales department name (e.g., "Accounts", "HR", "Billing", "Head Office").
 * Returns null if the input is blank or clearly invalid (e.g., purely numeric/symbol junk like "12345").
 */
export function normalizeNonSalesDepartmentName(raw?: string | null): string | null {
  const trimmed = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  // Must contain at least 2 alphabetic characters so purely numeric/punctuation junk is rejected
  const letterCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
  if (letterCount < 2 || trimmed.length > 80) return null;

  const compact = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (NON_SALES_ALIASES[compact]) {
    return NON_SALES_ALIASES[compact];
  }
  return trimmed.slice(0, 80);
}

/**
 * Pure visibility predicate: Determines whether a given YYYY-MM month is visible to employees
 * under the Super Admin's PortalVisibilitySettings.
 * Defaults to visible when settings have not yet been configured (backward compatibility).
 */
export function isMonthVisibleToEmployees(
  monthKey: string,
  settings: PortalVisibilitySettings | null | undefined,
): boolean {
  if (!monthKey) return false;
  if (!settings || settings.mode === 'ALL') return true;
  return Array.isArray(settings.visibleMonths) && settings.visibleMonths.includes(monthKey);
}

export function filterVisibleMonths(
  monthKeys: string[],
  settings: PortalVisibilitySettings | null | undefined,
): string[] {
  if (!settings || settings.mode === 'ALL') return [...monthKeys];
  const allowed = new Set(settings.visibleMonths || []);
  return monthKeys.filter((m) => allowed.has(m));
}

export function buildDepartmentLeaderboardId(monthKey: string, departmentId: DepartmentId): string {
  return `${monthKey}__${departmentId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function buildEmployeeRankId(monthKey: string, employeeId: string): string {
  return `${monthKey}__${employeeId.trim()}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export interface ComputedDepartmentRankings {
  monthKey: string;
  leaderboards: DepartmentLeaderboard[];
  employeeRanks: EmployeeDepartmentRank[];
}

/**
 * Computes privacy-safe Cross-Branch Top-3 Sales Leaderboards (ONLY Sale Amount + Name + Branch + Photo,
 * strictly ZERO incentive figures or peer PII) and individual Employee Department Ranks for all 5 departments.
 */
export function computeDepartmentLeaderboardsAndRanks(params: {
  monthKey: string;
  employees: Employee[];
  incentives: PublishedIncentive[];
  employeeVisible: boolean;
  updatedByEmail: string;
  now?: string;
}): ComputedDepartmentRankings {
  const now = params.now || new Date().toISOString();
  const leaderboards: DepartmentLeaderboard[] = [];
  const employeeRanks: EmployeeDepartmentRank[] = [];

  for (const dept of OFFICIAL_DEPARTMENTS) {
    const deptEmployees = params.employees.filter(
      (e) => e.status === 'ACTIVE' && e.departmentId === dept.id,
    );

    const scored = deptEmployees.map((emp) => {
      const agg = aggregateEmployeeMonth(params.incentives, emp.employeeId, params.monthKey);
      const saleAmtPaise = Math.max(0, Math.round(agg.totalSaleAmtPaise || 0));
      const saleQty = Math.max(0, agg.totalSaleQty || 0);
      return {
        emp,
        saleAmtPaise,
        saleQty,
      };
    });

    // Deterministic sort: Sale Amount DESC -> Sale Qty DESC -> Name ASC -> Employee ID ASC
    scored.sort(
      (a, b) =>
        b.saleAmtPaise - a.saleAmtPaise ||
        b.saleQty - a.saleQty ||
        a.emp.fullName.localeCompare(b.emp.fullName) ||
        a.emp.employeeId.localeCompare(b.emp.employeeId),
    );

    const rankedWithSales = scored.filter((item) => item.saleAmtPaise > 0);
    const top3Raw = rankedWithSales.slice(0, 3);

    const top3: DepartmentLeaderboardEntry[] = top3Raw.map((item, idx) => ({
      rank: (idx + 1) as 1 | 2 | 3,
      employeeName: item.emp.fullName.slice(0, 120),
      branchName: item.emp.branchName.slice(0, 120),
      saleAmtPaise: item.saleAmtPaise,
      photoDataUrl: (item.emp.photoDataUrl || '').slice(0, MAX_EMPLOYEE_PHOTO_DATA_URL_LEN),
    }));

    leaderboards.push({
      leaderboardId: buildDepartmentLeaderboardId(params.monthKey, dept.id),
      monthKey: params.monthKey,
      departmentId: dept.id,
      departmentName: dept.name,
      totalParticipants: deptEmployees.length,
      top3,
      employeeVisible: params.employeeVisible,
      updatedByEmail: params.updatedByEmail.slice(0, 180),
      updatedAt: now,
    });

    const rank1SalePaise = top3Raw[0]?.saleAmtPaise ?? 0;
    const hasFullTop3Podium = top3Raw.length >= 3;
    const rank3SalePaise = hasFullTop3Podium ? top3Raw[2].saleAmtPaise : 0;

    // Assign standard competition rank for positive sales, 0 for zero sales
    let currentRank = 0;
    scored.forEach((item, idx) => {
      if (item.saleAmtPaise > 0) {
        if (idx === 0) {
          currentRank = 1;
        } else if (item.saleAmtPaise === scored[idx - 1].saleAmtPaise) {
          // Tie on exact Sale Amount -> share rank
        } else {
          currentRank = idx + 1;
        }
      }

      const assignedRank = item.saleAmtPaise > 0 ? currentRank : 0;
      const inTop3 = assignedRank >= 1 && assignedRank <= 3;
      const gapToTop3Paise = inTop3
        ? 0
        : !hasFullTop3Podium
          ? item.saleAmtPaise === 0
            ? 100 // Open Top-3 podium spot: ₹1 sale qualifies
            : 0
          : rank3SalePaise >= item.saleAmtPaise
            ? rank3SalePaise - item.saleAmtPaise + 100 // +₹1 to surpass #3
            : 0;
      const gapToRank1Paise =
        assignedRank === 1
          ? 0
          : rank1SalePaise > item.saleAmtPaise
            ? rank1SalePaise - item.saleAmtPaise
            : 0;

      employeeRanks.push({
        rankId: buildEmployeeRankId(params.monthKey, item.emp.employeeId),
        monthKey: params.monthKey,
        employeeId: item.emp.employeeId,
        authUid: item.emp.authUid || '',
        departmentId: dept.id,
        departmentName: dept.name,
        rank: assignedRank,
        totalParticipants: deptEmployees.length,
        saleAmtPaise: item.saleAmtPaise,
        gapToTop3Paise,
        gapToRank1Paise,
        employeeVisible: params.employeeVisible,
        updatedAt: now,
      });
    });
  }

  return {
    monthKey: params.monthKey,
    leaderboards,
    employeeRanks,
  };
}

export interface BulkDepartmentParseRow {
  rowNumber: number;
  employeeId: string;
  employeeName: string;
  branchName: string;
  rawDepartment: string;
  resolvedDepartment: OfficialDepartment | null;
  matchedEmployee: Employee | null;
  status: 'READY' | 'UNCHANGED' | 'UNKNOWN_EMPLOYEE' | 'INVALID_DEPARTMENT';
  message: string;
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

/**
 * Parses a bulk CSV (or tab-separated) Department Mapping sheet into validated preview rows.
 */
export function parseBulkDepartmentRows(
  rawRows: Array<{ rowNumber: number; employeeId: string; department: string }>,
  employees: Employee[],
): BulkDepartmentParseRow[] {
  const empById = new Map<string, Employee>();
  const empByLoginId = new Map<string, Employee>();
  for (const emp of employees) {
    empById.set(emp.employeeId.trim().toUpperCase(), emp);
    empByLoginId.set(emp.loginId.trim().toUpperCase(), emp);
  }

  return rawRows.map((row) => {
    const cleanId = row.employeeId.trim().toUpperCase();
    const matched = empById.get(cleanId) || empByLoginId.get(cleanId) || null;
    const resolved = resolveCanonicalDepartment(row.department);

    if (!matched) {
      return {
        rowNumber: row.rowNumber,
        employeeId: row.employeeId.trim(),
        employeeName: '—',
        branchName: '—',
        rawDepartment: row.department.trim(),
        resolvedDepartment: resolved,
        matchedEmployee: null,
        status: 'UNKNOWN_EMPLOYEE',
        message: `Employee ID "${row.employeeId.trim()}" not found in Employee Master.`,
      };
    }

    if (!resolved) {
      return {
        rowNumber: row.rowNumber,
        employeeId: matched.employeeId,
        employeeName: matched.fullName,
        branchName: matched.branchName,
        rawDepartment: row.department.trim(),
        resolvedDepartment: null,
        matchedEmployee: matched,
        status: 'INVALID_DEPARTMENT',
        message: `Unrecognized department "${row.department.trim()}". Use Saree, Ladies Wear, Kids Wear, Mens Wear, or Non Apparels.`,
      };
    }

    if (matched.departmentId === resolved.id) {
      return {
        rowNumber: row.rowNumber,
        employeeId: matched.employeeId,
        employeeName: matched.fullName,
        branchName: matched.branchName,
        rawDepartment: row.department.trim(),
        resolvedDepartment: resolved,
        matchedEmployee: matched,
        status: 'UNCHANGED',
        message: `Already assigned to ${resolved.name}.`,
      };
    }

    return {
      rowNumber: row.rowNumber,
      employeeId: matched.employeeId,
      employeeName: matched.fullName,
      branchName: matched.branchName,
      rawDepartment: row.department.trim(),
      resolvedDepartment: resolved,
      matchedEmployee: matched,
      status: 'READY',
      message: `Will assign to ${resolved.name}.`,
    };
  });
}

export function parseBulkDepartmentCsvText(
  csvText: string,
  employees: Employee[],
): BulkDepartmentParseRow[] {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const idIdx = headers.findIndex(
    (h) =>
      h.includes('salesmanno') ||
      h.includes('employeeid') ||
      h.includes('empid') ||
      h === 'id' ||
      h.includes('loginid'),
  );
  const deptIdx = headers.findIndex(
    (h) => h.includes('department') || h.includes('dept') || h.includes('section'),
  );

  const safeIdIdx = idIdx >= 0 ? idIdx : 0;
  const safeDeptIdx = deptIdx >= 0 ? deptIdx : headers.length - 1;

  const rawRows: Array<{ rowNumber: number; employeeId: string; department: string }> = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const empId = (cols[safeIdIdx] || '').trim();
    const dept = (cols[safeDeptIdx] || '').trim();
    if (!empId && !dept) continue;
    rawRows.push({ rowNumber: i + 1, employeeId: empId, department: dept });
  }

  return parseBulkDepartmentRows(rawRows, employees);
}

export function buildDepartmentCsvTemplate(employees: Employee[]): string {
  const header = 'Salesman No,Employee Name,Branch Name,Department (Saree Dept. / Ladies Wear Dept. / Kids Wear Dept. / Mens Wear Dept. / Non Apparels Dept.)';
  const sorted = [...employees]
    .filter((e) => e.status === 'ACTIVE')
    .sort((a, b) => a.branchName.localeCompare(b.branchName) || a.fullName.localeCompare(b.fullName));
  const lines = sorted.map((emp) => {
    const esc = (v: string) => `"${(v || '').replace(/"/g, '""')}"`;
    return [
      esc(emp.employeeId),
      esc(emp.fullName),
      esc(emp.branchName),
      esc(emp.departmentName || ''),
    ].join(',');
  });
  return [header, ...lines].join('\n');
}

/**
 * Client-side square center-crop + compression for Employee Photos.
 * Guarantees compact <= 35 KB thumbnail data URL safe for Firestore and fast mobile rendering.
 */
export async function compressEmployeePhotoToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (JPG, PNG, or WebP).');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Image is too large (max 10 MB before compression).');
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the selected image file.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Selected file could not be decoded as an image.'));
    el.src = dataUrl;
  });

  const size = 160;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Image canvas is not available in this browser.');
  }

  const minSide = Math.min(img.width, img.height);
  const sx = Math.floor((img.width - minSide) / 2);
  const sy = Math.floor((img.height - minSide) / 2);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

  let output = canvas.toDataURL('image/webp', 0.78);
  if (!output.startsWith('data:image/webp') || output.length > MAX_EMPLOYEE_PHOTO_DATA_URL_LEN) {
    output = canvas.toDataURL('image/jpeg', 0.78);
  }
  if (output.length > MAX_EMPLOYEE_PHOTO_DATA_URL_LEN) {
    output = canvas.toDataURL('image/jpeg', 0.58);
  }
  if (output.length > MAX_EMPLOYEE_PHOTO_DATA_URL_LEN) {
    throw new Error('Compressed photo is still too large. Please try a simpler portrait photo.');
  }
  return output;
}
