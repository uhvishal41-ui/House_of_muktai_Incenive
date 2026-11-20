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
  BARAMATI_MIDC: 'BARAMATI MIDC',
  'BARAMATI-MIDC': 'BARAMATI MIDC',
  OSMANABAD: 'DHARASHIV',
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

export function parseDmyToIsoStrict(raw: string): string | null {
  const cleaned = raw.trim();
  const isoMatch = cleaned.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (isoMatch) {
    const candidate = `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
    return isValidIsoDate(candidate) ? candidate : null;
  }
  const dmyMatch = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!dmyMatch) return null;
  const day = dmyMatch[1].padStart(2, '0');
  const month = dmyMatch[2].padStart(2, '0');
  const year = dmyMatch[3];
  const candidate = `${year}-${month}-${day}`;
  return isValidIsoDate(candidate) ? candidate : null;
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
  const period = classifyImportPeriod(params.periodStart, params.periodEnd, params.rawBannerDateText);
  const overrides = params.overrides || {};
  const overlapResolutionMode: OverlapResolutionMode = params.overlapResolutionMode || 'BLOCK';
  const overlapReconcileReason = (params.overlapReconcileReason || '').trim();

  const employeesById: Record<string, Employee> = {};
  for (const emp of params.employees) {
    employeesById[sanitizeId(emp.employeeId)] = emp;
  }

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
  const branchTransfers: BranchTransferCandidate[] = [];
  const existingEmployeeIdsInFile = new Set<string>();
  const smplCandidateIds = new Set<string>();
  const seenKeys = new Set<string>();

  const effectiveImportType: ImportType = period.importType || 'DAILY';
  const effectiveStart = period.periodStart || '';
  const effectiveEnd = period.periodEnd || '';
  // For DAILY, businessDate is the exact day. For MONTHLY / CUSTOM_PERIOD, businessDate carries periodEnd only for storage sort compatibility.
  const effectiveBusinessDate =
    effectiveImportType === 'DAILY' ? effectiveStart : effectiveEnd;

  const validatedRows: ValidatedImportRow[] = params.rows.map((row) => {
    const rawEmpId = params.mapping.employeeId ? row.raw[params.mapping.employeeId] : null;
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

    const employeeId =
      rawEmpId !== null && rawEmpId !== undefined ? sanitizeId(String(rawEmpId)) : '';
    const excelEmployeeName = rawEmpName ? String(rawEmpName).trim() : '';
    const branchCodeRaw = rawBranch ? String(rawBranch).trim() : '';
    const isSmplCandidate = isSmplCandidateName(excelEmployeeName);

    if (isSmplCandidate && employeeId) {
      smplCandidateIds.add(employeeId);
    }

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

    // Strict matching strictly by permanent Salesman No (employeeId) — NEVER by name
    const employee = employeeId ? employeesById[employeeId] : undefined;
    const isNewCandidate = Boolean(employeeId && !employee);

    if (employee) {
      existingEmployeeIdsInFile.add(employee.employeeId);
    } else if (employeeId && !newCandidateMap.has(employeeId)) {
      newCandidateMap.set(employeeId, {
        salesmanNo: employeeId,
        salesPersonName: excelEmployeeName || `Salesman ${employeeId}`,
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
    if (!period.valid) {
      hardErrors.push(period.errorMessage || 'Invalid or missing Excel banner date range');
    }
    if (!employeeId) {
      hardErrors.push('Missing Salesman No / Employee ID');
    }
    if (employeeId && !employee) {
      hardErrors.push(
        `Salesman No "${employeeId}" (${excelEmployeeName || 'Unknown'}) is a new candidate — register in Employee Master (with explicit Super Admin Active/Inactive status) before publishing`,
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
      period.valid && employeeId
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
      period.valid && employeeId && hardErrors.length === 0
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
      errorMessage = `Branch transfer warning: Employee Master has ${employee.branchName}, Excel has ${matchedBranch.branchName}. Super Admin must explicitly approve transfer before publishing.`;
    } else if (seenKeys.has(recordKey)) {
      validationStatus = 'DUPLICATE_IN_FILE';
      defaultResolution = 'SKIP';
      errorMessage = `Duplicate record for Salesman No ${employeeId} (${effectiveImportType} ${effectiveStart} to ${effectiveEnd}) inside uploaded file`;
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
