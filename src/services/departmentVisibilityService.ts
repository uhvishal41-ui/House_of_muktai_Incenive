import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  buildDepartmentLeaderboardId,
  buildEmployeeRankId,
  computeDepartmentLeaderboardsAndRanks,
  getDepartmentById,
  isMonthVisibleToEmployees,
  isSalarySlipMonthVisibleToEmployees,
} from '../lib/departmentLeaderboardEngine';
import { buildBirthdayProfileFromEmployee } from '../lib/birthdayEngine';
import { buildActiveAuthUidRecord } from '../lib/employeeRecordHelpers';
import { getOverlappingMonthKeys } from '../lib/incentiveEngine';
import type {
  AuditLog,
  DepartmentId,
  DepartmentLeaderboard,
  Employee,
  EmployeeColumnSettings,
  EmployeeDepartmentRank,
  PortalVisibilitySettings,
  PublishedIncentive,
  VisibilityMode,
} from '../types/incentive';

export const DEFAULT_PORTAL_VISIBILITY: PortalVisibilitySettings = {
  settingId: 'visibility',
  mode: 'ALL',
  visibleMonths: [],
  salarySlipMode: 'ALL',
  salarySlipVisibleMonths: [],
  updatedByEmail: '',
  updatedAt: '',
};

function requireActor(): { uid: string; email: string } {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required. Please sign in again.');
  return {
    uid: user.uid,
    email: (user.email || 'admin').slice(0, 180),
  };
}

async function writeVisibilityAuditLog(params: {
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
}): Promise<void> {
  const actor = requireActor();
  const now = new Date().toISOString();
  const logId = `LOG_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const logDoc: AuditLog = {
    logId,
    action: params.action.slice(0, 80),
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: 'SUPER_ADMIN',
    targetType: params.targetType.slice(0, 64),
    targetId: params.targetId.slice(0, 128),
    summary: params.summary.slice(0, 400),
    createdAt: now,
  };
  await setDoc(doc(db, 'audit_logs', logId), logDoc);
}

// =========================================================================
// 1. ADMIN-CONTROLLED EMPLOYEE MONTH VISIBILITY (portal_settings/visibility)
// =========================================================================

function normalizeVisibilityDoc(data: Partial<PortalVisibilitySettings>): PortalVisibilitySettings {
  const mode: VisibilityMode = data.mode === 'SELECTED' ? 'SELECTED' : 'ALL';
  const visibleMonths = Array.isArray(data.visibleMonths) ? data.visibleMonths : [];
  const salarySlipMode: VisibilityMode =
    data.salarySlipMode === 'SELECTED'
      ? 'SELECTED'
      : data.salarySlipMode === 'ALL'
        ? 'ALL'
        : mode;
  const salarySlipVisibleMonths = Array.isArray(data.salarySlipVisibleMonths)
    ? data.salarySlipVisibleMonths
    : data.salarySlipMode
      ? []
      : visibleMonths;
  return {
    settingId: 'visibility',
    mode,
    visibleMonths,
    salarySlipMode,
    salarySlipVisibleMonths,
    updatedByEmail: data.updatedByEmail || '',
    updatedAt: data.updatedAt || '',
  };
}

export async function fetchPortalVisibilitySettings(): Promise<PortalVisibilitySettings> {
  try {
    const snap = await getDoc(doc(db, 'portal_settings', 'visibility'));
    if (!snap.exists()) return { ...DEFAULT_PORTAL_VISIBILITY };
    return normalizeVisibilityDoc(snap.data() as Partial<PortalVisibilitySettings>);
  } catch {
    return { ...DEFAULT_PORTAL_VISIBILITY };
  }
}

export function subscribePortalVisibilitySettings(
  onData: (settings: PortalVisibilitySettings) => void,
): Unsubscribe {
  const ref = doc(db, 'portal_settings', 'visibility');
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData({ ...DEFAULT_PORTAL_VISIBILITY });
        return;
      }
      onData(normalizeVisibilityDoc(snap.data() as Partial<PortalVisibilitySettings>));
    },
    () => {
      // Fallback cleanly to ALL if settings document is not yet provisioned
      onData({ ...DEFAULT_PORTAL_VISIBILITY });
    },
  );
}

// =========================================================================
// 1b. ADMIN-ONLY EMPLOYEE MASTER CUSTOM COLUMNS (portal_settings/employee_columns)
// =========================================================================

export const DEFAULT_EMPLOYEE_COLUMN_SETTINGS: EmployeeColumnSettings = {
  settingId: 'employee_columns',
  customColumns: [],
  visibleColumns: [],
  updatedByEmail: '',
  updatedAt: '',
};

function sanitizeStringList(list: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const clean = String(item || '').trim().slice(0, maxLen);
    const norm = clean.toLowerCase();
    if (!clean || seen.has(norm) || out.length >= maxItems) continue;
    seen.add(norm);
    out.push(clean);
  }
  return out;
}

export function subscribeEmployeeColumnSettings(
  onData: (settings: EmployeeColumnSettings | null) => void,
): Unsubscribe {
  const ref = doc(db, 'portal_settings', 'employee_columns');
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const raw = snap.data() as Partial<EmployeeColumnSettings>;
      onData({
        settingId: 'employee_columns',
        customColumns: sanitizeStringList(raw.customColumns, 25, 60),
        visibleColumns: sanitizeStringList(raw.visibleColumns, 45, 70),
        updatedByEmail: raw.updatedByEmail || '',
        updatedAt: raw.updatedAt || '',
      });
    },
    () => {
      onData(null);
    },
  );
}

export async function saveEmployeeColumnSettings(params: {
  customColumns: string[];
  visibleColumns: string[];
}): Promise<EmployeeColumnSettings> {
  const actor = requireActor();
  const now = new Date().toISOString();
  const payload: EmployeeColumnSettings = {
    settingId: 'employee_columns',
    customColumns: sanitizeStringList(params.customColumns, 25, 60),
    visibleColumns: sanitizeStringList(params.visibleColumns, 45, 70),
    updatedByEmail: actor.email,
    updatedAt: now,
  };
  try {
    await setDoc(doc(db, 'portal_settings', 'employee_columns'), payload);
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'portal_settings/employee_columns');
  }
}

const VISIBILITY_SCOPED_COLLECTIONS = [
  'published_incentives',
  'monthly_summaries',
  'payout_records',
  'incentive_adjustments',
  'sales_targets',
  'department_leaderboards',
  'employee_department_ranks',
  'salary_slips',
] as const;

export interface SaveVisibilityResult {
  settings: PortalVisibilitySettings;
  documentsUpdated: number;
}

/**
 * Admin & Main Owner:
 * Updates `portal_settings/visibility` AND stamps `employeeVisible` independently across:
 *   - 7 Incentive / Leaderboard / Payout collections (controlled by `mode` + `visibleMonths`)
 *   - `salary_slips` collection (controlled by `salarySlipMode` + `salarySlipVisibleMonths`)
 * so Firestore Rules enforce both gates server-side with zero deletion of history.
 */
export async function savePortalVisibilitySettings(params: {
  mode: VisibilityMode;
  visibleMonths: string[];
  salarySlipMode?: VisibilityMode;
  salarySlipVisibleMonths?: string[];
}): Promise<SaveVisibilityResult> {
  const actor = requireActor();
  const now = new Date().toISOString();

  const normalizeMonthList = (list: string[] | undefined): string[] =>
    Array.from(
      new Set(
        (list || [])
          .map((m) => String(m || '').trim())
          .filter((m) => /^\d{4}-\d{2}$/.test(m)),
      ),
    )
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 48);

  const normalizedIncentiveMonths = normalizeMonthList(params.visibleMonths);
  const nextIncentiveMode: VisibilityMode = params.mode === 'SELECTED' ? 'SELECTED' : 'ALL';
  const nextSalarySlipMode: VisibilityMode =
    params.salarySlipMode === 'SELECTED'
      ? 'SELECTED'
      : params.salarySlipMode === 'ALL'
        ? 'ALL'
        : nextIncentiveMode;
  const normalizedSalarySlipMonths =
    params.salarySlipVisibleMonths !== undefined
      ? normalizeMonthList(params.salarySlipVisibleMonths)
      : params.salarySlipMode !== undefined
        ? []
        : normalizedIncentiveMonths;

  const nextSettings: PortalVisibilitySettings = {
    settingId: 'visibility',
    mode: nextIncentiveMode,
    visibleMonths: normalizedIncentiveMonths,
    salarySlipMode: nextSalarySlipMode,
    salarySlipVisibleMonths: normalizedSalarySlipMonths,
    updatedByEmail: actor.email,
    updatedAt: now,
  };

  const bothRelaxedToAll = nextIncentiveMode === 'ALL' && nextSalarySlipMode === 'ALL';

  try {
    // When relaxing BOTH to ALL, write portal_settings first so active employees immediately unlock
    if (bothRelaxedToAll) {
      await setDoc(doc(db, 'portal_settings', 'visibility'), nextSettings);
    }

    // Stamp `employeeVisible` across all 8 monthly collections with independent Incentive vs Salary Slip gates
    const snaps = await Promise.all(
      VISIBILITY_SCOPED_COLLECTIONS.map((colName) => getDocs(collection(db, colName))),
    );

    const pendingUpdates: Array<{ ref: ReturnType<typeof doc>; employeeVisible: boolean }> = [];
    for (let idx = 0; idx < snaps.length; idx += 1) {
      const colName = VISIBILITY_SCOPED_COLLECTIONS[idx];
      const snap = snaps[idx];
      for (const d of snap.docs) {
        const data = d.data() as { monthKey?: string; employeeVisible?: boolean } & Partial<PublishedIncentive>;
        const monthKey = typeof data.monthKey === 'string' ? data.monthKey : '';
        if (!monthKey) continue;
        const shouldBeVisible =
          colName === 'salary_slips'
            ? isSalarySlipMonthVisibleToEmployees(monthKey, nextSettings)
            : colName === 'published_incentives' && data.periodStart && data.periodEnd
              ? getOverlappingMonthKeys(data as PublishedIncentive).some((m) =>
                  isMonthVisibleToEmployees(m, nextSettings),
                )
              : isMonthVisibleToEmployees(monthKey, nextSettings);
        if (data.employeeVisible !== shouldBeVisible) {
          pendingUpdates.push({ ref: d.ref, employeeVisible: shouldBeVisible });
        }
      }
    }

    for (let i = 0; i < pendingUpdates.length; i += 380) {
      const wb = writeBatch(db);
      for (const op of pendingUpdates.slice(i, i + 380)) {
        wb.update(op.ref, { employeeVisible: op.employeeVisible });
      }
      await wb.commit();
    }

    // Whenever either gate is SELECTED, write portal_settings AFTER stamping docs so zero race window exists
    if (!bothRelaxedToAll) {
      await setDoc(doc(db, 'portal_settings', 'visibility'), nextSettings);
    }

    const incDesc =
      nextIncentiveMode === 'ALL'
        ? 'ALL months'
        : normalizedIncentiveMonths.length === 0
          ? 'NONE (hidden)'
          : normalizedIncentiveMonths.join(', ');
    const slipDesc =
      nextSalarySlipMode === 'ALL'
        ? 'ALL months'
        : normalizedSalarySlipMonths.length === 0
          ? 'NONE (hidden)'
          : normalizedSalarySlipMonths.join(', ');

    const summaryText = `Updated employee month visibility — Incentives: ${incDesc} | Payment Slips: ${slipDesc} (${pendingUpdates.length} records synced).`;

    await writeVisibilityAuditLog({
      action: 'UPDATE_MONTH_VISIBILITY',
      targetType: 'portal_settings',
      targetId: 'visibility',
      summary: summaryText,
    });

    return {
      settings: nextSettings,
      documentsUpdated: pendingUpdates.length,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'portal_settings/visibility');
  }
}

// =========================================================================
// 2. BULK DEPARTMENT ASSIGNMENT (employees + active_auth_uids atomic sync)
// =========================================================================

export interface BulkDepartmentUpdateResult {
  updatedCount: number;
  activeRegistrySynced: number;
}

export async function bulkUpdateEmployeeDepartments(params: {
  assignments: Array<{ employeeId: string; departmentId: DepartmentId }>;
  allEmployees: Employee[];
}): Promise<BulkDepartmentUpdateResult> {
  requireActor();
  const now = new Date().toISOString();

  const empById = new Map<string, Employee>();
  for (const emp of params.allEmployees) {
    empById.set(emp.employeeId.toUpperCase(), emp);
  }

  type Op =
    | { kind: 'update'; ref: ReturnType<typeof doc>; data: Record<string, unknown> }
    | { kind: 'set'; ref: ReturnType<typeof doc>; data: Record<string, unknown> }
    | { kind: 'delete'; ref: ReturnType<typeof doc> };

  const opUnits: Op[][] = [];
  let updatedCount = 0;
  let activeRegistrySynced = 0;

  for (const item of params.assignments) {
    const emp = empById.get(item.employeeId.trim().toUpperCase());
    const dept = getDepartmentById(item.departmentId);
    if (!emp || !dept) continue;

    const unit: Op[] = [
      {
        kind: 'update',
        ref: doc(db, 'employees', emp.employeeId),
        data: {
          departmentId: dept.id,
          departmentName: dept.name,
          updatedAt: now,
        },
      },
    ];
    updatedCount += 1;

    if (emp.authUid && emp.authUid.trim() !== '') {
      if (emp.status === 'ACTIVE') {
        const activeEntry = buildActiveAuthUidRecord({
          authUid: emp.authUid,
          employeeId: emp.employeeId,
          departmentId: dept.id,
          branchId: emp.branchId,
          branchName: emp.branchName,
          isBranchManager: emp.isBranchManager,
          updatedAt: now,
        });
        unit.push({
          kind: 'set',
          ref: doc(db, 'active_auth_uids', emp.authUid),
          data: activeEntry as unknown as Record<string, unknown>,
        });
      } else {
        unit.push({ kind: 'delete', ref: doc(db, 'active_auth_uids', emp.authUid) });
      }
      activeRegistrySynced += 1;
    }

    const updatedBirthdayProfile = buildBirthdayProfileFromEmployee(
      { ...emp, departmentId: dept.id, departmentName: dept.name },
      now,
    );
    if (updatedBirthdayProfile) {
      unit.push({
        kind: 'set',
        ref: doc(db, 'birthday_profiles', emp.employeeId),
        data: updatedBirthdayProfile as unknown as Record<string, unknown>,
      });
    }

    opUnits.push(unit);
  }

  if (opUnits.length === 0) {
    return { updatedCount: 0, activeRegistrySynced: 0 };
  }

  try {
    // Never split an employee's atomic unit across batch boundaries (<= 300 ops per commit)
    let wb = writeBatch(db);
    let opsInBatch = 0;

    for (const unit of opUnits) {
      if (opsInBatch + unit.length > 300) {
        await wb.commit();
        wb = writeBatch(db);
        opsInBatch = 0;
      }
      for (const op of unit) {
        if (op.kind === 'set') {
          wb.set(op.ref, op.data);
        } else if (op.kind === 'update') {
          wb.update(op.ref, op.data);
        } else {
          wb.delete(op.ref);
        }
        opsInBatch += 1;
      }
    }

    if (opsInBatch > 0) {
      await wb.commit();
    }

    await writeVisibilityAuditLog({
      action: 'BULK_DEPARTMENT_ASSIGNMENT',
      targetType: 'employees',
      targetId: `BULK_${updatedCount}`,
      summary: `Assigned departments for ${updatedCount} employee(s) across branches (${activeRegistrySynced} active auth profiles synced).`,
    });

    return { updatedCount, activeRegistrySynced };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'employees');
  }
}

// =========================================================================
// 3. CROSS-BRANCH 5-DEPARTMENT TOP-3 SALES LEADERBOARD & PERSONAL RANKINGS
// =========================================================================

export interface RecomputeDepartmentRankingsResult {
  monthsProcessed: number;
  leaderboardsWritten: number;
  employeeRanksWritten: number;
}

export async function recomputeAndSaveDepartmentRankings(params: {
  monthKeys?: string[];
  employees: Employee[];
  incentives: PublishedIncentive[];
  visibilitySettings?: PortalVisibilitySettings | null;
}): Promise<RecomputeDepartmentRankingsResult> {
  const actor = requireActor();
  const now = new Date().toISOString();

  const visibility = params.visibilitySettings || (await fetchPortalVisibilitySettings());

  const targetMonthKeys =
    params.monthKeys && params.monthKeys.length > 0
      ? Array.from(new Set(params.monthKeys.filter((m) => /^\d{4}-\d{2}$/.test(m))))
      : Array.from(
          new Set(
            params.incentives
              .filter((r) => r.status === 'PUBLISHED' && /^\d{4}-\d{2}$/.test(r.monthKey))
              .map((r) => r.monthKey),
          ),
        );

  if (targetMonthKeys.length === 0) {
    return { monthsProcessed: 0, leaderboardsWritten: 0, employeeRanksWritten: 0 };
  }

  const pendingSets: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];
  let leaderboardsWritten = 0;
  let employeeRanksWritten = 0;

  for (const monthKey of targetMonthKeys) {
    const employeeVisible = isMonthVisibleToEmployees(monthKey, visibility);
    const { leaderboards, employeeRanks } = computeDepartmentLeaderboardsAndRanks({
      monthKey,
      employees: params.employees,
      incentives: params.incentives,
      employeeVisible,
      updatedByEmail: actor.email,
      now,
    });

    for (const lb of leaderboards) {
      pendingSets.push({
        ref: doc(db, 'department_leaderboards', lb.leaderboardId),
        data: lb as unknown as Record<string, unknown>,
      });
      leaderboardsWritten += 1;
    }

    for (const rankDoc of employeeRanks) {
      pendingSets.push({
        ref: doc(db, 'employee_department_ranks', rankDoc.rankId),
        data: rankDoc as unknown as Record<string, unknown>,
      });
      employeeRanksWritten += 1;
    }
  }

  try {
    for (let i = 0; i < pendingSets.length; i += 380) {
      const wb = writeBatch(db);
      for (const op of pendingSets.slice(i, i + 380)) {
        wb.set(op.ref, op.data);
      }
      await wb.commit();
    }

    await writeVisibilityAuditLog({
      action: 'DEPARTMENT_LEADERBOARDS_RECOMPUTED',
      targetType: 'department_leaderboards',
      targetId: targetMonthKeys.slice(0, 6).join(',').slice(0, 128),
      summary: `Recomputed cross-branch 5-department Top-3 sales leaderboards for ${targetMonthKeys.length} month(s): ${leaderboardsWritten} department boards, ${employeeRanksWritten} employee ranks.`,
    });

    return {
      monthsProcessed: targetMonthKeys.length,
      leaderboardsWritten,
      employeeRanksWritten,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'department_leaderboards');
  }
}

export async function listDepartmentLeaderboards(
  monthKey?: string,
): Promise<DepartmentLeaderboard[]> {
  try {
    const q = monthKey
      ? query(collection(db, 'department_leaderboards'), where('monthKey', '==', monthKey))
      : collection(db, 'department_leaderboards');
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as DepartmentLeaderboard)
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey) || a.departmentName.localeCompare(b.departmentName));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'department_leaderboards');
  }
}

/**
 * Employee Mobile App: Privacy-hardened direct single-doc listener for OWN department's Top 3 ONLY.
 * Never performs a collection list query.
 */
export function subscribeOwnDepartmentLeaderboard(
  monthKey: string,
  departmentId: DepartmentId | '' | undefined,
  onData: (leaderboard: DepartmentLeaderboard | null) => void,
): Unsubscribe {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey) || !departmentId) {
    onData(null);
    return () => {};
  }
  const leaderboardId = buildDepartmentLeaderboardId(monthKey, departmentId);
  const ref = doc(db, 'department_leaderboards', leaderboardId);
  return onSnapshot(
    ref,
    (snap) => {
      onData(snap.exists() ? (snap.data() as DepartmentLeaderboard) : null);
    },
    () => {
      // Gracefully hide if month is not employee-visible or leaderboard not yet generated
      onData(null);
    },
  );
}

/**
 * Employee Mobile App: Privacy-hardened direct single-doc listener for OWN personal rank ONLY.
 * Never performs a collection list query.
 */
export function subscribeOwnDepartmentRank(
  monthKey: string,
  employeeId: string | undefined,
  onData: (rank: EmployeeDepartmentRank | null) => void,
): Unsubscribe {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey) || !employeeId?.trim()) {
    onData(null);
    return () => {};
  }
  const rankId = buildEmployeeRankId(monthKey, employeeId);
  const ref = doc(db, 'employee_department_ranks', rankId);
  return onSnapshot(
    ref,
    (snap) => {
      onData(snap.exists() ? (snap.data() as EmployeeDepartmentRank) : null);
    },
    () => {
      onData(null);
    },
  );
}
