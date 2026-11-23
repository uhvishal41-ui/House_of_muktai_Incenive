import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import type { UserRole } from '../src/types/incentive.ts';

export interface VerifiedAuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  isSuperAdmin: boolean;
}

export interface AuthenticatedRequest extends Request {
  authUser?: VerifiedAuthUser;
}

export interface AdminRegistryDoc {
  role: string;
  active: boolean;
  authType?: string;
}

export type AdminLookupFn = (params: {
  uid: string;
  idToken: string;
  projectId: string;
  databaseId: string;
}) => Promise<AdminRegistryDoc | null>;

const BOOTSTRAPPED_ADMIN_EMAIL = 'uhvishal41@gmail.com';
const ADMIN_AUTH_DOMAIN_SUFFIX = '@admin.homfash.internal';
const ADMIN_CACHE_TTL_MS = 60_000;
const adminLookupCache = new Map<string, { expiresAt: number; doc: AdminRegistryDoc | null }>();

interface FirebaseConfigInfo {
  projectId: string;
  databaseId: string;
}

function loadFirebaseConfig(): FirebaseConfigInfo {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return {
        projectId: parsed.projectId ? String(parsed.projectId) : process.env.FIREBASE_PROJECT_ID || '',
        databaseId: parsed.firestoreDatabaseId
          ? String(parsed.firestoreDatabaseId)
          : process.env.FIRESTORE_DATABASE_ID || '(default)',
      };
    }
  } catch {
    // Fallback to environment variables
  }
  return {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)',
  };
}

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

/**
 * Queries Firestore REST API for `/admins/{uid}` using the caller's OWN verified Firebase ID token.
 * Zero IAM required — works identically on Starter Tier and enforces firestore.rules.
 * Fails closed (returns null) on 403, 404, or network errors.
 */
export async function lookupAdminDocViaRest(params: {
  uid: string;
  idToken: string;
  projectId: string;
  databaseId: string;
}): Promise<AdminRegistryDoc | null> {
  const cached = adminLookupCache.get(params.uid);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.doc;
  }

  try {
    const encodedDb = encodeURIComponent(params.databaseId || '(default)');
    const encodedUid = encodeURIComponent(params.uid);
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(params.projectId)}/databases/${encodedDb}/documents/admins/${encodedUid}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${params.idToken}`,
        Accept: 'application/json',
      },
    });

    if (!resp.ok) {
      adminLookupCache.set(params.uid, { expiresAt: Date.now() + ADMIN_CACHE_TTL_MS, doc: null });
      return null;
    }

    const json = (await resp.json()) as {
      fields?: {
        role?: { stringValue?: string };
        active?: { booleanValue?: boolean };
        authType?: { stringValue?: string };
      };
    };

    const role = json.fields?.role?.stringValue || '';
    const active = json.fields?.active?.booleanValue === true;
    const authType = json.fields?.authType?.stringValue || '';
    const doc = { role, active, ...(authType ? { authType } : {}) };
    adminLookupCache.set(params.uid, { expiresAt: Date.now() + ADMIN_CACHE_TTL_MS, doc });
    return doc;
  } catch {
    return null;
  }
}

export function clearAdminLookupCache(): void {
  adminLookupCache.clear();
}

export function isMainOwnerIdentity(params: { email: string; emailVerified: boolean }): boolean {
  return (
    params.emailVerified === true &&
    params.email.trim().toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()
  );
}

/**
 * Consistent Admin Role Resolution:
 * - Main Owner: Verified registered Owner Gmail (`uhvishal41@gmail.com`)
 * - Active Password Admin: Owner-provisioned `/admins/{uid}` with `authType === 'PASSWORD'`, `active === true`, `role === 'SUPER_ADMIN'`, and `@admin.homfash.internal` auth email
 * - Active Verified Google Admin: Verified Google email listed in `/admins/{uid}` with `active === true` and `role === 'SUPER_ADMIN'`
 */
export function resolveRoleConsistent(params: {
  email: string;
  emailVerified: boolean;
  adminDoc?: AdminRegistryDoc | null;
}): UserRole {
  const lowerEmail = params.email.trim().toLowerCase();
  if (isMainOwnerIdentity({ email: lowerEmail, emailVerified: params.emailVerified })) {
    return 'SUPER_ADMIN';
  }
  if (
    lowerEmail.endsWith(ADMIN_AUTH_DOMAIN_SUFFIX) &&
    params.adminDoc &&
    params.adminDoc.active === true &&
    params.adminDoc.role === 'SUPER_ADMIN' &&
    params.adminDoc.authType === 'PASSWORD'
  ) {
    return 'SUPER_ADMIN';
  }
  if (!params.emailVerified) {
    return 'EMPLOYEE';
  }
  if (params.adminDoc && params.adminDoc.active === true && params.adminDoc.role === 'SUPER_ADMIN') {
    return 'SUPER_ADMIN';
  }
  return 'EMPLOYEE';
}

export function createFirebaseAuthMiddleware(adminLookup: AdminLookupFn = lookupAdminDocViaRest) {
  return async function verifyFirebaseBearerToken(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const header = req.headers.authorization;
      if (!header || !header.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing Bearer authentication token.' });
        return;
      }

      const token = header.slice('Bearer '.length).trim();
      const { projectId, databaseId } = loadFirebaseConfig();
      if (!projectId) {
        res.status(500).json({ error: 'Firebase project configuration is missing on server.' });
        return;
      }

      const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
        issuer: `https://securetoken.google.com/${projectId}`,
        audience: projectId,
      });

      const uid = typeof payload.sub === 'string' ? payload.sub : '';
      const email = typeof payload.email === 'string' ? payload.email : '';
      const emailVerified = payload.email_verified === true;

      if (!uid) {
        res.status(401).json({ error: 'Invalid authentication token subject.' });
        return;
      }

      let adminDoc: AdminRegistryDoc | null = null;
      const isBootstrapped = isMainOwnerIdentity({ email, emailVerified });
      const isPasswordAdminEmail = email.trim().toLowerCase().endsWith(ADMIN_AUTH_DOMAIN_SUFFIX);

      if (!isBootstrapped && (emailVerified || isPasswordAdminEmail)) {
        adminDoc = await adminLookup({ uid, idToken: token, projectId, databaseId });
      }

      const role = resolveRoleConsistent({
        email,
        emailVerified,
        adminDoc,
      });

      req.authUser = {
        uid,
        email,
        emailVerified,
        role,
        isSuperAdmin: role === 'SUPER_ADMIN',
      };

      next();
    } catch {
      res.status(401).json({ error: 'Authentication token is invalid or expired.' });
    }
  };
}

export const verifyFirebaseBearerToken = createFirebaseAuthMiddleware();

export function createRoleGuard(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      res.status(403).json({
        error: `Forbidden: Role "${req.authUser.role}" is not permitted to perform this operation. Super Admin authorization is required.`,
      });
      return;
    }
    next();
  };
}

export const requireSuperAdmin = createRoleGuard(['SUPER_ADMIN']);
