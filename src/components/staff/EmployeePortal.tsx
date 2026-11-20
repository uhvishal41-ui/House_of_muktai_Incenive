import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Calendar,
  Check,
  Eye,
  EyeOff,
  FileDown,
  Home,
  KeyRound,
  Lock,
  LogOut,
  MessageSquare,
  ShieldCheck,
  ShieldOff,
  Target,
  TrendingDown,
  TrendingUp,
  User,
  Wallet,
} from 'lucide-react';
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
import type {
  EmployeeNotification,
  EmployeeQuery,
  IncentiveAdjustment,
  MonthlySummary,
  PayoutRecord,
  PublishedIncentive,
  QueryCategory,
  SalesTarget,
} from '../../types/incentive';
import { BrandLogo, CompanyFooter } from '../common/BrandLogo';
import { OfflineIndicator } from '../common/OfflineIndicator';
import { PWAInstallButton } from '../common/PWAInstallButton';

type StaffTab = 'home' | 'statements' | 'history' | 'queries' | 'profile';

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
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9F1239]">
            {typeLabel}
          </p>
          <p className="text-sm font-semibold text-slate-900 mt-0.5 leading-snug">{dateRange}</p>
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            {rec.branchName}
            {rec.version > 1 ? ` · Revised v${rec.version}` : ''}
          </p>
        </div>

        <div className="text-right shrink-0">
          <p className="text-base sm:text-lg font-bold font-mono tabular-nums text-slate-900 leading-tight">
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
      <div className="rounded-xl bg-slate-50/90 border border-slate-100 divide-y divide-slate-200/70 sm:divide-y-0 sm:grid sm:grid-cols-3 sm:divide-x">
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
            <p className="text-sm font-mono tabular-nums font-semibold text-slate-900 shrink-0 sm:mt-1.5">
              {formatINRFromPaise(slab.inc)}
            </p>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onDownloadPdf(rec)}
          className="min-h-[38px] px-3.5 rounded-lg border border-rose-200 bg-rose-50/70 hover:bg-rose-100/80 text-xs font-semibold text-[#9F1239] inline-flex items-center gap-1.5 cursor-pointer transition-colors"
        >
          <FileDown className="w-3.5 h-3.5" />
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
  const [incentives, setIncentives] = useState<PublishedIncentive[]>([]);
  const [summaries, setSummaries] = useState<MonthlySummary[]>([]);
  const [notifications, setNotifications] = useState<EmployeeNotification[]>([]);
  const [payoutRecords, setPayoutRecords] = useState<PayoutRecord[]>([]);
  const [adjustments, setAdjustments] = useState<IncentiveAdjustment[]>([]);
  const [salesTargets, setSalesTargets] = useState<SalesTarget[]>([]);
  const [queries, setQueries] = useState<EmployeeQuery[]>([]);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [loading, setLoading] = useState(true);

  // Query form state
  const [queryMonth, setQueryMonth] = useState(getCurrentMonthKeyIST());
  const [queryCategory, setQueryCategory] = useState<QueryCategory>('INCENTIVE_MISMATCH');
  const [querySubject, setQuerySubject] = useState('');
  const [queryMessage, setQueryMessage] = useState('');
  const [querySubmitting, setQuerySubmitting] = useState(false);
  const [queryFeedback, setQueryFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null,
  );

  // Profile form state
  const [phone, setPhone] = useState(employeeProfile?.phone || '');
  const [address, setAddress] = useState(employeeProfile?.address || '');
  const [emergencyContact, setEmergencyContact] = useState(employeeProfile?.emergencyContact || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

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

  // Real-time Firestore live subscriptions across ALL employee-scoped collections.
  // Any Admin publish, batch edit/delete, payout update, bonus/deduction, sales target,
  // or query reply syncs automatically in real time without manual refresh.
  useEffect(() => {
    if (!employeeLoginGate.allowed || requiresFirstLoginPasswordChange || !user?.uid) {
      setIncentives([]);
      setSummaries([]);
      setNotifications([]);
      setPayoutRecords([]);
      setAdjustments([]);
      setSalesTargets([]);
      setQueries([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let gotIncentives = false;
    let gotSummaries = false;
    const markReadyIfCoreLoaded = () => {
      if (gotIncentives && gotSummaries) {
        setLoading(false);
      }
    };

    // Safety fallback so initial spinner never hangs if a listener takes long offline
    const fallbackTimer = window.setTimeout(() => setLoading(false), 3500);

    const uid = user.uid;
    const unsubs = [
      subscribeOwnPublishedIncentives(uid, (records) => {
        setIncentives(records);
        gotIncentives = true;
        markReadyIfCoreLoaded();
      }),
      subscribeOwnMonthlySummaries(uid, (list) => {
        setSummaries(list);
        gotSummaries = true;
        markReadyIfCoreLoaded();
      }),
      subscribeOwnNotifications(uid, (list) => {
        setNotifications(list);
      }),
      subscribeOwnPayoutRecords(uid, (list) => {
        setPayoutRecords(list);
      }),
      subscribeOwnActiveAdjustments(uid, (list) => {
        setAdjustments(list);
      }),
      subscribeOwnRelevantSalesTargets(uid, (list) => {
        setSalesTargets(list);
      }),
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
  }, [employeeLoginGate.allowed, requiresFirstLoginPasswordChange, user?.uid]);

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
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [activeSummaries, publishedMonthKeys]);

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

  const selectedMonthTarget = useMemo(() => {
    if (!employeeProfile) return null;
    const personal = salesTargets.find(
      (tgt) =>
        tgt.monthKey === selectedMonth &&
        tgt.scope === 'EMPLOYEE' &&
        tgt.employeeId?.toUpperCase() === employeeProfile.employeeId.toUpperCase(),
    );
    if (personal) return personal;
    return (
      salesTargets.find(
        (tgt) =>
          tgt.monthKey === selectedMonth &&
          tgt.scope === 'BRANCH' &&
          tgt.branchId === employeeProfile.branchId,
      ) || null
    );
  }, [salesTargets, selectedMonth, employeeProfile]);

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

  const latestRecord = useMemo(
    () => incentives.find((r) => r.status === 'PUBLISHED') || null,
    [incentives],
  );
  const unreadCount = notifications.filter((n) => !n.read).length;
  const openQueriesCount = queries.filter((q) => q.status !== 'RESOLVED').length;

  const maxHistoryPaise = useMemo(
    () => Math.max(1, ...safeMonthlyHistory.map((s) => s.grandTotalPaise)),
    [safeMonthlyHistory],
  );

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
      setProfileMessage(
        isMr ? 'तुमची माहिती यशस्वीरित्या सेव्ह झाली.' : 'Profile details updated successfully.',
      );
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

  const handleMarkRead = async (notificationId: string) => {
    await markNotificationRead(notificationId);
  };

  // Strict Deactivated Employee Block
  if (!employeeLoginGate.allowed) {
    const isDeactivated = employeeLoginGate.code === 'ACCOUNT_DEACTIVATED';
    return (
      <div className="min-h-screen bg-[#F6F7F9] flex items-center justify-center p-5">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-7 text-center space-y-4 shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-red-50 text-red-700 flex items-center justify-center mx-auto">
            <ShieldOff className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">
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
            className="h-11 px-5 rounded-xl bg-slate-900 text-white text-sm font-medium cursor-pointer"
          >
            {t.signOut}
          </button>
        </div>
      </div>
    );
  }

  // Strict Mandatory First-Login Password Setup Gate
  if (requiresFirstLoginPasswordChange && employeeProfile) {
    return (
      <div className="min-h-[100dvh] w-full overflow-x-hidden bg-[#F6F7F9] flex flex-col">
        <div className="h-1 w-full bg-gradient-to-r from-[#B91C1C] via-[#DC2626] to-[#EA580C]" />
        <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200">
          <div className="max-w-md mx-auto px-3.5 h-full flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <BrandLogo size="xs" />
              <p className="text-sm font-bold text-slate-900 truncate leading-tight">
                {COMPANY_BRAND.brandName}
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 shrink-0">
              <div role="group" aria-label="Language switch" className="inline-flex text-[11px]">
                <button
                  type="button"
                  onClick={() => toggleLang('en')}
                  className={`h-7 px-2 rounded-lg font-semibold cursor-pointer ${
                    lang === 'en' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => toggleLang('mr')}
                  className={`h-7 px-2 rounded-lg font-semibold cursor-pointer ${
                    lang === 'mr' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  मराठी
                </button>
              </div>
              <button
                type="button"
                onClick={logout}
                aria-label={t.signOut}
                className="h-7 w-8 rounded-lg bg-white border border-slate-200/80 text-slate-600 hover:text-slate-900 inline-flex items-center justify-center cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-3.5 sm:p-6">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="bg-slate-950 text-white px-4 py-4 relative">
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#B91C1C] via-[#DC2626] to-[#EA580C]" />
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-rose-900/40 border border-rose-500/30 text-amber-300 flex items-center justify-center shrink-0">
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

            <div className="p-4 sm:p-5 space-y-4">
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
                    {isMr ? 'नवीन पासवर्ड (किमान ८ अक्षरे)' : 'New Personal Password (min 8 characters)'}
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
                      className="w-full h-12 pl-3.5 pr-12 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-900/20 focus:border-rose-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-1 top-1 h-10 w-10 inline-flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
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
                      className="w-full h-12 pl-3.5 pr-12 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-900/20 focus:border-rose-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-1 top-1 h-10 w-10 inline-flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
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
                  className="w-full h-12 px-4 rounded-xl bg-[#9F1239] hover:bg-[#881337] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
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
  const achievedSalePaise = selectedMonthAgg?.totalSaleAmtPaise || 0;
  const achievedSaleQty = selectedMonthAgg?.totalSaleQty || 0;

  const targetSalePct =
    selectedMonthTarget && selectedMonthTarget.targetSaleAmtPaise > 0
      ? Math.round((achievedSalePaise / selectedMonthTarget.targetSaleAmtPaise) * 100)
      : 0;
  const targetRemainingPaise =
    selectedMonthTarget && selectedMonthTarget.targetSaleAmtPaise > 0
      ? Math.max(0, selectedMonthTarget.targetSaleAmtPaise - achievedSalePaise)
      : 0;

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

  return (
    <div className="min-h-[100dvh] w-full overflow-x-hidden bg-[#F6F7F9] pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-10">
      <div className="h-1 w-full bg-gradient-to-r from-[#B91C1C] via-[#DC2626] to-[#EA580C]" />

      {/* Compact Sticky Mobile App Bar (56px) */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-3.5 sm:px-6 h-full flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BrandLogo size="xs" />
            <span className="text-sm font-bold tracking-tight text-slate-900 truncate">
              {t.brand}
            </span>
          </div>

          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium">
            {(
              [
                ['home', t.tabOverview],
                ['statements', t.tabStatements],
                ['history', t.tabHistory],
                ['queries', t.tabQueries],
                ['profile', t.tabProfile],
              ] as Array<[StaffTab, string]>
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`py-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === tab
                    ? 'text-[#9F1239] border-b-2 border-[#9F1239] font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Unified Mobile Header Action Tray */}
          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 shrink-0">
            <div role="group" aria-label="Language switch" className="inline-flex text-[11px]">
              <button
                type="button"
                onClick={() => toggleLang('en')}
                className={`h-7 px-2 rounded-lg font-semibold cursor-pointer transition-colors ${
                  lang === 'en' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => toggleLang('mr')}
                className={`h-7 px-2 rounded-lg font-semibold cursor-pointer transition-colors ${
                  lang === 'mr' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                मराठी
              </button>
            </div>

            <button
              type="button"
              onClick={logout}
              aria-label={t.signOut}
              className="h-7 px-2 rounded-lg bg-white border border-slate-200/80 text-xs font-medium text-slate-600 hover:text-slate-900 inline-flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.signOut}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-3.5 sm:px-6 py-3.5 sm:py-6 space-y-3.5 sm:space-y-5">
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

        {/* Executive Employee Identity Card */}
        <section className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-rose-50 border border-rose-200/80 text-[#9F1239] font-bold text-sm flex items-center justify-center shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate leading-tight">
                {employeeProfile!.fullName}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                <span className="font-mono font-semibold text-slate-700">
                  #{employeeProfile!.employeeId}
                </span>{' '}
                · {employeeProfile!.branchName}
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
                  className="text-[11px] font-semibold text-[#9F1239] inline-flex items-center gap-1 mt-1 cursor-pointer hover:underline"
                >
                  <Bell className="w-3 h-3" />
                  <span>
                    {unreadCount} {unreadCount > 1 ? t.newAlertPlural : t.newAlertSingle}
                  </span>
                </button>
              )}
            </div>
          </div>

          <div className="shrink-0">
            <PWAInstallButton label={t.installApp} />
          </div>
        </section>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-7 h-56 bg-white border border-slate-200 rounded-2xl animate-pulse" />
            <div className="lg:col-span-5 h-56 bg-white border border-slate-200 rounded-2xl animate-pulse" />
          </div>
        ) : (
          <>
            {/* =============================================================== */}
            {/* OVERVIEW / HOME TAB                                             */}
            {/* =============================================================== */}
            {activeTab === 'home' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
                {/* Monthly Net Incentive Hero Card */}
                <section className="lg:col-span-7 bg-slate-950 text-white rounded-2xl p-5 sm:p-6 space-y-5 relative overflow-hidden shadow-xs">
                  <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#B91C1C] via-[#DC2626] to-[#EA580C]" />

                  {/* Row 1: Month Selector + MoM Delta */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {availableMonths.length > 1 ? (
                        <select
                          aria-label="Select incentive month"
                          value={selectedMonth}
                          onChange={(e) => setSelectedMonth(e.target.value)}
                          className="h-9 px-3 rounded-xl bg-white/10 border border-white/15 text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-rose-400/50 cursor-pointer"
                        >
                          {availableMonths.map((m) => (
                            <option key={m} value={m} className="text-slate-900">
                              {formatMonthLabel(m)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs font-semibold text-slate-200">
                          {selectedMonth ? formatMonthLabel(selectedMonth) : t.noPublishedYet}
                        </span>
                      )}
                    </div>

                    {prevMonth && (
                      <div className="text-right shrink-0">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold font-mono tabular-nums ${
                            momDelta.diff >= 0 ? 'text-emerald-300' : 'text-rose-300'
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
                        <p className="text-[10px] text-slate-400 leading-tight mt-0.5">
                          {t.vsMonth} {formatMonthLabel(prevMonth)}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Row 2: Main KPI Figure */}
                  <div>
                    <p className="text-xs text-slate-400 font-medium">{t.monthlyIncentive}</p>
                    <p className="text-3xl sm:text-4xl font-bold font-mono tabular-nums tracking-tight text-white mt-1">
                      {formatINRFromPaise(netPayablePaise)}
                    </p>
                    {selectedMonthAdjNetPaise !== 0 && (
                      <p className="text-[11px] font-mono tabular-nums text-slate-300 mt-1.5">
                        {t.grossIncentive}: {formatINRFromPaise(grossIncentivePaise)} ·{' '}
                        {t.adjustments}: {selectedMonthAdjNetPaise > 0 ? '+' : ''}
                        {formatINRFromPaise(selectedMonthAdjNetPaise)}
                      </p>
                    )}
                    <p className="text-[11px] text-slate-400 mt-1">
                      {selectedMonthAgg?.sourceType === 'MONTHLY_RECORD'
                        ? t.sourceMonthly
                        : selectedMonthAgg?.sourceType === 'DAILY_AGGREGATE'
                          ? `${t.sourceDailyPrefix} ${selectedMonthAgg.publishedDaysCount} ${t.sourceDailySuffix}`
                          : t.sourceNoData}
                    </p>
                  </div>

                  {/* Row 3: Aligned 2-Column Sale & Qty Strip */}
                  <div className="grid grid-cols-2 gap-3 rounded-xl bg-white/[0.06] border border-white/10 p-3.5">
                    <div>
                      <p className="text-[11px] text-slate-400">{t.totalSale}</p>
                      <p className="text-sm sm:text-base font-bold font-mono tabular-nums text-white mt-0.5">
                        {formatINRFromPaise(achievedSalePaise)}
                      </p>
                    </div>
                    <div className="border-l border-white/10 pl-3.5">
                      <p className="text-[11px] text-slate-400">{t.totalQty}</p>
                      <p className="text-sm sm:text-base font-bold font-mono tabular-nums text-white mt-0.5">
                        {formatQty(achievedSaleQty)}
                      </p>
                    </div>
                  </div>

                  {/* Row 4: 3 Incentive Slabs (Structured List on Mobile, 3 Equal Columns on sm+) */}
                  <div className="rounded-xl bg-white/[0.04] border border-white/10 divide-y divide-white/10 sm:divide-y-0 sm:grid sm:grid-cols-3 sm:divide-x">
                    {heroSlabs.map((slab) => (
                      <div
                        key={slab.label}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-3 sm:block"
                      >
                        <div className="min-w-0">
                          <p className="text-xs text-slate-200 font-medium truncate">{slab.label}</p>
                          <p className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
                            {t.saleLabel}: {formatINRFromPaise(slab.sale)} · {t.qtyLabel}:{' '}
                            {formatQty(slab.qty)}
                          </p>
                        </div>
                        <p className="text-sm sm:text-base font-mono tabular-nums font-semibold text-white shrink-0 sm:mt-1.5">
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
                      className="w-full sm:w-auto h-11 px-4 rounded-xl bg-[#9F1239] hover:bg-[#881337] active:scale-[0.99] text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                      <FileDown className="w-4 h-4" />
                      <span>{t.downloadPdfSlip}</span>
                    </button>
                  )}
                </section>

                {/* Right Column: Payout Status & Sales Target Cards */}
                <div className="lg:col-span-5 space-y-4">
                  {/* Payout Status Card */}
                  <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Wallet className="w-4 h-4 text-[#9F1239] shrink-0" />
                        <h2 className="text-sm font-semibold text-slate-900 truncate">
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
                              ? 'text-blue-700'
                              : 'text-amber-700'
                        }`}
                      >
                        {payoutStatusLabel}
                      </span>
                    </div>

                    <div className="text-xs text-slate-600 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span>{t.netPayable}</span>
                        <span className="font-mono tabular-nums font-bold text-sm text-slate-900">
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
                              {t.payoutDate}: {formatShortDate(selectedMonthPayout.paidAt.slice(0, 10))}
                            </p>
                          )}
                        </div>
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

                  {/* Monthly Sales Target Card */}
                  <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Target className="w-4 h-4 text-[#9F1239] shrink-0" />
                        <h2 className="text-sm font-semibold text-slate-900 truncate">
                          {t.targetTitle}
                        </h2>
                      </div>
                      {selectedMonthTarget && (
                        <span className="text-[11px] font-medium text-slate-500 shrink-0">
                          {selectedMonthTarget.scope === 'EMPLOYEE'
                            ? t.targetPersonalScope
                            : t.targetBranchScope}
                        </span>
                      )}
                    </div>

                    {selectedMonthTarget ? (
                      <div className="space-y-2.5">
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="font-mono tabular-nums text-slate-700">
                            {formatINRFromPaise(achievedSalePaise)} /{' '}
                            {formatINRFromPaise(selectedMonthTarget.targetSaleAmtPaise)}
                          </span>
                          <span
                            className={`font-mono tabular-nums font-bold shrink-0 ${
                              targetSalePct >= 100 ? 'text-emerald-700' : 'text-[#9F1239]'
                            }`}
                          >
                            {targetSalePct}% {t.targetAchieved}
                          </span>
                        </div>
                        <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              targetSalePct >= 100 ? 'bg-emerald-600' : 'bg-[#9F1239]'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(2, targetSalePct))}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 font-mono tabular-nums">
                          <span>
                            {targetRemainingPaise === 0
                              ? t.targetCompleted
                              : `${t.targetRemaining}: ${formatINRFromPaise(targetRemainingPaise)}`}
                          </span>
                          {selectedMonthTarget.targetSaleQty > 0 && (
                            <span>
                              {t.qtyLabel}: {formatQty(achievedSaleQty)} /{' '}
                              {formatQty(selectedMonthTarget.targetSaleQty)}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">{t.targetNoTarget}</p>
                    )}
                  </section>
                </div>

                {/* Latest Published Statement Card */}
                <section className="lg:col-span-12 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                  <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-slate-900">{t.latestStatement}</h2>
                    <button
                      type="button"
                      onClick={() => setActiveTab('statements')}
                      className="min-h-[36px] px-2.5 rounded-lg text-xs font-semibold text-[#9F1239] hover:bg-rose-50 cursor-pointer"
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
                  <section className="lg:col-span-12 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                    <div className="px-4 sm:px-5 py-3 border-b border-slate-100">
                      <h2 className="text-sm font-semibold text-slate-900">
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
                    className="lg:col-span-12 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs"
                  >
                    <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100">
                      <h2 className="text-sm font-semibold text-slate-900">{t.recentAlerts}</h2>
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
                              className="min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1 shrink-0 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
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
            )}

            {/* =============================================================== */}
            {/* STATEMENTS TAB                                                  */}
            {/* =============================================================== */}
            {activeTab === 'statements' && (
              <div className="space-y-3.5 sm:space-y-5">
                <section className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                  <h2 className="text-sm sm:text-base font-semibold text-slate-900">
                    {t.statementsHeader}
                  </h2>
                  <div className="grid grid-cols-2 sm:inline-flex items-center gap-1.5 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80">
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
                      className="h-9 px-3 rounded-lg bg-[#9F1239] hover:bg-[#881337] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-40 transition-colors"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      <span>{isMr ? 'PDF स्लिप' : 'PDF Slip'}</span>
                    </button>
                  </div>
                </section>

                {/* Monthly Incentive Statements */}
                {monthMonthlyRecords.length > 0 && (
                  <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                    <div className="px-4 sm:px-5 py-3 border-b border-slate-200 bg-slate-50/70">
                      <h3 className="text-sm font-semibold text-slate-900">
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
                  <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                    <div className="px-4 sm:px-5 py-3 border-b border-slate-200 bg-slate-50/70">
                      <h3 className="text-sm font-semibold text-slate-900">
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
                <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                  <div className="px-4 sm:px-5 py-3 border-b border-slate-200 bg-slate-50/70">
                    <h3 className="text-sm font-semibold text-slate-900">
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
              </div>
            )}

            {/* =============================================================== */}
            {/* HISTORY TAB                                                     */}
            {/* =============================================================== */}
            {activeTab === 'history' && (
              <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-2xs">
                <h2 className="text-base font-semibold text-slate-900">{t.historyTitle}</h2>

                {safeMonthlyHistory.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8 text-center">{t.historyEmpty}</p>
                ) : (
                  <div className="space-y-4">
                    {safeMonthlyHistory.map((s, idx) => {
                      const prev = safeMonthlyHistory[idx + 1];
                      const delta = prev ? s.grandTotalPaise - prev.grandTotalPaise : null;
                      const widthPct = Math.max(
                        5,
                        Math.round((s.grandTotalPaise / maxHistoryPaise) * 100),
                      );
                      const historySlabs = [
                        {
                          label: t.slab1,
                          inc: s.component1TotalPaise,
                          sale: s.saleAmt1TotalPaise,
                          qty: s.saleQty1Total,
                        },
                        {
                          label: t.slab2,
                          inc: s.component2TotalPaise,
                          sale: s.saleAmt2TotalPaise,
                          qty: s.saleQty2Total,
                        },
                        {
                          label: t.slab3,
                          inc: s.component3TotalPaise,
                          sale: s.saleAmt3TotalPaise,
                          qty: s.saleQty3Total,
                        },
                      ];
                      return (
                        <div
                          key={s.monthKey}
                          className="p-4 rounded-xl border border-slate-200/80 bg-slate-50/40 space-y-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-900">
                                {formatMonthLabel(s.monthKey)}
                              </p>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                {s.sourceType === 'MONTHLY_RECORD'
                                  ? t.monthlyStatementLabel
                                  : `${s.publishedDaysCount} ${t.dailyRecordsLabel}`}
                              </p>
                              <p className="text-[11px] font-mono tabular-nums text-slate-600 mt-0.5">
                                {t.saleLabel} {formatINRFromPaise(s.totalSaleAmtPaise)} ·{' '}
                                {t.qtyLabel} {formatQty(s.totalSaleQty)}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-base font-bold font-mono tabular-nums text-slate-900">
                                {formatINRFromPaise(s.grandTotalPaise)}
                              </p>
                              {delta !== null && (
                                <p
                                  className={`text-[11px] font-mono tabular-nums font-semibold mt-0.5 ${
                                    delta >= 0 ? 'text-emerald-700' : 'text-red-700'
                                  }`}
                                >
                                  {delta >= 0 ? '+' : ''}
                                  {formatINRFromPaise(delta)}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="h-2 w-full bg-slate-200/80 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#9F1239] rounded-full"
                              style={{ width: `${widthPct}%` }}
                            />
                          </div>

                          <div className="rounded-xl bg-white border border-slate-100 divide-y divide-slate-100 sm:divide-y-0 sm:grid sm:grid-cols-3 sm:divide-x">
                            {historySlabs.map((slab) => (
                              <div
                                key={slab.label}
                                className="px-3 py-2 flex items-center justify-between gap-2 sm:block"
                              >
                                <div className="min-w-0">
                                  <p className="text-[11px] text-slate-500 truncate">{slab.label}</p>
                                  <p className="text-[10px] font-mono tabular-nums text-slate-400">
                                    {t.saleLabel}: {formatINRFromPaise(slab.sale)} · {t.qtyLabel}:{' '}
                                    {formatQty(slab.qty)}
                                  </p>
                                </div>
                                <p className="text-xs font-mono tabular-nums font-semibold text-slate-900 shrink-0 sm:mt-1">
                                  {formatINRFromPaise(slab.inc)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* =============================================================== */}
            {/* QUERIES / DISPUTE TICKET TAB                                    */}
            {/* =============================================================== */}
            {activeTab === 'queries' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
                <form
                  onSubmit={handleQuerySubmit}
                  className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4 shadow-2xs"
                >
                  <h2 className="text-base font-semibold text-slate-900">{t.queriesTitle}</h2>

                  {queryFeedback && (
                    <div
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
                        {(availableMonths.length > 0 ? availableMonths : [getCurrentMonthKeyIST()]).map((m) => (
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
                      className="w-full h-11 px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-900/20 focus:border-rose-900"
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
                      className="w-full p-3.5 rounded-xl border border-slate-300 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-rose-900/20 focus:border-rose-900"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={querySubmitting}
                    className="w-full h-12 rounded-xl bg-[#9F1239] hover:bg-[#881337] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                  >
                    {querySubmitting ? t.submitting : t.raiseQueryBtn}
                  </button>
                </form>

                <section className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4 shadow-2xs">
                  <h2 className="text-base font-semibold text-slate-900">
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
                              <p className="text-sm font-semibold text-slate-900 leading-snug">
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
                                    ? 'text-blue-700'
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

            {/* =============================================================== */}
            {/* PROFILE & SECURITY TAB                                          */}
            {/* =============================================================== */}
            {activeTab === 'profile' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                <form
                  onSubmit={handleProfileSave}
                  className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4 shadow-2xs"
                >
                  <h2 className="text-base font-semibold text-slate-900">{t.profileTitle}</h2>

                  {profileMessage && (
                    <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                      {profileMessage}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3.5 rounded-xl border border-slate-200/70">
                    <div>
                      <span className="text-slate-500">{t.salesmanNo}</span>
                      <p className="font-mono font-semibold text-slate-900 mt-0.5">
                        {employeeProfile!.employeeId}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">{t.loginId}</span>
                      <p className="font-mono font-semibold text-slate-900 mt-0.5">
                        {employeeProfile!.loginId}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">{isMr ? 'शाखा' : 'Branch'}</span>
                      <p className="font-semibold text-slate-900 mt-0.5 truncate">
                        {employeeProfile!.branchName}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">{isMr ? 'पद' : 'Designation'}</span>
                      <p className="font-semibold text-slate-900 mt-0.5 truncate">
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
                      className="w-full h-11 px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-900/20 focus:border-rose-900"
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
                      className="w-full h-11 px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-900/20 focus:border-rose-900"
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
                      className="w-full h-11 px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-900/20 focus:border-rose-900"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={profileSaving}
                    className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                  >
                    {profileSaving ? t.saving : t.saveProfile}
                  </button>
                </form>

                <form
                  onSubmit={handlePasswordChange}
                  className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4 shadow-2xs"
                >
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-[#9F1239]" />
                    <h2 className="text-base font-semibold text-slate-900">
                      {t.changePasswordTitle}
                    </h2>
                  </div>

                  {pwdMessage && (
                    <div
                      className={`p-3 rounded-xl border text-xs leading-relaxed ${
                        pwdMessage.type === 'ok'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-red-50 border-red-200 text-red-800'
                      }`}
                    >
                      {pwdMessage.text}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      {t.newPassword}
                    </label>
                    <div className="relative">
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full h-11 pl-3.5 pr-12 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-900/20 focus:border-rose-900"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword((prev) => !prev)}
                        aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-1 top-1 h-9 w-9 inline-flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
                      >
                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      {t.confirmPassword}
                    </label>
                    <div className="relative">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full h-11 pl-3.5 pr-12 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-900/20 focus:border-rose-900"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-1 top-1 h-9 w-9 inline-flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
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
                    className="w-full h-12 rounded-xl bg-[#9F1239] hover:bg-[#881337] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                  >
                    {pwdSaving ? t.saving : t.updatePassword}
                  </button>
                </form>
              </div>
            )}
          </>
        )}
        {activeTab === 'profile' && <CompanyFooter compact />}
      </main>

      {/* Native-Style Fixed Bottom Navigation Bar (5 Equal Touch Targets) */}
      <nav
        aria-label="Employee Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-5 h-[60px]">
          {(
            [
              ['home', t.tabOverview, Home, unreadCount > 0],
              ['statements', t.tabStatements, Calendar, false],
              ['history', t.tabHistory, TrendingUp, false],
              ['queries', t.tabQueries, MessageSquare, openQueriesCount > 0],
              ['profile', t.tabProfile, User, false],
            ] as Array<[StaffTab, string, React.ComponentType<{ className?: string }>, boolean]>
          ).map(([tab, label, Icon, hasDot]) => {
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
                  active ? 'text-[#9F1239]' : 'text-slate-500'
                }`}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 w-8 h-0.5 rounded-full bg-[#9F1239]"
                  />
                )}
                <span className="relative">
                  <Icon className="w-5 h-5" />
                  {hasDot && (
                    <span
                      aria-hidden="true"
                      className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-[#9F1239] ring-2 ring-white"
                    />
                  )}
                </span>
                <span
                  className={`text-[10px] mt-1 leading-none truncate max-w-full ${
                    active ? 'font-bold' : 'font-medium'
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
