/**
 * Pure helper for generating collision-safe alternate Employee Login IDs when
 * Firebase Auth returns `auth/email-already-in-use` (e.g., after a Master reset
 * or when an old Auth account already exists with a customized password).
 *
 * Strictly obeys Firestore rule regex: `^[A-Z0-9_\-]{3,40}$`
 */

const VALID_LOGIN_ID_RE = /^[A-Z0-9_-]{3,40}$/;

export function normalizeLoginIdCandidate(raw: string): string {
  const cleaned = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
  if (cleaned.length >= 3) return cleaned.slice(0, 40);
  return `HOM${cleaned}`.slice(0, 40);
}

/**
 * Generates the next available clean Login ID suffix (`A`, `B`, `C`, ..., `R1`, `R2`, ...)
 * skipping any Login IDs already present in Employee Master or already tried in this attempt.
 */
export function generateNextAvailableLoginId(
  baseLoginId: string,
  usedLoginIds: Set<string>,
  startIndex: number = 0,
): string {
  const cleanBase = normalizeLoginIdCandidate(baseLoginId);
  // Strip any previous auto-reissue suffix like `_R1` or `_2` so retries don't chain awkwardly
  const rootBase = cleanBase.replace(/_R\d+$/i, '').slice(0, 34);
  const suffixes = [
    'A',
    'B',
    'C',
    'D',
    'E',
    'F',
    '_R1',
    '_R2',
    '_R3',
    '_R4',
    '_R5',
    '_R6',
    '_R7',
    '_R8',
    '_R9',
  ];

  for (let i = Math.max(0, startIndex); i < suffixes.length; i += 1) {
    const suffix = suffixes[i];
    const candidate = `${rootBase.slice(0, 40 - suffix.length)}${suffix}`.toUpperCase();
    if (VALID_LOGIN_ID_RE.test(candidate) && !usedLoginIds.has(candidate)) {
      return candidate;
    }
  }

  // Deterministic timestamp fallback if all 15 standard suffixes are occupied
  const stamp = Date.now().toString(36).toUpperCase().slice(-4);
  const fallback = `${rootBase.slice(0, 35)}_${stamp}`;
  return VALID_LOGIN_ID_RE.test(fallback) ? fallback : `HOM_${stamp}`;
}
