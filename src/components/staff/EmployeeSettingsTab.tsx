import React from 'react';
import {
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  LogOut,
  ShieldCheck,
  Smartphone,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useOnlineStatus } from '../../hooks/usePWAInstall';
import type { AppLang, STAFF_COPY } from '../../lib/i18n';
import { PWAInstallButton } from '../common/PWAInstallButton';

interface Props {
  lang: AppLang;
  isMr: boolean;
  t: (typeof STAFF_COPY)[AppLang];
  onToggleLang: (next: AppLang) => void;
  newPassword: string;
  setNewPassword: (v: string) => void;
  confirmPassword: string;
  setConfirmPassword: (v: string) => void;
  showNewPassword: boolean;
  setShowNewPassword: React.Dispatch<React.SetStateAction<boolean>>;
  showConfirmPassword: boolean;
  setShowConfirmPassword: React.Dispatch<React.SetStateAction<boolean>>;
  pwdSaving: boolean;
  pwdMessage: { type: 'ok' | 'err'; text: string } | null;
  onPasswordSubmit: (e: React.FormEvent) => Promise<void>;
  onLogout: () => Promise<void>;
}

export function EmployeeSettingsTab({
  lang,
  isMr,
  t,
  onToggleLang,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  showNewPassword,
  setShowNewPassword,
  showConfirmPassword,
  setShowConfirmPassword,
  pwdSaving,
  pwdMessage,
  onPasswordSubmit,
  onLogout,
}: Props) {
  const isOnline = useOnlineStatus();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
      {/* Left: Language, App Install, Network Status & Sign Out */}
      <div className="lg:col-span-5 space-y-4">
        <section className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-4 shadow-2xs">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#B8923A] shrink-0" />
            <h2 className="text-sm sm:text-base font-semibold text-[#0F1F3D]">
              {t.languageSettingTitle}
            </h2>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">{t.languageSettingSub}</p>

          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 border border-slate-200/80">
            <button
              type="button"
              onClick={() => onToggleLang('en')}
              className={`h-10 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                lang === 'en'
                  ? 'bg-[#0F1F3D] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => onToggleLang('mr')}
              className={`h-10 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                lang === 'mr'
                  ? 'bg-[#0F1F3D] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              मराठी (Marathi)
            </button>
          </div>
        </section>

        <section className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-2xs">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-[#B8923A] shrink-0" />
            <h2 className="text-sm font-semibold text-[#0F1F3D]">{t.appInfoTitle}</h2>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">{t.appInfoSub}</p>

          <div className="flex items-center justify-between gap-3 pt-1">
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                isOnline ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {isOnline ? (
                <>
                  <Wifi className="w-3.5 h-3.5" />
                  <span>{isMr ? 'ऑनलाइन सिंक सुरू' : 'Connected · Live Sync'}</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>{isMr ? 'ऑफलाइन मोड' : 'Offline · Cached Mode'}</span>
                </>
              )}
            </span>
            <PWAInstallButton label={t.installApp} />
          </div>
        </section>

        <section className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-3 shadow-2xs">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#0F1F3D] shrink-0" />
            <h2 className="text-sm font-semibold text-[#0F1F3D]">
              {isMr ? 'खाते सत्र (Session)' : 'Account Session'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full h-11 px-4 rounded-xl border border-red-200 bg-red-50/70 hover:bg-red-100/80 text-red-800 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{t.signOut}</span>
          </button>
        </section>
      </div>

      {/* Right: Change Password Security Card */}
      <form
        onSubmit={onPasswordSubmit}
        className="lg:col-span-7 bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-6 space-y-4 shadow-2xs"
      >
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-[#B8923A]" />
          <h2 className="text-base font-semibold text-[#0F1F3D]">{t.changePasswordTitle}</h2>
        </div>

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

        <div>
          <label
            htmlFor="settings-new-pwd"
            className="block text-xs font-semibold text-slate-700 mb-1.5"
          >
            {t.newPassword}
          </label>
          <div className="relative">
            <input
              id="settings-new-pwd"
              type={showNewPassword ? 'text' : 'password'}
              required
              minLength={8}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full h-11 pl-3.5 pr-12 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
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
          <label
            htmlFor="settings-confirm-pwd"
            className="block text-xs font-semibold text-slate-700 mb-1.5"
          >
            {t.confirmPassword}
          </label>
          <div className="relative">
            <input
              id="settings-confirm-pwd"
              type={showConfirmPassword ? 'text' : 'password'}
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full h-11 pl-3.5 pr-12 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((prev) => !prev)}
              aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
              className="absolute right-1 top-1 h-9 w-9 inline-flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
            >
              {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={pwdSaving}
          className="w-full h-12 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] active:scale-[0.99] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer transition-all"
        >
          {pwdSaving ? t.saving : t.updatePassword}
        </button>
      </form>
    </div>
  );
}
