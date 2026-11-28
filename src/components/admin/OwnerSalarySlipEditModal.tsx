import React, { useMemo, useState } from 'react';
import { Crown, Save, X } from 'lucide-react';
import { formatINRFromPaise, formatMonthLabel } from '../../lib/format';
import { normalizeSalaryPaymentMode } from '../../lib/salarySlipEngine';
import {
  updatePublishedSalarySlipByOwner,
  type OwnerSalarySlipEditInput,
} from '../../services/salarySlipService';
import type { SalarySlip, SalarySlipPaymentMode } from '../../types/incentive';

interface Props {
  slip: SalarySlip;
  isMainOwner?: boolean;
  onClose: () => void;
  onSaved: (updated: SalarySlip) => Promise<void>;
}

function paiseToRupeeStr(paise?: number): string {
  const val = (paise || 0) / 100;
  return Number.isInteger(val) ? String(val) : val.toFixed(2);
}

function rupeeStrToPaise(str: string): number {
  const num = Number(str);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 100);
}

function numStrToFloat(str: string): number {
  const num = Number(str);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 100) / 100;
}

export function OwnerSalarySlipEditModal({ slip, isMainOwner = false, onClose, onSaved }: Props) {
  const [totalDays, setTotalDays] = useState(String(slip.totalDays ?? 30));
  const [presentDays, setPresentDays] = useState(String(slip.presentDays ?? slip.paidDays ?? 0));
  const [paidDays, setPaidDays] = useState(String(slip.paidDays ?? 0));
  const [lopDays, setLopDays] = useState(String(slip.lopDays ?? 0));
  const [weeklyOffDays, setWeeklyOffDays] = useState(String(slip.weeklyOffDays ?? 0));
  const [paidLeaveDays, setPaidLeaveDays] = useState(String(slip.paidLeaveDays ?? 0));
  const [overtimeDays, setOvertimeDays] = useState(String(slip.overtimeDays ?? 0));
  const [overtimeHours, setOvertimeHours] = useState(String(slip.overtimeHours ?? 0));

  // Earnings (in rupees)
  const [basic, setBasic] = useState(paiseToRupeeStr(slip.basicPaise));
  const [da, setDa] = useState(paiseToRupeeStr(slip.dearnessAllowancePaise));
  const [hra, setHra] = useState(paiseToRupeeStr(slip.hraPaise));
  const [attendanceAllow, setAttendanceAllow] = useState(
    paiseToRupeeStr(slip.attendanceAllowancePaise),
  );
  const [washingAllow, setWashingAllow] = useState(paiseToRupeeStr(slip.washingAllowancePaise));
  const [conveyance, setConveyance] = useState(paiseToRupeeStr(slip.conveyancePaise));
  const [medicalAllow, setMedicalAllow] = useState(paiseToRupeeStr(slip.medicalAllowancePaise));
  const [lta, setLta] = useState(paiseToRupeeStr(slip.leaveTravelAllowancePaise));
  const [commExp, setCommExp] = useState(paiseToRupeeStr(slip.communicationExpensesPaise));
  const [healthClub, setHealthClub] = useState(paiseToRupeeStr(slip.healthClubAllowancePaise));
  const [adhocAllow, setAdhocAllow] = useState(paiseToRupeeStr(slip.adhocAllowancePaise));
  const [travelAllow, setTravelAllow] = useState(paiseToRupeeStr(slip.travelingAllowancePaise));
  const [salesComm, setSalesComm] = useState(paiseToRupeeStr(slip.salesCommissionPaise));
  const [specialAllow, setSpecialAllow] = useState(paiseToRupeeStr(slip.specialAllowancePaise));
  const [overtime, setOvertime] = useState(paiseToRupeeStr(slip.overtimePaise));
  const [incentive, setIncentive] = useState(paiseToRupeeStr(slip.incentivePaise));
  const [arrears, setArrears] = useState(paiseToRupeeStr(slip.arrearsPaise));
  const [otherEarnings, setOtherEarnings] = useState(paiseToRupeeStr(slip.otherEarningsPaise));

  // Deductions (in rupees)
  const [pf, setPf] = useState(paiseToRupeeStr(slip.pfPaise));
  const [esic, setEsic] = useState(paiseToRupeeStr(slip.esicPaise));
  const [pt, setPt] = useState(paiseToRupeeStr(slip.ptPaise));
  const [lwf, setLwf] = useState(paiseToRupeeStr(slip.lwfPaise));
  const [advanceRecovery, setAdvanceRecovery] = useState(
    paiseToRupeeStr(slip.advanceRecoveryPaise),
  );
  const [tds, setTds] = useState(paiseToRupeeStr(slip.tdsPaise));
  const [penalty, setPenalty] = useState(paiseToRupeeStr(slip.penaltyPaise));
  const [insurance, setInsurance] = useState(paiseToRupeeStr(slip.insurancePaise));
  const [otherDeduction, setOtherDeduction] = useState(paiseToRupeeStr(slip.otherDeductionPaise));

  // Payment metadata
  const [paymentMode, setPaymentMode] = useState<SalarySlipPaymentMode>(() =>
    normalizeSalaryPaymentMode(String(slip.paymentMode || '')),
  );
  const [paymentReference, setPaymentReference] = useState(slip.paymentReference || '');
  const [paymentDate, setPaymentDate] = useState(slip.paymentDate || '');
  const [remarks, setRemarks] = useState(slip.remarks || '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(() => {
    const grossPaise =
      rupeeStrToPaise(basic) +
      rupeeStrToPaise(da) +
      rupeeStrToPaise(hra) +
      rupeeStrToPaise(attendanceAllow) +
      rupeeStrToPaise(washingAllow) +
      rupeeStrToPaise(conveyance) +
      rupeeStrToPaise(medicalAllow) +
      rupeeStrToPaise(lta) +
      rupeeStrToPaise(commExp) +
      rupeeStrToPaise(healthClub) +
      rupeeStrToPaise(adhocAllow) +
      rupeeStrToPaise(travelAllow) +
      rupeeStrToPaise(salesComm) +
      rupeeStrToPaise(specialAllow) +
      rupeeStrToPaise(overtime) +
      rupeeStrToPaise(incentive) +
      rupeeStrToPaise(arrears) +
      rupeeStrToPaise(otherEarnings);

    const dedPaise =
      rupeeStrToPaise(pf) +
      rupeeStrToPaise(esic) +
      rupeeStrToPaise(pt) +
      rupeeStrToPaise(lwf) +
      rupeeStrToPaise(advanceRecovery) +
      rupeeStrToPaise(tds) +
      rupeeStrToPaise(penalty) +
      rupeeStrToPaise(insurance) +
      rupeeStrToPaise(otherDeduction);

    return {
      grossPaise,
      dedPaise,
      netPaise: grossPaise - dedPaise,
    };
  }, [
    basic, da, hra, attendanceAllow, washingAllow, conveyance, medicalAllow,
    lta, commExp, healthClub, adhocAllow, travelAllow, salesComm, specialAllow,
    overtime, incentive, arrears, otherEarnings,
    pf, esic, pt, lwf, advanceRecovery, tds, penalty, insurance, otherDeduction,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: OwnerSalarySlipEditInput = {
        totalDays: numStrToFloat(totalDays),
        presentDays: numStrToFloat(presentDays),
        paidDays: numStrToFloat(paidDays),
        lopDays: numStrToFloat(lopDays),
        weeklyOffDays: numStrToFloat(weeklyOffDays),
        paidLeaveDays: numStrToFloat(paidLeaveDays),
        overtimeDays: numStrToFloat(overtimeDays),
        overtimeHours: numStrToFloat(overtimeHours),
        basicPaise: rupeeStrToPaise(basic),
        dearnessAllowancePaise: rupeeStrToPaise(da),
        hraPaise: rupeeStrToPaise(hra),
        attendanceAllowancePaise: rupeeStrToPaise(attendanceAllow),
        washingAllowancePaise: rupeeStrToPaise(washingAllow),
        conveyancePaise: rupeeStrToPaise(conveyance),
        medicalAllowancePaise: rupeeStrToPaise(medicalAllow),
        leaveTravelAllowancePaise: rupeeStrToPaise(lta),
        communicationExpensesPaise: rupeeStrToPaise(commExp),
        healthClubAllowancePaise: rupeeStrToPaise(healthClub),
        adhocAllowancePaise: rupeeStrToPaise(adhocAllow),
        travelingAllowancePaise: rupeeStrToPaise(travelAllow),
        salesCommissionPaise: rupeeStrToPaise(salesComm),
        specialAllowancePaise: rupeeStrToPaise(specialAllow),
        overtimePaise: rupeeStrToPaise(overtime),
        incentivePaise: rupeeStrToPaise(incentive),
        arrearsPaise: rupeeStrToPaise(arrears),
        otherEarningsPaise: rupeeStrToPaise(otherEarnings),
        pfPaise: rupeeStrToPaise(pf),
        esicPaise: rupeeStrToPaise(esic),
        ptPaise: rupeeStrToPaise(pt),
        lwfPaise: rupeeStrToPaise(lwf),
        advanceRecoveryPaise: rupeeStrToPaise(advanceRecovery),
        tdsPaise: rupeeStrToPaise(tds),
        penaltyPaise: rupeeStrToPaise(penalty),
        insurancePaise: rupeeStrToPaise(insurance),
        otherDeductionPaise: rupeeStrToPaise(otherDeduction),
        paymentMode,
        paymentReference,
        paymentDate,
        remarks,
      };
      const updated = await updatePublishedSalarySlipByOwner(slip, payload);
      await onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save salary slip changes.');
    } finally {
      setSaving(false);
    }
  };

  const renderAmountField = (label: string, val: string, setter: (v: string) => void) => (
    <label className="block">
      <span className="block text-[11px] font-medium text-slate-600 mb-1">{label} (₹)</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={val}
        onChange={(e) => setter(e.target.value)}
        className="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#0F1F3D] text-white flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-bold flex items-center gap-2">
              <Crown className="w-4 h-4 text-[#DFC27D] shrink-0" />
              <span className="truncate">
                {isMainOwner ? 'Main Owner' : 'Admin'} · Edit &amp; Save Salary Slip ({formatMonthLabel(slip.monthKey)})
              </span>
            </h3>
            <p className="text-xs text-slate-300 mt-0.5 truncate">
              {slip.employeeName} · <span className="font-mono">{slip.employeeId}</span> ·{' '}
              {slip.branchName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-300 hover:text-white cursor-pointer"
            aria-label="Close salary slip editor"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Recalculated Summary Strip */}
        <div className="px-5 py-3 bg-[#FDF8EC] border-b border-[#B8923A]/35 grid grid-cols-3 gap-3 text-xs shrink-0">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Gross Earnings
            </p>
            <p className="text-sm font-bold font-mono tabular-nums text-[#0F1F3D]">
              {formatINRFromPaise(totals.grossPaise)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Total Deductions
            </p>
            <p className="text-sm font-bold font-mono tabular-nums text-red-700">
              {formatINRFromPaise(totals.dedPaise)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Net Payable Salary
            </p>
            <p
              className={`text-sm font-bold font-mono tabular-nums ${
                totals.netPaise < 0 ? 'text-red-700' : 'text-emerald-800'
              }`}
            >
              {formatINRFromPaise(totals.netPaise)}
            </p>
          </div>
        </div>

        {/* Scrollable Fields */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              {error}
            </div>
          )}

          {/* Attendance */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#0F1F3D] mb-2.5">
              Attendance &amp; Days
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ['Total Days', totalDays, setTotalDays],
                ['Present Days', presentDays, setPresentDays],
                ['Paid Days', paidDays, setPaidDays],
                ['LOP Days', lopDays, setLopDays],
                ['Weekly Off', weeklyOffDays, setWeeklyOffDays],
                ['Paid Leave', paidLeaveDays, setPaidLeaveDays],
                ['OT Days', overtimeDays, setOvertimeDays],
                ['OT Hours', overtimeHours, setOvertimeHours],
              ].map(([label, val, setter]) => (
                <label key={label as string} className="block">
                  <span className="block text-[11px] font-medium text-slate-600 mb-1">
                    {label as string}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={val as string}
                    onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                    className="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono text-slate-900"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Earnings */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-800 mb-2.5">
              Earnings (Auto-sums to Gross)
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {renderAmountField('Basic', basic, setBasic)}
              {renderAmountField('Dearness Allow.', da, setDa)}
              {renderAmountField('HRA', hra, setHra)}
              {renderAmountField('Conveyance', conveyance, setConveyance)}
              {renderAmountField('Special Allow.', specialAllow, setSpecialAllow)}
              {renderAmountField('Sales Commission', salesComm, setSalesComm)}
              {renderAmountField('Incentive', incentive, setIncentive)}
              {renderAmountField('Overtime Pay', overtime, setOvertime)}
              {renderAmountField('Attendance Allow.', attendanceAllow, setAttendanceAllow)}
              {renderAmountField('Washing Allow.', washingAllow, setWashingAllow)}
              {renderAmountField('Medical Allow.', medicalAllow, setMedicalAllow)}
              {renderAmountField('LTA', lta, setLta)}
              {renderAmountField('Communication', commExp, setCommExp)}
              {renderAmountField('Health Club', healthClub, setHealthClub)}
              {renderAmountField('Adhoc Allow.', adhocAllow, setAdhocAllow)}
              {renderAmountField('Traveling Allow.', travelAllow, setTravelAllow)}
              {renderAmountField('Arrears', arrears, setArrears)}
              {renderAmountField('Other Earnings', otherEarnings, setOtherEarnings)}
            </div>
          </div>

          {/* Deductions */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-red-800 mb-2.5">
              Deductions (Auto-sums to Total Deductions)
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {renderAmountField('PF', pf, setPf)}
              {renderAmountField('ESIC', esic, setEsic)}
              {renderAmountField('PT', pt, setPt)}
              {renderAmountField('LWF', lwf, setLwf)}
              {renderAmountField('Advance / EMI', advanceRecovery, setAdvanceRecovery)}
              {renderAmountField('TDS', tds, setTds)}
              {renderAmountField('Penalty', penalty, setPenalty)}
              {renderAmountField('Insurance', insurance, setInsurance)}
              {renderAmountField('Other Deduction', otherDeduction, setOtherDeduction)}
            </div>
          </div>

          {/* Payment Details & Remarks */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#0F1F3D] mb-2.5">
              Payment Details &amp; Remarks
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="block text-[11px] font-medium text-slate-600 mb-1">
                  Payment Mode
                </span>
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value as SalarySlipPaymentMode)}
                  className="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                >
                  <option value="">Not Set</option>
                  <option value="BANK">BANK</option>
                  <option value="NEFT">NEFT</option>
                  <option value="DCR">DCR</option>
                  <option value="CASH">CASH</option>
                  <option value="UPI">UPI</option>
                  <option value="CHEQUE">CHEQUE</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-[11px] font-medium text-slate-600 mb-1">
                  Payment Reference / UTR
                </span>
                <input
                  type="text"
                  maxLength={120}
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  className="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono text-slate-900"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-medium text-slate-600 mb-1">
                  Payment Date
                </span>
                <input
                  type="text"
                  maxLength={30}
                  placeholder="YYYY-MM-DD"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono text-slate-900"
                />
              </label>
            </div>
            <label className="block mt-3">
              <span className="block text-[11px] font-medium text-slate-600 mb-1">
                Remarks (shown on slip)
              </span>
              <input
                type="text"
                maxLength={240}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional revision note"
                className="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
              />
            </label>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <p className="text-[11px] text-slate-500">
            Update immediately refreshes both Admin Register and Employee PDF Payslip &amp; logs in Audit Logs.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-9 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <Save className="w-3.5 h-3.5 text-[#DFC27D]" />
              {saving ? 'Updating Slip...' : 'Save Updated Slip'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
