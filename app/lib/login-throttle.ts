// Per-network login throttle backed by the D1 auth_throttle table.
//
// Every attempt is counted *before* the password is hashed, in one atomic
// upsert that refuses to count while the bucket is locked. Parallel guesses
// therefore cannot slip past a lock, and a locked client costs no PBKDF2
// work. A successful login deletes the bucket.
//
// Five attempts within 24 hours lock the bucket for 1 minute; each further
// failure doubles the lock, up to 24 hours. Buckets are per client network
// only: a global lock would let anyone lock the owner out.

const WINDOW_SECONDS = 24 * 60 * 60;
const FREE_ATTEMPTS = 5;
const FIRST_LOCK_SECONDS = 60;
const MAX_LOCK_SECONDS = 24 * 60 * 60;

export type ThrottleDecision =
  | { allowed: true; attempts: number; lockedUntil: number }
  | { allowed: false; retryAfter: number };

/**
 * Counts one login attempt for `bucket` at `now` (Unix seconds). Refused
 * while the bucket is locked; otherwise returns the attempt count in the
 * current window and the lock this attempt set (0 when none).
 */
export async function reserveLoginAttempt(
  db: D1Database,
  bucket: string,
  now: number,
): Promise<ThrottleDecision> {
  // Inside DO UPDATE, bare column names are the row's current values.
  const [reserved, current] = await db.batch<{ failures: number; locked_until: number }>([
    db
      .prepare(
        `INSERT INTO auth_throttle (bucket, failures, window_start, locked_until)
         VALUES (?1, 1, ?2, 0)
         ON CONFLICT (bucket) DO UPDATE SET
           failures = CASE WHEN window_start <= ?2 - ?3 THEN 1 ELSE failures + 1 END,
           window_start = CASE WHEN window_start <= ?2 - ?3 THEN ?2 ELSE window_start END,
           locked_until = CASE
             WHEN window_start > ?2 - ?3 AND failures + 1 >= ?4
             THEN ?2 + min(?5 << min(failures + 1 - ?4, 16), ?6)
             ELSE 0
           END
         WHERE locked_until <= ?2
         RETURNING failures, locked_until`,
      )
      .bind(bucket, now, WINDOW_SECONDS, FREE_ATTEMPTS, FIRST_LOCK_SECONDS, MAX_LOCK_SECONDS),
    db
      .prepare("SELECT failures, locked_until FROM auth_throttle WHERE bucket = ?")
      .bind(bucket),
  ]);

  const counted = reserved.results[0];
  if (counted) {
    return { allowed: true, attempts: counted.failures, lockedUntil: counted.locked_until };
  }
  const lockedUntil = current.results[0]?.locked_until ?? now + FIRST_LOCK_SECONDS;
  return { allowed: false, retryAfter: Math.max(1, lockedUntil - now) };
}

/** Forgets a client's failed attempts after a successful login. */
export async function clearLoginAttempts(db: D1Database, bucket: string) {
  await db.prepare("DELETE FROM auth_throttle WHERE bucket = ?").bind(bucket).run();
}
