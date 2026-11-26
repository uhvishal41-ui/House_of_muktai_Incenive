import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Lock,
  ReceiptIndianRupee,
  Save,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { formatMonthLabel } from '../../lib/format';
import { savePortalVisibilitySettings } from '../../services/departmentVisibilityService';
import type {
  PortalVisibilitySettings,
  PublishedIncentive,
  SalarySlip,
  VisibilityMode,
} from '../../types/incentive';

interface Props {
  visibilitySettings: PortalVisibilitySettings;
  incentives: PublishedIncentive[];
  salarySlips?: SalarySlip[];
  availableMonths: string[];
  defaultFocus?: 'incentives' | 'salary';
  onSaved: (nextSettings: PortalVisibilitySettings) => Promise<void> | void;
}

type SectionKey = 'incentives' | 'salary';

export function MonthVisibilityControlCard({
  visibilitySettings,
  incentives,
  salarySlips = [],
  availableMonths,
  defaultFocus = 'incentives',
  onSaved,
}: Props) {
  const [activeSection, setActiveSection] = useState<SectionKey>(defaultFocus);

  const initialSlipMode: VisibilityMode =
    visibilitySettings.salarySlipMode ?? visibilitySettings.mode ?? 'ALL';
  const initialSlipMonths: string[] =
    visibilitySettings.salarySlipVisibleMonths ??
    (visibilitySettings.salarySlipMode ? [] : visibilitySettings.visibleMonths || []);

  const [mode, setMode] = useState<VisibilityMode>(visibilitySettings.mode || 'ALL');
  const [selectedMonths, setSelectedMonths] = useState<string[]>(
    visibilitySettings.visibleMonths || [],
  );
  const [salarySlipMode, setSalarySlipMode] = useState<VisibilityMode>(initialSlipMode);
  const [selectedSlipMonths, setSelectedSlipMonths] = useState<string[]>(initialSlipMonths);

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    const nextIncMode: VisibilityMode = visibilitySettings.mode || 'ALL';
    const nextIncMonths = visibilitySettings.visibleMonths || [];
    const nextSlipMode: VisibilityMode = visibilitySettings.salarySlipMode ?? nextIncMode;
    const nextSlipMonths =
      visibilitySettings.salarySlipVisibleMonths ??
      (visibilitySettings.salarySlipMode ? [] : nextIncMonths);
    setMode(nextIncMode);
    setSelectedMonths(nextIncMonths);
    setSalarySlipMode(nextSlipMode);
    setSelectedSlipMonths(nextSlipMonths);
  }, [
    visibilitySettings.mode,
    visibilitySettings.visibleMonths,
    visibilitySettings.salarySlipMode,
    visibilitySettings.salarySlipVisibleMonths,
    visibilitySettings.updatedAt,
  ]);

  const incentiveMonthCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const rec of incentives) {
      if (rec.status !== 'PUBLISHED') continue;
      map.set(rec.monthKey, (map.get(rec.monthKey) || 0) + 1);
    }
    return map;
  }, [incentives]);

  const salarySlipMonthCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const slip of salarySlips) {
      map.set(slip.monthKey, (map.get(slip.monthKey) || 0) + 1);
    }
    return map;
  }, [salarySlips]);

  const allMonthsSorted = useMemo(() => {
    const set = new Set<string>(availableMonths);
    for (const m of selectedMonths) {
      if (/^\d{4}-\d{2}$/.test(m)) set.add(m);
    }
    for (const m of selectedSlipMonths) {
      if (/^\d{4}-\d{2}$/.test(m)) set.add(m);
    }
    for (const m of incentiveMonthCounts.keys()) set.add(m);
    for (const m of salarySlipMonthCounts.keys()) set.add(m);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [
    availableMonths,
    selectedMonths,
    selectedSlipMonths,
    incentiveMonthCounts,
    salarySlipMonthCounts,
  ]);

  const toggleIncentiveMonth = (monthKey: string) => {
    setMode('SELECTED');
    setSelectedMonths((prev) =>
      prev.includes(monthKey) ? prev.filter((m) => m !== monthKey) : [...prev, monthKey],
    );
  };

  const toggleSlipMonth = (monthKey: string) => {
    setSalarySlipMode('SELECTED');
    setSelectedSlipMonths((prev) =>
      prev.includes(monthKey) ? prev.filter((m) => m !== monthKey) : [...prev, monthKey],
    );
  };

  const isDirty = useMemo(() => {
    if (mode !== (visibilitySettings.mode || 'ALL')) return true;
    const savedInc = [...(visibilitySettings.visibleMonths || [])].sort().join(',');
    const curInc = [...selectedMonths].sort().join(',');
    if (savedInc !== curInc) return true;

    const savedSlipMode = visibilitySettings.salarySlipMode ?? visibilitySettings.mode ?? 'ALL';
    if (salarySlipMode !== savedSlipMode) return true;

    const savedSlipArr =
      visibilitySettings.salarySlipVisibleMonths ??
      (visibilitySettings.salarySlipMode ? [] : visibilitySettings.visibleMonths || []);
    const savedSlip = [...savedSlipArr].sort().join(',');
    const curSlip = [...selectedSlipMonths].sort().join(',');
    return savedSlip !== curSlip;
  }, [
    mode,
    selectedMonths,
    salarySlipMode,
    selectedSlipMonths,
    visibilitySettings.mode,
    visibilitySettings.visibleMonths,
    visibilitySettings.salarySlipMode,
    visibilitySettings.salarySlipVisibleMonths,
  ]);

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await savePortalVisibilitySettings({
        mode,
        visibleMonths: selectedMonths,
        salarySlipMode,
        salarySlipVisibleMonths: selectedSlipMonths,
      });

      const incLabel =
        res.settings.mode === 'ALL'
          ? 'All months'
          : res.settings.visibleMonths.length === 0
            ? 'Hidden'
            : res.settings.visibleMonths.map((m) => formatMonthLabel(m)).join(', ');
      const slipModeResolved = res.settings.salarySlipMode ?? res.settings.mode;
      const slipMonthsResolved = res.settings.salarySlipVisibleMonths ?? res.settings.visibleMonths;
      const slipLabel =
        slipModeResolved === 'ALL'
          ? 'All months'
          : slipMonthsResolved.length === 0
            ? 'Hidden'
            : slipMonthsResolved.map((m) => formatMonthLabel(m)).join(', ');

      setFeedback({
        type: 'ok',
        text: `Updated employee visibility (${res.documentsUpdated} records synced) — Incentives: ${incLabel} · Payment Slips: ${slipLabel}.`,
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

  const liveIncentiveBadge =
    visibilitySettings.mode === 'ALL'
      ? 'All Months'
      : visibilitySettings.visibleMonths.length === 0
        ? 'Hidden'
        : visibilitySettings.visibleMonths.map((m) => formatMonthLabel(m)).join(', ');

  const liveSlipMode = visibilitySettings.salarySlipMode ?? visibilitySettings.mode ?? 'ALL';
  const liveSlipMonths =
    visibilitySettings.salarySlipVisibleMonths ??
    (visibilitySettings.salarySlipMode ? [] : visibilitySettings.visibleMonths || []);
  const liveSlipBadge =
    liveSlipMode === 'ALL'
      ? 'All Months'
      : liveSlipMonths.length === 0
        ? 'Hidden'
        : liveSlipMonths.map((m) => formatMonthLabel(m)).join(', ');

  const isIncentiveTab = activeSection === 'incentives';
  const currentMode = isIncentiveTab ? mode : salarySlipMode;
  const currentMonths = isIncentiveTab ? selectedMonths : selectedSlipMonths;
  const currentCounts = isIncentiveTab ? incentiveMonthCounts : salarySlipMonthCounts;
  const countUnit = isIncentiveTab ? 'rec' : 'slip';

  const setCurrentMode = (next: VisibilityMode) => {
    if (isIncentiveTab) {
      setMode(next);
      if (next === 'SELECTED' && selectedMonths.length === 0 && allMonthsSorted.length > 0) {
        setSelectedMonths([allMonthsSorted[0]]);
      }
    } else {
      setSalarySlipMode(next);
      if (next === 'SELECTED' && selectedSlipMonths.length === 0 && allMonthsSorted.length > 0) {
        setSelectedSlipMonths([allMonthsSorted[0]]);
      }
    }
  };

  const setCurrentMonths = (next: string[]) => {
    if (isIncentiveTab) {
      setMode('SELECTED');
      setSelectedMonths(next);
    } else {
      setSalarySlipMode('SELECTED');
      setSelectedSlipMonths(next);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 sm:px-5 py-3.5 bg-[#0F1F3D] text-white flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-white/10 border border-[#B8923A]/50 flex items-center justify-center shrink-0">
            <Eye className="w-4 h-4 text-[#DFC27D]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight text-white">
              Employee Portal · Month Visibility
            </h2>
            <p className="text-[11px] text-slate-300 truncate">
              Control which months staff can view for Incentives and Salary Slips
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-medium text-[#DFC27D] shrink-0">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Incentives: {liveIncentiveBadge}</span>
          </span>
          <span className="text-white/30">·</span>
          <span className="inline-flex items-center gap-1.5">
            <ReceiptIndianRupee className="w-3.5 h-3.5" />
            <span>Payment Slips: {liveSlipBadge}</span>
          </span>
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        {/* Independent Control Switcher: Incentives vs Payment Slips */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-3">
          <div className="inline-flex p-1 bg-slate-100 rounded-xl self-start">
            <button
              type="button"
              onClick={() => setActiveSection('incentives')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-all cursor-pointer ${
                isIncentiveTab
                  ? 'bg-[#0F1F3D] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Incentive Months</span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  isIncentiveTab ? 'bg-white/15 text-[#DFC27D]' : 'bg-slate-200/80 text-slate-600'
                }`}
              >
                {mode === 'ALL' ? 'ALL' : `${selectedMonths.length}M`}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('salary')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-all cursor-pointer ${
                !isIncentiveTab
                  ? 'bg-[#0F1F3D] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ReceiptIndianRupee className="w-3.5 h-3.5" />
              <span>Payment Slip Months</span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  !isIncentiveTab ? 'bg-white/15 text-[#DFC27D]' : 'bg-slate-200/80 text-slate-600'
                }`}
              >
                {salarySlipMode === 'ALL' ? 'ALL' : `${selectedSlipMonths.length}M`}
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              if (isIncentiveTab) {
                setMode(salarySlipMode);
                setSelectedMonths([...selectedSlipMonths]);
              } else {
                setSalarySlipMode(mode);
                setSelectedSlipMonths([...selectedMonths]);
              }
            }}
            className="text-[11px] font-medium text-[#0F1F3D] hover:underline inline-flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5 text-[#B8923A]" />
            <span>
              {isIncentiveTab ? 'Match Payment Slip Settings' : 'Match Incentive Settings'}
            </span>
          </button>
        </div>

        {/* Visibility Mode Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setCurrentMode('ALL')}
            className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
              currentMode === 'ALL'
                ? 'border-[#0F1F3D] bg-[#0F1F3D]/[0.04] ring-1 ring-[#0F1F3D]/15'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#0F1F3D]">
                {isIncentiveTab
                  ? 'Show All Published Incentive Months'
                  : 'Show All Uploaded Payment Slip Months'}
              </span>
              <span
                className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                  currentMode === 'ALL'
                    ? 'border-[#0F1F3D] bg-[#0F1F3D] text-white'
                    : 'border-slate-300 bg-white'
                }`}
              >
                {currentMode === 'ALL' && <Check className="w-2.5 h-2.5" />}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {isIncentiveTab
                ? 'Employees can view all published incentive statements & department rankings.'
                : 'Employees can view and download all uploaded monthly salary slips.'}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setCurrentMode('SELECTED')}
            className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
              currentMode === 'SELECTED'
                ? 'border-[#B8923A] bg-[#B8923A]/[0.06] ring-1 ring-[#B8923A]/25'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#0F1F3D]">
                {isIncentiveTab
                  ? 'Show Selected Incentive Months Only'
                  : 'Show Selected Payment Slip Months Only'}
              </span>
              <span
                className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                  currentMode === 'SELECTED'
                    ? 'border-[#B8923A] bg-[#B8923A] text-white'
                    : 'border-slate-300 bg-white'
                }`}
              >
                {currentMode === 'SELECTED' && <Check className="w-2.5 h-2.5" />}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {isIncentiveTab
                ? 'Release only checked incentive months to staff while keeping all older months safe in Admin.'
                : 'Release only checked payment slip months to staff (e.g., after payroll verification).'}
            </p>
          </button>
        </div>

        {/* Multi-Select Month Toggles */}
        {currentMode === 'SELECTED' && (
          <div className="space-y-3 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-700">
                Select Allowed {isIncentiveTab ? 'Incentive' : 'Payment Slip'} Months (
                {currentMonths.length} selected)
              </p>
              <div className="inline-flex items-center gap-2 text-[11px]">
                {allMonthsSorted.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCurrentMonths([allMonthsSorted[0]])}
                    className="text-[#0F1F3D] font-medium hover:underline cursor-pointer"
                  >
                    Latest Only ({formatMonthLabel(allMonthsSorted[0])})
                  </button>
                )}
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  onClick={() => setCurrentMonths([...allMonthsSorted])}
                  className="text-slate-600 hover:text-[#0F1F3D] cursor-pointer"
                >
                  Select All
                </button>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  onClick={() => setCurrentMonths([])}
                  className="text-slate-500 hover:text-red-700 cursor-pointer"
                >
                  Hide All
                </button>
              </div>
            </div>

            {allMonthsSorted.length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500">
                No published months found yet. Upload incentives or salary slips first to configure
                visibility.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {allMonthsSorted.map((mk) => {
                  const checked = currentMonths.includes(mk);
                  const count = currentCounts.get(mk) || 0;
                  return (
                    <button
                      key={mk}
                      type="button"
                      onClick={() =>
                        isIncentiveTab ? toggleIncentiveMonth(mk) : toggleSlipMonth(mk)
                      }
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
                          {count} {countUnit}
                          {count === 1 ? '' : 's'}
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

            {currentMonths.length === 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center gap-2">
                <EyeOff className="w-4 h-4 shrink-0" />
                <span>
                  Zero months selected — {isIncentiveTab ? 'incentives' : 'payment slips'} will be
                  temporarily hidden in the Employee Portal until you enable at least one month.
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
              Enforced server-side via Firestore Security Rules · Both Admin &amp; Owner retain full
              access.
            </span>
          </div>
          <button
            type="button"
            disabled={saving || !isDirty}
            onClick={handleSave}
            className="h-9 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50 transition-colors"
          >
            <Save className="w-3.5 h-3.5 text-[#DFC27D]" />
            {saving ? 'Applying to Staff App...' : 'Apply Visibility to Staff App'}
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
