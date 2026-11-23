import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  type Unsubscribe,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  buildBirthdayProfileFromEmployee,
  buildDeterministicWishId,
  getTodayIstParts,
  parseDobToIso,
  type BulkDobParseRow,
} from '../lib/birthdayEngine';
import type { BirthdayProfile, BirthdayWish, Employee } from '../types/incentive';

function requireActor() {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required.');
  return {
    uid: user.uid,
    email: user.email || 'unknown@houseofmuktai.co.in',
  };
}

async function writeBirthdayAuditLog(params: {
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
    // Non-blocking audit log write
  }
}

/**
 * Real-time subscription to active 12-branch birthday profiles (privacy-isolated MM-DD only).
 * Enforces `where('active', '==', true)` to align 1:1 with Firestore Rules Pillar 8.
 */
export function subscribeActiveBirthdayProfiles(
  onData: (profiles: BirthdayProfile[]) => void,
): Unsubscribe {
  const q = query(collection(db, 'birthday_profiles'), where('active', '==', true));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as BirthdayProfile);
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'birthday_profiles');
      } catch {
        // Logged structurally
      }
      onData([]);
    },
  );
}

/**
 * Real-time subscription to birthday wishes RECEIVED by the active employee for the current year.
 */
export function subscribeReceivedBirthdayWishes(
  employeeId: string,
  celebrationYear: number,
  onData: (wishes: BirthdayWish[]) => void,
): Unsubscribe {
  const cleanId = employeeId.trim();
  if (!cleanId) {
    onData([]);
    return () => {};
  }

  const q = query(
    collection(db, 'birthday_wishes'),
    where('recipientEmployeeId', '==', cleanId),
    where('celebrationYear', '==', celebrationYear),
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as BirthdayWish)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'birthday_wishes');
      } catch {
        // Logged structurally
      }
      onData([]);
    },
  );
}

/**
 * Real-time subscription to birthday wishes SENT by the signed-in user for the current year,
 * so the UI shows "Wished ✓" state across all 12 branches in real time.
 */
export function subscribeSentBirthdayWishes(
  senderAuthUid: string,
  celebrationYear: number,
  onData: (wishes: BirthdayWish[]) => void,
): Unsubscribe {
  if (!senderAuthUid) {
    onData([]);
    return () => {};
  }

  const q = query(
    collection(db, 'birthday_wishes'),
    where('senderAuthUid', '==', senderAuthUid),
    where('celebrationYear', '==', celebrationYear),
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as BirthdayWish)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'birthday_wishes');
      } catch {
        // Logged structurally
      }
      onData([]);
    },
  );
}

/**
 * Sends a deterministic (1 per sender per recipient per year) birthday wish from an active Employee.
 */
export async function sendEmployeeBirthdayWish(params: {
  recipient: BirthdayProfile;
  sender: Employee;
  message: string;
}): Promise<BirthdayWish> {
  const actor = requireActor();
  const cleanMsg = params.message.trim().slice(0, 240);
  if (cleanMsg.length < 2) {
    throw new Error('Please enter a birthday wish message (at least 2 characters).');
  }
  if (params.recipient.employeeId === params.sender.employeeId) {
    throw new Error('You cannot send a colleague wish to yourself.');
  }

  const today = getTodayIstParts();
  const wishId = buildDeterministicWishId(
    today.year,
    params.recipient.employeeId,
    params.sender.employeeId,
  );
  const now = new Date().toISOString();

  const payload: BirthdayWish = {
    wishId,
    celebrationYear: today.year,
    birthMonthDay: params.recipient.birthMonthDay,
    recipientEmployeeId: params.recipient.employeeId,
    recipientName: params.recipient.fullName.slice(0, 120),
    recipientBranchName: params.recipient.branchName.slice(0, 120),
    senderEmployeeId: params.sender.employeeId,
    senderAuthUid: actor.uid,
    senderName: params.sender.fullName.slice(0, 120),
    senderBranchName: params.sender.branchName.slice(0, 120),
    senderRole: 'EMPLOYEE',
    message: cleanMsg,
    createdAt: now,
  };

  try {
    await setDoc(doc(db, 'birthday_wishes', wishId), payload);
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `birthday_wishes/${wishId}`);
  }
}

/**
 * Sends an official House of Muktai Management birthday wish from Super Admin.
 */
export async function sendManagementBirthdayWish(params: {
  recipient: BirthdayProfile;
  message: string;
}): Promise<BirthdayWish> {
  const actor = requireActor();
  const cleanMsg = params.message.trim().slice(0, 240);
  if (cleanMsg.length < 2) {
    throw new Error('Please enter a birthday wish message.');
  }

  const today = getTodayIstParts();
  const senderId = 'HOUSE_OF_MUKTAI_MGMT';
  const wishId = buildDeterministicWishId(today.year, params.recipient.employeeId, senderId);
  const now = new Date().toISOString();

  const payload: BirthdayWish = {
    wishId,
    celebrationYear: today.year,
    birthMonthDay: params.recipient.birthMonthDay,
    recipientEmployeeId: params.recipient.employeeId,
    recipientName: params.recipient.fullName.slice(0, 120),
    recipientBranchName: params.recipient.branchName.slice(0, 120),
    senderEmployeeId: senderId,
    senderAuthUid: actor.uid,
    senderName: 'House of Muktai Management',
    senderBranchName: 'Head Office · Baramati',
    senderRole: 'SUPER_ADMIN',
    message: cleanMsg,
    createdAt: now,
  };

  try {
    await setDoc(doc(db, 'birthday_wishes', wishId), payload);
    await writeBirthdayAuditLog({
      action: 'BIRTHDAY_WISH_SENT',
      targetType: 'birthday_wishes',
      targetId: wishId,
      summary: `Sent official House of Muktai birthday wish to ${params.recipient.fullName} (${params.recipient.branchName})`,
    });
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `birthday_wishes/${wishId}`);
  }
}

/**
 * Super Admin: Bulk-updates employee Date of Birth (DOB) from validated CSV/Excel rows
 * AND atomically syncs the privacy-isolated `birthday_profiles` collection.
 */
export async function bulkUpdateEmployeeDobs(
  validRows: BulkDobParseRow[],
  employees: Employee[],
): Promise<{ updatedCount: number; syncedProfiles: number }> {
  const cleanRows = validRows.filter((r) => r.status === 'VALID' && r.normalizedDob);
  if (cleanRows.length === 0) {
    return { updatedCount: 0, syncedProfiles: 0 };
  }

  const empMap = new Map<string, Employee>(employees.map((e) => [e.employeeId, e]));
  const now = new Date().toISOString();
  const CHUNK_SIZE = 180; // 2 writes per employee => 360 ops < 500 batch limit
  let updatedCount = 0;
  let syncedProfiles = 0;

  try {
    for (let i = 0; i < cleanRows.length; i += CHUNK_SIZE) {
      const slice = cleanRows.slice(i, i + CHUNK_SIZE);
      const wb = writeBatch(db);

      for (const row of slice) {
        const emp = empMap.get(row.employeeId);
        if (!emp) continue;
        const normalized = parseDobToIso(row.normalizedDob);
        if (!normalized) continue;

        wb.update(doc(db, 'employees', emp.employeeId), {
          dateOfBirth: normalized,
          updatedAt: now,
        });
        updatedCount += 1;

        const profile = buildBirthdayProfileFromEmployee(
          { ...emp, dateOfBirth: normalized },
          now,
        );
        if (profile) {
          wb.set(doc(db, 'birthday_profiles', emp.employeeId), profile);
          syncedProfiles += 1;
        } else {
          wb.delete(doc(db, 'birthday_profiles', emp.employeeId));
        }
      }

      await wb.commit();
    }

    await writeBirthdayAuditLog({
      action: 'BULK_DOB_UPDATED',
      targetType: 'employees',
      targetId: `BATCH_${cleanRows.length}`,
      summary: `Bulk updated Date of Birth for ${updatedCount} employees and synced ${syncedProfiles} active birthday profiles.`,
    });

    return { updatedCount, syncedProfiles };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'birthday_profiles');
  }
}

/**
 * Super Admin: Re-syncs `birthday_profiles` cleanly from Employee Master
 * (creates/updates active employees with DOB, removes inactive or cleared profiles).
 */
export async function syncAllBirthdayProfilesFromEmployees(
  employees: Employee[],
): Promise<{ synced: number; removed: number }> {
  const now = new Date().toISOString();
  try {
    const existingSnap = await getDocs(collection(db, 'birthday_profiles'));
    const existingIds = new Set(existingSnap.docs.map((d) => d.id));
    const keepIds = new Set<string>();

    const ops: Array<
      | { kind: 'set'; id: string; data: BirthdayProfile }
      | { kind: 'delete'; id: string }
    > = [];

    for (const emp of employees) {
      const profile = buildBirthdayProfileFromEmployee(emp, now);
      if (profile) {
        keepIds.add(emp.employeeId);
        ops.push({ kind: 'set', id: emp.employeeId, data: profile });
      }
    }

    for (const id of existingIds) {
      if (!keepIds.has(id)) {
        ops.push({ kind: 'delete', id });
      }
    }

    let synced = 0;
    let removed = 0;
    const CHUNK = 400;
    for (let i = 0; i < ops.length; i += CHUNK) {
      const wb = writeBatch(db);
      for (const op of ops.slice(i, i + CHUNK)) {
        if (op.kind === 'set') {
          wb.set(doc(db, 'birthday_profiles', op.id), op.data);
          synced += 1;
        } else {
          wb.delete(doc(db, 'birthday_profiles', op.id));
          removed += 1;
        }
      }
      await wb.commit();
    }

    await writeBirthdayAuditLog({
      action: 'BIRTHDAY_DIRECTORY_SYNCED',
      targetType: 'birthday_profiles',
      targetId: 'ALL',
      summary: `Synced 12-branch birthday directory: ${synced} active profiles updated, ${removed} inactive/cleared removed.`,
    });

    return { synced, removed };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'birthday_profiles');
  }
}
