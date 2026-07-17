import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { generateEditorialStories, type EditorialOutcome, type GeneratedEditorialStory } from "../../src/lib/editorial/generatedStories";
import { polishEditorialStories } from "../../src/lib/editorial/aiPolish";
import {
  buildStoredSlateEditorialOutcomes,
  generateFreshFixtureDeskStory,
  mergeEditorialOutcomes,
  type StoredEditorialDecisionSummary,
  type StoredEditorialFixture
} from "../../src/lib/editorial/currentSlateStories";
declare const Netlify: { env: { get(name: string): string | undefined } };
const clean = (value?: string | null) => value?.trim() || null;
const tokenMatches = (a: string, b: string) => { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); };
type Existing = { slug: string; generator: GeneratedEditorialStory["generator"]; revision: number; data_fingerprint: string };
export async function runEditorialGeneration({ scheduleToken, adminToken, supabaseUrl, supabaseKey, openaiKey = null, openaiModel = null, now = new Date() }: { scheduleToken: string | null; adminToken: string | null; supabaseUrl: string | null; supabaseKey: string | null; openaiKey?: string | null; openaiModel?: string | null; now?: Date }) {
  if (!adminToken || !scheduleToken || !tokenMatches(adminToken, scheduleToken)) return Response.json({ success: false, error: "Editorial worker authorization failed." }, { status: 401 });
  if (!supabaseUrl || !supabaseKey) return Response.json({ success: false, error: "Editorial worker database configuration is incomplete." }, { status: 503 });
  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const freshnessStart = new Date(now.getTime() - 6 * 60 * 60_000).toISOString();
  const horizon = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const [
    { data: outcomes, error: outcomesError },
    { data: existing, error: existingError },
    { data: fixtures, error: fixturesError },
    { data: summaries, error: summariesError }
  ] = await Promise.all([
    db.from("op_public_prediction_outcomes").select("id,fixture_external_id,sport,league,home_team,away_team,kickoff_at,market,selection,recommended_selection,model_probability,value_edge,odds,result,settled_at,created_at").order("created_at", { ascending: false }).limit(500),
    db.from("op_editorial_stories").select("slug,generator,revision,data_fingerprint").gte("published_at", `${now.toISOString().slice(0, 10)}T00:00:00Z`),
    db.from("op_fixtures").select("external_id,sport,league_name,home_team_name,away_team_name,kickoff_at,last_synced_at").gte("kickoff_at", now.toISOString()).lt("kickoff_at", horizon).gte("last_synced_at", freshnessStart).in("status", ["scheduled", "not_started"]).order("kickoff_at", { ascending: true }).limit(500),
    db.from("op_fixture_decision_summaries").select("fixture_external_id,generated_at,expires_at,best_published_pick,best_lean,best_watchlist_candidate,all_market_analyses").gte("generated_at", freshnessStart).is("superseded_by", null).order("generated_at", { ascending: false }).limit(500)
  ]);
  if (outcomesError || existingError || fixturesError || summariesError) return Response.json({ success: false, error: outcomesError?.message ?? existingError?.message ?? fixturesError?.message ?? summariesError?.message }, { status: 500 });
  const prior = new Map(((existing ?? []) as Existing[]).map((row) => [row.slug, row]));
  const storedOutcomes = buildStoredSlateEditorialOutcomes(
    (fixtures ?? []) as StoredEditorialFixture[],
    (summaries ?? []) as StoredEditorialDecisionSummary[],
    now
  );
  const sourceRows = mergeEditorialOutcomes((outcomes ?? []) as EditorialOutcome[], storedOutcomes);
  const drafts = generateEditorialStories(sourceRows, now);
  if (!drafts.some((story) => story.generator === "daily-slate")) {
    const fixtureDesk = generateFreshFixtureDeskStory((fixtures ?? []) as StoredEditorialFixture[], now);
    if (fixtureDesk) drafts.unshift(fixtureDesk);
  }
  const changed = drafts.filter((story) => prior.get(story.slug)?.data_fingerprint !== story.dataFingerprint).map((story) => ({ ...story, revision: (prior.get(story.slug)?.revision ?? 0) + 1 }));
  if (!changed.length) return Response.json({ success: true, generated: 0, unchanged: drafts.length, slugs: [] });
  // Optional prose pass: keeps the deterministic facts, upgrades the writing.
  // Falls back to the deterministic text on any OpenAI failure.
  const published = await polishEditorialStories(changed, { apiKey: openaiKey, model: openaiModel });
  const payload = published.map((story) => ({ slug: story.slug, generator: story.generator, title: story.title, excerpt: story.excerpt, category: story.category, sport: story.sport, body: story.body, sources: story.sources, revision: story.revision, source_as_of: story.sourceAsOf, published_at: story.publishedAt, updated_at: now.toISOString(), read_minutes: story.readMinutes, data_fingerprint: story.dataFingerprint }));
  const { error: writeError } = await db.from("op_editorial_stories").upsert(payload, { onConflict: "slug" });
  return writeError ? Response.json({ success: false, error: writeError.message }, { status: 500 }) : Response.json({ success: true, generated: changed.length, unchanged: drafts.length - changed.length, sourceRows: sourceRows.length, storedSlateRows: storedOutcomes.length, slugs: changed.map((story) => story.slug) });
}
export default async function handler(request: Request) { return runEditorialGeneration({ scheduleToken: request.headers.get("x-oddspadi-schedule-token"), adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN")), supabaseUrl: clean(Netlify.env.get("SUPABASE_URL")), supabaseKey: clean(Netlify.env.get("SUPABASE_SECRET_KEY")) ?? clean(Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")), openaiKey: clean(Netlify.env.get("OPENAI_API_KEY")), openaiModel: clean(Netlify.env.get("OPENAI_EDITORIAL_MODEL")) }); }
