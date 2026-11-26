import React, { useEffect, useMemo, useState } from 'react';
import { Award, Building2, Eye, ShieldCheck, Target, Users } from 'lucide-react';
import { formatINRFromPaise, formatMonthLabel, formatQty } from '../../lib/format';
import { subscribeBranchManagerFloorData } from '../../services/proFeaturesService';
import type {
  Employee,
  MonthlySummary,
  SalesTarget,
} from '../../types/incentive';

interface Props {
  branchId: string;
  branchName: string;
  onlyEmployeeVisible: boolean;
  isMr: boolean;
}

export function BranchManagerFloorView({
  branchId,
  branchName,
  onlyEmployeeVisible,
  isMr,
}: Props) {
  const [branchStaff, setBranchStaff] = useState<Employee[]>([]);
  const [branchSummaries, setBranchSummaries] = useState<MonthlySummary[]>([]);
  const [branchTargets, setBranchTargets] = useState<SalesTarget[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    let loadedCount = 0;
    const markLoaded = () => {
      loadedCount += 1;
      if (loadedCount >= 2) setLoading(false);
    };

    const unsub = subscribeBranchManagerFloorData({
      branchId,
      onlyEmployeeVisible,
      onEmployees: (list) => {
        setBranchStaff(list);
        markLoaded();
      },
      onSummaries: (list) => {
        setBranchSummaries(list);
        markLoaded();
      },
      onTargets: (list) => {
        setBranchTargets(list);
        markLoaded();
      },
      onError: (err) => {
        setError(err.message);
        setLoading(false);
      },
    });

    const fallbackTimer = window.setTimeout(() => setLoading(false), 1800);
    return () => {
      window.clearTimeout(fallbackTimer);
      unsub();
    };
  }, [branchId, onlyEmployeeVisible]);

  const months = useMemo(() => {
    const set = new Set<string>();
    for (const s of branchSummaries) set.add(s.monthKey);
    for (const t of branchTargets) set.add(t.monthKey);
    return Array.from(set)
      .filter((m) => /^\d{4}-\d{2}$/.test(m))
      .sort()
      .reverse();
  }, [branchSummaries, branchTargets]);

  const effectiveMonth = months.includes(selectedMonth) ? selectedMonth : months[0] || '';

  const branchMonthTarget = useMemo(
    () =>
      branchTargets.find(
        (t) => t.scope === 'BRANCH' && t.branchId === branchId && t.monthKey === effectiveMonth,
      ) || null,
    [branchTargets, branchId, effectiveMonth],
  );

  const staffRows = useMemo(() => {
    const summaryByEmp = new Map<string, MonthlySummary>();
    for (const s of branchSummaries) {
      if (s.monthKey === effectiveMonth) {
        summaryByEmp.set(s.employeeId.toUpperCase(), s);
      }
    }
    const targetByEmp = new Map<string, SalesTarget>();
    for (const t of branchTargets) {
      if (t.scope === 'EMPLOYEE' && t.monthKey === effectiveMonth && t.employeeId) {
        targetByEmp.set(t.employeeId.toUpperCase(), t);
      }
    }

    return branchStaff
      .filter((e) => e.status === 'ACTIVE')
      .map((emp) => {
        const key = emp.employeeId.toUpperCase();
        const sum = summaryByEmp.get(key);
        const tgt = targetByEmp.get(key);
        const salesPaise = sum?.totalSaleAmtPaise || 0;
        const qty = sum?.totalSaleQty || 0;
        const incPaise = sum?.grandTotalPaise || 0;
        const targetPaise = tgt?.targetSaleAmtPaise || 0;
        const pct = targetPaise > 0 ? Math.min(999, Math.round((salesPaise / targetPaise) * 100)) : null;

        return {
          employeeId: emp.employeeId,
          fullName: emp.fullName,
          departmentName: emp.departmentName || emp.designation || 'Sales Floor',
          salesPaise,
          qty,
          incPaise,
          targetPaise,
          pct,
        };
      })
      .sort((a, b) => b.salesPaise - a.salesPaise || b.incPaise - a.incPaise);
  }, [branchStaff, branchSummaries, branchTargets, effectiveMonth]);

  const totals = useMemo(() => {
    const salesPaise = staffRows.reduce((s, r) => s + r.salesPaise, 0);
    const incPaise = staffRows.reduce((s, r) => s + r.incPaise, 0);
    const qty = staffRows.reduce((s, r) => s + r.qty, 0);
    const targetPaise = branchMonthTarget?.targetSaleAmtPaise || 0;
    const pct = targetPaise > 0 ? Math.round((salesPaise / targetPaise) * 100) : null;
    return { salesPaise, incPaise, qty, targetPaise, pct };
  }, [staffRows, branchMonthTarget]);

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-[#0F1F3D] to-[#1A315A] text-white rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#DFC27D] mb-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              {isMr ? 'ब्रांच मॅनेजर फ्लोर व्ह्यू (केवळ वाचन)' : 'Branch Manager Floor View (Read-Only)'}
            </div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Building2 className="w-5 h-5 text-[#DFC27D]" />
              {branchName}
            </h2>
            <p className="text-xs text-slate-300 mt-1">
              {isMr
                ? 'फक्त तुमच्या स्वतःच्या शाखेची विक्री, टार्गेट आणि इन्सेंटिव्ह प्रगती. इतर कर्मचाऱ्यांच्या पगार स्लिप पूर्णपणे खाजगी आहेत.'
                : 'Strictly scoped to your branch sales, targets & incentives. Peer salary slips remain 100% private.'}
            </p>
          </div>
          {months.length > 0 && (
            <select
              value={effectiveMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-9 px-3 rounded-xl bg-white/10 border border-white/20 text-xs font-semibold text-white self-start sm:self-center"
            >
              {months.map((mk) => (
                <option key={mk} value={mk} className="text-slate-900">
                  {formatMonthLabel(mk)}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-white/15">
          <div>
            <p className="text-[11px] text-slate-300">{isMr ? 'सक्रिय स्टाफ' : 'Active Staff'}</p>
            <p className="text-lg font-bold font-mono">{staffRows.length}</p>
          </div>
          <div>
            <p className="text-[11px] text-slate-300">{isMr ? 'शाखा एकूण विक्री' : 'Branch Sales'}</p>
            <p className="text-lg font-bold font-mono">{formatINRFromPaise(totals.salesPaise)}</p>
          </div>
          <div>
            <p className="text-[11px] text-slate-300">{isMr ? 'शाखा इन्सेंटिव्ह' : 'Branch Incentive'}</p>
            <p className="text-lg font-bold font-mono text-[#DFC27D]">
              {formatINRFromPaise(totals.incPaise)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-slate-300">{isMr ? 'टार्गेट पूर्णता' : 'Target Progress'}</p>
            <p className="text-lg font-bold font-mono">
              {totals.pct !== null ? `${totals.pct}%` : '—'}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#0F1F3D]" />
            <h3 className="text-sm font-bold text-[#0F1F3D]">
              {isMr ? 'शाखा टीम कामगिरी' : 'Branch Team Performance'}{' '}
              {effectiveMonth ? `(${formatMonthLabel(effectiveMonth)})` : ''}
            </h3>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
            <Eye className="w-3.5 h-3.5" />
            Read-Only
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading branch floor data...</div>
        ) : staffRows.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No active staff records found for {branchName}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3 text-left font-semibold">#</th>
                  <th className="py-2.5 px-3 text-left font-semibold">
                    {isMr ? 'कर्मचारी' : 'Staff Member'}
                  </th>
                  <th className="py-2.5 px-3 text-right font-semibold">
                    {isMr ? 'विक्री' : 'Sales'}
                  </th>
                  <th className="py-2.5 px-3 text-right font-semibold">
                    {isMr ? 'नग (Quantity)' : 'Quantity'}
                  </th>
                  <th className="py-2.5 px-3 text-right font-semibold">
                    {isMr ? 'इन्सेंटिव्ह' : 'Incentive'}
                  </th>
                  <th className="py-2.5 px-3 text-right font-semibold">
                    {isMr ? 'टार्गेट %' : 'Target %'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {staffRows.map((row, idx) => (
                  <tr key={row.employeeId} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-3 font-mono text-slate-500">{idx + 1}</td>
                    <td className="py-2.5 px-3">
                      <p className="font-semibold text-[#0F1F3D] flex items-center gap-1.5">
                        {row.fullName}
                        {idx === 0 && row.salesPaise > 0 && (
                          <Award className="w-3.5 h-3.5 text-[#B8923A] shrink-0" />
                        )}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {row.employeeId} · {row.departmentName}
                      </p>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatINRFromPaise(row.salesPaise)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                      {formatQty(row.qty)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-emerald-700">
                      {formatINRFromPaise(row.incPaise)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {row.pct !== null ? (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold ${
                            row.pct >= 100
                              ? 'bg-emerald-50 text-emerald-700'
                              : row.pct >= 75
                                ? 'bg-amber-50 text-amber-800'
                                : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          <Target className="w-3 h-3" />
                          {row.pct}%
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
