import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
declare const Netlify: { env: { get(name: string): string | undefined } };
const clean = (value?: string | null) => value?.trim() || null;
const tokenMatches = (a: string, b: string) => { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); };
/**
 * A row of the weekly recap now means one settled OFFICIAL publication.
 *
 * This job used to read `op_public_prediction_outcomes`, which was filling
 * with paper-mode shadow runs — so /news could report a graded week, with an
 * accuracy and an ROI, in a week where OddsPadi had published nothing. The
 * recap reads the publication ledger, where a row cannot exist unless it was
 * a real pre-kickoff public claim.
 */
export type WeeklyRecapOutcome = { result: string; odds: number | string; home_team: string | null; away_team: string | null; recommended_selection: string | null; selection: string };
export function buildWeeklyRecap(rows: WeeklyRecapOutcome[], start: Date, end: Date, generatedAt: Date) {
  const wins = rows.filter((row) => row.result === "won"); const losses = rows.filter((row) => row.result === "lost"); const decided = wins.length + losses.length;
  const returns = wins.reduce((sum, row) => sum + Number(row.odds), 0); const best = [...wins].sort((a, b) => Number(b.odds) - Number(a.odds))[0];
  // accuracy/roi stay null rather than 0 when nothing was decided: a week with
  // no settled picks has no accuracy, and 0% is a claim about the model.
  return { week_start: start.toISOString().slice(0, 10), week_end: end.toISOString().slice(0, 10), graded_count: rows.length, wins: wins.length, losses: losses.length, pushes: rows.filter((row) => row.result === "push").length, voids: rows.filter((row) => row.result === "void").length, accuracy: decided ? wins.length / decided : null, roi: decided ? (returns - decided) / decided : null, best_call: best ? `${best.home_team ?? "Match"} vs ${best.away_team ?? "opponent"}: ${best.recommended_selection ?? best.selection}` : null, best_call_odds: best ? Number(best.odds) : null, generated_at: generatedAt.toISOString() };
}
export async function runWeeklyRecap({ scheduleToken, adminToken, supabaseUrl, supabaseKey, now = new Date() }: { scheduleToken: string | null; adminToken: string | null; supabaseUrl: string | null; supabaseKey: string | null; now?: Date }) {
  if (!adminToken || !scheduleToken || !tokenMatches(adminToken, scheduleToken)) return Response.json({ success: false, error: "Weekly recap authorization failed." }, { status: 401 });
  if (!supabaseUrl || !supabaseKey) return Response.json({ success: false, error: "Weekly recap database configuration is incomplete." }, { status: 503 });
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); const start = new Date(end); start.setUTCDate(start.getUTCDate() - 7);
  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db
    .from("op_publications")
    .select("settlement_status,odds_at_publication,selection,selection_label,publication_status,metadata")
    .gte("settled_at", start.toISOString())
    .lt("settled_at", end.toISOString())
    .in("settlement_status", ["won", "lost", "push", "void"])
    // A retracted claim is withdrawn; it must not score in either direction.
    .neq("publication_status", "retracted");
  if (error) return Response.json({ success: false, error: error.message }, { status: 500 });
  const rows: WeeklyRecapOutcome[] = (data ?? []).map((row) => ({
    result: String(row.settlement_status),
    odds: Number(row.odds_at_publication),
    home_team: (row.metadata as Record<string, unknown> | null)?.homeTeam as string ?? null,
    away_team: (row.metadata as Record<string, unknown> | null)?.awayTeam as string ?? null,
    recommended_selection: String(row.selection_label ?? row.selection),
    selection: String(row.selection)
  }));
  const recap = buildWeeklyRecap(rows, start, end, now);
  const { error: writeError } = await db.from("op_weekly_prediction_recaps").upsert(recap, { onConflict: "week_start" });
  return writeError ? Response.json({ success: false, error: writeError.message }, { status: 500 }) : Response.json({ success: true, recap });
}
export default async function handler(request: Request) { return runWeeklyRecap({ scheduleToken: request.headers.get("x-oddspadi-schedule-token"), adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN")), supabaseUrl: clean(Netlify.env.get("SUPABASE_URL")), supabaseKey: clean(Netlify.env.get("SUPABASE_SECRET_KEY")) ?? clean(Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")) }); }
