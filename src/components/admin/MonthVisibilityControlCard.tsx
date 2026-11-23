import React, { useEffect, useMemo, useState } from 'react';
import { Check, Eye, EyeOff, Lock, Save, ShieldCheck } from 'lucide-react';
import { formatMonthLabel } from '../../lib/format';
import { savePortalVisibilitySettings } from '../../services/departmentVisibilityService';
import type {
  PortalVisibilitySettings,
  PublishedIncentive,
  VisibilityMode,
} from '../../types/incentive';

interface Props {
  visibilitySettings: PortalVisibilitySettings;
  incentives: PublishedIncentive[];
  availableMonths: string[];
  onSaved: (nextSettings: PortalVisibilitySettings) => Promise<void> | void;
}

export function MonthVisibilityControlCard({
  visibilitySettings,
  incentives,
  availableMonths,
  onSaved,
}: Props) {
  const [mode, setMode] = useState<VisibilityMode>(visibilitySettings.mode || 'ALL');
  const [selectedMonths, setSelectedMonths] = useState<string[]>(
    visibilitySettings.visibleMonths || [],
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setMode(visibilitySettings.mode || 'ALL');
    setSelectedMonths(visibilitySettings.visibleMonths || []);
  }, [visibilitySettings.mode, visibilitySettings.visibleMonths, visibilitySettings.updatedAt]);

  const monthCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const rec of incentives) {
      if (rec.status !== 'PUBLISHED') continue;
      map.set(rec.monthKey, (map.get(rec.monthKey) || 0) + 1);
    }
    return map;
  }, [incentives]);

  const allMonthsSorted = useMemo(() => {
    const set = new Set<string>(availableMonths);
    for (const m of selectedMonths) {
      if (/^\d{4}-\d{2}$/.test(m)) set.add(m);
    }
    for (const m of monthCounts.keys()) set.add(m);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [availableMonths, selectedMonths, monthCounts]);

  const toggleMonth = (monthKey: string) => {
    setMode('SELECTED');
    setSelectedMonths((prev) =>
      prev.includes(monthKey) ? prev.filter((m) => m !== monthKey) : [...prev, monthKey],
    );
  };

  const isDirty = useMemo(() => {
    if (mode !== visibilitySettings.mode) return true;
    const a = [...selectedMonths].sort().join(',');
    const b = [...(visibilitySettings.visibleMonths || [])].sort().join(',');
    return a !== b;
  }, [mode, selectedMonths, visibilitySettings.mode, visibilitySettings.visibleMonths]);

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await savePortalVisibilitySettings({
        mode,
        visibleMonths: selectedMonths,
      });
      setFeedback({
        type: 'ok',
        text:
          res.settings.mode === 'ALL'
            ? `Employee portal now shows ALL published months (${res.documentsUpdated} records synced).`
            : res.settings.visibleMonths.length === 0
              ? `All months temporarily hidden from employee mobile app (${res.documentsUpdated} records synced). Admin history remains intact.`
              : `Employee portal restricted strictly to: ${res.settings.visibleMonths.map((m) => formatMonthLabel(m)).join(', ')} (${res.documentsUpdated} records synced).`,
      });
      await onSaved(res.settings);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save employee month visibility.',
      });
    } finally {
      setSaving(false);
    }
  };

  const liveSummaryLabel =
    visibilitySettings.mode === 'ALL'
      ? 'All published months visible to employees'
      : visibilitySettings.visibleMonths.length === 0
        ? 'No months currently open to employees'
        : `Strictly visible to employees: ${visibilitySettings.visibleMonths
            .map((m) => formatMonthLabel(m))
            .join(', ')}`;

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 sm:px-5 py-3.5 bg-[#0F1F3D] text-white flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-white/10 border border-[#B8923A]/50 flex items-center justify-center shrink-0">
            <Eye className="w-4 h-4 text-[#DFC27D]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight text-white">
              Employee Mobile App · Month Visibility Control
            </h2>
            <p className="text-[11px] text-slate-300 truncate">
              Choose which published months staff can view · Hidden months remain 100% preserved in Admin
            </p>
          </div>
        </div>
        <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#DFC27D] shrink-0">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>{liveSummaryLabel}</span>
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        {/* Visibility Mode Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setMode('ALL')}
            className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
              mode === 'ALL'
                ? 'border-[#0F1F3D] bg-[#0F1F3D]/[0.04] ring-1 ring-[#0F1F3D]/15'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#0F1F3D]">
                Show All Published Months
              </span>
              <span
                className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                  mode === 'ALL'
                    ? 'border-[#0F1F3D] bg-[#0F1F3D] text-white'
                    : 'border-slate-300 bg-white'
                }`}
              >
                {mode === 'ALL' && <Check className="w-2.5 h-2.5" />}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Employees can switch between all published months in their statement & leaderboard.
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('SELECTED');
              if (selectedMonths.length === 0 && allMonthsSorted.length > 0) {
                setSelectedMonths([allMonthsSorted[0]]);
              }
            }}
            className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
              mode === 'SELECTED'
                ? 'border-[#B8923A] bg-[#B8923A]/[0.06] ring-1 ring-[#B8923A]/25'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#0F1F3D]">
                Show Selected Months Only
              </span>
              <span
                className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                  mode === 'SELECTED'
                    ? 'border-[#B8923A] bg-[#B8923A] text-white'
                    : 'border-slate-300 bg-white'
                }`}
              >
                {mode === 'SELECTED' && <Check className="w-2.5 h-2.5" />}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Example: Select only <strong>Oct 2026</strong> so staff strictly view Oct 2026 reports.
            </p>
          </button>
        </div>

        {/* Multi-Select Month Toggles */}
        {mode === 'SELECTED' && (
          <div className="space-y-3 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-700">
                Select Allowed Months ({selectedMonths.length} selected)
              </p>
              <div className="inline-flex items-center gap-2 text-[11px]">
                {allMonthsSorted.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedMonths([allMonthsSorted[0]])}
                    className="text-[#0F1F3D] font-medium hover:underline cursor-pointer"
                  >
                    Latest Only ({formatMonthLabel(allMonthsSorted[0])})
                  </button>
                )}
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  onClick={() => setSelectedMonths([...allMonthsSorted])}
                  className="text-slate-600 hover:text-[#0F1F3D] cursor-pointer"
                >
                  Select All
                </button>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  onClick={() => setSelectedMonths([])}
                  className="text-slate-500 hover:text-red-700 cursor-pointer"
                >
                  Hide All
                </button>
              </div>
            </div>

            {allMonthsSorted.length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500">
                No published months found yet. Publish an Excel batch first to configure visibility.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {allMonthsSorted.map((mk) => {
                  const checked = selectedMonths.includes(mk);
                  const count = monthCounts.get(mk) || 0;
                  return (
                    <button
                      key={mk}
                      type="button"
                      onClick={() => toggleMonth(mk)}
                      className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer flex items-start justify-between gap-2 ${
                        checked
                          ? 'border-[#0F1F3D] bg-[#0F1F3D] text-white shadow-xs'
                          : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:border-slate-300 hover:bg-white'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate">
                          {formatMonthLabel(mk)}
                        </div>
                        <div
                          className={`text-[10px] font-mono mt-0.5 ${
                            checked ? 'text-[#DFC27D]' : 'text-slate-500'
                          }`}
                        >
                          {count} rec{count === 1 ? '' : 's'}
                        </div>
                      </div>
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 ${
                          checked
                            ? 'border-[#DFC27D] bg-[#B8923A] text-white'
                            : 'border-slate-300 bg-white text-transparent'
                        }`}
                      >
                        <Check className="w-2.5 h-2.5" />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedMonths.length === 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center gap-2">
                <EyeOff className="w-4 h-4 shrink-0" />
                <span>
                  Zero months selected — employees will temporarily see an empty statement screen
                  until you enable at least one month.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Footer Action Row */}
        <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <Lock className="w-3.5 h-3.5 text-[#0F1F3D] shrink-0" />
            <span>
              Enforced server-side via Firestore Rules & Employee App · Admin always retains full access.
            </span>
          </div>
          <button
            type="button"
            disabled={saving || !isDirty}
            onClick={handleSave}
            className="h-9 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50 transition-colors"
          >
            <Save className="w-3.5 h-3.5 text-[#DFC27D]" />
            {saving ? 'Applying to Staff App...' : 'Apply Employee Visibility'}
          </button>
        </div>

        {feedback && (
          <div
            className={`p-3 rounded-lg border text-xs leading-relaxed ${
              feedback.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {feedback.text}
          </div>
        )}
      </div>
    </section>
  );
}
