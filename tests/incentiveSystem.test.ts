import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import type { NextFunction, Response } from 'express';
import { createExpressApp } from '../server.ts';
import {
  resolveRoleConsistent,
  type AuthenticatedRequest,
} from '../server/authMiddleware.ts';
import {
  buildDateColumnTemplateWorkbook,
  buildManagementReportWorkbook,
  buildSampleTemplateWorkbook,
  parseExcelBuffer,
} from '../server/excelEngine.ts';
import {
  isMonthVisibleToEmployees,
  isSalarySlipMonthVisibleToEmployees,
} from '../src/lib/departmentLeaderboardEngine.ts';
import {
  aggregateEmployeeMonth,
  applyPublishedCorrection,
  authorizeEmployeeStatusChange,
  canEmployeeLogin,
  detectPeriodOverlapsForEmployee,
  doesRecordOverlapMonth,
  getDeterministicNotificationId,
  getDeterministicVersionId,
  getIncentiveRecordKey,
  getOverlappingMonthKeys,
  parseExcelDateCellToIso,
  partitionEmployeeRecords,
  planBranchTransferConsolidation,
  resolveCanonicalBranchName,
  validateImportBatch,
} from '../src/lib/incentiveEngine.ts';
import {
  applyIncentiveAndLoanSyncToSalaryRows,
  buildWhatsAppDeepLink,
  buildWhatsAppSlipMessage,
  computeActiveLoanEmiByEmployee,
  computeAttendanceOtAttritionAnalytics,
  computeBranchPnlAnalytics,
  computeMonthlyNetIncentiveByEmployee,
  computePerformanceStreaksAndRetention,
  detectIncentiveImportAnomalies,
  detectSalarySlipAnomalies,
} from '../src/lib/proAnalyticsEngine.ts';
import {
  generateNextAvailableLoginId,
  normalizeLoginIdCandidate,
} from '../src/lib/loginProvisionHelper.ts';
import {
  buildBankNeftTransferDataset,
  buildBranchExecutiveSummaryRows,
  buildBranchIncentiveDataset,
  buildDcrCashDisbursementDataset,
  buildStatutoryComplianceDataset,
} from '../src/lib/branchReportsEngine.ts';
import {
  buildSalarySlipCsvTemplate,
  getSalarySlipEarningBreakdown,
  parseSalaryCsvText,
} from '../src/lib/salarySlipEngine.ts';
import type {
  Branch,
  Employee,
  EmployeeLoan,
  IncentiveAdjustment,
  MonthlySummary,
  PublishedIncentive,
  SalarySlip,
  SalesTarget,
  UserRole,
} from '../src/types/incentive.ts';

// --- Shared Realistic House of Muktai ERP Fixtures ---
const BRANCHES: Branch[] = [
  {
    branchId: 'BARAMATI_MIDC',
    branchCode: 'BARAMATI_MIDC',
    branchName: 'BARAMATI MIDC',
    city: 'Baramati',
    active: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    branchId: 'BARAMATI_MOTIBAG',
    branchCode: 'BARAMATI_MOTIBAG',
    branchName: 'BARAMATI MOTIBAG',
    city: 'Baramati',
    active: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    branchId: 'BEED',
    branchCode: 'BEED',
    branchName: 'BEED',
    city: 'Beed',
    active: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
];

const EMPLOYEES: Employee[] = [
  {
    employeeId: '459',
    loginId: 'HOM459',
    authEmail: 'hom459@staff.homfash.internal',
    authUid: 'uid-emp-459',
    fullName: 'Anita Popat Shingade',
    branchId: 'BARAMATI_MIDC',
    branchName: 'BARAMATI MIDC',
    designation: 'Sales Executive',
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    mustChangePassword: false,
    credentialsProvisioned: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    employeeId: '355',
    loginId: 'HOM355',
    authEmail: 'hom355@staff.homfash.internal',
    authUid: 'uid-emp-355',
    fullName: 'Asha Abaji Chavan',
    branchId: 'BARAMATI_MOTIBAG',
    branchName: 'BARAMATI MOTIBAG',
    designation: 'Sales Executive',
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    mustChangePassword: false,
    credentialsProvisioned: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    employeeId: '2432',
    loginId: 'HOM2432',
    authEmail: 'hom2432@staff.homfash.internal',
    authUid: 'uid-emp-2432',
    fullName: 'Ambrapali Shivaji Veer',
    branchId: 'BEED',
    branchName: 'BEED',
    designation: 'Sales Executive',
    role: 'EMPLOYEE',
    status: 'INACTIVE',
    mustChangePassword: false,
    credentialsProvisioned: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
];

function makePublishedRecord(overrides: Partial<PublishedIncentive>): PublishedIncentive {
  const importType = overrides.importType || 'DAILY';
  const periodStart = overrides.periodStart || overrides.businessDate || '2026-11-18';
  const periodEnd = overrides.periodEnd || periodStart;
  const employeeId = overrides.employeeId || '459';
  const c1 = overrides.component1Paise ?? 81600;
  const c2 = overrides.component2Paise ?? 1200;
  const c3 = overrides.component3Paise ?? 5100;
  return {
    recordId:
      overrides.recordId || getIncentiveRecordKey(importType, periodStart, periodEnd, employeeId),
    importType,
    periodStart,
    periodEnd,
    businessDate: importType === 'DAILY' ? periodStart : periodEnd,
    monthKey: periodStart.slice(0, 7),
    employeeId,
    authUid: overrides.authUid || 'uid-emp-459',
    employeeName: overrides.employeeName || 'Anita Popat Shingade',
    branchId: overrides.branchId || 'BARAMATI_MIDC',
    branchName: overrides.branchName || 'BARAMATI MIDC',
    component1Label: 'Incentive New Quantity Wise',
    component2Label: 'Old Incentive',
    component3Label: 'Incentive - 0.50%',
    component1Paise: c1,
    component2Paise: c2,
    component3Paise: c3,
    totalPaise: c1 + c2 + c3,
    ...(overrides.saleAmt1Paise !== undefined ? { saleAmt1Paise: overrides.saleAmt1Paise } : {}),
    ...(overrides.saleQty1 !== undefined ? { saleQty1: overrides.saleQty1 } : {}),
    ...(overrides.saleAmt2Paise !== undefined ? { saleAmt2Paise: overrides.saleAmt2Paise } : {}),
    ...(overrides.saleQty2 !== undefined ? { saleQty2: overrides.saleQty2 } : {}),
    ...(overrides.saleAmt3Paise !== undefined ? { saleAmt3Paise: overrides.saleAmt3Paise } : {}),
    ...(overrides.saleQty3 !== undefined ? { saleQty3: overrides.saleQty3 } : {}),
    ...(overrides.totalSaleAmtPaise !== undefined
      ? { totalSaleAmtPaise: overrides.totalSaleAmtPaise }
      : {}),
    ...(overrides.totalSaleQty !== undefined ? { totalSaleQty: overrides.totalSaleQty } : {}),
    status: 'PUBLISHED',
    version: overrides.version ?? 1,
    batchId: overrides.batchId || 'BATCH_TEST_1',
    publishedAt: overrides.publishedAt || '2026-11-18T10:00:00.000Z',
    publishedByEmail: 'uhvishal41@gmail.com',
  };
}

// =========================================================================
// TEST 1: Daily Excel Import Detection & Parsing
// =========================================================================
test('01. Daily Excel import (18-11-2026 To 18-11-2026) detects DAILY and validates exact totals', async () => {
  const buf = await buildSampleTemplateWorkbook(
    '2026-11-18',
    [
      {
        branchName: 'BARAMATI MIDC',
        salesPersonName: 'ANITA POPAT SHINGADE',
        salesmanNo: '459',
        component1: 816,
        component2: 12,
        component3: 51,
      },
    ],
    '2026-11-18',
  );

  const parsed = await parseExcelBuffer(buf, 'daily-18-11-2026.xlsx');
  assert.equal(parsed.importType, 'DAILY');
  assert.equal(parsed.periodStart, '2026-11-18');
  assert.equal(parsed.periodEnd, '2026-11-18');
  assert.equal(parsed.dateValidationError, null);

  const val = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [],
  });

  assert.equal(val.canStage, true);
  assert.equal(val.metrics.detectedImportType, 'DAILY');
  assert.equal(val.metrics.validEmployeeRows, 1);
  assert.equal(val.rows[0].recordKey, '2026-11-18_459');
  assert.equal(val.rows[0].totalPaise, 87900); // 816 + 12 + 51 = ₹879.00
});

// =========================================================================
// TEST 2: Monthly Excel Import Detection & Logical Separation
// =========================================================================
test('02. Monthly Excel import (01-10-2026 To 31-10-2026) detects MONTHLY and never creates artificial daily records', async () => {
  const buf = await buildSampleTemplateWorkbook(
    '2026-10-01',
    [
      {
        branchName: 'BARAMATI MIDC',
        salesPersonName: 'ANITA POPAT SHINGADE',
        salesmanNo: '459',
        component1: 8160,
        component2: 120,
        component3: 510,
      },
    ],
    '2026-10-31',
  );

  const parsed = await parseExcelBuffer(buf, 'oct-2026-monthly.xlsx');
  assert.equal(parsed.importType, 'MONTHLY');
  assert.equal(parsed.periodStart, '2026-10-01');
  assert.equal(parsed.periodEnd, '2026-10-31');

  const val = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [],
  });

  assert.equal(val.canStage, true);
  assert.equal(val.metrics.detectedImportType, 'MONTHLY');
  assert.equal(val.rows.length, 1); // Single monthly record, NOT 31 artificial daily rows
  assert.equal(val.rows[0].recordKey, 'MONTHLY_2026-10-01_2026-10-31_459');

  const monthlyRec = makePublishedRecord({
    importType: 'MONTHLY',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    component1Paise: 816000,
    component2Paise: 12000,
    component3Paise: 51000,
  });
  const parts = partitionEmployeeRecords([monthlyRec]);
  assert.equal(parts.dailyRecords.length, 0);
  assert.equal(parts.monthlyRecords.length, 1);
  assert.equal(parts.customPeriodRecords.length, 0);
});

// =========================================================================
// TEST 3: Custom Period Excel Import Detection
// =========================================================================
test('03. Custom Period Excel import (01-11-2026 To 15-11-2026) detects CUSTOM_PERIOD with exact start/end', async () => {
  const buf = await buildSampleTemplateWorkbook(
    '2026-11-01',
    [
      {
        branchName: 'BARAMATI MOTIBAG',
        salesPersonName: 'ASHA ABAJI CHAVAN',
        salesmanNo: '355',
        component1: 1713,
        component2: 341,
        component3: 125,
      },
    ],
    '2026-11-15',
  );

  const parsed = await parseExcelBuffer(buf, 'nov-first-half.xlsx');
  assert.equal(parsed.importType, 'CUSTOM_PERIOD');
  assert.equal(parsed.periodStart, '2026-11-01');
  assert.equal(parsed.periodEnd, '2026-11-15');

  const val = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [],
  });

  assert.equal(val.canStage, true);
  assert.equal(val.rows[0].recordKey, 'CUSTOM_PERIOD_2026-11-01_2026-11-15_355');
  assert.equal(val.rows[0].totalPaise, 217900);
});

// =========================================================================
// TEST 4: Missing Banner Date Blocked
// =========================================================================
test('04. Missing Excel banner date is rejected and blocks staging', async () => {
  const buf = await buildSampleTemplateWorkbook(
    '2026-11-18',
    [
      {
        branchName: 'BARAMATI MIDC',
        salesPersonName: 'ANITA POPAT SHINGADE',
        salesmanNo: '459',
        component1: 500,
        component2: 0,
        component3: 0,
      },
    ],
    '2026-11-18',
    '', // Empty date banner cell
  );

  const parsed = await parseExcelBuffer(buf, 'missing-banner.xlsx');
  assert.equal(parsed.importType, null);
  assert.ok(parsed.dateValidationError);

  const val = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [],
  });

  assert.equal(val.period.valid, false);
  assert.equal(val.period.errorCode, 'MISSING_BANNER_DATE');
  assert.equal(val.canStage, false);
});

// =========================================================================
// TEST 5: Invalid Date Range (start > end & impossible calendar date)
// =========================================================================
test('05. Invalid date range (start > end and invalid calendar date) is rejected and blocks staging', async () => {
  const reversedBuf = await buildSampleTemplateWorkbook(
    '2026-11-20',
    [
      {
        branchName: 'BARAMATI MIDC',
        salesPersonName: 'ANITA POPAT SHINGADE',
        salesmanNo: '459',
        component1: 500,
        component2: 0,
        component3: 0,
      },
    ],
    '2026-11-10',
  );
  const parsedRev = await parseExcelBuffer(reversedBuf, 'reversed-dates.xlsx');
  assert.equal(parsedRev.importType, null);
  assert.match(parsedRev.dateValidationError || '', /after end date/i);

  const valRev = validateImportBatch({
    periodStart: parsedRev.periodStart,
    periodEnd: parsedRev.periodEnd,
    rawBannerDateText: parsedRev.reportDateRangeText,
    rawTotalRows: parsedRev.rawTotalRows,
    skippedBlankRows: parsedRev.skippedBlankRows,
    skippedSummaryRows: parsedRev.skippedSummaryRows,
    rows: parsedRev.rows,
    mapping: parsedRev.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [],
  });
  assert.equal(valRev.period.errorCode, 'INVALID_DATE_RANGE');
  assert.equal(valRev.canStage, false);

  // Impossible date: 31-02-2026
  const badCalBuf = await buildSampleTemplateWorkbook(
    '2026-02-01',
    [
      {
        branchName: 'BARAMATI MIDC',
        salesPersonName: 'ANITA POPAT SHINGADE',
        salesmanNo: '459',
        component1: 500,
        component2: 0,
        component3: 0,
      },
    ],
    '2026-02-01',
    'As On :-01-02-2026 To 31-02-2026',
  );
  const parsedBadCal = await parseExcelBuffer(badCalBuf, 'impossible-feb31.xlsx');
  assert.equal(parsedBadCal.importType, null);
  assert.ok(parsedBadCal.dateValidationError);
});

// =========================================================================
// TEST 6: Blank Rows & Grand Total / Subtotal Rows Skipped Separately
// =========================================================================
test('06. Blank rows and Grand Total / Subtotal rows are skipped and counted separately', async () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Final Report');
  sheet.mergeCells('A1:B1');
  sheet.getCell('A1').value = 'Final Report incentive All Branches';
  sheet.mergeCells('C1:F1');
  sheet.getCell('C1').value = 'As On :-18-11-2026 To 18-11-2026';
  sheet.addRow([
    'NAME',
    'Sales Person Name',
    'Salesman No',
    'Incentive New Quantity Wise',
    'Old Incentive',
    'Incentive - 0.50%',
  ]);
  sheet.addRow(['BARAMATI MIDC', 'ANITA POPAT SHINGADE', 459, 816, 12, 51]);
  sheet.addRow(['BARAMATI MIDC', '(blank)', '(blank)', 0, 0, 0]);
  sheet.addRow(['BARAMATI MIDC', 'Subtotal', '', 816, 12, 51]);
  sheet.addRow(['BARAMATI MOTIBAG', '(blank)', '(blank)', 0, 0, 0]);
  sheet.addRow(['Grand Total', '', '', 816, 12, 51]);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const parsed = await parseExcelBuffer(buffer, 'with-blanks-and-totals.xlsx');

  assert.equal(parsed.rawTotalRows, 5);
  assert.equal(parsed.skippedBlankRows, 2);
  assert.equal(parsed.skippedSummaryRows, 2);
  assert.equal(parsed.totalRows, 1);
  assert.equal(parsed.rows[0].raw['Salesman No'], 459);
});

// =========================================================================
// TEST 7: Duplicate Daily Import Blocked From Silent Overwrite
// =========================================================================
test('07. Duplicate DAILY import is flagged EXISTS_PUBLISHED and defaults to SKIP', async () => {
  const buf = await buildSampleTemplateWorkbook(
    '2026-11-18',
    [
      {
        branchName: 'BARAMATI MIDC',
        salesPersonName: 'ANITA POPAT SHINGADE',
        salesmanNo: '459',
        component1: 900,
        component2: 10,
        component3: 40,
      },
    ],
    '2026-11-18',
  );
  const parsed = await parseExcelBuffer(buf, 'dup-daily.xlsx');
  const existing = makePublishedRecord({
    importType: 'DAILY',
    periodStart: '2026-11-18',
    periodEnd: '2026-11-18',
    employeeId: '459',
  });

  const val = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [existing],
  });

  assert.equal(val.rows[0].validationStatus, 'EXISTS_PUBLISHED');
  assert.equal(val.rows[0].resolution, 'SKIP');
  assert.equal(val.metrics.duplicateRecords, 1);
  assert.equal(val.canStage, false);
});

// =========================================================================
// TEST 8: Duplicate Monthly Import Blocked From Silent Overwrite
// =========================================================================
test('08. Duplicate MONTHLY import is flagged EXISTS_PUBLISHED and blocked from silent overwrite', async () => {
  const buf = await buildSampleTemplateWorkbook(
    '2026-10-01',
    [
      {
        branchName: 'BARAMATI MIDC',
        salesPersonName: 'ANITA POPAT SHINGADE',
        salesmanNo: '459',
        component1: 8160,
        component2: 120,
        component3: 510,
      },
    ],
    '2026-10-31',
  );
  const parsed = await parseExcelBuffer(buf, 'dup-monthly.xlsx');
  const existing = makePublishedRecord({
    importType: 'MONTHLY',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    employeeId: '459',
    component1Paise: 816000,
    component2Paise: 12000,
    component3Paise: 51000,
  });

  const val = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [existing],
  });

  assert.equal(val.rows[0].validationStatus, 'EXISTS_PUBLISHED');
  assert.equal(val.rows[0].resolution, 'SKIP');
  assert.equal(val.metrics.existingPublishedRecords, 1);
});

// =========================================================================
// TEST 9: Duplicate Custom Period Import Blocked From Silent Overwrite
// =========================================================================
test('09. Duplicate CUSTOM_PERIOD import is flagged EXISTS_PUBLISHED and blocked from silent overwrite', async () => {
  const buf = await buildSampleTemplateWorkbook(
    '2026-11-01',
    [
      {
        branchName: 'BARAMATI MOTIBAG',
        salesPersonName: 'ASHA ABAJI CHAVAN',
        salesmanNo: '355',
        component1: 1713,
        component2: 341,
        component3: 125,
      },
    ],
    '2026-11-15',
  );
  const parsed = await parseExcelBuffer(buf, 'dup-custom.xlsx');
  const existing = makePublishedRecord({
    importType: 'CUSTOM_PERIOD',
    periodStart: '2026-11-01',
    periodEnd: '2026-11-15',
    employeeId: '355',
    authUid: 'uid-emp-355',
    employeeName: 'Asha Abaji Chavan',
    branchId: 'BARAMATI_MOTIBAG',
    branchName: 'BARAMATI MOTIBAG',
  });

  const val = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [existing],
  });

  assert.equal(val.rows[0].validationStatus, 'EXISTS_PUBLISHED');
  assert.equal(val.rows[0].resolution, 'SKIP');
});

// =========================================================================
// TEST 10: Daily Import Overlapping Existing Published Monthly Import
// =========================================================================
test('10. DAILY import overlapping existing published MONTHLY record triggers PERIOD_OVERLAP and blocks publish', async () => {
  const buf = await buildSampleTemplateWorkbook(
    '2026-10-15',
    [
      {
        branchName: 'BARAMATI MIDC',
        salesPersonName: 'ANITA POPAT SHINGADE',
        salesmanNo: '459',
        component1: 500,
        component2: 20,
        component3: 30,
      },
    ],
    '2026-10-15',
  );
  const parsed = await parseExcelBuffer(buf, 'daily-inside-monthly.xlsx');
  const existingMonthly = makePublishedRecord({
    importType: 'MONTHLY',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    employeeId: '459',
  });

  const val = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [existingMonthly],
  });

  assert.equal(val.rows[0].validationStatus, 'PERIOD_OVERLAP');
  assert.equal(val.hasUnresolvedOverlaps, true);
  assert.equal(val.metrics.periodOverlapWarnings, 1);
  assert.equal(val.canStage, false);
});

// =========================================================================
// TEST 11: Monthly Import Overlapping Existing Published Daily Import
// =========================================================================
test('11. MONTHLY import overlapping existing published DAILY record triggers PERIOD_OVERLAP and blocks publish', async () => {
  const buf = await buildSampleTemplateWorkbook(
    '2026-11-01',
    [
      {
        branchName: 'BARAMATI MIDC',
        salesPersonName: 'ANITA POPAT SHINGADE',
        salesmanNo: '459',
        component1: 9000,
        component2: 100,
        component3: 400,
      },
    ],
    '2026-11-30',
  );
  const parsed = await parseExcelBuffer(buf, 'monthly-over-daily.xlsx');
  const existingDaily = makePublishedRecord({
    importType: 'DAILY',
    periodStart: '2026-11-18',
    periodEnd: '2026-11-18',
    employeeId: '459',
  });

  const val = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [existingDaily],
  });

  assert.equal(val.rows[0].validationStatus, 'PERIOD_OVERLAP');
  assert.equal(val.hasUnresolvedOverlaps, true);
  assert.equal(val.canStage, false);
});

// =========================================================================
// TEST 12: Custom Period Overlapping Existing Daily / Monthly / Custom Period
// =========================================================================
test('12. CUSTOM_PERIOD overlapping existing DAILY, MONTHLY, or CUSTOM_PERIOD triggers PERIOD_OVERLAP', async () => {
  const buf = await buildSampleTemplateWorkbook(
    '2026-11-10',
    [
      {
        branchName: 'BARAMATI MIDC',
        salesPersonName: 'ANITA POPAT SHINGADE',
        salesmanNo: '459',
        component1: 3000,
        component2: 100,
        component3: 200,
      },
    ],
    '2026-11-20',
  );
  const parsed = await parseExcelBuffer(buf, 'custom-overlap.xlsx');

  const scenarios: PublishedIncentive[] = [
    makePublishedRecord({ importType: 'DAILY', periodStart: '2026-11-15', periodEnd: '2026-11-15' }),
    makePublishedRecord({ importType: 'MONTHLY', periodStart: '2026-11-01', periodEnd: '2026-11-30' }),
    makePublishedRecord({ importType: 'CUSTOM_PERIOD', periodStart: '2026-11-01', periodEnd: '2026-11-15' }),
  ];

  for (const existing of scenarios) {
    const val = validateImportBatch({
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      rawBannerDateText: parsed.reportDateRangeText,
      rawTotalRows: parsed.rawTotalRows,
      skippedBlankRows: parsed.skippedBlankRows,
      skippedSummaryRows: parsed.skippedSummaryRows,
      rows: parsed.rows,
      mapping: parsed.suggestedMapping,
      branches: BRANCHES,
      employees: EMPLOYEES,
      publishedIncentives: [existing],
    });
    assert.equal(
      val.rows[0].validationStatus,
      'PERIOD_OVERLAP',
      `Expected PERIOD_OVERLAP against ${existing.importType}`,
    );
    assert.equal(val.canStage, false);
  }
});

// =========================================================================
// TEST 13: Double-Counting-Safe Monthly Reporting Aggregation
// =========================================================================
test('13. Monthly reporting aggregation NEVER double counts Daily + Monthly or adds Custom Period into monthly totals', () => {
  const daily1 = makePublishedRecord({
    importType: 'DAILY',
    periodStart: '2026-10-05',
    periodEnd: '2026-10-05',
    component1Paise: 10000,
    component2Paise: 2000,
    component3Paise: 3000,
  });
  const daily2 = makePublishedRecord({
    importType: 'DAILY',
    periodStart: '2026-10-06',
    periodEnd: '2026-10-06',
    component1Paise: 20000,
    component2Paise: 1000,
    component3Paise: 4000,
  });
  const customHalf = makePublishedRecord({
    importType: 'CUSTOM_PERIOD',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-15',
    component1Paise: 50000,
    component2Paise: 5000,
    component3Paise: 5000,
  });
  const monthlyFull = makePublishedRecord({
    importType: 'MONTHLY',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    component1Paise: 100000,
    component2Paise: 10000,
    component3Paise: 10000,
  });

  // Case A: Daily records + Custom Period -> sums ONLY Daily records (40000 paise), excludes Custom Period
  const aggDailyOnly = aggregateEmployeeMonth([daily1, daily2, customHalf], '459', '2026-10');
  assert.equal(aggDailyOnly.sourceType, 'DAILY_AGGREGATE');
  assert.equal(aggDailyOnly.grandTotalPaise, 40000);
  assert.equal(aggDailyOnly.publishedDaysCount, 2);
  assert.equal(aggDailyOnly.customPeriodRecordsExcludedFromMonthSum, 1);

  // Case B: Even if both Monthly and Daily existed -> NEVER adds them together (uses Monthly only = 120000 paise)
  const aggNoDouble = aggregateEmployeeMonth(
    [daily1, daily2, customHalf, monthlyFull],
    '459',
    '2026-10',
  );
  assert.equal(aggNoDouble.sourceType, 'MONTHLY_RECORD');
  assert.equal(aggNoDouble.grandTotalPaise, 120000);
  assert.equal(aggNoDouble.overlapAnomalyDetected, true);
});

// =========================================================================
// TEST 14: Match Employee Strictly By Salesman No Even On Name Change
// =========================================================================
test('14. Existing employee matches strictly by Salesman No even when Sales Person Name spelling changes', async () => {
  const buf = await buildSampleTemplateWorkbook(
    '2026-11-18',
    [
      {
        branchName: 'BARAMATI MIDC',
        salesPersonName: 'ANITA P. SHINGADE (UPDATED)',
        salesmanNo: '459',
        component1: 500,
        component2: 50,
        component3: 25,
      },
    ],
    '2026-11-18',
  );
  const parsed = await parseExcelBuffer(buf, 'name-spelling-change.xlsx');
  const val = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [],
  });

  assert.equal(val.metrics.newEmployeeCandidates, 0);
  assert.equal(val.metrics.existingEmployees, 1);
  assert.equal(val.rows[0].validationStatus, 'VALID');
  assert.equal(val.rows[0].employeeId, '459');
  assert.equal(val.rows[0].employeeName, 'Anita Popat Shingade');
});

// =========================================================================
// TEST 15: Branch Transfer Warning (Never Silently Overwrites Branch)
// =========================================================================
test('15. Existing Salesman No under different branch triggers BRANCH_TRANSFER warning without silent overwrite', async () => {
  const buf = await buildSampleTemplateWorkbook(
    '2026-11-18',
    [
      {
        branchName: 'BEED', // Master has BARAMATI MIDC for Salesman No 459
        salesPersonName: 'ANITA POPAT SHINGADE',
        salesmanNo: '459',
        component1: 700,
        component2: 0,
        component3: 30,
      },
    ],
    '2026-11-18',
  );
  const parsed = await parseExcelBuffer(buf, 'branch-transfer.xlsx');
  const val = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [],
  });

  assert.equal(val.rows[0].validationStatus, 'BRANCH_TRANSFER');
  assert.equal(val.rows[0].resolution, 'SKIP');
  assert.equal(val.metrics.branchTransferWarnings, 1);
  assert.equal(val.branchTransfers.length, 1);
  assert.equal(val.branchTransfers[0].masterBranchName, 'BARAMATI MIDC');
  assert.equal(val.branchTransfers[0].excelBranchName, 'BEED');
  // Master employee record remains unchanged until Super Admin approves
  assert.equal(EMPLOYEES[0].branchId, 'BARAMATI_MIDC');
});

// =========================================================================
// TEST 16: SMPL Candidate Visibility Without Auto-Deactivation
// =========================================================================
test('16. SMPL rows are flagged as SMPL candidates for review and NEVER auto-deactivated or auto-status-flipped', async () => {
  const activeSmplEmployee: Employee = {
    employeeId: '809',
    loginId: 'HOM809',
    authEmail: 'hom809@staff.homfash.internal',
    authUid: 'uid-emp-809',
    fullName: 'SMPL Baramati',
    branchId: 'BARAMATI_MIDC',
    branchName: 'BARAMATI MIDC',
    designation: 'Sales Executive (SMPL)',
    role: 'EMPLOYEE',
    status: 'ACTIVE', // Explicitly activated by Super Admin
    mustChangePassword: false,
    credentialsProvisioned: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };

  const buf = await buildSampleTemplateWorkbook(
    '2026-11-18',
    [
      {
        branchName: 'BARAMATI MIDC',
        salesPersonName: 'SMPL BARAMATI',
        salesmanNo: '809',
        component1: 86,
        component2: 31,
        component3: 29,
      },
      {
        branchName: 'BEED',
        salesPersonName: 'beed smpl',
        salesmanNo: '2292', // New unregistered SMPL candidate
        component1: 106,
        component2: 0,
        component3: 15,
      },
    ],
    '2026-11-18',
  );

  const parsed = await parseExcelBuffer(buf, 'smpl-check.xlsx');
  const val = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: [...EMPLOYEES, activeSmplEmployee],
    publishedIncentives: [],
  });

  assert.equal(val.metrics.smplCandidates, 2);
  // Active SMPL employee (809) remains VALID & ACTIVE (never auto-deactivated!)
  const row809 = val.rows.find((r) => r.employeeId === '809')!;
  assert.equal(row809.isSmplCandidate, true);
  assert.equal(row809.validationStatus, 'VALID');
  assert.equal(activeSmplEmployee.status, 'ACTIVE');

  // New SMPL candidate (2292) is surfaced for Super Admin explicit decision
  const cand2292 = val.newEmployeeCandidates.find((c) => c.salesmanNo === '2292')!;
  assert.equal(cand2292.isSmplCandidate, true);

  // Automated system import is strictly forbidden from changing status
  const sysAttempt = authorizeEmployeeStatusChange({
    actorRole: 'SYSTEM_IMPORT',
    currentStatus: 'ACTIVE',
    targetStatus: 'INACTIVE',
  });
  assert.equal(sysAttempt.allowed, false);
  assert.equal(sysAttempt.statusCode, 403);
});

// =========================================================================
// TEST 17: Published Record Correction Preserves Immutable Version History
// =========================================================================
test('17. Correction of published record requires reason, archives prior version, and increments version', () => {
  const existing = makePublishedRecord({
    importType: 'MONTHLY',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    employeeId: '459',
    component1Paise: 100000,
    component2Paise: 5000,
    component3Paise: 5000,
    version: 1,
  });

  assert.throws(
    () =>
      applyPublishedCorrection({
        existingRecord: existing,
        newComponent1Paise: 110000,
        newComponent2Paise: 5000,
        newComponent3Paise: 5000,
        correctionReason: 'ok', // Too short (<4 chars)
        batchId: 'BATCH_CORR_1',
        actorEmail: 'uhvishal41@gmail.com',
        now: '2026-11-19T00:00:00.000Z',
      }),
    /mandatory correction reason/i,
  );

  const { updatedRecord, versionSnapshot } = applyPublishedCorrection({
    existingRecord: existing,
    newComponent1Paise: 110000,
    newComponent2Paise: 5000,
    newComponent3Paise: 5000,
    correctionReason: 'Revised ERP return credit adjustment',
    batchId: 'BATCH_CORR_1',
    actorEmail: 'uhvishal41@gmail.com',
    now: '2026-11-19T00:00:00.000Z',
  });

  assert.equal(versionSnapshot.previousVersion, 1);
  assert.equal(versionSnapshot.newVersion, 2);
  assert.equal(versionSnapshot.previousTotalPaise, 110000);
  assert.equal(versionSnapshot.newTotalPaise, 120000);
  assert.equal(updatedRecord.version, 2);
  assert.equal(updatedRecord.totalPaise, 120000);
  assert.equal(updatedRecord.importType, 'MONTHLY');
});

// =========================================================================
// TEST 18: Backend RBAC — Only SUPER_ADMIN Can Change Employee Status (403 for Branch Manager & Employee)
// =========================================================================
test('18. Backend API enforces SUPER_ADMIN-only employee status control (403 for BRANCH_MANAGER and EMPLOYEE)', async () => {
  const testAuthMiddleware = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    const roleHeader = req.headers['x-test-role'] as UserRole | undefined;
    if (!roleHeader) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }
    req.authUser = {
      uid: `uid-${roleHeader.toLowerCase()}`,
      email:
        roleHeader === 'SUPER_ADMIN'
          ? 'uhvishal41@gmail.com'
          : `${roleHeader.toLowerCase()}@homfash.com`,
      emailVerified: true,
      role: roleHeader,
      isSuperAdmin: roleHeader === 'SUPER_ADMIN',
    };
    next();
  };

  const app = createExpressApp(testAuthMiddleware as never);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const callStatusEndpoint = async (role: string | null, targetStatus: 'ACTIVE' | 'INACTIVE') => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (role) headers['x-test-role'] = role;
      const resp = await fetch(
        `http://127.0.0.1:${port}/api/v1/admin/employees/authorize-status-change`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            employeeId: '459',
            currentStatus: 'ACTIVE',
            targetStatus,
          }),
        },
      );
      return { status: resp.status, body: await resp.json() };
    };

    const unauth = await callStatusEndpoint(null, 'INACTIVE');
    assert.equal(unauth.status, 401);

    const empAttempt = await callStatusEndpoint('EMPLOYEE', 'INACTIVE');
    assert.equal(empAttempt.status, 403);

    const bmAttempt = await callStatusEndpoint('BRANCH_MANAGER', 'INACTIVE');
    assert.equal(bmAttempt.status, 403);

    const adminAttempt = await callStatusEndpoint('SUPER_ADMIN', 'INACTIVE');
    assert.equal(adminAttempt.status, 200);
    assert.equal(adminAttempt.body.authorized, true);
    assert.equal(adminAttempt.body.auditAction, 'EMPLOYEE_DEACTIVATED');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// =========================================================================
// TEST 19: Deactivated Employee Blocked From Login While Preserving History
// =========================================================================
test('19. Deactivated employee is blocked from Employee Portal login while employee & historical incentives remain intact', () => {
  const inactiveEmp = EMPLOYEES.find((e) => e.employeeId === '2432')!;
  assert.equal(inactiveEmp.status, 'INACTIVE');

  const gate = canEmployeeLogin(inactiveEmp);
  assert.equal(gate.allowed, false);
  assert.equal(gate.code, 'ACCOUNT_DEACTIVATED');

  // Historical records for employee 2432 remain preserved in store
  const historicalRecords = [
    makePublishedRecord({
      employeeId: '2432',
      authUid: 'uid-emp-2432',
      importType: 'MONTHLY',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      component1Paise: 98400,
      component2Paise: 500,
      component3Paise: 3200,
    }),
  ];
  const agg = aggregateEmployeeMonth(historicalRecords, '2432', '2026-09');
  assert.equal(agg.grandTotalPaise, 102100);
});

// =========================================================================
// TEST 20: Reactivated Employee Regains Full Access & Historical Data + Strict Isolation
// =========================================================================
test('20. Reactivated employee regains login access with all historical Daily/Monthly/Custom records intact and isolated', () => {
  const empRecord: Employee = { ...EMPLOYEES.find((e) => e.employeeId === '2432')! };

  // Super Admin authorizes reactivation
  const decision = authorizeEmployeeStatusChange({
    actorRole: 'SUPER_ADMIN',
    currentStatus: empRecord.status,
    targetStatus: 'ACTIVE',
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.auditAction, 'EMPLOYEE_REACTIVATED');

  empRecord.status = 'ACTIVE';
  const gateAfter = canEmployeeLogin(empRecord);
  assert.equal(gateAfter.allowed, true);
  assert.equal(gateAfter.code, 'OK');

  // Employee sees ONLY their own published incentives (strict isolation from employee 459)
  const mixedStore: PublishedIncentive[] = [
    makePublishedRecord({
      employeeId: '2432',
      authUid: 'uid-emp-2432',
      importType: 'MONTHLY',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      component1Paise: 98400,
      component2Paise: 500,
      component3Paise: 3200,
    }),
    makePublishedRecord({
      employeeId: '2432',
      authUid: 'uid-emp-2432',
      importType: 'CUSTOM_PERIOD',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-15',
      component1Paise: 45000,
      component2Paise: 1000,
      component3Paise: 1500,
    }),
    makePublishedRecord({
      employeeId: '459',
      authUid: 'uid-emp-459',
      importType: 'DAILY',
      periodStart: '2026-11-18',
      periodEnd: '2026-11-18',
      component1Paise: 81600,
      component2Paise: 1200,
      component3Paise: 5100,
    }),
  ];

  const ownScoped = mixedStore.filter((r) => r.authUid === empRecord.authUid);
  assert.equal(ownScoped.length, 2);
  assert.equal(ownScoped.some((r) => r.employeeId === '459'), false);

  const parts = partitionEmployeeRecords(ownScoped);
  assert.equal(parts.monthlyRecords.length, 1);
  assert.equal(parts.customPeriodRecords.length, 1);
  assert.equal(parts.dailyRecords.length, 0);
});

// =========================================================================
// TEST 21 (Phase 2C Issue 2): Consistent Super Admin Resolution (/admins/{uid})
// =========================================================================
test('21. Consistent Super Admin role resolution honors bootstrapped email + active /admins/{uid} and rejects unverified/inactive', () => {
  // Bootstrapped primary Super Admin with verified email
  assert.equal(
    resolveRoleConsistent({
      email: 'uhvishal41@gmail.com',
      emailVerified: true,
      adminDoc: null,
    }),
    'SUPER_ADMIN',
  );

  // Secondary delegated Super Admin via active /admins/{uid} doc
  assert.equal(
    resolveRoleConsistent({
      email: 'finance.head@homfash.com',
      emailVerified: true,
      adminDoc: { role: 'SUPER_ADMIN', active: true },
    }),
    'SUPER_ADMIN',
  );

  // Deactivated /admins/{uid} doc fails closed to EMPLOYEE
  assert.equal(
    resolveRoleConsistent({
      email: 'former.admin@homfash.com',
      emailVerified: true,
      adminDoc: { role: 'SUPER_ADMIN', active: false },
    }),
    'EMPLOYEE',
  );

  // Unverified email NEVER receives SUPER_ADMIN even if bootstrapped or listed in /admins
  assert.equal(
    resolveRoleConsistent({
      email: 'uhvishal41@gmail.com',
      emailVerified: false,
      adminDoc: { role: 'SUPER_ADMIN', active: true },
    }),
    'EMPLOYEE',
  );
});

// =========================================================================
// TEST 22 (Phase 2C Issue 3): BRANCH_MANAGER Strictly Disabled in Phase 2
// =========================================================================
test('22. BRANCH_MANAGER role is disabled across role resolution and status authorization', () => {
  assert.equal(
    resolveRoleConsistent({
      email: 'manager@homfash.com',
      emailVerified: true,
      adminDoc: { role: 'BRANCH_MANAGER', active: true },
    }),
    'EMPLOYEE',
  );

  const bmStatusAttempt = authorizeEmployeeStatusChange({
    actorRole: 'BRANCH_MANAGER',
    currentStatus: 'ACTIVE',
    targetStatus: 'INACTIVE',
  });
  assert.equal(bmStatusAttempt.allowed, false);
  assert.equal(bmStatusAttempt.statusCode, 403);
});

// =========================================================================
// TEST 23 (Phase 2C Issue 4): Deterministic Publish & Retry Idempotency IDs
// =========================================================================
test('23. Deterministic version and notification IDs prevent duplicate writes on publish retry', () => {
  const v1 = getDeterministicVersionId('2026-11-18_459', 'BATCH_RETRY_001');
  const v2 = getDeterministicVersionId('2026-11-18_459', 'BATCH_RETRY_001');
  assert.equal(v1, v2);
  assert.equal(v1, '2026-11-18_459_B_BATCH_RETRY_001');

  const n1 = getDeterministicNotificationId('BATCH_RETRY_001', '459');
  const n2 = getDeterministicNotificationId('BATCH_RETRY_001', '459');
  assert.equal(n1, n2);
  assert.equal(n1, 'NTF_BATCH_RETRY_001_459');

  const existing = makePublishedRecord({
    importType: 'DAILY',
    periodStart: '2026-11-18',
    periodEnd: '2026-11-18',
    employeeId: '459',
  });
  const corr1 = applyPublishedCorrection({
    existingRecord: existing,
    newComponent1Paise: 90000,
    newComponent2Paise: 1200,
    newComponent3Paise: 5100,
    correctionReason: 'Retry idempotency check',
    batchId: 'BATCH_RETRY_001',
    actorEmail: 'uhvishal41@gmail.com',
    now: '2026-11-19T00:00:00.000Z',
  });
  assert.equal(corr1.versionSnapshot.versionId, v1);
});

// =========================================================================
// TEST 24 (Phase 2C Issue 5 - Option A): SKIP_OVERLAP Publishes Non-Conflicting Staff
// =========================================================================
test('24. Overlap Option A (SKIP_OVERLAP) skips conflicting employee and stages clean non-overlapping rows', async () => {
  const buf = await buildSampleTemplateWorkbook(
    '2026-11-01',
    [
      {
        branchName: 'BARAMATI MIDC',
        salesPersonName: 'ANITA POPAT SHINGADE',
        salesmanNo: '459', // Has conflicting published daily record on 2026-11-18
        component1: 9000,
        component2: 100,
        component3: 400,
      },
      {
        branchName: 'BARAMATI MOTIBAG',
        salesPersonName: 'ASHA ABAJI CHAVAN',
        salesmanNo: '355', // Clean employee with zero conflicts
        component1: 7000,
        component2: 200,
        component3: 300,
      },
    ],
    '2026-11-30',
  );
  const parsed = await parseExcelBuffer(buf, 'monthly-mixed-overlap.xlsx');
  const existingDaily459 = makePublishedRecord({
    importType: 'DAILY',
    periodStart: '2026-11-18',
    periodEnd: '2026-11-18',
    employeeId: '459',
  });

  // Default BLOCK prevents staging
  const blocked = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [existingDaily459],
    overlapResolutionMode: 'BLOCK',
  });
  assert.equal(blocked.canStage, false);

  // Option A SKIP_OVERLAP allows staging ONLY employee 355
  const skipped = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [existingDaily459],
    overlapResolutionMode: 'SKIP_OVERLAP',
  });
  assert.equal(skipped.canStage, true);
  assert.equal(skipped.hasUnresolvedOverlaps, false);
  assert.equal(skipped.metrics.publishableRows, 1);
  const row459 = skipped.rows.find((r) => r.employeeId === '459')!;
  const row355 = skipped.rows.find((r) => r.employeeId === '355')!;
  assert.equal(row459.resolution, 'SKIP');
  assert.equal(row355.resolution, 'PUBLISH_NEW');
});

// =========================================================================
// TEST 25 (Phase 2C Issue 5 - Option B): RECONCILE_SUPERSEDE Soft-Supersedes Safely
// =========================================================================
test('25. Overlap Option B (RECONCILE_SUPERSEDE) requires audit reason, lists conflicting IDs, and excludes SUPERSEDED records from totals', async () => {
  const buf = await buildSampleTemplateWorkbook(
    '2026-11-01',
    [
      {
        branchName: 'BARAMATI MIDC',
        salesPersonName: 'ANITA POPAT SHINGADE',
        salesmanNo: '459',
        component1: 9000,
        component2: 100,
        component3: 400,
      },
    ],
    '2026-11-30',
  );
  const parsed = await parseExcelBuffer(buf, 'monthly-reconcile.xlsx');
  const existingDaily = makePublishedRecord({
    importType: 'DAILY',
    periodStart: '2026-11-18',
    periodEnd: '2026-11-18',
    employeeId: '459',
  });

  // Missing reason (<4 chars) blocks staging
  const noReason = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [existingDaily],
    overlapResolutionMode: 'RECONCILE_SUPERSEDE',
    overlapReconcileReason: 'ok',
  });
  assert.equal(noReason.canStage, false);
  assert.equal(noReason.missingReconcileReason, true);

  // Valid audit reason enables SUPERSEDE_CONFLICTS with exact conflictingRecordIds
  const withReason = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [existingDaily],
    overlapResolutionMode: 'RECONCILE_SUPERSEDE',
    overlapReconcileReason: 'Audited month-end ERP sheet replaces provisional daily row',
  });
  assert.equal(withReason.canStage, true);
  assert.equal(withReason.rows[0].resolution, 'SUPERSEDE_CONFLICTS');
  assert.deepEqual(withReason.rows[0].conflictingRecordIds, [existingDaily.recordId]);

  // Once prior Daily is marked SUPERSEDED and Monthly is PUBLISHED, aggregation & overlap detection ignore SUPERSEDED
  const supersededDaily: PublishedIncentive = {
    ...existingDaily,
    status: 'SUPERSEDED',
    supersededByBatchId: 'BATCH_MONTHLY_1',
    supersededByRecordId: 'MONTHLY_2026-11-01_2026-11-30_459',
    supersededAt: '2026-11-30T12:00:00.000Z',
    supersededReason: 'Audited month-end ERP sheet replaces provisional daily row',
  };
  const newMonthly = makePublishedRecord({
    importType: 'MONTHLY',
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
    employeeId: '459',
    component1Paise: 900000,
    component2Paise: 10000,
    component3Paise: 40000,
  });

  const parts = partitionEmployeeRecords([supersededDaily, newMonthly]);
  assert.equal(parts.dailyRecords.length, 0);
  assert.equal(parts.monthlyRecords.length, 1);

  const agg = aggregateEmployeeMonth([supersededDaily, newMonthly], '459', '2026-11');
  assert.equal(agg.sourceType, 'MONTHLY_RECORD');
  assert.equal(agg.grandTotalPaise, 950000);
  assert.equal(agg.overlapAnomalyDetected, false);

  const overlapsAgainstSupersededOnly = detectPeriodOverlapsForEmployee({
    employeeId: '459',
    incomingImportType: 'MONTHLY',
    incomingStart: '2026-11-01',
    incomingEnd: '2026-11-30',
    incomingRecordKey: 'MONTHLY_2026-11-01_2026-11-30_459',
    publishedIncentives: [supersededDaily],
  });
  assert.equal(overlapsAgainstSupersededOnly.length, 0);
});

// =========================================================================
// TEST 26 (Phase 2C Issue 5): Cross-Month Custom Period Overlap Visibility
// =========================================================================
test('26. Cross-month CUSTOM_PERIOD record (2026-10-20 to 2026-11-05) appears in both 2026-10 and 2026-11', () => {
  const crossMonth = makePublishedRecord({
    importType: 'CUSTOM_PERIOD',
    periodStart: '2026-10-20',
    periodEnd: '2026-11-05',
    employeeId: '459',
  });

  assert.deepEqual(getOverlappingMonthKeys(crossMonth), ['2026-10', '2026-11']);
  assert.equal(doesRecordOverlapMonth(crossMonth, '2026-09'), false);
  assert.equal(doesRecordOverlapMonth(crossMonth, '2026-10'), true);
  assert.equal(doesRecordOverlapMonth(crossMonth, '2026-11'), true);
  assert.equal(doesRecordOverlapMonth(crossMonth, '2026-12'), false);
});

// =========================================================================
// TEST 27 (Phase 2C Issues 1, 2, 3, 4, 6): Hardened firestore.rules Invariants
// =========================================================================
test('27. firestore.rules enforces active_auth_uids revocation, Pillar 7 atomic sync, no BRANCH_MANAGER, terminal batch lock, and Google self-claim', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');

  // Issue 1: Active employee revocation registry + Pillar 7 existsAfter/getAfter enforcement
  assert.match(rulesText, /function isActiveEmployee\(\)/);
  assert.match(rulesText, /exists\(\/databases\/\$\(database\)\/documents\/active_auth_uids\/\$\(request\.auth\.uid\)\)/);
  assert.match(rulesText, /function isActiveRegistrySyncedAfter\(/);
  assert.match(rulesText, /existsAfter\(\/databases\/\$\(database\)\/documents\/active_auth_uids\//);
  assert.match(rulesText, /match \/active_auth_uids\/\{authUid\}/);

  // Issue 2: Verified users can get ONLY their own /admins/{adminUid} for Express & Frontend lookup
  assert.match(rulesText, /match \/admins\/\{adminUid\}/);
  assert.match(rulesText, /request\.auth\.token\.email_verified == true && request\.auth\.uid == adminUid/);

  // Issue 3: BRANCH_MANAGER completely disabled in executable rules logic
  const rulesWithoutComments = rulesText.replace(/\/\/[^\n]*/g, '');
  assert.equal(rulesWithoutComments.includes('BRANCH_MANAGER'), false);
  assert.match(rulesWithoutComments, /data\.role == 'SUPER_ADMIN'/);
  assert.match(rulesWithoutComments, /data\.role == 'EMPLOYEE'/);

  // Issue 4: Terminal PUBLISHED/REJECTED batch lock + PROCESSING/FAILED states
  assert.match(rulesText, /'PROCESSING'/);
  assert.match(rulesText, /'FAILED'/);
  assert.match(rulesText, /existing\(\)\.status != 'PUBLISHED'/);
  assert.match(rulesText, /existing\(\)\.status != 'REJECTED'/);

  // Issue 5: Soft SUPERSEDED status supported without permitting deletes
  assert.match(rulesText, /'SUPERSEDED'/);
  assert.match(rulesText, /allow delete: if false;/);

  // Issue 6: Verified Google self-claim Tier 2b
  assert.match(rulesText, /linkedGoogleEmail/);
});

// =========================================================================
// TEST 28: Official 12 House of Muktai Branches & ERP Spelling Alias Matching
// =========================================================================
test('28. ERP Excel "BARAMATI MOTIBAG" maps cleanly to official "BARAMATI MOTIBAGH" without creating duplicate branch or transfer warning', async () => {
  const officialBranches: Branch[] = [
    'BEED',
    'BHOSARI',
    'DHARASHIV',
    'INDAPUR',
    'PARANDA',
    'PANDHARPUR',
    'LONAND',
    'BARAMATI MIDC',
    'BARAMATI MOTIBAGH',
    'RASHIN',
    'SHRIGONDA',
    'SUPA',
  ].map((name) => {
    const code = name.replace(/\s+/g, '_');
    return {
      branchId: code,
      branchCode: code,
      branchName: name,
      city: name,
      active: true,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
  });

  assert.equal(officialBranches.length, 12);
  assert.equal(resolveCanonicalBranchName('BARAMATI MOTIBAG'), 'BARAMATI MOTIBAGH');
  assert.equal(resolveCanonicalBranchName('OSMANABAD'), 'DHARASHIV');

  const emp355Official: Employee = {
    ...EMPLOYEES[1],
    branchId: 'BARAMATI_MOTIBAGH',
    branchName: 'BARAMATI MOTIBAGH',
  };

  const buf = await buildSampleTemplateWorkbook(
    '2026-11-18',
    [
      {
        branchName: 'BARAMATI MOTIBAG', // ERP spelling without trailing H
        salesPersonName: 'ASHA ABAJI CHAVAN',
        salesmanNo: '355',
        component1: 1713,
        component2: 341,
        component3: 125,
      },
    ],
    '2026-11-18',
  );
  const parsed = await parseExcelBuffer(buf, 'erp-motibag-alias.xlsx');

  const val = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: officialBranches,
    employees: [emp355Official],
    publishedIncentives: [],
  });

  assert.equal(val.missingBranches.length, 0);
  assert.equal(val.branchTransfers.length, 0);
  assert.equal(val.rows[0].validationStatus, 'VALID');
  assert.equal(val.rows[0].branchId, 'BARAMATI_MOTIBAGH');
  assert.equal(val.rows[0].branchName, 'BARAMATI MOTIBAGH');
});

// =========================================================================
// TEST 29: Exact 12-Column ERP Format (Sale Amt & Sale Qty Imported + Both Column Orders + Double-Space Old Item Incentive)
// =========================================================================
test('29. 12-column ERP format imports Sale Amt & Sale Qty for all 3 sections, supports both column orders, and aggregates sales safely', async () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('October');

  // Exact Row 1 header layout requested by user (with double space in "Old  Item Incentive", no Row 1 date banner)
  sheet.addRow([
    'NAME',
    'Sales Person Name',
    'Salesman No',
    'Sale Amt',
    'Sale Qty',
    'Incentive New Quantity Wise',
    'Sale Amt',
    'Sale Qty',
    'Old  Item Incentive',
    'Sale Amt',
    'Sale Qty',
    'Incentive - 0.50%',
  ]);
  sheet.addRow([
    'BARAMATI MIDC',
    'ANITA POPAT SHINGADE',
    459,
    65000,
    42,
    816,
    4500.5,
    3,
    12,
    10200,
    9,
    51,
  ]);
  // Blank Sale Amt / Sale Qty cells safely parse as 0 (backward-compatible)
  sheet.addRow([
    'BARAMATI MIDC',
    'BHAGYASHREE ARUN KOKANE',
    2413,
    null,
    null,
    973,
    null,
    null,
    68,
    null,
    null,
    77,
  ]);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const parsed = await parseExcelBuffer(buffer, 'october-erp-12col.xlsx');

  assert.equal(parsed.headerRowNumber, 1);
  assert.deepEqual(parsed.excludedSalesColumns, []);
  assert.equal(parsed.suggestedMapping.branchCode, 'NAME');
  assert.equal(parsed.suggestedMapping.employeeName, 'Sales Person Name');
  assert.equal(parsed.suggestedMapping.employeeId, 'Salesman No');
  assert.equal(parsed.suggestedMapping.saleAmt1, 'Sale Amt');
  assert.equal(parsed.suggestedMapping.saleQty1, 'Sale Qty');
  assert.equal(parsed.suggestedMapping.component1, 'Incentive New Quantity Wise');
  assert.equal(parsed.suggestedMapping.saleAmt2, 'Sale Amt (2)');
  assert.equal(parsed.suggestedMapping.saleQty2, 'Sale Qty (2)');
  assert.equal(parsed.suggestedMapping.component2, 'Old  Item Incentive');
  assert.equal(parsed.suggestedMapping.saleAmt3, 'Sale Amt (3)');
  assert.equal(parsed.suggestedMapping.saleQty3, 'Sale Qty (3)');
  assert.equal(parsed.suggestedMapping.component3, 'Incentive - 0.50%');

  // Without a Row 1 banner, staging stays blocked until Super Admin explicitly confirms the report period
  const blockedVal = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [],
  });
  assert.equal(blockedVal.canStage, false);
  assert.equal(blockedVal.period.errorCode, 'MISSING_BANNER_DATE');

  // Once Super Admin selects October 2026 Full Month (2026-10-01 to 2026-10-31), it classifies as MONTHLY cleanly
  const emp2413: Employee = {
    ...EMPLOYEES[0],
    employeeId: '2413',
    loginId: 'EMP2413',
    authEmail: 'emp2413@staff.homfash.com',
    authUid: 'uid-emp-2413',
    fullName: 'BHAGYASHREE ARUN KOKANE',
  };
  const confirmedVal = validateImportBatch({
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    rawBannerDateText: 'Manual Monthly Selection: 2026-10-01 To 2026-10-31',
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: [...EMPLOYEES, emp2413],
    publishedIncentives: [],
  });

  assert.equal(confirmedVal.period.valid, true);
  assert.equal(confirmedVal.period.importType, 'MONTHLY');
  assert.equal(confirmedVal.canStage, true);

  // Row 1 exact incentive + Sale Amt (paise) + Sale Qty checks
  const r0 = confirmedVal.rows[0];
  assert.equal(r0.employeeId, '459');
  assert.equal(r0.component1Paise, 81600);
  assert.equal(r0.component2Paise, 1200);
  assert.equal(r0.component3Paise, 5100);
  assert.equal(r0.totalPaise, 87900);
  assert.equal(r0.saleAmt1Paise, 6500000);
  assert.equal(r0.saleQty1, 42);
  assert.equal(r0.saleAmt2Paise, 450050);
  assert.equal(r0.saleQty2, 3);
  assert.equal(r0.saleAmt3Paise, 1020000);
  assert.equal(r0.saleQty3, 9);
  assert.equal(r0.totalSaleAmtPaise, 7970050);
  assert.equal(r0.totalSaleQty, 54);

  // Row 2 blank sales default safely to 0
  const r1 = confirmedVal.rows[1];
  assert.equal(r1.employeeId, '2413');
  assert.equal(r1.totalPaise, 111800);
  assert.equal(r1.totalSaleAmtPaise, 0);
  assert.equal(r1.totalSaleQty, 0);

  // Batch preview totals include Sale Amt & Sale Qty
  assert.equal(confirmedVal.metrics.totalSaleAmtPaise, 7970050);
  assert.equal(confirmedVal.metrics.totalSaleQty, 54);

  // Aggregation preserves double-counting-safe Sale Amt & Sale Qty (MONTHLY overrides DAILY)
  const dailyRec = makePublishedRecord({
    importType: 'DAILY',
    periodStart: '2026-10-10',
    periodEnd: '2026-10-10',
    employeeId: '459',
    saleAmt1Paise: 500000,
    saleQty1: 5,
    totalSaleAmtPaise: 500000,
    totalSaleQty: 5,
  });
  const monthlyRec = makePublishedRecord({
    importType: 'MONTHLY',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    employeeId: '459',
    saleAmt1Paise: 6500000,
    saleQty1: 42,
    saleAmt2Paise: 450050,
    saleQty2: 3,
    saleAmt3Paise: 1020000,
    saleQty3: 9,
    totalSaleAmtPaise: 7970050,
    totalSaleQty: 54,
  });
  const agg = aggregateEmployeeMonth([dailyRec, monthlyRec], '459', '2026-10');
  assert.equal(agg.sourceType, 'MONTHLY_RECORD');
  assert.equal(agg.saleAmt1TotalPaise, 6500000);
  assert.equal(agg.saleQty1Total, 42);
  assert.equal(agg.totalSaleAmtPaise, 7970050);
  assert.equal(agg.totalSaleQty, 54);

  // Alternate column ordering (Sale Qty BEFORE Sale Amt) also maps cleanly without swapping
  const wbAlt = new ExcelJS.Workbook();
  const sheetAlt = wbAlt.addWorksheet('AltOrder');
  sheetAlt.addRow([
    'NAME',
    'Sales Person Name',
    'Salesman No',
    'Sale Qty',
    'Sale Amt',
    'Incentive New Quantity Wise',
    'Sale Qty',
    'Sale Amt',
    'Old Incentive',
    'Sale Qty',
    'Sale Amt',
    'Incentive - 0.50%',
  ]);
  sheetAlt.addRow([
    'BARAMATI MIDC',
    'ANITA POPAT SHINGADE',
    459,
    15,
    25000,
    400,
    2,
    3000,
    20,
    4,
    8000,
    40,
  ]);
  const parsedAlt = await parseExcelBuffer(
    Buffer.from(await wbAlt.xlsx.writeBuffer()),
    'alt-order.xlsx',
  );
  assert.equal(parsedAlt.suggestedMapping.saleQty1, 'Sale Qty');
  assert.equal(parsedAlt.suggestedMapping.saleAmt1, 'Sale Amt');
  assert.equal(parsedAlt.suggestedMapping.saleQty2, 'Sale Qty (2)');
  assert.equal(parsedAlt.suggestedMapping.saleAmt2, 'Sale Amt (2)');
  assert.equal(parsedAlt.suggestedMapping.saleQty3, 'Sale Qty (3)');
  assert.equal(parsedAlt.suggestedMapping.saleAmt3, 'Sale Amt (3)');
});

// =========================================================================
// TEST 30: Professional Suite — 2-Sheet Management Excel, New Slab Headers & Hardened Operational Rules
// =========================================================================
test('30. Management Excel workbook builds 2 formatted sheets, new slab names auto-map cleanly, and firestore.rules protects all 4 operational collections', async () => {
  // 1. Formatted 2-sheet Management Report (.xlsx)
  const reportBuf = await buildManagementReportWorkbook({
    monthKey: '2026-10',
    monthLabel: 'October 2026',
    branchRows: [
      {
        branchName: 'BARAMATI MIDC',
        staffCount: 1,
        totalSaleAmtRupees: 79700.5,
        totalSaleQty: 54,
        newItemsIncRupees: 816,
        oldItemsIncRupees: 12,
        otherItemsIncRupees: 51,
        grossIncentiveRupees: 879,
        incentivePctOfSale: 1.1,
        adjustmentsNetRupees: 200,
        netPayableRupees: 1079,
        paidCount: 1,
      },
    ],
    employeeRows: [
      {
        branchName: 'BARAMATI MIDC',
        employeeId: '459',
        employeeName: 'ANITA POPAT SHINGADE',
        saleAmt1Rupees: 65000,
        saleQty1: 42,
        inc1Rupees: 816,
        saleAmt2Rupees: 4500.5,
        saleQty2: 3,
        inc2Rupees: 12,
        saleAmt3Rupees: 10200,
        saleQty3: 9,
        inc3Rupees: 51,
        totalSaleAmtRupees: 79700.5,
        totalSaleQty: 54,
        grossIncentiveRupees: 879,
        adjustmentsNetRupees: 200,
        netPayableRupees: 1079,
        payoutStatus: 'PAID',
        paymentMode: 'BANK',
        paymentReference: 'UTR102030',
      },
    ],
  });

  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(reportBuf as unknown as ArrayBuffer);
  assert.deepEqual(
    loaded.worksheets.map((ws) => ws.name),
    ['Branch Summary', 'Employee Ledger'],
  );

  const bSheet = loaded.getWorksheet('Branch Summary')!;
  const bRow1 = String(bSheet.getCell('B1').value || '');
  const bRow2 = String(bSheet.getCell('B2').value || '');
  assert.match(bRow1, /HOUSE OF MUKTAI/);
  assert.match(bRow1, /SHRIMUKTAI MART PRIVATE LIMITED/);
  assert.match(bRow2, /WAGHOLIKAR HOUSE/);
  assert.match(bRow2, /Baramati, Pune, Maharashtra - 413102/);
  assert.ok(bSheet.getImages().length >= 1, 'Branch Summary sheet must embed the official logo');

  const bHeaderVals = bSheet.getRow(3).values as string[];
  assert.ok(bHeaderVals.includes('New Items Sale Inc (Rs)'));
  assert.ok(bHeaderVals.includes('Old Items Sale Inc (Rs)'));
  assert.ok(bHeaderVals.includes('Other Items Sale Inc (Rs)'));
  assert.ok(bHeaderVals.includes('Incentive % of Sale'));

  const eSheet = loaded.getWorksheet('Employee Ledger')!;
  assert.match(String(eSheet.getCell('B1').value || ''), /SHRIMUKTAI MART PRIVATE LIMITED/);
  assert.ok(eSheet.getImages().length >= 1, 'Employee Ledger sheet must embed the official logo');

  const eHeaderVals = eSheet.getRow(3).values as string[];
  assert.ok(eHeaderVals.includes('New Items Sale Incentive'));
  assert.ok(eHeaderVals.includes('Old Items Sale Incentive'));
  assert.ok(eHeaderVals.includes('Other Items Sale Incentive'));
  assert.ok(eHeaderVals.includes('Payout Status'));
  assert.ok(eHeaderVals.includes('Payment Ref'));

  // 2. New slab header names auto-map cleanly in parseExcelBuffer
  const sampleBuf = await buildSampleTemplateWorkbook(
    '2026-10-01',
    [
      {
        branchName: 'BARAMATI MIDC',
        salesPersonName: 'ANITA POPAT SHINGADE',
        salesmanNo: '459',
        saleAmt1: 50000,
        saleQty1: 30,
        component1: 700,
        saleAmt2: 4000,
        saleQty2: 4,
        component2: 20,
        saleAmt3: 10000,
        saleQty3: 8,
        component3: 50,
      },
    ],
    '2026-10-31',
  );
  const parsedNewSlabs = await parseExcelBuffer(sampleBuf, 'new-slabs.xlsx');
  assert.equal(parsedNewSlabs.suggestedMapping.component1, 'New Items Sale');
  assert.equal(parsedNewSlabs.suggestedMapping.component2, 'Old Items Sale');
  assert.equal(parsedNewSlabs.suggestedMapping.component3, 'Other Items Sale');

  // 3. Hardened firestore.rules includes all 4 operational collections with active-employee isolation
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  const rulesNoComments = rulesText.replace(/\/\/[^\n]*/g, '');
  assert.match(rulesNoComments, /match \/payout_records\/\{payoutId\}/);
  assert.match(rulesNoComments, /match \/incentive_adjustments\/\{adjustmentId\}/);
  assert.match(rulesNoComments, /match \/sales_targets\/\{targetId\}/);
  assert.match(rulesNoComments, /match \/employee_queries\/\{queryId\}/);
  assert.equal(rulesNoComments.includes('BRANCH_MANAGER'), false);
});

// =========================================================================
// TEST 31: Role-Separated Batch Edit, Update & Delete Security Rules Invariants
// =========================================================================
test('31. firestore.rules separates Super Admin draft ops from Main Owner published edit/delete while keeping audit_logs immutable', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  const rulesNoComments = rulesText.replace(/\/\/[^\n]*/g, '');

  // import_batches allows Main Owner post-publish edits/deletes, and Super Admin unpublished draft deletes
  const batchBlockMatch = rulesNoComments.match(/match \/import_batches\/\{batchId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(batchBlockMatch, 'import_batches match block must exist');
  assert.match(
    batchBlockMatch[0],
    /allow delete: if isValidId\(batchId\) && \(\s*isMainOwner\(\)\s*\|\| \(isSuperAdmin\(\) && existing\(\)\.status != 'PUBLISHED'\)\s*\);/,
  );
  assert.match(
    batchBlockMatch[0],
    /isMainOwner\(\)\s*&& existing\(\)\.status == 'PUBLISHED'\s*&& incoming\(\)\.status == 'PUBLISHED'/,
  );
  assert.match(batchBlockMatch[0], /'totalSaleAmtPaise'/);
  assert.match(batchBlockMatch[0], /'totalSaleQty'/);

  // import_batch_rows allows Super Admin row amount/qty edits & delete
  const rowsBlockMatch = rulesNoComments.match(/match \/import_batch_rows\/\{rowId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(rowsBlockMatch, 'import_batch_rows match block must exist');
  assert.match(rowsBlockMatch[0], /allow delete: if isValidId\(rowId\) && isSuperAdmin\(\);/);
  assert.match(rowsBlockMatch[0], /'component1Paise'/);
  assert.match(rowsBlockMatch[0], /'saleAmt1Paise'/);

  // published_incentives & monthly_summaries restrict permanent rollback delete strictly to Main Owner (and unlocked month)
  const pubBlockMatch = rulesNoComments.match(/match \/published_incentives\/\{recordId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(pubBlockMatch, 'published_incentives match block must exist');
  assert.match(
    pubBlockMatch[0],
    /allow delete: if isValidId\(recordId\) && isMainOwner\(\) && !isMonthPayrollLocked\(existing\(\)\.monthKey\);/,
  );

  const summaryBlockMatch = rulesNoComments.match(/match \/monthly_summaries\/\{summaryId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(summaryBlockMatch, 'monthly_summaries match block must exist');
  assert.match(
    summaryBlockMatch[0],
    /allow delete: if isValidId\(summaryId\) && isMainOwner\(\) && !isMonthPayrollLocked\(existing\(\)\.monthKey\);/,
  );

  // Immutable audit logs MUST remain undeletable; version history & employees allow delete ONLY for Main Owner
  const auditBlockMatch = rulesNoComments.match(/match \/audit_logs\/\{logId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(auditBlockMatch && /allow update, delete: if false;/.test(auditBlockMatch[0]));
  const verBlockMatch = rulesNoComments.match(/match \/incentive_versions\/\{versionId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(
    verBlockMatch &&
      /allow update: if false;/.test(verBlockMatch[0]) &&
      /allow delete: if isValidId\(versionId\) && isMainOwner\(\);/.test(verBlockMatch[0]),
  );
  const empBlockMatch = rulesNoComments.match(/match \/employees\/\{employeeId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(
    empBlockMatch && /allow delete: if isValidId\(employeeId\) && isMainOwner\(\);/.test(empBlockMatch[0]),
  );
});

// =========================================================================
// TEST 32: Complete 22-Collection Backup Manifest & Domain Hygiene Invariants
// =========================================================================
test('32. BACKUP_COLLECTION_NAMES covers all 22 Firestore collections and operationsService uses houseofmuktai.co.in fallback', () => {
  const serviceText = fs.readFileSync(
    path.resolve(process.cwd(), 'src/services/incentiveService.ts'),
    'utf-8',
  );
  const backupArrayMatch = serviceText.match(
    /export const BACKUP_COLLECTION_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const;/,
  );
  assert.ok(backupArrayMatch, 'BACKUP_COLLECTION_NAMES export must exist');

  const expected22Collections = [
    'admins',
    'active_auth_uids',
    'branches',
    'employees',
    'import_batches',
    'import_batch_rows',
    'published_incentives',
    'incentive_versions',
    'monthly_summaries',
    'notifications',
    'audit_logs',
    'payout_records',
    'incentive_adjustments',
    'sales_targets',
    'employee_queries',
    'portal_settings',
    'department_leaderboards',
    'employee_department_ranks',
    'salary_slips',
    'birthday_profiles',
    'birthday_wishes',
    'employee_loans',
  ];

  for (const col of expected22Collections) {
    assert.ok(
      backupArrayMatch[1].includes(`'${col}'`),
      `BACKUP_COLLECTION_NAMES must include '${col}'`,
    );
  }
  const quotedItems = backupArrayMatch[1].match(/'[^']+'/g) || [];
  assert.equal(quotedItems.length, 22, 'BACKUP_COLLECTION_NAMES must contain all 22 collections');

  const opsText = fs.readFileSync(
    path.resolve(process.cwd(), 'src/services/operationsService.ts'),
    'utf-8',
  );
  assert.equal(opsText.includes('unknown@homfash.com'), false);
  assert.ok(opsText.includes('unknown@houseofmuktai.co.in'));
});

// =========================================================================
// TEST 33: Branch-Wise Growth Target (+10% over Last Month) & Progress Math
// =========================================================================
test('33. Growth target engine calculates ₹1,00,000 + 10% = ₹1,10,000 cleanly and computes Admin/Employee progress accurately', async () => {
  const {
    computeGrowthPctOverBaseline,
    computeGrowthTargetPaise,
    computeGrowthTargetQty,
    computeTargetProgress,
  } = await import('../src/lib/targetCalculations.ts');

  // Exact user scenario: Last month sale ₹1,00,000 (10,000,000 paise) + 10% growth => ₹1,10,000
  const targetPaise = computeGrowthTargetPaise(10_000_000, 10);
  assert.equal(targetPaise, 11_000_000);

  // Implied growth percentage check
  assert.equal(computeGrowthPctOverBaseline(11_000_000, 10_000_000), 10);

  // Fallback target when new staff had ₹0 sale last month
  assert.equal(computeGrowthTargetPaise(0, 10, 50_000), 5_000_000);

  // Quantity growth calculation
  assert.equal(computeGrowthTargetQty(100, 10, true), 110);
  assert.equal(computeGrowthTargetQty(100, 10, false), 0);

  // Live progress calculation (mid-month ₹66,000 achieved out of ₹1,10,000 => 60%, ₹44,000 remaining)
  const midMonth = computeTargetProgress({
    achievedSalePaise: 6_600_000,
    targetSaleAmtPaise: 11_000_000,
    achievedQty: 55,
    targetSaleQty: 110,
  });
  assert.equal(midMonth.salePct, 60);
  assert.equal(midMonth.remainingSalePaise, 4_400_000);
  assert.equal(midMonth.qtyPct, 50);
  assert.equal(midMonth.status, 'IN_PROGRESS');

  // Achieved target (>=100%)
  const completed = computeTargetProgress({
    achievedSalePaise: 12_100_000,
    targetSaleAmtPaise: 11_000_000,
  });
  assert.equal(completed.salePct, 110);
  assert.equal(completed.remainingSalePaise, 0);
  assert.equal(completed.status, 'ACHIEVED');
});

// =========================================================================
// TEST 34: Payout / Adjustment / Target Mobile Sync & activeEmployeeId Rules
// =========================================================================
test('34. firestore.rules & services ensure PAID payouts, adjustments, and personal targets always sync to active Employee mobile portal', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  const rulesNoComments = rulesText.replace(/\/\/[^\n]*/g, '');

  // 1. Server-trusted activeEmployeeId() helper reads from active_auth_uids/{uid}
  assert.match(
    rulesNoComments,
    /function activeEmployeeId\(\)\s*\{\s*return get\(\/databases\/\$\(database\)\/documents\/active_auth_uids\/\$\(request\.auth\.uid\)\)\.data\.employeeId;\s*\}/,
  );

  // 2. payout_records, incentive_adjustments, and sales_targets strictly gate by isActiveEmployee() + isEmployeeVisibleDoc(...) + (authUid || activeEmployeeId())
  const payoutBlock = rulesNoComments.match(/match \/payout_records\/\{payoutId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(payoutBlock, 'payout_records match block must exist');
  assert.match(payoutBlock[0], /isActiveEmployee\(\) && isEmployeeVisibleDoc\(existing\(\)\) && \(existing\(\)\.authUid == request\.auth\.uid \|\| existing\(\)\.employeeId == activeEmployeeId\(\)\)/);
  assert.match(payoutBlock[0], /isActiveEmployee\(\) && isEmployeeVisibleDoc\(resource\.data\) && \(resource\.data\.authUid == request\.auth\.uid \|\| resource\.data\.employeeId == activeEmployeeId\(\)\)/);

  const adjBlock = rulesNoComments.match(/match \/incentive_adjustments\/\{adjustmentId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(adjBlock, 'incentive_adjustments match block must exist');
  assert.match(adjBlock[0], /isActiveEmployee\(\) && resource\.data\.status == 'ACTIVE' && isEmployeeVisibleDoc\(resource\.data\) && \(resource\.data\.authUid == request\.auth\.uid \|\| resource\.data\.employeeId == activeEmployeeId\(\)\)/);

  const targetBlock = rulesNoComments.match(/match \/sales_targets\/\{targetId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(targetBlock, 'sales_targets match block must exist');
  assert.match(targetBlock[0], /isActiveEmployee\(\) && isEmployeeVisibleDoc\(resource\.data\) && \(resource\.data\.scope == 'BRANCH' \|\| resource\.data\.authUid == request\.auth\.uid \|\| resource\.data\.employeeId == activeEmployeeId\(\)\)/);

  // 3. incentiveService.ts backfills authUid across payout_records, incentive_adjustments, and sales_targets too
  const svcText = fs.readFileSync(
    path.resolve(process.cwd(), 'src/services/incentiveService.ts'),
    'utf-8',
  );
  assert.ok(svcText.includes("collection(db, 'payout_records'), where('employeeId', '==', cleanEmpId)"));
  assert.ok(svcText.includes("collection(db, 'incentive_adjustments'), where('employeeId', '==', cleanEmpId)"));
  assert.ok(svcText.includes("collection(db, 'sales_targets'), where('employeeId', '==', cleanEmpId)"));
  assert.ok(svcText.includes('payoutsUpdated'));
  assert.ok(svcText.includes('adjustmentsUpdated'));
  assert.ok(svcText.includes('targetsUpdated'));

  // 4. operationsService.ts supports dual authUid + employeeId subscription, visibility filter, batch payout upsert, and operational sync
  const opsText = fs.readFileSync(
    path.resolve(process.cwd(), 'src/services/operationsService.ts'),
    'utf-8',
  );
  assert.ok(opsText.includes('export async function upsertPayoutRecordsBatch'));
  assert.ok(opsText.includes('export async function syncOperationalAuthUids'));
  assert.ok(opsText.includes("where('employeeId', '==', cleanEmpId)"));
  assert.ok(opsText.includes("where('employeeVisible', '==', true)"));
});

// =========================================================================
// TEST 35: Admin Month Visibility Rules (ALL, Single Month, Multi-Select, Empty)
// =========================================================================
test('35. Admin Month Visibility engine accurately gates ALL, single-month (Oct 2026 only), multi-month, and zero-month selections', async () => {
  const {
    isMonthVisibleToEmployees,
    filterVisibleMonths,
  } = await import('../src/lib/departmentLeaderboardEngine.ts');

  const allMonths = ['2026-10', '2026-09', '2026-08'];

  // 1. Default / ALL mode shows every published month
  assert.equal(isMonthVisibleToEmployees('2026-10', null), true);
  assert.equal(
    isMonthVisibleToEmployees('2026-08', {
      settingId: 'visibility',
      mode: 'ALL',
      visibleMonths: [],
      updatedByEmail: 'uhvishal41@gmail.com',
      updatedAt: '2026-11-01T00:00:00Z',
    }),
    true,
  );
  assert.deepEqual(
    filterVisibleMonths(allMonths, {
      settingId: 'visibility',
      mode: 'ALL',
      visibleMonths: [],
      updatedByEmail: 'uhvishal41@gmail.com',
      updatedAt: '2026-11-01T00:00:00Z',
    }),
    ['2026-10', '2026-09', '2026-08'],
  );

  // 2. Single-month restriction: ONLY Oct 2026 visible to staff
  const octOnly = {
    settingId: 'visibility' as const,
    mode: 'SELECTED' as const,
    visibleMonths: ['2026-10'],
    updatedByEmail: 'uhvishal41@gmail.com',
    updatedAt: '2026-11-01T00:00:00Z',
  };
  assert.equal(isMonthVisibleToEmployees('2026-10', octOnly), true);
  assert.equal(isMonthVisibleToEmployees('2026-09', octOnly), false);
  assert.equal(isMonthVisibleToEmployees('2026-08', octOnly), false);
  assert.deepEqual(filterVisibleMonths(allMonths, octOnly), ['2026-10']);

  // 3. Multi-select restriction: Oct 2026 & Sep 2026 visible
  const multiSelect = {
    settingId: 'visibility' as const,
    mode: 'SELECTED' as const,
    visibleMonths: ['2026-10', '2026-09'],
    updatedByEmail: 'uhvishal41@gmail.com',
    updatedAt: '2026-11-01T00:00:00Z',
  };
  assert.deepEqual(filterVisibleMonths(allMonths, multiSelect), ['2026-10', '2026-09']);

  // 4. Empty selected list hides all months from staff
  const hideAll = {
    settingId: 'visibility' as const,
    mode: 'SELECTED' as const,
    visibleMonths: [],
    updatedByEmail: 'uhvishal41@gmail.com',
    updatedAt: '2026-11-01T00:00:00Z',
  };
  assert.deepEqual(filterVisibleMonths(allMonths, hideAll), []);
});

// =========================================================================
// TEST 36: 5-Department Canonical Mapping & Bulk CSV Template / Parser
// =========================================================================
test('36. Official 5 textile departments resolve fuzzy retail spellings and Bulk CSV parser validates employee assignments', async () => {
  const {
    OFFICIAL_DEPARTMENTS,
    resolveCanonicalDepartment,
    buildDepartmentCsvTemplate,
    parseBulkDepartmentCsvText,
  } = await import('../src/lib/departmentLeaderboardEngine.ts');

  // Exactly 5 official departments
  assert.equal(OFFICIAL_DEPARTMENTS.length, 5);
  assert.deepEqual(
    OFFICIAL_DEPARTMENTS.map((d) => d.id),
    ['SAREE', 'LADIES_WEAR', 'KIDS_WEAR', 'MENS_WEAR', 'NON_APPARELS'],
  );

  // Fuzzy resolution of common retail spellings (including user prompt variations)
  assert.equal(resolveCanonicalDepartment('Saree Dept.')?.id, 'SAREE');
  assert.equal(resolveCanonicalDepartment('Lediesware Dept.')?.id, 'LADIES_WEAR');
  assert.equal(resolveCanonicalDepartment('Kids ware')?.id, 'KIDS_WEAR');
  assert.equal(resolveCanonicalDepartment('Mens ware Dept.')?.id, 'MENS_WEAR');
  assert.equal(resolveCanonicalDepartment('Non Apparels Dept.')?.id, 'NON_APPARELS');
  assert.equal(resolveCanonicalDepartment('Unknown Dept'), null);

  const mockEmployees: Employee[] = [
    {
      employeeId: 'EMP001',
      loginId: 'emp001',
      authEmail: 'emp001@homfash.com',
      fullName: 'Aarav Kulkarni',
      branchId: 'SUPA',
      branchName: 'Supa Branch',
      departmentId: 'KIDS_WEAR',
      departmentName: 'Kids Wear Dept.',
      designation: 'Sales Executive',
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      mustChangePassword: false,
      credentialsProvisioned: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      employeeId: 'EMP002',
      loginId: 'emp002',
      authEmail: 'emp002@homfash.com',
      fullName: 'Snehal Jadhav',
      branchId: 'DHARASHIV',
      branchName: 'Dharashiv Branch',
      designation: 'Sales Executive',
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      mustChangePassword: false,
      credentialsProvisioned: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const csvTemplate = buildDepartmentCsvTemplate(mockEmployees);
  assert.ok(csvTemplate.includes('EMP001'));
  assert.ok(csvTemplate.includes('Kids Wear Dept.'));

  const parsedRows = parseBulkDepartmentCsvText(
    [
      'Employee ID,Full Name,Branch,Department',
      'EMP001,Aarav Kulkarni,Supa Branch,Kids ware',
      'EMP002,Snehal Jadhav,Dharashiv Branch,Lediesware Dept.',
      'EMP999,Ghost User,Supa Branch,Saree Dept.',
      'EMP002,Snehal Jadhav,Dharashiv Branch,Invalid Dept',
    ].join('\n'),
    mockEmployees,
  );

  assert.equal(parsedRows.length, 4);
  assert.equal(parsedRows[0].employeeId, 'EMP001');
  assert.equal(parsedRows[0].status, 'UNCHANGED');
  assert.equal(parsedRows[0].resolvedDepartment?.id, 'KIDS_WEAR');
  assert.equal(parsedRows[1].employeeId, 'EMP002');
  assert.equal(parsedRows[1].status, 'READY');
  assert.equal(parsedRows[1].resolvedDepartment?.id, 'LADIES_WEAR');
  assert.equal(parsedRows[2].status, 'UNKNOWN_EMPLOYEE');
  assert.equal(parsedRows[3].status, 'INVALID_DEPARTMENT');
});

// =========================================================================
// TEST 37: 40-Employee Cross-Branch Kids Wear Top-3 Ranking & Zero-Incentive Privacy
// =========================================================================
test('37. 40-employee Kids Wear ranking crowns #1 Supa, #2 Dharashiv, #3 Shrigonda with ZERO peer incentives and exact personal rank', async () => {
  const {
    computeDepartmentLeaderboardsAndRanks,
    buildDepartmentLeaderboardId,
    buildEmployeeRankId,
  } = await import('../src/lib/departmentLeaderboardEngine.ts');

  const branchNames = [
    'Supa', 'Dharashiv', 'Shrigonda', 'Baramati', 'Indapur', 'Akluj',
    'Daund', 'Phaltan', 'Karjat', 'Jamkhed', 'Patas', 'Kurkumbh',
  ];

  // Build 40 ACTIVE Kids Wear employees across all 12 branches
  const employees: Employee[] = [];
  const incentives: PublishedIncentive[] = [];

  for (let i = 1; i <= 40; i++) {
    const branchIdx = (i - 1) % branchNames.length;
    const branchName = branchNames[branchIdx];
    const branchId = branchName.toUpperCase();
    const empId = `KW_${String(i).padStart(2, '0')}`;

    employees.push({
      employeeId: empId,
      loginId: empId.toLowerCase(),
      authEmail: `${empId.toLowerCase()}@homfash.com`,
      authUid: `uid_${empId}`,
      fullName: `Kids Staff ${i} (${branchName})`,
      branchId,
      branchName,
      departmentId: 'KIDS_WEAR',
      departmentName: 'Kids Wear Dept.',
      photoDataUrl: i <= 3 ? `data:image/jpeg;base64,MOCK_PHOTO_${i}` : undefined,
      designation: 'Sales Executive',
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      mustChangePassword: false,
      credentialsProvisioned: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    // Make #1 = Supa (i=1: ₹5,00,000), #2 = Dharashiv (i=2: ₹4,60,000), #3 = Shrigonda (i=3: ₹4,20,000)
    // Staff 4..39 descend by ₹10,000 each; Staff 40 has ₹0 sale (no incentive record)
    if (i < 40) {
      const saleRupees =
        i === 1 ? 500_000 : i === 2 ? 460_000 : i === 3 ? 420_000 : 420_000 - (i - 3) * 10_000;
      const salePaise = saleRupees * 100;
      incentives.push({
        recordId: `rec_${empId}_2026-10`,
        businessDate: '2026-10-31',
        monthKey: '2026-10',
        employeeId: empId,
        authUid: `uid_${empId}`,
        employeeName: `Kids Staff ${i} (${branchName})`,
        branchId,
        branchName,
        component1Label: 'C1',
        component2Label: 'C2',
        component3Label: 'C3',
        component1Paise: 50_000,
        component2Paise: 30_000,
        component3Paise: 20_000,
        totalPaise: 100_000,
        totalSaleAmtPaise: salePaise,
        totalSaleQty: 120,
        status: 'PUBLISHED',
        version: 1,
        batchId: 'batch_oct_2026',
        publishedAt: '2026-11-01T00:00:00Z',
        publishedByEmail: 'uhvishal41@gmail.com',
      });
    }
  }

  const { leaderboards, employeeRanks } = computeDepartmentLeaderboardsAndRanks({
    monthKey: '2026-10',
    employees,
    incentives,
    employeeVisible: true,
    updatedByEmail: 'uhvishal41@gmail.com',
    now: '2026-11-01T10:00:00Z',
  });

  const kidsBoard = leaderboards.find(
    (b) => b.leaderboardId === buildDepartmentLeaderboardId('2026-10', 'KIDS_WEAR'),
  );
  assert.ok(kidsBoard, 'Kids Wear leaderboard must be generated');
  assert.equal(kidsBoard.totalParticipants, 40);
  assert.equal(kidsBoard.top3.length, 3);

  // Exact Top 3 verification
  assert.equal(kidsBoard.top3[0].rank, 1);
  assert.equal(kidsBoard.top3[0].employeeName, 'Kids Staff 1 (Supa)');
  assert.equal(kidsBoard.top3[0].branchName, 'Supa');
  assert.equal(kidsBoard.top3[0].saleAmtPaise, 50_000_000);
  assert.equal(kidsBoard.top3[0].photoDataUrl, 'data:image/jpeg;base64,MOCK_PHOTO_1');

  assert.equal(kidsBoard.top3[1].rank, 2);
  assert.equal(kidsBoard.top3[1].branchName, 'Dharashiv');
  assert.equal(kidsBoard.top3[1].saleAmtPaise, 46_000_000);

  assert.equal(kidsBoard.top3[2].rank, 3);
  assert.equal(kidsBoard.top3[2].branchName, 'Shrigonda');
  assert.equal(kidsBoard.top3[2].saleAmtPaise, 42_000_000);

  // Privacy invariant: strictly ZERO incentive, peer employeeId, or PII fields on every Top-3 entry
  for (const entry of kidsBoard.top3) {
    const keys = Object.keys(entry);
    assert.equal('totalPaise' in entry, false);
    assert.equal('component1Paise' in entry, false);
    assert.equal('component2Paise' in entry, false);
    assert.equal('component3Paise' in entry, false);
    assert.equal('employeeId' in entry, false);
    assert.equal('phone' in entry, false);
    assert.equal('authEmail' in entry, false);
    assert.ok(
      keys.every((k) =>
        ['rank', 'employeeName', 'branchName', 'photoDataUrl', 'saleAmtPaise'].includes(k),
      ),
    );
  }

  // Personal rank #12 out of 40 + exact gap to surpass Top 3 (#3 + ₹1)
  const rank12 = employeeRanks.find(
    (r) => r.rankId === buildEmployeeRankId('2026-10', 'KW_12'),
  );
  assert.ok(rank12, 'Rank doc for KW_12 must exist');
  assert.equal(rank12.rank, 12);
  assert.equal(rank12.totalParticipants, 40);
  // KW_12 sale = 420,000 - 9*10,000 = 330,000; Top 3 cutoff (#3) = 420,000 => gap to surpass = ₹90,001 (9,000,100 paise)
  assert.equal(rank12.saleAmtPaise, 33_000_000);
  assert.equal(rank12.gapToTop3Paise, 9_000_100);
  assert.equal(rank12.gapToRank1Paise, 17_000_000);

  // Employee #40 with ₹0 sale receives rank 0 (Unranked) while still counting in 40 participants
  const rank40 = employeeRanks.find(
    (r) => r.rankId === buildEmployeeRankId('2026-10', 'KW_40'),
  );
  assert.ok(rank40);
  assert.equal(rank40.rank, 0);
  assert.equal(rank40.saleAmtPaise, 0);
  assert.equal(rank40.gapToTop3Paise, 42_000_100);
});

// =========================================================================
// TEST 38: Firestore Rules Hardening for Month Visibility & Department Leaderboards
// =========================================================================
test('38. firestore.rules enforces month visibility across monthly collections and isolates department leaderboards & personal ranks', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  const rulesNoComments = rulesText.replace(/\/\/[^\n]*/g, '');

  // 1. Visibility helper functions exist
  assert.match(rulesNoComments, /function isVisibilityRestricted\(\)/);
  assert.match(rulesNoComments, /function isEmployeeVisibleDoc\(data\)/);
  assert.match(rulesNoComments, /function activeEmployeeDepartmentId\(\)/);

  // 2. isValidLeaderboardEntry strictly uses hasOnly without any incentive field or peer ID
  const entryFn = rulesNoComments.match(/function isValidLeaderboardEntry\(entry\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(entryFn, 'isValidLeaderboardEntry must exist');
  assert.ok(
    entryFn[0].includes("entry.keys().hasOnly(['rank', 'employeeName', 'branchName', 'photoDataUrl', 'saleAmtPaise'])"),
  );
  assert.equal(entryFn[0].includes('totalPaise'), false);
  assert.equal(entryFn[0].includes('component1Paise'), false);

  // 3. portal_settings/visibility readable by Active Employees, writable ONLY by Super Admin
  const settingsBlock = rulesNoComments.match(/match \/portal_settings\/\{settingId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(settingsBlock);
  assert.match(settingsBlock[0], /settingId == 'visibility' && \(isSuperAdmin\(\) \|\| isActiveEmployee\(\)\)/);
  assert.match(settingsBlock[0], /settingId == 'employee_columns' && isSuperAdmin\(\)/);
  assert.match(settingsBlock[0], /allow list: if isSuperAdmin\(\);/);
  assert.match(settingsBlock[0], /allow delete: if false;/);

  // 4. department_leaderboards: zero staff list; staff get requires own departmentId + visible month
  const lbBlock = rulesNoComments.match(/match \/department_leaderboards\/\{leaderboardId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(lbBlock);
  assert.match(lbBlock[0], /allow list: if isSuperAdmin\(\);/);
  assert.match(lbBlock[0], /existing\(\)\.departmentId == activeEmployeeDepartmentId\(\)/);
  assert.match(lbBlock[0], /isEmployeeVisibleDoc\(existing\(\)\)/);

  // 5. employee_department_ranks: zero staff list; staff get requires own authUid/employeeId + visible month
  const rankBlock = rulesNoComments.match(/match \/employee_department_ranks\/\{rankId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(rankBlock);
  assert.match(rankBlock[0], /allow list: if isSuperAdmin\(\);/);
  assert.match(rankBlock[0], /existing\(\)\.authUid == request\.auth\.uid \|\| existing\(\)\.employeeId == activeEmployeeId\(\)/);
  assert.match(rankBlock[0], /isEmployeeVisibleDoc\(existing\(\)\)/);

  // 6. published_incentives & monthly_summaries enforce isEmployeeVisibleDoc on both get & list
  const pubBlock = rulesNoComments.match(/match \/published_incentives\/\{recordId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(pubBlock);
  assert.match(pubBlock[0], /isEmployeeVisibleDoc\(existing\(\)\)/);
  assert.match(pubBlock[0], /isEmployeeVisibleDoc\(resource\.data\)/);

  const sumBlock = rulesNoComments.match(/match \/monthly_summaries\/\{summaryId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(sumBlock);
  assert.match(sumBlock[0], /isEmployeeVisibleDoc\(existing\(\)\)/);
  assert.match(sumBlock[0], /isEmployeeVisibleDoc\(resource\.data\)/);
});

// =========================================================================
// TEST 39: Salary Slip Indian Words Converter & Privacy-Safe Bank Account Masking
// =========================================================================
test('39. Salary Slip engine converts paise to Indian English currency words and strictly masks bank account numbers', async () => {
  const {
    paiseToIndianWords,
    maskBankAccountNumber,
    buildSalarySlipId,
    normalizeMonthKeyFromCell,
  } = await import('../src/lib/salarySlipEngine.ts');

  // Indian currency words checks
  assert.equal(paiseToIndianWords(1_850_000), 'Rupees Eighteen Thousand Five Hundred Only');
  assert.equal(
    paiseToIndianWords(1_850_050),
    'Rupees Eighteen Thousand Five Hundred And Fifty Paise Only',
  );
  assert.equal(
    paiseToIndianWords(12_345_600),
    'Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six Only',
  );
  assert.equal(paiseToIndianWords(0), 'Rupees Zero Only');

  // Privacy-safe bank account masking
  assert.equal(maskBankAccountNumber('123456789012'), 'XXXX9012');
  assert.equal(maskBankAccountNumber('XXXX9012'), 'XXXX9012');
  assert.equal(maskBankAccountNumber('9876'), 'XXXX9876');
  assert.equal(maskBankAccountNumber(''), '');

  // Deterministic Slip ID & flexible month parsing
  assert.equal(buildSalarySlipId('2026-10', '459'), '2026-10__459');
  assert.equal(normalizeMonthKeyFromCell('Oct-2026'), '2026-10');
  assert.equal(normalizeMonthKeyFromCell('2026-10'), '2026-10');
  assert.equal(normalizeMonthKeyFromCell('10/2026'), '2026-10');
});

// =========================================================================
// TEST 40: Monthly Salary Sheet CSV Template, Payroll Math & Auto-Department Sync
// =========================================================================
test('40. Salary Slip CSV parser computes exact Gross/Deductions/Net math, masks bank accounts, flags errors, and detects Auto-Department Sync', async () => {
  const {
    buildSalarySlipCsvTemplate,
    parseSalaryCsvText,
  } = await import('../src/lib/salarySlipEngine.ts');

  // Template pre-fills active staff
  const templateCsv = buildSalarySlipCsvTemplate(EMPLOYEES, '2026-10');
  assert.ok(templateCsv.includes('459'));
  assert.ok(templateCsv.includes('355'));
  assert.equal(templateCsv.includes('2432'), false, 'Inactive staff should not be pre-filled');

  // Parse realistic payroll CSV with fuzzy department names, duplicate employee, and unknown ID
  const csvInput = [
    'Employee ID,Full Name,Branch,Department,Designation,Month,Total Days,Paid Days,LOP Days,Basic,HRA,Conveyance,Special Allowance,Overtime,Incentive / Bonus,Other Earnings,PF,ESIC,PT,Advance / Loan Recovery,TDS,Other Deduction,Bank Name,Bank A/c No,IFSC,PAN,UAN,PF No,ESIC No,DOJ,Payment Mode,Payment Date,Payment Ref,Remarks',
    '459,Anita Popat Shingade,BARAMATI MIDC,Kids ware,Senior Sales Executive,Oct-2026,31,30,1,15000,4000,1000,1500,500,1200,0,1800,150,200,500,0,0,HDFC Bank,123456789012,HDFC0001234,ABCDE1234F,100998877665,MH/PUN/12345,3112345678,2023-04-01,BANK,2026-11-05,NEFT998877,Diwali Bonus Included',
    '355,Asha Abaji Chavan,BARAMATI MOTIBAG,Lediesware Dept.,Sales Executive,2026-10,31,31,0,12000,3000,500,0,0,0,0,1440,120,200,0,0,0,SBI,998877665544,SBIN0004321,PQRSX5678K,,,,,,UPI,2026-11-05,UPI1122,',
    '459,Anita Popat Shingade,BARAMATI MIDC,Kids ware,Senior Sales Executive,2026-10,31,30,1,15000,0,0,0,0,0,0,0,0,0,0,0,0,,,,,,,,,,,',
    '9999,Unknown Staff,BARAMATI MIDC,Saree Dept.,Sales Executive,2026-10,31,31,0,10000,0,0,0,0,0,0,0,0,0,0,0,0,,,,,,,,,,,',
  ].join('\n');

  const summary = parseSalaryCsvText(csvInput, EMPLOYEES, '2026-10');
  assert.equal(summary.rows.length, 4);
  assert.equal(summary.validRows.length, 2);
  assert.equal(summary.duplicateRows.length, 1);
  assert.equal(summary.errorRows.length, 1);
  assert.equal(summary.departmentSyncCount, 2);

  // Verify Row 1 exact payroll arithmetic & bank masking
  const row459 = summary.rows[0];
  assert.equal(row459.status, 'VALID');
  assert.equal(row459.willSyncDepartment, true);
  assert.equal(row459.resolvedDepartment?.id, 'KIDS_WEAR');
  assert.equal(row459.resolvedDepartment?.name, 'Kids Wear Dept.');
  assert.equal(row459.grossEarningsPaise, 2_320_000); // 15000+4000+1000+1500+500+1200 = ₹23,200
  assert.equal(row459.totalDeductionsPaise, 265_000); // 1800+150+200+500 = ₹2,650
  assert.equal(row459.netPayablePaise, 2_055_000); // ₹20,550
  assert.equal(row459.bankAccountMasked, 'XXXX9012');
  assert.equal(row459.paymentMode, 'BANK');

  // Verify Row 2 department normalization
  const row355 = summary.rows[1];
  assert.equal(row355.status, 'VALID');
  assert.equal(row355.resolvedDepartment?.id, 'LADIES_WEAR');
  assert.equal(row355.resolvedDepartment?.name, 'Ladies Wear Dept.');
  assert.equal(row355.bankAccountMasked, 'XXXX5544');
  assert.equal(row355.grossEarningsPaise, 1_550_000); // ₹15,500
  assert.equal(row355.totalDeductionsPaise, 176_000); // ₹1,760
  assert.equal(row355.netPayablePaise, 1_374_000); // ₹13,740

  // Verify duplicate & unknown employee errors
  assert.equal(summary.rows[2].status, 'DUPLICATE_IN_FILE');
  assert.equal(summary.rows[3].status, 'ERROR');
  assert.match(summary.rows[3].errorMessage, /not found in Employee Master/i);

  // Summary KPIs sum strictly VALID rows
  assert.equal(summary.totalGrossPaise, 3_870_000);
  assert.equal(summary.totalDeductionsPaise, 441_000);
  assert.equal(summary.totalNetPaise, 3_429_000);
});

// =========================================================================
// TEST 41: Salary Slip Firestore Rules Invariants & Month Visibility Integration
// =========================================================================
test('41. firestore.rules enforces exact Salary Slip arithmetic & privacy isolation and Month Visibility cascades to salary_slips', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  const rulesNoComments = rulesText.replace(/\/\/[^\n]*/g, '');

  // 1. isValidSalarySlip + split earnings/deductions helpers enforce exact arithmetic
  const earnMatch = rulesNoComments.match(/function isValidSalarySlipEarnings\(data\)\s*\{[\s\S]*?\n    \}/);
  const dedMatch = rulesNoComments.match(/function isValidSalarySlipDeductions\(data\)\s*\{[\s\S]*?\n    \}/);
  const fnMatch = rulesNoComments.match(/function isValidSalarySlip\(data\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(earnMatch && earnMatch[0].includes('data.grossEarningsPaise == (sum1 + sum2)'));
  assert.ok(dedMatch && dedMatch[0].includes('data.totalDeductionsPaise == dedSum'));
  assert.ok(fnMatch, 'isValidSalarySlip validator must exist in firestore.rules');
  assert.ok(fnMatch[0].includes('isValidSalarySlipEarnings(data)'));
  assert.ok(fnMatch[0].includes('isValidSalarySlipDeductions(data)'));
  assert.ok(fnMatch[0].includes('data.netPayablePaise == (data.grossEarningsPaise - data.totalDeductionsPaise)'));

  // 2. match /salary_slips/{slipId} strictly isolates private staff reads & restricts writes to Super Admin
  const slipBlock = rulesNoComments.match(/match \/salary_slips\/\{slipId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(slipBlock, 'salary_slips match block must exist');
  assert.match(
    slipBlock[0],
    /isActiveEmployee\(\) && isSalarySlipVisibleDoc\(existing\(\)\) && \(existing\(\)\.authUid == request\.auth\.uid \|\| existing\(\)\.employeeId == activeEmployeeId\(\)\)/,
  );
  assert.match(
    slipBlock[0],
    /isActiveEmployee\(\) && isSalarySlipVisibleDoc\(resource\.data\) && \(resource\.data\.authUid == request\.auth\.uid \|\| resource\.data\.employeeId == activeEmployeeId\(\)\)/,
  );
  assert.match(slipBlock[0], /allow create: if isValidId\(slipId\) && isSuperAdmin\(\) && isValidSalarySlip\(incoming\(\)\)/);
  assert.match(slipBlock[0], /incoming\(\)\.uploadedAt == existing\(\)\.uploadedAt/);
  assert.match(
    slipBlock[0],
    /allow delete: if isValidId\(slipId\) && isMainOwner\(\) && !isMonthPayrollLocked\(existing\(\)\.monthKey\);/,
  );

  // 3. departmentVisibilityService cascades Admin Month Visibility toggles to salary_slips
  const visSvcText = fs.readFileSync(
    path.resolve(process.cwd(), 'src/services/departmentVisibilityService.ts'),
    'utf-8',
  );
  assert.ok(
    visSvcText.includes("'salary_slips'"),
    'VISIBILITY_SCOPED_COLLECTIONS must include salary_slips',
  );
});

// =========================================================================
// TEST 42: Salary Slip Header Substring Collision Guard (Zero Ghost Amounts / Double-Counting)
// =========================================================================
test('42. Salary Slip parser prevents short-key collisions (pl/ta/da/wo/tax/deduction) when optional columns are omitted', async () => {
  const { parseSalaryCsvText } = await import('../src/lib/salarySlipEngine.ts');

  // Minimal HR sheet that intentionally OMITS Paid Leave, Conveyance, Special Allowance, Weekly Off, TDS, and Other Deduction
  // while INCLUDING Employee ID=459 (contains "pl"), Total Days=31 (contains "ta" & "da"), Worked Days=28 (contains "wo"),
  // Professional Tax=200 (contains "tax"), and PF Deduction=1800 (contains "deduction")
  const minimalCsv = [
    'Employee ID,Employee Name,Total Days,Worked Days,Basic Salary,HRA,PF Deduction,Professional Tax,Total Deductions',
    '459,Anita Popat Shingade,31,28,15000,3000,1800,200,2000',
  ].join('\n');

  const res = parseSalaryCsvText(minimalCsv, EMPLOYEES, '2026-10');
  assert.equal(res.validRows.length, 1);
  const row = res.validRows[0];

  assert.equal(row.totalDays, 31);
  assert.equal(row.paidDays, 28);
  assert.equal(row.paidLeaveDays, 0, 'pl must NOT match employeeid (459)');
  assert.equal(row.weeklyOffDays, 0, 'wo must NOT match workeddays (28)');
  assert.equal(row.conveyancePaise, 0, 'ta must NOT match totaldays (31)');
  assert.equal(row.specialAllowancePaise, 0, 'da must NOT match totaldays (31)');
  assert.equal(row.tdsPaise, 0, 'tax must NOT double-count Professional Tax (200)');
  assert.equal(row.otherDeductionPaise, 0, 'deduction must NOT double-count PF Deduction or Total Deductions');
  assert.equal(row.basicPaise, 1_500_000);
  assert.equal(row.hraPaise, 300_000);
  assert.equal(row.grossEarningsPaise, 1_800_000); // Exactly ₹18,000
  assert.equal(row.pfPaise, 180_000);
  assert.equal(row.ptPaise, 20_000);
  assert.equal(row.totalDeductionsPaise, 200_000); // Exactly ₹2,000
  assert.equal(row.netPayablePaise, 1_600_000); // Exactly ₹16,000
});

// =========================================================================
// TEST 43: Salary Slip Attendance Bounds (<= 31 & Paid <= Total) & Negative Net Pay Guard
// =========================================================================
test('43. Salary Slip parser rejects attendance days > 31, Paid Days > Total Days, and Negative Net Pay before Firestore write', async () => {
  const { parseSalaryCsvText } = await import('../src/lib/salarySlipEngine.ts');

  const badRowsCsv = [
    'Salesman No,Total Days,Paid Days,Basic Salary,PF,Advance Recovery',
    '459,35,30,15000,1800,0', // Total Days > 31
    '355,30,31,15000,1800,0', // Paid Days > Total Days
  ].join('\n');

  const res1 = parseSalaryCsvText(badRowsCsv, EMPLOYEES, '2026-10');
  assert.equal(res1.validRows.length, 0);
  assert.equal(res1.errorRows.length, 2);
  assert.match(res1.errorRows[0].errorMessage, /between 0 and 31/i);
  assert.match(res1.errorRows[1].errorMessage, /cannot exceed Total Days/i);

  const negNetCsv = [
    'Salesman No,Total Days,Paid Days,Basic Salary,Advance Recovery',
    '459,31,30,10000,12000', // Deductions ₹12,000 > Gross ₹10,000
  ].join('\n');

  const res2 = parseSalaryCsvText(negNetCsv, EMPLOYEES, '2026-10');
  assert.equal(res2.validRows.length, 0);
  assert.equal(res2.errorRows.length, 1);
  assert.match(res2.errorRows[0].errorMessage, /Net Payable cannot be negative/i);
});

// =========================================================================
// TEST 44: Salary Slip Company Banner Header Auto-Detection & Date Cell Normalization
// =========================================================================
test('44. Salary Slip parser auto-detects header row below Row 1–2 company banners and normalizes Date cells to YYYY-MM-DD', async () => {
  const { parseSalaryCsvText, normalizeDateCellToIso } = await import(
    '../src/lib/salarySlipEngine.ts'
  );

  // Date normalization tests (Excel Date object, DD-MM-YYYY, DD/MM/YYYY, ISO)
  assert.equal(normalizeDateCellToIso(new Date('2026-11-05T06:00:00.000Z')), '2026-11-05');
  assert.equal(normalizeDateCellToIso('05-11-2026'), '2026-11-05');
  assert.equal(normalizeDateCellToIso('1/4/2023'), '2023-04-01');
  assert.equal(normalizeDateCellToIso('2026-10-01'), '2026-10-01');

  // CSV with 2 title banner rows before actual headers on Row 3
  const bannerCsv = [
    'SHRIMUKTAI MART PRIVATE LIMITED — HOUSE OF MUKTAI',
    'Monthly Payroll Register — Oct 2026',
    'Salesman No,Employee Name,DOJ,Basic Salary,HRA,Payment Date',
    '459,Anita Popat Shingade,01-04-2023,15000,3000,05/11/2026',
  ].join('\n');

  const res = parseSalaryCsvText(bannerCsv, EMPLOYEES, '2026-10');
  assert.equal(res.validRows.length, 1);
  assert.equal(res.validRows[0].employeeId, '459');
  assert.equal(res.validRows[0].dateOfJoining, '2023-04-01');
  assert.equal(res.validRows[0].paymentDate, '2026-11-05');
  assert.equal(res.validRows[0].netPayablePaise, 1_800_000);
});

// =========================================================================
// TEST 45: Department Top-3 Leaderboard Gap Math When < 3 Active Sellers Exist
// =========================================================================
test('45. Department Leaderboard computes ₹1 gapToTop3Paise when fewer than 3 sellers exist in a department', async () => {
  const { computeDepartmentLeaderboardsAndRanks } = await import(
    '../src/lib/departmentLeaderboardEngine.ts'
  );

  const deptEmps: Employee[] = [
    { ...EMPLOYEES[0], employeeId: 'E1', fullName: 'Seller One', departmentId: 'KIDS_WEAR', departmentName: 'Kids Wear Dept.', status: 'ACTIVE' },
    { ...EMPLOYEES[1], employeeId: 'E2', fullName: 'Seller Two', departmentId: 'KIDS_WEAR', departmentName: 'Kids Wear Dept.', status: 'ACTIVE' },
    { ...EMPLOYEES[0], employeeId: 'E3', fullName: 'Zero Seller', departmentId: 'KIDS_WEAR', departmentName: 'Kids Wear Dept.', status: 'ACTIVE' },
  ];

  const incs: PublishedIncentive[] = [
    makePublishedRecord({
      importType: 'MONTHLY',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      employeeId: 'E1',
      saleAmt1Paise: 5_000_000, // ₹50,000
    }),
    makePublishedRecord({
      importType: 'MONTHLY',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      employeeId: 'E2',
      saleAmt1Paise: 3_000_000, // ₹30,000
    }),
  ];

  const { leaderboards, employeeRanks } = computeDepartmentLeaderboardsAndRanks({
    monthKey: '2026-10',
    employees: deptEmps,
    incentives: incs,
    employeeVisible: true,
    updatedByEmail: 'uhvishal41@gmail.com',
  });

  const kidsBoard = leaderboards.find((b) => b.departmentId === 'KIDS_WEAR');
  assert.ok(kidsBoard);
  assert.equal(kidsBoard.top3.length, 2);

  const rankZero = employeeRanks.find((r) => r.employeeId === 'E3');
  assert.ok(rankZero);
  assert.equal(rankZero.rank, 0);
  assert.equal(
    rankZero.gapToTop3Paise,
    100,
    'With only 2 sellers on podium, open 3rd spot needs only ₹1 (100 paise), not Rank #2 + ₹1',
  );
  assert.equal(rankZero.gapToRank1Paise, 5_000_000);
});

// =========================================================================
// TEST 46: Birthday Engine IST Matching, Feb 29 Leap Fallback & Dec→Jan Year Wrap
// =========================================================================
test('46. Birthday Engine parses DOBs, handles Feb 29 leap-year fallback on Feb 28, and wraps Dec→Jan upcoming window accurately', async () => {
  const {
    parseDobToIso,
    extractMonthDayFromDob,
    isBirthdayToday,
    daysUntilNextBirthday,
  } = await import('../src/lib/birthdayEngine.ts');

  assert.equal(parseDobToIso('1994-05-18'), '1994-05-18');
  assert.equal(parseDobToIso('18-05-1994'), '1994-05-18');
  assert.equal(parseDobToIso('05/11/1998'), '1998-11-05');
  assert.equal(parseDobToIso('2025-01-01'), ''); // Out of 1940–2015 employee bounds
  assert.equal(parseDobToIso('31-02-1995'), ''); // Invalid calendar date

  const md = extractMonthDayFromDob('1994-05-18');
  assert.deepEqual(md, { birthMonthDay: '05-18', birthMonth: 5, birthDay: 18 });

  // Non-leap year (2026-02-28 IST): Feb 29 birthday celebrates on Feb 28
  const feb28NonLeap = new Date('2026-02-28T06:00:00.000Z'); // 11:30 IST on 2026-02-28
  assert.equal(isBirthdayToday('1996-02-29', feb28NonLeap), true);
  assert.equal(daysUntilNextBirthday('02-29', feb28NonLeap), 0);

  // Dec 29 IST -> Jan 2 birthday is 4 days away across year boundary
  const dec29 = new Date('2026-12-29T06:00:00.000Z'); // 11:30 IST on 2026-12-29
  assert.equal(daysUntilNextBirthday('01-02', dec29), 4);
  assert.equal(daysUntilNextBirthday('12-29', dec29), 0);
});

// =========================================================================
// TEST 47: Privacy-Isolated Birthday Profile Builder & Deterministic Wish IDs
// =========================================================================
test('47. buildBirthdayProfileFromEmployee strips all sensitive PII and excludes INACTIVE staff; wish IDs are deterministic', async () => {
  const {
    buildBirthdayProfileFromEmployee,
    buildDeterministicWishId,
  } = await import('../src/lib/birthdayEngine.ts');

  const sensitiveActiveEmp: Employee = {
    ...EMPLOYEES[0],
    status: 'ACTIVE',
    dateOfBirth: '1993-08-15',
    phone: '9876543210',
    panNumber: 'ABCDE1234F',
    bankAccountMasked: 'XXXX5678',
  };

  const profile = buildBirthdayProfileFromEmployee(sensitiveActiveEmp);
  assert.ok(profile, 'Active employee with DOB must produce a BirthdayProfile');
  assert.equal(profile.birthMonthDay, '08-15');
  assert.equal(profile.birthMonth, 8);
  assert.equal(profile.birthDay, 15);
  assert.equal(profile.active, true);

  // Zero PII leakage check
  const keys = Object.keys(profile);
  assert.equal(keys.includes('dateOfBirth'), false);
  assert.equal(keys.includes('phone'), false);
  assert.equal(keys.includes('panNumber'), false);
  assert.equal(keys.includes('bankAccountMasked'), false);
  assert.equal(keys.includes('authEmail'), false);

  // INACTIVE employee MUST NOT appear in birthday_profiles
  const inactiveEmp: Employee = { ...sensitiveActiveEmp, status: 'INACTIVE' };
  assert.equal(buildBirthdayProfileFromEmployee(inactiveEmp), null);

  // Deterministic 1-wish-per-sender-per-year ID
  assert.equal(buildDeterministicWishId(2026, '459', '355'), '2026__459__355');
});

// =========================================================================
// TEST 48: Bulk DOB CSV Parser Validation (DD-MM-YYYY, YYYY-MM-DD, Unknown ID, Invalid Date)
// =========================================================================
test('48. parseBulkDobCsvText validates DD-MM-YYYY & ISO DOBs, skips blank rows, and flags invalid dates & unknown Employee IDs', async () => {
  const { parseBulkDobCsvText } = await import('../src/lib/birthdayEngine.ts');

  const csv = [
    'Employee ID,Employee Name,Branch,Date of Birth (YYYY-MM-DD)',
    '459,Anita Popat Shingade,BARAMATI MIDC,15-08-1993',
    '355,Ramesh Tukaram Kale,BEED,1991-11-23',
    '2432,Inactive Staff,BARAMATI MIDC,', // Blank DOB -> skipped cleanly
    '99999,Ghost Employee,PUNE,1995-04-12', // Unknown ID -> ERROR
    '459,Anita Popat Shingade,BARAMATI MIDC,31-02-1993', // Invalid calendar date -> ERROR
  ].join('\n');

  const rows = parseBulkDobCsvText(csv, EMPLOYEES);
  const valid = rows.filter((r) => r.status === 'VALID');
  const errors = rows.filter((r) => r.status === 'ERROR');

  assert.equal(valid.length, 2);
  assert.equal(valid[0].employeeId, '459');
  assert.equal(valid[0].normalizedDob, '1993-08-15');
  assert.equal(valid[1].employeeId, '355');
  assert.equal(valid[1].normalizedDob, '1991-11-23');

  assert.equal(errors.length, 2);
  assert.match(errors[0].errorMessage || '', /not found in Employee Master/i);
  assert.match(errors[1].errorMessage || '', /Invalid Date of Birth/i);
});

// =========================================================================
// TEST 49: Birthday Firestore Security Rules Invariants (PII Isolation & Immutable Wishes)
// =========================================================================
test('49. firestore.rules isolates birthday_profiles PII, enforces immutable 1-per-year birthday_wishes, and blocks self-wishing', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  const rulesNoComments = rulesText.replace(/\/\/[^\n]*/g, '');

  // 1. isValidBirthdayProfile must NOT include dateOfBirth or sensitive keys
  const bpFn = rulesNoComments.match(/function isValidBirthdayProfile\(data\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(bpFn, 'isValidBirthdayProfile validator must exist');
  assert.equal(bpFn[0].includes("'dateOfBirth'"), false, 'birthday_profiles must never store birth year/dateOfBirth');
  assert.equal(bpFn[0].includes("'phone'"), false);
  assert.equal(bpFn[0].includes("'panNumber'"), false);

  // 2. match /birthday_profiles/{employeeId} restricts staff reads strictly to active == true
  const bpBlock = rulesNoComments.match(/match \/birthday_profiles\/\{employeeId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(bpBlock, 'birthday_profiles match block must exist');
  assert.match(bpBlock[0], /isActiveEmployee\(\) && resource\.data\.active == true/);
  assert.match(bpBlock[0], /allow create: if isValidId\(employeeId\) && isSuperAdmin\(\)/);
  assert.match(bpBlock[0], /allow update: if isValidId\(employeeId\) && isSuperAdmin\(\)/);

  // 3. match /birthday_wishes/{wishId} enforces immutability, anti-self-wish, and deterministic ID
  const bwBlock = rulesNoComments.match(/match \/birthday_wishes\/\{wishId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(bwBlock, 'birthday_wishes match block must exist');
  assert.match(bwBlock[0], /allow update: if false;/);
  assert.match(bwBlock[0], /incoming\(\)\.recipientEmployeeId != activeEmployeeId\(\)/);
  assert.match(bwBlock[0], /incoming\(\)\.senderEmployeeId == activeEmployeeId\(\)/);
  assert.match(bwBlock[0], /string\(incoming\(\)\.celebrationYear\) \+ '__' \+ incoming\(\)\.recipientEmployeeId \+ '__' \+ activeEmployeeId\(\)/);
});

// =========================================================================
// TEST 50: Salary Slip 14 Official Earning Columns, Exact Arithmetic & Rules
// =========================================================================
test('50. Salary Slip template & parser support all 14 official earning columns with zero double-counting and synced firestore.rules', async () => {
  const {
    buildSalarySlipCsvTemplate,
    getSalarySlipEarningBreakdown,
    parseSalaryCsvText,
  } = await import('../src/lib/salarySlipEngine.ts');

  // 1. Official CSV template includes ALL 14 requested earning headers in exact order
  const csvTemplate = buildSalarySlipCsvTemplate(EMPLOYEES, '2026-10');
  const headerLine = csvTemplate.split('\n')[0];
  const required14 = [
    'Basic Salary',
    'Dearness Allowance',
    'HRA',
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
  ];
  let prevIndex = -1;
  for (const col of required14) {
    const idx = headerLine.indexOf(col);
    assert.ok(idx > prevIndex, `Template header must contain "${col}" in exact order`);
    prevIndex = idx;
  }

  // 2. Parse a complete row with all 14 earning columns populated (exact user spellings)
  const fullCsv = [
    'Employee ID,Employee Name,Branch,Department,Designation,Working Days,Paid Days,LOP Days,Basic Salary,Dearness Allowance,HRA,Attendance Allowance,Washing Allowance,Convenience Allowance,Medical Allowance,Leave Travel Allowance,Communication Expanses,Adhoc Allowance,Traveling Allowance,Sales Commotion,Incentive,Overtime,PF,ESIC,PT,TDS,Advance,Other Deductions,Payment Mode',
    '459,Anita Popat Shingade,BARAMATI MIDC,Saree Dept.,Sales Executive,30,30,0,15000,2000,3000,1000,500,800,1250,1500,600,750,900,1100,1600,1000,1800,200,200,0,500,100,NEFT',
  ].join('\n');

  const parsed = parseSalaryCsvText(fullCsv, EMPLOYEES, '2026-10');
  assert.equal(parsed.rows.length, 1);
  const row = parsed.rows[0];
  assert.equal(row.status, 'VALID');
  assert.equal(row.basicPaise, 1500000);
  assert.equal(row.dearnessAllowancePaise, 200000);
  assert.equal(row.hraPaise, 300000);
  assert.equal(row.attendanceAllowancePaise, 100000);
  assert.equal(row.washingAllowancePaise, 50000);
  assert.equal(row.conveyancePaise, 80000);
  assert.equal(row.medicalAllowancePaise, 125000);
  assert.equal(row.leaveTravelAllowancePaise, 150000);
  assert.equal(row.communicationExpensesPaise, 60000);
  assert.equal(row.adhocAllowancePaise, 75000);
  assert.equal(row.travelingAllowancePaise, 90000);
  assert.equal(row.salesCommissionPaise, 110000);
  assert.equal(row.incentivePaise, 160000);
  assert.equal(row.overtimePaise, 100000);
  assert.equal(row.otherEarningsPaise, 0, 'No double-counting into Other Earnings');
  // Sum = 15000+2000+3000+1000+500+800+1250+1500+600+750+900+1100+1600+1000 = 31000.00 -> 3100000 paise
  assert.equal(row.grossEarningsPaise, 3100000);
  // Deductions = 1800+200+200+0+500+100 = 2800.00 -> 280000 paise
  assert.equal(row.totalDeductionsPaise, 280000);
  assert.equal(row.netPayablePaise, 2820000);

  // 3. Alternate standard spellings also parse identically without collision
  const altCsv = [
    'Employee ID,Basic,DA,HRA,Attendance Allowance,Washing Allowance,Conveyance Allowance,Medical Allowance,LTA,Communication Expenses,Adhoc Allowance,Travelling Allowance,Sales Commission,Incentive,Overtime',
    '459,10000,1000,2000,500,250,400,600,700,300,350,450,550,900,1000',
  ].join('\n');
  const altParsed = parseSalaryCsvText(altCsv, EMPLOYEES, '2026-10');
  assert.equal(altParsed.rows[0].status, 'VALID');
  assert.equal(altParsed.rows[0].grossEarningsPaise, 1900000);
  assert.equal(altParsed.rows[0].leaveTravelAllowancePaise, 70000);
  assert.equal(altParsed.rows[0].travelingAllowancePaise, 45000);
  assert.equal(altParsed.rows[0].salesCommissionPaise, 55000);

  // 4. Breakdown helper emits all 14 lines for slip UI & PDF
  const breakdown = getSalarySlipEarningBreakdown(
    {
      basicPaise: row.basicPaise,
      dearnessAllowancePaise: row.dearnessAllowancePaise,
      hraPaise: row.hraPaise,
      attendanceAllowancePaise: row.attendanceAllowancePaise,
      washingAllowancePaise: row.washingAllowancePaise,
      conveyancePaise: row.conveyancePaise,
      medicalAllowancePaise: row.medicalAllowancePaise,
      leaveTravelAllowancePaise: row.leaveTravelAllowancePaise,
      communicationExpensesPaise: row.communicationExpensesPaise,
      adhocAllowancePaise: row.adhocAllowancePaise,
      travelingAllowancePaise: row.travelingAllowancePaise,
      salesCommissionPaise: row.salesCommissionPaise,
      specialAllowancePaise: 0,
      incentivePaise: row.incentivePaise,
      overtimePaise: row.overtimePaise,
      otherEarningsPaise: 0,
    } as import('../src/types/incentive.ts').SalarySlip,
    'en',
  );
  assert.equal(breakdown.length, 14);
  assert.equal(
    breakdown.reduce((sum, [, paise]) => sum + paise, 0),
    3100000,
  );

  // 5. firestore.rules validates all 9 new optional earning fields in isValidSalarySlip
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  const slipFn = rulesText.match(/function isValidSalarySlip\(data\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(slipFn, 'isValidSalarySlip validator must exist in firestore.rules');
  for (const field of [
    'dearnessAllowancePaise',
    'attendanceAllowancePaise',
    'washingAllowancePaise',
    'medicalAllowancePaise',
    'leaveTravelAllowancePaise',
    'communicationExpensesPaise',
    'adhocAllowancePaise',
    'travelingAllowancePaise',
    'salesCommissionPaise',
  ]) {
    assert.ok(slipFn[0].includes(field), `isValidSalarySlip must validate ${field}`);
  }
});

// =========================================================================
// TEST 51: Bulk Employee Master Upload — Zero Silent Overlaps & Clear Error Diagnostics
// =========================================================================
test('51. Bulk Employee Master engine prevents silent Branch/Dept/Designation overlaps and explains every validation & duplicate error clearly', async () => {
  const {
    buildEmployeeImportDiagnosticsCsv,
    buildEmployeeMasterCsvTemplate,
    parseEmployeeMasterCsvText,
  } = await import('../src/lib/employeeBulkImportEngine.ts');

  const template = buildEmployeeMasterCsvTemplate(BRANCHES, EMPLOYEES, 'blank');
  assert.match(template.split('\n')[0], /Employee ID,Sale ID,Login ID,Full Name,Branch,Department,Designation/);

  const seededEmployees: Employee[] = [
    {
      ...EMPLOYEES[0],
      departmentId: 'SAREE',
      departmentName: 'Saree Dept.',
    },
    {
      ...EMPLOYEES[1],
      departmentId: 'LADIES_WEAR',
      departmentName: 'Ladies Wear Dept.',
    },
    {
      ...EMPLOYEES[0],
      employeeId: '777',
      loginId: 'HOM777',
      authEmail: 'hom777@auth.homfash.internal',
      authUid: 'uid-emp-777',
      fullName: 'Mahesh Kadam',
      branchId: 'BEED',
      branchName: 'BEED',
      departmentId: 'MENS_WEAR',
      departmentName: 'Mens Wear Dept.',
    },
  ];

  const csv = [
    'HOUSE OF MUKTAI - EMPLOYEE MASTER UPLOAD SHEET',
    'Employee ID,Login ID,Full Name,Branch,Department,Designation,Status,Date of Birth',
    // Row 3: Brand-new valid employee -> NEW_READY
    'EMP901,HOM901,Snehal Deshmukh,BARAMATI MIDC,Saree Dept.,Sales Executive,ACTIVE,1996-05-14',
    // Row 4: Existing employee 459 with changed Branch + Dept + Designation -> OVERLAP_CONFLICT (NEVER silent overwrite!)
    '459,HOM459,Anita Popat Shingade,BEED,Mens Wear Dept.,Senior Sales Executive,ACTIVE,',
    // Row 5: Existing employee 355 identically matching Master -> UNCHANGED
    '355,HOM355,Asha Abaji Chavan,BARAMATI MOTIBAG,Ladies Wear Dept.,Sales Executive,ACTIVE,',
    // Row 6: Duplicate Employee ID in same file (repeats EMP901 from row 3) -> DUPLICATE_IN_FILE
    'EMP901,HOM999,Duplicate Person,BEED,Kids Wear Dept.,Sales Executive,ACTIVE,',
    // Row 7: Invalid Branch typo ("Baramti MIDC"), invalid Department junk ("12345"), blank Designation, invalid DOB -> ERROR with exact reasons & branch suggestion!
    'EMP902,HOM902,Rohan Patil,Baramti MIDC,12345,,ACTIVE,32-13-1995',
    // Row 8: Login ID collision with existing Master employee 777 (not in CSV) -> ERROR explaining who owns HOM777
    'EMP903,HOM777,Kiran Jadhav,BEED,Non Apparels Dept.,Floor Supervisor,ACTIVE,',
  ].join('\n');

  const summary = parseEmployeeMasterCsvText(csv, BRANCHES, seededEmployees);
  assert.equal(summary.totalRows, 6);
  assert.equal(summary.newReadyCount, 1);
  assert.equal(summary.overlapConflictCount, 1);
  assert.equal(summary.orgOverlapCount, 1);
  assert.equal(summary.unchangedCount, 1);
  assert.equal(summary.duplicateInFileCount, 1);
  assert.equal(summary.errorCount, 2);

  // Verify NEW_READY row
  const newRow = summary.rows.find((r) => r.employeeId === 'EMP901' && r.status === 'NEW_READY');
  assert.ok(newRow);
  assert.equal(newRow.branchId, 'BARAMATI_MIDC');
  assert.equal(newRow.departmentId, 'SAREE');
  assert.equal(newRow.designation, 'Sales Executive');

  // Verify OVERLAP_CONFLICT row captures exact Branch, Department & Designation diffs
  const overlapRow = summary.rows.find((r) => r.status === 'OVERLAP_CONFLICT');
  assert.ok(overlapRow);
  assert.equal(overlapRow.employeeId, '459');
  assert.equal(overlapRow.hasOrgOverlap, true);
  assert.deepEqual(
    overlapRow.diffs.map((d) => d.field),
    ['branch', 'department', 'designation'],
  );
  assert.match(overlapRow.overlapSummary, /Branch: BARAMATI MIDC -> BEED/);
  assert.match(overlapRow.overlapSummary, /Department: Saree Dept\. -> Mens Wear Dept\./);
  assert.match(overlapRow.overlapSummary, /Designation: Sales Executive -> Senior Sales Executive/);

  // Verify DUPLICATE_IN_FILE cites exact first row number (Row 3)
  const dupRow = summary.rows.find((r) => r.status === 'DUPLICATE_IN_FILE');
  assert.ok(dupRow);
  assert.equal(dupRow.duplicateFirstRowNumber, 3);
  assert.match(dupRow.summaryMessage, /Row 3/);

  // Verify ERROR row #7 lists all 4 exact issues + closest Branch suggestion ("BARAMATI MIDC")
  const errRow = summary.rows.find((r) => r.rawEmployeeId === 'EMP902');
  assert.ok(errRow);
  assert.equal(errRow.status, 'ERROR');
  assert.equal(errRow.errorDetails.length, 4);
  const branchErr = errRow.errorDetails.find((e) => e.field === 'Branch');
  assert.ok(branchErr && /Did you mean "BARAMATI MIDC"\?/.test(branchErr.reason));
  const deptErr = errRow.errorDetails.find((e) => e.field === 'Department');
  assert.ok(deptErr && /Saree Dept\./.test(deptErr.reason));
  const desigErr = errRow.errorDetails.find((e) => e.field === 'Designation');
  assert.ok(desigErr && /Designation is blank/i.test(desigErr.reason));
  const dobErr = errRow.errorDetails.find((e) => e.field === 'Date of Birth');
  assert.ok(dobErr && /Invalid Date of Birth/i.test(dobErr.reason));

  // Verify ERROR row #8 explains Login ID collision with Mahesh Kadam (777)
  const loginCollisionRow = summary.rows.find((r) => r.rawEmployeeId === 'EMP903');
  assert.ok(loginCollisionRow);
  assert.equal(loginCollisionRow.status, 'ERROR');
  assert.match(loginCollisionRow.summaryMessage, /already assigned to existing employee/i);
  assert.match(loginCollisionRow.summaryMessage, /777/);

  // Verify Diagnostics CSV exports ONLY the 4 problematic/overlapping rows (not NEW_READY / UNCHANGED)
  const diagCsv = buildEmployeeImportDiagnosticsCsv(summary.rows);
  const diagLines = diagCsv.trim().split('\n');
  assert.equal(diagLines.length, 5, 'Header + 1 overlap + 1 duplicate + 2 error rows = 5 lines');
  assert.match(diagCsv, /OVERLAP \/ CONFLICT/);
  assert.match(diagCsv, /DUPLICATE IN FILE/);
  assert.match(diagCsv, /VALIDATION ERROR/);
});

// =========================================================================
// TEST 52: Universal Employee ID & Non-Sales Departments (Accounts, HR, Billing, Management, Head Office)
// =========================================================================
test('52. Salary Slip & Employee Master use Employee ID and cleanly support Non-Sales Departments without leaderboard pollution', async () => {
  const { resolveCanonicalDepartment } = await import('../src/lib/departmentLeaderboardEngine.ts');
  const { buildSalarySlipCsvTemplate, parseSalaryCsvText } = await import(
    '../src/lib/salarySlipEngine.ts'
  );
  const { parseEmployeeMasterCsvText } = await import('../src/lib/employeeBulkImportEngine.ts');

  // 1. "Management", "Human Resources", "Maintenance" MUST NOT falsely match "Mens Wear Dept."
  assert.equal(resolveCanonicalDepartment('Management'), null);
  assert.equal(resolveCanonicalDepartment('Human Resources'), null);
  assert.equal(resolveCanonicalDepartment('Maintenance'), null);
  assert.equal(resolveCanonicalDepartment('Accounts'), null);
  assert.equal(resolveCanonicalDepartment('Mens Wear')?.id, 'MENS_WEAR');

  // 2. Salary Slip template Column 1 uses "Employee ID" (not "Salesman No")
  const templateCsv = buildSalarySlipCsvTemplate(EMPLOYEES, '2026-11');
  const headerLine = templateCsv.split('\n')[0];
  assert.ok(headerLine.startsWith('"Employee ID"'), `Expected Employee ID header, got: ${headerLine.slice(0, 40)}`);
  assert.equal(headerLine.includes('Salesman No'), false);

  // 3. Bulk Employee Master accepts Non-Sales Departments cleanly & detects Non-Sales overlap changes
  const existingStaff: Employee[] = [
    {
      ...EMPLOYEES[0],
      employeeId: '1131',
      loginId: 'HOM1131',
      fullName: 'Sagar Rajendra Thorat',
      branchId: 'BARAMATI_MIDC',
      branchName: 'BARAMATI MIDC',
      departmentId: '',
      departmentName: 'Accounts',
      designation: 'Senior Accountant',
    },
  ];

  const masterCsv = [
    'Employee ID,Login ID,Full Name,Branch,Department,Designation,Status',
    '1140,HOM1140,Priya Kulkarni,BARAMATI MIDC,HR,HR Executive,ACTIVE',
    '1141,HOM1141,Amit Shinde,BEED,Billing,Cashier,ACTIVE',
    '1142,HOM1142,Suresh Pawar,BARAMATI MOTIBAG,Management,Branch Operations Head,ACTIVE',
    // Existing employee 1131 changing Accounts -> Head Office must trigger OVERLAP_CONFLICT
    '1131,HOM1131,Sagar Rajendra Thorat,BARAMATI MIDC,Head Office,Senior Accountant,ACTIVE',
  ].join('\n');

  const masterParsed = parseEmployeeMasterCsvText(masterCsv, BRANCHES, existingStaff);
  assert.equal(masterParsed.newReadyCount, 3);
  assert.equal(masterParsed.overlapConflictCount, 1);
  assert.equal(masterParsed.errorCount, 0);

  const hrRow = masterParsed.rows.find((r) => r.employeeId === '1140');
  assert.equal(hrRow?.departmentId, '');
  assert.equal(hrRow?.departmentName, 'HR & Admin');

  const billingRow = masterParsed.rows.find((r) => r.employeeId === '1141');
  assert.equal(billingRow?.departmentId, '');
  assert.equal(billingRow?.departmentName, 'Billing & Cash');

  const mgmtRow = masterParsed.rows.find((r) => r.employeeId === '1142');
  assert.equal(mgmtRow?.departmentId, '');
  assert.equal(mgmtRow?.departmentName, 'Management');

  const overlapAccRow = masterParsed.rows.find((r) => r.employeeId === '1131');
  assert.equal(overlapAccRow?.status, 'OVERLAP_CONFLICT');
  assert.match(overlapAccRow?.overlapSummary || '', /Department: Accounts -> Head Office/);

  // 4. Salary Slip parser accepts Non-Sales Departments cleanly (both Employee ID and legacy Salesman No)
  const salaryCsv = [
    'Employee ID,Employee Name,Branch Name,Department,Designation,Pay Month,Total Days,Paid Days,Basic Salary,HRA,PF,PT,Payment Mode',
    '1131,Sagar Rajendra Thorat,BARAMATI MIDC,Accounts,Senior Accountant,2026-11,30,30,60000,15000,1800,200,NEFT',
  ].join('\n');

  const salaryParsed = parseSalaryCsvText(salaryCsv, existingStaff, '2026-11');
  assert.equal(salaryParsed.validRows.length, 1);
  assert.equal(salaryParsed.errorRows.length, 0);
  assert.equal(salaryParsed.validRows[0].resolvedDepartment, null);
  assert.equal(salaryParsed.validRows[0].customDepartmentName, 'Accounts');
  assert.equal(salaryParsed.validRows[0].designation, 'Senior Accountant');
  assert.equal(salaryParsed.validRows[0].grossEarningsPaise, 7_500_000);
});

// =========================================================================
// TEST 53: Main Owner Gmail Exclusivity + Password Admin Governance & Self-Service Password Change
// =========================================================================
test('53. Main Owner Gmail exclusivity, Password Admin role resolution/suspension, firestore.rules gates, and AdminShell Owner isolation', async () => {
  const { isMainOwnerIdentity, resolveRoleConsistent } = await import(
    '../server/authMiddleware.ts'
  );

  // 1. Main Owner check: strictly verified registered Gmail ONLY
  assert.equal(isMainOwnerIdentity({ email: 'uhvishal41@gmail.com', emailVerified: true }), true);
  assert.equal(isMainOwnerIdentity({ email: 'UHVISHAL41@GMAIL.COM', emailVerified: true }), true);
  assert.equal(isMainOwnerIdentity({ email: 'uhvishal41@gmail.com', emailVerified: false }), false);
  assert.equal(isMainOwnerIdentity({ email: 'otherowner@gmail.com', emailVerified: true }), false);
  assert.equal(
    isMainOwnerIdentity({ email: 'homadmin@admin.homfash.internal', emailVerified: false }),
    false,
  );

  // 2. Role resolution for Main Owner, Active Password Admin, Suspended Password Admin, and Spoofed accounts
  assert.equal(
    resolveRoleConsistent({ email: 'uhvishal41@gmail.com', emailVerified: true, adminDoc: null }),
    'SUPER_ADMIN',
  );
  assert.equal(
    resolveRoleConsistent({ email: 'uhvishal41@gmail.com', emailVerified: false, adminDoc: null }),
    'EMPLOYEE',
  );

  // Active Owner-provisioned Password Admin -> SUPER_ADMIN (operational roles)
  assert.equal(
    resolveRoleConsistent({
      email: 'homadmin@admin.homfash.internal',
      emailVerified: false,
      adminDoc: {
        role: 'SUPER_ADMIN',
        authType: 'PASSWORD',
        active: true,
      },
    }),
    'SUPER_ADMIN',
  );

  // Suspended Password Admin -> immediately revoked to EMPLOYEE
  assert.equal(
    resolveRoleConsistent({
      email: 'homadmin@admin.homfash.internal',
      emailVerified: false,
      adminDoc: {
        role: 'SUPER_ADMIN',
        authType: 'PASSWORD',
        active: false,
      },
    }),
    'EMPLOYEE',
  );

  // Spoofed unverified non-admin domain cannot bypass using authType: 'PASSWORD'
  assert.equal(
    resolveRoleConsistent({
      email: 'attacker@gmail.com',
      emailVerified: false,
      adminDoc: {
        role: 'SUPER_ADMIN',
        authType: 'PASSWORD',
        active: true,
      },
    }),
    'EMPLOYEE',
  );

  // 3. Firestore Security Rules strictly lock /admins governance to isMainOwner()
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  const rulesNoComments = rulesText.replace(/\/\/[^\n]*/g, '');
  assert.match(rulesNoComments, /function isMainOwner\(\)/);
  assert.match(rulesNoComments, /function isActivePasswordAdmin\(\)/);
  assert.match(rulesNoComments, /isMainOwner\(\)\s*\|\|\s*isActivePasswordAdmin\(\)/);

  const adminsBlock = rulesNoComments.match(/match \/admins\/\{adminUid\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(adminsBlock, '/admins/{adminUid} rules block must exist');
  assert.match(adminsBlock[0], /allow list: if isMainOwner\(\);/);
  assert.match(adminsBlock[0], /allow create: if isValidId\(adminUid\) && isMainOwner\(\)/);
  assert.match(adminsBlock[0], /allow delete: if isValidId\(adminUid\) && isMainOwner\(\);/);
  assert.match(
    adminsBlock[0],
    /\[\s*'mustChangePassword',\s*'passwordUpdatedAt',\s*'updatedAt'\s*\]/,
  );

  // 4. UI Gate check: AdminShell & OwnerAdminAccessManager strictly gate Owner controls behind isMainOwner
  const shellText = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/admin/AdminShell.tsx'),
    'utf-8',
  );
  assert.ok(shellText.includes("!isMainOwner && activeTab === 'owner-access' ? 'overview'"));
  assert.ok(shellText.includes("{isMainOwner && safeActiveTab === 'owner-access'"));
  assert.ok(shellText.includes('AdminChangePasswordModal'));

  const ownerPanelText = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/admin/OwnerAdminAccessManager.tsx'),
    'utf-8',
  );
  assert.ok(ownerPanelText.includes('if (!isMainOwner)'));
});

// =========================================================================
// TEST 54: Unified Date-Column Incentive Template (Single & Multi-Date Upload, Zero Banner Needed)
// =========================================================================
test('54. Date-column incentive template parses single & multi-date rows directly by Date cell with unique per-date keys', async () => {
  assert.equal(parseExcelDateCellToIso('2026-11-12'), '2026-11-12');
  assert.equal(parseExcelDateCellToIso('15-11-2026'), '2026-11-15');
  assert.equal(parseExcelDateCellToIso('05/11/2026'), '2026-11-05');

  const buf = await buildDateColumnTemplateWorkbook('2026-11-10', [
    {
      dateIso: '2026-11-10',
      branchName: 'BARAMATI MIDC',
      salesPersonName: 'ANITA POPAT SHINGADE',
      salesmanNo: '459',
      saleAmt1: 50000,
      saleQty1: 20,
      component1: 500,
      component2: 100,
      component3: 50,
    },
    {
      dateIso: '11-11-2026', // Same employee on next date in DD-MM-YYYY format -> MUST NOT be flagged as duplicate
      branchName: 'BARAMATI MIDC',
      salesPersonName: 'ANITA POPAT SHINGADE',
      salesmanNo: '459',
      saleAmt1: 60000,
      saleQty1: 25,
      component1: 600,
      component2: 120,
      component3: 80,
    },
  ]);

  const parsed = await parseExcelBuffer(buf, 'date-column-multi.xlsx');
  assert.equal(parsed.headerRowNumber, 1);
  assert.equal(parsed.suggestedMapping.businessDate, 'Date');
  assert.equal(parsed.periodStart, '2026-11-10');
  assert.equal(parsed.periodEnd, '2026-11-11');
  assert.equal(parsed.dateValidationError, null);

  const val = validateImportBatch({
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rawBannerDateText: parsed.reportDateRangeText,
    rawTotalRows: parsed.rawTotalRows,
    skippedBlankRows: parsed.skippedBlankRows,
    skippedSummaryRows: parsed.skippedSummaryRows,
    rows: parsed.rows,
    mapping: parsed.suggestedMapping,
    branches: BRANCHES,
    employees: EMPLOYEES,
    publishedIncentives: [],
  });

  assert.equal(val.canStage, true);
  assert.equal(val.rows.length, 2);
  assert.equal(val.rows[0].validationStatus, 'VALID');
  assert.equal(val.rows[1].validationStatus, 'VALID');
  assert.equal(val.rows[0].businessDate, '2026-11-10');
  assert.equal(val.rows[1].businessDate, '2026-11-11');
  assert.notEqual(val.rows[0].recordKey, val.rows[1].recordKey);
});

// =========================================================================
// TEST 55: Branch Transfer Incentive Consolidation (Previous Branch -> New Current Branch)
// =========================================================================
test('55. Branch transfer consolidation carries forward previous-branch published incentives into new current branch cleanly', () => {
  const emp459 = EMPLOYEES[0]; // Currently BARAMATI_MIDC
  const prevBranchRecords: PublishedIncentive[] = [
    {
      recordId: '2026-11-05_459',
      importType: 'DAILY',
      periodStart: '2026-11-05',
      periodEnd: '2026-11-05',
      businessDate: '2026-11-05',
      monthKey: '2026-11',
      employeeId: '459',
      authUid: emp459.authUid || '',
      employeeName: emp459.fullName,
      branchId: 'BARAMATI_MIDC',
      branchName: 'BARAMATI MIDC',
      component1Label: 'New Items Sale',
      component2Label: 'Old Items Sale',
      component3Label: 'Other Items Sale',
      component1Paise: 50000,
      component2Paise: 10000,
      component3Paise: 5000,
      totalPaise: 65000,
      saleAmt1Paise: 4000000,
      saleQty1: 20,
      saleAmt2Paise: 500000,
      saleQty2: 5,
      saleAmt3Paise: 1000000,
      saleQty3: 8,
      totalSaleAmtPaise: 5500000,
      totalSaleQty: 33,
      status: 'PUBLISHED',
      version: 1,
      batchId: 'BATCH_PREV_1',
      publishedAt: '2026-11-05T10:00:00.000Z',
      publishedByEmail: 'uhvishal41@gmail.com',
    },
    {
      // Superseded record must NEVER be double-counted or migrated
      recordId: '2026-11-04_459',
      importType: 'DAILY',
      periodStart: '2026-11-04',
      periodEnd: '2026-11-04',
      businessDate: '2026-11-04',
      monthKey: '2026-11',
      employeeId: '459',
      authUid: emp459.authUid || '',
      employeeName: emp459.fullName,
      branchId: 'BARAMATI_MIDC',
      branchName: 'BARAMATI MIDC',
      component1Label: 'New Items Sale',
      component2Label: 'Old Items Sale',
      component3Label: 'Other Items Sale',
      component1Paise: 99900,
      component2Paise: 0,
      component3Paise: 0,
      totalPaise: 99900,
      status: 'SUPERSEDED',
      version: 1,
      batchId: 'BATCH_OLD',
      publishedAt: '2026-11-04T10:00:00.000Z',
      publishedByEmail: 'uhvishal41@gmail.com',
    },
  ];

  const plan = planBranchTransferConsolidation({
    employee: emp459,
    newBranchId: 'BEED',
    newBranchName: 'BEED',
    publishedIncentives: prevBranchRecords,
    targetMonthKeys: ['2026-11'],
    now: '2026-11-15T12:00:00.000Z',
  });

  assert.equal(plan.recordsToMigrate.length, 1);
  assert.equal(plan.recordsToMigrate[0].recordId, '2026-11-05_459');
  assert.equal(plan.migratedIncentivePaise, 65000);
  assert.deepEqual(plan.affectedMonthKeys, ['2026-11']);
  assert.equal(plan.updatedMonthlySummaries.length, 1);
  assert.equal(plan.updatedMonthlySummaries[0].branchId, 'BEED');
  assert.equal(plan.updatedMonthlySummaries[0].branchName, 'BEED');
  assert.equal(plan.updatedMonthlySummaries[0].grandTotalPaise, 65000);

  // After adding a new incentive under BEED, employee's BEED total = Previous (65000) + New (45000) = 110000
  const postTransferRecords: PublishedIncentive[] = [
    { ...prevBranchRecords[0], branchId: 'BEED', branchName: 'BEED' },
    {
      ...prevBranchRecords[0],
      recordId: '2026-11-15_459',
      periodStart: '2026-11-15',
      periodEnd: '2026-11-15',
      businessDate: '2026-11-15',
      branchId: 'BEED',
      branchName: 'BEED',
      component1Paise: 30000,
      component2Paise: 10000,
      component3Paise: 5000,
      totalPaise: 45000,
    },
  ];
  const agg = aggregateEmployeeMonth(postTransferRecords, '459', '2026-11');
  assert.equal(agg.grandTotalPaise, 110000);
  assert.equal(agg.publishedDaysCount, 2);
});

// =========================================================================
// TEST 56: Independent Employee Month Visibility for BOTH Incentives & Payment Slips (Admin & Owner)
// =========================================================================
test('56. Independent visibility controls allow different allowed months for Incentives vs Payment Slips and enforce server-side rules', () => {
  const settings = {
    settingId: 'visibility' as const,
    mode: 'SELECTED' as const,
    visibleMonths: ['2026-11'],
    salarySlipMode: 'SELECTED' as const,
    salarySlipVisibleMonths: ['2026-10'],
    updatedByEmail: 'uhvishal41@gmail.com',
    updatedAt: '2026-11-20T10:00:00.000Z',
  };

  // Incentives show ONLY 2026-11
  assert.equal(isMonthVisibleToEmployees('2026-11', settings), true);
  assert.equal(isMonthVisibleToEmployees('2026-10', settings), false);

  // Payment Slips show ONLY 2026-10 (independently of Incentives!)
  assert.equal(isSalarySlipMonthVisibleToEmployees('2026-10', settings), true);
  assert.equal(isSalarySlipMonthVisibleToEmployees('2026-11', settings), false);

  // Legacy settings doc without salarySlipMode falls back cleanly to Incentive mode
  const legacySettings = {
    settingId: 'visibility' as const,
    mode: 'SELECTED' as const,
    visibleMonths: ['2026-10'],
    updatedByEmail: 'uhvishal41@gmail.com',
    updatedAt: '2026-10-20T10:00:00.000Z',
  };
  assert.equal(isSalarySlipMonthVisibleToEmployees('2026-10', legacySettings), true);
  assert.equal(isSalarySlipMonthVisibleToEmployees('2026-09', legacySettings), false);

  // Verify Firestore Security Rules enforce isSalarySlipVisibleDoc on /salary_slips & allow salarySlipMode updates for Admin & Owner
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  const rulesNoComments = rulesText.replace(/\/\/[^\n]*/g, '');
  assert.match(rulesNoComments, /function isSalarySlipVisibilityRestricted\(\)/);
  assert.match(rulesNoComments, /function isSalarySlipVisibleDoc\(data\)/);
  assert.match(rulesNoComments, /'salarySlipMode',\s*'salarySlipVisibleMonths'/);
  const salaryBlock = rulesNoComments.match(/match \/salary_slips\/\{slipId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(salaryBlock, '/salary_slips/{slipId} rules block must exist');
  assert.match(salaryBlock[0], /isSalarySlipVisibleDoc\(existing\(\)\)/);
  assert.match(salaryBlock[0], /isSalarySlipVisibleDoc\(resource\.data\)/);
});

// =========================================================================
// TEST 57: 1-Click Incentive & Active Loan EMI Auto-Sync into Salary Slips & CSV Template
// =========================================================================
test('57. 1-Click Incentive + Loan EMI sync auto-fills CSV template and recalculates exact paise Net Payable', () => {
  const emp = EMPLOYEES[0];
  const pubInc: PublishedIncentive[] = [
    {
      recordId: 'DAILY_2026-11-10_459',
      importType: 'DAILY',
      periodStart: '2026-11-10',
      periodEnd: '2026-11-10',
      businessDate: '2026-11-10',
      monthKey: '2026-11',
      employeeId: emp.employeeId,
      authUid: emp.authUid || 'uid_459',
      employeeName: emp.fullName,
      branchId: emp.branchId,
      branchName: emp.branchName,
      component1Label: 'New',
      component2Label: 'Old',
      component3Label: '0.5%',
      component1Paise: 200000,
      component2Paise: 50000,
      component3Paise: 25000,
      totalPaise: 275000,
      saleAmt1Paise: 5000000,
      saleQty1: 20,
      saleAmt2Paise: 1000000,
      saleQty2: 5,
      saleAmt3Paise: 500000,
      saleQty3: 3,
      totalSaleAmtPaise: 6500000,
      totalSaleQty: 28,
      status: 'PUBLISHED',
      version: 1,
      batchId: 'B1',
      publishedAt: '2026-11-11T00:00:00.000Z',
      publishedByEmail: 'uhvishal41@gmail.com',
    },
  ];
  const adjs: IncentiveAdjustment[] = [
    {
      adjustmentId: 'ADJ1',
      employeeId: emp.employeeId,
      authUid: emp.authUid || 'uid_459',
      employeeName: emp.fullName,
      branchId: emp.branchId,
      branchName: emp.branchName,
      monthKey: '2026-11',
      type: 'BONUS',
      amountPaise: 25000,
      reason: 'Festival Top Performer',
      status: 'ACTIVE',
      createdByEmail: 'uhvishal41@gmail.com',
      createdAt: '2026-11-12T00:00:00.000Z',
    },
  ];
  const loans: EmployeeLoan[] = [
    {
      loanId: 'LOAN_459_1',
      employeeId: emp.employeeId,
      authUid: emp.authUid,
      employeeName: emp.fullName,
      branchId: emp.branchId,
      branchName: emp.branchName,
      loanType: 'SALARY_ADVANCE',
      principalPaise: 600000,
      monthlyEmiPaise: 200000,
      totalInstallments: 3,
      paidInstallments: 1,
      remainingBalancePaise: 400000,
      startMonthKey: '2026-10',
      lastDeductedMonthKey: '2026-10',
      status: 'ACTIVE',
      createdByEmail: 'uhvishal41@gmail.com',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-31T00:00:00.000Z',
    },
  ];

  const incMap = computeMonthlyNetIncentiveByEmployee(pubInc, adjs, '2026-11');
  const loanMap = computeActiveLoanEmiByEmployee(loans, '2026-11');
  assert.equal(incMap[emp.employeeId.toUpperCase()].netPayablePaise, 300000);
  assert.equal(loanMap[emp.employeeId.toUpperCase()].totalDueEmiPaise, 200000);

  const csv = buildSalarySlipCsvTemplate([emp], '2026-11', {
    incentivePaiseByEmp: { [emp.employeeId.toUpperCase()]: 300000 },
    advanceRecoveryPaiseByEmp: { [emp.employeeId.toUpperCase()]: 200000 },
  });
  assert.ok(csv.includes('"3000"'));
  assert.ok(csv.includes('"2000"'));

  const rawCsv = [
    'Employee ID,Pay Month,Total Days,Paid Days,Basic Salary,PF',
    `${emp.employeeId},2026-11,30,30,15000,1800`,
  ].join('\n');
  const parsed = parseSalaryCsvText(rawCsv, [emp], '2026-11');
  assert.equal(parsed.validRows.length, 1);
  assert.equal(parsed.validRows[0].netPayablePaise, 1320000);

  const synced = applyIncentiveAndLoanSyncToSalaryRows(parsed.rows, incMap, loanMap, {
    syncIncentives: true,
    syncLoans: true,
  });
  assert.equal(synced.syncedIncentiveCount, 1);
  assert.equal(synced.syncedLoanCount, 1);
  assert.equal(synced.rows[0].incentivePaise, 300000);
  assert.equal(synced.rows[0].advanceRecoveryPaise, 200000);
  assert.equal(synced.rows[0].grossEarningsPaise, 1800000);
  assert.equal(synced.rows[0].totalDeductionsPaise, 380000);
  assert.equal(synced.rows[0].netPayablePaise, 1420000);
});

// =========================================================================
// TEST 58: Pre-Publish Smart Audit & Anomaly Guard (Incentives & Salary Slips)
// =========================================================================
test('58. Pre-Publish Anomaly Guard flags ±40% variance, zero-sales high incentive, high LOP, and high deductions', () => {
  const emp = EMPLOYEES[0];
  const priorInc: PublishedIncentive[] = [
    {
      recordId: 'MONTHLY_2026-10_459',
      importType: 'MONTHLY',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      businessDate: '2026-10-31',
      monthKey: '2026-10',
      employeeId: emp.employeeId,
      authUid: emp.authUid || 'uid_459',
      employeeName: emp.fullName,
      branchId: emp.branchId,
      branchName: emp.branchName,
      component1Label: 'A',
      component2Label: 'B',
      component3Label: 'C',
      component1Paise: 100000,
      component2Paise: 0,
      component3Paise: 0,
      totalPaise: 100000,
      saleAmt1Paise: 5000000,
      saleQty1: 25,
      saleAmt2Paise: 0,
      saleQty2: 0,
      saleAmt3Paise: 0,
      saleQty3: 0,
      totalSaleAmtPaise: 5000000,
      totalSaleQty: 25,
      status: 'PUBLISHED',
      version: 1,
      batchId: 'B0',
      publishedAt: '2026-10-31T00:00:00.000Z',
      publishedByEmail: 'uhvishal41@gmail.com',
    },
  ];

  const incAnomalies = detectIncentiveImportAnomalies({
    validatedRows: [
      {
        rowNumber: 2,
        importType: 'DAILY',
        periodStart: '2026-11-15',
        periodEnd: '2026-11-15',
        businessDate: '2026-11-15',
        recordKey: `DAILY_2026-11-15_${emp.employeeId}`,
        employeeId: emp.employeeId,
        employeeName: emp.fullName,
        excelEmployeeName: emp.fullName,
        branchId: emp.branchId,
        branchName: emp.branchName,
        branchCodeRaw: emp.branchId,
        isSmplCandidate: false,
        isNewCandidate: false,
        component1Paise: 250000,
        component2Paise: 0,
        component3Paise: 0,
        totalPaise: 250000,
        saleAmt1Paise: 0,
        saleQty1: 0,
        saleAmt2Paise: 0,
        saleQty2: 0,
        saleAmt3Paise: 0,
        saleQty3: 0,
        totalSaleAmtPaise: 0,
        totalSaleQty: 0,
        validationStatus: 'VALID',
        resolution: 'PUBLISH_NEW',
        correctionReason: '',
        overlapConflicts: [],
        conflictingRecordIds: [],
        errorMessage: '',
      },
    ],
    publishedIncentives: priorInc,
  });

  const codes = new Set(incAnomalies.map((a) => a.code));
  assert.ok(codes.has('ZERO_SALES_HIGH_INCENTIVE'));
  assert.ok(codes.has('VARIANCE_SPIKE'));

  const csv = [
    'Employee ID,Pay Month,Total Days,Paid Days,LOP Days,Basic Salary,Advance Recovery',
    `${emp.employeeId},2026-11,30,18,12,10000,5000`,
  ].join('\n');
  const parsed = parseSalaryCsvText(csv, [emp], '2026-11');
  const salAnomalies = detectSalarySlipAnomalies({
    validRows: parsed.validRows,
    existingSlips: [],
  });
  const salCodes = new Set(salAnomalies.map((a) => a.code));
  assert.ok(salCodes.has('HIGH_DEDUCTIONS'));
  assert.ok(salCodes.has('HIGH_LOP_DAYS'));
});

// =========================================================================
// TEST 59: Executive Branch P&L Cost-to-Sales Ratio (Zero Double-Counting of Incentive)
// =========================================================================
test('59. computeBranchPnlAnalytics computes exact Cost-to-Sales % without double-counting salary slip incentive line', () => {
  const emp = EMPLOYEES[0];
  const summaries: MonthlySummary[] = [
    {
      summaryId: `${emp.employeeId}_2026-11`,
      employeeId: emp.employeeId,
      authUid: emp.authUid || 'uid_459',
      employeeName: emp.fullName,
      branchId: emp.branchId,
      branchName: emp.branchName,
      monthKey: '2026-11',
      sourceType: 'DAILY_AGGREGATE',
      component1TotalPaise: 500000,
      component2TotalPaise: 0,
      component3TotalPaise: 0,
      grandTotalPaise: 500000,
      saleAmt1TotalPaise: 25000000,
      saleQty1Total: 100,
      saleAmt2TotalPaise: 0,
      saleQty2Total: 0,
      saleAmt3TotalPaise: 0,
      saleQty3Total: 0,
      totalSaleAmtPaise: 25000000,
      totalSaleQty: 100,
      publishedDaysCount: 15,
      updatedAt: '2026-11-20T00:00:00.000Z',
    },
  ];
  const slips: SalarySlip[] = [
    {
      slipId: `2026-11__${emp.employeeId}`,
      monthKey: '2026-11',
      employeeId: emp.employeeId,
      authUid: emp.authUid || 'uid_459',
      employeeName: emp.fullName,
      branchId: emp.branchId,
      branchName: emp.branchName,
      designation: emp.designation,
      totalDays: 30,
      paidDays: 30,
      lopDays: 0,
      weeklyOffDays: 4,
      paidLeaveDays: 0,
      overtimeHours: 0,
      basicPaise: 2000000,
      hraPaise: 0,
      conveyancePaise: 0,
      specialAllowancePaise: 0,
      overtimePaise: 0,
      incentivePaise: 500000,
      otherEarningsPaise: 0,
      grossEarningsPaise: 2500000,
      pfPaise: 180000,
      esicPaise: 0,
      ptPaise: 20000,
      advanceRecoveryPaise: 0,
      tdsPaise: 0,
      otherDeductionPaise: 0,
      totalDeductionsPaise: 200000,
      netPayablePaise: 2300000,
      employeeVisible: true,
      uploadedByEmail: 'uhvishal41@gmail.com',
      uploadedAt: '2026-11-25T00:00:00.000Z',
      updatedAt: '2026-11-25T00:00:00.000Z',
    },
  ];

  const pnl = computeBranchPnlAnalytics({
    branches: BRANCHES,
    employees: [emp],
    monthlySummaries: summaries,
    salarySlips: slips,
    selectedMonth: '2026-11',
  });

  assert.equal(pnl.companyTotals.totalPayrollCostPaise, 2500000);
  assert.equal(pnl.companyTotals.costToSalesPct, 10);
  assert.equal(pnl.companyTotals.incentiveToSalesPct, 2);
});

// =========================================================================
// TEST 60: Multi-Month Performance Streaks (Star Performer 3M) & Early Coaching Alerts (2M Drop)
// =========================================================================
test('60. computePerformanceStreaksAndRetention identifies 3M Star Performers and 2M consecutive sales drop alerts', () => {
  const starEmp = EMPLOYEES[0];
  const dropEmp = EMPLOYEES[1];

  const mkSummary = (emp: Employee, monthKey: string, salePaise: number): MonthlySummary => ({
    summaryId: `${emp.employeeId}_${monthKey}`,
    employeeId: emp.employeeId,
    authUid: emp.authUid || `uid_${emp.employeeId}`,
    employeeName: emp.fullName,
    branchId: emp.branchId,
    branchName: emp.branchName,
    monthKey,
    sourceType: 'MONTHLY_RECORD',
    component1TotalPaise: 100000,
    component2TotalPaise: 0,
    component3TotalPaise: 0,
    grandTotalPaise: 100000,
    saleAmt1TotalPaise: salePaise,
    saleQty1Total: 10,
    saleAmt2TotalPaise: 0,
    saleQty2Total: 0,
    saleAmt3TotalPaise: 0,
    saleQty3Total: 0,
    totalSaleAmtPaise: salePaise,
    totalSaleQty: 10,
    publishedDaysCount: 1,
    updatedAt: '2026-11-20T00:00:00.000Z',
  });

  const mkTarget = (emp: Employee, monthKey: string, targetPaise: number): SalesTarget => ({
    targetId: `EMP_${emp.employeeId}_${monthKey}`,
    monthKey,
    scope: 'EMPLOYEE',
    branchId: emp.branchId,
    branchName: emp.branchName,
    employeeId: emp.employeeId,
    employeeName: emp.fullName,
    targetSaleAmtPaise: targetPaise,
    targetSaleQty: 10,
    updatedByEmail: 'uhvishal41@gmail.com',
    updatedAt: '2026-11-01T00:00:00.000Z',
  });

  const res = computePerformanceStreaksAndRetention({
    employees: [starEmp, dropEmp],
    monthlySummaries: [
      mkSummary(starEmp, '2026-09', 12000000),
      mkSummary(starEmp, '2026-10', 13000000),
      mkSummary(starEmp, '2026-11', 15000000),
      mkSummary(dropEmp, '2026-09', 10000000),
      mkSummary(dropEmp, '2026-10', 8000000),
      mkSummary(dropEmp, '2026-11', 6000000),
    ],
    salesTargets: [
      mkTarget(starEmp, '2026-09', 10000000),
      mkTarget(starEmp, '2026-10', 11000000),
      mkTarget(starEmp, '2026-11', 12000000),
    ],
  });

  assert.equal(res.starPerformers.length, 1);
  assert.equal(res.starPerformers[0].employeeId, starEmp.employeeId);
  assert.equal(res.starPerformers[0].consecutiveTargetMetMonths, 3);

  assert.equal(res.coachingAlerts.length, 1);
  assert.equal(res.coachingAlerts[0].employeeId, dropEmp.employeeId);
  assert.equal(res.coachingAlerts[0].consecutiveDeclineMonths, 2);
});

// =========================================================================
// TEST 61: WhatsApp Dispatch Deep Link & Phone Normalization
// =========================================================================
test('61. WhatsApp dispatch builds valid Indian wa.me link with Marathi/English payslip message', () => {
  const msg = buildWhatsAppSlipMessage({
    employeeName: 'ANITA POPAT SHINGADE',
    monthKey: '2026-11',
    netPayablePaise: 1850000,
    branchName: 'BARAMATI MIDC',
    portalUrl: 'https://staff.houseofmuktai.co.in',
  });
  assert.ok(msg.includes('ANITA POPAT SHINGADE'));
  assert.ok(msg.includes('Nov 2026'));
  assert.ok(msg.includes('https://staff.houseofmuktai.co.in'));

  const link = buildWhatsAppDeepLink('98765 43210', msg);
  assert.ok(link.startsWith('https://wa.me/919876543210?text='));
  const fallbackLink = buildWhatsAppDeepLink('', msg);
  assert.ok(fallbackLink.startsWith('https://wa.me/?text='));
});

// =========================================================================
// TEST 62: Firestore Security Rules Enforce Branch Manager Own-Branch Isolation & Employee Loans Privacy
// =========================================================================
test('62. Firestore rules enforce Branch Manager own-branch read-only floor view (zero peer salary access) and employee_loans privacy', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  assert.ok(rulesText.length > 0, 'firestore.rules must exist and be non-empty');

  const rulesNoComments = rulesText.replace(/\/\/[^\n]*/g, '');
  assert.match(rulesNoComments, /function isActiveBranchManager\(\)/);
  assert.match(rulesNoComments, /function activeBranchManagerBranchId\(\)/);
  assert.match(rulesNoComments, /function isValidEmployeeLoan\(data\)/);

  const salaryBlock = rulesNoComments.match(/match \/salary_slips\/\{slipId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(salaryBlock);
  assert.equal(
    salaryBlock[0].includes('isActiveBranchManager'),
    false,
    'Branch Manager must NEVER be allowed to read peer salary slips',
  );

  const loansBlock = rulesNoComments.match(/match \/employee_loans\/\{loanId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(loansBlock, '/employee_loans/{loanId} rules block must exist');
  assert.match(loansBlock[0], /isValidEmployeeLoan\(incoming\(\)\)/);
  assert.match(loansBlock[0], /activeEmployeeId\(\)/);
});

// =========================================================================
// TEST 63: Dual-ID Architecture (Official EMP ID + Optional Unique SELL ID)
// =========================================================================
test('63. Dual-ID supports Sales (EMP ID + unique SELL ID) and Non-Sales (blank SELL ID), blocks duplicate SELL ID, and auto-maps POS SELL ID -> Master EMP ID during Incentive Import', async () => {
  const { parseEmployeeMasterCsvText } = await import('../src/lib/employeeBulkImportEngine.ts');

  // 1. Employee Master Bulk Import: Sales staff with SELL ID + Non-Sales staff with blank SELL ID + duplicate SELL ID check
  const masterCsv = [
    'EMP ID,SELL ID,Login ID,Full Name,Branch,Department,Designation,Gender,Category,Status',
    'EMP001,101,HOM001,Snehal Deshmukh,BARAMATI MIDC,Saree Dept.,Sales Executive,Female,Sales,ACTIVE',
    'EMP002,,HOM002,Pratiksha Kulkarni,BEED,Accounts,Accountant,Female,Non-Sales,ACTIVE',
    'EMP003,101,HOM003,Duplicate Seller,BEED,Saree Dept.,Sales Executive,Female,Sales,ACTIVE',
  ].join('\n');

  const masterSummary = parseEmployeeMasterCsvText(masterCsv, BRANCHES, []);
  assert.equal(masterSummary.newReadyCount, 2, 'Sales + Non-Sales rows should both be NEW_READY');
  assert.equal(masterSummary.duplicateInFileCount, 1, 'Duplicate SELL ID 101 must be flagged');
  const emp1Row = masterSummary.rows.find((r) => r.employeeId === 'EMP001');
  const emp2Row = masterSummary.rows.find((r) => r.employeeId === 'EMP002');
  assert.equal(emp1Row?.saleId, '101');
  assert.equal(emp1Row?.gender, 'Female');
  assert.equal(emp1Row?.category, 'Sales');
  assert.equal(emp2Row?.saleId, '');
  assert.equal(emp2Row?.category, 'Non-Sales');

  // 2. Incentive Upload: POS SELL ID column ("SELL ID") resolves to canonical Master EMP ID
  // Even if another Non-Sales employee has EMP ID = "101", a "SELL ID" column MUST prefer saleId lookup!
  const dualEmployees: Employee[] = [
    {
      ...EMPLOYEES[0],
      employeeId: 'EMP001',
      saleId: '101',
      loginId: 'HOM001',
      fullName: 'Snehal Deshmukh',
      branchId: 'BARAMATI_MIDC',
      branchName: 'BARAMATI MIDC',
      status: 'ACTIVE',
    },
    {
      ...EMPLOYEES[1],
      employeeId: '101',
      saleId: '',
      loginId: 'HOM_ACC101',
      fullName: 'Accountant Same Number',
      branchId: 'BEED',
      branchName: 'BEED',
      status: 'ACTIVE',
    },
  ];

  const val = validateImportBatch({
    periodStart: null,
    periodEnd: null,
    rawBannerDateText: '',
    rawTotalRows: 1,
    skippedBlankRows: 0,
    skippedSummaryRows: 0,
    rows: [
      {
        rowNumber: 2,
        raw: {
          Date: '2026-10-15',
          NAME: 'BARAMATI MIDC',
          'SELL ID': '101',
          'EMPLOYEE NAME': 'Snehal Deshmukh',
          'New Items Sale Amt': 50000,
          'New Items Sale Qty': 12,
          'New Items Sale Incentive': 1250,
          'Old Items Sale Incentive': 0,
          'Other Items Sale Incentive': 0,
        },
      },
    ],
    mapping: {
      businessDate: 'Date',
      branchCode: 'NAME',
      employeeId: 'SELL ID',
      employeeName: 'EMPLOYEE NAME',
      saleAmt1: 'New Items Sale Amt',
      saleQty1: 'New Items Sale Qty',
      component1: 'New Items Sale Incentive',
      component2: 'Old Items Sale Incentive',
      component3: 'Other Items Sale Incentive',
    },
    branches: BRANCHES,
    employees: dualEmployees,
    publishedIncentives: [],
    overrides: {},
  });

  assert.equal(val.metrics.validEmployeeRows, 1, 'POS SELL ID row should validate cleanly');
  assert.equal(
    val.rows[0].employeeId,
    'EMP001',
    'SELL ID "101" must canonically map to Master EMP ID "EMP001" rather than Non-Sales EMP ID "101"',
  );
  assert.equal(val.rows[0].employeeName, 'Snehal Deshmukh');
  assert.equal(val.rows[0].totalPaise, 125_000);
});

// =========================================================================
// TEST 64: Exact 45-Column House of Muktai Salary Excel Parser & Formula Cross-Check
// =========================================================================
test('64. Salary Slip parser handles all 45 exact House of Muktai headers, attendance formula, zero SALARY/Monthly Gross double-counting, and cross-check warnings', async () => {
  const {
    parseSalaryCsvText,
    getSalarySlipEarningBreakdown,
    getSalarySlipDeductionBreakdown,
  } = await import('../src/lib/salarySlipEngine.ts');

  const dualEmployees: Employee[] = [
    {
      ...EMPLOYEES[0],
      employeeId: 'EMP001',
      saleId: '101',
      loginId: 'HOM001',
      fullName: 'Snehal Deshmukh',
      branchId: 'BARAMATI_MIDC',
      branchName: 'BARAMATI MIDC',
      departmentId: 'SAREE',
      departmentName: 'Saree Dept.',
      designation: 'Sales Executive',
      status: 'ACTIVE',
    },
    {
      ...EMPLOYEES[1],
      employeeId: 'EMP002',
      saleId: '',
      loginId: 'HOM002',
      fullName: 'Pratiksha Kulkarni',
      branchId: 'BEED',
      branchName: 'BEED',
      departmentId: '',
      departmentName: 'Accounts',
      designation: 'Accountant',
      status: 'ACTIVE',
    },
  ];

  // Exact 45 headers provided by the user (preserving exact spellings & trailing space on "TDS ")
  const headers45 = [
    'Sr No', 'EMP ID', 'SELL ID', 'EMPLOYEE NAME', 'DEPARTMENT', 'BRANCH',
    'GENDER', 'CATEGORY', 'SALARY', 'MONTHS DAY', 'PRESENT DAYS', 'W/O',
    'TOTAL DAYS', 'OT DAYS', 'Monthly Gross', 'BASIC', 'DA', 'HRA',
    'ATTENDANCE ALLOW', 'WASHING ALLOW', 'CONVEYANCE ALLOW', 'MEDICAL ALLOW',
    'LTA ALLOW', 'COMM. EXPENSE', 'HEALTH CLUB ALLOW', 'ADVOCH ALLOW',
    'TRAVALLING ALLOWANCE', 'SALES COMMISION', 'INSENTIVE', 'OT', 'ARREARS',
    'EARN GROSS', 'PROVIDENT FUND', 'ESIC', 'PROFETIONAL TAX', 'LWF',
    'Advance', 'TDS ', 'Penalty', 'Insurance', 'Total Deduction', 'NET PAY',
    'BANK ACCOUNT NO', 'IFSC CODE',
  ];

  // Row 1: Exact matching math (Earnings sum = 25,000, Deductions sum = 2,500, Net = 22,500)
  // SALARY (30,000) & Monthly Gross (28,000) MUST NOT be summed into Gross!
  const row1 = [
    '1', 'EMP001', '101', 'Snehal Deshmukh', 'Saree Dept.', 'BARAMATI MIDC',
    'Female', 'Sales', '30000', '31', '24', '4',
    '28', '2', '28000', '10000', '1000', '2000',
    '500', '300', '700', '500',
    '500', '500', '500', '500',
    '500', '1500', '3000', '1000', '2000',
    '25000', '1200', '200', '200', '25',
    '500', '100', '75', '200', '2500', '22500',
    '123456789012', 'SBIN0001234',
  ];

  // Row 2: Non-Sales (blank SELL ID) with intentional Excel NET PAY mismatch to verify cross-check warning
  const row2 = [
    '2', 'EMP002', '', 'Pratiksha Kulkarni', 'Accounts', 'BEED',
    'Female', 'Non-Sales', '20000', '31', '27', '4',
    '31', '0', '20000', '15000', '0', '5000',
    '0', '0', '0', '0',
    '0', '0', '0', '0',
    '0', '0', '0', '0', '0',
    '20000', '1800', '0', '200', '0',
    '0', '0', '0', '0', '2000', '19999', // Mismatch: true net is 18,000
    '987654321098', 'HDFC0000456',
  ];

  const csv = [headers45.join(','), row1.join(','), row2.join(',')].join('\n');
  const res = parseSalaryCsvText(csv, dualEmployees, '2026-10');

  assert.equal(res.errorRows.length, 0, 'Both 45-column rows must parse with zero errors');
  assert.equal(res.validRows.length, 2);

  const r1 = res.validRows[0];
  assert.equal(r1.employeeId, 'EMP001');
  assert.equal(r1.saleId, '101');
  assert.equal(r1.gender, 'Female');
  assert.equal(r1.category, 'Sales');
  // Attendance confirmation: MONTHS DAY=31, PRESENT=24, W/O=4, TOTAL DAYS (Paid)=28 -> LOP=3, OT DAYS=2
  assert.equal(r1.totalDays, 31);
  assert.equal(r1.presentDays, 24);
  assert.equal(r1.weeklyOffDays, 4);
  assert.equal(r1.paidDays, 28);
  assert.equal(r1.lopDays, 3);
  assert.equal(r1.overtimeDays, 2);
  // Reference-only salary fields captured but NOT double-counted
  assert.equal(r1.monthlySalaryRatePaise, 3_000_000);
  assert.equal(r1.monthlyGrossRatePaise, 2_800_000);
  // Exact computed earnings, deductions, net
  assert.equal(r1.healthClubAllowancePaise, 50_000);
  assert.equal(r1.arrearsPaise, 200_000);
  assert.equal(r1.grossEarningsPaise, 2_500_000, 'Gross must equal sum of 18 earning heads (₹25,000), never including SALARY/Monthly Gross');
  assert.equal(r1.lwfPaise, 2_500);
  assert.equal(r1.penaltyPaise, 7_500);
  assert.equal(r1.insurancePaise, 20_000);
  assert.equal(r1.totalDeductionsPaise, 250_000);
  assert.equal(r1.netPayablePaise, 2_250_000);
  assert.equal(r1.bankAccountMasked, 'XXXX9012');
  assert.equal(r1.bankIfsc, 'SBIN0001234');
  assert.equal(r1.sheetCrossCheckWarning, '', 'Exact matching row must produce zero cross-check warnings');

  // Breakdown helpers include all new heads
  const r1Slip = r1 as unknown as import('../src/types/incentive.ts').SalarySlip;
  const earnBreakdown = getSalarySlipEarningBreakdown(r1Slip, 'en');
  assert.ok(earnBreakdown.some(([label]) => label.includes('Health Club')));
  assert.ok(earnBreakdown.some(([label]) => label.includes('Arrears')));
  const dedBreakdown = getSalarySlipDeductionBreakdown(r1Slip, 'en');
  assert.ok(dedBreakdown.some(([label]) => label.includes('LWF')));
  assert.ok(dedBreakdown.some(([label]) => label.includes('Penalty')));
  assert.ok(dedBreakdown.some(([label]) => label.includes('Insurance')));

  // Row 2 cross-check warning caught
  const r2 = res.validRows[1];
  assert.equal(r2.employeeId, 'EMP002');
  assert.equal(r2.saleId, '');
  assert.equal(r2.netPayablePaise, 1_800_000);
  assert.match(r2.sheetCrossCheckWarning, /NET PAY/i, 'Sheet NET PAY mismatch (> ₹1) must surface warning');
});

// =========================================================================
// TEST 65: Firestore Rules Invariants for Dual-ID, 45-Column SalarySlip Arithmetic & Main Owner Clean Reset
// =========================================================================
test('65. Firestore rules whitelist Dual-ID fields, enforce 45-column SalarySlip arithmetic, gate Clean Reset deletes to Main Owner, and keep audit_logs strictly immutable', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  assert.ok(rulesText.length > 0, 'firestore.rules must exist and be non-empty');

  const rulesNoComments = rulesText.replace(/\/\/[^\n]*/g, '');

  // 1. Employee Dual-ID fields whitelisted
  assert.match(rulesNoComments, /isOptionalString\(data,\s*'saleId',\s*40\)/);
  assert.match(rulesNoComments, /isOptionalString\(data,\s*'gender',\s*20\)/);
  assert.match(rulesNoComments, /isOptionalString\(data,\s*'category',\s*40\)/);

  // 2. SalarySlip split earnings/deductions validators with all new heads
  assert.match(rulesNoComments, /function isValidSalarySlipEarnings\(data\)/);
  assert.match(rulesNoComments, /function isValidSalarySlipDeductions\(data\)/);
  assert.match(rulesNoComments, /'healthClubAllowancePaise'/);
  assert.match(rulesNoComments, /'arrearsPaise'/);
  assert.match(rulesNoComments, /'lwfPaise'/);
  assert.match(rulesNoComments, /'penaltyPaise'/);
  assert.match(rulesNoComments, /'insurancePaise'/);

  // 3. Main Owner-only delete gate for Clean Reset while audit_logs remains strictly non-deletable
  const empBlock = rulesNoComments.match(/match \/employees\/\{employeeId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(empBlock);
  assert.match(empBlock[0], /allow delete: if isValidId\(employeeId\) && isMainOwner\(\);/);

  const auditBlock = rulesNoComments.match(/match \/audit_logs\/\{logId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(auditBlock);
  assert.match(auditBlock[0], /allow update, delete: if false;/);
});

// =========================================================================
// TEST 66: Dynamic Custom Columns in Employee Master (Bulk Import, Overlap Diff, Export & Firestore Rules)
// =========================================================================
test('66. Employee Master supports arbitrary user-defined custom columns in Bulk Import, Zero-Silent-Overlap diffing, CSV export, and Firestore rules', async () => {
  const {
    buildEmployeeMasterCsvTemplate,
    parseEmployeeMasterCsvText,
  } = await import('../src/lib/employeeBulkImportEngine.ts');

  const existingEmployees: Employee[] = [
    {
      ...EMPLOYEES[0],
      employeeId: 'EMP001',
      saleId: '101',
      loginId: 'HOM001',
      fullName: 'Snehal Deshmukh',
      branchId: 'BARAMATI_MIDC',
      branchName: 'BARAMATI MIDC',
      departmentId: 'SAREE',
      departmentName: 'Saree Dept.',
      designation: 'Sales Executive',
      status: 'ACTIVE',
      address: 'Baramati, Pune',
      emergencyContact: '9876500001',
      customFields: {
        'Locker No': 'L-101',
        'Bus Route': 'Route-A',
      },
    },
  ];

  // 1. Export pre-filled template with extra custom columns
  const exportedCsv = buildEmployeeMasterCsvTemplate(
    BRANCHES,
    existingEmployees,
    'prefilled',
    ['Badge Color'],
  );
  assert.ok(exportedCsv.includes('Locker No'), 'Exported CSV header must include existing custom column Locker No');
  assert.ok(exportedCsv.includes('Bus Route'), 'Exported CSV header must include existing custom column Bus Route');
  assert.ok(exportedCsv.includes('Badge Color'), 'Exported CSV header must include requested custom column Badge Color');
  assert.ok(exportedCsv.includes('L-101'), 'Exported CSV row must contain employee custom column value');

  // 2. Parse CSV with extra custom columns:
  // - Row 1 (EMP001): modifies Bus Route from Route-A -> Route-B and adds Badge Color = Gold -> triggers OVERLAP_CONFLICT
  // - Row 2 (EMP999): new employee with arbitrary custom columns Locker No, Bus Route, Badge Color -> NEW_READY
  const importCsv = [
    'Employee ID,Sale ID,Login ID,Full Name,Branch,Department,Designation,Gender,Category,Status,Address,Emergency Contact,Locker No,Bus Route,Badge Color',
    'EMP001,101,HOM001,Snehal Deshmukh,BARAMATI MIDC,Saree Dept.,Sales Executive,Female,Sales,ACTIVE,Baramati,9876500001,L-101,Route-B,Gold',
    'EMP999,,HOM999,Rohan Patil,BEED,Accounts,Accountant,Male,Non-Sales,ACTIVE,Beed City,9823000099,L-999,Route-C,Silver',
  ].join('\n');

  const parsed = parseEmployeeMasterCsvText(importCsv, BRANCHES, existingEmployees);
  assert.equal(parsed.errorCount, 0);
  assert.equal(parsed.newReadyCount, 1);
  assert.equal(parsed.overlapConflictCount, 1);

  const conflictRow = parsed.rows.find((r) => r.employeeId === 'EMP001');
  assert.ok(conflictRow);
  assert.equal(conflictRow.status, 'OVERLAP_CONFLICT');
  assert.equal(conflictRow.customFields['Bus Route'], 'Route-B');
  assert.equal(conflictRow.customFields['Badge Color'], 'Gold');
  assert.ok(
    conflictRow.diffs.some((d) => d.label === 'Bus Route' && d.masterValue === 'Route-A' && d.fileValue === 'Route-B'),
    'Diff engine must detect change in custom column Bus Route',
  );
  assert.ok(
    conflictRow.diffs.some((d) => d.label === 'Badge Color' && d.fileValue === 'Gold'),
    'Diff engine must detect newly populated custom column Badge Color',
  );

  const newRow = parsed.rows.find((r) => r.employeeId === 'EMP999');
  assert.ok(newRow);
  assert.equal(newRow.status, 'NEW_READY');
  assert.equal(newRow.address, 'Beed City');
  assert.equal(newRow.emergencyContact, '9823000099');
  assert.equal(newRow.customFields['Locker No'], 'L-999');
  assert.equal(newRow.customFields['Bus Route'], 'Route-C');
  assert.equal(newRow.customFields['Badge Color'], 'Silver');

  // 3. Verify Firestore rules allow customFields map (up to 25 custom columns) on employees
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  assert.match(rulesText, /'customFields'/);
  assert.match(rulesText, /data\.customFields is map && data\.customFields\.size\(\) <= 25/);
});

// =========================================================================
// TEST 67: Bug #1 & Bug #2 Regression Guard — Login Provisioning Zero Data Loss & Pillar 7 Branch Manager Preservation
// =========================================================================
test('67. Login activation preserves saleId/gender/category/isBranchManager/customFields (Bug #1) and all 5 services preserve Branch Manager metadata in active_auth_uids (Bug #2)', async () => {
  const {
    buildActiveAuthUidRecord,
    buildCleanProvisionedEmployeeDoc,
    sanitizeEmployeeCustomFields,
  } = await import('../src/lib/employeeRecordHelpers.ts');

  const pendingBranchManager: Employee = {
    employeeId: 'EMP501',
    saleId: '777',
    loginId: 'HOM501',
    authEmail: 'hom501@staff.houseofmuktai.co.in',
    authUid: '',
    fullName: 'Suresh Jadhav',
    branchId: 'BARAMATI_MIDC',
    branchName: 'BARAMATI MIDC',
    departmentId: 'SAREE',
    departmentName: 'Saree Dept.',
    designation: 'Branch Floor Manager',
    gender: 'Male',
    category: 'Sales',
    dateOfBirth: '1991-08-15',
    dateOfJoining: '2022-04-01',
    phone: '9876543210',
    address: 'Baramati MIDC Road, Pune',
    emergencyContact: '9876500099',
    customFields: {
      'Aadhar No': '5555-6666-7777',
      'Blood Group': 'B+',
      'Weekly Off Day': 'Monday',
    },
    role: 'EMPLOYEE',
    isBranchManager: true,
    status: 'ACTIVE',
    mustChangePassword: true,
    credentialsProvisioned: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  };

  // 1. Bug #1 Guard: Activating pending login MUST preserve ALL fields (never drop saleId, gender, category, isBranchManager, customFields)
  const provisioned = buildCleanProvisionedEmployeeDoc(
    pendingBranchManager,
    'uid_suresh_501',
    '2026-11-25T10:00:00.000Z',
    (id) => `${id.toLowerCase()}@staff.houseofmuktai.co.in`,
  );
  assert.equal(provisioned.authUid, 'uid_suresh_501');
  assert.equal(provisioned.credentialsProvisioned, true);
  assert.equal(provisioned.saleId, '777', 'saleId MUST be preserved on login activation');
  assert.equal(provisioned.gender, 'Male', 'gender MUST be preserved on login activation');
  assert.equal(provisioned.category, 'Sales', 'category MUST be preserved on login activation');
  assert.equal(provisioned.isBranchManager, true, 'isBranchManager MUST be preserved on login activation');
  assert.equal(provisioned.address, 'Baramati MIDC Road, Pune');
  assert.equal(provisioned.emergencyContact, '9876500099');
  assert.deepEqual(provisioned.customFields, {
    'Aadhar No': '5555-6666-7777',
    'Blood Group': 'B+',
    'Weekly Off Day': 'Monday',
  });

  // Cap customFields cleanly at <= 25 keys and strip blank entries
  const oversizedCustom: Record<string, string> = { BlankCol: '   ' };
  for (let i = 1; i <= 30; i += 1) {
    oversizedCustom[`Col_${i}`] = `Val_${i}`;
  }
  const sanitizedCustom = sanitizeEmployeeCustomFields(oversizedCustom);
  assert.equal(Object.keys(sanitizedCustom).length, 25);
  assert.equal(sanitizedCustom.BlankCol, undefined);

  // 2. Bug #2 Guard: buildActiveAuthUidRecord ALWAYS includes branchId, branchName, isBranchManager, departmentId
  const activeMgr = buildActiveAuthUidRecord({
    authUid: 'uid_suresh_501',
    employeeId: provisioned.employeeId,
    departmentId: provisioned.departmentId,
    branchId: provisioned.branchId,
    branchName: provisioned.branchName,
    isBranchManager: provisioned.isBranchManager,
    updatedAt: '2026-11-25T10:00:00.000Z',
  });
  assert.deepEqual(activeMgr, {
    authUid: 'uid_suresh_501',
    employeeId: 'EMP501',
    departmentId: 'SAREE',
    branchId: 'BARAMATI_MIDC',
    branchName: 'BARAMATI MIDC',
    isBranchManager: true,
    active: true,
    updatedAt: '2026-11-25T10:00:00.000Z',
  });

  // Non-sales staff (blank/invalid departmentId) gets departmentId: '' while keeping branchId & isBranchManager: false
  const activeNonSales = buildActiveAuthUidRecord({
    authUid: 'uid_acc_902',
    employeeId: 'EMP902',
    departmentId: 'ACCOUNTS',
    branchId: 'BEED',
    branchName: 'BEED',
    isBranchManager: false,
    updatedAt: '2026-11-25T10:00:00.000Z',
  });
  assert.equal(activeNonSales.departmentId, '');
  assert.equal(activeNonSales.branchId, 'BEED');
  assert.equal(activeNonSales.branchName, 'BEED');
  assert.equal(activeNonSales.isBranchManager, false);

  // 3. Source-code regression guard: ALL 5 services must import and use buildActiveAuthUidRecord
  const serviceFiles = [
    'src/services/incentiveService.ts',
    'src/services/employeeBulkImportService.ts',
    'src/services/salarySlipService.ts',
    'src/services/birthdayService.ts',
    'src/services/departmentVisibilityService.ts',
  ];
  for (const relPath of serviceFiles) {
    const content = fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf-8');
    assert.ok(
      content.includes('buildActiveAuthUidRecord'),
      `${relPath} MUST use shared buildActiveAuthUidRecord helper so Branch Manager access is never wiped`,
    );
  }
});

// =========================================================================
// TEST 68: Bug #3, #4 & #5 Regression Guard — Cloud Column Rules, Lightweight Vite Pre-Bundling & Bulk CLEAR Token
// =========================================================================
test('68. Firestore enforces Admin-only employee_columns sync (Bug #3), Vite avoids eager exceljs/pptxgenjs pre-bundling (Bug #4), and Bulk CSV supports CLEAR sentinel (Bug #5)', async () => {
  const { parseEmployeeMasterCsvText } = await import('../src/lib/employeeBulkImportEngine.ts');

  // 1. Bug #5 Guard: Blank cell keeps existing custom column value, while CLEAR / [CLEAR] explicitly clears it
  const existingEmployees: Employee[] = [
    {
      ...EMPLOYEES[0],
      employeeId: 'EMP001',
      saleId: '101',
      loginId: 'HOM001',
      fullName: 'Snehal Deshmukh',
      branchId: 'BARAMATI_MIDC',
      branchName: 'BARAMATI MIDC',
      departmentId: 'SAREE',
      departmentName: 'Saree Dept.',
      designation: 'Sales Executive',
      status: 'ACTIVE',
      customFields: {
        'Aadhar No': '1234-5678-9012',
        'Blood Group': 'O+',
      },
    },
  ];

  const clearCsv = [
    'Employee ID,Sale ID,Login ID,Full Name,Branch,Department,Designation,Status,Aadhar No,Blood Group',
    'EMP001,101,HOM001,Snehal Deshmukh,BARAMATI MIDC,Saree Dept.,Sales Executive,ACTIVE,,CLEAR',
  ].join('\n');

  const parsed = parseEmployeeMasterCsvText(clearCsv, BRANCHES, existingEmployees);
  assert.equal(parsed.errorCount, 0);
  assert.equal(parsed.overlapConflictCount, 1);
  const row = parsed.rows[0];
  assert.equal(row.customFields['Aadhar No'], '1234-5678-9012', 'Blank cell must preserve existing custom value safely');
  assert.equal(row.customFields['Blood Group'], undefined, 'CLEAR token must remove existing custom value');
  assert.ok(
    row.diffs.some((d) => d.label === 'Blood Group' && d.masterValue === 'O+' && d.fileValue === '(Cleared)'),
    'Diff engine must explicitly show cleared custom column change',
  );

  // 2. Bug #3 Guard: firestore.rules protects portal_settings/employee_columns as strictly Admin-only with bounded lists
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  assert.match(rulesText, /function isValidEmployeeColumnSettings\(data\)/);
  assert.match(rulesText, /settingId == 'employee_columns' && isSuperAdmin\(\)/);
  assert.match(rulesText, /data\.customColumns\.size\(\) <= 25/);
  assert.match(rulesText, /data\.visibleColumns\.size\(\) <= 75/);

  // 3. Bug #4 Guard: vite.config.ts must not eagerly pre-bundle heavy on-demand exceljs or pptxgenjs
  const viteConfigText = fs.readFileSync(path.resolve(process.cwd(), 'vite.config.ts'), 'utf-8');
  const optimizeBlock = viteConfigText.match(/optimizeDeps:\s*\{[\s\S]*?\n    \},/);
  assert.ok(optimizeBlock, 'vite.config.ts should have optimizeDeps block');
  assert.doesNotMatch(optimizeBlock[0], /'exceljs'/, 'exceljs must stay lazy-loaded, not eagerly pre-bundled');
  assert.doesNotMatch(optimizeBlock[0], /'pptxgenjs'/, 'pptxgenjs must not be eagerly pre-bundled in client Vite config');
});

// =========================================================================
// TEST 69: Sale-ID-Only Incentive Upload & Name-Verified Sale ID Auto-Linking
// =========================================================================
test('69. Incentive upload supports blank EMP ID with Sales ID only, auto-links unlinked Master employees by unique Name match, and refuses ambiguous/duplicate collisions', () => {
  const testEmployees: Employee[] = [
    // Already linked with saleId '459'
    {
      ...EMPLOYEES[0],
      employeeId: 'EMP459',
      saleId: '459',
      fullName: 'Ramesh Patil',
      branchId: 'BEED',
      branchName: 'BEED',
      status: 'ACTIVE',
    },
    // Unlinked Master employee (EMP ID only, blank saleId) — exact Name + Branch match
    {
      ...EMPLOYEES[0],
      employeeId: 'EMP707',
      saleId: '',
      fullName: 'Pratiksha Kulkarni',
      branchId: 'BEED',
      branchName: 'BEED',
      status: 'ACTIVE',
    },
    // Unlinked Master employee — word-order reversed in Excel within same branch
    {
      ...EMPLOYEES[0],
      employeeId: 'EMP708',
      saleId: '',
      fullName: 'Sagar Deshmukh',
      branchId: 'BARAMATI_MIDC',
      branchName: 'BARAMATI MIDC',
      status: 'ACTIVE',
    },
    // Ambiguous duplicate-name pair in the SAME branch (both unlinked) — MUST NOT auto-link
    {
      ...EMPLOYEES[0],
      employeeId: 'EMP801',
      saleId: '',
      fullName: 'Amit Joshi',
      branchId: 'BEED',
      branchName: 'BEED',
      status: 'ACTIVE',
    },
    {
      ...EMPLOYEES[0],
      employeeId: 'EMP802',
      saleId: '',
      fullName: 'Amit Joshi',
      branchId: 'BEED',
      branchName: 'BEED',
      status: 'ACTIVE',
    },
    // Unlinked Master employee whose Excel row tries to reuse already-owned saleId '459' — MUST NOT link
    {
      ...EMPLOYEES[0],
      employeeId: 'EMP901',
      saleId: '',
      fullName: 'Kiran Shinde',
      branchId: 'BARAMATI_MIDC',
      branchName: 'BARAMATI MIDC',
      status: 'ACTIVE',
    },
  ];

  const dualColumnMapping = {
    businessDate: 'Date',
    branchCode: 'Branch',
    employeeId: 'Employee ID',
    saleId: 'Sales ID',
    employeeName: 'Employee Name',
    component1: 'New Inc',
    component2: 'Old Inc',
    component3: 'Other Inc',
    saleAmt1: '',
    saleQty1: '',
    saleAmt2: '',
    saleQty2: '',
    saleAmt3: '',
    saleQty3: '',
  };

  // Scenario A: Happy path — blank Employee ID column, only Sales ID populated (1 already linked + 2 unlinked matched by Name)
  const happyRes = validateImportBatch({
    periodStart: '2026-10-15',
    periodEnd: '2026-10-15',
    rawBannerDateText: '2026-10-15',
    rawTotalRows: 3,
    skippedBlankRows: 0,
    skippedSummaryRows: 0,
    rows: [
      {
        rowNumber: 2,
        raw: {
          Date: '2026-10-15',
          Branch: 'BEED',
          'Employee ID': '',
          'Sales ID': '459',
          'Employee Name': 'Ramesh Patil',
          'New Inc': 120,
          'Old Inc': 80,
          'Other Inc': 50,
        },
      },
      {
        rowNumber: 3,
        raw: {
          Date: '2026-10-15',
          Branch: 'BEED',
          'Employee ID': '',
          'Sales ID': '707',
          'Employee Name': 'Pratiksha Kulkarni',
          'New Inc': 200,
          'Old Inc': 100,
          'Other Inc': 0,
        },
      },
      {
        rowNumber: 4,
        raw: {
          Date: '2026-10-15',
          Branch: 'BARAMATI MIDC',
          'Employee ID': '',
          'Sales ID': '708',
          'Employee Name': 'Deshmukh Sagar',
          'New Inc': 150,
          'Old Inc': 50,
          'Other Inc': 25,
        },
      },
    ],
    mapping: dualColumnMapping,
    branches: BRANCHES,
    employees: testEmployees,
    publishedIncentives: [],
  });

  assert.equal(happyRes.canStage, true, `Expected canStage=true, got blockingReasons: ${happyRes.blockingReasons.join('; ')}`);
  assert.equal(happyRes.metrics.invalidRows, 0);
  assert.equal(happyRes.newEmployeeCandidates.length, 0, 'Auto-linked Master employees must NOT be flagged as new candidates');
  assert.equal(happyRes.rows[0].employeeId, 'EMP459');
  assert.equal(happyRes.rows[0].validationStatus, 'VALID');
  assert.equal(happyRes.rows[0].matchedSaleId, '459');
  assert.equal(Boolean(happyRes.rows[0].matchedViaSaleIdLink), false);

  assert.equal(happyRes.rows[1].employeeId, 'EMP707');
  assert.equal(happyRes.rows[1].validationStatus, 'VALID');
  assert.equal(happyRes.rows[1].matchedSaleId, '707');
  assert.equal(happyRes.rows[1].matchedViaSaleIdLink, true);

  assert.equal(happyRes.rows[2].employeeId, 'EMP708');
  assert.equal(happyRes.rows[2].validationStatus, 'VALID');
  assert.equal(happyRes.rows[2].matchedSaleId, '708');
  assert.equal(happyRes.rows[2].matchedViaSaleIdLink, true);

  assert.equal(happyRes.pendingSaleIdLinks.length, 2);
  const link707 = happyRes.pendingSaleIdLinks.find((l) => l.employeeId === 'EMP707');
  const link708 = happyRes.pendingSaleIdLinks.find((l) => l.employeeId === 'EMP708');
  assert.ok(link707);
  assert.equal(link707.proposedSaleId, '707');
  assert.equal(link707.matchBasis, 'EXACT_NAME_AND_BRANCH');
  assert.ok(link708);
  assert.equal(link708.proposedSaleId, '708');
  assert.equal(link708.matchBasis, 'UNIQUE_NAME_TOKENS_AND_BRANCH');

  // Scenario B: Safety guard — ambiguous duplicate names MUST NOT auto-link, and reusing existing saleId '459' with EMP901 MUST NOT create a duplicate link
  const guardRes = validateImportBatch({
    periodStart: '2026-10-16',
    periodEnd: '2026-10-16',
    rawBannerDateText: '2026-10-16',
    rawTotalRows: 2,
    skippedBlankRows: 0,
    skippedSummaryRows: 0,
    rows: [
      {
        rowNumber: 2,
        raw: {
          Date: '2026-10-16',
          Branch: 'BEED',
          'Employee ID': '',
          'Sales ID': '888',
          'Employee Name': 'Amit Joshi',
          'New Inc': 100,
          'Old Inc': 0,
          'Other Inc': 0,
        },
      },
      {
        rowNumber: 3,
        raw: {
          Date: '2026-10-16',
          Branch: 'BARAMATI MIDC',
          'Employee ID': 'EMP901',
          'Sales ID': '459',
          'Employee Name': 'Kiran Shinde',
          'New Inc': 90,
          'Old Inc': 0,
          'Other Inc': 0,
        },
      },
    ],
    mapping: dualColumnMapping,
    branches: BRANCHES,
    employees: testEmployees,
    publishedIncentives: [],
  });

  // Row 2 ('Amit Joshi' appears twice in BEED Master) -> MUST NOT auto-link
  assert.equal(guardRes.rows[0].validationStatus, 'ERROR');
  assert.equal(Boolean(guardRes.rows[0].matchedViaSaleIdLink), false);
  // Row 3 ('EMP901' paired with already-owned saleId '459') -> MUST NOT propose linking '459' to EMP901
  assert.equal(guardRes.pendingSaleIdLinks.length, 0);

  // Scenario C: Backend server.ts validateImportSchema MUST preserve mapping.saleId (not strip it via Zod)
  const serverText = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
  const validateSchemaMatch = serverText.match(/const validateImportSchema = z\.object\(\{[\s\S]*?\n\}\);/);
  assert.ok(validateSchemaMatch, 'validateImportSchema must exist in server.ts');
  assert.match(
    validateSchemaMatch[0],
    /saleId:\s*z\.string\(\)/,
    'validateImportSchema.mapping MUST accept optional saleId so Sale-ID-only uploads pass backend validation',
  );
});

// =========================================================================
// TEST 70: Real Monthly Paysheet Upgrades — OT Attendance, Negative ADVOCH, .00/#N/A Cleaning, Unnamed DCR Mode, ₹1 Rounding & Aliases
// =========================================================================
test('70. Monthly Paysheet parser handles OT days > 30, negative ADVOCH auto-balance, .00/#N/A cleaning, unnamed DCR column, ₹1 rounding, and retail aliases', async () => {
  const { resolveCanonicalDepartment } = await import('../src/lib/departmentLeaderboardEngine.ts');
  const {
    cleanExcelTextCell,
    sanitizeSaleIdCell,
    maskBankAccountNumber,
  } = await import('../src/lib/salarySlipEngine.ts');

  // 1. Canonical Branch & Department retail aliases
  assert.equal(resolveCanonicalBranchName('SMPL'), 'BARAMATI MIDC');
  assert.equal(resolveCanonicalBranchName('MIDC'), 'BARAMATI MIDC');
  assert.equal(resolveCanonicalBranchName('MOTI 1'), 'BARAMATI MOTIBAGH');
  assert.equal(resolveCanonicalBranchName('INDPR'), 'INDAPUR');
  assert.equal(resolveCanonicalBranchName('SGND'), 'SHRIGONDA');
  assert.equal(resolveCanonicalDepartment('LEADIES WEAR')?.id, 'LADIES_WEAR');
  assert.equal(resolveCanonicalDepartment('HOSIARY')?.id, 'NON_APPARELS');

  // 2. Excel error tokens, .00 decimal suffixes, and placeholder Sale IDs cleaned safely
  assert.equal(cleanExcelTextCell('#N/A'), '');
  assert.equal(cleanExcelTextCell('#REF!'), '');
  assert.equal(sanitizeSaleIdCell('2216.00'), '2216');
  assert.equal(sanitizeSaleIdCell('0.00'), '');
  assert.equal(sanitizeSaleIdCell('BILLING'), '');
  assert.equal(sanitizeSaleIdCell('HELPER'), '');
  assert.equal(sanitizeSaleIdCell('HK'), '');
  assert.equal(maskBankAccountNumber('44035408025.00'), 'XXXX8025');
  assert.equal(maskBankAccountNumber('#N/A'), '');

  // 3. Full 45-column CSV covering:
  //    - Row A (0065): OT attendance (MONTHS DAY=30, TOTAL DAYS=31, OT DAYS=1), SELL ID="87.00", Bank="44035408025.00", unnamed trailing col="DCR", DEP="LEADIES WEAR"
  //    - Row B (3014): Negative ADVOCH ALLOW (-525) absorbed by fixed allowances, DEP="LEFT" ignored (keeps Master dept), unnamed trailing col="NEFT"
  //    - Row C (3071): Bank-Exact ₹1 rounding (component sum = 4367.50, EARN GROSS = 4367), SELL ID="HELPER", Bank="#N/A", unnamed trailing col="#N/A"
  const testEmployees: Employee[] = [
    {
      ...EMPLOYEES[0],
      employeeId: '0065',
      fullName: 'SATISH NAMDEO GAWADE',
      branchId: 'BARAMATI_MIDC',
      branchName: 'BARAMATI MIDC',
      departmentId: 'SAREE',
      departmentName: 'Saree Dept.',
      status: 'ACTIVE',
    },
    {
      ...EMPLOYEES[0],
      employeeId: '3014',
      fullName: 'RUKUMINIBAI SURYAVANSHI',
      branchId: 'BARAMATI_MOTIBAGH',
      branchName: 'BARAMATI MOTIBAGH',
      departmentId: 'MENS_WEAR',
      departmentName: 'Mens Wear Dept.',
      status: 'ACTIVE',
    },
    {
      ...EMPLOYEES[0],
      employeeId: '3071',
      fullName: 'SANDHYA BHIMRAO OHOL',
      branchId: 'INDAPUR',
      branchName: 'INDAPUR',
      departmentId: 'NON_APPARELS',
      departmentName: 'Non Apparels Dept.',
      status: 'ACTIVE',
    },
  ];

  const headerRow = [
    'EMP ID',
    'SELL ID',
    'BRANCH',
    'EMP NAME',
    'DEP',
    'MONTHS DAY',
    'PRESENT',
    'W/O',
    'OT DAYS',
    'TOTAL DAYS',
    'SALARY',
    'BASIC',
    'HRA',
    'CONVEYANCE',
    'MEDICAL ALLOW',
    'WASHING ALLOW',
    'ATTENDANCE ALLOW',
    'COMMUNICATION EXP',
    'ADVOCH ALLOW',
    'OT',
    'SALES COMMISION',
    'EARN GROSS',
    'PF',
    'PT',
    'TOTAL DEDUCTION',
    'NET PAY',
    'BANK A/C NO',
    '', // Unnamed 28th trailing column holding DCR / NEFT / #N/A
  ].join(',');

  const rowA = [
    '0065', '87.00', 'SMPL', 'SATISH NAMDEO GAWADE', 'LEADIES WEAR',
    '30', '27', '4', '1', '31',
    '15000', '8000', '2000', '1000', '500', '500', '500', '500', '2000', '500', '2110', '17610',
    '1020', '200', '1220', '16390',
    '44035408025.00', 'DCR',
  ].join(',');

  const rowB = [
    '3014', '2448.00', 'MOTI 1', 'RUKUMINIBAI SURYAVANSHI', 'LEFT',
    '30', '6', '1', '0', '7',
    '9000', '1500', '358', '200', '200', '150', '100', '50', '-525', '0', '0', '2033',
    '0', '0', '0', '2033',
    '123456787202', 'NEFT',
  ].join(',');

  const rowC = [
    '3071', 'HELPER', 'INDPR', 'SANDHYA BHIMRAO OHOL', 'HOSIARY',
    '30', '12.5', '2', '0', '14.5',
    '9000', '2500', '500', '200', '100', '100', '0', '0', '939', '0', '28.50', '4367',
    '0', '0', '0', '4367',
    '#N/A', '#N/A',
  ].join(',');

  const parsed = parseSalaryCsvText([headerRow, rowA, rowB, rowC].join('\n'), testEmployees, '2026-10');

  assert.equal(parsed.errorRows.length, 0, `Expected 0 errors, got: ${parsed.errorRows.map((e) => e.errorMessage).join('; ')}`);
  assert.equal(parsed.validRows.length, 3);

  // Row A checks: OT capped cleanly, SELL ID .00 stripped, Bank .00 fixed, DCR mode detected, LEADIES WEAR mapped
  const rA = parsed.validRows.find((r) => r.employeeId === '0065')!;
  assert.equal(rA.paidDays, 30);
  assert.equal(rA.totalDays, 30);
  assert.equal(rA.overtimeDays, 1);
  assert.equal(rA.saleId, '87');
  assert.equal(rA.bankAccountMasked, 'XXXX8025');
  assert.equal(rA.paymentMode, 'DCR');
  assert.equal(rA.resolvedDepartment?.id, 'LADIES_WEAR');
  assert.equal(rA.grossEarningsPaise, 1761000);
  assert.equal(rA.netPayablePaise, 1639000);

  // Row B checks: Negative ADVOCH (-525) auto-balanced so every earning head >= 0, DEP="LEFT" ignored (keeps Master MENS_WEAR)
  const rB = parsed.validRows.find((r) => r.employeeId === '3014')!;
  assert.equal(rB.adhocAllowancePaise, 0);
  assert.equal(rB.grossEarningsPaise, 203300);
  assert.equal(rB.netPayablePaise, 203300);
  assert.equal(rB.paymentMode, 'NEFT');
  assert.equal(rB.rawDepartment, '');
  assert.equal(rB.resolvedDepartment, null);
  assert.equal(rB.willSyncDepartment, false);
  assert.ok(
    rB.basicPaise >= 0 && rB.hraPaise >= 0 && rB.conveyancePaise >= 0 &&
    rB.medicalAllowancePaise >= 0 && rB.washingAllowancePaise >= 0 &&
    rB.attendanceAllowancePaise >= 0 && rB.communicationExpensesPaise >= 0,
  );

  // Row C checks: Bank-Exact ₹1 rounding aligns 4367.50 -> 4367.00 while preserving 18-head exact sum; HELPER/#N/A cleaned
  const rC = parsed.validRows.find((r) => r.employeeId === '3071')!;
  assert.equal(rC.saleId, '');
  assert.equal(rC.bankAccountMasked, '');
  assert.equal(rC.paymentMode, '');
  assert.equal(rC.resolvedDepartment?.id, 'NON_APPARELS');
  assert.equal(rC.grossEarningsPaise, 436700);
  assert.equal(rC.netPayablePaise, 436700);
  assert.equal(rC.sheetCrossCheckWarning, '');
  const rCSum =
    rC.basicPaise + rC.dearnessAllowancePaise + rC.hraPaise + rC.attendanceAllowancePaise +
    rC.washingAllowancePaise + rC.conveyancePaise + rC.medicalAllowancePaise +
    rC.leaveTravelAllowancePaise + rC.communicationExpensesPaise + rC.healthClubAllowancePaise +
    rC.adhocAllowancePaise + rC.travelingAllowancePaise + rC.salesCommissionPaise +
    rC.specialAllowancePaise + rC.overtimePaise + rC.incentivePaise + rC.arrearsPaise + rC.otherEarningsPaise;
  assert.equal(rCSum, rC.grossEarningsPaise);

  // 4. firestore.rules & firebase-blueprint.json both whitelist 'DCR' payment mode
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  assert.match(rulesText, /'BANK',\s*'NEFT',\s*'DCR',\s*'CASH',\s*'UPI',\s*'CHEQUE'/);
  const blueprintText = fs.readFileSync(path.resolve(process.cwd(), 'firebase-blueprint.json'), 'utf-8');
  assert.match(blueprintText, /"DCR"/);
});

// =========================================================================
// TEST 71: Double-Incentive Auto-Protection in 1-Click Sync
// =========================================================================
test('71. 1-Click Sync auto-skips rows that already contain Sales Commission to prevent double-counting, while syncing rows without it', () => {
  const testEmployees: Employee[] = [
    { ...EMPLOYEES[0], employeeId: 'E1', fullName: 'Has Sales Comm', status: 'ACTIVE' },
    { ...EMPLOYEES[0], employeeId: 'E2', fullName: 'No Sales Comm', status: 'ACTIVE' },
  ];

  const csv = [
    'EMP ID,EMP NAME,MONTHS DAY,TOTAL DAYS,BASIC,SALES COMMISION,EARN GROSS,TOTAL DEDUCTION,NET PAY',
    'E1,Has Sales Comm,30,30,10000,1500,11500,0,11500',
    'E2,No Sales Comm,30,30,10000,0,10000,0,10000',
  ].join('\n');

  const parsed = parseSalaryCsvText(csv, testEmployees, '2026-10');
  assert.equal(parsed.validRows.length, 2);

  const incentiveMap = {
    E1: { employeeId: 'E1', grossPaise: 150000, adjustmentsNetPaise: 0, netPayablePaise: 150000 },
    E2: { employeeId: 'E2', grossPaise: 80000, adjustmentsNetPaise: 0, netPayablePaise: 80000 },
  };

  // Default behavior: E1 skipped (already has salesCommissionPaise = 150000), E2 synced (incentivePaise = 80000)
  const guarded = applyIncentiveAndLoanSyncToSalaryRows(parsed.validRows, incentiveMap, {}, { syncIncentives: true });
  assert.equal(guarded.skippedAlreadyHasSalesCommissionCount, 1);
  assert.equal(guarded.syncedIncentiveCount, 1);

  const e1Guarded = guarded.rows.find((r) => r.employeeId === 'E1')!;
  const e2Guarded = guarded.rows.find((r) => r.employeeId === 'E2')!;
  assert.equal(e1Guarded.salesCommissionPaise, 150000);
  assert.equal(e1Guarded.incentivePaise, 0);
  assert.equal(e1Guarded.netPayablePaise, 1150000);

  assert.equal(e2Guarded.salesCommissionPaise, 0);
  assert.equal(e2Guarded.incentivePaise, 80000);
  assert.equal(e2Guarded.netPayablePaise, 1080000);

  // Explicit override option still works when intentionally requested
  const forced = applyIncentiveAndLoanSyncToSalaryRows(parsed.validRows, incentiveMap, {}, {
    syncIncentives: true,
    forceOverwriteSalesCommission: true,
  });
  assert.equal(forced.skippedAlreadyHasSalesCommissionCount, 0);
  assert.equal(forced.syncedIncentiveCount, 2);
});

// =========================================================================
// TEST 72: Inline Missing Employee Resolution (Add / Change / Update) during Salary Upload
// =========================================================================
test('72. Salary upload tags missing employees with EMPLOYEE_NOT_FOUND + canonical rawBranch, ranks smart Master suggestions, and immediately validates after ID override/add', async () => {
  const {
    extractRawSalaryRowsFromCsv,
    parseSalarySheetRows,
    applyEmployeeIdOverrideToRawRows,
    findSuggestedMasterEmployeesForSalaryRow,
  } = await import('../src/lib/salarySlipEngine.ts');

  const masterEmployees: Employee[] = [
    {
      ...EMPLOYEES[0],
      employeeId: '0065',
      saleId: '87',
      fullName: 'SATISH NAMDEO GAWADE',
      branchId: 'BARAMATI_MIDC',
      branchName: 'BARAMATI MIDC',
      status: 'ACTIVE',
    },
    {
      ...EMPLOYEES[0],
      employeeId: '2040',
      saleId: '512',
      fullName: 'ASHVINI PATOLE',
      branchId: 'BARAMATI_MOTIBAGH',
      branchName: 'BARAMATI MOTIBAGH',
      status: 'ACTIVE',
    },
  ];

  // CSV has 3 unmatched rows:
  // Row 2: typo '65' instead of '0065' (leading-zero & exact Sale ID 87 & exact Name match)
  // Row 3: wrong EMP ID '9999' for 'PATOLE ASHVINI' (reordered Name words match)
  // Row 4: brand new employee 'HK' LAXMI KALE at branch 'MOTI 1' (not in Master yet)
  const csv = [
    'EMP ID,SELL ID,BRANCH,EMP NAME,DEP,MONTHS DAY,TOTAL DAYS,BASIC,EARN GROSS,TOTAL DEDUCTION,NET PAY',
    '65,87.00,SMPL,SATISH NAMDEO GAWADE,SAREE,30,30,15000,15000,0,15000',
    '9999,,MOTI 1,PATOLE ASHVINI,LEADIES WEAR,30,30,12000,12000,0,12000',
    'HK,,MOTI 1,LAXMI KALE,HK,30,30,8000,8000,0,8000',
  ].join('\n');

  const rawRows = extractRawSalaryRowsFromCsv(csv);
  assert.equal(rawRows.length, 3);

  const initial = parseSalarySheetRows(rawRows, masterEmployees, '2026-10');
  assert.equal(initial.validRows.length, 0);
  assert.equal(initial.errorRows.length, 3);
  assert.ok(initial.errorRows.every((r) => r.errorCode === 'EMPLOYEE_NOT_FOUND'));
  assert.equal(initial.errorRows[0].rawBranch, 'BARAMATI MIDC');
  assert.equal(initial.errorRows[1].rawBranch, 'BARAMATI MOTIBAGH');
  assert.equal(initial.errorRows[2].rawBranch, 'BARAMATI MOTIBAGH');

  // Smart suggestions rank exact Sale ID / Name match first
  const sugRow2 = findSuggestedMasterEmployeesForSalaryRow(initial.errorRows[0], masterEmployees);
  assert.equal(sugRow2[0]?.employee.employeeId, '0065');
  assert.match(sugRow2[0]?.reason || '', /Exact Sale ID match/);

  const sugRow3 = findSuggestedMasterEmployeesForSalaryRow(initial.errorRows[1], masterEmployees);
  assert.equal(sugRow3[0]?.employee.employeeId, '2040');
  assert.match(sugRow3[0]?.reason || '', /Same name words/);

  // 1. Simulate "Change" on Row 2 ('65' -> '0065') & "Update" link on Row 3 ('9999' -> '2040')
  let nextRaw = applyEmployeeIdOverrideToRawRows(rawRows, initial.errorRows[0].rowNumber, '0065');
  nextRaw = applyEmployeeIdOverrideToRawRows(nextRaw, initial.errorRows[1].rowNumber, '2040');

  // 2. Simulate "Add" on Row 4 ('HK' -> newly created Master employee '3099' LAXMI KALE)
  const addedEmployee: Employee = {
    ...EMPLOYEES[0],
    employeeId: '3099',
    loginId: 'HOM3099',
    fullName: 'LAXMI KALE',
    branchId: 'BARAMATI_MOTIBAGH',
    branchName: 'BARAMATI MOTIBAGH',
    departmentId: '',
    departmentName: 'Housekeeping',
    status: 'ACTIVE',
  };
  nextRaw = applyEmployeeIdOverrideToRawRows(nextRaw, initial.errorRows[2].rowNumber, '3099');

  const resolved = parseSalarySheetRows(nextRaw, [...masterEmployees, addedEmployee], '2026-10');
  assert.equal(resolved.errorRows.length, 0);
  assert.equal(resolved.validRows.length, 3);
  assert.equal(resolved.totalNetPaise, 3500000); // 15000 + 12000 + 8000 = ₹35,000 exact
  // Ensure SELL ID on Row 2 was NEVER overwritten by EMP ID override
  assert.equal(resolved.validRows.find((r) => r.employeeId === '0065')?.saleId, '87');
});

// =========================================================================
// TEST 73: Branch P&L Sales Commission Deduplication + Clean Payslip Label
// =========================================================================
test('73. computeBranchPnlAnalytics deduplicates salesCommissionPaise when published incentives exist and preserves it on salary-only months', () => {
  const emp = EMPLOYEES[0];
  const summariesOct: MonthlySummary[] = [
    {
      summaryId: `${emp.employeeId}_2026-10`,
      employeeId: emp.employeeId,
      authUid: emp.authUid || 'uid_459',
      employeeName: emp.fullName,
      branchId: emp.branchId,
      branchName: emp.branchName,
      monthKey: '2026-10',
      sourceType: 'MONTHLY_RECORD',
      component1TotalPaise: 400000,
      component2TotalPaise: 0,
      component3TotalPaise: 0,
      grandTotalPaise: 400000, // ₹4,000 published incentive
      saleAmt1TotalPaise: 20000000, // ₹2,00,000 sales
      saleQty1Total: 80,
      saleAmt2TotalPaise: 0,
      saleQty2Total: 0,
      saleAmt3TotalPaise: 0,
      saleQty3Total: 0,
      totalSaleAmtPaise: 20000000,
      totalSaleQty: 80,
      publishedDaysCount: 1,
      updatedAt: '2026-10-31T00:00:00.000Z',
    },
  ];
  const slips: SalarySlip[] = [
    {
      slipId: `2026-10__${emp.employeeId}`,
      monthKey: '2026-10',
      employeeId: emp.employeeId,
      authUid: emp.authUid || 'uid_459',
      employeeName: emp.fullName,
      branchId: emp.branchId,
      branchName: emp.branchName,
      designation: emp.designation,
      totalDays: 31,
      paidDays: 31,
      lopDays: 0,
      weeklyOffDays: 4,
      paidLeaveDays: 0,
      overtimeHours: 0,
      basicPaise: 1500000,
      hraPaise: 100000,
      conveyancePaise: 50000,
      salesCommissionPaise: 400000, // ₹4,000 Sales Commission in real paysheet
      specialAllowancePaise: 0,
      overtimePaise: 0,
      incentivePaise: 0,
      otherEarningsPaise: 0,
      grossEarningsPaise: 2050000, // ₹20,500 gross incl. ₹4,000 sales commission
      pfPaise: 0,
      esicPaise: 0,
      ptPaise: 0,
      advanceRecoveryPaise: 0,
      tdsPaise: 0,
      otherDeductionPaise: 0,
      totalDeductionsPaise: 0,
      netPayablePaise: 2050000,
      employeeVisible: true,
      uploadedByEmail: 'uhvishal41@gmail.com',
      uploadedAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
    {
      slipId: `2026-09__${emp.employeeId}`,
      monthKey: '2026-09',
      employeeId: emp.employeeId,
      authUid: emp.authUid || 'uid_459',
      employeeName: emp.fullName,
      branchId: emp.branchId,
      branchName: emp.branchName,
      designation: emp.designation,
      totalDays: 30,
      paidDays: 30,
      lopDays: 0,
      weeklyOffDays: 4,
      paidLeaveDays: 0,
      overtimeHours: 0,
      basicPaise: 1500000,
      hraPaise: 0,
      conveyancePaise: 0,
      salesCommissionPaise: 300000,
      specialAllowancePaise: 0,
      overtimePaise: 0,
      incentivePaise: 0,
      otherEarningsPaise: 0,
      grossEarningsPaise: 1800000, // Salary-only month (no published summary)
      pfPaise: 0,
      esicPaise: 0,
      ptPaise: 0,
      advanceRecoveryPaise: 0,
      tdsPaise: 0,
      otherDeductionPaise: 0,
      totalDeductionsPaise: 0,
      netPayablePaise: 1800000,
      employeeVisible: true,
      uploadedByEmail: 'uhvishal41@gmail.com',
      uploadedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
  ];

  // Case A: Oct 2026 has BOTH published incentives & salesCommissionPaise -> ZERO double-counting
  const pnlOct = computeBranchPnlAnalytics({
    branches: BRANCHES,
    employees: [emp],
    monthlySummaries: summariesOct,
    salarySlips: slips,
    selectedMonth: '2026-10',
  });
  assert.equal(pnlOct.companyTotals.totalPayrollCostPaise, 2050000); // ₹20,500 (NOT ₹24,500!)
  assert.equal(pnlOct.companyTotals.costToSalesPct, 10.25);
  const octTrend = pnlOct.monthlyTrend.find((m) => m.monthKey === '2026-10');
  assert.equal(octTrend?.totalPayrollCostPaise, 2050000);

  // Case B: Sep 2026 has ONLY salary slip (no published incentives) -> preserves full ₹18,000 gross
  const sepTrend = pnlOct.monthlyTrend.find((m) => m.monthKey === '2026-09');
  assert.equal(sepTrend?.totalPayrollCostPaise, 1800000);

  // Case C: Printed earning breakdown uses clean "Conveyance Allowance" spelling
  const enRows = getSalarySlipEarningBreakdown(slips[0], 'en');
  assert.ok(enRows.some(([label, amt]) => label === 'Conveyance Allowance' && amt === 50000));
});

// =========================================================================
// TEST 74: Login Provisioning Collision-Free Re-issue Helper (auth/email-already-in-use fix)
// =========================================================================
test('74. generateNextAvailableLoginId produces collision-free, Firestore-rule-compliant alternate Login IDs', () => {
  const loginRuleRegex = /^[A-Z0-9_-]{3,40}$/;

  assert.equal(normalizeLoginIdCandidate(' hom 0065! '), 'HOM0065');

  const used = new Set<string>(['HOM0065', 'HOM0065A']);
  const next1 = generateNextAvailableLoginId('HOM0065', used);
  assert.equal(next1, 'HOM0065B');
  assert.match(next1, loginRuleRegex);

  used.add(next1);
  const next2 = generateNextAvailableLoginId('HOM0065', used);
  assert.equal(next2, 'HOM0065C');
  assert.match(next2, loginRuleRegex);

  // Handles long Login IDs near the 40-char Firestore rule ceiling cleanly
  const longBase = 'HOM' + '9'.repeat(37);
  const usedLong = new Set<string>([longBase]);
  const altLong = generateNextAvailableLoginId(longBase, usedLong);
  assert.ok(altLong.length <= 40);
  assert.notEqual(altLong, longBase);
  assert.match(altLong, loginRuleRegex);
});

// =========================================================================
// TEST 75: Branch Reports Engine — Strict Branch Scoping for NEFT, DCR/Cash, Statutory & Incentives
// =========================================================================
test('75. branchReportsEngine isolates Bank NEFT, DCR/Cash, Statutory PF/ESIC/PT/LWF, and Incentives per selected branch', () => {
  const empMidc = {
    ...EMPLOYEES[0],
    bankName: 'HDFC Bank',
    bankAccountMasked: 'XXXX1234',
    bankIfsc: 'HDFC0001234',
    uanNumber: '100998877665',
  };
  const empMotibag = {
    ...EMPLOYEES[1],
    bankName: '',
    bankAccountMasked: '',
    bankIfsc: '',
  };

  const slips: SalarySlip[] = [
    {
      slipId: '2026-10__459',
      monthKey: '2026-10',
      employeeId: empMidc.employeeId,
      authUid: 'uid_459',
      employeeName: empMidc.fullName,
      branchId: 'BARAMATI_MIDC',
      branchName: 'BARAMATI MIDC',
      designation: empMidc.designation,
      totalDays: 31,
      paidDays: 31,
      lopDays: 0,
      weeklyOffDays: 4,
      paidLeaveDays: 0,
      overtimeHours: 0,
      basicPaise: 1500000,
      hraPaise: 300000,
      conveyancePaise: 0,
      specialAllowancePaise: 0,
      overtimePaise: 0,
      incentivePaise: 0,
      otherEarningsPaise: 0,
      grossEarningsPaise: 1800000,
      pfPaise: 180000,
      esicPaise: 13500,
      ptPaise: 20000,
      lwfPaise: 1200,
      advanceRecoveryPaise: 0,
      tdsPaise: 0,
      otherDeductionPaise: 0,
      totalDeductionsPaise: 214700,
      netPayablePaise: 1585300,
      paymentMode: 'NEFT',
      employeeVisible: true,
      uploadedByEmail: 'uhvishal41@gmail.com',
      uploadedAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
    {
      slipId: '2026-10__355',
      monthKey: '2026-10',
      employeeId: empMotibag.employeeId,
      authUid: 'uid_355',
      employeeName: empMotibag.fullName,
      branchId: 'BARAMATI_MOTIBAG',
      branchName: 'BARAMATI MOTIBAG',
      designation: empMotibag.designation,
      totalDays: 31,
      paidDays: 29,
      lopDays: 2,
      weeklyOffDays: 4,
      paidLeaveDays: 0,
      overtimeHours: 0,
      basicPaise: 1200000,
      hraPaise: 0,
      conveyancePaise: 0,
      specialAllowancePaise: 0,
      overtimePaise: 0,
      incentivePaise: 0,
      otherEarningsPaise: 0,
      grossEarningsPaise: 1200000,
      pfPaise: 0,
      esicPaise: 0,
      ptPaise: 20000,
      lwfPaise: 0,
      advanceRecoveryPaise: 0,
      tdsPaise: 0,
      otherDeductionPaise: 0,
      totalDeductionsPaise: 20000,
      netPayablePaise: 1180000,
      paymentMode: 'DCR',
      employeeVisible: true,
      uploadedByEmail: 'uhvishal41@gmail.com',
      uploadedAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
  ];

  // Single-branch NEFT report -> strictly BARAMATI_MIDC
  const neftMidc = buildBankNeftTransferDataset({
    salarySlips: slips,
    employees: [empMidc, empMotibag],
    selectedMonth: '2026-10',
    selectedBranchId: 'BARAMATI_MIDC',
  });
  assert.equal(neftMidc.rows.length, 1);
  assert.equal(neftMidc.readyCount, 1);
  assert.equal(neftMidc.missingBankDetailsCount, 0);
  assert.equal(neftMidc.totalAmountPaise, 1585300);

  // Single-branch DCR/Cash report -> strictly BARAMATI_MOTIBAG
  const dcrMotibag = buildDcrCashDisbursementDataset({
    salarySlips: slips,
    selectedMonth: '2026-10',
    selectedBranchId: 'BARAMATI_MOTIBAG',
  });
  assert.equal(dcrMotibag.rows.length, 1);
  assert.equal(dcrMotibag.dcrCount, 1);
  assert.equal(dcrMotibag.totalAmountPaise, 1180000);

  // Statutory report across ALL vs single branch
  const statMidc = buildStatutoryComplianceDataset({
    salarySlips: slips,
    employees: [empMidc, empMotibag],
    selectedMonth: '2026-10',
    selectedBranchId: 'BARAMATI_MIDC',
  });
  assert.equal(statMidc.totals.pfPaise, 180000);
  assert.equal(statMidc.totals.esicPaise, 13500);
  assert.equal(statMidc.totals.ptPaise, 20000);
  assert.equal(statMidc.totals.lwfPaise, 1200);
  assert.equal(statMidc.totals.totalStatutoryPaise, 214700);
  assert.equal(statMidc.rows[0].uanNumber, '100998877665');

  // Branch incentive dataset & side-by-side summary
  const summaries: MonthlySummary[] = [
    {
      summaryId: '2026-10__459',
      monthKey: '2026-10',
      employeeId: empMidc.employeeId,
      authUid: 'uid_459',
      employeeName: empMidc.fullName,
      branchId: 'BARAMATI_MIDC',
      branchName: 'BARAMATI MIDC',
      component1TotalPaise: 200000,
      component2TotalPaise: 100000,
      component3TotalPaise: 50000,
      grandTotalPaise: 350000,
      totalSaleAmtPaise: 25000000,
      totalSaleQty: 140,
      publishedDaysCount: 1,
      sourceType: 'MONTHLY_RECORD',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
  ];
  const incMidc = buildBranchIncentiveDataset({
    monthlySummaries: summaries,
    employees: [empMidc, empMotibag],
    payoutRecords: [],
    adjustments: [],
    selectedMonth: '2026-10',
    selectedBranchId: 'BARAMATI_MIDC',
  });
  assert.equal(incMidc.rows.length, 1);
  assert.equal(incMidc.totals.netPayablePaise, 350000);

  const summaryRows = buildBranchExecutiveSummaryRows({
    branches: BRANCHES,
    employees: [empMidc, empMotibag],
    salarySlips: slips,
    monthlySummaries: summaries,
    payoutRecords: [],
    adjustments: [],
    selectedMonth: '2026-10',
    selectedBranchId: 'ALL',
  });
  const midcSummary = summaryRows.find((r) => r.branchId === 'BARAMATI_MIDC');
  const motibagSummary = summaryRows.find((r) => r.branchId === 'BARAMATI_MOTIBAG');
  assert.equal(midcSummary?.neftAmountPaise, 1585300);
  assert.equal(motibagSummary?.dcrCashAmountPaise, 1180000);
});

// =========================================================================
// TEST 76: Overtime, Attendance (LOP) & Attrition Insights Analytics (Pro #5)
// =========================================================================
test('76. computeAttendanceOtAttritionAnalytics flags High-LOP (>=4d), High-OT, Attrition %, and New Joiners', () => {
  const emps: Employee[] = [
    { ...EMPLOYEES[0], status: 'ACTIVE', dateOfJoining: '2026-10-05' },
    { ...EMPLOYEES[1], status: 'INACTIVE', dateOfJoining: '2024-01-10' },
  ];
  const slips: SalarySlip[] = [
    {
      slipId: '2026-10__459',
      monthKey: '2026-10',
      employeeId: emps[0].employeeId,
      authUid: 'uid_459',
      employeeName: emps[0].fullName,
      branchId: emps[0].branchId,
      branchName: emps[0].branchName,
      designation: emps[0].designation,
      totalDays: 31,
      paidDays: 26,
      lopDays: 5,
      weeklyOffDays: 4,
      paidLeaveDays: 0,
      overtimeDays: 6,
      overtimeHours: 48,
      basicPaise: 1200000,
      hraPaise: 0,
      conveyancePaise: 0,
      specialAllowancePaise: 0,
      overtimePaise: 400000, // 33.3% of Basic -> High OT
      incentivePaise: 0,
      otherEarningsPaise: 0,
      grossEarningsPaise: 1600000,
      pfPaise: 0,
      esicPaise: 0,
      ptPaise: 0,
      advanceRecoveryPaise: 0,
      tdsPaise: 0,
      otherDeductionPaise: 0,
      totalDeductionsPaise: 0,
      netPayablePaise: 1600000,
      employeeVisible: true,
      uploadedByEmail: 'uhvishal41@gmail.com',
      uploadedAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
  ];

  const report = computeAttendanceOtAttritionAnalytics({
    branches: BRANCHES,
    employees: emps,
    salarySlips: slips,
    selectedMonth: '2026-10',
  });

  assert.equal(report.companyTotals.activeStaffCount, 1);
  assert.equal(report.companyTotals.inactiveStaffCount, 1);
  assert.equal(report.companyTotals.attritionPct, 50);
  assert.equal(report.companyTotals.newJoinersCount, 1);
  assert.equal(report.companyTotals.totalOvertimeDays, 6);
  assert.equal(report.companyTotals.totalOvertimePaise, 400000);
  assert.equal(report.companyTotals.totalLopDays, 5);
  assert.equal(report.highLopAlerts.length, 1);
  assert.equal(report.highLopAlerts[0].lopDays, 5);
  assert.equal(report.highOtAlerts.length, 1);
  assert.equal(report.highOtAlerts[0].overtimeDays, 6);
});

// =========================================================================
// TEST 77: Firestore Rules Governance for Month Payroll Lock / Freeze (Pro #4)
// =========================================================================
test('77. firestore.rules restricts payroll_locks writes strictly to Main Owner and blocks locked-month salary/incentive mutations', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  const rulesNoComments = rulesText.replace(/\/\/[^\n]*/g, '');

  assert.match(rulesNoComments, /function isMonthPayrollLocked\(monthKey\)/);
  assert.match(rulesNoComments, /function isValidPayrollLockSettings\(data\)/);

  const settingsBlock = rulesNoComments.match(
    /match \/portal_settings\/\{settingId\}\s*\{[\s\S]*?\n    \}/,
  );
  assert.ok(settingsBlock);
  assert.match(settingsBlock[0], /settingId == 'payroll_locks' && isMainOwner\(\) && isValidPayrollLockSettings\(incoming\(\)\)/);

  const slipsBlock = rulesNoComments.match(/match \/salary_slips\/\{slipId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(slipsBlock);
  assert.match(slipsBlock[0], /!isMonthPayrollLocked\(incoming\(\)\.monthKey\)/);
  assert.match(slipsBlock[0], /!isMonthPayrollLocked\(existing\(\)\.monthKey\)/);

  const pubBlock = rulesNoComments.match(
    /match \/published_incentives\/\{recordId\}\s*\{[\s\S]*?\n    \}/,
  );
  assert.ok(pubBlock);
  assert.match(pubBlock[0], /!isMonthPayrollLocked\(incoming\(\)\.monthKey\)/);
  assert.match(pubBlock[0], /!isMonthPayrollLocked\(existing\(\)\.monthKey\)/);
});

// =========================================================================
// TEST 78: Firestore Rules Security Audit Hardening Invariants
// =========================================================================
test('78. firestore.rules enforces SalarySlip string bounds, employee_queries employeeId binding, active_auth_uids existsAfter guard, and admins email binding', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  assert.ok(rulesText.length > 0, 'firestore.rules must exist and be non-empty');

  const rulesNoComments = rulesText.replace(/\/\/[^\n]*/g, '');

  // 1. SalarySlip optional strings and slipId are bounded
  const metaMatch = rulesNoComments.match(/function isValidSalarySlipMetadata\(data\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(metaMatch, 'isValidSalarySlipMetadata helper must exist');
  for (const field of [
    'departmentName', 'designation', 'dateOfJoining', 'panNumber', 'uanNumber',
    'pfNumber', 'esicNumber', 'bankName', 'bankAccountMasked', 'bankIfsc',
    'paymentReference', 'paymentDate', 'remarks',
  ]) {
    assert.ok(metaMatch[0].includes(`'${field}'`), `isValidSalarySlipMetadata must bound ${field}`);
  }
  assert.match(rulesNoComments, /isValidSalarySlipMetadata\(data\)/);

  // 2. employee_queries create binds employeeId to activeEmployeeId()
  const queriesBlock = rulesNoComments.match(/match \/employee_queries\/\{queryId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(queriesBlock);
  assert.match(queriesBlock[0], /incoming\(\)\.authUid == request\.auth\.uid\s*&&\s*incoming\(\)\.employeeId == activeEmployeeId\(\)/);

  // 3. active_auth_uids self-heal checks active == true, existsAfter, and branchName
  const registryBlock = rulesNoComments.match(/match \/active_auth_uids\/\{authUid\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(registryBlock);
  assert.match(registryBlock[0], /incoming\(\)\.active == true/);
  assert.match(registryBlock[0], /existsAfter\(\/databases\/\$\(database\)\/documents\/employees\/\$\(incoming\(\)\.employeeId\)\)/);
  assert.match(registryBlock[0], /incoming\(\)\.branchName == getAfter\(\/databases\/\$\(database\)\/documents\/employees\/\$\(incoming\(\)\.employeeId\)\)\.data\.branchName/);

  // 4. admins self-update binds existing email to request.auth.token.email
  const adminsBlock = rulesNoComments.match(/match \/admins\/\{adminUid\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(adminsBlock);
  assert.match(adminsBlock[0], /existing\(\)\.email == request\.auth\.token\.email/);
});

// =========================================================================
// TEST 79: Main Owner vs Super Admin Role Separation (Rules + Services + UI)
// =========================================================================
test('79. Main Owner vs Super Admin privileges are separated across firestore.rules, services, and Admin UI', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  assert.ok(rulesText.length > 0, 'firestore.rules must exist and be non-empty');
  const rulesNoComments = rulesText.replace(/\/\/[^\n]*/g, '');

  // 1. All destructive master/financial deletes are strictly Main Owner only in firestore.rules
  const ownerDeleteCollections: Array<[string, RegExp]> = [
    ['admins', /allow delete: if isValidId\(adminUid\) && isMainOwner\(\);/],
    ['branches', /allow delete: if isValidId\(branchId\) && isMainOwner\(\);/],
    ['employees', /allow delete: if isValidId\(employeeId\) && isMainOwner\(\);/],
    ['published_incentives', /allow delete: if isValidId\(recordId\) && isMainOwner\(\) && !isMonthPayrollLocked\(existing\(\)\.monthKey\);/],
    ['incentive_versions', /allow delete: if isValidId\(versionId\) && isMainOwner\(\);/],
    ['monthly_summaries', /allow delete: if isValidId\(summaryId\) && isMainOwner\(\) && !isMonthPayrollLocked\(existing\(\)\.monthKey\);/],
    ['payout_records', /allow delete: if isValidId\(payoutId\) && isMainOwner\(\) && !isMonthPayrollLocked\(existing\(\)\.monthKey\);/],
    ['incentive_adjustments', /allow delete: if isValidId\(adjustmentId\) && isMainOwner\(\) && !isMonthPayrollLocked\(existing\(\)\.monthKey\);/],
    ['sales_targets', /allow delete: if isValidId\(targetId\) && isMainOwner\(\);/],
    ['employee_queries', /allow delete: if isValidId\(queryId\) && isMainOwner\(\);/],
    ['salary_slips', /allow delete: if isValidId\(slipId\) && isMainOwner\(\) && !isMonthPayrollLocked\(existing\(\)\.monthKey\);/],
    ['employee_loans', /allow delete: if isValidId\(loanId\) && isMainOwner\(\);/],
  ];
  for (const [col, pattern] of ownerDeleteCollections) {
    const m = rulesNoComments.match(new RegExp(`match \\/${col}\\/\\{[^}]+\\}\\s*\\{[\\s\\S]*?\\n    \\}`));
    assert.ok(m, `${col} match block must exist`);
    assert.match(m[0], pattern, `${col} delete must be restricted strictly to Main Owner`);
  }

  // 2. import_batches allows Super Admin draft delete only, while Main Owner owns PUBLISHED edits & deletes
  const batchBlock = rulesNoComments.match(/match \/import_batches\/\{batchId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(batchBlock);
  assert.match(
    batchBlock[0],
    /isMainOwner\(\)\s*&& existing\(\)\.status == 'PUBLISHED'\s*&& incoming\(\)\.status == 'PUBLISHED'/,
  );
  assert.match(
    batchBlock[0],
    /allow delete: if isValidId\(batchId\) && \(\s*isMainOwner\(\)\s*\|\| \(isSuperAdmin\(\) && existing\(\)\.status != 'PUBLISHED'\)\s*\);/,
  );

  // 3. Dedicated audited Main Owner service mutations exist
  const incSvc = fs.readFileSync(path.resolve(process.cwd(), 'src/services/incentiveService.ts'), 'utf-8');
  assert.ok(incSvc.includes('export async function deleteEmployeeByOwner('));
  assert.ok(incSvc.includes("'EMPLOYEE_DELETED_BY_OWNER'"));

  const slipSvc = fs.readFileSync(path.resolve(process.cwd(), 'src/services/salarySlipService.ts'), 'utf-8');
  assert.ok(slipSvc.includes('export async function updatePublishedSalarySlipByOwner('));
  assert.ok(slipSvc.includes("'SALARY_SLIP_OWNER_EDITED'"));

  const opsSvc = fs.readFileSync(path.resolve(process.cwd(), 'src/services/operationsService.ts'), 'utf-8');
  assert.ok(opsSvc.includes('export async function deletePayoutRecordByOwner('));
  assert.ok(opsSvc.includes('export async function deleteIncentiveAdjustmentByOwner('));
  assert.ok(opsSvc.includes('export async function deleteEmployeeQueryByOwner('));

  // 4. Admin UI components gate destructive actions & inline Owner editors behind isMainOwner
  const uiChecks: Array<[string, string[]]> = [
    ['src/components/admin/OwnerSalarySlipEditModal.tsx', ['updatePublishedSalarySlipByOwner']],
    ['src/components/admin/SalarySlipsManager.tsx', ['isMainOwner', 'OwnerSalarySlipEditModal']],
    ['src/components/admin/EmployeeMaster.tsx', ['isMainOwner', 'deleteEmployeeByOwner']],
    ['src/components/admin/HistoryAndReports.tsx', ['isMainOwner']],
    ['src/components/admin/AdminPayoutsAndQueries.tsx', ['isMainOwner', 'deletePayoutRecordByOwner', 'deleteIncentiveAdjustmentByOwner', 'deleteEmployeeQueryByOwner']],
    ['src/components/admin/BranchMaster.tsx', ['isMainOwner']],
    ['src/components/admin/BranchTargetManager.tsx', ['isMainOwner']],
    ['src/components/admin/ProExecutiveSuite.tsx', ['isMainOwner']],
    ['src/components/admin/OwnerAdminAccessManager.tsx', ['Main Owner', 'Super Admin']],
  ];
  for (const [relPath, tokens] of uiChecks) {
    const content = fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf-8');
    for (const token of tokens) {
      assert.ok(content.includes(token), `${relPath} must contain ${token}`);
    }
  }
});

// =========================================================================
// TEST 80: Local Folder Fuzzy Spreadsheet Matcher (Voice Excel Upload)
// =========================================================================
test('80. Local Folder Sync fuzzy matches exact, month-alias, ambiguous, and missing spreadsheet filenames accurately', async () => {
  const {
    findBestMatchingSpreadsheetFile,
    scoreSpreadsheetFileMatch,
  } = await import('../src/lib/localFolderSync.ts');

  const files = [
    {
      name: 'Oct_2026_Incentive_Report.xlsx',
      relativePath: 'Oct_2026_Incentive_Report.xlsx',
      extension: 'xlsx' as const,
      getFile: async () => new File([], 'Oct_2026_Incentive_Report.xlsx'),
    },
    {
      name: 'October_2026_Salary_Sheet.xlsx',
      relativePath: 'Payroll/October_2026_Salary_Sheet.xlsx',
      extension: 'xlsx' as const,
      getFile: async () => new File([], 'October_2026_Salary_Sheet.xlsx'),
    },
    {
      name: 'Baramati_Daily_Sales_15Oct.csv',
      relativePath: 'Baramati_Daily_Sales_15Oct.csv',
      extension: 'csv' as const,
      getFile: async () => new File([], 'Baramati_Daily_Sales_15Oct.csv'),
    },
  ];

  // 1. Exact filename match
  const exact = findBestMatchingSpreadsheetFile('Oct_2026_Incentive_Report.xlsx', files);
  assert.equal(exact.status, 'MATCHED');
  if (exact.status === 'MATCHED') {
    assert.equal(exact.entry.name, 'Oct_2026_Incentive_Report.xlsx');
  }

  // 2. Fuzzy natural spoken query with month alias ("october salary")
  const fuzzySalary = findBestMatchingSpreadsheetFile('october 2026 salary', files);
  assert.equal(fuzzySalary.status, 'MATCHED');
  if (fuzzySalary.status === 'MATCHED') {
    assert.equal(fuzzySalary.entry.name, 'October_2026_Salary_Sheet.xlsx');
  }

  // 3. Typo-tolerant query ("baramti daily sales")
  const typoMatch = findBestMatchingSpreadsheetFile('baramti daily sales', files);
  assert.equal(typoMatch.status, 'MATCHED');
  if (typoMatch.status === 'MATCHED') {
    assert.equal(typoMatch.entry.name, 'Baramati_Daily_Sales_15Oct.csv');
  }

  // 4. Ambiguous query matching both Oct_2026 files closely
  const ambiguous = findBestMatchingSpreadsheetFile('oct 2026', files);
  assert.equal(ambiguous.status, 'AMBIGUOUS');
  if (ambiguous.status === 'AMBIGUOUS') {
    assert.ok(ambiguous.candidates.length >= 2);
  }

  // 5. Missing file returns NOT_FOUND with available suggestions
  const missing = findBestMatchingSpreadsheetFile('December_2027_Audit_Bonus', files);
  assert.equal(missing.status, 'NOT_FOUND');
  assert.ok(missing.suggestions.length >= 1);

  // 6. Score helper ranks closer match strictly higher
  assert.ok(
    scoreSpreadsheetFileMatch('incentive oct 2026', files[0].name) >
      scoreSpreadsheetFileMatch('incentive oct 2026', files[1].name),
  );
});

// =========================================================================
// TEST 81: Marathi Voice Assistant Security, Gemini Tools & UI Wiring
// =========================================================================
test('81. Marathi Voice Assistant keeps API keys strictly server-side, protects voice routes with Super Admin auth, and exposes all 14 app tools', async () => {
  // 1. Verify zero @google/genai or secret env vars in frontend src/
  const walkSrcFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walkSrcFiles(full));
      else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  for (const filePath of walkSrcFiles(path.resolve(process.cwd(), 'src'))) {
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.equal(
      content.includes('@google/genai'),
      false,
      `Frontend file ${filePath} must never import @google/genai`,
    );
    assert.equal(
      content.includes('GEMINI_API_KEY'),
      false,
      `Frontend file ${filePath} must never reference GEMINI_API_KEY`,
    );
    assert.equal(
      content.includes('ELEVENLABS_API_KEY'),
      false,
      `Frontend file ${filePath} must never reference ELEVENLABS_API_KEY`,
    );
  }

  // 2. Verify all 14 Function Calling declarations exist in server/voiceTools.ts
  const { VOICE_FUNCTION_DECLARATIONS } = await import('../server/voiceTools.ts');
  const declaredNames = VOICE_FUNCTION_DECLARATIONS.map((d) => d.name);
  const requiredTools = [
    'navigate_to_section',
    'filter_workspace',
    'search_employees',
    'add_employee',
    'update_employee',
    'delete_employee',
    'manage_incentive_adjustment',
    'manage_payout_status',
    'manage_salary_slip',
    'manage_incentive_batches_and_months',
    'upload_excel_from_local_folder',
    'manage_branches_targets_loans',
    'get_analytics_summary',
    'download_report',
    'prepare_whatsapp_dispatch',
    'get_executive_briefing',
  ];
  assert.equal(VOICE_FUNCTION_DECLARATIONS.length, 16);
  for (const toolName of requiredTools) {
    assert.ok(declaredNames.includes(toolName), `Missing voice tool declaration: ${toolName}`);
  }

  // 3. Verify server/voiceService.ts uses official Gemini models, User-Agent header & optional ElevenLabs
  const voiceSvcText = fs.readFileSync(
    path.resolve(process.cwd(), 'server/voiceService.ts'),
    'utf-8',
  );
  assert.ok(voiceSvcText.includes("'User-Agent': 'aistudio-build'"));
  assert.ok(voiceSvcText.includes('gemini-4-hydrogen'));
  assert.ok(voiceSvcText.includes('gemini-3.5-transcribe'));
  assert.ok(voiceSvcText.includes('eleven_flash_v2_5'));
  assert.ok(voiceSvcText.includes('eleven_multilingual_v2'));
  assert.ok(voiceSvcText.includes('process.env.GEMINI_API_KEY'));
  assert.ok(voiceSvcText.includes('ELEVENLABS_API_KEY'));

  // 4. Verify server.ts secures all 4 voice routes with authMiddleware + requireSuperAdmin
  const serverText = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
  assert.match(serverText, /router\.get\(\s*'\/voice\/status',\s*authMiddleware,\s*requireSuperAdmin/);
  assert.match(serverText, /router\.post\(\s*'\/voice\/transcribe',\s*authMiddleware,\s*requireSuperAdmin/);
  assert.match(serverText, /router\.post\(\s*'\/voice\/converse',\s*authMiddleware,\s*requireSuperAdmin/);
  assert.match(serverText, /router\.post\(\s*'\/voice\/tts',\s*authMiddleware,\s*requireSuperAdmin/);

  // 5. Verify metadata.json & AdminShell wiring
  const metaJson = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'metadata.json'), 'utf-8'),
  );
  assert.ok(metaJson.requestFramePermissions?.includes('microphone'));
  assert.ok(metaJson.majorCapabilities?.includes('MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API'));

  const shellText = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/admin/AdminShell.tsx'),
    'utf-8',
  );
  assert.ok(shellText.includes('MarathiVoiceAssistant'));
  assert.ok(shellText.includes('Link Local Folder'));
  assert.ok(shellText.includes('Folder Linked'));
});

// =========================================================================
// TEST 82: Voice Service ThinkingLevel Safety & Devanagari Marathi Employee Lookup
// =========================================================================
test('82. Voice service uses valid ThinkingLevel.LOW on gemini-4-hydrogen and matches Devanagari Marathi employee names & digits', async () => {
  // 1. Regression guard: ThinkingLevel.MINIMAL throws HTTP 400 on gemini-4-hydrogen
  const voiceSvcText = fs.readFileSync(
    path.resolve(process.cwd(), 'server/voiceService.ts'),
    'utf-8',
  );
  assert.ok(
    voiceSvcText.includes('thinkingLevel: ThinkingLevel.LOW'),
    'gemini-4-hydrogen must use ThinkingLevel.LOW (not MINIMAL)',
  );
  assert.equal(
    voiceSvcText.includes('thinkingLevel: ThinkingLevel.MINIMAL'),
    false,
    'ThinkingLevel.MINIMAL must never be passed to gemini-4-hydrogen',
  );
  assert.equal(
    voiceSvcText.includes('delete copy.thoughtSignature'),
    false,
    'thoughtSignature must NEVER be stripped from functionCall parts (breaks Gemini 3.1/4 Turn 2 with HTTP 400)',
  );
  assert.ok(
    voiceSvcText.includes('preferredModel') &&
      voiceSvcText.includes('usedModel') &&
      voiceSvcText.includes('flattenToolLoopForCrossModelFallback'),
    'voiceService.ts must pin preferredModel across multi-turn tool loops and flatten history on cross-model failover',
  );
  assert.ok(
    voiceSvcText.includes('isPlausibleElevenLabsApiKey') &&
      voiceSvcText.includes('ElevenLabsSpeechError') &&
      !voiceSvcText.includes('synthesizeViaGoogleNeuralMarathiTts') &&
      !voiceSvcText.includes("language_code = 'mr'"),
    'voiceService.ts must run in strict ElevenLabs-only TTS mode and validate ElevenLabs sk_ API keys',
  );

  // 2. Verify Devanagari transliteration & phonetic employee matching ("शोभा लोंढे" -> SHOBHA POPAT LONDHE)
  const { transliterateDevanagariToLatin, findMatchingEmployees } = await import(
    '../src/services/voiceToolExecutor.ts'
  );
  assert.equal(transliterateDevanagariToLatin('शोभा लोंढे'), 'shobha londhe');
  assert.equal(transliterateDevanagariToLatin('११३६'), '1136');

  const sampleStaff: Employee[] = [
    ...EMPLOYEES,
    {
      employeeId: '1136',
      loginId: 'HOM1136',
      authEmail: 'hom1136@staff.houseofmuktai.internal',
      fullName: 'SHOBHA POPAT LONDHE',
      branchId: 'DHARASHIV',
      branchName: 'DHARASHIV',
      departmentId: 'SAREE',
      departmentName: 'Saree Dept.',
      designation: 'Sales Executive',
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      mustChangePassword: false,
      credentialsProvisioned: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const byMarathiName = findMatchingEmployees('शोभा लोंढे', sampleStaff);
  assert.equal(byMarathiName.exact?.employeeId, '1136');
  assert.equal(byMarathiName.exact?.fullName, 'SHOBHA POPAT LONDHE');

  const byMarathiDigits = findMatchingEmployees('११३६', sampleStaff);
  assert.equal(byMarathiDigits.exact?.employeeId, '1136');

  const byAnitaMarathi = findMatchingEmployees('अनिता शिंगाडे', sampleStaff);
  assert.equal(byAnitaMarathi.exact?.employeeId, '459');
});

// =========================================================================
// TEST 83: Pro Voice AI Upgrades — Wake-Word, Multi-Step Detection, WhatsApp & Executive Briefing
// =========================================================================
test('83. Pro Voice AI detects Hey Muktai wake-word, multi-step chains, and executes WhatsApp dispatch + Executive Briefing tools', async () => {
  const {
    extractWakeWordCommand,
    isMultiStepVoiceCommand,
    describeVoiceToolStepMr,
  } = await import('../src/lib/voiceProHelpers.ts');

  // 1. Wake-word detection (standalone & inline command in Marathi + English)
  const w1 = extractWakeWordCommand('हे मुक्ताई');
  assert.equal(w1.triggered, true);
  assert.equal(w1.commandText, '');

  const w2 = extractWakeWordCommand('हे मुक्ताई, शोभा लोंढे यांची माहिती सांग');
  assert.equal(w2.triggered, true);
  assert.equal(w2.commandText, 'शोभा लोंढे यांची माहिती सांग');

  const w3 = extractWakeWordCommand('Hey Muktai show Dharashiv top performers');
  assert.equal(w3.triggered, true);
  assert.equal(w3.commandText, 'show Dharashiv top performers');

  const w4 = extractWakeWordCommand('आजचा पगार किती आहे');
  assert.equal(w4.triggered, false);

  // 2. Multi-step connector detection
  assert.equal(
    isMultiStepVoiceCommand('धाराशिव शाखेचे पेआउट PAID करा आणि रिपोर्ट डाउनलोड करा'),
    true,
  );
  assert.equal(isMultiStepVoiceCommand('Update 1136 to Saree and send WhatsApp slip'), true);
  assert.equal(isMultiStepVoiceCommand('शोभा लोंढे यांच्याबद्दल माहिती पाहिजे'), false);

  assert.ok(describeVoiceToolStepMr('prepare_whatsapp_dispatch', { employeeIdentifier: '1136' }).includes('WhatsApp'));
  assert.ok(describeVoiceToolStepMr('get_executive_briefing', {}).includes('ब्रीफिंग'));

  // 3. Execute prepare_whatsapp_dispatch & get_executive_briefing tools end-to-end
  const { executeVoiceToolCall } = await import('../src/services/voiceToolExecutor.ts');
  let capturedCard: unknown = null;
  const mockEnv = {
    isMainOwner: true,
    branches: BRANCHES,
    employees: [
      {
        ...EMPLOYEES[0],
        phone: '9876543210',
      },
    ],
    batches: [],
    incentives: [],
    monthlySummaries: [
      {
        summaryId: '2026-10__459',
        monthKey: '2026-10',
        employeeId: '459',
        authUid: 'uid_459',
        employeeName: EMPLOYEES[0].fullName,
        branchId: EMPLOYEES[0].branchId,
        branchName: EMPLOYEES[0].branchName,
        component1TotalPaise: 120_000,
        component2TotalPaise: 30_000,
        component3TotalPaise: 10_000,
        grandTotalPaise: 160_000,
        totalSaleAmtPaise: 18_500_000,
        totalSaleQty: 140,
        publishedDaysCount: 28,
        sourceType: 'DAILY_AGGREGATE' as const,
        updatedAt: '2026-11-01T00:00:00Z',
      },
    ],
    payoutRecords: [],
    adjustments: [],
    salesTargets: [],
    employeeQueries: [],
    salarySlips: [
      {
        slipId: '2026-10__459',
        monthKey: '2026-10',
        employeeId: '459',
        authUid: 'uid_459',
        employeeName: EMPLOYEES[0].fullName,
        branchId: EMPLOYEES[0].branchId,
        branchName: EMPLOYEES[0].branchName,
        departmentId: 'SAREE' as const,
        departmentName: 'Saree Dept.',
        designation: 'Sales Executive',
        totalDays: 31,
        paidDays: 30,
        lopDays: 1,
        weeklyOffDays: 4,
        paidLeaveDays: 0,
        overtimeHours: 0,
        basicPaise: 1_500_000,
        hraPaise: 300_000,
        conveyancePaise: 0,
        specialAllowancePaise: 0,
        overtimePaise: 0,
        incentivePaise: 0,
        otherEarningsPaise: 0,
        grossEarningsPaise: 1_800_000,
        pfPaise: 180_000,
        esicPaise: 0,
        ptPaise: 20_000,
        advanceRecoveryPaise: 0,
        tdsPaise: 0,
        otherDeductionPaise: 0,
        totalDeductionsPaise: 200_000,
        netPayablePaise: 1_600_000,
        paymentMode: 'BANK' as const,
        employeeVisible: true,
        uploadedByEmail: 'uhvishal41@gmail.com',
        uploadedAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      },
    ],
    employeeLoans: [],
    visibilitySettings: {
      settingId: 'visibility' as const,
      mode: 'ALL' as const,
      visibleMonths: [],
      salarySlipMode: 'ALL' as const,
      salarySlipVisibleMonths: [],
      updatedByEmail: 'uhvishal41@gmail.com',
      updatedAt: '2026-11-01T00:00:00Z',
    },
    payrollLockSettings: {
      settingId: 'payroll_locks' as const,
      lockedMonths: [],
      updatedByEmail: 'uhvishal41@gmail.com',
      updatedAt: '2026-11-01T00:00:00Z',
    },
    linkedFolder: (await import('../src/lib/localFolderSync.ts')).EMPTY_LINKED_FOLDER,
    setLinkedFolder: () => {},
    navigateToTab: () => {},
    openModal: () => {},
    applyVoiceFilter: () => {},
    refreshAll: async () => {},
    onLiveStatus: () => {},
    onPendingConfirmation: () => {},
    onActionCard: (card: unknown) => {
      capturedCard = card;
    },
  };

  const waRes = await executeVoiceToolCall(
    'prepare_whatsapp_dispatch',
    { employeeIdentifier: 'अनिता शिंगाडे', monthKey: '2026-10' },
    mockEnv,
  );
  assert.equal(waRes.ok, true);
  assert.equal(waRes.hasPhone, true);
  assert.ok(capturedCard && (capturedCard as { type: string }).type === 'whatsapp');
  const waItem = (capturedCard as { items: Array<{ waUrl: string }> }).items[0];
  assert.ok(waItem.waUrl.startsWith('https://wa.me/919876543210?text='));

  const briefRes = await executeVoiceToolCall(
    'get_executive_briefing',
    { monthKey: '2026-10' },
    mockEnv,
  );
  assert.equal(briefRes.ok, true);
  assert.ok(capturedCard && (capturedCard as { type: string }).type === 'briefing');
  assert.equal((capturedCard as { pendingPayoutCount: number }).pendingPayoutCount, 1);
  assert.ok(typeof briefRes.directReplyMr === 'string' && briefRes.directReplyMr.includes('बिझनेस रिपोर्ट'));
});

// =========================================================================
// TEST 84: Rule-Compliant SalarySlip Update Sanitizer (Zero Permission Denied on Legacy Docs)
// =========================================================================
test('84. buildSanitizedSalarySlipForRules strips unknown keys, normalizes legacy paymentMode/departmentId, bounds strings, and computes exact integer totals', async () => {
  const { buildSanitizedSalarySlipForRules } = await import('../src/services/salarySlipService.ts');

  const dirtyLegacySlip = {
    slipId: '2026-10__0072',
    monthKey: '2026-10',
    employeeId: '0072',
    authUid: null as unknown as string,
    employeeName: 'Shobha Londhe',
    branchId: 'DHARASHIV',
    branchName: 'DHARASHIV',
    departmentId: 'LEGACY_UNKNOWN_DEPT' as unknown as import('../src/types/incentive.ts').DepartmentId,
    departmentName: 'A'.repeat(120),
    designation: null as unknown as string,
    dateOfJoining: 'Mon Apr 01 2023 00:00:00 GMT+0530', // > 20 chars
    panNumber: 'ABCDE1234F_EXTRA_LONG_TEXT_999', // > 20 chars
    bankIfsc: 'SBIN0001234_TOO_LONG_IFSC', // > 20 chars
    bankName: 'B'.repeat(100), // > 80 chars
    paymentMode: 'Bank Transfer' as unknown as import('../src/types/incentive.ts').SalarySlipPaymentMode,
    remarks: 'R'.repeat(300), // > 240 chars
    basicPaise: 1_500_000.4,
    hraPaise: 300_000,
    conveyancePaise: 0,
    specialAllowancePaise: 0,
    overtimePaise: 0,
    incentivePaise: 120_000,
    otherEarningsPaise: 0,
    pfPaise: 180_000,
    esicPaise: 0,
    ptPaise: 20_000,
    advanceRecoveryPaise: 0,
    tdsPaise: 0,
    otherDeductionPaise: 0,
    totalDays: 35, // > 31
    paidDays: 34, // > 31
    lopDays: -2,
    weeklyOffDays: 4,
    paidLeaveDays: 0,
    overtimeHours: 0,
    unknownExtraLegacyKey: 'SHOULD_BE_STRIPPED',
  } as unknown as import('../src/types/incentive.ts').SalarySlip;

  const clean = buildSanitizedSalarySlipForRules(dirtyLegacySlip, {
    slipId: '2026-10__0072',
    monthKey: '2026-10',
    employeeId: '0072',
    uploadedByEmail: 'uhvishal41@gmail.com',
    uploadedAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-27T07:00:00.000Z',
  });

  assert.equal('unknownExtraLegacyKey' in clean, false, 'Extra unknown keys must be stripped');
  assert.equal(clean.authUid, '');
  assert.equal(clean.departmentId, '');
  assert.equal(clean.departmentName?.length, 80);
  assert.equal(clean.designation, 'Employee');
  assert.equal(clean.dateOfJoining?.length, 20);
  assert.equal(clean.panNumber?.length, 20);
  assert.equal(clean.bankIfsc?.length, 20);
  assert.equal(clean.bankName?.length, 80);
  assert.equal(clean.remarks?.length, 240);
  assert.equal(clean.paymentMode, 'BANK');
  assert.equal(clean.employeeVisible, true);
  assert.equal(clean.totalDays, 31);
  assert.equal(clean.paidDays, 31);
  assert.equal(clean.lopDays, 0);
  assert.equal(clean.grossEarningsPaise, 1_920_000);
  assert.equal(clean.totalDeductionsPaise, 200_000);
  assert.equal(clean.netPayablePaise, 1_720_000);
});

// =========================================================================
// TEST 85: ElevenLabs Ultra-Low-Latency Marathi Engine (eleven_flash_v2_5 + /stream), Custom Voice ID & Render.com Readiness
// =========================================================================
test('85. ElevenLabs voice engine validates sk_ keys, prioritizes eleven_flash_v2_5 with /stream + mp3_22050_32 + latency=3, caches phrases, preserves custom Voice ID, and declares Render.com secrets', async () => {
  const {
    isPlausibleElevenLabsApiKey,
    sanitizeElevenLabsVoiceId,
    resolveElevenLabsModelChain,
    resolveElevenLabsConfig,
    buildElevenLabsRequestPayload,
    buildElevenLabsStreamUrl,
    openMarathiSpeechStream,
    synthesizeMarathiSpeech,
    resetElevenLabsRuntimeStateForTest,
  } = await import('../server/voiceService.ts');

  resetElevenLabsRuntimeStateForTest();

  // 1. Key format validation: accept real sk_ keys & legacy 32-hex, reject Voice IDs / Key IDs
  const mockValidKey = ['sk', 'unit', 'mock', '0123456789abcdef01234567'].join('_');
  assert.equal(isPlausibleElevenLabsApiKey(mockValidKey), true);
  assert.equal(isPlausibleElevenLabsApiKey('pNInz6obpgDQGcFmaJgB'), false);
  assert.equal(isPlausibleElevenLabsApiKey(''), false);

  // 2. Strict single selected Voice ID sanitization (NEVER substitutes Sarah or any other default voice)
  const customVoice = sanitizeElevenLabsVoiceId('CustomVoiceId1234567');
  assert.equal(customVoice.voiceId, 'CustomVoiceId1234567');
  assert.equal(customVoice.isCustom, true);

  const missingVoice = sanitizeElevenLabsVoiceId('   ');
  assert.equal(missingVoice.voiceId, '');
  assert.equal(missingVoice.isCustom, false);

  // 3. Model priority chain defaults to eleven_flash_v2_5 (ultra-low latency) -> eleven_v3 -> eleven_multilingual_v2
  assert.deepEqual(resolveElevenLabsModelChain(undefined), [
    'eleven_flash_v2_5',
    'eleven_v3',
    'eleven_multilingual_v2',
  ]);
  assert.deepEqual(resolveElevenLabsModelChain('eleven_multilingual_v2'), [
    'eleven_multilingual_v2',
    'eleven_flash_v2_5',
    'eleven_v3',
  ]);

  // 4. Streaming endpoint & payload rules: /stream + optimize_streaming_latency=3 + mp3_22050_32
  const flashStreamUrl = buildElevenLabsStreamUrl('CustomMarathiVoice123', 'eleven_flash_v2_5');
  assert.ok(flashStreamUrl.includes('/v1/text-to-speech/CustomMarathiVoice123/stream'));
  assert.ok(flashStreamUrl.includes('output_format=mp3_22050_32'));
  assert.ok(flashStreamUrl.includes('optimize_streaming_latency=3'));

  const v3Payload = buildElevenLabsRequestPayload({
    text: 'नमस्कार!',
    modelId: 'eleven_v3',
  });
  assert.equal(v3Payload.model_id, 'eleven_v3');
  assert.equal(v3Payload.language_code, 'mr');

  const flashPayload = buildElevenLabsRequestPayload({
    text: 'नमस्कार!',
    modelId: 'eleven_flash_v2_5',
  });
  assert.equal(flashPayload.model_id, 'eleven_flash_v2_5');
  assert.equal('language_code' in flashPayload, false);

  // 5. Status resolution for missing key, invalid format, missing Voice ID, and ready selected Voice ID
  assert.equal(resolveElevenLabsConfig({}).status, 'missing_key');
  assert.equal(
    resolveElevenLabsConfig({ ELEVENLABS_API_KEY: 'pNInz6obpgDQGcFmaJgB' }).status,
    'invalid_key_format',
  );
  assert.equal(
    resolveElevenLabsConfig({
      ELEVENLABS_API_KEY: ['sk', 'unit', 'ready', 'abcdefghijklmnopqrst1234'].join('_'),
    }).status,
    'missing_voice_id',
  );
  const readyCfg = resolveElevenLabsConfig({
    ELEVENLABS_API_KEY: ['sk', 'unit', 'ready', 'abcdefghijklmnopqrst1234'].join('_'),
    ELEVENLABS_VOICE_ID: 'CustomMarathiVoice123',
  });
  assert.equal(readyCfg.status, 'ready');
  assert.equal(readyCfg.voiceId, 'CustomMarathiVoice123');
  assert.equal(readyCfg.voiceIdIsCustom, true);
  assert.equal(readyCfg.primaryModelId, 'eleven_flash_v2_5');

  // 6. Server in-memory cache returns instant cache hit on repeated phrases without a 2nd ElevenLabs call
  const prevKey = process.env.ELEVENLABS_API_KEY;
  const prevVoice = process.env.ELEVENLABS_VOICE_ID;
  const prevModel = process.env.ELEVENLABS_MODEL_ID;
  const prevFetch = globalThis.fetch;
  let fetchCalls = 0;
  process.env.ELEVENLABS_API_KEY = ['sk', 'unit', 'cache', 'abcdefghijklmnopqrst1234'].join('_');
  process.env.ELEVENLABS_VOICE_ID = 'CustomMarathiVoice123';
  delete process.env.ELEVENLABS_MODEL_ID;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x64]), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    });
  }) as typeof fetch;
  try {
    const first = await synthesizeMarathiSpeech('नमस्कार मुक्ताई!');
    assert.equal(first.modelUsed, 'eleven_flash_v2_5');
    assert.equal(fetchCalls, 1);

    const secondStream = await openMarathiSpeechStream('नमस्कार   मुक्ताई!');
    assert.equal(secondStream.cacheHit, true);
    assert.ok(secondStream.buffer && secondStream.buffer.byteLength === 4);
    assert.equal(fetchCalls, 1, 'Repeated phrase must play from server cache with 0 API calls');
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = prevKey;
    if (prevVoice === undefined) delete process.env.ELEVENLABS_VOICE_ID;
    else process.env.ELEVENLABS_VOICE_ID = prevVoice;
    if (prevModel === undefined) delete process.env.ELEVENLABS_MODEL_ID;
    else process.env.ELEVENLABS_MODEL_ID = prevModel;
    resetElevenLabsRuntimeStateForTest();
  }

  // 7. Render.com Blueprint declares GEMINI_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID safely with sync: false
  const renderYaml = fs.readFileSync(path.resolve(process.cwd(), 'render.yaml'), 'utf-8');
  assert.ok(renderYaml.includes('key: GEMINI_API_KEY'));
  assert.ok(renderYaml.includes('key: ELEVENLABS_API_KEY'));
  assert.ok(renderYaml.includes('key: ELEVENLABS_VOICE_ID'));
  assert.ok(renderYaml.includes('key: ELEVENLABS_MODEL_ID'));
  assert.ok(renderYaml.includes('sync: false'));
  assert.ok(renderYaml.includes('eleven_flash_v2_5'));
});

// =========================================================================
// TEST 86: Strict Single Selected Voice Lock (Zero Alternate Voices) & "आजचा कोटा संपला आहे" Alert
// =========================================================================
test('86. ElevenLabs strictly uses ONLY selected ELEVENLABS_VOICE_ID (never switches voices) and reports "आजचा कोटा संपला आहे" on quota exhaustion', async () => {
  const {
    classifyElevenLabsHttpError,
    synthesizeMarathiSpeech,
    ElevenLabsSpeechError,
    getVoiceCapabilitiesStatus,
    resetElevenLabsRuntimeStateForTest,
  } = await import('../server/voiceService.ts');

  // 1. Error classifier accuracy
  assert.equal(
    classifyElevenLabsHttpError(
      402,
      JSON.stringify({
        detail: {
          status: 'payment_required',
          message: 'Free users cannot use library voices via the API. Please upgrade your subscription.',
        },
      }),
    ),
    'library_voice_paid_only',
  );
  assert.equal(
    classifyElevenLabsHttpError(
      401,
      JSON.stringify({
        detail: {
          status: 'detected_unusual_activity',
          message: 'Unusual activity detected. Free Tier usage disabled.',
        },
      }),
    ),
    'free_tier_ip_blocked',
  );
  assert.equal(
    classifyElevenLabsHttpError(
      401,
      JSON.stringify({
        detail: { status: 'quota_exceeded', message: 'This request exceeds your remaining quota' },
      }),
    ),
    'quota_exceeded',
  );
  assert.equal(
    classifyElevenLabsHttpError(
      401,
      JSON.stringify({ detail: { code: 'invalid_api_key', message: 'Invalid API key' } }),
    ),
    'auth_rejected',
  );

  // 2. Live strict single-voice test:
  //    (a) HTTP 402 on selected Voice ID MUST stop immediately with voice_paid_plan_required (ZERO fallback to Sarah/Rachel/etc.)
  //    (b) Quota exceeded MUST throw ElevenLabsSpeechError('quota_cooldown') with exact "आजचा कोटा संपला आहे" Marathi message
  resetElevenLabsRuntimeStateForTest();
  const prevKey = process.env.ELEVENLABS_API_KEY;
  const prevVoice = process.env.ELEVENLABS_VOICE_ID;
  const prevFetch = globalThis.fetch;

  const calledUrls: string[] = [];
  process.env.ELEVENLABS_API_KEY = ['sk', 'unit', 'freetier', '1234567890abcdefghij'].join('_');
  process.env.ELEVENLABS_VOICE_ID = 'SelectedCustomVoice999';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calledUrls.push(url);
    return new Response(
      JSON.stringify({
        detail: {
          status: 'payment_required',
          message: 'Free users cannot use library voices via the API.',
        },
      }),
      { status: 402, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () => {
        await synthesizeMarathiSpeech('नमस्कार मुक्ताई!', { forceRefresh: true });
      },
      (err: unknown) =>
        err instanceof ElevenLabsSpeechError && err.reason === 'voice_paid_plan_required',
    );
    assert.equal(calledUrls.length, 1, 'Must call ONLY the selected Voice ID and NEVER switch to another voice');
    assert.ok(calledUrls[0].includes('SelectedCustomVoice999/stream'));
    assert.ok(calledUrls[0].includes('output_format=mp3_22050_32'));
    assert.ok(calledUrls[0].includes('optimize_streaming_latency=3'));

    const status402 = getVoiceCapabilitiesStatus();
    assert.equal(status402.elevenLabsConfigured, false);
    assert.equal(status402.elevenLabsStatus, 'voice_paid_plan_required');

    // Now test quota exhaustion -> must return exact "आजचा कोटा संपला आहे" message
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calledUrls.push(String(input));
      return new Response(
        JSON.stringify({
          detail: { status: 'quota_exceeded', message: 'This request exceeds your remaining quota' },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    await assert.rejects(
      async () => {
        await synthesizeMarathiSpeech('आजचा रिपोर्ट सांग', { forceRefresh: true });
      },
      (err: unknown) =>
        err instanceof ElevenLabsSpeechError &&
        err.reason === 'quota_cooldown' &&
        err.message.includes('आजचा कोटा संपला आहे'),
    );
    const statusQuota = getVoiceCapabilitiesStatus();
    assert.equal(statusQuota.elevenLabsStatus, 'quota_cooldown');
    assert.ok(statusQuota.statusMessageMr?.includes('आजचा कोटा संपला आहे'));
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = prevKey;
    if (prevVoice === undefined) delete process.env.ELEVENLABS_VOICE_ID;
    else process.env.ELEVENLABS_VOICE_ID = prevVoice;
    resetElevenLabsRuntimeStateForTest();
  }
});

// =========================================================================
// TEST 87: Dual-Engine Sarvam AI + ElevenLabs TTS (Zero Robotic Fallback) & 100% Feminine Marathi Persona
// =========================================================================
test('87. Voice assistant supports dual Sarvam AI + ElevenLabs engines with zero speechSynthesis fallback and 100% feminine Marathi persona', async () => {
  const voiceServiceSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'server/voiceService.ts'),
    'utf-8',
  );
  const speechClientSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/lib/voiceSpeechClient.ts'),
    'utf-8',
  );
  const assistantUiSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/admin/MarathiVoiceAssistant.tsx'),
    'utf-8',
  );
  const voiceToolsSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'server/voiceTools.ts'),
    'utf-8',
  );
  const voiceExecSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/services/voiceToolExecutor.ts'),
    'utf-8',
  );

  // 1. Zero browser speechSynthesis / SpeechSynthesisUtterance / alternate premade voice fallback anywhere
  assert.equal(speechClientSrc.includes('speechSynthesis'), false);
  assert.equal(speechClientSrc.includes('SpeechSynthesisUtterance'), false);
  assert.equal(assistantUiSrc.includes('window.speechSynthesis'), false);
  assert.equal(voiceServiceSrc.includes('FREE_PREMADE_FEMALE_VOICES'), false);
  assert.equal(voiceServiceSrc.includes('EXAVITQu4vr4xnSDxMaL'), false);

  // 2. Dual engine switcher UI & strict feminine Marathi persona
  assert.ok(assistantUiSrc.includes('Sarvam AI (मृणाल)'));
  assert.ok(assistantUiSrc.includes('ElevenLabs'));
  assert.ok(assistantUiSrc.includes('मी तुमची काय मदत करू शकते?'));
  assert.ok(voiceToolsSrc.includes('मी तुमची काय मदत करू शकते?'));
  assert.ok(voiceToolsSrc.includes('मी फाईल लगेच अपलोड करते.'));
  assert.equal(voiceToolsSrc.includes('फाईल लगेच अपलोड करतो'), false);
  assert.ok(voiceExecSrc.includes('मी सेव्ह करते.'));
  assert.equal(voiceExecSrc.includes('मी सेव्ह करतो'), false);

  // 3. Server supports dual providers (default sarvam) and still throws cleanly when keys are missing
  const {
    synthesizeMarathiSpeech,
    synthesizeDualProviderSpeech,
    ElevenLabsSpeechError,
    DualTtsUnavailableError,
    getVoiceCapabilitiesStatus,
    resetElevenLabsRuntimeStateForTest,
    resetSarvamRuntimeStateForTest,
  } = await import('../server/voiceService.ts');

  resetElevenLabsRuntimeStateForTest();
  resetSarvamRuntimeStateForTest();
  const prevElKey = process.env.ELEVENLABS_API_KEY;
  const prevSarvamKey = process.env.SARVAM_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.SARVAM_API_KEY;
  try {
    const caps = getVoiceCapabilitiesStatus();
    assert.equal(caps.defaultProvider, 'sarvam');
    assert.deepEqual(caps.availableProviders, ['sarvam', 'elevenlabs']);
    assert.equal(caps.sarvamSpeaker, 'mrunal');
    assert.equal(caps.sarvamModelId, 'bulbul:v3');

    await assert.rejects(
      async () => {
        await synthesizeMarathiSpeech('नमस्कार मुक्ताई!', { forceRefresh: true });
      },
      (err: unknown) =>
        err instanceof ElevenLabsSpeechError && err.reason === 'missing_key',
    );

    await assert.rejects(
      async () => {
        await synthesizeDualProviderSpeech({
          text: 'नमस्कार मुक्ताई!',
          provider: 'sarvam',
          forceRefresh: true,
        });
      },
      (err: unknown) =>
        err instanceof DualTtsUnavailableError &&
        err.sarvamStatus === 'missing_key' &&
        err.elevenLabsStatus === 'missing_key',
    );
  } finally {
    if (prevElKey !== undefined) process.env.ELEVENLABS_API_KEY = prevElKey;
    if (prevSarvamKey !== undefined) process.env.SARVAM_API_KEY = prevSarvamKey;
    resetElevenLabsRuntimeStateForTest();
    resetSarvamRuntimeStateForTest();
  }
});

// =========================================================================
// TEST 88: Full 360-Degree Employee Master (46 Fields) — Import, Masking, Completeness & Export
// =========================================================================
test('88. Employee Master supports all 46 HR/KYC/Statutory/Bank/Ops fields across import, masking, completeness, and full CSV export', async () => {
  const {
    maskAadhaarNumber,
    parseMonthlySalaryToPaise,
    formatSalaryRupeesPlain,
    computeEmployeeCompleteness,
    buildFullEmployeeMasterCsv,
    FULL_EMPLOYEE_EXPORT_HEADERS,
  } = await import('../src/lib/employeeMasterExport.ts');
  const {
    EMPLOYEE_MASTER_TEMPLATE_HEADERS,
    parseEmployeeMasterCsvText,
  } = await import('../src/lib/employeeBulkImportEngine.ts');

  // 1. Aadhaar masking & monthly gross salary parsing
  assert.equal(maskAadhaarNumber('1234 5678 9012'), 'XXXX-XXXX-9012');
  assert.equal(maskAadhaarNumber('XXXX-XXXX-4321'), 'XXXX-XXXX-4321');
  assert.equal(maskAadhaarNumber(''), '');
  assert.equal(parseMonthlySalaryToPaise('₹18,500.50'), 1850050);
  assert.equal(parseMonthlySalaryToPaise('22000'), 2200000);
  assert.equal(parseMonthlySalaryToPaise(''), undefined);
  assert.equal(formatSalaryRupeesPlain(1850050), '18500.50');
  assert.equal(formatSalaryRupeesPlain(2200000), '22000');
  assert.equal(EMPLOYEE_MASTER_TEMPLATE_HEADERS.length, 25);
  assert.equal(FULL_EMPLOYEE_EXPORT_HEADERS.length, 25);
  assert.ok(EMPLOYEE_MASTER_TEMPLATE_HEADERS.includes('Date of Exit'));
  assert.ok(FULL_EMPLOYEE_EXPORT_HEADERS.includes('Date of Exit'));

  // 2. Bulk CSV Import for a brand-new employee with all new fields + custom column
  const existingEmp: Employee = {
    employeeId: 'EMP_EXISTING_01',
    saleId: 'S001',
    loginId: 'HOM_EX01',
    authEmail: 'hom_ex01@houseofmuktai.internal',
    role: 'EMPLOYEE',
    mustChangePassword: false,
    credentialsProvisioned: true,
    fullName: 'Existing Staff Member',
    branchId: 'BARAMATI_MIDC',
    branchName: 'BARAMATI MIDC',
    departmentId: 'SAREE',
    departmentName: 'Saree',
    designation: 'Sales Executive',
    status: 'ACTIVE',
    phone: '9822000001',
    shiftTiming: '10:00 AM - 08:00 PM',
    monthlyGrossSalaryPaise: 1500000,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };

  const csvHeaders = [
    'Employee ID',
    'Sale ID',
    'Login ID',
    'Full Name',
    'Branch',
    'Department',
    'Designation',
    'Employment Type',
    'Category',
    'Reporting Manager',
    'Shift Timing',
    'Weekly Off Day',
    'Uniform Size',
    'Gender',
    'Status',
    'Date of Birth',
    'Date of Joining',
    'Father / Spouse Name',
    'Marital Status',
    'Blood Group',
    'Qualification',
    'Mobile Number',
    'Alternate Mobile',
    'Personal Email',
    'Residential Address',
    'Permanent Address',
    'Emergency Contact Name',
    'Emergency Contact',
    'Nominee Name',
    'Nominee Relation',
    'Aadhaar Number',
    'PAN Number',
    'UAN Number',
    'PF Account Number',
    'ESIC Number',
    'Monthly Gross Salary (INR)',
    'Payment Mode',
    'Bank Name',
    'Bank Branch',
    'Bank Account Number',
    'Bank IFSC Code',
    'UPI ID',
    'HR Remarks',
    'Locker Number',
  ];

  const newRow = [
    'EMP_NEW_360',
    'S360',
    'HOM_360',
    'Priya Deshmukh',
    'BARAMATI MIDC',
    'Saree',
    'Senior Sales Executive',
    'Full-Time',
    'Regular',
    'Ramesh Patil',
    '10:00 AM - 08:00 PM',
    'Tuesday',
    'M',
    'Female',
    'ACTIVE',
    '1997-05-14',
    '2025-04-01',
    'Suresh Deshmukh',
    'Married',
    'O+',
    'B.Com',
    '9876543210',
    '9876500001',
    'priya.deshmukh@example.com',
    '"Plot 12, MIDC Road, Baramati"',
    '"At Post Malegaon, Baramati"',
    'Suresh Deshmukh',
    '9822112233',
    'Suresh Deshmukh',
    'Spouse',
    '4512 8899 6712',
    'ABCDE1234F',
    '101234567890',
    'MHPUN12345670000123',
    '31001234560001001',
    '"₹18,500.50"',
    'NEFT / Bank Transfer',
    'HDFC Bank',
    'Baramati Main',
    '50100099887766',
    'HDFC0001234',
    'priya@okhdfcbank',
    '"Top performer, fluent in Marathi"',
    'L-42',
  ];

  // Overlap row updating shift timing and salary on existingEmp
  const overlapRow = [
    'EMP_EXISTING_01',
    'S001',
    'HOM_EX01',
    'Existing Staff Member',
    'BARAMATI MIDC',
    'Saree',
    'Sales Executive',
    'Full-Time',
    '',
    '',
    '11:00 AM - 09:00 PM',
    'Wednesday',
    'L',
    '',
    'ACTIVE',
    '',
    '',
    '',
    '',
    '',
    '',
    '9822000001',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '9999 8888 7777',
    '',
    '',
    '',
    '',
    '17500',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ];

  const csvText = [csvHeaders.join(','), newRow.join(','), overlapRow.join(',')].join('\n');
  const parsed = parseEmployeeMasterCsvText(csvText, BRANCHES, [existingEmp]);

  assert.equal(parsed.totalRows, 2);
  assert.equal(parsed.newReadyCount, 1);
  assert.equal(parsed.overlapConflictCount, 1);
  assert.equal(parsed.errorCount, 0);

  const created = parsed.rows.find((r) => r.employeeId === 'EMP_NEW_360');
  assert.ok(created);
  assert.equal(created.status, 'NEW_READY');
  assert.equal(created.fatherOrSpouseName, 'Suresh Deshmukh');
  assert.equal(created.maritalStatus, 'Married');
  assert.equal(created.bloodGroup, 'O+');
  assert.equal(created.qualification, 'B.Com');
  assert.equal(created.employmentType, 'Full-Time');
  assert.equal(created.reportingManager, 'Ramesh Patil');
  assert.equal(created.shiftTiming, '10:00 AM - 08:00 PM');
  assert.equal(created.weeklyOffDay, 'Tuesday');
  assert.equal(created.uniformSize, 'M');
  assert.equal(created.aadhaarMasked, 'XXXX-XXXX-6712');
  assert.equal(created.monthlyGrossSalaryPaise, 1850050);
  assert.equal(created.paymentMode, 'NEFT / Bank Transfer');
  assert.equal(created.bankBranchName, 'Baramati Main');
  assert.equal(created.upiId, 'priya@okhdfcbank');
  assert.equal(created.alternatePhone, '9876500001');
  assert.equal(created.personalEmail, 'priya.deshmukh@example.com');
  assert.equal(created.permanentAddress, 'At Post Malegaon, Baramati');
  assert.equal(created.emergencyContactName, 'Suresh Deshmukh');
  assert.equal(created.nomineeName, 'Suresh Deshmukh');
  assert.equal(created.nomineeRelation, 'Spouse');
  assert.equal(created.hrRemarks, 'Top performer, fluent in Marathi');
  assert.equal(created.customFields['Locker Number'], 'L-42');

  const overlapped = parsed.rows.find((r) => r.employeeId === 'EMP_EXISTING_01');
  assert.ok(overlapped);
  assert.equal(overlapped.status, 'OVERLAP_CONFLICT');
  const diffFields = new Set(overlapped.diffs.map((d) => d.field));
  assert.ok(diffFields.has('shiftTiming'));
  assert.ok(diffFields.has('monthlyGrossSalaryPaise'));
  assert.ok(diffFields.has('aadhaarMasked'));
  assert.ok(diffFields.has('uniformSize'));

  // 3. Completeness report: 100% for complete profile, <80% with exact missing labels for sparse profile
  const fullEmployee: Employee = {
    employeeId: created.employeeId,
    saleId: created.saleId,
    loginId: created.loginId,
    authEmail: `${created.loginId}@houseofmuktai.internal`,
    role: 'EMPLOYEE',
    mustChangePassword: false,
    credentialsProvisioned: true,
    fullName: created.fullName,
    branchId: created.branchId,
    branchName: created.branchName,
    departmentId: created.departmentId || undefined,
    departmentName: created.departmentName,
    designation: created.designation,
    status: created.employeeStatus,
    dateOfBirth: created.dateOfBirth,
    dateOfJoining: created.dateOfJoining,
    phone: created.phone,
    panNumber: created.panNumber,
    aadhaarMasked: created.aadhaarMasked,
    bankName: created.bankName,
    bankBranchName: created.bankBranchName,
    bankAccountMasked: created.bankAccountMasked,
    bankIfsc: created.bankIfsc,
    monthlyGrossSalaryPaise: created.monthlyGrossSalaryPaise,
    emergencyContactName: created.emergencyContactName,
    emergencyContact: created.emergencyContact,
    address: created.address,
    permanentAddress: created.permanentAddress,
    hrRemarks: created.hrRemarks,
    customFields: created.customFields,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };

  const fullReport = computeEmployeeCompleteness(fullEmployee);
  assert.equal(fullReport.scorePct, 100);
  assert.equal(fullReport.kycReady, true);
  assert.equal(fullReport.bankReady, true);
  assert.equal(fullReport.missingLabels.length, 0);

  const sparseReport = computeEmployeeCompleteness(existingEmp);
  assert.ok(sparseReport.scorePct < 80);
  assert.equal(sparseReport.kycReady, false);
  assert.equal(sparseReport.bankReady, false);
  assert.ok(sparseReport.missingLabels.includes('PAN Number'));
  assert.ok(sparseReport.missingLabels.includes('Aadhaar (Masked)'));

  // 4. Full Master CSV Export starts with UTF-8 BOM, includes all headers + custom columns, quotes commas
  const exportedCsv = buildFullEmployeeMasterCsv([fullEmployee, existingEmp], ['Locker Number']);
  assert.ok(exportedCsv.startsWith('\uFEFF'), 'CSV export must start with UTF-8 BOM');
  for (const h of FULL_EMPLOYEE_EXPORT_HEADERS) {
    assert.ok(exportedCsv.includes(h), `Exported CSV missing header: ${h}`);
  }
  assert.ok(exportedCsv.includes('Locker Number'));
  assert.ok(exportedCsv.includes('L-42'));
  assert.ok(exportedCsv.includes('"Plot 12, MIDC Road, Baramati"'));
  assert.equal(exportedCsv.includes('HR Remarks'), false);
  assert.ok(exportedCsv.includes('XXXX-XXXX-6712'));
});

// =========================================================================
// TEST 89: Full Audit Hardening Regression Guard (Rules, Auth Cache, Queries, IST Dates, Voice, Scoped Refresh)
// =========================================================================
test('89. Audit fixes enforce Employee Master update whitelist, Payroll Lock across all financial collections, bounded 10s admin cache, month-scoped salary queries, IST export dates, and direct Muktai Employee Master fields', () => {
  const rulesNoComments = fs
    .readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8')
    .replace(/\/\/[^\n]*/g, '');

  // 1. Employee Master update whitelist allows dateOfExit, aadhaarMasked, monthlyGrossSalaryPaise
  const empBlock = rulesNoComments.match(/match \/employees\/\{employeeId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(empBlock, 'employees rules block must exist');
  assert.ok(empBlock[0].includes("'dateOfExit'"), 'employees update whitelist must include dateOfExit');
  assert.ok(empBlock[0].includes("'aadhaarMasked'"), 'employees update whitelist must include aadhaarMasked');
  assert.ok(empBlock[0].includes("'monthlyGrossSalaryPaise'"), 'employees update whitelist must include monthlyGrossSalaryPaise');

  // 2. Payroll Lock enforced across monthly_summaries, payout_records, and incentive_adjustments
  for (const col of ['monthly_summaries', 'payout_records', 'incentive_adjustments']) {
    const block = rulesNoComments.match(new RegExp(`match \\/${col}\\/\\{[^}]+\\}\\s*\\{[\\s\\S]*?\\n    \\}`));
    assert.ok(block, `${col} rules block must exist`);
    assert.match(block[0], /!isMonthPayrollLocked\(incoming\(\)\.monthKey\)/, `${col} must block writes on locked month`);
    assert.match(block[0], /!isMonthPayrollLocked\(existing\(\)\.monthKey\)/, `${col} must block edits/deletes on locked month`);
  }

  // 3. Server auth cache uses 10s TTL and bounded max entries
  const authMwSrc = fs.readFileSync(path.resolve(process.cwd(), 'server/authMiddleware.ts'), 'utf-8');
  assert.ok(authMwSrc.includes('ADMIN_CACHE_TTL_MS = 10_000'), 'Admin cache TTL must be 10 seconds');
  assert.ok(authMwSrc.includes('MAX_ADMIN_CACHE_ENTRIES = 200'), 'Admin cache must have a strict size cap');

  // 4. Salary slip batch publish queries only affected months instead of scanning entire collection
  const slipSvcSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/services/salarySlipService.ts'), 'utf-8');
  assert.ok(slipSvcSrc.includes("where('monthKey', '==', mk)"), 'publishSalarySlipsBatch must use month-scoped query');

  // 5. Export filenames use IST date helper instead of raw UTC toISOString()
  const empExportSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/employeeMasterExport.ts'), 'utf-8');
  assert.ok(empExportSrc.includes('getTodayIST()'), 'employeeMasterExport must use getTodayIST()');
  assert.equal(empExportSrc.includes('toISOString().slice(0, 10)'), false);
  const pdfGenSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/pdfGenerator.ts'), 'utf-8');
  assert.ok(pdfGenSrc.includes('getTodayIST()'), 'pdfGenerator must use getTodayIST()');

  // 6. Voice update_employee maps directly to monthlyGrossSalaryPaise, dateOfExit, aadhaarMasked
  const voiceToolsSrc = fs.readFileSync(path.resolve(process.cwd(), 'server/voiceTools.ts'), 'utf-8');
  const voiceExecSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/services/voiceToolExecutor.ts'), 'utf-8');
  assert.ok(voiceToolsSrc.includes('monthlyGrossSalaryRupees'));
  assert.ok(voiceToolsSrc.includes('dateOfExit'));
  assert.ok(voiceToolsSrc.includes('aadhaarNumber'));
  assert.ok(voiceExecSrc.includes('monthlyGrossSalaryPaise'));
  assert.ok(voiceExecSrc.includes('dateOfExit'));
  assert.ok(voiceExecSrc.includes('maskAadhaarNumber'));

  // 7. .env.example matches eleven_flash_v2_5 primary TTS model
  const envExample = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf-8');
  assert.ok(envExample.includes('ELEVENLABS_MODEL_ID=eleven_flash_v2_5'));

  // 8. AdminPayoutsAndQueries & HistoryAndReports guard locked months in UI
  const payoutsUi = fs.readFileSync(path.resolve(process.cwd(), 'src/components/admin/AdminPayoutsAndQueries.tsx'), 'utf-8');
  const historyUi = fs.readFileSync(path.resolve(process.cwd(), 'src/components/admin/HistoryAndReports.tsx'), 'utf-8');
  assert.ok(payoutsUi.includes('payrollLockSettings'));
  assert.ok(historyUi.includes('payrollLockSettings'));

  // 9. Active employee first-login password setup & profile self-update uses isolated helper + resilient token sync
  assert.ok(rulesNoComments.includes('function isValidEmployeeSelfUpdate(oldData, newData)'));
  assert.ok(rulesNoComments.includes('function isValidNotificationReadUpdate(oldData, newData)'));
  const empPortalSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/staff/EmployeePortal.tsx'), 'utf-8');
  assert.ok(empPortalSrc.includes('newPasswordForReauth'));
  assert.ok(empPortalSrc.includes('authPasswordAlreadyUpdated'));
});

// =========================================================================
// TEST 90: Main Owner Password Management for All Admins & Employees
// =========================================================================
test('90. Main Owner can set/reset passwords for any Admin or Employee with same visible Username/Login ID, instant old-password revocation, strict Owner-only guards, and zero plaintext logging', async () => {
  const {
    adminUsernameToRotatedAuthEmail,
    employeeLoginIdToRotatedAuthEmail,
    extractAuthEmailRotationIndex,
    generateStrongTemporaryPassword,
    isAdminAuthEmail,
    MAX_AUTH_ROTATION_SLOTS,
  } = await import('../src/lib/firebase.ts');

  // 1. Rotated internal auth email helpers preserve visible username/loginId & match domain checks
  assert.equal(MAX_AUTH_ROTATION_SLOTS, 8);
  assert.equal(adminUsernameToRotatedAuthEmail('HOMADMIN', 1), 'homadmin@admin.homfash.internal');
  assert.equal(adminUsernameToRotatedAuthEmail('HOMADMIN', 2), 'homadmin__r2@admin.homfash.internal');
  assert.equal(adminUsernameToRotatedAuthEmail('homadmin__r2', 3), 'homadmin__r3@admin.homfash.internal');
  assert.equal(isAdminAuthEmail(adminUsernameToRotatedAuthEmail('HOMADMIN', 4)), true);
  assert.equal(extractAuthEmailRotationIndex('homadmin@admin.homfash.internal', '__r'), 1);
  assert.equal(extractAuthEmailRotationIndex('homadmin__r5@admin.homfash.internal', '__r'), 5);

  assert.equal(employeeLoginIdToRotatedAuthEmail('HOM2265', 1), 'hom2265@auth.homfash.internal');
  assert.equal(employeeLoginIdToRotatedAuthEmail('HOM2265', 2), 'hom2265__p2@auth.homfash.internal');
  assert.equal(employeeLoginIdToRotatedAuthEmail('hom2265__p2', 3), 'hom2265__p3@auth.homfash.internal');
  assert.equal(extractAuthEmailRotationIndex('hom2265@auth.homfash.internal', '__p'), 1);
  assert.equal(extractAuthEmailRotationIndex('hom2265__p6@auth.homfash.internal', '__p'), 6);

  // 2. Cryptographically strong temporary password generator produces >= 12 char unique passwords
  const pwd1 = generateStrongTemporaryPassword('Muktai@');
  const pwd2 = generateStrongTemporaryPassword('Admin@');
  assert.ok(pwd1.startsWith('Muktai@') && pwd1.length >= 13);
  assert.ok(pwd2.startsWith('Admin@') && pwd2.length >= 12);
  assert.notEqual(pwd1, pwd2);

  // 3. Service-layer strict Main Owner enforcement & atomic credential rotation + zero plaintext password in audit logs
  const adminSvcSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/services/adminAccessService.ts'), 'utf-8');
  assert.ok(adminSvcSrc.includes('export async function ownerSetAdminPassword('));
  assert.ok(adminSvcSrc.includes('requireMainOwnerActor()'));
  assert.ok(adminSvcSrc.includes('OWNER_SET_ADMIN_PASSWORD'));
  assert.ok(adminSvcSrc.includes('adminUsernameToRotatedAuthEmail'));

  const empSvcSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/services/incentiveService.ts'), 'utf-8');
  assert.ok(empSvcSrc.includes('export async function ownerSetEmployeePassword('));
  assert.ok(empSvcSrc.includes('OWNER_SET_EMPLOYEE_PASSWORD'));
  assert.ok(empSvcSrc.includes('employeeLoginIdToRotatedAuthEmail'));
  assert.ok(empSvcSrc.includes('syncEmployeeAuthUidToExistingRecords'));
  // Ensure ownerSetEmployeePassword never writes plaintext password into audit summary
  const empSetPwdFn = empSvcSrc.match(/export async function ownerSetEmployeePassword[\s\S]*?return \{ employee: updatedEmp, rotated: hasExistingCredential \};/);
  assert.ok(empSetPwdFn, 'ownerSetEmployeePassword implementation must exist');
  assert.ok(empSetPwdFn[0].includes('MAIN_OWNER_EMAIL'), 'Must strictly verify MAIN_OWNER_EMAIL');
  assert.equal(/summary:[\s\S]{0,220}cleanPassword/.test(empSetPwdFn[0]), false, 'Audit log summary must never include plaintext password');

  // 4. AuthContext resolves rotated slots seamlessly for both Admins & Employees and rejects stale slots
  const authCtxSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/context/AuthContext.tsx'), 'utf-8');
  assert.ok(authCtxSrc.includes('adminUsernameToRotatedAuthEmail'));
  assert.ok(authCtxSrc.includes('employeeLoginIdToRotatedAuthEmail'));
  assert.ok(authCtxSrc.includes('MAX_AUTH_ROTATION_SLOTS'));
  assert.ok(authCtxSrc.includes('fetchOwnEmployeeProfile()'));

  // 5. UI exposes Main Owner Set Password controls in both OwnerAdminAccessManager & EmployeeMaster
  const ownerUiSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/admin/OwnerAdminAccessManager.tsx'), 'utf-8');
  assert.ok(ownerUiSrc.includes('ownerSetAdminPassword'));
  assert.ok(ownerUiSrc.includes('Main Owner · Set Admin Password'));
  assert.ok(ownerUiSrc.includes('Set Password'));

  const empMasterUiSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/admin/EmployeeMaster.tsx'), 'utf-8');
  assert.ok(empMasterUiSrc.includes('ownerSetEmployeePassword'));
  assert.ok(empMasterUiSrc.includes('Main Owner · Set Employee Password'));
  assert.ok(empMasterUiSrc.includes('isMainOwner && pwdTargetEmp'));
  assert.ok(empMasterUiSrc.includes('Employee Password Ready'));
});







