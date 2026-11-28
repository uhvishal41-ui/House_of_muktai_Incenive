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
import { isMonthVisibleToEmployees } from '../lib/departmentLeaderboardEngine';
import { fetchPortalVisibilitySettings } from './departmentVisibilityService';
import type {
  AdjustmentType,
  Employee,
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

export async function fetchOwnPayoutRecords(employeeId?: string): Promise<PayoutRecord[]> {
  const actor = requireActor();
  try {
    const queries = [
      getDocs(query(collection(db, 'payout_records'), where('authUid', '==', actor.uid))),
    ];
    if (employeeId?.trim()) {
      queries.push(
        getDocs(query(collection(db, 'payout_records'), where('employeeId', '==', employeeId.trim()))),
      );
    }
    const settled = await Promise.allSettled(queries);
    const map = new Map<string, PayoutRecord>();
    let anySucceeded = false;
    let firstError: unknown = null;
    for (const res of settled) {
      if (res.status === 'fulfilled') {
        anySucceeded = true;
        for (const d of res.value.docs) {
          const rec = d.data() as PayoutRecord;
          map.set(rec.payoutId, rec);
        }
      } else if (!firstError) {
        firstError = res.reason;
      }
    }
    if (!anySucceeded && firstError) throw firstError;
    return Array.from(map.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'payout_records');
  }
}

export function subscribeOwnPayoutRecords(
  uid: string,
  onData: (records: PayoutRecord[]) => void,
  employeeId?: string,
  onlyEmployeeVisible = false,
): Unsubscribe {
  let byUidMap = new Map<string, PayoutRecord>();
  let byEmpMap = new Map<string, PayoutRecord>();

  const emitMerged = () => {
    const merged = new Map<string, PayoutRecord>(byEmpMap);
    for (const [k, v] of byUidMap.entries()) {
      merged.set(k, v);
    }
    onData(Array.from(merged.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey)));
  };

  const uidConstraints = [
    where('authUid', '==', uid),
    ...(onlyEmployeeVisible ? [where('employeeVisible', '==', true)] : []),
  ];
  const unsubUid = onSnapshot(
    query(collection(db, 'payout_records'), ...uidConstraints),
    (snap) => {
      byUidMap = new Map(
        snap.docs.map((d) => {
          const rec = d.data() as PayoutRecord;
          return [rec.payoutId, rec];
        }),
      );
      emitMerged();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'payout_records');
      } catch {
        // Logged via handleFirestoreError
      }
    },
  );

  const cleanEmpId = employeeId?.trim();
  const empConstraints = cleanEmpId
    ? [
        where('employeeId', '==', cleanEmpId),
        ...(onlyEmployeeVisible ? [where('employeeVisible', '==', true)] : []),
      ]
    : [];
  const unsubEmp = cleanEmpId
    ? onSnapshot(
        query(collection(db, 'payout_records'), ...empConstraints),
        (snap) => {
          byEmpMap = new Map(
            snap.docs.map((d) => {
              const rec = d.data() as PayoutRecord;
              return [rec.payoutId, rec];
            }),
          );
          emitMerged();
        },
        () => {
          // Fallback silently to authUid stream if legacy rules have not been redeployed yet
        },
      )
    : () => {};

  return () => {
    unsubUid();
    unsubEmp();
  };
}

export interface UpsertPayoutRecordInput {
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
}

function buildPayoutRecordPayload(
  params: UpsertPayoutRecordInput,
  actorEmail: string,
  now: string,
  employeeVisible: boolean,
): PayoutRecord {
  const payoutId = `${params.monthKey}_${params.employeeId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const netPayablePaise = Math.round(params.grossIncentivePaise + params.adjustmentsNetPaise);

  return {
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
    ...(params.status === 'PAID' ? { paidAt: params.paidAt || now } : {}),
    ...(params.remarks?.trim() ? { remarks: params.remarks.trim().slice(0, 240) } : {}),
    employeeVisible,
    updatedByEmail: actorEmail,
    updatedAt: now,
  };
}

export async function upsertPayoutRecord(params: UpsertPayoutRecordInput): Promise<PayoutRecord> {
  const actor = requireActor();
  const now = new Date().toISOString();
  const visibility = await fetchPortalVisibilitySettings();
  const payload = buildPayoutRecordPayload(
    params,
    actor.email,
    now,
    isMonthVisibleToEmployees(params.monthKey, visibility),
  );

  try {
    await setDoc(doc(db, 'payout_records', payload.payoutId), payload);
    await writeOpsAuditLog({
      action: `PAYOUT_${params.status}`,
      targetType: 'payout_records',
      targetId: payload.payoutId,
      summary: `Marked ${params.employeeName} (${params.employeeId}) for ${params.monthKey} as ${params.status} (Net Rs ${(payload.netPayablePaise / 100).toFixed(2)}, Mode: ${params.paymentMode || 'N/A'})`,
    });
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `payout_records/${payload.payoutId}`);
  }
}

export async function upsertPayoutRecordsBatch(params: {
  monthKey: string;
  items: UpsertPayoutRecordInput[];
  paymentMode?: PaymentMode;
  paymentReference?: string;
}): Promise<PayoutRecord[]> {
  if (params.items.length === 0) return [];
  const actor = requireActor();
  const now = new Date().toISOString();
  const visibility = await fetchPortalVisibilitySettings();
  const records = params.items.map((item) =>
    buildPayoutRecordPayload(
      item,
      actor.email,
      now,
      isMonthVisibleToEmployees(item.monthKey, visibility),
    ),
  );

  try {
    const CHUNK_SIZE = 400;
    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
      const slice = records.slice(i, i + CHUNK_SIZE);
      const wb = writeBatch(db);
      for (const rec of slice) {
        wb.set(doc(db, 'payout_records', rec.payoutId), rec);
      }
      await wb.commit();
    }

    const totalNetPaise = records.reduce((sum, r) => sum + r.netPayablePaise, 0);
    await writeOpsAuditLog({
      action: 'PAYOUT_BULK_PAID',
      targetType: 'payout_records',
      targetId: `BULK_${params.monthKey}_${Date.now()}`.slice(0, 80),
      summary: `Bulk marked ${records.length} employee(s) as PAID for ${params.monthKey} (Total Net Rs ${(totalNetPaise / 100).toFixed(2)}, Mode: ${params.paymentMode || 'N/A'}${params.paymentReference ? `, Ref: ${params.paymentReference}` : ''})`,
    });
    return records;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'payout_records');
  }
}

/**
 * Super Admin helper: Backfills missing or stale authUid across payout_records,
 * incentive_adjustments, and employee sales_targets so staff mobile apps stay 100% synced.
 */
export async function syncOperationalAuthUids(employees: Employee[]): Promise<{
  payoutsSynced: number;
  adjustmentsSynced: number;
  targetsSynced: number;
}> {
  const empUidById = new Map<string, string>();
  for (const emp of employees) {
    if (emp.authUid) {
      empUidById.set(emp.employeeId.trim().toUpperCase(), emp.authUid);
    }
  }
  if (empUidById.size === 0) {
    return { payoutsSynced: 0, adjustmentsSynced: 0, targetsSynced: 0 };
  }

  try {
    const [payoutSnap, adjSnap, tgtSnap] = await Promise.all([
      getDocs(collection(db, 'payout_records')),
      getDocs(collection(db, 'incentive_adjustments')),
      getDocs(collection(db, 'sales_targets')),
    ]);

    const updates: Array<{ ref: ReturnType<typeof doc>; authUid: string }> = [];
    let payoutsSynced = 0;
    let adjustmentsSynced = 0;
    let targetsSynced = 0;

    for (const d of payoutSnap.docs) {
      const rec = d.data() as PayoutRecord;
      const expectedUid = empUidById.get(rec.employeeId.trim().toUpperCase());
      if (expectedUid && rec.authUid !== expectedUid) {
        updates.push({ ref: d.ref, authUid: expectedUid });
        payoutsSynced += 1;
      }
    }

    for (const d of adjSnap.docs) {
      const rec = d.data() as IncentiveAdjustment;
      const expectedUid = empUidById.get(rec.employeeId.trim().toUpperCase());
      if (expectedUid && rec.authUid !== expectedUid) {
        updates.push({ ref: d.ref, authUid: expectedUid });
        adjustmentsSynced += 1;
      }
    }

    for (const d of tgtSnap.docs) {
      const rec = d.data() as SalesTarget;
      if (rec.scope !== 'EMPLOYEE' || !rec.employeeId) continue;
      const expectedUid = empUidById.get(rec.employeeId.trim().toUpperCase());
      if (expectedUid && rec.authUid !== expectedUid) {
        updates.push({ ref: d.ref, authUid: expectedUid });
        targetsSynced += 1;
      }
    }

    for (let i = 0; i < updates.length; i += 400) {
      const wb = writeBatch(db);
      for (const item of updates.slice(i, i + 400)) {
        wb.update(item.ref, { authUid: item.authUid });
      }
      await wb.commit();
    }

    if (updates.length > 0) {
      await writeOpsAuditLog({
        action: 'OPERATIONAL_AUTH_UID_SYNC',
        targetType: 'payout_records',
        targetId: `SYNC_${Date.now()}`,
        summary: `Synced employee authUid to ${payoutsSynced} payout(s), ${adjustmentsSynced} adjustment(s), and ${targetsSynced} personal target(s) for mobile visibility.`,
      });
    }

    return { payoutsSynced, adjustmentsSynced, targetsSynced };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'payout_records');
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
  employeeId?: string,
  onlyEmployeeVisible = false,
): Unsubscribe {
  let byUidMap = new Map<string, IncentiveAdjustment>();
  let byEmpMap = new Map<string, IncentiveAdjustment>();

  const emitMerged = () => {
    const merged = new Map<string, IncentiveAdjustment>(byEmpMap);
    for (const [k, v] of byUidMap.entries()) {
      merged.set(k, v);
    }
    onData(Array.from(merged.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  };

  const uidConstraints = [
    where('authUid', '==', uid),
    where('status', '==', 'ACTIVE'),
    ...(onlyEmployeeVisible ? [where('employeeVisible', '==', true)] : []),
  ];
  const unsubUid = onSnapshot(
    query(collection(db, 'incentive_adjustments'), ...uidConstraints),
    (snap) => {
      byUidMap = new Map(
        snap.docs.map((d) => {
          const rec = d.data() as IncentiveAdjustment;
          return [rec.adjustmentId, rec];
        }),
      );
      emitMerged();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'incentive_adjustments');
      } catch {
        // Logged via handleFirestoreError
      }
    },
  );

  const cleanEmpId = employeeId?.trim();
  const empConstraints = cleanEmpId
    ? [
        where('employeeId', '==', cleanEmpId),
        where('status', '==', 'ACTIVE'),
        ...(onlyEmployeeVisible ? [where('employeeVisible', '==', true)] : []),
      ]
    : [];
  const unsubEmp = cleanEmpId
    ? onSnapshot(
        query(collection(db, 'incentive_adjustments'), ...empConstraints),
        (snap) => {
          byEmpMap = new Map(
            snap.docs.map((d) => {
              const rec = d.data() as IncentiveAdjustment;
              return [rec.adjustmentId, rec];
            }),
          );
          emitMerged();
        },
        () => {
          // Fallback silently to authUid stream if legacy rules have not been redeployed yet
        },
      )
    : () => {};

  return () => {
    unsubUid();
    unsubEmp();
  };
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
  const visibility = await fetchPortalVisibilitySettings();

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
    employeeVisible: isMonthVisibleToEmployees(params.monthKey, visibility),
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
  employeeId?: string,
  onlyEmployeeVisible = false,
): Unsubscribe {
  let branchMap = new Map<string, SalesTarget>();
  let empUidMap = new Map<string, SalesTarget>();
  let empIdMap = new Map<string, SalesTarget>();

  const emitMerged = () => {
    const merged = new Map<string, SalesTarget>(branchMap);
    for (const [k, v] of empIdMap.entries()) {
      merged.set(k, v);
    }
    for (const [k, v] of empUidMap.entries()) {
      merged.set(k, v);
    }
    onData(Array.from(merged.values()));
  };

  const visFilter = onlyEmployeeVisible ? [where('employeeVisible', '==', true)] : [];

  const unsubBranch = onSnapshot(
    query(collection(db, 'sales_targets'), where('scope', '==', 'BRANCH'), ...visFilter),
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

  const unsubEmpUid = onSnapshot(
    query(collection(db, 'sales_targets'), where('authUid', '==', uid), ...visFilter),
    (snap) => {
      empUidMap = new Map(
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

  const cleanEmpId = employeeId?.trim();
  const unsubEmpId = cleanEmpId
    ? onSnapshot(
        query(collection(db, 'sales_targets'), where('employeeId', '==', cleanEmpId), ...visFilter),
        (snap) => {
          empIdMap = new Map(
            snap.docs.map((d) => {
              const t = d.data() as SalesTarget;
              return [t.targetId, t];
            }),
          );
          emitMerged();
        },
        () => {
          // Fallback silently to authUid stream if legacy rules have not been redeployed yet
        },
      )
    : () => {};

  return () => {
    unsubBranch();
    unsubEmpUid();
    unsubEmpId();
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
  employeeVisible: boolean,
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
    employeeVisible,
    updatedByEmail: actorEmail,
    updatedAt: now,
  };
}

export async function upsertSalesTarget(params: UpsertSalesTargetInput): Promise<SalesTarget> {
  const actor = requireActor();
  const now = new Date().toISOString();
  const visibility = await fetchPortalVisibilitySettings();
  const record = buildSalesTargetRecord(
    params,
    actor.email,
    now,
    isMonthVisibleToEmployees(params.monthKey, visibility),
  );

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
  const visibility = await fetchPortalVisibilitySettings();
  const records = params.items.map((item) =>
    buildSalesTargetRecord(
      item,
      actor.email,
      now,
      isMonthVisibleToEmployees(item.monthKey, visibility),
    ),
  );

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

export async function deletePayoutRecordByOwner(payout: PayoutRecord): Promise<void> {
  const actor = requireActor();
  try {
    await deleteDoc(doc(db, 'payout_records', payout.payoutId));
    await writeOpsAuditLog({
      action: 'PAYOUT_DELETED_BY_OWNER',
      targetType: 'payout_records',
      targetId: payout.payoutId,
      summary: `${actor.email} deleted payout record for ${payout.employeeName} (${payout.employeeId}, ${payout.monthKey})`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `payout_records/${payout.payoutId}`);
  }
}

export async function deleteIncentiveAdjustmentByOwner(adj: IncentiveAdjustment): Promise<void> {
  const actor = requireActor();
  try {
    await deleteDoc(doc(db, 'incentive_adjustments', adj.adjustmentId));
    await writeOpsAuditLog({
      action: 'ADJUSTMENT_DELETED_BY_OWNER',
      targetType: 'incentive_adjustments',
      targetId: adj.adjustmentId,
      summary: `${actor.email} deleted ${adj.type} adjustment (${adj.employeeName}, ${adj.monthKey})`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `incentive_adjustments/${adj.adjustmentId}`);
  }
}

export async function deleteEmployeeQueryByOwner(queryRec: EmployeeQuery): Promise<void> {
  const actor = requireActor();
  try {
    await deleteDoc(doc(db, 'employee_queries', queryRec.queryId));
    await writeOpsAuditLog({
      action: 'QUERY_DELETED_BY_OWNER',
      targetType: 'employee_queries',
      targetId: queryRec.queryId,
      summary: `${actor.email} deleted employee query ${queryRec.queryId} (${queryRec.employeeName})`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `employee_queries/${queryRec.queryId}`);
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

