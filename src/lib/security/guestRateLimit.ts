import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/security/inputValidation";
import { privateJson } from "@/lib/security/privateJson";

/**
 * Device-keyed rate limiting for anonymous, service-role-backed endpoints.
 *
 * The origin guard already blocks cross-site callers; this bounds how often a
 * single browser device can drive an unauthenticated service-role endpoint
 * (workspace share creation, workspace compute) so neither can be spammed.
 */

const DEVICE_COOKIE = "op_device_key";
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type GuestRateAction = "workspace_share" | "workspace_compute";

export function deviceKeyFrom(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === DEVICE_COOKIE) {
      const value = rest.join("=").trim();
      return isUuid(value) ? value : null;
    }
  }
  return null;
}

/** Attaches the device cookie to a response, minting one if absent. */
export function withDeviceCookie(response: Response, deviceKey: string): Response {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.append(
    "Set-Cookie",
    `${DEVICE_COOKIE}=${deviceKey}; Path=/; Max-Age=${DEVICE_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`
  );
  return response;
}

export type GuestRateLimitContext = { deviceKey: string; setCookie: boolean };

/**
 * Consume one unit for this device+action. Returns either a 429 response (with
 * the device cookie attached) or a context the caller stamps onto its own
 * success response so the cookie persists.
 */
export async function enforceGuestRateLimit(
  service: SupabaseClient,
  request: Request,
  action: GuestRateAction
): Promise<{ limited: Response } | { ok: GuestRateLimitContext }> {
  const existing = deviceKeyFrom(request);
  const deviceKey = existing ?? randomUUID();
  const { data, error } = await service.rpc("op_consume_guest_rate_limit", {
    p_device_key: deviceKey,
    p_action: action
  });
  // Fail open on infrastructure errors — the origin guard is still in force —
  // but never fail open on an actual limit breach.
  if (error) return { ok: { deviceKey, setCookie: !existing } };
  const row = (Array.isArray(data) ? data[0] : data) as { allowed?: unknown; retry_after_seconds?: unknown } | null;
  if (row && row.allowed === false) {
    const retryAfter = typeof row.retry_after_seconds === "number" ? Math.max(1, Math.ceil(row.retry_after_seconds)) : 60;
    const response = privateJson(
      { error: "Too many requests from this device. Please slow down." },
      { status: 429, headers: { "retry-after": String(retryAfter) } }
    );
    return { limited: withDeviceCookie(response, deviceKey) };
  }
  return { ok: { deviceKey, setCookie: !existing } };
}

/** Stamp the device cookie onto a success response when it was freshly minted. */
export function applyGuestRateContext(response: Response, context: GuestRateLimitContext): Response {
  return context.setCookie ? withDeviceCookie(response, context.deviceKey) : response;
}
