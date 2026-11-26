import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FileDown,
  MessageSquarePlus,
  ReceiptIndianRupee,
} from 'lucide-react';
import { formatINRFromPaise, formatMonthLabel } from '../../lib/format';
import { downloadEmployeeSalarySlipPdf } from '../../lib/pdfGenerator';
import {
  getSalarySlipDeductionBreakdown,
  getSalarySlipEarningBreakdown,
  paiseToIndianWords,
} from '../../lib/salarySlipEngine';
import type { SalarySlip } from '../../types/incentive';

interface HomeCardProps {
  slip: SalarySlip | null;
  allSlips?: SalarySlip[];
  monthKey: string;
  isMr: boolean;
  onSelectMonth?: (monthKey: string) => void;
  onViewAllSlips: () => void;
  onRaiseQuery?: (slip: SalarySlip) => void;
}

export function SalarySlipHomeCard({
  slip,
  allSlips = [],
  monthKey,
  isMr,
  onSelectMonth,
  onViewAllSlips,
  onRaiseQuery,
}: HomeCardProps) {
  const [downloading, setDownloading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const activeSlip = slip || allSlips[0] || null;
  if (!activeSlip) return null;

  const displayMonthKey = activeSlip.monthKey || monthKey;
  const earnings = getSalarySlipEarningBreakdown(activeSlip, isMr ? 'mr' : 'en');
  const deductions = getSalarySlipDeductionBreakdown(activeSlip, isMr ? 'mr' : 'en');

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadEmployeeSalarySlipPdf(activeSlip);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="lg:col-span-12 bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-2xs">
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#0F1F3D] text-[#DFC27D] flex items-center justify-center shrink-0">
            <ReceiptIndianRupee className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-[#0F1F3D] truncate">
                {isMr ? 'मासिक पगार स्लिप (Monthly Salary Slip)' : 'Monthly Salary Slip'} ·{' '}
                {formatMonthLabel(displayMonthKey)}
              </h2>
              {allSlips.length > 1 && onSelectMonth && (
                <select
                  aria-label="Select salary slip month"
                  value={displayMonthKey}
                  onChange={(e) => onSelectMonth(e.target.value)}
                  className="h-7 px-2 rounded-lg border border-slate-200 bg-slate-50 text-[11px] font-semibold text-[#0F1F3D] cursor-pointer"
                >
                  {allSlips.map((s) => (
                    <option key={s.slipId} value={s.monthKey}>
                      {formatMonthLabel(s.monthKey)}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <p className="text-[11px] text-slate-500 truncate mt-0.5">
              {isMr ? 'पगाराचे दिवस' : 'Paid Days'}: {activeSlip.paidDays} / {activeSlip.totalDays}
              {activeSlip.presentDays && activeSlip.presentDays > 0
                ? ` · ${isMr ? 'हजर' : 'Present'}: ${activeSlip.presentDays}`
                : ''}
              {activeSlip.lopDays > 0 ? ` · LOP: ${activeSlip.lopDays}` : ''}
              {activeSlip.paymentMode ? ` · ${activeSlip.paymentMode}` : ''}
              {activeSlip.paymentDate ? ` · ${activeSlip.paymentDate}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-[#0F1F3D] inline-flex items-center gap-1 cursor-pointer"
          >
            <span>
              {expanded
                ? isMr
                  ? 'तपशील लपवा'
                  : 'Hide Breakdown'
                : isMr
                  ? 'संपूर्ण तपशील पहा'
                  : 'Full Breakdown'}
            </span>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={onViewAllSlips}
            className="min-h-[36px] px-2.5 rounded-lg text-xs font-semibold text-[#1E3A5F] hover:bg-slate-100 cursor-pointer"
          >
            {isMr ? `सर्व स्लिप्स (${allSlips.length || 1})` : `All Slips (${allSlips.length || 1})`}
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="grid grid-cols-3 gap-3 flex-1">
          <div className="rounded-xl bg-slate-50/80 border border-slate-200/70 px-3 py-2.5">
            <p className="text-[11px] text-slate-500">{isMr ? 'एकूण पगार (Gross)' : 'Gross Pay'}</p>
            <p className="text-sm sm:text-base font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
              {formatINRFromPaise(activeSlip.grossEarningsPaise)}
            </p>
          </div>
          <div className="rounded-xl bg-red-50/40 border border-red-200/60 px-3 py-2.5">
            <p className="text-[11px] text-slate-500">{isMr ? 'एकूण कपात' : 'Deductions'}</p>
            <p className="text-sm sm:text-base font-mono tabular-nums font-semibold text-red-700 mt-0.5">
              {formatINRFromPaise(activeSlip.totalDeductionsPaise)}
            </p>
          </div>
          <div className="rounded-xl bg-[#FDF8EC] border border-[#B8923A]/40 px-3 py-2.5">
            <p className="text-[11px] text-[#9A7625] font-semibold">
              {isMr ? 'हातात मिळणारा पगार' : 'Net In-Hand'}
            </p>
            <p className="text-base sm:text-lg font-mono tabular-nums font-bold text-[#0F1F3D] mt-0.5">
              {formatINRFromPaise(activeSlip.netPayablePaise)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
          {onRaiseQuery && (
            <button
              type="button"
              onClick={() => onRaiseQuery(activeSlip)}
              className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[#0F1F3D] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
            >
              <MessageSquarePlus className="w-3.5 h-3.5 text-[#B8923A]" />
              <span>{isMr ? 'शंका विचारा' : 'Ask Question'}</span>
            </button>
          )}
          <button
            type="button"
            disabled={downloading}
            onClick={() => void handleDownload()}
            className="min-h-[42px] px-4 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-60 flex-1 sm:flex-initial"
          >
            <FileDown className="w-4 h-4 text-[#DFC27D]" />
            <span>
              {downloading
                ? isMr
                  ? 'तयार होत आहे...'
                  : 'Generating...'
                : isMr
                  ? 'पगार स्लिप PDF डाउनलोड'
                  : 'Download Payslip PDF'}
            </span>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 sm:px-5 pb-5 pt-3 border-t border-slate-100 space-y-4 bg-[#F8FAFC]/60">
          {/* Attendance Strip */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
            {[
              [isMr ? 'एकूण दिवस' : 'Total Days', activeSlip.totalDays],
              ...(activeSlip.presentDays && activeSlip.presentDays > 0
                ? [[isMr ? 'हजर दिवस' : 'Present Days', activeSlip.presentDays] as [string, number]]
                : []),
              [isMr ? 'पगार दिवस' : 'Paid Days', activeSlip.paidDays],
              [isMr ? 'गैरहजर (LOP)' : 'LOP Days', activeSlip.lopDays],
              [isMr ? 'साप्ताहिक सुट्टी' : 'Weekly Off', activeSlip.weeklyOffDays],
              ...(activeSlip.overtimeDays && activeSlip.overtimeDays > 0
                ? [[isMr ? 'OT दिवस' : 'OT Days', activeSlip.overtimeDays] as [string, number]]
                : [[isMr ? 'रजा' : 'Paid Leave', activeSlip.paidLeaveDays] as [string, number]]),
              ...(activeSlip.presentDays && activeSlip.presentDays > 0
                ? []
                : [['OT Hrs', activeSlip.overtimeHours] as [string, number]]),
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
                <span className="font-mono">{formatINRFromPaise(activeSlip.grossEarningsPaise)}</span>
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
                <span className="font-mono">{formatINRFromPaise(activeSlip.totalDeductionsPaise)}</span>
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

          {/* Net Pay in Words + Bank Metadata */}
          <div className="rounded-xl bg-[#0F1F3D]/[0.04] border border-[#0F1F3D]/15 px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <p className="font-semibold text-[#0F1F3D]">
              {paiseToIndianWords(activeSlip.netPayablePaise)}
            </p>
            <p className="text-[11px] text-slate-600 font-mono">
              {[
                activeSlip.bankName,
                activeSlip.bankAccountMasked ? `A/c ${activeSlip.bankAccountMasked}` : '',
                activeSlip.paymentMode ? `Mode: ${activeSlip.paymentMode}` : '',
                activeSlip.paymentReference ? `Ref: ${activeSlip.paymentReference}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

interface FullListProps {
  slips: SalarySlip[];
  isMr: boolean;
  onRaiseQuery?: (slip: SalarySlip) => void;
}

export function SalarySlipFullList({ slips, isMr, onRaiseQuery }: FullListProps) {
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
        const deductions = getSalarySlipDeductionBreakdown(slip, isMr ? 'mr' : 'en');

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
                  {onRaiseQuery && (
                    <button
                      type="button"
                      onClick={() => onRaiseQuery(slip)}
                      className="min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[#0F1F3D] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <MessageSquarePlus className="w-3.5 h-3.5 text-[#B8923A]" />
                      <span>{isMr ? 'शंका' : 'Query'}</span>
                    </button>
                  )}
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
                    ...(slip.presentDays && slip.presentDays > 0
                      ? [[isMr ? 'हजर दिवस' : 'Present Days', slip.presentDays] as [string, number]]
                      : []),
                    [isMr ? 'पगार दिवस' : 'Paid Days', slip.paidDays],
                    [isMr ? 'गैरहजर' : 'LOP', slip.lopDays],
                    [isMr ? 'साप्ताहिक सुट्टी' : 'Weekly Off', slip.weeklyOffDays],
                    ...(slip.overtimeDays && slip.overtimeDays > 0
                      ? [[isMr ? 'OT दिवस' : 'OT Days', slip.overtimeDays] as [string, number]]
                      : [[isMr ? 'रजा' : 'Paid Leave', slip.paidLeaveDays] as [string, number]]),
                    ...(slip.presentDays && slip.presentDays > 0
                      ? []
                      : [['OT Hrs', slip.overtimeHours] as [string, number]]),
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

                {/* Statutory IDs (UAN No, PF No, ESIC No, PAN) */}
                {(slip.uanNumber || slip.pfNumber || slip.esicNumber || slip.panNumber) && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      ['UAN No', slip.uanNumber],
                      ['PF No', slip.pfNumber],
                      ['ESIC No', slip.esicNumber],
                      ['PAN', slip.panNumber],
                    ]
                      .filter(([, val]) => Boolean(val))
                      .map(([label, val]) => (
                        <div
                          key={String(label)}
                          className="rounded-lg bg-white border border-slate-200/80 px-3 py-2 min-w-0"
                        >
                          <p className="text-[10px] font-medium text-slate-500">{label}</p>
                          <p className="text-xs font-mono font-semibold text-[#0F1F3D] truncate mt-0.5">
                            {val}
                          </p>
                        </div>
                      ))}
                  </div>
                )}

                {/* Net Words + Bank / Payment Metadata */}
                <div className="rounded-xl bg-[#0F1F3D]/[0.04] border border-[#0F1F3D]/15 px-3.5 py-3 space-y-1 text-xs">
                  <p className="font-semibold text-[#0F1F3D]">
                    {paiseToIndianWords(slip.netPayablePaise)}
                  </p>
                  <p className="text-[11px] text-slate-600">
                    {[
                      slip.bankName ? `${slip.bankName}` : '',
                      slip.bankAccountMasked ? `A/c ${slip.bankAccountMasked}` : '',
                      slip.bankIfsc ? `IFSC: ${slip.bankIfsc}` : '',
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

