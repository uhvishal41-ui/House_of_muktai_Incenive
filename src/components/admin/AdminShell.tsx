import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Building2,
  Check,
  FileSpreadsheet,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Smartphone,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useAuth } from '../../context/AuthContext';
import {
  DEFAULT_12_BRANCHES,
  isLegacyOrDuplicateBranch,
  listAllMonthlySummaries,
  listAllPublishedIncentives,
  listAuditLogs,
  listBranches,
  listEmployees,
  listImportBatches,
  listIncentiveVersions,
  syncOfficial12Branches,
} from '../../services/incentiveService';
import {
  listAllAdjustments,
  listAllEmployeeQueries,
  listAllPayoutRecords,
  listAllSalesTargets,
} from '../../services/operationsService';
import type {
  AuditLog,
  Branch,
  Employee,
  EmployeeQuery,
  ImportBatch,
  IncentiveAdjustment,
  IncentiveVersion,
  MonthlySummary,
  PayoutRecord,
  PublishedIncentive,
  SalesTarget,
} from '../../types/incentive';
import { COMPANY_BRAND, getShareableStaffAppUrl } from '../../lib/companyBrand';
import { BrandLogo, CompanyFooter } from '../common/BrandLogo';
import { PageTransition, WorkspaceSkeleton } from '../common/MotionPrimitives';
import { OfflineIndicator } from '../common/OfflineIndicator';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { AdminGlobalSearch, type AdminNavTab } from './AdminGlobalSearch';
import { AdminNotificationCenter } from './AdminNotificationCenter';
import { AdminOverview } from './AdminOverview';

// Route/tab-level code splitting for faster initial Admin Panel load (H2)
const AdminAnalytics = lazy(() =>
  import('./AdminAnalytics').then((m) => ({ default: m.AdminAnalytics })),
);
const AdminPayoutsAndQueries = lazy(() =>
  import('./AdminPayoutsAndQueries').then((m) => ({ default: m.AdminPayoutsAndQueries })),
);
const BranchMaster = lazy(() =>
  import('./BranchMaster').then((m) => ({ default: m.BranchMaster })),
);
const EmployeeMaster = lazy(() =>
  import('./EmployeeMaster').then((m) => ({ default: m.EmployeeMaster })),
);
const ExcelImportWorkflow = lazy(() =>
  import('./ExcelImportWorkflow').then((m) => ({ default: m.ExcelImportWorkflow })),
);
const HistoryAndReports = lazy(() =>
  import('./HistoryAndReports').then((m) => ({ default: m.HistoryAndReports })),
);

const NAV_ITEMS: Array<{
  id: AdminNavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'import', label: 'Excel Upload', icon: FileSpreadsheet },
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'branches', label: 'Branches', icon: Building2 },
  { id: 'payouts', label: 'Payouts & Queries', icon: Wallet },
  { id: 'analytics', label: 'Analytics & Targets', icon: BarChart3 },
  { id: 'history', label: 'Approvals & Reports', icon: History },
];

export function AdminShell() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminNavTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [incentives, setIncentives] = useState<PublishedIncentive[]>([]);
  const [monthlySummaries, setMonthlySummaries] = useState<MonthlySummary[]>([]);
  const [versions, setVersions] = useState<IncentiveVersion[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [payoutRecords, setPayoutRecords] = useState<PayoutRecord[]>([]);
  const [adjustments, setAdjustments] = useState<IncentiveAdjustment[]>([]);
  const [salesTargets, setSalesTargets] = useState<SalesTarget[]>([]);
  const [employeeQueries, setEmployeeQueries] = useState<EmployeeQuery[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [copiedStaffLink, setCopiedStaffLink] = useState(false);
  const autoSyncedBranchesRef = useRef(false);

  // Global keyboard shortcut Cmd+K / Ctrl+K for Global Search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleCopyStaffAppLink = async () => {
    const staffUrl = getShareableStaffAppUrl();
    try {
      await navigator.clipboard.writeText(staffUrl);
      setCopiedStaffLink(true);
      window.setTimeout(() => setCopiedStaffLink(false), 2600);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = staffUrl;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopiedStaffLink(true);
        window.setTimeout(() => setCopiedStaffLink(false), 2600);
      } catch {
        setCopiedStaffLink(false);
      }
    }
  };

  const refreshAll = useCallback(async () => {
    setLoadingData(true);
    try {
      let [b, e, ib, pi, ms, iv, al] = await Promise.all([
        listBranches(),
        listEmployees(),
        listImportBatches(),
        listAllPublishedIncentives(),
        listAllMonthlySummaries(),
        listIncentiveVersions(),
        listAuditLogs(),
      ]);

      const [pr, adj, tgt, qry] = await Promise.all([
        listAllPayoutRecords().catch(() => [] as PayoutRecord[]),
        listAllAdjustments().catch(() => [] as IncentiveAdjustment[]),
        listAllSalesTargets().catch(() => [] as SalesTarget[]),
        listAllEmployeeQueries().catch(() => [] as EmployeeQuery[]),
      ]);

      // Automatically link the 12 official branches & clean legacy placeholders/alias duplicates once on load
      if (!autoSyncedBranchesRef.current) {
        const existingIds = new Set(b.map((br) => br.branchId));
        const missingOfficial = DEFAULT_12_BRANCHES.some((def) => !existingIds.has(def.code));
        const hasLegacyOrDuplicate = b.some((br) => isLegacyOrDuplicateBranch(br));
        autoSyncedBranchesRef.current = true;
        if (missingOfficial || hasLegacyOrDuplicate) {
          try {
            await syncOfficial12Branches({ pruneAllNonOfficialUnreferenced: false });
            setSyncWarning(null);
            [b, e, pi, ms, al] = await Promise.all([
              listBranches(),
              listEmployees(),
              listAllPublishedIncentives(),
              listAllMonthlySummaries(),
              listAuditLogs(),
            ]);
          } catch (syncErr) {
            setSyncWarning(
              syncErr instanceof Error
                ? `Official 12 branch sync could not complete automatically: ${syncErr.message}`
                : 'Official 12 branch sync could not complete automatically. Use Branch Master to retry.',
            );
          }
        }
      }

      setBranches(b);
      setEmployees(e);
      setBatches(ib);
      setIncentives(pi);
      setMonthlySummaries(ms);
      setVersions(iv);
      setAuditLogs(al);
      setPayoutRecords(pr);
      setAdjustments(adj);
      setSalesTargets(tgt);
      setEmployeeQueries(qry);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const currentNavLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label || 'Dashboard';
  const pendingApprovalCount = batches.filter(
    (b) =>
      b.status === 'VALIDATED' ||
      b.status === 'APPROVED' ||
      b.status === 'FAILED' ||
      b.status === 'PROCESSING',
  ).length;
  const openQueriesCount = employeeQueries.filter((q) => q.status !== 'RESOLVED').length;
  const adminInitials = (user?.email || 'SA').slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-[#F5F7FA] flex">
      {/* Desktop Executive Corporate Navy Sidebar (256px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-[#0F1F3D] text-white border-r border-[#1E3A5F]/60 z-20">
        <div className="h-1 w-full bg-gradient-to-r from-[#B8923A] via-[#DFC27D] to-[#B8923A]" />
        <div className="px-4 py-4 flex items-center gap-3 border-b border-white/10">
          <BrandLogo size="sm" className="border-[#B8923A]/40" />
          <div className="min-w-0">
            <span className="text-sm font-bold tracking-tight text-white block truncate">
              {COMPANY_BRAND.brandName}
            </span>
            <span className="text-[10px] font-semibold text-[#DFC27D] block truncate">
              SHRIMUKTAI MART PVT. LTD.
            </span>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="Admin Navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            const countBadge =
              item.id === 'payouts'
                ? openQueriesCount
                : item.id === 'history'
                  ? pendingApprovalCount
                  : 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full h-10 px-3 rounded-xl text-sm font-medium inline-flex items-center justify-between gap-2 transition-all whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-white text-[#0F1F3D] font-semibold shadow-xs'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="inline-flex items-center gap-3 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      active ? 'text-[#B8923A]' : 'text-slate-400'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {countBadge > 0 && (
                  <span
                    className={`text-[11px] font-mono font-bold ${
                      active ? 'text-[#9A7625]' : 'text-[#DFC27D]'
                    }`}
                  >
                    {countBadge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10 bg-[#0B172E]">
          <div className="mb-3 flex items-center gap-2.5 px-1">
            <div className="w-8 h-8 rounded-lg bg-[#1E3A5F] border border-[#B8923A]/40 text-[#DFC27D] text-xs font-bold flex items-center justify-center shrink-0">
              {adminInitials}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">Super Admin</p>
              <p className="text-[11px] text-slate-400 truncate">{user?.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="w-full h-9 px-3 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile Animated Navigation Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden flex">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="fixed inset-0 bg-[#0F1F3D]/50 backdrop-blur-xs"
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-72 max-w-[85vw] bg-[#0F1F3D] text-white h-full flex flex-col border-r border-white/10 z-50"
            >
              <div className="h-1 w-full bg-gradient-to-r from-[#B8923A] via-[#DFC27D] to-[#B8923A]" />
              <div className="px-4 py-3.5 flex items-center justify-between border-b border-white/10">
                <div className="flex items-center gap-2.5 min-w-0">
                  <BrandLogo size="sm" className="border-[#B8923A]/40" />
                  <div className="min-w-0">
                    <span className="text-sm font-bold text-white block truncate">
                      {COMPANY_BRAND.brandName}
                    </span>
                    <span className="text-[10px] font-semibold text-[#DFC27D] block truncate">
                      SHRIMUKTAI MART PVT. LTD.
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 text-slate-300 hover:text-white cursor-pointer"
                  aria-label="Close navigation"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="flex-1 p-3.5 space-y-1 overflow-y-auto">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full h-11 px-3 rounded-xl text-sm font-medium inline-flex items-center gap-3 cursor-pointer transition-colors ${
                        active
                          ? 'bg-white text-[#0F1F3D] font-semibold'
                          : 'text-slate-200 hover:bg-white/10'
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          active ? 'text-[#B8923A]' : 'text-slate-400'
                        }`}
                      />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
              <div className="p-4 border-t border-white/10 bg-[#0B172E] space-y-3">
                <p className="text-[11px] text-slate-400 leading-snug">
                  {COMPANY_BRAND.legalName} · Baramati, Pune - 413102
                </p>
                <button
                  type="button"
                  onClick={logout}
                  className="w-full h-10 px-3 rounded-lg border border-white/15 bg-white/5 text-sm font-medium text-white inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content Viewport */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 h-16 bg-white/95 backdrop-blur-md border-b border-slate-200/90 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-[#0F1F3D] cursor-pointer"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 hidden sm:inline whitespace-nowrap">
                Admin Panel
              </span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <h1 className="font-semibold text-[#0F1F3D] truncate">{currentNavLabel}</h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Global Search Trigger */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="h-8 px-2.5 sm:px-3 rounded-lg bg-[#F5F7FA] hover:bg-slate-100 border border-slate-200/90 text-xs text-slate-600 inline-flex items-center gap-2 cursor-pointer transition-colors"
              title="Global Search (Ctrl+K)"
            >
              <Search className="w-3.5 h-3.5 text-[#1E3A5F]" />
              <span className="hidden md:inline">Search...</span>
              <kbd className="hidden lg:inline px-1.5 py-0.5 text-[10px] font-mono bg-white border border-slate-200 rounded text-slate-400">
                Ctrl K
              </kbd>
            </button>

            {/* Notification Center Bell */}
            <AdminNotificationCenter
              batches={batches}
              employeeQueries={employeeQueries}
              onNavigate={(tab) => setActiveTab(tab)}
            />

            {/* Staff App Link + Install + Refresh */}
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 shrink-0">
              <button
                type="button"
                onClick={handleCopyStaffAppLink}
                title={`Copy Employee Mobile App link (${COMPANY_BRAND.staffDomain})`}
                className="h-8 px-2.5 sm:px-3 rounded-lg bg-white hover:bg-slate-50 border border-slate-200/80 text-xs font-semibold text-[#0F1F3D] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                {copiedStaffLink ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-700" />
                    <span className="text-emerald-800">Copied</span>
                  </>
                ) : (
                  <>
                    <Smartphone className="w-3.5 h-3.5 text-[#B8923A]" />
                    <span className="hidden sm:inline">Staff App Link</span>
                    <span className="sm:hidden">Staff</span>
                  </>
                )}
              </button>
              <PWAInstallButton />
              <button
                type="button"
                onClick={refreshAll}
                disabled={loadingData}
                aria-label="Refresh workspace data"
                className="h-8 px-2.5 sm:px-3 rounded-lg bg-white hover:bg-slate-50 border border-slate-200/80 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`} />
                <span className="hidden md:inline">Refresh</span>
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          {syncWarning && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-3">
              <span className="truncate">{syncWarning}</span>
              <button
                type="button"
                onClick={() => {
                  setSyncWarning(null);
                  autoSyncedBranchesRef.current = false;
                  void refreshAll();
                }}
                className="px-2.5 py-1 rounded-lg bg-[#0F1F3D] text-white font-medium shrink-0 cursor-pointer hover:bg-[#162B50]"
              >
                Retry Sync
              </button>
            </div>
          )}

          {loadingData && branches.length === 0 && batches.length === 0 ? (
            <WorkspaceSkeleton />
          ) : (
            <AnimatePresence mode="wait">
              <PageTransition key={activeTab}>
                {activeTab === 'overview' && (
                  <AdminOverview
                    branches={branches}
                    employees={employees}
                    batches={batches}
                    incentives={incentives}
                    monthlySummaries={monthlySummaries}
                    employeeQueries={employeeQueries}
                    onNavigate={(tab) => setActiveTab(tab)}
                  />
                )}
                {activeTab === 'analytics' && (
                  <Suspense fallback={<WorkspaceSkeleton />}>
                    <AdminAnalytics
                      branches={branches}
                      employees={employees}
                      incentives={incentives}
                      monthlySummaries={monthlySummaries}
                      payoutRecords={payoutRecords}
                      adjustments={adjustments}
                      salesTargets={salesTargets}
                      onRefresh={refreshAll}
                    />
                  </Suspense>
                )}
                {activeTab === 'payouts' && (
                  <Suspense fallback={<WorkspaceSkeleton />}>
                    <AdminPayoutsAndQueries
                      branches={branches}
                      employees={employees}
                      incentives={incentives}
                      monthlySummaries={monthlySummaries}
                      payoutRecords={payoutRecords}
                      adjustments={adjustments}
                      employeeQueries={employeeQueries}
                      onRefresh={refreshAll}
                    />
                  </Suspense>
                )}
                {activeTab === 'branches' && (
                  <Suspense fallback={<WorkspaceSkeleton />}>
                    <BranchMaster
                      branches={branches}
                      employees={employees}
                      onRefresh={refreshAll}
                    />
                  </Suspense>
                )}
                {activeTab === 'employees' && (
                  <Suspense fallback={<WorkspaceSkeleton />}>
                    <EmployeeMaster
                      branches={branches}
                      employees={employees}
                      onRefresh={refreshAll}
                    />
                  </Suspense>
                )}
                {activeTab === 'import' && (
                  <Suspense fallback={<WorkspaceSkeleton />}>
                    <ExcelImportWorkflow
                      branches={branches}
                      employees={employees}
                      publishedIncentives={incentives}
                      onRefresh={refreshAll}
                    />
                  </Suspense>
                )}
                {activeTab === 'history' && (
                  <Suspense fallback={<WorkspaceSkeleton />}>
                    <HistoryAndReports
                      branches={branches}
                      employees={employees}
                      batches={batches}
                      incentives={incentives}
                      monthlySummaries={monthlySummaries}
                      versions={versions}
                      auditLogs={auditLogs}
                      payoutRecords={payoutRecords}
                      adjustments={adjustments}
                      onRefresh={refreshAll}
                    />
                  </Suspense>
                )}
              </PageTransition>
            </AnimatePresence>
          )}
          <CompanyFooter />
        </main>
      </div>

      <AdminGlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        branches={branches}
        employees={employees}
        batches={batches}
        onNavigate={(tab) => setActiveTab(tab)}
      />
      <OfflineIndicator />
    </div>
  );
}
