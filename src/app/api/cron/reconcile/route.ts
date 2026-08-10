import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isCronAuthorized } from "@/lib/sports/intelligence/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeExceptions, type PendingException } from "@/lib/settlement/exceptionWriter";
import { toPublicRunReceipt } from "@/lib/sports/intelligence/publicRunReceipt";
import { readLatestProviderRun, startProviderRun, finishProviderRun } from "@/lib/sports/intelligence/repository";
import {
  reconcile,
  EMPTY_RECONCILER_INPUT,
  type ReconcilerInput,
  type ReconcilerFinding
} from "@/lib/reconciliation/detections";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * Scheduled production reconciler.
 *
 * Reads the truth sources with the service role (READ ONLY), detects the
 * mismatch classes in @/lib/reconciliation/detections, and ALERTS by writing
 * one op_settlement_exceptions row per finding through op_record_settlement_exception.
 * It never corrects a source table — immutable records stay immutable, and a
 * mismatch becomes a case for a human, not a silent rewrite.
 *
 * An unreadable source is reported as `could_not_check` (502) with NO exception
 * rows — an unread source is never a false "clean".
 */

const LIMIT = 1000;

async function tryRead<T>(
  label: string,
  couldNotCheck: string[],
  run: () => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  try {
    const { data, error } = await run();
    if (error) {
      couldNotCheck.push(label);
      return [];
    }
    return (data as T[] | null) ?? [];
  } catch {
    couldNotCheck.push(label);
    return [];
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

async function gather(client: SupabaseClient): Promise<{ input: ReconcilerInput; couldNotCheck: string[] }> {
  const couldNotCheck: string[] = [];
  const [fixtureRows, pubRows, storyRows, decisionRows, resultRows, tipRows, projRows, dupRows, closeRows, modelRows] =
    await Promise.all([
      tryRead<Record<string, unknown>>("op_fixtures", couldNotCheck, () =>
        client.from("op_fixtures").select("id,external_id,status,last_synced_at,metadata").limit(LIMIT)
      ),
      tryRead<Record<string, unknown>>("op_publications", couldNotCheck, () =>
        client.from("op_publications").select("id,fixture_id,fixture_external_id,settlement_status,model_version,kickoff_at,publication_status").in("publication_status", ["published", "corrected", "retracted"]).limit(LIMIT)
      ),
      tryRead<Record<string, unknown>>("op_editorial_stories", couldNotCheck, () =>
        client.from("op_editorial_stories").select("slug,body,claim").limit(LIMIT)
      ),
      tryRead<Record<string, unknown>>("op_fixture_decision_summaries", couldNotCheck, () =>
        client.from("op_fixture_decision_summaries").select("fixture_external_id,generated_at,superseded_by").is("superseded_by", null).limit(LIMIT)
      ),
      tryRead<Record<string, unknown>>("op_fixture_results", couldNotCheck, () =>
        client.from("op_fixture_results").select("fixture_id,verification_state,is_current").eq("is_current", true).limit(LIMIT)
      ),
      tryRead<Record<string, unknown>>("op_community_tips", couldNotCheck, () =>
        client.from("op_community_tips").select("id,fixture_id,deleted_at,moderated_at").limit(LIMIT)
      ),
      tryRead<Record<string, unknown>>("op_public_projections", couldNotCheck, () =>
        client.from("op_public_projections").select("name,scope,built_at").limit(LIMIT)
      ),
      tryRead<Record<string, unknown>>("op_fixtures_duplicates", couldNotCheck, () =>
        client.from("op_fixtures").select("id,metadata").not("metadata->>duplicateOf", "is", null).limit(LIMIT)
      ),
      tryRead<Record<string, unknown>>("op_closing_prices", couldNotCheck, () =>
        client.from("op_closing_prices").select("publication_id,is_current,capture_status").eq("is_current", true).limit(LIMIT)
      ),
      tryRead<Record<string, unknown>>("op_model_registry", couldNotCheck, () =>
        client.from("op_model_registry").select("model_id,state").eq("state", "approved").limit(LIMIT)
      )
    ]);

  const capturedPublicationIds = new Set(
    closeRows.filter((row) => str(row.capture_status) === "captured").map((row) => str(row.publication_id)).filter(Boolean)
  );
  const approvedModelVersions = modelRows.map((row) => str(row.model_id)).filter((value): value is string => Boolean(value));

  const input: ReconcilerInput = {
    ...EMPTY_RECONCILER_INPUT,
    fixtures: fixtureRows.map((row) => ({
      id: String(row.id),
      externalId: str(row.external_id),
      status: str(row.status) ?? "unknown",
      lastSyncedAt: str(row.last_synced_at)
    })),
    publications: pubRows.map((row) => ({
      id: String(row.id),
      fixtureId: str(row.fixture_id),
      fixtureExternalId: str(row.fixture_external_id),
      settlementStatus: str(row.settlement_status),
      modelVersion: str(row.model_version),
      hasCurrentClose: capturedPublicationIds.has(String(row.id)),
      kickoffAt: str(row.kickoff_at),
      publicationStatus: str(row.publication_status) ?? "published"
    })),
    stories: storyRows.map((row) => {
      const claim = (row.claim ?? {}) as Record<string, unknown>;
      const cited = Array.isArray(claim.publicationIds) ? (claim.publicationIds as unknown[]).map(String) : [];
      return {
        slug: String(row.slug),
        claimsACount: /\b\d+\s+(winning\s+)?(picks?|selections?|tips?)\b/i.test(String(row.body ?? "")),
        citedPublicationIds: cited
      };
    }),
    decisions: decisionRows.map((row) => ({
      fixtureExternalId: String(row.fixture_external_id),
      generatedAt: str(row.generated_at),
      supersededBy: str(row.superseded_by)
    })),
    results: resultRows.map((row) => ({
      fixtureId: String(row.fixture_id),
      verificationState: str(row.verification_state) ?? "provisional",
      isCurrent: Boolean(row.is_current)
    })),
    tips: tipRows.map((row) => ({
      id: String(row.id),
      fixtureId: str(row.fixture_id),
      deletedAt: str(row.deleted_at),
      moderatedAt: str(row.moderated_at)
    })),
    projections: projRows.map((row) => ({ name: String(row.name), scope: String(row.scope ?? ""), builtAt: str(row.built_at) })),
    duplicates: dupRows.map((row) => ({ id: String(row.id), duplicateOf: String((row.metadata as Record<string, unknown> | null)?.duplicateOf ?? "") })),
    approvedModelVersions
  };
  return { input, couldNotCheck };
}

function toException(finding: ReconcilerFinding): PendingException {
  return {
    kind: `reconciler_${finding.kind}`,
    severity: finding.severity,
    // Entity ids are carried in detail, not the FK columns, so a story slug,
    // projection name or external id can never violate a fixture/publication FK.
    detail: { source: "production-reconciler", entity: finding.entity, message: finding.detail }
  };
}

export async function GET() {
  const run = await readLatestProviderRun(["production-reconcile"]);
  return apiSuccess(toPublicRunReceipt(run));
}

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return apiError("Unauthorized.", 401);
  const client = getSupabaseServerClient();
  if (!client) return apiError("Server storage is not configured.", 503);

  const startedAt = new Date().toISOString();
  const claim = await startProviderRun({ providerName: "oddspadi-reconciler", jobType: "production-reconcile", startedAt, client });
  if (claim && !claim.acquired) return apiSuccess({ status: "skipped", reason: "pipeline busy" });

  const { input, couldNotCheck } = await gather(client);
  const report = reconcile(input, new Date(), couldNotCheck);

  let written = 0;
  if (report.status === "findings") {
    const result = await writeExceptions(client, report.findings.map(toException), { persist: true });
    written = result.written;
  }

  if (claim?.run) {
    await finishProviderRun(
      claim.run,
      {
        finishedAt: new Date().toISOString(),
        status: report.status === "could_not_check" ? "partial" : "completed",
        fixturesFound: input.fixtures.length,
        oddsFound: 0,
        predictionsGenerated: written,
        valuePicksPublished: 0,
        errors: report.couldNotCheck
      },
      client
    );
  }

  // Minimal response: counts and status, never the raw findings or source text.
  const body = { status: report.status, findingCount: report.findings.length, alertsWritten: written, couldNotCheck: report.couldNotCheck.length };
  return report.status === "could_not_check" ? apiError("Reconciler could not read every source.", 502) : apiSuccess(body);
}
