import { deleteField, doc, writeBatch } from 'firebase/firestore';
import { buildBirthdayProfileFromEmployee } from '../lib/birthdayEngine';
import { buildActiveAuthUidRecord } from '../lib/employeeRecordHelpers';
import {
  db,
  handleFirestoreError,
  loginIdToAuthEmail,
  OperationType,
} from '../lib/firebase';
import type { ParsedEmployeeMasterRow } from '../lib/employeeBulkImportEngine';
import { recomputeAndSaveDepartmentRankings } from './departmentVisibilityService';
import { recordAuditLog } from './incentiveService';
import type {
  Employee,
  PortalVisibilitySettings,
  PublishedIncentive,
} from '../types/incentive';

export interface BulkEmployeeCommitResult {
  createdCount: number;
  updatedCount: number;
  birthdayProfilesSynced: number;
  activeRegistrySynced: number;
  leaderboardMonthsRefreshed: number;
}

type BatchOp =
  | { kind: 'set'; ref: ReturnType<typeof doc>; data: Record<string, unknown> }
  | { kind: 'update'; ref: ReturnType<typeof doc>; data: Record<string, unknown> }
  | { kind: 'delete'; ref: ReturnType<typeof doc> };

/**
 * Atomically commits validated NEW employees and explicitly Admin-approved OVERLAP updates.
 * - Strictly honors Pillar 7 (`active_auth_uids` kept in sync inside the same WriteBatch unit)
 * - Syncs privacy-isolated `birthday_profiles` for active employees with valid DOB
 * - Refreshes Top-3 department leaderboards if departments changed
 */
export async function commitEmployeeMasterBulkImport(params: {
  rowsToCreate: ParsedEmployeeMasterRow[];
  rowsToUpdate: ParsedEmployeeMasterRow[];
  allEmployees: Employee[];
  incentives?: PublishedIncentive[];
  visibilitySettings?: PortalVisibilitySettings;
}): Promise<BulkEmployeeCommitResult> {
  const {
    rowsToCreate,
    rowsToUpdate,
    allEmployees,
    incentives = [],
    visibilitySettings,
  } = params;

  const now = new Date().toISOString();
  const opUnits: BatchOp[][] = [];

  let createdCount = 0;
  let updatedCount = 0;
  let birthdayProfilesSynced = 0;
  let activeRegistrySynced = 0;
  let departmentTouched = false;

  const updatedEmployeeMap = new Map<string, Employee>(
    allEmployees.map((e) => [e.employeeId.toUpperCase(), e]),
  );

  // 1. Create brand-new employees (never overwrites existing)
  for (const row of rowsToCreate) {
    if (row.status !== 'NEW_READY' || !row.employeeId || !row.branchId) continue;

    const empPayload: Employee = {
      employeeId: row.employeeId,
      ...(row.saleId ? { saleId: row.saleId } : {}),
      loginId: row.loginId,
      authEmail: loginIdToAuthEmail(row.loginId),
      authUid: '',
      fullName: row.fullName,
      branchId: row.branchId,
      branchName: row.branchName,
      designation: row.designation,
      ...(row.gender ? { gender: row.gender } : {}),
      ...(row.category ? { category: row.category } : {}),
      role: 'EMPLOYEE',
      status: row.employeeStatus,
      mustChangePassword: true,
      credentialsProvisioned: false,
      createdAt: now,
      updatedAt: now,
      ...(row.departmentId
        ? { departmentId: row.departmentId, departmentName: row.departmentName }
        : row.departmentName
          ? { departmentId: '' as const, departmentName: row.departmentName }
          : {}),
      ...(row.dateOfBirth ? { dateOfBirth: row.dateOfBirth } : {}),
      ...(row.dateOfJoining ? { dateOfJoining: row.dateOfJoining } : {}),
      ...(row.phone ? { phone: row.phone } : {}),
      ...(row.panNumber ? { panNumber: row.panNumber } : {}),
      ...(row.uanNumber ? { uanNumber: row.uanNumber } : {}),
      ...(row.pfNumber ? { pfNumber: row.pfNumber } : {}),
      ...(row.esicNumber ? { esicNumber: row.esicNumber } : {}),
      ...(row.bankName ? { bankName: row.bankName } : {}),
      ...(row.bankAccountMasked ? { bankAccountMasked: row.bankAccountMasked } : {}),
      ...(row.bankIfsc ? { bankIfsc: row.bankIfsc } : {}),
      ...(row.linkedGoogleEmail ? { linkedGoogleEmail: row.linkedGoogleEmail } : {}),
      ...(row.address ? { address: row.address } : {}),
      ...(row.emergencyContact ? { emergencyContact: row.emergencyContact } : {}),
      ...(row.fatherOrSpouseName ? { fatherOrSpouseName: row.fatherOrSpouseName } : {}),
      ...(row.maritalStatus ? { maritalStatus: row.maritalStatus } : {}),
      ...(row.bloodGroup ? { bloodGroup: row.bloodGroup } : {}),
      ...(row.qualification ? { qualification: row.qualification } : {}),
      ...(row.dateOfExit ? { dateOfExit: row.dateOfExit } : {}),
      ...(row.exitReason ? { exitReason: row.exitReason } : {}),
      ...(row.employmentType ? { employmentType: row.employmentType } : {}),
      ...(row.reportingManager ? { reportingManager: row.reportingManager } : {}),
      ...(row.shiftTiming ? { shiftTiming: row.shiftTiming } : {}),
      ...(row.weeklyOffDay ? { weeklyOffDay: row.weeklyOffDay } : {}),
      ...(row.uniformSize ? { uniformSize: row.uniformSize } : {}),
      ...(row.alternatePhone ? { alternatePhone: row.alternatePhone } : {}),
      ...(row.personalEmail ? { personalEmail: row.personalEmail } : {}),
      ...(row.aadhaarMasked ? { aadhaarMasked: row.aadhaarMasked } : {}),
      ...(row.monthlyGrossSalaryPaise !== undefined && row.monthlyGrossSalaryPaise > 0
        ? { monthlyGrossSalaryPaise: row.monthlyGrossSalaryPaise }
        : {}),
      ...(row.paymentMode ? { paymentMode: row.paymentMode } : {}),
      ...(row.bankBranchName ? { bankBranchName: row.bankBranchName } : {}),
      ...(row.upiId ? { upiId: row.upiId } : {}),
      ...(row.permanentAddress ? { permanentAddress: row.permanentAddress } : {}),
      ...(row.emergencyContactName ? { emergencyContactName: row.emergencyContactName } : {}),
      ...(row.nomineeName ? { nomineeName: row.nomineeName } : {}),
      ...(row.nomineeRelation ? { nomineeRelation: row.nomineeRelation } : {}),
      ...(row.hrRemarks ? { hrRemarks: row.hrRemarks } : {}),
      ...(row.customFields && Object.keys(row.customFields).length > 0
        ? { customFields: row.customFields }
        : {}),
    };

    const unit: BatchOp[] = [
      {
        kind: 'set',
        ref: doc(db, 'employees', empPayload.employeeId),
        data: empPayload as unknown as Record<string, unknown>,
      },
    ];

    const birthdayProfile = buildBirthdayProfileFromEmployee(empPayload, now);
    if (birthdayProfile) {
      unit.push({
        kind: 'set',
        ref: doc(db, 'birthday_profiles', empPayload.employeeId),
        data: birthdayProfile as unknown as Record<string, unknown>,
      });
      birthdayProfilesSynced += 1;
    }

    opUnits.push(unit);
    updatedEmployeeMap.set(empPayload.employeeId.toUpperCase(), empPayload);
    if (empPayload.departmentId) departmentTouched = true;
    createdCount += 1;
  }

  // 2. Update ONLY explicitly Admin-approved overlap rows
  for (const row of rowsToUpdate) {
    if (row.status !== 'OVERLAP_CONFLICT' || !row.existingEmployee) continue;
    const existing = row.existingEmployee;

    const mergedEmp: Employee = {
      ...existing,
      ...(row.saleId ? { saleId: row.saleId } : {}),
      loginId: row.loginId,
      authEmail:
        row.loginId !== existing.loginId
          ? loginIdToAuthEmail(row.loginId)
          : existing.authEmail,
      fullName: row.fullName,
      branchId: row.branchId,
      branchName: row.branchName,
      designation: row.designation,
      ...(row.gender ? { gender: row.gender } : {}),
      ...(row.category ? { category: row.category } : {}),
      status: row.employeeStatus,
      role: 'EMPLOYEE',
      updatedAt: now,
      ...(row.departmentId
        ? { departmentId: row.departmentId, departmentName: row.departmentName }
        : row.departmentName
          ? { departmentId: '' as const, departmentName: row.departmentName }
          : existing.departmentId
            ? { departmentId: existing.departmentId, departmentName: existing.departmentName }
            : existing.departmentName
              ? { departmentId: '' as const, departmentName: existing.departmentName }
              : {}),
      ...(row.dateOfBirth ? { dateOfBirth: row.dateOfBirth } : {}),
      ...(row.dateOfJoining ? { dateOfJoining: row.dateOfJoining } : {}),
      ...(row.phone ? { phone: row.phone } : {}),
      ...(row.panNumber ? { panNumber: row.panNumber } : {}),
      ...(row.uanNumber ? { uanNumber: row.uanNumber } : {}),
      ...(row.pfNumber ? { pfNumber: row.pfNumber } : {}),
      ...(row.esicNumber ? { esicNumber: row.esicNumber } : {}),
      ...(row.bankName ? { bankName: row.bankName } : {}),
      ...(row.bankAccountMasked ? { bankAccountMasked: row.bankAccountMasked } : {}),
      ...(row.bankIfsc ? { bankIfsc: row.bankIfsc } : {}),
      ...(row.linkedGoogleEmail ? { linkedGoogleEmail: row.linkedGoogleEmail } : {}),
      ...(row.address ? { address: row.address } : {}),
      ...(row.emergencyContact ? { emergencyContact: row.emergencyContact } : {}),
      ...(row.fatherOrSpouseName ? { fatherOrSpouseName: row.fatherOrSpouseName } : {}),
      ...(row.maritalStatus ? { maritalStatus: row.maritalStatus } : {}),
      ...(row.bloodGroup ? { bloodGroup: row.bloodGroup } : {}),
      ...(row.qualification ? { qualification: row.qualification } : {}),
      ...(row.dateOfExit ? { dateOfExit: row.dateOfExit } : {}),
      ...(row.exitReason ? { exitReason: row.exitReason } : {}),
      ...(row.employmentType ? { employmentType: row.employmentType } : {}),
      ...(row.reportingManager ? { reportingManager: row.reportingManager } : {}),
      ...(row.shiftTiming ? { shiftTiming: row.shiftTiming } : {}),
      ...(row.weeklyOffDay ? { weeklyOffDay: row.weeklyOffDay } : {}),
      ...(row.uniformSize ? { uniformSize: row.uniformSize } : {}),
      ...(row.alternatePhone ? { alternatePhone: row.alternatePhone } : {}),
      ...(row.personalEmail ? { personalEmail: row.personalEmail } : {}),
      ...(row.aadhaarMasked ? { aadhaarMasked: row.aadhaarMasked } : {}),
      ...(row.monthlyGrossSalaryPaise !== undefined && row.monthlyGrossSalaryPaise > 0
        ? { monthlyGrossSalaryPaise: row.monthlyGrossSalaryPaise }
        : {}),
      ...(row.paymentMode ? { paymentMode: row.paymentMode } : {}),
      ...(row.bankBranchName ? { bankBranchName: row.bankBranchName } : {}),
      ...(row.upiId ? { upiId: row.upiId } : {}),
      ...(row.permanentAddress ? { permanentAddress: row.permanentAddress } : {}),
      ...(row.emergencyContactName ? { emergencyContactName: row.emergencyContactName } : {}),
      ...(row.nomineeName ? { nomineeName: row.nomineeName } : {}),
      ...(row.nomineeRelation ? { nomineeRelation: row.nomineeRelation } : {}),
      ...(row.hrRemarks ? { hrRemarks: row.hrRemarks } : {}),
      ...(row.customFields && Object.keys(row.customFields).length > 0
        ? { customFields: row.customFields }
        : {}),
    };

    const updateFields: Record<string, unknown> = {
      loginId: mergedEmp.loginId,
      authEmail: mergedEmp.authEmail,
      fullName: mergedEmp.fullName,
      branchId: mergedEmp.branchId,
      branchName: mergedEmp.branchName,
      designation: mergedEmp.designation,
      status: mergedEmp.status,
      role: 'EMPLOYEE',
      updatedAt: now,
    };

    if (mergedEmp.saleId) updateFields.saleId = mergedEmp.saleId;
    if (mergedEmp.gender) updateFields.gender = mergedEmp.gender;
    if (mergedEmp.category) updateFields.category = mergedEmp.category;
    if (mergedEmp.departmentId || mergedEmp.departmentName) {
      updateFields.departmentId = mergedEmp.departmentId || '';
      updateFields.departmentName = mergedEmp.departmentName || '';
    }
    if (mergedEmp.dateOfBirth) updateFields.dateOfBirth = mergedEmp.dateOfBirth;
    if (mergedEmp.dateOfJoining) updateFields.dateOfJoining = mergedEmp.dateOfJoining;
    if (mergedEmp.phone) updateFields.phone = mergedEmp.phone;
    if (mergedEmp.panNumber) updateFields.panNumber = mergedEmp.panNumber;
    if (mergedEmp.uanNumber) updateFields.uanNumber = mergedEmp.uanNumber;
    if (mergedEmp.pfNumber) updateFields.pfNumber = mergedEmp.pfNumber;
    if (mergedEmp.esicNumber) updateFields.esicNumber = mergedEmp.esicNumber;
    if (mergedEmp.bankName) updateFields.bankName = mergedEmp.bankName;
    if (mergedEmp.bankAccountMasked) updateFields.bankAccountMasked = mergedEmp.bankAccountMasked;
    if (mergedEmp.bankIfsc) updateFields.bankIfsc = mergedEmp.bankIfsc;
    if (mergedEmp.linkedGoogleEmail) updateFields.linkedGoogleEmail = mergedEmp.linkedGoogleEmail;
    if (mergedEmp.address) updateFields.address = mergedEmp.address;
    if (mergedEmp.emergencyContact) updateFields.emergencyContact = mergedEmp.emergencyContact;
    if (mergedEmp.fatherOrSpouseName) updateFields.fatherOrSpouseName = mergedEmp.fatherOrSpouseName;
    if (mergedEmp.maritalStatus) updateFields.maritalStatus = mergedEmp.maritalStatus;
    if (mergedEmp.bloodGroup) updateFields.bloodGroup = mergedEmp.bloodGroup;
    if (mergedEmp.qualification) updateFields.qualification = mergedEmp.qualification;
    if (mergedEmp.dateOfExit) updateFields.dateOfExit = mergedEmp.dateOfExit;
    if (mergedEmp.exitReason) updateFields.exitReason = mergedEmp.exitReason;
    if (mergedEmp.employmentType) updateFields.employmentType = mergedEmp.employmentType;
    if (mergedEmp.reportingManager) updateFields.reportingManager = mergedEmp.reportingManager;
    if (mergedEmp.shiftTiming) updateFields.shiftTiming = mergedEmp.shiftTiming;
    if (mergedEmp.weeklyOffDay) updateFields.weeklyOffDay = mergedEmp.weeklyOffDay;
    if (mergedEmp.uniformSize) updateFields.uniformSize = mergedEmp.uniformSize;
    if (mergedEmp.alternatePhone) updateFields.alternatePhone = mergedEmp.alternatePhone;
    if (mergedEmp.personalEmail) updateFields.personalEmail = mergedEmp.personalEmail;
    if (mergedEmp.aadhaarMasked) updateFields.aadhaarMasked = mergedEmp.aadhaarMasked;
    if (
      typeof mergedEmp.monthlyGrossSalaryPaise === 'number' &&
      mergedEmp.monthlyGrossSalaryPaise > 0
    ) {
      updateFields.monthlyGrossSalaryPaise = mergedEmp.monthlyGrossSalaryPaise;
    }
    if (mergedEmp.paymentMode) updateFields.paymentMode = mergedEmp.paymentMode;
    if (mergedEmp.bankBranchName) updateFields.bankBranchName = mergedEmp.bankBranchName;
    if (mergedEmp.upiId) updateFields.upiId = mergedEmp.upiId;
    if (mergedEmp.permanentAddress) updateFields.permanentAddress = mergedEmp.permanentAddress;
    if (mergedEmp.emergencyContactName) {
      updateFields.emergencyContactName = mergedEmp.emergencyContactName;
    }
    if (mergedEmp.nomineeName) updateFields.nomineeName = mergedEmp.nomineeName;
    if (mergedEmp.nomineeRelation) updateFields.nomineeRelation = mergedEmp.nomineeRelation;
    if (mergedEmp.hrRemarks) updateFields.hrRemarks = mergedEmp.hrRemarks;
    if (mergedEmp.customFields && Object.keys(mergedEmp.customFields).length > 0) {
      updateFields.customFields = mergedEmp.customFields;
    } else if (
      existing.customFields &&
      Object.keys(existing.customFields).length > 0 &&
      row.customFields &&
      Object.keys(row.customFields).length === 0
    ) {
      updateFields.customFields = deleteField();
    }

    const unit: BatchOp[] = [
      {
        kind: 'update',
        ref: doc(db, 'employees', existing.employeeId),
        data: updateFields,
      },
    ];

    // Pillar 7 atomicity: keep active_auth_uids synced inside the EXACT same WriteBatch
    if (existing.authUid && existing.authUid.trim() !== '') {
      const activeRef = doc(db, 'active_auth_uids', existing.authUid);
      if (mergedEmp.status === 'ACTIVE') {
        const activeRecord = buildActiveAuthUidRecord({
          authUid: existing.authUid,
          employeeId: existing.employeeId,
          departmentId: mergedEmp.departmentId,
          branchId: mergedEmp.branchId,
          branchName: mergedEmp.branchName,
          isBranchManager: mergedEmp.isBranchManager,
          updatedAt: now,
        });
        unit.push({
          kind: 'set',
          ref: activeRef,
          data: activeRecord as unknown as Record<string, unknown>,
        });
      } else {
        unit.push({ kind: 'delete', ref: activeRef });
      }
      activeRegistrySynced += 1;
    }

    // Sync or remove privacy-isolated 12-branch birthday profile
    const birthdayProfile = buildBirthdayProfileFromEmployee(mergedEmp, now);
    if (birthdayProfile) {
      unit.push({
        kind: 'set',
        ref: doc(db, 'birthday_profiles', existing.employeeId),
        data: birthdayProfile as unknown as Record<string, unknown>,
      });
      birthdayProfilesSynced += 1;
    } else if (existing.dateOfBirth || existing.status !== mergedEmp.status) {
      unit.push({
        kind: 'delete',
        ref: doc(db, 'birthday_profiles', existing.employeeId),
      });
    }

    if (mergedEmp.departmentId !== existing.departmentId) {
      departmentTouched = true;
    }

    opUnits.push(unit);
    updatedEmployeeMap.set(existing.employeeId.toUpperCase(), mergedEmp);
    updatedCount += 1;
  }

  // Commit in atomic chunks (<= 300 Firestore ops per batch, never splitting an employee unit)
  try {
    let batch = writeBatch(db);
    let opsInBatch = 0;

    for (const unit of opUnits) {
      if (opsInBatch + unit.length > 300) {
        await batch.commit();
        batch = writeBatch(db);
        opsInBatch = 0;
      }
      for (const op of unit) {
        if (op.kind === 'set') {
          batch.set(op.ref, op.data);
        } else if (op.kind === 'update') {
          batch.update(op.ref, op.data);
        } else {
          batch.delete(op.ref);
        }
        opsInBatch += 1;
      }
    }

    if (opsInBatch > 0) {
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'employees/bulk-master-import');
  }

  // Refresh Top-3 Department Leaderboards if any department was added or updated
  let leaderboardMonthsRefreshed = 0;
  if (departmentTouched && incentives.length > 0) {
    try {
      const rankRes = await recomputeAndSaveDepartmentRankings({
        employees: Array.from(updatedEmployeeMap.values()),
        incentives,
        visibilitySettings,
      });
      leaderboardMonthsRefreshed = rankRes.monthsProcessed;
    } catch {
      // Non-blocking
    }
  }

  if (createdCount > 0 || updatedCount > 0) {
    await recordAuditLog({
      action: 'BULK_EMPLOYEE_MASTER_IMPORT',
      targetType: 'employee',
      targetId: `BULK_${createdCount}_${updatedCount}`,
      summary: `Bulk Employee Master import: ${createdCount} new employee(s) created, ${updatedCount} admin-approved overlap update(s) applied, ${birthdayProfilesSynced} birthday profile(s) synced.`,
    });
  }

  return {
    createdCount,
    updatedCount,
    birthdayProfilesSynced,
    activeRegistrySynced,
    leaderboardMonthsRefreshed,
  };
}
