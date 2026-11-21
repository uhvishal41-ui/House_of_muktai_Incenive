import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, Clock, MessageSquare } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { formatINRFromPaise } from '../../lib/format';
import type { EmployeeQuery, ImportBatch } from '../../types/incentive';
import type { AdminNavTab } from './AdminGlobalSearch';

interface Props {
  batches: ImportBatch[];
  employeeQueries: EmployeeQuery[];
  onNavigate: (tab: AdminNavTab) => void;
}

export function AdminNotificationCenter({ batches, employeeQueries, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const pendingBatches = batches.filter(
    (b) => b.status === 'VALIDATED' || b.status === 'APPROVED' || b.status === 'PROCESSING',
  );
  const failedBatches = batches.filter((b) => b.status === 'FAILED');
  const openQueries = employeeQueries.filter((q) => q.status !== 'RESOLVED');

  const totalActionable = pendingBatches.length + failedBatches.length + openQueries.length;

  const jump = (tab: AdminNavTab) => {
    setOpen(false);
    onNavigate(tab);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Admin Notifications (${totalActionable} pending)`}
        aria-expanded={open}
        className="relative h-8 w-8 rounded-lg bg-white hover:bg-slate-50 border border-slate-200/90 text-[#0F1F3D] inline-flex items-center justify-center cursor-pointer transition-colors"
      >
        <Bell className="w-4 h-4" />
        {totalActionable > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#B8923A] text-[#0F1F3D] text-[10px] font-bold font-mono flex items-center justify-center">
            {totalActionable > 99 ? '99+' : totalActionable}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden z-40"
          >
            <div className="px-4 py-3 bg-[#0F1F3D] text-white flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold tracking-tight">Action Center</h3>
                <p className="text-[11px] text-[#DFC27D]">
                  {totalActionable > 0
                    ? `${totalActionable} item(s) requiring attention`
                    : 'All approvals and queries are up to date'}
                </p>
              </div>
              <Bell className="w-4 h-4 text-[#DFC27D]" />
            </div>

            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
              {totalActionable === 0 ? (
                <div className="py-8 px-4 text-center space-y-1.5">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto" />
                  <p className="text-xs font-medium text-slate-700">Everything is clear</p>
                  <p className="text-[11px] text-slate-500">
                    No pending batch approvals, failed publishes, or open employee queries.
                  </p>
                </div>
              ) : (
                <>
                  {failedBatches.map((b) => (
                    <button
                      key={b.batchId}
                      type="button"
                      onClick={() => jump('history')}
                      className="w-full p-3.5 hover:bg-red-50/40 text-left flex items-start gap-3 cursor-pointer transition-colors"
                    >
                      <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-red-900 truncate">
                          Publish Failed: {b.fileName}
                        </p>
                        <p className="text-[11px] text-slate-600 mt-0.5">
                          {b.periodStart || b.businessDate} · Safe to retry publish
                        </p>
                      </div>
                    </button>
                  ))}

                  {pendingBatches.map((b) => (
                    <button
                      key={b.batchId}
                      type="button"
                      onClick={() => jump('history')}
                      className="w-full p-3.5 hover:bg-slate-50 text-left flex items-start gap-3 cursor-pointer transition-colors"
                    >
                      <Clock className="w-4 h-4 text-[#B8923A] shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#0F1F3D] truncate">
                          {b.status}: {b.fileName}
                        </p>
                        <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                          {b.totalRows} rows · {formatINRFromPaise(b.totalIncentivePaise)}
                        </p>
                      </div>
                    </button>
                  ))}

                  {openQueries.slice(0, 6).map((q) => (
                    <button
                      key={q.queryId}
                      type="button"
                      onClick={() => jump('payouts')}
                      className="w-full p-3.5 hover:bg-slate-50 text-left flex items-start gap-3 cursor-pointer transition-colors"
                    >
                      <MessageSquare className="w-4 h-4 text-[#1E3A5F] shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#0F1F3D] truncate">
                          Query: {q.subject}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">
                          {q.employeeName} (#{q.employeeId}) · {q.status.replace('_', ' ')}
                        </p>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
