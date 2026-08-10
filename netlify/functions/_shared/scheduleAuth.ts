import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time schedule-token comparison for the job workers.
 *
 * The previous per-worker implementation compared `expected.length ===
 * supplied.length` before `timingSafeEqual`, which leaks the secret's length
 * by timing. Hashing both sides to a fixed 32-byte digest removes the length
 * branch entirely while keeping the compare constant-time.
 */
export function safeTokenMatches(expected: string, supplied: string): boolean {
  if (!expected || !supplied) return false;
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(left, right);
}
