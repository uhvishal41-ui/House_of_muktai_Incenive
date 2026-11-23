import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, FileSpreadsheet, ReceiptIndianRupee, Search, Users, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { formatINRFromPaise, formatMonthLabel } from '../../lib/format';
import type { Branch, Employee, ImportBatch, SalarySlip } from '../../types/incentive';

export type AdminNavTab =
  | 'overview'
  | 'analytics'
  | 'payouts'
  | 'salary'
  | 'branches'
  | 'employees'
  | 'import'
  | 'history';

interface Props {
  open: boolean;
  onClose: () => void;
  branches: Branch[];
  employees: Employee[];
  batches: ImportBatch[];
  salarySlips?: SalarySlip[];
  onNavigate: (tab: AdminNavTab) => void;
}

export function AdminGlobalSearch({
  open,
  onClose,
  branches,
  employees,
  batches,
  salarySlips = [],
  onNavigate,
}: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const trimmed = query.trim().toLowerCase();

  const results = useMemo(() => {
    if (!trimmed) {
      return {
        employees: employees.slice(0, 5),
        branches: branches.slice(0, 4),
        salarySlips: salarySlips.slice(0, 3),
        batches: batches.slice(0, 3),
      };
    }

    const matchedEmployees = employees
      .filter(
        (e) =>
          e.fullName.toLowerCase().includes(trimmed) ||
          e.employeeId.toLowerCase().includes(trimmed) ||
          e.loginId.toLowerCase().includes(trimmed) ||
          e.branchName.toLowerCase().includes(trimmed) ||
          (e.departmentName || '').toLowerCase().includes(trimmed),
      )
      .slice(0, 8);

    const matchedBranches = branches
      .filter(
        (b) =>
          b.branchName.toLowerCase().includes(trimmed) ||
          b.branchCode.toLowerCase().includes(trimmed) ||
          b.city.toLowerCase().includes(trimmed),
      )
      .slice(0, 5);

    const matchedSalarySlips = salarySlips
      .filter(
        (s) =>
          s.employeeName.toLowerCase().includes(trimmed) ||
          s.employeeId.toLowerCase().includes(trimmed) ||
          s.branchName.toLowerCase().includes(trimmed) ||
          (s.departmentName || '').toLowerCase().includes(trimmed) ||
          s.monthKey.toLowerCase().includes(trimmed) ||
          formatMonthLabel(s.monthKey).toLowerCase().includes(trimmed) ||
          'salary slip payslip'.includes(trimmed),
      )
      .slice(0, 5);

    const matchedBatches = batches
      .filter(
        (b) =>
          b.fileName.toLowerCase().includes(trimmed) ||
          b.status.toLowerCase().includes(trimmed) ||
          (b.periodStart || b.businessDate).toLowerCase().includes(trimmed),
      )
      .slice(0, 5);

    return {
      employees: matchedEmployees,
      branches: matchedBranches,
      salarySlips: matchedSalarySlips,
      batches: matchedBatches,
    };
  }, [trimmed, employees, branches, salarySlips, batches]);

  const totalMatches =
    results.employees.length +
    results.branches.length +
    results.salarySlips.length +
    results.batches.length;

  const jumpTo = (tab: AdminNavTab) => {
    onNavigate(tab);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Global Admin Search"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#0F1F3D]/45 backdrop-blur-xs"
          />

          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-xl bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden"
          >
            {/* Search Input Bar */}
            <div className="flex items-center gap-3 px-4 h-14 border-b border-slate-200">
              <Search className="w-4 h-4 text-[#B8923A] shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search employees, departments, salary slips, branches, or batches..."
                className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={onClose}
                aria-label="Close search"
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 inline-flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Results */}
            <div className="max-h-[65vh] overflow-y-auto divide-y divide-slate-100">
              {totalMatches === 0 ? (
                <div className="py-10 px-6 text-center text-sm text-slate-500">
                  No employees, departments, salary slips, branches, or batches matched &ldquo;{query}&rdquo;.
                </div>
              ) : (
                <>
                  {results.employees.length > 0 && (
                    <div className="p-3">
                      <p className="px-2 pb-1.5 text-[11px] font-semibold text-slate-400">
                        Employees ({results.employees.length})
                      </p>
                      <div className="space-y-0.5">
                        {results.employees.map((emp) => (
                          <button
                            key={emp.employeeId}
                            type="button"
                            onClick={() => jumpTo('employees')}
                            className="w-full px-2.5 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between gap-3 text-left cursor-pointer transition-colors"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Users className="w-4 h-4 text-[#1E3A5F] shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-[#0F1F3D] truncate">
                                  {emp.fullName}
                                </p>
                                <p className="text-[11px] text-slate-500 truncate">
                                  <span className="font-mono">#{emp.employeeId}</span> ·{' '}
                                  {emp.branchName}
                                  {emp.departmentName ? ` · ${emp.departmentName}` : ''} ·{' '}
                                  {emp.designation}
                                </p>
                              </div>
                            </div>
                            <span
                              className={`text-[11px] font-semibold shrink-0 ${
                                emp.status === 'ACTIVE' ? 'text-emerald-700' : 'text-red-700'
                              }`}
                            >
                              {emp.status}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {results.salarySlips.length > 0 && (
                    <div className="p-3">
                      <p className="px-2 pb-1.5 text-[11px] font-semibold text-slate-400">
                        Salary Slips ({results.salarySlips.length})
                      </p>
                      <div className="space-y-0.5">
                        {results.salarySlips.map((slip) => (
                          <button
                            key={slip.slipId}
                            type="button"
                            onClick={() => jumpTo('salary')}
                            className="w-full px-2.5 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between gap-3 text-left cursor-pointer transition-colors"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <ReceiptIndianRupee className="w-4 h-4 text-[#B8923A] shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-[#0F1F3D] truncate">
                                  {slip.employeeName} · {formatMonthLabel(slip.monthKey)}
                                </p>
                                <p className="text-[11px] text-slate-500 truncate">
                                  <span className="font-mono">#{slip.employeeId}</span> ·{' '}
                                  {slip.branchName}
                                  {slip.departmentName ? ` · ${slip.departmentName}` : ''}
                                </p>
                              </div>
                            </div>
                            <span className="text-[11px] font-mono font-semibold text-emerald-700 shrink-0 tabular-nums">
                              {formatINRFromPaise(slip.netPayablePaise)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {results.branches.length > 0 && (
                    <div className="p-3">
                      <p className="px-2 pb-1.5 text-[11px] font-semibold text-slate-400">
                        Branches ({results.branches.length})
                      </p>
                      <div className="space-y-0.5">
                        {results.branches.map((br) => (
                          <button
                            key={br.branchId}
                            type="button"
                            onClick={() => jumpTo('branches')}
                            className="w-full px-2.5 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between gap-3 text-left cursor-pointer transition-colors"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Building2 className="w-4 h-4 text-[#B8923A] shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-[#0F1F3D] truncate">
                                  {br.branchName}
                                </p>
                                <p className="text-[11px] text-slate-500 truncate">
                                  <span className="font-mono">{br.branchCode}</span> · {br.city}
                                </p>
                              </div>
                            </div>
                            <span
                              className={`text-[11px] font-semibold shrink-0 ${
                                br.active ? 'text-emerald-700' : 'text-slate-400'
                              }`}
                            >
                              {br.active ? 'Active' : 'Inactive'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {results.batches.length > 0 && (
                    <div className="p-3">
                      <p className="px-2 pb-1.5 text-[11px] font-semibold text-slate-400">
                        Import Batches ({results.batches.length})
                      </p>
                      <div className="space-y-0.5">
                        {results.batches.map((b) => (
                          <button
                            key={b.batchId}
                            type="button"
                            onClick={() => jumpTo('history')}
                            className="w-full px-2.5 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between gap-3 text-left cursor-pointer transition-colors"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <FileSpreadsheet className="w-4 h-4 text-[#1E3A5F] shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-[#0F1F3D] truncate">
                                  {b.fileName}
                                </p>
                                <p className="text-[11px] text-slate-500 font-mono truncate">
                                  {b.importType || 'DAILY'} · {b.periodStart || b.businessDate} ·{' '}
                                  {formatINRFromPaise(b.totalIncentivePaise)}
                                </p>
                              </div>
                            </div>
                            <span className="text-[11px] font-semibold text-slate-600 shrink-0">
                              {b.status}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="px-4 py-2.5 bg-[#F8FAFC] border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
              <span>Click any result to jump directly to its workspace</span>
              <span className="font-mono text-slate-400">ESC to close</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
