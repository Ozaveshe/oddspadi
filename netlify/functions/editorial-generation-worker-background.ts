import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { generateEditorialStories, type EditorialOutcome, type GeneratedEditorialStory } from "../../src/lib/editorial/generatedStories";
declare const Netlify: { env: { get(name: string): string | undefined } };
const clean = (value?: string | null) => value?.trim() || null;
const tokenMatches = (a: string, b: string) => { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); };
type Existing = { slug: string; generator: GeneratedEditorialStory["generator"]; revision: number; data_fingerprint: string };
export async function runEditorialGeneration({ scheduleToken, adminToken, supabaseUrl, supabaseKey, now = new Date() }: { scheduleToken: string | null; adminToken: string | null; supabaseUrl: string | null; supabaseKey: string | null; now?: Date }) {
  if (!adminToken || !scheduleToken || !tokenMatches(adminToken, scheduleToken)) return Response.json({ success: false, error: "Editorial worker authorization failed." }, { status: 401 });
  if (!supabaseUrl || !supabaseKey) return Response.json({ success: false, error: "Editorial worker database configuration is incomplete." }, { status: 503 });
  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ data: outcomes, error: outcomesError }, { data: existing, error: existingError }] = await Promise.all([
    db.from("op_public_prediction_outcomes").select("id,fixture_external_id,sport,league,home_team,away_team,kickoff_at,market,selection,recommended_selection,model_probability,value_edge,odds,result,settled_at,created_at").order("created_at", { ascending: false }).limit(500),
    db.from("op_editorial_stories").select("slug,generator,revision,data_fingerprint").gte("published_at", `${now.toISOString().slice(0, 10)}T00:00:00Z`)
  ]);
  if (outcomesError || existingError) return Response.json({ success: false, error: outcomesError?.message ?? existingError?.message }, { status: 500 });
  const prior = new Map(((existing ?? []) as Existing[]).map((row) => [row.slug, row]));
  const drafts = generateEditorialStories((outcomes ?? []) as EditorialOutcome[], now);
  const changed = drafts.filter((story) => prior.get(story.slug)?.data_fingerprint !== story.dataFingerprint).map((story) => ({ ...story, revision: (prior.get(story.slug)?.revision ?? 0) + 1 }));
  if (!changed.length) return Response.json({ success: true, generated: 0, unchanged: drafts.length, slugs: [] });
  const payload = changed.map((story) => ({ slug: story.slug, generator: story.generator, title: story.title, excerpt: story.excerpt, category: story.category, sport: story.sport, body: story.body, sources: story.sources, revision: story.revision, source_as_of: story.sourceAsOf, published_at: story.publishedAt, updated_at: now.toISOString(), read_minutes: story.readMinutes, data_fingerprint: story.dataFingerprint }));
  const { error: writeError } = await db.from("op_editorial_stories").upsert(payload, { onConflict: "slug" });
  return writeError ? Response.json({ success: false, error: writeError.message }, { status: 500 }) : Response.json({ success: true, generated: changed.length, unchanged: drafts.length - changed.length, slugs: changed.map((story) => story.slug) });
}
export default async function handler(request: Request) { return runEditorialGeneration({ scheduleToken: request.headers.get("x-oddspadi-schedule-token"), adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN")), supabaseUrl: clean(Netlify.env.get("SUPABASE_URL")), supabaseKey: clean(Netlify.env.get("SUPABASE_SECRET_KEY")) ?? clean(Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")) }); }
