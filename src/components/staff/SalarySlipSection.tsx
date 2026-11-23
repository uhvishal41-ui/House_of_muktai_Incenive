import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FileDown,
  ReceiptIndianRupee,
} from 'lucide-react';
import { formatINRFromPaise, formatMonthLabel } from '../../lib/format';
import { downloadEmployeeSalarySlipPdf } from '../../lib/pdfGenerator';
import {
  getSalarySlipEarningBreakdown,
  paiseToIndianWords,
} from '../../lib/salarySlipEngine';
import type { SalarySlip } from '../../types/incentive';

interface HomeCardProps {
  slip: SalarySlip | null;
  monthKey: string;
  isMr: boolean;
  onViewAllSlips: () => void;
}

export function SalarySlipHomeCard({
  slip,
  monthKey,
  isMr,
  onViewAllSlips,
}: HomeCardProps) {
  const [downloading, setDownloading] = useState(false);

  if (!slip) return null;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadEmployeeSalarySlipPdf(slip);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="lg:col-span-12 bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-2xs">
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#0F1F3D] text-[#DFC27D] flex items-center justify-center shrink-0">
            <ReceiptIndianRupee className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[#0F1F3D] truncate">
              {isMr ? 'मासिक पगार स्लिप' : 'Monthly Salary Slip'} · {formatMonthLabel(monthKey)}
            </h2>
            <p className="text-[11px] text-slate-500 truncate">
              {isMr ? 'पगाराचे दिवस' : 'Paid Days'}: {slip.paidDays} / {slip.totalDays}
              {slip.paymentMode ? ` · ${slip.paymentMode}` : ''}
              {slip.paymentDate ? ` · ${slip.paymentDate}` : ''}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onViewAllSlips}
          className="min-h-[36px] px-2.5 rounded-lg text-xs font-semibold text-[#1E3A5F] hover:bg-slate-100 cursor-pointer shrink-0"
        >
          {isMr ? 'सर्व पहा' : 'View All'}
        </button>
      </div>

      <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="grid grid-cols-3 gap-3 flex-1">
          <div>
            <p className="text-[11px] text-slate-500">{isMr ? 'एकूण पगार' : 'Gross Pay'}</p>
            <p className="text-sm sm:text-base font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
              {formatINRFromPaise(slip.grossEarningsPaise)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500">{isMr ? 'कपात' : 'Deductions'}</p>
            <p className="text-sm sm:text-base font-mono tabular-nums font-semibold text-red-700 mt-0.5">
              {formatINRFromPaise(slip.totalDeductionsPaise)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-[#9A7625] font-semibold">
              {isMr ? 'निव्वळ पगार' : 'Net In-Hand'}
            </p>
            <p className="text-base sm:text-lg font-mono tabular-nums font-bold text-[#0F1F3D] mt-0.5">
              {formatINRFromPaise(slip.netPayablePaise)}
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={downloading}
          onClick={() => void handleDownload()}
          className="min-h-[42px] px-4 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-60 shrink-0"
        >
          <FileDown className="w-4 h-4 text-[#DFC27D]" />
          <span>
            {downloading
              ? isMr
                ? 'तयार होत आहे...'
                : 'Generating...'
              : isMr
                ? 'पगार स्लिप PDF डाउनलोड करा'
                : 'Download Salary Slip PDF'}
          </span>
        </button>
      </div>
    </section>
  );
}

interface FullListProps {
  slips: SalarySlip[];
  isMr: boolean;
}

export function SalarySlipFullList({ slips, isMr }: FullListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(slips[0]?.slipId || null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  if (slips.length === 0) {
    return (
      <div className="bg-white border border-slate-200/90 rounded-2xl p-8 text-center space-y-1.5">
        <ReceiptIndianRupee className="w-7 h-7 text-slate-300 mx-auto" />
        <p className="text-sm font-semibold text-slate-700">
          {isMr ? 'अद्याप कोणतीही पगार स्लिप उपलब्ध नाही' : 'No monthly salary slips available yet'}
        </p>
        <p className="text-xs text-slate-500">
          {isMr
            ? 'Admin ने मासिक पगार स्लिप प्रसिद्ध केल्यावर येथे PDF डाउनलोडसाठी दिसतील.'
            : 'Once Accounts publishes monthly salary slips for visible periods, they will appear here for PDF download.'}
        </p>
      </div>
    );
  }

  const handleDownload = async (slip: SalarySlip) => {
    setDownloadingId(slip.slipId);
    try {
      await downloadEmployeeSalarySlipPdf(slip);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-3.5">
      {slips.map((slip) => {
        const isOpen = expandedId === slip.slipId;
        const earnings = getSalarySlipEarningBreakdown(slip, isMr ? 'mr' : 'en');

        const allDeductions: Array<[string, number]> = [
          ['PF', slip.pfPaise],
          ['ESIC', slip.esicPaise],
          [isMr ? 'व्यावसायिक कर (PT)' : 'Professional Tax (PT)', slip.ptPaise],
          [isMr ? 'उचल / हप्ता कपात' : 'Advance / Loan Recovery', slip.advanceRecoveryPaise],
          ['TDS', slip.tdsPaise],
          [isMr ? 'इतर कपात' : 'Other Deductions', slip.otherDeductionPaise],
        ];
        const deductions = allDeductions.filter(([, amt]) => amt > 0);

        return (
          <article
            key={slip.slipId}
            className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-2xs"
          >
            <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-wide text-[#9A7625]">
                  {isMr ? 'मासिक पगार स्लिप' : 'MONTHLY SALARY SLIP'}
                </p>
                <h3 className="text-base font-bold text-[#0F1F3D] mt-0.5">
                  {formatMonthLabel(slip.monthKey)}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {slip.branchName}
                  {slip.departmentName ? ` · ${slip.departmentName}` : ''} ·{' '}
                  {isMr ? 'पगाराचे दिवस' : 'Paid Days'}: {slip.paidDays}/{slip.totalDays}
                </p>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3">
                <div className="sm:text-right">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">
                    {isMr ? 'निव्वळ पगार' : 'Net Payable'}
                  </p>
                  <p className="text-lg font-mono tabular-nums font-bold text-[#0F1F3D]">
                    {formatINRFromPaise(slip.netPayablePaise)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={downloadingId === slip.slipId}
                    onClick={() => void handleDownload(slip)}
                    className="min-h-[40px] px-3.5 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <FileDown className="w-3.5 h-3.5 text-[#DFC27D]" />
                    <span>{downloadingId === slip.slipId ? '...' : 'PDF'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : slip.slipId)}
                    aria-label={isOpen ? 'Collapse details' : 'Expand details'}
                    className="min-h-[40px] w-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 inline-flex items-center justify-center cursor-pointer"
                  >
                    {isOpen ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {isOpen && (
              <div className="px-4 sm:px-5 pb-5 pt-3 border-t border-slate-100 space-y-4 bg-[#F8FAFC]/60">
                {/* Attendance & Bank Strip */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                  {[
                    [isMr ? 'एकूण दिवस' : 'Total Days', slip.totalDays],
                    [isMr ? 'पगार दिवस' : 'Paid Days', slip.paidDays],
                    [isMr ? 'गैरहजर' : 'LOP', slip.lopDays],
                    [isMr ? 'साप्ताहिक सुट्टी' : 'Weekly Off', slip.weeklyOffDays],
                    [isMr ? 'रजा' : 'Paid Leave', slip.paidLeaveDays],
                    ['OT Hrs', slip.overtimeHours],
                  ].map(([label, val]) => (
                    <div
                      key={String(label)}
                      className="rounded-lg bg-white border border-slate-200/80 py-2 px-1.5"
                    >
                      <p className="text-[10px] text-slate-500 truncate">{label}</p>
                      <p className="text-xs font-mono font-bold text-[#0F1F3D] mt-0.5">{val}</p>
                    </div>
                  ))}
                </div>

                {/* Earnings vs Deductions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="bg-white border border-slate-200/80 rounded-xl overflow-hidden">
                    <div className="px-3.5 py-2 bg-[#0F1F3D] text-white text-[11px] font-bold flex justify-between">
                      <span>{isMr ? 'उत्पन्न (Earnings)' : 'Earnings'}</span>
                      <span>{formatINRFromPaise(slip.grossEarningsPaise)}</span>
                    </div>
                    <div className="divide-y divide-slate-100 text-xs">
                      {earnings.map(([label, amt]) => (
                        <div key={label} className="px-3.5 py-2 flex justify-between gap-2">
                          <span className="text-slate-600">{label}</span>
                          <span className="font-mono tabular-nums font-semibold text-slate-900">
                            {formatINRFromPaise(amt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200/80 rounded-xl overflow-hidden">
                    <div className="px-3.5 py-2 bg-slate-800 text-white text-[11px] font-bold flex justify-between">
                      <span>{isMr ? 'कपात (Deductions)' : 'Deductions'}</span>
                      <span>{formatINRFromPaise(slip.totalDeductionsPaise)}</span>
                    </div>
                    <div className="divide-y divide-slate-100 text-xs">
                      {deductions.length === 0 ? (
                        <div className="px-3.5 py-3 text-slate-400">
                          {isMr ? 'कोणतीही कपात नाही' : 'No deductions for this month'}
                        </div>
                      ) : (
                        deductions.map(([label, amt]) => (
                          <div key={label} className="px-3.5 py-2 flex justify-between gap-2">
                            <span className="text-slate-600">{label}</span>
                            <span className="font-mono tabular-nums font-semibold text-red-700">
                              {formatINRFromPaise(amt)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Net Words + Bank / Payment Metadata */}
                <div className="rounded-xl bg-[#0F1F3D]/[0.04] border border-[#0F1F3D]/15 px-3.5 py-3 space-y-1 text-xs">
                  <p className="font-semibold text-[#0F1F3D]">
                    {paiseToIndianWords(slip.netPayablePaise)}
                  </p>
                  <p className="text-[11px] text-slate-600">
                    {[
                      slip.bankName ? `${slip.bankName}` : '',
                      slip.bankAccountMasked ? `A/c ${slip.bankAccountMasked}` : '',
                      slip.paymentMode ? `Mode: ${slip.paymentMode}` : '',
                      slip.paymentReference ? `Ref: ${slip.paymentReference}` : '',
                      slip.paymentDate ? `Date: ${slip.paymentDate}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ') ||
                      (isMr
                        ? 'SHRIMUKTAI MART PRIVATE LIMITED अधिकृत मासिक पगार स्लिप'
                        : 'Official SHRIMUKTAI MART PRIVATE LIMITED Monthly Salary Slip')}
                  </p>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
