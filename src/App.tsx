import React from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginView } from './components/LoginView';
import { AdminShell } from './components/admin/AdminShell';
import { EmployeePortal } from './components/staff/EmployeePortal';
import { StaffAppLoginView } from './components/staff/StaffAppLoginView';
import { AuthProvider, useAuth } from './context/AuthContext';

function AppRouter() {
  const { user, loading, isSuperAdmin, isDedicatedStaffApp, logout } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F7F9] flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="w-6 h-6 border-2 border-[#9F1239] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-medium text-slate-500">
            {isDedicatedStaffApp
              ? 'Loading House of Muktai Staff App...'
              : 'Connecting to House of Muktai Incentive Platform...'}
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return isDedicatedStaffApp ? <StaffAppLoginView /> : <LoginView />;
  }

  if (isSuperAdmin) {
    if (isDedicatedStaffApp) {
      return (
        <div className="min-h-screen bg-[#F6F7F9] flex items-center justify-center p-5">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 text-center space-y-4 shadow-xs">
            <h1 className="text-base font-semibold text-slate-900">
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
                className="w-full sm:w-auto h-11 px-4 rounded-xl bg-[#9F1239] hover:bg-[#881337] text-white text-xs font-semibold cursor-pointer"
              >
                Sign Out for Employee Login
              </button>
              <a
                href="/"
                className="w-full sm:w-auto h-11 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center justify-center"
              >
                Open Admin Panel
              </a>
            </div>
          </div>
        </div>
      );
    }
    return <AdminShell />;
  }

  return <EmployeePortal />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </ErrorBoundary>
  );
}
