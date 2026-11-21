import React, { Suspense, lazy, useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BrandSplashScreen } from './components/common/MotionPrimitives';
import { AuthProvider, useAuth } from './context/AuthContext';

const LoginView = lazy(() =>
  import('./components/LoginView').then((m) => ({ default: m.LoginView })),
);
const StaffAppLoginView = lazy(() =>
  import('./components/staff/StaffAppLoginView').then((m) => ({ default: m.StaffAppLoginView })),
);
const AdminShell = lazy(() =>
  import('./components/admin/AdminShell').then((m) => ({ default: m.AdminShell })),
);
const EmployeePortal = lazy(() =>
  import('./components/staff/EmployeePortal').then((m) => ({ default: m.EmployeePortal })),
);

function AppRouter() {
  const { user, loading, isSuperAdmin, isDedicatedStaffApp, logout } = useAuth();
  const [introSplashDone, setIntroSplashDone] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('hom_splash_shown') === '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (introSplashDone) return;
    const timer = window.setTimeout(() => {
      setIntroSplashDone(true);
      try {
        sessionStorage.setItem('hom_splash_shown', '1');
      } catch {
        // ignore storage restrictions
      }
    }, 620);
    return () => window.clearTimeout(timer);
  }, [introSplashDone]);

  const splashSubtitle = isDedicatedStaffApp
    ? 'Official Employee Incentive Mobile App'
    : 'Employee Incentive Management System';

  if (loading || !introSplashDone) {
    return <BrandSplashScreen subtitle={splashSubtitle} />;
  }

  if (!user) {
    return (
      <Suspense fallback={<BrandSplashScreen subtitle={splashSubtitle} />}>
        {isDedicatedStaffApp ? <StaffAppLoginView /> : <LoginView />}
      </Suspense>
    );
  }

  if (isSuperAdmin) {
    if (isDedicatedStaffApp) {
      return (
        <div className="min-h-screen bg-[#F5F7FA] flex items-center justify-center p-5">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="h-1 w-full bg-gradient-to-r from-[#0F1F3D] via-[#1E3A5F] to-[#B8923A]" />
            <div className="p-6 text-center space-y-4">
              <h1 className="text-base font-semibold text-[#0F1F3D]">
                House of Muktai Staff App
              </h1>
              <p className="text-xs text-slate-600 leading-relaxed">
                You are currently signed in as Super Admin (
                <span className="font-mono text-slate-800">{user.email}</span>). Sign out to sign in
                with an employee Login ID, or switch to the Super Admin Panel.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={logout}
                  className="w-full sm:w-auto h-11 px-4 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold cursor-pointer transition-colors"
                >
                  Sign Out for Employee Login
                </button>
                <a
                  href="/"
                  className="w-full sm:w-auto h-11 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center justify-center transition-colors"
                >
                  Open Admin Panel
                </a>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <Suspense fallback={<BrandSplashScreen subtitle="Loading Admin Console..." />}>
        <AdminShell />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<BrandSplashScreen subtitle="Loading Employee Dashboard..." />}>
      <EmployeePortal />
    </Suspense>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ErrorBoundary>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </ErrorBoundary>
    </MotionConfig>
  );
}
