import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  Bell,
  Calendar,
  Check,
  Eye,
  EyeOff,
  FileDown,
  Home,
  Lock,
  LogOut,
  MessageSquare,
  Settings,
  ShieldCheck,
  ShieldOff,
  Target,
  TrendingDown,
  TrendingUp,
  User,
  Wallet,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useAuth } from '../../context/AuthContext';
import { COMPANY_BRAND, DEFAULT_EMPLOYEE_PASSWORD } from '../../lib/companyBrand';
import {
  formatINRFromPaise,
  formatMonthLabel,
  formatQty,
  formatShortDate,
  getCurrentMonthKeyIST,
  getPreviousMonthKey,
} from '../../lib/format';
import { getSavedLang, saveLang, STAFF_COPY, type AppLang } from '../../lib/i18n';
import {
  aggregateEmployeeMonth,
  doesRecordOverlapMonth,
  formatImportTypeLabel,
  getOverlappingMonthKeys,
  normalizeRecordPeriod,
  partitionEmployeeRecords,
} from '../../lib/incentiveEngine';
import { downloadEmployeeIncentiveSlipPdf } from '../../lib/pdfGenerator';
import {
  computeGrowthPctOverBaseline,
  computeTargetProgress,
} from '../../lib/targetCalculations';
import {
  markNotificationRead,
  subscribeOwnMonthlySummaries,
  subscribeOwnNotifications,
  subscribeOwnPublishedIncentives,
  updateOwnEmployeeProfile,
} from '../../services/incentiveService';
import {
  submitEmployeeQuery,
  subscribeOwnActiveAdjustments,
  subscribeOwnEmployeeQueries,
  subscribeOwnPayoutRecords,
  subscribeOwnRelevantSalesTargets,
} from '../../services/operationsService';
import {
  DEFAULT_PORTAL_VISIBILITY,
  subscribeOwnDepartmentLeaderboard,
  subscribeOwnDepartmentRank,
  subscribePortalVisibilitySettings,
} from '../../services/departmentVisibilityService';
import { subscribeOwnSalarySlips } from '../../services/salarySlipService';
import { isMonthVisibleToEmployees } from '../../lib/departmentLeaderboardEngine';
import type {
  DepartmentLeaderboard,
  EmployeeDepartmentRank,
  EmployeeNotification,
  EmployeeQuery,
  IncentiveAdjustment,
  MonthlySummary,
  PayoutRecord,
  PortalVisibilitySettings,
  PublishedIncentive,
  QueryCategory,
  SalarySlip,
  SalesTarget,
} from '../../types/incentive';
import { BrandLogo, CompanyFooter } from '../common/BrandLogo';
import { AnimatedCounter, PageTransition, WorkspaceSkeleton } from '../common/MotionPrimitives';
import { OfflineIndicator } from '../common/OfflineIndicator';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { DepartmentLeaderboardCard } from './DepartmentLeaderboardCard';
import { EmployeeSettingsTab } from './EmployeeSettingsTab';
import { SalarySlipFullList, SalarySlipHomeCard } from './SalarySlipSection';

const EmployeeReportsTab = lazy(() =>
  import('./EmployeeReportsTab').then((m) => ({ default: m.EmployeeReportsTab })),
);

type StaffTab = 'home' | 'statements' | 'reports' | 'profile' | 'settings';
type ProfileSubView = 'details' | 'queries';
type StatementsSubView = 'incentives' | 'salary';

interface StatementRowProps {
  rec: PublishedIncentive;
  t: (typeof STAFF_COPY)[AppLang];
  onDownloadPdf: (rec: PublishedIncentive) => void;
}

function StatementRecordCard({ rec, t, onDownloadPdf }: StatementRowProps) {
  const norm = normalizeRecordPeriod(rec);
  const typeLabel = formatImportTypeLabel(norm.importType);
  const dateRange =
    norm.importType === 'DAILY'
      ? formatShortDate(norm.periodStart)
      : `${formatShortDate(norm.periodStart)} – ${formatShortDate(norm.periodEnd)}`;

  const slabs = [
    {
      label: t.slab1,
      inc: rec.component1Paise,
      sale: rec.saleAmt1Paise || 0,
      qty: rec.saleQty1 || 0,
    },
    {
      label: t.slab2,
      inc: rec.component2Paise,
      sale: rec.saleAmt2Paise || 0,
      qty: rec.saleQty2 || 0,
    },
    {
      label: t.slab3,
      inc: rec.component3Paise,
      sale: rec.saleAmt3Paise || 0,
      qty: rec.saleQty3 || 0,
    },
  ];

  return (
    <div className="p-4 sm:p-5 space-y-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wide text-[#9A7625]">
            {typeLabel}
          </p>
          <p className="text-sm font-semibold text-[#0F1F3D] mt-0.5 leading-snug">{dateRange}</p>
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            {rec.branchName}
            {rec.version > 1 ? ` · Revised v${rec.version}` : ''}
          </p>
        </div>

        <div className="text-right shrink-0">
          <p className="text-base sm:text-lg font-bold font-mono tabular-nums text-[#0F1F3D] leading-tight">
            {formatINRFromPaise(rec.totalPaise)}
          </p>
          <p className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
            {t.saleLabel}: {formatINRFromPaise(rec.totalSaleAmtPaise || 0)}
          </p>
          <p className="text-[11px] font-mono tabular-nums text-slate-500">
            {t.qtyLabel}: {formatQty(rec.totalSaleQty || 0)}
          </p>
        </div>
      </div>

      {/* 3-Slab Clean Aligned Rows on Mobile, 3 Equal Columns on Tablet/Desktop */}
      <div className="rounded-xl bg-[#F8FAFC] border border-slate-200/70 divide-y divide-slate-200/70 sm:divide-y-0 sm:grid sm:grid-cols-3 sm:divide-x">
        {slabs.map((slab) => (
          <div
            key={slab.label}
            className="px-3 py-2.5 flex items-center justify-between gap-3 sm:block"
          >
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-700 truncate">{slab.label}</p>
              <p className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                {t.saleLabel}: {formatINRFromPaise(slab.sale)} · {t.qtyLabel}: {formatQty(slab.qty)}
              </p>
            </div>
            <p className="text-sm font-mono tabular-nums font-semibold text-[#0F1F3D] shrink-0 sm:mt-1.5">
              {formatINRFromPaise(slab.inc)}
            </p>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onDownloadPdf(rec)}
          className="min-h-[40px] px-3.5 rounded-lg border border-[#0F1F3D]/20 bg-[#0F1F3D]/[0.04] hover:bg-[#0F1F3D]/[0.08] active:scale-[0.98] text-xs font-semibold text-[#0F1F3D] inline-flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <FileDown className="w-3.5 h-3.5 text-[#B8923A]" />
          <span>{t.downloadPdfSlip}</span>
        </button>
      </div>
    </div>
  );
}

export function EmployeePortal() {
  const {
    user,
    employeeProfile,
    employeeLoginGate,
    logout,
    changeOwnPassword,
    refreshEmployeeProfile,
  } = useAuth();
  const [lang, setLang] = useState<AppLang>(() => getSavedLang());
  const t = STAFF_COPY[lang];
  const isMr = lang === 'mr';

  const [activeTab, setActiveTab] = useState<StaffTab>('home');
  const [profileSubView, setProfileSubView] = useState<ProfileSubView>('details');
  const [statementsSubView, setStatementsSubView] = useState<StatementsSubView>('incentives');
  const [rawIncentives, setRawIncentives] = useState<PublishedIncentive[]>([]);
  const [rawSummaries, setRawSummaries] = useState<MonthlySummary[]>([]);
  const [notifications, setNotifications] = useState<EmployeeNotification[]>([]);
  const [rawPayoutRecords, setRawPayoutRecords] = useState<PayoutRecord[]>([]);
  const [rawAdjustments, setRawAdjustments] = useState<IncentiveAdjustment[]>([]);
  const [rawSalesTargets, setRawSalesTargets] = useState<SalesTarget[]>([]);
  const [rawSalarySlips, setRawSalarySlips] = useState<SalarySlip[]>([]);
  const [queries, setQueries] = useState<EmployeeQuery[]>([]);
  const [visibilitySettings, setVisibilitySettings] = useState<PortalVisibilitySettings>(
    DEFAULT_PORTAL_VISIBILITY,
  );
  const [visibilityLoaded, setVisibilityLoaded] = useState(false);
  const [deptLeaderboard, setDeptLeaderboard] = useState<DepartmentLeaderboard | null>(null);
  const [deptRank, setDeptRank] = useState<EmployeeDepartmentRank | null>(null);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedTargetMonth, setSelectedTargetMonth] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  // Query form state
  const [queryMonth, setQueryMonth] = useState(getCurrentMonthKeyIST());
  const [queryCategory, setQueryCategory] = useState<QueryCategory>('INCENTIVE_MISMATCH');
  const [querySubject, setQuerySubject] = useState('');
  const [queryMessage, setQueryMessage] = useState('');
  const [querySubmitting, setQuerySubmitting] = useState(false);
  const [queryFeedback, setQueryFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null,
  );

  // Profile form state (H3 fix: structured ok/err feedback)
  const [phone, setPhone] = useState(employeeProfile?.phone || '');
  const [address, setAddress] = useState(employeeProfile?.address || '');
  const [emergencyContact, setEmergencyContact] = useState(employeeProfile?.emergencyContact || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null,
  );

  // Change password state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdMessage, setPwdMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [justUnlockedPortal, setJustUnlockedPortal] = useState(false);

  const toggleLang = (next: AppLang) => {
    setLang(next);
    saveLang(next);
  };

  const requiresFirstLoginPasswordChange = Boolean(employeeProfile?.mustChangePassword);

  // 1. Real-time Admin Month Visibility listener (loaded first so queries match Firestore rules)
  useEffect(() => {
    if (!employeeLoginGate.allowed || requiresFirstLoginPasswordChange || !user?.uid) {
      setVisibilitySettings(DEFAULT_PORTAL_VISIBILITY);
      setVisibilityLoaded(false);
      return;
    }
    const unsub = subscribePortalVisibilitySettings((settings) => {
      setVisibilitySettings(settings);
      setVisibilityLoaded(true);
    });
    return () => unsub();
  }, [employeeLoginGate.allowed, requiresFirstLoginPasswordChange, user?.uid]);

  // 2. Real-time Firestore live subscriptions across ALL employee-scoped collections (visibility-aware)
  useEffect(() => {
    if (!employeeLoginGate.allowed || requiresFirstLoginPasswordChange || !user?.uid) {
      setRawIncentives([]);
      setRawSummaries([]);
      setNotifications([]);
      setRawPayoutRecords([]);
      setRawAdjustments([]);
      setRawSalesTargets([]);
      setRawSalarySlips([]);
      setQueries([]);
      setLoading(false);
      return;
    }

    if (!visibilityLoaded) {
      setLoading(true);
      return;
    }

    const uid = user.uid;
    const empId = employeeProfile?.employeeId;
    const onlyEmployeeVisible = visibilitySettings.mode === 'SELECTED';
    const allMonthsTemporarilyHidden =
      onlyEmployeeVisible && visibilitySettings.visibleMonths.length === 0;

    if (allMonthsTemporarilyHidden) {
      setRawIncentives([]);
      setRawSummaries([]);
      setRawPayoutRecords([]);
      setRawAdjustments([]);
      setRawSalesTargets([]);
      setRawSalarySlips([]);
      setLoading(false);
      const unsubs = [
        subscribeOwnNotifications(uid, (list) => setNotifications(list)),
        subscribeOwnEmployeeQueries(uid, (list) => setQueries(list)),
      ];
      return () => {
        for (const unsub of unsubs) unsub();
      };
    }

    setLoading(true);
    let gotIncentives = false;
    let gotSummaries = false;
    const markReadyIfCoreLoaded = () => {
      if (gotIncentives && gotSummaries) {
        setLoading(false);
      }
    };

    const fallbackTimer = window.setTimeout(() => setLoading(false), 3500);

    const unsubs = [
      subscribeOwnPublishedIncentives(
        uid,
        (records) => {
          setRawIncentives(records);
          gotIncentives = true;
          markReadyIfCoreLoaded();
        },
        onlyEmployeeVisible,
      ),
      subscribeOwnMonthlySummaries(
        uid,
        (list) => {
          setRawSummaries(list);
          gotSummaries = true;
          markReadyIfCoreLoaded();
        },
        onlyEmployeeVisible,
      ),
      subscribeOwnNotifications(uid, (list) => {
        setNotifications(list);
      }),
      subscribeOwnPayoutRecords(
        uid,
        (list) => {
          setRawPayoutRecords(list);
        },
        empId,
        onlyEmployeeVisible,
      ),
      subscribeOwnActiveAdjustments(
        uid,
        (list) => {
          setRawAdjustments(list);
        },
        empId,
        onlyEmployeeVisible,
      ),
      subscribeOwnRelevantSalesTargets(
        uid,
        (list) => {
          setRawSalesTargets(list);
        },
        empId,
        onlyEmployeeVisible,
      ),
      subscribeOwnSalarySlips(
        uid,
        (list) => {
          setRawSalarySlips(list);
        },
        empId,
        onlyEmployeeVisible,
      ),
      subscribeOwnEmployeeQueries(uid, (list) => {
        setQueries(list);
      }),
    ];

    return () => {
      window.clearTimeout(fallbackTimer);
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }, [
    employeeLoginGate.allowed,
    requiresFirstLoginPasswordChange,
    user?.uid,
    employeeProfile?.employeeId,
    visibilityLoaded,
    visibilitySettings.mode,
    visibilitySettings.visibleMonths.join(','),
  ]);

  // Defensive client-side visibility filter synchronized 1:1 with Firestore Rules
  const incentives = useMemo(
    () =>
      rawIncentives.filter((r) =>
        r.periodStart && r.periodEnd
          ? getOverlappingMonthKeys(r).some((m) => isMonthVisibleToEmployees(m, visibilitySettings))
          : isMonthVisibleToEmployees(r.monthKey, visibilitySettings),
      ),
    [rawIncentives, visibilitySettings],
  );
  const summaries = useMemo(
    () => rawSummaries.filter((s) => isMonthVisibleToEmployees(s.monthKey, visibilitySettings)),
    [rawSummaries, visibilitySettings],
  );
  const payoutRecords = useMemo(
    () => rawPayoutRecords.filter((p) => isMonthVisibleToEmployees(p.monthKey, visibilitySettings)),
    [rawPayoutRecords, visibilitySettings],
  );
  const adjustments = useMemo(
    () => rawAdjustments.filter((a) => isMonthVisibleToEmployees(a.monthKey, visibilitySettings)),
    [rawAdjustments, visibilitySettings],
  );
  const salesTargets = useMemo(
    () => rawSalesTargets.filter((t) => isMonthVisibleToEmployees(t.monthKey, visibilitySettings)),
    [rawSalesTargets, visibilitySettings],
  );
  const salarySlips = useMemo(
    () => rawSalarySlips.filter((s) => isMonthVisibleToEmployees(s.monthKey, visibilitySettings)),
    [rawSalarySlips, visibilitySettings],
  );

  // 3. Privacy-hardened single-doc listeners for OWN department Top-3 Leaderboard & OWN personal rank
  useEffect(() => {
    if (
      !employeeLoginGate.allowed ||
      requiresFirstLoginPasswordChange ||
      !employeeProfile ||
      !selectedMonth ||
      !isMonthVisibleToEmployees(selectedMonth, visibilitySettings)
    ) {
      setDeptLeaderboard(null);
      setDeptRank(null);
      return;
    }

    const unsubLb = subscribeOwnDepartmentLeaderboard(
      selectedMonth,
      employeeProfile.departmentId,
      (lb) => setDeptLeaderboard(lb),
    );
    const unsubRank = subscribeOwnDepartmentRank(
      selectedMonth,
      employeeProfile.employeeId,
      (rk) => setDeptRank(rk),
    );

    return () => {
      unsubLb();
      unsubRank();
    };
  }, [
    employeeLoginGate.allowed,
    requiresFirstLoginPasswordChange,
    employeeProfile?.employeeId,
    employeeProfile?.departmentId,
    selectedMonth,
    visibilitySettings,
  ]);

  useEffect(() => {
    setPhone(employeeProfile?.phone || '');
    setAddress(employeeProfile?.address || '');
    setEmergencyContact(employeeProfile?.emergencyContact || '');
  }, [employeeProfile]);

  // Strictly partition Daily, Monthly, and Custom Period records
  const partitioned = useMemo(() => partitionEmployeeRecords(incentives), [incentives]);

  const publishedMonthKeys = useMemo(() => {
    const set = new Set<string>();
    for (const i of incentives) {
      if (i.status !== 'PUBLISHED') continue;
      for (const mk of getOverlappingMonthKeys(i)) set.add(mk);
    }
    return set;
  }, [incentives]);

  const activeSummaries = useMemo(
    () => summaries.filter((s) => s.sourceType !== 'NO_DATA' && publishedMonthKeys.has(s.monthKey)),
    [summaries, publishedMonthKeys],
  );

  const availableMonths = useMemo(() => {
    const set = new Set<string>(publishedMonthKeys);
    for (const s of activeSummaries) set.add(s.monthKey);
    for (const sl of salarySlips) set.add(sl.monthKey);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [activeSummaries, publishedMonthKeys, salarySlips]);

  // Auto-focus latest published month whenever availableMonths changes
  useEffect(() => {
    if (!employeeProfile) return;
    if (availableMonths.length === 0) {
      if (selectedMonth !== '') setSelectedMonth('');
      return;
    }
    if (!availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[0]);
      setQueryMonth(availableMonths[0]);
    }
  }, [employeeProfile, availableMonths, selectedMonth]);

  const prevMonth = selectedMonth ? getPreviousMonthKey(selectedMonth) : '';

  const selectedMonthAgg = useMemo(() => {
    if (!employeeProfile || !selectedMonth) return null;
    return aggregateEmployeeMonth(incentives, employeeProfile.employeeId, selectedMonth);
  }, [incentives, employeeProfile, selectedMonth]);

  const previousMonthAgg = useMemo(() => {
    if (!employeeProfile || !prevMonth) return null;
    return aggregateEmployeeMonth(incentives, employeeProfile.employeeId, prevMonth);
  }, [incentives, employeeProfile, prevMonth]);

  const selectedMonthAdjustments = useMemo(
    () => adjustments.filter((a) => a.monthKey === selectedMonth && a.status === 'ACTIVE'),
    [adjustments, selectedMonth],
  );

  const selectedMonthAdjNetPaise = useMemo(
    () =>
      selectedMonthAdjustments.reduce(
        (acc, a) => acc + (a.type === 'BONUS' ? a.amountPaise : -a.amountPaise),
        0,
      ),
    [selectedMonthAdjustments],
  );

  const selectedMonthPayout = useMemo(
    () => payoutRecords.find((p) => p.monthKey === selectedMonth) || null,
    [payoutRecords, selectedMonth],
  );

  const selectedMonthSalarySlip = useMemo(
    () => salarySlips.find((s) => s.monthKey === selectedMonth) || null,
    [salarySlips, selectedMonth],
  );

  // All months that have a Personal or Branch target for this employee
  const relevantTargetMonths = useMemo(() => {
    if (!employeeProfile) return [];
    const set = new Set<string>();
    for (const tgt of salesTargets) {
      const isPersonal =
        tgt.scope === 'EMPLOYEE' &&
        tgt.employeeId?.toUpperCase() === employeeProfile.employeeId.toUpperCase();
      const isOwnBranch = tgt.scope === 'BRANCH' && tgt.branchId === employeeProfile.branchId;
      if (isPersonal || isOwnBranch) {
        set.add(tgt.monthKey);
      }
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [salesTargets, employeeProfile]);

  // Keep selectedTargetMonth focused on the newest target month (even if that month has 0 sales published yet!)
  useEffect(() => {
    if (relevantTargetMonths.length === 0) {
      if (selectedTargetMonth !== '') setSelectedTargetMonth('');
      return;
    }
    if (!relevantTargetMonths.includes(selectedTargetMonth)) {
      setSelectedTargetMonth(relevantTargetMonths[0]);
    }
  }, [relevantTargetMonths, selectedTargetMonth]);

  const activeTargetMonth = selectedTargetMonth || selectedMonth;

  const personalMonthTarget = useMemo(() => {
    if (!employeeProfile || !activeTargetMonth) return null;
    return (
      salesTargets.find(
        (tgt) =>
          tgt.monthKey === activeTargetMonth &&
          tgt.scope === 'EMPLOYEE' &&
          tgt.employeeId?.toUpperCase() === employeeProfile.employeeId.toUpperCase(),
      ) || null
    );
  }, [salesTargets, activeTargetMonth, employeeProfile]);

  const branchMonthTarget = useMemo(() => {
    if (!employeeProfile || !activeTargetMonth) return null;
    return (
      salesTargets.find(
        (tgt) =>
          tgt.monthKey === activeTargetMonth &&
          tgt.scope === 'BRANCH' &&
          tgt.branchId === employeeProfile.branchId,
      ) || null
    );
  }, [salesTargets, activeTargetMonth, employeeProfile]);

  const selectedMonthTarget = personalMonthTarget || branchMonthTarget;

  const targetMonthAgg = useMemo(() => {
    if (!employeeProfile || !activeTargetMonth) return null;
    return aggregateEmployeeMonth(incentives, employeeProfile.employeeId, activeTargetMonth);
  }, [incentives, employeeProfile, activeTargetMonth]);

  const targetBaselineMonth = activeTargetMonth ? getPreviousMonthKey(activeTargetMonth) : '';
  const targetBaselineAgg = useMemo(() => {
    if (!employeeProfile || !targetBaselineMonth) return null;
    return aggregateEmployeeMonth(incentives, employeeProfile.employeeId, targetBaselineMonth);
  }, [incentives, employeeProfile, targetBaselineMonth]);

  const momDelta = useMemo(() => {
    const curr = selectedMonthAgg?.grandTotalPaise || 0;
    const prev = previousMonthAgg?.grandTotalPaise || 0;
    const diff = curr - prev;
    const pct = prev > 0 ? Math.round((diff / prev) * 100) : curr > 0 ? 100 : 0;
    return { diff, pct };
  }, [selectedMonthAgg, previousMonthAgg]);

  const monthDailyRecords = useMemo(
    () => partitioned.dailyRecords.filter((r) => r.monthKey === selectedMonth),
    [partitioned.dailyRecords, selectedMonth],
  );

  const monthMonthlyRecords = useMemo(
    () => partitioned.monthlyRecords.filter((r) => r.monthKey === selectedMonth),
    [partitioned.monthlyRecords, selectedMonth],
  );

  const monthCustomRecords = useMemo(
    () =>
      partitioned.customPeriodRecords.filter((r) => doesRecordOverlapMonth(r, selectedMonth)),
    [partitioned.customPeriodRecords, selectedMonth],
  );

  const safeMonthlyHistory = useMemo(() => {
    if (!employeeProfile) return [];
    return availableMonths
      .map((monthKey) => aggregateEmployeeMonth(incentives, employeeProfile.employeeId, monthKey))
      .filter((agg) => agg.sourceType !== 'NO_DATA');
  }, [availableMonths, incentives, employeeProfile]);

  // All-time total published incentive (strictly double-counting-safe across all published months)
  const allTimePublishedPaise = useMemo(
    () => safeMonthlyHistory.reduce((acc, m) => acc + m.grandTotalPaise, 0),
    [safeMonthlyHistory],
  );

  const latestRecord = useMemo(
    () => incentives.find((r) => r.status === 'PUBLISHED') || null,
    [incentives],
  );
  const unreadCount = notifications.filter((n) => !n.read).length;
  const openQueriesCount = queries.filter((q) => q.status !== 'RESOLVED').length;

  const initials = useMemo(() => {
    const parts = (employeeProfile?.fullName || 'HM').trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || parts[0]?.[1] || '')).toUpperCase();
  }, [employeeProfile?.fullName]);

  const handleDownloadMonthlyPdf = () => {
    if (!employeeProfile || !selectedMonthAgg) return;
    downloadEmployeeIncentiveSlipPdf({
      employeeName: employeeProfile.fullName,
      employeeId: employeeProfile.employeeId,
      branchName: employeeProfile.branchName,
      designation: employeeProfile.designation,
      periodTitle: `${formatMonthLabel(selectedMonth)} Statement`,
      periodBadge:
        selectedMonthAgg.sourceType === 'MONTHLY_RECORD'
          ? 'MONTHLY'
          : selectedMonthAgg.sourceType === 'DAILY_AGGREGATE'
            ? `DAILY (${selectedMonthAgg.publishedDaysCount}D)`
            : 'STATEMENT',
      slab1SaleAmtPaise: selectedMonthAgg.saleAmt1TotalPaise || 0,
      slab1SaleQty: selectedMonthAgg.saleQty1Total || 0,
      slab1IncentivePaise: selectedMonthAgg.component1TotalPaise || 0,
      slab2SaleAmtPaise: selectedMonthAgg.saleAmt2TotalPaise || 0,
      slab2SaleQty: selectedMonthAgg.saleQty2Total || 0,
      slab2IncentivePaise: selectedMonthAgg.component2TotalPaise || 0,
      slab3SaleAmtPaise: selectedMonthAgg.saleAmt3TotalPaise || 0,
      slab3SaleQty: selectedMonthAgg.saleQty3Total || 0,
      slab3IncentivePaise: selectedMonthAgg.component3TotalPaise || 0,
      totalSaleAmtPaise: selectedMonthAgg.totalSaleAmtPaise || 0,
      totalSaleQty: selectedMonthAgg.totalSaleQty || 0,
      grossIncentivePaise: selectedMonthAgg.grandTotalPaise || 0,
      adjustments: selectedMonthAdjustments,
      payout: selectedMonthPayout,
      fileName: `house-of-muktai-slip-${employeeProfile.employeeId}-${selectedMonth}.pdf`,
    });
  };

  const handleDownloadRecordPdf = (rec: PublishedIncentive) => {
    if (!employeeProfile) return;
    const norm = normalizeRecordPeriod(rec);
    const typeLabel = formatImportTypeLabel(norm.importType);
    const dateRange =
      norm.importType === 'DAILY'
        ? formatShortDate(norm.periodStart)
        : `${formatShortDate(norm.periodStart)} to ${formatShortDate(norm.periodEnd)}`;
    const isMonthlyRec = norm.importType === 'MONTHLY';
    downloadEmployeeIncentiveSlipPdf({
      employeeName: rec.employeeName || employeeProfile.fullName,
      employeeId: rec.employeeId,
      branchName: rec.branchName || employeeProfile.branchName,
      designation: employeeProfile.designation,
      periodTitle: `${typeLabel} (${dateRange})`,
      periodBadge: norm.importType,
      slab1SaleAmtPaise: rec.saleAmt1Paise || 0,
      slab1SaleQty: rec.saleQty1 || 0,
      slab1IncentivePaise: rec.component1Paise,
      slab2SaleAmtPaise: rec.saleAmt2Paise || 0,
      slab2SaleQty: rec.saleQty2 || 0,
      slab2IncentivePaise: rec.component2Paise,
      slab3SaleAmtPaise: rec.saleAmt3Paise || 0,
      slab3SaleQty: rec.saleQty3 || 0,
      slab3IncentivePaise: rec.component3Paise,
      totalSaleAmtPaise:
        rec.totalSaleAmtPaise ??
        (rec.saleAmt1Paise || 0) + (rec.saleAmt2Paise || 0) + (rec.saleAmt3Paise || 0),
      totalSaleQty:
        rec.totalSaleQty ??
        Math.round(((rec.saleQty1 || 0) + (rec.saleQty2 || 0) + (rec.saleQty3 || 0)) * 100) / 100,
      grossIncentivePaise: rec.totalPaise,
      adjustments: isMonthlyRec ? selectedMonthAdjustments : [],
      payout: isMonthlyRec ? selectedMonthPayout : null,
      fileName: `house-of-muktai-${norm.importType.toLowerCase()}-${rec.employeeId}-${norm.periodStart}.pdf`,
    });
  };

  const handleQuerySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeProfile) return;
    setQuerySubmitting(true);
    setQueryFeedback(null);
    try {
      await submitEmployeeQuery({
        monthKey: queryMonth,
        employeeId: employeeProfile.employeeId,
        employeeName: employeeProfile.fullName,
        branchId: employeeProfile.branchId,
        branchName: employeeProfile.branchName,
        category: queryCategory,
        subject: querySubject,
        message: queryMessage,
      });
      setQuerySubject('');
      setQueryMessage('');
      setQueryFeedback({
        type: 'ok',
        text: isMr
          ? 'तुमची शंका यशस्वीरित्या Super Admin कडे पाठवली गेली आहे.'
          : 'Your query has been submitted to Super Admin.',
      });
    } catch (err) {
      setQueryFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to submit query.',
      });
    } finally {
      setQuerySubmitting(false);
    }
  };

  // H3 Fix: Proper try/catch error feedback for profile save
  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeProfile) return;
    setProfileSaving(true);
    setProfileMessage(null);
    try {
      await updateOwnEmployeeProfile(employeeProfile.employeeId, {
        phone,
        address,
        emergencyContact,
      });
      await refreshEmployeeProfile();
      setProfileMessage({
        type: 'ok',
        text: isMr
          ? 'तुमची माहिती यशस्वीरित्या सेव्ह झाली.'
          : 'Profile details updated successfully.',
      });
    } catch (err) {
      setProfileMessage({
        type: 'err',
        text: err instanceof Error && err.message ? err.message : t.profileSaveError,
      });
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setPwdMessage({
        type: 'err',
        text: isMr
          ? 'नवीन पासवर्ड किमान ८ अक्षरांचा असणे आवश्यक आहे.'
          : 'New password must be at least 8 characters long.',
      });
      return;
    }
    if (newPassword.trim() === DEFAULT_EMPLOYEE_PASSWORD) {
      setPwdMessage({
        type: 'err',
        text: isMr
          ? `कृपया कंपनीचा डिफॉल्ट पासवर्ड (${DEFAULT_EMPLOYEE_PASSWORD}) सोडून तुमच्या पसंतीचा वेगळा पासवर्ड निवडा.`
          : `Please choose a personal password different from the default password (${DEFAULT_EMPLOYEE_PASSWORD}).`,
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdMessage({
        type: 'err',
        text: isMr
          ? 'दोन्ही पासवर्ड एकसारखे नाहीत. कृपया पुन्हा तपासा.'
          : 'Passwords do not match. Please re-enter carefully.',
      });
      return;
    }
    setPwdSaving(true);
    setPwdMessage(null);
    const wasFirstLogin = Boolean(employeeProfile?.mustChangePassword);
    try {
      await changeOwnPassword(newPassword, wasFirstLogin ? DEFAULT_EMPLOYEE_PASSWORD : undefined);
      if (wasFirstLogin && employeeProfile) {
        await updateOwnEmployeeProfile(employeeProfile.employeeId, {
          phone: employeeProfile.phone || '',
          address: employeeProfile.address || '',
          emergencyContact: employeeProfile.emergencyContact || '',
          mustChangePassword: false,
        });
        await refreshEmployeeProfile();
        setJustUnlockedPortal(true);
      }
      setNewPassword('');
      setConfirmPassword('');
      setPwdMessage({
        type: 'ok',
        text: isMr
          ? 'पासवर्ड यशस्वीरित्या बदलला आहे! आता तुम्ही तुमचे सर्व इन्सेंटिव्ह रेकॉर्ड्स पाहू शकता.'
          : 'Password updated successfully! Your incentive portal is now unlocked.',
      });
    } catch (err) {
      setPwdMessage({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'Please sign out and sign in again before changing your password.',
      });
    } finally {
      setPwdSaving(false);
    }
  };

  // H3 Fix: Proper try/catch error handling for marking notifications read
  const handleMarkRead = async (notificationId: string) => {
    setActionError(null);
    try {
      await markNotificationRead(notificationId);
    } catch {
      setActionError(
        isMr
          ? 'सूचना अपडेट करता आली नाही. कृपया पुन्हा प्रयत्न करा.'
          : 'Unable to update notification right now. Please try again.',
      );
    }
  };

  // Strict Deactivated Employee Block
  if (!employeeLoginGate.allowed) {
    const isDeactivated = employeeLoginGate.code === 'ACCOUNT_DEACTIVATED';
    return (
      <div className="min-h-screen bg-[#F5F7FA] flex items-center justify-center p-5">
        <div className="max-w-md w-full bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs">
          <div className="h-1 w-full bg-red-600" />
          <div className="p-7 text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-red-50 text-red-700 flex items-center justify-center mx-auto">
              <ShieldOff className="w-6 h-6" />
            </div>
            <h1 className="text-lg font-semibold text-[#0F1F3D]">
              {isDeactivated
                ? 'Employee Account Deactivated'
                : 'Account Not Linked to Employee Master'}
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">{employeeLoginGate.message}</p>
            {isDeactivated && employeeProfile && (
              <p className="text-xs font-mono text-slate-500">
                Salesman No: {employeeProfile.employeeId} · Status: INACTIVE
              </p>
            )}
            <button
              type="button"
              onClick={logout}
              className="h-11 px-5 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-sm font-semibold cursor-pointer transition-colors"
            >
              {t.signOut}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Strict Mandatory First-Login Password Setup Gate
  if (requiresFirstLoginPasswordChange && employeeProfile) {
    return (
      <div className="min-h-[100dvh] w-full overflow-x-hidden bg-[#F5F7FA] flex flex-col">
        <div className="h-1 w-full bg-gradient-to-r from-[#0F1F3D] via-[#1E3A5F] to-[#B8923A]" />
        <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200/90">
          <div className="max-w-md mx-auto px-3.5 h-full flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <BrandLogo size="xs" />
              <p className="text-sm font-bold text-[#0F1F3D] truncate leading-tight">
                {COMPANY_BRAND.brandName}
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 shrink-0">
              <div role="group" aria-label="Language switch" className="inline-flex text-[11px]">
                <button
                  type="button"
                  onClick={() => toggleLang('en')}
                  className={`h-7 px-2 rounded-lg font-semibold cursor-pointer ${
                    lang === 'en' ? 'bg-[#0F1F3D] text-white shadow-xs' : 'text-slate-600'
                  }`}
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => toggleLang('mr')}
                  className={`h-7 px-2 rounded-lg font-semibold cursor-pointer ${
                    lang === 'mr' ? 'bg-[#0F1F3D] text-white shadow-xs' : 'text-slate-600'
                  }`}
                >
                  मराठी
                </button>
              </div>
              <button
                type="button"
                onClick={logout}
                aria-label={t.signOut}
                className="h-7 w-8 rounded-lg bg-white border border-slate-200/80 text-slate-600 hover:text-[#0F1F3D] inline-flex items-center justify-center cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-3.5 sm:p-6">
          <div className="w-full max-w-md bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs">
            <div className="bg-[#0F1F3D] text-white px-5 py-4 relative">
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#B8923A] via-[#DFC27D] to-[#B8923A]" />
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/10 border border-[#B8923A]/40 text-[#DFC27D] flex items-center justify-center shrink-0">
                  <Lock className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-base font-semibold text-white">
                    {isMr ? 'नवीन पासवर्ड सेट करा' : 'Set Personal Password'}
                  </h1>
                  <p className="text-[11px] text-slate-300 truncate">
                    {employeeProfile.fullName} · #{employeeProfile.employeeId}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-600 leading-snug">
                {isMr
                  ? 'प्रथम लॉगिनसाठी किमान ८ अक्षरांचा तुमचा वैयक्तिक पासवर्ड सेट करा.'
                  : 'Create your private password (min 8 characters) to continue.'}
              </p>

              {pwdMessage && (
                <div
                  role="alert"
                  className={`p-3 rounded-xl border text-xs leading-relaxed ${
                    pwdMessage.type === 'ok'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-red-50 border-red-200 text-red-800'
                  }`}
                >
                  {pwdMessage.text}
                </div>
              )}

              <form onSubmit={handlePasswordChange} className="space-y-4">
                <div>
                  <label
                    htmlFor="first-new-password"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    {isMr
                      ? 'नवीन पासवर्ड (किमान ८ अक्षरे)'
                      : 'New Personal Password (min 8 characters)'}
                  </label>
                  <div className="relative">
                    <input
                      id="first-new-password"
                      type={showNewPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder={isMr ? 'तुमच्या पसंतीचा नवीन पासवर्ड टाका' : 'Enter your new password'}
                      className="w-full h-12 pl-3.5 pr-12 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-1 top-1 h-10 w-10 inline-flex items-center justify-center text-slate-500 hover:text-[#0F1F3D] rounded-lg cursor-pointer"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="first-confirm-password"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    {isMr ? 'नवीन पासवर्ड पुन्हा टाका' : 'Confirm New Password'}
                  </label>
                  <div className="relative">
                    <input
                      id="first-confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder={isMr ? 'नवीन पासवर्ड पुन्हा टाका' : 'Re-enter your new password'}
                      className="w-full h-12 pl-3.5 pr-12 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-1 top-1 h-10 w-10 inline-flex items-center justify-center text-slate-500 hover:text-[#0F1F3D] rounded-lg cursor-pointer"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={pwdSaving}
                  className="w-full h-12 px-4 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] active:scale-[0.99] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4 text-[#DFC27D]" />
                  <span>
                    {pwdSaving
                      ? isMr
                        ? 'पासवर्ड सेव्ह होत आहे...'
                        : 'Saving Password...'
                      : isMr
                        ? 'पासवर्ड सेव्ह करा आणि इन्सेंटिव्ह पहा'
                        : 'Save Password & View My Incentives'}
                  </span>
                </button>
              </form>
            </div>
          </div>
        </main>

        <div className="max-w-lg w-full mx-auto px-4 pb-6">
          <CompanyFooter />
        </div>
      </div>
    );
  }

  const grossIncentivePaise = selectedMonthAgg?.grandTotalPaise || 0;
  const netPayablePaise = grossIncentivePaise + selectedMonthAdjNetPaise;
  const previousMonthPaise = previousMonthAgg?.grandTotalPaise || 0;
  const achievedSalePaise = selectedMonthAgg?.totalSaleAmtPaise || 0;
  const achievedSaleQty = selectedMonthAgg?.totalSaleQty || 0;

  const targetAchievedSalePaise = targetMonthAgg?.totalSaleAmtPaise || 0;
  const targetAchievedSaleQty = targetMonthAgg?.totalSaleQty || 0;
  const targetBaselineSalePaise = targetBaselineAgg?.totalSaleAmtPaise || 0;

  const targetProgress = computeTargetProgress({
    achievedSalePaise: targetAchievedSalePaise,
    targetSaleAmtPaise: selectedMonthTarget?.targetSaleAmtPaise || 0,
    achievedQty: targetAchievedSaleQty,
    targetSaleQty: selectedMonthTarget?.targetSaleQty || 0,
  });

  const targetGrowthPct =
    selectedMonthTarget && selectedMonthTarget.scope === 'EMPLOYEE'
      ? computeGrowthPctOverBaseline(
          selectedMonthTarget.targetSaleAmtPaise,
          targetBaselineSalePaise,
        )
      : null;

  const targetStatusBadgeLabel =
    targetProgress.status === 'ACHIEVED'
      ? t.targetCompleted
      : targetProgress.status === 'ON_TRACK'
        ? t.targetOnTrack
        : targetProgress.status === 'IN_PROGRESS'
          ? t.targetInProgress
          : t.targetNotStarted;

  const payoutStatusLabel =
    selectedMonthPayout?.status === 'PAID'
      ? t.payoutPaid
      : selectedMonthPayout?.status === 'APPROVED'
        ? t.payoutApproved
        : t.payoutUnpaid;

  const heroSlabs = [
    {
      label: t.slab1,
      inc: selectedMonthAgg?.component1TotalPaise || 0,
      sale: selectedMonthAgg?.saleAmt1TotalPaise || 0,
      qty: selectedMonthAgg?.saleQty1Total || 0,
    },
    {
      label: t.slab2,
      inc: selectedMonthAgg?.component2TotalPaise || 0,
      sale: selectedMonthAgg?.saleAmt2TotalPaise || 0,
      qty: selectedMonthAgg?.saleQty2Total || 0,
    },
    {
      label: t.slab3,
      inc: selectedMonthAgg?.component3TotalPaise || 0,
      sale: selectedMonthAgg?.saleAmt3TotalPaise || 0,
      qty: selectedMonthAgg?.saleQty3Total || 0,
    },
  ];

  const desktopTabs: Array<[StaffTab, string]> = [
    ['home', t.tabOverview],
    ['statements', t.tabStatements],
    ['reports', t.tabHistory],
    ['profile', t.tabProfile],
    ['settings', t.tabSettings],
  ];

  const mobileNavTabs: Array<
    [StaffTab, string, React.ComponentType<{ className?: string }>, boolean]
  > = [
    ['home', t.tabOverview, Home, unreadCount > 0],
    ['statements', t.tabStatements, Calendar, false],
    ['reports', t.tabHistory, BarChart3, false],
    ['profile', t.tabProfile, User, openQueriesCount > 0],
    ['settings', t.tabSettings, Settings, false],
  ];

  return (
    <div className="min-h-[100dvh] w-full overflow-x-hidden bg-[#F5F7FA] pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-10">
      <div className="h-1 w-full bg-gradient-to-r from-[#0F1F3D] via-[#1E3A5F] to-[#B8923A]" />

      {/* Compact Sticky Mobile App Bar (56px) */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200/90">
        <div className="max-w-5xl mx-auto px-3.5 sm:px-6 h-full flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BrandLogo size="xs" />
            <span className="text-sm font-bold tracking-tight text-[#0F1F3D] truncate">
              {t.brand}
            </span>
          </div>

          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium">
            {desktopTabs.map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`py-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === tab
                    ? 'text-[#0F1F3D] border-b-2 border-[#B8923A] font-semibold'
                    : 'text-slate-600 hover:text-[#0F1F3D]'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Compact Header Action Tray */}
          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 shrink-0">
            <div role="group" aria-label="Language switch" className="inline-flex text-[11px]">
              <button
                type="button"
                onClick={() => toggleLang('en')}
                className={`h-7 px-2 rounded-lg font-semibold cursor-pointer transition-colors ${
                  lang === 'en' ? 'bg-[#0F1F3D] text-white shadow-xs' : 'text-slate-600'
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => toggleLang('mr')}
                className={`h-7 px-2 rounded-lg font-semibold cursor-pointer transition-colors ${
                  lang === 'mr' ? 'bg-[#0F1F3D] text-white shadow-xs' : 'text-slate-600'
                }`}
              >
                मराठी
              </button>
            </div>

            <button
              type="button"
              onClick={logout}
              aria-label={t.signOut}
              className="h-7 px-2 rounded-lg bg-white border border-slate-200/80 text-xs font-medium text-slate-600 hover:text-[#0F1F3D] inline-flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.signOut}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-3.5 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-5">
        {justUnlockedPortal && (
          <div className="p-3.5 sm:p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3 text-xs sm:text-sm text-emerald-900">
            <div className="flex items-center gap-2.5 min-w-0">
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
              <span className="leading-snug">
                {isMr
                  ? 'तुमचा वैयक्तिक पासवर्ड यशस्वीरित्या सेव्ह झाला आहे. आता तुम्ही तुमचे सर्व इन्सेंटिव्ह रेकॉर्ड्स पाहू शकता.'
                  : 'Your personal password has been saved. Welcome to your House of Muktai Incentive App!'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setJustUnlockedPortal(false)}
              className="min-h-[36px] px-2.5 rounded-lg text-xs font-semibold text-emerald-800 hover:bg-emerald-100 shrink-0 cursor-pointer"
            >
              OK
            </button>
          </div>
        )}

        {actionError && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between gap-3 text-xs text-red-800"
          >
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="px-2 py-1 rounded text-red-900 font-semibold hover:bg-red-100 cursor-pointer"
            >
              OK
            </button>
          </div>
        )}

        {/* Executive Employee Identity Card */}
        <section className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-[#0F1F3D] border border-[#B8923A]/40 text-[#DFC27D] font-bold text-sm flex items-center justify-center overflow-hidden shrink-0 shadow-2xs">
              {employeeProfile?.photoDataUrl ? (
                <img
                  src={employeeProfile.photoDataUrl}
                  alt={employeeProfile.fullName}
                  className="w-full h-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-[#0F1F3D] truncate leading-tight">
                {employeeProfile!.fullName}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                <span className="font-mono font-semibold text-[#0F1F3D]">
                  #{employeeProfile!.employeeId}
                </span>{' '}
                · {employeeProfile!.branchName}
                {employeeProfile?.departmentName ? (
                  <span className="font-semibold text-[#9A7625]">
                    {' '}
                    · {employeeProfile.departmentName}
                  </span>
                ) : null}
                <span className="hidden sm:inline"> · {employeeProfile!.designation}</span>
              </p>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('home');
                    document.getElementById('staff-alerts-section')?.scrollIntoView({
                      behavior: 'smooth',
                    });
                  }}
                  className="text-[11px] font-semibold text-[#9A7625] inline-flex items-center gap-1 mt-1 cursor-pointer hover:underline"
                >
                  <Bell className="w-3 h-3" />
                  <span>
                    {unreadCount} {unreadCount > 1 ? t.newAlertPlural : t.newAlertSingle}
                  </span>
                </button>
              )}
            </div>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveTab('profile');
                setProfileSubView('queries');
              }}
              className="hidden sm:inline-flex h-8 px-3 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-[#0F1F3D] items-center gap-1.5 cursor-pointer transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5 text-[#B8923A]" />
              <span>{t.tabQueries}</span>
              {openQueriesCount > 0 && (
                <span className="font-mono text-[11px] text-[#9A7625]">({openQueriesCount})</span>
              )}
            </button>
            <PWAInstallButton label={t.installApp} />
          </div>
        </section>

        {loading ? (
          <WorkspaceSkeleton />
        ) : (
          <AnimatePresence mode="wait">
            {/* =============================================================== */}
            {/* HOME TAB                                                        */}
            {/* =============================================================== */}
            {activeTab === 'home' && (
              <PageTransition key="tab-home" className="space-y-4 sm:space-y-5">
                {visibilitySettings.mode === 'SELECTED' && (
                  <div className="px-3.5 py-2.5 rounded-xl bg-[#0F1F3D]/[0.05] border border-[#0F1F3D]/15 text-xs text-[#0F1F3D] flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {visibilitySettings.visibleMonths.length === 0
                        ? isMr
                          ? 'सध्या Admin कडून कोणताही महिना प्रदर्शनासाठी खुला केलेला नाही.'
                          : 'No incentive period is currently open for staff viewing.'
                        : isMr
                          ? `Admin ने निवडलेला कालावधी: ${visibilitySettings.visibleMonths
                              .map((m) => formatMonthLabel(m))
                              .join(', ')}`
                          : `Visible period: ${visibilitySettings.visibleMonths
                              .map((m) => formatMonthLabel(m))
                              .join(', ')}`}
                    </span>
                  </div>
                )}

                {/* Executive Top Summary Strip: All-Time Published + Previous Month */}
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className="bg-white border border-slate-200/90 rounded-2xl p-3.5 sm:p-4 shadow-2xs">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-medium text-slate-500 truncate">
                        {t.allTimeIncentive}
                      </p>
                      <Award className="w-4 h-4 text-[#B8923A] shrink-0" />
                    </div>
                    <p className="text-lg sm:text-xl font-bold text-[#0F1F3D] mt-1.5">
                      <AnimatedCounter value={allTimePublishedPaise} mode="paise" />
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                      {safeMonthlyHistory.length} {t.activeMonthsLabel}
                    </p>
                  </div>

                  <div className="bg-white border border-slate-200/90 rounded-2xl p-3.5 sm:p-4 shadow-2xs">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-medium text-slate-500 truncate">
                        {prevMonth ? `${t.previousMonthLabel} · ${formatMonthLabel(prevMonth)}` : t.previousMonthLabel}
                      </p>
                      <Calendar className="w-4 h-4 text-[#1E3A5F] shrink-0" />
                    </div>
                    <p className="text-lg sm:text-xl font-bold text-[#0F1F3D] mt-1.5">
                      <AnimatedCounter value={previousMonthPaise} mode="paise" />
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('reports')}
                      className="text-[11px] font-semibold text-[#1E3A5F] hover:underline mt-0.5 cursor-pointer"
                    >
                      {isMr ? 'आलेख पहा →' : 'View Reports →'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
                  {/* Monthly Net Incentive Hero Card (Corporate Navy + Gold) */}
                  <section className="lg:col-span-7 bg-[#0F1F3D] text-white rounded-2xl p-5 sm:p-6 space-y-5 relative overflow-hidden shadow-xs">
                    <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#B8923A] via-[#DFC27D] to-[#B8923A]" />

                    {/* Row 1: Month Selector + MoM Delta */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {availableMonths.length > 1 ? (
                          <select
                            aria-label="Select incentive month"
                            value={selectedMonth}
                            onChange={(e) => setSelectedMonth(e.target.value)}
                            className="h-9 px-3 rounded-xl bg-white/10 border border-white/15 text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[#DFC27D]/50 cursor-pointer"
                          >
                            {availableMonths.map((m) => (
                              <option key={m} value={m} className="text-slate-900">
                                {formatMonthLabel(m)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs font-semibold text-[#DFC27D]">
                            {selectedMonth ? formatMonthLabel(selectedMonth) : t.noPublishedYet}
                          </span>
                        )}
                      </div>

                      {prevMonth && (
                        <div className="text-right shrink-0">
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-semibold font-mono tabular-nums ${
                              momDelta.diff >= 0 ? 'text-emerald-300' : 'text-red-300'
                            }`}
                          >
                            {momDelta.diff >= 0 ? (
                              <TrendingUp className="w-3.5 h-3.5" />
                            ) : (
                              <TrendingDown className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {momDelta.diff >= 0 ? '+' : ''}
                              {momDelta.pct}%
                            </span>
                          </span>
                          <p className="text-[10px] text-slate-300 leading-tight mt-0.5">
                            {t.vsMonth} {formatMonthLabel(prevMonth)}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Row 2: Main KPI Figure */}
                    <div>
                      <p className="text-xs text-[#DFC27D] font-medium">{t.monthlyIncentive}</p>
                      <p className="text-3xl sm:text-4xl font-bold tracking-tight text-white mt-1">
                        <AnimatedCounter value={netPayablePaise} mode="paise" />
                      </p>
                      {selectedMonthAdjNetPaise !== 0 && (
                        <p className="text-[11px] font-mono tabular-nums text-slate-200 mt-1.5">
                          {t.grossIncentive}: {formatINRFromPaise(grossIncentivePaise)} ·{' '}
                          {t.adjustments}: {selectedMonthAdjNetPaise > 0 ? '+' : ''}
                          {formatINRFromPaise(selectedMonthAdjNetPaise)}
                        </p>
                      )}
                      <p className="text-[11px] text-slate-300 mt-1">
                        {selectedMonthAgg?.sourceType === 'MONTHLY_RECORD'
                          ? t.sourceMonthly
                          : selectedMonthAgg?.sourceType === 'DAILY_AGGREGATE'
                            ? `${t.sourceDailyPrefix} ${selectedMonthAgg.publishedDaysCount} ${t.sourceDailySuffix}`
                            : t.sourceNoData}
                      </p>
                    </div>

                    {/* Row 3: Aligned 2-Column Sale & Qty Strip */}
                    <div className="grid grid-cols-2 gap-3 rounded-xl bg-white/[0.07] border border-white/10 p-3.5">
                      <div>
                        <p className="text-[11px] text-slate-300">{t.totalSale}</p>
                        <p className="text-sm sm:text-base font-bold font-mono tabular-nums text-white mt-0.5">
                          {formatINRFromPaise(achievedSalePaise)}
                        </p>
                      </div>
                      <div className="border-l border-white/10 pl-3.5">
                        <p className="text-[11px] text-slate-300">{t.totalQty}</p>
                        <p className="text-sm sm:text-base font-bold font-mono tabular-nums text-white mt-0.5">
                          {formatQty(achievedSaleQty)}
                        </p>
                      </div>
                    </div>

                    {/* Row 4: 3 Incentive Slabs */}
                    <div className="rounded-xl bg-white/[0.05] border border-white/10 divide-y divide-white/10 sm:divide-y-0 sm:grid sm:grid-cols-3 sm:divide-x">
                      {heroSlabs.map((slab) => (
                        <div
                          key={slab.label}
                          className="px-3.5 py-2.5 flex items-center justify-between gap-3 sm:block"
                        >
                          <div className="min-w-0">
                            <p className="text-xs text-slate-200 font-medium truncate">
                              {slab.label}
                            </p>
                            <p className="text-[11px] font-mono tabular-nums text-slate-300/80 mt-0.5">
                              {t.saleLabel}: {formatINRFromPaise(slab.sale)} · {t.qtyLabel}:{' '}
                              {formatQty(slab.qty)}
                            </p>
                          </div>
                          <p className="text-sm sm:text-base font-mono tabular-nums font-semibold text-[#DFC27D] shrink-0 sm:mt-1.5">
                            {formatINRFromPaise(slab.inc)}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Row 5: Primary Mobile-Friendly PDF CTA */}
                    {selectedMonthAgg && selectedMonthAgg.sourceType !== 'NO_DATA' && (
                      <button
                        type="button"
                        onClick={handleDownloadMonthlyPdf}
                        className="w-full sm:w-auto h-11 px-4 rounded-xl bg-[#B8923A] hover:bg-[#A6812F] active:scale-[0.985] text-[#0F1F3D] text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs"
                      >
                        <FileDown className="w-4 h-4" />
                        <span>{t.downloadPdfSlip}</span>
                      </button>
                    )}
                  </section>

                  {/* Right Column: Payout Status & Sales Target Cards */}
                  <div className="lg:col-span-5 space-y-4">
                    {/* Payout Status Card */}
                    <section className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-3 shadow-2xs">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Wallet className="w-4 h-4 text-[#B8923A] shrink-0" />
                          <h2 className="text-sm font-semibold text-[#0F1F3D] truncate">
                            {selectedMonth
                              ? `${t.payoutStatusTitle} · ${formatMonthLabel(selectedMonth)}`
                              : t.payoutStatusTitle}
                          </h2>
                        </div>
                        <span
                          className={`text-xs font-bold shrink-0 ${
                            selectedMonthPayout?.status === 'PAID'
                              ? 'text-emerald-700'
                              : selectedMonthPayout?.status === 'APPROVED'
                                ? 'text-[#1E3A5F]'
                                : 'text-amber-700'
                          }`}
                        >
                          {payoutStatusLabel}
                        </span>
                      </div>

                      <div className="text-xs text-slate-600 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span>{t.netPayable}</span>
                          <span className="font-mono tabular-nums font-bold text-sm text-[#0F1F3D]">
                            {formatINRFromPaise(netPayablePaise)}
                          </span>
                        </div>
                        {selectedMonthPayout?.status === 'PAID' ? (
                          <div className="text-[11px] font-mono text-slate-600 pt-2 border-t border-slate-100 space-y-0.5">
                            <p>
                              {t.payoutMode}: {selectedMonthPayout.paymentMode || '—'}
                              {selectedMonthPayout.paymentReference
                                ? ` · ${t.payoutRef}: ${selectedMonthPayout.paymentReference}`
                                : ''}
                            </p>
                            {selectedMonthPayout.paidAt && (
                              <p className="text-slate-500">
                                {t.payoutDate}:{' '}
                                {formatShortDate(selectedMonthPayout.paidAt.slice(0, 10))}
                              </p>
                            )}
                          </div>
                        ) : selectedMonthPayout?.status === 'APPROVED' ? (
                          <p className="text-[11px] text-[#1E3A5F] pt-2 border-t border-slate-100">
                            {isMr
                              ? 'अकाउंट्सकडून पेआउट मंजूर झाले आहे; लवकरच रक्कम जमा होईल.'
                              : 'Approved by accounts; payout disbursement is in progress.'}
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-500 pt-2 border-t border-slate-100">
                            {t.payoutNotSettled}
                          </p>
                        )}
                      </div>

                      {selectedMonthAdjustments.length > 0 && (
                        <div className="pt-2.5 border-t border-slate-100 space-y-1.5">
                          <p className="text-[11px] font-semibold text-slate-700">
                            {t.adjustmentsSectionTitle} {formatMonthLabel(selectedMonth)}
                          </p>
                          {selectedMonthAdjustments.map((adj) => {
                            const isBonus = adj.type === 'BONUS';
                            return (
                              <div
                                key={adj.adjustmentId}
                                className="flex items-start justify-between gap-3 text-xs"
                              >
                                <span className="text-slate-600 leading-snug">
                                  {adj.type.replace('_', ' ')} — {adj.reason}
                                </span>
                                <span
                                  className={`font-mono tabular-nums font-semibold shrink-0 ${
                                    isBonus ? 'text-emerald-700' : 'text-red-700'
                                  }`}
                                >
                                  {isBonus ? '+' : '-'}
                                  {formatINRFromPaise(adj.amountPaise)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>

                    {/* Monthly Sales Target Progress Card (Live Sync with Admin Branch Targets) */}
                    <section className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-2xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Target className="w-4 h-4 text-[#B8923A] shrink-0" />
                          <div className="min-w-0">
                            <h2 className="text-sm font-semibold text-[#0F1F3D] truncate">
                              {t.targetTitle}
                            </h2>
                            {selectedMonthTarget && (
                              <p className="text-[11px] text-slate-500">
                                {selectedMonthTarget.scope === 'EMPLOYEE'
                                  ? t.targetPersonalScope
                                  : t.targetBranchScope}{' '}
                                · {formatMonthLabel(selectedMonthTarget.monthKey)}
                              </p>
                            )}
                          </div>
                        </div>

                        {relevantTargetMonths.length > 1 ? (
                          <select
                            aria-label="Select target month"
                            value={activeTargetMonth}
                            onChange={(e) => setSelectedTargetMonth(e.target.value)}
                            className="h-7 px-2 rounded-lg border border-slate-200 bg-slate-50 text-[11px] font-semibold text-[#0F1F3D] cursor-pointer"
                          >
                            {relevantTargetMonths.map((mk) => (
                              <option key={mk} value={mk}>
                                {formatMonthLabel(mk)}
                              </option>
                            ))}
                          </select>
                        ) : selectedMonthTarget ? (
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0 ${
                              targetProgress.status === 'ACHIEVED'
                                ? 'bg-emerald-50 text-emerald-700'
                                : targetProgress.status === 'ON_TRACK'
                                  ? 'bg-[#0F1F3D]/[0.07] text-[#0F1F3D]'
                                  : 'bg-[#B8923A]/15 text-[#9A7625]'
                            }`}
                          >
                            {targetStatusBadgeLabel}
                          </span>
                        ) : null}
                      </div>

                      {selectedMonthTarget ? (
                        <div className="space-y-3">
                          {/* Last Month Baseline & Growth % Comparison Strip */}
                          {selectedMonthTarget.scope === 'EMPLOYEE' &&
                            targetBaselineSalePaise > 0 && (
                              <div className="rounded-xl bg-[#F8FAFC] border border-slate-200/80 px-3 py-2 flex items-center justify-between gap-2 text-[11px]">
                                <span className="text-slate-600">
                                  {t.targetLastMonth} ({formatMonthLabel(targetBaselineMonth)}):{' '}
                                  <strong className="font-mono text-slate-800">
                                    {formatINRFromPaise(targetBaselineSalePaise)}
                                  </strong>
                                </span>
                                {targetGrowthPct !== null && (
                                  <span className="font-mono font-bold text-[#9A7625] shrink-0">
                                    {targetGrowthPct >= 0 ? '+' : ''}
                                    {targetGrowthPct}%
                                  </span>
                                )}
                              </div>
                            )}

                          {/* Sale Progress Bar */}
                          {selectedMonthTarget.targetSaleAmtPaise > 0 && (
                            <div className="space-y-2">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-xs font-medium text-slate-600">
                                  {t.totalSale}
                                </span>
                                <span
                                  className={`text-sm font-mono tabular-nums font-bold ${
                                    targetProgress.salePct >= 100
                                      ? 'text-emerald-700'
                                      : 'text-[#0F1F3D]'
                                  }`}
                                >
                                  {targetProgress.salePct}% {t.targetAchieved}
                                </span>
                              </div>
                              <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    targetProgress.salePct >= 100
                                      ? 'bg-emerald-600'
                                      : 'bg-gradient-to-r from-[#0F1F3D] to-[#B8923A]'
                                  }`}
                                  style={{
                                    width: `${Math.min(100, Math.max(targetProgress.salePct > 0 ? 3 : 0, targetProgress.salePct))}%`,
                                  }}
                                />
                              </div>

                              {/* 3-Column Target / Achieved / Remaining Breakdown */}
                              <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                                <div className="rounded-lg bg-slate-50 border border-slate-200/70 px-2 py-2">
                                  <p className="text-[10px] text-slate-500 font-medium">
                                    {t.targetGoalLabel}
                                  </p>
                                  <p className="text-[11px] sm:text-xs font-mono tabular-nums font-bold text-[#0F1F3D] mt-0.5 truncate">
                                    {formatINRFromPaise(selectedMonthTarget.targetSaleAmtPaise)}
                                  </p>
                                </div>
                                <div className="rounded-lg bg-slate-50 border border-slate-200/70 px-2 py-2">
                                  <p className="text-[10px] text-slate-500 font-medium">
                                    {t.targetAchievedLabel}
                                  </p>
                                  <p className="text-[11px] sm:text-xs font-mono tabular-nums font-bold text-emerald-700 mt-0.5 truncate">
                                    {formatINRFromPaise(targetAchievedSalePaise)}
                                  </p>
                                </div>
                                <div className="rounded-lg bg-slate-50 border border-slate-200/70 px-2 py-2">
                                  <p className="text-[10px] text-slate-500 font-medium">
                                    {t.targetRemaining}
                                  </p>
                                  <p className="text-[11px] sm:text-xs font-mono tabular-nums font-bold text-[#9A7625] mt-0.5 truncate">
                                    {targetProgress.remainingSalePaise === 0
                                      ? '₹0.00'
                                      : formatINRFromPaise(targetProgress.remainingSalePaise)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Optional Sale Qty Progress Bar */}
                          {selectedMonthTarget.targetSaleQty > 0 && (
                            <div className="pt-2 border-t border-slate-100 space-y-1.5">
                              <div className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="text-slate-600 font-medium">
                                  {t.targetQtyProgress}
                                </span>
                                <span className="font-mono tabular-nums font-semibold text-[#0F1F3D]">
                                  {formatQty(targetAchievedSaleQty)} /{' '}
                                  {formatQty(selectedMonthTarget.targetSaleQty)} (
                                  {targetProgress.qtyPct}%)
                                </span>
                              </div>
                              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    targetProgress.qtyPct >= 100
                                      ? 'bg-emerald-600'
                                      : 'bg-[#1E3A5F]'
                                  }`}
                                  style={{
                                    width: `${Math.min(100, Math.max(targetProgress.qtyPct > 0 ? 3 : 0, targetProgress.qtyPct))}%`,
                                  }}
                                />
                              </div>
                            </div>
                          )}

                          {/* Companion Branch Target Note (when employee has personal target + branch target also exists) */}
                          {personalMonthTarget && branchMonthTarget && (
                            <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                              <span>
                                {t.targetBranchGoalNote} ({branchMonthTarget.branchName})
                              </span>
                              <span className="font-mono font-semibold text-slate-700">
                                {formatINRFromPaise(branchMonthTarget.targetSaleAmtPaise)}
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">{t.targetNoTarget}</p>
                      )}
                    </section>
                  </div>

                  {/* 5-Department Cross-Branch Top-3 Sales Leaderboard + Own Personal Rank */}
                  <DepartmentLeaderboardCard
                    monthKey={selectedMonth}
                    departmentId={employeeProfile?.departmentId}
                    departmentName={employeeProfile?.departmentName}
                    currentEmployeeId={employeeProfile!.employeeId}
                    leaderboard={deptLeaderboard}
                    personalRank={deptRank}
                    isMr={isMr}
                  />

                  {/* Monthly Salary Slip Quick Card (visible when Accounts publishes salary slip) */}
                  <SalarySlipHomeCard
                    slip={selectedMonthSalarySlip}
                    monthKey={selectedMonth}
                    isMr={isMr}
                    onViewAllSlips={() => {
                      setStatementsSubView('salary');
                      setActiveTab('statements');
                    }}
                  />

                  {/* Latest Published Statement Card */}
                  <section className="lg:col-span-12 bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-2xs">
                    <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-[#0F1F3D]">{t.latestStatement}</h2>
                      <button
                        type="button"
                        onClick={() => setActiveTab('statements')}
                        className="min-h-[36px] px-2.5 rounded-lg text-xs font-semibold text-[#1E3A5F] hover:bg-slate-100 cursor-pointer transition-colors"
                      >
                        {t.viewAll}
                      </button>
                    </div>

                    {latestRecord ? (
                      <StatementRecordCard
                        rec={latestRecord}
                        t={t}
                        onDownloadPdf={handleDownloadRecordPdf}
                      />
                    ) : (
                      <p className="text-sm text-slate-500 px-5 py-8 text-center">
                        {t.noPublishedYet}
                      </p>
                    )}
                  </section>

                  {/* Custom Period Statements */}
                  {partitioned.customPeriodRecords.length > 0 && (
                    <section className="lg:col-span-12 bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-2xs">
                      <div className="px-4 sm:px-5 py-3 border-b border-slate-100">
                        <h2 className="text-sm font-semibold text-[#0F1F3D]">
                          {t.customStatementsTitle}
                        </h2>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {partitioned.customPeriodRecords.slice(0, 4).map((rec) => (
                          <StatementRecordCard
                            key={rec.recordId}
                            rec={rec}
                            t={t}
                            onDownloadPdf={handleDownloadRecordPdf}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Publish Notifications */}
                  {notifications.length > 0 && (
                    <section
                      id="staff-alerts-section"
                      className="lg:col-span-12 bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-2xs"
                    >
                      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100">
                        <h2 className="text-sm font-semibold text-[#0F1F3D]">{t.recentAlerts}</h2>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {notifications.slice(0, 6).map((n) => (
                          <div
                            key={n.notificationId}
                            className="p-4 sm:px-5 flex items-start justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900 leading-snug">
                                {n.title}
                              </p>
                              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                                {n.message}
                              </p>
                            </div>
                            {!n.read ? (
                              <button
                                type="button"
                                onClick={() => handleMarkRead(n.notificationId)}
                                className="min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-medium text-[#0F1F3D] hover:bg-slate-50 inline-flex items-center gap-1 shrink-0 cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5 text-[#B8923A]" />
                                <span>{t.markRead}</span>
                              </button>
                            ) : (
                              <span className="text-[11px] font-medium text-slate-400 shrink-0 pt-1">
                                {t.readLabel}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              </PageTransition>
            )}

            {/* =============================================================== */}
            {/* MY INCENTIVES / STATEMENTS TAB                                  */}
            {/* =============================================================== */}
            {activeTab === 'statements' && (
              <PageTransition key="tab-statements" className="space-y-4 sm:space-y-5">
                {/* Clean Segmented Toggle: Incentive Statements vs Monthly Salary Slips */}
                <div className="inline-flex p-1 rounded-xl bg-white border border-slate-200/90 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setStatementsSubView('incentives')}
                    className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      statementsSubView === 'incentives'
                        ? 'bg-[#0F1F3D] text-white'
                        : 'text-slate-600 hover:text-[#0F1F3D]'
                    }`}
                  >
                    {isMr ? 'इन्सेंटिव्ह स्लिप' : 'Incentive Statements'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatementsSubView('salary')}
                    className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                      statementsSubView === 'salary'
                        ? 'bg-[#0F1F3D] text-white'
                        : 'text-slate-600 hover:text-[#0F1F3D]'
                    }`}
                  >
                    <span>{isMr ? 'पगार स्लिप (Salary)' : 'Salary Slips'}</span>
                    {salarySlips.length > 0 && (
                      <span
                        className={`font-mono text-[11px] ${
                          statementsSubView === 'salary' ? 'text-[#DFC27D]' : 'text-[#9A7625]'
                        }`}
                      >
                        ({salarySlips.length})
                      </span>
                    )}
                  </button>
                </div>

                {statementsSubView === 'salary' ? (
                  <SalarySlipFullList slips={salarySlips} isMr={isMr} />
                ) : (
                  <>
                    <section className="bg-white border border-slate-200/90 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                      <div>
                        <h2 className="text-sm sm:text-base font-semibold text-[#0F1F3D]">
                          {t.statementsHeader}
                        </h2>
                        <p className="text-[11px] text-slate-500 mt-0.5">{t.statementsSub}</p>
                      </div>
                      <div className="grid grid-cols-2 sm:inline-flex items-center gap-1.5 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 shrink-0">
                        <select
                          aria-label="Select statement month"
                          value={selectedMonth}
                          disabled={availableMonths.length === 0}
                          onChange={(e) => setSelectedMonth(e.target.value)}
                          className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800 disabled:opacity-60"
                        >
                          {availableMonths.length === 0 ? (
                            <option value="">{isMr ? 'डेटा नाही' : 'No Months'}</option>
                          ) : (
                            availableMonths.map((m) => (
                              <option key={m} value={m}>
                                {formatMonthLabel(m)}
                              </option>
                            ))
                          )}
                        </select>
                        <button
                          type="button"
                          disabled={!selectedMonthAgg || selectedMonthAgg.sourceType === 'NO_DATA'}
                          onClick={handleDownloadMonthlyPdf}
                          className="h-9 px-3 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-40 transition-colors"
                        >
                          <FileDown className="w-3.5 h-3.5 text-[#DFC27D]" />
                          <span>{isMr ? 'PDF स्लिप' : 'PDF Slip'}</span>
                        </button>
                      </div>
                    </section>

                    {/* Monthly Incentive Statements */}
                    {monthMonthlyRecords.length > 0 && (
                      <section className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-2xs">
                        <div className="px-4 sm:px-5 py-3 border-b border-slate-200/80 bg-[#F8FAFC]">
                          <h3 className="text-sm font-semibold text-[#0F1F3D]">
                            {t.monthlySectionTitle}
                          </h3>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {monthMonthlyRecords.map((rec) => (
                            <StatementRecordCard
                              key={rec.recordId}
                              rec={rec}
                              t={t}
                              onDownloadPdf={handleDownloadRecordPdf}
                            />
                          ))}
                        </div>
                      </section>
                    )}

                    {/* Custom Period Incentive Statements */}
                    {monthCustomRecords.length > 0 && (
                      <section className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-2xs">
                        <div className="px-4 sm:px-5 py-3 border-b border-slate-200/80 bg-[#F8FAFC]">
                          <h3 className="text-sm font-semibold text-[#0F1F3D]">
                            {t.customSectionTitle}
                          </h3>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {monthCustomRecords.map((rec) => (
                            <StatementRecordCard
                              key={rec.recordId}
                              rec={rec}
                              t={t}
                              onDownloadPdf={handleDownloadRecordPdf}
                            />
                          ))}
                        </div>
                      </section>
                    )}

                    {/* Daily Incentive Breakdown */}
                    <section className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-2xs">
                      <div className="px-4 sm:px-5 py-3 border-b border-slate-200/80 bg-[#F8FAFC]">
                        <h3 className="text-sm font-semibold text-[#0F1F3D]">
                          {selectedMonth
                            ? `${t.dailySectionTitle} · ${formatMonthLabel(selectedMonth)}`
                            : t.dailySectionTitle}
                        </h3>
                      </div>

                      {monthDailyRecords.length === 0 ? (
                        <div className="p-7 text-center text-sm text-slate-500">
                          {selectedMonth
                            ? `${t.noDailyRecords} ${formatMonthLabel(selectedMonth)}.`
                            : t.noPublishedYet}
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {monthDailyRecords.map((rec) => (
                            <StatementRecordCard
                              key={rec.recordId}
                              rec={rec}
                              t={t}
                              onDownloadPdf={handleDownloadRecordPdf}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  </>
                )}
              </PageTransition>
            )}

            {/* =============================================================== */}
            {/* REPORTS TAB (RECHARTS CHART + YEARLY SUMMARY + MOM HISTORY)     */}
            {/* =============================================================== */}
            {activeTab === 'reports' && (
              <PageTransition key="tab-reports">
                <Suspense fallback={<WorkspaceSkeleton />}>
                  <EmployeeReportsTab
                    monthlyHistory={safeMonthlyHistory}
                    t={t}
                    isMr={isMr}
                  />
                </Suspense>
              </PageTransition>
            )}

            {/* =============================================================== */}
            {/* PROFILE & QUERIES TAB                                           */}
            {/* =============================================================== */}
            {activeTab === 'profile' && (
              <PageTransition key="tab-profile" className="space-y-4">
                {/* Clean segmented switcher between Profile Details & Queries */}
                <div className="inline-flex p-1 rounded-xl bg-white border border-slate-200/90 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setProfileSubView('details')}
                    className={`h-9 px-4 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      profileSubView === 'details'
                        ? 'bg-[#0F1F3D] text-white'
                        : 'text-slate-600 hover:text-[#0F1F3D]'
                    }`}
                  >
                    {t.profileTitle}
                  </button>
                  <button
                    type="button"
                    onClick={() => setProfileSubView('queries')}
                    className={`h-9 px-4 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                      profileSubView === 'queries'
                        ? 'bg-[#0F1F3D] text-white'
                        : 'text-slate-600 hover:text-[#0F1F3D]'
                    }`}
                  >
                    <span>{t.queriesTitle}</span>
                    {openQueriesCount > 0 && (
                      <span
                        className={`font-mono text-[11px] ${
                          profileSubView === 'queries' ? 'text-[#DFC27D]' : 'text-[#9A7625]'
                        }`}
                      >
                        ({openQueriesCount})
                      </span>
                    )}
                  </button>
                </div>

                {profileSubView === 'details' ? (
                  <form
                    onSubmit={handleProfileSave}
                    className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-6 space-y-4 shadow-2xs max-w-2xl"
                  >
                    <div>
                      <h2 className="text-base font-semibold text-[#0F1F3D]">{t.profileTitle}</h2>
                      <p className="text-xs text-slate-500 mt-0.5">{t.profileSub}</p>
                    </div>

                    {profileMessage && (
                      <div
                        role="alert"
                        className={`p-3 rounded-xl border text-xs leading-relaxed ${
                          profileMessage.type === 'ok'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : 'bg-red-50 border-red-200 text-red-800'
                        }`}
                      >
                        {profileMessage.text}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3 text-xs bg-[#F8FAFC] p-4 rounded-xl border border-slate-200/70">
                      <div>
                        <span className="text-slate-500">{t.salesmanNo}</span>
                        <p className="font-mono font-semibold text-[#0F1F3D] mt-0.5">
                          {employeeProfile!.employeeId}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">{t.loginId}</span>
                        <p className="font-mono font-semibold text-[#0F1F3D] mt-0.5">
                          {employeeProfile!.loginId}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">{isMr ? 'शाखा' : 'Branch'}</span>
                        <p className="font-semibold text-[#0F1F3D] mt-0.5 truncate">
                          {employeeProfile!.branchName}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">{isMr ? 'पद' : 'Designation'}</span>
                        <p className="font-semibold text-[#0F1F3D] mt-0.5 truncate">
                          {employeeProfile!.designation}
                        </p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        {t.phone}
                      </label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full h-11 px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        {t.address}
                      </label>
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        className="w-full h-11 px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        {t.emergencyContact}
                      </label>
                      <input
                        type="text"
                        value={emergencyContact}
                        onChange={(e) => setEmergencyContact(e.target.value)}
                        className="w-full h-11 px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={profileSaving}
                      className="w-full h-12 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] active:scale-[0.99] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer transition-all"
                    >
                      {profileSaving ? t.saving : t.saveProfile}
                    </button>
                  </form>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
                    <form
                      onSubmit={handleQuerySubmit}
                      className="lg:col-span-5 bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-6 space-y-4 shadow-2xs"
                    >
                      <div>
                        <h2 className="text-base font-semibold text-[#0F1F3D]">{t.queriesTitle}</h2>
                        <p className="text-xs text-slate-500 mt-0.5">{t.queriesSub}</p>
                      </div>

                      {queryFeedback && (
                        <div
                          role="alert"
                          className={`p-3 rounded-xl border text-xs ${
                            queryFeedback.type === 'ok'
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                              : 'bg-red-50 border-red-200 text-red-800'
                          }`}
                        >
                          {queryFeedback.text}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                            {t.queryMonth}
                          </label>
                          <select
                            value={queryMonth}
                            onChange={(e) => setQueryMonth(e.target.value)}
                            className="w-full h-11 px-2.5 rounded-xl border border-slate-300 bg-white text-xs font-medium text-slate-800"
                          >
                            {(availableMonths.length > 0
                              ? availableMonths
                              : [getCurrentMonthKeyIST()]
                            ).map((m) => (
                              <option key={m} value={m}>
                                {formatMonthLabel(m)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                            {t.queryCategory}
                          </label>
                          <select
                            value={queryCategory}
                            onChange={(e) => setQueryCategory(e.target.value as QueryCategory)}
                            className="w-full h-11 px-2.5 rounded-xl border border-slate-300 bg-white text-xs font-medium text-slate-800"
                          >
                            <option value="SALE_AMOUNT">{t.catSaleAmt}</option>
                            <option value="SALE_QTY">{t.catSaleQty}</option>
                            <option value="INCENTIVE_MISMATCH">{t.catIncentive}</option>
                            <option value="PAYOUT_STATUS">{t.catPayout}</option>
                            <option value="OTHER">{t.catOther}</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          {t.querySubject}
                        </label>
                        <input
                          type="text"
                          required
                          minLength={3}
                          maxLength={120}
                          value={querySubject}
                          onChange={(e) => setQuerySubject(e.target.value)}
                          placeholder={
                            isMr
                              ? 'उदा. ऑक्टोबर न्यू आयटम विक्री तफावत'
                              : 'e.g. October New Items Sale Qty mismatch'
                          }
                          className="w-full h-11 px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          {t.queryMessage}
                        </label>
                        <textarea
                          required
                          minLength={5}
                          maxLength={600}
                          rows={4}
                          value={queryMessage}
                          onChange={(e) => setQueryMessage(e.target.value)}
                          className="w-full p-3.5 rounded-xl border border-slate-300 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={querySubmitting}
                        className="w-full h-12 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer transition-colors"
                      >
                        {querySubmitting ? t.submitting : t.raiseQueryBtn}
                      </button>
                    </form>

                    <section className="lg:col-span-7 bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-6 space-y-4 shadow-2xs">
                      <h2 className="text-base font-semibold text-[#0F1F3D]">
                        {t.myQueries} ({queries.length})
                      </h2>
                      {queries.length === 0 ? (
                        <p className="text-sm text-slate-500 py-8 text-center">{t.noQueriesYet}</p>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {queries.map((q) => (
                            <div key={q.queryId} className="py-4 first:pt-0 last:pb-0 space-y-2">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-[#0F1F3D] leading-snug">
                                    {q.subject}
                                  </p>
                                  <p className="text-[11px] text-slate-500 mt-0.5">
                                    {formatMonthLabel(q.monthKey)} · {q.category.replace('_', ' ')}
                                  </p>
                                </div>
                                <span
                                  className={`text-xs font-bold shrink-0 ${
                                    q.status === 'RESOLVED'
                                      ? 'text-emerald-700'
                                      : q.status === 'IN_REVIEW'
                                        ? 'text-[#1E3A5F]'
                                        : 'text-amber-700'
                                  }`}
                                >
                                  {q.status === 'RESOLVED'
                                    ? t.statusResolved
                                    : q.status === 'IN_REVIEW'
                                      ? t.statusInReview
                                      : t.statusOpen}
                                </span>
                              </div>
                              <p className="text-xs text-slate-700 leading-relaxed">{q.message}</p>
                              {q.adminReply && (
                                <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-950 leading-relaxed">
                                  <strong className="block text-[11px] text-emerald-800 mb-0.5">
                                    {t.adminReply}
                                  </strong>
                                  {q.adminReply}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                )}
              </PageTransition>
            )}

            {/* =============================================================== */}
            {/* SETTINGS TAB                                                    */}
            {/* =============================================================== */}
            {activeTab === 'settings' && (
              <PageTransition key="tab-settings">
                <EmployeeSettingsTab
                  lang={lang}
                  isMr={isMr}
                  t={t}
                  onToggleLang={toggleLang}
                  newPassword={newPassword}
                  setNewPassword={setNewPassword}
                  confirmPassword={confirmPassword}
                  setConfirmPassword={setConfirmPassword}
                  showNewPassword={showNewPassword}
                  setShowNewPassword={setShowNewPassword}
                  showConfirmPassword={showConfirmPassword}
                  setShowConfirmPassword={setShowConfirmPassword}
                  pwdSaving={pwdSaving}
                  pwdMessage={pwdMessage}
                  onPasswordSubmit={handlePasswordChange}
                  onLogout={logout}
                />
              </PageTransition>
            )}
          </AnimatePresence>
        )}

        {(activeTab === 'profile' || activeTab === 'settings') && <CompanyFooter compact />}
      </main>

      {/* Native-Style Fixed 5-Tab Bottom Navigation Bar (Home / Incentives / Reports / Profile / Settings) */}
      <nav
        aria-label="Employee Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-5 h-[60px]">
          {mobileNavTabs.map(([tab, label, Icon, hasBadge]) => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setActiveTab(tab);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className={`relative flex flex-col items-center justify-center min-h-[48px] px-1 transition-colors cursor-pointer ${
                  active ? 'text-[#0F1F3D]' : 'text-slate-500'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="staff-bottom-nav-indicator"
                    aria-hidden="true"
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute top-0 w-9 h-0.5 rounded-full bg-[#B8923A]"
                  />
                )}
                <span className="relative">
                  <Icon className="w-5 h-5" />
                  {hasBadge && (
                    <span
                      aria-hidden="true"
                      className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-[#B8923A] ring-2 ring-white"
                    />
                  )}
                </span>
                <span
                  className={`text-[10px] mt-1 leading-none truncate max-w-full ${
                    active ? 'font-bold text-[#0F1F3D]' : 'font-medium'
                  }`}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
      <OfflineIndicator />
    </div>
  );
}
