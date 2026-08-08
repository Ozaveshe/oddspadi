import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { privateJson } from "@/lib/security/privateJson";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";
import { ALERT_TYPES, type AlertChannel, type AlertType } from "@/lib/personal/alertPolicy";
import { isValidTimeZone } from "@/lib/time/dayWindow";

export const dynamic = "force-dynamic";

/**
 * Alert preferences: consent, channels, quiet hours, caps.
 *
 * No row means no alerts — GET reflects that as `configured: false` with the
 * defaults, and nothing is created until the user saves. Every field is
 * validated against the closed vocabularies; a preferences row is consent,
 * and consent to something unparseable is consent to nothing.
 */

const CHANNELS: readonly AlertChannel[] = ["push", "email", "whatsapp"];
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

async function authClient() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: privateJson({ error: "Alerts are not configured." }, { status: 503 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: privateJson({ error: "Sign in to manage alerts." }, { status: 401 }) };
  return { supabase, user };
}

export async function GET() {
  const auth = await authClient();
  if (auth.error) {
    if (auth.error.status === 401) return privateJson({ configured: false, authenticated: false });
    return auth.error;
  }
  const { data, error } = await auth.supabase
    .from("op_alert_preferences")
    .select("channels,enabled_types,quiet_hours,timezone,sport_settings,competition_settings,max_alerts_per_day,updated_at")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (error) return databaseUnavailable("alert preferences read", error, "Alert settings are temporarily unavailable.");
  return privateJson(
    { authenticated: true, configured: Boolean(data), preferences: data ?? null },
    { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } }
  );
}

export async function PUT(request: Request) {
  const originError = rejectCrossSiteMutation(request);
  if (originError) return originError;
  const auth = await authClient();
  if (auth.error) return auth.error;
  const rateLimit = await enforceUserRateLimit(auth.supabase, "profile_update");
  if (rateLimit) return rateLimit;

  const parsed = await readBoundedJson<{
    channels?: unknown;
    enabledTypes?: unknown;
    quietHours?: unknown;
    timezone?: unknown;
    sportSettings?: unknown;
    competitionSettings?: unknown;
    maxAlertsPerDay?: unknown;
  }>(request, 8_192);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;

  const channels = Array.isArray(body.channels)
    ? body.channels.filter((value): value is AlertChannel => CHANNELS.includes(value as AlertChannel))
    : [];
  const enabledTypes = Array.isArray(body.enabledTypes)
    ? body.enabledTypes.filter((value): value is AlertType => ALERT_TYPES.includes(value as AlertType))
    : [];

  let quietHours: { start: string; end: string } | null = null;
  if (body.quietHours && typeof body.quietHours === "object") {
    const candidate = body.quietHours as { start?: unknown; end?: unknown };
    if (typeof candidate.start === "string" && typeof candidate.end === "string" && CLOCK.test(candidate.start) && CLOCK.test(candidate.end)) {
      quietHours = { start: candidate.start, end: candidate.end };
    } else {
      return privateJson({ error: "Quiet hours need HH:MM start and end times." }, { status: 400 });
    }
  }

  const timezone = typeof body.timezone === "string" && isValidTimeZone(body.timezone) ? body.timezone : null;
  if (!timezone) return privateJson({ error: "Choose a valid timezone for your alerts." }, { status: 400 });

  const toggleMap = (value: unknown): Record<string, boolean> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, boolean> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === "boolean" && key.length <= 60) out[key.toLowerCase()] = entry;
    }
    return out;
  };

  const maxAlertsPerDay = Number(body.maxAlertsPerDay);
  const cappedMax = Number.isFinite(maxAlertsPerDay) ? Math.min(50, Math.max(1, Math.floor(maxAlertsPerDay))) : 10;

  const { error } = await auth.supabase.from("op_alert_preferences").upsert(
    {
      user_id: auth.user.id,
      channels,
      enabled_types: enabledTypes,
      quiet_hours: quietHours,
      timezone,
      sport_settings: toggleMap(body.sportSettings),
      competition_settings: toggleMap(body.competitionSettings),
      max_alerts_per_day: cappedMax,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
  if (error) return databaseUnavailable("alert preferences write", error, "Could not save alert settings right now.");
  return privateJson({
    ok: true,
    note:
      channels.includes("email") || channels.includes("whatsapp")
        ? "Email and WhatsApp are recorded as preferences but not yet deliverable; push is the only live channel today."
        : undefined
  });
}

export async function DELETE(request: Request) {
  const originError = rejectCrossSiteMutation(request);
  if (originError) return originError;
  const auth = await authClient();
  if (auth.error) return auth.error;
  const { error } = await auth.supabase.from("op_alert_preferences").delete().eq("user_id", auth.user.id);
  if (error) return databaseUnavailable("alert preferences delete", error, "Could not withdraw alert consent right now.");
  return privateJson({ ok: true });
}
