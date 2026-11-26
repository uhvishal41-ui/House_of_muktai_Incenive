import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { COMPANY_BRAND } from '../src/lib/companyBrand.ts';
import {
  classifyImportPeriod,
  parseDmyToIsoStrict,
  parseExcelDateCellToIso,
} from '../src/lib/incentiveEngine.ts';
import type {
  ExcelColumnMapping,
  ExcelParseResponse,
  ParsedExcelRow,
} from '../src/types/incentive.ts';

// Keep Sale Amt / Sale Qty columns for per-section sales & incentive reporting; only ignore unrelated invoice/revenue columns
const SALES_HEADER_REGEX = /\b(total\s*sales|net\s*sales|gross\s*sales|revenue|turnover|bill\s*value|invoice\s*amt)\b/i;

const SALE_AMT_COLUMN_REGEX = /\bsales?\s*(amt|amount)\b/i;
const SALE_QTY_COLUMN_REGEX = /\bsales?\s*(qty|quantity)\b/i;

const KNOWN_HEADER_SIGNALS = [
  /^date$/i,
  /incentive\s*date/i,
  /business\s*date/i,
  /^name$/i,
  /sales\s*person\s*name/i,
  /salesman\s*no/i,
  /sell[\s_-]*(id|code|no)/i,
  /sale[\s_-]*(id|code|no)/i,
  /emp(loyee)?[\s_-]*(id|code|no)/i,
  /branch/i,
  /incentive/i,
  /old\s+(?:item\s+)?incentive/i,
  /new\s*items?\s*sale/i,
  /old\s*items?\s*sale/i,
  /other\s*items?\s*sale/i,
  /\bsales?\s*(amt|amount|qty|quantity)\b/i,
];

function extractCellPrimitive(value: ExcelJS.CellValue): string | number | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return formatDateIST(value);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  if (typeof value === 'object') {
    if ('result' in value && value.result !== undefined && value.result !== null) {
      return extractCellPrimitive(value.result as ExcelJS.CellValue);
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim() || null;
    }
    if ('text' in value && typeof value.text === 'string') {
      return value.text.trim() || null;
    }
  }

  return null;
}

export function formatDateIST(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

function extractBannerMetadata(worksheet: ExcelJS.Worksheet, headerRowNumber: number): {
  reportTitle: string;
  reportDateRangeText: string;
  detectedFromDate: string | null;
  detectedToDate: string | null;
} {
  const bannerTexts: string[] = [];
  for (let r = 1; r < headerRowNumber; r++) {
    const row = worksheet.getRow(r);
    const seenInRow = new Set<string>();
    row.eachCell({ includeEmpty: false }, (cell) => {
      const val = String(extractCellPrimitive(cell.value) ?? '').trim();
      if (val && !seenInRow.has(val)) {
        seenInRow.add(val);
        bannerTexts.push(val);
      }
    });
  }

  let reportTitle = '';
  let reportDateRangeText = '';
  let detectedFromDate: string | null = null;
  let detectedToDate: string | null = null;

  for (const text of bannerTexts) {
    // Match "As On :-01-10-2026 To 31-10-2026", "2026-10-01 to 2026-10-31", etc.
    const rangeMatch = text.match(
      /(\d{1,4}[/-]\d{1,2}[/-]\d{2,4})\s*(?:to|–|—)\s*(\d{1,4}[/-]\d{1,2}[/-]\d{2,4})/i,
    );
    if (rangeMatch) {
      reportDateRangeText = text;
      detectedFromDate = parseDmyToIsoStrict(rangeMatch[1]);
      detectedToDate = parseDmyToIsoStrict(rangeMatch[2]);
      continue;
    }

    // Match hyphen-separated date range with spaces around hyphen: "01-10-2026 - 31-10-2026"
    const spacedHyphenMatch = text.match(
      /(\d{1,4}[/-]\d{1,2}[/-]\d{2,4})\s+-\s+(\d{1,4}[/-]\d{1,2}[/-]\d{2,4})/,
    );
    if (spacedHyphenMatch) {
      reportDateRangeText = text;
      detectedFromDate = parseDmyToIsoStrict(spacedHyphenMatch[1]);
      detectedToDate = parseDmyToIsoStrict(spacedHyphenMatch[2]);
      continue;
    }

    const singleMatch = text.match(/(\d{1,4}[/-]\d{1,2}[/-]\d{2,4})/);
    if (singleMatch && !reportDateRangeText) {
      reportDateRangeText = text;
      detectedFromDate = parseDmyToIsoStrict(singleMatch[1]);
      detectedToDate = detectedFromDate;
      continue;
    }

    if (/as\s*on|period|from|date/i.test(text) && !reportDateRangeText) {
      reportDateRangeText = text;
      continue;
    }

    if (!reportTitle) {
      reportTitle = text;
    }
  }

  return { reportTitle, reportDateRangeText, detectedFromDate, detectedToDate };
}

function detectHeaderRow(worksheet: ExcelJS.Worksheet): number {
  let bestRow = 1;
  let bestScore = -1;
  const maxScan = Math.min(10, worksheet.rowCount);

  for (let r = 1; r <= maxScan; r++) {
    const row = worksheet.getRow(r);
    const labels: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell) => {
      const val = String(extractCellPrimitive(cell.value) ?? '').trim();
      if (val) labels.push(val);
    });
    if (labels.length < 3) continue;

    let score = 0;
    for (const label of labels) {
      if (KNOWN_HEADER_SIGNALS.some((rx) => rx.test(label))) {
        score += 3;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }

  return bestRow;
}

function suggestColumnMapping(headers: string[]): ExcelColumnMapping {
  const findHeader = (patterns: RegExp[], exclude: string[] = []): string => {
    for (const pattern of patterns) {
      const match = headers.find((h) => !exclude.includes(h) && pattern.test(h));
      if (match) return match;
    }
    return '';
  };

  const businessDate = findHeader([
    /^date$/i,
    /incentive\s*date/i,
    /business\s*date/i,
    /txn\s*date/i,
    /entry\s*date/i,
    /report\s*date/i,
    /\bdate\b/i,
  ]);
  const empIdExplicit = findHeader([
    /emp(loyee)?[\s_-]*(id|code|no)/i,
    /staff[\s_-]*(id|code|no)/i,
    /login[\s_-]*id/i,
  ]);
  const saleIdExplicit = findHeader(
    [
      /sell[\s_-]*(id|code|no)/i,
      /sale[\s_-]*(id|code|no)/i,
      /salesman\s*no/i,
      /salesman\s*id/i,
      /sales[\s_-]*(id|code|no)/i,
    ],
    [empIdExplicit].filter(Boolean),
  );
  const employeeId = empIdExplicit || saleIdExplicit;
  const saleId = empIdExplicit && saleIdExplicit ? saleIdExplicit : '';

  const employeeName = findHeader([
    /sales\s*person\s*name/i,
    /salesman\s*name/i,
    /emp(loyee)?[\s_-]*name/i,
    /staff[\s_-]*name/i,
  ]);
  const branchCode = findHeader(
    [/^name$/i, /branch[\s_-]*(code|id|name)?/i, /store/i, /location/i],
    [employeeName, employeeId, saleId].filter(Boolean),
  );

  const used = [businessDate, employeeId, saleId, employeeName, branchCode].filter(Boolean);

  // Exact incentive component matching (supports both new slab names and ERP headers)
  const comp1 = findHeader(
    [
      /new\s*items?\s*sale/i,
      /incentive\s*new\s*quantity\s*wise/i,
      /new\s*quantity/i,
      /component\s*1/i,
    ],
    used,
  );
  const comp2 = findHeader(
    [/old\s*items?\s*sale/i, /old\s+(?:item\s+)?incentive/i, /component\s*2/i],
    [...used, comp1].filter(Boolean),
  );
  const comp3 = findHeader(
    [
      /other\s*items?\s*sale/i,
      /incentive\s*[-–]?\s*0\.?50?%/i,
      /0\.?50?%/i,
      /component\s*3/i,
    ],
    [...used, comp1, comp2].filter(Boolean),
  );

  // Pair each section's preceding Sale Amt & Sale Qty columns positionally (supports both "Sale Amt, Sale Qty" and "Sale Qty, Sale Amt")
  const findSectionSaleCols = (
    compHeader: string,
    afterIdx: number,
    usedSaleCols: string[],
  ): { amt: string; qty: string; endIdx: number } => {
    const compIdx = compHeader ? headers.indexOf(compHeader) : -1;
    if (compIdx <= 0) return { amt: '', qty: '', endIdx: afterIdx };
    const startIdx = Math.max(0, afterIdx + 1);
    const slice = headers.slice(startIdx, compIdx).filter((h) => !usedSaleCols.includes(h));
    const amt = slice.find((h) => SALE_AMT_COLUMN_REGEX.test(h)) || '';
    const qty = slice.find((h) => SALE_QTY_COLUMN_REGEX.test(h)) || '';
    return { amt, qty, endIdx: compIdx };
  };

  const usedSaleCols: string[] = [];
  const sec1 = findSectionSaleCols(comp1, -1, usedSaleCols);
  if (sec1.amt) usedSaleCols.push(sec1.amt);
  if (sec1.qty) usedSaleCols.push(sec1.qty);

  const sec2 = findSectionSaleCols(comp2, sec1.endIdx, usedSaleCols);
  if (sec2.amt) usedSaleCols.push(sec2.amt);
  if (sec2.qty) usedSaleCols.push(sec2.qty);

  const sec3 = findSectionSaleCols(comp3, sec2.endIdx, usedSaleCols);
  if (sec3.amt) usedSaleCols.push(sec3.amt);
  if (sec3.qty) usedSaleCols.push(sec3.qty);

  const allExcludedForFallback = [...used, comp1, comp2, comp3, ...usedSaleCols].filter(Boolean);
  const remainingCandidates = headers.filter(
    (h) =>
      !allExcludedForFallback.includes(h) &&
      !SALES_HEADER_REGEX.test(h) &&
      !SALE_AMT_COLUMN_REGEX.test(h) &&
      !SALE_QTY_COLUMN_REGEX.test(h),
  );

  return {
    businessDate,
    employeeId,
    ...(saleId ? { saleId } : {}),
    employeeName,
    branchCode,
    component1: comp1 || remainingCandidates[0] || '',
    component2: comp2 || remainingCandidates[1] || '',
    component3: comp3 || remainingCandidates[2] || '',
    saleAmt1: sec1.amt,
    saleQty1: sec1.qty,
    saleAmt2: sec2.amt,
    saleQty2: sec2.qty,
    saleAmt3: sec3.amt,
    saleQty3: sec3.qty,
  };
}

function isBlankMarker(val: string | number | null | undefined): boolean {
  if (val === null || val === undefined) return false;
  const s = String(val).trim().toLowerCase();
  return s === '(blank)' || s === 'blank';
}

function isSummaryRowMarker(val: string | number | null | undefined): boolean {
  if (val === null || val === undefined) return false;
  const s = String(val).trim().toLowerCase();
  return (
    s === 'grand total' ||
    s === 'sub total' ||
    s === 'subtotal' ||
    s === 'total' ||
    s === 'branch total' ||
    /\btotal$/i.test(s)
  );
}

export async function parseExcelBuffer(
  buffer: Buffer,
  fileName: string,
  requestedSheet?: string,
): Promise<ExcelParseResponse> {
  const fileSha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const availableSheets = workbook.worksheets.map((ws) => ws.name);
  if (availableSheets.length === 0) {
    throw new Error('The uploaded Excel workbook contains no worksheets.');
  }

  const worksheet = requestedSheet
    ? workbook.getWorksheet(requestedSheet) || workbook.worksheets[0]
    : workbook.worksheets[0];

  const headerRowNumber = detectHeaderRow(worksheet);
  const banner = extractBannerMetadata(worksheet, headerRowNumber);
  const periodClassification = classifyImportPeriod(
    banner.detectedFromDate,
    banner.detectedToDate,
    banner.reportDateRangeText,
  );
  const headerRow = worksheet.getRow(headerRowNumber);

  const rawHeaders: { colIndex: number; name: string }[] = [];
  const excludedSalesColumns: string[] = [];

  const seenHeaderCounts = new Map<string, number>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const label = String(extractCellPrimitive(cell.value) ?? '').trim();
    if (!label) return;
    if (SALES_HEADER_REGEX.test(label)) {
      if (!excludedSalesColumns.includes(label)) {
        excludedSalesColumns.push(label);
      }
      return;
    }
    const prevCount = seenHeaderCounts.get(label) || 0;
    seenHeaderCounts.set(label, prevCount + 1);
    const uniqueName = prevCount === 0 ? label : `${label} (${prevCount + 1})`;
    rawHeaders.push({ colIndex: colNumber, name: uniqueName });
  });

  if (rawHeaders.length === 0) {
    throw new Error(`Row ${headerRowNumber} does not contain recognizable column headers.`);
  }

  const headers = rawHeaders.map((h) => h.name);
  const suggestedMapping = suggestColumnMapping(headers);
  const rows: ParsedExcelRow[] = [];
  let rawTotalRows = 0;
  let skippedBlankRows = 0;
  let skippedSummaryRows = 0;

  for (let rowIdx = headerRowNumber + 1; rowIdx <= worksheet.rowCount; rowIdx++) {
    const row = worksheet.getRow(rowIdx);
    const record: Record<string, string | number | null> = {};
    let hasAnyValue = false;

    for (const h of rawHeaders) {
      const val = extractCellPrimitive(row.getCell(h.colIndex).value);
      record[h.name] = val;
      if (val !== null && String(val).trim() !== '') {
        hasAnyValue = true;
      }
    }

    if (!hasAnyValue) continue;
    rawTotalRows += 1;

    const empIdCell = suggestedMapping.employeeId ? record[suggestedMapping.employeeId] : null;
    const saleIdCell = suggestedMapping.saleId ? record[suggestedMapping.saleId] : null;
    const empNameCell = suggestedMapping.employeeName ? record[suggestedMapping.employeeName] : null;
    const branchCell = suggestedMapping.branchCode ? record[suggestedMapping.branchCode] : null;

    if (
      isSummaryRowMarker(branchCell) ||
      isSummaryRowMarker(empNameCell) ||
      isSummaryRowMarker(empIdCell) ||
      isSummaryRowMarker(saleIdCell)
    ) {
      skippedSummaryRows += 1;
      continue;
    }

    const bothIdsBlankMarker = suggestedMapping.saleId
      ? (isBlankMarker(empIdCell) && (saleIdCell === null || isBlankMarker(saleIdCell))) ||
        (isBlankMarker(saleIdCell) && (empIdCell === null || isBlankMarker(empIdCell)))
      : isBlankMarker(empIdCell);

    if (
      bothIdsBlankMarker ||
      isBlankMarker(empNameCell) ||
      isBlankMarker(branchCell)
    ) {
      skippedBlankRows += 1;
      continue;
    }

    rows.push({
      rowNumber: rowIdx,
      raw: record,
    });
  }

  // If the workbook includes a Date column, derive period span directly from row Date values
  let finalImportType = periodClassification.importType;
  let finalPeriodStart = periodClassification.periodStart;
  let finalPeriodEnd = periodClassification.periodEnd;
  let finalDetectedFromDate = banner.detectedFromDate;
  let finalDetectedToDate = banner.detectedToDate;
  let finalDateValidationError = periodClassification.errorMessage;
  let finalReportDateRangeText = banner.reportDateRangeText;

  if (suggestedMapping.businessDate) {
    const validRowDates: string[] = [];
    for (const r of rows) {
      const iso = parseExcelDateCellToIso(r.raw[suggestedMapping.businessDate]);
      if (iso) validRowDates.push(iso);
    }
    if (validRowDates.length > 0) {
      validRowDates.sort();
      const minDate = validRowDates[0];
      const maxDate = validRowDates[validRowDates.length - 1];
      finalImportType = 'DAILY';
      finalPeriodStart = minDate;
      finalPeriodEnd = maxDate;
      finalDetectedFromDate = minDate;
      finalDetectedToDate = maxDate;
      finalDateValidationError = null;
      finalReportDateRangeText =
        minDate === maxDate ? minDate : `${minDate} to ${maxDate}`;
    }
  }

  return {
    fileName,
    fileSha256,
    sheetName: worksheet.name,
    availableSheets,
    headerRowNumber,
    reportTitle: banner.reportTitle,
    reportDateRangeText: finalReportDateRangeText,
    importType: finalImportType,
    periodStart: finalPeriodStart,
    periodEnd: finalPeriodEnd,
    detectedFromDate: finalDetectedFromDate,
    detectedToDate: finalDetectedToDate,
    dateValidationError: finalDateValidationError,
    rawTotalRows,
    skippedBlankRows,
    skippedSummaryRows,
    headers,
    excludedSalesColumns,
    suggestedMapping,
    totalRows: rows.length,
    rows,
  };
}

function isoToDmy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

export async function buildSampleTemplateWorkbook(
  periodStartIso: string,
  sampleRows: Array<{
    branchName: string;
    salesPersonName: string;
    salesmanNo: string;
    component1: number;
    component2: number;
    component3: number;
    saleAmt1?: number;
    saleQty1?: number;
    saleAmt2?: number;
    saleQty2?: number;
    saleAmt3?: number;
    saleQty3?: number;
  }>,
  periodEndIso?: string,
  bannerOverride?: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'House of Muktai Incentive System';
  workbook.created = new Date();

  const startDmy = isoToDmy(periodStartIso);
  const endDmy = isoToDmy(periodEndIso || periodStartIso);

  const sheet = workbook.addWorksheet('Final Report');

  // Row 1: Exact House of Muktai ERP Banner Format
  sheet.mergeCells('A1:C1');
  sheet.getCell('A1').value = 'Final Report incentive All Branches';
  sheet.getCell('A1').font = { bold: true, size: 11 };
  sheet.getCell('A1').alignment = { horizontal: 'center' };
  sheet.getCell('A1').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFCD5B4' },
  };

  sheet.mergeCells('D1:L1');
  sheet.getCell('D1').value =
    bannerOverride !== undefined ? bannerOverride : `As On :-${startDmy} To ${endDmy}`;
  sheet.getCell('D1').font = { bold: true, size: 11 };
  sheet.getCell('D1').alignment = { horizontal: 'center' };

  // Row 2: Exact 12-Column Headers (with Sale Amt & Sale Qty for each incentive slab)
  const headerRow = sheet.addRow([
    'NAME',
    'Sales Person Name',
    'Salesman No',
    'Sale Amt',
    'Sale Qty',
    'New Items Sale',
    'Sale Amt',
    'Sale Qty',
    'Old Items Sale',
    'Sale Amt',
    'Sale Qty',
    'Other Items Sale',
  ]);
  headerRow.font = { bold: true };
  sheet.columns = [
    { width: 22 },
    { width: 28 },
    { width: 14 },
    { width: 14 },
    { width: 12 },
    { width: 26 },
    { width: 14 },
    { width: 12 },
    { width: 20 },
    { width: 14 },
    { width: 12 },
    { width: 18 },
  ];

  for (const row of sampleRows) {
    sheet.addRow([
      row.branchName,
      row.salesPersonName,
      Number.isFinite(Number(row.salesmanNo)) && row.salesmanNo.trim() !== ''
        ? Number(row.salesmanNo)
        : row.salesmanNo,
      row.saleAmt1 ?? 0,
      row.saleQty1 ?? 0,
      row.component1,
      row.saleAmt2 ?? 0,
      row.saleQty2 ?? 0,
      row.component2,
      row.saleAmt3 ?? 0,
      row.saleQty3 ?? 0,
      row.component3,
    ]);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export async function buildDateColumnTemplateWorkbook(
  defaultDateIso: string,
  sampleRows: Array<{
    dateIso?: string;
    branchName: string;
    salesPersonName: string;
    salesmanNo: string;
    saleId?: string;
    component1: number;
    component2: number;
    component3: number;
    saleAmt1?: number;
    saleQty1?: number;
    saleAmt2?: number;
    saleQty2?: number;
    saleAmt3?: number;
    saleQty3?: number;
  }>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'House of Muktai Incentive System';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Incentive Upload');

  const headerRow = sheet.addRow([
    'Date',
    'Branch Name',
    'Employee Name',
    'Employee ID',
    'Sales ID',
    'Sale Amount',
    'Sale Quantity',
    'New Items Sale',
    'Sale Amount',
    'Sale Quantity',
    'Old Items Sale',
    'Sale Amount',
    'Sale Quantity',
    'Other Items Sale',
  ]);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  // Highlight Date column header so staff know every row uploads by its Date cell
  headerRow.getCell(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF9F1239' },
  };

  sheet.columns = [
    { width: 15 },
    { width: 22 },
    { width: 28 },
    { width: 15 },
    { width: 15 },
    { width: 14 },
    { width: 12 },
    { width: 18 },
    { width: 14 },
    { width: 12 },
    { width: 18 },
    { width: 14 },
    { width: 12 },
    { width: 18 },
  ];

  for (const row of sampleRows) {
    const empIdVal =
      Number.isFinite(Number(row.salesmanNo)) && row.salesmanNo.trim() !== ''
        ? Number(row.salesmanNo)
        : row.salesmanNo;
    const rawSaleId = (row.saleId ?? '').trim();
    const saleIdVal =
      rawSaleId !== '' && Number.isFinite(Number(rawSaleId))
        ? Number(rawSaleId)
        : rawSaleId;
    const added = sheet.addRow([
      row.dateIso || defaultDateIso,
      row.branchName,
      row.salesPersonName,
      empIdVal,
      saleIdVal,
      row.saleAmt1 ?? 0,
      row.saleQty1 ?? 0,
      row.component1,
      row.saleAmt2 ?? 0,
      row.saleQty2 ?? 0,
      row.component2,
      row.saleAmt3 ?? 0,
      row.saleQty3 ?? 0,
      row.component3,
    ]);
    added.getCell(1).numFmt = '@';
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export async function buildErrorReportWorkbook(
  rows: Array<{
    rowNumber: number;
    businessDate: string;
    employeeId: string;
    branchCode: string;
    component1Rupees: string;
    component2Rupees: string;
    component3Rupees: string;
    validationStatus: string;
    errorMessage: string;
  }>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'House of Muktai Incentive System';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Validation Error Report');
  sheet.columns = [
    { header: 'Row #', key: 'rowNumber', width: 10 },
    { header: 'Period / Date', key: 'businessDate', width: 24 },
    { header: 'Salesman No', key: 'employeeId', width: 16 },
    { header: 'Branch (NAME)', key: 'branchCode', width: 22 },
    { header: 'New Items Sale', key: 'component1Rupees', width: 22 },
    { header: 'Old Items Sale', key: 'component2Rupees', width: 20 },
    { header: 'Other Items Sale', key: 'component3Rupees', width: 20 },
    { header: 'Status', key: 'validationStatus', width: 22 },
    { header: 'Issue / Resolution Notes', key: 'errorMessage', width: 52 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F172A' },
  };

  for (const row of rows) {
    sheet.addRow(row);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export interface ManagementBranchRowInput {
  branchName: string;
  staffCount: number;
  totalSaleAmtRupees: number;
  totalSaleQty: number;
  newItemsIncRupees: number;
  oldItemsIncRupees: number;
  otherItemsIncRupees: number;
  grossIncentiveRupees: number;
  incentivePctOfSale: number;
  adjustmentsNetRupees: number;
  netPayableRupees: number;
  paidCount: number;
}

export interface ManagementEmployeeRowInput {
  branchName: string;
  employeeId: string;
  employeeName: string;
  saleAmt1Rupees: number;
  saleQty1: number;
  inc1Rupees: number;
  saleAmt2Rupees: number;
  saleQty2: number;
  inc2Rupees: number;
  saleAmt3Rupees: number;
  saleQty3: number;
  inc3Rupees: number;
  totalSaleAmtRupees: number;
  totalSaleQty: number;
  grossIncentiveRupees: number;
  adjustmentsNetRupees: number;
  netPayableRupees: number;
  payoutStatus: string;
  paymentMode: string;
  paymentReference: string;
}

export async function buildManagementReportWorkbook(params: {
  monthKey: string;
  monthLabel: string;
  branchRows: ManagementBranchRowInput[];
  employeeRows: ManagementEmployeeRowInput[];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = `${COMPANY_BRAND.brandName} — ${COMPANY_BRAND.legalName}`;
  workbook.company = COMPANY_BRAND.legalName;
  workbook.created = new Date();

  const rupeeFmt = '#,##0.00';
  const qtyFmt = '#,##0.##';
  const pctFmt = '0.00"%"';

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  };

  // Embed official House of Muktai logo PNG if present on disk
  let logoImageId: number | null = null;
  try {
    const logoAbsPath = path.resolve(process.cwd(), 'public', 'assets', 'aistudio', 'house-of-muktai-logo.png');
    if (fs.existsSync(logoAbsPath)) {
      const logoBuf = fs.readFileSync(logoAbsPath);
      logoImageId = workbook.addImage({
        base64: `data:image/png;base64,${logoBuf.toString('base64')}`,
        extension: 'png',
      });
    }
  } catch {
    logoImageId = null;
  }

  const applySheetLetterhead = (
    sheet: ExcelJS.Worksheet,
    lastColLetter: string,
    reportTitle: string,
  ) => {
    // Row 1: Brand + Legal Entity Banner
    sheet.mergeCells(`B1:${lastColLetter}1`);
    sheet.getCell('A1').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFFFFF' },
    };
    sheet.getCell('A2').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFFFFF' },
    };
    sheet.mergeCells('A1:A2');

    const titleCell = sheet.getCell('B1');
    titleCell.value = `${COMPANY_BRAND.brandNameUpper}  —  ${COMPANY_BRAND.legalName}`;
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF9F1239' },
    };
    sheet.getRow(1).height = 28;

    // Row 2: Registered Address + Report Title & Month
    sheet.mergeCells(`B2:${lastColLetter}2`);
    const addrCell = sheet.getCell('B2');
    addrCell.value = `Registered Office: ${COMPANY_BRAND.fullAddress}   |   ${reportTitle} (${params.monthLabel} / ${params.monthKey})`;
    addrCell.font = { bold: false, size: 9.5, color: { argb: 'FF334155' } };
    addrCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: true };
    addrCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF8FAFC' },
    };
    addrCell.border = {
      bottom: { style: 'medium', color: { argb: 'FFEA580C' } },
    };
    sheet.getRow(2).height = 24;

    if (logoImageId !== null) {
      sheet.addImage(logoImageId, {
        tl: { col: 0.15, row: 0.1 },
        ext: { width: 58, height: 58 },
      });
    }
  };

  // =========================================================================
  // SHEET 1: Branch Summary (12-Branch Management Overview)
  // =========================================================================
  const bSheet = workbook.addWorksheet('Branch Summary', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  applySheetLetterhead(bSheet, 'L', '12-Branch Management Incentive Summary');

  const bHeader = bSheet.addRow([
    'Branch Name',
    'Staff Count',
    'Total Sale Amt (Rs)',
    'Total Sale Qty',
    'New Items Sale Inc (Rs)',
    'Old Items Sale Inc (Rs)',
    'Other Items Sale Inc (Rs)',
    'Gross Incentive (Rs)',
    'Incentive % of Sale',
    'Net Adjustments (Rs)',
    'Net Payable (Rs)',
    'Paid Staff',
  ]);
  bHeader.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  bHeader.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F172A' },
  };
  bHeader.alignment = { vertical: 'middle' };
  bHeader.height = 24;

  bSheet.columns = [
    { width: 24 },
    { width: 12 },
    { width: 20 },
    { width: 15 },
    { width: 22 },
    { width: 22 },
    { width: 22 },
    { width: 20 },
    { width: 18 },
    { width: 20 },
    { width: 20 },
    { width: 14 },
  ];

  let totStaff = 0;
  let totSaleAmt = 0;
  let totSaleQty = 0;
  let totC1 = 0;
  let totC2 = 0;
  let totC3 = 0;
  let totGross = 0;
  let totAdj = 0;
  let totNet = 0;
  let totPaid = 0;

  params.branchRows.forEach((br, idx) => {
    totStaff += br.staffCount;
    totSaleAmt += br.totalSaleAmtRupees;
    totSaleQty += br.totalSaleQty;
    totC1 += br.newItemsIncRupees;
    totC2 += br.oldItemsIncRupees;
    totC3 += br.otherItemsIncRupees;
    totGross += br.grossIncentiveRupees;
    totAdj += br.adjustmentsNetRupees;
    totNet += br.netPayableRupees;
    totPaid += br.paidCount;

    const r = bSheet.addRow([
      br.branchName,
      br.staffCount,
      br.totalSaleAmtRupees,
      br.totalSaleQty,
      br.newItemsIncRupees,
      br.oldItemsIncRupees,
      br.otherItemsIncRupees,
      br.grossIncentiveRupees,
      br.incentivePctOfSale,
      br.adjustmentsNetRupees,
      br.netPayableRupees,
      `${br.paidCount}/${br.staffCount}`,
    ]);
    r.height = 20;
    r.eachCell((cell) => {
      cell.border = thinBorder;
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
    });
    r.getCell(3).numFmt = rupeeFmt;
    r.getCell(4).numFmt = qtyFmt;
    r.getCell(5).numFmt = rupeeFmt;
    r.getCell(6).numFmt = rupeeFmt;
    r.getCell(7).numFmt = rupeeFmt;
    r.getCell(8).numFmt = rupeeFmt;
    r.getCell(9).numFmt = pctFmt;
    r.getCell(10).numFmt = rupeeFmt;
    r.getCell(11).numFmt = rupeeFmt;
  });

  const grandPct = totSaleAmt > 0 ? Math.round((totGross / totSaleAmt) * 10000) / 100 : 0;
  const bTotalRow = bSheet.addRow([
    'GRAND TOTAL',
    totStaff,
    Math.round(totSaleAmt * 100) / 100,
    Math.round(totSaleQty * 100) / 100,
    Math.round(totC1 * 100) / 100,
    Math.round(totC2 * 100) / 100,
    Math.round(totC3 * 100) / 100,
    Math.round(totGross * 100) / 100,
    grandPct,
    Math.round(totAdj * 100) / 100,
    Math.round(totNet * 100) / 100,
    `${totPaid}/${totStaff}`,
  ]);
  bTotalRow.font = { bold: true, color: { argb: 'FF0F172A' } };
  bTotalRow.height = 24;
  bTotalRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF9F1239' } },
      bottom: { style: 'medium', color: { argb: 'FF9F1239' } },
    };
  });
  [3, 5, 6, 7, 8, 10, 11].forEach((c) => {
    bTotalRow.getCell(c).numFmt = rupeeFmt;
  });
  bTotalRow.getCell(4).numFmt = qtyFmt;
  bTotalRow.getCell(9).numFmt = pctFmt;

  bSheet.addRow([]);
  const bFoot = bSheet.addRow([
    `${COMPANY_BRAND.brandName} · ${COMPANY_BRAND.legalName} — ${COMPANY_BRAND.fullAddress}`,
  ]);
  bFoot.font = { italic: true, size: 8.5, color: { argb: 'FF64748B' } };
  bSheet.views = [{ state: 'frozen', ySplit: 3 }];

  // =========================================================================
  // SHEET 2: Employee Ledger (3 Slabs + Sale Amt + Sale Qty + Payout Details)
  // =========================================================================
  const eSheet = workbook.addWorksheet('Employee Ledger', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  applySheetLetterhead(eSheet, 'T', 'Employee Sales, Incentive & Payout Ledger');

  const eHeader = eSheet.addRow([
    'Branch (NAME)',
    'Salesman No',
    'Sales Person Name',
    'New Items Sale Amt',
    'New Items Sale Qty',
    'New Items Sale Incentive',
    'Old Items Sale Amt',
    'Old Items Sale Qty',
    'Old Items Sale Incentive',
    'Other Items Sale Amt',
    'Other Items Sale Qty',
    'Other Items Sale Incentive',
    'Total Sale Amt',
    'Total Sale Qty',
    'Gross Incentive',
    'Adjustments',
    'Net Payable',
    'Payout Status',
    'Payment Mode',
    'Payment Ref',
  ]);
  eHeader.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  eHeader.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F172A' },
  };
  eHeader.alignment = { vertical: 'middle' };
  eHeader.height = 24;

  eSheet.columns = [
    { width: 22 },
    { width: 14 },
    { width: 28 },
    { width: 18 },
    { width: 16 },
    { width: 22 },
    { width: 18 },
    { width: 16 },
    { width: 22 },
    { width: 18 },
    { width: 16 },
    { width: 22 },
    { width: 18 },
    { width: 15 },
    { width: 18 },
    { width: 16 },
    { width: 18 },
    { width: 15 },
    { width: 14 },
    { width: 22 },
  ];

  let eSa1 = 0;
  let eSq1 = 0;
  let eI1 = 0;
  let eSa2 = 0;
  let eSq2 = 0;
  let eI2 = 0;
  let eSa3 = 0;
  let eSq3 = 0;
  let eI3 = 0;
  let eTotSa = 0;
  let eTotSq = 0;
  let eTotGross = 0;
  let eTotAdj = 0;
  let eTotNet = 0;

  params.employeeRows.forEach((emp, idx) => {
    eSa1 += emp.saleAmt1Rupees;
    eSq1 += emp.saleQty1;
    eI1 += emp.inc1Rupees;
    eSa2 += emp.saleAmt2Rupees;
    eSq2 += emp.saleQty2;
    eI2 += emp.inc2Rupees;
    eSa3 += emp.saleAmt3Rupees;
    eSq3 += emp.saleQty3;
    eI3 += emp.inc3Rupees;
    eTotSa += emp.totalSaleAmtRupees;
    eTotSq += emp.totalSaleQty;
    eTotGross += emp.grossIncentiveRupees;
    eTotAdj += emp.adjustmentsNetRupees;
    eTotNet += emp.netPayableRupees;

    const r = eSheet.addRow([
      emp.branchName,
      emp.employeeId,
      emp.employeeName,
      emp.saleAmt1Rupees,
      emp.saleQty1,
      emp.inc1Rupees,
      emp.saleAmt2Rupees,
      emp.saleQty2,
      emp.inc2Rupees,
      emp.saleAmt3Rupees,
      emp.saleQty3,
      emp.inc3Rupees,
      emp.totalSaleAmtRupees,
      emp.totalSaleQty,
      emp.grossIncentiveRupees,
      emp.adjustmentsNetRupees,
      emp.netPayableRupees,
      emp.payoutStatus,
      emp.paymentMode || '—',
      emp.paymentReference || '—',
    ]);
    r.height = 20;
    r.eachCell((cell) => {
      cell.border = thinBorder;
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
    });
    [4, 6, 7, 9, 10, 12, 13, 15, 16, 17].forEach((c) => {
      r.getCell(c).numFmt = rupeeFmt;
    });
    [5, 8, 11, 14].forEach((c) => {
      r.getCell(c).numFmt = qtyFmt;
    });
  });

  const eTotalRow = eSheet.addRow([
    'GRAND TOTAL',
    `${params.employeeRows.length} Staff`,
    '',
    Math.round(eSa1 * 100) / 100,
    Math.round(eSq1 * 100) / 100,
    Math.round(eI1 * 100) / 100,
    Math.round(eSa2 * 100) / 100,
    Math.round(eSq2 * 100) / 100,
    Math.round(eI2 * 100) / 100,
    Math.round(eSa3 * 100) / 100,
    Math.round(eSq3 * 100) / 100,
    Math.round(eI3 * 100) / 100,
    Math.round(eTotSa * 100) / 100,
    Math.round(eTotSq * 100) / 100,
    Math.round(eTotGross * 100) / 100,
    Math.round(eTotAdj * 100) / 100,
    Math.round(eTotNet * 100) / 100,
    '',
    '',
    '',
  ]);
  eTotalRow.font = { bold: true, color: { argb: 'FF0F172A' } };
  eTotalRow.height = 24;
  eTotalRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF9F1239' } },
      bottom: { style: 'medium', color: { argb: 'FF9F1239' } },
    };
  });
  [4, 6, 7, 9, 10, 12, 13, 15, 16, 17].forEach((c) => {
    eTotalRow.getCell(c).numFmt = rupeeFmt;
  });
  [5, 8, 11, 14].forEach((c) => {
    eTotalRow.getCell(c).numFmt = qtyFmt;
  });

  eSheet.addRow([]);
  const eFoot = eSheet.addRow([
    `${COMPANY_BRAND.brandName} · ${COMPANY_BRAND.legalName} — ${COMPANY_BRAND.fullAddress}`,
  ]);
  eFoot.font = { italic: true, size: 8.5, color: { argb: 'FF64748B' } };
  eSheet.views = [{ state: 'frozen', ySplit: 3 }];

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}


