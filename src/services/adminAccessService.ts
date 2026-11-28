import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as secondarySignOut,
  updatePassword,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  adminUsernameToAuthEmail,
  adminUsernameToRotatedAuthEmail,
  auth,
  db,
  DEFAULT_ADMIN_INITIAL_PASSWORD,
  extractAuthEmailRotationIndex,
  getSecondaryProvisioningAuth,
  handleFirestoreError,
  MAIN_OWNER_EMAIL,
  MAX_AUTH_ROTATION_SLOTS,
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

  if (!/^[a-zA-Z0-9_-]{3,40}$/.test(cleanUsername)) {
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

/**
 * Main Owner ONLY: Sets or resets any Password Admin's login password while keeping
 * their exact Username unchanged and revoking the old credential atomically.
 * - Never stores plaintext passwords in Firestore or Audit Logs.
 * - Uses isolated secondary Firebase Auth instance so Main Owner's Google session stays intact.
 */
export async function ownerSetAdminPassword(params: {
  admin: AdminAccountRecord;
  newPassword: string;
  mustChangePassword?: boolean;
}): Promise<AdminAccountRecord> {
  const owner = requireMainOwnerActor();
  const { admin } = params;
  const cleanPassword = params.newPassword.trim();
  const requireChange = Boolean(params.mustChangePassword);

  if (cleanPassword.length < 8) {
    throw new Error('New password must be at least 8 characters long.');
  }
  if (admin.authType !== 'PASSWORD' && !admin.username) {
    throw new Error('Only Username + Password Admin accounts support password setting. Google Admin accounts are managed by Google.');
  }

  const username = normalizeAdminUsername(
    admin.username || admin.email.split('@')[0].replace(/__r\d+$/i, ''),
  );
  if (!/^[a-zA-Z0-9_-]{3,40}$/.test(username)) {
    throw new Error('Invalid Admin Username on account record.');
  }

  const secondaryAuth = getSecondaryProvisioningAuth();
  const now = new Date().toISOString();

  // Path 1: Fast in-place password update if the Admin still has the default initial password
  try {
    const existingCred = await signInWithEmailAndPassword(
      secondaryAuth,
      admin.email,
      DEFAULT_ADMIN_INITIAL_PASSWORD,
    );
    if (cleanPassword !== DEFAULT_ADMIN_INITIAL_PASSWORD) {
      await updatePassword(existingCred.user, cleanPassword);
    }
    await secondarySignOut(secondaryAuth).catch(() => undefined);

    try {
      await updateDoc(doc(db, 'admins', admin.uid), {
        mustChangePassword: requireChange,
        passwordUpdatedAt: now,
        updatedAt: now,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `admins/${admin.uid}`);
    }

    await writeGovernanceAudit({
      action: 'OWNER_SET_ADMIN_PASSWORD',
      targetId: admin.uid,
      summary: `Main Owner set password for Admin "${username}" (${admin.displayName}).`,
    });

    return {
      ...admin,
      mustChangePassword: requireChange,
      passwordUpdatedAt: now,
      updatedAt: now,
    };
  } catch {
    await secondarySignOut(secondaryAuth).catch(() => undefined);
  }

  // Path 2: Atomic credential rotation preserving exact same visible Admin Username
  const currentSlot = extractAuthEmailRotationIndex(admin.email, '__r');
  let newUid = '';
  let newAuthEmail = '';

  const candidateSlots: number[] = [];
  for (let slot = currentSlot + 1; slot <= MAX_AUTH_ROTATION_SLOTS; slot += 1) {
    candidateSlots.push(slot);
  }
  for (let slot = 1; slot < currentSlot; slot += 1) {
    candidateSlots.push(slot);
  }

  for (const slot of candidateSlots) {
    const candidateEmail = adminUsernameToRotatedAuthEmail(username, slot);
    try {
      const cred = await createUserWithEmailAndPassword(
        secondaryAuth,
        candidateEmail,
        cleanPassword,
      );
      newUid = cred.user.uid;
      newAuthEmail = candidateEmail;
      await secondarySignOut(secondaryAuth).catch(() => undefined);
      break;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed') {
        throw new Error(
          'Email/Password sign-in is disabled in Firebase Console. Enable Authentication -> Sign-in method -> Email/Password first.',
        );
      }
      if (code === 'auth/email-already-in-use') {
        // If this rotation slot already exists with the exact target password (re-using a previous password), reuse safely
        try {
          const recovered = await signInWithEmailAndPassword(
            secondaryAuth,
            candidateEmail,
            cleanPassword,
          );
          if (recovered.user.uid !== admin.uid) {
            newUid = recovered.user.uid;
            newAuthEmail = candidateEmail;
            await secondarySignOut(secondaryAuth).catch(() => undefined);
            break;
          }
          await secondarySignOut(secondaryAuth).catch(() => undefined);
        } catch {
          await secondarySignOut(secondaryAuth).catch(() => undefined);
        }
        continue;
      }
      throw new Error(
        err instanceof Error ? err.message : 'Unable to set Admin password right now.',
      );
    }
  }

  if (!newUid || !newAuthEmail) {
    throw new Error(
      `Maximum password rotation slots (${MAX_AUTH_ROTATION_SLOTS}) reached for "${username}". Delete this Admin row and create a fresh Admin Username instead.`,
    );
  }

  const nextRecord: AdminAccountRecord = {
    uid: newUid,
    username,
    email: newAuthEmail,
    displayName: admin.displayName,
    role: 'SUPER_ADMIN',
    authType: 'PASSWORD',
    ...(admin.branchId ? { branchId: admin.branchId } : {}),
    active: admin.active,
    mustChangePassword: requireChange,
    passwordUpdatedAt: now,
    createdByEmail: admin.createdByEmail || owner.email.slice(0, 180),
    createdAt: admin.createdAt || now,
    updatedAt: now,
  };

  try {
    const wb = writeBatch(db);
    wb.set(doc(db, 'admins', newUid), nextRecord);
    if (newUid !== admin.uid) {
      wb.delete(doc(db, 'admins', admin.uid));
    }
    await wb.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `admins/${newUid}`);
  }

  await writeGovernanceAudit({
    action: 'OWNER_SET_ADMIN_PASSWORD',
    targetId: newUid,
    summary: `Main Owner set a new password for Admin "${username}" (${admin.displayName}) and revoked previous credential immediately.`,
  });

  return nextRecord;
}

