import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  browserPopupRedirectResolver,
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
  adminUsernameToRotatedAuthEmail,
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  employeeLoginIdToRotatedAuthEmail,
  googleProvider,
  isAdminAuthEmail,
  loginIdToAuthEmail,
  MAX_AUTH_ROTATION_SLOTS,
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
    await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
  };

  const signInAdminWithCredentials = async (username: string, password: string) => {
    setAdminAccessBlockedReason(null);
    const trimmed = username.trim();
    if (!trimmed || !password) {
      throw new Error('Enter both Admin Username and Password.');
    }

    // Check primary email first, then any Owner-rotated slots (__r2..__r8) so Admin always uses the exact same Username
    const candidateEmails: string[] = [adminUsernameToAuthEmail(trimmed)];
    for (let slot = 2; slot <= MAX_AUTH_ROTATION_SLOTS; slot += 1) {
      candidateEmails.push(adminUsernameToRotatedAuthEmail(trimmed, slot));
    }

    let firstError: unknown = null;
    let lastBlockedReason: string | null = null;

    for (let i = 0; i < candidateEmails.length; i += 1) {
      const candidateEmail = candidateEmails[i];
      try {
        const cred = await signInWithEmailAndPassword(auth, candidateEmail, password);
        const access = await resolveAdminAccess(cred.user);
        if (access.isSuperAdmin) {
          return;
        }
        // Signed into an old revoked/suspended rotation slot: sign out and check if a newer active slot matches
        lastBlockedReason = access.blockedReason;
        await signOut(auth).catch(() => undefined);
      } catch (err: unknown) {
        if (i === 0) firstError = err;
        const code = (err as { code?: string })?.code || '';
        const canRetryNext =
          code === 'auth/invalid-credential' || code === 'auth/user-not-found';
        if (!canRetryNext) {
          throw err;
        }
      }
    }

    if (lastBlockedReason) {
      throw new Error(lastBlockedReason);
    }
    throw (
      firstError ||
      new Error('Invalid Admin Username or Password. Please check with the Main Owner.')
    );
  };

  const signInEmployeeWithGoogle = async () => {
    setAdminAccessBlockedReason(null);
    await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
  };

  const signInEmployeeWithLoginId = async (loginId: string, password: string) => {
    setAdminAccessBlockedReason(null);
    const trimmed = loginId.trim();
    const cleanUpper = trimmed.toUpperCase().replace(/[^A-Z0-9_-]/g, '');

    // Build ordered candidate Login IDs:
    // 1. Exact typed ID & canonical HOM-prefixed ID
    // 2. Owner-rotated auth email slots (__p2..__p8) keeping exact visible Login ID unchanged
    // 3. Legacy auto-reissued Login IDs (HOM0065A, HOM0065B, HOM0065_R1)
    const candidateEmails: string[] = [];
    const pushEmailUnique = (email: string) => {
      const norm = email.trim().toLowerCase();
      if (norm && !candidateEmails.includes(norm)) {
        candidateEmails.push(norm);
      }
    };

    const baseIds: string[] = [];
    const pushBaseId = (id: string) => {
      if (id && !baseIds.includes(id)) baseIds.push(id);
    };
    pushBaseId(trimmed);
    if (cleanUpper) {
      pushBaseId(cleanUpper);
      const homBase = cleanUpper.startsWith('HOM') ? cleanUpper : `HOM${cleanUpper}`;
      pushBaseId(homBase);
      if (!/[A-Z]$/.test(homBase) && !/_R\d+$/.test(homBase)) {
        pushBaseId(`${homBase}A`);
        pushBaseId(`${homBase}B`);
        pushBaseId(`${homBase}_R1`);
      }
    }

    // First try slot 1 for all base IDs (fastest path for standard logins)
    for (const id of baseIds) {
      pushEmailUnique(loginIdToAuthEmail(id));
    }
    // Next try Owner-rotated password slots (__p2..__p8) for the primary typed/HOM IDs
    const primaryIdsForRotation = baseIds.slice(0, 3);
    for (let slot = 2; slot <= MAX_AUTH_ROTATION_SLOTS; slot += 1) {
      for (const id of primaryIdsForRotation) {
        pushEmailUnique(employeeLoginIdToRotatedAuthEmail(id, slot));
      }
    }

    let firstError: unknown = null;
    for (let i = 0; i < candidateEmails.length; i += 1) {
      const candidateEmail = candidateEmails[i];
      try {
        await signInWithEmailAndPassword(auth, candidateEmail, password);
        // Verify this signed-in UID maps to an active/current employee record (skip stale rotated slots)
        const matchedProfile = await fetchOwnEmployeeProfile();
        if (matchedProfile) {
          return;
        }
        // Signed into an old revoked password slot whose authUid was rotated away -> sign out and check newer slots
        await signOut(auth).catch(() => undefined);
      } catch (err: unknown) {
        if (i === 0) firstError = err;
        const code = (err as { code?: string })?.code || '';
        const canRetryNext =
          code === 'auth/invalid-credential' || code === 'auth/user-not-found';
        if (!canRetryNext) {
          throw err;
        }
      }
    }
    throw firstError || new Error('Invalid Login ID or password.');
  };

  const changeOwnPassword = async (newPassword: string, fallbackCurrentPassword?: string) => {
    if (!auth.currentUser) throw new Error('Not signed in.');
    try {
      await updatePassword(auth.currentUser, newPassword);
      await auth.currentUser.getIdToken(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
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
        await auth.currentUser.getIdToken(true);
        await new Promise((resolve) => setTimeout(resolve, 300));
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
    await currentUser.getIdToken(true);
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
