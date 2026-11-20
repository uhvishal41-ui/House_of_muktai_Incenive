import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Smartphone,
  Users,
  Wallet,
  X,
} from 'lucide-react';
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
import { OfflineIndicator } from '../common/OfflineIndicator';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { AdminAnalytics } from './AdminAnalytics';
import { AdminOverview } from './AdminOverview';
import { AdminPayoutsAndQueries } from './AdminPayoutsAndQueries';
import { BranchMaster } from './BranchMaster';
import { EmployeeMaster } from './EmployeeMaster';
import { ExcelImportWorkflow } from './ExcelImportWorkflow';
import { HistoryAndReports } from './HistoryAndReports';

type AdminTab =
  | 'overview'
  | 'analytics'
  | 'payouts'
  | 'branches'
  | 'employees'
  | 'import'
  | 'history';

const NAV_ITEMS: Array<{ id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'analytics', label: 'Analytics & Targets', icon: BarChart3 },
  { id: 'payouts', label: 'Payouts & Queries', icon: Wallet },
  { id: 'branches', label: 'Branch Master', icon: Building2 },
  { id: 'employees', label: 'Employee Master', icon: Users },
  { id: 'import', label: 'Daily Excel Import', icon: FileSpreadsheet },
  { id: 'history', label: 'Reports & Audit', icon: History },
];

export function AdminShell() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  const currentNavLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label || 'Overview';

  return (
    <div className="min-h-screen bg-[#F6F7F9] flex">
      {/* Desktop Left Sidebar (264px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-20">
        <div className="h-1 w-full bg-gradient-to-r from-[#B91C1C] via-[#DC2626] to-[#EA580C]" />
        <div className="px-4 py-3.5 flex items-center gap-3 border-b border-slate-200">
          <BrandLogo size="sm" />
          <div className="min-w-0">
            <span className="text-sm font-bold tracking-tight text-slate-900 block truncate">
              {COMPANY_BRAND.brandName}
            </span>
            <span className="text-[10px] font-semibold text-[#9F1239] block truncate">
              SHRIMUKTAI MART PVT. LTD.
            </span>
          </div>
        </div>

        <nav className="flex-1 p-3.5 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            const openQueries =
              item.id === 'payouts'
                ? employeeQueries.filter((q) => q.status !== 'RESOLVED').length
                : 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full h-10 px-3 rounded-lg text-sm font-medium inline-flex items-center justify-between gap-2 transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-[#9F1239] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="inline-flex items-center gap-3 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {openQueries > 0 && (
                  <span
                    className={`text-[11px] font-mono font-semibold ${
                      active ? 'text-amber-200' : 'text-[#9F1239]'
                    }`}
                  >
                    {openQueries}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 bg-slate-50/60">
          <div className="mb-3 px-1">
            <p className="text-xs font-semibold text-slate-900 truncate">Super Admin</p>
            <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
            <p className="text-[10px] text-slate-400 mt-1 truncate">Baramati, Pune · 413102</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="w-full h-9 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] bg-white h-full flex flex-col border-r border-slate-200 z-50">
            <div className="h-1 w-full bg-gradient-to-r from-[#B91C1C] via-[#DC2626] to-[#EA580C]" />
            <div className="px-4 py-3.5 flex items-center justify-between border-b border-slate-200">
              <div className="flex items-center gap-2.5 min-w-0">
                <BrandLogo size="sm" />
                <div className="min-w-0">
                  <span className="text-sm font-bold text-slate-900 block truncate">
                    {COMPANY_BRAND.brandName}
                  </span>
                  <span className="text-[10px] font-semibold text-[#9F1239] block truncate">
                    SHRIMUKTAI MART PVT. LTD.
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 text-slate-500 hover:text-slate-900"
                aria-label="Close navigation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
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
                    className={`w-full h-11 px-3 rounded-lg text-sm font-medium inline-flex items-center gap-3 ${
                      active ? 'bg-[#9F1239] text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200 bg-slate-50/70 space-y-3">
              <p className="text-[11px] text-slate-500 leading-snug">
                {COMPANY_BRAND.legalName} · Baramati, Pune - 413102
              </p>
              <button
                type="button"
                onClick={logout}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 inline-flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 hidden sm:inline whitespace-nowrap">Admin Panel</span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <h1 className="font-semibold text-slate-900 truncate">{currentNavLabel}</h1>
            </div>
          </div>

          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 shrink-0">
            <button
              type="button"
              onClick={handleCopyStaffAppLink}
              title="Copy Employee Mobile App link (/?portal=staff)"
              className="h-8 px-2.5 sm:px-3 rounded-lg bg-white hover:bg-rose-50 border border-slate-200/80 text-xs font-semibold text-[#9F1239] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              {copiedStaffLink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-700" />
                  <span className="text-emerald-800">Copied</span>
                </>
              ) : (
                <>
                  <Smartphone className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Staff App Link</span>
                  <span className="sm:hidden">Staff App</span>
                </>
              )}
            </button>
            <PWAInstallButton />
            <button
              type="button"
              onClick={refreshAll}
              disabled={loadingData}
              className="h-8 px-2.5 sm:px-3 rounded-lg bg-white hover:bg-slate-50 border border-slate-200/80 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
          {syncWarning && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-3">
              <span className="truncate">{syncWarning}</span>
              <button
                type="button"
                onClick={() => {
                  setSyncWarning(null);
                  autoSyncedBranchesRef.current = false;
                  void refreshAll();
                }}
                className="px-2.5 py-1 rounded bg-amber-900 text-white font-medium shrink-0 cursor-pointer hover:bg-amber-800"
              >
                Retry Sync
              </button>
            </div>
          )}
          {loadingData && branches.length === 0 && batches.length === 0 ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse"
                  />
                ))}
              </div>
              <div className="h-80 bg-white border border-slate-200 rounded-xl animate-pulse" />
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <AdminOverview
                  branches={branches}
                  employees={employees}
                  batches={batches}
                  incentives={incentives}
                  monthlySummaries={monthlySummaries}
                  onNavigate={(tab) => setActiveTab(tab)}
                />
              )}
              {activeTab === 'analytics' && (
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
              )}
              {activeTab === 'payouts' && (
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
              )}
              {activeTab === 'branches' && (
                <BranchMaster branches={branches} employees={employees} onRefresh={refreshAll} />
              )}
              {activeTab === 'employees' && (
                <EmployeeMaster
                  branches={branches}
                  employees={employees}
                  onRefresh={refreshAll}
                />
              )}
              {activeTab === 'import' && (
                <ExcelImportWorkflow
                  branches={branches}
                  employees={employees}
                  publishedIncentives={incentives}
                  onRefresh={refreshAll}
                />
              )}
              {activeTab === 'history' && (
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
              )}
            </>
          )}
          <CompanyFooter />
        </main>
      </div>
      <OfflineIndicator />
    </div>
  );
}
