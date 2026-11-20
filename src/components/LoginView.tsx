import React, { useState } from 'react';
import { ArrowRight, Building2, Eye, EyeOff, KeyRound, MapPin } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { COMPANY_BRAND } from '../lib/companyBrand';
import { BrandLogo } from './common/BrandLogo';

export function LoginView() {
  const {
    portalMode,
    setPortalMode,
    signInAdminWithGoogle,
    signInEmployeeWithLoginId,
    signInEmployeeWithGoogle,
  } = useAuth();

  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdminGoogleLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInAdminWithGoogle();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to complete Super Admin sign-in.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleEmployeeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId.trim() || !password) {
      setError('Enter both your assigned Login ID and password.');
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
          'Email/Password sign-in is not yet enabled in Firebase Console. Enable Authentication -> Sign-in method -> Email/Password, or use Google Sign-In if linked by Admin.',
        );
      } else if (
        code === 'auth/invalid-credential' ||
        code === 'auth/user-not-found' ||
        code === 'auth/wrong-password'
      ) {
        setError('Invalid Login ID or password. Contact your House of Muktai administrator.');
      } else {
        setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
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

      <header className="w-full border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <BrandLogo size="sm" />
            <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
              {COMPANY_BRAND.brandName}
            </span>
          </div>
          <div className="text-xs text-slate-500 hidden sm:flex items-center gap-2 whitespace-nowrap">
            <span className="font-medium text-slate-700">{COMPANY_BRAND.legalName}</span>
            <span aria-hidden="true">·</span>
            <span>{COMPANY_BRAND.branchCountLabel}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-3.5 sm:p-8">
        <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 items-stretch bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          {/* Left Executive Corporate Panel */}
          <div className="lg:col-span-5 bg-slate-950 text-white p-6 lg:p-8 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#B91C1C] via-[#DC2626] to-[#EA580C]" />

            <div className="space-y-5">
              <div className="flex items-center gap-3.5">
                <BrandLogo size="lg" className="border-white/20 shadow-sm" />
                <div className="min-w-0">
                  <p className="text-lg font-bold tracking-tight text-white">
                    {COMPANY_BRAND.brandName}
                  </p>
                  <p className="text-[11px] font-semibold tracking-wide text-amber-300/95 mt-0.5 leading-snug">
                    {COMPANY_BRAND.legalName}
                  </p>
                </div>
              </div>

              <h1
                className="text-xl lg:text-2xl font-semibold tracking-tight leading-snug text-white"
                style={{ textWrap: 'balance' }}
              >
                Employee Incentive Management System
              </h1>
            </div>

            <div className="mt-6 pt-5 border-t border-slate-800 space-y-2.5 text-[11px] text-slate-400">
              <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                <Building2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span>Registered Office</span>
              </div>
              <div className="flex items-start gap-1.5 leading-relaxed">
                <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                <span>{COMPANY_BRAND.fullAddress}</span>
              </div>
            </div>
          </div>

          {/* Right Auth Form Panel */}
          <div className="lg:col-span-7 p-6 lg:p-8 flex flex-col justify-center bg-white">
            <div className="mb-6">
              <div className="inline-flex p-1 bg-slate-100 border border-slate-200/80 rounded-xl mb-5" role="tablist">
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
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Admin Panel
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
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Employee Portal
                </button>
              </div>

              <h2 className="text-lg font-semibold text-slate-900">
                {portalMode === 'admin' ? 'Super Admin Sign In' : 'Employee Sign In'}
              </h2>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-5 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 leading-snug"
              >
                {error}
              </div>
            )}

            {portalMode === 'admin' ? (
              <div className="space-y-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleAdminGoogleLogin}
                  className="w-full h-11 px-4 rounded-xl bg-[#9F1239] hover:bg-[#881337] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>{busy ? 'Authenticating...' : 'Continue with Google'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <form onSubmit={handleEmployeeLogin} className="space-y-3.5">
                <div>
                  <label htmlFor="loginId" className="block text-xs font-semibold text-slate-700 mb-1">
                    Login ID / Salesman No
                  </label>
                  <input
                    id="loginId"
                    type="text"
                    autoComplete="username"
                    placeholder="e.g. HOM459 or 459"
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value.toUpperCase())}
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 font-mono placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-900/20 focus:border-rose-900"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-xs font-semibold text-slate-700 mb-1">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Enter password"
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

                <div className="pt-1 space-y-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full h-11 px-4 rounded-xl bg-[#9F1239] hover:bg-[#881337] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    <span>{busy ? 'Signing in...' : 'Sign In'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleEmployeeGoogleLogin}
                    className="w-full h-10 px-4 rounded-xl border border-slate-300 bg-slate-50/70 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    Continue with Google
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
