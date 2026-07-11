import { apiSuccess } from "@/app/api/sports/_utils";
import { getDecisionMemorySnapshot } from "@/lib/sports/prediction/decisionMemory";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 50) : 12;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const snapshot = await getDecisionMemorySnapshot({ limit: parseLimit(url.searchParams.get("limit")) });
  const traces = snapshot.recentRuns
    .filter((run) => run.brainTrace)
    .map((run) => ({
      runId: run.id,
      fixtureExternalId: run.fixtureExternalId,
      createdAt: run.createdAt,
      recommendedSelection: run.recommendedSelection,
      brain: run.brainTrace
    }));

  return apiSuccess({
    generatedAt: snapshot.generatedAt,
    status: snapshot.status,
    configured: snapshot.configured,
    projectRef: snapshot.projectRef,
    storedRuns: snapshot.summary.totalRuns,
    traces,
    reason: snapshot.reason,
    detail: traces.length
      ? `Loaded ${traces.length} stored agent brain trace(s).`
      : "No stored agent brain traces yet. New persisted decisions will include replayable brain snapshots."
  });
}
