import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  googleProvider,
  loginIdToAuthEmail,
} from '../lib/firebase';
import {
  fetchOwnEmployeeProfile,
  subscribeOwnEmployeeProfile,
} from '../services/incentiveService';
import type { Employee } from '../types/incentive';
import { canEmployeeLogin, type EmployeeLoginGateResult } from '../lib/incentiveEngine';

export type PortalMode = 'admin' | 'staff';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isSuperAdmin: boolean;
  isDedicatedStaffApp: boolean;
  employeeProfile: Employee | null;
  employeeLoginGate: EmployeeLoginGateResult;
  portalMode: PortalMode;
  setPortalMode: (mode: PortalMode) => void;
  signInAdminWithGoogle: () => Promise<void>;
  signInEmployeeWithLoginId: (loginId: string, password: string) => Promise<void>;
  signInEmployeeWithGoogle: () => Promise<void>;
  changeOwnPassword: (newPassword: string, fallbackCurrentPassword?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshEmployeeProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function detectDedicatedStaffApp(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  const pathname = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  return (
    host.startsWith('staff.') ||
    pathname === '/staff' ||
    pathname.startsWith('/staff/') ||
    params.get('portal') === 'staff' ||
    hash === '#staff' ||
    hash.startsWith('#/staff')
  );
}

function detectInitialPortalMode(): PortalMode {
  if (detectDedicatedStaffApp()) return 'staff';
  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase();
    if (host.startsWith('admin.')) return 'admin';
  }
  return 'admin';
}

/**
 * Consistent Super Admin check matching firestore.rules `isSuperAdmin()` and Express `authMiddleware`:
 * - Verified bootstrapped primary Super Admin (`uhvishal41@gmail.com`)
 * - OR active `/admins/{uid}` document with `role === 'SUPER_ADMIN'` and `emailVerified === true`
 */
async function resolveIsSuperAdmin(currentUser: User): Promise<boolean> {
  if (!currentUser.emailVerified) return false;
  if (currentUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) {
    return true;
  }
  try {
    const snap = await getDoc(doc(db, 'admins', currentUser.uid));
    if (!snap.exists()) return false;
    const data = snap.data() as { role?: string; active?: boolean };
    return data.role === 'SUPER_ADMIN' && data.active === true;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isDedicatedStaffApp] = useState<boolean>(detectDedicatedStaffApp);
  const [employeeProfile, setEmployeeProfile] = useState<Employee | null>(null);
  const [portalMode, setPortalMode] = useState<PortalMode>(detectInitialPortalMode);

  // When running as the dedicated Staff Mobile App (/staff or staff.<domain>),
  // link the standalone Staff PWA manifest & app title so Home Screen installs launch directly into Staff App.
  useEffect(() => {
    if (!isDedicatedStaffApp || typeof document === 'undefined') return;
    document.title = 'House of Muktai — Staff Incentive App';
    let manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!manifestLink) {
      manifestLink = document.createElement('link');
      manifestLink.rel = 'manifest';
      document.head.appendChild(manifestLink);
    }
    manifestLink.href = '/staff-manifest.webmanifest';
    const appleTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) {
      appleTitle.content = 'Muktai Staff';
    }
  }, [isDedicatedStaffApp]);

  const loadProfile = async (currentUser: User | null) => {
    if (!currentUser) {
      setEmployeeProfile(null);
      return;
    }
    try {
      const emp = await fetchOwnEmployeeProfile();
      setEmployeeProfile(emp);
    } catch {
      setEmployeeProfile(null);
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setLoading(true);
      setUser(nextUser);
      if (nextUser) {
        const adminAuthorized = await resolveIsSuperAdmin(nextUser);
        setIsSuperAdmin(adminAuthorized);
        if (!adminAuthorized) {
          await loadProfile(nextUser);
          setPortalMode('staff');
        } else {
          setEmployeeProfile(null);
        }
      } else {
        setIsSuperAdmin(false);
        setEmployeeProfile(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Live Firestore real-time subscription to the employee's own master record
  // so Admin status changes (ACTIVE/INACTIVE), branch transfers, or password flags sync immediately.
  const activeEmployeeId = !isSuperAdmin ? employeeProfile?.employeeId || null : null;
  useEffect(() => {
    if (!user || !activeEmployeeId) return;
    const unsub = subscribeOwnEmployeeProfile(activeEmployeeId, (liveEmp) => {
      setEmployeeProfile(liveEmp);
    });
    return () => unsub();
  }, [user, activeEmployeeId]);

  const signInAdminWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const signInEmployeeWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const signInEmployeeWithLoginId = async (loginId: string, password: string) => {
    const trimmed = loginId.trim();
    const authEmail = loginIdToAuthEmail(trimmed);
    try {
      await signInWithEmailAndPassword(auth, authEmail, password);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      const cleanUpper = trimmed.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      // Convenience fallback: if staff typed bare Salesman No (e.g. "459"), also try "HOM459"
      if (
        (code === 'auth/invalid-credential' || code === 'auth/user-not-found') &&
        cleanUpper &&
        !cleanUpper.startsWith('HOM')
      ) {
        await signInWithEmailAndPassword(auth, loginIdToAuthEmail(`HOM${cleanUpper}`), password);
        return;
      }
      throw err;
    }
  };

  const changeOwnPassword = async (newPassword: string, fallbackCurrentPassword?: string) => {
    if (!auth.currentUser) throw new Error('Not signed in.');
    try {
      await updatePassword(auth.currentUser, newPassword);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (
        code === 'auth/requires-recent-login' &&
        fallbackCurrentPassword &&
        auth.currentUser.email
      ) {
        const cred = EmailAuthProvider.credential(auth.currentUser.email, fallbackCurrentPassword);
        await reauthenticateWithCredential(auth.currentUser, cred);
        await updatePassword(auth.currentUser, newPassword);
        return;
      }
      throw err;
    }
  };

  const logout = async () => {
    await signOut(auth);
    setIsSuperAdmin(false);
    setEmployeeProfile(null);
  };

  const refreshEmployeeProfile = async () => {
    await loadProfile(auth.currentUser);
  };

  const employeeLoginGate = canEmployeeLogin(employeeProfile);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isSuperAdmin,
        isDedicatedStaffApp,
        employeeProfile,
        employeeLoginGate,
        portalMode,
        setPortalMode,
        signInAdminWithGoogle,
        signInEmployeeWithLoginId,
        signInEmployeeWithGoogle,
        changeOwnPassword,
        logout,
        refreshEmployeeProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
