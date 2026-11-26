import {
  collection,
  deleteDoc,
  doc,
  getDoc,
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
import {
  isSalarySlipMonthVisibleToEmployees,
  resolveCanonicalDepartment,
} from '../lib/departmentLeaderboardEngine';
import {
  buildSalarySlipId,
  getEffectiveDepartmentId,
  normalizeSalaryPaymentMode,
  type ParsedSalaryRow,
} from '../lib/salarySlipEngine';
import { buildActiveAuthUidRecord } from '../lib/employeeRecordHelpers';
import { recomputeAndSaveDepartmentRankings } from './departmentVisibilityService';
import type {
  AuditLog,
  DepartmentId,
  Employee,
  PortalVisibilitySettings,
  PublishedIncentive,
  SalarySlip,
} from '../types/incentive';

const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const VALID_MONTH_KEY_RE = /^\d{4}-\d{2}$/;
const VALID_DEPT_IDS = new Set<string>([
  'SAREE',
  'LADIES_WEAR',
  'KIDS_WEAR',
  'MENS_WEAR',
  'NON_APPARELS',
]);

function toSafeNonNegInt(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num);
}

function toSafeAttendanceNumber(value: unknown, maxVal: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.min(maxVal, Number(num.toFixed(2)));
}

function sanitizeDepartmentId(raw: unknown): DepartmentId | '' {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (VALID_DEPT_IDS.has(s)) return s as DepartmentId;
  const resolved = resolveCanonicalDepartment(s);
  return resolved ? resolved.id : '';
}

function validateSalarySlipDocForRules(slip: SalarySlip): string | null {
  if (!VALID_ID_RE.test(slip.slipId)) {
    return `Invalid Slip ID "${slip.slipId}" (only letters, numbers, _ and - allowed).`;
  }
  if (!VALID_MONTH_KEY_RE.test(slip.monthKey)) {
    return `Invalid Pay Month "${slip.monthKey}" for ${slip.employeeName}. Use YYYY-MM.`;
  }
  if (!VALID_ID_RE.test(slip.employeeId)) {
    return `Employee "${slip.employeeName}" has invalid Employee ID "${slip.employeeId}" in Employee Master (contains spaces or special characters).`;
  }
  if (!VALID_ID_RE.test(slip.branchId)) {
    return `Employee "${slip.employeeName}" (${slip.employeeId}) has invalid Branch ID "${slip.branchId}" in Employee Master. Re-save or Sync 12 Branches first.`;
  }
  if (!slip.employeeName.trim()) {
    return `Employee ID "${slip.employeeId}" has a blank Full Name in Employee Master.`;
  }
  if (!slip.branchName.trim()) {
    return `Employee "${slip.employeeName}" (${slip.employeeId}) has a blank Branch Name in Employee Master.`;
  }
  if (slip.departmentId && !VALID_DEPT_IDS.has(slip.departmentId)) {
    return `Employee "${slip.employeeName}" (${slip.employeeId}) has invalid Department ID "${slip.departmentId}".`;
  }
  if (slip.netPayablePaise < 0) {
    return `Employee "${slip.employeeName}" (${slip.employeeId}) has negative Net Payable.`;
  }
  return null;
}

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
  syncWarnings: string[];
}

/**
 * Super Admin ONLY:
 * 1. Fetches live existing slips for affected months so re-uploads preserve immutable `uploadedAt`.
 * 2. Publishes or updates monthly `salary_slips/{monthKey}__{employeeId}` documents
 *    with strict rule-synced integer arithmetic & sanitization.
 * 3. When `syncMasterData` is true, safely syncs Department (5 official depts),
 *    Designation, DOJ, PAN, UAN, PF, ESIC, Bank details onto `employees/{employeeId}`
 *    with atomic Pillar 7 `active_auth_uids` sync (isolated per-step so legacy employee issues
 *    never fail or mask salary slip publishing).
 * 4. Automatically refreshes the 12-branch Department Top-3 Leaderboards if departments changed.
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
  const saleIdOwnerMap = new Map<string, string>();
  for (const e of params.allEmployees) {
    empById.set(e.employeeId.trim().toUpperCase(), e);
    if (e.saleId && e.saleId.trim()) {
      saleIdOwnerMap.set(e.saleId.trim().toUpperCase(), e.employeeId.trim().toUpperCase());
    }
  }

  // Merge in-memory existingSlips with fresh Firestore docs for all affected months
  // so re-uploading a month NEVER fails Firestore's `incoming().uploadedAt == existing().uploadedAt` rule.
  const existingSlipById = new Map<string, SalarySlip>();
  for (const s of params.existingSlips) {
    existingSlipById.set(s.slipId, s);
  }

  const affectedMonths = new Set<string>();
  for (const row of params.validRows) {
    if (VALID_MONTH_KEY_RE.test(row.monthKey)) {
      affectedMonths.add(row.monthKey);
    }
  }

  try {
    const liveAllSnap = await getDocs(collection(db, 'salary_slips'));
    for (const d of liveAllSnap.docs) {
      const rec = d.data() as SalarySlip;
      existingSlipById.set(d.id, rec);
      if (rec.slipId) {
        existingSlipById.set(rec.slipId, rec);
      }
    }
  } catch {
    // Fall back to in-memory existingSlips if collection read fails
  }

  const slipOps: Array<{ ref: ReturnType<typeof doc>; data: SalarySlip }> = [];
  const empSyncOps: Array<{
    emp: Employee;
    empPatch: Record<string, unknown>;
    nextDeptId?: DepartmentId | '';
  }> = [];

  let departmentsSynced = 0;
  let masterProfilesSynced = 0;
  const syncWarnings: string[] = [];

  for (const row of params.validRows) {
    const emp = empById.get(row.employeeId.trim().toUpperCase());
    if (!emp) continue;

    const cleanEmployeeId = emp.employeeId.trim();
    const cleanBranchId = emp.branchId.trim();
    const slipId = buildSalarySlipId(row.monthKey, cleanEmployeeId);
    const existingSlip = existingSlipById.get(slipId);
    const effectiveDeptId = row.resolvedDepartment
      ? sanitizeDepartmentId(row.resolvedDepartment.id)
      : row.customDepartmentName
        ? ''
        : sanitizeDepartmentId(getEffectiveDepartmentId(row.resolvedDepartment, emp));
    const effectiveDeptName = (
      row.resolvedDepartment?.name ||
      row.customDepartmentName ||
      emp.departmentName ||
      ''
    ).trim();
    const employeeVisible = isSalarySlipMonthVisibleToEmployees(row.monthKey, params.visibilitySettings);

    // Guarantee exact integer paise & exact sums required by Firestore Security Rules
    const basicPaise = toSafeNonNegInt(row.basicPaise);
    const dearnessAllowancePaise = toSafeNonNegInt(row.dearnessAllowancePaise);
    const hraPaise = toSafeNonNegInt(row.hraPaise);
    const attendanceAllowancePaise = toSafeNonNegInt(row.attendanceAllowancePaise);
    const washingAllowancePaise = toSafeNonNegInt(row.washingAllowancePaise);
    const conveyancePaise = toSafeNonNegInt(row.conveyancePaise);
    const medicalAllowancePaise = toSafeNonNegInt(row.medicalAllowancePaise);
    const leaveTravelAllowancePaise = toSafeNonNegInt(row.leaveTravelAllowancePaise);
    const communicationExpensesPaise = toSafeNonNegInt(row.communicationExpensesPaise);
    const healthClubAllowancePaise = toSafeNonNegInt(row.healthClubAllowancePaise);
    const adhocAllowancePaise = toSafeNonNegInt(row.adhocAllowancePaise);
    const travelingAllowancePaise = toSafeNonNegInt(row.travelingAllowancePaise);
    const salesCommissionPaise = toSafeNonNegInt(row.salesCommissionPaise);
    const specialAllowancePaise = toSafeNonNegInt(row.specialAllowancePaise);
    const overtimePaise = toSafeNonNegInt(row.overtimePaise);
    const incentivePaise = toSafeNonNegInt(row.incentivePaise);
    const arrearsPaise = toSafeNonNegInt(row.arrearsPaise);
    const otherEarningsPaise = toSafeNonNegInt(row.otherEarningsPaise);

    const grossEarningsPaise =
      basicPaise +
      dearnessAllowancePaise +
      hraPaise +
      attendanceAllowancePaise +
      washingAllowancePaise +
      conveyancePaise +
      medicalAllowancePaise +
      leaveTravelAllowancePaise +
      communicationExpensesPaise +
      healthClubAllowancePaise +
      adhocAllowancePaise +
      travelingAllowancePaise +
      salesCommissionPaise +
      specialAllowancePaise +
      overtimePaise +
      incentivePaise +
      arrearsPaise +
      otherEarningsPaise;

    const pfPaise = toSafeNonNegInt(row.pfPaise);
    const esicPaise = toSafeNonNegInt(row.esicPaise);
    const ptPaise = toSafeNonNegInt(row.ptPaise);
    const lwfPaise = toSafeNonNegInt(row.lwfPaise);
    const advanceRecoveryPaise = toSafeNonNegInt(row.advanceRecoveryPaise);
    const tdsPaise = toSafeNonNegInt(row.tdsPaise);
    const penaltyPaise = toSafeNonNegInt(row.penaltyPaise);
    const insurancePaise = toSafeNonNegInt(row.insurancePaise);
    const otherDeductionPaise = toSafeNonNegInt(row.otherDeductionPaise);

    const totalDeductionsPaise =
      pfPaise +
      esicPaise +
      ptPaise +
      lwfPaise +
      advanceRecoveryPaise +
      tdsPaise +
      penaltyPaise +
      insurancePaise +
      otherDeductionPaise;

    const netPayablePaise = grossEarningsPaise - totalDeductionsPaise;

    const cleanSaleId = (row.saleId || emp.saleId || '').trim().toUpperCase().slice(0, 40);
    const cleanGender = (row.gender || emp.gender || '').trim().slice(0, 20);
    const cleanCategory = (row.category || emp.category || '').trim().slice(0, 40);
    const presentDays = toSafeAttendanceNumber(row.presentDays, 31);
    const overtimeDays = toSafeAttendanceNumber(row.overtimeDays, 31);
    const monthlySalaryRatePaise = toSafeNonNegInt(row.monthlySalaryRatePaise);
    const monthlyGrossRatePaise = toSafeNonNegInt(row.monthlyGrossRatePaise);

    const slipDoc: SalarySlip = {
      slipId,
      monthKey: row.monthKey.trim(),
      employeeId: cleanEmployeeId,
      ...(cleanSaleId ? { saleId: cleanSaleId } : {}),
      authUid: String(emp.authUid || '').trim().slice(0, 128),
      employeeName: (emp.fullName || row.employeeName || cleanEmployeeId).trim().slice(0, 120),
      branchId: cleanBranchId,
      branchName: (emp.branchName || row.branchName || cleanBranchId).trim().slice(0, 120),
      departmentId: effectiveDeptId,
      departmentName: effectiveDeptName.slice(0, 80),
      designation: (row.designation || emp.designation || 'Employee').trim().slice(0, 80),
      ...(cleanGender ? { gender: cleanGender } : {}),
      ...(cleanCategory ? { category: cleanCategory } : {}),
      dateOfJoining: (row.dateOfJoining || emp.dateOfJoining || '').trim().slice(0, 20),
      panNumber: (row.panNumber || emp.panNumber || '').trim().slice(0, 20),
      uanNumber: (row.uanNumber || emp.uanNumber || '').trim().slice(0, 24),
      pfNumber: (row.pfNumber || emp.pfNumber || '').trim().slice(0, 32),
      esicNumber: (row.esicNumber || emp.esicNumber || '').trim().slice(0, 32),
      bankName: (row.bankName || emp.bankName || '').trim().slice(0, 80),
      bankAccountMasked: (row.bankAccountMasked || emp.bankAccountMasked || '').trim().slice(0, 32),
      bankIfsc: (row.bankIfsc || emp.bankIfsc || '').trim().slice(0, 20),
      totalDays: toSafeAttendanceNumber(row.totalDays, 31),
      ...(presentDays > 0 ? { presentDays } : {}),
      paidDays: toSafeAttendanceNumber(row.paidDays, 31),
      lopDays: toSafeAttendanceNumber(row.lopDays, 31),
      weeklyOffDays: toSafeAttendanceNumber(row.weeklyOffDays, 31),
      paidLeaveDays: toSafeAttendanceNumber(row.paidLeaveDays, 31),
      ...(overtimeDays > 0 ? { overtimeDays } : {}),
      overtimeHours: toSafeAttendanceNumber(row.overtimeHours, 500),
      ...(monthlySalaryRatePaise > 0 ? { monthlySalaryRatePaise } : {}),
      ...(monthlyGrossRatePaise > 0 ? { monthlyGrossRatePaise } : {}),
      basicPaise,
      dearnessAllowancePaise,
      hraPaise,
      attendanceAllowancePaise,
      washingAllowancePaise,
      conveyancePaise,
      medicalAllowancePaise,
      leaveTravelAllowancePaise,
      communicationExpensesPaise,
      healthClubAllowancePaise,
      adhocAllowancePaise,
      travelingAllowancePaise,
      salesCommissionPaise,
      specialAllowancePaise,
      overtimePaise,
      incentivePaise,
      arrearsPaise,
      otherEarningsPaise,
      grossEarningsPaise,
      pfPaise,
      esicPaise,
      ptPaise,
      lwfPaise,
      advanceRecoveryPaise,
      tdsPaise,
      penaltyPaise,
      insurancePaise,
      otherDeductionPaise,
      totalDeductionsPaise,
      netPayablePaise,
      paymentMode: normalizeSalaryPaymentMode(row.paymentMode),
      paymentReference: String(row.paymentReference || '').trim().slice(0, 120),
      paymentDate: String(row.paymentDate || '').trim().slice(0, 30),
      remarks: String(row.remarks || '').trim().slice(0, 240),
      employeeVisible,
      uploadedByEmail: actor.email,
      uploadedAt: (existingSlip?.uploadedAt || now).slice(0, 40),
      updatedAt: now,
    };

    const preflightErr = validateSalarySlipDocForRules(slipDoc);
    if (preflightErr) {
      throw new Error(`Salary slip pre-check failed (Row ${row.rowNumber}): ${preflightErr}`);
    }

    slipOps.push({ ref: doc(db, 'salary_slips', slipId), data: slipDoc });

    // Prepare optional Employee Master & active_auth_uids sync
    if (params.syncMasterData && row.willSyncMasterFields) {
      const empPatch: Record<string, unknown> = { updatedAt: now };
      let nextDeptId: DepartmentId | '' | undefined;

      // Normalize any legacy role so `isValidEmployee` never rejects the update
      if ((emp.role as string) !== 'EMPLOYEE') {
        empPatch.role = 'EMPLOYEE';
      }

      if (row.resolvedDepartment && emp.departmentId !== row.resolvedDepartment.id) {
        empPatch.departmentId = row.resolvedDepartment.id;
        empPatch.departmentName = row.resolvedDepartment.name;
        nextDeptId = row.resolvedDepartment.id;
      } else if (
        !row.resolvedDepartment &&
        row.customDepartmentName &&
        (Boolean(emp.departmentId) ||
          (emp.departmentName || '').trim().toLowerCase() !==
            row.customDepartmentName.toLowerCase())
      ) {
        empPatch.departmentId = '';
        empPatch.departmentName = row.customDepartmentName.slice(0, 80);
        nextDeptId = '';
      }
      if (row.designation && row.designation.trim() && row.designation.trim() !== emp.designation) {
        empPatch.designation = row.designation.trim().slice(0, 80);
      }
      if (row.gender && row.gender.trim() && row.gender.trim() !== (emp.gender || '')) {
        empPatch.gender = row.gender.trim().slice(0, 20);
      }
      if (row.category && row.category.trim() && row.category.trim() !== (emp.category || '')) {
        empPatch.category = row.category.trim().slice(0, 40);
      }
      // Safely auto-link Sale ID onto Employee Master only if employee has none and no other employee owns it
      if (row.saleId && !emp.saleId) {
        const candidateSaleId = row.saleId.trim().toUpperCase().slice(0, 40);
        const ownerEmpId = saleIdOwnerMap.get(candidateSaleId);
        if (!ownerEmpId || ownerEmpId === cleanEmployeeId.toUpperCase()) {
          empPatch.saleId = candidateSaleId;
          saleIdOwnerMap.set(candidateSaleId, cleanEmployeeId.toUpperCase());
        }
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
      }
    }
  }

  // 1. Commit Salary Slips in safe 40-doc chunks with automatic per-slip self-healing fallback
  for (let i = 0; i < slipOps.length; i += 40) {
    const chunk = slipOps.slice(i, i + 40);
    try {
      const wb = writeBatch(db);
      for (const op of chunk) {
        wb.set(op.ref, op.data);
      }
      await wb.commit();
    } catch {
      // Self-heal per slip: re-read exact live immutable fields if the doc already exists in Firestore,
      // and isolate any single offending slip with crystal-clear diagnostics.
      for (const op of chunk) {
        let payload = op.data;
        try {
          const liveSnap = await getDoc(op.ref);
          if (liveSnap.exists()) {
            const liveData = liveSnap.data() as Partial<SalarySlip>;
            if (typeof liveData.uploadedAt === 'string' && liveData.uploadedAt.length > 0 && liveData.uploadedAt.length <= 40) {
              payload = { ...payload, uploadedAt: liveData.uploadedAt };
            }
          }
          await setDoc(op.ref, payload);
        } catch (slipErr) {
          const detail = `Salary slip write failed for ${payload.employeeName} (Emp ID: ${payload.employeeId}, Branch ID: ${payload.branchId}, Month: ${payload.monthKey}, Slip ID: ${payload.slipId}, Gross: ${payload.grossEarningsPaise}, Ded: ${payload.totalDeductionsPaise}, Net: ${payload.netPayablePaise}, Mode: "${payload.paymentMode || ''}").`;
          console.error(detail, slipErr);
          handleFirestoreError(
            new Error(`${slipErr instanceof Error ? slipErr.message : String(slipErr)} — ${detail}`),
            OperationType.WRITE,
            `salary_slips/${payload.slipId}`,
          );
        }
      }
    }
  }

  // 2. Commit Employee Master + atomic Pillar 7 active_auth_uids sync
  // Isolated per-step with per-employee fallback so one legacy employee doc never blocks or mislabels salary slip uploads.
  const updatedEmpMap = new Map<string, Employee>();
  const applySingleEmployeeSync = async (item: (typeof empSyncOps)[number]) => {
    const wb = writeBatch(db);
    wb.update(doc(db, 'employees', item.emp.employeeId), item.empPatch);
    const cleanUid = String(item.emp.authUid || '').trim();
    if (cleanUid && VALID_ID_RE.test(cleanUid)) {
      if (item.emp.status === 'ACTIVE') {
        const safeDept = sanitizeDepartmentId(item.nextDeptId ?? item.emp.departmentId ?? '');
        const activeDoc = buildActiveAuthUidRecord({
          authUid: cleanUid,
          employeeId: item.emp.employeeId,
          departmentId: safeDept,
          branchId: item.emp.branchId,
          branchName: item.emp.branchName,
          isBranchManager: item.emp.isBranchManager,
          updatedAt: now,
        });
        wb.set(doc(db, 'active_auth_uids', cleanUid), activeDoc);
      } else {
        wb.delete(doc(db, 'active_auth_uids', cleanUid));
      }
    }
    await wb.commit();

    const mergedEmp: Employee = {
      ...item.emp,
      ...(item.empPatch as Partial<Employee>),
    };
    updatedEmpMap.set(item.emp.employeeId.toUpperCase(), mergedEmp);
    masterProfilesSynced += 1;
    if (item.nextDeptId) departmentsSynced += 1;
  };

  for (let i = 0; i < empSyncOps.length; i += 180) {
    const chunk = empSyncOps.slice(i, i + 180);
    try {
      const wb = writeBatch(db);
      for (const item of chunk) {
        wb.update(doc(db, 'employees', item.emp.employeeId), item.empPatch);
        const cleanUid = String(item.emp.authUid || '').trim();
        if (cleanUid && VALID_ID_RE.test(cleanUid)) {
          if (item.emp.status === 'ACTIVE') {
            const safeDept = sanitizeDepartmentId(item.nextDeptId ?? item.emp.departmentId ?? '');
            const activeDoc = buildActiveAuthUidRecord({
              authUid: cleanUid,
              employeeId: item.emp.employeeId,
              departmentId: safeDept,
              branchId: item.emp.branchId,
              branchName: item.emp.branchName,
              isBranchManager: item.emp.isBranchManager,
              updatedAt: now,
            });
            wb.set(doc(db, 'active_auth_uids', cleanUid), activeDoc);
          } else {
            wb.delete(doc(db, 'active_auth_uids', cleanUid));
          }
        }
      }
      await wb.commit();
      for (const item of chunk) {
        const mergedEmp: Employee = {
          ...item.emp,
          ...(item.empPatch as Partial<Employee>),
        };
        updatedEmpMap.set(item.emp.employeeId.toUpperCase(), mergedEmp);
        masterProfilesSynced += 1;
        if (item.nextDeptId) departmentsSynced += 1;
      }
    } catch {
      // Fallback: sync each employee individually so 1 legacy profile never breaks the whole chunk
      for (const item of chunk) {
        try {
          await applySingleEmployeeSync(item);
        } catch {
          syncWarnings.push(
            `Skipped Employee Master auto-sync for ${item.emp.fullName} (${item.emp.employeeId}) — run "Sync Auth" in Employee Master if needed.`,
          );
        }
      }
    }
  }

  // 3. Auto-refresh 5-Department Top-3 Leaderboards if departments were updated (non-blocking)
  let leaderboardsRefreshedMonths = 0;
  if (departmentsSynced > 0 && params.incentives.length > 0) {
    try {
      const refreshedEmployees = params.allEmployees.map(
        (e) => updatedEmpMap.get(e.employeeId.toUpperCase()) || e,
      );
      const rankRes = await recomputeAndSaveDepartmentRankings({
        employees: refreshedEmployees,
        incentives: params.incentives,
        visibilitySettings: params.visibilitySettings,
      });
      leaderboardsRefreshedMonths = rankRes.monthsProcessed;
    } catch {
      syncWarnings.push(
        'Department Top-3 Leaderboards could not auto-refresh; click Refresh in Department Leaderboards tab.',
      );
    }
  }

  // 4. Write Audit Log (isolated error path: `audit_logs`)
  try {
    await writeSalaryAuditLog({
      action: 'PUBLISH_SALARY_SLIPS',
      targetType: 'salary_slips',
      targetId: Array.from(affectedMonths).sort().join('_') || `SLIPS_${Date.now()}`,
      summary: `Published ${slipOps.length} salary slip(s) for [${Array.from(affectedMonths).join(', ')}]; auto-synced ${departmentsSynced} department(s) & ${masterProfilesSynced} HR profile(s).`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'audit_logs');
  }

  return {
    slipsPublished: slipOps.length,
    departmentsSynced,
    masterProfilesSynced,
    leaderboardsRefreshedMonths,
    syncWarnings,
  };
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

/**
 * Super Admin ONLY: Bulk deletes an array of SalarySlip documents in safe 200-doc batches
 * and writes an immutable audit log entry.
 */
export async function deleteSalarySlipsBatch(params: {
  slips: SalarySlip[];
  scopeLabel?: string;
}): Promise<number> {
  const { slips, scopeLabel } = params;
  if (slips.length === 0) return 0;

  requireActor();
  for (let i = 0; i < slips.length; i += 200) {
    const chunk = slips.slice(i, i + 200);
    const wb = writeBatch(db);
    for (const s of chunk) {
      wb.delete(doc(db, 'salary_slips', s.slipId));
    }
    try {
      await wb.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'salary_slips');
      throw error;
    }
  }

  const months = Array.from(new Set(slips.map((s) => s.monthKey))).sort();
  try {
    await writeSalaryAuditLog({
      action: 'BULK_DELETE_SALARY_SLIPS',
      targetType: 'salary_slips',
      targetId: months.join('_') || `BULK_DEL_${Date.now()}`,
      summary: `Bulk deleted ${slips.length} salary slip(s) (${scopeLabel || months.join(', ')}).`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'audit_logs');
  }

  return slips.length;
}

/**
 * Super Admin ONLY: Moves/Reassigns an array of SalarySlips from their current monthKey
 * to `targetMonthKey` (e.g. Nov 2026 -> Oct 2026), creating/updating the target
 * `{targetMonthKey}__{employeeId}` documents with exact rule-valid fields and deleting
 * the old wrong-month documents atomically in batches.
 */
export async function moveSalarySlipsToMonthBatch(params: {
  slips: SalarySlip[];
  targetMonthKey: string;
  existingSlips: SalarySlip[];
  visibilitySettings?: PortalVisibilitySettings | null;
}): Promise<{ movedCount: number; deletedOldCount: number }> {
  const { slips, targetMonthKey, existingSlips, visibilitySettings } = params;
  const cleanTargetMonth = targetMonthKey.trim();
  if (!VALID_MONTH_KEY_RE.test(cleanTargetMonth)) {
    throw new Error('Select a valid target month (YYYY-MM).');
  }

  const movable = slips.filter((s) => s.monthKey !== cleanTargetMonth);
  if (movable.length === 0) {
    throw new Error(`All selected slips are already in ${cleanTargetMonth}.`);
  }

  const actor = requireActor();
  const now = new Date().toISOString();
  const targetVisible = isSalarySlipMonthVisibleToEmployees(cleanTargetMonth, visibilitySettings);

  // Build map of existing target-month slips so we preserve immutable uploadedAt if target doc already exists
  const existingById = new Map<string, SalarySlip>();
  for (const s of existingSlips) {
    existingById.set(s.slipId, s);
  }
  try {
    const snap = await getDocs(
      query(collection(db, 'salary_slips'), where('monthKey', '==', cleanTargetMonth)),
    );
    for (const d of snap.docs) {
      const rec = d.data() as SalarySlip;
      existingById.set(d.id, rec);
      if (rec.slipId) existingById.set(rec.slipId, rec);
    }
  } catch {
    // Fallback to in-memory existingSlips
  }

  let movedCount = 0;
  let deletedOldCount = 0;

  for (let i = 0; i < movable.length; i += 80) {
    const chunk = movable.slice(i, i + 80);
    const preparedOps: Array<{
      oldSlip: SalarySlip;
      newSlipId: string;
      newSlipDoc: SalarySlip;
    }> = [];

    const wb = writeBatch(db);
    for (const oldSlip of chunk) {
      const cleanEmpId = oldSlip.employeeId.trim();
      const newSlipId = buildSalarySlipId(cleanTargetMonth, cleanEmpId);
      const existingTarget = existingById.get(newSlipId);

      const newSlipDoc: SalarySlip = {
        ...oldSlip,
        slipId: newSlipId,
        monthKey: cleanTargetMonth,
        employeeVisible: targetVisible,
        uploadedByEmail: actor.email,
        uploadedAt: (existingTarget?.uploadedAt || oldSlip.uploadedAt || now).slice(0, 40),
        updatedAt: now,
      };

      const preflightErr = validateSalarySlipDocForRules(newSlipDoc);
      if (preflightErr) {
        throw new Error(preflightErr);
      }

      preparedOps.push({ oldSlip, newSlipId, newSlipDoc });
      wb.set(doc(db, 'salary_slips', newSlipId), newSlipDoc);
      if (oldSlip.slipId !== newSlipId) {
        wb.delete(doc(db, 'salary_slips', oldSlip.slipId));
      }
    }

    try {
      await wb.commit();
      for (const op of preparedOps) {
        movedCount += 1;
        if (op.oldSlip.slipId !== op.newSlipId) {
          deletedOldCount += 1;
        }
      }
    } catch {
      // Self-heal per slip: re-read exact live immutable uploadedAt if target doc already exists
      for (const op of preparedOps) {
        let payload = op.newSlipDoc;
        try {
          const targetRef = doc(db, 'salary_slips', op.newSlipId);
          const liveSnap = await getDoc(targetRef);
          if (liveSnap.exists()) {
            const liveData = liveSnap.data() as Partial<SalarySlip>;
            if (
              typeof liveData.uploadedAt === 'string' &&
              liveData.uploadedAt.length > 0 &&
              liveData.uploadedAt.length <= 40
            ) {
              payload = { ...payload, uploadedAt: liveData.uploadedAt };
            }
          }
          const singleWb = writeBatch(db);
          singleWb.set(targetRef, payload);
          if (op.oldSlip.slipId !== op.newSlipId) {
            singleWb.delete(doc(db, 'salary_slips', op.oldSlip.slipId));
          }
          await singleWb.commit();
          movedCount += 1;
          if (op.oldSlip.slipId !== op.newSlipId) {
            deletedOldCount += 1;
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `salary_slips/${op.newSlipId}`);
          throw error;
        }
      }
    }
  }

  const sourceMonths = Array.from(new Set(movable.map((s) => s.monthKey))).sort();
  try {
    await writeSalaryAuditLog({
      action: 'MOVE_SALARY_SLIPS_MONTH',
      targetType: 'salary_slips',
      targetId: `${sourceMonths.join('_')}__TO__${cleanTargetMonth}`,
      summary: `Moved ${movedCount} salary slip(s) from [${sourceMonths.join(', ')}] to ${cleanTargetMonth} and removed ${deletedOldCount} old slip(s).`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'audit_logs');
  }

  return { movedCount, deletedOldCount };
}

