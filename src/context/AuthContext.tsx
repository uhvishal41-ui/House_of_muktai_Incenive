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
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import {
  adminUsernameToAuthEmail,
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  googleProvider,
  isAdminAuthEmail,
  loginIdToAuthEmail,
} from '../lib/firebase';
import { markOwnAdminPasswordChanged } from '../services/adminAccessService';
import {
  fetchOwnEmployeeProfile,
  subscribeOwnEmployeeProfile,
} from '../services/incentiveService';
import type { AdminAccountRecord, Employee } from '../types/incentive';
import { canEmployeeLogin, type EmployeeLoginGateResult } from '../lib/incentiveEngine';

export type PortalMode = 'admin' | 'staff';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** Strictly true ONLY when signed in with the verified registered Main Owner Gmail */
  isMainOwner: boolean;
  /** True for Main Owner OR any Active Owner-provisioned Admin (operational Admin Panel access) */
  isSuperAdmin: boolean;
  /** Live `/admins/{uid}` record for Password/delegated Admins (null for Main Owner) */
  adminAccount: AdminAccountRecord | null;
  /** Set if a suspended/revoked Password Admin attempts to sign in */
  adminAccessBlockedReason: string | null;
  isDedicatedStaffApp: boolean;
  employeeProfile: Employee | null;
  employeeLoginGate: EmployeeLoginGateResult;
  portalMode: PortalMode;
  setPortalMode: (mode: PortalMode) => void;
  signInAdminWithGoogle: () => Promise<void>;
  signInAdminWithCredentials: (username: string, password: string) => Promise<void>;
  signInEmployeeWithLoginId: (loginId: string, password: string) => Promise<void>;
  signInEmployeeWithGoogle: () => Promise<void>;
  changeOwnPassword: (newPassword: string, fallbackCurrentPassword?: string) => Promise<void>;
  changeAdminOwnPassword: (currentPassword: string, newPassword: string) => Promise<void>;
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
  return 'staff';
}

function isVerifiedMainOwnerUser(currentUser: User): boolean {
  return (
    currentUser.emailVerified === true &&
    currentUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()
  );
}

/**
 * Resolves exact Admin governance tier matching `firestore.rules` & Express `authMiddleware`:
 * 1. Main Owner: Verified registered Owner Gmail (`uhvishal41@gmail.com`) -> isMainOwner=true, isSuperAdmin=true
 * 2. Active Password Admin: `@admin.homfash.internal` + `/admins/{uid}` active=true & authType='PASSWORD' -> isMainOwner=false, isSuperAdmin=true
 * 3. Active Verified Google Admin: verified email + `/admins/{uid}` active=true -> isMainOwner=false, isSuperAdmin=true
 */
async function resolveAdminAccess(currentUser: User): Promise<{
  isMainOwner: boolean;
  isSuperAdmin: boolean;
  adminAccount: AdminAccountRecord | null;
  blockedReason: string | null;
}> {
  if (isVerifiedMainOwnerUser(currentUser)) {
    return {
      isMainOwner: true,
      isSuperAdmin: true,
      adminAccount: null,
      blockedReason: null,
    };
  }

  const isPasswordAdminDomain = isAdminAuthEmail(currentUser.email);
  if (!isPasswordAdminDomain && !currentUser.emailVerified) {
    return {
      isMainOwner: false,
      isSuperAdmin: false,
      adminAccount: null,
      blockedReason: null,
    };
  }

  try {
    const snap = await getDoc(doc(db, 'admins', currentUser.uid));
    if (!snap.exists()) {
      return {
        isMainOwner: false,
        isSuperAdmin: false,
        adminAccount: null,
        blockedReason: isPasswordAdminDomain
          ? 'This Admin account is not authorized or has been removed by the Main Owner.'
          : null,
      };
    }
    const data = snap.data() as AdminAccountRecord;
    const isPasswordAuthorized =
      isPasswordAdminDomain &&
      data.role === 'SUPER_ADMIN' &&
      data.active === true &&
      data.authType === 'PASSWORD';
    const isGoogleAuthorized =
      !isPasswordAdminDomain &&
      currentUser.emailVerified === true &&
      data.role === 'SUPER_ADMIN' &&
      data.active === true;

    if (isPasswordAuthorized || isGoogleAuthorized) {
      return {
        isMainOwner: false,
        isSuperAdmin: true,
        adminAccount: data,
        blockedReason: null,
      };
    }

    return {
      isMainOwner: false,
      isSuperAdmin: false,
      adminAccount: null,
      blockedReason: isPasswordAdminDomain
        ? 'This Admin account has been suspended by the Main Owner.'
        : null,
    };
  } catch {
    return {
      isMainOwner: false,
      isSuperAdmin: false,
      adminAccount: null,
      blockedReason: isPasswordAdminDomain
        ? 'Unable to verify Admin authorization. Please contact the Main Owner.'
        : null,
    };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMainOwner, setIsMainOwner] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [adminAccount, setAdminAccount] = useState<AdminAccountRecord | null>(null);
  const [adminAccessBlockedReason, setAdminAccessBlockedReason] = useState<string | null>(null);
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
        const access = await resolveAdminAccess(nextUser);
        setIsMainOwner(access.isMainOwner);
        setIsSuperAdmin(access.isSuperAdmin);
        setAdminAccount(access.adminAccount);
        setAdminAccessBlockedReason(access.blockedReason);

        if (access.blockedReason) {
          // Immediately revoke suspended/removed Admin sessions
          setEmployeeProfile(null);
          await signOut(auth).catch(() => undefined);
        } else if (!access.isSuperAdmin) {
          await loadProfile(nextUser);
          setPortalMode('staff');
        } else {
          setEmployeeProfile(null);
        }
      } else {
        setIsMainOwner(false);
        setIsSuperAdmin(false);
        setAdminAccount(null);
        setEmployeeProfile(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Real-time revocation listener for non-Owner Admins:
  // If Main Owner suspends or deletes an Admin account while they are logged in, revoke immediately.
  useEffect(() => {
    if (!user || !isSuperAdmin || isMainOwner) return;
    const unsub = onSnapshot(
      doc(db, 'admins', user.uid),
      (snap) => {
        if (!snap.exists()) {
          setAdminAccessBlockedReason('Your Admin access was removed by the Main Owner.');
          setIsSuperAdmin(false);
          setAdminAccount(null);
          void signOut(auth).catch(() => undefined);
          return;
        }
        const live = snap.data() as AdminAccountRecord;
        if (!live.active || live.role !== 'SUPER_ADMIN') {
          setAdminAccessBlockedReason('Your Admin account was suspended by the Main Owner.');
          setIsSuperAdmin(false);
          setAdminAccount(null);
          void signOut(auth).catch(() => undefined);
          return;
        }
        setAdminAccount(live);
      },
      () => {
        // Ignore transient snapshot errors
      },
    );
    return () => unsub();
  }, [user, isSuperAdmin, isMainOwner]);

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
    setAdminAccessBlockedReason(null);
    await signInWithPopup(auth, googleProvider);
  };

  const signInAdminWithCredentials = async (username: string, password: string) => {
    setAdminAccessBlockedReason(null);
    const trimmed = username.trim();
    if (!trimmed || !password) {
      throw new Error('Enter both Admin Username and Password.');
    }
    const authEmail = adminUsernameToAuthEmail(trimmed);
    const cred = await signInWithEmailAndPassword(auth, authEmail, password);
    const access = await resolveAdminAccess(cred.user);
    if (!access.isSuperAdmin) {
      await signOut(auth).catch(() => undefined);
      throw new Error(
        access.blockedReason ||
          'This Admin account is suspended or not active. Contact the Main Owner.',
      );
    }
  };

  const signInEmployeeWithGoogle = async () => {
    setAdminAccessBlockedReason(null);
    await signInWithPopup(auth, googleProvider);
  };

  const signInEmployeeWithLoginId = async (loginId: string, password: string) => {
    setAdminAccessBlockedReason(null);
    const trimmed = loginId.trim();
    const authEmail = loginIdToAuthEmail(trimmed);
    try {
      await signInWithEmailAndPassword(auth, authEmail, password);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      const cleanUpper = trimmed.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      // Convenience fallback: if staff typed bare Employee ID (e.g. "459"), also try "HOM459"
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

  const changeAdminOwnPassword = async (currentPassword: string, newPassword: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.email) {
      throw new Error('Admin session expired. Please sign in again.');
    }
    if (!isAdminAuthEmail(currentUser.email)) {
      throw new Error('Password changes apply to Username/Password Admin accounts.');
    }
    if (!currentPassword) {
      throw new Error('Enter your current password to verify your identity.');
    }
    if (newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters long.');
    }
    if (newPassword === currentPassword) {
      throw new Error('New password must be different from your current password.');
    }

    const cred = EmailAuthProvider.credential(currentUser.email, currentPassword);
    await reauthenticateWithCredential(currentUser, cred);
    await updatePassword(currentUser, newPassword);
    const updatedAt = await markOwnAdminPasswordChanged();
    setAdminAccount((prev) =>
      prev
        ? { ...prev, mustChangePassword: false, passwordUpdatedAt: updatedAt, updatedAt }
        : prev,
    );
  };

  const logout = async () => {
    setAdminAccessBlockedReason(null);
    await signOut(auth);
    setIsMainOwner(false);
    setIsSuperAdmin(false);
    setAdminAccount(null);
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
        isMainOwner,
        isSuperAdmin,
        adminAccount,
        adminAccessBlockedReason,
        isDedicatedStaffApp,
        employeeProfile,
        employeeLoginGate,
        portalMode,
        setPortalMode,
        signInAdminWithGoogle,
        signInAdminWithCredentials,
        signInEmployeeWithLoginId,
        signInEmployeeWithGoogle,
        changeOwnPassword,
        changeAdminOwnPassword,
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
