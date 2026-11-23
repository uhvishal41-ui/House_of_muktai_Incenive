import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
  writeBatch,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { isMonthVisibleToEmployees } from '../lib/departmentLeaderboardEngine';
import {
  buildSalarySlipId,
  getEffectiveDepartmentId,
  type ParsedSalaryRow,
} from '../lib/salarySlipEngine';
import { recomputeAndSaveDepartmentRankings } from './departmentVisibilityService';
import type {
  ActiveAuthUidRecord,
  AuditLog,
  DepartmentId,
  Employee,
  PortalVisibilitySettings,
  PublishedIncentive,
  SalarySlip,
} from '../types/incentive';

function requireActor(): { uid: string; email: string } {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required. Please sign in again.');
  return {
    uid: user.uid,
    email: (user.email || 'admin@houseofmuktai.co.in').slice(0, 180),
  };
}

async function writeSalaryAuditLog(params: {
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
}): Promise<void> {
  const actor = requireActor();
  const now = new Date().toISOString();
  const logId = `LOG_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`.replace(
    /[^a-zA-Z0-9_-]/g,
    '_',
  );
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

/**
 * Super Admin ONLY: Lists all published monthly salary slips sorted by newest month -> name.
 */
export async function listAllSalarySlips(): Promise<SalarySlip[]> {
  try {
    const snap = await getDocs(collection(db, 'salary_slips'));
    return snap.docs
      .map((d) => d.data() as SalarySlip)
      .sort(
        (a, b) =>
          b.monthKey.localeCompare(a.monthKey) ||
          a.branchName.localeCompare(b.branchName) ||
          a.employeeName.localeCompare(b.employeeName),
      );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'salary_slips');
  }
}

/**
 * Active Employee ONLY: Real-time dual subscription (by authUid + employeeId fallback)
 * for own monthly salary slips, strictly gated by Admin Month Visibility (`employeeVisible`).
 */
export function subscribeOwnSalarySlips(
  authUid: string,
  onData: (slips: SalarySlip[]) => void,
  employeeId?: string,
  onlyEmployeeVisible = false,
): Unsubscribe {
  const byUid = new Map<string, SalarySlip>();
  const byEmpId = new Map<string, SalarySlip>();

  const emitMerged = () => {
    const merged = new Map<string, SalarySlip>();
    for (const [k, v] of byUid.entries()) merged.set(k, v);
    for (const [k, v] of byEmpId.entries()) merged.set(k, v);
    const list = Array.from(merged.values()).sort((a, b) =>
      b.monthKey.localeCompare(a.monthKey),
    );
    onData(list);
  };

  const uidConstraints: QueryConstraint[] = [where('authUid', '==', authUid)];
  if (onlyEmployeeVisible) {
    uidConstraints.push(where('employeeVisible', '==', true));
  }
  const qUid = query(collection(db, 'salary_slips'), ...uidConstraints);
  const unsubUid = onSnapshot(
    qUid,
    (snap) => {
      byUid.clear();
      snap.docs.forEach((d) => {
        const rec = d.data() as SalarySlip;
        byUid.set(rec.slipId || d.id, rec);
      });
      emitMerged();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'salary_slips');
      } catch {
        // Logged via handleFirestoreError
      }
    },
  );

  let unsubEmp: Unsubscribe | null = null;
  const cleanEmpId = (employeeId || '').trim();
  if (cleanEmpId) {
    const empConstraints: QueryConstraint[] = [where('employeeId', '==', cleanEmpId)];
    if (onlyEmployeeVisible) {
      empConstraints.push(where('employeeVisible', '==', true));
    }
    const qEmp = query(collection(db, 'salary_slips'), ...empConstraints);
    unsubEmp = onSnapshot(
      qEmp,
      (snap) => {
        byEmpId.clear();
        snap.docs.forEach((d) => {
          const rec = d.data() as SalarySlip;
          byEmpId.set(rec.slipId || d.id, rec);
        });
        emitMerged();
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, 'salary_slips');
        } catch {
          // Logged via handleFirestoreError
        }
      },
    );
  }

  return () => {
    unsubUid();
    if (unsubEmp) unsubEmp();
  };
}

export interface PublishSalarySlipsResult {
  slipsPublished: number;
  departmentsSynced: number;
  masterProfilesSynced: number;
  leaderboardsRefreshedMonths: number;
}

/**
 * Super Admin ONLY:
 * 1. Publishes or updates monthly `salary_slips/{monthKey}__{employeeId}` documents
 *    stamped with the Admin's current `employeeVisible` rule.
 * 2. When `syncMasterData` is true, automatically syncs Department (5 official depts),
 *    Designation, DOJ, PAN, UAN, PF, ESIC, Bank details onto `employees/{employeeId}`
 *    and atomically updates `active_auth_uids/{authUid}.departmentId`.
 * 3. Automatically refreshes the 12-branch Department Top-3 Leaderboards if departments changed.
 */
export async function publishSalarySlipsBatch(params: {
  validRows: ParsedSalaryRow[];
  allEmployees: Employee[];
  existingSlips: SalarySlip[];
  incentives: PublishedIncentive[];
  visibilitySettings?: PortalVisibilitySettings | null;
  syncMasterData: boolean;
}): Promise<PublishSalarySlipsResult> {
  const actor = requireActor();
  const now = new Date().toISOString();

  if (!params.validRows.length) {
    throw new Error('No valid salary rows to publish.');
  }

  const empById = new Map<string, Employee>();
  for (const e of params.allEmployees) {
    empById.set(e.employeeId.trim().toUpperCase(), e);
  }

  const existingSlipById = new Map<string, SalarySlip>();
  for (const s of params.existingSlips) {
    existingSlipById.set(s.slipId, s);
  }

  const slipOps: Array<{ ref: ReturnType<typeof doc>; data: SalarySlip }> = [];
  const empSyncOps: Array<{
    emp: Employee;
    empPatch: Record<string, unknown>;
    nextDeptId?: DepartmentId | '';
  }> = [];

  let departmentsSynced = 0;
  let masterProfilesSynced = 0;
  const affectedMonths = new Set<string>();

  for (const row of params.validRows) {
    const emp = empById.get(row.employeeId.trim().toUpperCase());
    if (!emp) continue;

    affectedMonths.add(row.monthKey);
    const slipId = buildSalarySlipId(row.monthKey, emp.employeeId);
    const existingSlip = existingSlipById.get(slipId);
    const effectiveDeptId = getEffectiveDepartmentId(row.resolvedDepartment, emp);
    const effectiveDeptName = row.resolvedDepartment?.name || emp.departmentName || '';
    const employeeVisible = isMonthVisibleToEmployees(row.monthKey, params.visibilitySettings);

    const slipDoc: SalarySlip = {
      slipId,
      monthKey: row.monthKey,
      employeeId: emp.employeeId,
      authUid: emp.authUid || '',
      employeeName: emp.fullName.slice(0, 120),
      branchId: emp.branchId,
      branchName: emp.branchName.slice(0, 120),
      departmentId: effectiveDeptId,
      departmentName: effectiveDeptName.slice(0, 80),
      designation: (row.designation || emp.designation || 'Sales Executive').slice(0, 80),
      dateOfJoining: (row.dateOfJoining || emp.dateOfJoining || '').slice(0, 20),
      panNumber: (row.panNumber || emp.panNumber || '').slice(0, 20),
      uanNumber: (row.uanNumber || emp.uanNumber || '').slice(0, 24),
      pfNumber: (row.pfNumber || emp.pfNumber || '').slice(0, 32),
      esicNumber: (row.esicNumber || emp.esicNumber || '').slice(0, 32),
      bankName: (row.bankName || emp.bankName || '').slice(0, 80),
      bankAccountMasked: (row.bankAccountMasked || emp.bankAccountMasked || '').slice(0, 32),
      bankIfsc: (row.bankIfsc || emp.bankIfsc || '').slice(0, 20),
      totalDays: row.totalDays,
      paidDays: row.paidDays,
      lopDays: row.lopDays,
      weeklyOffDays: row.weeklyOffDays,
      paidLeaveDays: row.paidLeaveDays,
      overtimeHours: row.overtimeHours,
      basicPaise: row.basicPaise,
      hraPaise: row.hraPaise,
      conveyancePaise: row.conveyancePaise,
      specialAllowancePaise: row.specialAllowancePaise,
      overtimePaise: row.overtimePaise,
      incentivePaise: row.incentivePaise,
      otherEarningsPaise: row.otherEarningsPaise,
      grossEarningsPaise: row.grossEarningsPaise,
      pfPaise: row.pfPaise,
      esicPaise: row.esicPaise,
      ptPaise: row.ptPaise,
      advanceRecoveryPaise: row.advanceRecoveryPaise,
      tdsPaise: row.tdsPaise,
      otherDeductionPaise: row.otherDeductionPaise,
      totalDeductionsPaise: row.totalDeductionsPaise,
      netPayablePaise: row.netPayablePaise,
      paymentMode: row.paymentMode,
      paymentReference: row.paymentReference.slice(0, 120),
      paymentDate: row.paymentDate.slice(0, 30),
      remarks: row.remarks.slice(0, 240),
      employeeVisible,
      uploadedByEmail: actor.email,
      uploadedAt: existingSlip?.uploadedAt || now,
      updatedAt: now,
    };

    slipOps.push({ ref: doc(db, 'salary_slips', slipId), data: slipDoc });

    // Prepare optional Employee Master & active_auth_uids sync
    if (params.syncMasterData && row.willSyncMasterFields) {
      const empPatch: Record<string, unknown> = { updatedAt: now };
      let nextDeptId: DepartmentId | '' | undefined;

      if (row.resolvedDepartment && emp.departmentId !== row.resolvedDepartment.id) {
        empPatch.departmentId = row.resolvedDepartment.id;
        empPatch.departmentName = row.resolvedDepartment.name;
        nextDeptId = row.resolvedDepartment.id;
        departmentsSynced += 1;
      }
      if (row.designation && row.designation !== emp.designation) {
        empPatch.designation = row.designation.slice(0, 80);
      }
      if (row.dateOfJoining && row.dateOfJoining !== (emp.dateOfJoining || '')) {
        empPatch.dateOfJoining = row.dateOfJoining.slice(0, 20);
      }
      if (row.panNumber && row.panNumber !== (emp.panNumber || '')) {
        empPatch.panNumber = row.panNumber.slice(0, 20);
      }
      if (row.uanNumber && row.uanNumber !== (emp.uanNumber || '')) {
        empPatch.uanNumber = row.uanNumber.slice(0, 24);
      }
      if (row.pfNumber && row.pfNumber !== (emp.pfNumber || '')) {
        empPatch.pfNumber = row.pfNumber.slice(0, 32);
      }
      if (row.esicNumber && row.esicNumber !== (emp.esicNumber || '')) {
        empPatch.esicNumber = row.esicNumber.slice(0, 32);
      }
      if (row.bankName && row.bankName !== (emp.bankName || '')) {
        empPatch.bankName = row.bankName.slice(0, 80);
      }
      if (row.bankAccountMasked && row.bankAccountMasked !== (emp.bankAccountMasked || '')) {
        empPatch.bankAccountMasked = row.bankAccountMasked.slice(0, 32);
      }
      if (row.bankIfsc && row.bankIfsc !== (emp.bankIfsc || '')) {
        empPatch.bankIfsc = row.bankIfsc.slice(0, 20);
      }

      if (Object.keys(empPatch).length > 1) {
        empSyncOps.push({ emp, empPatch, nextDeptId });
        masterProfilesSynced += 1;
      }
    }
  }

  try {
    // 1. Commit Salary Slips in safe chunks
    for (let i = 0; i < slipOps.length; i += 350) {
      const wb = writeBatch(db);
      for (const op of slipOps.slice(i, i + 350)) {
        wb.set(op.ref, op.data);
      }
      await wb.commit();
    }

    // 2. Commit Employee Master + atomic active_auth_uids sync
    const updatedEmpMap = new Map<string, Employee>();
    for (let i = 0; i < empSyncOps.length; i += 180) {
      const wb = writeBatch(db);
      for (const item of empSyncOps.slice(i, i + 180)) {
        const mergedEmp: Employee = {
          ...item.emp,
          ...(item.empPatch as Partial<Employee>),
        };
        updatedEmpMap.set(item.emp.employeeId.toUpperCase(), mergedEmp);
        wb.update(doc(db, 'employees', item.emp.employeeId), item.empPatch);

        if (item.emp.status === 'ACTIVE' && item.emp.authUid) {
          const activeDoc: ActiveAuthUidRecord = {
            authUid: item.emp.authUid,
            employeeId: item.emp.employeeId,
            departmentId: (item.nextDeptId ?? item.emp.departmentId ?? '') as DepartmentId | '',
            active: true,
            updatedAt: now,
          };
          wb.set(doc(db, 'active_auth_uids', item.emp.authUid), activeDoc);
        }
      }
      await wb.commit();
    }

    // 3. Auto-refresh 5-Department Top-3 Leaderboards if departments were updated
    let leaderboardsRefreshedMonths = 0;
    if (departmentsSynced > 0 && params.incentives.length > 0) {
      const refreshedEmployees = params.allEmployees.map(
        (e) => updatedEmpMap.get(e.employeeId.toUpperCase()) || e,
      );
      const rankRes = await recomputeAndSaveDepartmentRankings({
        employees: refreshedEmployees,
        incentives: params.incentives,
        visibilitySettings: params.visibilitySettings,
      });
      leaderboardsRefreshedMonths = rankRes.monthsProcessed;
    }

    await writeSalaryAuditLog({
      action: 'PUBLISH_SALARY_SLIPS',
      targetType: 'salary_slips',
      targetId: Array.from(affectedMonths).sort().join('_') || `SLIPS_${Date.now()}`,
      summary: `Published ${slipOps.length} salary slip(s) for [${Array.from(affectedMonths).join(', ')}]; auto-synced ${departmentsSynced} department(s) & ${masterProfilesSynced} HR profile(s).`,
    });

    return {
      slipsPublished: slipOps.length,
      departmentsSynced,
      masterProfilesSynced,
      leaderboardsRefreshedMonths,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'salary_slips');
  }
}

export async function deleteSalarySlip(slip: SalarySlip): Promise<void> {
  try {
    await deleteDoc(doc(db, 'salary_slips', slip.slipId));
    await writeSalaryAuditLog({
      action: 'DELETE_SALARY_SLIP',
      targetType: 'salary_slips',
      targetId: slip.slipId,
      summary: `Deleted salary slip for ${slip.employeeName} (${slip.employeeId}) — ${slip.monthKey}.`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `salary_slips/${slip.slipId}`);
  }
}
