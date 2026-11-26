import {
  buildBankNeftTransferDataset,
  buildBranchAttendanceOtAttrition,
  buildBranchExecutiveSummaryRows,
  buildBranchIncentiveDataset,
  buildCsvDocument,
  buildDcrCashDisbursementDataset,
  buildStatutoryComplianceDataset,
  getFilteredBranchSalarySlips,
  paiseToRupeesNumber,
  type BranchFilterInput,
} from '../lib/branchReportsEngine';
import { COMPANY_BRAND } from '../lib/companyBrand';
import { formatMonthLabel } from '../lib/format';
import type { Employee } from '../types/incentive';

const NAVY_ARGB = 'FF0F1F3D';
const GOLD_ARGB = 'FFB8923A';
const SUBHEADER_ARGB = 'FFF1F5F9';
const TOTAL_BG_ARGB = 'FFE2E8F0';
const CURRENCY_FMT = '₹#,##0.00';

function safeFileSlug(raw: string): string {
  return String(raw || 'ALL_BRANCHES')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCsvFile(csvContent: string, fileName: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  triggerBlobDownload(blob, fileName);
}

function resolveBranchLabel(input: BranchFilterInput): string {
  if (input.selectedBranchId === 'ALL') {
    return `All ${input.branches.length} Branches`;
  }
  const found = input.branches.find((b) => b.branchId === input.selectedBranchId);
  return found ? found.branchName : input.selectedBranchId;
}

// Style helper for ExcelJS worksheets
type ExcelWorksheet = import('exceljs').Worksheet;

function addBrandedBanner(
  ws: ExcelWorksheet,
  colCount: number,
  reportTitle: string,
  subtitle: string,
): number {
  ws.mergeCells(1, 1, 1, colCount);
  const r1 = ws.getCell(1, 1);
  r1.value = `${COMPANY_BRAND.brandNameUpper} — ${COMPANY_BRAND.legalName}`;
  r1.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_ARGB } };
  r1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 24;

  ws.mergeCells(2, 1, 2, colCount);
  const r2 = ws.getCell(2, 1);
  r2.value = `${reportTitle}  |  ${subtitle}`;
  r2.font = { bold: true, size: 10, color: { argb: NAVY_ARGB } };
  r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBHEADER_ARGB } };
  r2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;

  ws.views = [{ state: 'frozen', ySplit: 4 }];
  return 4; // Header row index
}

function styleHeaderRow(ws: ExcelWorksheet, rowIndex: number): void {
  const row = ws.getRow(rowIndex);
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_ARGB } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      bottom: { style: 'medium', color: { argb: GOLD_ARGB } },
    };
  });
}

function styleTotalRow(ws: ExcelWorksheet, rowIndex: number, currencyCols: number[]): void {
  const row = ws.getRow(rowIndex);
  row.height = 22;
  row.eachCell((cell, colNum) => {
    cell.font = { bold: true, size: 10, color: { argb: NAVY_ARGB } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG_ARGB } };
    cell.border = {
      top: { style: 'thin', color: { argb: NAVY_ARGB } },
      bottom: { style: 'double', color: { argb: NAVY_ARGB } },
    };
    if (currencyCols.includes(colNum)) {
      cell.numFmt = CURRENCY_FMT;
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
    }
  });
}

function applyColumnWidths(ws: ExcelWorksheet, widths: number[]): void {
  widths.forEach((w, idx) => {
    ws.getColumn(idx + 1).width = w;
  });
}

function formatDataRows(ws: ExcelWorksheet, startRow: number, endRow: number, currencyCols: number[]): void {
  for (let r = startRow; r <= endRow; r += 1) {
    const row = ws.getRow(r);
    row.eachCell((cell, colNum) => {
      cell.font = { size: 10 };
      if (currencyCols.includes(colNum)) {
        cell.numFmt = CURRENCY_FMT;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else {
        cell.alignment = { vertical: 'middle' };
      }
    });
  }
}

async function saveWorkbook(wb: import('exceljs').Workbook, fileName: string): Promise<void> {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerBlobDownload(blob, fileName);
}

// =========================================================================
// WORKSHEET BUILDERS (REUSED BY BOTH SINGLE EXPORTS & COMPLETE BRANCH PACK)
// =========================================================================

function populateExecutiveSummarySheet(
  wb: import('exceljs').Workbook,
  input: BranchFilterInput,
  branchLabel: string,
): void {
  const rows = buildBranchExecutiveSummaryRows(input);
  const ws = wb.addWorksheet('Branch Summary');
  const headers = [
    'Branch Name',
    'Active Staff',
    'Inactive Staff',
    'Salary Slips',
    'Salary Gross (₹)',
    'Total Deductions (₹)',
    'Net Payable (₹)',
    'Bank NEFT (₹)',
    'NEFT Staff',
    'DCR / Cash (₹)',
    'DCR/Cash Staff',
    'Statutory PF+ESIC+PT (₹)',
    'Overtime Pay (₹)',
    'LOP Days',
    'Branch Sales (₹)',
    'Published Incentive (₹)',
  ];
  const headerRowIdx = addBrandedBanner(
    ws,
    headers.length,
    'Branch Executive Summary',
    `${branchLabel} · ${formatMonthLabel(input.selectedMonth)} (${input.selectedMonth})`,
  );
  ws.getRow(headerRowIdx).values = headers;
  styleHeaderRow(ws, headerRowIdx);

  const startRow = headerRowIdx + 1;
  rows.forEach((r) => {
    ws.addRow([
      r.branchName,
      r.activeStaffCount,
      r.inactiveStaffCount,
      r.salarySlipCount,
      paiseToRupeesNumber(r.salaryGrossPaise),
      paiseToRupeesNumber(r.salaryDeductionsPaise),
      paiseToRupeesNumber(r.salaryNetPaise),
      paiseToRupeesNumber(r.neftAmountPaise),
      r.neftStaffCount,
      paiseToRupeesNumber(r.dcrCashAmountPaise),
      r.dcrCashStaffCount,
      paiseToRupeesNumber(r.statutoryTotalPaise),
      paiseToRupeesNumber(r.overtimePaise),
      r.lopDays,
      paiseToRupeesNumber(r.totalSalesPaise),
      paiseToRupeesNumber(r.totalIncentivePaise),
    ]);
  });
  const endRow = startRow + rows.length - 1;
  const currencyCols = [5, 6, 7, 8, 10, 12, 13, 15, 16];
  if (rows.length > 0) formatDataRows(ws, startRow, endRow, currencyCols);

  const totRow = ws.addRow([
    'TOTAL',
    rows.reduce((a, r) => a + r.activeStaffCount, 0),
    rows.reduce((a, r) => a + r.inactiveStaffCount, 0),
    rows.reduce((a, r) => a + r.salarySlipCount, 0),
    paiseToRupeesNumber(rows.reduce((a, r) => a + r.salaryGrossPaise, 0)),
    paiseToRupeesNumber(rows.reduce((a, r) => a + r.salaryDeductionsPaise, 0)),
    paiseToRupeesNumber(rows.reduce((a, r) => a + r.salaryNetPaise, 0)),
    paiseToRupeesNumber(rows.reduce((a, r) => a + r.neftAmountPaise, 0)),
    rows.reduce((a, r) => a + r.neftStaffCount, 0),
    paiseToRupeesNumber(rows.reduce((a, r) => a + r.dcrCashAmountPaise, 0)),
    rows.reduce((a, r) => a + r.dcrCashStaffCount, 0),
    paiseToRupeesNumber(rows.reduce((a, r) => a + r.statutoryTotalPaise, 0)),
    paiseToRupeesNumber(rows.reduce((a, r) => a + r.overtimePaise, 0)),
    Math.round(rows.reduce((a, r) => a + r.lopDays, 0) * 100) / 100,
    paiseToRupeesNumber(rows.reduce((a, r) => a + r.totalSalesPaise, 0)),
    paiseToRupeesNumber(rows.reduce((a, r) => a + r.totalIncentivePaise, 0)),
  ]);
  styleTotalRow(ws, totRow.number, currencyCols);
  applyColumnWidths(ws, [24, 12, 12, 12, 16, 16, 16, 16, 11, 16, 12, 18, 15, 11, 17, 17]);
}

function populateSalaryRegisterSheet(
  wb: import('exceljs').Workbook,
  input: BranchFilterInput,
  branchLabel: string,
): void {
  const slips = getFilteredBranchSalarySlips(
    input.salarySlips,
    input.selectedMonth,
    input.selectedBranchId,
  );
  const ws = wb.addWorksheet('Salary Register');
  const headers = [
    'Sr',
    'EMP ID',
    'Sales ID',
    'Employee Name',
    'Branch',
    'Department',
    'Designation',
    'Total Days',
    'Paid Days',
    'LOP Days',
    'OT Days',
    'Basic (₹)',
    'HRA (₹)',
    'Allowances (₹)',
    'Sales Comm. (₹)',
    'Incentive (₹)',
    'Overtime (₹)',
    'Gross Pay (₹)',
    'PF (₹)',
    'ESIC (₹)',
    'PT (₹)',
    'LWF (₹)',
    'Advance (₹)',
    'Other Ded. (₹)',
    'Total Ded. (₹)',
    'Net Payable (₹)',
    'Pay Mode',
  ];
  const headerRowIdx = addBrandedBanner(
    ws,
    headers.length,
    'Monthly Salary Register',
    `${branchLabel} · ${formatMonthLabel(input.selectedMonth)}`,
  );
  ws.getRow(headerRowIdx).values = headers;
  styleHeaderRow(ws, headerRowIdx);

  const startRow = headerRowIdx + 1;
  slips.forEach((s, idx) => {
    const allowances =
      (s.dearnessAllowancePaise || 0) +
      (s.attendanceAllowancePaise || 0) +
      (s.washingAllowancePaise || 0) +
      (s.conveyancePaise || 0) +
      (s.medicalAllowancePaise || 0) +
      (s.leaveTravelAllowancePaise || 0) +
      (s.communicationExpensesPaise || 0) +
      (s.healthClubAllowancePaise || 0) +
      (s.adhocAllowancePaise || 0) +
      (s.travelingAllowancePaise || 0) +
      (s.specialAllowancePaise || 0) +
      (s.arrearsPaise || 0) +
      (s.otherEarningsPaise || 0);
    const otherDed =
      (s.tdsPaise || 0) +
      (s.penaltyPaise || 0) +
      (s.insurancePaise || 0) +
      (s.otherDeductionPaise || 0);

    ws.addRow([
      idx + 1,
      s.employeeId,
      s.saleId || '',
      s.employeeName,
      s.branchName,
      s.departmentName || '',
      s.designation || '',
      s.totalDays,
      s.paidDays,
      s.lopDays,
      s.overtimeDays || 0,
      paiseToRupeesNumber(s.basicPaise),
      paiseToRupeesNumber(s.hraPaise),
      paiseToRupeesNumber(allowances),
      paiseToRupeesNumber(s.salesCommissionPaise || 0),
      paiseToRupeesNumber(s.incentivePaise),
      paiseToRupeesNumber(s.overtimePaise),
      paiseToRupeesNumber(s.grossEarningsPaise),
      paiseToRupeesNumber(s.pfPaise),
      paiseToRupeesNumber(s.esicPaise),
      paiseToRupeesNumber(s.ptPaise),
      paiseToRupeesNumber(s.lwfPaise || 0),
      paiseToRupeesNumber(s.advanceRecoveryPaise),
      paiseToRupeesNumber(otherDed),
      paiseToRupeesNumber(s.totalDeductionsPaise),
      paiseToRupeesNumber(s.netPayablePaise),
      s.paymentMode || '',
    ]);
  });
  const endRow = startRow + slips.length - 1;
  const currencyCols = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
  if (slips.length > 0) formatDataRows(ws, startRow, endRow, currencyCols);

  const totRow = ws.addRow([
    '',
    '',
    '',
    `TOTAL (${slips.length} Staff)`,
    '',
    '',
    '',
    '',
    '',
    Math.round(slips.reduce((a, s) => a + (s.lopDays || 0), 0) * 100) / 100,
    Math.round(slips.reduce((a, s) => a + (s.overtimeDays || 0), 0) * 100) / 100,
    paiseToRupeesNumber(slips.reduce((a, s) => a + s.basicPaise, 0)),
    paiseToRupeesNumber(slips.reduce((a, s) => a + s.hraPaise, 0)),
    paiseToRupeesNumber(
      slips.reduce(
        (a, s) =>
          a +
          (s.grossEarningsPaise -
            s.basicPaise -
            s.hraPaise -
            (s.salesCommissionPaise || 0) -
            s.incentivePaise -
            s.overtimePaise),
        0,
      ),
    ),
    paiseToRupeesNumber(slips.reduce((a, s) => a + (s.salesCommissionPaise || 0), 0)),
    paiseToRupeesNumber(slips.reduce((a, s) => a + s.incentivePaise, 0)),
    paiseToRupeesNumber(slips.reduce((a, s) => a + s.overtimePaise, 0)),
    paiseToRupeesNumber(slips.reduce((a, s) => a + s.grossEarningsPaise, 0)),
    paiseToRupeesNumber(slips.reduce((a, s) => a + s.pfPaise, 0)),
    paiseToRupeesNumber(slips.reduce((a, s) => a + s.esicPaise, 0)),
    paiseToRupeesNumber(slips.reduce((a, s) => a + s.ptPaise, 0)),
    paiseToRupeesNumber(slips.reduce((a, s) => a + (s.lwfPaise || 0), 0)),
    paiseToRupeesNumber(slips.reduce((a, s) => a + s.advanceRecoveryPaise, 0)),
    paiseToRupeesNumber(
      slips.reduce(
        (a, s) =>
          a +
          (s.tdsPaise + (s.penaltyPaise || 0) + (s.insurancePaise || 0) + s.otherDeductionPaise),
        0,
      ),
    ),
    paiseToRupeesNumber(slips.reduce((a, s) => a + s.totalDeductionsPaise, 0)),
    paiseToRupeesNumber(slips.reduce((a, s) => a + s.netPayablePaise, 0)),
    '',
  ]);
  styleTotalRow(ws, totRow.number, currencyCols);
  applyColumnWidths(
    ws,
    [6, 11, 10, 26, 20, 16, 16, 10, 10, 9, 9, 13, 12, 14, 14, 13, 13, 15, 11, 11, 10, 10, 13, 13, 14, 16, 11],
  );
}

function populateBankNeftSheet(
  wb: import('exceljs').Workbook,
  input: BranchFilterInput,
  branchLabel: string,
): void {
  const dataset = buildBankNeftTransferDataset({
    salarySlips: input.salarySlips,
    employees: input.employees,
    selectedMonth: input.selectedMonth,
    selectedBranchId: input.selectedBranchId,
  });
  const ws = wb.addWorksheet('Bank NEFT Transfer');
  const headers = [
    'Sr No',
    'Employee ID',
    'Beneficiary Name',
    'Branch',
    'Department',
    'Bank Name',
    'Account Number',
    'IFSC Code',
    'Net Amount (₹)',
    'Mode',
    'Narration',
    'Bank Status',
  ];
  const headerRowIdx = addBrandedBanner(
    ws,
    headers.length,
    'Bank NEFT Bulk Transfer Sheet',
    `${branchLabel} · ${formatMonthLabel(input.selectedMonth)} · ${dataset.rows.length} Transfers`,
  );
  ws.getRow(headerRowIdx).values = headers;
  styleHeaderRow(ws, headerRowIdx);

  const startRow = headerRowIdx + 1;
  dataset.rows.forEach((r) => {
    ws.addRow([
      r.srNo,
      r.employeeId,
      r.employeeName,
      r.branchName,
      r.departmentName,
      r.bankName,
      r.bankAccount,
      r.bankIfsc,
      paiseToRupeesNumber(r.netPayablePaise),
      r.paymentMode,
      r.narration,
      r.bankDetailsComplete ? 'READY' : 'MISSING ACCOUNT/IFSC',
    ]);
  });
  const endRow = startRow + dataset.rows.length - 1;
  if (dataset.rows.length > 0) formatDataRows(ws, startRow, endRow, [9]);

  const totRow = ws.addRow([
    '',
    '',
    `TOTAL NEFT (${dataset.rows.length} Staff)`,
    '',
    '',
    '',
    '',
    '',
    paiseToRupeesNumber(dataset.totalAmountPaise),
    '',
    '',
    dataset.missingBankDetailsCount > 0 ? `${dataset.missingBankDetailsCount} Missing` : 'ALL READY',
  ]);
  styleTotalRow(ws, totRow.number, [9]);
  applyColumnWidths(ws, [7, 12, 26, 20, 16, 20, 18, 15, 16, 10, 22, 20]);
}

function populateDcrCashSheet(
  wb: import('exceljs').Workbook,
  input: BranchFilterInput,
  branchLabel: string,
): void {
  const dataset = buildDcrCashDisbursementDataset({
    salarySlips: input.salarySlips,
    selectedMonth: input.selectedMonth,
    selectedBranchId: input.selectedBranchId,
  });
  const ws = wb.addWorksheet('DCR & Cash Voucher');
  const headers = [
    'Sr No',
    'Employee ID',
    'Employee Name',
    'Branch',
    'Department',
    'Designation',
    'Paid / Total Days',
    'Net Payable (₹)',
    'Mode',
    'Receiver Signature',
  ];
  const headerRowIdx = addBrandedBanner(
    ws,
    headers.length,
    'DCR / Cash Salary Disbursement Voucher',
    `${branchLabel} · ${formatMonthLabel(input.selectedMonth)} · ${dataset.rows.length} Staff`,
  );
  ws.getRow(headerRowIdx).values = headers;
  styleHeaderRow(ws, headerRowIdx);

  const startRow = headerRowIdx + 1;
  dataset.rows.forEach((r) => {
    ws.addRow([
      r.srNo,
      r.employeeId,
      r.employeeName,
      r.branchName,
      r.departmentName,
      r.designation,
      `${r.paidDays} / ${r.totalDays}`,
      paiseToRupeesNumber(r.netPayablePaise),
      r.paymentMode,
      '',
    ]);
  });
  const endRow = startRow + dataset.rows.length - 1;
  if (dataset.rows.length > 0) formatDataRows(ws, startRow, endRow, [8]);

  const totRow = ws.addRow([
    '',
    '',
    `TOTAL DCR / CASH (${dataset.rows.length} Staff)`,
    '',
    '',
    '',
    '',
    paiseToRupeesNumber(dataset.totalAmountPaise),
    '',
    '',
  ]);
  styleTotalRow(ws, totRow.number, [8]);
  applyColumnWidths(ws, [7, 12, 26, 20, 16, 16, 15, 16, 12, 24]);
}

function populateStatutorySheet(
  wb: import('exceljs').Workbook,
  input: BranchFilterInput,
  branchLabel: string,
): void {
  const dataset = buildStatutoryComplianceDataset({
    salarySlips: input.salarySlips,
    employees: input.employees,
    selectedMonth: input.selectedMonth,
    selectedBranchId: input.selectedBranchId,
  });
  const ws = wb.addWorksheet('PF ESIC PT LWF');
  const headers = [
    'Sr No',
    'Employee ID',
    'Employee Name',
    'Branch',
    'UAN Number',
    'PF Number',
    'ESIC Number',
    'PAN Number',
    'Gross Wages (₹)',
    'Basic Wages (₹)',
    'PF Deduction (₹)',
    'ESIC Deduction (₹)',
    'PT Deduction (₹)',
    'LWF (₹)',
    'TDS (₹)',
    'Total Statutory (₹)',
  ];
  const headerRowIdx = addBrandedBanner(
    ws,
    headers.length,
    'Monthly Statutory Compliance Challan (PF / ESIC / PT / LWF / TDS)',
    `${branchLabel} · ${formatMonthLabel(input.selectedMonth)}`,
  );
  ws.getRow(headerRowIdx).values = headers;
  styleHeaderRow(ws, headerRowIdx);

  const startRow = headerRowIdx + 1;
  dataset.rows.forEach((r) => {
    ws.addRow([
      r.srNo,
      r.employeeId,
      r.employeeName,
      r.branchName,
      r.uanNumber,
      r.pfNumber,
      r.esicNumber,
      r.panNumber,
      paiseToRupeesNumber(r.grossEarningsPaise),
      paiseToRupeesNumber(r.basicPaise),
      paiseToRupeesNumber(r.pfPaise),
      paiseToRupeesNumber(r.esicPaise),
      paiseToRupeesNumber(r.ptPaise),
      paiseToRupeesNumber(r.lwfPaise),
      paiseToRupeesNumber(r.tdsPaise),
      paiseToRupeesNumber(r.totalStatutoryPaise),
    ]);
  });
  const endRow = startRow + dataset.rows.length - 1;
  const currencyCols = [9, 10, 11, 12, 13, 14, 15, 16];
  if (dataset.rows.length > 0) formatDataRows(ws, startRow, endRow, currencyCols);

  const totRow = ws.addRow([
    '',
    '',
    `TOTAL (${dataset.rows.length} Staff)`,
    '',
    '',
    '',
    '',
    '',
    paiseToRupeesNumber(dataset.totals.grossEarningsPaise),
    paiseToRupeesNumber(dataset.totals.basicPaise),
    paiseToRupeesNumber(dataset.totals.pfPaise),
    paiseToRupeesNumber(dataset.totals.esicPaise),
    paiseToRupeesNumber(dataset.totals.ptPaise),
    paiseToRupeesNumber(dataset.totals.lwfPaise),
    paiseToRupeesNumber(dataset.totals.tdsPaise),
    paiseToRupeesNumber(dataset.totals.totalStatutoryPaise),
  ]);
  styleTotalRow(ws, totRow.number, currencyCols);
  applyColumnWidths(ws, [7, 12, 26, 20, 16, 16, 16, 14, 15, 15, 14, 14, 13, 11, 11, 16]);
}

function populateIncentiveSheet(
  wb: import('exceljs').Workbook,
  input: BranchFilterInput,
  branchLabel: string,
): void {
  const dataset = buildBranchIncentiveDataset({
    monthlySummaries: input.monthlySummaries,
    employees: input.employees,
    payoutRecords: input.payoutRecords,
    adjustments: input.adjustments,
    selectedMonth: input.selectedMonth,
    selectedBranchId: input.selectedBranchId,
  });
  const ws = wb.addWorksheet('Sales & Incentives');
  const headers = [
    'Sr No',
    'EMP ID',
    'Sales ID',
    'Employee Name',
    'Branch',
    'Department',
    'New Items Sale (₹)',
    'New Items Inc (₹)',
    'Old Items Sale (₹)',
    'Old Items Inc (₹)',
    'Other Sale (₹)',
    'Other Inc (₹)',
    'Total Sales (₹)',
    'Total Qty',
    'Gross Incentive (₹)',
    'Adjustments (₹)',
    'Net Payable (₹)',
    'Payout Status',
  ];
  const headerRowIdx = addBrandedBanner(
    ws,
    headers.length,
    'Branch Sales & Incentive Ledger',
    `${branchLabel} · ${formatMonthLabel(input.selectedMonth)}`,
  );
  ws.getRow(headerRowIdx).values = headers;
  styleHeaderRow(ws, headerRowIdx);

  const startRow = headerRowIdx + 1;
  dataset.rows.forEach((r) => {
    ws.addRow([
      r.srNo,
      r.employeeId,
      r.saleId,
      r.employeeName,
      r.branchName,
      r.departmentName,
      paiseToRupeesNumber(r.saleAmt1Paise),
      paiseToRupeesNumber(r.inc1Paise),
      paiseToRupeesNumber(r.saleAmt2Paise),
      paiseToRupeesNumber(r.inc2Paise),
      paiseToRupeesNumber(r.saleAmt3Paise),
      paiseToRupeesNumber(r.inc3Paise),
      paiseToRupeesNumber(r.totalSaleAmtPaise),
      r.totalSaleQty,
      paiseToRupeesNumber(r.grossIncentivePaise),
      paiseToRupeesNumber(r.adjustmentsNetPaise),
      paiseToRupeesNumber(r.netPayablePaise),
      r.payoutStatus,
    ]);
  });
  const endRow = startRow + dataset.rows.length - 1;
  const currencyCols = [7, 8, 9, 10, 11, 12, 13, 15, 16, 17];
  if (dataset.rows.length > 0) formatDataRows(ws, startRow, endRow, currencyCols);

  const totRow = ws.addRow([
    '',
    '',
    '',
    `TOTAL (${dataset.rows.length} Staff)`,
    '',
    '',
    paiseToRupeesNumber(dataset.rows.reduce((a, r) => a + r.saleAmt1Paise, 0)),
    paiseToRupeesNumber(dataset.rows.reduce((a, r) => a + r.inc1Paise, 0)),
    paiseToRupeesNumber(dataset.rows.reduce((a, r) => a + r.saleAmt2Paise, 0)),
    paiseToRupeesNumber(dataset.rows.reduce((a, r) => a + r.inc2Paise, 0)),
    paiseToRupeesNumber(dataset.rows.reduce((a, r) => a + r.saleAmt3Paise, 0)),
    paiseToRupeesNumber(dataset.rows.reduce((a, r) => a + r.inc3Paise, 0)),
    paiseToRupeesNumber(dataset.totals.totalSaleAmtPaise),
    dataset.totals.totalSaleQty,
    paiseToRupeesNumber(dataset.totals.grossIncentivePaise),
    paiseToRupeesNumber(dataset.totals.adjustmentsNetPaise),
    paiseToRupeesNumber(dataset.totals.netPayablePaise),
    `${dataset.totals.paidCount} Paid`,
  ]);
  styleTotalRow(ws, totRow.number, currencyCols);
  applyColumnWidths(ws, [7, 11, 10, 26, 20, 16, 15, 14, 15, 14, 14, 13, 16, 11, 16, 14, 16, 14]);
}

function populateAttendanceOtAttritionSheet(
  wb: import('exceljs').Workbook,
  input: BranchFilterInput,
  branchLabel: string,
): void {
  const analytics = buildBranchAttendanceOtAttrition({
    branches: input.branches,
    employees: input.employees,
    salarySlips: input.salarySlips,
    selectedMonth: input.selectedMonth,
    selectedBranchId: input.selectedBranchId,
  });
  const ws = wb.addWorksheet('OT, LOP & Attrition');
  const headers = [
    'Branch Name',
    'Active Staff',
    'Inactive Staff',
    'Attrition %',
    'New Joiners (Month)',
    'Total OT Days',
    'Total OT Hours',
    'Overtime Pay (₹)',
    'Total LOP Days',
    'High LOP Staff (>=4d)',
    'High OT Staff',
  ];
  const headerRowIdx = addBrandedBanner(
    ws,
    headers.length,
    'Branch Overtime, LOP & Attrition Summary',
    `${branchLabel} · ${formatMonthLabel(input.selectedMonth)}`,
  );
  ws.getRow(headerRowIdx).values = headers;
  styleHeaderRow(ws, headerRowIdx);

  const startRow = headerRowIdx + 1;
  analytics.branchRows.forEach((r) => {
    ws.addRow([
      r.branchName,
      r.activeStaffCount,
      r.inactiveStaffCount,
      `${r.attritionPct}%`,
      r.newJoinersCount,
      r.totalOvertimeDays,
      r.totalOvertimeHours,
      paiseToRupeesNumber(r.totalOvertimePaise),
      r.totalLopDays,
      r.highLopStaffCount,
      r.highOtStaffCount,
    ]);
  });
  const endRow = startRow + analytics.branchRows.length - 1;
  if (analytics.branchRows.length > 0) formatDataRows(ws, startRow, endRow, [8]);

  const totRow = ws.addRow([
    'TOTAL',
    analytics.companyTotals.activeStaffCount,
    analytics.companyTotals.inactiveStaffCount,
    `${analytics.companyTotals.attritionPct}%`,
    analytics.companyTotals.newJoinersCount,
    analytics.companyTotals.totalOvertimeDays,
    analytics.companyTotals.totalOvertimeHours,
    paiseToRupeesNumber(analytics.companyTotals.totalOvertimePaise),
    analytics.companyTotals.totalLopDays,
    analytics.companyTotals.highLopStaffCount,
    analytics.companyTotals.highOtStaffCount,
  ]);
  styleTotalRow(ws, totRow.number, [8]);
  applyColumnWidths(ws, [24, 13, 13, 12, 18, 13, 14, 16, 14, 18, 14]);
}

function populateEmployeeRosterSheet(
  wb: import('exceljs').Workbook,
  input: BranchFilterInput,
  branchLabel: string,
): void {
  const list: Employee[] = input.employees
    .filter(
      (e) =>
        input.selectedBranchId === 'ALL' || e.branchId === input.selectedBranchId,
    )
    .sort(
      (a, b) =>
        a.branchName.localeCompare(b.branchName) || a.fullName.localeCompare(b.fullName),
    );
  const ws = wb.addWorksheet('Employee Roster');
  const headers = [
    'Sr No',
    'EMP ID',
    'Sales ID',
    'Login ID',
    'Employee Name',
    'Branch',
    'Department',
    'Designation',
    'DOJ',
    'Phone',
    'Bank Name',
    'Account',
    'IFSC',
    'UAN',
    'Status',
    'Login Status',
  ];
  const headerRowIdx = addBrandedBanner(
    ws,
    headers.length,
    'Branch Employee Master Roster',
    `${branchLabel} · ${list.length} Employee(s)`,
  );
  ws.getRow(headerRowIdx).values = headers;
  styleHeaderRow(ws, headerRowIdx);

  list.forEach((e, idx) => {
    ws.addRow([
      idx + 1,
      e.employeeId,
      e.saleId || '',
      e.loginId,
      e.fullName,
      e.branchName,
      e.departmentName || '',
      e.designation,
      e.dateOfJoining || '',
      e.phone || '',
      e.bankName || '',
      e.bankAccountMasked || '',
      e.bankIfsc || '',
      e.uanNumber || '',
      e.status,
      e.credentialsProvisioned && e.authUid ? 'ACTIVE' : 'PENDING',
    ]);
  });
  applyColumnWidths(ws, [7, 11, 10, 14, 26, 20, 16, 18, 12, 14, 18, 16, 14, 15, 10, 12]);
}

// =========================================================================
// PUBLIC DOWNLOAD FUNCTIONS
// =========================================================================

export async function downloadCompleteBranchReportPackXlsx(
  input: BranchFilterInput,
): Promise<void> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY_BRAND.legalName;
  wb.created = new Date();

  const branchLabel = resolveBranchLabel(input);
  populateExecutiveSummarySheet(wb, input, branchLabel);
  populateSalaryRegisterSheet(wb, input, branchLabel);
  populateBankNeftSheet(wb, input, branchLabel);
  populateDcrCashSheet(wb, input, branchLabel);
  populateStatutorySheet(wb, input, branchLabel);
  populateIncentiveSheet(wb, input, branchLabel);
  populateAttendanceOtAttritionSheet(wb, input, branchLabel);
  populateEmployeeRosterSheet(wb, input, branchLabel);

  const slug = safeFileSlug(branchLabel);
  await saveWorkbook(
    wb,
    `HouseOfMuktai_BranchReportPack_${slug}_${input.selectedMonth}.xlsx`,
  );
}

export async function downloadBankNeftExportXlsx(input: BranchFilterInput): Promise<void> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const branchLabel = resolveBranchLabel(input);
  populateBankNeftSheet(wb, input, branchLabel);
  await saveWorkbook(
    wb,
    `HouseOfMuktai_BankNEFT_${safeFileSlug(branchLabel)}_${input.selectedMonth}.xlsx`,
  );
}

export function downloadBankNeftExportCsv(input: BranchFilterInput): void {
  const dataset = buildBankNeftTransferDataset({
    salarySlips: input.salarySlips,
    employees: input.employees,
    selectedMonth: input.selectedMonth,
    selectedBranchId: input.selectedBranchId,
  });
  const branchLabel = resolveBranchLabel(input);
  const csv = buildCsvDocument(
    [
      'Sr No',
      'Employee ID',
      'Beneficiary Name',
      'Branch',
      'Bank Name',
      'Account Number',
      'IFSC Code',
      'Amount (INR)',
      'Mode',
      'Narration',
    ],
    dataset.rows.map((r) => [
      r.srNo,
      r.employeeId,
      r.employeeName,
      r.branchName,
      r.bankName,
      r.bankAccount,
      r.bankIfsc,
      paiseToRupeesNumber(r.netPayablePaise).toFixed(2),
      r.paymentMode,
      r.narration,
    ]),
  );
  downloadCsvFile(
    csv,
    `HouseOfMuktai_BankNEFT_${safeFileSlug(branchLabel)}_${input.selectedMonth}.csv`,
  );
}

export async function downloadDcrCashExportXlsx(input: BranchFilterInput): Promise<void> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const branchLabel = resolveBranchLabel(input);
  populateDcrCashSheet(wb, input, branchLabel);
  await saveWorkbook(
    wb,
    `HouseOfMuktai_DCR_Cash_${safeFileSlug(branchLabel)}_${input.selectedMonth}.xlsx`,
  );
}

export function downloadDcrCashExportCsv(input: BranchFilterInput): void {
  const dataset = buildDcrCashDisbursementDataset({
    salarySlips: input.salarySlips,
    selectedMonth: input.selectedMonth,
    selectedBranchId: input.selectedBranchId,
  });
  const branchLabel = resolveBranchLabel(input);
  const csv = buildCsvDocument(
    ['Sr No', 'Employee ID', 'Employee Name', 'Branch', 'Department', 'Paid Days', 'Net Payable (INR)', 'Mode'],
    dataset.rows.map((r) => [
      r.srNo,
      r.employeeId,
      r.employeeName,
      r.branchName,
      r.departmentName,
      r.paidDays,
      paiseToRupeesNumber(r.netPayablePaise).toFixed(2),
      r.paymentMode,
    ]),
  );
  downloadCsvFile(
    csv,
    `HouseOfMuktai_DCR_Cash_${safeFileSlug(branchLabel)}_${input.selectedMonth}.csv`,
  );
}

export async function downloadStatutoryComplianceXlsx(input: BranchFilterInput): Promise<void> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const branchLabel = resolveBranchLabel(input);
  populateStatutorySheet(wb, input, branchLabel);
  await saveWorkbook(
    wb,
    `HouseOfMuktai_Statutory_PF_ESIC_PT_${safeFileSlug(branchLabel)}_${input.selectedMonth}.xlsx`,
  );
}

export function downloadStatutoryComplianceCsv(input: BranchFilterInput): void {
  const dataset = buildStatutoryComplianceDataset({
    salarySlips: input.salarySlips,
    employees: input.employees,
    selectedMonth: input.selectedMonth,
    selectedBranchId: input.selectedBranchId,
  });
  const branchLabel = resolveBranchLabel(input);
  const csv = buildCsvDocument(
    [
      'Sr No',
      'Employee ID',
      'Employee Name',
      'Branch',
      'UAN',
      'PF No',
      'ESIC No',
      'PAN',
      'Gross (INR)',
      'Basic (INR)',
      'PF (INR)',
      'ESIC (INR)',
      'PT (INR)',
      'LWF (INR)',
      'TDS (INR)',
      'Total Statutory (INR)',
    ],
    dataset.rows.map((r) => [
      r.srNo,
      r.employeeId,
      r.employeeName,
      r.branchName,
      r.uanNumber,
      r.pfNumber,
      r.esicNumber,
      r.panNumber,
      paiseToRupeesNumber(r.grossEarningsPaise).toFixed(2),
      paiseToRupeesNumber(r.basicPaise).toFixed(2),
      paiseToRupeesNumber(r.pfPaise).toFixed(2),
      paiseToRupeesNumber(r.esicPaise).toFixed(2),
      paiseToRupeesNumber(r.ptPaise).toFixed(2),
      paiseToRupeesNumber(r.lwfPaise).toFixed(2),
      paiseToRupeesNumber(r.tdsPaise).toFixed(2),
      paiseToRupeesNumber(r.totalStatutoryPaise).toFixed(2),
    ]),
  );
  downloadCsvFile(
    csv,
    `HouseOfMuktai_Statutory_PF_ESIC_PT_${safeFileSlug(branchLabel)}_${input.selectedMonth}.csv`,
  );
}

export async function downloadBranchSalaryRegisterXlsx(input: BranchFilterInput): Promise<void> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const branchLabel = resolveBranchLabel(input);
  populateSalaryRegisterSheet(wb, input, branchLabel);
  await saveWorkbook(
    wb,
    `HouseOfMuktai_SalaryRegister_${safeFileSlug(branchLabel)}_${input.selectedMonth}.xlsx`,
  );
}

export async function downloadBranchIncentiveReportXlsx(input: BranchFilterInput): Promise<void> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const branchLabel = resolveBranchLabel(input);
  populateIncentiveSheet(wb, input, branchLabel);
  await saveWorkbook(
    wb,
    `HouseOfMuktai_IncentiveReport_${safeFileSlug(branchLabel)}_${input.selectedMonth}.xlsx`,
  );
}

export async function downloadAttendanceOtAttritionXlsx(input: BranchFilterInput): Promise<void> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const branchLabel = resolveBranchLabel(input);
  populateAttendanceOtAttritionSheet(wb, input, branchLabel);
  await saveWorkbook(
    wb,
    `HouseOfMuktai_OT_LOP_Attrition_${safeFileSlug(branchLabel)}_${input.selectedMonth}.xlsx`,
  );
}

export async function downloadBranchEmployeeRosterXlsx(input: BranchFilterInput): Promise<void> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const branchLabel = resolveBranchLabel(input);
  populateEmployeeRosterSheet(wb, input, branchLabel);
  await saveWorkbook(
    wb,
    `HouseOfMuktai_EmployeeRoster_${safeFileSlug(branchLabel)}_${input.selectedMonth}.xlsx`,
  );
}
