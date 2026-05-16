type LockEntry = { failures: number; lockedUntil: number };

const byKey = new Map<string, LockEntry>();

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

function normalizeEmail(email: string) {
  return String(email ?? "").trim().toLowerCase();
}

export function assertLoginNotLocked(email: string): void {
  const key = normalizeEmail(email);
  const entry = byKey.get(key);
  if (!entry) return;
  if (entry.lockedUntil > Date.now()) {
    const mins = Math.ceil((entry.lockedUntil - Date.now()) / 60_000);
    const err: any = new Error(`Too many failed login attempts. Try again in ${mins} minute(s).`);
    err.code = 429;
    throw err;
  }
  if (entry.lockedUntil <= Date.now() && entry.failures >= MAX_FAILURES) {
    byKey.delete(key);
  }
}

export function recordLoginFailure(email: string): void {
  const key = normalizeEmail(email);
  const now = Date.now();
  let entry = byKey.get(key);
  if (!entry || entry.lockedUntil <= now) {
    entry = { failures: 0, lockedUntil: 0 };
  }
  entry.failures += 1;
  if (entry.failures >= MAX_FAILURES) {
    entry.lockedUntil = now + LOCK_MS;
  }
  byKey.set(key, entry);
}

export function clearLoginFailures(email: string): void {
  byKey.delete(normalizeEmail(email));
}
