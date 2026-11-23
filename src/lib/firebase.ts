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
  return username.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
}

export function adminUsernameToAuthEmail(username: string): string {
  const normalized = normalizeAdminUsername(username).toLowerCase();
  return `${normalized}@${ADMIN_AUTH_DOMAIN}`;
}

export function isAdminAuthEmail(email?: string | null): boolean {
  return Boolean(email && email.trim().toLowerCase().endsWith(`@${ADMIN_AUTH_DOMAIN}`));
}
