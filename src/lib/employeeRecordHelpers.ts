import { getDepartmentById } from './departmentLeaderboardEngine';
import { sanitizeId } from './format';
import { maskBankAccountNumber } from './salarySlipEngine';
import type { ActiveAuthUidRecord, DepartmentId, Employee } from '../types/incentive';

/**
 * Sanitizes Employee Master dynamic custom columns to strictly honor
 * firebase-blueprint.json & firestore.rules volumetric bounds (<= 25 keys, key <= 60, value <= 200).
 */
export function sanitizeEmployeeCustomFields(
  raw?: Record<string, string>,
): Record<string, string> {
  const clean: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return clean;
  for (const [k, v] of Object.entries(raw)) {
    const cleanKey = String(k || '').trim().slice(0, 60);
    const cleanVal = String(v ?? '').trim().slice(0, 200);
    if (cleanKey && cleanVal && Object.keys(clean).length < 25) {
      clean[cleanKey] = cleanVal;
    }
  }
  return clean;
}

/**
 * Single Source of Truth for `/active_auth_uids/{authUid}` Pillar 7 documents.
 * Guarantees `branchId`, `branchName`, `isBranchManager`, and `departmentId`
 * are NEVER dropped during login activation, bulk updates, salary slip sync,
 * DOB uploads, department uploads, branch transfers, or first-login self-claim.
 */
export function buildActiveAuthUidRecord(params: {
  authUid: string;
  employeeId: string;
  departmentId?: DepartmentId | '' | string;
  branchId?: string;
  branchName?: string;
  isBranchManager?: boolean;
  updatedAt: string;
}): ActiveAuthUidRecord {
  const resolvedDept = getDepartmentById(params.departmentId);
  const cleanBranchId = String(params.branchId || '').trim().slice(0, 64);
  const cleanBranchName = String(params.branchName || '').trim().slice(0, 120);

  return {
    authUid: String(params.authUid || '').trim().slice(0, 128),
    employeeId: String(params.employeeId || '').trim().slice(0, 64),
    departmentId: resolvedDept ? resolvedDept.id : '',
    ...(cleanBranchId ? { branchId: cleanBranchId } : {}),
    ...(cleanBranchName ? { branchName: cleanBranchName } : {}),
    isBranchManager: Boolean(params.isBranchManager),
    active: true,
    updatedAt: params.updatedAt,
  };
}

/**
 * Builds a schema-valid Employee Master document when provisioning/activating
 * a pending employee's Firebase Auth login.
 * Preserves ALL employee master fields — including `saleId`, `gender`, `category`,
 * `isBranchManager`, `address`, `emergencyContact`, and `customFields`.
 */
export function buildCleanProvisionedEmployeeDoc(
  emp: Employee,
  uid: string,
  now: string,
  authEmailForLogin: (loginId: string) => string,
): Employee {
  const cleanEmpId = sanitizeId(emp.employeeId).slice(0, 64);
  const cleanLoginId = sanitizeId(emp.loginId || `HOM${emp.employeeId}`).slice(0, 40);
  const safeLoginId =
    cleanLoginId.length >= 3
      ? cleanLoginId
      : `HOM${cleanEmpId}`.slice(0, 40);
  const cleanSaleId = emp.saleId?.trim()
    ? sanitizeId(emp.saleId.trim().toUpperCase().replace(/\s+/g, '')).toUpperCase().slice(0, 40)
    : '';
  const resolvedDept = getDepartmentById(emp.departmentId);
  const cleanCustomFields = sanitizeEmployeeCustomFields(emp.customFields);

  return {
    employeeId: cleanEmpId,
    ...(cleanSaleId ? { saleId: cleanSaleId } : {}),
    loginId: safeLoginId,
    authEmail: authEmailForLogin(safeLoginId),
    authUid: uid,
    fullName: (emp.fullName || `Employee ${emp.employeeId}`).trim().slice(0, 120),
    branchId: emp.branchId,
    branchName: (emp.branchName || emp.branchId).trim().slice(0, 120),
    ...(resolvedDept
      ? { departmentId: resolvedDept.id, departmentName: resolvedDept.name }
      : emp.departmentName?.trim()
        ? { departmentId: '' as const, departmentName: emp.departmentName.trim().slice(0, 80) }
        : {}),
    ...(emp.photoDataUrl?.trim()
      ? { photoDataUrl: emp.photoDataUrl.trim().slice(0, 45000) }
      : {}),
    designation: (emp.designation || 'Employee').trim().slice(0, 80),
    ...(emp.gender?.trim() ? { gender: emp.gender.trim().slice(0, 20) } : {}),
    ...(emp.category?.trim() ? { category: emp.category.trim().slice(0, 40) } : {}),
    ...(emp.dateOfBirth?.trim() ? { dateOfBirth: emp.dateOfBirth.trim().slice(0, 20) } : {}),
    ...(emp.dateOfJoining?.trim() ? { dateOfJoining: emp.dateOfJoining.trim().slice(0, 20) } : {}),
    ...(emp.panNumber?.trim()
      ? { panNumber: emp.panNumber.trim().toUpperCase().slice(0, 20) }
      : {}),
    ...(emp.uanNumber?.trim() ? { uanNumber: emp.uanNumber.trim().slice(0, 24) } : {}),
    ...(emp.pfNumber?.trim() ? { pfNumber: emp.pfNumber.trim().slice(0, 32) } : {}),
    ...(emp.esicNumber?.trim() ? { esicNumber: emp.esicNumber.trim().slice(0, 32) } : {}),
    ...(emp.bankName?.trim() ? { bankName: emp.bankName.trim().slice(0, 80) } : {}),
    ...(emp.bankAccountMasked?.trim()
      ? { bankAccountMasked: maskBankAccountNumber(emp.bankAccountMasked) }
      : {}),
    ...(emp.bankIfsc?.trim()
      ? { bankIfsc: emp.bankIfsc.trim().toUpperCase().slice(0, 20) }
      : {}),
    role: 'EMPLOYEE',
    ...(emp.isBranchManager !== undefined
      ? { isBranchManager: Boolean(emp.isBranchManager) }
      : {}),
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
    ...(Object.keys(cleanCustomFields).length > 0
      ? { customFields: cleanCustomFields }
      : {}),
  };
}
