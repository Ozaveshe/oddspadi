import { apiSuccess } from "@/app/api/sports/_utils";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { readDecisionSupabaseLiveMcpProofArtifact } from "@/lib/sports/prediction/decisionSupabaseLiveMcpProofArtifact";
import { buildDecisionSupabaseProjectIsolation, parseObservedMcpTableList } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const readiness = await verifyDecisionEngineReadiness();
  const url = new URL(request.url);
  const artifact = readDecisionSupabaseLiveMcpProofArtifact();
  const observedMcpTables = parseObservedMcpTableList(url.searchParams.get("observedMcpTables"));

  return apiSuccess(
    buildDecisionSupabaseProjectIsolation({
      readiness,
      observedMcpProjectUrl: url.searchParams.get("observedMcpProjectUrl") ?? artifact.artifact?.projectUrl ?? null,
      observedMcpTables: observedMcpTables.length ? observedMcpTables : artifact.artifact?.tables
    })
  );
}

export async function POST(request: Request) {
  const readiness = await verifyDecisionEngineReadiness();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return apiSuccess(
    buildDecisionSupabaseProjectIsolation({
      readiness,
      observedMcpProjectUrl: typeof body.observedMcpProjectUrl === "string" ? body.observedMcpProjectUrl : null,
      observedMcpTables: parseObservedMcpTableList(body.observedMcpTables ?? body.tables ?? body)
    })
  );
}
