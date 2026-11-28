import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  DEFAULT_ADMIN_INITIAL_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  generateStrongTemporaryPassword,
  MAIN_OWNER_EMAIL,
  normalizeAdminUsername,
} from '../../lib/firebase';
import {
  createPasswordAdminAccount,
  deleteAdminAccountRecord,
  listAdminAccounts,
  ownerSetAdminPassword,
  toggleAdminAccountStatus,
} from '../../services/adminAccessService';
import type { AdminAccountRecord } from '../../types/incentive';

interface Props {
  onRefreshShell?: () => Promise<void> | void;
}

function formatIsoShort(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function OwnerAdminAccessManager({ onRefreshShell }: Props) {
  const { isMainOwner, user } = useAuth();

  const [accounts, setAccounts] = useState<AdminAccountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Quick Default Admin Activation state
  const [quickUsername, setQuickUsername] = useState(DEFAULT_ADMIN_USERNAME);
  const [quickDisplayName, setQuickDisplayName] = useState('House of Muktai Admin');
  const [quickPassword, setQuickPassword] = useState(DEFAULT_ADMIN_INITIAL_PASSWORD);
  const [showQuickPwd, setShowQuickPwd] = useState(false);
  const [creatingQuick, setCreatingQuick] = useState(false);

  // Custom Admin creation form state
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [creatingCustom, setCreatingCustom] = useState(false);

  // Newly created / reset credentials box (for instant copy/handoff to Admin)
  const [newlyCreatedCreds, setNewlyCreatedCreds] = useState<{
    username: string;
    displayName: string;
    password: string;
    isReset?: boolean;
  } | null>(null);
  const [copiedCreds, setCopiedCreds] = useState(false);

  // Set Admin Password modal state (Main Owner only)
  const [resetTargetAdmin, setResetTargetAdmin] = useState<AdminAccountRecord | null>(null);
  const [resetAdminPassword, setResetAdminPassword] = useState('');
  const [showResetAdminPwd, setShowResetAdminPwd] = useState(true);
  const [resetAdminMustChange, setResetAdminMustChange] = useState(false);
  const [savingResetAdmin, setSavingResetAdmin] = useState(false);
  const [resetAdminErr, setResetAdminErr] = useState<string | null>(null);

  // Inline row action states
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    if (!isMainOwner) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listAdminAccounts();
      setAccounts(list);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load Admin accounts from Firestore.',
      );
    } finally {
      setLoading(false);
    }
  }, [isMainOwner]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  // Strict UI fail-safe: NEVER render Owner controls unless verified Main Owner Gmail is signed in
  if (!isMainOwner) {
    return null;
  }

  const hasPasswordAdmin = accounts.some(
    (a) => a.authType === 'PASSWORD' || Boolean(a.username),
  );
  const activeAdminsCount = accounts.filter((a) => a.active).length;

  const copyCredentialsText = async (creds: {
    username: string;
    displayName: string;
    password: string;
    isReset?: boolean;
  }) => {
    const text = [
      'House of Muktai — Admin Panel Login',
      `Admin Name: ${creds.displayName}`,
      `Username: ${creds.username}`,
      `${creds.isReset ? 'New Password' : 'Initial Password'}: ${creds.password}`,
      'Note: Sign in via "Admin / Owner Panel -> Admin Login" and change your password anytime from the Change Password button.',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCreds(true);
      window.setTimeout(() => setCopiedCreds(false), 2500);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopiedCreds(true);
        window.setTimeout(() => setCopiedCreds(false), 2500);
      } catch {
        setCopiedCreds(false);
      }
    }
  };

  const handleActivateDefaultAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setCreatingQuick(true);
    try {
      const created = await createPasswordAdminAccount({
        username: quickUsername,
        displayName: quickDisplayName,
        initialPassword: quickPassword,
      });
      setNewlyCreatedCreds({
        username: created.username || normalizeAdminUsername(quickUsername),
        displayName: created.displayName,
        password: quickPassword.trim(),
      });
      setSuccessMsg(
        `Admin account "${created.username}" activated! Admin can now sign in with Username & Password and change their password anytime.`,
      );
      await loadAccounts();
      if (onRefreshShell) await onRefreshShell();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to activate Admin account.');
    } finally {
      setCreatingQuick(false);
    }
  };

  const handleCreateCustomAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setCreatingCustom(true);
    try {
      const created = await createPasswordAdminAccount({
        username: newUsername,
        displayName: newDisplayName,
        initialPassword: newPassword,
      });
      setNewlyCreatedCreds({
        username: created.username || normalizeAdminUsername(newUsername),
        displayName: created.displayName,
        password: newPassword.trim(),
      });
      setSuccessMsg(
        `New Admin "${created.username}" (${created.displayName}) created successfully.`,
      );
      setNewUsername('');
      setNewDisplayName('');
      setNewPassword('');
      await loadAccounts();
      if (onRefreshShell) await onRefreshShell();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create Admin account.');
    } finally {
      setCreatingCustom(false);
    }
  };

  const handleToggleActive = async (admin: AdminAccountRecord) => {
    setError(null);
    setSuccessMsg(null);
    setBusyUid(admin.uid);
    try {
      const nextActive = !admin.active;
      await toggleAdminAccountStatus(admin, nextActive);
      setSuccessMsg(
        nextActive
          ? `Admin "${admin.username || admin.email}" reactivated.`
          : `Admin "${admin.username || admin.email}" suspended immediately. Active sessions are revoked.`,
      );
      await loadAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update Admin status.');
    } finally {
      setBusyUid(null);
    }
  };

  const handleDeleteAdmin = async (admin: AdminAccountRecord) => {
    setError(null);
    setSuccessMsg(null);
    setBusyUid(admin.uid);
    try {
      await deleteAdminAccountRecord(admin);
      setConfirmDeleteUid(null);
      setSuccessMsg(
        `Admin access for "${admin.username || admin.email}" permanently removed.`,
      );
      await loadAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove Admin account.');
    } finally {
      setBusyUid(null);
    }
  };

  const openSetAdminPasswordModal = (admin: AdminAccountRecord) => {
    setResetTargetAdmin(admin);
    setResetAdminPassword('');
    setShowResetAdminPwd(true);
    setResetAdminMustChange(false);
    setResetAdminErr(null);
  };

  const handleSaveResetAdminPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTargetAdmin) return;
    const cleanPwd = resetAdminPassword.trim();
    if (cleanPwd.length < 8) {
      setResetAdminErr('Password must be at least 8 characters long.');
      return;
    }
    setSavingResetAdmin(true);
    setResetAdminErr(null);
    setError(null);
    setSuccessMsg(null);
    try {
      const updatedAdmin = await ownerSetAdminPassword({
        admin: resetTargetAdmin,
        newPassword: cleanPwd,
        mustChangePassword: resetAdminMustChange,
      });
      setNewlyCreatedCreds({
        username: updatedAdmin.username || resetTargetAdmin.username || updatedAdmin.email,
        displayName: updatedAdmin.displayName,
        password: cleanPwd,
        isReset: true,
      });
      setSuccessMsg(
        `New password set for Admin "${updatedAdmin.username || updatedAdmin.displayName}". Previous password is revoked immediately.`,
      );
      setResetTargetAdmin(null);
      setResetAdminPassword('');
      await loadAccounts();
      if (onRefreshShell) await onRefreshShell();
    } catch (err) {
      setResetAdminErr(
        err instanceof Error ? err.message : 'Unable to set new password for Admin.',
      );
    } finally {
      setSavingResetAdmin(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Main Owner Exclusive Header Banner */}
      <div className="rounded-2xl bg-[#0F1F3D] text-white border border-[#B8923A]/40 overflow-hidden shadow-xs">
        <div className="h-1 w-full bg-gradient-to-r from-[#B8923A] via-[#DFC27D] to-[#B8923A]" />
        <div className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-[#B8923A]/20 border border-[#DFC27D]/40 text-[#DFC27D] flex items-center justify-center shrink-0">
              <Crown className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                Main Owner · Admin Access Control
              </h2>
              <p className="text-xs text-slate-300 mt-1">
                Signed in as{' '}
                <span className="font-mono text-[#DFC27D] font-semibold">
                  {user?.email || MAIN_OWNER_EMAIL}
                </span>{' '}
                · Create, suspend, or remove Admin accounts.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Active Admins
              </p>
              <p className="text-lg font-bold font-mono text-[#DFC27D] tabular-nums">
                {activeAdminsCount} / {accounts.length}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadAccounts()}
              disabled={loading}
              className="h-10 px-3.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-semibold text-white inline-flex items-center gap-2 cursor-pointer disabled:opacity-60 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Feedback Alerts */}
      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs sm:text-sm flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
          <div className="flex-1">{error}</div>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs sm:text-sm flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
          <div className="flex-1">{successMsg}</div>
        </div>
      )}

      {/* Newly Provisioned Credentials Copy Box */}
      {newlyCreatedCreds && (
        <div className="p-4 sm:p-5 rounded-2xl bg-[#FFFDF7] border-2 border-[#B8923A] shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2 text-[#0F1F3D]">
              <KeyRound className="w-4 h-4 text-[#B8923A]" />
              <h3 className="text-sm font-bold">
                Admin Credentials Ready — Share Privately With Your Admin
              </h3>
            </div>
            <button
              type="button"
              onClick={() => void copyCredentialsText(newlyCreatedCreds)}
              className="h-8 px-3 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
            >
              {copiedCreds ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-300" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[#DFC27D]" />
                  Copy Login Details
                </>
              )}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-white border border-slate-200">
              <p className="text-[11px] text-slate-500">Admin Name</p>
              <p className="font-semibold text-[#0F1F3D] mt-0.5">{newlyCreatedCreds.displayName}</p>
            </div>
            <div className="p-3 rounded-xl bg-white border border-slate-200">
              <p className="text-[11px] text-slate-500">Admin Username</p>
              <p className="font-mono font-bold text-[#0F1F3D] mt-0.5">
                {newlyCreatedCreds.username}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-white border border-slate-200">
              <p className="text-[11px] text-slate-500">
                {newlyCreatedCreds.isReset ? 'New Password' : 'Initial Password'}
              </p>
              <p className="font-mono font-bold text-[#9A7625] mt-0.5">
                {newlyCreatedCreds.password}
              </p>
            </div>
          </div>
          <p className="text-[11px] text-slate-600">
            Admin logs in via <strong>Admin / Owner Panel → Admin Login</strong> using this
            Username &amp; Password, and can change their password anytime from the{' '}
            <strong>Change Password</strong> button inside the Admin Panel.
          </p>
        </div>
      )}

      {/* 1-Click Default Admin Activation Card (highlighted when no Password Admin exists yet) */}
      {!loading && !hasPasswordAdmin && (
        <div className="rounded-2xl bg-white border-2 border-[#B8923A]/60 shadow-xs p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#9A7625]">
                Quick 1-Click Setup
              </span>
              <h3 className="text-base font-bold text-[#0F1F3D] mt-0.5">
                Activate Default Admin Login ({DEFAULT_ADMIN_USERNAME})
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Ready-to-use Admin username &amp; initial password. You can edit them below before
                activating; once logged in, Admin can change their own password anytime.
              </p>
            </div>
          </div>

          <form
            onSubmit={handleActivateDefaultAdmin}
            className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
          >
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Admin Username
              </label>
              <input
                type="text"
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={quickUsername}
                onChange={(e) => setQuickUsername(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#B8923A]/30 focus:border-[#0F1F3D]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Display Name
              </label>
              <input
                type="text"
                required
                value={quickDisplayName}
                onChange={(e) => setQuickDisplayName(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#B8923A]/30 focus:border-[#0F1F3D]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Initial Password (min 8 chars)
              </label>
              <div className="relative">
                <input
                  type={showQuickPwd ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={quickPassword}
                  onChange={(e) => setQuickPassword(e.target.value)}
                  className="w-full h-10 pl-3 pr-9 rounded-xl border border-slate-300 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#B8923A]/30 focus:border-[#0F1F3D]"
                />
                <button
                  type="button"
                  onClick={() => setShowQuickPwd((s) => !s)}
                  aria-label={showQuickPwd ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  {showQuickPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={creatingQuick}
              className="h-10 px-4 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 transition-colors"
            >
              <ShieldCheck className="w-4 h-4 text-[#DFC27D]" />
              {creatingQuick ? 'Activating...' : 'Activate Admin Login'}
            </button>
          </form>
        </div>
      )}

      {/* Role Governance Comparison + Create New Admin Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Create New / Additional / Replacement Admin */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-lg bg-[#0F1F3D] text-[#DFC27D] flex items-center justify-center shrink-0">
              <Plus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#0F1F3D]">Create Admin Username &amp; Password</h3>
              <p className="text-[11px] text-slate-500">
                Add a new Admin or issue a replacement username if an Admin forgets their password
              </p>
            </div>
          </div>

          <form onSubmit={handleCreateCustomAdmin} className="space-y-3.5 mt-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Admin Username
              </label>
              <input
                type="text"
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="e.g. muktai_admin or homadmin"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#B8923A]/30 focus:border-[#0F1F3D]"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                3–40 characters: letters, digits, hyphen (-), or underscore (_)
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Admin Full Name / Desk Label
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Payroll Admin / Office Manager"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#B8923A]/30 focus:border-[#0F1F3D]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Initial Password
              </label>
              <div className="relative">
                <input
                  type={showNewPwd ? 'text' : 'password'}
                  required
                  minLength={8}
                  placeholder="Minimum 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full h-10 pl-3 pr-9 rounded-xl border border-slate-300 text-sm font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#B8923A]/30 focus:border-[#0F1F3D]"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPwd((s) => !s)}
                  aria-label={showNewPwd ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Admin can update this password anytime after logging in.
              </p>
            </div>

            <button
              type="submit"
              disabled={creatingCustom}
              className="w-full h-10 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 transition-colors"
            >
              <KeyRound className="w-4 h-4 text-[#DFC27D]" />
              {creatingCustom ? 'Creating Admin...' : 'Create Admin Account'}
            </button>
          </form>
        </div>

        {/* Right: Role Matrix — Main Owner vs Admin */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-[#FDF8EC] border border-[#B8923A]/35 text-[#9A7625] flex items-center justify-center shrink-0">
                <Shield className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#0F1F3D]">
                  Role &amp; Access Separation (Main Owner vs Admin)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Enforced simultaneously in the UI, Express API middleware, and Firestore Security
                  Rules
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Main Owner Box */}
              <div className="p-4 rounded-xl bg-[#FDFBF5] border border-[#B8923A]/40 space-y-2">
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-[#B8923A]" />
                  <span className="text-xs font-bold text-[#0F1F3D]">
                    Main Owner (Registered Gmail Only)
                  </span>
                </div>
                <p className="text-[11px] font-mono text-[#9A7625] break-all">
                  {MAIN_OWNER_EMAIL}
                </p>
                <ul className="text-xs text-slate-700 space-y-1.5 pt-1">
                  <li className="flex items-start gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
                    <span>Exclusive access to this Owner · Admin Access tab</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
                    <span>Create, Suspend, Reactivate, or Remove any Admin</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
                    <span>Full operational access across all 12 branches &amp; payroll</span>
                  </li>
                </ul>
              </div>

              {/* Admin Box */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#1E3A5F]" />
                  <span className="text-xs font-bold text-[#0F1F3D]">
                    Admin (Username + Password Login)
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Exact existing operational roles · Self-service password change
                </p>
                <ul className="text-xs text-slate-700 space-y-1.5 pt-1">
                  <li className="flex items-start gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
                    <span>
                      All existing tabs: Dashboard, Excel Upload, Employees, Branches, Payouts &amp;
                      Queries, Salary Slips, Analytics &amp; Targets, Approvals &amp; Reports
                    </span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
                    <span>Can change their own password anytime inside Admin Panel</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <UserX className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                    <span className="text-slate-600">
                      Cannot see or access Owner · Admin Access controls
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 mt-4 pt-3 border-t border-slate-100">
            <strong>Owner Password Control:</strong> Main Owner can set or reset any Admin&apos;s
            password anytime using the <strong>Set Password</strong> button below (keeping the exact
            same username), and can also set or reset any Employee&apos;s password directly from{' '}
            <strong>Employee Master</strong> — previous passwords are revoked immediately.
          </p>
        </div>
      </div>

      {/* Provisioned Admin Accounts Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-[#0F1F3D]">
              Provisioned Admin Accounts ({accounts.length})
            </h3>
            <p className="text-xs text-slate-500">
              Changes take effect in real time across web, API, and Firestore database rules
            </p>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading Admin accounts...</div>
        ) : accounts.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-sm font-semibold text-[#0F1F3D]">No Admin accounts provisioned yet</p>
            <p className="text-xs text-slate-500">
              Use the <strong>Quick 1-Click Setup</strong> card above to activate{' '}
              <span className="font-mono font-semibold text-[#0F1F3D]">
                {DEFAULT_ADMIN_USERNAME}
              </span>{' '}
              or create a custom Admin username.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                  <th className="py-3 px-4">Username / Login</th>
                  <th className="py-3 px-4">Display Name</th>
                  <th className="py-3 px-4">Login Type</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Password Security</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-4 text-right">Owner Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.map((acc) => {
                  const isBusy = busyUid === acc.uid;
                  const isConfirmingDelete = confirmDeleteUid === acc.uid;
                  const isPasswordType = acc.authType === 'PASSWORD' || Boolean(acc.username);
                  return (
                    <tr key={acc.uid} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <p className="font-mono font-bold text-[#0F1F3D]">
                          {acc.username || acc.email}
                        </p>
                        {acc.username && (
                          <p className="text-[11px] text-slate-400 font-mono truncate max-w-[200px]">
                            {acc.email}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-800">{acc.displayName}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                            isPasswordType
                              ? 'bg-[#EEF3FA] text-[#1E3A5F]'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {isPasswordType ? 'Username + Password' : 'Google Account'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${
                            acc.active ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              acc.active ? 'bg-emerald-600' : 'bg-red-600'
                            }`}
                          />
                          {acc.active ? 'ACTIVE' : 'SUSPENDED'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {isPasswordType ? (
                          acc.passwordUpdatedAt ? (
                            <span className="text-emerald-700 font-medium">
                              Changed by Admin ({formatIsoShort(acc.passwordUpdatedAt)})
                            </span>
                          ) : (
                            <span className="text-amber-700 font-medium">
                              Initial Password (awaiting change)
                            </span>
                          )
                        ) : (
                          <span className="text-slate-400">Managed by Google</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono">
                        {formatIsoShort(acc.createdAt)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          {isPasswordType && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => openSetAdminPasswordModal(acc)}
                              className="h-8 px-2.5 rounded-lg border border-[#B8923A]/50 bg-[#FDF8EC] hover:bg-[#F8ECCE] text-[#0F1F3D] text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 transition-colors"
                            >
                              <KeyRound className="w-3.5 h-3.5 text-[#9A7625]" />
                              Set Password
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleToggleActive(acc)}
                            className={`h-8 px-2.5 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 transition-colors ${
                              acc.active
                                ? 'border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900'
                                : 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900'
                            }`}
                          >
                            {acc.active ? (
                              <>
                                <UserX className="w-3.5 h-3.5" />
                                Suspend
                              </>
                            ) : (
                              <>
                                <UserCheck className="w-3.5 h-3.5" />
                                Reactivate
                              </>
                            )}
                          </button>

                          {isConfirmingDelete ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleDeleteAdmin(acc)}
                                className="h-8 px-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                              >
                                Confirm Remove
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => setConfirmDeleteUid(null)}
                                className="h-8 px-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[11px] font-medium cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setConfirmDeleteUid(acc.uid)}
                              aria-label={`Remove ${acc.username || acc.email}`}
                              className="h-8 w-8 rounded-lg border border-slate-200 hover:border-red-300 hover:bg-red-50 text-slate-500 hover:text-red-700 inline-flex items-center justify-center cursor-pointer disabled:opacity-50 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Role & Permissions Matrix: Main Owner vs Super Admin (Enforced by Firestore Rules + UI) */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-[#0F1F3D] flex items-center gap-2">
              <Crown className="w-4 h-4 text-[#B8923A]" />
              Role &amp; Permissions Matrix · Main Owner vs Super Admin
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              मुख्य मालक (Main Owner) आणि सुपर अॅडमिन (Super Admin) यांचे स्वतंत्र अधिकार — UI आणि Firestore Rules दोन्हीवर कडकपणे लागू.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                <th className="py-2.5 px-4">Module / Capability</th>
                <th className="py-2.5 px-4">Super Admin (Daily Operations)</th>
                <th className="py-2.5 px-4">Main Owner (Full Governance &amp; Control)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              <tr>
                <td className="py-2.5 px-4 font-semibold text-[#0F1F3D]">Employees &amp; Branches</td>
                <td className="py-2.5 px-4">Add, Edit, Activate/Deactivate, Provision Logins</td>
                <td className="py-2.5 px-4 font-medium text-emerald-800">All Admin rights + <strong>Permanent Delete</strong> Employee &amp; Branch</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-semibold text-[#0F1F3D]">Incentive Excel Batches</td>
                <td className="py-2.5 px-4">Upload, Validate, Approve, Publish; Edit/Delete unpublished drafts</td>
                <td className="py-2.5 px-4 font-medium text-emerald-800">All Admin rights + <strong>Edit/Delete PUBLISHED Batches</strong> &amp; <strong>Delete Whole Month</strong></td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-semibold text-[#0F1F3D]">Monthly Salary Slips</td>
                <td className="py-2.5 px-4">Upload Paysheet, Publish, 1-Click Sync, PDF/WhatsApp Dispatch</td>
                <td className="py-2.5 px-4 font-medium text-emerald-800">All Admin rights + <strong>Direct Edit Slip</strong>, <strong>Move Month</strong>, <strong>Single &amp; Bulk Delete</strong></td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-semibold text-[#0F1F3D]">Payouts, Adjustments &amp; Queries</td>
                <td className="py-2.5 px-4">Mark Approved/Paid, Add/Void Adjustments, Reply &amp; Resolve Queries</td>
                <td className="py-2.5 px-4 font-medium text-emerald-800">All Admin rights + <strong>Permanent Delete</strong> Payouts, Adjustments &amp; Queries</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-semibold text-[#0F1F3D]">Loans &amp; Sales Targets</td>
                <td className="py-2.5 px-4">Create &amp; Update Targets, Issue Loans, Record EMI &amp; Settle</td>
                <td className="py-2.5 px-4 font-medium text-emerald-800">All Admin rights + <strong>Permanent Delete</strong> Loans &amp; Sales Targets</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-semibold text-[#0F1F3D]">Master Governance</td>
                <td className="py-2.5 px-4 text-slate-400">Restricted (View-Only / No Access)</td>
                <td className="py-2.5 px-4 font-medium text-[#9A7625]"><strong>Admin &amp; Employee Password Control</strong>, <strong>Month Payroll Lock/Unlock</strong>, <strong>Fresh Start Reset</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Main Owner · Set / Reset Admin Password Modal */}
      {resetTargetAdmin && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border-2 border-[#B8923A]/50 rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 bg-[#0F1F3D] text-white flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-[#DFC27D] shrink-0" />
                  Main Owner · Set Admin Password
                </h3>
                <p className="text-xs text-slate-300 mt-0.5 truncate">
                  {resetTargetAdmin.displayName} (
                  <span className="font-mono text-[#DFC27D]">
                    {resetTargetAdmin.username || resetTargetAdmin.email}
                  </span>
                  )
                </p>
              </div>
              <button
                type="button"
                disabled={savingResetAdmin}
                onClick={() => setResetTargetAdmin(null)}
                className="p-1 text-slate-300 hover:text-white cursor-pointer"
                aria-label="Close set admin password modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveResetAdminPassword} className="p-5 space-y-4">
              {resetAdminErr && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                  <span>{resetAdminErr}</span>
                </div>
              )}

              <p className="text-xs text-slate-600 leading-relaxed">
                Set a new password for this Admin while keeping the exact same username{' '}
                <strong className="font-mono text-[#0F1F3D]">
                  {resetTargetAdmin.username || resetTargetAdmin.email}
                </strong>
                . The previous password is revoked immediately.
              </p>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="block text-xs font-medium text-slate-700">
                    New Password (min 8 chars)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setResetAdminPassword(generateStrongTemporaryPassword('Admin@'));
                      setShowResetAdminPwd(true);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#9A7625] hover:underline cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" />
                    Generate Strong
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showResetAdminPwd ? 'text' : 'password'}
                    required
                    minLength={8}
                    maxLength={128}
                    autoFocus
                    placeholder="Enter new password (min 8 chars)"
                    value={resetAdminPassword}
                    onChange={(e) => setResetAdminPassword(e.target.value)}
                    className="w-full h-10 pl-3 pr-9 rounded-xl border border-slate-300 text-sm font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#B8923A]/30 focus:border-[#0F1F3D]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetAdminPwd((s) => !s)}
                    aria-label={showResetAdminPwd ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showResetAdminPwd ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={resetAdminMustChange}
                  onChange={(e) => setResetAdminMustChange(e.target.checked)}
                  className="rounded border-slate-300 text-[#0F1F3D] focus:ring-[#0F1F3D]"
                />
                Require Admin to change password on next login
              </label>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={savingResetAdmin}
                  onClick={() => setResetTargetAdmin(null)}
                  className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingResetAdmin || resetAdminPassword.trim().length < 8}
                  className="h-9 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <KeyRound className="w-3.5 h-3.5 text-[#DFC27D]" />
                  {savingResetAdmin ? 'Updating Password...' : 'Save New Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
