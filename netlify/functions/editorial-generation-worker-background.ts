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
type PublicPickEditorialRow = {
  id: string;
  fixture_id: string;
  sport: string;
  league: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  market: string;
  selection: string;
  selection_label: string;
  model_probability: number | string;
  value_edge: number | string;
  odds: number | string;
  result: string;
  settled_at: string | null;
  published_at: string;
};

export function publicPickEditorialOutcome(row: PublicPickEditorialRow): EditorialOutcome {
  return {
    id: row.id,
    fixture_external_id: row.fixture_id,
    sport: row.sport,
    league: row.league,
    home_team: row.home_team,
    away_team: row.away_team,
    kickoff_at: row.kickoff_at,
    market: row.market,
    selection: row.selection,
    recommended_selection: row.selection_label,
    model_probability: row.model_probability,
    value_edge: row.value_edge,
    odds: row.odds,
    result: row.result,
    settled_at: row.settled_at,
    created_at: row.published_at
  };
}

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
    db.from("op_public_picks").select("id,fixture_id,sport,league,home_team,away_team,kickoff_at,market,selection,selection_label,model_probability,value_edge,odds,result,settled_at,published_at").order("published_at", { ascending: false }).limit(500),
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
  const sourceRows = mergeEditorialOutcomes(((outcomes ?? []) as PublicPickEditorialRow[]).map(publicPickEditorialOutcome), storedOutcomes);
  const drafts = generateEditorialStories(sourceRows, now);
  if (!drafts.some((story) => story.generator === "daily-slate")) {
    const fixtureDesk = generateFreshFixtureDeskStory((fixtures ?? []) as StoredEditorialFixture[], now);
    if (fixtureDesk) drafts.unshift(fixtureDesk);
  }
  const changed = drafts.filter((story) => prior.get(story.slug)?.data_fingerprint !== story.dataFingerprint).map((story) => ({ ...story, revision: (prior.get(story.slug)?.revision ?? 0) + 1 }));
  const draftSlugs = new Set(drafts.map((story) => story.slug));
  const removedSlugs = ((existing ?? []) as Existing[]).filter((row) => !draftSlugs.has(row.slug)).map((row) => row.slug);
  if (!changed.length && !removedSlugs.length) return Response.json({ success: true, generated: 0, unchanged: drafts.length, removed: 0, slugs: [], removedSlugs: [] });
  if (removedSlugs.length) {
    const { error: deleteError } = await db.from("op_editorial_stories").delete().in("slug", removedSlugs);
    if (deleteError) return Response.json({ success: false, error: deleteError.message }, { status: 500 });
  }
  // Optional prose pass: keeps the deterministic facts, upgrades the writing.
  // Falls back to the deterministic text on any OpenAI failure.
  const polished = changed.length ? await polishEditorialStories(changed, { apiKey: openaiKey, model: openaiModel }) : [];

  // Fail closed. A story that asserts a record must prove it against the
  // ledger at publish time; if it cannot, it is dropped rather than published
  // with a caveat. A missing article is a gap, a false one is the site lying
  // on its own behalf.
  const blocked: Array<{ slug: string; failures: string[] }> = [];
  const published = [];
  for (const story of polished) {
    if (!story.claim) {
      published.push(story);
      continue;
    }
    const ledger = await db
      .from("op_publications")
      .select("id,publication_status,settlement_status,published_at")
      .in("id", story.claim.publicationIds);
    const rows = ledger.error ? null : ledger.data ?? [];
    if (!rows) {
      // The ledger could not be read, so the claim cannot be verified. That is
      // not permission to publish it.
      blocked.push({ slug: story.slug, failures: ["ledger-unreadable"] });
      continue;
    }
    const wins = rows.filter((row) => row.publication_status !== "retracted" && row.settlement_status === "won").length;
    const losses = rows.filter((row) => row.publication_status !== "retracted" && row.settlement_status === "lost").length;
    const failures: string[] = [];
    if (rows.length !== story.claim.publicationIds.length) failures.push("picks-are-official");
    if (wins !== story.claim.statedWins || losses !== story.claim.statedLosses) failures.push("settlement-current");
    if (rows.some((row) => row.publication_status === "retracted")) failures.push("no-retracted-picks");
    if (rows.some((row) => !row.published_at)) failures.push("odds-timestamped");
    if (failures.length) {
      blocked.push({ slug: story.slug, failures });
      continue;
    }
    published.push(story);
  }
  if (blocked.length) {
    console.warn(JSON.stringify({ event: "oddspadi-editorial-validation-blocked", blocked }));
  }

  const payload = published.map((story) => ({ slug: story.slug, generator: story.generator, title: story.title, excerpt: story.excerpt, category: story.category, sport: story.sport, body: story.body, sources: story.sources, revision: story.revision, source_as_of: story.sourceAsOf, published_at: story.publishedAt, updated_at: now.toISOString(), read_minutes: story.readMinutes, data_fingerprint: story.dataFingerprint, claim: story.claim ?? null }));
  const { error: writeError } = payload.length ? await db.from("op_editorial_stories").upsert(payload, { onConflict: "slug" }) : { error: null };
  return writeError ? Response.json({ success: false, error: writeError.message }, { status: 500 }) : Response.json({ success: true, generated: published.length, blocked, blockedCount: blocked.length, unchanged: drafts.length - changed.length, removed: removedSlugs.length, sourceRows: sourceRows.length, storedSlateRows: storedOutcomes.length, slugs: changed.map((story) => story.slug), removedSlugs });
}
export default async function handler(request: Request) { return runEditorialGeneration({ scheduleToken: request.headers.get("x-oddspadi-schedule-token"), adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN")), supabaseUrl: clean(Netlify.env.get("SUPABASE_URL")), supabaseKey: clean(Netlify.env.get("SUPABASE_SECRET_KEY")) ?? clean(Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")), openaiKey: clean(Netlify.env.get("OPENAI_API_KEY")), openaiModel: clean(Netlify.env.get("OPENAI_EDITORIAL_MODEL")) }); }
