import JSZip from 'jszip';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  buildEmployeeSalarySlipPdfBytes,
  loadBrandLogoPngDataUrlPublic,
} from '../lib/pdfGenerator';
import { recordAuditLog } from './incentiveService';
import type {
  Employee,
  EmployeeLoan,
  LoanStatus,
  LoanType,
  MonthlySummary,
  PayrollLockSettings,
  SalarySlip,
  SalesTarget,
} from '../types/incentive';

function sanitizeId(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
}

// =========================================================================
// 1. EMPLOYEE ADVANCES & LOANS EMI TRACKER SERVICE
// =========================================================================

export async function listAllEmployeeLoans(): Promise<EmployeeLoan[]> {
  try {
    const snap = await getDocs(collection(db, 'employee_loans'));
    return snap.docs
      .map((d) => d.data() as EmployeeLoan)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'employee_loans');
    throw error;
  }
}

export function subscribeOwnEmployeeLoans(
  authUid: string,
  employeeId: string,
  onUpdate: (loans: EmployeeLoan[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const byId = new Map<string, EmployeeLoan>();
  const emit = () => {
    onUpdate(
      Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  };

  const unsubs: Unsubscribe[] = [];
  if (authUid) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'employee_loans'), where('authUid', '==', authUid)),
        (snap) => {
          for (const d of snap.docs) {
            const loan = d.data() as EmployeeLoan;
            byId.set(loan.loanId, loan);
          }
          emit();
        },
        (err) => {
          onError?.(err instanceof Error ? err : new Error(String(err)));
        },
      ),
    );
  }
  if (employeeId) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'employee_loans'), where('employeeId', '==', employeeId)),
        (snap) => {
          const seenIds = new Set<string>();
          for (const d of snap.docs) {
            const loan = d.data() as EmployeeLoan;
            seenIds.add(loan.loanId);
            byId.set(loan.loanId, loan);
          }
          for (const existingId of Array.from(byId.keys())) {
            const existing = byId.get(existingId);
            if (existing && existing.employeeId === employeeId && !seenIds.has(existingId)) {
              byId.delete(existingId);
            }
          }
          emit();
        },
        (err) => {
          onError?.(err instanceof Error ? err : new Error(String(err)));
        },
      ),
    );
  }

  return () => {
    for (const u of unsubs) u();
  };
}

export async function createEmployeeLoan(input: {
  employee: Employee;
  loanType: LoanType;
  principalRupees: number;
  totalInstallments: number;
  startMonthKey: string;
  remarks?: string;
}): Promise<EmployeeLoan> {
  const actor = auth.currentUser;
  const actorEmail = (actor?.email || 'admin').slice(0, 180);
  const principalPaise = Math.round(input.principalRupees * 100);
  const totalInstallments = Math.max(1, Math.min(120, Math.round(input.totalInstallments)));

  if (!Number.isFinite(principalPaise) || principalPaise <= 0) {
    throw new Error('Principal amount must be greater than ₹0.');
  }
  if (!/^\d{4}-\d{2}$/.test(input.startMonthKey)) {
    throw new Error('Start month must be in YYYY-MM format.');
  }

  const monthlyEmiPaise = Math.min(principalPaise, Math.ceil(principalPaise / totalInstallments));
  const now = new Date().toISOString();
  const loanId = sanitizeId(
    `LOAN_${input.employee.employeeId}_${input.startMonthKey}_${Date.now().toString(36).toUpperCase()}`,
  ).slice(0, 128);

  const record: EmployeeLoan = {
    loanId,
    employeeId: input.employee.employeeId,
    ...(input.employee.authUid ? { authUid: input.employee.authUid } : {}),
    employeeName: input.employee.fullName.slice(0, 120),
    branchId: input.employee.branchId,
    branchName: input.employee.branchName.slice(0, 120),
    loanType: input.loanType,
    principalPaise,
    monthlyEmiPaise,
    totalInstallments,
    paidInstallments: 0,
    remainingBalancePaise: principalPaise,
    startMonthKey: input.startMonthKey,
    status: 'ACTIVE',
    ...(input.remarks?.trim() ? { remarks: input.remarks.trim().slice(0, 240) } : {}),
    createdByEmail: actorEmail,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await setDoc(doc(db, 'employee_loans', loanId), record);
    await recordAuditLog({
      action: 'LOAN_CREATED',
      targetType: 'employee',
      targetId: input.employee.employeeId,
      summary: `Created ${input.loanType} (${loanId}) for ${input.employee.fullName}: ₹${(principalPaise / 100).toFixed(2)} across ${totalInstallments} EMI(s) starting ${input.startMonthKey}.`,
    });
    return record;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `employee_loans/${loanId}`);
    throw error;
  }
}

export async function recordLoanEmiDeduction(params: {
  loan: EmployeeLoan;
  monthKey: string;
  deductedPaise?: number;
}): Promise<EmployeeLoan> {
  const { loan, monthKey } = params;
  if (loan.status !== 'ACTIVE' || loan.remainingBalancePaise <= 0) {
    throw new Error('This loan is already closed or has zero remaining balance.');
  }
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error('Select a valid deduction month (YYYY-MM).');
  }
  if (loan.lastDeductedMonthKey === monthKey) {
    throw new Error(`EMI for ${monthKey} was already recorded for this loan.`);
  }

  const amountPaise = Math.min(
    loan.remainingBalancePaise,
    Math.max(1, Math.round(params.deductedPaise ?? loan.monthlyEmiPaise)),
  );
  const nextRemaining = Math.max(0, loan.remainingBalancePaise - amountPaise);
  const nextPaid = Math.min(loan.totalInstallments, loan.paidInstallments + 1);
  const nextStatus: LoanStatus = nextRemaining === 0 ? 'CLOSED' : 'ACTIVE';
  const now = new Date().toISOString();

  const updatePayload: Partial<EmployeeLoan> = {
    paidInstallments: nextPaid,
    remainingBalancePaise: nextRemaining,
    lastDeductedMonthKey: monthKey,
    status: nextStatus,
    updatedAt: now,
  };

  try {
    await updateDoc(doc(db, 'employee_loans', loan.loanId), updatePayload);
    await recordAuditLog({
      action: nextStatus === 'CLOSED' ? 'LOAN_CLOSED' : 'LOAN_EMI_DEDUCTED',
      targetType: 'employee',
      targetId: loan.employeeId,
      summary: `Recorded EMI deduction of ₹${(amountPaise / 100).toFixed(2)} for ${loan.employeeName} (${loan.loanId}, ${monthKey}). Remaining balance: ₹${(nextRemaining / 100).toFixed(2)} (${nextStatus}).`,
    });
    return { ...loan, ...updatePayload };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `employee_loans/${loan.loanId}`);
    throw error;
  }
}

export async function updateEmployeeLoanStatus(
  loan: EmployeeLoan,
  status: LoanStatus,
  remarks?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    status,
    updatedAt: now,
  };
  if (status === 'CLOSED') {
    updatePayload.remainingBalancePaise = 0;
  }
  if (remarks !== undefined) {
    updatePayload.remarks = remarks.trim().slice(0, 240);
  }
  try {
    await updateDoc(doc(db, 'employee_loans', loan.loanId), updatePayload);
    await recordAuditLog({
      action: 'LOAN_STATUS_UPDATED',
      targetType: 'employee',
      targetId: loan.employeeId,
      summary: `Updated loan ${loan.loanId} (${loan.employeeName}) status to ${status}.`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `employee_loans/${loan.loanId}`);
  }
}

export async function deleteEmployeeLoan(loan: EmployeeLoan): Promise<void> {
  try {
    await deleteDoc(doc(db, 'employee_loans', loan.loanId));
    await recordAuditLog({
      action: 'LOAN_DELETED',
      targetType: 'employee',
      targetId: loan.employeeId,
      summary: `Deleted loan record ${loan.loanId} (${loan.employeeName}).`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `employee_loans/${loan.loanId}`);
  }
}

// =========================================================================
// 2. BRANCH MANAGER READ-ONLY FLOOR SUBSCRIPTION (OWN BRANCH ONLY)
// =========================================================================

export function subscribeBranchManagerFloorData(params: {
  branchId: string;
  onlyEmployeeVisible: boolean;
  onEmployees: (employees: Employee[]) => void;
  onSummaries: (summaries: MonthlySummary[]) => void;
  onTargets: (targets: SalesTarget[]) => void;
  onError?: (err: Error) => void;
}): Unsubscribe {
  const { branchId, onlyEmployeeVisible, onEmployees, onSummaries, onTargets, onError } = params;

  const empQ = query(collection(db, 'employees'), where('branchId', '==', branchId));
  const sumQ = onlyEmployeeVisible
    ? query(
        collection(db, 'monthly_summaries'),
        where('branchId', '==', branchId),
        where('employeeVisible', '==', true),
      )
    : query(collection(db, 'monthly_summaries'), where('branchId', '==', branchId));
  const tgtQ = onlyEmployeeVisible
    ? query(
        collection(db, 'sales_targets'),
        where('branchId', '==', branchId),
        where('employeeVisible', '==', true),
      )
    : query(collection(db, 'sales_targets'), where('branchId', '==', branchId));

  const unsubEmp = onSnapshot(
    empQ,
    (snap) => {
      onEmployees(
        snap.docs
          .map((d) => d.data() as Employee)
          .sort((a, b) => a.fullName.localeCompare(b.fullName)),
      );
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );

  const unsubSum = onSnapshot(
    sumQ,
    (snap) => {
      onSummaries(snap.docs.map((d) => d.data() as MonthlySummary));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );

  const unsubTgt = onSnapshot(
    tgtQ,
    (snap) => {
      onTargets(snap.docs.map((d) => d.data() as SalesTarget));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );

  return () => {
    unsubEmp();
    unsubSum();
    unsubTgt();
  };
}

// =========================================================================
// 3. BULK BRANCH-ORGANIZED SALARY SLIP ZIP EXPORT
// =========================================================================

export async function downloadBulkSalarySlipsZip(params: {
  slips: SalarySlip[];
  monthLabel: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<number> {
  const { slips, monthLabel, onProgress } = params;
  if (slips.length === 0) return 0;

  const zip = new JSZip();
  const logoDataUrl = await loadBrandLogoPngDataUrlPublic();

  for (let i = 0; i < slips.length; i += 1) {
    const slip = slips[i];
    const pdfBytes = await buildEmployeeSalarySlipPdfBytes(slip, logoDataUrl);
    const branchFolder = (slip.branchName || 'General')
      .trim()
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .replace(/\s+/g, '_');
    const safeEmpId = slip.employeeId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeName = slip.employeeName
      .trim()
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 40);
    const filePath = `${branchFolder}/${safeEmpId}_${safeName}_${slip.monthKey}.pdf`;
    zip.file(filePath, pdfBytes);
    onProgress?.(i + 1, slips.length);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeMonth = monthLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
  a.href = url;
  a.download = `House_of_Muktai_Salary_Slips_${safeMonth}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return slips.length;
}

// =========================================================================
// 4. MONTH PAYROLL LOCK / FREEZE (MAKER-CHECKER GOVERNANCE - PRO #4)
// =========================================================================

export const DEFAULT_PAYROLL_LOCKS: PayrollLockSettings = {
  settingId: 'payroll_locks',
  lockedMonths: [],
  updatedByEmail: '',
  updatedAt: '',
};

export function isMonthPayrollLockedLocal(
  monthKey: string,
  lockSettings?: PayrollLockSettings | null,
): boolean {
  if (!monthKey || !lockSettings?.lockedMonths?.length) return false;
  return lockSettings.lockedMonths.includes(monthKey);
}

export async function fetchPayrollLockSettings(): Promise<PayrollLockSettings> {
  try {
    const snap = await getDoc(doc(db, 'portal_settings', 'payroll_locks'));
    if (!snap.exists()) return DEFAULT_PAYROLL_LOCKS;
    const raw = snap.data() as Partial<PayrollLockSettings>;
    const lockedMonths = Array.isArray(raw.lockedMonths)
      ? raw.lockedMonths.filter((m): m is string => typeof m === 'string' && /^\d{4}-\d{2}$/.test(m))
      : [];
    return {
      settingId: 'payroll_locks',
      lockedMonths: Array.from(new Set(lockedMonths)).sort().reverse(),
      ...(typeof raw.lockNote === 'string' && raw.lockNote.trim()
        ? { lockNote: raw.lockNote.trim() }
        : {}),
      updatedByEmail: raw.updatedByEmail || '',
      updatedAt: raw.updatedAt || '',
    };
  } catch {
    return DEFAULT_PAYROLL_LOCKS;
  }
}

export async function toggleMonthPayrollLock(params: {
  monthKey: string;
  lock: boolean;
  note?: string;
  currentSettings?: PayrollLockSettings | null;
}): Promise<PayrollLockSettings> {
  const { monthKey, lock, note, currentSettings } = params;
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error('Select a valid month (YYYY-MM) to lock or unlock.');
  }

  const base = currentSettings || (await fetchPayrollLockSettings());
  const nextSet = new Set(base.lockedMonths);
  if (lock) nextSet.add(monthKey);
  else nextSet.delete(monthKey);

  const lockedMonths = Array.from(nextSet).sort().reverse().slice(0, 48);
  const now = new Date().toISOString();
  const actorEmail = (auth.currentUser?.email || 'owner').slice(0, 180);
  const cleanNote = (note ?? base.lockNote ?? '').trim().slice(0, 240);

  const payload: PayrollLockSettings = {
    settingId: 'payroll_locks',
    lockedMonths,
    ...(cleanNote ? { lockNote: cleanNote } : {}),
    updatedByEmail: actorEmail,
    updatedAt: now,
  };

  try {
    await setDoc(doc(db, 'portal_settings', 'payroll_locks'), payload);
    await recordAuditLog({
      action: lock ? 'PAYROLL_MONTH_LOCKED' : 'PAYROLL_MONTH_UNLOCKED',
      targetType: 'portal_settings',
      targetId: monthKey,
      summary: `${lock ? 'Locked (frozen)' : 'Unlocked'} payroll & incentives for ${monthKey}.${
        cleanNote ? ` Note: ${cleanNote}` : ''
      }`,
    });
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'portal_settings/payroll_locks');
    throw error;
  }
}

