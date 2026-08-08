import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, expiring share tokens for read-only workspace links.
 *
 * The token IS the capability: whoever holds it can read the shared snapshot
 * until it expires or is revoked. Three consequences shape the design:
 *
 * - The expiry lives inside the signed material, so shortening or extending a
 *   link's life by editing the URL breaks the signature.
 * - Verification happens before any database read; a forged or expired token
 *   costs one HMAC, not one query.
 * - Revocation is a database fact, not a token fact — a revoked share fails
 *   at the row check even though its signature still verifies. That is the
 *   correct order: signatures prove the link was issued, the row proves it is
 *   still meant to work.
 */

const TOKEN_PATTERN = /^([a-z0-9-]{8,64})\.(\d{1,16})\.([A-Za-z0-9_-]{16,64})$/;

export function shareSecret(): string | null {
  const secret = process.env.WORKSPACE_SHARE_SECRET ?? null;
  // A missing secret disables sharing entirely — fail closed. Falling back to
  // a hardcoded default would make every "signed" link forgeable.
  return secret && secret.length >= 16 ? secret : null;
}

function signature(shareId: string, expiresAtMs: number, secret: string): string {
  return createHmac("sha256", secret).update(`${shareId}.${expiresAtMs}`).digest("base64url");
}

export function signShareToken(shareId: string, expiresAtMs: number, secret: string): string {
  return `${shareId}.${expiresAtMs}.${signature(shareId, expiresAtMs, secret)}`;
}

export type ShareTokenVerdict =
  | { ok: true; shareId: string; expiresAtMs: number }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyShareToken(token: string, secret: string, nowMs: number): ShareTokenVerdict {
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return { ok: false, reason: "malformed" };
  const [, shareId, expiresRaw, provided] = match;
  const expiresAtMs = Number(expiresRaw);
  if (!Number.isFinite(expiresAtMs)) return { ok: false, reason: "malformed" };

  const expected = signature(shareId!, expiresAtMs, secret);
  const providedBuffer = Buffer.from(provided!, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    return { ok: false, reason: "bad_signature" };
  }
  // Expiry is checked only after the signature: an attacker learns nothing
  // about validity windows from a forged token's error.
  if (nowMs >= expiresAtMs) return { ok: false, reason: "expired" };
  return { ok: true, shareId: shareId!, expiresAtMs };
}
