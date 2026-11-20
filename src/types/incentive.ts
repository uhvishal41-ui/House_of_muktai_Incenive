// Phase 2 strictly supports SUPER_ADMIN and EMPLOYEE roles (BRANCH_MANAGER disabled)
export type UserRole = 'SUPER_ADMIN' | 'EMPLOYEE';

export type ImportType = 'DAILY' | 'MONTHLY' | 'CUSTOM_PERIOD';

export type OverlapResolutionMode = 'BLOCK' | 'SKIP_OVERLAP' | 'RECONCILE_SUPERSEDE';

export interface ActiveAuthUidRecord {
  authUid: string;
  employeeId: string;
  active: true;
  updatedAt: string;
}

export interface Branch {
  branchId: string;
  branchCode: string;
  branchName: string;
  city: string;
  managerName?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Employee {
  employeeId: string;
  loginId: string;
  authEmail: string;
  linkedGoogleEmail?: string;
  authUid?: string;
  fullName: string;
  branchId: string;
  branchName: string;
  designation: string;
  phone?: string;
  address?: string;
  emergencyContact?: string;
  role: 'EMPLOYEE';
  status: 'ACTIVE' | 'INACTIVE';
  mustChangePassword: boolean;
  credentialsProvisioned: boolean;
  createdAt: string;
  updatedAt: string;
}

export type BatchStatus =
  | 'UPLOADED'
  | 'VALIDATED'
  | 'APPROVED'
  | 'PROCESSING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'REJECTED';

export interface ComponentLabels {
  component1: string;
  component2: string;
  component3: string;
}

export interface ImportBatch {
  batchId: string;
  fileName: string;
  fileSha256: string;
  importType: ImportType;
  periodStart: string;
  periodEnd: string;
  businessDate: string;
  status: BatchStatus;
  overlapResolutionMode?: OverlapResolutionMode;
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  correctionRows: number;
  overlapRows?: number;
  supersededRows?: number;
  branchTransferRows?: number;
  skippedBlankRows?: number;
  skippedSummaryRows?: number;
  totalIncentivePaise: number;
  totalSaleAmtPaise?: number;
  totalSaleQty?: number;
  componentLabels?: ComponentLabels;
  uploadedByUid: string;
  uploadedByEmail: string;
  approvedByEmail?: string;
  publishedByEmail?: string;
  publishLockId?: string;
  publishStartedAt?: string;
  publishAttemptCount?: number;
  lastPublishError?: string;
  rejectionReason?: string;
  correctionNote?: string;
  createdAt: string;
  updatedAt: string;
}

export type RowValidationStatus =
  | 'VALID'
  | 'ERROR'
  | 'DUPLICATE_IN_FILE'
  | 'EXISTS_PUBLISHED'
  | 'PERIOD_OVERLAP'
  | 'BRANCH_TRANSFER';

export type RowResolution = 'PUBLISH_NEW' | 'SKIP' | 'CORRECTION' | 'SUPERSEDE_CONFLICTS';

export interface ImportBatchRow {
  rowId: string;
  batchId: string;
  rowNumber: number;
  importType: ImportType;
  periodStart: string;
  periodEnd: string;
  businessDate: string;
  employeeId: string;
  employeeName?: string;
  branchId?: string;
  branchName?: string;
  component1Paise: number;
  component2Paise: number;
  component3Paise: number;
  totalPaise: number;
  saleAmt1Paise?: number;
  saleQty1?: number;
  saleAmt2Paise?: number;
  saleQty2?: number;
  saleAmt3Paise?: number;
  saleQty3?: number;
  totalSaleAmtPaise?: number;
  totalSaleQty?: number;
  validationStatus: RowValidationStatus;
  resolution: RowResolution;
  conflictingRecordIds?: string[];
  correctionReason?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface PublishedIncentive {
  recordId: string;
  importType?: ImportType;
  periodStart?: string;
  periodEnd?: string;
  businessDate: string;
  monthKey: string;
  employeeId: string;
  authUid: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  component1Label: string;
  component2Label: string;
  component3Label: string;
  component1Paise: number;
  component2Paise: number;
  component3Paise: number;
  totalPaise: number;
  saleAmt1Paise?: number;
  saleQty1?: number;
  saleAmt2Paise?: number;
  saleQty2?: number;
  saleAmt3Paise?: number;
  saleQty3?: number;
  totalSaleAmtPaise?: number;
  totalSaleQty?: number;
  status: 'PUBLISHED' | 'SUPERSEDED';
  version: number;
  batchId: string;
  correctionReason?: string;
  supersededByBatchId?: string;
  supersededByRecordId?: string;
  supersededAt?: string;
  supersededReason?: string;
  publishedAt: string;
  publishedByEmail: string;
}

export interface IncentiveVersion {
  versionId: string;
  recordId: string;
  importType?: ImportType;
  periodStart?: string;
  periodEnd?: string;
  businessDate: string;
  employeeId: string;
  branchId: string;
  previousVersion: number;
  newVersion: number;
  previousComponent1Paise: number;
  previousComponent2Paise: number;
  previousComponent3Paise: number;
  previousTotalPaise: number;
  newComponent1Paise: number;
  newComponent2Paise: number;
  newComponent3Paise: number;
  newTotalPaise: number;
  correctionReason: string;
  batchId: string;
  correctedByEmail: string;
  archivedAt: string;
}

export type MonthlySummarySourceType = 'DAILY_AGGREGATE' | 'MONTHLY_RECORD' | 'NO_DATA';

export interface MonthlySummary {
  summaryId: string;
  employeeId: string;
  authUid: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  monthKey: string;
  sourceType?: MonthlySummarySourceType;
  component1TotalPaise: number;
  component2TotalPaise: number;
  component3TotalPaise: number;
  grandTotalPaise: number;
  saleAmt1TotalPaise?: number;
  saleQty1Total?: number;
  saleAmt2TotalPaise?: number;
  saleQty2Total?: number;
  saleAmt3TotalPaise?: number;
  saleQty3Total?: number;
  totalSaleAmtPaise?: number;
  totalSaleQty?: number;
  publishedDaysCount: number;
  updatedAt: string;
}

export interface AuditLog {
  logId: string;
  action: string;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  targetType: string;
  targetId: string;
  summary: string;
  createdAt: string;
}

export interface EmployeeNotification {
  notificationId: string;
  employeeId: string;
  authUid: string;
  title: string;
  message: string;
  importType?: ImportType;
  periodStart?: string;
  periodEnd?: string;
  businessDate: string;
  batchId: string;
  read: boolean;
  createdAt: string;
  readAt?: string;
}

export interface ExcelColumnMapping {
  businessDate: string;
  employeeId: string;
  employeeName: string;
  branchCode: string;
  component1: string;
  component2: string;
  component3: string;
  saleAmt1?: string;
  saleQty1?: string;
  saleAmt2?: string;
  saleQty2?: string;
  saleAmt3?: string;
  saleQty3?: string;
}

export interface ParsedExcelRow {
  rowNumber: number;
  raw: Record<string, string | number | null>;
}

export interface ExcelParseResponse {
  fileName: string;
  fileSha256: string;
  sheetName: string;
  availableSheets: string[];
  headerRowNumber: number;
  reportTitle: string;
  reportDateRangeText: string;
  importType: ImportType | null;
  periodStart: string | null;
  periodEnd: string | null;
  detectedFromDate: string | null;
  detectedToDate: string | null;
  dateValidationError: string | null;
  rawTotalRows: number;
  skippedBlankRows: number;
  skippedSummaryRows: number;
  headers: string[];
  excludedSalesColumns: string[];
  suggestedMapping: ExcelColumnMapping;
  totalRows: number;
  rows: ParsedExcelRow[];
}

export type PayoutStatus = 'UNPAID' | 'APPROVED' | 'PAID';
export type PaymentMode = 'BANK' | 'CASH' | 'UPI' | '';

export interface PayoutRecord {
  payoutId: string; // `${monthKey}_${employeeId}`
  monthKey: string;
  employeeId: string;
  authUid: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  grossIncentivePaise: number;
  adjustmentsNetPaise: number; // positive for bonus net, negative for deductions net
  netPayablePaise: number;
  status: PayoutStatus;
  paymentMode?: PaymentMode;
  paymentReference?: string;
  paidAt?: string;
  remarks?: string;
  updatedByEmail: string;
  updatedAt: string;
}

export type AdjustmentType = 'BONUS' | 'DEDUCTION' | 'ADVANCE' | 'RETURN_ADJUSTMENT';

export interface IncentiveAdjustment {
  adjustmentId: string;
  monthKey: string;
  employeeId: string;
  authUid: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  type: AdjustmentType;
  amountPaise: number; // Always positive integer paise; BONUS adds, others subtract
  reason: string;
  status: 'ACTIVE' | 'VOIDED';
  createdByEmail: string;
  createdAt: string;
  voidedByEmail?: string;
  voidedAt?: string;
}

export interface SalesTarget {
  targetId: string; // `BRANCH_${monthKey}_${branchId}` or `EMP_${monthKey}_${employeeId}`
  monthKey: string;
  scope: 'BRANCH' | 'EMPLOYEE';
  branchId: string;
  branchName: string;
  employeeId?: string;
  authUid?: string;
  employeeName?: string;
  targetSaleAmtPaise: number;
  targetSaleQty: number;
  updatedByEmail: string;
  updatedAt: string;
}

export type QueryCategory =
  | 'SALE_AMOUNT'
  | 'SALE_QTY'
  | 'INCENTIVE_MISMATCH'
  | 'PAYOUT_STATUS'
  | 'OTHER';

export type QueryStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED';

export interface EmployeeQuery {
  queryId: string;
  monthKey: string;
  employeeId: string;
  authUid: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  category: QueryCategory;
  subject: string;
  message: string;
  status: QueryStatus;
  adminReply?: string;
  resolvedByEmail?: string;
  createdAt: string;
  updatedAt: string;
}

