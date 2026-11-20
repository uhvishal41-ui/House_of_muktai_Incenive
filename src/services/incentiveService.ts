import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  type Unsubscribe,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  auth,
  db,
  getSecondaryProvisioningAuth,
  handleFirestoreError,
  loginIdToAuthEmail,
  OperationType,
} from '../lib/firebase';
import { COMPANY_BRAND, DEFAULT_EMPLOYEE_PASSWORD } from '../lib/companyBrand';
import { formatShortDate, generateRecordId, sanitizeId } from '../lib/format';
import {
  applyPublishedCorrection,
  buildMonthlySummaryDocument,
  detectPeriodOverlapsForEmployee,
  formatImportTypeLabel,
  getDeterministicNotificationId,
  getDeterministicVersionId,
  getIncentiveRecordKey,
  resolveCanonicalBranchName,
} from '../lib/incentiveEngine';
import type {
  ActiveAuthUidRecord,
  AuditLog,
  Branch,
  ComponentLabels,
  Employee,
  EmployeeNotification,
  ImportBatch,
  ImportBatchRow,
  ImportType,
  IncentiveVersion,
  MonthlySummary,
  OverlapResolutionMode,
  PublishedIncentive,
} from '../types/incentive';

export const DEFAULT_12_BRANCHES: Array<{ code: string; name: string; city: string; manager: string }> = [
  { code: 'BEED', name: 'BEED', city: 'Beed', manager: '' },
  { code: 'BHOSARI', name: 'BHOSARI', city: 'Pune', manager: '' },
  { code: 'DHARASHIV', name: 'DHARASHIV', city: 'Dharashiv', manager: '' },
  { code: 'INDAPUR', name: 'INDAPUR', city: 'Indapur', manager: '' },
  { code: 'PARANDA', name: 'PARANDA', city: 'Paranda', manager: '' },
  { code: 'PANDHARPUR', name: 'PANDHARPUR', city: 'Pandharpur', manager: '' },
  { code: 'LONAND', name: 'LONAND', city: 'Lonand', manager: '' },
  { code: 'BARAMATI_MIDC', name: 'BARAMATI MIDC', city: 'Baramati', manager: '' },
  { code: 'BARAMATI_MOTIBAGH', name: 'BARAMATI MOTIBAGH', city: 'Baramati', manager: '' },
  { code: 'RASHIN', name: 'RASHIN', city: 'Rashin', manager: '' },
  { code: 'SHRIGONDA', name: 'SHRIGONDA', city: 'Shrigonda', manager: '' },
  { code: 'SUPA', name: 'SUPA', city: 'Supa', manager: '' },
];

export const OFFICIAL_BRANCH_ID_SET = new Set(DEFAULT_12_BRANCHES.map((b) => sanitizeId(b.code)));

const LEGACY_PLACEHOLDER_CODE_RE = /^HOM[-_]?(0[1-9]|1[0-2])$/i;

export function isLegacyOrDuplicateBranch(branch: Branch): boolean {
  const id = sanitizeId(branch.branchId || branch.branchCode);
  if (OFFICIAL_BRANCH_ID_SET.has(id)) return false;
  if (LEGACY_PLACEHOLDER_CODE_RE.test(branch.branchCode) || LEGACY_PLACEHOLDER_CODE_RE.test(branch.branchId)) {
    return true;
  }
  if (branch.branchName.trim().toLowerCase().startsWith('house of muktai')) {
    return true;
  }
  const canonicalId = sanitizeId(resolveCanonicalBranchName(branch.branchName));
  if (OFFICIAL_BRANCH_ID_SET.has(canonicalId) && id !== canonicalId) {
    return true;
  }
  return false;
}

export async function recordAuditLog(params: {
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  actorRole?: string;
}) {
  const user = auth.currentUser;
  if (!user) return;
  const logId = generateRecordId('LOG');
  const logEntry: AuditLog = {
    logId,
    action: params.action.slice(0, 80),
    actorUid: user.uid,
    actorEmail: (user.email || 'unknown').slice(0, 180),
    actorRole: (params.actorRole || 'SUPER_ADMIN').slice(0, 40),
    targetType: params.targetType.slice(0, 64),
    targetId: params.targetId.slice(0, 128),
    summary: params.summary.slice(0, 400),
    createdAt: new Date().toISOString(),
  };

  try {
    await setDoc(doc(db, 'audit_logs', logId), logEntry);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `audit_logs/${logId}`);
  }
}

// --- BRANCH MASTER ---
export async function listBranches(): Promise<Branch[]> {
  try {
    const snap = await getDocs(query(collection(db, 'branches'), orderBy('branchCode', 'asc')));
    return snap.docs.map((d) => d.data() as Branch);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'branches');
  }
}

export async function saveBranch(input: {
  branchId?: string;
  branchCode: string;
  branchName: string;
  city: string;
  managerName?: string;
  active: boolean;
  existingCreatedAt?: string;
}): Promise<Branch> {
  const now = new Date().toISOString();
  const cleanCode = sanitizeId(input.branchCode).slice(0, 24);
  const branchId = input.branchId || cleanCode;
  const payload: Branch = {
    branchId,
    branchCode: cleanCode,
    branchName: input.branchName.trim().slice(0, 120),
    city: input.city.trim().slice(0, 80),
    active: input.active,
    createdAt: input.existingCreatedAt || now,
    updatedAt: now,
    ...(input.managerName?.trim() ? { managerName: input.managerName.trim().slice(0, 120) } : {}),
  };

  try {
    await setDoc(doc(db, 'branches', branchId), payload);
    await recordAuditLog({
      action: input.existingCreatedAt ? 'BRANCH_UPDATED' : 'BRANCH_CREATED',
      targetType: 'branch',
      targetId: branchId,
      summary: `${input.existingCreatedAt ? 'Updated' : 'Created'} branch ${payload.branchCode} (${payload.branchName})`,
    });
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `branches/${branchId}`);
  }
}

export async function deleteBranch(branch: Branch): Promise<void> {
  try {
    const empSnap = await getDocs(
      query(collection(db, 'employees'), where('branchId', '==', branch.branchId)),
    );
    if (!empSnap.empty) {
      throw new Error(
        `Cannot delete branch "${branch.branchName}": ${empSnap.size} employee(s) are still linked to it. Reassign those employees first.`,
      );
    }
    await deleteDoc(doc(db, 'branches', branch.branchId));
    await recordAuditLog({
      action: 'BRANCH_DELETED',
      targetType: 'branch',
      targetId: branch.branchId,
      summary: `Removed unused branch ${branch.branchCode} (${branch.branchName})`,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Cannot delete branch')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.DELETE, `branches/${branch.branchId}`);
  }
}

/**
 * Links the exact 12 official House of Muktai branches by default, safely remaps any alias duplicate
 * references (e.g. BARAMATI_MOTIBAG -> BARAMATI_MOTIBAGH) across employees/incentives/summaries,
 * and removes obsolete placeholder/duplicate branches (preserving any custom user-added branches
 * unless `pruneAllNonOfficialUnreferenced` is true).
 */
export async function syncOfficial12Branches(options?: {
  pruneAllNonOfficialUnreferenced?: boolean;
}): Promise<{
  officialCount: number;
  createdOrUpdated: number;
  removedCount: number;
  remappedEmployees: number;
  remappedRecords: number;
}> {
  const now = new Date().toISOString();
  const pruneExtra = options?.pruneAllNonOfficialUnreferenced === true;

  try {
    const [branchSnap, empSnap, incSnap, sumSnap] = await Promise.all([
      getDocs(collection(db, 'branches')),
      getDocs(collection(db, 'employees')),
      getDocs(collection(db, 'published_incentives')),
      getDocs(collection(db, 'monthly_summaries')),
    ]);

    const existingBranches = new Map<string, Branch>();
    for (const d of branchSnap.docs) {
      existingBranches.set(d.id, d.data() as Branch);
    }

    const officialById = new Map<string, { code: string; name: string; city: string }>();
    for (const b of DEFAULT_12_BRANCHES) {
      officialById.set(sanitizeId(b.code), b);
    }

    type BatchOp =
      | { kind: 'set'; ref: ReturnType<typeof doc>; data: Record<string, unknown> }
      | { kind: 'update'; ref: ReturnType<typeof doc>; data: Record<string, unknown> }
      | { kind: 'delete'; ref: ReturnType<typeof doc> };

    const opUnits: BatchOp[][] = [];
    let createdOrUpdated = 0;

    // 1. Ensure all 12 official branches exist cleanly
    for (const b of DEFAULT_12_BRANCHES) {
      const branchId = sanitizeId(b.code);
      const prev = existingBranches.get(branchId);
      if (!prev) {
        const record: Branch = {
          branchId,
          branchCode: branchId,
          branchName: b.name,
          city: b.city,
          active: true,
          createdAt: now,
          updatedAt: now,
        };
        opUnits.push([
          {
            kind: 'set',
            ref: doc(db, 'branches', branchId),
            data: record as unknown as Record<string, unknown>,
          },
        ]);
        createdOrUpdated += 1;
      } else if (
        prev.branchName !== b.name ||
        prev.branchCode !== branchId ||
        prev.city !== b.city ||
        !prev.active
      ) {
        opUnits.push([
          {
            kind: 'update',
            ref: doc(db, 'branches', branchId),
            data: {
              branchCode: branchId,
              branchName: b.name,
              city: b.city,
              active: true,
              updatedAt: now,
            },
          },
        ]);
        createdOrUpdated += 1;
      }
    }

    // 2. Build alias remap table (e.g. BARAMATI_MOTIBAG -> BARAMATI_MOTIBAGH)
    const remapToOfficial = new Map<string, { branchId: string; branchName: string }>();
    for (const [id, br] of existingBranches.entries()) {
      if (OFFICIAL_BRANCH_ID_SET.has(id)) continue;
      const canonicalName = resolveCanonicalBranchName(br.branchName);
      const canonicalId = sanitizeId(canonicalName);
      const target = officialById.get(canonicalId);
      if (target) {
        remapToOfficial.set(id, { branchId: canonicalId, branchName: target.name });
      }
    }

    // 3. Remap employees pointing to alias duplicates (keep Pillar 7 active_auth_uids synced atomically in one unit)
    const referencedBranchIdsAfterRemap = new Set<string>();
    let remappedEmployees = 0;
    for (const d of empSnap.docs) {
      const emp = d.data() as Employee & { role: string };
      const target = remapToOfficial.get(emp.branchId);
      if (target) {
        const unit: BatchOp[] = [];
        const empUpdate: Record<string, unknown> = {
          branchId: target.branchId,
          branchName: target.branchName,
          updatedAt: now,
        };
        if (emp.role !== 'EMPLOYEE') {
          empUpdate.role = 'EMPLOYEE';
        }
        unit.push({ kind: 'update', ref: d.ref, data: empUpdate });
        if (emp.authUid) {
          if (emp.status === 'ACTIVE') {
            unit.push({
              kind: 'set',
              ref: doc(db, 'active_auth_uids', emp.authUid),
              data: {
                authUid: emp.authUid,
                employeeId: emp.employeeId,
                active: true,
                updatedAt: now,
              },
            });
          } else {
            unit.push({ kind: 'delete', ref: doc(db, 'active_auth_uids', emp.authUid) });
          }
        }
        opUnits.push(unit);
        remappedEmployees += 1;
        referencedBranchIdsAfterRemap.add(target.branchId);
      } else {
        referencedBranchIdsAfterRemap.add(emp.branchId);
      }
    }

    // 4. Remap published incentives (active PUBLISHED only) and monthly summaries for alias duplicates
    let remappedRecords = 0;
    for (const d of incSnap.docs) {
      const rec = d.data() as PublishedIncentive;
      if (rec.status !== 'PUBLISHED') continue;
      const target = remapToOfficial.get(rec.branchId);
      if (target) {
        opUnits.push([
          {
            kind: 'update',
            ref: d.ref,
            data: { branchId: target.branchId, branchName: target.branchName },
          },
        ]);
        remappedRecords += 1;
      }
    }

    for (const d of sumSnap.docs) {
      const sum = d.data() as MonthlySummary;
      const target = remapToOfficial.get(sum.branchId);
      if (target) {
        opUnits.push([
          {
            kind: 'update',
            ref: d.ref,
            data: { branchId: target.branchId, branchName: target.branchName, updatedAt: now },
          },
        ]);
        remappedRecords += 1;
      }
    }

    // 5. Remove obsolete placeholder / duplicate branches (and optionally any unreferenced non-official branches)
    let removedCount = 0;
    for (const [id, br] of existingBranches.entries()) {
      if (OFFICIAL_BRANCH_ID_SET.has(id)) continue;
      const isLegacyDup = isLegacyOrDuplicateBranch(br);
      const isUnreferenced = !referencedBranchIdsAfterRemap.has(id);
      if ((isLegacyDup && isUnreferenced) || (pruneExtra && isUnreferenced)) {
        opUnits.push([{ kind: 'delete', ref: doc(db, 'branches', id) }]);
        removedCount += 1;
      }
    }

    let currentChunk: BatchOp[] = [];
    const flushChunk = async () => {
      if (currentChunk.length === 0) return;
      const wb = writeBatch(db);
      for (const op of currentChunk) {
        if (op.kind === 'set') wb.set(op.ref, op.data);
        else if (op.kind === 'update') wb.update(op.ref, op.data);
        else wb.delete(op.ref);
      }
      await wb.commit();
      currentChunk = [];
    };

    for (const unit of opUnits) {
      if (currentChunk.length + unit.length > 350) {
        await flushChunk();
      }
      currentChunk.push(...unit);
    }
    await flushChunk();

    if (opUnits.length > 0) {
      await recordAuditLog({
        action: 'BRANCHES_OFFICIAL_12_SYNCED',
        targetType: 'branch',
        targetId: 'OFFICIAL_12',
        summary: `Synced 12 official branches (${createdOrUpdated} created/updated, ${removedCount} obsolete/duplicate removed, ${remappedEmployees} employees & ${remappedRecords} records remapped)`,
      });
    }

    return {
      officialCount: DEFAULT_12_BRANCHES.length,
      createdOrUpdated,
      removedCount,
      remappedEmployees,
      remappedRecords,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'branches');
  }
}

export async function initializeDefault12Branches(): Promise<number> {
  const res = await syncOfficial12Branches({ pruneAllNonOfficialUnreferenced: false });
  return res.officialCount;
}

// --- EMPLOYEE MASTER ---
export async function listEmployees(): Promise<Employee[]> {
  try {
    const snap = await getDocs(query(collection(db, 'employees'), orderBy('employeeId', 'asc')));
    return snap.docs.map((d) => d.data() as Employee);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'employees');
  }
}

export async function provisionEmployeeCredentials(
  loginId: string,
  initialPassword: string = DEFAULT_EMPLOYEE_PASSWORD,
): Promise<{
  uid: string;
  status: 'CREATED' | 'RECOVERED_EXISTING' | 'AUTH_PROVIDER_DISABLED' | 'ALREADY_EXISTS';
  message: string;
}> {
  const authEmail = loginIdToAuthEmail(loginId);
  const secondaryAuth = getSecondaryProvisioningAuth();
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, initialPassword);
    const uid = cred.user.uid;
    await signOut(secondaryAuth);
    return {
      uid,
      status: 'CREATED',
      message: `Login credentials provisioned for ${loginId} (default password set; first-login password change required).`,
    };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/operation-not-allowed') {
      return {
        uid: '',
        status: 'AUTH_PROVIDER_DISABLED',
        message:
          'Enable "Email/Password" in Firebase Console -> Authentication -> Sign-in method to activate Employee Login ID + Password sign-in.',
      };
    }
    if (code === 'auth/email-already-in-use') {
      // If an Auth user already exists with the default password, link its UID cleanly
      try {
        const existingCred = await signInWithEmailAndPassword(
          secondaryAuth,
          authEmail,
          initialPassword,
        );
        const uid = existingCred.user.uid;
        await signOut(secondaryAuth);
        return {
          uid,
          status: 'RECOVERED_EXISTING',
          message: `Linked existing Firebase Auth login for ${loginId}.`,
        };
      } catch {
        return {
          uid: '',
          status: 'ALREADY_EXISTS',
          message: `Auth account for ${loginId} already exists in Firebase Authentication (password already customized).`,
        };
      }
    }
    throw err;
  }
}

export interface ProvisionFailureItem {
  employeeId: string;
  loginId: string;
  fullName: string;
  branchName: string;
  errorCode: string;
  reason: string;
}

export interface BulkProvisionResult {
  totalPending: number;
  provisionedCount: number;
  alreadyExistedCount: number;
  failedCount: number;
  rateLimitedCount: number;
  providerDisabled: boolean;
  rateLimited: boolean;
  failedItems: ProvisionFailureItem[];
  message: string;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeProvisionError(err: unknown): { code: string; reason: string } {
  const code = (err as { code?: string })?.code || '';
  const rawMsg = err instanceof Error ? err.message : String(err);
  if (code === 'auth/too-many-requests' || rawMsg.includes('TOO_MANY_ATTEMPTS') || rawMsg.includes('too-many-requests')) {
    return {
      code: 'auth/too-many-requests',
      reason: 'Firebase Auth signup rate limit reached. Wait 5–10 minutes and click Activate Pending again.',
    };
  }
  if (code === 'auth/invalid-email') {
    return {
      code,
      reason: 'Invalid Login ID format (must contain letters/numbers, min 3 chars).',
    };
  }
  if (code === 'auth/network-request-failed') {
    return {
      code,
      reason: 'Temporary network/connection error. Retry in a moment.',
    };
  }
  if (rawMsg.includes('PERMISSION_DENIED') || rawMsg.includes('Missing or insufficient permissions')) {
    return {
      code: 'firestore/permission-denied',
      reason: 'Firestore validation/permission error on employee record.',
    };
  }
  return {
    code: code || 'unknown-error',
    reason: rawMsg.slice(0, 180) || 'Unknown error while activating login.',
  };
}

function buildCleanProvisionedEmployeeDoc(
  emp: Employee,
  uid: string,
  now: string,
): Employee {
  const cleanLoginId = sanitizeId(emp.loginId || `HOM${emp.employeeId}`).slice(0, 40);
  const safeLoginId = cleanLoginId.length >= 3 ? cleanLoginId : `HOM${sanitizeId(emp.employeeId)}`.slice(0, 40);
  return {
    employeeId: sanitizeId(emp.employeeId).slice(0, 64),
    loginId: safeLoginId,
    authEmail: loginIdToAuthEmail(safeLoginId),
    authUid: uid,
    fullName: (emp.fullName || `Salesman ${emp.employeeId}`).trim().slice(0, 120),
    branchId: emp.branchId,
    branchName: (emp.branchName || emp.branchId).trim().slice(0, 120),
    designation: (emp.designation || 'Sales Executive').trim().slice(0, 80),
    role: 'EMPLOYEE',
    status: emp.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    mustChangePassword: true,
    credentialsProvisioned: true,
    createdAt: emp.createdAt || now,
    updatedAt: now,
    ...(emp.linkedGoogleEmail?.trim()
      ? { linkedGoogleEmail: emp.linkedGoogleEmail.trim().toLowerCase().slice(0, 180) }
      : {}),
    ...(emp.phone?.trim() ? { phone: emp.phone.trim().slice(0, 24) } : {}),
    ...(emp.address?.trim() ? { address: emp.address.trim().slice(0, 240) } : {}),
    ...(emp.emergencyContact?.trim()
      ? { emergencyContact: emp.emergencyContact.trim().slice(0, 120) }
      : {}),
  };
}

export async function provisionSingleEmployeeDefaultLogin(
  emp: Employee,
): Promise<{ ok: boolean; status: string; message: string }> {
  const now = new Date().toISOString();
  const cleanLoginId = sanitizeId(emp.loginId || `HOM${emp.employeeId}`).slice(0, 40);
  const prov = await provisionEmployeeCredentials(cleanLoginId, DEFAULT_EMPLOYEE_PASSWORD);
  if (prov.status === 'AUTH_PROVIDER_DISABLED') {
    return { ok: false, status: prov.status, message: prov.message };
  }
  if ((prov.status === 'CREATED' || prov.status === 'RECOVERED_EXISTING') && prov.uid) {
    const wb = writeBatch(db);
    const updatedEmp = buildCleanProvisionedEmployeeDoc(emp, prov.uid, now);
    wb.set(doc(db, 'employees', updatedEmp.employeeId), updatedEmp);
    if (updatedEmp.status === 'ACTIVE') {
      const activeEntry: ActiveAuthUidRecord = {
        authUid: prov.uid,
        employeeId: updatedEmp.employeeId,
        active: true,
        updatedAt: now,
      };
      wb.set(doc(db, 'active_auth_uids', prov.uid), activeEntry);
    }
    await wb.commit();
    await syncEmployeeAuthUidToExistingRecords(updatedEmp.employeeId, prov.uid);
    return {
      ok: true,
      status: prov.status,
      message: `Activated ${updatedEmp.fullName} (${updatedEmp.loginId}) with default password ${DEFAULT_EMPLOYEE_PASSWORD}.`,
    };
  }
  return { ok: false, status: prov.status, message: prov.message };
}

export async function provisionAllPendingEmployeeLogins(
  employees: Employee[],
  options?: {
    onProgress?: (progress: {
      processed: number;
      total: number;
      provisioned: number;
      failed: number;
      currentName: string;
    }) => void;
  },
): Promise<BulkProvisionResult> {
  const pending = employees.filter((e) => !e.credentialsProvisioned || !e.authUid);
  if (pending.length === 0) {
    return {
      totalPending: 0,
      provisionedCount: 0,
      alreadyExistedCount: 0,
      failedCount: 0,
      rateLimitedCount: 0,
      providerDisabled: false,
      rateLimited: false,
      failedItems: [],
      message: 'All employees already have active Login ID credentials provisioned.',
    };
  }

  let provisionedCount = 0;
  let alreadyExistedCount = 0;
  let failedCount = 0;
  let rateLimitedCount = 0;
  let providerDisabled = false;
  let rateLimited = false;
  const failedItems: ProvisionFailureItem[] = [];
  const now = new Date().toISOString();

  for (let idx = 0; idx < pending.length; idx += 1) {
    const emp = pending[idx];
    options?.onProgress?.({
      processed: idx,
      total: pending.length,
      provisioned: provisionedCount,
      failed: failedCount,
      currentName: `${emp.fullName} (${emp.loginId})`,
    });

    // Gentle pacing between Firebase Auth signup calls prevents triggering Firebase's burst throttle
    if (idx > 0) {
      await sleepMs(350);
    }

    const cleanLoginId = sanitizeId(emp.loginId || `HOM${emp.employeeId}`).slice(0, 40);

    try {
      let prov: Awaited<ReturnType<typeof provisionEmployeeCredentials>>;
      try {
        prov = await provisionEmployeeCredentials(cleanLoginId, DEFAULT_EMPLOYEE_PASSWORD);
      } catch (firstErr: unknown) {
        const desc = describeProvisionError(firstErr);
        if (desc.code === 'auth/too-many-requests') {
          // Single calm backoff retry before pausing cleanly
          await sleepMs(4000);
          prov = await provisionEmployeeCredentials(cleanLoginId, DEFAULT_EMPLOYEE_PASSWORD);
        } else {
          throw firstErr;
        }
      }

      if (prov.status === 'AUTH_PROVIDER_DISABLED') {
        providerDisabled = true;
        break;
      }

      if ((prov.status === 'CREATED' || prov.status === 'RECOVERED_EXISTING') && prov.uid) {
        const wb = writeBatch(db);
        const updatedEmp = buildCleanProvisionedEmployeeDoc(emp, prov.uid, now);
        wb.set(doc(db, 'employees', updatedEmp.employeeId), updatedEmp);
        if (updatedEmp.status === 'ACTIVE') {
          const activeEntry: ActiveAuthUidRecord = {
            authUid: prov.uid,
            employeeId: updatedEmp.employeeId,
            active: true,
            updatedAt: now,
          };
          wb.set(doc(db, 'active_auth_uids', prov.uid), activeEntry);
        }
        await wb.commit();
        await syncEmployeeAuthUidToExistingRecords(updatedEmp.employeeId, prov.uid);
        provisionedCount += 1;
      } else if (prov.status === 'ALREADY_EXISTS') {
        alreadyExistedCount += 1;
        failedItems.push({
          employeeId: emp.employeeId,
          loginId: emp.loginId,
          fullName: emp.fullName,
          branchName: emp.branchName,
          errorCode: 'auth/email-already-in-use',
          reason: prov.message,
        });
      } else {
        failedCount += 1;
        failedItems.push({
          employeeId: emp.employeeId,
          loginId: emp.loginId,
          fullName: emp.fullName,
          branchName: emp.branchName,
          errorCode: prov.status,
          reason: prov.message,
        });
      }
    } catch (err: unknown) {
      const desc = describeProvisionError(err);
      if (desc.code === 'auth/too-many-requests') {
        rateLimited = true;
        // Stop immediately instead of hammering Firebase and extending the IP cooldown; record all remaining
        for (let r = idx; r < pending.length; r += 1) {
          const rem = pending[r];
          rateLimitedCount += 1;
          failedCount += 1;
          failedItems.push({
            employeeId: rem.employeeId,
            loginId: rem.loginId,
            fullName: rem.fullName,
            branchName: rem.branchName,
            errorCode: 'auth/too-many-requests',
            reason:
              'Paused due to Firebase Auth temporary signup limit (~100–150 accounts/window). Wait 5–10 minutes and click Activate All Pending again.',
          });
        }
        break;
      }
      failedCount += 1;
      failedItems.push({
        employeeId: emp.employeeId,
        loginId: emp.loginId,
        fullName: emp.fullName,
        branchName: emp.branchName,
        errorCode: desc.code,
        reason: desc.reason,
      });
    }
  }

  options?.onProgress?.({
    processed: pending.length,
    total: pending.length,
    provisioned: provisionedCount,
    failed: failedCount,
    currentName: '',
  });

  if (provisionedCount > 0) {
    await recordAuditLog({
      action: 'BULK_EMPLOYEE_LOGINS_PROVISIONED',
      targetType: 'employee_auth',
      targetId: `BULK_${Date.now()}`,
      summary: `Provisioned default first-login credentials (mandatory password change enabled) for ${provisionedCount} employee(s) out of ${pending.length} pending.${
        rateLimited ? ` Paused at Firebase rate limit (${rateLimitedCount} remaining to retry after cooldown).` : ''
      }`,
    });
  }

  if (providerDisabled) {
    return {
      totalPending: pending.length,
      provisionedCount,
      alreadyExistedCount,
      failedCount,
      rateLimitedCount,
      providerDisabled: true,
      rateLimited: false,
      failedItems,
      message:
        'Firebase Email/Password sign-in is currently OFF. Open Firebase Console -> Authentication -> Sign-in method -> Enable "Email/Password", then click this button again to activate all employee logins with Muktai@123.',
    };
  }

  if (rateLimited) {
    return {
      totalPending: pending.length,
      provisionedCount,
      alreadyExistedCount,
      failedCount,
      rateLimitedCount,
      providerDisabled: false,
      rateLimited: true,
      failedItems,
      message: `Activated ${provisionedCount} login(s). Firebase Auth temporarily rate-limited remaining ${rateLimitedCount} signup(s) (auth/too-many-requests). Wait 5–10 minutes and click "Activate All Pending" again to finish the remaining accounts.`,
    };
  }

  return {
    totalPending: pending.length,
    provisionedCount,
    alreadyExistedCount,
    failedCount,
    rateLimitedCount,
    providerDisabled: false,
    rateLimited: false,
    failedItems,
    message: `Activated ${provisionedCount} employee login(s) with default password ${DEFAULT_EMPLOYEE_PASSWORD} (mandatory password change on first login).${
      alreadyExistedCount > 0 ? ` ${alreadyExistedCount} already customized.` : ''
    }${failedCount > 0 ? ` ${failedCount} failed (see detailed list below).` : ''}`,
  };
}

/**
 * Helper: Synchronizes a newly linked/provisioned authUid onto all legacy records for that employee
 * (published_incentives, monthly_summaries, notifications) so historical statements appear immediately.
 */
async function syncEmployeeAuthUidToExistingRecords(
  employeeId: string,
  authUid: string,
): Promise<number> {
  if (!authUid) return 0;
  const cleanEmpId = sanitizeId(employeeId);
  const [incSnap, sumSnap, ntfSnap] = await Promise.all([
    getDocs(query(collection(db, 'published_incentives'), where('employeeId', '==', cleanEmpId))),
    getDocs(query(collection(db, 'monthly_summaries'), where('employeeId', '==', cleanEmpId))),
    getDocs(query(collection(db, 'notifications'), where('employeeId', '==', cleanEmpId))),
  ]);

  const refsToUpdate: Array<ReturnType<typeof doc>> = [];
  for (const d of incSnap.docs) {
    if ((d.data() as PublishedIncentive).authUid !== authUid) refsToUpdate.push(d.ref);
  }
  for (const d of sumSnap.docs) {
    if ((d.data() as MonthlySummary).authUid !== authUid) refsToUpdate.push(d.ref);
  }
  for (const d of ntfSnap.docs) {
    if ((d.data() as EmployeeNotification).authUid !== authUid) refsToUpdate.push(d.ref);
  }

  for (let i = 0; i < refsToUpdate.length; i += 400) {
    const wb = writeBatch(db);
    for (const ref of refsToUpdate.slice(i, i + 400)) {
      wb.update(ref, { authUid });
    }
    await wb.commit();
  }
  return refsToUpdate.length;
}

export async function saveEmployee(input: {
  employeeId: string;
  loginId: string;
  fullName: string;
  branchId: string;
  branchName: string;
  designation: string;
  phone?: string;
  address?: string;
  emergencyContact?: string;
  linkedGoogleEmail?: string;
  role?: 'EMPLOYEE';
  status: 'ACTIVE' | 'INACTIVE';
  mustChangePassword: boolean;
  initialPassword?: string;
  existing?: Employee | null;
}): Promise<{ employee: Employee; provisioningNote: string }> {
  const now = new Date().toISOString();
  const employeeId = sanitizeId(input.employeeId).slice(0, 64);
  const loginId = sanitizeId(input.loginId).slice(0, 40);
  const authEmail = loginIdToAuthEmail(loginId);

  const previousAuthUid = input.existing?.authUid || '';
  let authUid = previousAuthUid;
  let credentialsProvisioned = input.existing?.credentialsProvisioned || false;
  let provisioningNote = '';

  const effectiveInitialPassword = (
    input.initialPassword?.trim() ||
    (!input.existing ? DEFAULT_EMPLOYEE_PASSWORD : '')
  ).trim();

  if (effectiveInitialPassword.length >= 8 && !credentialsProvisioned) {
    const prov = await provisionEmployeeCredentials(loginId, effectiveInitialPassword);
    if ((prov.status === 'CREATED' || prov.status === 'RECOVERED_EXISTING') && prov.uid) {
      authUid = prov.uid;
      credentialsProvisioned = true;
    }
    provisioningNote = prov.message;
  }

  // Phase 2 enforces EMPLOYEE role only (BRANCH_MANAGER disabled)
  const record: Employee = {
    employeeId,
    loginId,
    authEmail,
    fullName: input.fullName.trim().slice(0, 120),
    branchId: input.branchId,
    branchName: input.branchName.trim().slice(0, 120),
    designation: input.designation.trim().slice(0, 80),
    role: 'EMPLOYEE',
    status: input.status,
    mustChangePassword: input.mustChangePassword,
    credentialsProvisioned,
    createdAt: input.existing?.createdAt || now,
    updatedAt: now,
    ...(authUid ? { authUid } : {}),
    ...(input.linkedGoogleEmail?.trim()
      ? { linkedGoogleEmail: input.linkedGoogleEmail.trim().toLowerCase().slice(0, 180) }
      : {}),
    ...(input.phone?.trim() ? { phone: input.phone.trim().slice(0, 24) } : {}),
    ...(input.address?.trim() ? { address: input.address.trim().slice(0, 240) } : {}),
    ...(input.emergencyContact?.trim()
      ? { emergencyContact: input.emergencyContact.trim().slice(0, 120) }
      : {}),
  };

  try {
    // Pillar 7 atomic writeBatch: employees/{employeeId} + active_auth_uids/{authUid} stay strictly in sync
    const wb = writeBatch(db);
    wb.set(doc(db, 'employees', employeeId), record);

    if (previousAuthUid && previousAuthUid !== authUid) {
      wb.delete(doc(db, 'active_auth_uids', previousAuthUid));
    }

    if (authUid) {
      if (record.status === 'ACTIVE') {
        const activeEntry: ActiveAuthUidRecord = {
          authUid,
          employeeId,
          active: true,
          updatedAt: now,
        };
        wb.set(doc(db, 'active_auth_uids', authUid), activeEntry);
      } else {
        wb.delete(doc(db, 'active_auth_uids', authUid));
      }
    }

    await wb.commit();

    // If a new authUid was provisioned, immediately backfill any legacy records for this employee
    if (authUid && authUid !== previousAuthUid) {
      await syncEmployeeAuthUidToExistingRecords(employeeId, authUid);
    }

    await recordAuditLog({
      action: input.existing ? 'EMPLOYEE_UPDATED' : 'EMPLOYEE_CREATED',
      targetType: 'employee',
      targetId: employeeId,
      summary: `${input.existing ? 'Updated' : 'Created'} employee ${employeeId} (${record.fullName}, Login ID: ${loginId}, Branch: ${record.branchName}, Status: ${record.status})`,
    });
    return { employee: record, provisioningNote };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `employees/${employeeId}`);
  }
}

/**
 * Super Admin ONLY: Activates, deactivates, or reactivates an employee.
 * Verified on Backend API (Bearer + requireSuperAdmin) AND Firestore Rules (isSuperAdmin + Pillar 7 active_auth_uids sync).
 * Deactivating atomically removes `/active_auth_uids/{authUid}` to immediately block all Firestore data access.
 * NEVER deletes employee record, historical incentives, or audit logs.
 */
export async function updateEmployeeStatus(params: {
  employee: Employee;
  targetStatus: 'ACTIVE' | 'INACTIVE';
  reason?: string;
}): Promise<{ auditAction: string }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Super Admin authentication is required.');

  const token = await user.getIdToken();
  const resp = await fetch('/api/v1/admin/employees/authorize-status-change', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      employeeId: params.employee.employeeId,
      currentStatus: params.employee.status,
      targetStatus: params.targetStatus,
      reason: params.reason?.trim() || undefined,
    }),
  });

  const authDecision = await resp.json().catch(() => ({ error: 'Authorization failed.' }));
  if (!resp.ok) {
    throw new Error(authDecision.error || 'Only Super Admin can change employee Active/Inactive status.');
  }

  const now = new Date().toISOString();
  const auditAction: string =
    authDecision.auditAction ||
    (params.targetStatus === 'INACTIVE'
      ? 'EMPLOYEE_DEACTIVATED'
      : params.employee.status === 'INACTIVE'
        ? 'EMPLOYEE_REACTIVATED'
        : 'EMPLOYEE_ACTIVATED');

  try {
    const wb = writeBatch(db);
    // Normalize legacy role to EMPLOYEE if needed during status update
    const empUpdate: Record<string, unknown> = {
      status: params.targetStatus,
      updatedAt: now,
    };
    if ((params.employee.role as string) !== 'EMPLOYEE') {
      empUpdate.role = 'EMPLOYEE';
    }
    wb.update(doc(db, 'employees', params.employee.employeeId), empUpdate);

    if (params.employee.authUid) {
      if (params.targetStatus === 'ACTIVE') {
        const activeEntry: ActiveAuthUidRecord = {
          authUid: params.employee.authUid,
          employeeId: params.employee.employeeId,
          active: true,
          updatedAt: now,
        };
        wb.set(doc(db, 'active_auth_uids', params.employee.authUid), activeEntry);
      } else {
        wb.delete(doc(db, 'active_auth_uids', params.employee.authUid));
      }
    }

    await wb.commit();

    const reasonText = params.reason?.trim() ? ` Reason: ${params.reason.trim()}` : '';
    await recordAuditLog({
      action: auditAction,
      targetType: 'employee',
      targetId: params.employee.employeeId,
      summary: `Super Admin changed ${params.employee.employeeId} (${params.employee.fullName}) from ${params.employee.status} to ${params.targetStatus} (active_auth_uids synced atomically). Historical incentives & audit logs preserved.${reasonText}`,
    });

    return { auditAction };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `employees/${params.employee.employeeId}`);
  }
}

export interface LegacyAuthBackfillResult {
  activeRegistryAdded: number;
  activeRegistryRemoved: number;
  incentivesUpdated: number;
  summariesUpdated: number;
  notificationsUpdated: number;
  legacyRolesNormalized: number;
  unlinkedEmployeesCount: number;
}

/**
 * Super Admin ONLY, Idempotent One-Click Backfill (Issues 1, 3, & 6):
 * 1. Syncs `/active_auth_uids/{authUid}` for all ACTIVE/INACTIVE employees with provisioned authUid.
 * 2. Normalizes any legacy BRANCH_MANAGER employee records to EMPLOYEE for Phase 2 compliance.
 * 3. Backfills missing/mismatched `authUid` on legacy `published_incentives`, `monthly_summaries`, and `notifications`.
 * Zero duplicate records, zero incentive amount modifications, zero notifications sent.
 */
export async function backfillAuthUidAndActiveRegistry(): Promise<LegacyAuthBackfillResult> {
  const user = auth.currentUser;
  if (!user) throw new Error('Super Admin authentication is required.');

  const now = new Date().toISOString();

  try {
    const [empSnap, activeSnap, incSnap, sumSnap, ntfSnap] = await Promise.all([
      getDocs(collection(db, 'employees')),
      getDocs(collection(db, 'active_auth_uids')),
      getDocs(collection(db, 'published_incentives')),
      getDocs(collection(db, 'monthly_summaries')),
      getDocs(collection(db, 'notifications')),
    ]);

    const employees = empSnap.docs.map((d) => d.data() as Employee);
    const activeRegistryIds = new Set(activeSnap.docs.map((d) => d.id));
    const empById = new Map<string, Employee>();
    const expectedActiveUids = new Map<string, string>(); // authUid -> employeeId
    let unlinkedEmployeesCount = 0;

    for (const emp of employees) {
      empById.set(sanitizeId(emp.employeeId), emp);
      if (emp.authUid) {
        if (emp.status === 'ACTIVE') {
          expectedActiveUids.set(emp.authUid, emp.employeeId);
        }
      } else {
        unlinkedEmployeesCount += 1;
      }
    }

    type BatchOp =
      | { kind: 'set'; ref: ReturnType<typeof doc>; data: Record<string, unknown> }
      | { kind: 'update'; ref: ReturnType<typeof doc>; data: Record<string, unknown> }
      | { kind: 'delete'; ref: ReturnType<typeof doc> };

    const ops: BatchOp[] = [];
    let activeRegistryAdded = 0;
    let activeRegistryRemoved = 0;
    let legacyRolesNormalized = 0;
    let incentivesUpdated = 0;
    let summariesUpdated = 0;
    let notificationsUpdated = 0;

    // 1. Add missing active_auth_uids entries for ACTIVE employees
    for (const [authUid, employeeId] of expectedActiveUids.entries()) {
      if (!activeRegistryIds.has(authUid)) {
        ops.push({
          kind: 'set',
          ref: doc(db, 'active_auth_uids', authUid),
          data: { authUid, employeeId, active: true, updatedAt: now },
        });
        activeRegistryAdded += 1;
      }
    }

    // 2. Remove stale active_auth_uids entries for INACTIVE/orphaned UIDs
    for (const existingUid of activeRegistryIds) {
      if (!expectedActiveUids.has(existingUid)) {
        ops.push({
          kind: 'delete',
          ref: doc(db, 'active_auth_uids', existingUid),
        });
        activeRegistryRemoved += 1;
      }
    }

    // 3. Normalize any legacy BRANCH_MANAGER roles in employees
    for (const d of empSnap.docs) {
      const emp = d.data() as Employee & { role: string };
      if (emp.role !== 'EMPLOYEE') {
        ops.push({
          kind: 'update',
          ref: d.ref,
          data: { role: 'EMPLOYEE', updatedAt: now },
        });
        legacyRolesNormalized += 1;
      }
    }

    // 4. Backfill missing/mismatched authUid on published_incentives
    for (const d of incSnap.docs) {
      const rec = d.data() as PublishedIncentive;
      const emp = empById.get(sanitizeId(rec.employeeId));
      if (emp?.authUid && rec.authUid !== emp.authUid) {
        ops.push({ kind: 'update', ref: d.ref, data: { authUid: emp.authUid } });
        incentivesUpdated += 1;
      }
    }

    // 5. Backfill missing/mismatched authUid on monthly_summaries
    for (const d of sumSnap.docs) {
      const rec = d.data() as MonthlySummary;
      const emp = empById.get(sanitizeId(rec.employeeId));
      if (emp?.authUid && rec.authUid !== emp.authUid) {
        ops.push({ kind: 'update', ref: d.ref, data: { authUid: emp.authUid } });
        summariesUpdated += 1;
      }
    }

    // 6. Backfill missing/mismatched authUid on notifications
    for (const d of ntfSnap.docs) {
      const rec = d.data() as EmployeeNotification;
      const emp = empById.get(sanitizeId(rec.employeeId));
      if (emp?.authUid && rec.authUid !== emp.authUid) {
        ops.push({ kind: 'update', ref: d.ref, data: { authUid: emp.authUid } });
        notificationsUpdated += 1;
      }
    }

    for (let i = 0; i < ops.length; i += 400) {
      const wb = writeBatch(db);
      for (const op of ops.slice(i, i + 400)) {
        if (op.kind === 'set') wb.set(op.ref, op.data);
        else if (op.kind === 'update') wb.update(op.ref, op.data);
        else wb.delete(op.ref);
      }
      await wb.commit();
    }

    await recordAuditLog({
      action: 'LEGACY_AUTH_UID_BACKFILL',
      targetType: 'system',
      targetId: `BACKFILL_${Date.now()}`,
      summary: `Synced active_auth_uids (+${activeRegistryAdded}/-${activeRegistryRemoved}), normalized ${legacyRolesNormalized} legacy role(s), backfilled authUid on ${incentivesUpdated} incentives, ${summariesUpdated} summaries, ${notificationsUpdated} notifications.`,
    });

    return {
      activeRegistryAdded,
      activeRegistryRemoved,
      incentivesUpdated,
      summariesUpdated,
      notificationsUpdated,
      legacyRolesNormalized,
      unlinkedEmployeesCount,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'active_auth_uids');
  }
}

/**
 * Super Admin ONLY: Explicitly approves a branch transfer detected during Excel import.
 * Excel import NEVER silently overwrites an employee's branch.
 */
export async function approveEmployeeBranchTransfer(params: {
  employee: Employee;
  newBranchId: string;
  newBranchName: string;
  reason?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  try {
    await updateDoc(doc(db, 'employees', params.employee.employeeId), {
      branchId: params.newBranchId,
      branchName: params.newBranchName.trim().slice(0, 120),
      updatedAt: now,
    });
    await recordAuditLog({
      action: 'EMPLOYEE_BRANCH_TRANSFERRED',
      targetType: 'employee',
      targetId: params.employee.employeeId,
      summary: `Super Admin approved branch transfer for ${params.employee.employeeId} (${params.employee.fullName}): ${params.employee.branchName} -> ${params.newBranchName}.${params.reason ? ` Note: ${params.reason}` : ''}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `employees/${params.employee.employeeId}`);
  }
}

export async function updateOwnEmployeeProfile(
  employeeId: string,
  updates: { phone: string; address: string; emergencyContact: string; mustChangePassword?: boolean },
): Promise<void> {
  const payload: Record<string, string | boolean> = {
    phone: updates.phone.trim().slice(0, 24),
    address: updates.address.trim().slice(0, 240),
    emergencyContact: updates.emergencyContact.trim().slice(0, 120),
    updatedAt: new Date().toISOString(),
  };
  if (typeof updates.mustChangePassword === 'boolean') {
    payload.mustChangePassword = updates.mustChangePassword;
  }

  try {
    await updateDoc(doc(db, 'employees', employeeId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `employees/${employeeId}`);
  }
}

function toCleanTitleCase(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1).toLowerCase() : ''))
    .join(' ');
}

/**
 * Super Admin–controlled ERP master registration:
 * - Registers ONLY missing branches and explicitly reviewed new employee candidates.
 * - NEVER auto-sets SMPL or any employee to INACTIVE without explicit Super Admin selection (`initialStatus`).
 * - NEVER overwrites existing employees' status or branch.
 */
export async function syncMastersFromErpRows(params: {
  missingBranches: string[];
  missingEmployees: Array<{
    salesmanNo: string;
    salesPersonName: string;
    erpBranchName: string;
    isSmplCandidate: boolean;
    initialStatus: 'ACTIVE' | 'INACTIVE';
  }>;
  existingBranches: Branch[];
  existingEmployees?: Employee[];
}): Promise<{ branchesCreated: number; employeesCreated: number }> {
  const now = new Date().toISOString();
  const branchLookup: Record<string, Branch> = {};
  for (const b of params.existingBranches) {
    branchLookup[b.branchName.trim().toUpperCase()] = b;
    branchLookup[b.branchCode.trim().toUpperCase()] = b;
    branchLookup[resolveCanonicalBranchName(b.branchName)] = b;
  }

  const existingEmpSet = new Set<string>(
    (params.existingEmployees || []).map((e) => sanitizeId(e.employeeId)),
  );

  const opGroups: Array<
    Array<{ ref: ReturnType<typeof doc>; data: Branch | Employee | ActiveAuthUidRecord }>
  > = [];
  let branchesCreated = 0;

  for (const rawBranch of params.missingBranches) {
    const cleanName = resolveCanonicalBranchName(rawBranch);
    if (!cleanName || branchLookup[cleanName]) continue;
    const branchCode = sanitizeId(cleanName).slice(0, 24);
    const branchDoc: Branch = {
      branchId: branchCode,
      branchCode,
      branchName: cleanName,
      city: toCleanTitleCase(cleanName.split(' ')[0] || cleanName).slice(0, 80),
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    branchLookup[cleanName] = branchDoc;
    branchLookup[branchCode] = branchDoc;
    opGroups.push([{ ref: doc(db, 'branches', branchCode), data: branchDoc }]);
    branchesCreated += 1;
  }

  let employeesCreated = 0;
  let loginsProvisioned = 0;
  let authProviderDisabled = false;
  const seenEmpIds = new Set<string>();

  for (const emp of params.missingEmployees) {
    const employeeId = sanitizeId(emp.salesmanNo).slice(0, 64);
    // Strict safeguard: NEVER touch existing employee records
    if (!employeeId || seenEmpIds.has(employeeId) || existingEmpSet.has(employeeId)) continue;
    seenEmpIds.add(employeeId);

    const branchKey = resolveCanonicalBranchName(emp.erpBranchName);
    const branch = branchLookup[branchKey] || branchLookup[sanitizeId(branchKey).slice(0, 24)];
    if (!branch) continue;

    const loginId = `HOM${employeeId}`.slice(0, 40);
    let authUid = '';
    let credentialsProvisioned = false;

    if (!authProviderDisabled) {
      try {
        const prov = await provisionEmployeeCredentials(loginId, DEFAULT_EMPLOYEE_PASSWORD);
        if (prov.status === 'AUTH_PROVIDER_DISABLED') {
          authProviderDisabled = true;
        } else if ((prov.status === 'CREATED' || prov.status === 'RECOVERED_EXISTING') && prov.uid) {
          authUid = prov.uid;
          credentialsProvisioned = true;
          loginsProvisioned += 1;
        }
      } catch {
        // Keep Firestore registration resilient even if individual auth provisioning fails
      }
    }

    const empDoc: Employee = {
      employeeId,
      loginId,
      authEmail: loginIdToAuthEmail(loginId),
      fullName: toCleanTitleCase(emp.salesPersonName || `Salesman ${employeeId}`).slice(0, 120),
      branchId: branch.branchId,
      branchName: branch.branchName,
      designation: emp.isSmplCandidate ? 'Sales Executive (SMPL)' : 'Sales Executive',
      role: 'EMPLOYEE',
      // Explicitly controlled by Super Admin selection — NEVER auto-assigned based on SMPL naming
      status: emp.initialStatus,
      mustChangePassword: true,
      credentialsProvisioned,
      createdAt: now,
      updatedAt: now,
      ...(authUid ? { authUid } : {}),
    };
    const empPair: Array<{
      ref: ReturnType<typeof doc>;
      data: Branch | Employee | ActiveAuthUidRecord;
    }> = [{ ref: doc(db, 'employees', employeeId), data: empDoc }];
    if (authUid && emp.initialStatus === 'ACTIVE') {
      const activeEntry: ActiveAuthUidRecord = {
        authUid,
        employeeId,
        active: true,
        updatedAt: now,
      };
      empPair.push({ ref: doc(db, 'active_auth_uids', authUid), data: activeEntry });
    }
    opGroups.push(empPair);
    employeesCreated += 1;
  }

  try {
    // Chunk atomic groups at <= 400 operations so employee + active_auth_uids pairs NEVER split across batches
    let batchOps: Array<{
      ref: ReturnType<typeof doc>;
      data: Branch | Employee | ActiveAuthUidRecord;
    }> = [];
    const flushBatch = async () => {
      if (batchOps.length === 0) return;
      const wb = writeBatch(db);
      for (const op of batchOps) {
        wb.set(op.ref, op.data);
      }
      await wb.commit();
      batchOps = [];
    };

    for (const group of opGroups) {
      if (batchOps.length + group.length > 400) {
        await flushBatch();
      }
      batchOps.push(...group);
    }
    await flushBatch();

    await recordAuditLog({
      action: 'ERP_MASTERS_REGISTERED_BY_ADMIN',
      targetType: 'master_sync',
      targetId: `SYNC_${Date.now()}`,
      summary: `Super Admin registered ${branchesCreated} new branches and ${employeesCreated} new employee candidates (${loginsProvisioned} auto-provisioned with default first-login password).`,
    });

    return { branchesCreated, employeesCreated };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'employees');
  }
}

// --- PUBLISHED INCENTIVES & MONTHLY SUMMARIES ---
export async function listAllPublishedIncentives(): Promise<PublishedIncentive[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'published_incentives'), orderBy('businessDate', 'desc')),
    );
    return snap.docs.map((d) => d.data() as PublishedIncentive);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'published_incentives');
  }
}

export async function listAllMonthlySummaries(): Promise<MonthlySummary[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'monthly_summaries'), orderBy('monthKey', 'desc')),
    );
    return snap.docs.map((d) => d.data() as MonthlySummary);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'monthly_summaries');
  }
}

export async function listImportBatches(): Promise<ImportBatch[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'import_batches'), orderBy('createdAt', 'desc')),
    );
    return snap.docs.map((d) => d.data() as ImportBatch);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'import_batches');
  }
}

export async function listBatchRows(batchId: string): Promise<ImportBatchRow[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'import_batch_rows'), where('batchId', '==', batchId)),
    );
    return snap.docs
      .map((d) => d.data() as ImportBatchRow)
      .sort((a, b) => a.rowNumber - b.rowNumber);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'import_batch_rows');
  }
}

export async function listIncentiveVersions(): Promise<IncentiveVersion[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'incentive_versions'), orderBy('archivedAt', 'desc')),
    );
    return snap.docs.map((d) => d.data() as IncentiveVersion);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'incentive_versions');
  }
}

export async function listAuditLogs(): Promise<AuditLog[]> {
  try {
    const snap = await getDocs(query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc')));
    return snap.docs.map((d) => d.data() as AuditLog);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'audit_logs');
  }
}

// --- STAGING, APPROVAL, REJECTION & TRANSACTION-LOCKED IDEMPOTENT PUBLISHING WORKFLOW ---
const PUBLISH_LOCK_STALE_MS = 5 * 60 * 1000;

export async function stageValidatedBatch(params: {
  fileName: string;
  fileSha256: string;
  importType: ImportType;
  periodStart: string;
  periodEnd: string;
  businessDate: string;
  overlapResolutionMode?: OverlapResolutionMode;
  skippedBlankRows: number;
  skippedSummaryRows: number;
  componentLabels: ComponentLabels;
  rows: Omit<ImportBatchRow, 'rowId' | 'batchId' | 'createdAt'>[];
}): Promise<{ batch: ImportBatch; rows: ImportBatchRow[] }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Super Admin authentication is required.');

  const overlapResolutionMode: OverlapResolutionMode = params.overlapResolutionMode || 'BLOCK';
  const overlapRowsCount = params.rows.filter((r) => r.validationStatus === 'PERIOD_OVERLAP').length;
  if (overlapRowsCount > 0 && overlapResolutionMode === 'BLOCK') {
    throw new Error(
      `Cannot stage batch: ${overlapRowsCount} row(s) have unresolved period overlap conflicts with existing published records.`,
    );
  }
  const missingReconcileReason = params.rows.some(
    (r) => r.resolution === 'SUPERSEDE_CONFLICTS' && (r.correctionReason || '').trim().length < 4,
  );
  if (missingReconcileReason) {
    throw new Error(
      'Cannot stage batch: Reconcile & Supersede rows require a mandatory audit reason (min 4 characters).',
    );
  }

  const now = new Date().toISOString();
  const batchId = generateRecordId('BATCH');

  const stagedRows: ImportBatchRow[] = params.rows.map((r) => ({
    ...r,
    rowId: `${batchId}_R${r.rowNumber}`,
    batchId,
    createdAt: now,
  }));

  const validRows = stagedRows.filter((r) => r.validationStatus === 'VALID').length;
  const errorRows = stagedRows.filter((r) => r.validationStatus === 'ERROR').length;
  const duplicateRows = stagedRows.filter(
    (r) => r.validationStatus === 'DUPLICATE_IN_FILE' || r.validationStatus === 'EXISTS_PUBLISHED',
  ).length;
  const correctionRows = stagedRows.filter((r) => r.resolution === 'CORRECTION').length;
  const supersededRows = stagedRows.filter((r) => r.resolution === 'SUPERSEDE_CONFLICTS').length;
  const branchTransferRows = stagedRows.filter(
    (r) => r.validationStatus === 'BRANCH_TRANSFER',
  ).length;
  const actionableStagedRows = stagedRows.filter(
    (r) =>
      r.resolution === 'PUBLISH_NEW' ||
      r.resolution === 'CORRECTION' ||
      r.resolution === 'SUPERSEDE_CONFLICTS',
  );
  const totalIncentivePaise = actionableStagedRows.reduce((acc, r) => acc + r.totalPaise, 0);
  const totalSaleAmtPaise = actionableStagedRows.reduce(
    (acc, r) => acc + (r.totalSaleAmtPaise || 0),
    0,
  );
  const totalSaleQty =
    Math.round(actionableStagedRows.reduce((acc, r) => acc + (r.totalSaleQty || 0), 0) * 100) / 100;

  const batchDoc: ImportBatch = {
    batchId,
    fileName: params.fileName.slice(0, 180),
    fileSha256: params.fileSha256.slice(0, 128),
    importType: params.importType,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    businessDate: params.businessDate.slice(0, 20),
    status: 'VALIDATED',
    overlapResolutionMode,
    totalRows: stagedRows.length,
    validRows,
    errorRows,
    duplicateRows,
    correctionRows,
    overlapRows: overlapRowsCount,
    supersededRows,
    branchTransferRows,
    skippedBlankRows: params.skippedBlankRows,
    skippedSummaryRows: params.skippedSummaryRows,
    totalIncentivePaise,
    totalSaleAmtPaise,
    totalSaleQty,
    componentLabels: params.componentLabels,
    uploadedByUid: user.uid,
    uploadedByEmail: (user.email || 'admin').slice(0, 180),
    createdAt: now,
    updatedAt: now,
  };

  try {
    const stageOps: Array<() => { ref: ReturnType<typeof doc>; data: ImportBatch | ImportBatchRow }> = [
      () => ({ ref: doc(db, 'import_batches', batchId), data: batchDoc }),
      ...stagedRows.map((row) => () => ({ ref: doc(db, 'import_batch_rows', row.rowId), data: row })),
    ];

    for (let i = 0; i < stageOps.length; i += 400) {
      const wb = writeBatch(db);
      for (const buildOp of stageOps.slice(i, i + 400)) {
        const op = buildOp();
        wb.set(op.ref, op.data);
      }
      await wb.commit();
    }

    await recordAuditLog({
      action: 'IMPORT_BATCH_STAGED',
      targetType: 'import_batch',
      targetId: batchId,
      summary: `Staged ${params.importType} batch ${params.fileName} (${params.periodStart} to ${params.periodEnd}; mode=${overlapResolutionMode}; ${validRows} valid, ${correctionRows} corrections, ${supersededRows} reconcile-supersede, ${errorRows} errors)`,
    });

    return { batch: batchDoc, rows: stagedRows };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `import_batches/${batchId}`);
  }
}

export async function approveImportBatch(batchId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required.');
  const now = new Date().toISOString();
  try {
    await updateDoc(doc(db, 'import_batches', batchId), {
      status: 'APPROVED',
      approvedByEmail: (user.email || 'admin').slice(0, 180),
      updatedAt: now,
    });
    await recordAuditLog({
      action: 'IMPORT_BATCH_APPROVED',
      targetType: 'import_batch',
      targetId: batchId,
      summary: `Approved import batch ${batchId} for publishing`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `import_batches/${batchId}`);
  }
}

export async function rejectImportBatch(batchId: string, reason: string): Promise<void> {
  const now = new Date().toISOString();
  try {
    await updateDoc(doc(db, 'import_batches', batchId), {
      status: 'REJECTED',
      rejectionReason: reason.trim().slice(0, 300) || 'Rejected by Super Admin during review.',
      updatedAt: now,
    });
    await recordAuditLog({
      action: 'IMPORT_BATCH_REJECTED',
      targetType: 'import_batch',
      targetId: batchId,
      summary: `Rejected import batch ${batchId}: ${reason.trim().slice(0, 200)}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `import_batches/${batchId}`);
  }
}

/**
 * Safe Transaction-Locked, Idempotent & Retryable Publishing (Issues 4 & 5):
 * 1. Acquires atomic `APPROVED/FAILED -> PROCESSING` lock via Firestore `runTransaction`.
 * 2. Supports Option A (`SKIP_OVERLAP`) & Option B (`RECONCILE_SUPERSEDE` soft-marking prior records `SUPERSEDED`).
 * 3. Uses deterministic IDs for `published_incentives`, `incentive_versions`, `monthly_summaries`, and `notifications`
 *    so retries after partial failure NEVER duplicate incentives, versions, or notifications.
 * 4. Transitions batch to `FAILED` with `lastPublishError` on any error so Super Admin can safely retry.
 */
export async function publishApprovedBatch(params: {
  batch: ImportBatch;
  rows: ImportBatchRow[];
  employeesById: Record<string, Employee>;
}): Promise<{ publishedCount: number; correctedCount: number; supersededCount: number }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required.');

  const actionableRows = params.rows.filter(
    (r) =>
      (r.resolution === 'PUBLISH_NEW' && r.validationStatus === 'VALID') ||
      (r.resolution === 'CORRECTION' && r.validationStatus === 'EXISTS_PUBLISHED') ||
      (r.resolution === 'SUPERSEDE_CONFLICTS' && r.validationStatus === 'PERIOD_OVERLAP'),
  );

  if (actionableRows.length === 0) {
    throw new Error('No publishable, correction, or reconciled rows exist in this batch.');
  }

  const batchRef = doc(db, 'import_batches', params.batch.batchId);
  const lockId = generateRecordId('LOCK');
  const now = new Date().toISOString();

  // STEP 1: Acquire atomic publish lock via runTransaction (prevents concurrent double-publish)
  let lockedBatch: ImportBatch;
  try {
    lockedBatch = await runTransaction(db, async (tx) => {
      const snap = await tx.get(batchRef);
      if (!snap.exists()) {
        throw new Error(`Import batch ${params.batch.batchId} not found.`);
      }
      const current = snap.data() as ImportBatch;
      if (current.status === 'PUBLISHED') {
        throw new Error(`Batch ${params.batch.batchId} is already PUBLISHED.`);
      }
      if (current.status === 'REJECTED') {
        throw new Error(`Batch ${params.batch.batchId} was REJECTED and cannot be published.`);
      }
      if (current.status === 'PROCESSING') {
        const startedMs = current.publishStartedAt ? Date.parse(current.publishStartedAt) : 0;
        const isStale = startedMs > 0 && Date.now() - startedMs > PUBLISH_LOCK_STALE_MS;
        if (!isStale) {
          throw new Error(
            `Batch ${params.batch.batchId} is currently PROCESSING in another session. Please wait before retrying.`,
          );
        }
      } else if (current.status !== 'APPROVED' && current.status !== 'FAILED') {
        throw new Error(
          `Batch ${params.batch.batchId} must be APPROVED (or FAILED for retry) before publishing. Current status: ${current.status}.`,
        );
      }

      const nextAttempts = (current.publishAttemptCount || 0) + 1;
      tx.update(batchRef, {
        status: 'PROCESSING',
        publishLockId: lockId,
        publishStartedAt: now,
        publishAttemptCount: nextAttempts,
        lastPublishError: '',
        updatedAt: now,
      });

      return {
        ...current,
        status: 'PROCESSING',
        publishLockId: lockId,
        publishStartedAt: now,
        publishAttemptCount: nextAttempts,
      };
    });
  } catch (error) {
    if (error instanceof Error && !error.message.includes('permission')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, `import_batches/${params.batch.batchId}`);
  }

  const labels: ComponentLabels = lockedBatch.componentLabels || {
    component1: 'New Items Sale',
    component2: 'Old Items Sale',
    component3: 'Other Items Sale',
  };

  try {
    // Fetch current published records to enforce fresh overlap protection & double-counting-safe summaries
    const existingPublishedList = await listAllPublishedIncentives();
    const publishedMap = new Map<string, PublishedIncentive>();
    for (const rec of existingPublishedList) {
      publishedMap.set(rec.recordId, rec);
    }

    const batchImportType: ImportType = lockedBatch.importType || 'DAILY';
    const batchPeriodStart = lockedBatch.periodStart || lockedBatch.businessDate;
    const batchPeriodEnd = lockedBatch.periodEnd || lockedBatch.businessDate;

    // Hard overlap safety check & conflict collection
    const conflictsByRowNumber = new Map<number, PublishedIncentive[]>();
    for (const row of actionableRows) {
      const rowImportType: ImportType = row.importType || batchImportType;
      const rowStart = row.periodStart || batchPeriodStart;
      const rowEnd = row.periodEnd || batchPeriodEnd;
      const recordId = getIncentiveRecordKey(rowImportType, rowStart, rowEnd, row.employeeId);
      const conflicts = detectPeriodOverlapsForEmployee({
        employeeId: row.employeeId,
        incomingImportType: rowImportType,
        incomingStart: rowStart,
        incomingEnd: rowEnd,
        incomingRecordKey: recordId,
        publishedIncentives: existingPublishedList,
      });

      if (conflicts.length > 0) {
        if (row.resolution === 'SUPERSEDE_CONFLICTS') {
          const reason = (row.correctionReason || '').trim();
          if (reason.length < 4) {
            throw new Error(
              `Publish blocked: Salesman No ${row.employeeId} reconciliation requires a mandatory audit reason (min 4 characters).`,
            );
          }
          const matchingDocs = conflicts
            .map((c) => publishedMap.get(c.conflictingRecordId))
            .filter((d): d is PublishedIncentive => Boolean(d && d.status === 'PUBLISHED'));
          conflictsByRowNumber.set(row.rowNumber, matchingDocs);
        } else {
          throw new Error(
            `Publish blocked: Salesman No ${row.employeeId} (${rowImportType} ${rowStart} to ${rowEnd}) overlaps existing published ${conflicts[0].conflictingImportType} record (${conflicts[0].conflictingPeriodStart} to ${conflicts[0].conflictingPeriodEnd}).`,
          );
        }
      }
    }

    let publishedCount = 0;
    let correctedCount = 0;
    let supersededCount = 0;
    const affectedSummaryKeys = new Map<string, { employee: Employee; monthKey: string }>();
    const pendingSets: Array<{ ref: ReturnType<typeof doc>; data: unknown }> = [];

    for (const row of actionableRows) {
      const emp = params.employeesById[sanitizeId(row.employeeId)];
      if (!emp) continue;

      const rowImportType: ImportType = row.importType || batchImportType;
      const rowStart = row.periodStart || batchPeriodStart;
      const rowEnd = row.periodEnd || batchPeriodEnd;
      const recordId = getIncentiveRecordKey(rowImportType, rowStart, rowEnd, row.employeeId);
      const businessDate = rowImportType === 'DAILY' ? rowStart : rowEnd;
      const monthKey = rowStart.slice(0, 7);

      const existingSnap = await getDoc(doc(db, 'published_incentives', recordId));
      const existingRec = existingSnap.exists() ? (existingSnap.data() as PublishedIncentive) : null;

      // Retry idempotency: if this exact batch already wrote this record in a previous partial attempt, skip rewriting record/version
      const alreadyAppliedByThisBatch = existingRec?.batchId === lockedBatch.batchId;

      if (!alreadyAppliedByThisBatch) {
        // Option B Reconciliation: Soft-supersede conflicting prior published records (NEVER delete!)
        if (row.resolution === 'SUPERSEDE_CONFLICTS') {
          const conflictingDocs = conflictsByRowNumber.get(row.rowNumber) || [];
          const supersedeReason = (row.correctionReason || 'Reconciled by Super Admin').trim().slice(0, 240);
          for (const prior of conflictingDocs) {
            const supersededDoc: PublishedIncentive = {
              ...prior,
              status: 'SUPERSEDED',
              supersededByBatchId: lockedBatch.batchId,
              supersededByRecordId: recordId,
              supersededAt: now,
              supersededReason: supersedeReason,
            };
            pendingSets.push({
              ref: doc(db, 'published_incentives', prior.recordId),
              data: supersededDoc,
            });
            publishedMap.set(prior.recordId, supersededDoc);
            affectedSummaryKeys.set(`${emp.employeeId}_${prior.monthKey}`, {
              employee: emp,
              monthKey: prior.monthKey,
            });
            supersededCount += 1;
          }
        }

        if (existingRec && existingRec.status === 'PUBLISHED' && row.resolution !== 'CORRECTION') {
          // Strict safeguard: never silently overwrite previously published records
          continue;
        }

        if (existingRec && existingRec.status === 'PUBLISHED' && row.resolution === 'CORRECTION') {
          const { updatedRecord, versionSnapshot } = applyPublishedCorrection({
            existingRecord: existingRec,
            newComponent1Paise: row.component1Paise,
            newComponent2Paise: row.component2Paise,
            newComponent3Paise: row.component3Paise,
            newSaleAmt1Paise: row.saleAmt1Paise ?? 0,
            newSaleQty1: row.saleQty1 ?? 0,
            newSaleAmt2Paise: row.saleAmt2Paise ?? 0,
            newSaleQty2: row.saleQty2 ?? 0,
            newSaleAmt3Paise: row.saleAmt3Paise ?? 0,
            newSaleQty3: row.saleQty3 ?? 0,
            newTotalSaleAmtPaise: row.totalSaleAmtPaise ?? 0,
            newTotalSaleQty: row.totalSaleQty ?? 0,
            correctionReason: row.correctionReason || 'Approved batch correction',
            batchId: lockedBatch.batchId,
            actorEmail: user.email || 'admin',
            now,
            employeeName: emp.fullName,
            branchId: emp.branchId,
            branchName: emp.branchName,
            authUid: emp.authUid || '',
          });

          const deterministicVerId = getDeterministicVersionId(recordId, lockedBatch.batchId);
          const existingVerSnap = await getDoc(doc(db, 'incentive_versions', deterministicVerId));
          if (!existingVerSnap.exists()) {
            pendingSets.push({
              ref: doc(db, 'incentive_versions', deterministicVerId),
              data: { ...versionSnapshot, versionId: deterministicVerId },
            });
          }

          pendingSets.push({
            ref: doc(db, 'published_incentives', recordId),
            data: updatedRecord,
          });
          publishedMap.set(recordId, updatedRecord);
          correctedCount += 1;
        } else {
          const saleAmt1Paise = row.saleAmt1Paise ?? 0;
          const saleQty1 = row.saleQty1 ?? 0;
          const saleAmt2Paise = row.saleAmt2Paise ?? 0;
          const saleQty2 = row.saleQty2 ?? 0;
          const saleAmt3Paise = row.saleAmt3Paise ?? 0;
          const saleQty3 = row.saleQty3 ?? 0;
          const totalSaleAmtPaise =
            row.totalSaleAmtPaise ?? saleAmt1Paise + saleAmt2Paise + saleAmt3Paise;
          const totalSaleQty =
            row.totalSaleQty ?? Math.round((saleQty1 + saleQty2 + saleQty3) * 100) / 100;

          const newRecord: PublishedIncentive = {
            recordId,
            importType: rowImportType,
            periodStart: rowStart,
            periodEnd: rowEnd,
            businessDate,
            monthKey,
            employeeId: emp.employeeId,
            authUid: emp.authUid || '',
            employeeName: emp.fullName,
            branchId: emp.branchId,
            branchName: emp.branchName,
            component1Label: labels.component1,
            component2Label: labels.component2,
            component3Label: labels.component3,
            component1Paise: row.component1Paise,
            component2Paise: row.component2Paise,
            component3Paise: row.component3Paise,
            totalPaise: row.totalPaise,
            saleAmt1Paise,
            saleQty1,
            saleAmt2Paise,
            saleQty2,
            saleAmt3Paise,
            saleQty3,
            totalSaleAmtPaise,
            totalSaleQty,
            status: 'PUBLISHED',
            version: 1,
            batchId: lockedBatch.batchId,
            publishedAt: now,
            publishedByEmail: (user.email || 'admin').slice(0, 180),
          };
          pendingSets.push({ ref: doc(db, 'published_incentives', recordId), data: newRecord });
          publishedMap.set(recordId, newRecord);
          publishedCount += 1;
        }
      }

      // Only DAILY and MONTHLY records affect monthly_summaries (CUSTOM_PERIOD stays logically separate!)
      if (rowImportType === 'DAILY' || rowImportType === 'MONTHLY') {
        affectedSummaryKeys.set(`${emp.employeeId}_${monthKey}`, { employee: emp, monthKey });
      }

      // Deterministic notification ID: prevents duplicate notifications on retry
      const notifId = getDeterministicNotificationId(lockedBatch.batchId, emp.employeeId);
      const existingNotifSnap = await getDoc(doc(db, 'notifications', notifId));
      if (!existingNotifSnap.exists()) {
        const periodText =
          rowImportType === 'DAILY'
            ? formatShortDate(rowStart)
            : `${formatShortDate(rowStart)} to ${formatShortDate(rowEnd)}`;
        const typeLabel = formatImportTypeLabel(rowImportType);

        const notif: EmployeeNotification = {
          notificationId: notifId,
          employeeId: emp.employeeId,
          authUid: emp.authUid || '',
          title:
            existingRec && row.resolution === 'CORRECTION'
              ? `${typeLabel} Revised`
              : `${typeLabel} Published`,
          message:
            existingRec && row.resolution === 'CORRECTION'
              ? `Your ${typeLabel.toLowerCase()} for ${periodText} has been revised and published.`
              : `Your ${typeLabel.toLowerCase()} for ${periodText} is now available in your statement.`,
          importType: rowImportType,
          periodStart: rowStart,
          periodEnd: rowEnd,
          businessDate,
          batchId: lockedBatch.batchId,
          read: false,
          createdAt: now,
        };
        pendingSets.push({ ref: doc(db, 'notifications', notifId), data: notif });
      }
    }

    // Recompute affected monthly_summaries cleanly from post-publish PUBLISHED records only (ZERO double counting)
    const allPostPublishRecords = Array.from(publishedMap.values());
    const pendingDeletes: Array<ReturnType<typeof doc>> = [];
    for (const [summaryId, info] of affectedSummaryKeys.entries()) {
      const summaryDoc = buildMonthlySummaryDocument({
        records: allPostPublishRecords,
        employee: info.employee,
        monthKey: info.monthKey,
        now,
      });
      if (summaryDoc.sourceType === 'NO_DATA') {
        pendingDeletes.push(doc(db, 'monthly_summaries', summaryId));
      } else {
        pendingSets.push({ ref: doc(db, 'monthly_summaries', summaryId), data: summaryDoc });
      }
    }

    for (let i = 0; i < pendingSets.length; i += 400) {
      const wb = writeBatch(db);
      for (const op of pendingSets.slice(i, i + 400)) {
        wb.set(op.ref, op.data);
      }
      await wb.commit();
    }
    for (let i = 0; i < pendingDeletes.length; i += 400) {
      const wb = writeBatch(db);
      for (const ref of pendingDeletes.slice(i, i + 400)) {
        wb.delete(ref);
      }
      await wb.commit();
    }

    await updateDoc(batchRef, {
      status: 'PUBLISHED',
      publishedByEmail: (user.email || 'admin').slice(0, 180),
      supersededRows: supersededCount,
      lastPublishError: '',
      updatedAt: now,
    });

    await recordAuditLog({
      action: 'IMPORT_BATCH_PUBLISHED',
      targetType: 'import_batch',
      targetId: lockedBatch.batchId,
      summary: `Published ${batchImportType} batch ${lockedBatch.batchId} (${batchPeriodStart} to ${batchPeriodEnd}): ${publishedCount} new, ${correctedCount} corrections, ${supersededCount} prior conflicting records soft-superseded.`,
    });

    if (supersededCount > 0) {
      await recordAuditLog({
        action: 'INCENTIVE_OVERLAP_RECONCILED',
        targetType: 'import_batch',
        targetId: lockedBatch.batchId,
        summary: `Reconciled ${supersededCount} overlapping prior published incentive record(s) to SUPERSEDED status during batch ${lockedBatch.batchId} (history preserved, zero double counting).`,
      });
    }

    return { publishedCount, correctedCount, supersededCount };
  } catch (error) {
    const errMsg = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    // Safely unlock batch into FAILED state so Super Admin can inspect and retry idempotently
    try {
      await updateDoc(batchRef, {
        status: 'FAILED',
        lastPublishError: errMsg,
        updatedAt: new Date().toISOString(),
      });
      await recordAuditLog({
        action: 'IMPORT_BATCH_PUBLISH_FAILED',
        targetType: 'import_batch',
        targetId: lockedBatch.batchId,
        summary: `Batch ${lockedBatch.batchId} publish failed and transitioned to FAILED for safe retry: ${errMsg.slice(0, 240)}`,
      });
    } catch {
      // Preserve original failure error
    }
    throw error;
  }
}

function collectMonthKeysInRange(startDate?: string, endDate?: string): string[] {
  const startMonth = (startDate || '').slice(0, 7);
  const endMonth = (endDate || startDate || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(startMonth)) return [];
  if (!/^\d{4}-\d{2}$/.test(endMonth) || endMonth < startMonth) return [startMonth];
  const out: string[] = [];
  let [y, m] = startMonth.split('-').map(Number);
  const [ey, em] = endMonth.split('-').map(Number);
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard < 24) {
    out.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    guard += 1;
  }
  return out;
}

async function recomputeAffectedMonthlySummaries(params: {
  affectedPairs: Array<{ employeeId: string; monthKey: string; fallbackRec?: PublishedIncentive }>;
  affectedMonthKeys?: string[];
  employeesById: Record<string, Employee>;
  now: string;
}): Promise<void> {
  const uniqueMap = new Map<
    string,
    { employeeId: string; monthKey: string; fallbackRec?: PublishedIncentive }
  >();
  const monthKeySet = new Set<string>();

  for (const mk of params.affectedMonthKeys || []) {
    if (/^\d{4}-\d{2}$/.test(mk)) monthKeySet.add(mk);
  }
  for (const item of params.affectedPairs) {
    const cleanEmpId = sanitizeId(item.employeeId);
    if (!cleanEmpId || !item.monthKey || !/^\d{4}-\d{2}$/.test(item.monthKey)) continue;
    monthKeySet.add(item.monthKey);
    const summaryId = `${cleanEmpId}_${item.monthKey}`;
    if (!uniqueMap.has(summaryId)) {
      uniqueMap.set(summaryId, {
        employeeId: cleanEmpId,
        monthKey: item.monthKey,
        fallbackRec: item.fallbackRec,
      });
    }
  }
  if (uniqueMap.size === 0 && monthKeySet.size === 0) return;

  const currentPublished = await listAllPublishedIncentives();
  const opsByPath = new Map<
    string,
    | { type: 'set'; ref: ReturnType<typeof doc>; data: MonthlySummary }
    | { type: 'delete'; ref: ReturnType<typeof doc> }
  >();

  for (const [summaryId, info] of uniqueMap.entries()) {
    const emp = params.employeesById[info.employeeId];
    const fallback = info.fallbackRec;
    const syntheticEmployee: Employee | null =
      emp ||
      (fallback
        ? {
            employeeId: fallback.employeeId,
            loginId: `EMP${fallback.employeeId}`,
            authEmail: '',
            authUid: fallback.authUid || '',
            fullName: fallback.employeeName,
            branchId: fallback.branchId,
            branchName: fallback.branchName,
            designation: 'Sales Executive',
            role: 'EMPLOYEE',
            status: 'ACTIVE',
            mustChangePassword: false,
            createdAt: params.now,
            updatedAt: params.now,
          }
        : null);

    const ref = doc(db, 'monthly_summaries', summaryId);
    if (!syntheticEmployee) {
      opsByPath.set(ref.path, { type: 'delete', ref });
      continue;
    }

    const summaryDoc = buildMonthlySummaryDocument({
      records: currentPublished,
      employee: syntheticEmployee,
      monthKey: info.monthKey,
      now: params.now,
    });

    if (summaryDoc.sourceType === 'NO_DATA') {
      opsByPath.set(ref.path, { type: 'delete', ref });
    } else {
      opsByPath.set(ref.path, { type: 'set', ref, data: summaryDoc });
    }
  }

  // Sweep all existing monthly_summaries docs in every affected monthKey so zero orphaned or NO_DATA docs remain
  for (const mk of monthKeySet) {
    const monthSnap = await getDocs(
      query(collection(db, 'monthly_summaries'), where('monthKey', '==', mk)),
    );
    for (const snapDoc of monthSnap.docs) {
      if (opsByPath.has(snapDoc.ref.path)) continue;
      const existing = snapDoc.data() as MonthlySummary;
      const cleanEmpId = sanitizeId(existing.employeeId || '');
      const emp: Employee = params.employeesById[cleanEmpId] || {
        employeeId: cleanEmpId || existing.employeeId,
        loginId: `EMP${cleanEmpId || existing.employeeId}`,
        authEmail: '',
        authUid: existing.authUid || '',
        fullName: existing.employeeName || 'Employee',
        branchId: existing.branchId || '',
        branchName: existing.branchName || '',
        designation: 'Sales Executive',
        role: 'EMPLOYEE',
        status: 'ACTIVE',
        mustChangePassword: false,
        createdAt: params.now,
        updatedAt: params.now,
      };
      const recomputed = buildMonthlySummaryDocument({
        records: currentPublished,
        employee: emp,
        monthKey: mk,
        now: params.now,
      });
      if (recomputed.sourceType === 'NO_DATA') {
        opsByPath.set(snapDoc.ref.path, { type: 'delete', ref: snapDoc.ref });
      }
    }
  }

  const ops = Array.from(opsByPath.values());
  for (let i = 0; i < ops.length; i += 400) {
    const wb = writeBatch(db);
    for (const op of ops.slice(i, i + 400)) {
      if (op.type === 'delete') {
        wb.delete(op.ref);
      } else {
        wb.set(op.ref, op.data);
      }
    }
    await wb.commit();
  }
}

export async function updateImportBatch(params: {
  batch: ImportBatch;
  fileName: string;
  correctionNote: string;
  importType?: ImportType;
  periodStart?: string;
  periodEnd?: string;
  updatedRows: ImportBatchRow[];
  deletedRowIds: string[];
  employeesById: Record<string, Employee>;
}): Promise<{
  updatedRowCount: number;
  deletedRowCount: number;
  publishedRecordsUpdated: number;
  publishedRecordsDeleted: number;
}> {
  const user = auth.currentUser;
  if (!user) throw new Error('Super Admin authentication required.');
  if (params.batch.status === 'PROCESSING') {
    throw new Error('Cannot edit a batch while it is currently PROCESSING.');
  }
  if (params.batch.status === 'REJECTED') {
    throw new Error('Rejected batches cannot be edited. Delete the batch or upload a new file.');
  }

  const cleanFileName = params.fileName.trim().slice(0, 180);
  if (!cleanFileName) {
    throw new Error('Batch file name cannot be empty.');
  }
  const cleanNote = params.correctionNote.trim().slice(0, 300);
  const isPublished = params.batch.status === 'PUBLISHED';
  if (isPublished && cleanNote.length < 4) {
    throw new Error(
      'An audit / update reason (minimum 4 characters) is required when editing a PUBLISHED batch.',
    );
  }

  const now = new Date().toISOString();
  const deletedIdSet = new Set(params.deletedRowIds);
  const nextImportType: ImportType = isPublished
    ? params.batch.importType || 'DAILY'
    : params.importType || params.batch.importType || 'DAILY';
  const nextPeriodStart = isPublished
    ? params.batch.periodStart || params.batch.businessDate
    : (params.periodStart || params.batch.periodStart || params.batch.businessDate).trim();
  const nextPeriodEnd = isPublished
    ? params.batch.periodEnd || params.batch.businessDate
    : nextImportType === 'DAILY'
      ? nextPeriodStart
      : (params.periodEnd || params.batch.periodEnd || params.batch.businessDate).trim();
  const nextBusinessDate = nextImportType === 'DAILY' ? nextPeriodStart : nextPeriodEnd;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextPeriodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(nextPeriodEnd)) {
    throw new Error('Period start and end dates must be valid YYYY-MM-DD dates.');
  }
  if (nextPeriodStart > nextPeriodEnd) {
    throw new Error('Period start date cannot be after period end date.');
  }

  const normalizedRemainingRows: ImportBatchRow[] = params.updatedRows
    .filter((r) => !deletedIdSet.has(r.rowId))
    .map((r) => {
      const c1 = Math.max(0, Math.round(r.component1Paise || 0));
      const c2 = Math.max(0, Math.round(r.component2Paise || 0));
      const c3 = Math.max(0, Math.round(r.component3Paise || 0));
      const sa1 = Math.max(0, Math.round(r.saleAmt1Paise || 0));
      const sa2 = Math.max(0, Math.round(r.saleAmt2Paise || 0));
      const sa3 = Math.max(0, Math.round(r.saleAmt3Paise || 0));
      const sq1 = Math.max(0, Math.round((r.saleQty1 || 0) * 100) / 100);
      const sq2 = Math.max(0, Math.round((r.saleQty2 || 0) * 100) / 100);
      const sq3 = Math.max(0, Math.round((r.saleQty3 || 0) * 100) / 100);
      return {
        ...r,
        importType: nextImportType,
        periodStart: nextPeriodStart,
        periodEnd: nextPeriodEnd,
        businessDate: nextBusinessDate,
        component1Paise: c1,
        component2Paise: c2,
        component3Paise: c3,
        totalPaise: c1 + c2 + c3,
        saleAmt1Paise: sa1,
        saleQty1: sq1,
        saleAmt2Paise: sa2,
        saleQty2: sq2,
        saleAmt3Paise: sa3,
        saleQty3: sq3,
        totalSaleAmtPaise: sa1 + sa2 + sa3,
        totalSaleQty: Math.round((sq1 + sq2 + sq3) * 100) / 100,
        ...(isPublished ? { correctionReason: cleanNote.slice(0, 240) } : {}),
      };
    });

  const actionableRows = normalizedRemainingRows.filter((r) => r.resolution !== 'SKIP');
  const totalIncentivePaise = actionableRows.reduce((s, r) => s + r.totalPaise, 0);
  const totalSaleAmtPaise = actionableRows.reduce((s, r) => s + (r.totalSaleAmtPaise || 0), 0);
  const totalSaleQty =
    Math.round(actionableRows.reduce((s, r) => s + (r.totalSaleQty || 0), 0) * 100) / 100;
  const validRows = normalizedRemainingRows.filter(
    (r) => r.validationStatus === 'VALID' || r.validationStatus === 'BRANCH_TRANSFER',
  ).length;

  type BatchOp =
    | { type: 'set'; ref: ReturnType<typeof doc>; data: unknown }
    | { type: 'delete'; ref: ReturnType<typeof doc> };
  const ops: BatchOp[] = [];
  const affectedSummaryPairs: Array<{
    employeeId: string;
    monthKey: string;
    fallbackRec?: PublishedIncentive;
  }> = [];

  let publishedRecordsUpdated = 0;
  let publishedRecordsDeleted = 0;

  try {
    // Load existing batch rows so we know which employeeIds belonged to deletedRowIds
    const existingBatchRows = await listBatchRows(params.batch.batchId);
    const existingRowsById = new Map(existingBatchRows.map((r) => [r.rowId, r]));

    // Map published_incentives belonging to this batch if PUBLISHED
    const batchPublishedByRecordId = new Map<string, PublishedIncentive>();
    const batchPublishedByEmpId = new Map<string, PublishedIncentive>();
    if (isPublished) {
      const pubSnap = await getDocs(
        query(collection(db, 'published_incentives'), where('batchId', '==', params.batch.batchId)),
      );
      for (const d of pubSnap.docs) {
        const rec = d.data() as PublishedIncentive;
        batchPublishedByRecordId.set(rec.recordId, rec);
        batchPublishedByEmpId.set(sanitizeId(rec.employeeId), rec);
      }
    }

    // 1. Update remaining rows (and sync published_incentives + version history if PUBLISHED)
    for (const row of normalizedRemainingRows) {
      ops.push({ type: 'set', ref: doc(db, 'import_batch_rows', row.rowId), data: row });

      if (isPublished && row.resolution !== 'SKIP') {
        const expectedRecId = getIncentiveRecordKey(
          nextImportType,
          nextPeriodStart,
          nextPeriodEnd,
          row.employeeId,
        );
        const existingRec =
          batchPublishedByRecordId.get(expectedRecId) ||
          batchPublishedByEmpId.get(sanitizeId(row.employeeId));

        if (existingRec && existingRec.status === 'PUBLISHED') {
          const changed =
            existingRec.component1Paise !== row.component1Paise ||
            existingRec.component2Paise !== row.component2Paise ||
            existingRec.component3Paise !== row.component3Paise ||
            (existingRec.saleAmt1Paise ?? 0) !== (row.saleAmt1Paise ?? 0) ||
            (existingRec.saleQty1 ?? 0) !== (row.saleQty1 ?? 0) ||
            (existingRec.saleAmt2Paise ?? 0) !== (row.saleAmt2Paise ?? 0) ||
            (existingRec.saleQty2 ?? 0) !== (row.saleQty2 ?? 0) ||
            (existingRec.saleAmt3Paise ?? 0) !== (row.saleAmt3Paise ?? 0) ||
            (existingRec.saleQty3 ?? 0) !== (row.saleQty3 ?? 0);

          if (changed) {
            const emp = params.employeesById[sanitizeId(row.employeeId)];
            const { updatedRecord, versionSnapshot } = applyPublishedCorrection({
              existingRecord: existingRec,
              newComponent1Paise: row.component1Paise,
              newComponent2Paise: row.component2Paise,
              newComponent3Paise: row.component3Paise,
              newSaleAmt1Paise: row.saleAmt1Paise ?? 0,
              newSaleQty1: row.saleQty1 ?? 0,
              newSaleAmt2Paise: row.saleAmt2Paise ?? 0,
              newSaleQty2: row.saleQty2 ?? 0,
              newSaleAmt3Paise: row.saleAmt3Paise ?? 0,
              newSaleQty3: row.saleQty3 ?? 0,
              newTotalSaleAmtPaise: row.totalSaleAmtPaise ?? 0,
              newTotalSaleQty: row.totalSaleQty ?? 0,
              correctionReason: cleanNote.slice(0, 240),
              batchId: params.batch.batchId,
              actorEmail: user.email || 'admin',
              now,
              employeeName: emp?.fullName || existingRec.employeeName,
              branchId: emp?.branchId || existingRec.branchId,
              branchName: emp?.branchName || existingRec.branchName,
              authUid: emp?.authUid || existingRec.authUid || '',
            });

            const versionId = generateRecordId('VER');
            ops.push({
              type: 'set',
              ref: doc(db, 'incentive_versions', versionId),
              data: { ...versionSnapshot, versionId },
            });
            ops.push({
              type: 'set',
              ref: doc(db, 'published_incentives', existingRec.recordId),
              data: updatedRecord,
            });
            affectedSummaryPairs.push({
              employeeId: existingRec.employeeId,
              monthKey: existingRec.monthKey,
              fallbackRec: updatedRecord,
            });
            publishedRecordsUpdated += 1;
          }
        }
      }
    }

    // 2. Delete removed rows (and remove their published_incentives docs if PUBLISHED)
    for (const delRowId of params.deletedRowIds) {
      ops.push({ type: 'delete', ref: doc(db, 'import_batch_rows', delRowId) });
      if (isPublished) {
        const oldRow = existingRowsById.get(delRowId);
        if (oldRow) {
          const expectedRecId = getIncentiveRecordKey(
            nextImportType,
            nextPeriodStart,
            nextPeriodEnd,
            oldRow.employeeId,
          );
          const existingRec =
            batchPublishedByRecordId.get(expectedRecId) ||
            batchPublishedByEmpId.get(sanitizeId(oldRow.employeeId));
          if (existingRec && existingRec.batchId === params.batch.batchId) {
            ops.push({
              type: 'delete',
              ref: doc(db, 'published_incentives', existingRec.recordId),
            });
            affectedSummaryPairs.push({
              employeeId: existingRec.employeeId,
              monthKey: existingRec.monthKey,
              fallbackRec: existingRec,
            });
            publishedRecordsDeleted += 1;
          }
        }
      }
    }

    // Commit row, version, and published_incentives updates in chunks of 400
    for (let i = 0; i < ops.length; i += 400) {
      const wb = writeBatch(db);
      for (const op of ops.slice(i, i + 400)) {
        if (op.type === 'delete') {
          wb.delete(op.ref);
        } else {
          wb.set(op.ref, op.data);
        }
      }
      await wb.commit();
    }

    // 3. Update parent import_batches metadata & totals
    const batchPatch: Record<string, unknown> = {
      fileName: cleanFileName,
      totalRows: normalizedRemainingRows.length,
      validRows,
      totalIncentivePaise,
      totalSaleAmtPaise,
      totalSaleQty,
      updatedAt: now,
    };
    if (cleanNote) {
      batchPatch.correctionNote = cleanNote;
    }
    if (isPublished) {
      batchPatch.correctionRows =
        (params.batch.correctionRows || 0) + publishedRecordsUpdated;
    } else {
      batchPatch.importType = nextImportType;
      batchPatch.periodStart = nextPeriodStart;
      batchPatch.periodEnd = nextPeriodEnd;
      batchPatch.businessDate = nextBusinessDate;
    }
    await updateDoc(doc(db, 'import_batches', params.batch.batchId), batchPatch);

    // 4. Recompute affected employees' monthly summaries if PUBLISHED records changed
    if (isPublished && affectedSummaryPairs.length > 0) {
      await recomputeAffectedMonthlySummaries({
        affectedPairs: affectedSummaryPairs,
        employeesById: params.employeesById,
        now,
      });
    }

    await recordAuditLog({
      action: 'IMPORT_BATCH_UPDATED',
      targetType: 'import_batch',
      targetId: params.batch.batchId,
      summary: `Updated ${params.batch.status} batch ${params.batch.batchId} (${cleanFileName}): ${normalizedRemainingRows.length} row(s) retained, ${params.deletedRowIds.length} row(s) removed${
        isPublished
          ? `, ${publishedRecordsUpdated} published record(s) revised (versioned), ${publishedRecordsDeleted} published record(s) removed`
          : ''
      }${cleanNote ? `. Note: ${cleanNote.slice(0, 140)}` : ''}`,
    });

    return {
      updatedRowCount: normalizedRemainingRows.length,
      deletedRowCount: params.deletedRowIds.length,
      publishedRecordsUpdated,
      publishedRecordsDeleted,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `import_batches/${params.batch.batchId}`);
  }
}

export async function deleteImportBatch(params: {
  batch: ImportBatch;
  reason?: string;
  employeesById: Record<string, Employee>;
}): Promise<{
  deletedRowsCount: number;
  deletedPublishedCount: number;
  deletedNotificationsCount: number;
}> {
  const user = auth.currentUser;
  if (!user) throw new Error('Super Admin authentication required.');
  if (params.batch.status === 'PROCESSING') {
    const startedMs = params.batch.publishStartedAt ? Date.parse(params.batch.publishStartedAt) : 0;
    const isStale = startedMs > 0 && Date.now() - startedMs > PUBLISH_LOCK_STALE_MS;
    if (!isStale) {
      throw new Error(
        `Batch ${params.batch.batchId} is currently PROCESSING. Wait for it to finish before deleting.`,
      );
    }
  }

  const now = new Date().toISOString();
  const cleanReason = (params.reason || '').trim().slice(0, 240);

  try {
    const rowsSnap = await getDocs(
      query(collection(db, 'import_batch_rows'), where('batchId', '==', params.batch.batchId)),
    );

    const shouldCleanPublished =
      params.batch.status === 'PUBLISHED' || params.batch.status === 'FAILED';

    let publishedEntries: Array<{ ref: ReturnType<typeof doc>; data: PublishedIncentive }> = [];
    let notificationRefs: Array<ReturnType<typeof doc>> = [];

    if (shouldCleanPublished) {
      const [pubSnap, notifSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'published_incentives'),
            where('batchId', '==', params.batch.batchId),
          ),
        ),
        getDocs(
          query(collection(db, 'notifications'), where('batchId', '==', params.batch.batchId)),
        ),
      ]);
      publishedEntries = pubSnap.docs.map((d) => ({
        ref: d.ref,
        data: d.data() as PublishedIncentive,
      }));
      notificationRefs = notifSnap.docs.map((d) => d.ref);
    }

    const deleteRefs: Array<ReturnType<typeof doc>> = [];
    const affectedSummaryPairs: Array<{
      employeeId: string;
      monthKey: string;
      fallbackRec?: PublishedIncentive;
    }> = [];
    const affectedMonthKeys = new Set<string>(
      collectMonthKeysInRange(
        params.batch.periodStart || params.batch.businessDate,
        params.batch.periodEnd || params.batch.businessDate,
      ),
    );

    for (const entry of publishedEntries) {
      deleteRefs.push(entry.ref);
      if (entry.data.monthKey) affectedMonthKeys.add(entry.data.monthKey);
      affectedSummaryPairs.push({
        employeeId: entry.data.employeeId,
        monthKey: entry.data.monthKey,
        fallbackRec: entry.data,
      });
    }
    for (const nRef of notificationRefs) {
      deleteRefs.push(nRef);
    }
    for (const rDoc of rowsSnap.docs) {
      const rData = rDoc.data() as ImportBatchRow;
      for (const mk of collectMonthKeysInRange(
        rData.periodStart || rData.businessDate,
        rData.periodEnd || rData.businessDate,
      )) {
        affectedMonthKeys.add(mk);
      }
      deleteRefs.push(rDoc.ref);
    }
    deleteRefs.push(doc(db, 'import_batches', params.batch.batchId));

    for (let i = 0; i < deleteRefs.length; i += 400) {
      const wb = writeBatch(db);
      for (const ref of deleteRefs.slice(i, i + 400)) {
        wb.delete(ref);
      }
      await wb.commit();
    }

    if (affectedSummaryPairs.length > 0 || (shouldCleanPublished && affectedMonthKeys.size > 0)) {
      await recomputeAffectedMonthlySummaries({
        affectedPairs: affectedSummaryPairs,
        affectedMonthKeys: Array.from(affectedMonthKeys),
        employeesById: params.employeesById,
        now,
      });
    }

    await recordAuditLog({
      action: 'IMPORT_BATCH_DELETED',
      targetType: 'import_batch',
      targetId: params.batch.batchId,
      summary: `Deleted ${params.batch.status} batch ${params.batch.batchId} (${params.batch.fileName}, ${params.batch.periodStart || params.batch.businessDate} to ${params.batch.periodEnd || params.batch.businessDate}): ${rowsSnap.size} staged row(s), ${publishedEntries.length} published incentive(s), and ${notificationRefs.length} notification(s) removed.${
        cleanReason ? ` Reason: ${cleanReason}` : ''
      }`,
    });

    return {
      deletedRowsCount: rowsSnap.size,
      deletedPublishedCount: publishedEntries.length,
      deletedNotificationsCount: notificationRefs.length,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `import_batches/${params.batch.batchId}`);
  }
}

/**
 * Super Admin ONLY: Permanently deletes all incentive records, import batches, staged rows,
 * monthly summaries, notifications, and sales targets for a specific monthKey (YYYY-MM),
 * and voids any active adjustments for that month. Records an immutable audit log.
 */
export async function purgeMonthRecords(params: {
  monthKey: string;
  reason?: string;
}): Promise<{
  deletedBatches: number;
  deletedRows: number;
  deletedIncentives: number;
  deletedSummaries: number;
  deletedNotifications: number;
  deletedTargets: number;
  voidedAdjustments: number;
}> {
  const user = auth.currentUser;
  if (!user) throw new Error('Super Admin authentication is required.');
  const targetMonth = params.monthKey.trim();
  if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
    throw new Error('Invalid month key. Expected YYYY-MM.');
  }

  const now = new Date().toISOString();
  const cleanReason = (params.reason || '').trim().slice(0, 240);

  try {
    const [batchesSnap, incSnap, sumSnap, notifSnap, tgtSnap, adjSnap] = await Promise.all([
      getDocs(collection(db, 'import_batches')),
      getDocs(collection(db, 'published_incentives')),
      getDocs(query(collection(db, 'monthly_summaries'), where('monthKey', '==', targetMonth))),
      getDocs(collection(db, 'notifications')),
      getDocs(query(collection(db, 'sales_targets'), where('monthKey', '==', targetMonth))),
      getDocs(query(collection(db, 'incentive_adjustments'), where('monthKey', '==', targetMonth))),
    ]);

    const matchingBatchDocs = batchesSnap.docs.filter((d) => {
      const b = d.data() as ImportBatch;
      const start = b.periodStart || b.businessDate || '';
      const end = b.periodEnd || b.businessDate || '';
      return (
        start.startsWith(targetMonth) ||
        end.startsWith(targetMonth) ||
        (b.businessDate || '').startsWith(targetMonth)
      );
    });
    const matchingBatchIds = new Set(matchingBatchDocs.map((d) => d.id));

    const matchingRowRefs: Array<ReturnType<typeof doc>> = [];
    for (const batchId of matchingBatchIds) {
      const rSnap = await getDocs(
        query(collection(db, 'import_batch_rows'), where('batchId', '==', batchId)),
      );
      for (const rDoc of rSnap.docs) {
        matchingRowRefs.push(rDoc.ref);
      }
    }

    const matchingIncDocs = incSnap.docs.filter((d) => {
      const r = d.data() as PublishedIncentive;
      const start = r.periodStart || r.businessDate || '';
      const end = r.periodEnd || r.businessDate || '';
      return (
        r.monthKey === targetMonth ||
        start.startsWith(targetMonth) ||
        end.startsWith(targetMonth) ||
        (r.batchId ? matchingBatchIds.has(r.batchId) : false)
      );
    });

    const matchingNotifDocs = notifSnap.docs.filter((d) => {
      const n = d.data() as EmployeeNotification;
      return (
        (n.businessDate || '').startsWith(targetMonth) ||
        (n.batchId ? matchingBatchIds.has(n.batchId) : false)
      );
    });

    const deleteRefs: Array<ReturnType<typeof doc>> = [
      ...matchingRowRefs,
      ...matchingBatchDocs.map((d) => d.ref),
      ...matchingIncDocs.map((d) => d.ref),
      ...sumSnap.docs.map((d) => d.ref),
      ...matchingNotifDocs.map((d) => d.ref),
      ...tgtSnap.docs.map((d) => d.ref),
    ];

    for (let i = 0; i < deleteRefs.length; i += 400) {
      const wb = writeBatch(db);
      for (const ref of deleteRefs.slice(i, i + 400)) {
        wb.delete(ref);
      }
      await wb.commit();
    }

    // Void active adjustments for the purged month (firestore.rules preserves immutable audit history via VOIDED status)
    const activeAdjDocs = adjSnap.docs.filter((d) => (d.data() as { status?: string }).status === 'ACTIVE');
    for (let i = 0; i < activeAdjDocs.length; i += 400) {
      const wb = writeBatch(db);
      for (const aDoc of activeAdjDocs.slice(i, i + 400)) {
        wb.update(aDoc.ref, {
          status: 'VOIDED',
          voidedByEmail: user.email || 'admin',
          voidedAt: now,
        });
      }
      await wb.commit();
    }

    await recordAuditLog({
      action: 'MONTH_DATA_PURGED',
      targetType: 'monthly_summary',
      targetId: targetMonth,
      summary: `Purged all records for ${targetMonth}: ${matchingBatchDocs.length} batch(es), ${matchingRowRefs.length} row(s), ${matchingIncDocs.length} published record(s), ${sumSnap.size} summary(s), ${matchingNotifDocs.length} notification(s), ${tgtSnap.size} target(s) removed; ${activeAdjDocs.length} adjustment(s) voided.${
        cleanReason ? ` Reason: ${cleanReason}` : ''
      }`,
    });

    return {
      deletedBatches: matchingBatchDocs.length,
      deletedRows: matchingRowRefs.length,
      deletedIncentives: matchingIncDocs.length,
      deletedSummaries: sumSnap.size,
      deletedNotifications: matchingNotifDocs.length,
      deletedTargets: tgtSnap.size,
      voidedAdjustments: activeAdjDocs.length,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `monthly_summaries/${targetMonth}`);
  }
}

// --- EMPLOYEE-SCOPED READS (ANTI-IDOR + ISSUE 6 VERIFIED SELF-CLAIM) ---
export async function fetchOwnEmployeeProfile(): Promise<Employee | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const byUidSnap = await getDocs(
      query(collection(db, 'employees'), where('authUid', '==', user.uid)),
    );
    if (!byUidSnap.empty) {
      return byUidSnap.docs[0].data() as Employee;
    }
    if (user.email && user.emailVerified) {
      const byGoogleSnap = await getDocs(
        query(collection(db, 'employees'), where('linkedGoogleEmail', '==', user.email.toLowerCase())),
      );
      if (!byGoogleSnap.empty) {
        const emp = byGoogleSnap.docs[0].data() as Employee;
        // Issue 6: One-time verified Google self-claim of empty authUid for ACTIVE employee
        if (emp.status === 'ACTIVE' && !emp.authUid) {
          try {
            const now = new Date().toISOString();
            const wb = writeBatch(db);
            wb.update(doc(db, 'employees', emp.employeeId), {
              authUid: user.uid,
              updatedAt: now,
            });
            const activeEntry: ActiveAuthUidRecord = {
              authUid: user.uid,
              employeeId: emp.employeeId,
              active: true,
              updatedAt: now,
            };
            wb.set(doc(db, 'active_auth_uids', user.uid), activeEntry);
            await wb.commit();
            return { ...emp, authUid: user.uid, updatedAt: now };
          } catch {
            // Return profile even if self-claim could not complete
          }
        }
        return emp;
      }
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'employees');
  }
}

export async function fetchOwnPublishedIncentives(): Promise<PublishedIncentive[]> {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const snap = await getDocs(
      query(
        collection(db, 'published_incentives'),
        where('authUid', '==', user.uid),
        where('status', '==', 'PUBLISHED'),
      ),
    );
    return snap.docs
      .map((d) => d.data() as PublishedIncentive)
      .sort((a, b) => (b.periodStart || b.businessDate).localeCompare(a.periodStart || a.businessDate));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'published_incentives');
  }
}

export async function fetchOwnMonthlySummaries(): Promise<MonthlySummary[]> {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const snap = await getDocs(
      query(collection(db, 'monthly_summaries'), where('authUid', '==', user.uid)),
    );
    return snap.docs
      .map((d) => d.data() as MonthlySummary)
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'monthly_summaries');
  }
}

export async function fetchOwnNotifications(): Promise<EmployeeNotification[]> {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const snap = await getDocs(
      query(collection(db, 'notifications'), where('authUid', '==', user.uid)),
    );
    return snap.docs
      .map((d) => d.data() as EmployeeNotification)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'notifications');
  }
}

export function subscribeOwnEmployeeProfile(
  employeeId: string,
  onData: (employee: Employee | null) => void,
): Unsubscribe {
  const ref = doc(db, 'employees', employeeId);
  return onSnapshot(
    ref,
    (snap) => {
      onData(snap.exists() ? (snap.data() as Employee) : null);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, `employees/${employeeId}`);
      } catch {
        // Logged via handleFirestoreError
      }
    },
  );
}

export function subscribeOwnPublishedIncentives(
  uid: string,
  onData: (records: PublishedIncentive[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'published_incentives'),
    where('authUid', '==', uid),
    where('status', '==', 'PUBLISHED'),
  );
  return onSnapshot(
    q,
    (snap) => {
      const records = snap.docs
        .map((d) => d.data() as PublishedIncentive)
        .sort((a, b) =>
          (b.periodStart || b.businessDate).localeCompare(a.periodStart || a.businessDate),
        );
      onData(records);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'published_incentives');
      } catch {
        // Logged via handleFirestoreError
      }
    },
  );
}

export function subscribeOwnMonthlySummaries(
  uid: string,
  onData: (summaries: MonthlySummary[]) => void,
): Unsubscribe {
  const q = query(collection(db, 'monthly_summaries'), where('authUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as MonthlySummary)
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'monthly_summaries');
      } catch {
        // Logged via handleFirestoreError
      }
    },
  );
}

export function subscribeOwnNotifications(
  uid: string,
  onData: (notifications: EmployeeNotification[]) => void,
): Unsubscribe {
  const q = query(collection(db, 'notifications'), where('authUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as EmployeeNotification)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'notifications');
      } catch {
        // Logged via handleFirestoreError
      }
    },
  );
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'notifications', notificationId), {
      read: true,
      readAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `notifications/${notificationId}`);
  }
}

// --- STRICTLY READ-ONLY FULL FIRESTORE BACKUP EXPORT (ALL 11 COLLECTIONS) ---
export const BACKUP_COLLECTION_NAMES = [
  'admins',
  'active_auth_uids',
  'branches',
  'employees',
  'import_batches',
  'import_batch_rows',
  'published_incentives',
  'incentive_versions',
  'monthly_summaries',
  'notifications',
  'audit_logs',
] as const;

export type BackupCollectionName = (typeof BACKUP_COLLECTION_NAMES)[number];

export interface BackupDocumentEntry {
  id: string;
  data: Record<string, unknown>;
}

export interface BackupCollectionManifestEntry {
  collection: BackupCollectionName;
  documentCount: number;
  sha256: string;
}

export interface FullFirestoreBackupSnapshot {
  manifest: {
    manifestVersion: string;
    organization: string;
    legalEntity: string;
    registeredAddress: string;
    project: string;
    firebaseProjectId: string;
    firestoreDatabaseId: string;
    exportedAtUtc: string;
    exportedByEmail: string;
    readOnlyExport: true;
    collectionCount: number;
    totalDocuments: number;
    payloadSha256: string;
    collections: BackupCollectionManifestEntry[];
  };
  collections: Record<BackupCollectionName, BackupDocumentEntry[]>;
}

async function computeSha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Super Admin ONLY, STRICTLY READ-ONLY export of all 10 Firestore collections.
 * Uses unscoped getDocs(collection(db, name)) so zero documents are skipped due to missing sort fields.
 * Performs ZERO Firestore writes.
 */
export async function exportFullFirestoreBackup(): Promise<{
  snapshot: FullFirestoreBackupSnapshot;
  serializedJson: string;
  fileSha256: string;
  fileSizeBytes: number;
}> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Super Admin authentication is required to export Firestore backup.');
  }

  const exportedAtUtc = new Date().toISOString();

  const fetchedEntries = await Promise.all(
    BACKUP_COLLECTION_NAMES.map(async (colName) => {
      try {
        const snap = await getDocs(collection(db, colName));
        const docs: BackupDocumentEntry[] = snap.docs
          .map((d) => ({
            id: d.id,
            data: d.data() as Record<string, unknown>,
          }))
          .sort((a, b) => a.id.localeCompare(b.id));
        const sha256 = await computeSha256Hex(JSON.stringify(docs));
        return { colName, docs, sha256 };
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, colName);
      }
    }),
  );

  const collections = {} as Record<BackupCollectionName, BackupDocumentEntry[]>;
  const collectionManifest: BackupCollectionManifestEntry[] = [];
  let totalDocuments = 0;

  for (const entry of fetchedEntries) {
    collections[entry.colName] = entry.docs;
    collectionManifest.push({
      collection: entry.colName,
      documentCount: entry.docs.length,
      sha256: entry.sha256,
    });
    totalDocuments += entry.docs.length;
  }

  const payloadSha256 = await computeSha256Hex(JSON.stringify(collections));

  const snapshot: FullFirestoreBackupSnapshot = {
    manifest: {
      manifestVersion: '2.1.0',
      organization: COMPANY_BRAND.brandName,
      legalEntity: COMPANY_BRAND.legalName,
      registeredAddress: COMPANY_BRAND.fullAddress,
      project: 'HOUSE OF MUKTAI – EMPLOYEE INCENTIVE MANAGEMENT SYSTEM',
      firebaseProjectId: firebaseConfig.projectId,
      firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
      exportedAtUtc,
      exportedByEmail: user.email || 'unknown',
      readOnlyExport: true,
      collectionCount: BACKUP_COLLECTION_NAMES.length,
      totalDocuments,
      payloadSha256,
      collections: collectionManifest,
    },
    collections,
  };

  const serializedJson = JSON.stringify(snapshot, null, 2);
  // In-memory JSON readability round-trip check before returning
  const parsedCheck = JSON.parse(serializedJson) as FullFirestoreBackupSnapshot;
  if (
    !parsedCheck?.manifest ||
    parsedCheck.manifest.collectionCount !== BACKUP_COLLECTION_NAMES.length ||
    parsedCheck.manifest.totalDocuments !== totalDocuments
  ) {
    throw new Error('Backup JSON verification failed during readability check.');
  }

  const fileSha256 = await computeSha256Hex(serializedJson);
  const fileSizeBytes = new TextEncoder().encode(serializedJson).byteLength;

  return {
    snapshot,
    serializedJson,
    fileSha256,
    fileSizeBytes,
  };
}

