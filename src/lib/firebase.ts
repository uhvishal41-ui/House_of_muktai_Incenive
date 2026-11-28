import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function getSecondaryProvisioningAuth() {
  const secondaryName = 'employee-provisioning-app';
  const existingApp = getApps().find((a) => a.name === secondaryName);
  const secondaryApp = existingApp || initializeApp(firebaseConfig, secondaryName);
  return getAuth(secondaryApp);
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();

export const INTERNAL_AUTH_DOMAIN = 'auth.homfash.internal';
export const ADMIN_AUTH_DOMAIN = 'admin.homfash.internal';
export const BOOTSTRAPPED_ADMIN_EMAIL = 'uhvishal41@gmail.com';
export const MAIN_OWNER_EMAIL = BOOTSTRAPPED_ADMIN_EMAIL;
export const DEFAULT_ADMIN_USERNAME = 'HOMADMIN';
export const DEFAULT_ADMIN_INITIAL_PASSWORD = 'MuktaiAdmin@2026';

export function loginIdToAuthEmail(loginId: string): string {
  const normalized = loginId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return `${normalized}@${INTERNAL_AUTH_DOMAIN}`;
}

export function normalizeAdminUsername(username: string): string {
  return username.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
}

export function adminUsernameToAuthEmail(username: string): string {
  const normalized = normalizeAdminUsername(username).toLowerCase();
  return `${normalized}@${ADMIN_AUTH_DOMAIN}`;
}

export function isAdminAuthEmail(email?: string | null): boolean {
  return Boolean(email && email.trim().toLowerCase().endsWith(`@${ADMIN_AUTH_DOMAIN}`));
}

export const MAX_AUTH_ROTATION_SLOTS = 8;

/**
 * Maps an Admin username + rotation slot (1 = primary, 2..N = rotated) to its internal Firebase Auth email.
 * Keeps the visible Admin username completely unchanged across Owner-initiated password resets.
 */
export function adminUsernameToRotatedAuthEmail(username: string, rotationIndex: number): string {
  const normalized = normalizeAdminUsername(username).toLowerCase();
  const base = normalized.replace(/__r\d+$/i, '');
  if (rotationIndex <= 1) {
    return `${base}@${ADMIN_AUTH_DOMAIN}`;
  }
  return `${base}__r${rotationIndex}@${ADMIN_AUTH_DOMAIN}`;
}

/**
 * Maps an Employee Login ID + rotation slot (1 = primary, 2..N = rotated) to its internal Firebase Auth email.
 * Keeps the visible Employee Login ID completely unchanged across Owner-initiated password resets.
 */
export function employeeLoginIdToRotatedAuthEmail(loginId: string, rotationIndex: number): string {
  const normalized = loginId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const base = normalized.replace(/__p\d+$/i, '');
  if (rotationIndex <= 1) {
    return `${base}@${INTERNAL_AUTH_DOMAIN}`;
  }
  return `${base}__p${rotationIndex}@${INTERNAL_AUTH_DOMAIN}`;
}

/**
 * Reads the current rotation index (1 for base email, 2+ for rotated email) from an internal auth email.
 */
export function extractAuthEmailRotationIndex(
  email: string | undefined | null,
  marker: '__r' | '__p',
): number {
  if (!email) return 1;
  const localPart = email.trim().toLowerCase().split('@')[0] || '';
  const regex = marker === '__r' ? /__r(\d+)$/ : /__p(\d+)$/;
  const match = localPart.match(regex);
  if (!match) return 1;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed >= 2 ? parsed : 1;
}

/**
 * Generates a cryptographically strong, easy-to-share password (e.g. Muktai@4829) using Web Crypto.
 */
export function generateStrongTemporaryPassword(prefix: string = 'Muktai@'): string {
  const digits = '23456789';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const part1 = Array.from(bytes.slice(0, 4))
    .map((b) => digits[b % digits.length])
    .join('');
  const part2 = Array.from(bytes.slice(4, 6))
    .map((b) => chars[b % chars.length])
    .join('');
  return `${prefix}${part1}${part2}`;
}

