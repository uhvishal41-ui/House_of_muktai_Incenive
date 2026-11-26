import React, { useState } from 'react';
import { ArrowRight, Crown, Eye, EyeOff, KeyRound, Languages, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { COMPANY_BRAND } from '../lib/companyBrand';
import { getSavedLang, saveLang, type AppLang } from '../lib/i18n';
import { BrandLogo } from './common/BrandLogo';
import {
  AutoMixGoogleButton,
  ContinuousAnimatedBrandName,
} from './common/PlayfulAnimatedBrand';

export function LoginView() {
  const {
    portalMode,
    setPortalMode,
    adminAccessBlockedReason,
    signInAdminWithGoogle,
    signInAdminWithCredentials,
    signInEmployeeWithLoginId,
  } = useAuth();

  const [lang, setLang] = useState<AppLang>(() => getSavedLang());
  const isMr = lang === 'mr';

  const toggleLang = () => {
    const next: AppLang = lang === 'mr' ? 'en' : 'mr';
    setLang(next);
    saveLang(next);
  };

  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);

  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleError = error || adminAccessBlockedReason;

  const handleMainOwnerGoogleLogin = async () => {
    setError(null);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError(
        'No internet connection detected. Connect to the internet and try Main Owner Sign In again.',
      );
      return;
    }
    setBusy(true);
    try {
      await signInAdminWithGoogle();
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/network-request-failed') {
        setError(
          'Google Sign-In network request failed (auth/network-request-failed). Please check your internet connection, disable any Ad-Blocker / VPN / Brave Shields, use a regular browser window (not Incognito with blocked third-party cookies), and try again.',
        );
      } else if (code === 'auth/popup-blocked') {
        setError(
          'Browser blocked the Google Sign-In popup. Please allow popups for this site and click Sign In again.',
        );
      } else if (
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request'
      ) {
        setError('Google Sign-In popup was closed before signing in. Please try again.');
      } else if (code === 'auth/unauthorized-domain') {
        setError(
          'This domain is not allowlisted for Google Sign-In in Firebase Console -> Authentication -> Settings -> Authorized domains.',
        );
      } else {
        const msg =
          err instanceof Error ? err.message : 'Unable to complete Main Owner Google sign-in.';
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAdminPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminUsername.trim() || !adminPassword) {
      setError('Enter both Admin Username and Password.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await signInAdminWithCredentials(adminUsername, adminPassword);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed') {
        setError(
          'Email/Password sign-in is not yet enabled in Firebase Console. Enable Authentication -> Sign-in method -> Email/Password.',
        );
      } else if (
        code === 'auth/invalid-credential' ||
        code === 'auth/user-not-found' ||
        code === 'auth/wrong-password'
      ) {
        setError(
          'Invalid Admin Username or Password. If not activated yet, Main Owner can activate it under Owner · Admin Access.',
        );
      } else {
        setError(err instanceof Error ? err.message : 'Admin sign-in failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleEmployeeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId.trim() || !password) {
      setError(
        isMr
          ? 'कृपया तुमचा Employee ID / Login ID आणि पासवर्ड दोन्ही टाका.'
          : 'Enter both your assigned Login ID and password.',
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
          'Email/Password sign-in is not yet enabled in Firebase Console. Enable Authentication -> Sign-in method -> Email/Password.',
        );
      } else if (
        code === 'auth/invalid-credential' ||
        code === 'auth/user-not-found' ||
        code === 'auth/wrong-password'
      ) {
        setError(
          isMr
            ? 'तुमचा Login ID किंवा पासवर्ड चुकीचा आहे. अडचण आल्यास तुमच्या House of Muktai Admin शी संपर्क साधा.'
            : 'Invalid Login ID or password. Contact your House of Muktai administrator.',
        );
      } else {
        setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full overflow-x-hidden bg-[#F5F7FA] flex flex-col">
      <div className="h-1 w-full bg-gradient-to-r from-[#0F1F3D] via-[#1E3A5F] to-[#B8923A]" />

      <header className="w-full border-b border-slate-200/90 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <BrandLogo size="sm" />
            <ContinuousAnimatedBrandName
              tone="dark"
              className="text-base whitespace-nowrap"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-500 hidden sm:flex items-center gap-2 whitespace-nowrap">
              <span className="font-semibold text-[#0F1F3D]">{COMPANY_BRAND.legalName}</span>
              <span aria-hidden="true">·</span>
              <span>{COMPANY_BRAND.branchCountLabel}</span>
            </div>
            <button
              type="button"
              onClick={toggleLang}
              className="h-8 px-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-[#0F1F3D] inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Languages className="w-3.5 h-3.5 text-[#B8923A]" />
              <span>{isMr ? 'EN' : 'मराठी'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-3.5 sm:p-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 items-stretch bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs"
        >
          {/* Left Executive Corporate Navy Panel */}
          <div className="lg:col-span-5 bg-[#0F1F3D] text-white p-6 lg:p-8 flex flex-col justify-center relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#B8923A] via-[#DFC27D] to-[#B8923A]" />

            <div className="space-y-4">
              <div className="flex items-center gap-3.5">
                <BrandLogo size="lg" className="border-[#B8923A]/40 shadow-sm" />
                <div className="min-w-0">
                  <ContinuousAnimatedBrandName
                    tone="light"
                    className="text-xl sm:text-2xl leading-tight"
                  />
                  <p className="text-[11px] font-semibold tracking-wide text-[#DFC27D] mt-1 leading-snug">
                    {COMPANY_BRAND.legalName}
                  </p>
                </div>
              </div>

              <h1 className="text-[11px] sm:text-xs lg:text-[12.5px] font-semibold tracking-tight leading-snug text-white whitespace-nowrap">
                Employee Incentive &amp; Payroll Management System
              </h1>
            </div>
          </div>

          {/* Right Auth Form Panel */}
          <div className="lg:col-span-7 p-6 lg:p-8 flex flex-col justify-center bg-white">
            <div className="mb-5">
              <div
                className="inline-flex p-1 bg-slate-100 border border-slate-200/80 rounded-xl mb-4"
                role="tablist"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={portalMode === 'admin'}
                  onClick={() => {
                    setPortalMode('admin');
                    setError(null);
                  }}
                  className={`h-8 px-3.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                    portalMode === 'admin'
                      ? 'bg-[#0F1F3D] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Admin / Owner Panel
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={portalMode === 'staff'}
                  onClick={() => {
                    setPortalMode('staff');
                    setError(null);
                  }}
                  className={`h-8 px-3.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                    portalMode === 'staff'
                      ? 'bg-[#0F1F3D] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {isMr ? 'कर्मचारी पोर्टल (Employee)' : 'Employee Portal'}
                </button>
              </div>

              <h2 className="text-lg font-semibold text-[#0F1F3D]">
                {portalMode === 'admin'
                  ? 'Admin & Main Owner Sign In'
                  : isMr
                    ? 'कर्मचारी लॉगिन (Employee Sign In)'
                    : 'Employee Sign In'}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {portalMode === 'admin'
                  ? 'Admin signs in with Username & Password · Main Owner signs in with Registered Gmail.'
                  : isMr
                    ? 'तुमचा Employee ID / Login ID आणि पासवर्ड टाकून पगार स्लिप व इन्सेंटिव्ह पहा.'
                    : 'Sign in with your Employee ID / Login ID and personal password.'}
              </p>
            </div>

            <AnimatePresence>
              {visibleError && (
                <motion.div
                  role="alert"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                  className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 leading-snug"
                >
                  {visibleError}
                </motion.div>
              )}
            </AnimatePresence>

            {portalMode === 'admin' ? (
              <div className="space-y-4">
                {/* Admin Username + Password Sign-In */}
                <form onSubmit={handleAdminPasswordLogin} className="space-y-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#0F1F3D] uppercase tracking-wider">
                    <KeyRound className="w-3.5 h-3.5 text-[#B8923A]" />
                    <span>Admin Login (Username &amp; Password)</span>
                  </div>
                  <div>
                    <label
                      htmlFor="adminUsername"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      Admin Username
                    </label>
                    <input
                      id="adminUsername"
                      type="text"
                      autoComplete="username"
                      placeholder="e.g. HOMADMIN"
                      value={adminUsername}
                      onChange={(e) => setAdminUsername(e.target.value.toUpperCase())}
                      className="w-full h-11 px-3.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 font-mono placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="adminPassword"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      Admin Password
                    </label>
                    <div className="relative">
                      <input
                        id="adminPassword"
                        type={showAdminPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        placeholder="Enter admin password"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        className="w-full h-11 pl-3.5 pr-11 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowAdminPassword((prev) => !prev)}
                        aria-label={showAdminPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-1 top-0.5 h-10 w-10 inline-flex items-center justify-center text-slate-500 hover:text-[#0F1F3D] rounded-lg cursor-pointer"
                      >
                        {showAdminPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full h-11 px-4 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] active:scale-[0.99] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer"
                  >
                    <span>{busy ? 'Signing in...' : 'Sign In as Admin'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>

                {/* Divider for Main Owner Exclusive Access */}
                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-3 text-[11px] font-semibold text-[#9A7625] inline-flex items-center gap-1.5">
                      <Crown className="w-3.5 h-3.5" />
                      <span>Main Owner Access (Registered Gmail Only)</span>
                    </span>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <AutoMixGoogleButton
                    onClick={handleMainOwnerGoogleLogin}
                    disabled={busy}
                    busy={busy}
                    label="Main Owner Sign In with Google"
                    busyLabel="Authenticating Main Owner..."
                    variant="secondary"
                  />
                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#B8923A] shrink-0" />
                    <span>
                      Owner-only controls appear strictly when signed in with the registered Main
                      Owner Gmail.
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleEmployeeLogin} className="space-y-3.5">
                <div>
                  <label htmlFor="loginId" className="block text-xs font-semibold text-slate-700 mb-1">
                    {isMr ? 'तुमचा Login ID किंवा Employee ID' : 'Login ID / Employee ID'}
                  </label>
                  <input
                    id="loginId"
                    type="text"
                    autoComplete="username"
                    placeholder={isMr ? 'उदा. HOM459 किंवा 459' : 'e.g. HOM459 or 459'}
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value.toUpperCase())}
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 font-mono placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    {isMr
                      ? 'टीप: फक्त तुमचा नंबर (उदा. 459 किंवा 0065) टाकला तरी चालेल.'
                      : 'Tip: You can enter either your bare Employee ID (e.g. 459) or full Login ID (HOM459).'}
                  </p>
                </div>

                <div>
                  <label htmlFor="password" className="block text-xs font-semibold text-slate-700 mb-1">
                    {isMr ? 'पासवर्ड (Password)' : 'Password'}
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder={isMr ? 'पासवर्ड टाका' : 'Enter password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full h-11 pl-3.5 pr-11 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-1 top-0.5 h-10 w-10 inline-flex items-center justify-center text-slate-500 hover:text-[#0F1F3D] rounded-lg cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="pt-1">
                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full h-11 px-4 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] active:scale-[0.99] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer"
                  >
                    <span>
                      {busy
                        ? isMr
                          ? 'लॉगिन होत आहे...'
                          : 'Signing in...'
                        : isMr
                          ? 'लॉगिन करा (Sign In)'
                          : 'Sign In'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </form>
            )}
          </div>
        </motion.div>
      </main>
    </div>
  );
}

