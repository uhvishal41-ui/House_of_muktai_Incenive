// Phase 2 strictly supports SUPER_ADMIN and EMPLOYEE roles (BRANCH_MANAGER disabled)
export type UserRole = 'SUPER_ADMIN' | 'EMPLOYEE';

export type ImportType = 'DAILY' | 'MONTHLY' | 'CUSTOM_PERIOD';

export type OverlapResolutionMode = 'BLOCK' | 'SKIP_OVERLAP' | 'RECONCILE_SUPERSEDE';

export type DepartmentId =
  | 'SAREE'
  | 'LADIES_WEAR'
  | 'KIDS_WEAR'
  | 'MENS_WEAR'
  | 'NON_APPARELS';

export type AdminAuthType = 'GOOGLE' | 'PASSWORD';

export interface AdminAccountRecord {
  uid: string;
  username?: string;
  email: string;
  displayName: string;
  role: 'SUPER_ADMIN';
  authType?: AdminAuthType;
  branchId?: string;
  active: boolean;
  mustChangePassword?: boolean;
  passwordUpdatedAt?: string;
  createdByEmail?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ActiveAuthUidRecord {
  authUid: string;
  employeeId: string;
  departmentId?: DepartmentId | '';
  branchId?: string;
  branchName?: string;
  isBranchManager?: boolean;
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
  saleId?: string; // Optional unique POS / Salesman Code (SELL ID) for Sales staff; blank for Non-Sales
  loginId: string;
  authEmail: string;
  linkedGoogleEmail?: string;
  authUid?: string;
  fullName: string;
  branchId: string;
  branchName: string;
  departmentId?: DepartmentId | '';
  departmentName?: string;
  photoDataUrl?: string;
  designation: string;
  gender?: string;
  category?: string;
  dateOfBirth?: string; // YYYY-MM-DD (private in employees; only MM-DD synced to birthday_profiles)
  dateOfJoining?: string;
  panNumber?: string;
  uanNumber?: string;
  pfNumber?: string;
  esicNumber?: string;
  bankName?: string;
  bankAccountMasked?: string;
  bankIfsc?: string;
  phone?: string;
  address?: string;
  emergencyContact?: string;
  customFields?: Record<string, string>; // Dynamic user-added extra columns in Employee Master & Bulk Excel Upload
  role: 'EMPLOYEE';
  isBranchManager?: boolean; // Optional read-only floor manager view strictly for own branch (zero peer salary access)
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
  employeeVisible?: boolean;
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
  employeeVisible?: boolean;
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
  saleId?: string;
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
  employeeVisible?: boolean;
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
  employeeVisible?: boolean;
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
  employeeVisible?: boolean;
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

export type VisibilityMode = 'ALL' | 'SELECTED';

export interface PortalVisibilitySettings {
  settingId: 'visibility';
  mode: VisibilityMode;
  visibleMonths: string[]; // YYYY-MM array (bounded <= 48) for Incentives
  salarySlipMode?: VisibilityMode; // Independent mode for Payment / Salary Slips (defaults to mode)
  salarySlipVisibleMonths?: string[]; // Independent YYYY-MM array (<= 48) for Payment / Salary Slips
  updatedByEmail: string;
  updatedAt: string;
}

export interface EmployeeColumnSettings {
  settingId: 'employee_columns';
  customColumns: string[]; // Bounded <= 25 custom column names (<= 60 chars each)
  visibleColumns: string[]; // Bounded <= 45 table column IDs (built-in + custom:*)
  updatedByEmail: string;
  updatedAt: string;
}

export interface PayrollLockSettings {
  settingId: 'payroll_locks';
  lockedMonths: string[]; // Bounded <= 48 YYYY-MM months frozen by Main Owner (Maker-Checker)
  lockNote?: string;
  updatedByEmail: string;
  updatedAt: string;
}

export interface DepartmentLeaderboardEntry {
  rank: 1 | 2 | 3;
  employeeName: string;
  branchName: string;
  saleAmtPaise: number; // ONLY Sale Amount — strictly ZERO incentive figures or private PII
  photoDataUrl: string;
}

export interface DepartmentLeaderboard {
  leaderboardId: string; // `${monthKey}__${departmentId}`
  monthKey: string;
  departmentId: DepartmentId;
  departmentName: string;
  totalParticipants: number;
  top3: DepartmentLeaderboardEntry[];
  employeeVisible: boolean;
  updatedByEmail: string;
  updatedAt: string;
}

export interface EmployeeDepartmentRank {
  rankId: string; // `${monthKey}__${employeeId}`
  monthKey: string;
  employeeId: string;
  authUid: string;
  departmentId: DepartmentId;
  departmentName: string;
  rank: number; // 1..N when saleAmtPaise > 0; 0 when no sale recorded yet
  totalParticipants: number;
  saleAmtPaise: number;
  gapToTop3Paise: number; // 0 if already inside Top 3
  gapToRank1Paise: number;
  employeeVisible: boolean;
  updatedAt: string;
}

export type SalarySlipPaymentMode = '' | 'BANK' | 'NEFT' | 'DCR' | 'CASH' | 'UPI' | 'CHEQUE';

export interface SalarySlip {
  slipId: string; // `${monthKey}__${employeeId}`
  monthKey: string; // YYYY-MM
  employeeId: string;
  saleId?: string;
  authUid: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  departmentId?: DepartmentId | '';
  departmentName?: string;
  designation?: string;
  gender?: string;
  category?: string;
  dateOfJoining?: string;
  panNumber?: string;
  uanNumber?: string;
  pfNumber?: string;
  esicNumber?: string;
  bankName?: string;
  bankAccountMasked?: string;
  bankIfsc?: string;
  // Attendance
  totalDays: number;
  presentDays?: number;
  paidDays: number;
  lopDays: number;
  weeklyOffDays: number;
  paidLeaveDays: number;
  overtimeDays?: number;
  overtimeHours: number;
  // Reference Rate / CTC columns (NEVER summed into grossEarningsPaise)
  monthlySalaryRatePaise?: number;
  monthlyGrossRatePaise?: number;
  // Earnings (paise)
  basicPaise: number;
  dearnessAllowancePaise?: number;
  hraPaise: number;
  attendanceAllowancePaise?: number;
  washingAllowancePaise?: number;
  conveyancePaise: number;
  medicalAllowancePaise?: number;
  leaveTravelAllowancePaise?: number;
  communicationExpensesPaise?: number;
  healthClubAllowancePaise?: number;
  adhocAllowancePaise?: number;
  travelingAllowancePaise?: number;
  salesCommissionPaise?: number;
  specialAllowancePaise: number;
  overtimePaise: number;
  incentivePaise: number;
  arrearsPaise?: number;
  otherEarningsPaise: number;
  grossEarningsPaise: number;
  // Deductions (paise)
  pfPaise: number;
  esicPaise: number;
  ptPaise: number;
  lwfPaise?: number;
  advanceRecoveryPaise: number;
  tdsPaise: number;
  penaltyPaise?: number;
  insurancePaise?: number;
  otherDeductionPaise: number;
  totalDeductionsPaise: number;
  // Net & Payment
  netPayablePaise: number;
  paymentMode?: SalarySlipPaymentMode;
  paymentReference?: string;
  paymentDate?: string;
  remarks?: string;
  employeeVisible: boolean;
  uploadedByEmail: string;
  uploadedAt: string;
  updatedAt: string;
}

export interface BirthdayProfile {
  employeeId: string;
  fullName: string;
  branchId: string;
  branchName: string;
  departmentId?: DepartmentId | '';
  departmentName?: string;
  designation: string;
  photoDataUrl?: string;
  birthMonthDay: string; // Strictly 'MM-DD' — zero birth year exposed cross-branch
  birthMonth: number; // 1..12
  birthDay: number; // 1..31
  active: boolean;
  updatedAt: string;
}

export type BirthdayWishSenderRole = 'EMPLOYEE' | 'SUPER_ADMIN';

export interface BirthdayWish {
  wishId: string; // `${celebrationYear}__${recipientEmployeeId}__${senderEmployeeId}`
  celebrationYear: number;
  birthMonthDay: string; // 'MM-DD'
  recipientEmployeeId: string;
  recipientName: string;
  recipientBranchName: string;
  senderEmployeeId: string;
  senderAuthUid: string;
  senderName: string;
  senderBranchName: string;
  senderRole: BirthdayWishSenderRole;
  message: string;
  createdAt: string;
}

export type LoanType = 'SALARY_ADVANCE' | 'PERSONAL_LOAN' | 'FESTIVAL_ADVANCE';
export type LoanStatus = 'ACTIVE' | 'CLOSED' | 'CANCELLED';

export interface EmployeeLoan {
  loanId: string;
  employeeId: string;
  authUid?: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  loanType: LoanType;
  principalPaise: number;
  monthlyEmiPaise: number;
  totalInstallments: number;
  paidInstallments: number;
  remainingBalancePaise: number;
  startMonthKey: string; // YYYY-MM
  lastDeductedMonthKey?: string; // YYYY-MM
  status: LoanStatus;
  remarks?: string;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
}



