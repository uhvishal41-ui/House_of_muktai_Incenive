import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  type Unsubscribe,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import type {
  AdjustmentType,
  EmployeeQuery,
  IncentiveAdjustment,
  PaymentMode,
  PayoutRecord,
  PayoutStatus,
  QueryCategory,
  QueryStatus,
  SalesTarget,
} from '../types/incentive';

function requireActor() {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required.');
  return {
    uid: user.uid,
    email: user.email || 'unknown@houseofmuktai.co.in',
  };
}

async function writeOpsAuditLog(params: {
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
}): Promise<void> {
  const actor = requireActor();
  const now = new Date().toISOString();
  const logId = `LOG_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  try {
    await setDoc(doc(db, 'audit_logs', logId), {
      logId,
      action: params.action,
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: 'SUPER_ADMIN',
      targetType: params.targetType,
      targetId: params.targetId,
      summary: params.summary.slice(0, 400),
      createdAt: now,
    });
  } catch {
    // Non-blocking secondary audit write
  }
}

// =========================================================================
// 1. PAYOUT SETTLEMENT TRACKING (payout_records)
// =========================================================================

export async function listAllPayoutRecords(): Promise<PayoutRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'payout_records'));
    return snap.docs
      .map((d) => d.data() as PayoutRecord)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'payout_records');
  }
}

export async function fetchOwnPayoutRecords(): Promise<PayoutRecord[]> {
  const actor = requireActor();
  try {
    const q = query(collection(db, 'payout_records'), where('authUid', '==', actor.uid));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as PayoutRecord)
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'payout_records');
  }
}

export function subscribeOwnPayoutRecords(
  uid: string,
  onData: (records: PayoutRecord[]) => void,
): Unsubscribe {
  const q = query(collection(db, 'payout_records'), where('authUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as PayoutRecord)
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'payout_records');
      } catch {
        // Logged via handleFirestoreError
      }
    },
  );
}

export async function upsertPayoutRecord(params: {
  monthKey: string;
  employeeId: string;
  authUid: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  grossIncentivePaise: number;
  adjustmentsNetPaise: number;
  status: PayoutStatus;
  paymentMode?: PaymentMode;
  paymentReference?: string;
  paidAt?: string;
  remarks?: string;
}): Promise<PayoutRecord> {
  const actor = requireActor();
  const now = new Date().toISOString();
  const payoutId = `${params.monthKey}_${params.employeeId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const netPayablePaise = Math.round(params.grossIncentivePaise + params.adjustmentsNetPaise);

  const payload: PayoutRecord = {
    payoutId,
    monthKey: params.monthKey,
    employeeId: params.employeeId,
    authUid: params.authUid || '',
    employeeName: params.employeeName.slice(0, 120),
    branchId: params.branchId,
    branchName: params.branchName.slice(0, 120),
    grossIncentivePaise: Math.max(0, Math.round(params.grossIncentivePaise)),
    adjustmentsNetPaise: Math.round(params.adjustmentsNetPaise),
    netPayablePaise,
    status: params.status,
    ...(params.paymentMode ? { paymentMode: params.paymentMode } : { paymentMode: '' }),
    ...(params.paymentReference?.trim()
      ? { paymentReference: params.paymentReference.trim().slice(0, 120) }
      : {}),
    ...(params.status === 'PAID'
      ? { paidAt: params.paidAt || now }
      : {}),
    ...(params.remarks?.trim() ? { remarks: params.remarks.trim().slice(0, 240) } : {}),
    updatedByEmail: actor.email,
    updatedAt: now,
  };

  try {
    await setDoc(doc(db, 'payout_records', payoutId), payload);
    await writeOpsAuditLog({
      action: `PAYOUT_${params.status}`,
      targetType: 'payout_records',
      targetId: payoutId,
      summary: `Marked ${params.employeeName} (${params.employeeId}) for ${params.monthKey} as ${params.status} (Net Rs ${(netPayablePaise / 100).toFixed(2)}, Mode: ${params.paymentMode || 'N/A'})`,
    });
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `payout_records/${payoutId}`);
  }
}

// =========================================================================
// 2. AUDITED BONUS / DEDUCTION / ADVANCE ADJUSTMENTS (incentive_adjustments)
// =========================================================================

export async function listAllAdjustments(): Promise<IncentiveAdjustment[]> {
  try {
    const snap = await getDocs(collection(db, 'incentive_adjustments'));
    return snap.docs
      .map((d) => d.data() as IncentiveAdjustment)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'incentive_adjustments');
  }
}

export async function fetchOwnActiveAdjustments(): Promise<IncentiveAdjustment[]> {
  const actor = requireActor();
  try {
    const q = query(
      collection(db, 'incentive_adjustments'),
      where('authUid', '==', actor.uid),
      where('status', '==', 'ACTIVE'),
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as IncentiveAdjustment)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'incentive_adjustments');
  }
}

export function subscribeOwnActiveAdjustments(
  uid: string,
  onData: (adjustments: IncentiveAdjustment[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'incentive_adjustments'),
    where('authUid', '==', uid),
    where('status', '==', 'ACTIVE'),
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as IncentiveAdjustment)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'incentive_adjustments');
      } catch {
        // Logged via handleFirestoreError
      }
    },
  );
}

export async function createIncentiveAdjustment(params: {
  monthKey: string;
  employeeId: string;
  authUid: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  type: AdjustmentType;
  amountPaise: number;
  reason: string;
}): Promise<IncentiveAdjustment> {
  const actor = requireActor();
  const now = new Date().toISOString();
  const cleanAmt = Math.round(params.amountPaise);
  if (cleanAmt <= 0) throw new Error('Adjustment amount must be greater than zero.');
  const cleanReason = params.reason.trim();
  if (cleanReason.length < 3) throw new Error('Please enter a clear adjustment reason.');

  const adjustmentId = `ADJ_${Date.now()}_${params.employeeId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const record: IncentiveAdjustment = {
    adjustmentId,
    monthKey: params.monthKey,
    employeeId: params.employeeId,
    authUid: params.authUid || '',
    employeeName: params.employeeName.slice(0, 120),
    branchId: params.branchId,
    branchName: params.branchName.slice(0, 120),
    type: params.type,
    amountPaise: cleanAmt,
    reason: cleanReason.slice(0, 240),
    status: 'ACTIVE',
    createdByEmail: actor.email,
    createdAt: now,
  };

  try {
    await setDoc(doc(db, 'incentive_adjustments', adjustmentId), record);
    await writeOpsAuditLog({
      action: `ADJUSTMENT_${params.type}`,
      targetType: 'incentive_adjustments',
      targetId: adjustmentId,
      summary: `Added ${params.type} of Rs ${(cleanAmt / 100).toFixed(2)} for ${params.employeeName} (${params.employeeId}) in ${params.monthKey}: ${cleanReason}`,
    });
    return record;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `incentive_adjustments/${adjustmentId}`);
  }
}

export async function voidIncentiveAdjustment(adjustmentId: string): Promise<void> {
  const actor = requireActor();
  const now = new Date().toISOString();
  try {
    await updateDoc(doc(db, 'incentive_adjustments', adjustmentId), {
      status: 'VOIDED',
      voidedByEmail: actor.email,
      voidedAt: now,
    });
    await writeOpsAuditLog({
      action: 'ADJUSTMENT_VOIDED',
      targetType: 'incentive_adjustments',
      targetId: adjustmentId,
      summary: `Voided adjustment ${adjustmentId} (preserved in audit history)`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `incentive_adjustments/${adjustmentId}`);
  }
}

// =========================================================================
// 3. MONTHLY SALES TARGETS (sales_targets)
// =========================================================================

export async function listAllSalesTargets(): Promise<SalesTarget[]> {
  try {
    const snap = await getDocs(collection(db, 'sales_targets'));
    return snap.docs
      .map((d) => d.data() as SalesTarget)
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey) || a.branchName.localeCompare(b.branchName));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'sales_targets');
  }
}

export async function fetchOwnRelevantSalesTargets(): Promise<SalesTarget[]> {
  const actor = requireActor();
  try {
    const [branchSnap, empSnap] = await Promise.all([
      getDocs(query(collection(db, 'sales_targets'), where('scope', '==', 'BRANCH'))),
      getDocs(query(collection(db, 'sales_targets'), where('authUid', '==', actor.uid))),
    ]);
    const map = new Map<string, SalesTarget>();
    for (const d of branchSnap.docs) {
      const t = d.data() as SalesTarget;
      map.set(t.targetId, t);
    }
    for (const d of empSnap.docs) {
      const t = d.data() as SalesTarget;
      map.set(t.targetId, t);
    }
    return Array.from(map.values());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'sales_targets');
  }
}

export function subscribeOwnRelevantSalesTargets(
  uid: string,
  onData: (targets: SalesTarget[]) => void,
): Unsubscribe {
  let branchMap = new Map<string, SalesTarget>();
  let empMap = new Map<string, SalesTarget>();

  const emitMerged = () => {
    const merged = new Map<string, SalesTarget>(branchMap);
    for (const [k, v] of empMap.entries()) {
      merged.set(k, v);
    }
    onData(Array.from(merged.values()));
  };

  const unsubBranch = onSnapshot(
    query(collection(db, 'sales_targets'), where('scope', '==', 'BRANCH')),
    (snap) => {
      branchMap = new Map(
        snap.docs.map((d) => {
          const t = d.data() as SalesTarget;
          return [t.targetId, t];
        }),
      );
      emitMerged();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'sales_targets');
      } catch {
        // Logged via handleFirestoreError
      }
    },
  );

  const unsubEmp = onSnapshot(
    query(collection(db, 'sales_targets'), where('authUid', '==', uid)),
    (snap) => {
      empMap = new Map(
        snap.docs.map((d) => {
          const t = d.data() as SalesTarget;
          return [t.targetId, t];
        }),
      );
      emitMerged();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'sales_targets');
      } catch {
        // Logged via handleFirestoreError
      }
    },
  );

  return () => {
    unsubBranch();
    unsubEmp();
  };
}

export interface UpsertSalesTargetInput {
  monthKey: string;
  scope: 'BRANCH' | 'EMPLOYEE';
  branchId: string;
  branchName: string;
  employeeId?: string;
  authUid?: string;
  employeeName?: string;
  targetSaleAmtPaise: number;
  targetSaleQty: number;
}

function buildSalesTargetRecord(
  params: UpsertSalesTargetInput,
  actorEmail: string,
  now: string,
): SalesTarget {
  const keyPart = params.scope === 'BRANCH' ? params.branchId : params.employeeId || 'UNKNOWN';
  const targetId = `${params.scope}_${params.monthKey}_${keyPart}`.replace(/[^a-zA-Z0-9_-]/g, '_');

  return {
    targetId,
    monthKey: params.monthKey,
    scope: params.scope,
    branchId: params.branchId,
    branchName: params.branchName.slice(0, 120),
    ...(params.scope === 'EMPLOYEE' && params.employeeId ? { employeeId: params.employeeId } : {}),
    ...(params.scope === 'EMPLOYEE' && params.authUid ? { authUid: params.authUid } : {}),
    ...(params.scope === 'EMPLOYEE' && params.employeeName
      ? { employeeName: params.employeeName.slice(0, 120) }
      : {}),
    targetSaleAmtPaise: Math.max(0, Math.round(params.targetSaleAmtPaise)),
    targetSaleQty: Math.max(0, Math.round(params.targetSaleQty * 100) / 100),
    updatedByEmail: actorEmail,
    updatedAt: now,
  };
}

export async function upsertSalesTarget(params: UpsertSalesTargetInput): Promise<SalesTarget> {
  const actor = requireActor();
  const now = new Date().toISOString();
  const record = buildSalesTargetRecord(params, actor.email, now);

  try {
    await setDoc(doc(db, 'sales_targets', record.targetId), record);
    await writeOpsAuditLog({
      action: 'SALES_TARGET_UPDATED',
      targetType: 'sales_targets',
      targetId: record.targetId,
      summary: `Set ${params.scope} target for ${params.scope === 'BRANCH' ? params.branchName : `${params.employeeName} (${params.employeeId})`} in ${params.monthKey}: Sale Rs ${(record.targetSaleAmtPaise / 100).toFixed(0)}, Qty ${record.targetSaleQty}`,
    });
    return record;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `sales_targets/${record.targetId}`);
  }
}

export async function upsertSalesTargetsBatch(params: {
  monthKey: string;
  branchName: string;
  items: UpsertSalesTargetInput[];
  auditSummary?: string;
}): Promise<SalesTarget[]> {
  if (params.items.length === 0) return [];
  const actor = requireActor();
  const now = new Date().toISOString();
  const records = params.items.map((item) => buildSalesTargetRecord(item, actor.email, now));

  try {
    const CHUNK_SIZE = 400;
    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
      const slice = records.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const rec of slice) {
        batch.set(doc(db, 'sales_targets', rec.targetId), rec);
      }
      await batch.commit();
    }

    await writeOpsAuditLog({
      action: 'SALES_TARGETS_BULK_UPDATED',
      targetType: 'sales_targets',
      targetId: `BULK_${params.monthKey}_${params.branchName}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80),
      summary:
        params.auditSummary ||
        `Bulk saved ${records.length} sales target(s) for ${params.branchName} in ${params.monthKey}`,
    });

    return records;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'sales_targets');
  }
}

export async function deleteSalesTarget(targetId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'sales_targets', targetId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `sales_targets/${targetId}`);
  }
}

// =========================================================================
// 4. EMPLOYEE QUERY / DISPUTE TICKETS (employee_queries)
// =========================================================================

export async function listAllEmployeeQueries(): Promise<EmployeeQuery[]> {
  try {
    const snap = await getDocs(collection(db, 'employee_queries'));
    return snap.docs
      .map((d) => d.data() as EmployeeQuery)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'employee_queries');
  }
}

export async function fetchOwnEmployeeQueries(): Promise<EmployeeQuery[]> {
  const actor = requireActor();
  try {
    const q = query(collection(db, 'employee_queries'), where('authUid', '==', actor.uid));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as EmployeeQuery)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'employee_queries');
  }
}

export function subscribeOwnEmployeeQueries(
  uid: string,
  onData: (queries: EmployeeQuery[]) => void,
): Unsubscribe {
  const q = query(collection(db, 'employee_queries'), where('authUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as EmployeeQuery)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'employee_queries');
      } catch {
        // Logged via handleFirestoreError
      }
    },
  );
}

export async function submitEmployeeQuery(params: {
  monthKey: string;
  employeeId: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  category: QueryCategory;
  subject: string;
  message: string;
}): Promise<EmployeeQuery> {
  const actor = requireActor();
  const now = new Date().toISOString();
  const subject = params.subject.trim();
  const message = params.message.trim();
  if (subject.length < 3) throw new Error('Please enter a short subject (at least 3 characters).');
  if (message.length < 5) throw new Error('Please explain your query in a few words.');

  const queryId = `QRY_${Date.now()}_${params.employeeId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const record: EmployeeQuery = {
    queryId,
    monthKey: params.monthKey,
    employeeId: params.employeeId,
    authUid: actor.uid,
    employeeName: params.employeeName.slice(0, 120),
    branchId: params.branchId,
    branchName: params.branchName.slice(0, 120),
    category: params.category,
    subject: subject.slice(0, 120),
    message: message.slice(0, 600),
    status: 'OPEN',
    createdAt: now,
    updatedAt: now,
  };

  try {
    await setDoc(doc(db, 'employee_queries', queryId), record);
    return record;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `employee_queries/${queryId}`);
  }
}

export async function resolveEmployeeQuery(params: {
  queryId: string;
  status: QueryStatus;
  adminReply: string;
}): Promise<void> {
  const actor = requireActor();
  const now = new Date().toISOString();
  try {
    await updateDoc(doc(db, 'employee_queries', params.queryId), {
      status: params.status,
      adminReply: params.adminReply.trim().slice(0, 600),
      resolvedByEmail: actor.email,
      updatedAt: now,
    });
    await writeOpsAuditLog({
      action: `QUERY_${params.status}`,
      targetType: 'employee_queries',
      targetId: params.queryId,
      summary: `Updated employee query ${params.queryId} to ${params.status}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `employee_queries/${params.queryId}`);
  }
}

// =========================================================================
// 5. FORMATTED MULTI-SHEET EXCEL MANAGEMENT REPORT DOWNLOAD
// =========================================================================

export async function downloadManagementExcelReport(payload: {
  monthKey: string;
  monthLabel: string;
  branchRows: Array<{
    branchName: string;
    staffCount: number;
    totalSaleAmtRupees: number;
    totalSaleQty: number;
    newItemsIncRupees: number;
    oldItemsIncRupees: number;
    otherItemsIncRupees: number;
    grossIncentiveRupees: number;
    incentivePctOfSale: number;
    adjustmentsNetRupees: number;
    netPayableRupees: number;
    paidCount: number;
  }>;
  employeeRows: Array<{
    branchName: string;
    employeeId: string;
    employeeName: string;
    saleAmt1Rupees: number;
    saleQty1: number;
    inc1Rupees: number;
    saleAmt2Rupees: number;
    saleQty2: number;
    inc2Rupees: number;
    saleAmt3Rupees: number;
    saleQty3: number;
    inc3Rupees: number;
    totalSaleAmtRupees: number;
    totalSaleQty: number;
    grossIncentiveRupees: number;
    adjustmentsNetRupees: number;
    netPayableRupees: number;
    payoutStatus: string;
    paymentMode: string;
    paymentReference: string;
  }>;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Super Admin authentication required.');
  const token = await user.getIdToken();
  const resp = await fetch('/api/v1/excel/management-report', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    throw new Error(errData.error || 'Unable to generate management Excel workbook.');
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `house-of-muktai-management-report-${payload.monthKey}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);

  await writeOpsAuditLog({
    action: 'REPORT_XLSX_EXPORTED',
    targetType: 'management_report',
    targetId: payload.monthKey,
    summary: `Exported formatted 2-sheet Excel management report for ${payload.monthKey} (${payload.branchRows.length} branches, ${payload.employeeRows.length} employees)`,
  });
}

