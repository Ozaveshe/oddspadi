import { getSupabaseServerClient } from "@/lib/supabase/server";
import { privateJson } from "@/lib/security/privateJson";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { readLatestDecisionSummary } from "@/lib/sports/intelligence/repository";

export const dynamic = "force-dynamic";

/**
 * Recheck: the freshest public state for a workspace's fixtures.
 *
 * Returns fixture lifecycle (started? finished? current score), the official
 * publication state, and the latest decision summary's public fields — the
 * same data the fixture's own page shows. The client decides what to do with
 * it; this route never edits a workspace and never rewrites a frozen
 * snapshot's numbers.
 */

const MAX_FIXTURES = 20;

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request);
  if (originError) return originError;
  const service = getSupabaseServerClient();
  if (!service) return privateJson({ error: "Recheck is not configured." }, { status: 503 });

  const parsed = await readBoundedJson<{ fixtureIds?: unknown }>(request, 16_000);
  if (!parsed.ok) return parsed.response;
  const fixtureIds = Array.isArray(parsed.value.fixtureIds)
    ? parsed.value.fixtureIds.filter((value): value is string => typeof value === "string" && value.length <= 120)
    : null;
  if (!fixtureIds || !fixtureIds.length) return privateJson({ error: "Send { fixtureIds: [...] }." }, { status: 400 });
  if (fixtureIds.length > MAX_FIXTURES) return privateJson({ error: `At most ${MAX_FIXTURES} fixtures recheck at once.` }, { status: 400 });

  const unique = [...new Set(fixtureIds)];

  const { data: fixtures, error: fixtureError } = await service
    .from("op_fixtures")
    .select("external_id,status,kickoff_at,home_score,away_score")
    .in("external_id", unique);
  if (fixtureError) return databaseUnavailable("workspace recheck fixtures", fixtureError, "Recheck is temporarily unavailable.");

  const { data: publications, error: publicationError } = await service
    .from("op_publications")
    .select("id,fixture_external_id,market,selection,selection_label,publication_status,settlement_status,model_probability,implied_probability,published_at")
    .in("fixture_external_id", unique)
    .in("publication_status", ["published", "corrected"]);
  if (publicationError) return databaseUnavailable("workspace recheck publications", publicationError, "Recheck is temporarily unavailable.");

  const summaries: Record<string, unknown> = {};
  for (const externalId of unique) {
    const summary = await readLatestDecisionSummary(externalId, service);
    if (summary) {
      // Public fields only — the same boundary the fixture page draws.
      summaries[externalId] = {
        publicStatus: summary.publicStatus,
        generatedAt: summary.generatedAt,
        expiresAt: summary.expiresAt,
        bestPublishedPick: summary.bestPublishedPick ?? null
      };
    }
  }

  return privateJson({
    fixtures: Object.fromEntries(
      (fixtures ?? []).map((row) => [
        String(row.external_id),
        {
          status: String(row.status ?? "unknown"),
          kickoffAt: row.kickoff_at ?? null,
          homeScore: row.home_score ?? null,
          awayScore: row.away_score ?? null
        }
      ])
    ),
    officialPublications: Object.fromEntries(
      (publications ?? []).map((row) => [String(row.fixture_external_id), row])
    ),
    decisionSummaries: summaries,
    checkedAt: new Date().toISOString()
  });
}
