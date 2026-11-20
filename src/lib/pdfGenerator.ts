import { jsPDF } from 'jspdf';
import { COMPANY_BRAND, DEFAULT_EMPLOYEE_PASSWORD } from './companyBrand';
import { formatMonthLabel, formatQty, formatShortDate } from './format';
import type {
  Employee,
  IncentiveAdjustment,
  PayoutRecord,
} from '../types/incentive';

function formatRsPdf(paise: number): string {
  const neg = paise < 0;
  const rupees = Math.abs(paise) / 100;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
  return `${neg ? '-' : ''}Rs. ${formatted}`;
}

let cachedLogoDataUrl: string | null | undefined = undefined;

async function loadBrandLogoPngDataUrl(): Promise<string | null> {
  if (cachedLogoDataUrl !== undefined) return cachedLogoDataUrl;
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    cachedLogoDataUrl = null;
    return null;
  }

  const tryLoad = (url: string): Promise<string | null> =>
    new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const size = 256;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(img, 0, 0, size, size);
          resolve(canvas.toDataURL('image/png'));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });

  const pngAttempt = await tryLoad(COMPANY_BRAND.logoPngPath);
  if (pngAttempt) {
    cachedLogoDataUrl = pngAttempt;
    return pngAttempt;
  }
  const webpAttempt = await tryLoad(COMPANY_BRAND.logoWebpPath);
  cachedLogoDataUrl = webpAttempt;
  return webpAttempt;
}

/**
 * Draws the official House of Muktai / SHRIMUKTAI MART PRIVATE LIMITED letterhead
 * with embedded corporate logo, crimson-to-saffron ribbon, legal name & registered Baramati address.
 * Returns the bottom Y coordinate below the letterhead.
 */
function drawCorporateLetterhead(params: {
  doc: jsPDF;
  logoDataUrl: string | null;
  documentTitle: string;
  rightMetaTop: string;
  rightMetaBottom: string;
  margin: number;
}): number {
  const { doc, logoDataUrl, documentTitle, rightMetaTop, rightMetaBottom, margin } = params;
  const pageWidth = doc.internal.pageSize.getWidth();

  // Top Brand Accent Strip (Crimson + Saffron Orange from official logo)
  doc.setFillColor(185, 28, 28); // #B91C1C
  doc.rect(0, 0, pageWidth * 0.72, 3.2, 'F');
  doc.setFillColor(234, 88, 12); // #EA580C
  doc.rect(pageWidth * 0.72, 0, pageWidth * 0.28, 3.2, 'F');

  // Clean White Executive Letterhead Band
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 3.2, pageWidth, 31.8, 'F');

  const logoSize = 22;
  const logoX = margin;
  const logoY = 7.5;
  let textStartX = margin;

  if (logoDataUrl) {
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(logoX, logoY, logoSize, logoSize, 2, 2, 'FD');
    doc.addImage(logoDataUrl, 'PNG', logoX + 1, logoY + 1, logoSize - 2, logoSize - 2);
    textStartX = logoX + logoSize + 4.5;
  }

  // Brand Name & Corporate Legal Entity
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(COMPANY_BRAND.brandNameUpper, textStartX, 13.5);

  doc.setTextColor(159, 18, 57); // #9F1239
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  doc.text(COMPANY_BRAND.legalName, textStartX, 18.8);

  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.6);
  doc.text(COMPANY_BRAND.addressLine1, textStartX, 23.6);
  doc.text(COMPANY_BRAND.addressLine2, textStartX, 27.6);

  // Right Document Meta Block
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(documentTitle, pageWidth - margin, 13.5, { align: 'right' });

  doc.setTextColor(159, 18, 57);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.text(rightMetaTop, pageWidth - margin, 19.2, { align: 'right' });

  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.text(rightMetaBottom, pageWidth - margin, 24.4, { align: 'right' });

  // Crisp Divider Hairline
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.35);
  doc.line(margin, 34.5, pageWidth - margin, 34.5);

  return 40;
}

function drawCorporateFooter(params: {
  doc: jsPDF;
  margin: number;
  note: string;
  pageNumber?: number;
  totalPages?: number;
}) {
  const { doc, margin, note, pageNumber, totalPages } = params;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const lineY = pageHeight - 17;

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(margin, lineY, pageWidth - margin, lineY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  doc.text(`${COMPANY_BRAND.brandName} · ${COMPANY_BRAND.legalName}`, margin, lineY + 4.8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(`${COMPANY_BRAND.fullAddress}`, margin, lineY + 8.8);
  doc.text(note, margin, lineY + 12.6);

  if (pageNumber && totalPages) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - margin, lineY + 4.8, {
      align: 'right',
    });
  }
}

export interface EmployeeSlipPdfInput {
  employeeName: string;
  employeeId: string;
  branchName: string;
  designation?: string;
  periodTitle: string;
  periodBadge: string;
  slab1SaleAmtPaise: number;
  slab1SaleQty: number;
  slab1IncentivePaise: number;
  slab2SaleAmtPaise: number;
  slab2SaleQty: number;
  slab2IncentivePaise: number;
  slab3SaleAmtPaise: number;
  slab3SaleQty: number;
  slab3IncentivePaise: number;
  totalSaleAmtPaise: number;
  totalSaleQty: number;
  grossIncentivePaise: number;
  adjustments?: IncentiveAdjustment[];
  payout?: PayoutRecord | null;
  fileName: string;
}

export async function downloadEmployeeIncentiveSlipPdf(
  input: EmployeeSlipPdfInput,
): Promise<void> {
  const logoDataUrl = await loadBrandLogoPngDataUrl();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentW = pageWidth - margin * 2;

  let y = drawCorporateLetterhead({
    doc,
    logoDataUrl,
    documentTitle: 'INCENTIVE & SALES SLIP',
    rightMetaTop: input.periodBadge,
    rightMetaBottom: `Generated: ${new Date().toLocaleDateString('en-IN')}`,
    margin,
  });

  // Employee Identity Box
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, contentW, 28, 2, 2, 'FD');

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(input.employeeName, margin + 4.5, y + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.8);
  doc.setTextColor(71, 85, 105);
  doc.text(`Salesman No: ${input.employeeId}`, margin + 4.5, y + 15);
  doc.text(`Branch: ${input.branchName}`, margin + 4.5, y + 21.5);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.text(input.periodTitle, pageWidth - margin - 4.5, y + 8, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Designation: ${input.designation || 'Sales Executive'}`,
    pageWidth - margin - 4.5,
    y + 15,
    { align: 'right' },
  );
  const incPct =
    input.totalSaleAmtPaise > 0
      ? ((input.grossIncentivePaise / input.totalSaleAmtPaise) * 100).toFixed(2)
      : '0.00';
  doc.text(`Incentive / Sale Ratio: ${incPct}%`, pageWidth - margin - 4.5, y + 21.5, {
    align: 'right',
  });

  // Table Section Title
  y += 36;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('Sales & Incentive Breakdown (3 Slabs)', margin, y);
  y += 4;

  // Table Header
  doc.setFillColor(15, 23, 42);
  doc.rect(margin, y, contentW, 9, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Slab / Category', margin + 3.5, y + 6);
  doc.text('Sale Amount', margin + 96, y + 6, { align: 'right' });
  doc.text('Sale Qty', margin + 128, y + 6, { align: 'right' });
  doc.text('Incentive Earned', pageWidth - margin - 3.5, y + 6, { align: 'right' });
  y += 9;

  const rows = [
    {
      label: '1. New Items Sale',
      amt: input.slab1SaleAmtPaise,
      qty: input.slab1SaleQty,
      inc: input.slab1IncentivePaise,
    },
    {
      label: '2. Old Items Sale',
      amt: input.slab2SaleAmtPaise,
      qty: input.slab2SaleQty,
      inc: input.slab2IncentivePaise,
    },
    {
      label: '3. Other Items Sale',
      amt: input.slab3SaleAmtPaise,
      qty: input.slab3SaleQty,
      inc: input.slab3IncentivePaise,
    },
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  rows.forEach((row, idx) => {
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, contentW, 9.5, 'F');
    }
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y + 9.5, pageWidth - margin, y + 9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(row.label, margin + 3.5, y + 6.3);
    doc.text(formatRsPdf(row.amt), margin + 96, y + 6.3, { align: 'right' });
    doc.text(formatQty(row.qty), margin + 128, y + 6.3, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(formatRsPdf(row.inc), pageWidth - margin - 3.5, y + 6.3, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    y += 9.5;
  });

  // Gross Total Row
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, y, contentW, 10.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Gross Total', margin + 3.5, y + 7);
  doc.text(formatRsPdf(input.totalSaleAmtPaise), margin + 96, y + 7, { align: 'right' });
  doc.text(formatQty(input.totalSaleQty), margin + 128, y + 7, { align: 'right' });
  doc.setTextColor(159, 18, 57);
  doc.text(formatRsPdf(input.grossIncentivePaise), pageWidth - margin - 3.5, y + 7, {
    align: 'right',
  });
  y += 16;

  // Adjustments Section
  const activeAdjs = (input.adjustments || []).filter((a) => a.status === 'ACTIVE');
  let adjustmentsNetPaise = 0;
  for (const adj of activeAdjs) {
    adjustmentsNetPaise += adj.type === 'BONUS' ? adj.amountPaise : -adj.amountPaise;
  }

  if (activeAdjs.length > 0) {
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Bonus / Deductions / Advance Adjustments', margin, y);
    y += 4;

    doc.setFillColor(248, 250, 252);
    doc.rect(margin, y, contentW, 8, 'F');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text('Type', margin + 3.5, y + 5.5);
    doc.text('Reason / Remarks', margin + 44, y + 5.5);
    doc.text('Amount', pageWidth - margin - 3.5, y + 5.5, { align: 'right' });
    y += 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    for (const adj of activeAdjs) {
      const signed = adj.type === 'BONUS' ? adj.amountPaise : -adj.amountPaise;
      doc.setTextColor(15, 23, 42);
      doc.text(adj.type.replace('_', ' '), margin + 3.5, y + 5.5);
      doc.text(adj.reason.slice(0, 62), margin + 44, y + 5.5);
      doc.setTextColor(signed >= 0 ? 22 : 185, signed >= 0 ? 101 : 28, signed >= 0 ? 52 : 28);
      doc.text(`${signed >= 0 ? '+' : ''}${formatRsPdf(signed)}`, pageWidth - margin - 3.5, y + 5.5, {
        align: 'right',
      });
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y + 8, pageWidth - margin, y + 8);
      y += 8;
    }
    y += 6;
  }

  // Net Payable Summary Band
  const netPayablePaise = input.grossIncentivePaise + adjustmentsNetPaise;
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(margin, y, contentW, 19, 2, 2, 'F');
  doc.setFillColor(185, 28, 28);
  doc.rect(margin, y, 2.5, 19, 'F');
  doc.setTextColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.8);
  doc.text('NET PAYABLE INCENTIVE', margin + 6, y + 7.5);
  doc.text(
    activeAdjs.length > 0
      ? `Gross ${formatRsPdf(input.grossIncentivePaise)} ${adjustmentsNetPaise >= 0 ? '+' : ''} Adjustments ${formatRsPdf(adjustmentsNetPaise)}`
      : 'No adjustments or deductions applied',
    margin + 6,
    y + 13.8,
  );
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(formatRsPdf(netPayablePaise), pageWidth - margin - 5, y + 11.8, { align: 'right' });
  y += 25;

  // Payout Settlement Box
  if (input.payout) {
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, y, contentW, 20, 2, 2, 'FD');
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(`Payout Status: ${input.payout.status}`, margin + 4.5, y + 7.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    const modeLine = `Payment Mode: ${input.payout.paymentMode || '—'}   |   Ref: ${input.payout.paymentReference || '—'}   |   Paid Date: ${input.payout.paidAt ? formatShortDate(input.payout.paidAt.slice(0, 10)) : '—'}`;
    doc.text(modeLine, margin + 4.5, y + 14.5);
    y += 26;
  }

  // Authorized Signatory Area
  const sigY = Math.min(264, Math.max(y + 16, 246));
  doc.setDrawColor(203, 213, 225);
  doc.line(pageWidth - margin - 62, sigY, pageWidth - margin, sigY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text('Authorized Signatory', pageWidth - margin, sigY + 4.5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(COMPANY_BRAND.legalName, pageWidth - margin, sigY + 8.5, { align: 'right' });

  drawCorporateFooter({
    doc,
    margin,
    note: 'Official Computer-Generated Incentive Statement. For any discrepancy, raise a ticket via the Employee Portal.',
    pageNumber: 1,
    totalPages: 1,
  });

  doc.save(input.fileName);
}

export interface BranchSummaryPdfRow {
  branchName: string;
  staffCount: number;
  saleAmtPaise: number;
  saleQty: number;
  grossIncentivePaise: number;
  adjustmentsNetPaise: number;
  netPayablePaise: number;
  paidCount: number;
  incentivePct: number;
}

export async function downloadManagementBranchSummaryPdf(params: {
  monthKey: string;
  rows: BranchSummaryPdfRow[];
}): Promise<void> {
  const logoDataUrl = await loadBrandLogoPngDataUrl();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const contentW = pageWidth - margin * 2;

  const drawPageTop = () => {
    const startY = drawCorporateLetterhead({
      doc,
      logoDataUrl,
      documentTitle: '12-BRANCH MANAGEMENT SUMMARY',
      rightMetaTop: `${formatMonthLabel(params.monthKey)} (${params.monthKey})`,
      rightMetaBottom: `Generated: ${new Date().toLocaleDateString('en-IN')}`,
      margin,
    });

    doc.setFillColor(15, 23, 42);
    doc.rect(margin, startY, contentW, 9, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('Branch', margin + 3, startY + 6);
    doc.text('Staff', margin + 62, startY + 6, { align: 'right' });
    doc.text('Total Sale Amt', margin + 104, startY + 6, { align: 'right' });
    doc.text('Sale Qty', margin + 132, startY + 6, { align: 'right' });
    doc.text('Gross Incentive', margin + 170, startY + 6, { align: 'right' });
    doc.text('Inc %', margin + 192, startY + 6, { align: 'right' });
    doc.text('Adjustments', margin + 224, startY + 6, { align: 'right' });
    doc.text('Net Payable', margin + 256, startY + 6, { align: 'right' });
    doc.text('Paid', pageWidth - margin - 2, startY + 6, { align: 'right' });
    return startY + 9;
  };

  let y = drawPageTop();

  let totStaff = 0;
  let totSaleAmt = 0;
  let totSaleQty = 0;
  let totGross = 0;
  let totAdj = 0;
  let totNet = 0;
  let totPaid = 0;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);

  params.rows.forEach((r, idx) => {
    totStaff += r.staffCount;
    totSaleAmt += r.saleAmtPaise;
    totSaleQty += r.saleQty;
    totGross += r.grossIncentivePaise;
    totAdj += r.adjustmentsNetPaise;
    totNet += r.netPayablePaise;
    totPaid += r.paidCount;

    if (y > 176) {
      doc.addPage();
      y = drawPageTop();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
    }
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, contentW, 8.5, 'F');
    }
    doc.setTextColor(15, 23, 42);
    doc.text(r.branchName.slice(0, 26), margin + 3, y + 5.8);
    doc.text(String(r.staffCount), margin + 62, y + 5.8, { align: 'right' });
    doc.text(formatRsPdf(r.saleAmtPaise), margin + 104, y + 5.8, { align: 'right' });
    doc.text(formatQty(r.saleQty), margin + 132, y + 5.8, { align: 'right' });
    doc.text(formatRsPdf(r.grossIncentivePaise), margin + 170, y + 5.8, { align: 'right' });
    doc.text(`${r.incentivePct.toFixed(2)}%`, margin + 192, y + 5.8, { align: 'right' });
    doc.text(formatRsPdf(r.adjustmentsNetPaise), margin + 224, y + 5.8, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(formatRsPdf(r.netPayablePaise), margin + 256, y + 5.8, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(`${r.paidCount}/${r.staffCount}`, pageWidth - margin - 2, y + 5.8, { align: 'right' });
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y + 8.5, pageWidth - margin, y + 8.5);
    y += 8.5;
  });

  // Grand Total row
  const grandPct = totSaleAmt > 0 ? (totGross / totSaleAmt) * 100 : 0;
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, y, contentW, 10, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(159, 18, 57);
  doc.text('GRAND TOTAL', margin + 3, y + 6.8);
  doc.setTextColor(15, 23, 42);
  doc.text(String(totStaff), margin + 62, y + 6.8, { align: 'right' });
  doc.text(formatRsPdf(totSaleAmt), margin + 104, y + 6.8, { align: 'right' });
  doc.text(formatQty(totSaleQty), margin + 132, y + 6.8, { align: 'right' });
  doc.text(formatRsPdf(totGross), margin + 170, y + 6.8, { align: 'right' });
  doc.text(`${grandPct.toFixed(2)}%`, margin + 192, y + 6.8, { align: 'right' });
  doc.text(formatRsPdf(totAdj), margin + 224, y + 6.8, { align: 'right' });
  doc.setTextColor(159, 18, 57);
  doc.text(formatRsPdf(totNet), margin + 256, y + 6.8, { align: 'right' });
  doc.setTextColor(15, 23, 42);
  doc.text(`${totPaid}/${totStaff}`, pageWidth - margin - 2, y + 6.8, { align: 'right' });

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawCorporateFooter({
      doc,
      margin,
      note: 'Confidential Management Financial Report — Double-counting-safe monthly branch aggregation.',
      pageNumber: p,
      totalPages,
    });
  }

  doc.save(`house-of-muktai-branch-summary-${params.monthKey}.pdf`);
}

export async function downloadCredentialSheetPdf(params: {
  employees: Employee[];
  branchFilterLabel: string;
  portalUrl: string;
}): Promise<void> {
  const logoDataUrl = await loadBrandLogoPngDataUrl();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const contentW = pageWidth - margin * 2;

  const drawHeader = () => {
    const afterHead = drawCorporateLetterhead({
      doc,
      logoDataUrl,
      documentTitle: 'STAFF CREDENTIAL SHEET',
      rightMetaTop: `Branch: ${params.branchFilterLabel}`,
      rightMetaBottom: 'Confidential · Super Admin Export',
      margin,
    });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(`Employee Portal URL: ${params.portalUrl}`, margin, afterHead + 1.5);
    doc.text(
      `Generated: ${new Date().toLocaleDateString('en-IN')}`,
      pageWidth - margin,
      afterHead + 1.5,
      { align: 'right' },
    );

    doc.setFillColor(255, 241, 242);
    doc.setDrawColor(253, 164, 175);
    doc.roundedRect(margin, afterHead + 3.5, contentW, 7.5, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(159, 18, 57);
    doc.text(
      `Default First-Time Password: ${DEFAULT_EMPLOYEE_PASSWORD}   |   Staff must set their own password on first login to view incentives.`,
      margin + 3,
      afterHead + 8.3,
    );

    const tableY = afterHead + 13.5;
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, tableY, contentW, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Salesman No', margin + 2.5, tableY + 5.5);
    doc.text('Employee Name', margin + 27, tableY + 5.5);
    doc.text('Branch', margin + 84, tableY + 5.5);
    doc.text('Login ID', margin + 124, tableY + 5.5);
    doc.text('Access Status', pageWidth - margin - 2.5, tableY + 5.5, { align: 'right' });
    return tableY + 8;
  };

  let y = drawHeader();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  const sorted = [...params.employees].sort(
    (a, b) => a.branchName.localeCompare(b.branchName) || a.fullName.localeCompare(b.fullName),
  );

  sorted.forEach((emp, idx) => {
    if (y > 268) {
      doc.addPage();
      y = drawHeader();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
    }
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, contentW, 8, 'F');
    }
    doc.setTextColor(15, 23, 42);
    doc.text(emp.employeeId.slice(0, 12), margin + 2.5, y + 5.5);
    doc.text(emp.fullName.slice(0, 28), margin + 27, y + 5.5);
    doc.text(emp.branchName.slice(0, 18), margin + 84, y + 5.5);
    doc.setFont('helvetica', 'bold');
    doc.text(emp.loginId, margin + 124, y + 5.5);
    doc.setFont('helvetica', 'normal');
    const accessLabel =
      emp.status === 'INACTIVE'
        ? 'INACTIVE'
        : emp.credentialsProvisioned
          ? emp.mustChangePassword
            ? 'Ready (Pwd Reset)'
            : 'Active Login'
          : 'Not Provisioned';
    doc.text(accessLabel, pageWidth - margin - 2.5, y + 5.5, { align: 'right' });
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y + 8, pageWidth - margin, y + 8);
    y += 8;
  });

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawCorporateFooter({
      doc,
      margin,
      note: 'Confidential Staff Access Roster — For internal branch distribution only.',
      pageNumber: p,
      totalPages,
    });
  }

  doc.save(`house-of-muktai-staff-logins-${new Date().toISOString().slice(0, 10)}.pdf`);
}
