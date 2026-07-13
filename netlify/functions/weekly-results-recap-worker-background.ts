import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
declare const Netlify: { env: { get(name: string): string | undefined } };
const clean = (value?: string | null) => value?.trim() || null;
const tokenMatches = (a: string, b: string) => { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); };
export type WeeklyRecapOutcome = { result: string; odds: number | string; home_team: string | null; away_team: string | null; recommended_selection: string | null; selection: string };
export function buildWeeklyRecap(rows: WeeklyRecapOutcome[], start: Date, end: Date, generatedAt: Date) {
  const wins = rows.filter((row) => row.result === "won"); const losses = rows.filter((row) => row.result === "lost"); const decided = wins.length + losses.length;
  const returns = wins.reduce((sum, row) => sum + Number(row.odds), 0); const best = [...wins].sort((a, b) => Number(b.odds) - Number(a.odds))[0];
  return { week_start: start.toISOString().slice(0, 10), week_end: end.toISOString().slice(0, 10), graded_count: rows.length, wins: wins.length, losses: losses.length, pushes: rows.filter((row) => row.result === "push").length, voids: rows.filter((row) => row.result === "void").length, accuracy: decided ? wins.length / decided : 0, roi: decided ? (returns - decided) / decided : 0, best_call: best ? `${best.home_team ?? "Match"} vs ${best.away_team ?? "opponent"}: ${best.recommended_selection ?? best.selection}` : null, best_call_odds: best ? Number(best.odds) : null, generated_at: generatedAt.toISOString() };
}
export async function runWeeklyRecap({ scheduleToken, adminToken, supabaseUrl, supabaseKey, now = new Date() }: { scheduleToken: string | null; adminToken: string | null; supabaseUrl: string | null; supabaseKey: string | null; now?: Date }) {
  if (!adminToken || !scheduleToken || !tokenMatches(adminToken, scheduleToken)) return Response.json({ success: false, error: "Weekly recap authorization failed." }, { status: 401 });
  if (!supabaseUrl || !supabaseKey) return Response.json({ success: false, error: "Weekly recap database configuration is incomplete." }, { status: 503 });
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); const start = new Date(end); start.setUTCDate(start.getUTCDate() - 7);
  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.from("op_public_prediction_outcomes").select("result,odds,home_team,away_team,recommended_selection,selection").gte("settled_at", start.toISOString()).lt("settled_at", end.toISOString()).in("result", ["won", "lost", "push", "void"]);
  if (error) return Response.json({ success: false, error: error.message }, { status: 500 });
  const rows = (data ?? []) as WeeklyRecapOutcome[];
  const recap = buildWeeklyRecap(rows, start, end, now);
  const { error: writeError } = await db.from("op_weekly_prediction_recaps").upsert(recap, { onConflict: "week_start" });
  return writeError ? Response.json({ success: false, error: writeError.message }, { status: 500 }) : Response.json({ success: true, recap });
}
export default async function handler(request: Request) { return runWeeklyRecap({ scheduleToken: request.headers.get("x-oddspadi-schedule-token"), adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN")), supabaseUrl: clean(Netlify.env.get("SUPABASE_URL")), supabaseKey: clean(Netlify.env.get("SUPABASE_SECRET_KEY")) ?? clean(Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")) }); }
