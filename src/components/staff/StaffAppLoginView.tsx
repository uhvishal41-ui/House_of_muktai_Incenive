import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Smartphone } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { COMPANY_BRAND } from '../../lib/companyBrand';
import { getSavedLang, saveLang, type AppLang } from '../../lib/i18n';
import { BrandLogo, CompanyFooter } from '../common/BrandLogo';
import { PWAInstallButton } from '../common/PWAInstallButton';

export function StaffAppLoginView() {
  const { signInEmployeeWithLoginId, signInEmployeeWithGoogle } = useAuth();
  const [lang, setLang] = useState<AppLang>(() => getSavedLang());
  const isMr = lang === 'mr';

  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleLang = (next: AppLang) => {
    setLang(next);
    saveLang(next);
  };

  const handleEmployeeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId.trim() || !password) {
      setError(
        isMr
          ? 'कृपया Login ID आणि पासवर्ड टाका.'
          : 'Enter both your Login ID and password.',
      );
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await signInEmployeeWithLoginId(loginId, password);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed') {
        setError(
          isMr
            ? 'पासवर्ड लॉगिन सुरू नाही. Admin शी संपर्क साधा.'
            : 'Email/Password sign-in is disabled. Contact Admin.',
        );
      } else if (
        code === 'auth/invalid-credential' ||
        code === 'auth/user-not-found' ||
        code === 'auth/wrong-password'
      ) {
        setError(
          isMr
            ? 'चुकीचा Login ID किंवा पासवर्ड.'
            : 'Invalid Login ID or password.',
        );
      } else {
        setError(err instanceof Error ? err.message : 'Sign-in failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleEmployeeGoogleLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInEmployeeWithGoogle();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full overflow-x-hidden bg-[#F6F7F9] flex flex-col">
      <div className="h-1 w-full bg-gradient-to-r from-[#B91C1C] via-[#DC2626] to-[#EA580C]" />

      {/* Compact Mobile Top Bar */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-md mx-auto px-3.5 h-full flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandLogo size="xs" />
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-tight text-slate-900 truncate leading-tight">
                {COMPANY_BRAND.brandName}
              </p>
              <p className="text-[10px] font-semibold text-[#9F1239] truncate leading-tight">
                {isMr ? 'कर्मचारी अ‍ॅप' : 'Staff App'}
              </p>
            </div>
          </div>

          <div
            role="group"
            aria-label="Language switch"
            className="inline-flex p-0.5 rounded-xl bg-slate-100 border border-slate-200/80 text-[11px] shrink-0"
          >
            <button
              type="button"
              onClick={() => toggleLang('en')}
              className={`h-7 px-2.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                lang === 'en' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => toggleLang('mr')}
              className={`h-7 px-2.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                lang === 'mr' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              मराठी
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-3.5 py-4 sm:py-8">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          {/* Executive App Header */}
          <div className="bg-slate-950 text-white px-4 py-4 sm:px-5 sm:py-5 relative">
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#B91C1C] via-[#DC2626] to-[#EA580C]" />
            <div className="flex items-center gap-3">
              <BrandLogo size="md" className="border-white/20 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-white leading-tight">
                  {isMr ? 'कर्मचारी लॉगिन' : 'Employee Sign In'}
                </h1>
                <p className="text-[11px] font-medium text-amber-300/95 truncate mt-0.5">
                  {COMPANY_BRAND.legalName}
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            {error && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 leading-snug"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleEmployeeLogin} className="space-y-3.5">
              <div>
                <label
                  htmlFor="staff-loginId"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  {isMr ? 'Login ID / Salesman No' : 'Login ID / Salesman No'}
                </label>
                <input
                  id="staff-loginId"
                  type="text"
                  autoComplete="username"
                  inputMode="text"
                  placeholder={isMr ? 'उदा. HOM459 किंवा 459' : 'e.g. HOM459 or 459'}
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value.toUpperCase())}
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 font-mono placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-900/20 focus:border-rose-900"
                />
              </div>

              <div>
                <label
                  htmlFor="staff-password"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  {isMr ? 'पासवर्ड' : 'Password'}
                </label>
                <div className="relative">
                  <input
                    id="staff-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder={isMr ? 'पासवर्ड टाका' : 'Enter password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-11 pl-3.5 pr-11 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-900/20 focus:border-rose-900"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-0.5 h-10 w-10 inline-flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Unified Login Action Tray */}
              <div className="pt-1 space-y-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-11 px-4 rounded-xl bg-[#9F1239] hover:bg-[#881337] active:scale-[0.99] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer"
                >
                  <span>
                    {busy
                      ? isMr
                        ? 'लॉगिन होत आहे...'
                        : 'Signing in...'
                      : isMr
                        ? 'लॉगिन करा'
                        : 'Sign In'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={handleEmployeeGoogleLogin}
                  className="w-full h-10 px-4 rounded-xl border border-slate-300 bg-slate-50/70 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors disabled:opacity-60 cursor-pointer"
                >
                  {isMr ? 'Google खात्याने लॉगिन करा' : 'Continue with Google'}
                </button>
              </div>
            </form>

            {/* Compact App Install Row */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 min-w-0">
                <Smartphone className="w-3.5 h-3.5 text-[#9F1239] shrink-0" />
                <span className="truncate">
                  {isMr ? 'मोबाईल अ‍ॅप Install करा' : 'Install Mobile App'}
                </span>
              </div>
              <PWAInstallButton label={isMr ? 'Install' : 'Install'} />
            </div>
          </div>
        </div>
      </main>

      <div className="max-w-md w-full mx-auto px-3.5 pb-4">
        <CompanyFooter compact />
      </div>
    </div>
  );
}
