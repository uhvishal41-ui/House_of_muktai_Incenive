import type {
  Branch,
  Employee,
  ExcelColumnMapping,
  ImportType,
  IncentiveVersion,
  MonthlySummary,
  MonthlySummarySourceType,
  OverlapResolutionMode,
  ParsedExcelRow,
  PublishedIncentive,
  RowResolution,
  RowValidationStatus,
  UserRole,
} from '../types/incentive.ts';
import {
  formatINRFromPaise,
  parseAmountToPaise,
  parseOptionalAmountToPaise,
  parseOptionalQty,
  sanitizeId,
} from './format.ts';

export interface PeriodClassification {
  valid: boolean;
  importType: ImportType | null;
  periodStart: string | null;
  periodEnd: string | null;
  businessDate: string | null;
  errorCode: 'MISSING_BANNER_DATE' | 'INVALID_DATE_RANGE' | null;
  errorMessage: string | null;
}

export interface NewEmployeeCandidate {
  salesmanNo: string;
  salesPersonName: string;
  erpBranchName: string;
  isSmplCandidate: boolean;
}

export interface BranchTransferCandidate {
  employeeId: string;
  employeeName: string;
  masterBranchId: string;
  masterBranchName: string;
  excelBranchId: string;
  excelBranchName: string;
  rowNumber: number;
}

export interface PendingSaleIdLinkCandidate {
  employeeId: string;
  masterFullName: string;
  excelEmployeeName: string;
  branchId: string;
  branchName: string;
  excelBranchName: string;
  proposedSaleId: string;
  matchBasis:
    | 'EXACT_EMP_ID'
    | 'EXACT_NAME_AND_BRANCH'
    | 'UNIQUE_NAME_TOKENS_AND_BRANCH'
    | 'UNIQUE_EXACT_NAME';
  rowCount: number;
  sampleRowNumber: number;
}

export interface PeriodOverlapDetail {
  conflictingRecordId: string;
  conflictingImportType: ImportType;
  conflictingPeriodStart: string;
  conflictingPeriodEnd: string;
  conflictingTotalPaise: number;
}

export interface ValidatedImportRow {
  rowNumber: number;
  importType: ImportType;
  periodStart: string;
  periodEnd: string;
  businessDate: string;
  recordKey: string;
  employeeId: string;
  employeeName: string;
  excelEmployeeName: string;
  matchedSaleId?: string;
  matchedViaSaleIdLink?: boolean;
  branchId: string;
  branchName: string;
  branchCodeRaw: string;
  masterBranchId?: string;
  masterBranchName?: string;
  isSmplCandidate: boolean;
  isNewCandidate: boolean;
  component1Paise: number;
  component2Paise: number;
  component3Paise: number;
  totalPaise: number;
  saleAmt1Paise: number;
  saleQty1: number;
  saleAmt2Paise: number;
  saleQty2: number;
  saleAmt3Paise: number;
  saleQty3: number;
  totalSaleAmtPaise: number;
  totalSaleQty: number;
  validationStatus: RowValidationStatus;
  resolution: RowResolution;
  correctionReason: string;
  errorMessage: string;
  existingTotalPaise?: number;
  existingVersion?: number;
  overlapConflicts: PeriodOverlapDetail[];
  conflictingRecordIds: string[];
}

export interface ImportPreviewMetrics {
  detectedImportType: ImportType | null;
  reportStartDate: string | null;
  reportEndDate: string | null;
  totalExcelRows: number;
  validEmployeeRows: number;
  newEmployeeCandidates: number;
  pendingSaleIdLinksCount: number;
  existingEmployees: number;
  smplCandidates: number;
  blankRowsSkipped: number;
  summaryRowsSkipped: number;
  invalidRows: number;
  duplicateRecords: number;
  duplicateInFileRecords: number;
  existingPublishedRecords: number;
  branchTransferWarnings: number;
  periodOverlapWarnings: number;
  supersededConflictRows: number;
  correctionRows: number;
  publishableRows: number;
  totalIncentivePaise: number;
  totalSaleAmtPaise: number;
  totalSaleQty: number;
}

export interface ImportValidationResult {
  period: PeriodClassification;
  overlapResolutionMode: OverlapResolutionMode;
  rows: ValidatedImportRow[];
  metrics: ImportPreviewMetrics;
  missingBranches: string[];
  newEmployeeCandidates: NewEmployeeCandidate[];
  pendingSaleIdLinks: PendingSaleIdLinkCandidate[];
  branchTransfers: BranchTransferCandidate[];
  hasUnresolvedOverlaps: boolean;
  missingCorrectionReason: boolean;
  missingReconcileReason: boolean;
  canStage: boolean;
  blockingReasons: string[];
}

export function normalizeBranchKey(val: string): string {
  return val.trim().replace(/\s+/g, ' ').toUpperCase();
}

const BRANCH_CANONICAL_ALIASES: Record<string, string> = {
  'BARAMATI MOTIBAG': 'BARAMATI MOTIBAGH',
  BARAMATI_MOTIBAG: 'BARAMATI MOTIBAGH',
  'BARAMATI-MOTIBAG': 'BARAMATI MOTIBAGH',
  BARAMATI_MOTIBAGH: 'BARAMATI MOTIBAGH',
  'BARAMATI-MOTIBAGH': 'BARAMATI MOTIBAGH',
  'MOTI 1': 'BARAMATI MOTIBAGH',
  MOTI1: 'BARAMATI MOTIBAGH',
  MOTIBAG: 'BARAMATI MOTIBAGH',
  MOTIBAGH: 'BARAMATI MOTIBAGH',
  BARAMATI_MIDC: 'BARAMATI MIDC',
  'BARAMATI-MIDC': 'BARAMATI MIDC',
  MIDC: 'BARAMATI MIDC',
  SMPL: 'BARAMATI MIDC',
  BHOS: 'BHOSARI',
  OSMANABAD: 'DHARASHIV',
  DHSV: 'DHARASHIV',
  INDPR: 'INDAPUR',
  LOND: 'LONAND',
  PNDR: 'PANDHARPUR',
  PRND: 'PARANDA',
  RASH: 'RASHIN',
  SGND: 'SHRIGONDA',
};

export function resolveCanonicalBranchName(raw: string): string {
  const normalized = normalizeBranchKey(raw);
  if (!normalized) return '';
  return BRANCH_CANONICAL_ALIASES[normalized] || normalized;
}

export function isSmplCandidateName(name: string): boolean {
  return /\bsmpl\b/i.test(name);
}

export function getLastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidIsoDate(iso: string | null | undefined): iso is string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [yStr, mStr, dStr] = iso.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return false;
  if (!Number.isInteger(m) || m < 1 || m > 12) return false;
  const maxDay = getLastDayOfMonth(y, m);
  return Number.isInteger(d) && d >= 1 && d <= maxDay;
}

const MONTH_NAME_MAP: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

export function parseDmyToIsoStrict(raw: string): string | null {
  const cleaned = raw.trim();
  const isoMatch = cleaned.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (isoMatch) {
    const candidate = `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
    return isValidIsoDate(candidate) ? candidate : null;
  }
  const dmyMatch = cleaned.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    const candidate = `${year}-${month}-${day}`;
    return isValidIsoDate(candidate) ? candidate : null;
  }
  const namedMatch = cleaned.match(/^(\d{1,2})[\s/-]+([a-zA-Z]{3,9})[\s,/-]+(\d{4})$/);
  if (namedMatch) {
    const mm = MONTH_NAME_MAP[namedMatch[2].toLowerCase()];
    if (!mm) return null;
    const candidate = `${namedMatch[3]}-${mm}-${namedMatch[1].padStart(2, '0')}`;
    return isValidIsoDate(candidate) ? candidate : null;
  }
  return null;
}

/**
 * Parses an Excel Date cell value (YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, DD-MMM-YYYY,
 * or numeric Excel serial date) strictly into an ISO YYYY-MM-DD date string.
 */
export function parseExcelDateCellToIso(
  raw: string | number | Date | null | undefined,
): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const d = String(raw.getUTCDate()).padStart(2, '0');
    const iso = `${y}-${m}-${d}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Excel serial date range (roughly 2000-01-01 to 2100-12-31 -> 36526..73415)
    if (raw >= 36526 && raw <= 73415) {
      const utcMs = Date.UTC(1899, 11, 30) + Math.floor(raw) * 86400000;
      const dt = new Date(utcMs);
      const iso = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
      return isValidIsoDate(iso) ? iso : null;
    }
    return null;
  }
  const str = String(raw).trim();
  if (!str) return null;
  // Handle ISO timestamps like "2026-10-15T00:00:00.000Z"
  const isoPrefix = str.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (isoPrefix) {
    return isValidIsoDate(isoPrefix[1]) ? isoPrefix[1] : null;
  }
  // Numeric string representing Excel serial date
  if (/^\d{5}(\.\d+)?$/.test(str)) {
    return parseExcelDateCellToIso(Number(str));
  }
  return parseDmyToIsoStrict(str);
}

export function classifyImportPeriod(
  fromIso: string | null | undefined,
  toIso: string | null | undefined,
  rawBannerDateText?: string,
): PeriodClassification {
  const hasRawText = Boolean(rawBannerDateText && rawBannerDateText.trim().length > 0);

  if (!fromIso && !toIso) {
    return {
      valid: false,
      importType: null,
      periodStart: null,
      periodEnd: null,
      businessDate: null,
      errorCode: hasRawText ? 'INVALID_DATE_RANGE' : 'MISSING_BANNER_DATE',
      errorMessage: hasRawText
        ? `Invalid report date range in Excel banner ("${rawBannerDateText}"). Expected valid DD-MM-YYYY To DD-MM-YYYY dates.`
        : 'Missing report date range in Excel banner (Row 1). Expected e.g. "As On :-01-10-2026 To 31-10-2026".',
    };
  }

  if (!isValidIsoDate(fromIso) || !isValidIsoDate(toIso)) {
    return {
      valid: false,
      importType: null,
      periodStart: isValidIsoDate(fromIso) ? fromIso : null,
      periodEnd: isValidIsoDate(toIso) ? toIso : null,
      businessDate: null,
      errorCode: 'INVALID_DATE_RANGE',
      errorMessage: `Invalid calendar date in Excel banner (${fromIso || 'missing'} to ${toIso || 'missing'}).`,
    };
  }

  if (fromIso > toIso) {
    return {
      valid: false,
      importType: null,
      periodStart: fromIso,
      periodEnd: toIso,
      businessDate: null,
      errorCode: 'INVALID_DATE_RANGE',
      errorMessage: `Invalid report date range: Start date (${fromIso}) is after end date (${toIso}).`,
    };
  }

  if (fromIso === toIso) {
    return {
      valid: true,
      importType: 'DAILY',
      periodStart: fromIso,
      periodEnd: toIso,
      businessDate: fromIso,
      errorCode: null,
      errorMessage: null,
    };
  }

  const [sy, sm, sd] = fromIso.split('-').map(Number);
  const [ey, em, ed] = toIso.split('-').map(Number);
  const lastDay = getLastDayOfMonth(ey, em);

  if (sy === ey && sm === em && sd === 1 && ed === lastDay) {
    return {
      valid: true,
      importType: 'MONTHLY',
      periodStart: fromIso,
      periodEnd: toIso,
      businessDate: null,
      errorCode: null,
      errorMessage: null,
    };
  }

  return {
    valid: true,
    importType: 'CUSTOM_PERIOD',
    periodStart: fromIso,
    periodEnd: toIso,
    businessDate: null,
    errorCode: null,
    errorMessage: null,
  };
}

export function getIncentiveRecordKey(
  importType: ImportType,
  periodStart: string,
  periodEnd: string,
  employeeId: string,
): string {
  const cleanEmp = sanitizeId(employeeId);
  if (importType === 'DAILY') {
    return `${periodStart}_${cleanEmp}`;
  }
  return `${importType}_${periodStart}_${periodEnd}_${cleanEmp}`;
}

export function getDeterministicVersionId(recordId: string, batchId: string): string {
  const safeRecord = recordId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeBatch = batchId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safeRecord}_B_${safeBatch}`.slice(0, 128);
}

export function getDeterministicNotificationId(batchId: string, employeeId: string): string {
  const safeBatch = batchId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeEmp = sanitizeId(employeeId);
  return `NTF_${safeBatch}_${safeEmp}`.slice(0, 128);
}

export function normalizeRecordPeriod(record: PublishedIncentive): {
  importType: ImportType;
  periodStart: string;
  periodEnd: string;
} {
  const importType: ImportType = record.importType || 'DAILY';
  const periodStart = record.periodStart || record.businessDate;
  const periodEnd = record.periodEnd || record.businessDate;
  return { importType, periodStart, periodEnd };
}

export function datesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA <= endB && startB <= endA;
}

/**
 * Checks whether a published record's [periodStart, periodEnd] overlaps the given YYYY-MM month.
 * Ensures cross-month CUSTOM_PERIOD statements appear accurately in every month they span.
 */
export function doesRecordOverlapMonth(record: PublishedIncentive, monthKey: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return record.monthKey === monthKey;
  const [yStr, mStr] = monthKey.split('-');
  const lastDay = String(getLastDayOfMonth(Number(yStr), Number(mStr))).padStart(2, '0');
  const monthStart = `${monthKey}-01`;
  const monthEnd = `${monthKey}-${lastDay}`;
  const norm = normalizeRecordPeriod(record);
  return datesOverlap(norm.periodStart, norm.periodEnd, monthStart, monthEnd);
}

export function getOverlappingMonthKeys(record: PublishedIncentive): string[] {
  const norm = normalizeRecordPeriod(record);
  const startMonth = norm.periodStart.slice(0, 7);
  const endMonth = norm.periodEnd.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth) || startMonth > endMonth) {
    return [record.monthKey];
  }
  const result: string[] = [];
  let [y, m] = startMonth.split('-').map(Number);
  const [ey, em] = endMonth.split('-').map(Number);
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard < 24) {
    result.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    guard += 1;
  }
  return result.length > 0 ? result : [record.monthKey];
}

export function formatImportTypeLabel(importType: ImportType | null | undefined): string {
  if (importType === 'MONTHLY') return 'Monthly Incentive';
  if (importType === 'CUSTOM_PERIOD') return 'Custom Period Incentive';
  return 'Daily Incentive';
}

export function detectPeriodOverlapsForEmployee(params: {
  employeeId: string;
  incomingImportType: ImportType;
  incomingStart: string;
  incomingEnd: string;
  incomingRecordKey: string;
  publishedIncentives: PublishedIncentive[];
}): PeriodOverlapDetail[] {
  const cleanEmp = sanitizeId(params.employeeId);
  const conflicts: PeriodOverlapDetail[] = [];

  for (const pub of params.publishedIncentives) {
    // Soft-superseded historical records do not conflict with new imports
    if (pub.status !== 'PUBLISHED') continue;
    if (sanitizeId(pub.employeeId) !== cleanEmp) continue;
    const norm = normalizeRecordPeriod(pub);
    const existingKey =
      pub.recordId ||
      getIncentiveRecordKey(norm.importType, norm.periodStart, norm.periodEnd, cleanEmp);

    // Exact same key is handled as EXISTS_PUBLISHED duplicate / versioned correction, not overlap
    if (
      existingKey === params.incomingRecordKey ||
      (norm.importType === params.incomingImportType &&
        norm.periodStart === params.incomingStart &&
        norm.periodEnd === params.incomingEnd)
    ) {
      continue;
    }

    if (datesOverlap(params.incomingStart, params.incomingEnd, norm.periodStart, norm.periodEnd)) {
      conflicts.push({
        conflictingRecordId: existingKey,
        conflictingImportType: norm.importType,
        conflictingPeriodStart: norm.periodStart,
        conflictingPeriodEnd: norm.periodEnd,
        conflictingTotalPaise: pub.totalPaise,
      });
    }
  }

  return conflicts;
}

export function validateImportBatch(params: {
  periodStart: string | null;
  periodEnd: string | null;
  rawBannerDateText?: string;
  rawTotalRows: number;
  skippedBlankRows: number;
  skippedSummaryRows: number;
  rows: ParsedExcelRow[];
  mapping: ExcelColumnMapping;
  branches: Branch[];
  employees: Employee[];
  publishedIncentives: PublishedIncentive[];
  overlapResolutionMode?: OverlapResolutionMode;
  overlapReconcileReason?: string;
  overrides?: Record<number, { resolution: RowResolution; correctionReason: string }>;
}): ImportValidationResult {
  const hasDateColumn = Boolean(params.mapping.businessDate && params.mapping.businessDate.trim());
  const parsedRowDates = hasDateColumn
    ? params.rows.map((r) => parseExcelDateCellToIso(r.raw[params.mapping.businessDate]))
    : [];
  const validRowDatesSorted = hasDateColumn
    ? parsedRowDates.filter((d): d is string => Boolean(d)).sort((a, b) => a.localeCompare(b))
    : [];

  const period: PeriodClassification = hasDateColumn
    ? validRowDatesSorted.length > 0
      ? {
          valid: true,
          importType: 'DAILY',
          periodStart: validRowDatesSorted[0],
          periodEnd: validRowDatesSorted[validRowDatesSorted.length - 1],
          businessDate: validRowDatesSorted[validRowDatesSorted.length - 1],
          errorCode: null,
          errorMessage: null,
        }
      : {
          valid: false,
          importType: null,
          periodStart: null,
          periodEnd: null,
          businessDate: null,
          errorCode: 'MISSING_BANNER_DATE',
          errorMessage: `No valid dates found in the "${params.mapping.businessDate}" column. Enter valid YYYY-MM-DD or DD-MM-YYYY dates in each row.`,
        }
    : classifyImportPeriod(params.periodStart, params.periodEnd, params.rawBannerDateText);

  const overrides = params.overrides || {};
  const overlapResolutionMode: OverlapResolutionMode = params.overlapResolutionMode || 'BLOCK';
  const overlapReconcileReason = (params.overlapReconcileReason || '').trim();

  const employeesById: Record<string, Employee> = {};
  const employeesBySaleId: Record<string, Employee> = {};
  const unlinkedByNameAndBranch = new Map<string, Employee[]>();
  const unlinkedByTokensAndBranch = new Map<string, Employee[]>();
  const unlinkedByName = new Map<string, Employee[]>();

  const normalizeNameForMatch = (raw: string): string =>
    String(raw || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const buildTokenSignature = (normName: string): string => {
    const tokens = normName.split(' ').filter((t) => t.length > 0);
    if (tokens.length < 2) return '';
    return [...tokens].sort().join('|');
  };

  const pushMapItem = (map: Map<string, Employee[]>, key: string, emp: Employee) => {
    if (!key) return;
    const arr = map.get(key);
    if (arr) arr.push(emp);
    else map.set(key, [emp]);
  };

  for (const emp of params.employees) {
    employeesById[sanitizeId(emp.employeeId).toUpperCase()] = emp;
    if (emp.saleId && emp.saleId.trim()) {
      employeesBySaleId[sanitizeId(emp.saleId).toUpperCase()] = emp;
    } else {
      // Master employees who do NOT yet have a Sale ID are eligible for verified name-based Sale ID linking
      const normName = normalizeNameForMatch(emp.fullName);
      if (normName) {
        pushMapItem(unlinkedByName, normName, emp);
        if (emp.branchId) {
          pushMapItem(unlinkedByNameAndBranch, `${normName}__${emp.branchId}`, emp);
          const tokenSig = buildTokenSignature(normName);
          if (tokenSig) {
            pushMapItem(unlinkedByTokensAndBranch, `${tokenSig}__${emp.branchId}`, emp);
          }
        }
      }
    }
  }
  const preferSaleIdLookup = /sell[\s_-]*(id|code|no)|sale[\s_-]*(id|code|no)|salesman/i.test(
    params.mapping.employeeId || '',
  );

  // Also detect any unmapped ID columns in the sheet so if the user has both Employee ID and Sales ID columns and fills either one, it resolves seamlessly
  const sampleRowKeys = params.rows[0] ? Object.keys(params.rows[0].raw) : [];
  const autoEmpIdCol =
    params.mapping.employeeId ||
    sampleRowKeys.find((k) => /emp(loyee)?[\s_-]*(id|code|no)|staff[\s_-]*(id|code|no)|login[\s_-]*id/i.test(k)) ||
    '';
  const autoSaleIdCol =
    params.mapping.saleId ||
    sampleRowKeys.find(
      (k) =>
        k !== autoEmpIdCol &&
        /sell[\s_-]*(id|code|no)|sale[\s_-]*(id|code|no)|salesman[\s_-]*(no|id|code)?|sales[\s_-]*(id|code|no)/i.test(
          k,
        ),
    ) ||
    '';

  const branchesByKey: Record<string, Branch> = {};
  for (const b of params.branches) {
    branchesByKey[normalizeBranchKey(b.branchCode)] = b;
    branchesByKey[normalizeBranchKey(b.branchId)] = b;
    branchesByKey[normalizeBranchKey(b.branchName)] = b;
    branchesByKey[sanitizeId(b.branchName)] = b;
    const canonicalName = resolveCanonicalBranchName(b.branchName);
    if (canonicalName) {
      branchesByKey[canonicalName] = b;
      branchesByKey[sanitizeId(canonicalName)] = b;
    }
  }

  const publishedByKey: Record<string, PublishedIncentive> = {};
  for (const p of params.publishedIncentives) {
    if (p.status !== 'PUBLISHED') continue;
    const norm = normalizeRecordPeriod(p);
    const key =
      p.recordId || getIncentiveRecordKey(norm.importType, norm.periodStart, norm.periodEnd, p.employeeId);
    publishedByKey[key] = p;
  }

  const missingBranchSet = new Set<string>();
  const newCandidateMap = new Map<string, NewEmployeeCandidate>();
  const pendingSaleIdLinkMap = new Map<string, PendingSaleIdLinkCandidate>();
  const claimedSaleIdToEmpId = new Map<string, string>();
  const claimedEmpIdToSaleId = new Map<string, string>();
  const branchTransfers: BranchTransferCandidate[] = [];
  const existingEmployeeIdsInFile = new Set<string>();
  const smplCandidateIds = new Set<string>();
  const seenKeys = new Set<string>();

  const fallbackImportType: ImportType = period.importType || 'DAILY';
  const fallbackStart = period.periodStart || '';
  const fallbackEnd = period.periodEnd || '';
  const fallbackBusinessDate = fallbackImportType === 'DAILY' ? fallbackStart : fallbackEnd;

  const VALID_SALE_ID_RE = /^[A-Z0-9_-]{1,40}$/;

  const validatedRows: ValidatedImportRow[] = params.rows.map((row, rowIdx) => {
    const rawEmpId = autoEmpIdCol ? row.raw[autoEmpIdCol] : null;
    const rawSaleId = autoSaleIdCol ? row.raw[autoSaleIdCol] : null;
    const rawEmpName = params.mapping.employeeName ? row.raw[params.mapping.employeeName] : null;
    const rawBranch = params.mapping.branchCode ? row.raw[params.mapping.branchCode] : null;
    const rawC1 = params.mapping.component1 ? row.raw[params.mapping.component1] : null;
    const rawC2 = params.mapping.component2 ? row.raw[params.mapping.component2] : null;
    const rawC3 = params.mapping.component3 ? row.raw[params.mapping.component3] : null;
    const rawSaleAmt1 = params.mapping.saleAmt1 ? row.raw[params.mapping.saleAmt1] : null;
    const rawSaleQty1 = params.mapping.saleQty1 ? row.raw[params.mapping.saleQty1] : null;
    const rawSaleAmt2 = params.mapping.saleAmt2 ? row.raw[params.mapping.saleAmt2] : null;
    const rawSaleQty2 = params.mapping.saleQty2 ? row.raw[params.mapping.saleQty2] : null;
    const rawSaleAmt3 = params.mapping.saleAmt3 ? row.raw[params.mapping.saleAmt3] : null;
    const rawSaleQty3 = params.mapping.saleQty3 ? row.raw[params.mapping.saleQty3] : null;

    const rowDateIso = hasDateColumn ? parsedRowDates[rowIdx] : null;
    const effectiveImportType: ImportType = hasDateColumn ? 'DAILY' : fallbackImportType;
    const effectiveStart = hasDateColumn ? rowDateIso || '' : fallbackStart;
    const effectiveEnd = hasDateColumn ? rowDateIso || '' : fallbackEnd;
    const effectiveBusinessDate = hasDateColumn ? rowDateIso || '' : fallbackBusinessDate;
    const rowPeriodValid = hasDateColumn ? Boolean(rowDateIso) : period.valid;

    const empIdToken =
      rawEmpId !== null && rawEmpId !== undefined ? sanitizeId(String(rawEmpId)) : '';
    const saleIdToken =
      rawSaleId !== null && rawSaleId !== undefined ? sanitizeId(String(rawSaleId)) : '';
    const empIdUpper = empIdToken.toUpperCase();
    const saleIdUpper = saleIdToken.toUpperCase();
    const rawIdToken = empIdToken || saleIdToken;
    const excelEmployeeName = rawEmpName ? String(rawEmpName).trim() : '';
    const branchCodeRaw = rawBranch ? String(rawBranch).trim() : '';
    const isSmplCandidate = isSmplCandidateName(excelEmployeeName);

    const bKey = resolveCanonicalBranchName(branchCodeRaw);
    const rawKey = normalizeBranchKey(branchCodeRaw);
    const matchedBranch = bKey
      ? branchesByKey[bKey] ||
        branchesByKey[sanitizeId(bKey)] ||
        branchesByKey[rawKey] ||
        branchesByKey[sanitizeId(branchCodeRaw)]
      : undefined;

    if (bKey && !matchedBranch) {
      missingBranchSet.add(bKey);
    }

    // 1. Direct Dual-ID matching: checks Employee ID column AND Sales ID column (either or both can be filled)
    let employee: Employee | undefined;
    let matchedSaleId: string | undefined;
    let matchedViaSaleIdLink = false;

    if (empIdUpper) {
      if (preferSaleIdLookup) {
        if (employeesBySaleId[empIdUpper]) {
          employee = employeesBySaleId[empIdUpper];
          matchedSaleId = empIdUpper;
        } else if (employeesById[empIdUpper]) {
          employee = employeesById[empIdUpper];
        }
      } else {
        if (employeesById[empIdUpper]) {
          employee = employeesById[empIdUpper];
        } else if (employeesBySaleId[empIdUpper]) {
          employee = employeesBySaleId[empIdUpper];
          matchedSaleId = empIdUpper;
        }
      }
    }
    if (!employee && saleIdUpper) {
      if (employeesBySaleId[saleIdUpper]) {
        employee = employeesBySaleId[saleIdUpper];
        matchedSaleId = saleIdUpper;
      } else if (employeesById[saleIdUpper]) {
        employee = employeesById[saleIdUpper];
      }
    }

    // 1b. If matched directly by EMP ID, and Excel ALSO has a Sales ID while Master has no Sale ID yet, propose verified Sale ID link
    if (
      employee &&
      saleIdUpper &&
      (!employee.saleId || !employee.saleId.trim()) &&
      VALID_SALE_ID_RE.test(saleIdUpper) &&
      !employeesBySaleId[saleIdUpper]
    ) {
      const existingSaleOwner = claimedSaleIdToEmpId.get(saleIdUpper);
      const existingEmpSale = claimedEmpIdToSaleId.get(employee.employeeId.toUpperCase());
      if (
        (!existingSaleOwner || existingSaleOwner === employee.employeeId.toUpperCase()) &&
        (!existingEmpSale || existingEmpSale === saleIdUpper)
      ) {
        claimedSaleIdToEmpId.set(saleIdUpper, employee.employeeId.toUpperCase());
        claimedEmpIdToSaleId.set(employee.employeeId.toUpperCase(), saleIdUpper);
        matchedSaleId = saleIdUpper;
        matchedViaSaleIdLink = true;
        const linkKey = employee.employeeId.toUpperCase();
        const prevLink = pendingSaleIdLinkMap.get(linkKey);
        if (prevLink) {
          prevLink.rowCount += 1;
        } else {
          pendingSaleIdLinkMap.set(linkKey, {
            employeeId: employee.employeeId,
            masterFullName: employee.fullName,
            excelEmployeeName: excelEmployeeName || employee.fullName,
            branchId: employee.branchId,
            branchName: employee.branchName,
            excelBranchName: matchedBranch?.branchName || bKey || employee.branchName,
            proposedSaleId: saleIdUpper,
            matchBasis: 'EXACT_EMP_ID',
            rowCount: 1,
            sampleRowNumber: row.rowNumber,
          });
        }
      }
    }

    // 2. Smart Name-Verified Auto-Link:
    // If Excel only has Sales ID (Employee ID blank or unmapped) and Master has this employee by EMP ID WITHOUT a Sale ID yet,
    // match strictly uniquely by Name (+ Branch) with zero ambiguity/collision and propose linking Sale ID to Master!
    const candidateSaleId = saleIdUpper || empIdUpper;
    if (
      !employee &&
      candidateSaleId &&
      VALID_SALE_ID_RE.test(candidateSaleId) &&
      !employeesBySaleId[candidateSaleId]
    ) {
      const alreadyClaimedEmpId = claimedSaleIdToEmpId.get(candidateSaleId);
      if (alreadyClaimedEmpId && employeesById[alreadyClaimedEmpId]) {
        employee = employeesById[alreadyClaimedEmpId];
        matchedSaleId = candidateSaleId;
        matchedViaSaleIdLink = true;
        const prevLink = pendingSaleIdLinkMap.get(alreadyClaimedEmpId);
        if (prevLink) prevLink.rowCount += 1;
      } else if (excelEmployeeName) {
        const normName = normalizeNameForMatch(excelEmployeeName);
        if (normName) {
          let resolvedCandidate: Employee | undefined;
          let matchBasis: PendingSaleIdLinkCandidate['matchBasis'] | undefined;

          if (matchedBranch) {
            const byNameBranch = unlinkedByNameAndBranch.get(`${normName}__${matchedBranch.branchId}`);
            if (byNameBranch && byNameBranch.length === 1) {
              resolvedCandidate = byNameBranch[0];
              matchBasis = 'EXACT_NAME_AND_BRANCH';
            } else {
              const tokenSig = buildTokenSignature(normName);
              const byTokensBranch = tokenSig
                ? unlinkedByTokensAndBranch.get(`${tokenSig}__${matchedBranch.branchId}`)
                : undefined;
              if (byTokensBranch && byTokensBranch.length === 1) {
                resolvedCandidate = byTokensBranch[0];
                matchBasis = 'UNIQUE_NAME_TOKENS_AND_BRANCH';
              }
            }
          }

          if (!resolvedCandidate) {
            const byExactName = unlinkedByName.get(normName);
            if (byExactName && byExactName.length === 1) {
              resolvedCandidate = byExactName[0];
              matchBasis = 'UNIQUE_EXACT_NAME';
            }
          }

          if (resolvedCandidate && matchBasis) {
            const empKey = resolvedCandidate.employeeId.toUpperCase();
            const existingEmpSale = claimedEmpIdToSaleId.get(empKey);
            // Zero-collision guard: never link two different Sale IDs to the same Master employee
            if (!existingEmpSale || existingEmpSale === candidateSaleId) {
              employee = resolvedCandidate;
              matchedSaleId = candidateSaleId;
              matchedViaSaleIdLink = true;
              claimedSaleIdToEmpId.set(candidateSaleId, empKey);
              claimedEmpIdToSaleId.set(empKey, candidateSaleId);
              const prevLink = pendingSaleIdLinkMap.get(empKey);
              if (prevLink) {
                prevLink.rowCount += 1;
              } else {
                pendingSaleIdLinkMap.set(empKey, {
                  employeeId: resolvedCandidate.employeeId,
                  masterFullName: resolvedCandidate.fullName,
                  excelEmployeeName,
                  branchId: resolvedCandidate.branchId,
                  branchName: resolvedCandidate.branchName,
                  excelBranchName: matchedBranch?.branchName || bKey || resolvedCandidate.branchName,
                  proposedSaleId: candidateSaleId,
                  matchBasis,
                  rowCount: 1,
                  sampleRowNumber: row.rowNumber,
                });
              }
            }
          }
        }
      }
    }

    const employeeId = employee ? employee.employeeId : rawIdToken;

    if (isSmplCandidate && employeeId) {
      smplCandidateIds.add(employeeId);
    }

    const isNewCandidate = Boolean(rawIdToken && !employee);

    if (employee) {
      existingEmployeeIdsInFile.add(employee.employeeId);
    } else if (rawIdToken && !newCandidateMap.has(rawIdToken)) {
      newCandidateMap.set(rawIdToken, {
        salesmanNo: rawIdToken,
        salesPersonName: excelEmployeeName || `Employee ${rawIdToken}`,
        erpBranchName: bKey,
        isSmplCandidate,
      });
    }

    const c1 = parseAmountToPaise(rawC1);
    const c2 = parseAmountToPaise(rawC2);
    const c3 = parseAmountToPaise(rawC3);
    const sa1 = params.mapping.saleAmt1 ? parseOptionalAmountToPaise(rawSaleAmt1) : 0;
    const sq1 = params.mapping.saleQty1 ? parseOptionalQty(rawSaleQty1) : 0;
    const sa2 = params.mapping.saleAmt2 ? parseOptionalAmountToPaise(rawSaleAmt2) : 0;
    const sq2 = params.mapping.saleQty2 ? parseOptionalQty(rawSaleQty2) : 0;
    const sa3 = params.mapping.saleAmt3 ? parseOptionalAmountToPaise(rawSaleAmt3) : 0;
    const sq3 = params.mapping.saleQty3 ? parseOptionalQty(rawSaleQty3) : 0;

    const hardErrors: string[] = [];
    if (hasDateColumn) {
      if (!rowDateIso) {
        const rawDateDisplay = String(row.raw[params.mapping.businessDate] ?? '').trim();
        hardErrors.push(
          rawDateDisplay
            ? `Invalid Date "${rawDateDisplay}" in "${params.mapping.businessDate}" column (use YYYY-MM-DD or DD-MM-YYYY)`
            : `Missing Date in "${params.mapping.businessDate}" column`,
        );
      }
    } else if (!period.valid) {
      hardErrors.push(period.errorMessage || 'Invalid or missing Excel date');
    }
    if (!employeeId) {
      hardErrors.push('Missing Employee ID / Sales ID');
    }
    if (employeeId && !employee) {
      hardErrors.push(
        `Employee ID / Sales ID "${employeeId}" (${excelEmployeeName || 'Unknown'}) is a new candidate — register in Employee Master (with explicit Super Admin Active/Inactive status) before publishing`,
      );
    } else if (employee && employee.status !== 'ACTIVE') {
      hardErrors.push(
        `Employee "${employeeId}" (${employee.fullName}) is INACTIVE (controlled by Super Admin) and excluded from active publishing`,
      );
    }

    if (params.mapping.branchCode) {
      if (!branchCodeRaw) {
        hardErrors.push('Missing Branch (NAME)');
      } else if (!matchedBranch) {
        hardErrors.push(`Branch "${branchCodeRaw}" not found in Branch Master`);
      }
    }

    if (c1 === null) hardErrors.push(`Invalid ${params.mapping.component1 || 'Component 1'}`);
    if (c2 === null) hardErrors.push(`Invalid ${params.mapping.component2 || 'Component 2'}`);
    if (c3 === null) hardErrors.push(`Invalid ${params.mapping.component3 || 'Component 3'}`);
    if (sa1 === null) hardErrors.push(`Invalid ${params.mapping.saleAmt1 || 'Sale Amt (Sec 1)'}`);
    if (sq1 === null) hardErrors.push(`Invalid ${params.mapping.saleQty1 || 'Sale Qty (Sec 1)'}`);
    if (sa2 === null) hardErrors.push(`Invalid ${params.mapping.saleAmt2 || 'Sale Amt (Sec 2)'}`);
    if (sq2 === null) hardErrors.push(`Invalid ${params.mapping.saleQty2 || 'Sale Qty (Sec 2)'}`);
    if (sa3 === null) hardErrors.push(`Invalid ${params.mapping.saleAmt3 || 'Sale Amt (Sec 3)'}`);
    if (sq3 === null) hardErrors.push(`Invalid ${params.mapping.saleQty3 || 'Sale Qty (Sec 3)'}`);

    const safeC1 = c1 ?? 0;
    const safeC2 = c2 ?? 0;
    const safeC3 = c3 ?? 0;
    const totalPaise = safeC1 + safeC2 + safeC3;
    const safeSa1 = sa1 ?? 0;
    const safeSq1 = sq1 ?? 0;
    const safeSa2 = sa2 ?? 0;
    const safeSq2 = sq2 ?? 0;
    const safeSa3 = sa3 ?? 0;
    const safeSq3 = sq3 ?? 0;
    const totalSaleAmtPaise = safeSa1 + safeSa2 + safeSa3;
    const totalSaleQty = Math.round((safeSq1 + safeSq2 + safeSq3) * 100) / 100;

    const recordKey =
      rowPeriodValid && employeeId
        ? getIncentiveRecordKey(effectiveImportType, effectiveStart, effectiveEnd, employeeId)
        : '';

    const hasBranchTransfer = Boolean(
      employee && matchedBranch && employee.branchId !== matchedBranch.branchId,
    );

    if (hasBranchTransfer && employee && matchedBranch) {
      branchTransfers.push({
        employeeId: employee.employeeId,
        employeeName: employee.fullName,
        masterBranchId: employee.branchId,
        masterBranchName: employee.branchName,
        excelBranchId: matchedBranch.branchId,
        excelBranchName: matchedBranch.branchName,
        rowNumber: row.rowNumber,
      });
    }

    const overlapConflicts =
      rowPeriodValid && employeeId && hardErrors.length === 0
        ? detectPeriodOverlapsForEmployee({
            employeeId,
            incomingImportType: effectiveImportType,
            incomingStart: effectiveStart,
            incomingEnd: effectiveEnd,
            incomingRecordKey: recordKey,
            publishedIncentives: params.publishedIncentives,
          })
        : [];

    let validationStatus: RowValidationStatus = 'VALID';
    let defaultResolution: RowResolution = 'PUBLISH_NEW';
    let errorMessage = '';
    let existingTotalPaise: number | undefined;
    let existingVersion: number | undefined;

    if (hardErrors.length > 0) {
      validationStatus = 'ERROR';
      defaultResolution = 'SKIP';
      errorMessage = hardErrors.join('; ');
    } else if (hasBranchTransfer && employee && matchedBranch) {
      validationStatus = 'BRANCH_TRANSFER';
      defaultResolution = 'SKIP';
      errorMessage = `Branch transfer detected: Master has ${employee.branchName}, template has ${matchedBranch.branchName}. Approve transfer to move employee & carry forward previous branch incentives into ${matchedBranch.branchName}.`;
    } else if (seenKeys.has(recordKey)) {
      validationStatus = 'DUPLICATE_IN_FILE';
      defaultResolution = 'SKIP';
      errorMessage = `Duplicate record for Employee ID ${employeeId} (${effectiveImportType} ${effectiveStart}${effectiveStart === effectiveEnd ? '' : ` to ${effectiveEnd}`}) inside uploaded file`;
    } else if (overlapConflicts.length > 0) {
      seenKeys.add(recordKey);
      validationStatus = 'PERIOD_OVERLAP';
      defaultResolution = 'SKIP';
      const first = overlapConflicts[0];
      errorMessage = `Period overlap conflict: overlaps published ${first.conflictingImportType} record (${first.conflictingPeriodStart} to ${first.conflictingPeriodEnd}, ${formatINRFromPaise(first.conflictingTotalPaise)}). Resolve conflict to prevent double counting.`;
    } else if (publishedByKey[recordKey]) {
      seenKeys.add(recordKey);
      validationStatus = 'EXISTS_PUBLISHED';
      defaultResolution = 'SKIP';
      existingTotalPaise = publishedByKey[recordKey].totalPaise;
      existingVersion = publishedByKey[recordKey].version;
      errorMessage = `Already published (${effectiveImportType} v${existingVersion}, ${formatINRFromPaise(existingTotalPaise)}). Mark as Correction with mandatory reason to create a new version.`;
    } else {
      seenKeys.add(recordKey);
    }

    const override = overrides[row.rowNumber];
    let resolution: RowResolution = defaultResolution;
    let correctionReason = override?.correctionReason || '';

    if (validationStatus === 'EXISTS_PUBLISHED' && override) {
      resolution = override.resolution;
    } else if (validationStatus === 'PERIOD_OVERLAP') {
      if (overlapResolutionMode === 'RECONCILE_SUPERSEDE') {
        resolution = override?.resolution === 'SKIP' ? 'SKIP' : 'SUPERSEDE_CONFLICTS';
        correctionReason = (override?.correctionReason || overlapReconcileReason).trim();
      } else {
        // BLOCK and SKIP_OVERLAP both default conflicting rows to SKIP
        resolution = 'SKIP';
      }
    }

    return {
      rowNumber: row.rowNumber,
      importType: effectiveImportType,
      periodStart: effectiveStart,
      periodEnd: effectiveEnd,
      businessDate: effectiveBusinessDate,
      recordKey,
      employeeId,
      employeeName: employee?.fullName || excelEmployeeName || '—',
      excelEmployeeName,
      ...(matchedSaleId ? { matchedSaleId } : {}),
      ...(matchedViaSaleIdLink ? { matchedViaSaleIdLink: true } : {}),
      branchId: employee?.branchId || matchedBranch?.branchId || '',
      branchName: employee?.branchName || matchedBranch?.branchName || branchCodeRaw || '—',
      branchCodeRaw,
      masterBranchId: employee?.branchId,
      masterBranchName: employee?.branchName,
      isSmplCandidate,
      isNewCandidate,
      component1Paise: safeC1,
      component2Paise: safeC2,
      component3Paise: safeC3,
      totalPaise,
      saleAmt1Paise: safeSa1,
      saleQty1: safeSq1,
      saleAmt2Paise: safeSa2,
      saleQty2: safeSq2,
      saleAmt3Paise: safeSa3,
      saleQty3: safeSq3,
      totalSaleAmtPaise,
      totalSaleQty,
      validationStatus,
      resolution,
      correctionReason,
      errorMessage,
      existingTotalPaise,
      existingVersion,
      overlapConflicts,
      conflictingRecordIds: overlapConflicts.map((c) => c.conflictingRecordId),
    };
  });

  const validEmployeeRows = validatedRows.filter((r) => r.validationStatus === 'VALID').length;
  const invalidRows = validatedRows.filter((r) => r.validationStatus === 'ERROR').length;
  const duplicateInFileRecords = validatedRows.filter(
    (r) => r.validationStatus === 'DUPLICATE_IN_FILE',
  ).length;
  const existingPublishedRecords = validatedRows.filter(
    (r) => r.validationStatus === 'EXISTS_PUBLISHED',
  ).length;
  const duplicateRecords = duplicateInFileRecords + existingPublishedRecords;
  const branchTransferWarnings = validatedRows.filter(
    (r) => r.validationStatus === 'BRANCH_TRANSFER',
  ).length;
  const periodOverlapWarnings = validatedRows.filter(
    (r) => r.validationStatus === 'PERIOD_OVERLAP',
  ).length;
  const supersededConflictRows = validatedRows.filter(
    (r) => r.resolution === 'SUPERSEDE_CONFLICTS',
  ).length;
  const correctionRows = validatedRows.filter((r) => r.resolution === 'CORRECTION').length;
  const publishableRows = validatedRows.filter(
    (r) =>
      r.resolution === 'PUBLISH_NEW' ||
      r.resolution === 'CORRECTION' ||
      r.resolution === 'SUPERSEDE_CONFLICTS',
  ).length;
  const actionablePreviewRows = validatedRows.filter(
    (r) =>
      r.resolution === 'PUBLISH_NEW' ||
      r.resolution === 'CORRECTION' ||
      r.resolution === 'SUPERSEDE_CONFLICTS',
  );
  const totalIncentivePaise = actionablePreviewRows.reduce((sum, r) => sum + r.totalPaise, 0);
  const totalSaleAmtPaise = actionablePreviewRows.reduce((sum, r) => sum + r.totalSaleAmtPaise, 0);
  const totalSaleQty =
    Math.round(actionablePreviewRows.reduce((sum, r) => sum + r.totalSaleQty, 0) * 100) / 100;

  const missingCorrectionReason = validatedRows.some(
    (r) => r.resolution === 'CORRECTION' && r.correctionReason.trim().length < 4,
  );
  const missingReconcileReason = validatedRows.some(
    (r) => r.resolution === 'SUPERSEDE_CONFLICTS' && r.correctionReason.trim().length < 4,
  );
  const hasUnresolvedOverlaps = periodOverlapWarnings > 0 && overlapResolutionMode === 'BLOCK';

  const blockingReasons: string[] = [];
  if (!period.valid) {
    blockingReasons.push(period.errorMessage || 'Invalid or missing report banner dates.');
  }
  if (hasUnresolvedOverlaps) {
    blockingReasons.push(
      `${periodOverlapWarnings} row(s) have period overlap conflicts with existing published records. Choose Option A (Skip Overlapping Rows) or Option B (Reconcile & Supersede Prior Records) to proceed safely without double counting.`,
    );
  }
  if (missingCorrectionReason) {
    blockingReasons.push('Every row marked as Correction requires a mandatory reason (min 4 characters).');
  }
  if (missingReconcileReason) {
    blockingReasons.push(
      'Reconcile & Supersede mode requires a mandatory audit reason (min 4 characters).',
    );
  }
  if (publishableRows === 0) {
    blockingReasons.push('No publishable new, correction, or reconciled rows are ready to stage.');
  }

  return {
    period,
    overlapResolutionMode,
    rows: validatedRows,
    metrics: {
      detectedImportType: period.importType,
      reportStartDate: period.periodStart,
      reportEndDate: period.periodEnd,
      totalExcelRows: params.rawTotalRows,
      validEmployeeRows,
      newEmployeeCandidates: newCandidateMap.size,
      pendingSaleIdLinksCount: pendingSaleIdLinkMap.size,
      existingEmployees: existingEmployeeIdsInFile.size,
      smplCandidates: smplCandidateIds.size,
      blankRowsSkipped: params.skippedBlankRows,
      summaryRowsSkipped: params.skippedSummaryRows,
      invalidRows,
      duplicateRecords,
      duplicateInFileRecords,
      existingPublishedRecords,
      branchTransferWarnings,
      periodOverlapWarnings,
      supersededConflictRows,
      correctionRows,
      publishableRows,
      totalIncentivePaise,
      totalSaleAmtPaise,
      totalSaleQty,
    },
    missingBranches: Array.from(missingBranchSet),
    newEmployeeCandidates: Array.from(newCandidateMap.values()),
    pendingSaleIdLinks: Array.from(pendingSaleIdLinkMap.values()),
    branchTransfers,
    hasUnresolvedOverlaps,
    missingCorrectionReason,
    missingReconcileReason,
    canStage: blockingReasons.length === 0,
    blockingReasons,
  };
}

// --- DOUBLE-COUNTING-SAFE REPORTING AGGREGATION ---

export interface AggregatedEmployeeMonth {
  employeeId: string;
  monthKey: string;
  sourceType: MonthlySummarySourceType;
  component1TotalPaise: number;
  component2TotalPaise: number;
  component3TotalPaise: number;
  grandTotalPaise: number;
  saleAmt1TotalPaise: number;
  saleQty1Total: number;
  saleAmt2TotalPaise: number;
  saleQty2Total: number;
  saleAmt3TotalPaise: number;
  saleQty3Total: number;
  totalSaleAmtPaise: number;
  totalSaleQty: number;
  publishedDaysCount: number;
  dailyRecordsUsed: number;
  monthlyRecordUsed: boolean;
  customPeriodRecordsExcludedFromMonthSum: number;
  overlapAnomalyDetected: boolean;
}

export function partitionEmployeeRecords(records: PublishedIncentive[]): {
  dailyRecords: PublishedIncentive[];
  monthlyRecords: PublishedIncentive[];
  customPeriodRecords: PublishedIncentive[];
} {
  const dailyRecords: PublishedIncentive[] = [];
  const monthlyRecords: PublishedIncentive[] = [];
  const customPeriodRecords: PublishedIncentive[] = [];

  for (const r of records) {
    if (r.status !== 'PUBLISHED') continue;
    const norm = normalizeRecordPeriod(r);
    if (norm.importType === 'MONTHLY') {
      monthlyRecords.push(r);
    } else if (norm.importType === 'CUSTOM_PERIOD') {
      customPeriodRecords.push(r);
    } else {
      dailyRecords.push(r);
    }
  }

  dailyRecords.sort((a, b) =>
    normalizeRecordPeriod(b).periodStart.localeCompare(normalizeRecordPeriod(a).periodStart),
  );
  monthlyRecords.sort((a, b) =>
    normalizeRecordPeriod(b).periodStart.localeCompare(normalizeRecordPeriod(a).periodStart),
  );
  customPeriodRecords.sort((a, b) =>
    normalizeRecordPeriod(b).periodStart.localeCompare(normalizeRecordPeriod(a).periodStart),
  );

  return { dailyRecords, monthlyRecords, customPeriodRecords };
}

/**
 * Computes a single employee's monthly total WITHOUT double counting:
 * - Uses published DAILY records OR a published MONTHLY record — NEVER both together.
 * - Keeps CUSTOM_PERIOD records logically separate and never adds them into monthly totals blindly.
 * - Never splits monthly totals into artificial daily records.
 */
export function aggregateEmployeeMonth(
  records: PublishedIncentive[],
  employeeId: string,
  monthKey: string,
): AggregatedEmployeeMonth {
  const cleanEmp = sanitizeId(employeeId);
  const matching = records.filter(
    (r) =>
      sanitizeId(r.employeeId) === cleanEmp &&
      r.status === 'PUBLISHED' &&
      (r.monthKey === monthKey || normalizeRecordPeriod(r).periodStart.slice(0, 7) === monthKey),
  );

  const dailyRecs = matching.filter((r) => normalizeRecordPeriod(r).importType === 'DAILY');
  const monthlyRecs = matching.filter((r) => normalizeRecordPeriod(r).importType === 'MONTHLY');
  const customRecs = matching.filter((r) => normalizeRecordPeriod(r).importType === 'CUSTOM_PERIOD');

  const overlapAnomalyDetected = dailyRecs.length > 0 && monthlyRecs.length > 0;

  // If a published MONTHLY record exists for this employee + month, use it as the authoritative monthly total (NEVER add daily rows on top).
  if (monthlyRecs.length > 0) {
    const latestMonthly = [...monthlyRecs].sort((a, b) =>
      b.publishedAt.localeCompare(a.publishedAt),
    )[0];
    const sa1 = latestMonthly.saleAmt1Paise || 0;
    const sq1 = latestMonthly.saleQty1 || 0;
    const sa2 = latestMonthly.saleAmt2Paise || 0;
    const sq2 = latestMonthly.saleQty2 || 0;
    const sa3 = latestMonthly.saleAmt3Paise || 0;
    const sq3 = latestMonthly.saleQty3 || 0;
    return {
      employeeId: cleanEmp,
      monthKey,
      sourceType: 'MONTHLY_RECORD',
      component1TotalPaise: latestMonthly.component1Paise,
      component2TotalPaise: latestMonthly.component2Paise,
      component3TotalPaise: latestMonthly.component3Paise,
      grandTotalPaise:
        latestMonthly.component1Paise +
        latestMonthly.component2Paise +
        latestMonthly.component3Paise,
      saleAmt1TotalPaise: sa1,
      saleQty1Total: sq1,
      saleAmt2TotalPaise: sa2,
      saleQty2Total: sq2,
      saleAmt3TotalPaise: sa3,
      saleQty3Total: sq3,
      totalSaleAmtPaise: latestMonthly.totalSaleAmtPaise ?? sa1 + sa2 + sa3,
      totalSaleQty:
        latestMonthly.totalSaleQty ?? Math.round((sq1 + sq2 + sq3) * 100) / 100,
      publishedDaysCount: 0,
      dailyRecordsUsed: 0,
      monthlyRecordUsed: true,
      customPeriodRecordsExcludedFromMonthSum: customRecs.length,
      overlapAnomalyDetected,
    };
  }

  if (dailyRecs.length > 0) {
    const c1 = dailyRecs.reduce((sum, r) => sum + r.component1Paise, 0);
    const c2 = dailyRecs.reduce((sum, r) => sum + r.component2Paise, 0);
    const c3 = dailyRecs.reduce((sum, r) => sum + r.component3Paise, 0);
    const sa1 = dailyRecs.reduce((sum, r) => sum + (r.saleAmt1Paise || 0), 0);
    const sq1 = Math.round(dailyRecs.reduce((sum, r) => sum + (r.saleQty1 || 0), 0) * 100) / 100;
    const sa2 = dailyRecs.reduce((sum, r) => sum + (r.saleAmt2Paise || 0), 0);
    const sq2 = Math.round(dailyRecs.reduce((sum, r) => sum + (r.saleQty2 || 0), 0) * 100) / 100;
    const sa3 = dailyRecs.reduce((sum, r) => sum + (r.saleAmt3Paise || 0), 0);
    const sq3 = Math.round(dailyRecs.reduce((sum, r) => sum + (r.saleQty3 || 0), 0) * 100) / 100;
    const totalSaleAmtPaise = dailyRecs.reduce(
      (sum, r) =>
        sum +
        (r.totalSaleAmtPaise ??
          (r.saleAmt1Paise || 0) + (r.saleAmt2Paise || 0) + (r.saleAmt3Paise || 0)),
      0,
    );
    const totalSaleQty =
      Math.round(
        dailyRecs.reduce(
          (sum, r) =>
            sum + (r.totalSaleQty ?? (r.saleQty1 || 0) + (r.saleQty2 || 0) + (r.saleQty3 || 0)),
          0,
        ) * 100,
      ) / 100;
    return {
      employeeId: cleanEmp,
      monthKey,
      sourceType: 'DAILY_AGGREGATE',
      component1TotalPaise: c1,
      component2TotalPaise: c2,
      component3TotalPaise: c3,
      grandTotalPaise: c1 + c2 + c3,
      saleAmt1TotalPaise: sa1,
      saleQty1Total: sq1,
      saleAmt2TotalPaise: sa2,
      saleQty2Total: sq2,
      saleAmt3TotalPaise: sa3,
      saleQty3Total: sq3,
      totalSaleAmtPaise,
      totalSaleQty,
      publishedDaysCount: dailyRecs.length,
      dailyRecordsUsed: dailyRecs.length,
      monthlyRecordUsed: false,
      customPeriodRecordsExcludedFromMonthSum: customRecs.length,
      overlapAnomalyDetected: false,
    };
  }

  return {
    employeeId: cleanEmp,
    monthKey,
    sourceType: 'NO_DATA',
    component1TotalPaise: 0,
    component2TotalPaise: 0,
    component3TotalPaise: 0,
    grandTotalPaise: 0,
    saleAmt1TotalPaise: 0,
    saleQty1Total: 0,
    saleAmt2TotalPaise: 0,
    saleQty2Total: 0,
    saleAmt3TotalPaise: 0,
    saleQty3Total: 0,
    totalSaleAmtPaise: 0,
    totalSaleQty: 0,
    publishedDaysCount: 0,
    dailyRecordsUsed: 0,
    monthlyRecordUsed: false,
    customPeriodRecordsExcludedFromMonthSum: customRecs.length,
    overlapAnomalyDetected: false,
  };
}

export function buildMonthlySummaryDocument(params: {
  records: PublishedIncentive[];
  employee: Employee;
  monthKey: string;
  now: string;
}): MonthlySummary {
  const agg = aggregateEmployeeMonth(params.records, params.employee.employeeId, params.monthKey);
  return {
    summaryId: `${params.employee.employeeId}_${params.monthKey}`,
    employeeId: params.employee.employeeId,
    authUid: params.employee.authUid || '',
    employeeName: params.employee.fullName,
    branchId: params.employee.branchId,
    branchName: params.employee.branchName,
    monthKey: params.monthKey,
    sourceType: agg.sourceType,
    component1TotalPaise: agg.component1TotalPaise,
    component2TotalPaise: agg.component2TotalPaise,
    component3TotalPaise: agg.component3TotalPaise,
    grandTotalPaise: agg.grandTotalPaise,
    saleAmt1TotalPaise: agg.saleAmt1TotalPaise,
    saleQty1Total: agg.saleQty1Total,
    saleAmt2TotalPaise: agg.saleAmt2TotalPaise,
    saleQty2Total: agg.saleQty2Total,
    saleAmt3TotalPaise: agg.saleAmt3TotalPaise,
    saleQty3Total: agg.saleQty3Total,
    totalSaleAmtPaise: agg.totalSaleAmtPaise,
    totalSaleQty: agg.totalSaleQty,
    publishedDaysCount: agg.publishedDaysCount,
    updatedAt: params.now,
  };
}

// --- PUBLISHED RECORD CORRECTION VERSIONING ---

export function applyPublishedCorrection(params: {
  existingRecord: PublishedIncentive;
  newComponent1Paise: number;
  newComponent2Paise: number;
  newComponent3Paise: number;
  newSaleAmt1Paise?: number;
  newSaleQty1?: number;
  newSaleAmt2Paise?: number;
  newSaleQty2?: number;
  newSaleAmt3Paise?: number;
  newSaleQty3?: number;
  newTotalSaleAmtPaise?: number;
  newTotalSaleQty?: number;
  correctionReason: string;
  batchId: string;
  actorEmail: string;
  now: string;
  employeeName?: string;
  branchId?: string;
  branchName?: string;
  authUid?: string;
}): { updatedRecord: PublishedIncentive; versionSnapshot: IncentiveVersion } {
  const reason = params.correctionReason.trim();
  if (reason.length < 4) {
    throw new Error('A mandatory correction reason (at least 4 characters) is required to revise a published incentive.');
  }

  const norm = normalizeRecordPeriod(params.existingRecord);
  const nextVersion = params.existingRecord.version + 1;
  const newTotalPaise =
    params.newComponent1Paise + params.newComponent2Paise + params.newComponent3Paise;
  // Deterministic version ID guarantees retry idempotency (zero duplicate snapshots)
  const versionId = getDeterministicVersionId(params.existingRecord.recordId, params.batchId);

  const versionSnapshot: IncentiveVersion = {
    versionId,
    recordId: params.existingRecord.recordId,
    importType: norm.importType,
    periodStart: norm.periodStart,
    periodEnd: norm.periodEnd,
    businessDate: params.existingRecord.businessDate,
    employeeId: params.existingRecord.employeeId,
    branchId: params.branchId || params.existingRecord.branchId,
    previousVersion: params.existingRecord.version,
    newVersion: nextVersion,
    previousComponent1Paise: params.existingRecord.component1Paise,
    previousComponent2Paise: params.existingRecord.component2Paise,
    previousComponent3Paise: params.existingRecord.component3Paise,
    previousTotalPaise: params.existingRecord.totalPaise,
    newComponent1Paise: params.newComponent1Paise,
    newComponent2Paise: params.newComponent2Paise,
    newComponent3Paise: params.newComponent3Paise,
    newTotalPaise,
    correctionReason: reason.slice(0, 300),
    batchId: params.batchId,
    correctedByEmail: params.actorEmail.slice(0, 180),
    archivedAt: params.now,
  };

  const saleAmt1Paise = params.newSaleAmt1Paise ?? params.existingRecord.saleAmt1Paise ?? 0;
  const saleQty1 = params.newSaleQty1 ?? params.existingRecord.saleQty1 ?? 0;
  const saleAmt2Paise = params.newSaleAmt2Paise ?? params.existingRecord.saleAmt2Paise ?? 0;
  const saleQty2 = params.newSaleQty2 ?? params.existingRecord.saleQty2 ?? 0;
  const saleAmt3Paise = params.newSaleAmt3Paise ?? params.existingRecord.saleAmt3Paise ?? 0;
  const saleQty3 = params.newSaleQty3 ?? params.existingRecord.saleQty3 ?? 0;
  const totalSaleAmtPaise =
    params.newTotalSaleAmtPaise ?? saleAmt1Paise + saleAmt2Paise + saleAmt3Paise;
  const totalSaleQty =
    params.newTotalSaleQty ?? Math.round((saleQty1 + saleQty2 + saleQty3) * 100) / 100;

  const updatedRecord: PublishedIncentive = {
    ...params.existingRecord,
    importType: norm.importType,
    periodStart: norm.periodStart,
    periodEnd: norm.periodEnd,
    authUid: params.authUid ?? params.existingRecord.authUid,
    employeeName: params.employeeName || params.existingRecord.employeeName,
    branchId: params.branchId || params.existingRecord.branchId,
    branchName: params.branchName || params.existingRecord.branchName,
    component1Paise: params.newComponent1Paise,
    component2Paise: params.newComponent2Paise,
    component3Paise: params.newComponent3Paise,
    totalPaise: newTotalPaise,
    saleAmt1Paise,
    saleQty1,
    saleAmt2Paise,
    saleQty2,
    saleAmt3Paise,
    saleQty3,
    totalSaleAmtPaise,
    totalSaleQty,
    status: 'PUBLISHED',
    version: nextVersion,
    batchId: params.batchId,
    correctionReason: reason.slice(0, 240),
    publishedAt: params.now,
    publishedByEmail: params.actorEmail.slice(0, 180),
  };

  return { updatedRecord, versionSnapshot };
}

// --- STRICT SUPER ADMIN EMPLOYEE STATUS AUTHORIZATION & LOGIN GATE ---

export interface StatusChangeAuthResult {
  allowed: boolean;
  statusCode: 200 | 403;
  auditAction?: 'EMPLOYEE_ACTIVATED' | 'EMPLOYEE_DEACTIVATED' | 'EMPLOYEE_REACTIVATED';
  error?: string;
}

export function authorizeEmployeeStatusChange(params: {
  actorRole: UserRole | 'BRANCH_MANAGER' | 'SYSTEM_IMPORT' | string;
  currentStatus?: 'ACTIVE' | 'INACTIVE';
  targetStatus: 'ACTIVE' | 'INACTIVE';
}): StatusChangeAuthResult {
  if (params.actorRole !== 'SUPER_ADMIN') {
    return {
      allowed: false,
      statusCode: 403,
      error:
        'Forbidden: Only Super Admin is authorized to activate, deactivate, or reactivate employee accounts.',
    };
  }

  let auditAction: 'EMPLOYEE_ACTIVATED' | 'EMPLOYEE_DEACTIVATED' | 'EMPLOYEE_REACTIVATED' =
    'EMPLOYEE_ACTIVATED';
  if (params.targetStatus === 'INACTIVE') {
    auditAction = 'EMPLOYEE_DEACTIVATED';
  } else if (params.currentStatus === 'INACTIVE' && params.targetStatus === 'ACTIVE') {
    auditAction = 'EMPLOYEE_REACTIVATED';
  }

  return {
    allowed: true,
    statusCode: 200,
    auditAction,
  };
}

export interface EmployeeLoginGateResult {
  allowed: boolean;
  code: 'OK' | 'PROFILE_NOT_FOUND' | 'ACCOUNT_DEACTIVATED';
  message: string;
}

export function canEmployeeLogin(employee: Employee | null | undefined): EmployeeLoginGateResult {
  if (!employee) {
    return {
      allowed: false,
      code: 'PROFILE_NOT_FOUND',
      message:
        'Your signed-in account is not linked to an employee profile. Contact your Super Admin.',
    };
  }
  if (employee.status !== 'ACTIVE') {
    return {
      allowed: false,
      code: 'ACCOUNT_DEACTIVATED',
      message:
        'Your employee account is currently INACTIVE. Portal access has been disabled by Super Admin. Your historical incentive records remain safely preserved.',
    };
  }
  return {
    allowed: true,
    code: 'OK',
    message: 'Access granted.',
  };
}

// --- BRANCH TRANSFER INCENTIVE CONSOLIDATION (PREVIOUS BRANCH -> CURRENT BRANCH) ---

export interface BranchTransferConsolidationPlan {
  employeeId: string;
  previousBranchId: string;
  previousBranchName: string;
  newBranchId: string;
  newBranchName: string;
  affectedMonthKeys: string[];
  recordsToMigrate: PublishedIncentive[];
  migratedIncentivePaise: number;
  migratedSaleAmtPaise: number;
  migratedSaleQty: number;
  updatedMonthlySummaries: MonthlySummary[];
}

/**
 * Pure planner for consolidating a transferred employee's previous-branch incentives into
 * their NEW current branch without any double counting.
 *
 * When `targetMonthKeys` is provided (e.g. from the uploaded template's Date column),
 * all active PUBLISHED incentives in those month(s) currently attributed to another branch
 * are re-attributed to the employee's new current branch and monthly summaries are rebuilt
 * under the new branch so current branch totals seamlessly include previous branch incentives.
 */
export function planBranchTransferConsolidation(params: {
  employee: Employee;
  newBranchId: string;
  newBranchName: string;
  publishedIncentives: PublishedIncentive[];
  targetMonthKeys?: string[];
  now?: string;
}): BranchTransferConsolidationPlan {
  const cleanEmp = sanitizeId(params.employee.employeeId);
  const now = params.now || new Date().toISOString();
  const normalizedTargetMonths = Array.from(
    new Set(
      (params.targetMonthKeys || [])
        .map((m) => m.trim())
        .filter((m) => /^\d{4}-\d{2}$/.test(m)),
    ),
  );
  const targetMonthSet = normalizedTargetMonths.length > 0 ? new Set(normalizedTargetMonths) : null;

  const employeePublished = params.publishedIncentives.filter(
    (r) => r.status === 'PUBLISHED' && sanitizeId(r.employeeId) === cleanEmp,
  );

  // If no explicit target months were passed, default to the employee's latest published month
  let effectiveMonthSet = targetMonthSet;
  if (!effectiveMonthSet && employeePublished.length > 0) {
    const latestMonth = employeePublished
      .map((r) => r.monthKey)
      .filter((m) => /^\d{4}-\d{2}$/.test(m))
      .sort((a, b) => b.localeCompare(a))[0];
    if (latestMonth) {
      effectiveMonthSet = new Set([latestMonth]);
    }
  }

  const recordsToMigrate: PublishedIncentive[] = [];
  const affectedMonthSet = new Set<string>(normalizedTargetMonths);

  for (const rec of employeePublished) {
    if (effectiveMonthSet && !effectiveMonthSet.has(rec.monthKey)) continue;
    if (rec.branchId !== params.newBranchId || rec.branchName !== params.newBranchName) {
      recordsToMigrate.push({
        ...rec,
        branchId: params.newBranchId,
        branchName: params.newBranchName,
      });
      affectedMonthSet.add(rec.monthKey);
    }
  }

  const migratedIds = new Set(recordsToMigrate.map((r) => r.recordId));
  const postMigrationRecords = params.publishedIncentives.map((r) =>
    migratedIds.has(r.recordId)
      ? { ...r, branchId: params.newBranchId, branchName: params.newBranchName }
      : r,
  );

  const migratedEmployee: Employee = {
    ...params.employee,
    branchId: params.newBranchId,
    branchName: params.newBranchName,
    updatedAt: now,
  };

  const affectedMonthKeys = Array.from(affectedMonthSet).sort((a, b) => b.localeCompare(a));
  const updatedMonthlySummaries: MonthlySummary[] = [];
  for (const mk of affectedMonthKeys) {
    const summary = buildMonthlySummaryDocument({
      records: postMigrationRecords,
      employee: migratedEmployee,
      monthKey: mk,
      now,
    });
    if (summary.sourceType !== 'NO_DATA') {
      updatedMonthlySummaries.push(summary);
    }
  }

  const migratedIncentivePaise = recordsToMigrate.reduce((acc, r) => acc + r.totalPaise, 0);
  const migratedSaleAmtPaise = recordsToMigrate.reduce(
    (acc, r) => acc + (r.totalSaleAmtPaise || 0),
    0,
  );
  const migratedSaleQty =
    Math.round(recordsToMigrate.reduce((acc, r) => acc + (r.totalSaleQty || 0), 0) * 100) / 100;

  return {
    employeeId: params.employee.employeeId,
    previousBranchId: params.employee.branchId,
    previousBranchName: params.employee.branchName,
    newBranchId: params.newBranchId,
    newBranchName: params.newBranchName,
    affectedMonthKeys,
    recordsToMigrate,
    migratedIncentivePaise,
    migratedSaleAmtPaise,
    migratedSaleQty,
    updatedMonthlySummaries,
  };
}
