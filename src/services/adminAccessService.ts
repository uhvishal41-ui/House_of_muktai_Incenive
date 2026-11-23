import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as secondarySignOut,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  adminUsernameToAuthEmail,
  auth,
  db,
  getSecondaryProvisioningAuth,
  handleFirestoreError,
  MAIN_OWNER_EMAIL,
  normalizeAdminUsername,
  OperationType,
} from '../lib/firebase';
import type { AdminAccountRecord, AuditLog } from '../types/incentive';

function requireMainOwnerActor(): { uid: string; email: string } {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || user.email?.toLowerCase() !== MAIN_OWNER_EMAIL.toLowerCase()) {
    throw new Error('Only the registered Main Owner Gmail account can manage Admin access.');
  }
  return { uid: user.uid, email: user.email };
}

async function writeGovernanceAudit(params: {
  action: string;
  targetId: string;
  summary: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  const now = new Date().toISOString();
  const logId = `LOG_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`.replace(
    /[^a-zA-Z0-9_-]/g,
    '_',
  );
  const logDoc: AuditLog = {
    logId,
    action: params.action.slice(0, 80),
    actorUid: user.uid,
    actorEmail: (user.email || MAIN_OWNER_EMAIL).slice(0, 180),
    actorRole: 'SUPER_ADMIN',
    targetType: 'ADMIN_ACCOUNT',
    targetId: params.targetId.slice(0, 128),
    summary: params.summary.slice(0, 400),
    createdAt: now,
  };
  try {
    await setDoc(doc(db, 'audit_logs', logId), logDoc);
  } catch {
    // Non-blocking audit write
  }
}

/**
 * Main Owner ONLY: Lists all Admin accounts stored in `/admins`.
 */
export async function listAdminAccounts(): Promise<AdminAccountRecord[]> {
  requireMainOwnerActor();
  try {
    const snap = await getDocs(collection(db, 'admins'));
    return snap.docs
      .map((d) => d.data() as AdminAccountRecord)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'admins');
  }
}

/**
 * Main Owner ONLY: Provisions a new Username + Password Admin account using the isolated
 * secondary Firebase Auth instance (Main Owner session stays signed in uninterrupted).
 */
export async function createPasswordAdminAccount(params: {
  username: string;
  displayName: string;
  initialPassword: string;
}): Promise<AdminAccountRecord> {
  const owner = requireMainOwnerActor();
  const cleanUsername = normalizeAdminUsername(params.username);
  const cleanName = params.displayName.trim().slice(0, 120);
  const password = params.initialPassword.trim();

  if (!/^[A-Z0-9_-]{3,40}$/.test(cleanUsername)) {
    throw new Error(
      'Admin Username must be 3–40 characters using letters, numbers, hyphens (-), or underscores (_).',
    );
  }
  if (cleanName.length < 2) {
    throw new Error('Enter a valid Admin Display Name (minimum 2 characters).');
  }
  if (password.length < 8) {
    throw new Error('Initial Password must be at least 8 characters long.');
  }

  const authEmail = adminUsernameToAuthEmail(cleanUsername);
  const secondaryAuth = getSecondaryProvisioningAuth();
  let uid = '';

  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, password);
    uid = cred.user.uid;
    await secondarySignOut(secondaryAuth).catch(() => undefined);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/operation-not-allowed') {
      throw new Error(
        'Email/Password sign-in is disabled in Firebase Console. Enable Authentication -> Sign-in method -> Email/Password first.',
      );
    }
    if (code === 'auth/email-already-in-use') {
      // If this exact username+password was already provisioned earlier, recover its UID cleanly
      try {
        const recovered = await signInWithEmailAndPassword(secondaryAuth, authEmail, password);
        uid = recovered.user.uid;
        await secondarySignOut(secondaryAuth).catch(() => undefined);
      } catch {
        throw new Error(
          `Admin Username "${cleanUsername}" is already registered with a different password. Choose a new username (e.g., ${cleanUsername}2) or sign in with the existing password.`,
        );
      }
    } else {
      throw new Error(
        err instanceof Error ? err.message : 'Unable to create Admin login credentials.',
      );
    }
  }

  const now = new Date().toISOString();
  const record: AdminAccountRecord = {
    uid,
    username: cleanUsername,
    email: authEmail,
    displayName: cleanName,
    role: 'SUPER_ADMIN',
    authType: 'PASSWORD',
    active: true,
    mustChangePassword: true,
    createdByEmail: owner.email.slice(0, 180),
    createdAt: now,
    updatedAt: now,
  };

  try {
    await setDoc(doc(db, 'admins', uid), record);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `admins/${uid}`);
  }

  await writeGovernanceAudit({
    action: 'OWNER_CREATED_ADMIN_ACCOUNT',
    targetId: uid,
    summary: `Main Owner provisioned Password Admin "${cleanUsername}" (${cleanName}).`,
  });

  return record;
}

/**
 * Main Owner ONLY: Instantly activates or suspends an Admin account.
 * Suspending revokes all Firestore and backend access immediately.
 */
export async function toggleAdminAccountStatus(
  admin: AdminAccountRecord,
  nextActive: boolean,
): Promise<void> {
  requireMainOwnerActor();
  const now = new Date().toISOString();
  try {
    await updateDoc(doc(db, 'admins', admin.uid), {
      active: nextActive,
      updatedAt: now,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `admins/${admin.uid}`);
  }

  await writeGovernanceAudit({
    action: nextActive ? 'OWNER_REACTIVATED_ADMIN' : 'OWNER_SUSPENDED_ADMIN',
    targetId: admin.uid,
    summary: `Main Owner ${nextActive ? 'reactivated' : 'suspended'} Admin "${admin.username || admin.email}" (${admin.displayName}).`,
  });
}

/**
 * Main Owner ONLY: Permanently deletes an Admin's `/admins/{uid}` authorization record.
 */
export async function deleteAdminAccountRecord(admin: AdminAccountRecord): Promise<void> {
  requireMainOwnerActor();
  try {
    await deleteDoc(doc(db, 'admins', admin.uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `admins/${admin.uid}`);
  }

  await writeGovernanceAudit({
    action: 'OWNER_REMOVED_ADMIN_ACCOUNT',
    targetId: admin.uid,
    summary: `Main Owner removed Admin authorization record for "${admin.username || admin.email}" (${admin.displayName}).`,
  });
}

/**
 * Active Password Admin ONLY: Records self-service password change timestamp in `/admins/{uid}`.
 */
export async function markOwnAdminPasswordChanged(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required.');
  const now = new Date().toISOString();
  try {
    await updateDoc(doc(db, 'admins', user.uid), {
      mustChangePassword: false,
      passwordUpdatedAt: now,
      updatedAt: now,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `admins/${user.uid}`);
  }

  await writeGovernanceAudit({
    action: 'ADMIN_PASSWORD_CHANGED',
    targetId: user.uid,
    summary: `Admin (${user.email || user.uid}) changed their own login password.`,
  });

  return now;
}
