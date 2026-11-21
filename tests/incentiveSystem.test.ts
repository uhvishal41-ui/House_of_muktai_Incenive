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
  buildManagementReportWorkbook,
  buildSampleTemplateWorkbook,
  parseExcelBuffer,
} from '../server/excelEngine.ts';
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
  partitionEmployeeRecords,
  resolveCanonicalBranchName,
  validateImportBatch,
} from '../src/lib/incentiveEngine.ts';
import type {
  Branch,
  Employee,
  PublishedIncentive,
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
// TEST 31: Super Admin Batch Edit, Update & Delete Security Rules Invariants
// =========================================================================
test('31. firestore.rules supports Super Admin audited batch edit/update/delete while keeping audit_logs, incentive_versions & employees undeletable', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  const rulesNoComments = rulesText.replace(/\/\/[^\n]*/g, '');

  // import_batches allows Super Admin delete & audited PUBLISHED metadata/totals update (status locked to PUBLISHED)
  const batchBlockMatch = rulesNoComments.match(/match \/import_batches\/\{batchId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(batchBlockMatch, 'import_batches match block must exist');
  assert.match(batchBlockMatch[0], /allow delete: if isValidId\(batchId\) && isSuperAdmin\(\);/);
  assert.match(batchBlockMatch[0], /existing\(\)\.status == 'PUBLISHED'\s*&& incoming\(\)\.status == 'PUBLISHED'/);
  assert.match(batchBlockMatch[0], /'totalSaleAmtPaise'/);
  assert.match(batchBlockMatch[0], /'totalSaleQty'/);

  // import_batch_rows allows Super Admin row amount/qty edits & delete
  const rowsBlockMatch = rulesNoComments.match(/match \/import_batch_rows\/\{rowId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(rowsBlockMatch, 'import_batch_rows match block must exist');
  assert.match(rowsBlockMatch[0], /allow delete: if isValidId\(rowId\) && isSuperAdmin\(\);/);
  assert.match(rowsBlockMatch[0], /'component1Paise'/);
  assert.match(rowsBlockMatch[0], /'saleAmt1Paise'/);

  // published_incentives, monthly_summaries & notifications permit Super Admin rollback delete
  const pubBlockMatch = rulesNoComments.match(/match \/published_incentives\/\{recordId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(pubBlockMatch, 'published_incentives match block must exist');
  assert.match(pubBlockMatch[0], /allow delete: if isValidId\(recordId\) && isSuperAdmin\(\);/);

  const summaryBlockMatch = rulesNoComments.match(/match \/monthly_summaries\/\{summaryId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(summaryBlockMatch, 'monthly_summaries match block must exist');
  assert.match(summaryBlockMatch[0], /allow delete: if isValidId\(summaryId\) && isSuperAdmin\(\);/);

  // Immutable audit logs, version history & employees MUST remain undeletable
  const auditBlockMatch = rulesNoComments.match(/match \/audit_logs\/\{logId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(auditBlockMatch && /allow update, delete: if false;/.test(auditBlockMatch[0]));
  const verBlockMatch = rulesNoComments.match(/match \/incentive_versions\/\{versionId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(verBlockMatch && /allow update, delete: if false;/.test(verBlockMatch[0]));
  const empBlockMatch = rulesNoComments.match(/match \/employees\/\{employeeId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(empBlockMatch && /allow delete: if false;/.test(empBlockMatch[0]));
});

// =========================================================================
// TEST 32: Complete 15-Collection Backup Manifest & Domain Hygiene Invariants
// =========================================================================
test('32. BACKUP_COLLECTION_NAMES covers all 15 Firestore collections and operationsService uses houseofmuktai.co.in fallback', () => {
  const serviceText = fs.readFileSync(
    path.resolve(process.cwd(), 'src/services/incentiveService.ts'),
    'utf-8',
  );
  const backupArrayMatch = serviceText.match(
    /export const BACKUP_COLLECTION_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const;/,
  );
  assert.ok(backupArrayMatch, 'BACKUP_COLLECTION_NAMES export must exist');

  const expected15Collections = [
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
  ];

  for (const col of expected15Collections) {
    assert.ok(
      backupArrayMatch[1].includes(`'${col}'`),
      `BACKUP_COLLECTION_NAMES must include '${col}'`,
    );
  }
  const quotedItems = backupArrayMatch[1].match(/'[^']+'/g) || [];
  assert.equal(quotedItems.length, 15, 'BACKUP_COLLECTION_NAMES must contain all 15 collections');

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

  // 2. payout_records, incentive_adjustments, and sales_targets strictly gate by isActiveEmployee() + (authUid || activeEmployeeId())
  const payoutBlock = rulesNoComments.match(/match \/payout_records\/\{payoutId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(payoutBlock, 'payout_records match block must exist');
  assert.match(payoutBlock[0], /isActiveEmployee\(\) && \(existing\(\)\.authUid == request\.auth\.uid \|\| existing\(\)\.employeeId == activeEmployeeId\(\)\)/);
  assert.match(payoutBlock[0], /isActiveEmployee\(\) && \(resource\.data\.authUid == request\.auth\.uid \|\| resource\.data\.employeeId == activeEmployeeId\(\)\)/);

  const adjBlock = rulesNoComments.match(/match \/incentive_adjustments\/\{adjustmentId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(adjBlock, 'incentive_adjustments match block must exist');
  assert.match(adjBlock[0], /isActiveEmployee\(\) && resource\.data\.status == 'ACTIVE' && \(resource\.data\.authUid == request\.auth\.uid \|\| resource\.data\.employeeId == activeEmployeeId\(\)\)/);

  const targetBlock = rulesNoComments.match(/match \/sales_targets\/\{targetId\}\s*\{[\s\S]*?\n    \}/);
  assert.ok(targetBlock, 'sales_targets match block must exist');
  assert.match(targetBlock[0], /isActiveEmployee\(\) && \(resource\.data\.scope == 'BRANCH' \|\| resource\.data\.authUid == request\.auth\.uid \|\| resource\.data\.employeeId == activeEmployeeId\(\)\)/);

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

  // 4. operationsService.ts supports dual authUid + employeeId subscription, batch payout upsert, and operational sync
  const opsText = fs.readFileSync(
    path.resolve(process.cwd(), 'src/services/operationsService.ts'),
    'utf-8',
  );
  assert.ok(opsText.includes('export async function upsertPayoutRecordsBatch'));
  assert.ok(opsText.includes('export async function syncOperationalAuthUids'));
  assert.ok(opsText.includes("query(collection(db, 'payout_records'), where('employeeId', '==', cleanEmpId))"));
});


