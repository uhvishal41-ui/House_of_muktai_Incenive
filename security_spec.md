# House of Muktai — Phase 2C Firestore Security Specification

## Core Security Invariants
1. **Inactive Employee Instant Access Revocation (Issue 1):** Every ACTIVE employee with a provisioned `authUid` has a corresponding `/active_auth_uids/{authUid}` document (`active: true`) synced atomically via `writeBatch` and enforced by Pillar 7 `existsAfter` / `getAfter` checks. Deactivating an employee deletes `/active_auth_uids/{authUid}`, immediately denying `published_incentives`, `monthly_summaries`, `notifications`, and profile updates at the Firestore Rules layer.
2. **Consistent Super Admin Authorization (Issue 2):** `SUPER_ADMIN` access is granted strictly to verified `uhvishal41@gmail.com` OR an active `/admins/{uid}` document with `role == 'SUPER_ADMIN'` and `email_verified == true`. Verified users may `get` only their own `/admins/{uid}` doc so Frontend (`AuthContext`) and Express API (`authMiddleware` REST lookup using caller's own Bearer token) share one consistent source of truth.
3. **Phase 2 Role Restriction (Issue 3):** Only `SUPER_ADMIN` (in `/admins`) and `EMPLOYEE` (in `/employees`) are permitted. `BRANCH_MANAGER` is rejected across Firestore rules, API middleware, and UI.
4. **Atomic Publish Lock & Terminal Batch Immutability (Issue 4):** `import_batches` cannot be modified once `PUBLISHED` or `REJECTED`. Publishing acquires `APPROVED/FAILED -> PROCESSING` inside `runTransaction` before committing deterministic record, version, summary, and notification IDs.
5. **Soft Superseding on Overlap Reconciliation (Issue 5):** `published_incentives` are never deleted. Overlap reconciliation transitions prior conflicting records from `PUBLISHED` to `SUPERSEDED` (immutable financials thereafter; employees only read `PUBLISHED` records).
6. **Verified Google Self-Claim & Legacy Backfill (Issue 6):** An ACTIVE employee with empty `authUid` and verified Google email matching `linkedGoogleEmail` may atomically set only `['authUid', 'updatedAt']` on their own `employees/{employeeId}` doc and create `/active_auth_uids/{request.auth.uid}`.

## Dirty Dozen Adversarial Payloads (All Must Return `PERMISSION_DENIED`)
1. **Inactive Employee Reads Own Incentives:** Deactivated employee (`active_auth_uids/{uid}` absent) calls `get`/`list` on `published_incentives` where `authUid == uid` → DENIED by `isActiveEmployee()`.
2. **Inactive Employee Reads Monthly Summary:** Deactivated employee calls `list` on `monthly_summaries` → DENIED by `isActiveEmployee()`.
3. **Inactive Employee Reads/Marks Notifications:** Deactivated employee calls `list`/`update` on `notifications` → DENIED by `isActiveEmployee()`.
4. **Employee Self-Reactivation Attack:** Inactive employee updates `employees/{id}` setting `status: 'ACTIVE'` → DENIED (`isActiveEmployee()` fails + `status` not in employee `hasOnly`).
5. **Employee Forging `/active_auth_uids/{uid}`:** Inactive employee attempts `create` on `/active_auth_uids/{uid}` → DENIED (`getAfter` verifies `employees/{id}.status == 'ACTIVE'`).
6. **Super Admin Desync Attack (Pillar 7):** Super Admin updates `employees/{id}.status = 'INACTIVE'` without deleting `/active_auth_uids/{authUid}` in the same batch → DENIED by `isActiveRegistrySyncedAfter`.
7. **Disabled Role Injection (`BRANCH_MANAGER`):** Payload attempts `create`/`update` on `/employees/{id}` or `/admins/{uid}` with `role: 'BRANCH_MANAGER'` → DENIED (`data.role == 'EMPLOYEE'` / `'SUPER_ADMIN'`).
8. **Email Spoofing Admin Bypass:** Unverified token (`email_verified: false`) with `email: 'uhvishal41@gmail.com'` attempts admin read/write → DENIED.
9. **Cross-Employee IDOR Read:** Active Employee A queries `published_incentives` for Employee B's `authUid` → DENIED (`resource.data.authUid == request.auth.uid`).
10. **Terminal Batch Tampering:** Super Admin attempts to mutate a `PUBLISHED` or `REJECTED` `import_batches/{id}` document → DENIED (`existing().status != 'PUBLISHED' && existing().status != 'REJECTED'`).
11. **Superseded Record Financial Tampering:** Payload attempts to change `totalPaise` or revert `status` from `SUPERSEDED` back to `PUBLISHED` → DENIED (`existing().status == 'SUPERSEDED'` allows only `['authUid']`).
12. **Shadow Field Injection:** Any write including an unlisted field (e.g., `isAdmin: true`, `bonusOverride: 99999`) → DENIED by `keys().hasOnly(...)` on every entity validator.
